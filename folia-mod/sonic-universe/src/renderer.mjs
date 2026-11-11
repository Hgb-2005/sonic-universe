import { createAnalyzer } from './analysis.mjs';
import {
  createNebulaLibrary,
  nebulaThemeKey,
  NEBULA_LAYOUTS,
} from './nebula.mjs';
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
const TRANSITION_SECONDS = 0.9;

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));
const lerp = (from, to, amount) => from + (to - from) * amount;

function safeNumber(value, fallback, low, high) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? number : fallback, low, high);
}

function normalizeScene(value) {
  return SCENES.some((scene) => scene.value === value) ? value : 'auto';
}

function createCanvas(documentRef) {
  return documentRef.createElement('canvas');
}

function imageFactoryFor(documentRef, windowRef) {
  return documentRef?.defaultView?.Image ?? windowRef?.Image ?? globalThis.Image;
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
    // Some mount shims expose read-only inline styles.
  }

  const context = canvas.getContext('2d', { alpha: false, desynchronized: true }) ?? canvas.getContext('2d');
  if (!context) throw new Error('canvas-2d-unavailable');
  const transitionContext = transitionCanvas.getContext('2d', { alpha: false, desynchronized: true })
    ?? transitionCanvas.getContext('2d');

  const analyzer = createAnalyzer();
  const random = mulberry32(0x51a7c0de);
  const nebulas = createNebulaLibrary({
    documentRef,
    imageFactory: imageFactoryFor(documentRef, windowRef),
  });
  const viewport = { width: 0, height: 0, dpr: 1 };
  const stars = [];
  let palette = createPalette({});
  let themeSignature = nebulaThemeKey(palette);
  let sprites = {};
  let settings = readSettings();
  let sceneSetting = settings.scene;
  let currentScene = sceneSetting === 'auto' ? 'ring' : sceneSetting;
  let autoStartedAt = 0;
  let autoCursor = 0;
  let transition = { active: false, startedAt: 0, duration: TRANSITION_SECONDS };
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
    const count = Math.round(42 + settings.density * 1.12);
    for (let index = 0; index < count; index += 1) {
      stars.push({
        x: random(),
        y: random(),
        z: 0.18 + random() * 0.82,
        size: 0.3 + Math.pow(random(), 3.5) * 1.55,
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
    gradient.addColorStop(0.12, rgba(color, 0.9));
    gradient.addColorStop(0.4, rgba(color, 0.22));
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
    const nextPalette = createPalette(host.getTheme?.() ?? {});
    const nextSignature = nebulaThemeKey(nextPalette);
    if (nextSignature !== themeSignature) {
      palette = nextPalette;
      themeSignature = nextSignature;
      rebuildSprites();
      staticFrameKey = '';
    }
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
      duration: reducedMotion ? 0.42 : TRANSITION_SECONDS,
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
    const dprLimit = width < 680 ? 1.35 : width > 1900 ? 1.6 : 1.75;
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

  function drawBackdrop() {
    const width = viewport.width;
    const height = viewport.height;
    const background = mixColor(palette.deep, palette.black, settings.depth * 0.004);
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, rgba(mixColor(background, palette.themeSecondary, 0.045), 1));
    gradient.addColorStop(0.55, rgba(background, 1));
    gradient.addColorStop(1, rgba(mixColor(background, palette.black, 0.72), 1));
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const glowX = width * (currentScene === 'blackhole' ? 0.69 : 0.5);
    const glowY = height * (currentScene === 'peaks' ? 0.55 : 0.47);
    const bloom = context.createRadialGradient(
      glowX,
      glowY,
      0,
      glowX,
      glowY,
      Math.max(width, height) * 0.62,
    );
    bloom.addColorStop(0, rgba(palette.themePrimary, 0.035 + settings.glow * 0.00016));
    bloom.addColorStop(0.55, rgba(palette.themeSecondary, 0.018 + settings.glow * 0.00008));
    bloom.addColorStop(1, rgba(palette.deep, 0));
    context.fillStyle = bloom;
    context.fillRect(0, 0, width, height);
  }

  function drawStars(timestamp) {
    const width = viewport.width;
    const height = viewport.height;
    const speed = reducedMotion ? 0.24 : settings.motion / 100;
    const count = Math.max(30, Math.floor(stars.length * quality));
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < count; index += 1) {
      const star = stars[index];
      const x = (((star.x + visualTime * 0.00075 * star.z * speed) % 1) + 1) % 1 * width;
      const y = (star.y + Math.sin(star.phase * 1.8) * 0.0022) * height;
      const twinkle = 0.48 + 0.52 * Math.pow(0.5 + 0.5 * Math.sin(timestamp * 0.00042 * star.z + star.phase), 2);
      const alpha = twinkle * (0.12 + star.z * 0.32);
      if (star.size > 1.24) {
        drawSprite(star.warmth > 0.66 ? sprites.warm : sprites.white, x, y, 2.6 + star.size * 2.2, alpha * 0.42);
      } else {
        context.fillStyle = rgba(star.warmth > 0.88 ? palette.warm : palette.hot, alpha);
        context.fillRect(x, y, star.size, star.size);
      }
    }
    context.restore();
  }

  function sceneGeometry(scene) {
    const width = viewport.width;
    const height = viewport.height;
    const base = Math.min(width, height);
    const portrait = height > width * 1.08;
    const radius = portrait
      ? width * (0.36 + settings.depth * 0.00016)
      : base * (0.355 + settings.depth * 0.00034);
    const layout = NEBULA_LAYOUTS[scene] ?? NEBULA_LAYOUTS.ring;
    const nebulaWidth = radius * layout.width;
    const nebulaHeight = radius * layout.height;
    return {
      width,
      height,
      base,
      radius,
      nebulaWidth,
      nebulaHeight,
      x: width * 0.5 + radius * layout.x,
      y: height * (scene === 'peaks' ? 0.5 : 0.48) + radius * layout.y,
      portrait,
      layout,
    };
  }

  function drawFallbackNebula(scene, geometry, timestamp) {
    const state = analyzer.state;
    const speed = reducedMotion ? 0.2 : settings.motion / 100;
    const flow = timestamp * 0.00006 * speed + visualTime * 0.02;
    context.save();
    context.translate(geometry.x, geometry.y);
    context.rotate(geometry.layout.rotate);
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';

    const ridgeColor = mixColor(palette.themeSecondary, palette.core, 0.45);
    if (scene === 'galaxy' || scene === 'blackhole') {
      const arms = scene === 'galaxy' ? 5 : 8;
      for (let arm = 0; arm < arms; arm += 1) {
        for (let piece = 0; piece < 7; piece += 1) {
          const start = piece / 7 * TAU + arm / arms * TAU + flow * (scene === 'blackhole' ? 0.16 : 0.1);
          const length = 0.19 + seededRange(arm * 17 + piece, 0x91b2, 4) * 0.22;
          const radius = geometry.nebulaWidth * (0.09 + piece * 0.038);
          context.beginPath();
          context.ellipse(0, 0, radius, radius * (scene === 'blackhole' ? 0.31 : 0.47), 0, start, start + length);
          context.lineWidth = (scene === 'blackhole' ? 8 : 15) * (1 - piece * 0.055) * quality;
          context.strokeStyle = rgba(arm % 3 ? ridgeColor : palette.hot, 0.1 + state.mid * 0.05);
          context.stroke();
        }
      }
    } else if (scene === 'peaks') {
      for (let layer = 0; layer < 6; layer += 1) {
        context.beginPath();
        for (let point = 0; point <= 70; point += 1) {
          const progress = point / 70;
          const envelope = 0.2 + Math.sin(progress * Math.PI) * 0.8;
          const x = (progress - 0.5) * geometry.nebulaWidth;
          const ridge = (
            Math.sin(progress * 17 + layer * 0.7 + flow * 2) * 0.22
            + Math.sin(progress * 37 - layer * 1.1) * 0.1
            + 0.32
          ) * envelope;
          const y = geometry.nebulaHeight * (layer * 0.055 - 0.08 - ridge * 0.29);
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.lineWidth = (14 - layer) * quality;
        context.strokeStyle = rgba(layer % 2 ? palette.core : ridgeColor, 0.08 + state.mid * 0.04);
        context.stroke();
      }
    } else {
      for (let band = 0; band < 11; band += 1) {
        for (let piece = 0; piece < 8; piece += 1) {
          if ((band + piece) % 5 === 0) continue;
          const start = piece / 8 * TAU + flow * (band % 2 ? -0.05 : 0.04);
          const length = 0.16 + (piece % 3) * 0.04;
          context.beginPath();
          context.ellipse(
            0,
            0,
            geometry.nebulaWidth * (0.18 + band * 0.017),
            geometry.nebulaHeight * (0.17 + band * 0.021),
            0,
            start,
            start + length,
          );
          context.lineWidth = (12 - band * 0.55) * quality;
          context.strokeStyle = rgba(band < 5 ? palette.core : ridgeColor, 0.08 + state.mid * 0.04);
          context.stroke();
        }
      }
    }
    context.restore();
  }

  function drawNebulaFrame(scene, timestamp) {
    const geometry = sceneGeometry(scene);
    const state = analyzer.state;
    const surface = nebulas.get(scene, palette);
    if (!surface) {
      drawFallbackNebula(scene, geometry, timestamp);
      return geometry;
    }

    const calm = reducedMotion ? 0.2 : 1;
    const speed = settings.motion / 100;
    const phase = { ring: 0, galaxy: 1.7, peaks: 3.1, blackhole: 4.5 }[scene];
    const bassScale = 1 + (state.bass * 0.023 + state.bassOnset * 0.011) * calm;
    const midScale = 1 + (state.lowMid * 0.011 + state.mid * 0.008) * calm;
    const rotateMotion = Math.sin(timestamp * 0.000034 * speed + phase) * 0.014
      + Math.sin(timestamp * 0.000087 * speed + phase * 0.7) * state.mid * 0.006;
    const driftX = Math.sin(timestamp * 0.000041 * speed + phase) * geometry.radius * 0.005 * calm;
    const driftY = Math.cos(timestamp * 0.000037 * speed + phase) * geometry.radius * 0.004 * calm;
    const intensity = 0.91 + settings.glow * 0.00065 + state.bass * 0.045 + state.energy * 0.025;

    context.save();
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = clamp(intensity);
    context.translate(geometry.x + driftX, geometry.y + driftY);
    context.rotate(geometry.layout.rotate + rotateMotion);
    context.scale(bassScale * midScale, (1 + state.lowMid * 0.012 * calm));
    context.drawImage(
      surface,
      -geometry.nebulaWidth / 2,
      -geometry.nebulaHeight / 2,
      geometry.nebulaWidth,
      geometry.nebulaHeight,
    );
    context.restore();

    if (scene === 'blackhole') {
      const holeRadius = geometry.base * (0.071 + settings.depth * 0.00012 + state.bass * 0.0045);
      const holeX = geometry.x + driftX;
      const holeY = geometry.y + driftY;
      context.save();
      context.globalCompositeOperation = 'source-over';
      const shadow = context.createRadialGradient(holeX, holeY, holeRadius * 0.54, holeX, holeY, holeRadius * 1.18);
      shadow.addColorStop(0, 'rgba(0, 0, 0, 1)');
      shadow.addColorStop(0.74, 'rgba(0, 1, 6, 0.99)');
      shadow.addColorStop(1, 'rgba(0, 2, 9, 0)');
      context.fillStyle = shadow;
      context.beginPath();
      context.arc(holeX, holeY, holeRadius * 1.18, 0, TAU);
      context.fill();
      context.restore();
    }
    return geometry;
  }

  function drawRidgeHighlights(scene, geometry, timestamp) {
    const state = analyzer.state;
    if (reducedMotion || (!state.shimmer && !state.bassOnset)) return;
    const count = Math.max(5, Math.round(5 + settings.density * 0.055));
    const glow = settings.glow / 100;
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < count; index += 1) {
      const seed = seededRange(index, 0x30a1, scene.length + 2);
      const pulse = Math.max(
        state.shimmer * (0.28 + seed * 0.72),
        state.bassOnset * (index % 3 === 0 ? 0.48 : 0.18),
      );
      let x = geometry.x;
      let y = geometry.y;
      if (scene === 'ring') {
        const angle = seed * TAU + timestamp * 0.000035 * (settings.motion / 100);
        x += Math.cos(angle) * geometry.nebulaWidth * (0.27 + seededRange(index, 0x44c2, 3) * 0.16);
        y += Math.sin(angle) * geometry.nebulaHeight * (0.25 + seededRange(index, 0x51e1, 4) * 0.12);
      } else if (scene === 'galaxy') {
        const radius = 0.08 + seed * 0.39;
        const angle = index % 3 * TAU / 3 + radius * 5.5 + timestamp * 0.000025;
        x += Math.cos(angle) * geometry.nebulaWidth * radius;
        y += Math.sin(angle) * geometry.nebulaHeight * radius * 0.45;
      } else if (scene === 'peaks') {
        x += (seed - 0.5) * geometry.nebulaWidth * 0.72;
        y += geometry.nebulaHeight * (0.02 - Math.abs(seed - 0.5) * 0.18);
      } else {
        const angle = seed * TAU + timestamp * 0.00006;
        const radius = 0.18 + seededRange(index, 0x6131, 5) * 0.16;
        x += Math.cos(angle) * geometry.nebulaWidth * radius;
        y += Math.sin(angle) * geometry.nebulaHeight * radius * 0.22;
      }
      const size = 5 + pulse * 15 + glow * 3;
      drawSprite(index % 4 === 0 ? sprites.hot : sprites.core, x, y, size, clamp(0.05 + pulse * 0.24));
    }
    context.restore();
  }

  function drawVignette() {
    const width = viewport.width;
    const height = viewport.height;
    const radius = Math.max(width, height) * 0.72;
    const vignette = context.createRadialGradient(width * 0.5, height * 0.48, radius * 0.28, width * 0.5, height * 0.48, radius);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.72, 'rgba(0, 1, 10, 0.045)');
    vignette.addColorStop(1, `rgba(0, 1, 8, ${palette.daylight ? 0.12 : 0.34})`);
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
  }

  function drawScene(timestamp) {
    drawBackdrop();
    drawStars(timestamp);
    const geometry = drawNebulaFrame(currentScene, timestamp);
    drawRidgeHighlights(currentScene, geometry, timestamp);
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
      const key = [
        viewport.width,
        viewport.height,
        currentScene,
        sceneSetting,
        settings.density,
        settings.depth,
        themeSignature,
        nebulas.getStats().cachedSurfaces,
      ].join(':');
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

    const motionScale = reducedMotion ? 0.26 : settings.motion / 100;
    visualTime += rawDt * (settings.highDynamic ? 1 : 0.7) * motionScale;
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
      themeStructureKey: themeSignature,
      nebula: nebulas.getStats(),
      disposed,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    removeMotionListener();
    analyzer.reset();
    nebulas.dispose();
    canvas.remove();
    transitionCanvas.width = 0;
    transitionCanvas.height = 0;
    stars.length = 0;
  }

  applyTheme();
  rebuildSprites();
  rebuildStars();
  autoStartedAt = now();
  nebulas.load().then(() => {
    if (disposed) return;
    staticFrameKey = '';
    if (host.staticMode) render(now(), true);
  }).catch(() => {
    // Rich star-atlas loading has a broken-ridge fallback; the background must
    // remain usable even when a platform refuses image decoding.
  });

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
