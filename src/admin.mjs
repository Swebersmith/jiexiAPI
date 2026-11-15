import { html, client, styles } from './admin-page.mjs';
import { loadConfig, saveConfig } from './config.mjs';

const encoder = new TextEncoder();
const fail = (message, status) => Object.assign(new Error(message), { status });
const reply = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
async function key(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.MEDIA_SECRET + '\n' + env.ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(value, env) { return hex(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(value))); }
async function verify(value, signature, env) {
  if (!/^[a-f0-9]{64}$/.test(signature || '')) return false;
  return crypto.subtle.verify('HMAC', await key(env), Uint8Array.from(signature.match(/../g), part => parseInt(part, 16)), encoder.encode(value));
}
async function authenticated(request, env) {
  const token = /(?:^|;\s*)jiexi_admin=([^;]+)/.exec(request.headers.get('Cookie') || '')?.[1] || '';
  const [expires, nonce, signature] = token.split('.');
  return /^\d+$/.test(expires || '') && Number(expires) > Date.now() / 1000 && Number(expires) <= Date.now() / 1000 + 28860 && /^[a-f0-9-]{36}$/.test(nonce || '') && await verify(expires + '.' + nonce, signature, env);
}

export async function handleAdmin(request, env, readText) {
  const url = new URL(request.url);
  if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return null;
  let response;
  try {
    if (['GET', 'HEAD'].includes(request.method) && ['/admin', '/admin/', '/admin/app.js', '/admin/style.css'].includes(url.pathname)) {
      const script = url.pathname.endsWith('.js'), css = url.pathname.endsWith('.css');
      response = new Response(request.method === 'HEAD' ? null : script ? client : css ? styles : html, { headers: { 'Content-Type': script ? 'text/javascript; charset=utf-8' : css ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' } });
    } else {
      if (!env.ADMIN_PASSWORD || !env.MEDIA_SECRET) throw fail('管理员密码尚未配置', 503);
      if (!['GET', 'POST', 'PUT'].includes(request.method)) throw fail('请求方法不受支持', 405);
      if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) throw fail('管理请求来源无效', 403);
      if (url.pathname === '/admin/api/login' && request.method === 'POST') {
        let data;
        try { data = JSON.parse(await readText(new Response(request.body), 2048)); } catch { throw fail('登录请求格式无效', 400); }
        if (typeof data.password !== 'string' || !await verify(data.password, await sign(env.ADMIN_PASSWORD, env), env)) throw fail('管理密码错误', 401);
        const value = Math.floor(Date.now() / 1000 + 28800) + '.' + crypto.randomUUID();
        response = reply({ ok: true }, 200, { 'Set-Cookie': 'jiexi_admin=' + value + '.' + await sign(value, env) + '; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=28800' });
      } else {
        if (!await authenticated(request, env)) throw fail('请先登录管理后台', 401);
        if (url.pathname === '/admin/api/logout' && request.method === 'POST') response = reply({ ok: true }, 200, { 'Set-Cookie': 'jiexi_admin=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
        else if (url.pathname === '/admin/api/config' && request.method === 'GET') response = reply({ ...await loadConfig(env), publicOrigin: env.PUBLIC_ORIGIN || url.origin });
        else if (url.pathname === '/admin/api/config' && request.method === 'PUT') {
          let data;
          try { data = JSON.parse(await readText(new Response(request.body), 131072)); } catch { throw fail('配置请求格式无效或过大', 400); }
          response = reply(await saveConfig(env, data));
        } else throw fail('管理接口不存在', 404);
      }
    }
  } catch (err) { response = reply({ error: { message: err.status ? err.message : '管理服务暂时不可用' } }, err.status || 503); }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  return new Response(response.body, { status: response.status, headers });
}
