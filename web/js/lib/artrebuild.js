// Bounded art reconstruction. Existing headers, entry IDs and unrelated bodies are retained.
import {parsePakd,view}from './pakd.js';
import {decompressAshg,compressAshg,isAshg}from './ashg.js';
import {decrypt,encrypt}from './crypt.js';
import {unzipSingle,zipSingle,crc32}from './zip.js';
import {readRGBAPNG,indexedPaletteMatches,spritePNGCorrection}from './pngrgba.js';
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
const align=n=>(n+15)&~15;
export async function unpackArt(bytes){const {name,data}=await unzipSingle(decrypt(bytes));return {name,pack:data};}
export async function repackArt(original,pack,{path=''}={}){const old=await unpackArt(original);pack=repairArtCompression(pack,{path}).bytes;if(same(old.pack,pack))return original;const bytes=encrypt(await zipSingle(old.name,pack));const verify=await unpackArt(bytes);if(!same(verify.pack,pack))throw new Error('DAT rebuild verification failed');verifyArtCompression(verify.pack,{path});return bytes;}
export function rebuildPakd(original,edits){
 const p=parsePakd(original),v=view(original),n=p.count;if(12+n*4>original.length||p.total>original.length||p.entries.some(e=>e.offset<12+n*4))throw new Error('Invalid PAKD');
 const pieces=p.entries.map(e=>edits.get(e.index)??e.data);if(pieces.every((d,i)=>same(d,p.entries[i].data)))return original;
 if(pieces.every((d,i)=>d.length===p.entries[i].data.length)){const out=original.slice();for(const [i,d]of edits)out.set(d,p.entries[i].offset);return out;}
 const header=n?p.entries[0].offset:12,tail=original.subarray(p.total),total=header+pieces.reduce((a,d)=>a+align(d.length),0),out=new Uint8Array(total+tail.length),o=view(out);out.set(original.subarray(0,header));let at=header;
 pieces.forEach((d,i)=>{o.setUint32(8+i*4,at,true);out.set(d,at);at+=align(d.length);});o.setUint32(8+n*4,total,true);out.set(tail,total);
 const check=parsePakd(out);if(check.count!==n||check.entries.some((e,i)=>e.id!==p.entries[i].id))throw new Error('PAKD identity changed');return out;
}
export function literalAshg(bytes,template){
 // Retain the public name for callers; rebuilt streams now use native LZ matches.
 const bits=template[13]&31,out=compressAshg(bytes,{template,window:bits>=1&&bits<=15?bits:7});
 if(!same(decompressAshg(out,{verifyChecksum:true}),bytes))throw new Error('ASHG verification failed');return out;
}
export function portraitRuntimeIssue(compressed,expanded,path){
 if(!/^(?:object\/[^/]+[0-9]{2}\.dat|menu\/menu_classface\.dat)$/i.test(path)||expanded.length<52||view(expanded).getUint32(0,true)!==0x00787462||view(expanded).getUint16(8,true)!==512||view(expanded).getUint16(10,true)!==512||compressed.length<=0x28000)return null;
 return `Portrait in ${path} is ${compressed.length.toLocaleString()} bytes after compression. The game silently rejects portraits above 163,840 bytes (160 KiB). Simplify the image or leave more transparent space before importing again.`;
}
// Older editor imports wrote alignment padding into the CRC byte. Repair wrappers
// without changing their expanded art, resource IDs, or native compression streams.
export function repairArtCompression(pack,{path=''}={}){let checked=0,corrected=0;const issues=[];
 function walk(d,path=[],depth=0){if(depth>12)throw new Error('Art compression nesting limit');
  if(isAshg(d)){checked++;const expanded=decompressAshg(d),expected=crc32(expanded)&255,invalid=d[14]!==expected;if(invalid){corrected++;issues.push({path,stored:d[14],expected});}const next=walk(expanded,[...path,'ashg'],depth+1);if(next!==expanded)return literalAshg(next,d);if(!invalid)return d;const out=d.slice();out[14]=expected;return out;}
  if(d.length>=12&&view(d).getUint32(0,true)===0x646b6170){const p=parsePakd(d),edits=new Map();for(const e of p.entries){const next=walk(e.data,[...path,e.index],depth+1);if(next!==e.data)edits.set(e.index,next);}return edits.size?rebuildPakd(d,edits):d;}
  return d;
 }const bytes=walk(pack);if(path)verifyPortraitLimits(bytes,path);return {bytes,checked,corrected,issues};
}
function verifyPortraitLimits(pack,path){
 function walk(d,depth=0){if(depth>12)throw new Error('Art compression nesting limit');if(isAshg(d)){const expanded=decompressAshg(d),issue=portraitRuntimeIssue(d,expanded,path);if(issue)throw Object.assign(new Error(issue),{code:'PORTRAIT_SIZE'});walk(expanded,depth+1);}else if(d.length>=12&&view(d).getUint32(0,true)===0x646b6170)for(const e of parsePakd(d).entries)walk(e.data,depth+1);}
 walk(pack);
}
export function verifyArtCompression(pack,options={}){const result=repairArtCompression(pack,options);if(result.corrected)throw new Error(`${result.corrected} compressed art resources have invalid native checksums`);return {checked:result.checked};}
export function patchArt(pack,locator,change){
 function walk(d,index){if(index===locator.length)return change(d);const step=locator[index];
  if(step.type==='pakd'){const p=parsePakd(d),e=p.entries[step.index];if(!e||e.id!==step.id)throw new Error('Resource entry no longer matches');return rebuildPakd(d,new Map([[step.index,walk(e.data,index+1)]]));}
  if(step.type==='ashg'){const expanded=decompressAshg(d),next=walk(expanded,index+1);return same(expanded,next)?d:literalAshg(next,d);}
  if(step.type==='btx'){if(index!==locator.length-1)throw new Error('Unsupported texture locator');const start=step.offset;if(start<0||start+52>d.length)throw new Error('Texture outside resource');const old=d.subarray(start),next=change(old);if(next.length!==old.length)throw new Error('Inline texture resizing is not supported');const out=d.slice();out.set(next,start);return out;}
  if(step.type==='arc'){
   const v=view(d),n=v.getUint16(8,true),count=v.getUint16(6,true);if(48+n*4>d.length)throw new Error('Invalid ARC');let pos=(48+n*4+31)&~31,found=null;
   for(let i=0;i<count;i++){const len=d[pos+14],name=new TextDecoder().decode(d.subarray(pos+20,pos+20+len)).replace(/\0.*$/s,'');if(name===step.name&&v.getUint16(pos+6,true)===step.index)found=v.getUint32(48+step.index*4,true);pos=(pos+20+len+31)&~31;}
   if(found===null||found+8>d.length)throw new Error('ARC resource no longer matches');const start=found+v.getUint16(found+4,true),size=v.getUint32(found,true),old=d.subarray(start,start+size),next=walk(old,index+1);
   if(next.length!==old.length)throw new Error('ARC resource resizing is not supported yet');const out=d.slice();out.set(next,start);return out;
  }throw new Error(`Rebuilding ${step.type} resources is not supported yet`);
 }return walk(pack,0);
}
export function replaceNativeArt(target,donor){
 if(target.kind!==donor.kind||target.width!==donor.width||target.height!==donor.height)throw new Error('Donor image dimensions or type do not match');
 if(target.kind==='indexed'){
  if(target.bpp!==donor.bpp||target.palettes.length||donor.palettes.length)throw new Error('Appearance transfer needs matching shared-palette indexed sheets');
  return leaf=>patchIndices(leaf,donor.sheet.indices,target.width,target.height);
 }
 if(target.format!==donor.format||target.texture.stride!==donor.texture.stride)throw new Error('Texture format/stride does not match');
 return leaf=>{const v=view(leaf),offset=v.getUint32(24,true),out=leaf.slice();if(offset+donor.texture.data.length>out.length)throw new Error('Donor pixels exceed texture');out.set(donor.texture.data,offset);return out;};
}
export function patchIndices(leaf,indices,width,height){
 const out=leaf.slice(),v=view(out),t=16+v.getUint32(20,true);if(v.getUint16(t+20,true)!==width||v.getUint16(t+22,true)!==height||indices.length!==width*height)throw new Error('Sprite dimensions changed');
 const bpp=v.getUint16(t+24,true),start=t+v.getUint32(t+8,true);if(![4,8].includes(bpp)||indices.some(n=>n>=(1<<bpp)))throw new Error('Palette index exceeds native bit depth');
 if(bpp===8)out.set(indices,start);else for(let i=0;i<indices.length;i++){const at=start+(i>>1),shift=(i&1)*4;out[at]=(out[at]&~(15<<shift))|(indices[i]<<shift);}return out;
}
export async function readIndexedPNG(bytes,expectedPalette,options={}){
 const image=await readRGBAPNG(bytes,options);
 if(image.png.colourType!==3||image.png.bitDepth!==8||image.png.interlaced)throw spritePNGCorrection('This sprite PNG needs its encoding corrected. Convert and preview to use the selected native palette.');
 if(!indexedPaletteMatches(image,expectedPalette))throw spritePNGCorrection('The PNG palette was changed or reordered. Convert and preview to map its colours to the selected native palette.');
 return {width:image.width,height:image.height,indices:image.indices};
}
