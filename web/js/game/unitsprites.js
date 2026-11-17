// Battle sprites for units. A unit's sprite pair names an actor set (its
// first number); explicit actor IDs come from FileTable directory 20, so new
// character filenames cannot shift any existing actor's number.
// Actor file: zip -> pakd -> entry 0: pakd [image, aura btx, mask btx].
// Image (Gibbed ImageFile/Image/Texture): 512x384 sheet of 8-bit palette
// indices (index 0 = transparent), stored linearly, laid out as 3 rows of
// 128-px cells. Colours come from the battle palette bank (see tables.js).

import { decrypt } from '../lib/crypt.js';
import { unzipSingle } from '../lib/zip.js';
import { parsePakd, view } from '../lib/pakd.js';
import { DEFAULT_PALETTE } from './palette.js';
import { source } from './source.js';
import { battleData } from './battledata.js';
import { readFileRegistry } from '../lib/filetable.js';
import { composePoses, parsePoseDefinition, poseGroup } from './actorposes.js';

const PAKD = 0x646B6170;
const SHEET_W = 512, SHEET_H = 384, ROW_H = 128;

let actorNamesPromise = null;

export function actorNames() {
  actorNamesPromise ??= source.read('FileTable.bin').then(({bytes})=>{
    const actors=readFileRegistry(bytes).filter(e=>e.directory===20),names=Array(Math.max(0,...actors.map(e=>e.id))).fill('');
    for(const actor of actors)names[actor.id-1]=actor.path.split('/').pop().replace(/\.dat$/i,'');
    return names;
  });
  return actorNamesPromise;
}

const frames = new Map(); // actor id -> Promise<{name, width, height, indices} | {name, placeholder} | null>
const sheets = new Map();
const poses = new Map();
const definitions = new Map();

function actorSheet(actorId) {
  if (!sheets.has(actorId)) sheets.set(actorId, readActorSheet(actorId));
  return sheets.get(actorId);
}

/** Front/back idle and walking images for the cutscene preview. */
export async function loadActorPoses(actorId, palette = DEFAULT_PALETTE) {
  if (!poses.has(actorId)) poses.set(actorId, (async () => {
    const actor = await actorSheet(actorId);
    if (!actor || actor.placeholder) return actor;
    const group = poseGroup(actor.name);
    if (!definitions.has(group)) definitions.set(group, battleData().then(({ dat }) => {
      const bank = parsePakd(dat.pakd.entries[0].data).entries;
      return parsePoseDefinition(bank[group].data,{idleFromSequence:group===24,nativeAnchor:group===24?{x:0,y:8}:null});
    }));
    return { name: actor.name, ...composePoses(actor.sheet, await definitions.get(group)) };
  })().catch(err => { console.warn(`directional sprite for actor ${actorId}:`, err); return null; }));
  const pose = await poses.get(actorId);
  if (!pose) return loadActorFrame(actorId, palette); // retain the existing fallback
  if (pose.placeholder) return pose;
  return { ...pose, frames: new Map([...pose.frames].map(([id, frame]) => [id, { ...frame, rgba: colorFrame(frame, palette) }])) };
}

function colorFrame(frame, palette) {
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let i = 0; i < frame.indices.length; i++) {
    const k = frame.indices[i];
    if (k) rgba.set(palette.subarray(k * 4, k * 4 + 4), i * 4);
  }
  return rgba;
}

/**
 * Standing frame of an actor, coloured with `palette` (256 RGBA entries).
 * Returns {name, width, height, rgba}, {name, placeholder: true} for actors
 * whose sheet layout is unsupported, or null. DorgaluaXL is composed from
 * its multi-cell native frames rather than cut into ordinary unit cells.
 */
export async function loadActorFrame(actorId, palette = DEFAULT_PALETTE) {
  if (!frames.has(actorId)) frames.set(actorId, readActorFrame(actorId).catch((err) => {
    console.warn(`sprite for actor ${actorId}:`, err);
    return null;
  }));
  const frame = await frames.get(actorId);
  if (!frame || frame.placeholder) return frame;
  const rgba = colorFrame(frame, palette);
  return { name: frame.name, width: frame.width, height: frame.height,pivot:frame.pivot,pivotX:frame.pivotX, rgba };
}

