// Scene-specific actor actions: IDX0 type 2 -> 0x12000 + resource ID.
// Each package contains its own indexed atlas and SAS3 sequence, not a
// walking animation number. Original names come from the aura/mask textures.
import { parsePakd, view } from '../lib/pakd.js';
import { decompressAshg, isAshg } from '../lib/ashg.js';
import { readIndexSheet } from './unitsprites.js';
import { DEFAULT_PALETTE } from './palette.js';

export function animationIndex(bytes) {
  if (!bytes) return [];
  const v = view(bytes);
  if (v.getUint32(0, true) !== 0x30584449) throw new Error('expected scene resource index');
  for (let i = 0; i < v.getUint16(4, true); i++) {
    const o = v.getUint32(8 + i * 4, true);
    if (v.getUint16(o, true) === 2) return Array.from({ length: v.getUint16(o + 2, true) }, (_, j) => v.getUint16(o + 4 + j * 2, true));
  }
  return [];
}

export function parseActionSequence(bytes, { battle = false } = {}) {
  const v = view(bytes), range = (o, n) => { if (o < 0 || n < 0 || o + n > bytes.length) throw new Error('truncated scene animation'); };
  range(0, 16);
  if (v.getUint32(0, true) !== 0x33534153) throw new Error('expected Reborn SAS3 action');
  const ft = v.getUint32(8, true), count = v.getUint32(12, true);
  range(16, count * 4); range(ft, 4);
  const frameCount = v.getUint32(ft, true); range(ft + 4, frameCount * 4);
  const frames = Array.from({ length: frameCount }, (_, i) => {
    const o = v.getUint32(ft + 4 + i * 4, true); range(o, 6);
    const sheet = bytes[o], n = bytes[o + 1]; range(o + 6, n * 12);
    return { sheet, cells: Array.from({ length: n }, (_, j) => {
      const p = o + 6 + j * 12;
      return { x: v.getInt16(p, true), y: v.getInt16(p + 2, true), width: v.getUint16(p + 4, true), height: v.getUint16(p + 6, true), u: v.getUint16(p + 8, true), v: v.getUint16(p + 10, true) };
    }) };
  });
  const slots = Array.from({ length: count }, (_, i) => {
    const flags = v.getUint32(16 + i * 4, true);
    if (flags < 2) return null;
    const o = flags >>> 1; range(o, 4); const n = bytes[o]; range(o + 4, n * 14);
    const commands = Array.from({ length: n }, (_, j) => {
      const p = o + 4 + j * 14;
      const c = { tick: v.getUint16(p, true), op: bytes[p + 2], event: v.getUint16(p + 4, true), frame: bytes[p + 4], flip: !!bytes[p + 5], flipY: !!bytes[p + 6], priority: v.getInt8(p + 7), x: v.getInt16(p + 8, true), y: v.getInt16(p + 10, true), z: v.getInt16(p + 12, true), target: v.getInt8(p + 4) };
      if (![0, 1, 2, 3, 7, 11].includes(c.op) && !(battle && [8,9,10,12,14].includes(c.op))) throw new Error(`unmapped action opcode ${c.op}`);
      if ((c.op === 0 || c.op === 2) && c.frame >= frameCount) throw new Error('action frame outside table');
      if (c.op === 11 && (c.target < 0 || c.target >= n)) throw new Error('action loop outside sequence');
      return c;
    });
    return { mirror: !!(flags & 1), length: v.getUint16(o + 2, true), commands };
  });
  return { coordinateScale: bytes[4] || 1, frames, slots, duration: Math.max(0, ...slots.map(s => s?.length ?? 0)), has3d: slots.some(s => s?.commands.some(c => c.op === 2 || c.op === 3)) };
}

/** Sample native frame, move, hide and loop commands; finite actions hold their final pose. */
export function sampleAction(definition, direction, tick = 0) {
  let slot = definition.slots[direction], fallback = false;
  if (!slot) { slot = definition.slots[direction ^ 2] ?? definition.slots[direction ^ 1] ?? definition.slots.find(Boolean); fallback = true; }
  if (!slot) return null;
  let time = Math.max(0, tick);
  const loop = slot.commands.find(c => c.op === 11);
  if (loop && time >= loop.tick) {
    const start = slot.commands[loop.target].tick, length = loop.tick - start;
    if (length > 0) time = start + ((time - start) % length);
  }
  const state = { frame: null, coordinateScale: definition.coordinateScale ?? 1, mirror: slot.mirror, flip: slot.mirror, flipY: false, priority:0, x: 0, y: 0, z: 0, space: 'screen', hidden: false, fallback };
  for (const c of slot.commands) {
    if (c.tick > time || c.op === 11) continue;
    if (![0,1,2,3,7].includes(c.op)) continue; // battle sound/action event, not a sprite transform
    if (c.op === 7) { state.hidden = true; continue; }
    if (c.op === 0 || c.op === 2) { state.frame = c.frame; state.flip = slot.mirror !== c.flip; state.flipY = c.flipY; state.priority=c.priority??0; state.hidden = false; }
    state.x = slot.mirror && (c.op === 0 || c.op === 1) ? -c.x : c.x; state.y = c.y; state.z = c.z;
    state.space = c.op === 2 || c.op === 3 ? 'world' : 'screen';
  }
  return state.frame === null && !state.hidden ? null : state;
}

