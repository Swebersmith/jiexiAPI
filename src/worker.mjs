import { handleParserResolver, allowed, signCatalogMedia } from './parser-resolver.mjs';
import { handleAdmin } from './admin.mjs';
import { loadConfig } from './config.mjs';
import { identifyPage, episodeNumber } from './page-metadata.mjs';
import { catalogIdentity, catalogLanguage, catalogQueries, matchingItems, episodeChoices, availableEpisodes } from './catalog-match.mjs';
import { probeCatalogMedia, sortRoutes } from './media-probe.mjs';
import { resolveParserServices } from './parser-services.mjs';

const error = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (data, status = 200) => Response.json(data, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
} });

export async function readText(response, limit = 4 * 1024 * 1024) {
  if (!response.ok) { await response.body?.cancel(); throw error('上游返回 HTTP ' + response.status, 502); }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw error('响应超过大小限制', 413);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); }
}

function sources(env) {
  let list;
  try { list = JSON.parse(env.CMS_SOURCES || '[]'); } catch { throw error('CMS_SOURCES 配置格式错误', 503); }
  if (!Array.isArray(list) || list.length > 8) throw error('请配置 1–8 个苹果 CMS JSON 采集源', 503);
  if (!list.length) throw error('当前没有已启用的采集源，请在管理后台启用', 503);
  const ids = new Set();
  for (const source of list) {
    if (!/^[a-z0-9_-]{1,32}$/.test(source.id) || ids.has(source.id) || !source.name) throw error('采集源标识配置错误', 503);
    allowed(source.url);
    ids.add(source.id);
  }
  return list;
}

async function cms(source, params) {
  const target = new URL(source.url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  // The source endpoint is operator configured. Redirects are rejected explicitly.
  let data;
  try {
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 CrayonPlayer/0.3' } });
    data = JSON.parse(await readText(response));
  } catch (err) { throw error(source.name + '暂时不可用（' + (err.name === 'SyntaxError' ? 'JSON 格式错误' : err.message) + '）', 502); }
  if (!data || !Array.isArray(data.list) || (data.code !== undefined && Number(data.code) !== 1)) throw error(source.name + '未返回有效的苹果 CMS JSON 数据', 502);
  return data;
}

function title(value) { return String(value || '').replace(/<[^>]*>/g, '').slice(0, 1000); }
function poster(video, source) {
  for (const value of [video.vod_pic, video.vod_pic_thumb, video.vod_pic_slide]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 8192) continue;
    try {
      const url = new URL(value.trim(), source.url);
      if (url.protocol === 'http:') url.protocol = 'https:';
      return allowed(url.href).href;
    } catch { /* Other catalog image fields may provide a valid public cover. */ }
  }
  return '';
}
function item(video, source) {
  const result = { id: source.id + ':' + video.vod_id, sourceId: source.id, sourceName: source.name,
    title: title(video.vod_name), year: title(video.vod_year), type: title(video.type_name), language: title(video.vod_lang),
    description: title(video.vod_content), remarks: title(video.vod_remarks), poster: poster(video, source),
  };
  return { ...result, language: catalogLanguage(result), groupKey: catalogIdentity(result) };
}

export function playLines(video) {
  const names = String(video.vod_play_from || '').split('$$$');
  return String(video.vod_play_url || '').split('$$$').map((group, index) => ({
    id: String(index), name: names[index] || '线路 ' + (index + 1),
    episodes: group.split('#').flatMap((entry, episode) => {
      const separator = entry.indexOf('$');
      const url = (separator < 0 ? entry : entry.slice(separator + 1)).trim();
      try { allowed(url); } catch { return []; }
      const label = title(separator < 0 ? '第 ' + (episode + 1) + ' 集' : entry.slice(0, separator));
      return [{ id: String(episode), title: label, number: episodeNumber(label), url }];
    }),
  })).filter(line => line.episodes.length);
}

