import { allowed, upstream } from './parser-resolver.mjs';
import { videoDimensions } from './video-dimensions.mjs';

const fail = message => Object.assign(new Error(message), { status: 502 });
async function bytes(response, limit, strict = false) {
  if (!response.ok) { await response.body?.cancel(); throw fail('采集站媒体返回 HTTP ' + response.status); }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (strict || length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (strict && length + value.length > limit) throw fail('采集站播放清单过大');
      const chunk = value.subarray(0, limit - length); chunks.push(chunk); length += chunk.length;
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function probeCatalogMedia(raw, type = '') {
  const signal = AbortSignal.timeout(8000);
  const original = allowed(raw).href;
  let url = original;
  let advertised = { width: 0, height: 0 };
  if (type === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(url)) {
    let durationSeconds;
    let probeStage = 'playlist';
    try {
      for (let depth = 0; depth < 4; depth++) {
        probeStage = 'playlist';
        const response = await upstream(url, {}, true, signal);
        const manifest = new TextDecoder().decode(await bytes(response, 4 * 1024 * 1024, true));
        if (!manifest.trimStart().startsWith('#EXTM3U')) throw fail('采集站未返回有效 HLS 清单');
        const lines = manifest.split(/\r?\n/).map(line => line.trim());
        const variants = [];
        lines.forEach((line, index) => {
          if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
          const resolution = /RESOLUTION=(\d+)x(\d+)/i.exec(line);
          const uri = lines.slice(index + 1).find(item => item && !item.startsWith('#'));
          if (uri) variants.push({ url: new URL(uri, url).href, width: Number(resolution?.[1] || 0), height: Number(resolution?.[2] || 0), bandwidth: Number(/(?:^|,)BANDWIDTH=(\d+)/.exec(line)?.[1] || 0) });
        });
        if (variants.length) {
          variants.sort((a, b) => b.width * b.height - a.width * a.height || b.bandwidth - a.bandwidth);
          advertised = variants[0]; url = variants[0].url; continue;
        }
        const segment = lines.find(line => line && !line.startsWith('#'));
        if (!segment) throw fail('采集站清单没有视频分片');
        if (lines.includes('#EXT-X-ENDLIST')) {
          const durations = lines.filter(line => line.startsWith('#EXTINF:')).map(line => Number(line.slice(8).split(',')[0]));
          if (durations.length && durations.every(value => Number.isFinite(value) && value > 0)) durationSeconds = durations.reduce((sum, value) => sum + value, 0);
        }
        probeStage = 'segment';
        const range = /#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/.exec(manifest);
        const offset = Number(range?.[2] || 0);
        const size = Math.min(256 * 1024, Number(range?.[1] || 256 * 1024));
        const started = Date.now();
        const media = await upstream(new URL(segment, url).href, { Range: 'bytes=' + offset + '-' + (offset + size - 1) }, true, signal);
        const latencyMs = Math.max(1, Date.now() - started);
        let dimensions = videoDimensions(await bytes(media, size));
        const map = /#EXT-X-MAP:.*?URI="([^"]+)"/.exec(manifest);
        if (!dimensions.width && map) dimensions = videoDimensions(await bytes(await upstream(new URL(map[1], url).href, { Range: 'bytes=0-262143' }, true, signal), 256 * 1024));
        const quality = dimensions.width ? { ...dimensions, source: 'video' } : { width: advertised.width, height: advertised.height, source: advertised.width ? 'manifest' : 'unknown' };
        return { url: original, type: 'm3u8', latencyMs, durationSeconds, quality: { ...quality, label: quality.width ? quality.width + '×' + quality.height : '清晰度未知' } };
      }
      throw fail('播放清单嵌套过深');
    } catch (err) {
      throw Object.assign(err, { probeStage, ...(durationSeconds ? { durationSeconds } : {}) });
    }
  }
  const started = Date.now();
  const response = await upstream(url, { Range: 'bytes=0-262143' }, true, signal);
  const latencyMs = Math.max(1, Date.now() - started);
  const sample = await bytes(response, 256 * 1024);
  if (new TextDecoder().decode(sample.subarray(0, 64)).trimStart().startsWith('#EXTM3U')) return probeCatalogMedia(raw, 'm3u8');
  const mp4 = sample.length >= 8 && String.fromCharCode(...sample.subarray(4, 8)) === 'ftyp';
  const webm = sample.length >= 4 && sample[0] === 0x1a && sample[1] === 0x45 && sample[2] === 0xdf && sample[3] === 0xa3;
  if (!mp4 && !webm) throw fail('采集站未返回有效视频文件');
  const size = videoDimensions(sample);
  return { url, type: webm ? 'webm' : 'mp4', latencyMs, quality: { ...size, source: size.width ? 'video' : 'unknown', label: size.width ? size.width + '×' + size.height : '清晰度未知' } };
}

// Compare the same episode only. A fourfold difference is enough to require
// review. Smaller differences require corroboration from two other sources.
export function durationOutliers(observations) {
  const measured = observations.filter(value => Number.isFinite(value.durationSeconds) && value.durationSeconds > 0);
  const outliers = new Map();
  for (const candidate of measured) {
    const longer = measured.filter(value => value.sourceId !== candidate.sourceId && value.url !== candidate.url
      && value.durationSeconds > candidate.durationSeconds * 2 && value.durationSeconds - candidate.durationSeconds >= 300);
    for (const reference of longer) {
      const peers = longer.filter(value => value.durationSeconds >= reference.durationSeconds && value.durationSeconds <= reference.durationSeconds * 1.15);
      const corroborated = new Set(peers.map(value => value.sourceId)).size >= 2 && new Set(peers.map(value => value.url)).size >= 2;
      if (!corroborated && reference.durationSeconds < candidate.durationSeconds * 4) continue;
      const expectedDurationSeconds = peers.reduce((sum, value) => sum + value.durationSeconds, 0) / peers.length;
      outliers.set(candidate.url, { durationSeconds: candidate.durationSeconds, expectedDurationSeconds });
      break;
    }
  }
  return outliers;
}

export function sortRoutes(routes) {
  return routes.sort((a, b) => b.quality.width * b.quality.height - a.quality.width * a.quality.height || a.latencyMs - b.latencyMs);
}
