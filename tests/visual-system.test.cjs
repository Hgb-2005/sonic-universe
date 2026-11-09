const assert = require("node:assert/strict");
const { test } = require("node:test");
const visual = require("../outputs/visual-system.js");

test("look normalization preserves v19 defaults and rejects invalid values", () => {
  assert.deepEqual(visual.normalizeLook({}), visual.DEFAULTS);
  const clean = visual.normalizeLook({
    theme: "invalid",
    visualMode: "invalid",
    motionSpeed: Infinity,
    particleCount: 1234,
    intensity: -4,
    depth: 9,
    glow: "0.5",
    trail: 2,
    response: "wild",
    beat: "yes",
  });
  assert.equal(clean.theme, "nebula");
  assert.equal(clean.visualMode, "ring");
  assert.equal(clean.particleCount, 1200);
  assert.equal(clean.intensity, 0.2);
  assert.equal(clean.depth, 1);
  assert.equal(clean.glow, 0.5);
  assert.equal(clean.trail, 1);
  assert.equal(clean.response, "balanced");
  assert.equal(clean.beat, false);
});

test("share links round-trip visual state without private content", () => {
  const look = visual.normalizeLook({
    visualMode: "blackhole",
    theme: "solar",
    trail: 0.55,
    intensity: 0.7,
    particleCount: 2400,
    response: "strong",
    beat: true,
    depth: 0.72,
    glow: 0.64,
    motionSpeed: 1.25,
  });
  const url = visual.serializeShare(look, "https://hgb-2005.github.io/sonic-universe/");
  assert.doesNotMatch(url, /lyrics|song|author|private/i);
  const parsed = visual.parseShare(new URL(url).search, visual.DEFAULTS);
  assert.equal(parsed.hasVisualState, true);
  assert.deepEqual(parsed.look, look);
});

test("invalid or out-of-range share values use safe defaults", () => {
  const parsed = visual.parseShare("?visualMode=nope&trail=999&response=wild&beat=yes&particleCount=4", visual.DEFAULTS);
  assert.deepEqual(parsed.look, visual.DEFAULTS);
  assert.equal(parsed.hasVisualState, false);
});

test("mobile performance caps display values without rewriting the request", () => {
  const look = visual.normalizeLook({ particleCount: 6000, trail: 1 });
  const mobile = visual.performanceProfile({ width: 390, coarsePointer: true, dpr: 3 });
  const effective = visual.effectiveLook(look, mobile);
  assert.equal(mobile.tier, "mobile");
  assert.ok(effective.effectiveParticleCount <= 1700);
  assert.ok(effective.effectiveTrail <= 0.73);
  assert.equal(look.particleCount, 6000);
  assert.equal(look.trail, 1);
});

test("automatic journey continuously covers all four scenes", () => {
  const checkpoints = [0, 0.38, 0.62, 0.88, 1];
  const expected = ["ring", "galaxy", "peaks", "blackhole", "blackhole"];
  checkpoints.forEach((progress, index) => {
    const weights = visual.journeyWeights(progress);
    const dominant = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(dominant, expected[index], `at ${progress}`);
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });
});

test("trail decay and beat gate behave deterministically", () => {
  assert.equal(visual.trailAlpha(0, 1 / 60), 1);
  assert.ok(visual.trailAlpha(1, 1 / 60) < visual.trailAlpha(0.2, 1 / 60));
  assert.equal(visual.beatGate(0.9, 0.3, false, false).hit, false);
  assert.equal(visual.beatGate(0.9, 0.3, true, true).hit, false);
  assert.deepEqual(visual.beatGate(0.9, 0.3, true, false), {
    hit: true,
    envelope: 1,
    previous: 0.9,
  });
});

test("noise is finite, centered and changes smoothly", () => {
  const samples = Array.from({ length: 40 }, (_, index) => visual.fbm2(index * 0.17, index * 0.09, 3));
  assert.ok(samples.every(Number.isFinite));
  assert.ok(samples.some(value => value > 0) && samples.some(value => value < 0));
  assert.ok(Math.abs(visual.fbm2(2.1, 3.7, 3) - visual.fbm2(2.1, 3.7, 3)) < 1e-12);
  assert.ok(Math.abs(visual.fbm2(2.1, 3.7, 3) - visual.fbm2(2.11, 3.7, 3)) < 0.08);
});
