'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const scenes = require('../outputs/reactive-scenes.js');

test('automatic scenes use a repeatable per-song choice and react to sustained energy', () => {
  const song = {track:'test-artist:test-track1', selected:'auto', active:true, elapsed:.1};
  const director = scenes.createDirector();
  const starting = director.update(song);
  assert.equal(scenes.createDirector().update(song),starting);
  assert.equal(starting,'prism-bloom');

  let scene;
  const energetic = {...song,sound:{presence:.95,bass:.97,high:.83}};
  for(let frame=0;frame<20;frame++)scene=director.update(energetic);
  assert.equal(scene,starting,'brief peaks keep the scene stable');
  for(let frame=0;frame<190;frame++)scene=director.update(energetic);
  assert.equal(scene,'prism-tunnel');

  for(let frame=0;frame<270;frame++)scene=director.update({...song,active:false});
  assert.equal(scene,'prism-tunnel','paused playback keeps its automatic choice');
  for(let frame=0;frame<210;frame++)scene=director.update(song);
  assert.equal(scenes.get(scene).group,'山水');
});

test('explicit scenes take priority and preference recovery accepts only catalogue ids', () => {
  const director = scenes.createDirector();
  assert.equal(director.update({track:'pinned',selected:'jiangnan-rain',active:true,elapsed:.1}),'jiangnan-rain');
  assert.equal(scenes.normalizeSelection('orbit-particles'),'orbit-particles');
  assert.equal(scenes.normalizeSelection('constructor'),'auto');
  assert.equal(new Set(scenes.catalogue.map(scene=>scene.id)).size,12);
});

test('a sustained timbre change waits for the next bar even when loudness stays steady',()=>{
  const director=scenes.createDirector();
  const frame={track:'sections',active:true,elapsed:.1,selected:'auto'};
  const start={presence:.57,bass:.45,mid:.08,high:.14};
  const changed={presence:.57,bass:.14,mid:.08,high:.45};
  for(let i=0;i<135;i++)director.update({...frame,sound:start});
  for(let i=0;i<25;i++)assert.equal(director.update({...frame,sound:{...changed,beat:{locked:true,bar:12,barPhase:.55}}}),'prism-bloom');
  assert.equal(director.update({...frame,sound:{...changed,beat:{locked:true,bar:13,barPhase:0}}}),'silkscreen');
});

test('Jiangnan holds the composition on a brief accent and follows sustained changes at a bar boundary', () => {
  const director = scenes.createJiangnanDirector();
  const calm = {presence:.28, mid:.30, rms:.035};
  const swell = {presence:.83, mid:.77, rms:.11};
  const quiet = {presence:.06, mid:.11, rms:.008};
  const transitions = [];
  let previous;
  for (let frame = 0; frame < 620; frame++) {
    const time = frame / 10;
    const sound = time < 5 || time >= 52 ? quiet : time >= 26 && time < 47 ? swell : calm;
    const accent = time >= 16 && time < 16.5;
    const beat = {locked:true, bar:Math.floor(time/2), barPhase:(time%2)/2};
    const state = director({track:'song', position:time, duration:62, elapsed:.1, sound:{...(accent?swell:sound),beat}});
    if (state.phase !== previous) transitions.push({phase:state.phase, time});
    previous = state.phase;
  }
  assert.deepEqual(transitions.map(step => step.phase),[0,1,2,1,0]);
  const opening = transitions.find(step => step.phase === 2);
  assert.ok(opening.time > 28 && opening.time < 34);
  assert.ok(opening.time % 2 <= .1,'the first strong sustained section opens on the bar');
  assert.equal(director({track:'next', position:0, duration:60, elapsed:.1, sound:swell}).phase,0);
});
