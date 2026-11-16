import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewrite, signCatalogMedia, handleParserResolver } from '../src/parser-resolver.mjs';

const base = 'https://media.demo.site/video/title/index.m3u8';
const origin = 'https://player.demo.site';
const env = { secret: 'ad-filter-test-secret-long-enough' };
const program = Array.from({ length: 50 }, (_, index) => '#EXTINF:6.006,\n/video/title/' + index + '.ts').join('\n');
const insert = Array.from({ length: 8 }, (_, index) => '#EXTINF:3,\n/video/adjump/time/' + index + '.ts').join('\n') + '\n#EXTINF:2.04,\n/video/adjump/time/8.ts';
const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:7\n' + program + '\n#EXT-X-DISCONTINUITY\n' + insert + '\n#EXT-X-DISCONTINUITY\n' + program + '\n#EXT-X-ENDLIST';
const addresses = value => value.split('\n').filter(line => line && !line.startsWith('#'));
const metadata = value => JSON.parse(value.split('\n').find(line => line.startsWith('#CRAYON-AD-FILTER:')).slice(18));

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
