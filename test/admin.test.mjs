import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.mjs';
import { loadConfig, saveConfig } from '../src/config.mjs';

function environment() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return {
    MEDIA_SECRET: 'test-secret-test-secret-test-secret', ADMIN_PASSWORD: 'test-admin-password-test-admin',
    CMS_SOURCES: JSON.stringify([{ id: 'ruyi', name: '如意', url: 'https://cms.demo.site/api' }]),
    CONFIG_DB: { prepare(sql) {
      const statement = db.prepare(sql);
      let values = [];
      return { bind(...args) { values = args; return this; }, async first() { return statement.get(...values) || null; }, async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; } };
    } },
    db,
  };
}
const call = (env, path, options = {}) => worker.fetch(new Request('https://admin.demo.site' + path, options), env);

test('protects configuration and rejects login from a foreign origin', async () => {
  const env = environment();
  try {
    assert.equal((await call(env, '/admin/')).status, 200);
    const anonymous = await call(env, '/admin/api/config');
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.text()).includes('CMS_SOURCES'), false);
    assert.equal((await call(env, '/admin/api/login', { method: 'POST', headers: { Origin: 'https://foreign.demo.site' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) })).status, 403);
    assert.equal((await call(env, '/admin/api/login', { method: 'POST', headers: { Origin: 'https://admin.demo.site' }, body: JSON.stringify({ password: 'incorrect' }) })).status, 401);
  } finally { env.db.close(); }
});

test('logs in, updates persistent configuration, rejects stale saves and logs out', async () => {
  const env = environment();
  try {
    const login = await call(env, '/admin/api/login', { method: 'POST', headers: { Origin: 'https://admin.demo.site' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('Set-Cookie').split(';')[0];
    assert.match(login.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
    const config = await (await call(env, '/admin/api/config', { headers: { Cookie: cookie } })).json();
    assert.equal(config.revision, 0);
    const data = { ...config, qlEnabled: false };
    const options = { method: 'PUT', headers: { Cookie: cookie, Origin: 'https://admin.demo.site' }, body: JSON.stringify(data) };
    const saved = await (await call(env, '/admin/api/config', options)).json();
    assert.equal(saved.revision, 1);
    assert.equal((await loadConfig(env)).qlEnabled, false);
    assert.equal((await call(env, '/admin/api/config', options)).status, 409);
    assert.equal((await call(env, '/api/resolve?input=' + encodeURIComponent('https://v.qq.com/x/page/test.html'))).status, 503);
    const next = await saveConfig(env, { ...saved, qlEnabled: true });
    assert.equal(next.revision, 2);
    assert.equal((await loadConfig(env)).qlEnabled, true);
    const logout = await call(env, '/admin/api/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://admin.demo.site' } });
    assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
    env.ADMIN_PASSWORD += 'rotated';
    assert.equal((await call(env, '/admin/api/config', { headers: { Cookie: cookie } })).status, 401);
  } finally { env.db.close(); }
});

test('validates source configuration and prevents lost updates', async () => {
  const env = environment();
  try {
    const initial = await loadConfig(env);
    await assert.rejects(saveConfig(env, { ...initial, sources: [{ ...initial.sources[0], url: 'https://localhost/api' }] }));
    await assert.rejects(saveConfig(env, { ...initial, sources: [initial.sources[0], initial.sources[0]] }));
    const results = await Promise.allSettled([saveConfig(env, initial), saveConfig(env, initial)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await loadConfig(env)).revision, 1);
  } finally { env.db.close(); }
});
