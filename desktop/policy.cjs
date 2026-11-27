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
    previousLyric: text(source.previousLyric, 300),
    translation: text(source.translation, 300),
  };
}
// 只读歌词接口的载荷：限制行数/词数/长度，避免渲染进程把任意内容塞进接口。
function lyricDocument(value) {
  const source = value && typeof value === 'object' ? value : null;
  if (!source) return null;
  const text = (input, max = 300) => typeof input === 'string' ? input.slice(0, max) : '';
  const time = input => Number.isFinite(input) ? Math.max(0, Math.min(86400, input)) : 0;
  const lines = Array.isArray(source.lines) ? source.lines.slice(0, 400) : [];
  return {
    track: { name: text(source.track?.name, 160), artist: text(source.track?.artist, 120) },
    duration: time(source.duration),
    offset: Number.isFinite(source.offset) ? Math.max(-120, Math.min(120, source.offset)) : 0,
    mediaStart: time(source.mediaStart),
    lines: lines.map(line => ({
      time: time(line?.time),
      end: Number.isFinite(line?.end) ? time(line.end) : null,
      text: text(line?.text),
      translation: text(line?.translation),
      isChorus: line?.isChorus === true,
      words: Array.isArray(line?.words) ? line.words.slice(0, 120).map(word => ({
        text: text(word?.text, 60),
        start: time(word?.start),
        end: time(word?.end),
      })) : [],
    })),
  };
}
module.exports = { trustedFrame, externalUrl, playerState, lyricDocument };
