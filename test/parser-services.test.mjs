import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { validateParsers, qlParser } from '../src/parser-services.mjs';
import { validateConfig } from '../src/config.mjs';
import { client } from '../src/admin-page.mjs';

const source = 'https://v.youku.com/v_show/id_a.html?token=a+b&part=2#video';
const parser = (id, extra = {}) => ({ id, name: id, url: 'https://' + id + '.parser.demo.site/api', enabled: true, ...extra });
const environment = (parsers, extra = {}) => ({ MEDIA_SECRET: 'parser-services-media-secret-long',
  CMS_SOURCES: JSON.stringify([{ id: 'test', name: '测试源', url: 'https://cms.demo.site/api' }]),
  PARSER_SERVICES: JSON.stringify(parsers), ...extra });
const request = (env, data) => worker.fetch(new Request('https://api.demo.site/api/resolve', { method: 'POST', body: JSON.stringify(data) }), env);
const manifest = (width = 1920, height = 1080) => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=' + width + 'x' + height + '\nmedia.m3u8';

test('restores QL token resolution through the unified endpoint, explicit selection and configured fallback', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(input); calls.push(url.hostname);
    if (url.hostname === 'svip.qlplayer.cyou') {
      if (url.pathname === '/') {
        assert.equal(url.searchParams.get('url'), source);
        return new Response('player = {apiToken: "temporary+token"}');
      }
      assert.equal(url.searchParams.get('token'), 'temporary+token');
      return Response.json({ code: 200, type: 'm3u8', url: 'https://ql.cdn.demo.site/master.m3u8' });
    }
    const response = catalog(url); if (response) return response;
    return media(url);
  };
  try {
    const response = await request(environment([]), { url: source, parser: 'ql' });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.parserId, 'ql');
    assert.equal(data.quality.width, 1920);
    assert.equal(new URL(data.url).pathname, '/api/jiexi/resolved-media');
    assert.equal(JSON.stringify(data).includes('temporary+token'), false);
    assert.equal(calls.includes('cms.demo.site'), false);
    const fallback = await request(environment([qlParser]), { url: source });
    assert.equal((await fallback.json()).parserId, 'ql');
    const disabled = await request(environment([{ ...qlParser, enabled: false }]), { url: source, parser: 'ql' });
    assert.equal(disabled.status, 404);
    assert.equal(validateParsers([qlParser])[0].method, 'QL');
    assert.throws(() => validateParsers([{ ...qlParser, url: 'https://other.demo.site/' }]));
  } finally { globalThis.fetch = original; }
});
function media(url, width = 1920, height = 1080) {
  if (url.pathname.endsWith('master.m3u8')) return new Response(manifest(width, height));
  if (url.pathname.endsWith('media.m3u8') || url.pathname === '/stream') return new Response('#EXTM3U\n#EXTINF:6,\n0.m4s\n#EXT-X-ENDLIST', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
  return new Response(new Uint8Array([1, 2, 3, 4]));
}
function catalog(url, available = false) {
  if (url.hostname === 'v.youku.com') return new Response('<meta name="irAlbumName" content="影片"><meta name="irTitle" content="影片 第1集">');
  if (url.hostname === 'cms.demo.site') return Response.json({ code: 1, list: available ? [{ vod_id: 1, vod_name: '影片', vod_year: '2026', type_name: '国产剧', vod_play_from: 'hls', vod_play_url: '第1集$https://cms.cdn.demo.site/master.m3u8' }] : [] });
}

test('validates parser settings, supports Workers endpoints and initializes old configurations', () => {
  new Function(client);
  assert.equal(validateConfig({ sources: [], pageEnabled: true }).parserMode, 'fallback');
  assert.deepEqual(validateConfig({ sources: [], pageEnabled: true }).parsers, []);
  assert.equal(validateParsers([parser('worker', { url: 'https://other-service.user.workers.dev/api' })])[0].method, 'GET');
  for (const value of [parser('auto'), parser('cms'), parser('x', { url: 'https://127.0.0.1/api' }), parser('x', { url: 'http://parser.demo.site/api' }), parser('x', { method: 'DELETE' }), parser('x', { responsePath: '__proto__.url' }), parser('x', { headers: { Host: 'localhost' } }), parser('x', { headers: { Authorization: 'one\r\ntwo' } }), parser('x', { params: { key: {} } })]) {
    assert.throws(() => validateParsers([value]));
  }
  assert.throws(() => validateParsers([parser('same'), parser('same')]));
  assert.throws(() => validateParsers([parser(123)]));
  assert.throws(() => validateParsers([parser('x', { urlParam: { toString: 123 } })]), { status: 400 });
});

test('falls back in configured order, encodes GET parameters and keeps endpoint credentials private', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(input); calls.push(url.hostname);
    const response = catalog(url); if (response) return response;
    if (url.hostname === 'bad.parser.demo.site') return new Response('secret-api-token', { status: 503 });
    if (url.hostname === 'good.parser.demo.site') {
      assert.equal(url.searchParams.get('v'), source);
      assert.equal(url.searchParams.get('key'), 'secret-api-token');
      assert.equal(url.searchParams.get('level'), 'high');
      return Response.json({ code: 200, data: { url: 'https://good.cdn.demo.site/master.m3u8' } });
    }
    assert.equal(url.hostname, 'good.cdn.demo.site');
    return media(url);
  };
  try {
    const env = environment([parser('bad'), parser('good', { url: 'https://good.parser.demo.site/api?key=secret-api-token', urlParam: 'v', params: { level: 'high' } }), parser('unused')]);
    const response = await request(env, { url: source });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.provider, 'external'); assert.equal(data.parserId, 'good');
    assert.deepEqual(data.parserResults.map(result => result.status), ['unavailable', 'ok']);
    assert.equal(data.selectedRouteId, 'parser:good');
    assert.equal(data.quality.width, 1920);
    assert.equal(new URL(data.url).pathname, '/api/jiexi/resolved-media');
    assert.equal(calls.includes('unused.parser.demo.site'), false);
    assert.equal(JSON.stringify(data).includes('secret-api-token'), false);
  } finally { globalThis.fetch = original; }
});

