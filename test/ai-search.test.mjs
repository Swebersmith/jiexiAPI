import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSearchResults, encryptAiKey, publicAiSearch, similarTitle, validateAiSearch } from '../src/ai-search.mjs';
import worker from '../src/worker.mjs';

const item = (id, title) => ({ id, title, year: '2026', type: '国产剧', language: '普通话', groupKey: title + '|2026|mandarin' });
const search = { kind: 'search', query: '走马上任', warning: '', providers: [], items: [item('ruyi:1', '走马上任'), item('bfzy:2', '走马上任'), item('czzy:3', '走马上任'), item('bfzy:4', '代理市长'), item('bfzy:5', '新局长到来之前')] };
const env = { AI_SEARCH_CONFIG: { enabled: true, model: 'glm-4-flash-250414' }, GLM_API_KEY: 'test-only-glm-key', MEDIA_SECRET: 'test-media-secret-long-enough' };
const completion = relevant => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ relevant }) } }] });

test('filters public search candidates, preserves all sources for an exact title and rejects thematic false positives', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-only-glm-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'glm-4-flash-250414');
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.candidates.length, 3);
    assert.equal(options.redirect, 'manual');
    assert.equal(JSON.stringify(input).includes('test-only-glm-key'), false);
    return completion([1, 2]);
  };
  try {
    const result = await filterSearchResults(search, env);
    assert.deepEqual(result.items.map(item => item.id), ['ruyi:1', 'bfzy:2', 'czzy:3']);
    assert.equal(result.aiFilter.removedCount, 2);
    assert.equal(result.aiFilter.status, 'filtered');
    assert.equal(JSON.stringify(result).includes(env.GLM_API_KEY), false);
    assert.equal(search.items.length, 5);
    assert.equal(similarTitle('走马上仼', '走马上任'), true);
    assert.equal(similarTitle('走马', '走马上任'), true);
    assert.equal(similarTitle('走马上任', '马'), false);
  } finally { globalThis.fetch = original; }
});

test('retains partial and typo matches selected by AI and accepts an empty relevant list', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => completion([0, 1, 2]);
  try {
    for (const query of ['走马', '走马上仼']) {
      const result = await filterSearchResults({ ...search, query }, env);
      assert.equal(result.items.length, 3);
    }
    globalThis.fetch = async () => completion([]);
    const result = await filterSearchResults({ ...search, query: '完全不存在的作品' }, env);
    assert.deepEqual(result.items, []);
  } finally { globalThis.fetch = original; }
});

test('falls back transparently on invalid output, unavailable credentials or provider failures without leaking data', async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [completion([999]), new Response('not JSON'), new Response(env.GLM_API_KEY, { status: 401 }), new Response(null, { status: 302, headers: { Location: 'https://other.demo.site/' } }), Response.json({ choices: [{ finish_reason: 'length', message: { content: '{' } }] })]) {
      globalThis.fetch = async () => response;
      const result = await filterSearchResults(search, env);
      assert.equal(result.items.length, 5);
      assert.equal(result.aiFilter.status, 'unavailable');
      assert.equal(JSON.stringify(result).includes(env.GLM_API_KEY), false);
      assert.match(result.warning, /原始结果/);
    }
    const missing = await filterSearchResults(search, { AI_SEARCH_CONFIG: { enabled: true } });
    assert.match(missing.aiFilter.message, /API Key/);
    globalThis.fetch = () => { throw Error('Disabled AI must not call the provider'); };
    assert.equal(await filterSearchResults(search, {}), search);
    const empty = await filterSearchResults({ ...search, items: [] }, env);
    assert.equal(empty.items.length, 0);
    assert.equal(empty.aiFilter.status, 'empty');
  } finally { globalThis.fetch = original; }
});

test('caches decisions by candidate snapshot, configuration revision and query', async () => {
  const original = globalThis.fetch;
  const cache = new Map(); let calls = 0;
  const database = { prepare(sql) { let values; return { bind(...args) { values = args; return this; },
    async first() { return cache.has(values[0]) ? { value: cache.get(values[0]) } : null; },
    async run() { cache.set(values[0], values[1]); return { meta: { changes: 1 } }; } }; } };
  globalThis.fetch = async () => { calls++; return completion([0]); };
  try {
    const config = { ...env, CONFIG_DB: database };
    assert.equal((await filterSearchResults(search, config)).aiFilter.cacheHit, false);
    assert.equal((await filterSearchResults(search, config)).aiFilter.cacheHit, true);
    assert.equal(calls, 1);
    await filterSearchResults(search, { ...config, AI_SEARCH_CONFIG: { ...config.AI_SEARCH_CONFIG, revision: 2 } });
    await filterSearchResults({ ...search, query: '走马' }, config);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('uses an encrypted custom credential without exposing its ciphertext or plaintext to the administrator', async () => {
  const original = globalThis.fetch;
  const encryptedKey = await encryptAiKey('custom-test-key', env);
  assert.equal(encryptedKey.includes('custom-test-key'), false);
  const ai = { enabled: true, model: 'glm-4-flash-250414', encryptedKey };
  assert.deepEqual(publicAiSearch(ai, env), { enabled: true, model: ai.model, keyConfigured: true, keySource: 'custom' });
  globalThis.fetch = async (_url, options) => { assert.equal(options.headers.Authorization, 'Bearer custom-test-key'); return completion([0]); };
  try { assert.equal((await filterSearchResults(search, { ...env, AI_SEARCH_CONFIG: ai })).aiFilter.status, 'filtered'); }
  finally { globalThis.fetch = original; }
  for (const value of [null, { enabled: 'yes' }, { model: '../bad model' }]) assert.throws(() => validateAiSearch(value));
  await assert.rejects(encryptAiKey('one\r\ntwo', env));
});

test('wires AI into public title searches using persisted settings', async () => {
  const original = globalThis.fetch;
  const configuration = { sources: [{ id: 'bfzy', name: '暴风', url: 'https://cms.demo.site/api', enabled: true }], pageEnabled: true, aiSearch: { enabled: true, model: 'glm-4-flash-250414' } };
  const configDb = { prepare() { return { async first() { return { value: JSON.stringify(configuration), revision: 1 }; } }; } };
  let calls = 0;
  globalThis.fetch = async url => {
    if (new URL(url).hostname === 'cms.demo.site') return Response.json({ code: 1, list: [{ vod_id: 1, vod_name: '走马上任', type_name: '国产剧', vod_play_from: 'hls', vod_play_url: '第1集$https://cdn.demo.site/master.m3u8' }, { vod_id: 2, vod_name: '代理市长' }] });
    if (new URL(url).hostname === 'cdn.demo.site') {
      if (new URL(url).pathname === '/master.m3u8') return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nmedia.m3u8');
      if (new URL(url).pathname === '/media.m3u8') return new Response('#EXTM3U\n#EXTINF:6,\n0.m4s\n#EXT-X-ENDLIST');
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }
    calls++; return completion([0, 1]);
  };
  try {
    for (const path of ['/api/player/search?q=', '/api/resolve?input=']) {
      const response = await worker.fetch(new Request('https://api.demo.site' + path + encodeURIComponent('走马上任')), { ...env, CONFIG_DB: configDb });
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.items.length, 1);
      assert.equal(data.aiFilter.status, 'filtered');
    }
    assert.equal(calls, 2);
    const episode = await worker.fetch(new Request('https://api.demo.site/api/player/resolve', { method: 'POST', body: JSON.stringify({ episodeRef: { id: 'bfzy:1', line: '0', episode: '0', title: '第1集' } }) }), { ...env, CONFIG_DB: configDb });
    assert.equal(episode.status, 200);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
