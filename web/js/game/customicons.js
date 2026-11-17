import { artFiles, scanArt } from './artassets.js';
import { renameBTX } from './artregistry.js';
import { patchTextureData, rgbaAsset } from './artcolour.js';
import { unpackArt } from '../lib/artrebuild.js';
import { decodeEncodedBC7, rebuildTexturePixels } from '../lib/bc7encode.js';
import { readRGBAPNG } from '../lib/pngrgba.js';
import { sha256 } from '../lib/artfiles.js';
import { view } from '../lib/pakd.js';
import { source } from './source.js';

export const ICON_BANKS = {
  spell_icon: { label: 'Spell', category: 'spells', prefix: 'icon_spell_', type: 1 },
  skill_icon: { label: 'Ability', category: 'skills', prefix: 'icon_skill_', type: 2 },
  finishblow_icon: { label: 'Finisher', category: 'finishers', prefix: 'icon_finishblow_', type: 3 },
  itemicon: { label: 'Item or equipment', category: 'items', prefix: 'item_icon_', type: 0 },
};
const LANGUAGES = ['de-de', 'en-us', 'es-es', 'fr-fr', 'ja-jp', 'ko-kr', 'zh-cn', 'zh-tw'];
const FIRST = 2000, LAST = 9999, SIZE = 64;
export const iconArchivePath = bank => `menu/texture_x4/${bank}.dat`;
export const iconName = (bank, id) => ICON_BANKS[bank].prefix + String(id).padStart(4, '0') + (bank === 'itemicon' ? '_00' : '');
export const effectBank = type => ['','spell_icon','skill_icon','finishblow_icon'][type];
export const inventoryIconOffsets = kind => kind === 'armament' ? [0x70, 0x73] : [0x16, 0x18];
export const isCustomIconId = id => id >= FIRST && id <= LAST;

function defaultEffectBank(type) {
  if (type >= 22 && type <= 43) return 'finishblow_icon';
  if (type === 18 || type === 19) return 'skill_icon';
  if ((type >= 1 && type <= 13) || type === 16) return 'spell_icon';
  return null;
}

export function customIconBinding(kind, row) {
  if (kind === 'effect') {
    const bank = effectBank(row[0xac]) || defaultEffectBank(row[2]);
    return bank ? { bank, id: view(row).getUint16(0xaa, true), bankMatches: row[0xac] === ICON_BANKS[bank].type } : null;
  }
  if (kind !== 'armament' && kind !== 'commodity') return null;
  const [offset, palette] = inventoryIconOffsets(kind);
  return { bank: 'itemicon', id: view(row).getUint16(offset, true), bankMatches: row[palette] === 0 };
}

export function writeCustomIcon(kind, row, bank, id) {
  if (!row[2] || !isCustomIconId(id) || customIconBinding(kind, row)?.bank !== bank) return false;
  if (kind === 'effect') {
    view(row).setUint16(0xaa, id, true);
    row[0xac] = ICON_BANKS[bank].type;
  } else {
    const [offset, palette] = inventoryIconOffsets(kind);
    view(row).setUint16(offset, id, true);
    row[palette] = 0;
  }
  return true;
}

export async function newIconPlan({ bank, label, png, known = [], tables, progress = () => {} }) {
  if (!Object.hasOwn(ICON_BANKS, bank)) throw new Error('Choose the type of icon to add');
  label = label.trim();
  if (!label || label.length > 80) throw new Error('Enter a name for this icon (up to 80 characters)');
  const path = iconArchivePath(bank), spec = ICON_BANKS[bank];
  const { rgba } = await readRGBAPNG(png, { width: SIZE, height: SIZE });
  progress('Checking available icon slots…');
  const { bytes } = await source.read(path);
  const assets = scanArt((await unpackArt(bytes)).pack, path).assets;
  const used = new Set(known.filter(r => r.bank === bank).map(r => r.id));
  const pattern = new RegExp(`^${spec.prefix}(\\d{4})${bank === 'itemicon' ? '_\\d{2}' : ''}$`);
  const mark = textures => {
    for (const texture of textures) {
      const match = pattern.exec(texture.name);
      if (match) used.add(Number(match[1]));
    }
  };
  mark(assets);
  const localized = bank === 'finishblow_icon' ? [] : await Promise.all(LANGUAGES.map(lang => artFiles(spec.category, lang)));
  for (const file of localized.flat().filter(file => file.path !== path)) {
    const { bytes: override } = await source.read(file.path);
    mark(scanArt((await unpackArt(override)).pack, file.path).assets);
  }
  for (const kind of bank === 'itemicon' ? ['armament', 'commodity'] : ['effect']) {
    const table = tables?.[kind];
    for (let i = 1; i < (table?.count ?? 0); i++) {
      const row = table.row(i);
      if (!row[2]) continue;
      const binding = customIconBinding(kind, row);
      if (binding?.bank === bank) used.add(binding.id);
    }
  }
  const donor = assets.find(a => pattern.test(a.name) && a.width === SIZE && a.height === SIZE && a.format === 13
    && a.raw.length === 4176 && a.raw[18] === 0 && view(a.raw).getUint32(24, true) === 80);
  if (!donor) throw new Error('This archive has no compatible 64 × 64 native icon');
  let id = FIRST;
  while (used.has(id)) id++;
  if (id > LAST) throw new Error('This icon archive has no free slots');

  const name = iconName(bank, id);
  // Force all blocks to be encoded from the PNG. The donor supplies only the native header.
  const original = rgba.slice();
  for (let i = 3; i < original.length; i += 4) original[i] ^= 255;
  const encoded = await rebuildTexturePixels(donor, original, rgba, progress, new Map());
  const texture = renameBTX(patchTextureData(donor.raw, encoded.data), name);
  const [after] = scanArt(texture, path).assets;
  if (!after || after.name !== name || after.texture.data.some((byte, i) => byte !== encoded.data[i])) {
    throw new Error('Rebuilt icon failed verification');
  }
  const actual = new Uint8Array(rgba.length);
  for (let y = 0; y < SIZE; y += 4) {
    for (let x = 0; x < SIZE; x += 4) {
      const offset = (y/4)*after.texture.stride + (x/4)*16;
      const block = decodeEncodedBC7(after.texture.data.subarray(offset, offset+16));
      for (const [i, pixel] of block.entries()) {
        const at = ((y + (i >> 2))*SIZE + x + (i & 3))*4;
        const alpha = rgba[at+3];
        if ((alpha === 0 || alpha === 255) && pixel[3] !== alpha) {
          throw new Error('Rebuilt icon changed its opaque or transparent pixels');
        }
        actual.set(pixel, at);
      }
    }
  }
  return {
    title: `Add ${spec.label.toLowerCase()} icon`,
    summary: `${label} · slot #${id} · ${name}`,
    notes: ['The shared archive supplies this icon in every language.', 'Pick this icon by name in Stats & Values after saving the import.',
      'Review the preview for colour changes from the game’s BC7 compression.'],
    imported: rgbaAsset(SIZE, SIZE, rgba), after: rgbaAsset(SIZE, SIZE, actual, name),
    files: [],
    icon: { bank, id, label, texture, expectedSHA256: await sha256(bytes) },
  };
}