test('calls a selected POST service with custom fields and relays extensionless HLS', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'post.parser.demo.site') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { quality: 1080, video: source });
      assert.equal(options.headers.get('Authorization'), 'Bearer private-token');
      assert.equal(options.headers.get('Content-Type'), 'application/json');
      return Response.json({ format: 'hls', payload: { stream: { playback: 'https://post.cdn.demo.site/stream?id=1' } } });
    }
    assert.equal(url.hostname, 'post.cdn.demo.site');
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    return media(url);
  };
  try {
    const env = environment([parser('post', { method: 'POST', urlParam: 'video', responsePath: 'payload.stream.playback', params: { quality: 1080 }, headers: { Authorization: 'Bearer private-token', 'content-type': 'ignored' } })]);
    const response = await request(env, { url: source, parser: 'post' });
    const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.type, 'm3u8');
    const relayed = await worker.fetch(new Request(data.url), env);
    assert.equal(relayed.status, 200);
    assert.match(await relayed.text(), /resolved-media/);
    assert.equal(JSON.stringify(data).includes('private-token'), false);
  } finally { globalThis.fetch = original; }
});

test('resolves API-only configurations without fetching page metadata', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'only.parser.demo.site') return Response.json({ url: 'https://only.cdn.demo.site/master.m3u8' });
    assert.equal(url.hostname, 'only.cdn.demo.site');
    return media(url);
  };
  try {
    const response = await request(environment([parser('only')], { CMS_SOURCES: '[]' }), { url: source });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).parserId, 'only');
  } finally { globalThis.fetch = original; }
});

test('preserves CMS-first behavior and merges external results by actual quality when requested', async () => {
  const original = globalThis.fetch;
  let parserCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input);
    const response = catalog(url, true); if (response) return response;
    if (url.hostname === 'external.parser.demo.site') { parserCalls++; return Response.json({ url: 'https://external.cdn.demo.site/master.m3u8' }); }
    return media(url, url.hostname.startsWith('external') ? 3840 : 1280, url.hostname.startsWith('external') ? 2160 : 720);
  };
  try {
    const env = environment([parser('external')]);
    const fallback = await (await request(env, { url: source })).json();
    assert.equal(fallback.provider, 'cms'); assert.equal(parserCalls, 0);
    const combined = await (await request({ ...env, PARSER_MODE: 'combined' }, { url: source })).json();
    assert.equal(parserCalls, 1); assert.equal(combined.routes.length, 2);
    assert.equal(combined.provider, 'external'); assert.equal(combined.quality.width, 3840);
    assert.equal(combined.match, undefined);
    assert.equal(combined.routes[1].match.sourceId, 'test');
    assert.equal(combined.episodes[0].number, 1);
    assert.equal(combined.url, combined.routes[0].url);
  } finally { globalThis.fetch = original; }
});

test('keeps explicit episode overrides on CMS matching and rejects unavailable selected services', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    const response = catalog(url, true); if (response) return response;
    assert.fail('A parser must not resolve a different episode through the original page');
  };
  try {
    const env = environment([parser('external'), parser('disabled', { enabled: false })], { PARSER_MODE: 'combined' });
    const selected = await request(env, { url: source, episode: 2 });
    assert.equal(selected.status, 404); assert.equal((await selected.json()).error.code, 'EPISODE_NOT_FOUND');
    assert.equal((await request(env, { url: source, parser: 'disabled' })).status, 404);
    assert.equal((await request(env, { url: source, parser: 'external', episode: 2 })).status, 400);
  } finally { globalThis.fetch = original; }
});

test('rejects private media, cross-domain credential redirects, HTML responses and recursive calls', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'private.parser.demo.site') return Response.json({ url: 'https://127.0.0.1/video.mp4' });
    if (url.hostname === 'redirect.parser.demo.site') return new Response(null, { status: 307, headers: { Location: 'https://foreign.demo.site/api' } });
    if (url.hostname === 'html.parser.demo.site') return new Response('<html>secret-token</html>');
    assert.fail('Unsafe upstream must not be fetched');
  };
  try {
    for (const id of ['private', 'redirect', 'html', 'loop']) {
      const service = parser(id, id === 'loop' ? { url: 'https://api.demo.site/api/resolve' } : {});
      const response = await request(environment([service]), { url: source, parser: id });
      assert.equal(response.status, 502);
      const data = await response.json();
      assert.equal(data.parserResults[0].status, 'unavailable');
      assert.equal(JSON.stringify(data).includes('secret-token'), false);
    }
    const loop = await worker.fetch(new Request('https://api.demo.site/api/resolve?url=' + encodeURIComponent(source), { headers: { 'X-Crayon-Resolver-Hop': '1' } }), environment([]));
    assert.equal(loop.status, 400);
  } finally { globalThis.fetch = original; }
});
