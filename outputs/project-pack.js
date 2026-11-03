(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicProjectPack = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const MAGIC = 'SONICPACK1\n', MAX = 1024 * 1024 * 1024, HEADER_MAX = 24 * 1024 * 1024;
  const KEYS = ['session','preferences','film','instrument','refinement','drafts','visual-presets-v1','particle-engine'].map(k => 'sonic-universe-'+k);
  const STATES = ['library','atelier','background'];
  function validHeader(h) {
    if (!h || h.format !== 'sonic-universe-project' || h.version !== 1 || !Array.isArray(h.state) || !Array.isArray(h.media) || !Array.isArray(h.preferences) || h.media.length > 2000) throw Error('不是当前版本的声波宇宙备份。');
    const unique = new Set();
    for (const entry of h.state) {
      if (!Array.isArray(entry) || entry.length !== 2 || !STATES.includes(entry[0]) || unique.has(entry[0])) throw Error('作品设置记录无效。');
      unique.add(entry[0]);
    }
    const prefs = new Set();
    for (const entry of h.preferences) {
      if (!Array.isArray(entry) || entry.length !== 2 || !KEYS.includes(entry[0]) || typeof entry[1] !== 'string' || prefs.has(entry[0])) throw Error('本机设置记录无效。');
      prefs.add(entry[0]);
    }
    const library = h.state.find(e => e[0] === 'library')?.[1];
    if (!library || library.version !== 5 || !Array.isArray(library.tracks) || library.tracks.length > 2001) throw Error('备份缺少完整曲库。');
    const ids = new Set(), files = new Set();
    for (const t of library.tracks) {
      if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 160 || ids.has(t.id) || !['demo','file'].includes(t.kind) || typeof t.name !== 'string') throw Error('曲库中有无效或重复歌曲。');
      ids.add(t.id); if (t.kind === 'file') files.add(t.id);
    }
    const mediaIds = new Set(); let size = 0;
    for (const m of h.media) {
      if (!m || !files.has(m.key) || mediaIds.has(m.key) || !Number.isSafeInteger(m.size) || m.size <= 0 || typeof m.type !== 'string' || m.type.length > 120) throw Error('音乐文件索引不完整。');
      mediaIds.add(m.key); size += m.size;
    }
    if (mediaIds.size !== files.size || size > MAX) throw Error('备份缺少歌曲文件，或超过 1 GB。');
    return size;
  }
  async function encode(snapshot) {
    const media = snapshot.media.map(([key, blob]) => ({key, size:blob.size, type:blob.type}));
    const h = {format:'sonic-universe-project', version:1, createdAt:new Date().toISOString(), state:snapshot.state, preferences:snapshot.preferences, media};
    validHeader(h);
    const header = new TextEncoder().encode(JSON.stringify(h));
    if (header.byteLength > HEADER_MAX) throw Error('作品设置超过 24 MB，请精简后备份。');
    const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, header.byteLength, true);
    const result = new Blob([MAGIC, length, header, ...snapshot.media.map(([,blob]) => blob)], {type:'application/octet-stream'});
    if (result.size > MAX) throw Error('备份超过 1 GB，请减少本地歌曲后重试。');
    return result;
  }
  async function decode(file) {
    if (!file || file.size > MAX || file.size < MAGIC.length + 4) throw Error('文件为空、已损坏，或超过 1 GB。');
    const prefix = new Uint8Array(await file.slice(0, MAGIC.length+4).arrayBuffer());
    if (new TextDecoder().decode(prefix.slice(0,MAGIC.length)) !== MAGIC) throw Error('请选择 .sonicpack 作品备份文件。');
    const n = new DataView(prefix.buffer).getUint32(MAGIC.length,true), start = MAGIC.length+4;
    if (n < 2 || n > HEADER_MAX || start+n > file.size) throw Error('备份头已损坏，原有作品已保留。');
    let h; try { h = JSON.parse(await file.slice(start,start+n).text()); } catch { throw Error('无法读取作品设置。'); }
    const bytes = validHeader(h);
    if (file.size !== start+n+bytes) throw Error('备份文件不完整，请重新导出。');
    let offset = start+n;
    const media = h.media.map(m => {const blob=file.slice(offset,offset+m.size,m.type); offset+=m.size; return [m.key,blob];});
    return {state:h.state, preferences:h.preferences, media, createdAt:h.createdAt};
  }
  const request = r => new Promise((resolve,reject) => {r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const done = tx => new Promise((resolve,reject) => {tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('存储操作被取消。'));tx.onerror=()=>{};});
  async function snapshot(db, storage) {
    const tx=db.transaction(['state','media'],'readonly'), finish=done(tx);
    const state=tx.objectStore('state'), media=tx.objectStore('media');
    const [values,keys,blobs] = await Promise.all([Promise.all(STATES.map(k=>request(state.get(k)))),request(media.getAllKeys()),request(media.getAll()),finish]);
    return {state:STATES.flatMap((k,i)=>values[i]===undefined?[]:[[k,values[i]]]),media:keys.map((k,i)=>[k,blobs[i]]),preferences:KEYS.flatMap(k=>{const v=storage.getItem(k);return v===null?[]:[[k,v]];})};
  }
  async function restore(db, storage, data) {
    // Replace both stores in one IndexedDB transaction; restore preferences if it fails.
    const previous=KEYS.map(k=>[k,storage.getItem(k)]);
    const setPrefs = entries => {KEYS.forEach(k=>storage.removeItem(k));entries.forEach(([k,v])=>{if(v!==null)storage.setItem(k,v);});};
    try {
      setPrefs(data.preferences);
      const tx=db.transaction(['state','media'],'readwrite'), finish=done(tx);
      try {
        tx.objectStore('state').clear();tx.objectStore('media').clear();
        data.state.forEach(([k,v])=>tx.objectStore('state').put(v,k));
        data.media.forEach(([k,v])=>tx.objectStore('media').put(v,k));
      } catch(error) {tx.abort();await finish.catch(()=>{});throw error;}
      await finish;
    } catch(error) {setPrefs(previous);throw error;}
  }
  return {encode,decode,snapshot,restore,KEYS};
});
