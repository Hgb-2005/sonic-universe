import { createAnalyzer, HISTORY_LENGTH, LANE_COUNT } from './analysis.mjs';
import { createPalette, mixColor, rgba } from './palette.mjs';
import { mulberry32, seededRange } from './random.mjs';

export const SCENES = Object.freeze([
  { value: 'auto', zh: '自动轮换' },
  { value: 'ring', zh: '紫雾星环' },
  { value: 'galaxy', zh: '深蓝银河' },
  { value: 'peaks', zh: '月下声脊' },
  { value: 'blackhole', zh: '引力黑洞' },
]);

const CYCLE = ['ring', 'galaxy', 'blackhole', 'peaks'];
const SCENE_LABELS = Object.fromEntries(SCENES.map((scene) => [scene.value, scene.zh]));
const TAU = Math.PI * 2;

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));
const lerp = (from, to, amount) => from + (to - from) * amount;

function safeNumber(value, fallback, low, high) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? number : fallback, low, high);
}

function normalizeScene(value) {
  return SCENES.some((scene) => scene.value === value) ? value : 'auto';
}

function laneAt(state, position) {
  const scaled = clamp(position) * (LANE_COUNT - 1);
  const low = Math.floor(scaled);
  const high = Math.min(LANE_COUNT - 1, low + 1);
  return lerp(state.lanes[low], state.lanes[high], scaled - low);
}

function createCanvas(documentRef) {
  return documentRef.createElement('canvas');
}

