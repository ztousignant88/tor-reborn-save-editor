// Read-only standing/walking poses from Reborn's SAS3 animation bank.
// Binary field meanings cross-checked with Gibbed.TacticsOgre.SequenceFormats;
// the shipped Reborn bank has the 16-byte header (scale at +4).
import { view } from '../lib/pakd.js';

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Scene directions are east, south, west, north in map coordinates. */
export function facingPose(facing, yaw, sourceView = null) {
  const [x, z] = DIRECTIONS[facing] ?? DIRECTIONS[1];
  const front = x * Math.sin(yaw) + z * Math.cos(yaw) >= -1e-8;
  const screenX = x * Math.cos(yaw) - z * Math.sin(yaw);
  return {
    view: front ? 'front' : 'back',
    // Native front images face screen-right; back images face screen-left.
    // They require opposite mirroring rules to follow the same map direction.
    flip: (sourceView ?? (front ? 'front' : 'back')) === 'front' ? screenX < -1e-8 : screenX > 1e-8,
  };
}

export function movementFacing(from, to, fallback = 1) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  if (Math.abs(dx) + Math.abs(dy) < 1e-8) return fallback;
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
}

// Project characters get new sprite names (e.g. "OgreB"), so their family can't come
// from the name: it is registered from their character sheet's animation type.
const projectFamilies = new Map();
export function setProjectPoseGroups(entries) {
  projectFamilies.clear();
  for (const [name, family] of entries) projectFamilies.set(String(name).toLowerCase(), family);
}

/** Native animation families: actor names, not localized class names. */
export function poseGroup(name) {
  const n = name.toLowerCase();
  if (projectFamilies.has(n)) return projectFamilies.get(n);
  if (n === 'dorgaluaxl') return 24;
  if (n === 'dorgalua') return 23;
  if (n === 'dra_ark') return 2;
  if (n === 'dra_dark') return 3;
  if (n === 'dra_frost') return 4;
  if (n === 'dra_thunder') return 5;
  if (n.startsWith('dra_')) return 1;
  if (n === 'octopus') return 6;
  if (n === 'cockatrice' || n === 'gryphon') return 7;
  if (n.startsWith('gol_') || n === 'cyclops') return 8;
  if (n === 'hydra') return 9;
  return 0;
}

export function walkFrame(timeline, tick = 0) {
  const t = ((tick % timeline.length) + timeline.length) % timeline.length;
  let frame = timeline.steps[0].frame;
  for (const step of timeline.steps) { if (step.tick > t) break; frame = step.frame; }
  return frame;
}

export function parsePoseDefinition(bytes,{idleFromSequence=false,nativeAnchor=null}={}) {
  const v = view(bytes);
  const range = (o, n) => { if (o < 0 || n < 0 || o + n > bytes.length) throw new Error('truncated SAS3 pose data'); };
  range(0, 16);
  if (v.getUint32(0, true) !== 0x33534153) throw new Error('expected Reborn SAS3 animation');
  const ft = v.getUint32(8, true), slots = v.getUint32(12, true);
  range(16, slots * 4); range(ft, 4);
  const count = v.getUint32(ft, true); range(ft + 4, count * 4);
  const frames = new Map(), images = new Map();
  const readFrame = (id) => {
    if (frames.has(id)) return;
    if (id >= count) throw new Error('SAS3 frame outside table');
    const o = v.getUint32(ft + 4 + id * 4, true); range(o, 6);
    const sheet = bytes[o], n = bytes[o + 1]; range(o + 6, n * 12);
    if (sheet !== 0 || !n) throw new Error('unsupported standing/walking sprite sheet');
    const cells = [];
    for (let i = 0; i < n; i++) {
      const p = o + 6 + i * 12;
      cells.push({ x: v.getInt16(p, true), y: v.getInt16(p + 2, true),
        width: v.getUint16(p + 4, true), height: v.getUint16(p + 6, true),
        u: v.getUint16(p + 8, true), v: v.getUint16(p + 10, true) });
    }
    frames.set(id, cells);
  };
  const image = (frame, x = 0, y = 0, flip = false, vflip = false) => {
    readFrame(frame);
    const key = x || y || flip || vflip ? `${frame}:${x}:${y}:${+flip}:${+vflip}` : frame;
    images.set(key, { frame, x, y, flip, vflip });
    return key;
  };
  const sequence = (slot) => {
    if (slot >= slots) throw new Error('missing walking direction');
    const flags = v.getUint32(16 + slot * 4, true), o = flags >>> 1;
    if (o < 16 + slots * 4) throw new Error('missing walking sequence');
    range(o, 4); const n = bytes[o]; range(o + 4, n * 14);
    const length = v.getUint16(o + 2, true), steps = [];
    if (!length || n > 127) throw new Error('invalid walking sequence');
    for (let i = 0; i < n; i++) {
      const p = o + 4 + i * 14, opcode = bytes[p + 2];
      if (opcode !== 0 && opcode !== 2) continue;
      if (v.getInt16(p + 12, true) || (opcode === 2 && (v.getInt16(p + 8, true) || v.getInt16(p + 10, true)))) {
        throw new Error('walking sequence needs unsupported frame transform');
      }
      const frame = image(bytes[p + 4], v.getInt16(p + 8, true), v.getInt16(p + 10, true), !!bytes[p + 5], !!bytes[p + 6]);
      steps.push({ tick: v.getUint16(p, true), frame });
    }
    steps.sort((a, b) => a.tick - b.tick);
    if (!steps.length || steps[0].tick !== 0) throw new Error('walking sequence has no initial image');
    return { length, steps };
  };
  const front = sequence(0), back = sequence(2);
  // The neutral humanoid walk poses are frames 0/4. Other supported families
  // also use those as their resting poses (their first walk image may differ).
  const idle=idleFromSequence?{front:front.steps[0].frame,back:back.steps[0].frame}:{front:0,back:4};
  if(!idleFromSequence){image(0);image(4);}
  return { frames, images, front, back, idle,nativeAnchor };
}

