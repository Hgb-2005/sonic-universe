'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('../outputs/lyric-ink.js');

test('dark surfaces get light ink and light surfaces get dark ink', () => {
  assert.equal(ink.tonedInk('dark').text, ink.DARK.text);
  assert.equal(ink.tonedInk('light').text, ink.LIGHT.text);
  assert.notEqual(ink.DARK.text, ink.LIGHT.text);
});

test('dark surfaces get a two-layer halo, light surfaces only a tight bright edge', () => {
  const darkLayers = ink.tonedInk('dark').shadow.split(', ').filter(part => /rgba\(/.test(part));
  assert.ok(darkLayers.length >= 2, 'dark ink needs both a tight and a wide glow');
  const lightShadow = ink.tonedInk('light').shadow;
  assert.ok(/rgba\(/.test(lightShadow), 'light ink still keeps an edge');
  // 亮底上不做大范围虚光，否则细笔画会被洗淡
  const blur = Number((lightShadow.match(/0px (\d+)px/) || [0, 0])[1]);
  assert.ok(blur <= 2, 'light ink halo must stay tight, got ' + blur + 'px');
});

test('the readable weight sits below bold so the edge is softer', () => {
  assert.ok(ink.tonedInk('dark').weight <= 600);
  assert.ok(ink.tonedInk('dark').weight >= 500);
});

test('background entries drive the tone, unknown ones fall back to light ink', () => {
  assert.equal(ink.backgroundTone({ tone: 'light' }), 'light');
  assert.equal(ink.backgroundTone({ tone: 'dark' }), 'dark');
  assert.equal(ink.backgroundTone(null), 'dark');
});

test('bright scenes switch to dark ink while night scenes keep light ink', () => {
  assert.equal(ink.sceneTone('amber-dunes'), 'dark');
  assert.equal(ink.sceneTone('tide-dial'), 'dark');
  assert.equal(ink.sceneTone('silkscreen'), 'light');
  assert.equal(ink.sceneTone('jiangnan-rain'), 'dark');
  assert.equal(ink.sceneTone('violet-aurora'), 'dark');
  assert.equal(ink.sceneTone('not-a-scene'), 'dark');
});

test('css variables include everything the stylesheet needs', () => {
  const vars = ink.cssVars('light');
  for (const key of ['--lyric-ink', '--lyric-ink-waiting', '--lyric-ink-translation', '--lyric-ink-shadow', '--lyric-ink-weight']) {
    assert.ok(vars[key], key + ' missing');
  }
});
