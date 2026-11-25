/* The look is driven by the lyric clock so seeking never replays an entrance. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicLyricEffects = api;
})(globalThis, function () {
  'use strict';
  const palettes = {
    impact: ['#ada69c', '#fff7e6'],
    cut: ['#a6bac5', '#ecfbff'],
    neon: ['#8bb6b5', '#ccfff5'],
    echo: ['#bea0bb', '#ffeff9'],
    film: ['#b5b4af', '#f8f3e5'],
    flare: ['#d0ae96', '#fff0cd'],
    tide: ['#91aeb2', '#e9f9f0'],
    ink: ['#a3aca0', '#eadfc7'],
  };
  const groups = [
    { name: '节奏', beat: true, entries: [
      ['impact', '重拍', '暗铜车间里的暖色节拍线，唱到的字轻弹'],
      ['cut', '切片', '冷色斜切舞台，字块错位后轻轻归位'],
      ['neon', '电台', '青绿调谐刻度，信号线沿着歌词推进'],
      ['echo', '叠声', '莓紫色声波从两侧散开，字边带着轻微回声'],
      ['film', '负片', '黑白宽银幕，歌词在胶片边框中显影'],
      ['flare', '耀斑', '暖色光环托住歌词，长音时字轻轻上浮'],
    ] },
    { name: '氛围', entries: [
      ['orbit', '星屑', '细小光点跟随字词向两侧散开'],
      ['tide', '潮线', '封面为舞台染色，水纹随节拍荡开，原词与译文居中'],
      ['ink', '洇墨', '深墨山影上的暖色书法，换句时墨影轻轻晕开'],
      ['mist', '晨雾', '整句穿过薄雾慢慢显现'],
      ['sunrise', '晨曦', '暖色光沿着歌词底部铺开'],
      ['petal', '花信', '深浅花瓣伴着字词轻轻翻落'],
    ] },
    { name: '构图', entries: [
      ['prism', '折光', '斜切色面滑过居中的大字'],
      ['stairs', '浮阶', '高低错落的字逐步归位'],
      ['paper', '纸幕', '几层折纸从对角舒展'],
      ['clock', '摆钟', '字沿弧面摆进刻度盘中央'],
      ['wide', '远景', '大字向两侧拉开，再收回中间'],
      ['still', '静止', '只显示居中的原词'],
    ] },
  ].map(({name, beat = false, entries}) => Object.freeze({
    name, entries: Object.freeze(entries.map(([id,label,description]) => {
      const [waiting, sung] = palettes[id] || [];
      return Object.freeze({id, label, description, beat:beat||id==='orbit',
        palette:waiting ? Object.freeze({waiting, sung}) : null});
    })),
  }));
  // 动效强度：轻=只做透明度/位移，中=元素入场，强=整屏构图变化。设置面板据此标注。
  const intensityById={
    impact:'strong',cut:'medium',neon:'medium',echo:'medium',film:'strong',flare:'strong',
    orbit:'light',tide:'medium',ink:'light',mist:'light',sunrise:'light',petal:'light',
    prism:'medium',stairs:'medium',paper:'medium',clock:'medium',wide:'strong',still:'light',
  };
  const presets = new Map(groups.flatMap(group => group.entries).map(preset =>
    [preset.id,Object.freeze({...preset,intensity:intensityById[preset.id]||'medium'})]));
  const get = id => presets.get(id) || presets.get('orbit');
  const clamp = (value, min=0, max=1) => Math.min(max, Math.max(min,value));
  const smooth = x => x * x * (3 - 2 * x);
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', {granularity:'word'}) : null;
  function units(line, end, timed) {
    if (timed.length) return timed;
    const parts = segmenter ? Array.from(segmenter.segment(line.text), item => item.segment) : [line.text];
    const spread = clamp((end-line.time)*.34, 0, .46);
    return parts.map((text,index) => {
      const start = line.time + index / parts.length * spread;
      return {text,start,end:Math.min(end,start+.32)};
    });
  }
  function lineFrame(position, start, end, animated) {
    if (!animated) return {enter:1, phase:.5, direction:0};
    const elapsed = Math.max(0,position-start);
    const phase = clamp(elapsed/Math.max(.05,end-start));
    return {enter:smooth(clamp(elapsed/Math.min(.48,Math.max(.12,(end-start)*.45)))), phase,
      direction:Math.sin(phase*Math.PI*2)};
  }
  function wordMotion(word, lineStart) {
    const duration = clamp((word.end-word.start)*.55+.16,.16,.48);
    const begin = Math.max(lineStart,word.start-.055);
    const voice = Math.max(.12,word.end-word.start);
    return {begin,duration,voice,finish:Math.max(begin+duration,word.start+voice)};
  }
  function wordFrame(word, position) {
    const {begin,duration,voice} = word.motion;
    const amount = clamp((position-begin)/duration);
    const voiced = clamp((position-word.start)/voice);
    return {rest:1-smooth(amount),note:Math.sin(Math.PI * voiced),
      wave:Math.sin(Math.PI * amount) * (word.order%2===0 ? 1 : -1)};
  }
  function applyBackdrop(stage,preset,photo) {
    stage.hidden=!preset;
    stage.dataset.fx=preset?.id||'';
    stage.toggleAttribute('data-soft-effect',Boolean(photo));
  }
  return Object.freeze({groups:Object.freeze(groups),get,units,lineFrame,wordMotion,wordFrame,applyBackdrop});
});
