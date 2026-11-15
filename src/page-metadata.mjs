import { allowed } from './parser-resolver.mjs';

const fail = message => Object.assign(new Error(message), { status: 422, code: 'PAGE_METADATA_UNAVAILABLE' });
const crawlerAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const browserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function decodeText(value) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', middot: '·' };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|middot);/gi, (match, name) => {
    if (name[0] !== '#') return entities[name.toLowerCase()] ?? match;
    const number = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  }).replace(/<[^>]*>/g, '').trim();
}

export function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  let total = 0, digit = 0;
  for (const character of value) {
    if (character in digits) digit = digits[character];
    else if (character in units) { total += (digit || 1) * units[character]; digit = 0; }
    else return undefined;
  }
  return total + digit;
}

export function episodeNumber(value) {
  const text = decodeText(value).normalize('NFKC');
  const date = /(?:^|\D)(20\d{2})[-./年]?(\d{2})[-./月]?(\d{2})(?:日|期)?(?:$|\D)/.exec(text);
  if (date) return date.slice(1).join('');
  const match = /第\s*([\d零〇一二两三四五六七八九十百千]+)\s*[集话期回]/.exec(text) || /^(\d{1,4})$/.exec(text) || /\b(?:EP|Episode)\s*(\d{1,4})\b/i.exec(text);
  const number = match ? chineseNumber(match[1]) : undefined;
  return number > 0 && number < 10000 ? number : undefined;
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[match[1].toLowerCase()] = decodeText(match[2] ?? match[3] ?? match[4]);
  return result;
}

function cleanTitle(value) {
  return decodeText(value)
    .replace(/^【(?:腾讯视频|优酷|爱奇艺|芒果TV|哔哩哔哩)】\s*/i, '')
    .replace(/\s*[-_|－—]\s*(?:电视剧|电影|动漫|动画|国创|番剧|综艺|少儿|儿童|高清|完整版|全集|在线观看|在线|bilibili|哔哩哔哩|爱奇艺|优酷|腾讯视频|芒果).*/i, '')
    .replace(/\s*第\s*[\d零〇一二两三四五六七八九十百千]+\s*[集话期回].*$/, '')
    .replace(/[《》]/g, '').trim();
}

function objectProperty(html, name) {
  const match = new RegExp('"' + name + '"\\s*:\\s*\\{').exec(html);
  if (!match) return {};
  const offset = match.index + match[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  for (let index = offset; index < html.length; index++) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(offset, index + 1)); } catch { return {}; }
    }
  }
  return {};
}

