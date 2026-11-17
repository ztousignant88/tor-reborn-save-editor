// Optional portrait adjustments. All attempts start from the supplied pixels;
// previews remain separate from project/game writes and the source PNG.
import {rebuildTexturePixels}from '../lib/bc7encode.js';
import {parsePakd,view}from '../lib/pakd.js';
import {decompressAshg}from '../lib/ashg.js';
import {literalAshg}from '../lib/artrebuild.js';
export const PORTRAIT_LIMIT=0x28000;
export const isPortraitAsset=(path,asset)=>asset?.kind==='texture'&&asset.width===512&&asset.height===512&&/^(?:object\/[^/]+[0-9]{2}\.dat|menu\/menu_classface\.dat)$/i.test(path);
export function portraitSizeError(path,size){return Object.assign(new Error(`Portrait in ${path} is ${size.toLocaleString()} bytes after compression; the game limit is 163,840 bytes (160 KiB). Choose Reduce fine detail or Shrink inside canvas to build an adjusted preview.`),{code:'PORTRAIT_SIZE',path,bytes:size,limit:PORTRAIT_LIMIT});}
function context(pack,asset){
 let d=pack,last=null;
 for(const step of asset.locator){
  if(step.type==='pakd'){const e=parsePakd(d).entries[step.index];if(!e||e.id!==step.id)throw new Error('Portrait resource changed');d=e.data;last=null;}
  else if(step.type==='ashg'){const expanded=decompressAshg(d);last={template:d,expanded};d=expanded;}
  else if(step.type==='btx')return last?{...last,offset:step.offset}:null;
  else return null;
 }return null;
}
function compressedSize(ctx,data){const next=ctx.expanded.slice(),v=view(next),at=ctx.offset+v.getUint32(ctx.offset+24,true);if(at+data.length>next.length)throw new Error('Portrait pixels exceed native resource');next.set(data,at);return literalAshg(next,ctx.template).length;}
// Area averaging in premultiplied colour avoids dark fringes around alpha.
function resize(rgba,w,h,nw,nh){
 const out=new Uint8Array(nw*nh*4),sx=w/nw,sy=h/nh;
 for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){let alpha=0,r=0,g=0,b=0,area=0;const x0=x*sx,x1=(x+1)*sx,y0=y*sy,y1=(y+1)*sy;
  for(let iy=Math.floor(y0);iy<Math.ceil(y1)&&iy<h;iy++)for(let ix=Math.floor(x0);ix<Math.ceil(x1)&&ix<w;ix++){const weight=(Math.min(x1,ix+1)-Math.max(x0,ix))*(Math.min(y1,iy+1)-Math.max(y0,iy)),at=(iy*w+ix)*4,a=rgba[at+3]*weight;area+=weight;alpha+=a;r+=rgba[at]*a;g+=rgba[at+1]*a;b+=rgba[at+2]*a;}
  const at=(y*nw+x)*4;if(alpha){out[at]=Math.round(r/alpha);out[at+1]=Math.round(g/alpha);out[at+2]=Math.round(b/alpha);}out[at+3]=Math.round(alpha/area);
 }return out;
}
export function adjustPortrait(rgba,w,h,{resolution=w,bits=8,scale=1}={}){
 if(rgba.length!==w*h*4||!Number.isInteger(resolution)||resolution<1||resolution>w||!Number.isInteger(bits)||bits<1||bits>8||!Number.isFinite(scale)||scale<=0||scale>1)throw new Error('Invalid portrait adjustment');
 const out=new Uint8Array(rgba.length);
 if(scale<1){const nw=Math.max(1,Math.round(w*scale)),nh=Math.max(1,Math.round(h*scale)),small=resize(rgba,w,h,nw,nh),dx=Math.floor((w-nw)/2),dy=h-nh;for(let y=0;y<nh;y++)out.set(small.subarray(y*nw*4,(y+1)*nw*4),((y+dy)*w+dx)*4);return out;}
 const nh=Math.max(1,Math.round(h*resolution/w)),small=resolution<w?resize(rgba,w,h,resolution,nh):rgba,levels=(1<<bits)-1;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=(y*w+x)*4,p=(Math.floor(y*nh/h)*resolution+Math.floor(x*resolution/w))*4;out[at+3]=rgba[at+3];if(!out[at+3])continue;for(let c=0;c<3;c++)out[at+c]=Math.round(Math.round(small[p+c]*levels/255)*255/levels);}
 return out;
}
export function portraitFitNote(fit){if(!fit)return '';return `${fit.description} Compressed portrait: ${fit.beforeBytes.toLocaleString()} → ${fit.afterBytes.toLocaleString()} bytes; game limit 163,840 bytes. The supplied PNG is unchanged. Review the adjusted preview before saving.`;}
export async function prepareTexturePixels({path,pack,asset,original,rgba,fitPortraits='off',progress=()=>{},cache=null,adjustments=null}){
 if(!['off','detail','shrink'].includes(fitPortraits))throw new Error('Unknown portrait fitting option');
 let encoded=await rebuildTexturePixels(asset,original,rgba,progress,cache);
 if(!isPortraitAsset(path,asset))return {encoded,rgba,fit:null};
 const ctx=context(pack,asset);if(!ctx)return {encoded,rgba,fit:null};
 const beforeBytes=encoded.changed?compressedSize(ctx,encoded.data):ctx.template.length;
 if(beforeBytes<=PORTRAIT_LIMIT)return {encoded,rgba,fit:null};
 if(fitPortraits==='off')throw portraitSizeError(path,beforeBytes);
 const stored=adjustments?.get(rgba)?.[fitPortraits];
 const candidates=fitPortraits==='detail'?[{bits:7},{bits:6},{bits:5},{resolution:384,bits:7},{resolution:256,bits:7},{resolution:192,bits:6},{resolution:128,bits:6},{resolution:96,bits:5},{resolution:64,bits:4}]:[.95,.9,.85,.8,.75,.67,.5,.375,.25].map(scale=>({scale}));
 if(stored)candidates.unshift(stored.settings);
 for(const settings of candidates){
  progress(`Trying portrait adjustment: ${settings.scale?Math.round(settings.scale*100)+'% size':(settings.resolution??asset.width)+' pixels, '+(settings.bits??8)+'-bit colour detail'}…`);
  const adjusted=stored&&settings===stored.settings?stored.rgba:adjustPortrait(rgba,asset.width,asset.height,settings);encoded=await rebuildTexturePixels(asset,original,adjusted,progress,cache);const afterBytes=encoded.changed?compressedSize(ctx,encoded.data):ctx.template.length;
  if(afterBytes>PORTRAIT_LIMIT)continue;
  const description=settings.scale?`Portrait shrunk to ${Math.round(settings.scale*100)}%, centred horizontally and aligned to the bottom of the original canvas.`:`Portrait size and alpha outline retained; ${settings.resolution??asset.width} × ${settings.resolution??asset.width} colour detail and ${2**settings.bits} levels per colour channel.`;
  const fit={mode:fitPortraits,settings,beforeBytes,afterBytes,limit:PORTRAIT_LIMIT,description};if(adjustments){const byMode=adjustments.get(rgba)??{};byMode[fitPortraits]={settings,rgba:adjusted};adjustments.set(rgba,byMode);}return {encoded,rgba:adjusted,fit};
 }
 throw Object.assign(portraitSizeError(path,beforeBytes),{message:`No tested ${fitPortraits==='detail'?'detail reduction':'portrait size'} fits the game limit. Try the other fitting option or revise the portrait in an art tool.`});
}
