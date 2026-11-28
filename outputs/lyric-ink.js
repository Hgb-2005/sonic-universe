/* Lyric ink: pick text colour and a two-layer halo from the surface it sits on.
   Mirrors the trick Folia uses in wordGlow.ts — glyph body and glow move separately,
   so a highlight never thins the readable shape. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SonicLyricInk=api})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const DARK={'text':'#f4f8f5','waiting':'rgba(214,226,220,.62)','translation':'rgba(223,234,228,.78)',
    shadow:'0 1px 2px rgba(4,12,10,.45), 0 8px 30px rgba(4,12,10,.32)',weight:560};
  const LIGHT={'text':'#10201d','waiting':'rgba(14,28,25,.88)','translation':'rgba(18,34,30,.9)',
    // 深墨落在亮底上不需要大光晕，白色虚光会把细笔画洗淡，只留一圈紧实的亮边。
    shadow:'0 1px 1px rgba(255,255,255,.28)',weight:560};
  // 这些场景底色偏亮，歌词改用深色墨。
  const LIGHT_SCENES=new Set(['silkscreen']);
  function sceneTone(id){return LIGHT_SCENES.has(id)?'light':'dark'}
  function tonedInk(tone){return tone==='light'?{...LIGHT}:{...DARK}}
  // 背景条目自带 tone；没有就按 id 猜，未知一律走深色墨（更保险）。
  function backgroundTone(entry){
    if(!entry)return 'dark';
    if(entry.tone==='light')return 'light';
    return 'dark';
  }
  function cssVars(tone){
    const ink=tonedInk(tone);
    return {'--lyric-ink':ink.text,'--lyric-ink-waiting':ink.waiting,'--lyric-ink-translation':ink.translation,
      '--lyric-ink-shadow':ink.shadow,'--lyric-ink-weight':String(ink.weight)};
  }
  return Object.freeze({DARK,LIGHT,LIGHT_SCENES,sceneTone,tonedInk,backgroundTone,cssVars});
});
