'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tuning = require('../outputs/audio-tuning.js');

test('perceptual volume keeps the ends and bends the middle', () => {
  assert.equal(tuning.perceptualGain(0), 0);
  assert.equal(tuning.perceptualGain(1), 1);
  const half = tuning.perceptualGain(0.5);
  assert.ok(half > 0.15 && half < 0.3, `half slider should be about -13 dB, got ${half}`);
  assert.ok(Math.abs(tuning.dbOf(half) - -13.2) < 1.5);
});

test('perceptual volume is monotonic and clamped', () => {
  let previous = -1;
  for (let i = 0; i <= 20; i += 1) {
    const gain = tuning.perceptualGain(i / 20);
    assert.ok(gain >= previous, 'gain must not decrease as the slider grows');
    previous = gain;
  }
  assert.equal(tuning.perceptualGain(-5), 0);
  assert.equal(tuning.perceptualGain(9), 1);
  assert.equal(tuning.perceptualGain(NaN), 0);
});

test('slider percent is the inverse of perceptual gain', () => {
  for (const value of [0, 0.1, 0.37, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(tuning.sliderPercent(tuning.perceptualGain(value)) - value) < 1e-9);
  }
});

test('decibel helpers agree with the usual definition', () => {
  assert.ok(Math.abs(tuning.dbOf(0.5) - -6.0206) < 1e-3);
  assert.ok(Math.abs(tuning.gainOfDb(-6.0206) - 0.5) < 1e-3);
  assert.equal(tuning.dbOf(0), -Infinity);
  assert.equal(tuning.gainOfDb(NaN), 0);
  assert.equal(tuning.formatDb(-Infinity), '-∞ dB');
  assert.equal(tuning.formatDb(3.04), '+3.0 dB');
});

test('loudness normalisation boosts quiet tracks and cuts loud ones within limits', () => {
  assert.equal(tuning.loudnessGainDb(-14), 0);
  assert.equal(tuning.loudnessGainDb(-20), 6);
  assert.equal(tuning.loudnessGainDb(-8), -6);
  assert.equal(tuning.loudnessGainDb(-30), 9, 'boost is capped');
  assert.equal(tuning.loudnessGainDb(-2), -9, 'cut is capped');
  assert.equal(tuning.loudnessGainDb(NaN), 0, 'a missing measurement leaves playback alone');
});

test('the rate table is the one the settings offer', () => {
  assert.deepEqual([...tuning.RATES], [0.75, 1, 1.25, 1.5, 2]);
});
