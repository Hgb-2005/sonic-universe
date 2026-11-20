'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sonicDesktopLyrics', Object.freeze({
  onState(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('sonic:desktop-lyrics-render', (_event, value) => callback(value));
  },
  close: () => ipcRenderer.send('sonic:desktop-lyrics-command', 'close'),
  lock: () => ipcRenderer.send('sonic:desktop-lyrics-command', 'lock'),
}));
