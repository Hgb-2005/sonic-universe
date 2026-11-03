const {test}=require('node:test');
const assert=require('node:assert/strict');
const Pack=require('../outputs/project-pack.js');
const fixture=()=>({state:[['library',{version:5,tracks:[{id:'song-1',kind:'file',name:'我的音乐',cover:'data:image/png;base64,aA=='}],playlists:[{id:'list',trackIds:['song-1']}]}],['atelier',{version:1,songs:{'song-1':{lyrics:[{at:2,text:'星光'}]}}}]],media:[['song-1',new Blob([new Uint8Array([0,1,2,255,9])],{type:'audio/wav'})]],preferences:[[Pack.KEYS[0],'{"id":"song-1","position":2}']]});

test('full pack preserves binary music, artwork, playlists, lyrics and preferences',async()=>{
  const original=fixture(),blob=await Pack.encode(original),restored=await Pack.decode(blob);
  assert.deepEqual(restored.state,original.state);assert.deepEqual(restored.preferences,original.preferences);
  assert.equal(restored.media[0][1].type,'audio/wav');
  assert.deepEqual(new Uint8Array(await restored.media[0][1].arrayBuffer()),new Uint8Array([0,1,2,255,9]));
});
test('truncation, wrong format, missing media and duplicate tracks are rejected',async()=>{
  const blob=await Pack.encode(fixture());
  await assert.rejects(Pack.decode(blob.slice(0,blob.size-1)),/不完整/);
  await assert.rejects(Pack.decode(new Blob(['not a sonic pack'])),/sonicpack/);
  let f=fixture();f.media=[];await assert.rejects(Pack.encode(f),/缺少歌曲/);
  f=fixture();f.state[0][1].tracks.push({...f.state[0][1].tracks[0]});await assert.rejects(Pack.encode(f),/重复/);
});
test('quota failure rolls preferences back before any database change',async()=>{
  const values=new Map([[Pack.KEYS[0],'old']]);
  const storage={getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k),setItem:(k,v)=>{if(v==='too large')throw Error('quota');values.set(k,v);}};
  await assert.rejects(Pack.restore({transaction(){throw Error('must not reach DB');}},storage,{preferences:[[Pack.KEYS[0],'too large']]}),/quota/);
  assert.deepEqual([...values],[[Pack.KEYS[0],'old']]);
});

test('an intentionally empty library still preserves the creative workspace',async()=>{
  const original=fixture();original.state[0][1].tracks=[];original.state[0][1].playlists=[];original.media=[];
  const restored=await Pack.decode(await Pack.encode(original));
  assert.deepEqual(restored.state,original.state);assert.deepEqual(restored.media,[]);
});
