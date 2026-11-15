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
    for (let depth = 0; depth < 4; depth++) {
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
      return { url: original, type: 'm3u8', latencyMs, quality: { ...quality, label: quality.width ? quality.width + '×' + quality.height : '清晰度未知' } };
    }
    throw fail('播放清单嵌套过深');
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

export function sortRoutes(routes) {
  return routes.sort((a, b) => b.quality.width * b.quality.height - a.quality.width * a.quality.height || a.latencyMs - b.latencyMs);
}
