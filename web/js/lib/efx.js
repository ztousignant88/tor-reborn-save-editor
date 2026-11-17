// Reborn EFX0011 reader. All offsets refer to the unmodified native data.
// Layout cross-checked against the game's loader (4A1740/4A3F20/4A4280).
const dv=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const fail=message=>{throw new Error(`EFX: ${message}`);};

export function decompressMlz(b){
  const v=dv(b);
  if(b.length<8||v.getUint32(0,true)!==0x305a4c4d)fail('missing MLZ0 header');
  const size=v.getUint32(4,true);
  if(size>64*1024*1024)fail('oversized effect');
  const out=new Uint8Array(size);let p=8,q=0;
  const next=()=>p<b.length?b[p++]:fail('truncated compressed stream');
  const length=n=>{if(n===15){let x;do{n+=x=next();}while(x===255);}return n;};
  while(p<b.length){
    const token=next(),l=length(token>>>4);
    if(p+l>b.length||q+l>size)fail('literal outside buffer');
    out.set(b.subarray(p,p+l),q);p+=l;q+=l;
    if(p===b.length)break;
    const offset=next()|next()<<8,n=length(token&15)+4;
    if(!offset||offset>q||q+n>size)fail('invalid back reference');
    for(let j=0;j<n;j++,q++)out[q]=out[q-offset];
  }
  if(q!==size)fail('decompressed size mismatch');
  return out;
}

export function parseEfx(b){
  if(new TextDecoder().decode(b.subarray(0,7))!=='EFX0011')fail('unsupported header');
  const v=dv(b),metas=new Map(),generators=new Map(),elements=new Map(),resources=new Map(),attachments=new Map();
  if(v.getUint32(12,true)!==b.length)fail('effect size mismatch');
  let chunks=0;
  for(let p=16;p<b.length;){
    if(p+12>b.length)fail('truncated chunk');
    const size=v.getUint32(p,true),op=v.getUint16(p+6,true),tail=v.getUint32(p+8,true);
    if(size<16||p+size>b.length||v.getUint16(p+4,true)!==0x100)fail('invalid chunk');
    const data=b.subarray(p+12,p+size),d=dv(data),id=d.getUint16(0,true);
    if(op===0x600)metas.set(id,{id,pages:data.slice(13,29),
      initialPage:data[4],cuePages:data.slice(5,11),finishPage:data[11],resultPage:data[12],
      cueFrames:Array.from({length:7},(_,i)=>d.getInt16(36+i*2,true)),
      resultFrame:d.getInt16(50,true),resultEndFrame:d.getInt16(54,true),
      perResult:!!data[30],intervalFromResultEnd:!!data[31],
      raw:data.slice(4,56),schedulers:[]});
    else if(op===0x620){
      const meta=metas.get(id);if(!meta)fail('scheduler without meta');
      const s={page:data[2],id:data[3],type:data[4],start:d.getInt32(24,true),end:d.getInt32(28,true)};
      if(s.type===1)Object.assign(s,{generator:d.getUint16(32,true),element:d.getUint16(34,true)});
      if(s.type===2){s.events=[];for(let j=0;j<data[32];j++){
        const o=36+j*20;s.events.push({type:data[o],time:d.getUint16(o+2,true),args:Array.from({length:4},(_,k)=>d.getInt32(o+4+k*4,true))});
      }}
      meta.schedulers.push(s);
    }else if(op===0x800||op===0xa00||op===0x700){
      const body=data.subarray(4);
      if(tail>body.length)fail('curve data outside chunk');
      (op===0x800?generators:op===0xa00?elements:attachments).set(id,{id,kind:data[2],body,tail:body.subarray(tail)});
    }else if(op===0xb00)resources.set(`${data[2]}:${data[3]}`,data.subarray(4));
    p+=size;chunks++;
  }
  return {metas,generators,elements,resources,attachments,chunks};
}

