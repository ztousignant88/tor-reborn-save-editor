// Map-object pictures use native SAS3 banks 14..18. Battle data entry 38,
// byte +0x1C selects the bank; +0x18..1B describe separate effects, not frames.
import { parsePakd, parseXlce } from '../lib/pakd.js';
import { battleData } from './battledata.js';
import { parseActionSequence, sampleAction } from './sceneanimations.js';

let definitionsPromise = null, definitions = new Map();
export function parseObjectDefinitions(bankBytes, tableBytes) {
  const bank = parsePakd(bankBytes), table = parseXlce(tableBytes), groups = new Map(), out = new Map();
  if (table.rowSize !== 30) throw new Error('unexpected map object table');
  for (let id=0;id<table.count;id++) {
    const group=table.row(id)[0x1C];
    if (group<14||group>18) continue;
    if (!groups.has(group)) groups.set(group,parseActionSequence(bank.entries[group].data));
    out.set(id,{group,definition:groups.get(group)});
  }
  return out;
}
export function loadObjectDefinitions() {
  definitionsPromise ??= battleData().then(({dat})=>{
    definitions=parseObjectDefinitions(dat.pakd.entries[0].data,dat.pakd.entries[38].data);
    return definitions;
  });
  return definitionsPromise;
}

/** Copy compressed blocks exactly; no decoding or recompression of game art. */
export function cropObjectTexture(tex, cell) {
  const {u,v,width,height}=cell;
  if (!(width>0&&height>0&&u>=0&&v>=0&&u+width<=tex.width&&v+height<=tex.height)) throw new Error('object frame outside texture');
  let data;
  if (tex.format===0) {
    data=new Uint8Array(width*height*4);
    const stride=tex.stride??tex.width*4;
    for(let y=0;y<height;y++)data.set(tex.data.subarray((v+y)*stride+u*4,(v+y)*stride+(u+width)*4),y*width*4);
  } else {
    if(![7,13].includes(tex.format)||[u,v,width,height].some(n=>n%4)) throw new Error('unsupported object frame blocks');
    const bytes=tex.format===7?8:16, rowBytes=width/4*bytes, stride=tex.stride??Math.ceil(tex.width/4)*bytes;
    data=new Uint8Array(rowBytes*height/4);
    for(let y=0;y<height/4;y++) {
      const start=(v/4+y)*stride+u/4*bytes;
      if(start+rowBytes>tex.data.length)throw new Error('truncated object texture');
      data.set(tex.data.subarray(start,start+rowBytes),y*rowBytes);
    }
  }
  return {name:tex.name,width,height,format:tex.format,data};
}

export function objectSprite(tex, type, defs=definitions) {
  const native=defs.get(type);
  if(!native)return tex; // unknown extra atlases must not be guessed into frames
  const def=native.definition, sequence=def.slots[0];
  const used=new Set(sequence?.commands.filter(c=>c.op===0||c.op===2).map(c=>c.frame));
  if(!used.size)return tex;
  const frames=def.frames.map((frame,id)=>{
    if(!used.has(id))return null; // destruction-state cells can be outside the default object's atlas
    if(frame.sheet!==0||frame.cells.length!==1)throw new Error('unsupported map object cell layout');
    const cell=frame.cells[0],image=cropObjectTexture(tex,cell);
    return {image,width:cell.width,height:cell.height,pivot:(cell.y+cell.height)/cell.height,pivotX:-cell.x/cell.width};
  });
  const first=sampleAction(def,0,0)?.frame;
  return {...tex,objectSprite:{...native,frames,first,animated:used.size>1&&sequence.length>0}};
}

/** Preview frame timing is the native SAS3 timeline, including nonuniform holds and loops. */
export function objectFrameAt(sprite,tick=0) {
  const state=sampleAction(sprite.definition,0,tick);
  const frame=state&&!state.hidden?sprite.frames[state.frame]:null;
  return frame?{...frame,index:state.frame,flip:state.flip,flipY:state.flipY,x:state.x,y:state.y}:null;
}
