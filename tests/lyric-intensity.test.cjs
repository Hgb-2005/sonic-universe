'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const effects = require('../outputs/lyric-effects.js');

const all = effects.groups.flatMap(group => group.entries);

test('every lyric effect declares a usable intensity', () => {
  assert.equal(all.length, 18);
  for (const entry of all) {
    const preset = effects.get(entry.id);
    assert.ok(['light', 'medium', 'strong'].includes(preset.intensity), entry.id + ' -> ' + preset.intensity);
  }
});

test('intensity covers all three bands so the panel can filter', () => {
  const counts = { light: 0, medium: 0, strong: 0 };
  for (const entry of all) counts[effects.get(entry.id).intensity] += 1;
  assert.ok(counts.light >= 3, 'some gentle options must exist');
  assert.ok(counts.medium >= 3);
  assert.ok(counts.strong >= 3);
});

test('the featured row mixes intensities instead of showing only strong ones', () => {
  const featured = ['tide', 'cut', 'film', 'ink', 'orbit', 'still'].map(id => effects.get(id).intensity);
  assert.ok(new Set(featured).size >= 2, 'featured: ' + featured.join(','));
});

test('unknown ids still fall back to a real preset', () => {
  const fallback = effects.get('not-a-real-effect');
  assert.equal(fallback.id, 'orbit');
  assert.equal(fallback.intensity, 'light');
});
