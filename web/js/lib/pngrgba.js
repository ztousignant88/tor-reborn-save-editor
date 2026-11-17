// Decode PNG samples directly, without canvas colour changes or alpha premultiplication.
import {crc32}from './zip.js';
export async function readRGBAPNG(bytes,{width:expectedW,height:expectedH}={}){
 const signature=[137,80,78,71,13,10,26,10];if(bytes.length<45||signature.some((n,i)=>bytes[i]!==n))throw new Error('Choose a PNG image');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),chunks=[];let width,height,depth,type,channels,palette,alpha,interlace,header=false,end=false;
 for(let at=8;at+12<=bytes.length;){const size=v.getUint32(at),next=at+12+size;if(next>bytes.length)throw new Error('Truncated PNG');const name=new TextDecoder().decode(bytes.subarray(at+4,at+8)),d=bytes.subarray(at+8,at+8+size);if(crc32(bytes.subarray(at+4,at+8+size))!==v.getUint32(at+8+size))throw new Error('PNG checksum failed');
  if(name==='IHDR'){if(header||at!==8||size!==13)throw new Error('Invalid PNG header');header=true;const h=new DataView(d.buffer,d.byteOffset,d.byteLength);width=h.getUint32(0);height=h.getUint32(4);depth=d[8];type=d[9];interlace=d[12];channels={0:1,2:3,3:1,4:2,6:4}[type];const depths=type===3?[1,2,4,8]:type===0?[1,2,4,8,16]:[8,16];if(!channels||!depths.includes(depth)||d[10]||d[11]||interlace>1)throw new Error('Unsupported PNG encoding');if(!width||!height||width*height>32*1024*1024)throw new Error('PNG is too large');if(expectedW!=null&&width!==expectedW||expectedH!=null&&height!==expectedH)throw new Error(`Keep the native size: ${expectedW} × ${expectedH}. This image is ${width} × ${height}; colour conversion does not resize or rearrange sprite frames.`);}
  else if(!header)throw new Error('Missing PNG header');
  else if(name==='PLTE'){if(palette||chunks.length||!size||size%3||size>768)throw new Error('Invalid PNG palette');palette=d;}
  else if(name==='tRNS'){if(alpha||chunks.length)throw new Error('Invalid PNG transparency');alpha=d;}
  else if(name==='IDAT')chunks.push(d);
  else if(name==='IEND'){if(size)throw new Error('Invalid PNG end');end=true;break;}
  else if(name==='acTL')throw new Error('Animated PNG is not supported; import a still image');
  else if(name[0]===name[0].toUpperCase())throw new Error('Unsupported critical PNG chunk');at=next;
 }
 if(!header||!end||!chunks.length||type===3&&(!palette||palette.length/3>2**depth))throw new Error('Incomplete PNG');
 if(alpha&&(type===0?alpha.length!==2:type===2?alpha.length!==6:type===3?alpha.length>palette.length/3:true))throw new Error('Invalid PNG transparency');
 const passes=(interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]]).map(([x,y,dx,dy])=>({x,y,dx,dy,w:Math.max(0,Math.ceil((width-x)/dx)),h:Math.max(0,Math.ceil((height-y)/dy))})).filter(p=>p.w&&p.h);
 const expected=passes.reduce((n,p)=>n+(1+Math.ceil(p.w*channels*depth/8))*p.h,0),bpp=Math.max(1,Math.ceil(channels*depth/8)),reader=new Blob(chunks).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),parts=[];let length=0;
 for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>expected){await reader.cancel();throw new Error('PNG pixel stream is too large');}parts.push(r.value);}if(length!==expected)throw new Error('PNG pixel stream size mismatch');const packed=new Uint8Array(length);let offset=0;for(const p of parts){packed.set(p,offset);offset+=p.length;}
 const rgba=new Uint8Array(width*height*4),indices=type===3?new Uint8Array(width*height):null,av=alpha?new DataView(alpha.buffer,alpha.byteOffset,alpha.byteLength):null,max=2**depth-1,byte=n=>Math.round(n*255/max),paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};offset=0;
 for(const p of passes){const rowBytes=Math.ceil(p.w*channels*depth/8);let previous=new Uint8Array(rowBytes),row=new Uint8Array(rowBytes);
  for(let y=0;y<p.h;y++){const filter=packed[offset++];if(filter>4)throw new Error('Invalid PNG filter');for(let x=0;x<rowBytes;x++){const a=x>=bpp?row[x-bpp]:0,b=previous[x],c=x>=bpp?previous[x-bpp]:0;row[x]=(packed[offset++]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}
   const sample=i=>depth===16?row[i*2]*256+row[i*2+1]:depth===8?row[i]:row[i*depth>>3]>>(8-depth-(i*depth&7))&max;
   for(let x=0;x<p.w;x++){const pixel=(p.y+y*p.dy)*width+p.x+x*p.dx,out=pixel*4,i=x*channels,a=sample(i);
    if(type===6)rgba.set([byte(a),byte(sample(i+1)),byte(sample(i+2)),byte(sample(i+3))],out);
    else if(type===2){const g=sample(i+1),b=sample(i+2);rgba.set([byte(a),byte(g),byte(b),av&&a===av.getUint16(0)&&g===av.getUint16(2)&&b===av.getUint16(4)?0:255],out);}
    else if(type===4)rgba.set([byte(a),byte(a),byte(a),byte(sample(i+1))],out);
    else if(type===0)rgba.set([byte(a),byte(a),byte(a),av&&a===av.getUint16(0)?0:255],out);
    else{if(a*3+2>=palette.length)throw new Error('PNG refers to a missing palette colour');indices[pixel]=a;rgba.set([palette[a*3],palette[a*3+1],palette[a*3+2],alpha?.[a]??255],out);}
   }[previous,row]=[row,previous];
  }
 }return {width,height,rgba,indices,palette,alpha,png:{colourType:type,bitDepth:depth,interlaced:!!interlace}};
}
export function indexedPaletteMatches(image,expected){if(!image.indices||!expected)return false;for(let i=0;i<image.palette.length/3;i++)if(i*4+3>=expected.length||image.palette[i*3]!==expected[i*4]||image.palette[i*3+1]!==expected[i*4+1]||image.palette[i*3+2]!==expected[i*4+2]||(image.alpha?.[i]??255)!==(i===0?0:expected[i*4+3]))return false;return true;}
export function spritePNGCorrection(message){const error=new Error(message);error.code='SPRITE_PNG_CORRECTION';return error;}
