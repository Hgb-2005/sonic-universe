const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));
const follow = (value, target, dt, attack, release) => (
  value + (target - value) * (1 - Math.exp(-dt / (target > value ? attack : release)))
);

export const LANE_COUNT = 22;
export const HISTORY_LENGTH = 34;
const HISTORY_STEP = 0.045;

function emptyAudio() {
  return {
    getPower: () => 0,
    getBands: () => ({ bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 }),
    getSpectrum: () => null,
  };
}

function spectrumLane(spectrum, index, count) {
  const lowHz = 50 * Math.pow(16000 / 50, index / count);
  const highHz = 50 * Math.pow(16000 / 50, (index + 1) / count);
  const first = Math.max(0, Math.floor((lowHz / 24000) * spectrum.length));
  const end = Math.min(spectrum.length, Math.max(first + 1, Math.ceil((highHz / 24000) * spectrum.length)));
  let value = 0;
  for (let bin = first; bin < end; bin += 1) value = Math.max(value, clamp(spectrum[bin] / 255));
  return value;
}

function fallbackLane(bands, progress) {
  if (progress < 0.28) return bands[0] * (0.72 + Math.sin(progress * Math.PI / 0.28) * 0.28);
  if (progress < 0.55) return bands[1] * 0.7 + bands[0] * 0.3;
  if (progress < 0.78) return bands[2] * 0.62 + bands[3] * 0.38;
  return bands[3] * 0.38 + bands[4] * 0.62;
}

export function createAnalyzer() {
  const state = {
    bass: 0,
    lowMid: 0,
    mid: 0,
    vocal: 0,
    treble: 0,
    energy: 0,
    bassOnset: 0,
    shimmer: 0,
    phase: 0,
    time: 0,
    lanes: new Float32Array(LANE_COUNT),
    history: Array.from({ length: LANE_COUNT }, () => new Float32Array(HISTORY_LENGTH)),
    settled: true,
  };
  let previousBass = 0;
  let previousTreble = 0;
  let historyClock = 0;

  function reset() {
    for (const key of ['bass', 'lowMid', 'mid', 'vocal', 'treble', 'energy', 'bassOnset', 'shimmer', 'phase', 'time']) {
      state[key] = 0;
    }
    state.lanes.fill(0);
    state.history.forEach((row) => row.fill(0));
    previousBass = 0;
    previousTreble = 0;
    historyClock = 0;
    state.settled = true;
  }

  function update(audio = emptyAudio(), seconds = 1 / 60, options = {}) {
    const dt = clamp(seconds, 0, 0.1);
    const sensitivity = clamp(options.sensitivity ?? 1, 0.2, 3);
    const paused = Boolean(options.paused);
    if (!dt) return state;

    let input = emptyAudio().getBands();
    let spectrum = null;
    let reportedPower = 0;
    try {
      input = audio?.getBands?.() ?? input;
      spectrum = audio?.getSpectrum?.() ?? null;
      reportedPower = clamp((audio?.getPower?.() ?? 0) * sensitivity);
    } catch {
      input = emptyAudio().getBands();
      spectrum = null;
      reportedPower = 0;
    }

    const bands = [
      clamp(input.bass * sensitivity),
      clamp(input.lowMid * sensitivity),
      clamp(input.mid * sensitivity),
      clamp(input.vocal * sensitivity),
      clamp(input.treble * sensitivity),
    ];
    const bandPower = Math.max(...bands);
    const power = paused ? 0 : Math.max(reportedPower, bandPower);

    const targets = bands.map((value) => (paused ? 0 : value));
    state.bass = follow(state.bass, targets[0], dt, 0.08, 0.75);
    state.lowMid = follow(state.lowMid, targets[1], dt, 0.1, 0.68);
    state.mid = follow(state.mid, targets[2], dt, 0.12, 0.56);
    state.vocal = follow(state.vocal, targets[3], dt, 0.11, 0.53);
    state.treble = follow(state.treble, targets[4], dt, 0.045, 0.4);

    const bassRise = Math.max(0, state.bass - previousBass) / dt;
    const trebleRise = Math.max(0, state.treble - previousTreble) / dt;
    const onsetTarget = paused ? 0 : clamp(bassRise * 0.14) * clamp((state.bass - 0.035) * 2.5);
    const shimmerTarget = paused ? 0 : clamp(trebleRise * 0.12 + state.treble * 0.08);
    state.bassOnset = Math.max(state.bassOnset * Math.exp(-dt / 0.24), onsetTarget);
    state.shimmer = Math.max(state.shimmer * Math.exp(-dt / 0.18), shimmerTarget);
    state.energy = clamp(state.bass * 0.34 + state.lowMid * 0.24 + state.mid * 0.2 + state.vocal * 0.14 + state.treble * 0.08);

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      let target = 0;
      if (!paused) {
        if (spectrum && spectrum.length) target = spectrumLane(spectrum, lane, LANE_COUNT) * power;
        if (!spectrum || target < 0.01) target = fallbackLane(bands, lane / (LANE_COUNT - 1)) * power;
      }
      state.lanes[lane] = follow(state.lanes[lane], target, dt, 0.075, 0.46);
    }

    state.phase += dt * (0.055 + state.mid * 0.72 + state.energy * 0.18);
    state.time += dt;
    if (!paused) historyClock += dt;
    while (historyClock >= HISTORY_STEP) {
      historyClock -= HISTORY_STEP;
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        state.history[lane].copyWithin(1, 0, HISTORY_LENGTH - 1);
        state.history[lane][0] = state.lanes[lane];
      }
    }

    previousBass = paused ? 0 : state.bass;
    previousTreble = paused ? 0 : state.treble;
    const peak = Math.max(
      state.bass, state.lowMid, state.mid, state.vocal, state.treble,
      state.bassOnset, state.shimmer, ...state.lanes,
    );
    if (paused && peak < 0.002) {
      for (const key of ['bass', 'lowMid', 'mid', 'vocal', 'treble', 'energy', 'bassOnset', 'shimmer']) {
        state[key] = 0;
      }
      state.lanes.fill(0);
      state.history.forEach((row) => row.fill(0));
      state.settled = true;
    } else {
      state.settled = false;
    }
    return state;
  }

  return { state, update, reset };
}
