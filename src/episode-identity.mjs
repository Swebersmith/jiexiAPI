import { chineseNumber, decodeText, episodeNumber } from './page-metadata.mjs';

const variants = /加更|沉浸|抢鲜|抢先|超前|预告|先导|花絮|番外|特辑|纯享|会员|陪看|精编|加料|彩蛋|衍生|收官|庆功|未播|幕后/gu;
const issuePattern = /第\s*([\d零〇一二两三四五六七八九十百千]+)\s*[集话期回]/;

/** Episode identity follows the label, including parts and alternate editions. */
export function episodeIdentity(label) {
  const original = decodeText(label).normalize('NFKC').toLowerCase();
  let rest = original;
  const dateMatch = /(?<!\d)(20\d{2})(?:[-./年](\d{1,2})[-./月](\d{1,2})日?|(\d{2})(\d{2}))(?!\d)/.exec(rest);
  let date = '';
  if (dateMatch) {
    const year = Number(dateMatch[1]), month = Number(dateMatch[2] || dateMatch[4]), day = Number(dateMatch[3] || dateMatch[5]);
    const value = new Date(Date.UTC(year, month - 1, day));
    if (value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day) {
      date = String(year) + String(month).padStart(2, '0') + String(day).padStart(2, '0');
      rest = rest.replace(dateMatch[0], '');
    }
  }
  const edition = [...new Set(rest.match(variants) || [])].sort().join('+') || '正片';
  rest = rest.replace(variants, '').replace(/完整版|正片|版/gu, '');
  const issue = issuePattern.exec(rest) || /\b(?:ep|episode)\s*(\d{1,4})\b/i.exec(rest);
  let number = issue ? chineseNumber(issue[1]) : undefined;
  if (issue) rest = rest.replace(issue[0], '');
  // The date itself can be wrapped as 第20261029期.
  rest = rest.replace(/第\s*期/gu, '');
  const numberedPart = date && /^\s*[-_：:]\s*(\d{1,3})\s*$/.exec(rest);
  if (numberedPart) { number = Number(numberedPart[1]); rest = ''; }
  rest = rest.replace(/[\s\p{P}\p{S}]/gu, '').replace(/([上中下])半(?:部分|场|期|集)?$/u, '$1').replace(/([上中下])(?:集|期|篇|部)$/u, '$1');
  const part = /^[上中下]{1,3}$/u.test(rest) ? rest : '';
  if (part) rest = '';
  if (!date && number === undefined) number = episodeNumber(original);
  if (!date && number !== undefined && /^\d+$/.test(rest)) rest = '';
  // A date plus an explicit upper/lower part is shared across source-specific
  // issue numbering. A plain date with two numbered issues retains that number.
  const identity = date ? 'date:' + date : number !== undefined ? 'number:' + number : 'title:' + original.replace(/[\s\p{P}\p{S}]/gu, '');
  const key = [identity, edition, part || '全', date && !part && number !== undefined ? String(number) : '', rest].join('|');
  return { key, number: date ? Number(date) : number > 0 ? number : undefined, issue: number };
}

export function lineEpisodeIdentities(line) {
  const entries = line.episodes.map(episode => ({ episode, identity: episodeIdentity(episode.title) }));
  const issues = new Map();
  for (const { identity } of entries) {
    if (identity.issue === undefined) continue;
    if (!issues.has(identity.key)) issues.set(identity.key, new Set());
    issues.get(identity.key).add(identity.issue);
  }
  // Two numbered issues on the same date can each have an upper/lower part.
  // Preserve both when a catalogue provides evidence of that distinction.
  for (const entry of entries) if (issues.get(entry.identity.key)?.size > 1)
    entry.identity = { ...entry.identity, key: entry.identity.key + '|issue:' + (entry.identity.issue ?? 'unknown') };
  return entries;
}

export function episodeReference(detail, line, episode) {
  return { id: detail.id, line: line.id, lineName: line.name, episode: episode.id, title: episode.title };
}
