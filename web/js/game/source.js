// File access through the local editor server (serve.py).

const HEADERS = { 'X-TOR-Editor': '1' };
let readApi = '/api';

/** Use installed game assets for this page, independent of the open project. */
export function useInstalledGameData() {
  readApi = '/api/save-editor/data';
}

async function check(res) {
  if (res.ok) return res;
  let message = `${res.status} ${res.statusText}`;
  try { message = (await res.json()).error || message; } catch { /* not JSON */ }
  throw new Error(message);
}

const q = (params) => new URLSearchParams(params).toString();

/** GET with a few retries: a dropped connection should not silently lose a file. */
async function fetchRetry(url, options, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 150 * i));
    }
  }
}

export const source = {
  async info() {
    return (await check(await fetch(`${readApi}/info`, { headers: HEADERS }))).json();
  },
  async list(dir) {
    return (await (await check(await fetch(`${readApi}/list?${q({ dir })}`, { headers: HEADERS }))).json()).files;
  },
  /** Read a file relative to Data/. With `max`, only the first bytes are sent. */
  async read(path, max, track = false) {
    const params = max ? { path, max } : { path };
    const headers = track ? {...HEADERS, 'X-TOR-Track-File': '1'} : HEADERS;
    const res = await check(await fetchRetry(`${readApi}/file?${q(params)}`, { headers }));
    return { bytes: new Uint8Array(await res.arrayBuffer()), size: Number(res.headers.get('X-File-Size')),
      scope: res.headers.get('X-TOR-File-Scope'), revision: res.headers.get('X-TOR-File-Revision'),
      view: res.headers.get('X-TOR-Content-View') };
  },
  async write(path, bytes, options) {
    const headers = {...HEADERS};
    if (options?.scope) {
      headers['X-TOR-File-Scope'] = options.scope;
      headers['X-TOR-Original-Size'] = String(options.originalSize);
      if (options.overwrite) headers['X-TOR-Overwrite'] = options.overwrite;
      if (options.revision) headers['X-TOR-File-Revision'] = options.revision;
    } else if (options?.view) {
      headers['X-TOR-Content-View'] = options.view;
    }
    const res = await fetch(`/api/file?${q({ path })}`, { method: 'POST', headers, body: bytes });
    if (options && res.status === 409) {
      const conflict = await res.json();
      if (conflict.overwrite) return conflict;
      throw new Error(conflict.error);
    }
    return (await check(res)).json();
  },
  async checkSave(files) {
    const res = await fetch('/api/save/check', {method:'POST', headers:{...HEADERS,'Content-Type':'application/json'},
      body:JSON.stringify({files})});
    return (await check(res)).json();
  },
  // ---- map library (editor/maps): whole maps under their own names ----
  // ---- another project's characters and files (read-only) ----
  async projectCharacters(name) {
    return (await check(await fetch(`/api/project/characters?${q({ name })}`, { headers: HEADERS }))).json();
  },
  async readProjectFile(name, path) {
    return new Uint8Array(await (await check(await fetch(`/api/project/file?${q({ name, path })}`, { headers: HEADERS }))).arrayBuffer());
  },
  async savedMaps() {
    return (await (await check(await fetch('/api/maps', { headers: HEADERS }))).json()).maps;
  },
  async readSavedMap(name) {
    return new Uint8Array(await (await check(await fetch(`/api/map?${q({ name })}`, { headers: HEADERS }))).arrayBuffer());
  },
  async writeSavedMap(name, bytes, meta, replace = false) {
    return (await check(await fetch(`/api/map?${q({ name, ...meta, replace: replace ? 1 : 0 })}`, { method: 'POST', headers: HEADERS, body: bytes }))).json();
  },
  async deleteSavedMap(name) {
    return (await check(await fetch(`/api/map/delete?${q({ name })}`, { method: 'POST', headers: HEADERS }))).json();
  },
  async menuMods() {
    return (await check(await fetch('/api/menu-mods',{headers:HEADERS}))).json();
  },
  async exportClassChange(project) {
    return (await check(await fetch(`/api/project/export-class-change?${q({project})}`, {headers:HEADERS}))).blob();
  },
  async saveMenuMods(info,settings,definitions) {
    return (await check(await fetch('/api/menu-mods',{method:'POST',headers:{...HEADERS,'Content-Type':'application/json'},body:JSON.stringify({...definitions,project:info.project??null,dataRoot:info.dataRoot,settings})}))).json();
  },
  async restrictionGroups() {
    return (await check(await fetch('/api/restriction-groups', {headers:HEADERS}))).json();
  },
  async saveRestrictionGroups(info,settings) {
    return (await check(await fetch('/api/restriction-groups',{method:'POST',headers:{...HEADERS,'Content-Type':'application/json'},body:JSON.stringify({project:info.project??null,dataRoot:info.dataRoot,settings})}))).json();
  },
  async backups() {
    return (await (await check(await fetch('/api/backups', { headers: HEADERS }))).json()).files;
  },
  async restore() {
    return (await check(await fetch('/api/restore', { method: 'POST', headers: HEADERS }))).json();
  },
  /** { projects: [{ name, created, saved, files, size }], open, applied: { name, at, files } | null } */
  async projects() {
    return (await check(await fetch('/api/projects', { headers: HEADERS }))).json();
  },
  /** action: new, open, saveas, merge or apply (see serve.py). */
  async applyStatus(token) {
    const res = await fetch(`/api/project/apply-status?id=${encodeURIComponent(token)}`, { headers: HEADERS, cache: 'no-store' });
    return (await check(res)).json();
  },
  async project(action, body) {
    const res = await fetch(`/api/project/${action}`, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await check(res)).json();
  },
};

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
