import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { extractMetadata, identifyPage } from '../src/page-metadata.mjs';
import { availableEpisodes, catalogIdentity, catalogLanguage, catalogQuery, catalogQueries, normalizedTitle, matchingItems, selectEpisode } from '../src/catalog-match.mjs';
import { readText } from '../src/worker.mjs';

test('extracts the current title and episode for indexed Youku, iQiyi, Tencent and Bilibili pages', () => {
  const youku = extractMetadata('<meta content="谷雨" name="irAlbumName"><meta property="og:title" content="谷雨 第22集 剧情"><script>window.data={"showVideoStage":22}</script>', 'https://v.youku.com/v_show/id_a.html');
  assert.equal(youku.title, '谷雨'); assert.equal(youku.episode, 22);
  const iqiyi = extractMetadata('<meta name="irAlbumName" content="熊出没之小小世界 第2季"><meta name="irTitle" content="熊出没之小小世界 第2季 第十二集"><meta property="video:release_date" content="2025-03-21">', 'https://m.iqiyi.com/v_a.html');
  assert.equal(iqiyi.episode, 12); assert.equal(iqiyi.year, '2025');
  const tencent = extractMetadata('<meta property="og:title" content="【腾讯视频】 斗罗大陆 001"><script>window.__PINIA__={"coverInfo":{"title":"斗罗大陆","year":"2018"},"videoInfo":{"c_title_detail":"第001话"}}</script>', 'https://m.v.qq.com/x/m/play?cid=a&vid=b');
  assert.equal(tencent.title, '斗罗大陆'); assert.equal(tencent.episode, 1); assert.equal(tencent.year, '2018');
  const bili = extractMetadata('<meta property="og:title" content="任务大师"><script type="application/json">{"ogv_episode_info":{"episode_id":123,"index_title":"3"}}</script>', 'https://www.bilibili.com/bangumi/play/ep123');
  assert.equal(bili.episode, 3);
});

test('uses JSON-LD series metadata and does not use a related episode number', () => {
  const html = '<meta itemprop="episodeNumber" content="1"><script type="application/ld+json">{"@graph":[{"@type":"VideoObject","url":"https://www.iqiyi.com/v_current.html","name":"名称 第6集","episodeNumber":6,"partOfSeries":{"@id":"#series"}},{"@type":"TVSeries","@id":"#series","name":"名称"}]}</script>';
  const info = extractMetadata(html, 'https://www.iqiyi.com/v_current.html');
  assert.equal(info.title, '名称'); assert.equal(info.episode, 6);
  assert.throws(() => extractMetadata('<title>爱奇艺</title>', 'https://www.iqiyi.com/v_a.html'));
});

test('matches exact titles and seasons, and selects the exact episode across lines', () => {
  assert.equal(normalizedTitle('熊出没之小小世界 第2季'), normalizedTitle('熊出没之小小世界2'));
  assert.equal(normalizedTitle('作品 第一季'), normalizedTitle('作品'));
  const items = [{ title: '作品', year: '2024' }, { title: '作品', year: '2026' }, { title: '作品外传', year: '2026' }];
  assert.equal(matchingItems(items, { title: '作品', year: '2026' }).length, 1);
  assert.throws(() => matchingItems(items, { title: '作品' }), { code: 'AMBIGUOUS_RESOURCE' });
  assert.throws(() => matchingItems(items, { title: '作品2' }), { code: 'RESOURCE_NOT_FOUND' });
  assert.throws(() => matchingItems(items, { title: '作品', year: '2025' }), { code: 'RESOURCE_NOT_FOUND' });
  const detail = { type: '电视剧', lines: [{ name: 'HLS', episodes: [{ title: '第01集', url: 'https://cdn.demo.site/1.m3u8' }, { title: '第二集', url: 'https://cdn.demo.site/2.m3u8' }] }] };
  assert.equal(selectEpisode(detail, { title: '作品', episode: 2 }).episode.url, 'https://cdn.demo.site/2.m3u8');
  assert.throws(() => selectEpisode(detail, { title: '作品', episode: 3 }), { code: 'EPISODE_NOT_FOUND' });
  assert.throws(() => selectEpisode(detail, { title: '作品', episode: null }), { code: 'EPISODE_UNDETERMINED' });
});

