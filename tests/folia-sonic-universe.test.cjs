const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const moduleRoot = path.join(root, 'folia-mod', 'sonic-universe');
const importModule = (relative) => import(pathToFileURL(path.join(moduleRoot, relative)).href);

function createGradient() {
  return { addColorStop() {} };
}

function create2dContext() {
  const target = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#fff',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    createLinearGradient: createGradient,
    createRadialGradient: createGradient,
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return () => {};
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  });
}

function createCanvas() {
  const context = create2dContext();
  return {
    width: 0,
    height: 0,
    style: {},
    removed: false,
    getContext: () => context,
    setAttribute() {},
    remove() {
      this.removed = true;
    },
  };
}

function createDocument() {
  return {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return createCanvas();
    },
  };
}

function createWindow() {
  const mediaListeners = new Set();
  return {
    devicePixelRatio: 2.5,
    performance: { now: () => Date.now() },
    matchMedia() {
      return {
        matches: false,
        addEventListener(_name, listener) {
          mediaListeners.add(listener);
        },
        removeEventListener(_name, listener) {
          mediaListeners.delete(listener);
        },
      };
    },
  };
}

function createHost(overrides = {}) {
  const bands = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 };
  const spectrum = new Uint8Array(1024);
  const state = {
    paused: false,
    staticMode: false,
    settings: {
      scene: 'ring',
      density: 72,
      motion: 100,
      sensitivity: 1,
      glow: 62,
      depth: 68,
      highDynamic: true,
    },
    theme: {
      backgroundColor: '#050817',
      primaryColor: '#765bda',
      accentColor: '#c399ff',
      secondaryColor: '#3668d1',
      isDaylight: false,
    },
    bands,
    spectrum,
  };
  return Object.assign({
    get staticMode() {
      return state.staticMode;
    },
    isPaused: () => state.paused,
    getTheme: () => state.theme,
    getSettings: () => state.settings,
    getCoverUrl: () => null,
    audio: {
      getPower: () => Math.max(bands.bass, bands.lowMid, bands.mid, bands.vocal, bands.treble),
      getBands: () => bands,
      getSpectrum: () => spectrum,
    },
  }, overrides, { state });
}

