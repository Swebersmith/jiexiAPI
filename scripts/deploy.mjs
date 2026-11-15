import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('请在环境变量中设置 CLOUDFLARE_ACCOUNT_ID 与 CLOUDFLARE_API_TOKEN');
const config = JSON.parse(await readFile(new URL('../deployment.json', import.meta.url), 'utf8'));
const { name, ...metadata } = config;
async function api(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(JSON.stringify(result.errors));
  return result.result;
}
let existing = [];
try { existing = (await api(`scripts/${name}/secrets`)); }
catch (err) { if (!String(err).includes('10007')) throw err; }
if (existing.some(secret => secret.name === 'MEDIA_SECRET')) metadata.keep_bindings = ['secret_text'];
else metadata.bindings.push({ type: 'secret_text', name: 'MEDIA_SECRET', text: randomBytes(32).toString('hex') });
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
for (const file of ['worker.mjs', 'parser-resolver.mjs']) {
  form.append(file, new Blob([await readFile(new URL('../src/' + file, import.meta.url))], { type: 'application/javascript+module' }), file);
}
await api(`scripts/${name}`, { method: 'PUT', body: form });
await api(`scripts/${name}/subdomain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
const subdomain = await api('subdomain');
console.log(`https://${name}.${subdomain.subdomain}.workers.dev`);
