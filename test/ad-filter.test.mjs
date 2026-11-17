import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewrite, signCatalogMedia, handleParserResolver } from '../src/parser-resolver.mjs';
import { filterVodAdSegments } from '../src/vod-segment-filter.mjs';

const base = 'https://media.demo.site/video/title/index.m3u8';
const origin = 'https://player.demo.site';
const env = { secret: 'ad-filter-test-secret-long-enough' };
const program = Array.from({ length: 50 }, (_, index) => '#EXTINF:6.006,\n/video/title/' + index + '.ts').join('\n');
const insert = Array.from({ length: 8 }, (_, index) => '#EXTINF:3,\n/video/adjump/time/' + index + '.ts').join('\n') + '\n#EXTINF:2.04,\n/video/adjump/time/8.ts';
const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:7\n' + program + '\n#EXT-X-DISCONTINUITY\n' + insert + '\n#EXT-X-DISCONTINUITY\n' + program + '\n#EXT-X-ENDLIST';
const addresses = value => value.split('\n').filter(line => line && !line.startsWith('#'));
const metadata = value => JSON.parse(value.split('\n').find(line => line.startsWith('#CRAYON-AD-FILTER:')).slice(18));
const fixture = (provider, name) => readFileSync(new URL('./__fixtures__/' + provider + '/' + name, import.meta.url), 'utf8');
const ruyiBase = 'https://cdn.ryplay12.com/20251006/22917_c962e8c4/2000k/hls/index.m3u8';