export function readCurve(def,at,integer=false){
  const v=dv(def.body),t=dv(def.tail),sides=[];
  for(let side=0;side<2;side++){
    const offset=Number(v.getBigUint64(at+side*8,true)),count=def.body[at+20+side];
    if(!Number.isSafeInteger(offset)||offset+count*8>t.byteLength)fail('curve keys outside chunk');
    sides.push(Array.from({length:count},(_,j)=>[t.getInt32(offset+j*8,true),integer?t.getInt32(offset+j*8+4,true):t.getFloat32(offset+j*8+4,true)]));
  }
  return {sides,integer,randomMode:def.body[at+24],interpolation:[def.body[at+22],def.body[at+23]],loop:[v.getUint16(at+16,true),v.getUint16(at+18,true)]};
}

// 4FEAA0/4FF6E0: the second side is usually a random RANGE, not an upper bound.
export function curveRange(c,a,b,r){
  const n=c.randomMode??5;
  const x=n===0?a:n===1?a+b*r:n===2?a-b*r:n===3?a+b*(2*r-1):n===4?a*(1+b*r):n===5?a+(b-a)*r:a;
  return c.integer?Math.trunc(x):x;
}
// Native interpolation 1 is a quadratic B-spline (4FE7E0 -> 40C950/40C8A0),
// including time inversion. It is not a cubic or Catmull-Rom interpolant.
export function sampleCurve(c,t,random=0.5){
  const side=(keys,i)=>{
    if(!keys.length)return 0;if(keys.length===1)return keys[0][1];
    const period=c.loop[i];let tick=t;if(period&&tick>period)tick%=period;
    if(tick<=keys[0][0])return keys[0][1];
    if(c.interpolation[i]===1&&keys.length>2){
      const k=keys.findIndex(p=>p[0]>=tick);if(k<0)return keys.at(-1)[1];
      const mid=keys[k-1][0]+Math.trunc((keys[k][0]-keys[k-1][0])/2);
      const j=tick<=mid?k-2:k-1;
      if(j>=0&&j+2<keys.length){
        const [p,q,s]=keys.slice(j,j+3),a=p[0]-2*q[0]+s[0],b=q[0]-p[0],d=p[0]+q[0]-2*tick;
        const u=a?(-b+Math.sqrt(Math.max(0,b*b-a*d)))/a:(2*tick-p[0]-q[0])/(s[0]-p[0]);
        return (1-u)*(1-u)*p[1]/2+((1-u)*u+0.5)*q[1]+u*u*s[1]/2;
      }
    }
    for(let k=1;k<keys.length;k++)if(tick<keys[k][0]){
      const [a,x]=keys[k-1],[b,y]=keys[k];return x+(y-x)*(tick-a)/(b-a);
    }
    return keys.at(-1)[1];
  };
  const a=side(c.sides[0],0);if(!c.sides[1].length)return c.integer?Math.trunc(a):a;return curveRange(c,a,side(c.sides[1],1),random);
}

// Native 4FED30: vector modes include explicit zero/one vectors and linked
// axes. Empty Y/Z curves in a uniform scale do NOT mean zero-sized geometry.
export function readVector(def,at){
  const b=def.body;
  return {curves:[0,32,64].map(o=>readCurve(def,at+o)),mode:b[at+0x62],linked:!!b[at+0x60],range:!!b[at+0x61],groups:[b[at+0x63],b[at+0x64]]};
}
export function sampleVector(c,t,r=0.5){
  if(c.mode===0)return [0,0,0];if(c.mode===1)return [1,1,1];
  const side=s=>c.curves.map(x=>sampleCurve({...x,randomMode:0,sides:[x.sides[s],[]],interpolation:[x.interpolation[s],0],loop:[x.loop[s],0]},t));
  const indices=g=>g===1?[0,0,2]:g===2?[0,1,0]:g===3?[0,1,1]:[0,0,0];
  const a=side(0),b=side(1),base=c.linked?indices(c.groups[0]).map(i=>a[i]):a;
  const ranges=c.range?indices(c.groups[1]):[0,1,2];
  // Grouping applies to the range's curve AND its random operation, not
  // only the numeric range value. In particular uniform random scale must
  // use X's operation on all three axes (native 4FEE79/4FF192).
  return base.map((n,i)=>curveRange(c.curves[ranges[i]],n,b[ranges[i]],r));
}
// Native 4FE330 also has a precomputed packed colour and HSV mode.
export function readColor(def,at){
  const b=def.body;
  return {curves:[0,32,64,96].map(o=>readCurve(def,at+o,true)),constant:b[at+0x83]?Array.from(b.slice(at+0x88,at+0x8c)):null,linked:!!b[at+0x80],hsv:!!b[at+0x82]};
}
export function sampleColor(c,t,r=0.5){
  if(c.constant)return c.constant.slice();
  const a=c.curves.map(x=>sampleCurve(x,t,r));if(c.linked)a[1]=a[2]=a[0];
  if(!c.hsv)return a;
  const h=((a[0]%360)+360)%360/60,s=Math.min(255,a[1])/255,z=Math.min(255,a[2])/255,k=Math.floor(h),f=h-k,p=z*(1-s),q=z*(1-s*f),u=z*(1-s*(1-f));
  const rgb=[[z,u,p],[q,z,p],[p,z,u],[p,q,z],[u,p,z],[z,p,q]][k];return [...rgb.map(n=>n*255),a[3]];
}

