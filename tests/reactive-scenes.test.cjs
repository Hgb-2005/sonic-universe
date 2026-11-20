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
  assert.equal(new Set(scenes.catalogue.map(scene=>scene.id)).size,9);
});
