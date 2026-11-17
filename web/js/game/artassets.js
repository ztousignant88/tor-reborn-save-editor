import {crc32}from '../lib/zip.js';
import {portraitRuntimeIssue}from '../lib/artrebuild.js';
// Read-only art inventory. Locators refer to archive entries, never guessed frame grids.
import {parsePakd,view} from '../lib/pakd.js';
import {readIndexSheet,readImagePalette} from './unitsprites.js';
import {parseBtx} from './bgscene.js';
import {decompressAshg,isAshg} from '../lib/ashg.js';
import {decompressMlz,parseEfx} from '../lib/efx.js';
import {parseActionSequence} from './sceneanimations.js';
import {source} from './source.js';
import {loadDat} from './datfile.js';
export const ART_CATEGORIES=[['characters','Character sprites & portraits'],['items','Item & equipment icons'],['skills','Skill icons'],['spells','Spell icons'],['finishers','Finisher icons'],['menus','Other menu art'],['portraits','Class portraits'],['maps','Map tiles & objects'],['scenes','Cutscene art'],['shared','Equipment & shared art'],['effects','Effect textures']];
const STEMS={items:'itemicon',skills:'skill_icon',spells:'spell_icon',finishers:'finishblow_icon'};
export async function artFiles(category,lang='en-us'){
 const list=async dir=>(await source.list(dir)).filter(f=>/\.(dat|efz)$/i.test(f.name)).map(f=>({...f,path:`${dir}/${f.name}`}));
 if(category==='characters')return list('object');
 if(category==='maps')return list('bg');
 if(category==='scenes')return list('event/scene');
 if(category==='shared')return [{name:'battle_data_release.dat',path:'battle/battle_data_release.dat'}];
 if(category==='portraits')return [{name:'menu_classface.dat',path:'menu/menu_classface.dat'}];
 if(category==='effects')return [...await list('effect/global/common'),...await list('effect/global/magic')];
 const common=await list('menu/texture_x4');
 const localized=await list(`menu/texture_x4/${lang}`).catch(()=>[]);
 return [...common,...localized].filter(f=>STEMS[category]?f.name===`${STEMS[category]}.dat`:!Object.values(STEMS).some(s=>f.name===`${s}.dat`));
}
const decoder=new TextDecoder();
const magic=(d,s)=>d.length>=s.length&&[...s].every((c,i)=>d[i]===c.charCodeAt(0));
function pak(d){
 if(d.length<16)throw new Error('Truncated PAKD');const v=view(d),n=v.getUint32(4,true);
 if(n>100000||12+n*4>d.length)throw new Error('Invalid PAKD count');
 const p=parsePakd(d);let last=12+n*4;
 if(p.total>d.length||p.total<last)throw new Error('Invalid PAKD length');
 for(const e of p.entries){if(e.offset<last||e.offset>p.total)throw new Error('Invalid PAKD offsets');last=e.offset;}
 return p;
}
function texture(d,o){
 if(o<0||o+52>d.length||!magic(d.subarray(o),'btx\0'))throw new Error('Truncated BTX');
 const v=view(d),w=v.getUint16(o+8,true),h=v.getUint16(o+10,true),fmt=d[o+16],stride=v.getUint32(o+12,true),off=v.getUint32(o+24,true),name=v.getUint32(o+36,true);
 if(!w||!h||w>16384||h>16384||w*h>32*1024*1024||![0,7,8,9,13].includes(fmt)||off<52||name>=d.length-o)throw new Error('Unsupported BTX layout');
 const min=fmt===0?w*4:Math.ceil(w/4)*(fmt===7?8:16),rows=fmt===0?h:Math.ceil(h/4);
 if(stride<min||o+off+stride*rows>d.length)throw new Error('Truncated BTX pixels');
 const t=parseBtx(d,o);if(t.name.length>1024)throw new Error('Invalid texture name');return t;
}
export function scanArt(bytes,path='archive'){
 const assets=[],sequences=[],warnings=[];
 function visit(d,locator,depth=0,label=''){
  if(depth>12)throw new Error('Archive nesting limit reached');
  if(isAshg(d)){if(d.length<16||view(d).getUint32(8,true)>128*1024*1024)throw new Error('Invalid ASHG size');const expanded=decompressAshg(d);if((crc32(expanded)&255)!==d[14])warnings.push('Invalid native checksum in compressed art resource. Older editor imports need rebuilding before game use.');const issue=portraitRuntimeIssue(d,expanded,path);if(issue)warnings.push(issue);return visit(expanded,[...locator,{type:'ashg'}],depth+1,label);}
  if(magic(d,'pakd')){const p=pak(d);for(const e of p.entries)visit(e.data,[...locator,{type:'pakd',index:e.index,id:e.id}],depth+1,label);return;}
  if(magic(d,'ARC\0')){
   if(d.length<48)throw new Error('Truncated ARC');const v=view(d),count=v.getUint16(6,true),n=v.getUint16(8,true);if(48+n*4>d.length)throw new Error('Invalid ARC offsets');
   let at=(48+n*4+31)&~31;
   for(let i=0;i<count;i++){
    if(at+20>d.length)throw new Error('Truncated ARC directory');const index=v.getUint16(at+6,true),len=d[at+14];if(index>=n||at+20+len>d.length)throw new Error('Invalid ARC record');
    const name=decoder.decode(d.subarray(at+20,at+20+len)).replace(/\0.*$/s,''),offset=v.getUint32(48+index*4,true);
    if(offset+8>d.length)throw new Error('Invalid ARC resource');const size=v.getUint32(offset,true),header=v.getUint16(offset+4,true);
    if(header<8||offset+header+size>d.length)throw new Error('Truncated ARC resource');
    visit(d.subarray(offset+header,offset+header+size),[...locator,{type:'arc',name,index}],depth+1,name);at=(at+20+len+31)&~31;
   }return;
  }
  if(magic(d,'SAS3')){try{sequences.push({locator,definition:parseActionSequence(d,{battle:true})});}catch(e){warnings.push(`Animation: ${e.message}`);}return;}
  if(d.length>=40&&view(d).getUint32(0,true)===0&&view(d).getUint16(8,true)===1&&view(d).getUint16(10,true)===16&&view(d).getUint32(12,true)===3){
   const v=view(d),at=16+v.getUint32(20,true);if(at+26>d.length)return;
   const w=v.getUint16(at+20,true),h=v.getUint16(at+22,true),bpp=v.getUint16(at+24,true);
   if(!w||!h||w*h>32*1024*1024||![4,8].includes(bpp))return;
   const start=at+v.getUint32(at+8,true),size=v.getUint32(at+4,true);
   if(size<Math.ceil(w*h*bpp/8)||start+size>d.length)throw new Error('Truncated indexed image');
   const sheet=readIndexSheet(d);sheet.indices=sheet.indices.subarray(0,w*h);
   const paletteCount=v.getUint32(32,true);if(paletteCount>256)throw new Error('Unsupported palette count');const palettes=[];for(let i=0;i<paletteCount;i++){const p=readImagePalette(d,i);if(p)palettes.push(p);}
   assets.push({name:label||`Indexed sheet ${w}×${h}`,kind:'indexed',width:w,height:h,bpp,locator,sheet,palettes,raw:d});return;
  }
  // Native map scene and effect resource leaves contain inline BTX blocks.
  for(let o=0;o+52<=d.length;o+=4)if(d[o]===98&&d[o+1]===116&&d[o+2]===120&&d[o+3]===0){
   try{const t=texture(d,o);assets.push({name:label||t.name||'Texture',kind:'texture',width:t.width,height:t.height,format:t.format,locator:[...locator,{type:'btx',offset:o}],texture:t,raw:d.subarray(o,t.end)});o=(t.end+3&~3)-4;}catch(e){warnings.push(`${label||'Texture'} at ${o}: ${e.message}`);}
  }
 }
 visit(bytes,[]);return {path,assets:assets.map((a,id)=>({...a,id})),sequences,warnings};
}
/** An object/menu archive from bytes in memory (e.g. one a plan just built), like readArtArchive. */
export async function artArchiveFromBytes(path,bytes){
 const {decrypt}=await import('../lib/crypt.js'),{unzipSingle}=await import('../lib/zip.js');
 return {...scanArt((await unzipSingle(decrypt(bytes))).data,path),original:bytes};
}
export async function readArtArchive(path){
 const {bytes}=await source.read(path);let pack;
 if(/\.efz$/i.test(path)){
  const lib=parseEfx(decompressMlz(bytes));const result={path,assets:[],sequences:[],warnings:[]};
  for(const [key,data]of lib.resources)if(key.startsWith('82:')){const r=scanArt(data,path);for(const a of r.assets)result.assets.push({...a,id:result.assets.length,locator:[{type:'efx',key},...a.locator]});result.warnings.push(...r.warnings);}
  return {...result,original:bytes};
 }
 // Read the same project-aware source once; preserve exact encrypted bytes for packages.
 const {decrypt}=await import('../lib/crypt.js'),{unzipSingle}=await import('../lib/zip.js');pack=(await unzipSingle(decrypt(bytes))).data;
 return {...scanArt(pack,path),original:bytes};
}
export async function artAnimationBank(actor){
 const {pakd}=await loadDat('battle/battle_data_release.dat');const bank=pak(pakd.entries[0].data);
 const {poseGroup}=await import('./actorposes.js');const group=poseGroup(actor);return {group,definition:parseActionSequence(bank.entries[group].data,{battle:true}),raw:bank.entries[group].data};
}
export const safeArtName=s=>String(s).replace(/[^\w. -]+/g,'_').replace(/^\.+/,'').slice(0,110)||'art';