export function readShapes(raw){
  const v=dv(raw),count=v.getUint16(0,true),n=raw[2];
  if(8+count*128+n>raw.length)fail('truncated shape resource');
  const textures=raw.slice(8+count*128,8+count*128+n);
  const quads=Array.from({length:count},(_,i)=>{
    const o=8+i*128;
    return {points:Array.from({length:4},(_,j)=>Array.from({length:3},(_,k)=>v.getFloat32(o+j*16+k*4,true))),
      uv:Array.from({length:4},(_,j)=>[v.getFloat32(o+64+j*8,true),v.getFloat32(o+68+j*8,true)]),colors:Array.from({length:4},()=>Array.from(raw.slice(o+0x60,o+0x64),x=>x/128)),texture:textures[raw[o+0x71]],flags:raw[o+0x70]};
  });
  // Native 508F00: bit 0 starts a frame; bit 1 ends the list. Frames may
  // contain several quads (not one quad per frame). +71 selects the texture.
  const frames=[];
  for(const q of quads){if(q.flags&1||!frames.length)frames.push([]);frames.at(-1).push(q);}
  quads.frames=frames;quads.frameCount=v.getUint16(4,true);
  if(frames.length!==quads.frameCount)fail('shape frame markers disagree with header');
  return quads;
}

export function shapeFrame(raw,t,{mode=0}={}){
  const v=dv(raw),count=v.getUint16(0,true);
  if(4+count*16>raw.length)fail('truncated sprite track');
  let i=0,elapsed=0,last=0;const seen=new Map();
  // Skip complete cycles when seeking. A jump with no elapsed time is invalid,
  // rather than a reason to hang the browser on a malformed/custom resource.
  for(let steps=0;steps<8192&&i<count;steps++){
    if(seen.has(i)){
      const period=elapsed-seen.get(i);
      if(period<=0)fail('zero-time sprite-track cycle');
      const cycles=Math.floor((t-elapsed)/period);
      if(cycles>0)elapsed+=cycles*period;
      seen.clear();
    }
    seen.set(i,elapsed);
    const o=4+i*16,type=raw[o+8];
    if(type===0){last=v.getUint16(o+10,true);elapsed+=raw[o+9];if(t<elapsed)return last;i++;}
    else if(type===1){const target=v.getInt16(o+12,true);if(target<0||target>=count)fail('sprite-track jump outside resource');if(target===i)return last;i=target;}
    else if(type===2){if(mode===2)return null;if(mode!==1)return last;i=0;}
    else fail(`unknown sprite-track opcode ${type}`);
  }
  return last;
}

export function spriteTrackDuration(raw){
  const v=dv(raw),count=v.getUint16(0,true);if(4+count*16>raw.length)fail('truncated sprite track');
  let total=0;for(let i=0;i<count;i++){const o=4+i*16;if(raw[o+8]===0)total+=raw[o+9];}return total;
}

