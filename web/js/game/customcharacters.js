// Project-owned names and selection metadata. Native art/template IDs live in
// game files; editor labels travel in project.json, never browser storage.
import {source} from './source.js';
let metadata;
export function projectCharacters(){metadata??=source.info().then(info=>info.customCharacters??[]);return metadata;}
// Shared schemas describe stock IDs. Extend only art selectors using the open
// project's names, without changing schemas or writing name strings to the game.
export function projectArtOptions(kind,field,characters=[]){
 const options=field.options??[];if(field.type!=='enum'||field.size!==2||!characters.length)return options;
 const offset=field.offset,property=kind==='template'?(offset===0x3a?'actor':offset>=0x40&&offset<=0x4c&&offset%2===0?'appearance':null):kind==='class'?([0x90,0x92].includes(offset)?'actor':offset>=0x68&&offset<=0x82&&offset%2===0?'appearance':null):null;
 if(!property)return options;const named=new Map(options);for(const c of characters){const id=c[property];if(Number.isInteger(id)&&id>0&&id<=65535&&typeof c.name==='string'&&c.name.trim())named.set(id,c.name.trim());}return [...named].sort((a,b)=>a[0]-b[0]);
}
export const customKey=character=>'custom:'+character.template;
export function customLook(character){return {actor:character.actor,palette:character.palette,portraitPath:`object/${character.stem}00.dat`,owner:character.name};}
export function characterDonor(character,docs){
  const template=row=>new DataView(row.buffer,row.byteOffset,row.byteLength).getUint16(2,true);
  const units=docs.flatMap(doc=>doc.units.map(unit=>({doc,unit}))),existing=units.find(x=>template(x.unit.row)===character.template);
  const donor=existing??units.find(x=>template(x.unit.row)===character.baseTemplate&&x.unit.row[6]===character.classId)??units.find(x=>template(x.unit.row)===character.baseTemplate);
  const doc=donor?.doc??docs.find(d=>Number.isInteger(d.number));
  if(!doc)throw new Error(`No battle file available for ${character.name}`);
  const row=donor?.unit.row.slice()??new Uint8Array(196);
  if(!donor){row[8]=1;row[0x94]=7;}
  new DataView(row.buffer,row.byteOffset,row.byteLength).setUint16(2,character.template,true);row[6]=character.classId;
  return {doc,unit:{row,sprite:[character.actor,character.appearance],orig:null},label:character.name,custom:character};
}
export function customCastLook(character){return {character:character.template,portrait:character.appearance,sprite:character.actor,palette:character.palette,uses:0,donors:[],label:character.name,custom:character};}
const portraits=new Map();
export async function characterPortrait(path){
  if(!portraits.has(path))portraits.set(path,(async()=>{
    const [{readArtArchive},{artPixels}]=await Promise.all([import('./artassets.js'),import('../ui/artpixels.js')]);
    const archive=await readArtArchive(path),asset=archive.assets.find(a=>a.kind==='texture'&&a.width===512&&a.height===512&&!/_(?:aura|mask)$/i.test(a.name));
    if(!asset)return null;return {width:asset.width,height:asset.height,rgba:artPixels(asset)};
  })());
  return portraits.get(path);
}
