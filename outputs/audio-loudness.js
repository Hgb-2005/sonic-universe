/* Loudness measurement contracts: gated RMS estimate, peak and playback compensation.
   Pure functions over decoded channel data so the node suite can cover them. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SonicAudioLoudness=api})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const BLOCK_SECONDS=.4;          // EBU R128 用 400ms 门限块
  const SILENCE_DB=-70;            // 低于这个当作静音，不参与平均
  const relativeGate=-10;          // 比最响块低 10dB 的块不计入，避免前奏和安静段落拉低结果

  const toDb=value=>value>0?20*Math.log10(value):-Infinity;
  const fromDb=db=>Number.isFinite(db)?Math.pow(10,db/20):0;

  function peakOf(channels){
    let peak=0;
    for(const data of channels||[]){
      for(let i=0;i<data.length;i++){const v=Math.abs(data[i]);if(v>peak)peak=v}
    }
    return peak;
  }

  // 分块 RMS，相对门限后取平均，得到近似积分响度（dBFS）。
  function estimateLoudnessDb(channels,sampleRate){
    const rate=Number.isFinite(sampleRate)&&sampleRate>0?sampleRate:48000;
    const blockSize=Math.max(1,Math.round(rate*BLOCK_SECONDS));
    const blocks=[];
    const list=channels||[];
    if(!list.length)return -Infinity;
    const length=Math.min(...list.map(data=>data.length));
    for(let start=0;start+blockSize<=length;start+=blockSize){
      let sum=0;
      for(const data of list){
        for(let i=start;i<start+blockSize;i++){const v=data[i];sum+=v*v}
      }
      const rms=Math.sqrt(sum/(blockSize*list.length));
      blocks.push(toDb(rms));
    }
    if(!blocks.length){return toDb(Math.sqrt(list.reduce((acc,data)=>{for(let i=0;i<data.length;i++)acc+=data[i]*data[i];return acc},0)/(Math.max(1,length)*list.length)))}
    const audible=blocks.filter(db=>db>SILENCE_DB);
    if(!audible.length)return -Infinity;
    const loudest=Math.max(...audible);
    const gated=audible.filter(db=>db>=loudest+relativeGate);
    return gated.reduce((a,b)=>a+b,0)/gated.length;
  }

  // 播放补偿：目标 -14 LUFS，最多 ±9dB；测不到就返回 0。
  function gainForLoudness(loudness,target=-14,maxBoost=9,maxCut=9){
    if(!Number.isFinite(loudness))return 0;
    const want=target-loudness;
    return Math.min(Math.abs(maxBoost),Math.max(-Math.abs(maxCut),want));
  }

  function describe(loudness){
    if(!Number.isFinite(loudness))return '未测量';
    return loudness.toFixed(1)+' dB';
  }

  return Object.freeze({BLOCK_SECONDS,SILENCE_DB,relativeGate,peakOf,estimateLoudnessDb,gainForLoudness,describe,toDb,fromDb});
});