export function extractMetadata(html, source) {
  const meta = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const name = (attrs.name || attrs.property || '').toLowerCase();
    if (name && !meta[name]) meta[name] = attrs.content;
  }
  const nodes = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(match[1])) continue;
    try {
      const data = JSON.parse(match[2]);
      const roots = Array.isArray(data) ? data : data['@graph'] || [data];
      nodes.push(...roots.filter(node => node && typeof node === 'object'));
    } catch { /* Other public metadata remains usable if JSON-LD is malformed. */ }
  }
  const currentPath = new URL(source).pathname;
  const videos = nodes.filter(node => /VideoObject|TVEpisode|Movie|Episode/.test(String(node['@type'])));
  const video = videos.find(node => [node.url, node['@id'], node.contentUrl].some(value => {
    try { return new URL(value).pathname === currentPath; } catch { return false; }
  })) || (videos.length === 1 ? videos[0] : undefined);
  let series = video?.partOfSeries;
  if (series?.['@id']) series = nodes.find(node => node['@id'] === series['@id']) || series;
  const rawTitle = meta.irtitle || meta['og:title'] || video?.name || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '';
  const isTencent = /(?:^|\.)v\.qq\.com$/.test(new URL(source).hostname);
  const cover = isTencent ? objectProperty(html, 'coverInfo') : {};
  const currentVideo = isTencent ? objectProperty(html, 'videoInfo') : {};
  const title = cleanTitle(meta.iralbumname || series?.name || cover.title || rawTitle);
  if (!title || title.length > 100 || /^(?:腾讯视频|爱奇艺(?:-.*)?|优酷|芒果TV(?:-.*)?|哔哩哔哩|bilibili|视频不存在|出错了|页面不存在|访问验证|安全验证)$/i.test(title)) throw fail('网页未提供有效片名，请检查链接是否为具体视频播放页');
  let episode = episodeNumber(rawTitle) || episodeNumber(String(video?.episodeNumber || ''));
  if (isTencent) episode = episodeNumber(currentVideo.c_title_detail || currentVideo.c_title_output || '') || episode;
  if (!episode && /(?:^|\.)youku\.com$/.test(new URL(source).hostname)) episode = episodeNumber(/"showVideoStage"\s*:\s*(\d+)/.exec(html)?.[1] || '');
  if (!episode && /(?:^|\.)bilibili\.com$/.test(new URL(source).hostname)) episode = episodeNumber(/"ogv_episode_info"\s*:\s*\{[^{}]*?"index_title"\s*:\s*"([^"]+)"/.exec(html)?.[1] || '');
  const published = series?.datePublished || cover.year || cover.publish_date || meta['video:release_date'] || '';
  const year = /^(19\d{2}|20\d{2})/.exec(published)?.[1] || '';
  const isCollection = /^\/a_/.test(currentPath) || /\/bangumi\/play\/ss\d+/.test(currentPath) || /^\/x\/cover\/[^/]+\.html$/.test(currentPath) || new URL(source).hostname === 'm.v.qq.com' && !new URL(source).searchParams.has('vid');
  return { title, episode: episode ?? null, year, pageTitle: decodeText(rawTitle), source, isCollection };
}

async function pageResponse(raw, readText) {
  let target = allowed(raw);
  const timeout = AbortSignal.timeout(/(?:^|\.)bilibili\.com$/.test(target.hostname) ? 5000 : 12000);
  for (let redirects = 0; redirects < 4; redirects++) {
    const headers = /(?:^|\.)bilibili\.com$/.test(target.hostname)
      ? { 'User-Agent': browserAgent, Referer: 'https://www.bilibili.com/', Accept: target.hostname === 'api.bilibili.com' ? 'application/json' : 'text/html' }
      : { 'User-Agent': crawlerAgent, Accept: 'text/html,application/json' };
    const response = await fetch(target, { redirect: 'manual', signal: timeout, headers });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      await response.body?.cancel();
      if (!location) throw fail('网页重定向缺少目标地址');
      target = allowed(new URL(location, target).href);
      continue;
    }
    return { text: await readText(response), url: target.href };
  }
  throw fail('网页重定向次数过多');
}

async function bilibiliMetadata(input, readText) {
  const season = /^\/bangumi\/play\/(ss|ep)(\d+)\/?$/.exec(input.pathname);
  if (season) {
    const parameter = season[1] === 'ss' ? 'season_id' : 'ep_id';
    const data = JSON.parse((await pageResponse('https://api.bilibili.com/pgc/view/web/season?' + parameter + '=' + season[2], readText)).text);
    if (data.code !== 0 || !data.result?.title) throw fail('B 站未提供有效番剧信息');
    const result = data.result;
    const episode = season[1] === 'ep' ? result.episodes?.find(episode => String(episode.id) === season[2]) : result.episodes?.find(episode => episodeNumber(episode.title) === 1) || result.episodes?.[0];
    if (!episode) throw fail('B 站未提供该分集的信息');
    return { title: cleanTitle(result.title), episode: episodeNumber(episode.title) ?? null,
      year: /^(19\d{2}|20\d{2})/.exec(result.publish?.pub_time || '')?.[1] || '',
      pageTitle: result.title + ' ' + episode.title, source: input.href, isCollection: season[1] === 'ss' && result.type !== 2 };
  }
  const video = /^\/video\/(BV[\w]+|av\d+)\/?$/.exec(input.pathname);
  if (video) {
    const parameter = video[1].startsWith('av') ? 'aid=' + video[1].slice(2) : 'bvid=' + video[1];
    const data = JSON.parse((await pageResponse('https://api.bilibili.com/x/web-interface/view?' + parameter, readText)).text);
    if (data.code !== 0 || !data.data?.title) throw fail('B 站未提供有效视频信息');
    const part = data.data.pages?.find(part => part.page === Number(input.searchParams.get('p') || '1'));
    return { title: cleanTitle(data.data.title), episode: episodeNumber(data.data.title) || episodeNumber(part?.part || '') || null,
      year: '', pageTitle: data.data.title, source: input.href, isCollection: false };
  }
  return null;
}

