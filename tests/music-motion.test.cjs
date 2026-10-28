const assert = require('node:assert/strict');
const {create} = require('../outputs/music-motion.js');
const silent = {active:true,rms:0,bass:1,mid:1,high:1,spectrum:new Float32Array(96).fill(1)};
function run(motion, input, seconds, fps = 60) {
  for(let i = 0; i < Math.round(seconds * fps); i++) motion.update(input, 1 / fps);
  return motion.state;
}
const motion = create();
run(motion, silent, 2);
assert.equal(motion.state.cloud + motion.state.flow + motion.state.shimmer, 0);
assert.equal(motion.state.phase, 0);
assert.ok(motion.state.history.every(row => row.every(v => v === 0)));
const bass = {...silent,rms:.1,mid:0,high:0,spectrum:new Float32Array(96)};
run(motion, bass, 1);
assert.ok(motion.state.cloud > .95);
assert.equal(motion.state.flow + motion.state.shimmer, 0);
const afterBass = motion.state.cloud;
run(motion, {...silent,active:false}, .1);
assert.ok(motion.state.cloud < afterBass && motion.state.cloud > .7);
run(motion, {...silent,active:false}, 6);
assert.ok(motion.state.cloud < .001);
assert.ok(motion.state.history.every(row => row.every(v => v < .001)));
motion.reset();
const voice = {...silent,rms:.1,bass:0,high:0,spectrum:new Float32Array(96)};
voice.spectrum[52] = 1;voice.spectrum[53] = 1;
run(motion, voice, 2);
assert.equal(motion.state.cloud + motion.state.shimmer, 0);
assert.ok(motion.state.flow > .95 && motion.state.phase > 0);
assert.ok(motion.state.lanes.some(v => v > .1));
assert.ok(motion.state.lanes.some(v => v === 0));
const oldest = motion.state.history.map(row => row[20]);
run(motion, {...silent,active:false}, .2);
assert.ok(motion.state.history.some((row,i) => row[20] >= oldest[i] && row[0] < row[20]));
motion.reset();
const treble = {...silent,rms:.1,bass:0,mid:0,spectrum:new Float32Array(96)};
motion.update(treble, .05);
const transient = motion.state.shimmer;
run(motion, treble, 2);
assert.ok(transient > motion.state.shimmer * 2);
assert.equal(motion.state.cloud + motion.state.flow, 0);
const a = create(), b = create();
run(a, bass, .5, 30);run(b, bass, .5, 120);
assert.ok(Math.abs(a.state.cloud - b.state.cloud) < .0001);
run(a, {...silent,active:false}, 1, 30);run(b, {...silent,active:false}, 1, 120);
assert.ok(Math.abs(a.state.cloud - b.state.cloud) < .0001);
motion.reset();assert.equal(motion.state.phase, 0);assert.ok(motion.state.history.every(row => row.every(v => v === 0)));
// Narrow tones between lane centers must still leave a trail.
for(let band = 28; band < 77; band++) {
  motion.reset();const spectrum = new Float32Array(96);spectrum[band] = 1;
  run(motion, {...voice,spectrum}, .5);
  assert.ok(motion.state.lanes.some(v => v > .9), 'missing midrange band '+band);
}
console.log('PASS silence, separated sound layers, attack/release, spectral history, treble transients, frame-rate independence and reset');
