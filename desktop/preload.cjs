'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
async function folderImportKey(file, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.includes('/')) return '';
  const fullPath = webUtils.getPathForFile(file).replaceAll('\\', '/').toLowerCase();
  const relative = relativePath.toLowerCase();
  if (!fullPath.endsWith('/' + relative)) return '';
  const parent = fullPath.slice(0, -relative.length);
  const folder = parent + relative.split('/')[0];
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(folder));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
const subscribe = channel => callback => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('sonicDesktop', Object.freeze({
  folderImportKey,
  mini: () => ipcRenderer.invoke('sonic:mini'),
  desktopLyrics: () => ipcRenderer.invoke('sonic:desktop-lyrics'),
  wallpaper: enabled => ipcRenderer.invoke('sonic:wallpaper', enabled===true),
  settings: () => ipcRenderer.invoke('sonic:settings'),
  checkRelease: () => ipcRenderer.invoke('sonic:check-release'),
  openUpdate: () => ipcRenderer.invoke('sonic:open-update'),
  downloadUpdate: () => ipcRenderer.invoke('sonic:download-update'),
  setStartup: enabled => ipcRenderer.invoke('sonic:startup', enabled===true),
  authorizeCapture: () => ipcRenderer.invoke('sonic:capture'),
  externalNowPlaying: ({ sourceId } = {}) => ipcRenderer.invoke('sonic:external-now-playing', { sourceId }),
  publish: state => ipcRenderer.send('sonic:state', state),
  command: command => ipcRenderer.send('sonic:command', command),
  onCommand: subscribe('sonic:command'), onVisibility: subscribe('sonic:visibility'),
  onWallpaper: subscribe('sonic:wallpaper-state'), onPlayerState: subscribe('sonic:player-state'),
  onDesktopLyricsState: subscribe('sonic:desktop-lyrics-state'),
}));