async function detail(id, env) {
  const match = /^([a-z0-9_-]{1,32}):([0-9]{1,20})$/.exec(id || '');
  if (!match) throw error('影片标识无效');
  const source = sources(env).find(source => source.id === match[1]);
  if (!source) throw error('采集源不存在', 404);
  const data = await cms(source, { ac: 'detail', ids: match[2] });
  const video = data.list.find(video => String(video.vod_id) === match[2]);
  if (!video) throw error('影片不存在', 404);
  return { ...item(video, source), lines: playLines(video) };
}

async function search(input, env, sourceId, page = '1') {
  const query = typeof input === 'string' ? input.trim() : '';
  if (!query || query.length > 80 || /[\u0000-\u001f]/.test(query)) throw error('请输入 1–80 字片名');
  if (!/^[1-9]\d{0,3}$/.test(String(page))) throw error('页码无效');
  const list = sources(env).filter(source => !sourceId || source.id === sourceId);
  if (!list.length) throw error('采集源不存在', 404);
  const results = await Promise.allSettled(list.map(source => cms(source, { ac: 'detail', wd: query, pg: String(page) })));
  const items = [], providers = [];
  results.forEach((result, index) => {
    const source = list[index];
    if (result.status === 'rejected') { providers.push({ id: source.id, name: source.name, status: 'unavailable', message: result.reason.message }); return; }
    const data = result.value;
    items.push(...data.list.filter(video => /^\d{1,20}$/.test(String(video.vod_id))).slice(0, 100).map(video => item(video, source)));
    providers.push({ id: source.id, name: source.name, status: 'ok', page: Number(data.page || page), pageCount: Number(data.pagecount || 1) });
  });
  if (providers.every(provider => provider.status === 'unavailable')) throw error(providers.map(p => p.message).join('；'), 502);
  return { kind: 'search', query, items, providers, warning: providers.some(p => p.status === 'unavailable') ? '部分采集源不可用' : '' };
}

async function resolve(data, request, env) {
  if (!data || typeof data !== 'object') throw error('请求格式错误');
  if (data.id) {
    const video = await detail(data.id, env);
    if (data.episodeNumber !== undefined) {
      const episode = episodeNumber(String(data.episodeNumber));
      if (!episode) throw error('episodeNumber 参数须为正整数集数或 YYYYMMDD 日期');
      return json(await resolveCatalog({ title: video.title, year: video.year, language: video.language, episode, source: video.id, isCollection: false }, video.id, data, request, env));
    }
    const line = video.lines.find(line => line.id === String(data.line ?? '0'));
    const episode = line?.episodes.find(episode => episode.id === String(data.episode ?? '0'));
    if (!episode) throw error('播放线路或分集不存在', 404);
    return resolve({ url: episode.url }, request, env);
  }
  const input = data.input ?? data.url ?? data.q;
  if (typeof input !== 'string' || !input.trim() || input.length > 8192) throw error('请输入片名或完整视频 URL');
  const value = input.trim();
  const parser = data.parser ?? 'auto';
  if (typeof parser !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(parser)) throw error('解析接口标识无效');
  if (!/^https?:\/\//i.test(value)) {
    if (!['auto', 'cms'].includes(parser)) throw error('使用解析接口时请输入完整视频网页 URL');
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) throw error('URL 协议无效');
    return json(await search(value, env, data.source, data.page));
  }
  const target = allowed(value);
  if (['auto', 'cms'].includes(parser) && /\.(m3u8|mp4|webm|m4v)(?:$)/i.test(target.pathname)) {
    return json({ kind: 'playback', url: target.href, source: target.href, type: /\.m3u8$/i.test(target.pathname) ? 'm3u8' : /\.webm$/i.test(target.pathname) ? 'webm' : 'mp4', direct: true });
  }
  if (env.PAGE_ENABLED === false) throw error('管理后台已停用网页资源解析', 503);
  const services = JSON.parse(env.PARSER_SERVICES || '[]').filter(service => service.enabled);
  if (!['auto', 'cms'].includes(parser)) {
    const selected = services.find(service => service.id === parser);
    if (!selected) throw error('解析接口不存在或未启用', 404);
    if (data.episode !== undefined || data.year !== undefined) throw error('指定解析接口时请使用对应分集的网页 URL');
    const resolved = await resolveParserServices([selected], target.href, request, env, readText);
    return json(parserPlayback(target.href, undefined, resolved));
  }
  let catalog;
  let failure;
  try { catalog = await resolvePageCatalog(target, data, request, env); }
  catch (err) { failure = err; }
  if (parser === 'cms' || !services.length || data.source || data.episode !== undefined || data.year !== undefined) {
    if (failure) throw failure;
    return json(catalog);
  }
  if (catalog && env.PARSER_MODE !== 'combined') return json(catalog);
  const resolved = await resolveParserServices(services, target.href, request, env, readText, env.PARSER_MODE === 'combined');
  if (!catalog && !resolved.routes.length) {
    const err = error('采集源与解析接口均未提供可用视频', 502);
    err.parserResults = resolved.results;
    throw err;
  }
  return json(parserPlayback(target.href, catalog, resolved));
}

