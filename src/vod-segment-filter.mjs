// VOD segment filtering shared with Swebersmith/CrayonPlayer.
// Preserve AES sequence state and programme discontinuities when cutting insertions.
function attributes(line) {
  const result = {};
  for (const match of Array.from(
    line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)
  )) {
    result[match[1]] = match[2] ?? match[3];
  }
  return result;
}
function mediaIdentity(uri, baseUrl) {
  let url = new URL(uri, baseUrl);
  for (let depth = 0; depth < 4; depth++) {
    if (!/^\/api\/(?:jiexi|player)\/resolved-media$/.test(url.pathname)) break;
    const original = url.searchParams.get("url");
    if (!original) break;
    const next = new URL(original);
    if (next.protocol !== "https:") break;
    url = next;
  }
  return url;
}
function directory(uri, baseUrl) {
  const url = mediaIdentity(uri, baseUrl);
  return url.origin + url.pathname.slice(0, url.pathname.lastIndexOf("/"));
}
function parsePlaylist(content, baseUrl) {
  if (!/^\uFEFF?#EXTM3U(?:\r?\n|$)/.test(content) || !/^#EXT-X-ENDLIST\s*$/m.test(content) || /^#EXT-X-(?:STREAM-INF|MEDIA|I-FRAMES-ONLY|PART|SKIP|MAP|BYTERANGE|PRELOAD-HINT|SERVER-CONTROL|GAP)(?::|\s*$)/m.test(
    content
  ))
    return null;
  const header = [];
  const footer = [];
  const segments = [];
  let tags = [];
  let duration = 0;
  let start = 0;
  let sequence = 0;
  let discontinuity = 0;
  let initialDiscontinuity = 0;
  let key = "";
  let ended = false;
  for (const original of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    if (ended) {
      if (!line.startsWith("#")) return null;
      footer.push(original);
    } else if (line === "#EXT-X-ENDLIST") {
      if (duration) return null;
      footer.push(...tags, original);
      tags = [];
      ended = true;
    } else if (/^#EXT-X-(?:MEDIA|DISCONTINUITY)-SEQUENCE:/.test(line)) {
      if (segments.length || duration) return null;
      const value = Number(line.slice(line.indexOf(":") + 1));
      if (!Number.isSafeInteger(value) || value < 0) return null;
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) sequence = value;
      else discontinuity = initialDiscontinuity = value;
      header.push(original);
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const attr = attributes(line);
      if (attr.METHOD !== "NONE" && (attr.METHOD !== "AES-128" || !attr.URI || attr.KEYFORMAT && attr.KEYFORMAT !== "identity" || attr.IV && !/^0x[\da-f]{32}$/i.test(attr.IV)))
        return null;
      key = line;
    } else if (line === "#EXT-X-DISCONTINUITY") {
      if (duration) return null;
      discontinuity++;
    } else if (line.startsWith("#EXTINF:")) {
      if (duration) return null;
      duration = Number(line.slice(8).split(",")[0]);
      if (!Number.isFinite(duration) || duration <= 0) return null;
      tags.push(original);
    } else if (!line.startsWith("#")) {
      if (!duration || !Number.isSafeInteger(sequence)) return null;
      try {
        directory(line, baseUrl);
      } catch {
        return null;
      }
      segments.push({
        uri: original,
        duration,
        start,
        sequence,
        discontinuity,
        key,
        tags
      });
      start += duration;
      sequence++;
      duration = 0;
      tags = [];
    } else if (!segments.length && !duration && /^#(?:EXTM3U|EXT-X-(?:VERSION|TARGETDURATION|PLAYLIST-TYPE|INDEPENDENT-SEGMENTS|START))(?::|$)/.test(
      line
    )) {
      header.push(original);
    } else {
      tags.push(original);
    }
  }
  if (!ended || !segments.length || !Number.isFinite(start)) return null;
  const groups = [];
  for (const segment of segments) {
    let group = groups[groups.length - 1];
    if (!group || group.segments[0].discontinuity !== segment.discontinuity) {
      group = {
        segments: [],
        duration: 0,
        directory: directory(segment.uri.trim(), baseUrl),
        explicitAdInsertion: true
      };
      groups.push(group);
    }
    group.segments.push(segment);
    try {
      const path = decodeURIComponent(
        mediaIdentity(segment.uri.trim(), baseUrl).pathname
      );
      group.explicitAdInsertion &&= /(?:^|\/)video\/adjump\/time\/[^/]+\.ts$/i.test(path);
    } catch {
      group.explicitAdInsertion = false;
    }
    group.duration += segment.duration;
    if (group.directory !== directory(segment.uri.trim(), baseUrl))
      group.directory = null;
  }
  return {
    header,
    footer,
    segments,
    groups,
    duration: start,
    initialDiscontinuity
  };
}
const durationKey = (value) => value.toFixed(3);
const frameRates = [
  24,
  25,
  30,
  50,
  60,
  24e3 / 1001,
  3e4 / 1001,
  6e4 / 1001
];
const onFrameGrid = (duration, rate) => Math.abs(duration - Math.round(duration * rate) / rate) <= 51e-5;
function isRuyiInsertion(groups, index, total, baseUrl) {
  const group = groups[index];
  const values = group.segments.map((segment) => segment.duration);
  if (index === 0 || index === groups.length - 1 || group.segments[0].start < 120) return false;
  const remaining = total - group.segments[0].start - group.duration;
  if (remaining < 15) return false;
  const legacyPackage = values.length === 5 && values[4] === 3 || values.length === 6 && values[5] === 1;
  const currentPackage = values.length === 5 && values[4] >= 3.5 && values[4] < 4;
  if (legacyPackage && remaining < 60) return false;
  if (!legacyPackage && !currentPackage || !values.slice(0, -1).every((value) => value === 4)) return false;
  try {
    const url = mediaIdentity(baseUrl, baseUrl);
    if (!/^(?:cdn\d*|svip)\.ryi?play\d+\.com$/i.test(url.hostname) || !/^\/\d{8}\/[^/]+\/2000k\/hls\/index\.m3u8$/.test(url.pathname))
      return false;
    if (!group.segments.every((segment) => {
      const media = mediaIdentity(segment.uri.trim(), url.href);
      return directory(media.href, baseUrl) === directory(baseUrl, baseUrl) && /^[a-f\d]{32}\.ts$/i.test(media.pathname.split("/").pop() || "");
    })) return false;
  } catch {
    return false;
  }
  const neighbors = [groups[index - 1], groups[index + 1]];
  if (!neighbors.every(
    (neighbor) => neighbor.directory === group.directory && neighbor.segments.length >= 4
  )) return false;
  if (legacyPackage) {
    return neighbors.every(
      (neighbor) => neighbor.segments.filter((segment) => segment.duration !== 4).length >= 2
    );
  }
  return neighbors.some((neighbor) => neighbor.segments.length !== values.length) || neighbors.every(
    (neighbor) => neighbor.segments.every((segment) => segment.duration === 4)
  );
}
function detectGroups(groups, total, baseUrl) {
  const removed = /* @__PURE__ */ new Set();
  if (total < 120 || groups.length < 2) return removed;
  const directoryDurations = /* @__PURE__ */ new Map();
  const durations = /* @__PURE__ */ new Map();
  const all = groups.flatMap(
    (group) => group.segments.map((segment) => segment.duration)
  );
  for (const group of groups) {
    if (group.directory !== null)
      directoryDurations.set(
        group.directory,
        (directoryDurations.get(group.directory) || 0) + group.duration
      );
    for (const segment of group.segments) {
      const value = durationKey(segment.duration);
      durations.set(value, (durations.get(value) || 0) + 1);
    }
  }
  const topDirectory = Array.from(directoryDurations).sort(
    (a, b) => b[1] - a[1]
  )[0];
  const mainDirectory = topDirectory && topDirectory[1] >= total * 0.5 ? topDirectory[0] : null;
  const topDuration = Array.from(durations).sort((a, b) => b[1] - a[1])[0];
  const mainDuration = topDuration && topDuration[1] >= all.length * 0.7 ? topDuration[0] : null;
  const fingerprints = /* @__PURE__ */ new Map();
  const isMain = (index) => mainDirectory !== null && groups[index]?.directory === mainDirectory;
  const grid = all.length >= 100 ? frameRates.find(
    (rate) => all.filter((value) => onFrameGrid(value, rate)).length / all.length >= 0.97
  ) : void 0;
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const values = group.segments.map((segment) => segment.duration);
    if (group.duration <= 0 || group.duration > 60 || group.directory === null)
      continue;
    if (isRuyiInsertion(groups, index, total, baseUrl)) removed.add(index);
    if (group.explicitAdInsertion) removed.add(index);
    const keys = values.map(durationKey);
    const mainCount = mainDuration ? keys.filter((value) => value === mainDuration).length : 0;
    const counts = /* @__PURE__ */ new Map();
    keys.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    const repeatedCadence = Math.max(...Array.from(counts.values())) >= Math.max(3, Math.ceil(values.length / 2));
    const differentCadence = !!mainDuration && mainCount === 0 && repeatedCadence;
    const integerCadence = !!mainDuration && !mainDuration.endsWith("000") && keys.every((value) => value !== mainDuration && value.endsWith("000"));
    const uniform = keys.slice(0, -1).every((value) => value === keys[0]);
    const shortTail = values[values.length - 1] < 3 && values[values.length - 1] < values[0];
    const packaged = group.duration <= 30 && values.length >= 7 && values.length <= 9 && uniform && shortTail;
    const mainMinority = !!mainDuration && mainCount > 0 && mainCount * 2 < values.length && values.filter(
      (value) => durationKey(value) !== mainDuration && value >= 0.15
    ).length >= 2;
    if (isMain(index) && (differentCadence || integerCadence || mainMinority || packaged && mainDuration && keys[0] !== mainDuration))
      removed.add(index);
    if (mainDirectory && group.directory !== mainDirectory) {
      if (/(?:^|\/)209\d\/(?:0[1-9]|1[0-2])\/video(?:\/|$)/.test(group.directory))
        removed.add(index);
      if (values.length >= 2 && values.length <= 8 && group.duration >= 3 && group.duration <= 30 && (index === 0 || isMain(index - 1)) && (index === groups.length - 1 || isMain(index + 1)) && mainDuration && mainCount * 2 < values.length) {
        const fingerprint = keys.join(",");
        fingerprints.set(fingerprint, [
          ...fingerprints.get(fingerprint) || [],
          index
        ]);
      }
      if (index === 0 && packaged && mainDuration && mainCount === 0 && groups.slice(1).every((_, i) => isMain(i + 1)))
        removed.add(index);
    }
    if (grid && index > 0 && index < groups.length - 1 && isMain(index) && values.length >= 2 && values.length <= 8 && group.duration >= 3 && group.duration <= 30 && values.filter((value) => !onFrameGrid(value, grid)).length >= 2 && frameRates.some(
      (rate) => rate !== grid && values.every((value) => onFrameGrid(value, rate))
    ) && groups[index - 1].segments.every(
      (segment) => onFrameGrid(segment.duration, grid)
    ) && groups[index + 1].segments.every(
      (segment) => onFrameGrid(segment.duration, grid)
    ))
      removed.add(index);
  }
  fingerprints.forEach((indices) => {
    if (indices.length >= 2) indices.forEach((index) => removed.add(index));
  });
  const removedDuration = Array.from(removed).reduce(
    (sum, index) => sum + groups[index].duration,
    0
  );
  if (removed.size > 5 || removedDuration > total * 0.1 || removed.size === groups.length)
    return /* @__PURE__ */ new Set();
  return removed;
}
function filterVodAdSegments(content, baseUrl = "https://playlist.invalid/index.m3u8") {
  const unchanged = {
    playlist: content,
    originalDuration: 0,
    removed: [],
    reason: "unsupported"
  };
  const parsed = parsePlaylist(content, baseUrl);
  if (!parsed) return unchanged;
  const removedGroups = detectGroups(parsed.groups, parsed.duration, baseUrl);
  if (!removedGroups.size)
    return {
      ...unchanged,
      originalDuration: parsed.duration,
      reason: "no-match"
    };
  const removed = [];
  const excluded = /* @__PURE__ */ new Set();
  for (const index of Array.from(removedGroups)) {
    const group = parsed.groups[index];
    const start = group.segments[0].start;
    removed.push({ start, end: start + group.duration });
    group.segments.forEach((segment) => excluded.add(segment));
  }
  removed.sort((a, b) => a.start - b.start);
  const header = [...parsed.header];
  const versionIndex = header.findIndex(
    (line) => line.startsWith("#EXT-X-VERSION:")
  );
  if (versionIndex < 0) header.push("#EXT-X-VERSION:3");
  else if (Number(header[versionIndex].split(":")[1]) < 2)
    header[versionIndex] = "#EXT-X-VERSION:3";
  const lines = [...header];
  let lastKey = "";
  let lastDiscontinuity = parsed.initialDiscontinuity;
  for (const segment of parsed.segments) {
    if (excluded.has(segment)) continue;
    for (; lastDiscontinuity < segment.discontinuity; lastDiscontinuity++)
      lines.push("#EXT-X-DISCONTINUITY");
    let key = segment.key;
    if (key && attributes(key).METHOD === "AES-128" && !attributes(key).IV) {
      key += `,IV=0x${segment.sequence.toString(16).padStart(32, "0")}`;
    }
    if (key !== lastKey) {
      lines.push(key || "#EXT-X-KEY:METHOD=NONE");
      lastKey = key;
    }
    lines.push(...segment.tags, segment.uri);
  }
  lines.push(...parsed.footer);
  return {
    playlist: lines.join("\n") + "\n",
    originalDuration: parsed.duration,
    removed,
    reason: "filtered"
  };
}
export { filterVodAdSegments };
