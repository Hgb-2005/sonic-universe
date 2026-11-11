import { NEBULA_SOURCES, NEBULA_SOURCE_VERSION } from './nebula-assets.mjs';

export { NEBULA_SOURCES, NEBULA_SOURCE_VERSION };

export const NEBULA_SCENES = Object.freeze(['ring', 'galaxy', 'peaks', 'blackhole']);
export const NEBULA_LAYOUTS = Object.freeze({
  ring: Object.freeze({ width: 3.8, height: 2.95, x: 0.06, y: -0.01, rotate: -0.055 }),
  galaxy: Object.freeze({ width: 4.05, height: 3.08, x: 0.035, y: 0, rotate: 0.06 }),
  peaks: Object.freeze({ width: 4.1, height: 3.05, x: 0.025, y: 0.035, rotate: -0.018 }),
  blackhole: Object.freeze({ width: 4.05, height: 3.02, x: 0.035, y: 0, rotate: -0.05 }),
});

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function colorAt(colors, key, fallback) {
  const color = colors?.[key];
  return Array.isArray(color) && color.length >= 3 ? color : fallback;
}

/**
 * The V26 atlas stores density in R, warm filaments in G, cool filaments in B,
 * and coverage in A. Recolouring therefore changes only the palette while
 * preserving every ridge, dust lane and hole in the shared structure.
 */
export function recolorNebulaPixels(data, colors) {
  if (!data || typeof data.length !== 'number' || data.length % 4 !== 0) {
    throw new TypeError('nebula-pixels-required');
  }
  const shadow = colorAt(colors, 'deep', [2, 4, 14]);
  const body = colorAt(colors, 'second', [56, 104, 215]);
  const core = colorAt(colors, 'core', [182, 145, 255]);
  const cool = colorAt(colors, 'themeSecondary', [50, 99, 208]);
  const hot = colorAt(colors, 'hot', [238, 224, 255]);

  for (let index = 0; index < data.length; index += 4) {
    const density = data[index] / 255;
    const warmMask = data[index + 1] / 255;
    const coolMask = data[index + 2] / 255;
    const coverage = data[index + 3] / 255;
    if (coverage < 0.014) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      continue;
    }

    const bodyRamp = smoothstep(0.015, 0.74, density);
    const coreRamp = smoothstep(0.18, 0.95, density);
    const ridgeRamp = smoothstep(0.18, 0.92, density);
    let red = shadow[0] + (body[0] - shadow[0]) * bodyRamp;
    let green = shadow[1] + (body[1] - shadow[1]) * bodyRamp;
    let blue = shadow[2] + (body[2] - shadow[2]) * bodyRamp;

    red += (core[0] - red) * coreRamp * 0.54;
    green += (core[1] - green) * coreRamp * 0.54;
    blue += (core[2] - blue) * coreRamp * 0.54;

    const coolAmount = coolMask * ridgeRamp * 0.48;
    red += (cool[0] - red) * coolAmount;
    green += (cool[1] - green) * coolAmount;
    blue += (cool[2] - blue) * coolAmount;

    const hotAmount = warmMask * ridgeRamp * 0.58;
    red += (hot[0] - red) * hotAmount;
    green += (hot[1] - green) * hotAmount;
    blue += (hot[2] - blue) * hotAmount;

    data[index] = Math.round(clamp(red, 0, 255));
    data[index + 1] = Math.round(clamp(green, 0, 255));
    data[index + 2] = Math.round(clamp(blue, 0, 255));
    data[index + 3] = Math.round(coverage * 247);
  }
  return data;
}

export function nebulaThemeKey(colors) {
  const keys = ['deep', 'second', 'core', 'themeSecondary', 'hot'];
  return keys.map((key) => colorAt(colors, key, [0, 0, 0]).slice(0, 3).join('.')).join('|');
}

