// Native second mesh block: a painted picture with per-vertex UV and position.
// Boat scenes retain their animated terrain underneath this transparent layer.
import { view } from '../lib/pakd.js';

export function readPaintLayer(scene, meshStart) {
  const v=view(scene), offset=v.getUint32(meshStart+0x2c,true);
  if(!offset)return null;
  const b=meshStart+0x20+offset;
  if(b+0x24>scene.length)return null;
  const vb=b+v.getUint32(b+0x18,true);
  if(vb+32>scene.length)return null;
  const count=v.getUint32(vb+4,true),stride=v.getUint32(vb+8,true),head=v.getUint32(vb+12,true);
  if(stride!==20||count%3||head<16||vb+head+count*stride>scene.length)return null;
  const batchCount=v.getUint16(b+8,true),batchAt=b+v.getUint32(b+0x1c,true),materialAt=b+v.getUint32(b+0x0c,true),batches=[];
  for(let i=0;i<batchCount;i++){
    const at=batchAt+i*48,n=v.getUint32(at,true),byteOffset=v.getUint32(at+4,true),texture=v.getUint16(materialAt+i*48,true);
    if(byteOffset%stride||n%3||byteOffset/stride+n>count)throw new Error('invalid painted layer batch');
    batches.push({first:byteOffset/stride,count:n,texture});
  }
  const data=scene.slice(vb+head,vb+head+count*stride), f=new Float32Array(data.buffer);
  if(!f.every(Number.isFinite))throw new Error('invalid painted layer coordinates');
  const vertices=new Uint8Array(count*36), w=view(vertices);
  for(let i=0;i<count;i++){
    const p=i*5,o=i*36;
    for(let k=0;k<3;k++)w.setFloat32(o+k*4,f[p+2+k],true);
    w.setFloat32(o+16,1,true);vertices.set([255,255,255,255],o+24);
    w.setFloat32(o+28,f[p],true);w.setFloat32(o+32,f[p+1],true);
  }
  // A horizontal triangle determines the native screen projection. On a flat
  // boat plane, its foreshortening also determines the camera pitch exactly.
  let fit=null;
  for(let i=0;i<count;i+=3){
    const p=i*5,a=p+5,c=p+10;
    if(Math.abs(f[a+3]-f[p+3])+Math.abs(f[c+3]-f[p+3])>1e-5)continue;
    const dx=f[a+2]-f[p+2],dz=f[a+4]-f[p+4],ex=f[c+2]-f[p+2],ez=f[c+4]-f[p+4],det=dx*ez-ex*dz;
    if(Math.abs(det)<1e-5)continue;
    const ux=((f[a]-f[p])*ez-(f[c]-f[p])*dz)/det;
    const uz=(dx*(f[c]-f[p])-ex*(f[a]-f[p]))/det;
    const vx=((f[a+1]-f[p+1])*ez-(f[c+1]-f[p+1])*dz)/det;
    const vz=(dx*(f[c+1]-f[p+1])-ex*(f[a+1]-f[p+1]))/det;
    const scale=Math.hypot(ux,uz),sin=Math.hypot(vx,vz)/scale;
    if(!(scale>0&&sin>0&&sin<1))continue;
    const pitch=Math.asin(sin),vy=-Math.cos(pitch)*scale;
    fit={yaw:Math.atan2(-uz,ux),pitch,scale,ox:f[p]-ux*f[p+2]-uz*f[p+4],oy:f[p+1]-vx*f[p+2]-vy*f[p+3]-vz*f[p+4],score:1};
    break;
  }
  const flat=count>0&&f.every((x,i)=>i%5!==3||Math.abs(x-f[3])<1e-5);
  const camera=fit;
  if(fit){
    // Each material has its own UV origin: sails and hull must not be tested
    // as one full-atlas affine picture. The first batch establishes the camera.
    for(let p=0;p<(batches[0]?.count??count)*5;p+=5){
      const u=fit.ox+(f[p+2]*Math.cos(fit.yaw)-f[p+4]*Math.sin(fit.yaw))*fit.scale;
      const y=fit.oy+(f[p+2]*Math.sin(fit.pitch)*Math.sin(fit.yaw)-f[p+3]*Math.cos(fit.pitch)+f[p+4]*Math.sin(fit.pitch)*Math.cos(fit.yaw))*fit.scale;
      if(Math.abs(u-f[p])>1e-5||Math.abs(y-f[p+1])>1e-5){fit=null;break;}
    }
  }
  return {count,vertices,flat,projection:fit,camera,batches};
}
