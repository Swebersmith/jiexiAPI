import { handleParserResolver, allowed } from './parser-resolver.mjs';
import { handleAdmin } from './admin.mjs';
import { loadConfig } from './config.mjs';

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
function item(video, source) {
  return { id: source.id + ':' + video.vod_id, sourceId: source.id, sourceName: source.name,
    title: title(video.vod_name), year: title(video.vod_year), type: title(video.type_name),
    description: title(video.vod_content), remarks: title(video.vod_remarks),
  };
}

export function playLines(video) {
  const names = String(video.vod_play_from || '').split('$$$');
  return String(video.vod_play_url || '').split('$$$').map((group, index) => ({
    id: String(index), name: names[index] || '线路 ' + (index + 1),
    episodes: group.split('#').flatMap((entry, episode) => {
      const separator = entry.indexOf('$');
      const url = (separator < 0 ? entry : entry.slice(separator + 1)).trim();
      try { allowed(url); } catch { return []; }
      return [{ id: String(episode), title: title(separator < 0 ? '第 ' + (episode + 1) + ' 集' : entry.slice(0, separator)), url }];
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
    const line = video.lines.find(line => line.id === String(data.line ?? '0'));
    const episode = line?.episodes.find(episode => episode.id === String(data.episode ?? '0'));
    if (!episode) throw error('播放线路或分集不存在', 404);
    return resolve({ url: episode.url }, request, env);
  }
  const input = data.input ?? data.url ?? data.q;
  if (typeof input !== 'string' || !input.trim() || input.length > 8192) throw error('请输入片名或完整视频 URL');
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) throw error('URL 协议无效');
    return json(await search(value, env, data.source, data.page));
  }
  const target = allowed(value);
  if (/\.(m3u8|mp4|webm|m4v)(?:$)/i.test(target.pathname)) {
    return json({ kind: 'playback', url: target.href, source: target.href, type: /\.m3u8$/i.test(target.pathname) ? 'm3u8' : 'mp4', direct: true });
  }
  if (env.QL_ENABLED === false) throw error('管理后台已停用 QL 网页解析', 503);
  const internal = new Request(new URL('/api/player/resolve', env.PUBLIC_ORIGIN || request.url), { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: value, parser: 'ql' }) });
  return handleParserResolver(internal, { secret: env.MEDIA_SECRET, authorize: () => true });
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
      if (origin && !cors) throw error('请求来源未获授权', 403);
      if (['GET', 'POST'].includes(request.method) && ['/api/resolve', '/api/player/resolve', '/api/player/search', '/api/player/detail'].includes(url.pathname)) {
        const config = await loadConfig(env);
        env = { ...env, CMS_SOURCES: JSON.stringify(config.sources.filter(source => source.enabled)), QL_ENABLED: config.qlEnabled };
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
      response = json({ error: { code: status === 400 ? 'INVALID_REQUEST' : 'RESOLVE_FAILED', message: err.message } }, status);
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
