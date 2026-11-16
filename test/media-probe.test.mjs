import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoDimensions } from '../src/video-dimensions.mjs';
import { probeCatalogMedia, sortRoutes } from '../src/media-probe.mjs';
import worker from '../src/worker.mjs';

function bitWriter() {
  let text = '';
  return {
    value(value, count) { text += value.toString(2).padStart(count, '0'); return this; },
    unsigned(value) { const bits = (value + 1).toString(2); text += '0'.repeat(bits.length - 1) + bits; return this; },
    bytes() { text += '1'; text = text.padEnd(Math.ceil(text.length / 8) * 8, '0'); const data = []; for (let index = 0; index < text.length; index += 8) data.push(parseInt(text.slice(index, index + 8), 2)); return data; },
  };
}
function avc() {
  return Uint8Array.from([0, 0, 1, 0x67, ...bitWriter().value(66, 8).value(0, 8).value(31, 8)
    .unsigned(0).unsigned(0).unsigned(0).unsigned(0).unsigned(0).value(0, 1).unsigned(119).unsigned(67)
    .value(1, 1).value(1, 1).value(1, 1).unsigned(0).unsigned(0).unsigned(0).unsigned(4).bytes()]);
}
test('reads actual AVC crop dimensions from Annex B and transport stream video headers', () => {
  assert.deepEqual(videoDimensions(avc()), { width: 1920, height: 1080 });
  const data = new Uint8Array(188 * 3).fill(255);
  for (let index = 0; index < 3; index++) data.set([0x47, index === 0 ? 0x41 : 0x01, 0, 0x10], index * 188);
  data.set([0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 0], 4);
  data.set(avc(), 13);
  assert.deepEqual(videoDimensions(data), { width: 1920, height: 1080 });
  assert.deepEqual(videoDimensions(new Uint8Array([0, 0, 1, 0x67])), { width: 0, height: 0 });
});
test('reads HEVC and MP4 dimensions without inferring them from source names', () => {
  const writer = bitWriter().value(0, 4).value(0, 3).value(1, 1);
  for (let index = 0; index < 12; index++) writer.value(0, 8);
  const sps = Uint8Array.from([0, 0, 1, 0x42, 1, ...writer.unsigned(0).unsigned(1).unsigned(3840).unsigned(2160).value(0, 1).bytes()]);
  assert.deepEqual(videoDimensions(sps), { width: 3840, height: 2160 });
  const mp4 = new Uint8Array(64); mp4.set([97, 118, 99, 49], 4);
  new DataView(mp4.buffer).setUint16(32, 1280); new DataView(mp4.buffer).setUint16(34, 720);
  assert.deepEqual(videoDimensions(mp4), { width: 1280, height: 720 });
});
test('sorts clarity first and measured latency second, putting unknown clarity last', () => {
  const route = (id, width, height, latencyMs) => ({ id, quality: { width, height }, latencyMs });
  const routes = sortRoutes([route('unknown', 0, 0, 1), route('720', 1280, 720, 5), route('1080-slow', 1920, 1080, 200), route('1080-fast', 1920, 1080, 50)]);
  assert.deepEqual(routes.map(route => route.id), ['1080-fast', '1080-slow', '720', 'unknown']);
});
test('probes the highest HLS rendition while preserving its master playlist', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname === '/master.m3u8') return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080.m3u8');
    if (url.pathname === '/1080.m3u8') return new Response('#EXTM3U\n#EXTINF:6,\n0.ts');
    assert.equal(url.pathname, '/0.ts');
    return new Response(avc());
  };
  try {
    const result = await probeCatalogMedia('https://cdn.demo.site/master.m3u8');
    assert.equal(result.url, 'https://cdn.demo.site/master.m3u8');
    assert.equal(result.quality.width, 1920); assert.equal(result.quality.height, 1080);
    assert.equal(result.quality.source, 'video'); assert.ok(result.latencyMs > 0);
  } finally { globalThis.fetch = original; }
});
test('returns all ranked routes and uses the quality-first winner as the API result', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'v.youku.com') return new Response('<meta name="irAlbumName" content="影片"><meta name="irTitle" content="影片 第1集">');
    if (url.hostname.endsWith('.cms.demo.site')) {
      const id = url.hostname.split('.')[0];
      return Response.json({ code: 1, list: [{ vod_id: 1, vod_name: '影片', vod_year: '2026', type_name: '国产剧', vod_play_from: 'hls', vod_play_url: '第01集$https://' + id + '.cdn.demo.site/master.m3u8' }] });
    }
    if (url.pathname === '/master.m3u8') return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=' + (url.hostname.startsWith('fastsd') ? '1280x720' : '1920x1080') + '\nmedia.m3u8');
    if (url.pathname === '/media.m3u8') return new Response('#EXTM3U\n#EXTINF:6,\n0.m4s');
    await new Promise(resolve => setTimeout(resolve, url.hostname.startsWith('slowhd') ? 50 : 1));
    return new Response(new Uint8Array([1, 2, 3, 4]));
  };
  const env = { MEDIA_SECRET: 'source-ranking-test-secret', CMS_SOURCES: JSON.stringify(['fastsd', 'slowhd', 'fasthd'].map(id => ({ id, name: id, url: 'https://' + id + '.cms.demo.site/api' }))) };
  try {
    const response = await worker.fetch(new Request('https://api.demo.site/api/resolve?url=' + encodeURIComponent('https://v.youku.com/v_show/id_a.html')), env);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(data.routes.map(route => route.match.sourceId), ['fasthd', 'slowhd', 'fastsd']);
    assert.equal(data.url, data.routes[0].url);
    assert.equal(data.selectedRouteId, data.routes[0].id);
    assert.equal(data.quality.width, 1920); assert.equal(data.quality.height, 1080);
  } finally { globalThis.fetch = original; }
});