/** Compose native atlas cells on one canvas with a shared reference foot. */
export function composePoses(sheet, definition) {
  const pixels = new Map();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [id, transform] of definition.images) {
    const cells = definition.frames.get(transform.frame);
    const points = new Map();
    for (const c of cells) {
      if (!c.width || !c.height || c.u + c.width > sheet.width || c.v + c.height > sheet.height) throw new Error('pose cell outside sprite sheet');
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const k = sheet.indices[(c.v + y) * sheet.width + c.u + x];
        if (k) {
          const px = (transform.flip ? -(c.x + x) - 1 : c.x + x) + transform.x;
          const py = (transform.vflip ? -(c.y + y) - 1 : c.y + y) + transform.y;
          points.set(`${px},${py}`, [px, py, k]);
        }
      }
    }
    pixels.set(id, [...points.values()]);
    for (const [x, y] of points.values()) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  }
  const hasFront = !!pixels.get(definition.idle.front)?.length, hasBack = !!pixels.get(definition.idle.back)?.length;
  if (!hasFront && !hasBack) throw new Error('empty standing/walking frames');
  // Two civilian sheets ship only one direction. Keep their available
  // images rather than displaying a blank or inventing another view.
  const front = pixels.get(hasFront ? definition.idle.front : definition.idle.back);
  const fx0 = Math.min(...front.map(p => p[0])), fx1 = Math.max(...front.map(p => p[0])) + 1;
  const fy0 = Math.min(...front.map(p => p[1])), fy1 = Math.max(...front.map(p => p[1])) + 1;
  // Humanoid poses share a fixed foot reference, independent of hair,
  // weapons or the crop's centre. Keep other native families on their
  // existing reference until their ground contact is calibrated.
  const humanoid = definition.frames.get(0)?.some(c => c.x === -40 && c.y === -108 && c.width === 80 && c.height === 128);
  const anchorX = definition.nativeAnchor?.x??(humanoid ? 0 : (fx0 + fx1) / 2), anchorY = definition.nativeAnchor?.y??(humanoid ? 8 : fy1 - (fy1 - fy0) * 0.04);
  const width = x1 - x0, height = y1 - y0, frames = new Map();
  for (const [id, points] of pixels) {
    if (!points.length) continue;
    const indices = new Uint8Array(width * height);
    for (const [x, y, k] of points) indices[(y - y0) * width + x - x0] = k;
    frames.set(id, { width, height, indices, pivot: (y1 - anchorY) / height, pivotX: (anchorX - x0) / width });
  }
  const idle = { front: hasFront ? definition.idle.front : definition.idle.back,
    back: hasBack ? definition.idle.back : definition.idle.front };
  const timeline = (side) => {
    const available = side === 'front' ? (hasFront ? 'front' : 'back') : (hasBack ? 'back' : 'front');
    const t = definition[available];
    return { ...t, steps: t.steps.map(s => ({ ...s, frame: frames.has(s.frame) ? s.frame : idle[side] })) };
  };
  return { frames, front: timeline('front'), back: timeline('back'), idle, anchor: { x: anchorX, y: anchorY },
    singleView: hasFront && hasBack ? null : hasFront ? 'front' : 'back' };
}