test('merges numbered episodes across matching catalogs and omits non-media entries', () => {
  const details = [{ lines: [{ episodes: [
    { title: '第二集', url: 'https://cdn.demo.site/2.m3u8' },
    { title: '第1集', url: 'https://cdn.demo.site/1.mp4' },
    { title: '第3集', url: 'https://cdn.demo.site/watch/3' },
    { title: '正片', url: 'https://cdn.demo.site/movie.mp4' },
  ] }] }, { lines: [{ episodes: [
    { title: '第02集', url: 'https://backup.demo.site/2.m3u8' },
    { title: '第4集', url: 'https://backup.demo.site/4.m3u8' },
  ] }] }];
  assert.deepEqual(availableEpisodes(details), [{ number: 1, title: '第1集' }, { number: 2, title: '第二集' }, { number: 4, title: '第4集' }]);
});

test('searches version-free titles while retaining language and unrelated title qualifiers', () => {
  for (const title of ['名侦探柯南[普通话版]', '名侦探柯南（国语版）', '名侦探柯南【普通话】', '名侦探柯南国语', '名侦探柯南日语中字']) {
    assert.equal(catalogQuery(title), '名侦探柯南');
    assert.equal(normalizedTitle(title), normalizedTitle('名侦探柯南'));
  }
  assert.equal(normalizedTitle('作品国语（2026）'), normalizedTitle('作品'));
  assert.deepEqual(catalogQueries('名侦探柯南[普通话版]'), ['名侦探柯南', '名侦探柯南国语', '名侦探柯南普通话']);
  for (const title of ['名侦探柯南[电影解说]', '名侦探柯南剧场版', '名侦探柯南 OVA', '名侦探柯南 第2季']) {
    assert.notEqual(normalizedTitle(title), normalizedTitle('名侦探柯南'));
  }
  const items = [
    { id: 'japanese', title: '名侦探柯南', year: '1996', language: '日语' },
    { id: 'mandarin', title: '名侦探柯南国语', year: '1996', language: '日语' },
    { id: 'field', title: '名侦探柯南', year: '1996', language: '汉语普通话' },
    { id: 'unknown', title: '名侦探柯南', year: '1996' },
    { id: 'commentary', title: '名侦探柯南[电影解说]', year: '1996', language: '普通话' },
  ];
  const metadata = { title: '名侦探柯南[普通话版]', year: '1996' };
  assert.equal(catalogIdentity(items[1]), catalogIdentity({ title: '名侦探柯南[普通话版]', year: '1996' }));
  assert.notEqual(catalogIdentity(items[0]), catalogIdentity(items[1]));
  assert.equal(catalogLanguage(items[1]), '普通话');
  assert.equal(catalogIdentity(items[0]), catalogIdentity({ ...items[0], language: '日语,英语,德语' }));
  assert.deepEqual(matchingItems(items, metadata).map(item => item.id), ['mandarin', 'field']);
  assert.throws(() => matchingItems(items.filter(item => item.id === 'japanese' || item.id === 'unknown'), metadata), { code: 'LANGUAGE_NOT_FOUND' });
  assert.deepEqual(matchingItems(items, { title: '名侦探柯南[日语版]', year: '1996' }).map(item => item.id), ['japanese']);
  assert.deepEqual(matchingItems(items, { title: '名侦探柯南', language: '日语', year: '1996' }).map(item => item.id), ['japanese']);
});

