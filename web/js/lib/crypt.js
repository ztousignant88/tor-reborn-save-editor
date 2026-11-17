// Reborn ".dat" obfuscation. Port of Gibbed.Reborn DataBogoCrypt
// (zlib license, (c) Rick 'gibbed'): XOR with two fixed tables, then the
// whole buffer is rotated 3 bits as one bit stream. Length is preserved.

const TABLE2 = new Uint8Array([
  0xB0, 0xBC, 0x6D, 0x19, 0xE5, 0x14, 0xB6, 0xEA, 0xF4, 0xCB, 0x16, 0xB1, 0x7D, 0xE5, 0x7F, 0xB5,
  0x0B, 0x7C, 0x5E, 0xC4, 0x2D, 0x4F, 0x31, 0x99, 0x67, 0x98, 0x19, 0xE8, 0x28, 0x58, 0xDE, 0xC9,
  0xC1, 0x9B, 0xC9, 0x83, 0x34, 0xC4, 0x64, 0x85, 0x36, 0xFA, 0x0E, 0xDE, 0xFB, 0xE7, 0x68, 0x99,
  0x71, 0x32, 0x34, 0x36, 0xE5, 0x01, 0x7D, 0x63, 0x5C, 0x81, 0x77, 0x7C,
]);
const TABLE3 = new Uint8Array([
  0xC6, 0x53, 0x98, 0xED, 0xD0, 0xAA, 0xE0, 0x1B, 0x43, 0x31, 0x16, 0x32, 0xCE, 0x0D, 0x52, 0x57,
  0x7B, 0x72, 0x0F, 0xFB, 0xB7, 0xA9, 0xC6, 0xF1, 0xF1, 0x72, 0x2C, 0x89, 0x5F, 0xB2, 0x1B, 0xFA,
  0xA8, 0xDB, 0xE3, 0xE2, 0x41, 0xB5, 0xBE, 0xC9, 0x5D, 0xAE, 0xC6, 0x21, 0xE4, 0xD2, 0x88, 0x74,
  0x97, 0x26, 0x4F, 0x87, 0x7A, 0xF0, 0x69, 0x7A, 0xB7, 0x7E, 0x15, 0x09, 0xBA, 0x55, 0xAD, 0xCA,
  0xB1, 0x60, 0x34, 0x76,
]);

function xorWithTable(bytes, offset, count, table, seed) {
  const tableLength = table.length >> 2;
  let tableIndex = seed;
  for (let i = 0, o = offset; i + 4 <= count; i += 4, o += 4) {
    tableIndex %= tableLength;
    const t = tableIndex * 4;
    tableIndex++;
    bytes[o] ^= table[t];
    bytes[o + 1] ^= table[t + 1];
    bytes[o + 2] ^= table[t + 2];
    bytes[o + 3] ^= table[t + 3];
  }
}

// Rotate the buffer left by 3 bits. `wrap` is the byte that follows the
// last one (the first byte for a full buffer, the next byte for a prefix).
function deshift(src, n, wrap) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n - 1; i++) out[i] = ((src[i] << 3) | (src[i + 1] >> 5)) & 0xFF;
  out[n - 1] = ((src[n - 1] << 3) | (wrap >> 5)) & 0xFF;
  return out;
}

function enshift(src) {
  const n = src.length;
  const out = new Uint8Array(n);
  for (let i = n - 1; i > 0; i--) out[i] = ((src[i - 1] << 5) | (src[i] >> 3)) & 0xFF;
  out[0] = ((src[n - 1] << 5) | (src[0] >> 3)) & 0xFF;
  return out;
}

function unmask(buf) {
  xorWithTable(buf, 0, buf.length, TABLE2, 8);
  xorWithTable(buf, 16, buf.length - 16, TABLE3, buf[15] & 0x7F);
  return buf;
}

export function decrypt(data) {
  if (data.length < 16) throw new Error('file too small to be a Reborn .dat');
  return unmask(deshift(data, data.length, data[0]));
}

/** Decrypt only the first `n` bytes; the cipher is local apart from the final wrap. */
export function decryptPrefix(data, n) {
  if (n >= data.length) return decrypt(data);
  // The XOR passes work in whole dwords, so a dword-aligned prefix decrypts exactly.
  n -= n % 4;
  return unmask(deshift(data, n, data[n]));
}

export function encrypt(plain) {
  if (plain.length < 16) throw new Error('data too small to encrypt');
  const buf = plain.slice();
  xorWithTable(buf, 16, buf.length - 16, TABLE3, buf[15] & 0x7F);
  xorWithTable(buf, 0, buf.length, TABLE2, 8);
  return enshift(buf);
}
