// Data/FileTable.bin. On Reborn each file's external entry is its path as a
// NUL-terminated ASCII string followed directly by its u32 size. Changing a
// file's size only needs that one u32 patched in place, which leaves entries
// written by other mods untouched. A few paths are listed twice
// (event/scene/C4_ST_345.dat and C4_ST_346.dat); such entries are only trusted
// while they agree, and are patched together.

const SIGNATURE = 0x1EF1;

export function checkFileTable(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0, true) !== SIGNATURE) throw new Error('FileTable.bin has an unexpected signature');
}

function findPath(bytes, path) {
  const needle = new TextEncoder().encode(path + '\0');
  const first = needle[0];
  const hits = [];
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    hits.push(i + needle.length);
  }
  return hits;
}

/** Where `path`'s size is recorded: every entry for it, which must agree. */
function sizeEntries(bytes, path) {
  const hits = findPath(bytes, path);
  if (!hits.length) throw new Error(`FileTable has no entry for ${path}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  if (hits.some((h) => v.getUint32(h, true) !== v.getUint32(hits[0], true))) {
    throw new Error(`FileTable has ${hits.length} entries for ${path} with different sizes`);
  }
  return hits;
}

/** Return the recorded size for `path` (relative to Data/, exact case). */
export function getRecordedSize(bytes, path) {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(sizeEntries(bytes, path)[0], true);
}

/** Patch the recorded size for `path` in place (every entry for it). Returns the previous size. */
export function setRecordedSize(bytes, path, size) {
  const hits = sizeEntries(bytes, path);
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const previous = v.getUint32(hits[0], true);
  for (const h of hits) v.setUint32(h, size, true);
  return previous;
}

/** Explicit directory/file IDs, including appended art. Filename sort is not an ID. */
export function readFileRegistry(bytes) {
  checkFileTable(bytes);
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),need=(o,n)=>{if(o<0||o+n>bytes.length)throw new Error('Truncated FileTable');};
  need(0,68);const names=v.getUint16(2,true),dirs=v.getUint16(4,true),version=v.getUint16(6,true),pointers=v.getUint32(8,true),external=v.getUint32(12,true);
  if(version!==4)throw new Error('Unsupported FileTable version');
  const start=68+names*8,batches=start+dirs*24,out=[];need(start,dirs*24);
  const text=new TextDecoder('ascii');
  for(let i=0;i<dirs;i++){
    const at=start+i*24,directory=v.getUint16(at,true),count=v.getUint16(at+10,true),batch=batches+v.getUint32(at+16,true);need(batch,count*8);
    for(let j=0;j<count;j++){
      const b=batch+j*8,first=v.getUint16(b,true),n=v.getUint16(b+2,true),flags=v.getUint32(b+4,true);
      if(flags>>>29)throw new Error('Unsupported FileTable batch flags');need(pointers+flags,n*4);
      for(let k=0;k<n;k++){
        const offset=external+v.getUint32(pointers+flags+k*4,true)*8;need(offset,1);const end=bytes.indexOf(0,offset);if(end<0)throw new Error('Unterminated FileTable path');need(end+1,4);
        out.push({directory,id:first+k,path:text.decode(bytes.subarray(offset,end)),size:v.getUint32(end+1,true)});
      }
    }
  }
  return out;
}
