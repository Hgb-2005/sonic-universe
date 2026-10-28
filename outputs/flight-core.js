/* Original fixed chart and deterministic scoring for First Light. */
(() => {
  'use strict';
  const BPM = 96, BEAT = 60 / BPM, DURATION = 60, MOVE_TIME = .13;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const pattern = [1, 0, 0, 1, 2, 2, 1, 0, 1, 2, 1, 1, 0, 2, 1, 2];
  const chart = [];
  for (let beat = 4, index = 0; beat <= 92; beat += beat < 20 || beat >= 68 ? 2 : 1, index++) {
    const lane = pattern[index % pattern.length];
    chart.push(Object.freeze({ time: beat * BEAT, lane, type: 'ring' }));
    if (beat >= 24 && beat % 4 === 0) chart.push(Object.freeze({ time: beat * BEAT, lane: (lane + (beat % 8 === 0 ? 2 : 1)) % 3, type: 'rock' }));
  }
  chart.sort((a, b) => a.time - b.time);
  Object.freeze(chart);
  const totalRings = chart.filter(e => e.type === 'ring').length;
  const casualChart = [];
  for (let beat = 4, index = 0; beat <= 92; beat += 2, index++) {
    const lane = pattern[index % pattern.length];
    casualChart.push(Object.freeze({ time: beat * BEAT, lane, type: 'ring' }));
    if (beat >= 32 && beat % 8 === 0) casualChart.push(Object.freeze({ time: beat * BEAT, lane: (lane + 1) % 3, type: 'rock' }));
  }
  const tutorialChart = [1, 0, 2, 1].map((lane, index) => Object.freeze({ time: (index + 1) * 3.125, lane, type: 'ring' }));
  tutorialChart.push(Object.freeze({ time: 12.5, lane: 2, type: 'rock' }));
  const modes = Object.freeze({
    challenge: Object.freeze({ id: 'challenge', label: '挑战', duration: DURATION, chart, totalRings, perfect: .18, good: .44, missCost: 8, rockCost: 16, recovery: 2, canFail: true, lookAhead: 3.6 }),
    casual: Object.freeze({ id: 'casual', label: '休闲', duration: DURATION, chart: Object.freeze(casualChart), totalRings: 45, perfect: .27, good: .6, missCost: 4, rockCost: 10, recovery: 4, canFail: false, lookAhead: 4.4 }),
    tutorial: Object.freeze({ id: 'tutorial', label: '练习', duration: 15, chart: Object.freeze(tutorialChart), totalRings: 4, perfect: .27, good: .6, missCost: 0, rockCost: 0, recovery: 0, canFail: false, lookAhead: 4.4 })
  });
  const modeRules = mode => Object.prototype.hasOwnProperty.call(modes, mode) ? modes[mode] : modes.challenge;
  function createRun(mode = 'challenge') {
    const rules = modeRules(mode);
    return { mode: rules.id, time: 0, next: 0, score: 0, combo: 0, maxCombo: 0, energy: 100, perfect: 0, good: 0, misses: 0, collisions: 0, ended: false, reason: null, last: null, collected: [], movement: { from: 1, to: 1, at: -1 } };
  }
  function laneAt(run, time) {
    const m = run.movement, p = clamp((time - m.at) / MOVE_TIME, 0, 1), s = p * p * (3 - 2 * p);
    return m.from + (m.to - m.from) * s;
  }
  function advance(run, requestedTime) {
    if (run.ended || !Number.isFinite(requestedTime)) return run;
    const rules = modeRules(run.mode);
    const time = clamp(Math.max(run.time, requestedTime), 0, rules.duration);
    while (run.next < rules.chart.length && rules.chart[run.next].time <= time) {
      const event = rules.chart[run.next++], distance = Math.abs(laneAt(run, event.time) - event.lane);
      if (event.type === 'ring') {
        if (distance <= rules.good) {
          const perfect = distance <= rules.perfect;
          run[perfect ? 'perfect' : 'good']++;
          run.combo++; run.maxCombo = Math.max(run.combo, run.maxCombo);
          const points = Math.round((perfect ? 120 : 80) * (1 + Math.min(3, Math.floor(run.combo / 10)) * .25));
          run.score += points; run.energy = Math.min(100, run.energy + rules.recovery); run.collected.push(event.time);
          run.last = { kind: perfect ? 'perfect' : 'good', time: event.time, lane: event.lane, points };
        } else {
          run.misses++; run.combo = 0; run.energy = Math.max(0, run.energy - rules.missCost);
          run.last = { kind: 'miss', time: event.time, lane: event.lane, points: 0 };
        }
      } else if (distance < .34) {
        run.collisions++; run.combo = 0; run.energy = Math.max(0, run.energy - rules.rockCost);
        run.last = { kind: 'rock', time: event.time, lane: event.lane, points: 0 };
      }
      if (!run.energy && rules.canFail) { run.ended = true; run.reason = 'energy'; run.time = event.time; return run; }
    }
    run.time = time;
    if (time >= rules.duration) { run.ended = true; run.reason = 'complete'; }
    return run;
  }
  function move(run, lane, time) {
    advance(run, time);
    if (run.ended || !Number.isInteger(lane) || lane < 0 || lane > 2 || run.movement.to === lane) return;
    run.movement = { from: laneAt(run, run.time), to: lane, at: run.time };
  }
  function result(run) {
    const judged = run.perfect + run.good + run.misses;
    const accuracy = judged ? (run.perfect + run.good) / judged : 0;
    const quality = (run.perfect + run.good * .7) / modeRules(run.mode).totalRings;
    const grade = run.reason !== 'complete' ? 'D' : quality >= .95 && !run.collisions ? 'S' : quality >= .85 ? 'A' : quality >= .65 ? 'B' : quality >= .45 ? 'C' : 'D';
    return { score: run.score, grade, accuracy: Math.round(accuracy * 100), maxCombo: run.maxCombo, complete: run.reason === 'complete', perfect: run.perfect, good: run.good, misses: run.misses, collisions: run.collisions, time: run.time };
  }
  globalThis.SonicFlightCore = Object.freeze({ BPM, BEAT, DURATION, MOVE_TIME, chart, totalRings, modes, createRun, laneAt, advance, move, result });
})();
