import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { playLines } from '../src/worker.mjs';

const env = { CMS_SOURCES: JSON.stringify([{ id: 'test', name: '测试源', url: 'https://cms.demo.site/api.php/provide/vod' }]), ALLOWED_ORIGINS: 'https://player.demo.site' };
const video = { vod_id: 1, vod_name: '<b>影片</b>', vod_pic: 'http://cdn.demo.site/cover.jpg', vod_play_from: 'hls$$$mp4', vod_play_url: '第一集$https://cdn.demo.site/a.m3u8?token=a$b#第二集$https://cdn.demo.site/b.m3u8$$$正片$https://cdn.demo.site/c.mp4' };
const call = (path, options) => worker.fetch(new Request('https://api.demo.site' + path, options), env);

test('parses multiple lines and episodes, preserves URL dollar characters', () => {
  const lines = playLines(video);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].episodes.length, 2);
  assert.equal(lines[0].episodes[0].url, 'https://cdn.demo.site/a.m3u8?token=a$b');
  assert.equal(playLines({ vod_play_url: 'bad$javascript:alert(1)' }).length, 0);
});
test('unified title search, detail and episode resolution', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('ac'), 'detail');
    return Response.json({ code: 1, list: [video], page: 1, pagecount: 2 });
  };
  try {
    const result = await (await call('/api/resolve?input=影片')).json();
    assert.equal(result.kind, 'search');
    assert.equal(result.items[0].title, '影片');
    assert.equal(result.items[0].id, 'test:1');
    assert.equal(result.items[0].poster, 'https://cdn.demo.site/cover.jpg');
    assert.equal(result.items[0].groupKey, '影片||');
    const detail = await (await call('/api/player/detail?id=test:1')).json();
    assert.equal(detail.lines[1].name, 'mp4');
    const resolved = await (await call('/api/resolve', { method: 'POST', body: JSON.stringify({ id: 'test:1', line: '1', episode: '0' }) })).json();
    assert.equal(resolved.url, 'https://cdn.demo.site/c.mp4');
  } finally { globalThis.fetch = original; }
});
test('rejects unsafe inputs, malformed JSON, large body and foreign origins', async () => {
  for (const input of ['javascript:alert(1)', 'https://localhost/a.mp4', 'https://127.0.0.1/a.m3u8']) {
    assert.equal((await call('/api/resolve?input=' + encodeURIComponent(input))).status, 400);
  }
  assert.equal((await call('/api/resolve', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await call('/api/resolve', { method: 'POST', body: 'x'.repeat(17000) })).status, 413);
  assert.equal((await call('/health', { headers: { Origin: 'https://other.demo.site' } })).status, 403);
  assert.equal((await call('/health', { headers: { Origin: 'https://player.demo.site' } })).headers.get('Access-Control-Allow-Origin'), 'https://player.demo.site');
});
test('reports all upstream failures instead of returning empty search success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try { assert.equal((await call('/api/resolve?input=影片')).status, 502); }
  finally { globalThis.fetch = original; }
});

test('uses a safe public thumbnail when the catalog cover URL is invalid', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 1, list: [{ ...video, vod_pic: 'javascript:alert(1)', vod_pic_thumb: 'https://cdn.demo.site/thumb.jpg' }] });
  try {
    const result = await (await call('/api/player/search?q=影片')).json();
    assert.equal(result.items[0].poster, 'https://cdn.demo.site/thumb.jpg');
  } finally { globalThis.fetch = original; }
});
