'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const queue=require('../outputs/playback-queue-state.js');

const first={id:'track-local',kind:'file',name:'本地'};
const missing={id:'track-missing',kind:'file',name:'旧副本'};
const online={id:'online:qishui:31',kind:'online',provider:'qishui',mediaId:'31'};
const chart={id:'chart:sample',kind:'chart',artist:'验收'};
const codecs={
  remote:value=>value?.kind==='online'?value:null,
  chart:value=>value?.kind==='chart'?value:null,
  file:value=>value?.kind==='file'?value:null,
};
const data={library:new Map([[first.id,first]]),missing:new Map([[missing.id,missing]]),codecs,
  playable:track=>['file','online','demo'].includes(track?.kind)};
test('queue checkpoint preserves selected duplicate, remote metadata, order and recovery position',()=>{
  const saved=queue.checkpoint({
    items:[{entryId:'first',trackId:first.id},{entryId:'second',trackId:online.id,remote:online},
      {entryId:'duplicate',trackId:first.id},{entryId:'chart',trackId:chart.id,chart}],
    currentId:'duplicate',mode:'shuffle',label:'原顺序',fullOnly:true,recovery:{reason:'connection',position:27.5},
  },codecs);
  const restored=queue.restore({id:first.id,queue:saved},data);
  assert.equal(restored.at,2);
  assert.deepEqual(restored.entries.map(entry=>entry.candidate.id),[first.id,online.id,first.id,chart.id]);
  assert.equal(restored.mode,'shuffle');
  assert.equal(restored.label,'原顺序');
  assert.equal(restored.fullOnly,true);
  assert.deepEqual(restored.recovery,{reason:'connection',position:27.5});
});
test('old missing files and playback recovery survive while malformed entries are skipped',()=>{
  const saved={entries:[null,{trackId:'deleted'},{trackId:missing.id}],current:2,mode:'unknown'};
  const restored=queue.restore({id:missing.id,queue:saved,recovery:{reason:'file',position:-1,manual:true}},data);
  assert.equal(restored.at,0);
  assert.equal(restored.entries[0].file,missing);
  assert.equal(restored.mode,null);
  assert.deepEqual(restored.recovery,{reason:'file',position:0,manual:true});
  assert.equal(queue.restore({id:missing.id,queue:{...saved,current:0}},data),null);
  assert.equal(queue.recovery({reason:'unknown',position:70}),null);
});

