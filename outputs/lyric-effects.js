/* The look is driven by the lyric clock so seeking never replays an entrance. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicLyricEffects = api;
})(globalThis, function () {
  'use strict';
  const groups = [
    { name: '节奏', entries: [
      ['impact', '重拍', '唱到的字弹起，随后落回基线'],
      ['cut', '切片', '左右错位的字块分段入场'],
      ['neon', '电台', '电蓝与粉红的扫描线划过文字'],
      ['echo', '叠声', '每个字展开层叠的色影'],
      ['film', '负片', '字从窄幅画框中逐段显影'],
      ['flare', '耀斑', '光点在长音附近亮起'],
    ] },
    { name: '氛围', entries: [
      ['orbit', '星屑', '细小光点跟随字词向两侧散开'],
      ['tide', '潮线', '文字沿柔和的波形浮起'],
      ['ink', '洇墨', '字形由墨晕逐渐收清'],
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
  ].map(({name, entries}) => Object.freeze({
    name, entries: Object.freeze(entries.map(([id,label,description]) => Object.freeze({id,label,description}))),
  }));
  const presets = new Map(groups.flatMap(group => group.entries).map(preset => [preset.id,preset]));
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
  return Object.freeze({groups:Object.freeze(groups),get,units,lineFrame,wordMotion,wordFrame});
});
