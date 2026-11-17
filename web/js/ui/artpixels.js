import {textureRGBA} from './texcanvas.js';
export function artPixels(asset,palette){
 if(asset.kind==='indexed'){
  const colors=palette??asset.palettes[0];if(!colors)throw new Error('No palette is available for this sheet');
  const out=new Uint8Array(asset.width*asset.height*4);for(let i=0;i<asset.sheet.indices.length;i++){const k=asset.sheet.indices[i];if(k){if(k*4+4>colors.length)throw new Error('Pixel index outside palette');out.set(colors.subarray(k*4,k*4+4),i*4);}}return out;
 }
 let t=asset.texture;const rows=t.format===0?t.height:Math.ceil(t.height/4),stride=t.format===0?t.width*4:Math.ceil(t.width/4)*(t.format===7?8:16);
 if(t.stride!==stride){const data=new Uint8Array(rows*stride);for(let y=0;y<rows;y++)data.set(t.data.subarray(y*t.stride,y*t.stride+stride),y*stride);t={...t,stride,data};}
 if(t.format===0||t.format===13)return textureRGBA(t);
 const out=new Uint8Array(t.width*t.height*4),v=new DataView(t.data.buffer,t.data.byteOffset,t.data.byteLength),rgb=n=>[Math.round((n>>11&31)*255/31),Math.round((n>>5&63)*255/63),Math.round((n&31)*255/31),255];
 for(let by=0;by<Math.ceil(t.height/4);by++)for(let bx=0;bx<Math.ceil(t.width/4);bx++){
  const at=by*stride+bx*(t.format===7?8:16),co=at+(t.format===7?0:8),a=v.getUint16(co,true),b=v.getUint16(co+2,true),c=[rgb(a),rgb(b)],bits=v.getUint32(co+4,true);
  if(a>b||t.format!==7)c.push(c[0].map((n,i)=>i===3?255:Math.floor((2*n+c[1][i])/3)),c[0].map((n,i)=>i===3?255:Math.floor((n+2*c[1][i])/3)));else c.push(c[0].map((n,i)=>i===3?255:Math.floor((n+c[1][i])/2)),[0,0,0,0]);
  const alpha=[t.data[at],t.data[at+1]];
  if(t.format===9){if(alpha[0]>alpha[1])for(let i=1;i<=6;i++)alpha.push(Math.floor(((7-i)*alpha[0]+i*alpha[1])/7));else{for(let i=1;i<=4;i++)alpha.push(Math.floor(((5-i)*alpha[0]+i*alpha[1])/5));alpha.push(0,255);}}
  let ab=0n;if(t.format===9)for(let i=0;i<6;i++)ab|=BigInt(t.data[at+2+i])<<BigInt(i*8);
  for(let k=0;k<16;k++){const x=bx*4+k%4,y=by*4+Math.floor(k/4);if(x>=t.width||y>=t.height)continue;const pixel=[...c[bits>>>(k*2)&3]];if(t.format===8)pixel[3]=(t.data[at+(k>>1)]>>((k&1)*4)&15)*17;if(t.format===9)pixel[3]=alpha[Number(ab>>BigInt(k*3)&7n)];out.set(pixel,(y*t.width+x)*4);}
 }return out;
}
