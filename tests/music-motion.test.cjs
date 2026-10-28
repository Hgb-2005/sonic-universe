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

// A sustained low note starts once, then settles; repeated attacks keep a pulse.
const held = create(), drums = create();
run(held, bass, 4);
let peak = 0, pulseTotal = 0;
for(let i = 0; i < 240; i++) {
  const on = (i % 30) < 7;
  drums.update({...bass,rms:on?.1:0,bass:on?1:0}, 1/60);
  if(i > 60) {peak = Math.max(peak, drums.state.percussion);pulseTotal += drums.state.percussion;}
}
assert.ok(held.state.percussion < .0001);
assert.ok(peak > .8 && pulseTotal / 179 > .2);
assert.ok(held.state.sustain > drums.state.sustain * 2);
const wash = create();run(wash, voice, 4);
assert.ok(wash.state.sustain > .6 && wash.state.drift > .6);
const sparkle = create();sparkle.update(treble, 1/60);const firstSpark = sparkle.state.shimmer;
run(sparkle, treble, 3);assert.ok(sparkle.state.air > .9 && sparkle.state.shimmer < firstSpark);
for(const fps of [30,60,120]) {
  const m = create();run(m,bass,2,fps);run(m,{...silent,active:false},1,fps);
  assert.ok(m.state.sustain > .04 && m.state.sustain < .13);
  run(m,{...silent,active:false},7,fps);
  for(const key of ['cloud','flow','shimmer','presence','sustain','percussion','air','drift']) assert.ok(m.state[key]<.002,key);
  m.reset();assert.ok(Object.values(m.state).filter(v=>typeof v==='number').every(v=>v===0));
}
const invalid = create();invalid.update({active:true,rms:NaN,bass:Infinity,mid:-1,high:NaN},1/60);
assert.ok(['cloud','flow','shimmer','presence','sustain','percussion','air','drift','phase'].every(key=>invalid.state[key]===0));
assert.equal(invalid.update(bass,0).cloud,0);
console.log('PASS sustained tones, repeated low attacks, air, silence decay, invalid input and motion reset at 30/60/120 fps');