test('resolves the Tencent Mandarin title to the exact Mandarin CMS episode', async () => {
  const original = globalThis.fetch;
  const queries = new Set();
  const videos = [
    { vod_id: 562, vod_name: '名侦探柯南', vod_lang: '日语' },
    { vod_id: 563, vod_name: '名侦探柯南国语', vod_lang: '日语' },
  ].map(video => ({ ...video, vod_year: '1996', type_name: '日韩动漫', vod_play_from: 'hls', vod_play_url: '第1279集$https://cdn.demo.site/' + video.vod_id + '/1279.m3u8#第1280集$https://cdn.demo.site/' + video.vod_id + '/1280.m3u8' }));
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'm.v.qq.com') return new Response('<meta property="og:title" content="【腾讯视频】 名侦探柯南[普通话版] 1280"><script>{"coverInfo":{"title":"名侦探柯南[普通话版]","year":"1996"},"videoInfo":{"c_title_detail":"第1280集"}}</script>');
    if (url.hostname === 'cdn.demo.site') {
      assert.ok(['/563/1280.m3u8', '/563/0.ts'].includes(url.pathname));
      return new Response('#EXTM3U\n#EXTINF:6,\n0.ts\n#EXT-X-ENDLIST');
    }
    assert.equal(url.hostname, 'cms.demo.site');
    if (url.searchParams.has('wd')) {
      const query = url.searchParams.get('wd');
      queries.add(query);
      if (query === '名侦探柯南普通话') return new Response('Unavailable', { status: 503 });
      return Response.json({ code: 1, list: query === '名侦探柯南' ? [videos[0]] : videos });
    }
    assert.equal(url.searchParams.get('ids'), '563');
    return Response.json({ code: 1, list: [videos[1]] });
  };
  try {
    const env = { MEDIA_SECRET: 'test-media-signing-secret', CMS_SOURCES: JSON.stringify([{ id: 'test', name: '测试源', url: 'https://cms.demo.site/api' }]) };
    const response = await worker.fetch(new Request('https://api.demo.site/api/resolve?url=' + encodeURIComponent('https://v.qq.com/x/cover/hzgtnf6tbvfekfv/f41021om6x5.html')), env);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.match.title, '名侦探柯南国语');
    assert.equal(result.match.episodeNumber, 1280);
    assert.equal(result.routes.length, 1);
    assert.deepEqual([...queries].sort(), ['名侦探柯南', '名侦探柯南国语', '名侦探柯南普通话'].sort());
    assert.equal(result.originalUrl, 'https://cdn.demo.site/563/1280.m3u8');
    assert.equal(result.metadata.title, '名侦探柯南[普通话版]');
  } finally { globalThis.fetch = original; }
});

test('resolves a webpage to a CMS episode using only public metadata and configured sources', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async input => {
    const url = new URL(input); requests.push(url.href);
    if (url.hostname === 'v.youku.com') return new Response('<meta name="irAlbumName" content="谷雨"><meta name="irTitle" content="谷雨 第22集">');
    if (url.hostname === 'cdn.demo.site') return new Response('#EXTM3U\n#EXTINF:6,\n0.ts\n#EXT-X-ENDLIST');
    assert.equal(url.hostname, 'cms.demo.site');
    assert.equal(url.searchParams.get('ac'), 'detail');
    return Response.json({ code: 1, list: [{ vod_id: 1, vod_name: '谷雨', vod_year: '2026', type_name: '国产剧', vod_play_from: 'hls', vod_play_url: '第21集$https://cdn.demo.site/21.m3u8#第22集$https://cdn.demo.site/22.m3u8' }] });
  };
  try {
    const response = await worker.fetch(new Request('https://api.demo.site/api/resolve', { method: 'POST', body: JSON.stringify({ input: 'https://v.youku.com/v_show/id_a.html' }) }), { MEDIA_SECRET: 'test-media-secret-long', CMS_SOURCES: JSON.stringify([{ id: 'test', name: '测试源', url: 'https://cms.demo.site/api' }]) });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.provider, 'cms'); assert.equal(data.originalUrl, 'https://cdn.demo.site/22.m3u8');
    assert.equal(new URL(data.url).pathname, '/api/jiexi/resolved-media'); assert.equal(data.direct, false);
    assert.equal(data.match.episodeNumber, 22); assert.equal(data.metadata.title, '谷雨');
    assert.deepEqual(data.episodes.map(episode => episode.number), [21, 22]);
    assert.equal(data.selectedEpisodeNumber, 22);
    const selected = await worker.fetch(new Request('https://api.demo.site/api/resolve', { method: 'POST', body: JSON.stringify({ id: 'test:1', episodeNumber: 21 }) }), { MEDIA_SECRET: 'test-media-secret-long', CMS_SOURCES: JSON.stringify([{ id: 'test', name: '测试源', url: 'https://cms.demo.site/api' }]) });
    const next = await selected.json();
    assert.equal(selected.status, 200);
    assert.equal(next.match.episodeNumber, 21);
    assert.equal(next.originalUrl, 'https://cdn.demo.site/21.m3u8');
    assert.equal(next.routes.length, 1);
    assert.equal(next.selectedEpisodeNumber, 21);
    assert.equal(requests.some(url => url.includes('qlplayer')), false);
  } finally { globalThis.fetch = original; }
});

