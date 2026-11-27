(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicFolderLibrary = api;
})(globalThis, function () {
  'use strict';

  function relativeKey(path) {
    return path.replaceAll('\\', '/').toLowerCase();
  }

  function insideFolder(path) {
    return path.slice(path.indexOf('/') + 1);
  }

  function audioKey(path, size) {
    return path.slice(path.lastIndexOf('/') + 1) + '\0' + size;
  }

  function trackPath(track) {
    return relativeKey(track.sourcePath || track.blob?.name || track.signature?.match(/^(.*)\|\d+\|\d+$/)?.[1] || '');
  }

  async function sameAudio(first, second) {
    if (!first || !second || first.size !== second.size) return false;
    const chunkSize = 1024 * 1024;
    for (let offset = 0; offset < first.size; offset += chunkSize) {
      const [left, right] = await Promise.all([first, second].map(blob =>
        blob.slice(offset, offset + chunkSize).arrayBuffer().then(bytes => new Uint8Array(bytes))));
      for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return false;
      }
    }
    return true;
  }

  async function audioDigest(blob) {
    if (!globalThis.crypto?.subtle) return null;
    // Hash every byte without loading the whole file. Keep the chunk size stable for saved digests.
    const chunkSize = 4 * 1024 * 1024;
    const digests = new Uint8Array(Math.ceil(blob.size / chunkSize) * 32);
    for (let offset = 0, chunk = 0; offset < blob.size; offset += chunkSize, chunk++) {
      const bytes = await blob.slice(offset, offset + chunkSize).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      digests.set(new Uint8Array(digest), chunk * 32);
    }
    const digest = await crypto.subtle.digest('SHA-256', digests);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function fingerprint(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  function folderMetadata(track) {
    if (!track || typeof track.sourceFolder !== 'string' || !/^[a-f0-9]{64}$/.test(track.sourceFolder)) return {};
    return { sourceFolder: track.sourceFolder, sourceMissing: track.sourceMissing === true,
      sidecarStamp: typeof track.sidecarStamp==='string' ? track.sidecarStamp.slice(0,500) : null };
  }

  function manualFields(track) {
    const fields = ['name', 'artist', 'album', 'cover', 'lyrics'].filter(field => track?.manualFields?.[field] === true);
    return Object.fromEntries(fields.map(field => [field, true]));
  }

  function reconcile(tracks, sourceFolder, files, pathFor) {
    const byPath = new Map(), byAudio = new Map(), bySize = new Map(), incoming = new Map();
    const present = new Set(files.map(file => relativeKey(pathFor(file))));
    if (sourceFolder) {
      for (const file of files) {
        const key = audioKey(relativeKey(pathFor(file)), file.size);
        incoming.set(key, (incoming.get(key) || 0) + 1);
      }
    }
    const claimed = new Set(),digestCache=new WeakMap();
    function hash(track){
      if(track.audioDigest)return Promise.resolve(track.audioDigest);
      if(!digestCache.has(track.blob))digestCache.set(track.blob,audioDigest(track.blob));
      return digestCache.get(track.blob);
    }
    function index(track) {
      if (track.kind !== 'file' || !track.blob) return;
      const path = trackPath(track);
      if (!path) return;
      if (sourceFolder && track.sourceFolder === sourceFolder) {
        byPath.set(path, track);
        if (!bySize.has(track.blob.size)) bySize.set(track.blob.size,new Set());
        bySize.get(track.blob.size).add(track);
      }
      const key = audioKey(path, track.blob.size);
      if (!byAudio.has(key)) byAudio.set(key, new Set());
      byAudio.get(key).add(track);
    }
    tracks.forEach(index);
    return {
      unchanged(source, filePath) {
        const track=byPath.get(relativeKey(filePath));
        if(track?.signature===fingerprint(source))return {track,unchanged:true};
        return null;
      },
      async match(file, filePath) {
        const path = relativeKey(filePath), exact = byPath.get(path);
        if (exact) return { track: exact, unchanged: await sameAudio(exact.blob, file) };
        const key = audioKey(path, file.size);
        let match = null, ambiguous = false;
        for (const track of byAudio.get(key) || []) {
          const previous = trackPath(track);
          if (sourceFolder) {
            if (claimed.has(track)) continue;
            if (track.sourceFolder === sourceFolder) {
              // A moved subfolder can reuse an entry only when its old path vanished.
              if (present.has(previous) || incoming.get(key) !== 1) continue;
            } else if (insideFolder(previous) !== insideFolder(path)) continue;
          } else if (path.includes('/') && previous.includes('/') && insideFolder(previous) !== insideFolder(path)) {
            continue;
          }
          if (!await sameAudio(track.blob, file)) continue;
          if (!sourceFolder && previous === path) return { track, unchanged: true };
          if (match) ambiguous = true;
          else match = track;
        }
        if (!match && sourceFolder) {
          for (const track of bySize.get(file.size) || []) {
            if (claimed.has(track) || present.has(trackPath(track)) || !await sameAudio(track.blob,file)) continue;
            if (match) ambiguous=true;
            else match=track;
          }
        }
        if (ambiguous) return { ambiguous: true };
        if (sourceFolder && match) return { track: match, unchanged: true, relinked: true };
        const parent=path.slice(0,path.lastIndexOf('/'));
        const visibleCopies=sourceFolder&&[...(bySize.get(file.size)||[])].filter(track=>{
          const previous=trackPath(track);
          return present.has(previous)&&previous.slice(0,previous.lastIndexOf('/'))===parent;
        });
        if(visibleCopies?.length){
          const digest=await audioDigest(file);
          for(const track of visibleCopies){
            const known=digest&&await hash(track);
            if(known?digest===known:await sameAudio(track.blob,file))return {duplicateCopy:true};
          }
        }
        return { track: match, unchanged: Boolean(match) };
      },
      remember(track) { index(track); claimed.add(track); },
      removed() {
        return [...byPath].filter(([path, track]) =>
          !present.has(path) && !track.sourceMissing && trackPath(track) === path).map(([, track]) => track);
      },
    };
  }

  function groupFiles(selected, isAudio, pathFor, classify) {
    const files = selected.filter(isAudio);
    const stems = new Set(files.map(file => relativeKey(pathFor(file)).replace(/\.[^./]+$/, '')));
    const sidecars = new Map(), other = [];
    for (const file of selected) {
      if (isAudio(file)) continue;
      const info = classify(pathFor(file));
      const stem = info && (stems.has(info.rawStem) ? info.rawStem : info.stem);
      if (!info || file.size > 250000 || !stems.has(stem)) {
        other.push(file);
        continue;
      }
      if (!sidecars.has(stem)) sidecars.set(stem, {});
      sidecars.get(stem)[info.rawStem !== stem && info.translation ? 'translation' : info.format] ||= file;
    }
    return { files, sidecars, other };
  }

  return { fingerprint, audioDigest, folderMetadata, manualFields, reconcile, groupFiles };
});
