import { chineseNumber, episodeNumber } from './page-metadata.mjs';

const fail = (message, code, status = 404) => Object.assign(new Error(message), { status, code });
const playableMedia = /\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i;
const versionTag = /(?:国语|普通话|粤语|英语|日语)(?:配音)?(?:版)?|中字|高清版|完整版|未删减版|动画版|tv版/gi;
const versionSuffix = new RegExp(String.raw`(?:\s*[\[【(]\s*(?:(?:${versionTag.source})\s*)+[\]】)]|\s*(?:${versionTag.source}))\s*$`, 'i');
const languageNames = { mandarin: '普通话', cantonese: '粤语', japanese: '日语', english: '英语' };
const languagePatterns = { mandarin: /国语|普通话|汉语/, cantonese: /粤语/, japanese: /日语/, english: /英语/ };
const languageQueries = { mandarin: ['国语', '普通话'], cantonese: ['粤语'], japanese: ['日语'], english: ['英语'] };

function languages(value) {
  return Object.keys(languageNames).filter(language => languagePatterns[language].test(value));
}

function titleVersion(raw) {
  let title = String(raw || '').normalize('NFKC').replace(/\((?:19|20)\d{2}\)/g, '').trim();
  const tags = [];
  let suffix;
  while ((suffix = versionSuffix.exec(title))) {
    tags.unshift(...(suffix[0].match(versionTag) || []));
    title = title.slice(0, suffix.index).trim();
  }
  return { title, languages: languages(tags.join(' ')) };
}

export function catalogQuery(raw) { return titleVersion(raw).title; }

export function catalogQueries(raw) {
  const version = titleVersion(raw);
  return [version.title, ...version.languages.flatMap(language => languageQueries[language].map(label => version.title + label))];
}

export function normalizedTitle(raw) {
  return catalogQuery(raw).toLowerCase()
    .replace(/第\s*([\d零〇一二两三四五六七八九十百千]+)\s*[季部]/g, (_, value) => { const number = chineseNumber(value); return number === 1 ? '' : String(number); })
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
  const titleLanguages = titleVersion(metadata.title).languages;
  const requestedLanguages = titleLanguages.length ? titleLanguages : languages(metadata.language || '');
  if (requestedLanguages.length) {
    matches = matches.filter(item => {
      const titleLanguages = titleVersion(item.title).languages;
      const available = titleLanguages.length ? titleLanguages : languages(item.language || '');
      return requestedLanguages.every(language => available.includes(language));
    });
    if (!matches.length) throw fail('采集站暂未提供《' + catalogQuery(metadata.title) + '》的' + requestedLanguages.map(language => languageNames[language]).join('/') + '版本', 'LANGUAGE_NOT_FOUND');
  }
  const years = new Set(matches.map(item => item.year).filter(Boolean));
  if (years.size > 1) throw fail('采集站存在多个年份的同名影片，请提供 year 参数确认版本', 'AMBIGUOUS_RESOURCE', 409);
  return matches;
}

export function episodeChoices(detail, metadata) {
  const lines = detail.lines.map(line => ({ ...line, episodes: line.episodes.filter(episode => playableMedia.test(episode.url)) })).filter(line => line.episodes.length);
  let requested = metadata.episode;
  if (requested === null || requested === undefined) {
    if (lines.some(line => line.episodes.length === 1 && !/剧$|电视剧|动漫|动画|综艺|番剧|连续剧/.test(detail.type || ''))) {
      return lines.filter(line => line.episodes.length === 1).map(line => ({ line, episode: line.episodes[0], number: null }));
    } else if (metadata.isCollection) requested = 1;
    else throw fail('网页未提供当前集数，请提供 episode 参数或使用具体分集链接', 'EPISODE_UNDETERMINED', 422);
  }
  const choices = [];
  for (const line of lines) {
    const episode = line.episodes.find(episode => String(episodeNumber(episode.title)) === String(requested));
    if (episode) choices.push({ line, episode, number: requested });
  }
  if (choices.length) return choices;
  throw fail('采集站暂未提供《' + metadata.title + '》第 ' + requested + ' 集/期的可用视频', 'EPISODE_NOT_FOUND');
}

export function availableEpisodes(details) {
  const episodes = new Map();
  for (const detail of details) for (const line of detail.lines) for (const episode of line.episodes) {
    const number = episodeNumber(episode.title);
    if (number && playableMedia.test(episode.url) && !episodes.has(number)) episodes.set(number, { number, title: episode.title });
  }
  return [...episodes.values()].sort((a, b) => a.number - b.number);
}

export function selectEpisode(detail, metadata) { return episodeChoices(detail, metadata)[0]; }