function parserPlayback(source, catalog, resolved) {
  const routes = sortRoutes([...(catalog?.routes || []), ...resolved.routes]);
  if (!routes.length) {
    const err = error('解析接口未提供可播放视频', 502);
    err.parserResults = resolved.results;
    throw err;
  }
  const selected = routes[0];
  return { kind: 'playback', source, ...selected, provider: selected.provider || 'cms', metadata: catalog?.metadata || null,
    routes, selectedRouteId: selected.id, episodes: catalog?.episodes || [],
    selectedEpisodeNumber: catalog?.selectedEpisodeNumber ?? null, parserResults: resolved.results };
}

async function resolvePageCatalog(target, data, request, env) {
  if (!JSON.parse(env.CMS_SOURCES || '[]').length) throw error('当前没有已启用的采集源', 503);
  const metadata = await identifyPage(target.href, readText, env);
  if (data.episode !== undefined) {
    const episode = episodeNumber(String(data.episode));
    if (!episode) throw error('episode 参数须为正整数集数或 YYYYMMDD 日期');
    metadata.episode = episode;
  }
  if (data.year !== undefined) {
    if (!/^(19|20)\d{2}$/.test(String(data.year))) throw error('year 参数须为四位年份');
    metadata.year = String(data.year);
  }
  return resolveCatalog(metadata, target.href, data, request, env);
}

