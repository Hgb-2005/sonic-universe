const assert = require("node:assert/strict");
const { test } = require("node:test");
const presets = require("../outputs/visual-presets.js");

test("the scene library retains eight looks and adds three complete starter templates", () => {
  assert.equal(presets.length, 11);
  assert.equal(new Set(presets.map(preset => preset.id)).size, presets.length);
  assert.equal(new Set(presets.map(preset => preset.name)).size, presets.length);
  for (const { id, name, look } of presets) {
    assert.ok(id && name);
    assert.ok(["nebula", "galaxy", "solar"].includes(look.theme), id);
    assert.ok(["ring", "galaxy", "peaks", "blackhole"].includes(look.visualMode), id);
    assert.ok(look.motionSpeed >= .25 && look.motionSpeed <= 2, id);
    assert.ok(look.particleCount >= 400 && look.particleCount <= 6000, id);
    assert.ok(look.intensity >= .2 && look.intensity <= 1, id);
    assert.ok(look.depth >= 0 && look.depth <= 1 && look.glow >= 0 && look.glow <= 1, id);
    assert.ok(look.trail >= 0 && look.trail <= 1, id);
    assert.ok(["soft", "balanced", "strong"].includes(look.response), id);
    assert.equal(typeof look.beat, "boolean", id);
  }
});

test("starter templates capture stable scenes and a useful energy-saving option", () => {
  const cinema = presets.find(p => p.id === 'deep-cinema');
  const gold = presets.find(p => p.id === 'gold-softlight');
  const eco = presets.find(p => p.id === 'eco-stardust');
  assert.equal(cinema.look.visualMode, 'galaxy');
  assert.equal(cinema.look.response, 'balanced');
  assert.equal(gold.look.theme, 'solar');
  assert.equal(gold.look.visualMode, 'ring');
  assert.equal(eco.look.energySaver, true);
  assert.ok(eco.look.particleCount <= 1000 && eco.look.trail <= .28);
  for (const preset of [cinema, gold, eco]) {
    assert.equal(preset.look.journeyAuto, false);
    assert.equal(preset.look.storyEnabled, false);
  }
});
