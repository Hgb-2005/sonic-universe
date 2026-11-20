'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, _electron } = require('playwright');
const { createAppServer } = require('../companion/server.cjs');

const root = path.resolve(__dirname, '..');
const port = 18870;
const origin = `http://127.0.0.1:${port}`;

async function verifyScenes(page) {
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Simulate a profile saved before the dynamic scene preferences existed.
  await page.addInitScript(() => {
    const key = 'sonic-listening-room-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ mode:'work', background:'geometry' }));
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.SonicPlayback?.snapshot().ready);
  await page.evaluate(() => SonicPlayback.setVolume(0));

  const room = page.locator('#listeningRoom');
  const gallery = room.locator('[data-scene-dialog]');
  const backdrop = gallery.locator('[data-scene-backdrop]');
  const pin = gallery.locator('[data-action="scene-pin"]');
  const canvas = room.locator('.lr-background');
  const play = room.locator('[data-action="play"]');
  const setMode = mode => room.locator(`[data-room-mode="${mode}"]`).click();
  const openGallery = () => room.locator('[data-action="scene-gallery"]').filter({ visible:true }).click();
  const closeGallery = () => gallery.locator('[data-close]').click();
  const sceneButton = name => gallery.locator(`[data-scene-select="${name}"]`);
  const waitForScene = name => page.waitForFunction(expected =>
    document.getElementById('listeningRoom').dataset.activeScene === expected, name);
  const fingerprint = () => canvas.evaluate(source => {
    const sample = document.createElement('canvas');
    sample.width = 80;
    sample.height = 45;
    sample.getContext('2d').drawImage(source, 0, 0, sample.width, sample.height);
    return sample.toDataURL();
  });
  // After any paint scheduled by the interaction, compare two settled samples.
  const assertStill = async () => {
    await page.waitForTimeout(225);
    const first = await fingerprint();
    await page.waitForTimeout(325);
    assert.equal(await fingerprint(), first);
  };

  assert.equal(await room.getAttribute('data-mode'), 'work');
  assert.equal(await room.getAttribute('data-background'), 'geometry');
  assert.equal(await room.getAttribute('data-active-scene'), null);
  await setMode('visual');
  await waitForScene('prism-bloom');
  await openGallery();
  const previews = await gallery.locator('[data-scene-grid] canvas').evaluateAll(elements => elements.map(element => {
    const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
    const colors = new Set();
    for (let offset = 0; offset < pixels.length; offset += 68) {
      colors.add((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
    }
    return { colors:colors.size, image:element.toDataURL() };
  }));
  assert.equal(previews.length, 12);
  assert.ok(previews.every(preview => preview.colors > 5), 'all scene previews show painted detail');
  assert.equal(new Set(previews.map(preview => preview.image)).size, 12);
  assert.equal(await sceneButton('auto').getAttribute('aria-pressed'), 'true');
  await sceneButton('jiangnan-rain').click();
  await waitForScene('jiangnan-rain');
  await closeGallery();
  console.log('PASS geometry remains the work default; the stage opens on Prism Bloom and all twelve previews are distinct');

  const pausedFrame = await fingerprint();
  await play.click();
  await page.waitForFunction(() => SonicPlayback.snapshot().playing && SonicPlayback.snapshot().position > .3);
  assert.notEqual(await fingerprint(), pausedFrame, 'the selected scene starts moving when music plays');
  await page.mouse.move(180, 220);
  await page.waitForFunction(() => document.getElementById('listeningRoom').dataset.stageChrome==='false');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#listeningRoom .lr-player-wrap')).opacity)<.05);
  await page.mouse.move(185, 220);
  await page.waitForFunction(() => document.getElementById('listeningRoom').dataset.stageChrome==='true');
  await play.click();
  await page.waitForFunction(() => !SonicPlayback.snapshot().playing && SonicListeningRoom.stats().fpsLimit === 0);
  await assertStill();
  await play.click();
  await page.waitForFunction(() => SonicPlayback.snapshot().playing && SonicListeningRoom.stats().fpsLimit > 0);
  const resumedFrame = await fingerprint();
  await page.waitForTimeout(325);
  assert.notEqual(await fingerprint(), resumedFrame, 'the scene continues animating after resume');
  await play.click();
  await page.waitForFunction(() => !SonicPlayback.snapshot().playing);
  console.log('PASS the visual canvas animates with playback, freezes on pause, and resumes');

  await openGallery();
  await gallery.locator('[data-scene-filter="赛博"]').click();
  assert.equal(await sceneButton('jiangnan-rain').isVisible(), false);
  assert.equal(await sceneButton('neon-grid').isVisible(), true);
  const groups = await gallery.locator('[data-scene-grid] [data-scene-select]:visible').evaluateAll(nodes =>
    [...new Set(nodes.map(node => node.dataset.sceneGroup))]);
  assert.deepEqual(groups, ['赛博']);
  await sceneButton('neon-grid').click();
  await waitForScene('neon-grid');
  await pin.click();
  assert.equal(await pin.getAttribute('aria-pressed'), 'true');
  await backdrop.check();
  await closeGallery();

  await setMode('work');
  await waitForScene('neon-grid');
  await setMode('listen');
  await waitForScene('neon-grid');
  await page.reload();
  await waitForScene('neon-grid');
  assert.equal(await room.getAttribute('data-mode'), 'listen');
  await setMode('visual');
  await openGallery();
  assert.equal(await sceneButton('neon-grid').getAttribute('aria-pressed'), 'true');
  assert.equal(await pin.getAttribute('aria-pressed'), 'true');
  assert.equal(await backdrop.isChecked(), true);
  console.log('PASS scene filtering, per-track pinning and optional backdrops survive reload');

  await backdrop.uncheck();
  await closeGallery();
  await setMode('work');
  await waitForScene(undefined);
  assert.equal(await room.getAttribute('data-background'), 'geometry');
  await setMode('visual');
  await waitForScene('neon-grid');
  await openGallery();
  await sceneButton('auto').click();
  assert.equal(await sceneButton('auto').getAttribute('aria-pressed'), 'true');
  assert.equal(await pin.getAttribute('aria-pressed'), 'false');
  await sceneButton('jiangnan-rain').click();
  await waitForScene('jiangnan-rain');
  await closeGallery();

  await page.emulateMedia({ reducedMotion:'reduce' });
  await play.click();
  await page.waitForFunction(() => SonicPlayback.snapshot().playing && SonicPlayback.snapshot().position > .3);
  await assertStill();
  await play.click();
  await page.waitForFunction(() => !SonicPlayback.snapshot().playing);
  assert.deepEqual(errors, []);
  console.log('PASS returning to a pinned scene, switching to automatic mode and reduced motion');
}

async function run() {
  if (process.argv.includes('--packaged')) {
    const qa = path.join(root, 'work', 'desktop-qa');
    await fs.mkdir(qa, { recursive:true });
    const profile = await fs.mkdtemp(path.join(qa, 'scenes-profile-'));
    const executablePath = path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE || path.join(root, 'release', 'win-unpacked', '声波宇宙.exe'));
    const app = await _electron.launch({ executablePath, cwd:root, timeout:30000,
      env:{ ...process.env, SONIC_DESKTOP_PROFILE:profile, SONIC_DESKTOP_PORT:String(port) } });
    try { await verifyScenes(await app.firstWindow()); }
    finally { await app.close(); }
    return;
  }

  const app = createAppServer({ port, providers:new Map() });
  await app.listen();
  try {
    const channel = process.env.SONIC_TEST_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
    const browser = await chromium.launch({ channel, headless:true });
    try { await verifyScenes(await browser.newPage({ viewport:{ width:1440,height:900 } })); }
    finally { await browser.close(); }
  } finally {
    await new Promise(resolve => app.server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