async function resolveCatalog(metadata, source, data, request, env) {
  const results = await Promise.allSettled(catalogQueries(metadata.title).map(query => search(query, env, data.source)));
  const completed = results.filter(result => result.status === 'fulfilled');
  if (!completed.length) throw results[0].reason;
  const items = new Map(completed.flatMap(result => result.value.items).map(item => [item.id, item]));
  const candidates = matchingItems([...items.values()], metadata).slice(0, 8);
  const details = await Promise.allSettled(candidates.map(candidate => detail(candidate.id, env)));
  const choices = [];
  let failure;
  for (const result of details) {
    if (result.status === 'rejected') { failure = result.reason; continue; }
    try { choices.push(...episodeChoices(result.value, metadata).map(selected => ({ video: result.value, ...selected }))); }
    catch (err) { failure = err; }
  }
  const probes = new Map();
  const routes = [];
  for (let offset = 0; offset < choices.length; offset += 4) {
    const batch = await Promise.allSettled(choices.slice(offset, offset + 4).map(async ({ video, line, episode, number }) => {
      if (!probes.has(episode.url)) probes.set(episode.url, probeCatalogMedia(episode.url));
      const probe = await probes.get(episode.url);
      const media = await signCatalogMedia(probe.url, env.PUBLIC_ORIGIN || request.url, env.MEDIA_SECRET);
      const id = video.id + ':' + line.id + ':' + episode.id;
      return { id, ...media, quality: probe.quality, latencyMs: probe.latencyMs,
        name: video.sourceName + ' · ' + line.name + ' · ' + probe.quality.label + ' · ' + probe.latencyMs + 'ms',
        type: probe.type,
        match: { id: video.id, title: video.title, year: video.year, sourceId: video.sourceId, sourceName: video.sourceName,
          line: line.id, lineName: line.name, episode: episode.id, episodeTitle: episode.title, episodeNumber: number },
      };
    }));
    for (const result of batch) {
      if (result.status === 'fulfilled') routes.push(result.value);
      else failure = result.reason;
    }
  }
  sortRoutes(routes);
  if (!routes.length) throw failure || error('采集站未提供可用资源', 404);
  const episodes = availableEpisodes(details.filter(result => result.status === 'fulfilled').map(result => result.value));
  return { kind: 'playback', provider: 'cms', source, ...routes[0], metadata, routes, episodes, selectedEpisodeNumber: routes[0].match.episodeNumber, selectedRouteId: routes[0].id };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return Response.redirect(url.origin + '/admin/', 302);
    const admin = await handleAdmin(request, env, readText);
    if (admin) return admin;
    const origin = request.headers.get('Origin');
    const origins = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim());
    const cors = origin && (origins.includes(origin) || origin === url.origin) ? origin : '';
    let response;
    try {
      if (request.headers.get('X-Crayon-Resolver-Hop') && ['/api/resolve', '/api/player/resolve'].includes(url.pathname)) throw error('检测到解析接口循环调用', 400);
      if (origin && !cors) throw error('请求来源未获授权', 403);
      if (['GET', 'POST'].includes(request.method) && ['/api/resolve', '/api/player/resolve', '/api/player/search', '/api/player/detail'].includes(url.pathname)) {
        const config = await loadConfig(env);
        env = { ...env, CMS_SOURCES: JSON.stringify(config.sources.filter(source => source.enabled)), PAGE_ENABLED: config.pageEnabled,
          PARSER_SERVICES: JSON.stringify(config.parsers), PARSER_MODE: config.parserMode };
      }
      if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else if (url.pathname === '/health' && request.method === 'GET') response = json({ ok: true, service: 'jiexi-api' });
      else if (url.pathname === '/api/jiexi/resolved-media' || url.pathname.startsWith('/api/jiexi/resolved/')) {
        response = await handleParserResolver(request, { secret: env.MEDIA_SECRET, authorize: () => true });
      } else if (url.pathname === '/api/player/search' && request.method === 'GET') {
        response = json(await search(url.searchParams.get('q'), env, url.searchParams.get('source'), url.searchParams.get('page') || '1'));
      } else if (url.pathname === '/api/player/detail' && request.method === 'GET') {
        response = json(await detail(url.searchParams.get('id'), env));
      } else if (['/api/resolve', '/api/player/resolve'].includes(url.pathname)) {
        if (!['GET', 'POST'].includes(request.method)) throw error('请求方法不受支持', 405);
        let data = Object.fromEntries(url.searchParams);
        if (request.method === 'POST') {
          try { data = JSON.parse(await readText(new Response(request.body), 16384)); }
          catch (err) { throw error(err.status === 413 ? err.message : '请求 JSON 无效', err.status || 400); }
        }
        response = await resolve(data, request, env);
      } else throw error('接口不存在', 404);
    } catch (err) {
      const status = err.status || 502;
      console.warn(JSON.stringify({ event: 'api_error', path: url.pathname, status }));
      response = json({ error: { code: err.code || (status === 400 ? 'INVALID_REQUEST' : 'RESOLVE_FAILED'), message: err.message }, ...(err.parserResults ? { parserResults: err.parserResults } : {}) }, status);
    }
    const headers = new Headers(response.headers);
    headers.set('Vary', 'Origin');
    if (cors) {
      headers.set('Access-Control-Allow-Origin', cors);
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Range, If-Range');
      headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    }
    return new Response(response.body, { status: response.status, headers });
  },
};
