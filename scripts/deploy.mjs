import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('请在环境变量中设置 CLOUDFLARE_ACCOUNT_ID 与 CLOUDFLARE_API_TOKEN');
const config = JSON.parse(await readFile(new URL('../deployment.json', import.meta.url), 'utf8'));
const { name, ...metadata } = config;
async function api(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(JSON.stringify(result.errors));
  return result.result;
}
let existing = [];
try { existing = (await api(`workers/scripts/${name}/secrets`)); }
catch (err) { if (!String(err).includes('10007')) throw err; }
metadata.keep_bindings = ['secret_text'];
if (!existing.some(secret => secret.name === 'MEDIA_SECRET')) metadata.bindings.push({ type: 'secret_text', name: 'MEDIA_SECRET', text: randomBytes(32).toString('hex') });
if (!existing.some(secret => secret.name === 'ADMIN_PASSWORD')) {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 20) throw new Error('首次启用管理后台需要通过 ADMIN_PASSWORD 环境变量设置至少 20 字符的管理密码');
  metadata.bindings.push({ type: 'secret_text', name: 'ADMIN_PASSWORD', text: process.env.ADMIN_PASSWORD });
}
const database = metadata.bindings.find(binding => binding.name === 'CONFIG_DB');
if (!database?.id) throw new Error('请在 deployment.json 中绑定 CONFIG_DB D1 数据库');
await api(`d1/database/${database.id}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: await readFile(new URL('../schema.sql', import.meta.url), 'utf8') }) });
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
for (const file of (await readdir(new URL('../src/', import.meta.url))).filter(file => file.endsWith('.mjs'))) {
  form.append(file, new Blob([await readFile(new URL('../src/' + file, import.meta.url))], { type: 'application/javascript+module' }), file);
}
await api(`workers/scripts/${name}`, { method: 'PUT', body: form });
await api(`workers/scripts/${name}/subdomain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
const subdomain = await api('workers/subdomain');
console.log(`https://${name}.${subdomain.subdomain}.workers.dev`);
