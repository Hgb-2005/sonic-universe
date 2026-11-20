'use strict';

// Privileged desktop actions accept only the application's own top-level renderer.
function trustedFrame(event, window, origin) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  try { const url = new URL(event.senderFrame.url);return url.origin === origin && (url.pathname === '/' || url.pathname === '/index.html'); }
  catch { return false; }
}
function externalUrl(value) {
  try { const url = new URL(value);return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function playerState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const text = (input, max = 160) => typeof input === 'string' ? input.slice(0, max) : '';
  const number = input => Number.isFinite(input) ? Math.max(0, Math.min(86400, input)) : 0;
  const lyric = text(source.lyric, 300);
  return {
    track: { name: text(source.track?.name) || '声波宇宙', artist: text(source.track?.artist) },
    playing: source.playing === true,
    external: source.external === true,
    position: number(source.position),
    duration: number(source.duration),
    lyric,
    desktopLyric: typeof source.desktopLyric === 'string' ? text(source.desktopLyric, 300) : lyric,
    nextLyric: text(source.nextLyric, 300),
  };
}
module.exports = { trustedFrame, externalUrl, playerState };
