// "pakd" container (shared with the PSP release) and "xlce" compiled tables.

const PAKD = 0x646B6170; // 'pakd'
const XLCE = 0x65636C78; // 'xlce'

export const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

/**
 * Parse a pakd archive. Entries are views into `data` (no copies), so an
 * entry edited in place without changing its length keeps the archive valid.
 * Tolerates a truncated buffer: entries past the end are cut short.
 */
export function parsePakd(data) {
  const v = view(data);
  if (v.getUint32(0, true) !== PAKD) throw new Error('not a pakd archive');
  const count = v.getUint32(4, true);
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(v.getUint32(8 + i * 4, true));
  const total = v.getUint32(8 + count * 4, true);
  const headerEnd = 8 + count * 4 + 4;
  const idBytes = count ? offsets[0] - headerEnd - 4 : 0;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const id = i * 4 + 4 <= idBytes ? v.getUint32(headerEnd + i * 4, true) : 0;
    const start = offsets[i];
    const end = i + 1 < count ? offsets[i + 1] : total;
    entries.push({ index: i, id, offset: start, data: data.subarray(Math.min(start, data.length), Math.min(end, data.length)) });
  }
  return { count, total, entries };
}

const align16 = (n) => (n + 15) & ~15;

/**
 * Build a pakd with no entry IDs: header aligned to 16, each entry padded to
 * 16 (byte-exact for the game's localize and sound index files).
 */
export function buildPakd(entries) {
  const n = entries.length;
  const header = align16(8 + 4 * n + 4 + 4);
  const sizes = entries.map((e) => align16(e.length));
  const total = header + sizes.reduce((a, b) => a + b, 0);
  const out = new Uint8Array(total);
  const v = view(out);
  v.setUint32(0, PAKD, true);
  v.setUint32(4, n, true);
  let o = header;
  entries.forEach((e, i) => {
    v.setUint32(8 + i * 4, o, true);
    out.set(e, o);
    o += sizes[i];
  });
  v.setUint32(8 + n * 4, total, true);
  return out;
}

/**
 * Build a pakd with entry IDs: offsets, total, IDs and a zero word, header
 * aligned to 16. Entries are written as given, so pass them already padded
 * (entries taken from a parsed archive include their padding). Byte-exact for
 * all 816 event/scene files.
 */
export function buildPakdWithIds(entries) {
  const n = entries.length;
  const header = align16(8 + 4 * n + 4 + 4 * n + 4);
  const sizes = entries.map((e) => align16(e.data.length));
  const total = header + sizes.reduce((a, b) => a + b, 0);
  const out = new Uint8Array(total);
  const v = view(out);
  v.setUint32(0, PAKD, true);
  v.setUint32(4, n, true);
  let o = header;
  entries.forEach((e, i) => {
    v.setUint32(8 + i * 4, o, true);
    v.setUint32(12 + 4 * n + i * 4, e.id, true);
    out.set(e.data, o);
    o += sizes[i];
  });
  v.setUint32(8 + n * 4, total, true);
  return out;
}

export function isXlce(data) {
  return data.length >= 16 && view(data).getUint32(0, true) === XLCE;
}

/** A fixed-row table. `row(i)` returns a live view: writes go straight into the archive bytes. */
export function parseXlce(data) {
  const v = view(data);
  if (v.getUint32(0, true) !== XLCE) throw new Error('not an xlce table');
  const count = v.getUint32(4, true);
  const headerSize = v.getUint32(8, true);
  const rowSize = v.getUint32(12, true);
  return {
    count,
    rowSize,
    row: (i) => data.subarray(headerSize + i * rowSize, headerSize + (i + 1) * rowSize),
  };
}
