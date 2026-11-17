// Scene section 6: native BgTexAnime atlas-cell mappings. Nonzero event IDs
// include doors; only event 0 is an ambient preview. No game bytes are changed.
import {view} from '../lib/pakd.js';
import {cropObjectTexture} from './objectsprites.js';

export function parseMapAnimations(scene) {
  const v=view(scene),at=i=>v.getUint32(0x24+i*4,true)+0x10;
  let o=at(6);const limits=Array.from({length:11},(_,i)=>at(i)).filter(n=>n>o&&n<=scene.length);
  if(o<=0x10||o===at(3))return [];
  const end=Math.min(scene.length,...limits),out=[];
  while(o<end){
    if(scene.subarray(o,end).every(b=>b===0))break; // section alignment padding
    if(o+20>end)throw new Error('truncated map animation header');
    const size=v.getUint16(o+2,true),count=v.getUint16(o+14,true),rowsAt=v.getUint16(o+16,true);
    if(size<20||o+size>end||rowsAt<20||rowsAt+count*8>size)throw new Error('invalid map animation rows');
    const rows=Array.from({length:count},(_,i)=>{const p=o+rowsAt+i*8;return {target:v.getUint16(p,true),first:v.getUint16(p+2,true),last:v.getUint16(p+4,true)};});
    out.push({event:v.getUint16(o,true),targetAtlas:v.getUint16(o+4,true),sourceAtlas:v.getUint16(o+6,true),delay:v.getUint16(o+8,true),loops:v.getUint16(o+10,true),hold:v.getUint16(o+12,true),rows});
    o+=size;
  }
  return out;
}

export function mapAnimationFrame(animation,row,tick=0) {
  const length=Math.abs(row.last-row.first)+1,direction=row.last>=row.first?1:-1;
  if(length<1||!animation.hold)return row.first;
  const step=Math.floor(Math.max(0,tick-animation.delay)/animation.hold);
  return row.first+direction*(animation.loops&&step>=length*animation.loops?length-1:step%length);
}

export function animatedAtlasCells(scene,texture) {
  const match=/^bg\d{3}_(\d{2})_/.exec(texture?.name??'');
  if(!match)return [];
  const target=Number(match[1]),out=[];
  for(const a of scene.mapAnimations??[]){
    if(a.event!==0||a.targetAtlas!==target||!a.hold)continue;
    const source=scene.textures.find(t=>new RegExp(`^bg\\d{3}_a${String(a.sourceAtlas).padStart(2,'0')}_`).test(t.name)&&!t.name.includes('ripple')&&t.format===13);
    if(!source||texture.format!==13||texture.width%64||source.width%64)continue;
    const cols=source.width/64,targetCols=texture.width/64;
    for(const row of a.rows){
      if(Math.max(row.first,row.last)>=source.width/64*(source.height/32)||row.target>=targetCols*(texture.height/32))continue;
      const direction=row.last>=row.first?1:-1;
      const frames=Array.from({length:Math.abs(row.last-row.first)+1},(_,i)=>{const n=row.first+direction*i;return cropObjectTexture(source,{u:n%cols*64,v:Math.floor(n/cols)*32,width:64,height:32});});
      out.push({animation:a,row,x:row.target%targetCols*64,y:Math.floor(row.target/targetCols)*32,frames,lastFrame:-1});
    }
  }
  return out;
}
