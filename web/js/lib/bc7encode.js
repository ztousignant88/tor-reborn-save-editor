// BC7 single-subset modes 5/6. Existing native blocks are retained by the importer.
// Bit layouts follow BC7; endpoint fitting extends the project's existing icon encoder.
const W4=[0,4,9,13,17,21,26,30,34,38,43,47,51,55,60,64],W2=[0,21,43,64];
const clamp=n=>Math.max(0,Math.min(255,n));
function distance(a,b){let n=0;for(let c=0;c<a.length;c++)n+=(a[c]-b[c])**2;return n;}
function nearest(p,palette){let best=0,error=Infinity;for(let i=0;i<palette.length;i++){const e=distance(p,palette[i]);if(e<error){best=i;error=e;}}return best;}
function fit(pixels,weights,quantize){
 let a=pixels.reduce((a,p)=>distance(p,pixels[0])>distance(a,pixels[0])?p:a,pixels[0]),b=pixels.reduce((b,p)=>distance(p,a)>distance(b,a)?p:b,pixels[0]),best;
 for(let step=0;step<4;step++){
  const qa=quantize(a),qb=quantize(b),palette=weights.map(w=>qa.map((n,c)=>((64-w)*n+w*qb[c]+32)>>6)),indices=pixels.map(p=>nearest(p,palette)),error=pixels.reduce((sum,p,i)=>sum+distance(p,palette[indices[i]]),0);
  if(!best||error<best.error)best={a:qa,b:qb,indices,error};
  const ts=indices.map(i=>weights[i]/64);let aa=0,bb=0,ab=0;for(const t of ts){aa+=(1-t)**2;bb+=t*t;ab+=t*(1-t);}const det=aa*bb-ab*ab;if(det<1e-8)break;
  const xa=a.map((_,c)=>pixels.reduce((n,p,i)=>n+(1-ts[i])*p[c],0)),xb=a.map((_,c)=>pixels.reduce((n,p,i)=>n+ts[i]*p[c],0));a=xa.map((n,c)=>clamp((bb*n-ab*xb[c])/det));b=xb.map((n,c)=>clamp((aa*n-ab*xa[c])/det));
 }return best;
}
function bitsWriter(prefix,shift){let bits=BigInt(prefix),at=shift;return {put(n,size){bits|=BigInt(n)<<BigInt(at);at+=size;},finish(){if(at!==128)throw new Error('Invalid BC7 bit count');const bytes=new Uint8Array(16);for(let i=0;i<16;i++)bytes[i]=Number(bits>>BigInt(i*8)&255n);return bytes;}};}
function mode6(pixels){
 const quant=p=>{let best;for(let parity=0;parity<2;parity++){const values=p.map(n=>2*Math.max(0,Math.min(127,Math.round((n-parity)/2)))+parity),error=distance(p,values)+((p[3]<.5&&parity||p[3]>254.5&&!parity)?1e6:0);if(!best||error<best.error)best={values,error};}return best.values;};
 let {a,b,indices}=fit(pixels,W4,quant);if(indices[0]>=8){[a,b]=[b,a];indices=indices.map(i=>15-i);}const out=bitsWriter(64,7);for(let c=0;c<4;c++)for(const p of [a,b])out.put(p[c]>>1,7);out.put(a[0]&1,1);out.put(b[0]&1,1);indices.forEach((n,i)=>out.put(n,i?4:3));return out.finish();
}
function mode5(pixels){
 const quant=p=>p.map(n=>{let best=0,error=Infinity;const q=Math.round(n*127/255);for(let x=Math.max(0,q-1);x<=Math.min(127,q+1);x++){const value=(x<<1)|(x>>6),e=Math.abs(value-n);if(e<error){best=value;error=e;}}return best;});
 let {a,b,indices}=fit(pixels.map(p=>p.slice(0,3)),W2,quant),lo=Math.min(...pixels.map(p=>p[3])),hi=Math.max(...pixels.map(p=>p[3])),alphas=W2.map(w=>((64-w)*lo+w*hi+32)>>6),ai=pixels.map(p=>{let k=0;for(let i=1;i<4;i++)if(Math.abs(alphas[i]-p[3])<Math.abs(alphas[k]-p[3]))k=i;return k;});
 if(indices[0]>=2){[a,b]=[b,a];indices=indices.map(i=>3-i);}if(ai[0]>=2){[lo,hi]=[hi,lo];ai=ai.map(i=>3-i);}const out=bitsWriter(32,8);for(let c=0;c<3;c++)for(const p of [a,b])out.put(p[c]>>1,7);out.put(lo,8);out.put(hi,8);for(const stream of [indices,ai])stream.forEach((n,i)=>out.put(n,i?2:1));return out.finish();
}
export function decodeEncodedBC7(bytes){
 let bits=0n;for(let i=0;i<16;i++)bits|=BigInt(bytes[i])<<BigInt(i*8);let at=0;const get=n=>{const v=Number(bits>>BigInt(at)&((1n<<BigInt(n))-1n));at+=n;return v;};let mode=0;while(mode<8&&!get(1))mode++;const a=[],b=[];
 if(mode===6){for(let c=0;c<4;c++){a[c]=get(7);b[c]=get(7);}const pa=get(1),pb=get(1);for(let c=0;c<4;c++){a[c]=(a[c]<<1)|pa;b[c]=(b[c]<<1)|pb;}return Array.from({length:16},(_,i)=>{const w=W4[get(i?4:3)];return a.map((v,c)=>((64-w)*v+w*b[c]+32)>>6);});}
 if(mode!==5||get(2)!==0)throw new Error('Expected encoder BC7 mode 5 or 6');for(let c=0;c<3;c++){const x=get(7),y=get(7);a[c]=(x<<1)|(x>>6);b[c]=(y<<1)|(y>>6);}a[3]=get(8);b[3]=get(8);const ci=Array.from({length:16},(_,i)=>get(i?2:1)),ai=Array.from({length:16},(_,i)=>get(i?2:1));return ci.map((n,i)=>a.map((v,c)=>{const w=W2[c===3?ai[i]:n];return ((64-w)*v+w*b[c]+32)>>6;}));
}
function score(pixels,decoded){let error=0;for(let i=0;i<16;i++){const p=pixels[i],d=decoded[i];for(let c=0;c<3;c++)error+=((p[c]*p[3]-d[c]*d[3])/255)**2;error+=4*(p[3]-d[3])**2;}return error;}
export function encodeBC7Block(pixels){
 if(pixels.length!==16||pixels.some(p=>p.length!==4))throw new Error('Expected a 4×4 RGBA block');const six=mode6(pixels),decoded=decodeEncodedBC7(six),ends=decoded.every((d,i)=>(pixels[i][3]!==0||d[3]===0)&&(pixels[i][3]!==255||d[3]===255));
 if(ends&&pixels.every(p=>p[3]===255))return six;const five=mode5(pixels),d5=decodeEncodedBC7(five);return ends&&score(pixels,decoded)<=score(pixels,d5)?six:five;
}
export const visibleSame=(a,ai,b,bi)=>a[ai+3]===b[bi+3]&&(a[ai+3]===0||a[ai]===b[bi]&&a[ai+1]===b[bi+1]&&a[ai+2]===b[bi+2]);
export async function rebuildTexturePixels(asset,original,imported,progress=()=>{},cache=null){
 const {width:w,height:h}=asset,t=asset.texture;if(original.length!==w*h*4||imported.length!==original.length)throw new Error('Texture pixel dimensions do not match');if(![0,13].includes(asset.format)||asset.raw[18]!==0)throw new Error('PNG import currently supports single-level RGBA and BC7 textures');
 const data=t.data.slice();let changed=0,kept=0;
 if(asset.format===0){for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(original[i]!==imported[i]||original[i+1]!==imported[i+1]||original[i+2]!==imported[i+2]||original[i+3]!==imported[i+3]){data.set(imported.subarray(i,i+4),y*t.stride+x*4);changed++;}else kept++;}return {data,changed,kept,unit:'pixels'};}
 const total=Math.ceil(w/4)*Math.ceil(h/4);let n=0,nextYield=performance.now()+40;
 for(let by=0;by<h;by+=4)for(let bx=0;bx<w;bx+=4){let differs=false;for(let y=by;y<Math.min(h,by+4);y++)for(let x=bx;x<Math.min(w,bx+4);x++){const i=(y*w+x)*4;if(!visibleSame(original,i,imported,i))differs=true;}
  if(differs){const pixels=Array.from({length:16},(_,i)=>{const at=(Math.min(h-1,by+(i>>2))*w+Math.min(w-1,bx+i%4))*4;return [...imported.subarray(at,at+4)];}),key=cache?String.fromCharCode(...pixels.flat()):null;let block=cache?.get(key);if(!block){block=encodeBC7Block(pixels);if(cache&&cache.size<65536)cache.set(key,block);}data.set(block,(by/4)*t.stride+(bx/4)*16);changed++;}else kept++;
  n++;if(performance.now()>=nextYield){progress(`Rebuilding texture blocks ${n.toLocaleString()}/${total.toLocaleString()}…`);await new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});nextYield=performance.now()+40;}
 }return {data,changed,kept,unit:'blocks'};
}
