import { abilityIcon, itemIcon } from '../game/icons.js';
import { view } from '../lib/pakd.js';
import { textureCanvas } from './texcanvas.js';

export function missingIcon(scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.max(16, Math.round(32 * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(canvas.width / 32, canvas.height / 32);
  ctx.fillStyle = '#424b5a';
  ctx.fillRect(2, 2, 28, 28);
  ctx.fillStyle = '#d7dce3';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('?', 16, 24);
  canvas.title = 'No native artwork for this entry.';
  return canvas;
}

export async function itemArt(kind, row, lang, scale = 0.5) {
  if (!row?.[2]) return missingIcon(scale);
  const [iconAt, paletteAt] = kind === 'armament' ? [0x70, 0x73] : [0x16, 0x18];
  try {
    const art = await itemIcon(view(row).getUint16(iconAt, true), row[paletteAt], lang);
    const canvas = art.texture && textureCanvas(art.texture, scale);
    if (canvas) {
      if (art.missing) canvas.title = 'Using the game’s unknown-item icon.';
      return canvas;
    }
  } catch (error) {
    console.warn('Item artwork:', error.message);
  }
  return missingIcon(scale);
}

export function itemOptionArt(tables, id, lang) {
  const record = tables.itemRecord(id);
  return record ? itemArt(record.kind, record.row, lang) : missingIcon(0.5);
}

export async function abilityArt(kind, id, tables, lang, scale = 0.5) {
  try {
    const texture = await abilityIcon(kind, id, tables, lang);
    if (texture) {
      const canvas = textureCanvas(texture, scale);
      if (canvas) return canvas;
    }
  } catch (error) {
    console.warn('Ability artwork:', error.message);
  }
  return missingIcon(scale);
}