function feedAudio(host, frames = 120) {
  Object.assign(host.state.bands, { bass: 0.83, lowMid: 0.62, mid: 0.73, vocal: 0.47, treble: 0.36 });
  for (let index = 44; index < 420; index += 1) {
    const center = index < 160 ? 84 : 310;
    host.state.spectrum[index] = Math.max(0, Math.round(245 - Math.abs(index - center) * 0.72));
  }
  return frames;
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'mod.json'), 'utf8'));
  assert.equal(manifest.folium, 1);
  assert.equal(manifest.id, 'sonic-universe');
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.client, 'client.mjs');
  assert.deepEqual(manifest.permissions, []);
  assert.ok(fs.existsSync(path.join(moduleRoot, manifest.client)));

  const previewPath = path.join(moduleRoot, manifest.preview);
  const preview = fs.readFileSync(previewPath);
  assert.deepEqual([...preview.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(preview.length < 1024 * 1024, 'store preview should stay below 1 MiB');
  assert.equal(preview.readUInt32BE(16), 1280);
  assert.equal(preview.readUInt32BE(20), 720);

  const previewHtml = fs.readFileSync(path.join(moduleRoot, 'preview.html'), 'utf8');
  for (const theme of ['purple', 'blue', 'gold']) {
    assert.match(previewHtml, new RegExp(`\\b${theme}: \\{`), `preview should expose the ${theme} theme`);
  }

  const {
    createNebulaLibrary,
    recolorNebulaPixels,
    nebulaThemeKey,
    NEBULA_LAYOUTS,
    NEBULA_SCENES,
    NEBULA_SOURCES,
    NEBULA_SOURCE_VERSION,
  } = await importModule('src/nebula.mjs');
  const { createPalette } = await importModule('src/palette.mjs');
  assert.equal(NEBULA_SOURCE_VERSION, '2026.11.11-v26');
  assert.deepEqual([...NEBULA_SCENES], ['ring', 'galaxy', 'peaks', 'blackhole']);
  for (const scene of NEBULA_SCENES) {
    assert.equal(typeof NEBULA_LAYOUTS[scene]?.width, 'number');
    assert.match(NEBULA_SOURCES[scene], /^data:image\/webp;base64,/);
  }

  const nebulaStructure = new Uint8Array([
    230, 176, 36, 224,
    132, 32, 180, 171,
    64, 8, 52, 93,
    0, 0, 0, 0,
  ]);
  const purplePalette = createPalette({
    primaryColor: '#765bda',
    accentColor: '#c399ff',
    secondaryColor: '#3668d1',
  });
  const bluePalette = createPalette({
    primaryColor: '#398ae8',
    accentColor: '#a8e8ff',
    secondaryColor: '#2154d4',
  });
  const goldPalette = createPalette({
    primaryColor: '#e7a84b',
    accentColor: '#ffe0a0',
    secondaryColor: '#c66d2d',
  });
  assert.notEqual(nebulaThemeKey(purplePalette), nebulaThemeKey(goldPalette));
  const purplePixels = recolorNebulaPixels(nebulaStructure.slice(), purplePalette);
  const goldPixels = recolorNebulaPixels(nebulaStructure.slice(), goldPalette);
  const bluePixels = recolorNebulaPixels(nebulaStructure.slice(), bluePalette);
  for (let index = 3; index < purplePixels.length; index += 4) {
    assert.equal(goldPixels[index], purplePixels[index], 'themes must preserve the same coverage masks');
    assert.equal(bluePixels[index], purplePixels[index], 'themes must preserve the same coverage masks');
  }
  assert.notDeepEqual([...goldPixels.slice(0, 3)], [...purplePixels.slice(0, 3)]);
  assert.ok(goldPixels[0] > goldPixels[2], 'gold theme should make the dense ridge warm');
  assert.ok(bluePixels[2] > bluePixels[0], 'blue theme should make the dense ridge cool');

  const unsupportedNebulaLibrary = createNebulaLibrary({
    documentRef: null,
    imageFactory: null,
  });
  assert.equal(await unsupportedNebulaLibrary.load(), false);
  assert.equal(unsupportedNebulaLibrary.getStats().status, 'unsupported');
  unsupportedNebulaLibrary.dispose();
  assert.equal(unsupportedNebulaLibrary.getStats().disposed, true);

  const { createAnalyzer, LANE_COUNT } = await importModule('src/analysis.mjs');
  const analyzer = createAnalyzer();
  const audio = createHost();
  feedAudio(audio);
  for (let index = 0; index < 90; index += 1) {
    analyzer.update(audio.audio, 1 / 60, { sensitivity: 1, paused: false });
  }
  assert.ok(analyzer.state.bass > 0.7);
  assert.ok(analyzer.state.mid > 0.6);
  assert.ok(analyzer.state.lanes.every(Number.isFinite), 'every frequency lane should be finite');
  assert.ok(analyzer.state.lanes.some((value) => value > 0.35), 'spectrum should reach frequency lanes');
  assert.ok(analyzer.state.history.some((row) => row[0] > 0), 'recent spectrum should leave a trail');

  for (let index = 0; index < 600; index += 1) {
    analyzer.update(audio.audio, 1 / 60, { sensitivity: 1, paused: true });
  }
  assert.ok(analyzer.state.energy < 0.002, 'paused audio should settle');
  assert.ok(analyzer.state.settled);
  assert.ok(analyzer.state.lanes.every((value) => value < 0.002));
  assert.equal(analyzer.state.lanes.length, LANE_COUNT);

  const silent = createAnalyzer();
  const silentAudio = {
    getPower: () => 0,
    getBands: () => ({ bass: 1, lowMid: 1, mid: 1, vocal: 1, treble: 1 }),
    getSpectrum: () => new Uint8Array(1024).fill(255),
  };
  for (let index = 0; index < 120; index += 1) silent.update(silentAudio, 1 / 60, { paused: true });
  assert.ok(silent.state.energy < 0.001);
  assert.ok(silent.state.lanes.every((value) => value === 0));

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = createDocument();
  globalThis.window = createWindow();

  const { createRenderer } = await importModule('src/renderer.mjs');
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    style: {},
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    appendChild(child) {
      this.child = child;
    },
  };
  const host = createHost();
  feedAudio(host);
  const renderer = createRenderer({ container, host });
  renderer.resize({ width: 1280, height: 720 });
  assert.deepEqual(renderer.getState().viewport, { width: 1280, height: 720, dpr: 1.75 });

  for (const [index, scene] of ['ring', 'galaxy', 'peaks', 'blackhole'].entries()) {
    host.state.settings.scene = scene;
    renderer.syncContext(index * 20);
    assert.equal(renderer.render(index * 20 + 5), true);
    assert.equal(renderer.getState().scene, scene);
  }

  host.state.settings.scene = 'galaxy';
  renderer.syncContext(200);
  renderer.render(205);
  assert.equal(renderer.getState().transitionActive, true);
  host.state.settings.scene = 'blackhole';
  renderer.syncContext(220);
  renderer.render(225);
  assert.equal(renderer.getState().transitionActive, true, 'a second scene change should interrupt the first');

  host.state.theme = { ...host.state.theme, primaryColor: '#ff9c62', accentColor: '#ffd7a8' };
  renderer.syncContext(240);
  assert.equal(renderer.render(245), true);
  host.state.paused = true;
  let timestamp = 250;
  for (let index = 0; index < 720; index += 1) {
    timestamp += 16.67;
    renderer.render(timestamp);
  }
  assert.equal(renderer.getState().settled, true);

  host.state.staticMode = true;
  renderer.resize({ width: 640, height: 360 });
  const firstStatic = renderer.render(9000, true);
  const repeatedStatic = renderer.render(9050);
  assert.equal(firstStatic, true);
  assert.equal(repeatedStatic, false, 'static mode should draw only once');

  renderer.dispose();
  assert.equal(container.child.removed, true);
  assert.equal(renderer.getState().disposed, true);
  assert.equal(renderer.render(10000), false);

  const { default: activate } = await importModule('client.mjs');
  let registered;
  const registeredFolium = {
    registries: {
      backgrounds: {
        register(definition) {
          registered = definition;
          return { id: definition.id, unregister() {} };
        },
      },
    },
  };
  activate(registeredFolium);
  assert.equal(registered.id, 'music-stars');
  assert.equal(registered.settings.length, 7);
  assert.equal(registered.settings[0].defaultValue, 'auto');

  const mountedContainer = {
    clientWidth: 900,
    clientHeight: 600,
    style: {},
    getBoundingClientRect: () => ({ width: 900, height: 600 }),
    appendChild(child) {
      this.child = child;
    },
  };
  const mountedHost = createHost();
  let frame;
  let disposed = false;
  const mountContext = Object.assign(mountedHost, {
    onChange: () => () => {},
    onResize(listener) {
      listener({ width: 900, height: 600 });
      return () => {};
    },
    onFrame(listener) {
      frame = listener;
      return () => {
        frame = null;
      };
    },
  });
  const cleanup = registered.mount(mountedContainer, mountContext);
  assert.equal(typeof frame, 'function');
  frame(100);
  cleanup();
  disposed = mountedContainer.child.removed;
  assert.equal(disposed, true);
  assert.equal(frame, null);

  globalThis.document = previousDocument;
  globalThis.window = previousWindow;
  console.log('PASS Folia manifest, 1280x720 preview, four scenes, audio lanes, pause decay, static frame, theme/settings changes, mount and disposal');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
