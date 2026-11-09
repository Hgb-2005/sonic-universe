(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SonicVisualSystem = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODES = Object.freeze(["ring", "galaxy", "peaks", "blackhole"]);
  const THEMES = Object.freeze(["nebula", "galaxy", "solar"]);
  const RESPONSES = Object.freeze(["soft", "balanced", "strong"]);
  const DEFAULTS = Object.freeze({
    theme: "nebula",
    visualMode: "ring",
    motionSpeed: 1,
    particleCount: 2400,
    intensity: 0.7,
    depth: 0.65,
    glow: 0.6,
    trail: 0.55,
    response: "balanced",
    beat: false,
    storyEnabled: true,
    journeyAuto: true,
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function normalizeLook(value, defaults) {
    const fallback = { ...DEFAULTS, ...(defaults || {}) };
    const input = value && typeof value === "object" ? value : {};
    return {
      theme: THEMES.includes(input.theme) ? input.theme : fallback.theme,
      visualMode: MODES.includes(input.visualMode) ? input.visualMode : fallback.visualMode,
      motionSpeed: clamp(finite(input.motionSpeed, fallback.motionSpeed), 0.25, 2),
      particleCount: Math.round(clamp(finite(input.particleCount, fallback.particleCount), 400, 6000) / 200) * 200,
      intensity: clamp(finite(input.intensity, fallback.intensity), 0.2, 1),
      depth: clamp(finite(input.depth, fallback.depth), 0, 1),
      glow: clamp(finite(input.glow, fallback.glow), 0, 1),
      trail: clamp(finite(input.trail, fallback.trail), 0, 1),
      response: RESPONSES.includes(input.response) ? input.response : fallback.response,
      beat: typeof input.beat === "boolean" ? input.beat : fallback.beat,
      storyEnabled: typeof input.storyEnabled === "boolean" ? input.storyEnabled : fallback.storyEnabled,
      journeyAuto: typeof input.journeyAuto === "boolean" ? input.journeyAuto : fallback.journeyAuto,
    };
  }

  function performanceProfile(options) {
    const input = options || {};
    const width = finite(input.width, 1280);
    const memory = finite(input.deviceMemory, 8);
    const cores = finite(input.hardwareConcurrency, 8);
    const coarse = Boolean(input.coarsePointer);
    const mobile = Boolean(input.mobile) || coarse || width <= 760;
    const low = !mobile && (memory <= 4 || cores <= 4);
    const tier = mobile ? "mobile" : low ? "balanced" : "desktop";
    return {
      tier,
      maxParticles: mobile ? 1700 : low ? 3600 : 6000,
      maxTrail: mobile ? 0.73 : low ? 0.86 : 1,
      pixelRatio: mobile ? Math.min(finite(input.dpr, 1), 1.35) : Math.min(finite(input.dpr, 1), 2),
    };
  }

  function effectiveLook(look, profile) {
    const normalized = normalizeLook(look);
    const tier = profile || performanceProfile({});
    return {
      ...normalized,
      effectiveParticleCount: Math.min(normalized.particleCount, tier.maxParticles),
      effectiveTrail: Math.min(normalized.trail, tier.maxTrail),
    };
  }

  function parseShare(search, defaults) {
    const params = new URLSearchParams(String(search || ""));
    const fallback = { ...DEFAULTS, ...(defaults || {}) };
    const raw = {};
    const assign = (name, parser) => {
      if (params.has(name)) raw[name] = parser(params.get(name));
    };
    assign("visualMode", value => MODES.includes(value) ? value : undefined);
    assign("theme", value => THEMES.includes(value) ? value : undefined);
    assign("trail", value => {
      const number = Number(value);
      return value.trim() !== "" && Number.isFinite(number) && number >= 0 && number <= 100 ? number / 100 : undefined;
    });
    assign("intensity", value => {
      const number = Number(value);
      return value.trim() !== "" && Number.isFinite(number) && number >= 20 && number <= 100 ? number / 100 : undefined;
    });
    assign("particleCount", value => {
      const number = Number(value);
      return Number.isInteger(number) && number >= 400 && number <= 6000 ? number : undefined;
    });
    assign("response", value => RESPONSES.includes(value) ? value : undefined);
    assign("beat", value => value === "1" ? true : value === "0" ? false : undefined);
    assign("depth", value => {
      const number = Number(value);
      return value.trim() !== "" && Number.isFinite(number) && number >= 0 && number <= 100 ? number / 100 : undefined;
    });
    assign("glow", value => {
      const number = Number(value);
      return value.trim() !== "" && Number.isFinite(number) && number >= 0 && number <= 100 ? number / 100 : undefined;
    });
    assign("motionSpeed", value => {
      const number = Number(value);
      return value.trim() !== "" && Number.isFinite(number) && number >= 25 && number <= 200 ? number / 100 : undefined;
    });
    const clean = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
    return { look: normalizeLook({ ...fallback, ...clean }), hasVisualState: Object.keys(clean).length > 0 };
  }

  function serializeShare(look, baseUrl) {
    const normalized = normalizeLook(look);
    const url = new URL(baseUrl || "https://example.com/");
    url.search = "";
    url.hash = "";
    url.searchParams.set("visualMode", normalized.visualMode);
    url.searchParams.set("theme", normalized.theme);
    url.searchParams.set("trail", String(Math.round(normalized.trail * 100)));
    url.searchParams.set("intensity", String(Math.round(normalized.intensity * 100)));
    url.searchParams.set("particleCount", String(normalized.particleCount));
    url.searchParams.set("response", normalized.response);
    url.searchParams.set("beat", normalized.beat ? "1" : "0");
    url.searchParams.set("depth", String(Math.round(normalized.depth * 100)));
    url.searchParams.set("glow", String(Math.round(normalized.glow * 100)));
    url.searchParams.set("motionSpeed", String(Math.round(normalized.motionSpeed * 100)));
    url.searchParams.set("v", "20");
    return url.toString();
  }

  function journeyWeights(progress, options) {
    const p = clamp(finite(progress, 0), 0, 1);
    const thresholds = [
      [0.2, 0.34],
      [0.43, 0.58],
      [0.68, 0.83],
    ];
    const custom = options && Array.isArray(options.thresholds) ? options.thresholds : thresholds;
    const first = smoothstep(custom[0][0], custom[0][1], p);
    const second = smoothstep(custom[1][0], custom[1][1], p);
    const third = smoothstep(custom[2][0], custom[2][1], p);
    return {
      ring: 1 - first,
      galaxy: first * (1 - second),
      peaks: second * (1 - third),
      blackhole: third,
    };
  }

  function trailAlpha(trail, dt) {
    const amount = clamp(finite(trail, 0), 0, 1);
    if (amount <= 0.001) return 1;
    const seconds = 0.055 + amount * 1.45;
    return 1 - Math.exp(-Math.max(0, finite(dt, 1 / 60)) / seconds);
  }

  function beatGate(level, previous, enabled, reducedMotion) {
    if (!enabled || reducedMotion) return { hit: false, envelope: 0, previous: 0 };
    const normalized = clamp(finite(level, 0), 0, 1);
    const before = clamp(finite(previous, 0), 0, 1);
    const attack = normalized > 0.42 && normalized > before + 0.12;
    const envelope = attack ? clamp((normalized - 0.42) * 2.2, 0, 1) : 0;
    return { hit: attack, envelope, previous: normalized };
  }

  // Compact 2D simplex-style noise for organic, seam-free particle motion.
  const gradients = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];
  function noise2(x, y) {
    const px = Number.isFinite(x) ? x : 0;
    const py = Number.isFinite(y) ? y : 0;
    const cellX = Math.floor(px), cellY = Math.floor(py);
    const fx = px - cellX, fy = py - cellY;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const dot = (ix, iy, dx, dy) => {
      const gradient = gradients[(ix * 374761393 + iy * 668265263) & 7];
      return gradient[0] * dx + gradient[1] * dy;
    };
    const a = dot(cellX, cellY, fx, fy);
    const b = dot(cellX + 1, cellY, fx - 1, fy);
    const c = dot(cellX, cellY + 1, fx, fy - 1);
    const d = dot(cellX + 1, cellY + 1, fx - 1, fy - 1);
    const top = a + (b - a) * u;
    const bottom = c + (d - c) * u;
    return (top + (bottom - top) * v) * 0.70710678;
  }

  function fbm2(x, y, octaves) {
    let value = 0, amplitude = 0.55, frequency = 1, total = 0;
    const count = Math.max(1, Math.min(5, Math.round(finite(octaves, 3))));
    for (let index = 0; index < count; index += 1) {
      value += noise2(x * frequency, y * frequency) * amplitude;
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2.03;
    }
    return value / total;
  }

  return Object.freeze({
    DEFAULTS,
    MODES,
    THEMES,
    RESPONSES,
    normalizeLook,
    performanceProfile,
    effectiveLook,
    parseShare,
    serializeShare,
    journeyWeights,
    trailAlpha,
    beatGate,
    noise2,
    fbm2,
    smoothstep,
  });
});
