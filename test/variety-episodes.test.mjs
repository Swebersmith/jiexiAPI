import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { episodeIdentity, lineEpisodeIdentities } from '../src/episode-identity.mjs';
import { availableEpisodes, episodeChoices } from '../src/catalog-match.mjs';

test('identifies dates, issue numbers, upper/lower parts and alternate editions independently', () => {
  const key = value => episodeIdentity(value).key;
  for (const labels of [
    ['20261022-01', '20261022第01期'],
    ['20261029上', '20261029第3期（上）', '2026-10-29 第三期 上半期'],
    ['20261029下', '20261029第3期下'],
    ['20261106沉浸上', '20261106沉浸版上'],
    ['20261106加更', '20261106加更版'],
    ['第1集', '第01集', '第一集', 'EP1', '1'],
  ]) assert.equal(new Set(labels.map(key)).size, 1, labels.join(' / '));
  const distinct = ['20261022-01', '20261022-02', '20261022上', '20261022下', '20261022加更版', '20261022沉浸版上', '20261022沉浸版下', '20261022抢鲜版', '20261022', '先导片', '花絮'];
  assert.equal(new Set(distinct.map(key)).size, distinct.length);
  assert.notEqual(key('20261105(第4期下(下)'), key('20261105下'));
  const splitIssues = { episodes: ['20261029第1期上', '20261029第2期上'].map(title => ({ title })) };
  assert.equal(new Set(lineEpisodeIdentities(splitIssues).map(entry => entry.identity.key)).size, 2);
});

const labels = {
  ruyi: ['20261022-01', '20261022-02', '20261029上', '20261029下', '20261105上', '20261105下'],
  bfzy: ['20261022第1期', '20261022第2期', '20261029第3期上', '20261029第3期下', '20261030加更版第2期', '20261105第4期上', '20261105第4期下', '先导片'],
};
const video = (id, entries) => ({ vod_id: 1, vod_name: '后会友期', vod_year: '2026', type_name: '大陆综艺', vod_lang: '国语', vod_play_from: 'hls',
  vod_play_url: entries.map((label, index) => label + '$https://' + id + '.cdn.demo.site/' + index + '/index.m3u8').join('#') });
const env = { MEDIA_SECRET: 'variety-episodes-test-secret-long', CMS_SOURCES: JSON.stringify(Object.keys(labels).map(id => ({ id, name: id, url: 'https://' + id + '.cms.demo.site/api' }))) };
const request = data => worker.fetch(new Request('https://api.demo.site/api/player/resolve', { method: 'POST', body: JSON.stringify(data) }), env);
const ref = (id, episode, title) => ({ id: id + ':1', line: '0', lineName: 'hls', episode: String(episode), title });

test('resolves the clicked label across differently ordered catalogues and retains every named edition in the player list', async () => {
  const original = globalThis.fetch;
  let shifted = false;
  globalThis.fetch = async input => {
    const url = new URL(input);
    const id = url.hostname.split('.')[0];
    if (url.hostname.includes('.cms.')) return Response.json({ code: 1, list: [video(id, shifted && id === 'ruyi' ? ['先导片', ...labels[id]] : labels[id])] });
    if (url.pathname.endsWith('index.m3u8')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=' + (id === 'bfzy' ? '1920x1080' : '1280x720') + '\nmedia.m3u8');
    if (url.pathname.endsWith('media.m3u8')) return new Response('#EXTM3U\n#EXTINF:6,\n0.m4s\n#EXT-X-ENDLIST');
    return new Response(new Uint8Array([1, 2, 3, 4]));
  };
  try {
    const response = await request({ episodeRef: ref('ruyi', 3, '20261029下') });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.match.episodeTitle, '20261029第3期下');
    assert.deepEqual(data.routes.map(route => route.match.episodeTitle), ['20261029第3期下', '20261029下']);
    assert.equal(data.selectedEpisodeKey, episodeIdentity('20261029下').key);
    assert.equal(data.episodes.length, 8);
    assert.equal(data.episodes.filter(episode => episode.number === 20261022).length, 2);
    assert.equal(data.episodes.filter(episode => episode.number === 20261029).length, 2);
    assert.ok(data.episodes.every(episode => episode.episodeRef && episode.key));
    const secondIssue = data.episodes.find(episode => episode.title === '20261022-02');
    const selected = await (await request({ episodeRef: secondIssue.episodeRef })).json();
    assert.equal(selected.match.episodeTitle, '20261022第2期');
    assert.equal(selected.routes.length, 2);
    const extra = data.episodes.find(episode => episode.title.includes('加更'));
    const extraResult = await (await request({ episodeRef: extra.episodeRef })).json();
    assert.equal(extraResult.match.episodeTitle, '20261030加更版第2期');
    assert.equal(extraResult.routes.length, 1);
    const named = data.episodes.find(episode => episode.title === '先导片');
    assert.equal((await (await request({ episodeRef: named.episodeRef })).json()).match.episodeTitle, '先导片');
    const legacy = await request({ id: 'ruyi:1', episodeNumber: 20261029 });
    assert.equal(legacy.status, 409);
    shifted = true;
    const refreshed = await (await request({ episodeRef: ref('ruyi', 3, '20261029下') })).json();
    assert.equal(refreshed.metadata.episodeRef.episode, '4');
    assert.ok(refreshed.routes.every(route => route.match.episodeTitle.includes('下')));
    assert.equal((await request({ episodeRef: ref('ruyi', 3, '已移除的特别篇') })).status, 409);
    assert.equal((await request({ episodeRef: { id: 'ruyi:1' } })).status, 400);
  } finally { globalThis.fetch = original; }
});

test('retains safe unique matches when one line contains ambiguous aliases', () => {
  const detail = { id: 'test:1', lines: [
    { id: '0', episodes: ['20261106沉浸上', '20261106沉浸版上'].map((title, id) => ({ id: String(id), title, url: 'https://cdn.demo.site/' + id + '.m3u8' })) },
    { id: '1', episodes: [{ id: '0', title: '20261106沉浸版上', url: 'https://cdn.demo.site/other.m3u8' }] },
  ] };
  const metadata = { title: '节目', episodeKey: episodeIdentity('20261106沉浸上').key, episodeRef: ref('test', 0, '20261106沉浸上') };
  assert.equal(episodeChoices(detail, metadata).length, 2);
  assert.equal(availableEpisodes([detail]).length, 1);
});
