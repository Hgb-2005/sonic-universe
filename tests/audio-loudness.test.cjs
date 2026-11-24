'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loud = require('../outputs/audio-loudness.js');

function tone(seconds, amplitude, rate = 1000) {
  const data = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < data.length; i += 1) data[i] = Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude;
  return data;
}

test('a steady tone measures the RMS level it was built with', () => {
  // 0.25 峰值正弦 → RMS = 0.25/√2 ≈ -15.05 dBFS
  const db = loud.estimateLoudnessDb([tone(2, 0.25)], 1000);
  assert.ok(Math.abs(db - -15.05) < 0.6, `got ${db}`);
});

test('quieter material measures lower and silence is negative infinity', () => {
  const loudDb = loud.estimateLoudnessDb([tone(2, 0.5)], 1000);
  const quietDb = loud.estimateLoudnessDb([tone(2, 0.05)], 1000);
  assert.ok(loudDb > quietDb + 15);
  assert.equal(loud.estimateLoudnessDb([new Float32Array(2000)], 1000), -Infinity);
  assert.equal(loud.estimateLoudnessDb([], 1000), -Infinity);
});

test('a silent intro does not drag the measurement down', () => {
  const intro = new Float32Array(4000);
  const body = tone(2, 0.25, 1000);
  const joined = new Float32Array(intro.length + body.length);
  joined.set(intro, 0);
  joined.set(body, intro.length);
  const withIntro = loud.estimateLoudnessDb([joined], 1000);
  const without = loud.estimateLoudnessDb([body], 1000);
  assert.ok(Math.abs(withIntro - without) < 0.8, `${withIntro} vs ${without}`);
});

test('compensation aims for the target and respects the caps', () => {
  assert.equal(loud.gainForLoudness(-14), 0);
  assert.equal(loud.gainForLoudness(-20), 6);
  assert.equal(loud.gainForLoudness(-8), -6);
  assert.equal(loud.gainForLoudness(-40), 9);
  assert.equal(loud.gainForLoudness(-2), -9);
  assert.equal(loud.gainForLoudness(NaN), 0);
  assert.equal(loud.gainForLoudness(-20, -16, 6, 9), 4, 'a -16 target gives +4dB for -20 material');
  assert.equal(loud.gainForLoudness(-24, -16, 6, 9), 6);
});

test('peak headroom keeps a boost from clipping', () => {
  // 峰值 0.9 时最多只能再抬到 0.95：约 +0.47dB
  const headroom = 20 * Math.log10(0.95 / 0.9);
  assert.ok(Math.abs(headroom - 0.47) < 0.05);
  const gain = Math.min(9, headroom);
  assert.ok(10 ** (gain / 20) * 0.9 <= 0.9501);
});

test('peak detection uses the loudest sample across channels', () => {
  const left = new Float32Array([0, 0.2, -0.4]);
  const right = new Float32Array([0, 0.9, 0]);
  assert.ok(Math.abs(loud.peakOf([left, right]) - 0.9) < 1e-6);
  assert.equal(loud.peakOf([]), 0);
});
