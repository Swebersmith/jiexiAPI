import { allowed, signCatalogMedia, resolveQlMedia } from './parser-resolver.mjs';
import { probeCatalogMedia } from './media-probe.mjs';

const fail = (message, status = 400, code = 'INVALID_REQUEST') => Object.assign(new Error(message), { status, code });
const fieldPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const pathPattern = /^(?:[A-Za-z_][A-Za-z0-9_]*|\d+)(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+))*$/;
const forbiddenFields = new Set(['__proto__', 'constructor', 'prototype']);
const reservedHeaders = /^(?:host|content-length|connection|transfer-encoding|x-crayon-resolver-hop)$/i;
export const qlParser = { id: 'ql', name: 'QL · 麒麟', url: 'https://svip.qlplayer.cyou/', enabled: true, method: 'QL', urlParam: 'url', responsePath: '', headers: {}, params: {} };

function objectFields(value, headers = false) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length > 16) throw fail('额外参数和请求头须为最多 16 项的 JSON 对象');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 4096) throw fail('请求头或额外参数超过 4 KiB 限制');
  for (const [key, entry] of Object.entries(value)) {
    const validValue = typeof entry === 'string' || !headers && (typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry));
    if (forbiddenFields.has(key) || !validValue || String(entry).length > 2048 || !key || key.length > 64) throw fail('请检查额外参数或请求头格式');
    if (headers && (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || reservedHeaders.test(key) || /[\r\n]/.test(entry))) throw fail('请求头名称或内容无效');
  }
  if (headers) {
    try { new Headers(value); } catch { throw fail('请求头名称或内容无效'); }
  }
  return { ...value };
}

export function validateParsers(value = []) {
  if (!Array.isArray(value) || value.length > 8) throw fail('最多配置 8 个解析接口');
  const ids = new Set(['auto', 'cms']);
  return value.map(parser => {
    if (!parser || typeof parser.id !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(parser.id) || ids.has(parser.id) || typeof parser.name !== 'string' || !parser.name.trim() || parser.name.length > 60 || typeof parser.url !== 'string' || !parser.url.trim() || parser.url.length > 2048 || typeof parser.enabled !== 'boolean') throw fail('请检查解析接口标识、名称、地址和启用状态，标识须唯一并避开 auto 和 cms');
    ids.add(parser.id);
    const method = parser.method ?? 'GET';
    const urlParam = parser.urlParam ?? 'url';
    const responsePath = parser.responsePath ?? '';
    if (!['GET', 'POST', 'QL'].includes(method) || typeof urlParam !== 'string' || !fieldPattern.test(urlParam) || forbiddenFields.has(urlParam) || typeof responsePath !== 'string' || responsePath.length > 160 || responsePath && (!pathPattern.test(responsePath) || responsePath.split('.').some(key => forbiddenFields.has(key)))) throw fail('请检查请求方法、视频参数名和返回地址字段');
    const url = allowed(parser.url, { allowWorkers: true });
    if (method === 'QL' && url.href !== qlParser.url) throw fail('QL 适配器地址须为 https://svip.qlplayer.cyou/');
    if (url.href.length > 2048) throw fail('解析接口地址过长');
    return { id: parser.id, name: parser.name.trim(), url: url.href, enabled: parser.enabled, method, urlParam, responsePath,
      headers: objectFields(parser.headers ?? {}, true), params: objectFields(parser.params ?? {}) };
  });
}

