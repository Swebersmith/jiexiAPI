function bits(data) {
  const bytes = [];
  for (let index = 0; index < data.length; index++) {
    if (index >= 2 && data[index] === 3 && data[index - 1] === 0 && data[index - 2] === 0) continue;
    bytes.push(data[index]);
  }
  let position = 0;
  const read = count => {
    if (position + count > bytes.length * 8) throw new Error('Incomplete video header');
    let value = 0;
    for (let index = 0; index < count; index++, position++) value = value * 2 + ((bytes[position >> 3] >> (7 - (position & 7))) & 1);
    return value;
  };
  const skip = count => { while (count > 0) { const size = Math.min(count, 24); read(size); count -= size; } };
  const unsigned = () => {
    let zeros = 0;
    while (read(1) === 0) { if (++zeros > 30) throw new Error('Invalid video header'); }
    return 2 ** zeros - 1 + read(zeros);
  };
  const signed = () => { const value = unsigned(); return value & 1 ? (value + 1) / 2 : -value / 2; };
  return { read, skip, unsigned, signed };
}

function avcDimensions(data) {
  const b = bits(data);
  const profile = b.read(8); b.skip(16); b.unsigned();
  let chroma = 1, separate = 0;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = b.unsigned();
    if (chroma === 3) separate = b.read(1);
    b.unsigned(); b.unsigned(); b.skip(1);
    if (b.read(1)) {
      for (let index = 0; index < (chroma === 3 ? 12 : 8); index++) {
        if (!b.read(1)) continue;
        let last = 8, next = 8;
        for (let entry = 0; entry < (index < 6 ? 16 : 64); entry++) {
          if (next) next = (last + b.signed() + 256) % 256;
          last = next || last;
        }
      }
    }
  }
  b.unsigned();
  const order = b.unsigned();
  if (order === 0) b.unsigned();
  if (order === 1) {
    b.skip(1); b.signed(); b.signed();
    const count = b.unsigned();
    if (count > 255) throw new Error('Invalid reference frame count');
    for (let index = 0; index < count; index++) b.signed();
  }
  b.unsigned(); b.skip(1);
  const columns = b.unsigned() + 1, rows = b.unsigned() + 1;
  const frameOnly = b.read(1);
  if (!frameOnly) b.skip(1);
  b.skip(1);
  let left = 0, right = 0, top = 0, bottom = 0;
  if (b.read(1)) { left = b.unsigned(); right = b.unsigned(); top = b.unsigned(); bottom = b.unsigned(); }
  const arrayType = separate ? 0 : chroma;
  const cropX = arrayType === 1 || arrayType === 2 ? 2 : 1;
  const cropY = (arrayType === 1 ? 2 : 1) * (2 - frameOnly);
  return { width: columns * 16 - (left + right) * cropX, height: rows * 16 * (2 - frameOnly) - (top + bottom) * cropY };
}

function hevcDimensions(data) {
  const b = bits(data);
  b.skip(4); const layers = b.read(3); b.skip(1); b.skip(96);
  const profiles = [], levels = [];
  for (let index = 0; index < layers; index++) { profiles.push(b.read(1)); levels.push(b.read(1)); }
  if (layers) b.skip((8 - layers) * 2);
  for (let index = 0; index < layers; index++) { if (profiles[index]) b.skip(88); if (levels[index]) b.skip(8); }
  b.unsigned(); const chroma = b.unsigned();
  const separate = chroma === 3 ? b.read(1) : 0;
  let width = b.unsigned(), height = b.unsigned();
  if (b.read(1)) {
    const left = b.unsigned(), right = b.unsigned(), top = b.unsigned(), bottom = b.unsigned();
    width -= (left + right) * (!separate && (chroma === 1 || chroma === 2) ? 2 : 1);
    height -= (top + bottom) * (!separate && chroma === 1 ? 2 : 1);
  }
  return { width, height };
}

function elementaryStream(data) {
  let sync = -1;
  for (let index = 0; index < Math.min(188, data.length - 376); index++) {
    if (data[index] === 0x47 && data[index + 188] === 0x47 && data[index + 376] === 0x47) { sync = index; break; }
  }
  if (sync < 0) return data;
  const chunks = [];
  let videoPid = -1, length = 0;
  for (let offset = sync; offset + 188 <= data.length; offset += 188) {
    const pid = ((data[offset + 1] & 31) << 8) | data[offset + 2];
    const control = (data[offset + 3] >> 4) & 3;
    if (!(control & 1)) continue;
    let start = offset + 4;
    if (control & 2) start += 1 + data[start];
    if (start >= offset + 188) continue;
    if (data[offset + 1] & 64) {
      if (data[start] !== 0 || data[start + 1] !== 0 || data[start + 2] !== 1 || (data[start + 3] & 0xf0) !== 0xe0) continue;
      videoPid = pid;
      start += 9 + data[start + 8];
    }
    if (pid !== videoPid || start >= offset + 188) continue;
    const chunk = data.subarray(start, offset + 188); chunks.push(chunk); length += chunk.length;
  }
  const stream = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { stream.set(chunk, position); position += chunk.length; }
  return stream;
}

function valid(size) { return size.width >= 16 && size.width <= 16384 && size.height >= 16 && size.height <= 16384; }

export function videoDimensions(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let index = 4; index + 36 <= data.length; index++) {
    if (![0x61, 0x68, 0x76, 0x74].includes(data[index])) continue;
    const tag = String.fromCharCode(...data.subarray(index, index + 4));
    if (['avc1', 'hvc1', 'hev1', 'av01', 'vp09'].includes(tag)) {
      const size = { width: view.getUint16(index + 28), height: view.getUint16(index + 30) };
      if (valid(size)) return size;
    }
    if (tag === 'tkhd') {
      const end = index - 4 + view.getUint32(index - 4);
      if (end <= data.length && end > index + 72) {
        const size = { width: view.getUint16(end - 8), height: view.getUint16(end - 4) };
        if (valid(size)) return size;
      }
    }
  }
  const stream = elementaryStream(data);
  for (let index = 0; index + 5 < stream.length; index++) {
    if (stream[index] !== 0 || stream[index + 1] !== 0 || stream[index + 2] !== 1) continue;
    const header = index + 3;
    let end = stream.length;
    for (let cursor = header + 2; cursor + 3 < stream.length; cursor++) {
      if (stream[cursor] === 0 && stream[cursor + 1] === 0 && stream[cursor + 2] === 1) { end = cursor; break; }
    }
    try {
      let size;
      if ((stream[header] & 31) === 7) size = avcDimensions(stream.subarray(header + 1, end));
      else if (((stream[header] >> 1) & 63) === 33) size = hevcDimensions(stream.subarray(header + 2, end));
      if (size && valid(size)) return size;
    } catch { /* A short or encrypted sample has no readable dimensions. */ }
  }
  return { width: 0, height: 0 };
}