function loadImage(imageFactory, source, timeoutMs) {
  return new Promise((resolve, reject) => {
    let image;
    let settled = false;
    let timer = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      callback(value);
    };
    try {
      image = new imageFactory();
      image.decoding = 'async';
      image.onload = () => finish(resolve, image);
      image.onerror = () => finish(reject, new Error('nebula-image-decode-failed'));
      timer = setTimeout(() => finish(reject, new Error('nebula-image-load-timeout')), timeoutMs);
      image.src = source;
      if (typeof image.decode === 'function') {
        image.decode().catch(() => {
          // onload remains the fallback for browsers whose decode() rejects
          // while the same data URL still produces a usable image.
        });
      }
    } catch (error) {
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
      reject(error);
    }
  });
}

export function createNebulaLibrary({
  documentRef = globalThis.document,
  imageFactory = globalThis.Image,
  sources = NEBULA_SOURCES,
  timeoutMs = 5000,
} = {}) {
  const images = new Map();
  const surfaces = new Map();
  const failures = new Map();
  let disposed = false;
  let status = 'idle';
  let loadPromise = null;

  function canRecolor(image) {
    return Boolean(
      image &&
      documentRef &&
      typeof documentRef.createElement === 'function' &&
      Number.isFinite(image.naturalWidth ?? image.width) &&
      (image.naturalWidth ?? image.width) > 0 &&
      Number.isFinite(image.naturalHeight ?? image.height) &&
      (image.naturalHeight ?? image.height) > 0,
    );
  }

  function makeSurface(scene, colors) {
    if (disposed || !NEBULA_SCENES.includes(scene)) return null;
    const image = images.get(scene);
    if (!canRecolor(image)) return null;
    const themeKey = nebulaThemeKey(colors);
    const cacheKey = `${scene}\0${themeKey}`;
    if (surfaces.has(cacheKey)) return surfaces.get(cacheKey);

    try {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const surface = documentRef.createElement('canvas');
      surface.width = width;
      surface.height = height;
      const surfaceContext = surface.getContext?.('2d', { willReadFrequently: true })
        ?? surface.getContext?.('2d');
      if (!surfaceContext) throw new Error('nebula-2d-context-unavailable');
      surfaceContext.drawImage(image, 0, 0);
      const frame = surfaceContext.getImageData?.(0, 0, width, height);
      if (!frame?.data || frame.data.length !== width * height * 4) {
        throw new Error('nebula-pixels-unavailable');
      }
      recolorNebulaPixels(frame.data, colors);
      surfaceContext.putImageData(frame, 0, 0);

      if (surfaces.size >= 8) {
        const oldestKey = surfaces.keys().next().value;
        surfaces.delete(oldestKey);
      }
      surfaces.set(cacheKey, surface);
      return surface;
    } catch (error) {
      failures.set(cacheKey, String(error?.message ?? error));
      return null;
    }
  }

  function load() {
    if (disposed) return Promise.resolve(false);
    if (loadPromise) return loadPromise;
    if (typeof imageFactory !== 'function') {
      status = 'unsupported';
      return Promise.resolve(false);
    }
    status = 'loading';
    loadPromise = Promise.all(NEBULA_SCENES.map(async (scene) => {
      const source = sources?.[scene];
      if (typeof source !== 'string' || !source) {
        failures.set(scene, 'nebula-source-missing');
        return false;
      }
      try {
        const image = await loadImage(imageFactory, source, timeoutMs);
        if (disposed) return false;
        images.set(scene, image);
        return true;
      } catch (error) {
        if (!disposed) failures.set(scene, String(error?.message ?? error));
        return false;
      }
    })).then((loaded) => {
      if (disposed) return false;
      status = loaded.some(Boolean) ? 'ready' : 'failed';
      return loaded.some(Boolean);
    });
    return loadPromise;
  }

  function get(scene, colors) {
    return makeSurface(scene, colors);
  }

  function has(scene) {
    return images.has(scene);
  }

  function getStats() {
    return {
      status,
      loaded: [...images.keys()],
      failures: Object.fromEntries(failures),
      cachedSurfaces: surfaces.size,
      disposed,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const image of images.values()) {
      image.onload = null;
      image.onerror = null;
      image.src = '';
    }
    images.clear();
    surfaces.clear();
    failures.clear();
    status = 'disposed';
  }

  return {
    load,
    get,
    has,
    getStats,
    dispose,
  };
}
