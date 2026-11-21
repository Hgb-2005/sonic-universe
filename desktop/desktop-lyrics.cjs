'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, screen } = require('electron');
const { playerState } = require('./policy.cjs');

const page = path.join(__dirname, 'desktop-lyrics.html');
const pageUrl = pathToFileURL(page).href;

function createDesktopLyrics({ onState }) {
  let overlay;
  let loading;
  let visible = false;
  let locked = false;
  let suspended = false;
  let disposed = false;
  let state = lyricsState(playerState(null));

  function lyricsState(player) {
    return {
      trackName: player.track.name,
      playing: player.playing,
      external: player.external,
      lyric: player.desktopLyric,
      nextLyric: player.nextLyric,
      previousLyric: player.previousLyric,
      translation: player.translation,
    };
  }

  function notify() { onState({ visible, locked }); }

  function fitBounds(previous) {
    const display = previous ? screen.getDisplayMatching(previous) : screen.getPrimaryDisplay();
    const area = display.workArea;
    const width = Math.min(920, Math.max(1, area.width - 40));
    const height = Math.min(160, area.height);
    const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, Math.round(value)));
    const left = previous?.x ?? area.x + (area.width - width) / 2;
    const top = previous?.y ?? area.y + area.height - height - 36;
    return { x: clamp(left, area.x, area.x + area.width - width), y: clamp(top, area.y, area.y + area.height - height), width, height };
  }

  function sendState() {
    if (!overlay || overlay.isDestroyed()) return;
    const contents = overlay.webContents;
    if (!contents.isDestroyed() && !contents.isCrashed()) contents.send('sonic:desktop-lyrics-render', { ...state, locked });
  }

  function syncVisibility() {
    if (!overlay || overlay.isDestroyed()) return;
    if (visible && !suspended) {
      if (!loading) {
        sendState();
        overlay.showInactive();
      }
    } else overlay.hide();
  }

  function hide() {
    if (!visible) return;
    visible = false;
    locked = false;
    if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(false);
    syncVisibility();
    notify();
  }

  function openOverlay() {
    const candidate = new BrowserWindow({
      ...fitBounds(),
      title: '声波宇宙 · 桌面歌词',
      icon: path.join(__dirname, '../outputs/assets/sonic-icon.png'),
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'desktop-lyrics-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    overlay = candidate;
    candidate.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    candidate.webContents.on('will-navigate', event => event.preventDefault());
    candidate.webContents.on('render-process-gone', () => {
      if (!candidate.isDestroyed()) candidate.destroy();
    });
    candidate.on('close', event => {
      if (disposed) return;
      event.preventDefault();
      hide();
    });
    candidate.on('closed', () => {
      if (overlay !== candidate) return;
      overlay = null;
      loading = null;
      hide();
    });
    loading = candidate.loadFile(page).then(() => {
      if (overlay !== candidate) return;
      loading = null;
    }).catch(error => {
      if (!candidate.isDestroyed()) candidate.destroy();
      throw error;
    });
  }

  return {
    get visible() { return visible; },
    get locked() { return locked; },
    async toggle() {
      if (disposed) return { ok: false, visible: false, message: '桌面歌词正在关闭。' };
      if (visible) {
        hide();
        return { ok: true, visible: false };
      }
      visible = true;
      try {
        if (!overlay || overlay.isDestroyed()) openOverlay();
        if (loading) await loading;
        syncVisibility();
        notify();
        return { ok: true, visible };
      } catch (error) {
        hide();
        return { ok: false, visible: false, message: error.message || '桌面歌词未能打开。' };
      }
    },
    toggleLock() {
      if (!visible || !overlay || loading || overlay.isDestroyed()) return;
      locked = !locked;
      overlay.setIgnoreMouseEvents(locked);
      sendState();
      notify();
    },
    command(event, command) {
      if (!overlay || overlay.isDestroyed() || event.sender !== overlay.webContents ||
          event.senderFrame !== overlay.webContents.mainFrame || event.senderFrame?.url !== pageUrl) return;
      if (command === 'close') hide();
      if (command === 'lock' && !locked) this.toggleLock();
    },
    publish(player) {
      const next = lyricsState(player);
      if (Object.keys(next).every(key => next[key] === state[key])) return;
      state = next;
      if (visible && !loading && !suspended) sendState();
    },
    suspend(value) {
      if (suspended === value) return;
      suspended = value;
      syncVisibility();
    },
    fitDisplay() {
      if (overlay && !overlay.isDestroyed()) overlay.setBounds(fitBounds(overlay.getBounds()));
    },
    dispose() {
      disposed = true;
      visible = false;
      if (overlay && !overlay.isDestroyed()) overlay.destroy();
    },
  };
}

module.exports = { createDesktopLyrics };
