// Minimal single-entry ZIP support for Reborn .dat containers.
// Every decrypted .dat is a ZIP holding one deflated file named "pack".

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const LOCAL_SIG = 0x04034B50;
const CENTRAL_SIG = 0x02014B50;
const END_SIG = 0x06054B50;

/** Read the local header of the first entry. Works on truncated buffers. */
export function readLocalHeader(zip) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (v.getUint32(0, true) !== LOCAL_SIG) throw new Error('not a ZIP (bad local header)');
  const nameLength = v.getUint16(26, true);
  const extraLength = v.getUint16(28, true);
  return {
    flags: v.getUint16(6, true),
    method: v.getUint16(8, true),
    crc: v.getUint32(14, true),
    compressedSize: v.getUint32(18, true),
    size: v.getUint32(22, true),
    name: new TextDecoder().decode(zip.subarray(30, 30 + nameLength)),
    dataOffset: 30 + nameLength + extraLength,
  };
}

async function pump(stream, input, maxBytes) {
  // Feed `input` through a (de)compression stream, collecting output.
  // With maxBytes set, stop once enough output exists (input may be truncated).
  const writer = stream.writable.getWriter();
  const writeDone = writer.write(input).then(() => writer.close()).catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (maxBytes && total >= maxBytes) {
        reader.cancel().catch(() => {});
        break;
      }
    }
  } catch (err) {
    if (!maxBytes) throw err; // truncated input is expected when reading a prefix
  }
  await writeDone;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return maxBytes ? out.subarray(0, Math.min(total, maxBytes)) : out;
}

export const inflateRaw = (data, maxBytes = 0) => pump(new DecompressionStream('deflate-raw'), data, maxBytes);
export const deflateRaw = (data) => pump(new CompressionStream('deflate-raw'), data, 0);

/** Extract the single entry; verifies size and CRC when the whole file is present. */
export async function unzipSingle(zip) {
  const h = readLocalHeader(zip);
  const body = zip.subarray(h.dataOffset, h.dataOffset + h.compressedSize);
  let data;
  if (h.method === 8) data = await inflateRaw(body);
  else if (h.method === 0) data = body.slice();
  else throw new Error(`unsupported ZIP method ${h.method}`);
  if (data.length !== h.size) throw new Error('ZIP size mismatch');
  if (crc32(data) !== h.crc) throw new Error('ZIP CRC mismatch');
  return { name: h.name, data };
}

/** Inflate just the first `maxBytes` of the entry from a (possibly truncated) ZIP. */
export async function unzipPrefix(zip, maxBytes) {
  const h = readLocalHeader(zip);
  if (h.method !== 8) throw new Error('prefix read needs a deflated entry');
  return inflateRaw(zip.subarray(h.dataOffset), Math.min(maxBytes, h.size));
}

/**
 * Build a single-entry ZIP laid out exactly like the game's own files:
 * local flags 0, central flags 0x0800, method 8, zero timestamps.
 */
export async function zipSingle(name, data) {
  const nameBytes = new TextEncoder().encode(name);
  const compressed = await deflateRaw(data);
  const crc = crc32(data);
  const localSize = 30 + nameBytes.length + compressed.length;
  const centralSize = 46 + nameBytes.length;
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);

  v.setUint32(0, LOCAL_SIG, true);
  v.setUint16(4, 0x14, true);       // version needed
  v.setUint16(6, 0, true);          // flags
  v.setUint16(8, 8, true);          // deflate
  v.setUint32(10, 0, true);         // time + date
  v.setUint32(14, crc, true);
  v.setUint32(18, compressed.length, true);
  v.setUint32(22, data.length, true);
  v.setUint16(26, nameBytes.length, true);
  v.setUint16(28, 0, true);
  out.set(nameBytes, 30);
  out.set(compressed, 30 + nameBytes.length);

  const c = localSize;
  v.setUint32(c, CENTRAL_SIG, true);
  v.setUint16(c + 4, 0x14, true);   // version made by
  v.setUint16(c + 6, 0x14, true);   // version needed
  v.setUint16(c + 8, 0x0800, true); // flags (UTF-8 names)
  v.setUint16(c + 10, 8, true);
  v.setUint32(c + 12, 0, true);
  v.setUint32(c + 16, crc, true);
  v.setUint32(c + 20, compressed.length, true);
  v.setUint32(c + 24, data.length, true);
  v.setUint16(c + 28, nameBytes.length, true);
  v.setUint16(c + 30, 0, true);     // extra
  v.setUint16(c + 32, 0, true);     // comment
  v.setUint16(c + 34, 0, true);     // disk
  v.setUint16(c + 36, 0, true);     // internal attributes
  v.setUint32(c + 38, 0x20, true);  // external attributes (archive)
  v.setUint32(c + 42, 0, true);     // local header offset
  out.set(nameBytes, c + 46);

  const e = c + centralSize;
  v.setUint32(e, END_SIG, true);
  v.setUint16(e + 4, 0, true);
  v.setUint16(e + 6, 0, true);
  v.setUint16(e + 8, 1, true);
  v.setUint16(e + 10, 1, true);
  v.setUint32(e + 12, centralSize, true);
  v.setUint32(e + 16, localSize, true);
  v.setUint16(e + 20, 0, true);
  return out;
}
