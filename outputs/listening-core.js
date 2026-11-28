/* Small, framework-free contracts for the listening room and desktop shell. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicListeningCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  const defaults = Object.freeze({ mode: 'work', lyricStyle:'effects', lyricEffect:'tide', lyricScroll:'smooth', lyricAutoReturn:false, playbackBackground:'default', background: 'geometry', visualScene:'auto', stageEmbedUrl:'', stageReading:false, stageStyle:'particles', stageFont:'default', stageGlass:true, stageTranslations:true, reactiveBackdrop:false, beatClock:true, beatRatio:1, color: 'lilac', playbackColor:'cover', brightness: 55, response: 35, desktopLyrics: true, energySaver: true });
  function stageEmbedUrl(value) {
    if(typeof value!=='string' || value.length>2048)return '';
    try {
      const url=new URL(value);
      return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function normalize(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      mode: ['work', 'listen', 'library', 'search', 'visual'].includes(source.mode) ? source.mode : defaults.mode,
      lyricStyle: ['stage','list','fly','effects','reading'].includes(source.lyricStyle)?source.lyricStyle:defaults.lyricStyle,
      lyricEffect: typeof source.lyricEffect==='string'&&/^[a-z]{1,16}$/.test(source.lyricEffect)?source.lyricEffect:defaults.lyricEffect,
      lyricScroll: ['smooth','track','rise'].includes(source.lyricScroll)?source.lyricScroll:defaults.lyricScroll,
      lyricAutoReturn: source.lyricAutoReturn===true,
      playbackBackground: typeof source.playbackBackground==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(source.playbackBackground)?source.playbackBackground:defaults.playbackBackground,
      background: ['geometry', 'mist', 'plain', 'universe'].includes(source.background) ? source.background : defaults.background,
      visualScene: typeof source.visualScene==='string'&&/^[a-z-]{1,24}$/.test(source.visualScene)?source.visualScene:defaults.visualScene,
      stageEmbedUrl: stageEmbedUrl(source.stageEmbedUrl),
      stageReading: source.stageReading===true,
      stageFont: ['song','kai'].includes(source.stageFont)?source.stageFont:defaults.stageFont,
      stageStyle: source.stageStyle==='fold' ? 'dialogue' :
        ['scene','flow','particles','groove','trail','dialogue'].includes(source.stageStyle) ? source.stageStyle :
        source.stageParticles === false ? 'scene' : defaults.stageStyle,
      stageGlass: source.stageGlass!==false,
      stageTranslations: source.stageTranslations!==false,
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
  function lyricGap(line, next, position) {
    if (!Number.isFinite(line?.end) || !next || next.time - line.end <= 2.5 ||
        position < line.end || position >= next.time) return null;
    const elapsed = position - line.end;
    const remaining = next.time - position;
    if (elapsed < .45) return {phase: 'fade', opacity: 1 - elapsed / .45};
    if (remaining <= .35) return {phase: 'cue', opacity: .55 * (1 - remaining / .35)};
    return {phase: 'quiet', opacity: 0};
  }
  // The same timestamp must yield the same shot after a seek or a replay.
  function stageShots(lines) {
    let section=0, start=0;
    return lines.map((line,i)=>{
      const prev=lines[i-1];
      const gap=prev && Number.isFinite(prev.end) && line.time-prev.end>2.5;
      // Chorus tags are inferred from repeated text. One repeated line alone is not a new section.
      const entersRefrain=!prev?.isChorus && line.isChorus && lines[i+1]?.isChorus;
      const leavesRefrain=!line.isChorus && prev?.isChorus && lines[i-2]?.isChorus;
      if(prev && (gap || entersRefrain || leavesRefrain ||
          (i-start>=4 && line.time-lines[start].time>=10))){
        section++; start=i;
      }
      return {section, start:lines[start].time, row:(i-start)%2};
    });
  }
  function duetTimelines(lines) {
    const voices={left:[],right:[]};
    let nextStart=Infinity, nextUnsplit=Infinity;
    for(let i=lines.length-1;i>=0;i--){
      const line=lines[i],next=lines[i+1];
      if(next&&next.time>line.time)nextStart=next.time;
      if(line.singer==='left'||line.singer==='right'){
        const end=Math.min(Number.isFinite(line.end)?line.end:nextStart,nextUnsplit);
        voices[line.singer].push({time:line.time,end,line});
      }else nextUnsplit=line.time;
    }
    voices.left.reverse();
    voices.right.reverse();
    return voices;
  }
  function duetLineAt(timeline, position, duration) {
    const {line:entry,end}=lyricAt(timeline,position,duration);
    if(!entry)return null;
    const stop=Number.isFinite(entry.end)?entry.end:end;
    return position<stop?{line:entry.line,end:stop}:null;
  }
  // 帧率策略：省电优先仍然最省；关掉省电后按供电状态放开（插电 60，电池 30）。
  // 减少动态效果只留 10 帧，够看清歌词变化又不晕。
  function frameRate({ hidden = false, occluded = false, active = true, reduced = false, mode = 'work', energySaver = true, onBattery = false } = {}) {
    if (hidden || occluded || !active) return 0;
    if (reduced) return 10;
    const ceiling = mode === 'work' ? (onBattery ? 24 : 40) : (onBattery ? 30 : 60);
    return energySaver ? Math.min(ceiling, mode === 'work' ? 20 : 30) : ceiling;
  }
  function nextFrameDeadline(deadline, now, fps) {
    const interval = 1000 / fps;
    if (!deadline) return now + interval;
    const periods = Math.max(1, Math.floor((now - deadline) / interval) + 1);
    return deadline + periods * interval;
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
  return { defaults, normalize, stageEmbedUrl, lyricAt, lyricGap, stageShots, duetTimelines, duetLineAt, frameRate, nextFrameDeadline, playbackRenderScale, formatTime, approach, clamp };
});