export function actionLabel(nativeName, id) {
  if (!nativeName) return `Animation resource ${id}`;
  const names = { denim: 'Denam', kachua: 'Catiua', vice: 'Vyce', guildus: 'Gildas', mildain: 'Mirdyn', nybbas: 'Nybeth', armorica: 'Almorica' };
  let text = nativeName.replace(/_(aura|mask)$/, '');
  const headReturn = /neckturn_[lr]\d+_r$/.test(text);
  text = text.replace(/^([^_]+)/, w => names[w.toLowerCase()] ?? w[0].toUpperCase() + w.slice(1));
  return text.replace(/neckturn/g, 'head turn').replace(/looksup/g, 'look up').replace(/looksdown/g, 'look down')
    .replace(/body_revers/g, 'turn body').replace(/_([lr])(\d+)/g, (_, side, angle) => ` ${side === 'l' ? 'left' : 'right'} ${angle}°`)
    .replace(/_r$/, headReturn ? ' (return)' : ' r').replace(/_/g, ' ');
}

export function sceneActionResources(scene) {
  const resources = new Map();
  for (const e of scene.entries) {
    if (e.id < 0x12000 || e.id >= 0x13000) continue;
    try {
      const packageEntries = parsePakd(isAshg(e.data) ? decompressAshg(e.data) : e.data).entries;
      const sequence = packageEntries.find(p => p.data[0] === 0x53 && p.data[1] === 0x41 && p.data[2] === 0x53 && p.data[3] === 0x33);
      if (!sequence) continue;
      const imageEntries = parsePakd(packageEntries[0].data).entries;
      let nativeName = null;
      for (const tex of imageEntries) if (tex.data[0] === 0x62 && tex.data[1] === 0x74 && tex.data[2] === 0x78) {
        const start = view(tex.data).getUint32(0x24, true); let end = start;
        while (end < tex.data.length && tex.data[end]) end++;
        nativeName = new TextDecoder().decode(tex.data.subarray(start, end)).replace(/_(aura|mask)$/, '');
        if (nativeName) break;
      }
      const id = e.id - 0x12000;
      resources.set(id, { id, key: `${scene.fileName}:${id}`, nativeName, label: actionLabel(nativeName, id), definition: parseActionSequence(sequence.data), image: imageEntries[0].data });
    } catch (error) { resources.set(e.id - 0x12000, { id: e.id - 0x12000, error: error.message, label: `Animation resource ${e.id - 0x12000}` }); }
  }
  for (const part of scene.parts) {
    const index = scene.entries.find(e => e.id === 0x8000 + part.entryId);
    part.animations = animationIndex(index?.data).map((id, index) => ({ ...resources.get(id), id, index, label: resources.get(id)?.label ?? `Missing animation resource ${id}` }));
  }
  return resources;
}

/** Compose cells using the same native origin as the actor's walking frames. */
export function actionImages(resource, anchor = { x: 0, y: 8 }, palette = DEFAULT_PALETTE) {
  if(resource.rgbaFrames)return resource.rgbaFrames;
  const sheets = resource.images?.map(readIndexSheet) ?? [readIndexSheet(resource.image)];
  if (!sheets[0]) throw new Error('unmapped action atlas format');
  const used = new Set(resource.definition.slots.flatMap(s => s?.commands.filter(c => c.op === 0 || c.op === 2).map(c => c.frame) ?? []));
  if (!used.size) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of used) for (const c of resource.definition.frames[id].cells) {
    if (!c.width || !c.height) continue; // stock sequences use empty cells with sentinel UVs
    const f = resource.definition.frames[id];
    const sheet=sheets[f.sheet];
    if (!sheet || c.u + c.width > sheet.width || c.v + c.height > sheet.height) throw new Error('action cell outside its atlas');
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.width); y1 = Math.max(y1, c.y + c.height);
  }
  const width = x1 - x0, height = y1 - y0;
  if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096)) throw new Error('invalid action image bounds');
  return resource.definition.frames.map((f, id) => {
    if (!used.has(id)) return null; // some stock tables retain unused back-view rectangles outside their atlas
    const sheet=sheets[f.sheet];
    const rgba = new Uint8Array(width * height * 4);
    for (const c of f.cells) for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const k = sheet.indices[(c.v + y) * sheet.width + c.u + x];
      const colors=sheet.palette??resource.palette??palette;
      if (k && k*4+4<=colors.length) rgba.set(colors.subarray(k * 4, k * 4 + 4), ((c.y + y - y0) * width + c.x + x - x0) * 4);
    }
    return { rgba, width, height, pivot: (y1 - anchor.y) / height, pivotX: (anchor.x - x0) / width };
  });
}