function field(data, path) {
  return path.split('.').reduce((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined, data);
}

function mediaAddress(data, parser) {
  const paths = parser.responsePath ? [parser.responsePath] : ['url', 'data.url', 'data.0.url', '0.url', 'data.playUrl', 'data.play_url', 'data.src', 'data', 'result.url', 'playUrl', 'play_url', 'src'];
  const value = paths.map(path => field(data, path)).map(value => typeof value === 'string' ? value.trim() : value).find(value => typeof value === 'string' && /^https:\/\//i.test(value));
  if (!value) throw fail('接口未返回 HTTPS 媒体地址，请检查返回字段', 502, 'PARSER_RESPONSE_INVALID');
  return allowed(value).href;
}

async function parserResponse(parser, source, signal, readText) {
  let url = new URL(parser.url);
  const params = { ...parser.params, [parser.urlParam]: source };
  let method = parser.method;
  let body;
  const headers = new Headers(parser.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (!headers.has('User-Agent')) headers.set('User-Agent', 'Mozilla/5.0 CrayonPlayer/0.3');
  headers.set('X-Crayon-Resolver-Hop', '1');
  if (method === 'GET') for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  else { body = JSON.stringify(params); headers.set('Content-Type', 'application/json'); }
  for (let hop = 0; hop < 4; hop++) {
    allowed(url.href, { allowWorkers: true });
    const response = await fetch(url, { method, body, headers, redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      await response.body?.cancel();
      if (!location) throw fail('接口重定向缺少目标地址', 502, 'PARSER_RESPONSE_INVALID');
      const next = allowed(new URL(location, url).href, { allowWorkers: true });
      if (next.origin !== url.origin) throw fail('接口跳转到其他域名，请配置最终接口地址', 502, 'PARSER_RESPONSE_INVALID');
      if (response.status === 303 || method === 'POST' && [301, 302].includes(response.status)) {
        method = 'GET'; body = undefined; headers.delete('Content-Type');
      }
      url = next;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw fail('接口返回 HTTP ' + response.status, 502, 'PARSER_UPSTREAM_ERROR'); }
    try { return JSON.parse(await readText(response, 1024 * 1024)); }
    catch (error) { throw fail(error.status === 413 ? '接口响应超过大小限制' : '接口未返回有效 JSON', 502, 'PARSER_RESPONSE_INVALID'); }
  }
  throw fail('接口重定向次数过多', 502, 'PARSER_RESPONSE_INVALID');
}

async function resolveParser(parser, source, request, env, readText, remaining) {
  const endpoint = new URL(parser.url);
  const origins = new Set([new URL(request.url).origin, env.PUBLIC_ORIGIN && new URL(env.PUBLIC_ORIGIN).origin]);
  if (origins.has(endpoint.origin) && /^\/(?:api\/(?:resolve|player\/resolve)|parse)\/?$/.test(endpoint.pathname)) throw fail('解析接口不能指向本服务的解析入口', 502, 'PARSER_LOOP');
  const signal = AbortSignal.timeout(Math.max(1, Math.min(parser.method === 'QL' ? 25000 : 12000, remaining)));
  const data = parser.method === 'QL' ? await resolveQlMedia(source, signal) : await parserResponse(parser, source, signal, readText);
  const media = mediaAddress(data, parser);
  const type = [field(data, 'type'), field(data, 'data.type'), field(data, 'format'), field(data, 'data.format')].find(value => typeof value === 'string') || '';
  const probe = await probeCatalogMedia(media, /m3u8|mpegurl|^hls$/i.test(type) ? 'm3u8' : '');
  const signed = await signCatalogMedia(probe.url, env.PUBLIC_ORIGIN || request.url, env.MEDIA_SECRET);
  return { id: 'parser:' + parser.id, provider: 'external', parserId: parser.id, parserName: parser.name,
    ...signed, type: probe.type, quality: probe.quality, latencyMs: probe.latencyMs,
    name: parser.name + ' · ' + probe.quality.label + ' · ' + probe.latencyMs + 'ms' };
}

export async function resolveParserServices(parsers, source, request, env, readText, combined = false) {
  const routes = [], results = [];
  const deadline = Date.now() + 45000;
  const run = async parser => {
    if (Date.now() >= deadline) { results.push({ id: parser.id, name: parser.name, status: 'unavailable', message: '接口尝试时间已用完' }); return; }
    try {
      const route = await resolveParser(parser, source, request, env, readText, deadline - Date.now());
      routes.push(route); results.push({ id: parser.id, name: parser.name, status: 'ok' });
    } catch (error) {
      const known = typeof error.code === 'string' && error.code.startsWith('PARSER_') || /^采集站媒体返回 HTTP \d{3}$/.test(error.message || '');
      results.push({ id: parser.id, name: parser.name, status: 'unavailable', message: known ? error.message : '接口请求或媒体检测失败' });
    }
  };
  for (let offset = 0; offset < parsers.length; offset += combined ? 4 : 1) {
    await Promise.all(parsers.slice(offset, offset + (combined ? 4 : 1)).map(run));
    if (!combined && routes.length) break;
  }
  const order = new Map(parsers.map((parser, index) => [parser.id, index]));
  routes.sort((a, b) => order.get(a.parserId) - order.get(b.parserId));
  results.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { routes, results };
}
