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

  function createBeatTracker() {
    const state = {
      sequence:0, age:Infinity, strength:0, bpm:0, confidence:0,
      locked:false, phase:null, beatInBar:null, barPhase:null, bar:0, pulse:0,
    };
    const intervals = [];
    const tempoIntervals = [];
    const previous = new Float32Array(5);
    const envelope = new Float32Array(5);
    let time = -Infinity, startedAt = -Infinity, lastOnset = -Infinity, lastSound = -Infinity;
    let average = 0, deviation = 0, valley = true;
    let period = 0, position = 0, correction = 0, confidence = 0;
    let confirmedAt = -Infinity, confirmedBeat = 0;

    function clearTempo() {
      period = position = correction = confidence = 0;
      confirmedAt = -Infinity;
      confirmedBeat = 0;
      tempoIntervals.length = 0;
      state.bpm = state.confidence = state.bar = state.pulse = 0;
      state.phase = state.beatInBar = state.barPhase = null;
      state.locked = false;
    }

    function reset() {
      time = startedAt = lastOnset = lastSound = -Infinity;
      average = deviation = 0;
      valley = true;
      intervals.length = 0;
      state.age = Infinity;
      state.strength = 0;
      clearTempo();
    }

    function recordTempoOnset(now, gap) {
      if (gap >= .27 && gap <= 1.2) {
        tempoIntervals.push(gap);
        if (tempoIntervals.length > 4) tempoIntervals.shift();
      } else tempoIntervals.length = 0;

      const beat = Math.round(position);
      const steps = beat - confirmedBeat;
      const error = beat - position;
      if (period && steps > 0 && steps <= 3 && Math.abs(error) < .18) {
        const measured = (now - confirmedAt) / steps;
        if (measured >= period * .80 && measured <= period * 1.20) {
          period += (measured - period) * .18;
          correction = clamp(error, -.12, .12);
          confirmedAt = now;
          confirmedBeat = beat;
          confidence += (.98 - confidence) * .22;
          return;
        }
      }

      if (tempoIntervals.length < 4 || (period && now - confirmedAt <= period * 2.1)) return;
      const candidate = (tempoIntervals[0] + tempoIntervals[1] + tempoIntervals[2] + tempoIntervals[3]) / 4;
      const spread = Math.max(...tempoIntervals) - Math.min(...tempoIntervals);
      if (spread > candidate * .17) return;
      period = candidate;
      position = correction = confirmedBeat = 0;
      confirmedAt = now;
      confidence = .60 + .18 * (1 - spread / (candidate * .17));
    }

    function publishTempo(now) {
      if (!period) return;
      const sinceConfirmation = (now - confirmedAt) / period;
      if (sinceConfirmation > 3.15) { clearTempo(); return; }
      state.confidence = confidence * clamp((2.85 - sinceConfirmation) / 1.6);
      state.locked = state.confidence >= .48;
      if (!state.locked) {
        state.bpm = state.bar = state.pulse = 0;
        state.phase = state.beatInBar = state.barPhase = null;
        return;
      }
      const beat = Math.floor(position);
      const phase = position - beat;
      state.bpm = 60 / period;
      state.phase = phase;
      state.beatInBar = beat % 4;
      state.barPhase = (position % 4) / 4;
      state.bar = Math.floor(beat / 4);
      // The phase is an estimate between observed transients. Fade it if the music stops confirming the pulse.
      state.pulse = Math.pow(1 - phase, 4) * state.confidence;
    }

    function update({active, rms, sub, kick, body, edge}, now) {
      if (!active || !Number.isFinite(now)) {
        if (time !== -Infinity) reset();
        return state;
      }

      if (now < time || now - time > .26) reset();
      if (now === time) return state;
      const audible = rms >= .0025;
      if (audible) lastSound = now;
      else if (now - lastSound > Math.max(.8, period * 1.15)) {
        lastOnset = -Infinity;
        state.strength = 0;
        intervals.length = 0;
        clearTempo();
      }

      sub = clamp(sub);
      kick = clamp(kick);
      body = clamp(body);
      edge = clamp(edge);
      const loudness = Math.log1p(100 * clamp(rms)) / 4;
      const started = time !== -Infinity;
      const elapsed = started ? now - time : 0;
      const dt = clamp(elapsed, .008, .09);
      time = now;
      if (period) {
        const adjustment = correction * (1 - Math.exp(-elapsed / .19));
        correction -= adjustment;
        position += elapsed / period + adjustment;
      }
      const timing = clamp(Math.sqrt(.026 / dt), .57, 1.34);
      const subEdge = Math.max(0, sub - previous[0]), kickEdge = Math.max(0, kick - previous[1]);
      // A kick can briefly cancel a held sub-bass in the lowest bins while its upper harmonics still rise.
      const lowEdge = Math.max(subEdge * .66 + kickEdge * .34, kickEdge * .55) * timing;
      const upperEdge = (Math.max(0, body - previous[2]) * .59 + Math.max(0, edge - previous[3]) * .41) * timing;
      const levelEdge = Math.max(0, loudness - previous[4]) * timing;
      const low = Math.max(lowEdge, .68 * (Math.max(0, sub - envelope[0]) * .66 + Math.max(0, kick - envelope[1]) * .34));
      const upper = Math.max(upperEdge, .56 * (Math.max(0, body - envelope[2]) * .59 + Math.max(0, edge - envelope[3]) * .41));
      const level = Math.max(levelEdge, .54 * Math.max(0, loudness - envelope[4]));
      previous[0] = sub;
      previous[1] = kick;
      previous[2] = body;
      previous[3] = edge;
      previous[4] = loudness;
      if (!started) startedAt = now;
      const warm = now - startedAt >= .085;
      const blend = warm ? 1 - Math.exp(-dt / .055) : 1;
      for (let index = 0; index < envelope.length; index++) envelope[index] += (previous[index] - envelope[index]) * blend;
      if (!warm) return state;
      const flux = low * .72 + upper * .29 + level * .39;

      const sinceOnset = now - lastOnset;
      let threshold = .015 + average * .62 + deviation * 1.25;
      if (intervals.length === 3) {
        const period = (intervals[0] + intervals[1] + intervals[2]) / 3;
        const spread = Math.max(...intervals) - Math.min(...intervals);
        const phase = Math.abs(sinceOnset - period);
        // Prior attacks can help a softer one through. The clock never emits an attack on its own.
        if (spread < period * .18 && phase < period * .15) threshold *= .80 + .20 * phase / (period * .15);
      }

      const thump = lowEdge > .0045 && low > .009 && Math.max(sub, kick) > .05;
      const snap = upperEdge > .012 && upper > .022 && level > .022;
      if (flux < threshold * .64) valley = true;
      // Starting or seeking fills a new analysis window. Its edge is not a musical transient.
      if (audible && valley && sinceOnset >= .19 && flux > threshold && (thump || snap)) {
        if (sinceOnset >= .23 && sinceOnset <= 1.3) {
          intervals.push(sinceOnset);
          if (intervals.length > 3) intervals.shift();
        } else {
          intervals.length = 0;
        }
        lastOnset = now;
        valley = false;
        state.sequence++;
        state.strength = clamp(.28 + flux * 2.65 + (flux / threshold - 1) * .12, .28, 1);
        recordTempoOnset(now, sinceOnset);
      }

      const learned = Math.min(flux, threshold * 1.65);
      const adaptation = 1 - Math.exp(-dt / .55);
      deviation += (Math.abs(learned - average) - deviation) * adaptation;
      average += (learned - average) * adaptation;
      state.age = now - lastOnset;
      publishTempo(now);
      return state;
    }

    return {state, update, reset};
  }

  return {create, createBeatTracker, laneCount, historyLength};
});
