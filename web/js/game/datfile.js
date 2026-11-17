// Load and save Reborn .dat files: decrypt -> unzip "pack" -> pakd, and back.

import { decrypt, encrypt } from '../lib/crypt.js';
import { unzipSingle, zipSingle } from '../lib/zip.js';
import { parsePakd } from '../lib/pakd.js';
import { source } from './source.js';

export async function loadDat(path) {
  const { bytes, scope, revision, view } = await source.read(path, undefined, true);
  const { name, data } = await unzipSingle(decrypt(bytes));
  if (!/(^|\.)pack$/.test(name)) throw new Error(`${path}: unexpected entry "${name}"`);
  return { path, originalSize: bytes.length, scope, revision, view, entryName: name, pack: data, pakd: parsePakd(data) };
}

/** Re-encode a (possibly edited) pack into .dat bytes ready to write. */
export async function encodeDat(pack, entryName = 'pack') {
  return encrypt(await zipSingle(entryName, pack));
}
