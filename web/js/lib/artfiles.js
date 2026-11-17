// Portable PNG and ZIP exports: no game writes and no palette quantization.
import {crc32} from './zip.js';
const enc=new TextEncoder(),cat=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;};
function chunk(type,data){const name=enc.encode(type),out=new Uint8Array(data.length+12),v=new DataView(out.buffer);v.setUint32(0,data.length);out.set(name,4);out.set(data,8);v.setUint32(8+data.length,crc32(cat([name,data])));return out;}
export async function artPNG(width,height,pixels,palette=null){
 const channels=palette?1:4;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>32*1024*1024||pixels.length!==width*height*channels)throw new Error('Invalid PNG pixels');
 if(palette&&(palette.length<64||palette.length>1024||palette.length%4||pixels.some(i=>i>=palette.length/4)))throw new Error('Invalid indexed palette');
 const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);v.setUint32(0,width);v.setUint32(4,height);ihdr[8]=8;ihdr[9]=palette?3:6;
 const rows=new Uint8Array((width*channels+1)*height);for(let y=0;y<height;y++)rows.set(pixels.subarray(y*width*channels,(y+1)*width*channels),y*(width*channels+1)+1);
 const zipped=new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr)];
 if(palette){const rgb=new Uint8Array(palette.length/4*3),alpha=new Uint8Array(palette.length/4);for(let i=0;i<alpha.length;i++){rgb.set(palette.subarray(i*4,i*4+3),i*3);alpha[i]=i===0?0:palette[i*4+3];}parts.push(chunk('PLTE',rgb),chunk('tRNS',alpha));}
 return cat([...parts,chunk('IDAT',zipped),chunk('IEND',new Uint8Array())]);
}
export function artZIP(files){
 const names=new Set(),locals=[],central=[];let offset=0;
 for(const {name,data}of files){
  if(!name||name.startsWith('/')||name.split('/').includes('..')||names.has(name))throw new Error('Invalid or duplicate export path');names.add(name);
  const nb=enc.encode(name),crc=crc32(data),local=new Uint8Array(30+nb.length),lv=new DataView(local.buffer);lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,nb.length,true);local.set(nb,30);
  const c=new Uint8Array(46+nb.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,nb.length,true);cv.setUint32(42,offset,true);c.set(nb,46);locals.push(local,data);central.push(c);offset+=local.length+data.length;
 }
 if(files.length>65535||offset>0xffffffff)throw new Error('Export exceeds ZIP limits');const cd=cat(central),end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,cd.length,true);ev.setUint32(16,offset,true);return cat([...locals,cd,end]);
}
export const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