async function identifyBilibili(input, readText, browser) {
  try {
    const metadata = await bilibiliMetadata(input, readText);
    if (metadata) return metadata;
  } catch { /* The indexed page provides a second public metadata path. */ }
  const mobile = new URL(input);
  mobile.hostname = 'm.bilibili.com';
  try {
    const { text, url } = await pageResponse(mobile.href, readText);
    return extractMetadata(text, url);
  } catch (err) {
    if (!browser) throw err;
    const { renderedPage } = await import('./browser-metadata.mjs');
    const rendered = await renderedPage(input.href, browser);
    return extractMetadata(rendered.html, rendered.url);
  }
}

export async function identifyPage(raw, readText, options = {}) {
  const input = allowed(raw);
  if (/^(?:(?:www|m)\.)?bilibili\.com$/.test(input.hostname)) {
    const key = 'https://www.bilibili.com' + input.pathname + (input.searchParams.has('p') ? '?p=' + input.searchParams.get('p') : '');
    const now = Math.floor(Date.now() / 1000);
    if (options.CONFIG_DB) {
      const cached = await options.CONFIG_DB.prepare('SELECT value FROM page_metadata WHERE url = ? AND expires_at > ?').bind(key, now).first();
      if (cached) return { ...JSON.parse(cached.value), source: raw };
    }
    const metadata = { ...await identifyBilibili(input, readText, options.BROWSER), source: raw };
    if (options.CONFIG_DB) await options.CONFIG_DB.prepare('INSERT INTO page_metadata (url, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
      .bind(key, JSON.stringify(metadata), now + 86400).run();
    return metadata;
  }
  // Public mobile pages expose metadata for pages whose desktop shell is client-rendered.
  if (/^(?:www\.|m\.)?iqiyi\.com$/.test(input.hostname)) input.hostname = 'm.iqiyi.com';
  if (input.hostname === 'v.qq.com') {
    const cover = /^\/x\/cover\/([^/.]+)(?:\/([^/.]+))?\.html$/.exec(input.pathname);
    const vid = /^\/x\/page\/([^/.]+)\.html$/.exec(input.pathname);
    if (cover || vid) {
      const mobile = new URL('https://m.v.qq.com/x/m/play');
      if (cover) mobile.searchParams.set('cid', cover[1]);
      if (cover?.[2] || vid) mobile.searchParams.set('vid', cover?.[2] || vid[1]);
      input.href = mobile.href;
    }
  }
  if (/^(?:www|m|w)\.mgtv\.com$/.test(input.hostname)) {
    const id = /^\/b\/\d+\/(\d+)\.html$/.exec(input.pathname)?.[1];
    if (id) {
      const { text } = await pageResponse('https://pcweb.api.mgtv.com/video/info?vid=' + id, readText);
      const data = JSON.parse(text);
      const info = data.data?.info;
      if (data.code === 200 && info?.title) {
        const title = cleanTitle(info.clipName || info.plName || info.title);
        const pageTitle = info.videoName || data.data.video?.showTitle || info.title;
        return { title, episode: episodeNumber(pageTitle) ?? null, year: /^(19\d{2}|20\d{2})/.exec(info.detail?.releaseTime || '')?.[1] || '', pageTitle, source: raw, isCollection: false };
      }
      throw fail('芒果页面未提供有效视频信息');
    }
  }
  const { text, url } = await pageResponse(input.href, readText);
  return { ...extractMetadata(text, url), source: raw };
}