test('includes a newly configured fourth source and reports its HTTP failures without silently dropping it', async () => {
  const original = globalThis.fetch;
  const ids = ['ruyi', 'bfzy', 'czzy', 'ffzy'];
  let blocked = false;
  globalThis.fetch = async input => {
    const url = new URL(input);
    const id = url.hostname.split('.')[0];
    if (url.hostname.endsWith('.cms.demo.site')) return Response.json({ code: 1, list: [{ vod_id: 1, vod_name: '影片', vod_year: '2026', type_name: '国产剧', vod_play_from: 'hls', vod_play_url: '第01集$https://' + id + '.cdn.demo.site/master.m3u8' }] });
    if (blocked && id === 'ffzy') return new Response('upstream-private-debug-text', { status: 403 });
    if (url.pathname === '/master.m3u8') return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nmedia.m3u8');
    if (url.pathname === '/media.m3u8') return new Response('#EXTM3U\n#EXTINF:6,\n0.m4s');
    return new Response(new Uint8Array([1, 2, 3, 4]));
  };
  const environment = { MEDIA_SECRET: 'new-source-test-secret-long', CMS_SOURCES: JSON.stringify(ids.map(id => ({ id, name: id, url: 'https://' + id + '.cms.demo.site/api' }))) };
  const resolve = env => worker.fetch(new Request('https://api.demo.site/api/player/resolve', { method: 'POST', body: JSON.stringify({ episodeRef: { id: 'ruyi:1', line: '0', episode: '0', title: '第01集' } }) }), env);
  try {
    const available = await (await resolve(environment)).json();
    assert.equal(available.routes.length, 4);
    assert.ok(available.routes.some(route => route.match.sourceId === 'ffzy'));
    assert.deepEqual(available.unavailableRoutes, []);
    blocked = true;
    const unavailable = await (await resolve(environment)).json();
    assert.equal(unavailable.routes.length, 3);
    assert.equal(unavailable.unavailableRoutes.length, 1);
    assert.equal(unavailable.unavailableRoutes[0].sourceId, 'ffzy');
    assert.equal(unavailable.unavailableRoutes[0].available, false);
    assert.equal(unavailable.unavailableRoutes[0].upstreamStatus, 403);
    assert.equal(unavailable.unavailableRoutes[0].reason, '片源返回 HTTP 403');
    assert.equal(unavailable.url, unavailable.routes[0].url);
    assert.equal(JSON.stringify(unavailable).includes('upstream-private-debug-text'), false);
    const failed = await worker.fetch(new Request('https://api.demo.site/api/player/resolve', { method: 'POST', body: JSON.stringify({ id: 'ffzy:1', episodeNumber: 1, source: 'ffzy' }) }), environment);
    const data = await failed.json();
    assert.equal(failed.status, 502);
    assert.equal(data.unavailableRoutes[0].sourceId, 'ffzy');
  } finally { globalThis.fetch = original; }
});

test('gives each matching source a candidate slot before filling the detail budget with duplicate titles', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input), id = url.hostname.split('.')[0];
    if (url.hostname.endsWith('.cms.demo.site')) {
      const selected = url.searchParams.get('ids');
      const entries = selected ? [Number(selected)] : id === 'many' ? [1, 2, 3, 4, 5, 6, 7, 8] : [1];
      return Response.json({ code: 1, list: entries.map(vod_id => ({ vod_id, vod_name: '影片', vod_year: '2026', type_name: '国产剧', vod_play_from: 'hls', vod_play_url: '第1集$https://' + id + '.cdn.demo.site/' + vod_id + '/master.m3u8' })) });
    }
    if (url.pathname.endsWith('master.m3u8')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nmedia.m3u8');
    if (url.pathname.endsWith('media.m3u8')) return new Response('#EXTM3U\n#EXTINF:6,\n0.m4s');
    return new Response(new Uint8Array([1, 2, 3, 4]));
  };
  try {
    const env = { MEDIA_SECRET: 'source-fairness-test-secret', CMS_SOURCES: JSON.stringify(['many', 'ffzy'].map(id => ({ id, name: id, url: 'https://' + id + '.cms.demo.site/api' }))) };
    const response = await worker.fetch(new Request('https://api.demo.site/api/player/resolve', { method: 'POST', body: JSON.stringify({ id: 'many:1', episodeNumber: 1 }) }), env);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.routes.length, 8);
    assert.ok(data.routes.some(route => route.match.sourceId === 'ffzy'));
  } finally { globalThis.fetch = original; }
});
