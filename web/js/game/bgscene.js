// Battle map scene (bg/*.dat, pakd entry 0): textures and the terrain mesh.
//
// Scene header: u32 section offsets from +0x24 (file offset = value + 0x10):
//   [0] scene size, [1] tile records, [2] ?, [3] textures, [4] terrain mesh, ...
// Texture section: self-describing "btx" textures (BC7 colour atlases plus
// uncompressed "_m" masks and water ripple masks), found by signature.
// Mesh section: one mesh; at mesh+0x40 a header whose +8 is the offset (from
// mesh+0x40) of the vertex block. Vertex block: [size, count, stride=36,
// header=0x20] then a triangle list of {pos f32x3, normal f32x3, rgba u8x4, uv f32x2}.
// World units: x/z = tiles, y = height * HEIGHT_UNIT.

import { decrypt } from '../lib/crypt.js';
import { unzipSingle } from '../lib/zip.js';
import { parsePakd, view } from '../lib/pakd.js';
import { source } from './source.js';
import { loadObjectDefinitions, objectSprite } from './objectsprites.js';
import { parseMapAnimations } from './mapanimations.js';
import { readPaintLayer } from './paintlayer.js';

export const HEIGHT_UNIT = 0.40824829; // 1/sqrt(6): one tile height step in world units
const SECTION_BASE = 0x10;
const VERTEX_STRIDE = 36;

export const TEXTURE_FORMAT = { RGBA8: 0, BC1: 7, BC2: 8, BC3: 9, BC7: 13 };
const isBlockCompressed = (format) => format >= 7 && format <= 13; // BC1..BC7 (Gibbed TextureFormat)

export async function loadScene(path) {
  const { bytes } = await source.read(path);
  const { data: pack } = await unzipSingle(decrypt(bytes));
  const entries = parsePakd(pack).entries;
  const scene = entries[0].data;
  const v = view(scene);
  const section = (i) => v.getUint32(0x24 + i * 4, true) + SECTION_BASE;
  // Other pakd entries are object sprite atlases ("bgNNN_MapobjKK"), keyed by object type = entry id.
  const objectSprites = new Map();
  const objectDefinitions = await loadObjectDefinitions();
  for (const e of entries.slice(1)) if (isBtx(e.data, 0)) objectSprites.set(e.id, objectSprite(parseBtx(e.data, 0), e.id, objectDefinitions));
  return {
    name: new TextDecoder().decode(scene.subarray(0x10, 0x20)).replace(/\0.*$/s, ''),
    textures: readTextures(scene, section(3), section(4)),
    mesh: readMesh(scene, section(4)),
    paintLayer: readPaintLayer(scene, section(4)),
    objectSprites,
    mapAnimations: parseMapAnimations(scene),
    backdrop: readBackdrop(scene, section(4), section(5)),
    paintings: readTextures(scene, section(4), section(5)).filter(t=>/_p\d\d$/.test(t.name)),
  };
}

/**
 * Indoor maps (bg200-218, bg009_03: 39 files) are drawn in game as a painted
 * picture seen from a fixed camera ("bgNNN_KK_p00", 2048x2048 BC7, stored in the
 * mesh section after the vertices). Their own atlas is a checkerboard placeholder;
 * the mesh only gives the room's shape. Returns the picture, or null.
 */
function readBackdrop(scene, start, end) {
  return readTextures(scene, start, end).find((t) => /_p\d\d$/.test(t.name)) ?? null;
}

// 'btx\0' + version 0x0103 (low half)
const isBtx = (d, o) => d[o] === 0x62 && d[o + 1] === 0x74 && d[o + 2] === 0x78 && d[o + 3] === 0 && view(d).getUint16(o + 4, true) === 0x0103;

/** Parse a btx texture at offset `o`. Returns its pixel data as a view, plus its end offset. */
export function parseBtx(d, o) {
  const v = view(d);
  const width = v.getUint16(o + 8, true);
  const height = v.getUint16(o + 0x0A, true);
  const stride = v.getUint32(o + 0x0C, true);
  const format = d[o + 0x10];
  const dataOffset = v.getUint32(o + 0x18, true);
  const nameOffset = v.getUint32(o + 0x24, true);
  let nameEnd = o + nameOffset;
  while (d[nameEnd]) nameEnd++;
  const name = new TextDecoder().decode(d.subarray(o + nameOffset, nameEnd));
  const rows = isBlockCompressed(format) ? Math.ceil(height / 4) : height;
  const end = o + dataOffset + stride * rows;
  // Native hexadecimal asset hashes omit leading zeroes (bg203_02 has 15 digits).
  return { name: name.replace(/-[0-9a-f]{1,16}$/i, ''), width, height, stride, format, data: d.subarray(o + dataOffset, end), end };
}

/** The textures of a map scene (pakd entry 0); each one's data is a view into `scene`. */
export function sceneTextures(scene) {
  const v = view(scene);
  const section = (i) => v.getUint32(0x24 + i * 4, true) + SECTION_BASE;
  return readTextures(scene, section(3), section(4));
}

function readTextures(scene, start, end) {
  const out = [];
  for (let o = start; o + 0x34 < end; o += 4) {
    if (!isBtx(scene, o)) continue;
    const tex = parseBtx(scene, o);
    out.push(tex);
    o = tex.end - 4;
  }
  return out;
}

function readMesh(scene, meshStart) {
  const v = view(scene);
  const vbOffset = v.getUint32(meshStart + 0x48, true);
  const vb = meshStart + 0x40 + vbOffset;
  const count = v.getUint32(vb + 4, true);
  const stride = v.getUint32(vb + 8, true);
  const headerSize = v.getUint32(vb + 12, true);
  if (stride !== VERTEX_STRIDE || count % 3) throw new Error(`unexpected mesh layout (stride ${stride}, ${count} vertices)`);
  const start = vb + headerSize;
  return {
    count,
    // Interleaved bytes, ready for a GPU buffer: pos(12) normal(12) rgba(4) uv(8).
    vertices: scene.slice(start, start + count * stride),
  };
}
