/* Audio tuning contracts: perceptual volume, loudness normalisation and playback rates.
   Pure functions only, so the same file serves the page and the node test suite. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SonicAudioTuning=api})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const RATES=Object.freeze([.75,1,1.25,1.5,2]);
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number.isFinite(value)?value:min));
  // 滑块 0..1 → 线性增益。指数 2.2 是常见取舍：低端多一点行程，1.0 仍是 0 dB。
  function perceptualGain(value){
    const v=clamp(value,0,1);
    return v===0?0:Math.pow(v,2.2);
  }
  function sliderPercent(gain){
    const g=clamp(gain,0,1);
    return g===0?0:Math.pow(g,1/2.2);
  }
  function dbOf(gain){
    const g=Number.isFinite(gain)?gain:0;
    return g>0?20*Math.log10(g):-Infinity;
  }
  function gainOfDb(db){
    return Number.isFinite(db)?Math.pow(10,db/20):0;
  }
  // 响度归一化：把测量响度拉到目标，最多 ±maxDb；测量值缺失时不动。
  function loudnessGainDb(loudness,target=-14,maxBoost=9,maxCut=9){
    if(!Number.isFinite(loudness))return 0;
    return clamp(target-loudness,-Math.abs(maxCut),Math.abs(maxBoost));
  }
  function formatDb(db){
    if(!Number.isFinite(db))return '-∞ dB';
    return (db>0?'+':'')+db.toFixed(1)+' dB';
  }
  return Object.freeze({RATES,clamp,perceptualGain,sliderPercent,dbOf,gainOfDb,loudnessGainDb,formatDb});
});
