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
