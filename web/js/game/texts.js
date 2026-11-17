// LocalizeText_<lang>.dat: pakd of "txte" tables mapping keys to UTF-8 strings.
// Strings embed control sequences (EF A3 BF <op> <args>); these are stripped.

import { view } from '../lib/pakd.js';
import { loadDat } from './datfile.js';

const TXTE = 0x65747874; // 'txte'

// Size of each control op 0x80.. including the op byte, from Asvel's
// GameTextEncoding (Unlicense).
const OP_SIZES = [
  1, 3, 5, 6, 5, 3, 1, 2, 2, 2, 2, 3, 2, 3, 3, 3,
  3, 1, 1, 1, 1, 4, 1, 1, 3, 3, 2, 1, 3, 2, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 1, 3, 3,
  1, 1, 4, 4, 3, 3,
];

function decodeGameText(bytes) {
  const parts = [];
  let start = 0;
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] === 0xEF && bytes[i + 1] === 0xA3 && bytes[i + 2] === 0xBF && i + 3 < bytes.length) {
      if (i > start) parts.push(bytes.subarray(start, i));
      const op = bytes[i + 3] - 0x80;
      if (op === 0x00 || op === 0x06) parts.push(new Uint8Array([0x20])); // line breaks -> space
      i += 3 + (OP_SIZES[op] ?? 1);
      start = i;
    } else {
      i++;
    }
  }
  if (start < bytes.length) parts.push(bytes.subarray(start));
  const merged = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { merged.set(p, o); o += p.length; }
  return new TextDecoder().decode(merged).trim();
}

function readCString(data, offset) {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return data.subarray(offset, end);
}

export async function loadTexts(lang) {
  const dat = await loadDat(`localize/LocalizeText_${lang}.dat`);
  const texts = new Map();
  const keyDecoder = new TextDecoder();
  for (const entry of dat.pakd.entries) {
    const d = entry.data;
    if (d.length < 16) continue;
    const v = view(d);
    if (v.getUint32(0, true) !== TXTE) continue;
    const count = v.getUint32(4, true);
    const bodyStart = v.getUint32(8, true);
    const entrySize = v.getUint32(12, true);
    for (let i = 0; i < count; i++) {
      const at = bodyStart + i * entrySize;
      const key = keyDecoder.decode(readCString(d, Number(v.getBigUint64(at, true))));
      const value = decodeGameText(readCString(d, Number(v.getBigUint64(at + 8, true))));
      texts.set(key, value);
    }
  }
  return texts;
}

export const LANGUAGES = ['en-us', 'ja-jp', 'fr-fr', 'de-de', 'es-es', 'ko-kr', 'zh-cn', 'zh-tw'];
