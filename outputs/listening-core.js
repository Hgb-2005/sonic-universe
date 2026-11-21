/* Small, framework-free contracts for the listening room and desktop shell. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicListeningCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  const defaults = Object.freeze({ mode: 'work', lyricStyle:'list', lyricEffect:'orbit', background: 'geometry', visualScene:'auto', reactiveBackdrop:false, beatClock:true, beatRatio:1, color: 'lilac', brightness: 55, response: 35, desktopLyrics: true, energySaver: true });
  function normalize(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      mode: ['work', 'listen', 'library', 'visual'].includes(source.mode) ? source.mode : defaults.mode,
      lyricStyle: ['stage','list','fly','effects'].includes(source.lyricStyle)?source.lyricStyle:defaults.lyricStyle,
      lyricEffect: typeof source.lyricEffect==='string'&&/^[a-z]{1,16}$/.test(source.lyricEffect)?source.lyricEffect:defaults.lyricEffect,
      background: ['geometry', 'mist', 'plain', 'universe'].includes(source.background) ? source.background : defaults.background,
      visualScene: typeof source.visualScene==='string'&&/^[a-z-]{1,24}$/.test(source.visualScene)?source.visualScene:defaults.visualScene,
      reactiveBackdrop: source.reactiveBackdrop===true,
      beatClock: typeof source.beatClock === 'boolean' ? source.beatClock : defaults.beatClock,
      beatRatio: [.5,2].includes(source.beatRatio)?source.beatRatio:1,
      color: ['amber', 'ocean', 'lilac', 'cover'].includes(source.color) ? source.color : defaults.color,
      brightness: typeof source.brightness === 'number' ? clamp(source.brightness, 10, 100) : defaults.brightness,
      response: typeof source.response === 'number' ? clamp(source.response, 0, 100) : defaults.response,
      desktopLyrics: typeof source.desktopLyrics === 'boolean' ? source.desktopLyrics : defaults.desktopLyrics,
      energySaver: typeof source.energySaver === 'boolean' ? source.energySaver : defaults.energySaver,
    };
  }
  function lyricAt(lines, position, duration) {
    if (!Array.isArray(lines) || !lines.length || !Number.isFinite(position)) return { index: -1, line: null, end: 0 };
    let low = 0, high = lines.length - 1, index = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (lines[middle].time <= position) { index = middle; low = middle + 1; }
      else high = middle - 1;
    }
    const line = index >= 0 ? lines[index] : null;
    const end = line ? Math.max(line.time + .05, lines[index + 1]?.time ?? (Number.isFinite(duration) && duration > line.time ? duration : line.time + 6)) : 0;
    return { index, line, end };
  }
  function frameRate({ hidden = false, occluded = false, active = true, reduced = false, mode = 'work', energySaver = true } = {}) {
    if (hidden || occluded || !active) return 0;
    if (reduced) return 8;
    return mode === 'work' ? (energySaver ? 20 : 30) : (energySaver ? 30 : 45);
  }
  function formatTime(value) {
    const seconds = Math.floor(Math.max(0, Number.isFinite(value) ? value : 0));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function approach(value, target, seconds, timeConstant = .6) {
    return value + (target - value) * (1 - Math.exp(-clamp(seconds, 0, 1) / Math.max(.01, timeConstant)));
  }
  return { defaults, normalize, lyricAt, frameRate, formatTime, approach, clamp };
});