export function createRenderer({ container, host, documentRef = globalThis.document, windowRef = globalThis.window }) {
  if (!container || typeof container.appendChild !== 'function') throw new TypeError('renderer-container-required');
  if (!host) throw new TypeError('renderer-context-required');

  const canvas = createCanvas(documentRef);
  const transitionCanvas = createCanvas(documentRef);
  canvas.setAttribute?.('aria-hidden', 'true');
  canvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:block',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'background:#030510',
  ].join(';');
  container.appendChild(canvas);
  try {
    container.style.position ||= 'relative';
    container.style.overflow ||= 'hidden';
    container.style.background ||= '#030510';
  } catch {
    // Some test hosts use lightweight style shims.
  }

  const context = canvas.getContext('2d', { alpha: false, desynchronized: true }) ?? canvas.getContext('2d');
  if (!context) throw new Error('canvas-2d-unavailable');
  const transitionContext = transitionCanvas.getContext('2d', { alpha: false, desynchronized: true })
    ?? transitionCanvas.getContext('2d');

  const analyzer = createAnalyzer();
  const random = mulberry32(0x51a7c0de);
  const viewport = { width: 0, height: 0, dpr: 1 };
  const stars = [];
  let palette = createPalette({});
  let sprites = {};
  let settings = readSettings();
  let sceneSetting = settings.scene;
  let currentScene = sceneSetting === 'auto' ? 'ring' : sceneSetting;
  let autoStartedAt = 0;
  let autoCursor = 0;
  let transition = { active: false, startedAt: 0, duration: 1.45 };
  let lastTimestamp = null;
  let visualTime = 4.75;
  let disposed = false;
  let staticFrameKey = '';
  let quality = 1;
  let slowFrames = 0;
  let fastFrames = 0;
  let hadDrawnWhilePaused = false;
  let reducedMotion = false;
  let mediaQuery = null;

  function readSettings() {
    const raw = host.getSettings?.() ?? {};
    return {
      scene: normalizeScene(raw.scene),
      density: safeNumber(raw.density, 72, 18, 150),
      motion: safeNumber(raw.motion, 100, 20, 180),
      sensitivity: safeNumber(raw.sensitivity, 1, 0.35, 2.2),
      glow: safeNumber(raw.glow, 62, 0, 100),
      depth: safeNumber(raw.depth, 68, 0, 100),
      highDynamic: raw.highDynamic !== false,
    };
  }

  function rebuildStars() {
    stars.length = 0;
    const count = Math.round(260 + settings.density * 10.5);
    for (let index = 0; index < count; index += 1) {
      stars.push({
        x: random(),
        y: random(),
        z: 0.18 + random() * 0.82,
        size: 0.28 + Math.pow(random(), 3.2) * 1.85,
        phase: random() * TAU,
        warmth: random(),
      });
    }
  }

  function makeGlowSprite(color) {
    const sprite = createCanvas(documentRef);
    sprite.width = 64;
    sprite.height = 64;
    const spriteContext = sprite.getContext('2d');
    const gradient = spriteContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, rgba(color, 1));
    gradient.addColorStop(0.16, rgba(color, 0.92));
    gradient.addColorStop(0.48, rgba(color, 0.26));
    gradient.addColorStop(1, rgba(color, 0));
    spriteContext.fillStyle = gradient;
    spriteContext.fillRect(0, 0, 64, 64);
    return sprite;
  }

  function rebuildSprites() {
    sprites = {
      core: makeGlowSprite(palette.core),
      second: makeGlowSprite(palette.second),
      hot: makeGlowSprite(palette.hot),
      warm: makeGlowSprite(palette.warm),
      white: makeGlowSprite([235, 242, 255]),
    };
  }

  function applyTheme() {
    palette = createPalette(host.getTheme?.() ?? {});
    rebuildSprites();
  }

  function setupReducedMotion() {
    try {
      mediaQuery = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
      reducedMotion = Boolean(mediaQuery?.matches);
      const listener = (event) => {
        reducedMotion = Boolean(event.matches);
      };
      if (mediaQuery?.addEventListener) {
        mediaQuery.addEventListener('change', listener);
        return () => mediaQuery.removeEventListener('change', listener);
      }
      if (mediaQuery?.addListener) {
        mediaQuery.addListener(listener);
        return () => mediaQuery.removeListener(listener);
      }
    } catch {
      reducedMotion = false;
    }
    return () => {};
  }

  const removeMotionListener = setupReducedMotion();

  function snapshotCurrentFrame() {
    if (!transitionContext || viewport.width < 2 || viewport.height < 2) return false;
    try {
      transitionContext.setTransform(1, 0, 0, 1, 0, 0);
      transitionContext.globalAlpha = 1;
      transitionContext.globalCompositeOperation = 'source-over';
      transitionContext.drawImage(canvas, 0, 0, transitionCanvas.width, transitionCanvas.height);
      return true;
    } catch {
      return false;
    }
  }

  function switchScene(nextScene, timestamp) {
    if (nextScene === currentScene) return;
    const captured = snapshotCurrentFrame();
    currentScene = nextScene;
    transition = {
      active: captured,
      startedAt: timestamp,
      duration: reducedMotion ? 0.55 : 1.65,
    };
  }

  function resolveAutomaticScene(timestamp) {
    if (sceneSetting !== 'auto') return sceneSetting;
    if (!autoStartedAt) autoStartedAt = timestamp;
    const index = Math.floor(Math.max(0, timestamp - autoStartedAt) / (reducedMotion ? 60000 : 36000));
    return CYCLE[(autoCursor + index) % CYCLE.length];
  }

  function syncContext(timestamp = now()) {
    if (disposed) return;
    const previousSettings = settings;
    settings = readSettings();
    if (settings.scene !== sceneSetting) {
      const previousScene = currentScene;
      sceneSetting = settings.scene;
      autoCursor = previousScene === sceneSetting ? 0 : Math.max(0, CYCLE.indexOf(previousScene));
      autoStartedAt = timestamp;
      if (sceneSetting !== 'auto') switchScene(sceneSetting, timestamp);
    }
    if (settings.density !== previousSettings.density) rebuildStars();
    applyTheme();
    if (host.staticMode) {
      staticFrameKey = '';
      render(timestamp, true);
    }
  }

  function now() {
    return Number(windowRef?.performance?.now?.() ?? Date.now());
  }

  function resize(size = {}) {
    if (disposed) return;
    const width = Math.max(1, Math.round(Number(size.width) || container.clientWidth || 1));
    const height = Math.max(1, Math.round(Number(size.height) || container.clientHeight || 1));
    const rawDpr = Number(windowRef?.devicePixelRatio) || 1;
    const dprLimit = width < 680 ? 1.45 : 1.75;
    const dpr = clamp(rawDpr, 1, dprLimit);
    if (viewport.width === width && viewport.height === height && viewport.dpr === dpr) return;

    viewport.width = width;
    viewport.height = height;
    viewport.dpr = dpr;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    transitionCanvas.width = canvas.width;
    transitionCanvas.height = canvas.height;
    transition.active = false;
    staticFrameKey = '';
    lastTimestamp = null;
    if (host.staticMode) render(now(), true);
  }

  function setBaseTransform(target = context) {
    target.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    target.imageSmoothingEnabled = true;
  }

  function drawSprite(sprite, x, y, size, alpha = 1) {
    if (!sprite || alpha <= 0.002 || size <= 0) return;
    context.globalAlpha = clamp(alpha);
    context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  function drawNebula(x, y, radiusX, radiusY, color, alpha, rotation = 0) {
    if (radiusX <= 1 || radiusY <= 1 || alpha <= 0.002) return;
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(1, radiusY / radiusX);
    const cloud = context.createRadialGradient(0, 0, radiusX * 0.04, 0, 0, radiusX);
    cloud.addColorStop(0, rgba(color, alpha));
    cloud.addColorStop(0.24, rgba(color, alpha * 0.62));
    cloud.addColorStop(0.62, rgba(color, alpha * 0.16));
    cloud.addColorStop(1, rgba(color, 0));
    context.fillStyle = cloud;
    context.beginPath();
    context.arc(0, 0, radiusX, 0, TAU);
    context.fill();
    context.restore();
  }

  function drawBackdrop() {
    const width = viewport.width;
    const height = viewport.height;
    const background = mixColor(palette.deep, palette.black, settings.depth * 0.0038);
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, rgba(mixColor(background, palette.themeSecondary, palette.daylight ? 0.14 : 0.07), 1));
    gradient.addColorStop(0.46, rgba(background, 1));
    gradient.addColorStop(1, rgba(mixColor(background, palette.black, 0.64), 1));
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const bloomX = width * (currentScene === 'blackhole' ? 0.7 : 0.5);
    const bloomY = height * (currentScene === 'peaks' ? 0.58 : currentScene === 'galaxy' ? 0.5 : 0.44);
    const bloom = context.createRadialGradient(
      bloomX,
      bloomY,
      0,
      bloomX,
      bloomY,
      Math.max(width, height) * 0.72,
    );
    bloom.addColorStop(0, rgba(palette.themePrimary, palette.daylight ? 0.16 : 0.125));
    bloom.addColorStop(0.4, rgba(palette.themeSecondary, palette.daylight ? 0.09 : 0.072));
    bloom.addColorStop(1, rgba(palette.deep, 0));
    context.fillStyle = bloom;
    context.fillRect(0, 0, width, height);
  }

  function drawStars(timestamp) {
    const width = viewport.width;
    const height = viewport.height;
    const speed = reducedMotion ? 0.28 : settings.motion / 100;
    const qualityCount = Math.max(80, Math.floor(stars.length * quality));
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < qualityCount; index += 1) {
      const star = stars[index];
      const x = ((star.x + visualTime * 0.0016 * star.z * speed) % 1 + 1) % 1 * width;
      const y = (star.y + Math.sin(star.phase * 2.3) * 0.004) * height;
      const twinkle = 0.38 + 0.62 * Math.pow(0.5 + 0.5 * Math.sin(timestamp * 0.00055 * star.z + star.phase), 2);
      const alpha = twinkle * (0.22 + star.z * 0.45);
      if (star.size > 1.18) {
        drawSprite(star.warmth > 0.64 ? sprites.warm : sprites.white, x, y, 3.6 + star.size * 3.4, alpha * 0.68);
      } else {
        context.fillStyle = rgba(star.warmth > 0.82 ? palette.warm : palette.hot, alpha);
        context.fillRect(x, y, star.size, star.size);
      }
    }
    context.restore();
  }

  function drawRing() {
    const state = analyzer.state;
    const width = viewport.width;
    const height = viewport.height;
    const speed = reducedMotion ? 0.25 : settings.motion / 100;
    const centerX = width * 0.5;
    const centerY = height * 0.52;
    const scale = Math.min(width / 1400, height / 800);
    const radiusX = width * (0.34 + state.bass * 0.028 + settings.depth * 0.0007);
    const radiusY = height * (0.145 + state.lowMid * 0.02 + settings.depth * 0.00035);
    const angle = -0.11 + Math.sin(state.time * 0.045 * speed) * 0.035;
    const glow = settings.glow / 100;

    context.save();
    context.translate(centerX, centerY);
    context.rotate(angle);
    context.globalCompositeOperation = 'lighter';

    drawNebula(
      -radiusX * 0.08,
      radiusY * 0.05,
      radiusX * 0.88,
      radiusY * 2.2,
      palette.themePrimary,
      0.105 + glow * 0.045 + state.mid * 0.04,
      angle * -0.34,
    );
    drawNebula(
      radiusX * 0.24,
      -radiusY * 0.08,
      radiusX * 0.48,
      radiusY * 1.2,
      palette.second,
      0.085 + glow * 0.025 + state.treble * 0.03,
      angle * 0.42,
    );

    for (let ring = 0; ring < 7; ring += 1) {
      const spread = 0.72 + ring * 0.072;
      context.beginPath();
      context.ellipse(
        0,
        (ring - 3) * height * 0.008,
        radiusX * spread,
        radiusY * spread,
        0,
        0,
        TAU,
      );
      context.lineWidth = ring === 3 ? 1.55 : 0.62;
      context.strokeStyle = rgba(ring % 2 ? palette.second : palette.core, (0.16 + state.mid * 0.2) / Math.sqrt(ring + 1));
      context.stroke();
    }

    for (let band = 0; band < 3; band += 1) {
      context.beginPath();
      const spread = 0.74 + band * 0.105;
      for (let point = 0; point <= 190; point += 1) {
        const progress = point / 190;
        const theta = progress * TAU;
        const lane = Math.abs(Math.sin(progress * Math.PI * 5 + band * 0.09));
        const energy = laneAt(state, lane) * (0.6 - band * 0.12);
        const wave = Math.sin(theta * (5 + band) + state.time * (0.34 + speed * 0.23) + band) * 0.012 * (1 + state.mid);
        const x = Math.cos(theta) * radiusX * (spread + wave + energy * 0.065);
        const y = Math.sin(theta) * radiusY * (spread + wave + energy * 0.14);
        if (point === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.lineWidth = 0.72 + band * 0.38;
      context.strokeStyle = rgba(band === 1 ? palette.themeSecondary : palette.core, 0.2 + state.mid * 0.2);
      context.stroke();
    }

    const particleCount = Math.floor((190 + settings.density * 2.45) * quality);
    for (let index = 0; index < particleCount; index += 1) {
      const seed = seededRange(index, 0x92f4, 2);
      const phase = seededRange(index, 0x18c6, 3) * TAU;
      const radius = 0.7 + seed * 0.55;
      const orbit = state.time * (0.06 + speed * 0.05) * (1.2 - seed * 0.5);
      const theta = phase + orbit;
      const laneEnergy = laneAt(state, seed);
      const x = Math.cos(theta) * radiusX * radius * (1 + laneEnergy * 0.03);
      const y = Math.sin(theta) * radiusY * radius * (1 + laneEnergy * 0.08);
      const size = (2.6 + seededRange(index, 0x128a, 4) * 8.4) * (1 + state.bassOnset * 0.42);
      drawSprite(seed > 0.58 ? sprites.core : sprites.second, x, y, size, 0.22 + seed * 0.4 + state.shimmer * 0.2);
    }

    const centerGlow = 28 + state.bass * 44 + state.bassOnset * 32;
    drawSprite(sprites.core, 0, 0, centerGlow, 0.19 + glow * 0.2);
    drawSprite(sprites.hot, 0, 0, 8 + state.bassOnset * 15, 0.56 + state.bass * 0.18);
    context.restore();
  }

  function drawGalaxy() {
    const state = analyzer.state;
    const width = viewport.width;
    const height = viewport.height;
    const speed = reducedMotion ? 0.24 : settings.motion / 100;
    const centerX = width * 0.5;
    const centerY = height * 0.49;
    const count = Math.floor((400 + settings.density * 4.8) * quality);
    const tilt = height * (0.19 + settings.depth * 0.0008);

    context.save();
    context.globalCompositeOperation = 'lighter';
    drawNebula(
      centerX,
      centerY,
      width * 0.4,
      height * 0.13,
      palette.themePrimary,
      0.115 + state.mid * 0.06 + settings.glow * 0.00055,
      -0.18,
    );
    drawNebula(
      centerX - width * 0.12,
      centerY + height * 0.035,
      width * 0.24,
      height * 0.08,
      palette.second,
      0.105 + state.vocal * 0.055,
      0.34,
    );
    drawNebula(
      centerX + width * 0.17,
      centerY - height * 0.06,
      width * 0.2,
      height * 0.065,
      palette.hot,
      0.065 + state.treble * 0.055,
      -0.58,
    );

    const coreRadius = Math.min(width, height) * (0.083 + state.bass * 0.012);
    drawSprite(sprites.core, centerX, centerY, coreRadius * 3.15, 0.2 + settings.glow * 0.0023);
    drawSprite(sprites.hot, centerX, centerY, coreRadius * 1.2, 0.44 + state.bass * 0.18);

    for (let arm = 0; arm < 3; arm += 1) {
      context.beginPath();
      for (let point = 8; point <= 120; point += 1) {
        const radius = point / 120;
        const theta = arm * (TAU / 3) + radius * 5.9 - state.time * (0.055 + speed * 0.07);
        const x = centerX + Math.cos(theta) * radius * width * (0.45 + settings.depth * 0.00045);
        const y = centerY + Math.sin(theta) * radius * tilt;
        if (point === 8) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.lineWidth = 1.15;
      context.strokeStyle = rgba(arm === 0 ? palette.hot : palette.second, 0.075 + state.mid * 0.055);
      context.stroke();
    }

    for (let index = 0; index < count; index += 1) {
      const radialSeed = seededRange(index, 0x61a7, 7);
      const arm = index % 3;
      const radius = Math.pow(radialSeed, 0.72);
      const jitter = (seededRange(index, 0xa990, 8) - 0.5) * (0.12 + radius * 0.13);
      const theta = arm * (TAU / 3) + radius * 5.9 - state.time * (0.055 + speed * 0.07) + jitter;
      const laneEnergy = laneAt(state, radialSeed);
      const x = centerX + Math.cos(theta) * radius * width * (0.45 + settings.depth * 0.00045);
      const y = centerY + Math.sin(theta) * radius * tilt * (0.78 + seededRange(index, 0xa321, 9) * 0.48);
      const nearCore = 1 - clamp(radius);
      const size = 2.5 + seededRange(index, 0xf320, 10) * (5.2 + laneEnergy * 8.4);
      const alpha = 0.12 + (1 - radius) * 0.22 + laneEnergy * 0.43 + nearCore * state.mid * 0.14;
      if (seededRange(index, 0x1122, 11) > 0.58) {
        drawSprite(index % 4 === 0 ? sprites.hot : sprites.second, x, y, size, alpha);
      } else {
        context.fillStyle = rgba(index % 5 === 0 ? palette.hot : palette.second, alpha);
        context.fillRect(x, y, size * 0.34, size * 0.34);
      }
    }

    context.strokeStyle = rgba(palette.hot, 0.12 + state.mid * 0.12);
    context.lineWidth = 0.85;
    context.beginPath();
    context.ellipse(centerX, centerY, width * 0.22, height * 0.075, 0, 0, TAU);
    context.stroke();
    drawSprite(sprites.white, centerX, centerY, coreRadius * 0.45, 0.5 + state.treble * 0.18);
    context.restore();
  }

  function ridgeValue(position, layer) {
    const state = analyzer.state;
    const shifted = (position * 1.48 + state.time * (0.018 + layer * 0.002)) % 1;
    const lane = shifted * (LANE_COUNT - 1);
    const row = Math.min(HISTORY_LENGTH - 1, Math.floor(lane * 0.42) + layer * 2);
    const low = Math.floor(lane);
    const high = Math.min(LANE_COUNT - 1, low + 1);
    const current = lerp(state.history[low][row], state.history[high][row], lane - low);
    const shimmer = Math.sin(shifted * 42 + state.time * 0.6 + layer) * 0.025 * (0.4 + state.mid);
    return current + shimmer;
  }

  function drawPeaks() {
    const state = analyzer.state;
    const width = viewport.width;
    const height = viewport.height;
    const horizon = height * (0.64 + settings.depth * 0.0006);
    const glow = settings.glow / 100;
    const moonX = width * 0.8;
    const moonY = height * 0.22;
    const moonRadius = Math.min(width, height) * 0.055;

    context.save();
    context.globalCompositeOperation = 'lighter';
    drawNebula(
      moonX,
      moonY,
      moonRadius * 2.7,
      moonRadius * 2.7,
      palette.themeSecondary,
      0.08 + state.vocal * 0.035,
    );
    context.fillStyle = rgba(palette.hot, palette.daylight ? 0.28 : 0.18 + state.vocal * 0.05);
    context.beginPath();
    context.arc(moonX, moonY, moonRadius, 0, TAU);
    context.fill();
    context.fillStyle = rgba(palette.themePrimary, 0.08 + state.vocal * 0.035);
    for (const [offsetX, offsetY, size] of [[-0.24, -0.18, 0.19], [0.28, -0.08, 0.14], [-0.08, 0.32, 0.11]]) {
      context.beginPath();
      context.arc(moonX + moonRadius * offsetX, moonY + moonRadius * offsetY, moonRadius * size, 0, TAU);
      context.fill();
    }
    context.globalCompositeOperation = 'source-over';

    const atmospheric = context.createLinearGradient(0, height * 0.34, 0, horizon);
    atmospheric.addColorStop(0, rgba(palette.themeSecondary, 0));
    atmospheric.addColorStop(0.72, rgba(palette.themePrimary, 0.05 + state.mid * 0.06));
    atmospheric.addColorStop(1, rgba(palette.core, 0.03 + glow * 0.04));
    context.fillStyle = atmospheric;
    context.fillRect(0, height * 0.34, width, height * 0.7);

    for (let layer = 0; layer < 5; layer += 1) {
      const baseline = horizon + height * (0.015 + layer * 0.064);
      const amplitude = height * (0.11 + layer * 0.025) * (0.7 + settings.sensitivity * 0.22);
      context.beginPath();
      context.moveTo(-20, height + 20);
      for (let point = 0; point <= 96; point += 1) {
        const progress = point / 96;
        const envelope = 0.34 + Math.sin(progress * Math.PI) * 0.66;
        const ridge = ridgeValue(progress, layer) * envelope;
        const broad = Math.sin(progress * 14.5 + layer * 0.82 + state.time * 0.14) * 0.035;
        const y = baseline - ridge * amplitude - broad * height;
        context.lineTo(progress * width, y);
      }
      context.lineTo(width + 20, height + 20);
      context.closePath();
      const fill = context.createLinearGradient(0, baseline - amplitude, 0, height);
      fill.addColorStop(0, rgba(layer % 2 ? palette.core : palette.themeSecondary, 0.17 - layer * 0.014));
      fill.addColorStop(0.45, rgba(palette.themePrimary, 0.1 - layer * 0.008));
      fill.addColorStop(1, rgba(palette.deep, 0.92));
      context.fillStyle = fill;
      context.fill();
      context.lineWidth = layer === 0 ? 1.2 : 0.55;
      context.strokeStyle = rgba(layer === 0 ? palette.hot : palette.core, 0.34 - layer * 0.04 + state.shimmer * 0.14);
      context.stroke();
    }

    context.globalCompositeOperation = 'lighter';
    const horizonGlow = context.createLinearGradient(0, horizon - 10, 0, horizon + 16);
    horizonGlow.addColorStop(0, rgba(palette.hot, 0));
    horizonGlow.addColorStop(0.48, rgba(palette.core, 0.15 + glow * 0.09));
    horizonGlow.addColorStop(1, rgba(palette.core, 0));
    context.fillStyle = horizonGlow;
    context.fillRect(0, horizon - 10, width, 28);
    context.restore();
  }

  function drawBlackhole() {
    const state = analyzer.state;
    const width = viewport.width;
    const height = viewport.height;
    const desktop = width > height * 0.86;
    const centerX = width * (desktop ? 0.7 : 0.68);
    const centerY = height * (desktop ? 0.45 : 0.4);
    const base = Math.min(width, height);
    const holeRadius = base * (0.078 + settings.depth * 0.00022 + state.bass * 0.007);
    const diskX = holeRadius * (3.35 + state.lowMid * 0.38);
    const diskY = holeRadius * (0.82 + state.mid * 0.12);
    const tilt = -0.22 + Math.sin(state.time * 0.035) * 0.02;
    const speed = reducedMotion ? 0.25 : settings.motion / 100;

    context.save();
    context.translate(centerX, centerY);
    context.rotate(tilt);
    context.globalCompositeOperation = 'lighter';

    drawNebula(
      -diskX * 0.06,
      0,
      diskX * 0.88,
      diskY * 1.9,
      palette.themePrimary,
      0.115 + state.bass * 0.055 + settings.glow * 0.0005,
    );
    drawNebula(
      diskX * 0.12,
      -diskY * 0.04,
      diskX * 0.46,
      diskY * 0.92,
      palette.warm,
      0.07 + state.mid * 0.045,
    );

    const halo = context.createRadialGradient(0, 0, holeRadius * 0.92, 0, 0, diskX * 1.08);
    halo.addColorStop(0, rgba(palette.core, 0.02));
    halo.addColorStop(0.31, rgba(palette.themePrimary, 0.1 + state.bass * 0.09));
    halo.addColorStop(0.68, rgba(palette.warm, 0.055 + state.mid * 0.09));
    halo.addColorStop(1, rgba(palette.deep, 0));
    context.fillStyle = halo;
    context.beginPath();
    context.ellipse(0, 0, diskX * 1.08, diskY * 2.8, 0, 0, TAU);
    context.fill();

    for (let band = 0; band < 7; band += 1) {
      context.beginPath();
      context.ellipse(
        0,
        0,
        holeRadius * (1.22 + band * 0.27 + state.bass * 0.04),
        holeRadius * (0.34 + band * 0.087 + state.mid * 0.018),
        0,
        0,
        TAU,
      );
      context.lineWidth = 0.62 + (6 - band) * 0.34;
      context.strokeStyle = rgba(
        band < 3 ? palette.hot : palette.warm,
        (0.16 + state.mid * 0.2) / Math.pow(band + 1, 0.5),
      );
      context.stroke();
    }

    const particleCount = Math.floor((260 + settings.density * 3.85) * quality);
    for (let index = 0; index < particleCount; index += 1) {
      const seed = seededRange(index, 0x108a, 13);
      const phase = seededRange(index, 0x7c23, 14) * TAU;
      const orbit = phase + state.time * (0.13 + speed * 0.2) / (0.65 + seed);
      const radius = 1.18 + seed * 3.2;
      const x = Math.cos(orbit) * holeRadius * radius;
      const y = Math.sin(orbit) * holeRadius * (0.27 + seed * 0.82);
      const front = Math.sin(orbit) > 0 ? 1.25 : 0.75;
      const laneEnergy = laneAt(state, seed);
      drawSprite(
        seed > 0.66 ? sprites.hot : seed > 0.34 ? sprites.warm : sprites.second,
        x,
        y,
        2.6 + seed * 6.2,
        (0.16 + laneEnergy * 0.28) * front,
      );
    }
    drawSprite(sprites.hot, -diskX * 0.69, 0, holeRadius * 0.48, 0.26 + state.bassOnset * 0.2);
    drawSprite(sprites.warm, diskX * 0.72, 0, holeRadius * 0.42, 0.22 + state.bassOnset * 0.16);
    context.restore();

    context.save();
    context.globalCompositeOperation = 'source-over';
    const shadow = context.createRadialGradient(centerX, centerY, holeRadius * 0.48, centerX, centerY, holeRadius * 1.18);
    shadow.addColorStop(0, 'rgba(0, 0, 0, 1)');
    shadow.addColorStop(0.75, 'rgba(0, 1, 6, 0.995)');
    shadow.addColorStop(1, 'rgba(0, 2, 9, 0)');
    context.fillStyle = shadow;
    context.beginPath();
    context.arc(centerX, centerY, holeRadius * 1.18, 0, TAU);
    context.fill();
    context.restore();

    context.save();
    context.translate(centerX, centerY);
    context.rotate(tilt);
    context.globalCompositeOperation = 'lighter';
    context.beginPath();
    context.ellipse(0, 0, holeRadius * 1.47, holeRadius * 0.55, 0, 0.04, Math.PI - 0.04);
    context.lineWidth = 1.45 + state.bass * 1.55;
    context.strokeStyle = rgba(palette.hot, 0.58 + state.bassOnset * 0.22);
    context.stroke();
    context.beginPath();
    context.arc(0, 0, holeRadius * 1.035, -Math.PI * 0.8, Math.PI * 0.76);
    context.lineWidth = 1.05 + settings.glow * 0.006;
    context.strokeStyle = rgba(palette.core, 0.42 + state.vocal * 0.22);
    context.stroke();
    context.beginPath();
    context.ellipse(0, 0, holeRadius * 1.19, holeRadius * 0.24, 0, Math.PI * 0.08, Math.PI * 0.92);
    context.lineWidth = 0.8;
    context.strokeStyle = rgba(palette.second, 0.2 + state.shimmer * 0.17);
    context.stroke();
    context.restore();
  }

  function drawVignette() {
    const width = viewport.width;
    const height = viewport.height;
    const radius = Math.max(width, height) * 0.7;
    const vignette = context.createRadialGradient(width * 0.5, height * 0.48, radius * 0.24, width * 0.5, height * 0.48, radius);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.72, 'rgba(0, 1, 10, 0.08)');
    vignette.addColorStop(1, `rgba(0, 1, 8, ${palette.daylight ? 0.18 : 0.42})`);
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
  }

  function drawScene(timestamp) {
    drawBackdrop();
    drawStars(timestamp);
    if (currentScene === 'ring') drawRing();
    else if (currentScene === 'galaxy') drawGalaxy();
    else if (currentScene === 'peaks') drawPeaks();
    else drawBlackhole();
    drawVignette();

    if (transition.active) {
      const progress = clamp((timestamp - transition.startedAt) / (transition.duration * 1000));
      const eased = progress * progress * (3 - 2 * progress);
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1 - eased;
      context.drawImage(transitionCanvas, 0, 0);
      context.restore();
      if (progress >= 1) transition.active = false;
    }
  }

  function updateQuality(dt, renderCost) {
    const expensive = renderCost > 25 || dt > 0.038;
    const cheap = renderCost < 13 && dt < 0.025;
    slowFrames = expensive ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    fastFrames = cheap ? fastFrames + 1 : 0;
    if (slowFrames > 45) {
      quality = Math.max(0.48, quality - 0.1);
      slowFrames = 0;
      fastFrames = 0;
    } else if (fastFrames > 180) {
      quality = Math.min(1, quality + 0.06);
      fastFrames = 0;
    }
  }

  function render(timestamp = now(), force = false) {
    if (disposed || !viewport.width || !viewport.height) return false;
    if (host.staticMode) {
      const key = `${viewport.width}x${viewport.height}:${currentScene}:${sceneSetting}:${settings.density}:${settings.depth}`;
      if (!force && key === staticFrameKey) return false;
      staticFrameKey = key;
      analyzer.update(host.audio, 1 / 60, { sensitivity: settings.sensitivity, paused: false });
      setBaseTransform();
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, viewport.width, viewport.height);
      drawScene(timestamp || 9000);
      return true;
    }

    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : now();
    const rawDt = lastTimestamp === null ? 1 / 60 : clamp((safeTimestamp - lastTimestamp) / 1000, 0, 0.1);
    lastTimestamp = safeTimestamp;
    const paused = Boolean(host.isPaused?.());

    if (paused && analyzer.state.settled && hadDrawnWhilePaused) return false;

    analyzer.update(host.audio, rawDt, {
      sensitivity: settings.sensitivity,
      paused,
    });

    if (settings.scene === 'auto') {
      const automatic = resolveAutomaticScene(safeTimestamp);
      if (automatic !== currentScene) switchScene(automatic, safeTimestamp);
    } else if (currentScene !== settings.scene) {
      switchScene(settings.scene, safeTimestamp);
    }

    const motionScale = reducedMotion ? 0.34 : settings.motion / 100;
    visualTime += rawDt * (settings.highDynamic ? 1 : 0.72) * motionScale;
    const renderStarted = now();
    setBaseTransform();
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, viewport.width, viewport.height);
    drawScene(safeTimestamp);
    updateQuality(rawDt, now() - renderStarted);

    hadDrawnWhilePaused = paused;
    if (paused && analyzer.state.settled) hadDrawnWhilePaused = true;
    return true;
  }

  function getState() {
    return {
      scene: currentScene,
      sceneLabel: SCENE_LABELS[currentScene],
      viewport: { ...viewport },
      quality,
      paused: Boolean(host.isPaused?.()),
      settled: analyzer.state.settled,
      transitionActive: transition.active,
      disposed,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    removeMotionListener();
    analyzer.reset();
    canvas.remove();
    transitionCanvas.width = 0;
    transitionCanvas.height = 0;
    stars.length = 0;
  }

  applyTheme();
  rebuildStars();
  autoStartedAt = now();

  return {
    analyzer,
    canvas,
    resize,
    render,
    syncContext,
    getState,
    dispose,
  };
}
