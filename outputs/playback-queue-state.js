(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SonicPlaybackQueueState=api;
})(globalThis,function(){
  'use strict';
  const modes=['sequence','list','single','shuffle'];
  const reasons=['auth','connection','timeout','file','unplayable','resume-source'];
  function recovery(input){
    if(!input||!reasons.includes(input.reason))return null;
    const position=Number.isFinite(input.position)?Math.max(0,Math.min(86400,input.position)):0;
    return {reason:input.reason,position,
      ...(input.manual===true?{manual:true}:{}),
      ...(input.exhausted===true?{exhausted:true}:{})};
  }
  function checkpoint(queue,codecs){
    return {
      entries:queue.items.map(entry=>({trackId:entry.trackId,
        remote:codecs.remote(entry.remote)||undefined,
        chart:codecs.chart(entry.chart)||undefined,
        file:codecs.file(entry.file)||undefined})),
      current:queue.items.findIndex(entry=>entry.entryId===queue.currentId),
      mode:queue.mode,label:queue.label,
      ...(queue.fullOnly?{fullOnly:true}:{}),
      ...(queue.recovery?{recovery:queue.recovery}:{})
    };
  }
  function restore(point,{library,codecs,missing,playable}){
    const saved=point?.queue;
    if(!Array.isArray(saved?.entries)||!Number.isSafeInteger(saved.current)||saved.current<0||saved.current>=saved.entries.length)return null;
    const entries=[];
    let at=-1;
    for(const [index,data] of saved.entries.entries()){
      if(!data||typeof data.trackId!=='string')continue;
      const {trackId}=data;
      const remote=codecs.remote(data.remote),chart=codecs.chart(data.chart);
      const file=codecs.file(data.file)||missing.get(trackId)||(trackId===point.id?codecs.file(point.track):null);
      const stored=library.get(trackId),candidate=remote||stored||chart||file;
      if(candidate?.id!==trackId||!playable(candidate)&&candidate?.kind!=='chart')continue;
      if(index===saved.current&&trackId===point.id)at=entries.length;
      entries.push({candidate,remote,chart,file:stored?null:file});
    }
    if(at<0)return null;
    return {entries,at,mode:modes.includes(saved.mode)?saved.mode:null,
      label:typeof saved.label==='string'?saved.label.slice(0,80):'临时队列',
      fullOnly:saved.fullOnly===true,recovery:recovery(saved.recovery)||recovery(point.recovery)};
  }
  return Object.freeze({recovery,checkpoint,restore});
});

