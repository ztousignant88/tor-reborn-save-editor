// Menu icon archives: Data/menu/texture_x4/<name>.dat -> pakd entry 0 is an
// "ARC\0" archive (Gibbed ArcFile, zlib) of named textures. Each entry's data
// starts with [u32 size, u16 header size (0x20)], then a btx texture.
//   itemicon.dat     item_icon_<icon:04>_<palette:02>  (equipment, items)
//   spell_icon.dat   icon_spell_<native icon id:04>
//   skill_icon.dat   icon_skill_<skill:04>
// Localized archives (e.g. en-us/skill_icon.dat) supply MP/HP/stat lettering.
// Effect +AA is its icon ID; +AC selects spell(1), skill(2), finisher(3).
// Verified native formatter: executable RVA 0x2BBE10.

import { view } from '../lib/pakd.js';
import { parseBtx } from './bgscene.js';
import { loadDat } from './datfile.js';
import { isCustomIconId, iconName } from './customicons.js';

const archives = new Map(), merged = new Map();
const padded=(n,w=4)=>String(n).padStart(w,'0');
const LOCALIZED=new Set(['itemicon','skill_icon','spell_icon','st_icon','st_icon_48']);
const LANGUAGES=new Set(['en-us','ja-jp','de-de','es-es','fr-fr','ko-kr','zh-cn','zh-tw']);

export async function itemIcon(icon,palette,lang='en-us'){
  const bank=await loadIconArchive('itemicon',lang);
  const prefix=`item_icon_${padded(icon)}_`;
  const texture=bank.get(`${prefix}${padded(palette,2)}`)??bank.get(`${prefix}00`)
    ??[...bank].find(([name])=>name.startsWith(prefix))?.[1];
  return {texture:texture??bank.get('item_icon_0999_00'),missing:!texture};
}

/** Match native icon IDs; retain numbered ranks and share only equivalent variants. */
export async function abilityIcon(kind,id,tables,lang='en-us'){
  const [spells,finishers,skills,statuses]=await Promise.all(['spell_icon','finishblow_icon','skill_icon','st_icon_48'].map(name=>loadIconArchive(name,lang)));
  const skillArt=skillId=>{
    if(skillId<0||skillId>=tables.tables.skill.count)return null;
    const name=tables.skillName(skillId);
    // Distinct rank names retain distinct native cards. Equivalent variants
    // with the exact same name use one deterministic representative.
    const aliases=name?tables.lists.skill.filter(s=>s.id!==skillId&&s.name===name).map(s=>s.id):[];
    const candidates=[skillId,...aliases];
    for(const n of candidates){
      const row=tables.tables.skill.row(n),nameId=view(row).getUint16(0x5a,true);
      const art=skills.get(`icon_skill_${padded(n)}`)??skills.get(`icon_skill_${padded(nameId)}`);
      if(art)return art;
    }
    // Passive skills can use the status glyph explicitly recorded at +60/+64.
    // The native item inspector takes this route when no full skill card exists.
    for(const n of candidates){
      const row=tables.tables.skill.row(n),glyph=row[0x60]||row[0x64];
      if(glyph){const art=statuses.get(`st_icon01_${padded(glyph)}_00_s`);if(art)return art;}
    }
    return null;
  };
  if(kind==='skill'){
    if(id<0||id>=tables.tables.skill.count)return null;
    const row=tables.tables.skill.row(id),effectId=view(row).getUint16(4,true);
    if (effectId > 0 && effectId < tables.tables.effect.count) {
      const effect = tables.tables.effect.row(effectId), icon = view(effect).getUint16(0xaa, true);
      if (effect[0xac] === 2 && isCustomIconId(icon)) {
        const custom = skills.get(iconName('skill_icon', icon));
        if (custom) return custom;
      }
    }
    return skillArt(id);
  }
  const effectArt=effectId=>{
    const row=tables.tables.effect.row(effectId),icon=view(row).getUint16(0xaa,true),kind=row[0xac];
    if(kind===1)return spells.get(`icon_spell_${padded(icon)}`)??null;
    if(kind===2){
      const direct=skills.get(iconName('skill_icon',icon));
      return isCustomIconId(icon) ? direct??null : skillArt(icon)??direct??null;
    }
    if(kind===3)return finishers.get(`icon_finishblow_${padded(icon)}`)??null;
    return null;
  };
  const direct=effectArt(id);if(direct)return direct;
  // Old/unused rows may share a name with a usable native record. Pick the
  // first valid representative; never reinterpret an effect ID as a skill ID.
  const name=tables.effectName(id);
  for(const e of tables.lists.effect)if(name&&e.name===name){const art=effectArt(e.id);if(art)return art;}
  return null;
}

function rawArchive(name){
  if(!archives.has(name))archives.set(name,loadDat(`menu/texture_x4/${name}.dat`).then(dat=>parseArc(dat.pakd.entries[0].data)));
  return archives.get(name);
}

export function loadIconArchive(name,lang='en-us'){
  if(!LANGUAGES.has(lang))lang='en-us';
  const key=`${name}:${lang}`;
  if(!merged.has(key))merged.set(key,(async()=>{
    const paths=LOCALIZED.has(name)?[name,`${lang}/${name}`]:[name];
    const results=await Promise.allSettled(paths.map(rawArchive));
    const out=new Map();
    for(const result of results)if(result.status==='fulfilled')for(const [key,texture]of result.value)out.set(key,texture);
    return out;
  })().catch(err=>{console.warn(`icons ${name} (${lang}):`,err);return new Map();}));
  return merged.get(key);
}

function parseArc(d) {
  const v = view(d);
  if (v.getUint32(0, true) !== 0x00435241) throw new Error('not an ARC archive');
  const entryCount = v.getUint16(6, true);
  const offsetCount = v.getUint16(8, true);
  const offsets = Array.from({ length: offsetCount }, (_, i) => v.getUint32(0x30 + i * 4, true));
  let p = (0x30 + offsetCount * 4 + 31) & ~31;
  const out = new Map();
  for (let i = 0; i < entryCount; i++) {
    const offsetIndex = v.getUint16(p + 6, true);
    const nameLength = d[p + 14];
    const name = new TextDecoder().decode(d.subarray(p + 20, p + 20 + nameLength)).replace(/\0.*$/s, '');
    const at = offsets[offsetIndex];
    const headerSize = v.getUint16(at + 4, true);
    if (d[at + headerSize] === 0x62) out.set(name, parseBtx(d, at + headerSize)); // 'btx'
    p += (20 + nameLength + 31) & ~31;
  }
  return out;
}
