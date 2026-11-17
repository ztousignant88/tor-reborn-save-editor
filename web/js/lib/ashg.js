import {crc32} from './zip.js';
// "ashg" compression (LZ with literal runs), port of Gibbed's RLE.cs (zlib).
// Header: 'ashg', u32 compressed size, u32 uncompressed size, u8 version,
// u8 window bits (low 5), u8 CRC32 low byte, u8 reserved; data from +16.

export const isAshg = (d) => d.length >= 16 && d[0] === 0x61 && d[1] === 0x73 && d[2] === 0x68 && d[3] === 0x67;

// Version 2 uses 1–127 byte literal runs and two-byte overlapping LZ matches.
// Literal-only streams decode correctly but can exceed native fixed-size caches.
export function compressAshg(bytes, {window = 7, template = null} = {}) {
  if (!Number.isInteger(window) || window < 1 || window > 15) throw new Error('Unsupported ASHG window');
  const out = new Uint8Array(16 + bytes.length + Math.ceil(bytes.length / 127) + 15);
  if (template) out.set(template.subarray(0, 16));
  out.set([97, 115, 104, 103]);
  const v = new DataView(out.buffer), previous = new Int32Array(bytes.length), heads = new Map();
  const distanceLimit = 1 << window, lengthLimit = 3 + (32767 >> window);
  let at = 0, written = 16, literalStart = 0, literalLength = 0;
  const key = p => bytes[p] * 65536 + bytes[p + 1] * 256 + bytes[p + 2];
  const insert = p => { if (p + 2 < bytes.length) { const k = key(p); previous[p] = heads.get(k) ?? -1; heads.set(k, p); } };
  const flush = () => { if (literalLength) { out[written++] = literalLength; out.set(bytes.subarray(literalStart, literalStart + literalLength), written); written += literalLength; literalLength = 0; } };
  while (at < bytes.length) {
    let best = 0, distance = 0;
    const limit = Math.min(lengthLimit, bytes.length - at), oldest = Math.max(0, at - distanceLimit);
    if (limit >= 3) for (let p = heads.get(key(at)) ?? -1; p >= oldest; p = previous[p]) {
      if (best >= 3 && bytes[p + best] !== bytes[at + best]) continue;
      let n = 3;
      while (n < limit && bytes[p + n] === bytes[at + n]) n++;
      if (n > best) { best = n; distance = at - p; }
      if (best === limit) break;
    }
    let length = 1;
    if (best >= 3) {
      flush();
      const value = ((best - 3) << window) | (distance - 1);
      out[written++] = 128 | (value >> 8); out[written++] = value & 255;
      length = best;
    } else {
      if (!literalLength) literalStart = at;
      if (++literalLength === 127) flush();
    }
    for (let p = at; p < at + length; p++) insert(p);
    at += length;
  }
  flush();
  v.setUint32(4, written, true); v.setUint32(8, bytes.length, true);
  out[12] = 2; out[13] = (out[13] & 224) | window; out[14] = crc32(bytes) & 255;
  return out.slice(0, (written + 15) & ~15);
}

export function decompressAshg(input, { verifyChecksum = false } = {}) {
  const v = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const size = v.getUint32(8, true);
  const version = input[12];
  const window = input[13] & 0x1F;
  if (version === 0) { const out = input.slice(16, 16 + size); if (verifyChecksum && (out.length !== size || (crc32(out) & 255) !== input[14])) throw new Error('ASHG resource checksum failed'); return out; }
  if (version !== 2) throw new Error(`unsupported ashg version ${version}`);
  const out = new Uint8Array(size);
  const mask = (1 << window) - 1;
  let i = 16, o = 0;
  while (o < size) {
    const op = input[i++];
    if ((op & 0x80) === 0) {
      out.set(input.subarray(i, i + op), o);
      i += op;
      o += op;
    } else {
      const value = ((op & 0x7F) << 8) | input[i++];
      const offset = 1 + (value & mask);
      const length = 3 + (value >> window);
      for (let k = 0; k < length; k++, o++) out[o] = out[o - offset];
    }
  }
  if (verifyChecksum && (crc32(out) & 255) !== input[14]) throw new Error('ASHG resource checksum failed');
  return out;
}
