(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicFolderLibrary = api;
})(globalThis, function () {
  'use strict';

  function relativeKey(path) {
    return path.replaceAll('\\', '/').toLowerCase();
  }

  function fingerprint(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  function folderMetadata(track) {
    if (!track || typeof track.sourceFolder !== 'string' || !/^[a-f0-9]{64}$/.test(track.sourceFolder)) return {};
    return { sourceFolder: track.sourceFolder, sourceMissing: track.sourceMissing === true };
  }

  function manualFields(track) {
    const fields = ['name', 'artist', 'album', 'cover', 'lyrics'].filter(field => track?.manualFields?.[field] === true);
    return Object.fromEntries(fields.map(field => [field, true]));
  }

  function reconcile(tracks, sourceFolder, files, pathFor) {
    const byPath = new Map();
    const present = new Set(files.map(file => relativeKey(pathFor(file))));
    if (sourceFolder) {
      for (const track of tracks) {
        if (track.kind === 'file' && track.sourceFolder === sourceFolder) byPath.set(relativeKey(track.sourcePath), track);
      }
    }
    return {
      existing(path) { return byPath.get(relativeKey(path)); },
      removed() { return [...byPath].filter(([path, track]) => !present.has(path) && !track.sourceMissing).map(([, track]) => track); },
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

  return { fingerprint, folderMetadata, manualFields, reconcile, groupFiles };
});
