/* Sound envelopes shared by the artwork, instrument preview and video renderer. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicMusicMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
  const follow = (value, target, dt, attack, release) => value + (target - value) * (1 - Math.exp(-dt / (target > value ? attack : release)));
  const laneCount = 18, historyLength = 30, historyStep = .055;

  function create() {
    const state = {
      cloud: 0, flow: 0, shimmer: 0, presence: 0, phase: 0,
      sustain: 0, percussion: 0, air: 0, drift: 0,
      lanes: new Float32Array(laneCount),
      history: Array.from({length: laneCount}, () => new Float32Array(historyLength)),
      historyMix: 0
    };
    let previousHigh = 0, previousLow = 0, lowFloor = 0, clock = 0;
    function reset() {
      state.cloud = state.flow = state.shimmer = state.presence = state.phase = 0;
      state.sustain = state.percussion = state.air = state.drift = 0;
      state.lanes.fill(0);state.history.forEach(row => row.fill(0));
      state.historyMix = previousHigh = previousLow = lowFloor = clock = 0;
    }
    function update(input, seconds) {
      const dt = clamp(seconds, 0, .1);
      if (!dt) return state;
      // A silent file is silence too. Never fabricate motion from the playback flag.
      const gate = input.active ? clamp((input.rms - .0015) / .0045) : 0;
      const bass = clamp(input.bass) * gate, mid = clamp(input.mid) * gate, high = clamp(input.high) * gate;
      // Compare envelopes over time, so a held tone does not keep becoming a new hit.
      const highRise = Math.max(0, high - previousHigh) / dt;
      const lowRise = Math.max(0, bass - previousLow) / dt;
      const onset = clamp(lowRise * .14) * clamp((bass - lowFloor - .025) * 2.4);
      lowFloor = follow(lowFloor, bass, dt, .42, .8);
      previousHigh = high; previousLow = bass;
      state.presence = follow(state.presence, gate, dt, .18, .6);
      state.cloud = follow(state.cloud, bass, dt, .16, .8);
      state.flow = follow(state.flow, mid, dt, .12, .48);
      state.shimmer = follow(state.shimmer, clamp(high * .22 + highRise * .16), dt, .025, .24);
      state.percussion = Math.max(state.percussion * Math.exp(-dt / .23), onset);
      state.sustain = follow(state.sustain, (bass * .35 + mid * .65) * (1 - state.percussion * .65), dt, 1.1, .8);
      state.air = follow(state.air, high * (1 - clamp(highRise * .08) * .7), dt, .65, .7);
      state.drift = follow(state.drift, clamp(state.flow * .45 + state.sustain * .4 + state.percussion * .15), dt, .8, 1.1);
      state.phase += dt * state.flow * .34;
      for (let i = 0; i < laneCount; i++) {
        // 200 Hz–4 kHz of the existing 38 Hz–12.5 kHz logarithmic spectrum.
        const source = input.spectrum || [];
        const low = 200 * Math.pow(4000 / 200, i / laneCount);
        const high = 200 * Math.pow(4000 / 200, (i + 1) / laneCount);
        const bin = hz => Math.log(hz / 38) / Math.log(12500 / 38) * source.length;
        const first = Math.max(0, Math.floor(bin(low))), end = Math.min(source.length, Math.ceil(bin(high)));
        let value = 0;
        for(let band = first; band < end; band++) value = Math.max(value, clamp(source[band]));
        state.lanes[i] = follow(state.lanes[i], value * gate, dt, .09, .4);
      }
      clock += dt;
      while (clock >= historyStep) {
        clock -= historyStep;
        state.history.forEach((row, i) => {row.copyWithin(1, 0, historyLength - 1);row[0] = state.lanes[i];});
      }
      state.historyMix = clock / historyStep;
      return state;
    }
    return {state, update, reset};
  }
  return {create, laneCount, historyLength};
});