test('adapts Mango public metadata and rejects redirect targets outside public HTTPS', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.match(String(input), /pcweb.api.mgtv.com\/video\/info\?vid=123/);
    return Response.json({ code: 200, data: { info: { clipName: '小巷人家', title: '小巷人家', videoName: '小巷人家 第1集', detail: { releaseTime: '2024-10-28' } } } });
  };
  try {
    const info = await identifyPage('https://www.mgtv.com/b/593455/123.html', readText);
    assert.equal(info.title, '小巷人家'); assert.equal(info.episode, 1); assert.equal(info.year, '2024');
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } });
    await assert.rejects(identifyPage('https://v.youku.com/v_show/id_a.html', readText), { status: 400 });
  } finally { globalThis.fetch = original; }
});
test('uses the exact Bilibili episode ID from public season metadata', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.match(String(input), /api.bilibili.com\/pgc\/view\/web\/season\?ep_id=334366/);
    return Response.json({ code: 0, result: { title: '任务大师', type: 4, publish: { pub_time: '2020-08-03' }, episodes: [{ id: 333713, title: '1' }, { id: 334366, title: '2' }] } });
  };
  try {
    const metadata = await identifyPage('https://www.bilibili.com/bangumi/play/ep334366', readText);
    assert.equal(metadata.title, '任务大师'); assert.equal(metadata.episode, 2); assert.equal(metadata.year, '2020');
  } finally { globalThis.fetch = original; }
});
test('falls back to indexed mobile metadata when Bilibili API is unavailable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'api.bilibili.com') return new Response('Unavailable', { status: 412 });
    assert.equal(url.hostname, 'm.bilibili.com');
    return new Response('<meta property="og:title" content="任务大师 第2集"><script>{"ogv_episode_info":{"index_title":"2"}}</script>');
  };
  try {
    const metadata = await identifyPage('https://www.bilibili.com/bangumi/play/ep334366', readText);
    assert.equal(metadata.title, '任务大师'); assert.equal(metadata.episode, 2);
  } finally { globalThis.fetch = original; }
});
test('uses cached Bilibili metadata without opening a browser or fetching the page', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network should not be used'); };
  const cached = { title: '任务大师', episode: 2, year: '2020', isCollection: false };
  const CONFIG_DB = { prepare(sql) {
    assert.match(sql, /page_metadata/);
    return { bind(key) { assert.equal(key, 'https://www.bilibili.com/bangumi/play/ep334366'); return this; }, async first() { return { value: JSON.stringify(cached) }; } };
  } };
  try {
    const metadata = await identifyPage('https://www.bilibili.com/bangumi/play/ep334366?from=share', readText, { CONFIG_DB });
    assert.equal(metadata.title, '任务大师'); assert.equal(metadata.episode, 2);
  } finally { globalThis.fetch = original; }
});
test('skips unavailable media sources and signs a playable CMS result', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'v.youku.com') return new Response('<meta name="irAlbumName" content="谷雨"><meta name="irTitle" content="谷雨 第22集">');
    if (url.hostname === 'bad.cdn.demo.site') return new Response('missing', { status: 404 });
    if (url.hostname === 'good.cdn.demo.site') return new Response('#EXTM3U\n#EXTINF:6,\n0.ts\n#EXT-X-ENDLIST');
    const host = url.hostname.startsWith('bad.') ? 'bad' : 'good';
    return Response.json({ code: 1, list: [{ vod_id: 1, vod_name: '谷雨', vod_year: '2026', type_name: '国产剧', vod_play_from: 'hls', vod_play_url: '第22集$https://' + host + '.cdn.demo.site/22.m3u8' }] });
  };
  const env = { MEDIA_SECRET: 'test-media-signing-secret', CMS_SOURCES: JSON.stringify(['bad', 'good'].map(id => ({ id, name: id, url: 'https://' + id + '.cms.demo.site/api' }))) };
  try {
    const response = await worker.fetch(new Request('https://api.demo.site/api/resolve?url=' + encodeURIComponent('https://v.youku.com/v_show/id_a.html')), env);
    const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.match.sourceId, 'good');
    const media = await worker.fetch(new Request(data.url), env);
    assert.equal(media.status, 200); assert.match(await media.text(), /resolved-media/);
    const tampered = new URL(data.url); tampered.searchParams.set('url', 'https://evil.demo.site/video.m3u8');
    assert.equal((await worker.fetch(new Request(tampered), env)).status, 403);
  } finally { globalThis.fetch = original; }
});
