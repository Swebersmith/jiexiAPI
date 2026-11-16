import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.mjs';
import { loadConfig, saveConfig, validateConfig } from '../src/config.mjs';

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

test('saves write-only encrypted AI credentials, preserves them on legacy saves and supports deployment-key fallback', async () => {
  const env = environment(); env.GLM_API_KEY = 'deployed-test-key';
  try {
    const login = await call(env, '/admin/api/login', { method: 'POST', headers: { Origin: 'https://admin.demo.site' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) });
    const cookie = login.headers.get('Set-Cookie').split(';')[0];
    const headers = { Cookie: cookie, Origin: 'https://admin.demo.site' };
    const initial = await (await call(env, '/admin/api/config', { headers })).json();
    const response = await call(env, '/admin/api/config', { method: 'PUT', headers, body: JSON.stringify({ ...initial, aiSearch: { enabled: true, model: 'glm-4-flash-250414', apiKey: 'new-private-key' } }) });
    const saved = await response.json();
    assert.equal(saved.aiSearch.keySource, 'custom');
    assert.equal(saved.aiSearch.keyConfigured, true);
    assert.equal(JSON.stringify(saved).includes('new-private-key'), false);
    assert.equal(saved.aiSearch.encryptedKey, undefined);
    assert.equal(env.db.prepare('SELECT value FROM service_config').get().value.includes('new-private-key'), false);
    const before = (await loadConfig(env)).aiSearch.encryptedKey;
    const legacy = await saveConfig(env, { sources: saved.sources, pageEnabled: true, revision: saved.revision });
    assert.equal(legacy.aiSearch.encryptedKey, before);
    const cleared = await call(env, '/admin/api/config', { method: 'PUT', headers, body: JSON.stringify({ ...saved, revision: legacy.revision, aiSearch: { clearKey: true } }) });
    assert.equal((await cleared.json()).aiSearch.keySource, 'environment');
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
    const data = { ...config, pageEnabled: false };
    const options = { method: 'PUT', headers: { Cookie: cookie, Origin: 'https://admin.demo.site' }, body: JSON.stringify(data) };
    const saved = await (await call(env, '/admin/api/config', options)).json();
    assert.equal(saved.revision, 1);
    assert.equal((await loadConfig(env)).pageEnabled, false);
    assert.equal((await call(env, '/admin/api/config', options)).status, 409);
    assert.equal((await call(env, '/api/resolve?input=' + encodeURIComponent('https://v.qq.com/x/page/test.html'))).status, 503);
    const next = await saveConfig(env, { ...saved, pageEnabled: true });
    assert.equal(next.revision, 2);
    assert.equal((await loadConfig(env)).pageEnabled, true);
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
    const { pageEnabled, ...legacy } = initial;
    assert.equal(validateConfig({ ...legacy, qlEnabled: false }).pageEnabled, true);
    await assert.rejects(saveConfig(env, { ...initial, sources: [{ ...initial.sources[0], url: 'https://localhost/api' }] }));
    await assert.rejects(saveConfig(env, { ...initial, sources: [initial.sources[0], initial.sources[0]] }));
    const results = await Promise.allSettled([saveConfig(env, initial), saveConfig(env, initial)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await loadConfig(env)).revision, 1);
  } finally { env.db.close(); }
});

test('persists parser order and preserves services when a legacy client saves sources', async () => {
  const env = environment();
  try {
    const initial = await loadConfig(env);
    const parser = id => ({ id, name: id, url: 'https://' + id + '.parser.demo.site/api', enabled: true });
    const saved = await saveConfig(env, { ...initial, parsers: [parser('second'), parser('first')], parserMode: 'combined' });
    const next = await saveConfig(env, { sources: saved.sources, pageEnabled: true, revision: saved.revision });
    assert.deepEqual(next.parsers.map(parser => parser.id), ['second', 'first']);
    assert.equal(next.parserMode, 'combined');
    await assert.rejects(saveConfig(env, { ...next, parsers: null }));
  } finally { env.db.close(); }
});
