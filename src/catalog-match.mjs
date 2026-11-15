import { chineseNumber, episodeNumber } from './page-metadata.mjs';

const fail = (message, code, status = 404) => Object.assign(new Error(message), { status, code });
export function normalizedTitle(raw) {
  return String(raw || '').normalize('NFKC').toLowerCase()
    .replace(/第\s*([\d零〇一二两三四五六七八九十百千]+)\s*[季部]/g, (_, value) => { const number = chineseNumber(value); return number === 1 ? '' : String(number); })
    .replace(/[（(](?:19|20)\d{2}[)）]/g, '')
    .replace(/(?:国语|粤语|普通话|英语|日语|中字|高清版|完整版|未删减版|动画版|tv版)$/gi, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

export function matchingItems(items, metadata) {
  const expected = normalizedTitle(metadata.title);
  let matches = items.filter(item => normalizedTitle(item.title) === expected);
  if (!matches.length) throw fail('采集站中没有匹配到《' + metadata.title + '》', 'RESOURCE_NOT_FOUND');
  if (metadata.year) {
    const exactYear = matches.filter(item => item.year === metadata.year);
    if (exactYear.length) matches = exactYear;
    else if (matches.every(item => item.year)) throw fail('采集站未收录《' + metadata.title + '》的 ' + metadata.year + ' 年版本', 'RESOURCE_NOT_FOUND');
  }
  const years = new Set(matches.map(item => item.year).filter(Boolean));
  if (years.size > 1) throw fail('采集站存在多个年份的同名影片，请提供 year 参数确认版本', 'AMBIGUOUS_RESOURCE', 409);
  return matches;
}

export function selectEpisode(detail, metadata) {
  const lines = detail.lines.map(line => ({ ...line, episodes: line.episodes.filter(episode => /\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(episode.url)) })).filter(line => line.episodes.length);
  let requested = metadata.episode;
  if (requested === null || requested === undefined) {
    if (lines.some(line => line.episodes.length === 1 && !/剧$|电视剧|动漫|动画|综艺|番剧|连续剧/.test(detail.type || ''))) {
      const line = lines.find(line => line.episodes.length === 1);
      return { line, episode: line.episodes[0], number: null };
    } else if (metadata.isCollection) requested = 1;
    else throw fail('网页未提供当前集数，请提供 episode 参数或使用具体分集链接', 'EPISODE_UNDETERMINED', 422);
  }
  for (const line of lines) {
    const episode = line.episodes.find(episode => String(episodeNumber(episode.title)) === String(requested));
    if (episode) return { line, episode, number: requested };
  }
  throw fail('采集站暂未提供《' + metadata.title + '》第 ' + requested + ' 集/期的可用视频', 'EPISODE_NOT_FOUND');
}
