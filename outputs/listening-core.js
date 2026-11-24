/* Small, framework-free contracts for the listening room and desktop shell. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicListeningCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  const defaults = Object.freeze({ mode: 'work', lyricStyle:'effects', lyricEffect:'tide', lyricScroll:'smooth', playbackBackground:'default', background: 'geometry', visualScene:'auto', reactiveBackdrop:false, beatClock:true, beatRatio:1, color: 'lilac', playbackColor:'cover', brightness: 55, response: 35, desktopLyrics: true, energySaver: true });
  function normalize(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      mode: ['work', 'listen', 'library', 'search', 'visual'].includes(source.mode) ? source.mode : defaults.mode,
      lyricStyle: ['stage','list','fly','effects'].includes(source.lyricStyle)?source.lyricStyle:defaults.lyricStyle,
      lyricEffect: typeof source.lyricEffect==='string'&&/^[a-z]{1,16}$/.test(source.lyricEffect)?source.lyricEffect:defaults.lyricEffect,
      lyricScroll: ['smooth','track','rise'].includes(source.lyricScroll)?source.lyricScroll:defaults.lyricScroll,
      playbackBackground: typeof source.playbackBackground==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(source.playbackBackground)?source.playbackBackground:defaults.playbackBackground,
      background: ['geometry', 'mist', 'plain', 'universe'].includes(source.background) ? source.background : defaults.background,
      visualScene: typeof source.visualScene==='string'&&/^[a-z-]{1,24}$/.test(source.visualScene)?source.visualScene:defaults.visualScene,
      reactiveBackdrop: source.reactiveBackdrop===true,
      beatClock: typeof source.beatClock === 'boolean' ? source.beatClock : defaults.beatClock,
      beatRatio: [.5,2].includes(source.beatRatio)?source.beatRatio:1,
      color: ['amber', 'ocean', 'lilac', 'cover'].includes(source.color) ? source.color : defaults.color,
      playbackColor: ['amber','ocean','lilac','cover'].includes(source.playbackColor)?source.playbackColor:defaults.playbackColor,
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
  // 帧率策略：省电优先仍然最省；关掉省电后按供电状态放开（插电 60，电池 30）。
  // 减少动态效果只留 10 帧，够看清歌词变化又不晕。
  function frameRate({ hidden = false, occluded = false, active = true, reduced = false, mode = 'work', energySaver = true, onBattery = false } = {}) {
    if (hidden || occluded || !active) return 0;
    if (reduced) return 10;
    const ceiling = mode === 'work' ? (onBattery ? 24 : 40) : (onBattery ? 30 : 60);
    return energySaver ? Math.min(ceiling, mode === 'work' ? 20 : 30) : ceiling;
  }
  function playbackRenderScale(width,height,dpr,{energySaver,photo=false}={}) {
    const limit=energySaver?(photo?1.15:.8):(photo?1.6:2);
    const budget=energySaver?(photo?1350000:1000000):(photo?2600000:4000000);
    return Math.min(Math.max(dpr,1),limit,Math.sqrt(budget/Math.max(1,width*height)));
  }
  function formatTime(value) {
    const seconds = Math.floor(Math.max(0, Number.isFinite(value) ? value : 0));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function approach(value, target, seconds, timeConstant = .6) {
    return value + (target - value) * (1 - Math.exp(-clamp(seconds, 0, 1) / Math.max(.01, timeConstant)));
  }
  return { defaults, normalize, lyricAt, frameRate, playbackRenderScale, formatTime, approach, clamp };
});