async function readActorFrame(actorId) {
  const actor = await actorSheet(actorId);
  if (!actor || actor.placeholder) return actor;
  const frame = actor.name.toLowerCase()==='dorgaluaxl' ? null : firstCell(actor.sheet);
  if(!frame&&actor.name.toLowerCase()==='dorgaluaxl'){
    const {dat}=await battleData(),bank=parsePakd(dat.pakd.entries[0].data).entries;
    const poses=composePoses(actor.sheet,parsePoseDefinition(bank[24].data,{idleFromSequence:true,nativeAnchor:{x:0,y:8}}));
    return {name:actor.name,...poses.frames.get(poses.idle.front)};
  }
  return frame ? { name: actor.name, ...frame } : null;
}

async function readActorSheet(actorId) {
  const names = await actorNames();
  const name = names[actorId - 1];
  if (!name) return null;
  const { bytes } = await source.read(`object/${name}.dat`);
  const { data } = await unzipSingle(decrypt(bytes));
  const sheets = parsePakd(data).entries[0].data;
  if (view(sheets).getUint32(0, true) !== PAKD) return { name, placeholder: true };
  const sheet = readIndexSheet(parsePakd(sheets).entries[0].data);
  if (!sheet || ((sheet.width !== SHEET_W || sheet.height !== SHEET_H)&&name.toLowerCase()!=='dorgaluaxl')) return { name, placeholder: true };
  return { name, sheet };
}

/** ImageFile -> { width, height, indices } (one palette index per pixel). */
export function readIndexSheet(file) {
  const v = view(file);
  if (v.getUint32(0, true) !== 0 || v.getUint16(8, true) !== 1 || v.getUint16(10, true) !== 16) return null;
  const tex = 0x10 + v.getUint32(0x14, true);
  const dataSize = v.getUint32(tex + 4, true);
  const dataOffset = v.getUint32(tex + 8, true);
  const width = v.getUint16(tex + 0x14, true);
  const height = v.getUint16(tex + 0x16, true);
  const bpp = v.getUint16(tex + 0x18, true);
  const pixels = file.subarray(tex + dataOffset, tex + dataOffset + dataSize);
  if (bpp === 8) return { width, height, indices: pixels, palette:readImagePalette(file) };
  if (bpp !== 4) return null;
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < indices.length; i++) indices[i] = (pixels[i >> 1] >> ((i & 1) * 4)) & 0x0F;
  return { width, height, indices, palette:readImagePalette(file) };
}

/** ImageFile-local RGBA palette. Scene props/actions commonly bundle one;
 * ordinary actor sheets inherit the battle palette and have count zero. */
export function readImagePalette(file,index=0){
  if(file.length<0x24)return null;
  const v=view(file),count=v.getUint32(0x20,true);
  if(index<0||index>=count)return null;
  const base=0x10+v.getUint32(0x18,true),table=0x10+v.getUint32(0x1c,true);
  if(table+count*4>file.length)return null;
  const p=base+v.getUint32(table+index*4,true);
  if(p+12>file.length)return null;
  const size=v.getUint32(p+4,true),start=p+v.getUint32(p+8,true);
  if(size<64||size>1024||size%4||start+size>file.length)return null;
  return file.subarray(start,start+size);
}

/**
 * Cut the first frame: the sheet has 3 rows of 128-px cells; the number of
 * columns is the most frames found in any row (frames in a row are usually
 * separated by transparent columns, and never wider than 128 px), so
 * cell width = sheet width / columns.
 */
function firstCell({ width, indices }) {
  const opaque = (x, y) => indices[y * width + x] !== 0;
  const runsInRow = (row) => {
    let runs = 0, inRun = false;
    for (let x = 0; x < width; x++) {
      let any = false;
      for (let y = row * ROW_H; y < (row + 1) * ROW_H && !any; y++) any = opaque(x, y);
      if (any && !inRun) runs++;
      inRun = any;
    }
    return runs;
  };
  // frames are at most 128 px wide, so a 512-px row holds at least 4 cells
  const columns = Math.max(Math.ceil(width / ROW_H), ...[0, 1, 2].map(runsInRow));
  const cellW = Math.floor(width / columns);
  // the first cell (row-major) that has pixels, trimmed to them
  for (let row = 0; row < SHEET_H / ROW_H; row++) {
    for (let col = 0; col < columns; col++) {
      const cx = col * cellW, cy = row * ROW_H;
      let x0 = cx + cellW, x1 = cx, y0 = cy + ROW_H, y1 = cy;
      for (let y = cy; y < cy + ROW_H; y++) for (let x = cx; x < cx + cellW; x++) {
        if (!opaque(x, y)) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      }
      if (x1 <= x0) continue;
      const w = x1 - x0, h = y1 - y0;
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) out.set(indices.subarray((y0 + y) * width + x0, (y0 + y) * width + x1), y * w);
      return { width: w, height: h, indices: out };
    }
  }
  return null;
}