// Native 4FF940/4FFB00. An absent material is not a white texture. Type 4
// preset 0 is explicitly the game's white texture; presets 1/2 are separate
// global textures supplied by the renderer and must not use that fallback.
export function readMaterial(def,at){
  const b=def.body;
  return {type:b[at+0x118],texture:b[at+0x11a],shape:b[at+0x11d],track:b[at+0x11e],blend:b[at+0x11f],preset:b[at+0x120],mode:b[at+0x125],
    scroll:readVector(def,at),color:readColor(def,at+0x68)};
}

// Native unskinned model resource 54: indexed triangles/quads, vertex colours
// and UVs. Retain face colours for the soft, untextured Exorcism layer.
export function readModel(raw){
  const v=dv(raw),tri=v.getUint16(4,true),quad=v.getUint16(6,true),n=v.getUint16(8,true),normals=v.getUint16(10,true),nc=v.getUint16(12,true),nu=v.getUint16(14,true),nt=v.getUint16(16,true),extra=v.getUint16(18,true);
  let at=20;const points=Array.from({length:n},(_,i)=>Array.from({length:3},(_,k)=>v.getFloat32(at+i*16+k*4,true)));at+=n*16+normals*16;
  const colors=Array.from({length:nc},(_,i)=>Array.from(raw.slice(at+i*4,at+i*4+4),x=>x/128));at+=nc*4;
  const uv=Array.from({length:nu},(_,i)=>[v.getFloat32(at+i*8,true),v.getFloat32(at+i*8+4,true)]);at+=nu*8+extra*20;
  if(!(raw[0]&1))fail('unsupported non-indexed model');
  const count=tri*3+quad*4,indices=Array.from({length:count},(_,i)=>v.getInt16(at+i*2,true));at+=count*2;
  // The second indexed stream selects NORMALS, not UVs/colours. Native
  // 505A20 walks the colour/UV streams in face-corner order. Normal indices
  // can exceed both counts (common model 5 has 30 normals but 21 corners).
  const normalIndices=Array.from({length:count},(_,i)=>v.getInt16(at+i*2,true));at+=count*2;
  const faces=[],faceTextures=raw.slice(at,at+tri+quad);at+=tri+quad;
  const textures=raw.slice(at,at+nt);let start=0;
  for(let i=0;i<tri+quad;i++){
    const size=i<tri?3:4,ids=indices.slice(start,start+size),corners=Array.from({length:size},(_,j)=>start+j);if(size===3){ids.push(ids[2]);corners.push(corners[2]);}
    if(ids.some(x=>x<0||x>=n)||corners.some(x=>x>=nu&&nu||x>=nc&&nc))fail('model face outside vertex data');
    faces.push({points:ids.map(x=>points[x]),uv:corners.map(x=>uv[x]??[0,0]),colors:corners.map(x=>colors[x]??[1,1,1,1]),texture:textures[faceTextures[i]]??null,normalIndices:normalIndices.slice(start,start+size)});start+=size;
  }
  return faces;
}

// Flat, untextured, white gradient meshes are flash panels, including the
// separate copies in magic banks. Do not identify them by resource number.
export function isLightPanel(faces){
  if(faces.length<2)return false;
  const points=faces.flatMap(f=>f.points),colors=faces.flatMap(f=>f.colors??[]);
  if(!colors.length||faces.some(f=>f.texture!==null&&f.texture!==undefined))return false;
  if(colors.some(c=>c.slice(0,3).some(n=>Math.abs(n-1)>0.01)))return false;
  if(!colors.some(c=>c[3]<0.01)||!colors.some(c=>c[3]>0.05))return false;
  const a=points[0];let normal=null;
  for(let i=1;i<points.length&&!normal;i++)for(let j=i+1;j<points.length;j++){
    const b=points[i].map((n,k)=>n-a[k]),c=points[j].map((n,k)=>n-a[k]),v=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]],length=Math.hypot(...v);
    if(length>1e-6){normal=v.map(n=>n/length);break;}
  }
  return !!normal&&points.every(p=>Math.abs(p.reduce((s,n,k)=>s+(n-a[k])*normal[k],0))<1e-5);
}