// Original player captures include visually verified Ruyi insertions. Exact
// retained URI checks protect ordinary scenes with the same 4-second cadence.
for (const [name, url, ranges] of [
  ['bear-season1.m3u8', ruyiBase, [[480.36, 499.36]]],
  ['bear-season2.m3u8', 'https://cdn.ryplay12.com/20261001/42140_c77b26e4/2000k/hls/index.m3u8', [[529.28, 550.28]]],
  ['bear-season2-current.m3u8', 'https://cdn.ryplay12.com/20261001/42140_c77b26e4/2000k/hls/index.m3u8', [[663.04, 682.92]]],
  ['movie.m3u8', 'https://svip.ryiplay18.com/20260531/6798_92c24498/2000k/hls/index.m3u8', [[582.4, 601.4], [3380.36, 3401.36]]],
]) {
  test('uses the original player Ruyi rules before signing ' + name, async () => {
    const input = fixture('ruyi', name);
    const output = await rewrite(input, url, origin, env, '9999999999');
    const report = metadata(output);
    assert.equal(report.reason, 'filtered');
    assert.equal(report.removed.length, ranges.length);
    report.removed.forEach((range, index) => {
      assert.ok(Math.abs(range.start - ranges[index][0]) < 0.001);
      assert.ok(Math.abs(range.end - ranges[index][1]) < 0.001);
    });
    let time = 0;
    const retained = [];
    for (const match of input.matchAll(/#EXTINF:([\d.]+),\r?\n([^\r\n]+)/g)) {
      if (!ranges.some(([start, end]) => time >= start - 0.001 && time < end - 0.001)) retained.push(new URL(match[2], url).href);
      time += Number(match[1]);
    }
    assert.deepEqual(addresses(output).map(value => new URL(value).searchParams.get('url')), retained);
    assert.equal(filterVodAdSegments(filterVodAdSegments(input, url).playlist, url).reason, 'no-match');
  });
}

test('retains the original player Ruyi clean-movie and unrelated-host safeguards', async () => {
  const clean = fixture('ruyi', 'clean-movie.m3u8');
  assert.equal(filterVodAdSegments(clean, 'https://cdn7.ryplay7.com/20250501/13887_828cf261/2000k/hls/index.m3u8').playlist, clean);
  for (const url of ['https://unrelated.demo.site/20251006/22917_c962e8c4/2000k/hls/index.m3u8', 'https://cdn.ryplay12.com.evil.demo.site/20251006/22917_c962e8c4/2000k/hls/index.m3u8', 'https://cdn.ryplay12.com/ordinary/index.m3u8']) {
    assert.equal(filterVodAdSegments(fixture('ruyi', 'bear-season1.m3u8'), url).removed.length, 0);
  }
});

for (const [name, count] of [['movie.m3u8', 1649], ['series.m3u8', 680], ['new-series.m3u8', 1303]]) {
  test('retains the original player Baofeng rules for ' + name, async () => {
    const input = fixture('baofeng', name);
    const output = await rewrite(input, base, origin, env, '9999999999');
    assert.equal(metadata(output).removed.length, 2);
    assert.equal(addresses(output).length, count);
    const expected = addresses(input).filter(value => !value.startsWith('/video/adjump/time/')).map(value => new URL(value, base).href);
    assert.deepEqual(addresses(output).map(value => new URL(value).searchParams.get('url')), expected);
  });
}

test('applies generic cadence rules to another source and preserves AES sequence-derived IVs', async () => {
  const ad = Array.from({ length: 6 }, (_, index) => '#EXTINF:2,\n/video/title/insert-' + index + '.ts').join('\n') + '\n#EXTINF:0.5,\n/video/title/tail.ts';
  const input = playlist.replace(insert, ad).replace('#EXT-X-TARGETDURATION:7', '#EXT-X-TARGETDURATION:7\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"');
  const output = await rewrite(input, base, origin, env, '9999999999');
  assert.equal(metadata(output).reason, 'filtered');
  assert.equal(addresses(output).length, 100);
  assert.equal(addresses(output).some(value => /insert-|tail\.ts/.test(new URL(value).searchParams.get('url'))), false);
  assert.ok(output.includes('IV=0x' + (57).toString(16).padStart(32, '0')));
});

test('filters a redirected Ruyi child playlist using its final provider URL and propagates the ad switch', async () => {
  const originalFetch = globalThis.fetch;
  const entry = 'https://entry.demo.site/start';
  const master = 'https://cdn.ryplay12.com/20251006/22917_c962e8c4/master.m3u8';
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === entry) return new Response(null, { status: 302, headers: { Location: master } });
    let text;
    if (url === master) text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\n2000k/hls/index.m3u8';
    else { assert.equal(url, ruyiBase); text = fixture('ruyi', 'bear-season1.m3u8'); }
    const response = new Response(text, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  try {
    const signed = await signCatalogMedia(entry, origin, env.secret);
    const first = await handleParserResolver(new Request(signed.url), env);
    const childUrl = addresses(await first.text())[0];
    assert.equal(new URL(childUrl).searchParams.get('url'), ruyiBase);
    const child = await handleParserResolver(new Request(childUrl), env);
    const output = await child.text();
    assert.equal(metadata(output).reason, 'filtered');
    assert.ok(addresses(output).every(value => new URL(value).searchParams.get('url').startsWith(new URL('.', ruyiBase).href)));
    const off = new URL(signed.url); off.searchParams.set('ads', '0');
    const fullMaster = await handleParserResolver(new Request(off), env);
    const fullChild = await handleParserResolver(new Request(addresses(await fullMaster.text())[0]), env);
    const full = await fullChild.text();
    assert.equal(full.includes('#CRAYON-AD-FILTER:'), false);
    assert.equal(addresses(full).length - addresses(output).length, 5);
  } finally { globalThis.fetch = originalFetch; }
});

test('filters before signing media, preserves programme capabilities and reports source-time mapping', async () => {
  const result = await rewrite(playlist, base, origin, env, '9999999999');
  const data = metadata(result);
  assert.equal(data.version, 1);
  assert.equal(data.reason, 'filtered');
  assert.equal(data.removed.length, 1);
  assert.ok(Math.abs(data.removed[0].end - data.removed[0].start - 26.04) < 0.001);
  assert.equal(addresses(result).length, 100);
  for (const address of addresses(result)) {
    const url = new URL(address);
    assert.equal(url.pathname, '/api/jiexi/resolved-media');
    assert.equal(url.searchParams.get('url').includes('/adjump/'), false);
    assert.ok(url.searchParams.has('sig'));
  }
});

test('keeps the ad switch effective through the signed endpoint and disables child cuts for external audio', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(playlist, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
  try {
    const signed = await signCatalogMedia(base, origin, env.secret);
    const filtered = await handleParserResolver(new Request(signed.url), env);
    assert.equal(metadata(await filtered.text()).reason, 'filtered');
    const off = new URL(signed.url); off.searchParams.set('ads', '0');
    const full = await handleParserResolver(new Request(off), env);
    const text = await full.text();
    assert.equal(full.status, 200);
    assert.equal(text.includes('#CRAYON-AD-FILTER:'), false);
    assert.equal(addresses(text).length, 109);
    assert.ok(addresses(text).every(address => new URL(address).searchParams.get('ads') === '0'));
    const head = await handleParserResolver(new Request(off, { method: 'HEAD' }), env);
    assert.equal(await head.text(), '');
    const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="main",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO="audio"\nmedia.m3u8';
    const untouched = await rewrite(master, base, origin, env, '9999999999');
    assert.equal(new URL(addresses(untouched)[0]).searchParams.get('ads'), '0');
    const audio = untouched.match(/URI="([^"]+)"/)[1];
    assert.equal(new URL(audio).searchParams.get('ads'), '0');
  } finally { globalThis.fetch = originalFetch; }
});
