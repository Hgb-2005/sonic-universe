'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, _electron } = require('playwright');
const { createAppServer } = require('../companion/server.cjs');

const root = path.resolve(__dirname, '..');
const port = 18868;
const origin = `http://127.0.0.1:${port}`;
const first = '9101';
const unavailable = '9102';
const unrecognizedMedia = '9103';
const interrupted = '9104';
const removeFromQueue = '9105';
const duplicate = '9106';
const moveUp = '9107';
const allUnavailable = ['9201', '9202'];
const orderedIds = [first, unavailable, unrecognizedMedia, interrupted, removeFromQueue, duplicate, moveUp];
const playlistId = '9100';
const unavailablePlaylistId = '9200';
const title = id => `队列样例 ${id}`;

function silentWav(seconds) {
  const sampleRate = 8000;
  const pcmBytes = Math.round(seconds * sampleRate) * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBytes, 40);
  return wav;
}

function provideWav(route, body) {
  const headers = { 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
  if (!range) return route.fulfill({ contentType: 'audio/wav', headers, body });
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  if (start > end) return route.fulfill({ status:416, headers:{ 'Content-Range':`bytes */${body.length}` } });
  headers['Content-Range'] = `bytes ${start}-${end}/${body.length}`;
  return route.fulfill({ status:206, contentType:'audio/wav', headers, body:body.subarray(start,end+1) });
}

async function mockQishui(page) {
  const playlistReads = [];
  const audioRequests = [];
  const mediaRequests = [];
  const edits = [];
  const shortWav = silentWav(1.2);
  const longWav = silentWav(25);
  const tracks = ids => ids.map(mediaId => ({
    provider: 'qishui', mediaId, name: title(mediaId), artist: '本机测试音源', duration: mediaId === first ? 1.2 : 25,
  }));
  const playlists = [
    { id:playlistId, name:'连续播放测试', trackCount:orderedIds.length },
    { id:unavailablePlaylistId, name:'不可播测试', trackCount:allUnavailable.length },
  ];

  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      return ['http:', 'https:'].includes(url.protocol) ? route.abort() : route.continue();
    }
    if (url.pathname === '/health') return route.fulfill({ json:{ ok:true, companion:true } });
    if (url.pathname === '/api/qishui/login-status') {
      return route.fulfill({ json:{ authenticated:true, user:{ nickname:'本机测试账号' } } });
    }
    if (url.pathname === '/api/qishui/library/playlists') {
      return route.fulfill({ json:{ items:playlists, hasMore:false } });
    }
    const playlistMatch = /^\/api\/qishui\/playlists\/(\d+)$/.exec(url.pathname);
    if (playlistMatch) {
      const playlist = playlists.find(item => item.id === playlistMatch[1]);
      const offset = Number(url.searchParams.get('offset') || 0);
      playlistReads.push([playlistMatch[1],offset]);
      if (playlist?.id === playlistId && offset === 0) {
        return route.fulfill({ json:{ playlist, items:tracks(orderedIds.slice(0,2)), hasMore:true, nextOffset:2 } });
      }
      if (playlist?.id === playlistId && offset === 2) {
        return route.fulfill({ json:{ playlist, items:tracks(orderedIds.slice(2)), hasMore:false } });
      }
      if (playlist?.id === unavailablePlaylistId && offset === 0) {
        return route.fulfill({ json:{ playlist, items:tracks(allUnavailable), hasMore:false } });
      }
      return route.fulfill({ status:404, json:{ error:'未预期的歌单分页' } });
    }
    if (/^\/api\/qishui\/playlist\/(add|remove)$/.test(url.pathname)) {
      edits.push(request.postData());
      return route.fulfill({ status:500, json:{ error:'临时队列不应修改来源歌单' } });
    }
    const audioMatch = /^\/api\/qishui\/tracks\/(\d+)\/audio$/.exec(url.pathname);
    if (audioMatch) {
      const id = audioMatch[1];
      const retryAfterInterruption = id === interrupted && audioRequests.includes(id);
      audioRequests.push(id);
      if (id === unavailable || allUnavailable.includes(id) || retryAfterInterruption) {
        return route.fulfill({ status:422, json:{ code:'not-playable', error:'测试歌曲暂不可播' } });
      }
      return route.fulfill({ json:{ streamPath:`/media/queue-smoke/${id}`, preview:false } });
    }
    const mediaMatch = /^\/media\/queue-smoke\/(\d+)$/.exec(url.pathname);
    if (mediaMatch) {
      const id = mediaMatch[1];
      mediaRequests.push(id);
      if (id === unrecognizedMedia) return route.fulfill({ contentType:'audio/wav', body:'audio header is invalid' });
      return provideWav(route, id === first ? shortWav : longWav);
    }
    if (/^\/api\/qishui\/songs\/\d+\/lyrics$/.test(url.pathname)) return route.fulfill({ json:{ lrc:'' } });
    if (/^\/api\/qishui\/tracks\/\d+\/cover$/.test(url.pathname)) return route.fulfill({ status:404 });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status:404, json:{ error:'测试接口未配置' } });
    return route.continue();
  });
  return { playlistReads, audioRequests, mediaRequests, edits };
}

async function withinPlayer(check) {
  if (process.argv.includes('--packaged')) {
    const qa = path.join(root,'work','desktop-qa');
    await fs.mkdir(qa,{ recursive:true });
    const profile = await fs.mkdtemp(path.join(qa,'queue-profile-'));
    const executablePath = path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE || path.join(root,'release','win-unpacked','声波宇宙.exe'));
    const app = await _electron.launch({ executablePath, cwd:root, timeout:30000,
      env:{ ...process.env, SONIC_DESKTOP_PROFILE:profile, SONIC_DESKTOP_PORT:String(port) } });
    try { await check(await app.firstWindow()); }
    finally { await app.close(); }
    return;
  }

  const app = createAppServer({ port, providers:new Map() });
  await app.listen();
  try {
    const channel = process.env.SONIC_TEST_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
    const browser = await chromium.launch({ channel, headless:true });
    try { await check(await browser.newPage({ viewport:{ width:1440,height:900 } })); }
    finally { await browser.close(); }
  } finally {
    await new Promise(resolve => app.server.close(resolve));
  }
}

async function verifyQueue(page) {
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const network = await mockQishui(page);
  await page.goto(origin);
  await page.waitForFunction(() => window.SonicPlayback?.snapshot().ready);
  const room = page.locator('#listeningRoom');
  await page.evaluate(() => SonicPlayback.setVolume(0));
  const launchOnline = () => room.getByRole('button',{ name:'在线搜索',exact:true }).click();

  async function openPlaylist(id) {
    await page.locator('#onlinePlaylistsBtn').click();
    await page.locator(`[data-online-playlist-id="${id}"]`).click();
  }

  function trackRow(id) {
    return page.locator('#onlineResults .online-result').filter({ hasText:title(id) });
  }

  async function waitForPlaying(id) {
    try {
      await page.waitForFunction(expected => {
        const state = SonicPlayback.snapshot();
        return state.playing && !state.busy && state.track?.name === expected;
      }, title(id));
    } catch (error) {
      const status = await page.evaluate(() => {
        const { track, playing, busy } = SonicPlayback.snapshot();
        return { track:track?.name, playing, busy, mediaError:document.querySelector('#audio').error?.message,
          notice:document.querySelector('#onlineResultStatus').textContent };
      });
      throw new Error(`Expected ${title(id)} to play: ${JSON.stringify({ ...status, audioRequests:network.audioRequests, mediaRequests:network.mediaRequests, errors })}`,{cause:error});
    }
  }

  const state = () => page.evaluate(() => SonicPlayback.snapshot({ queue:true }));
  const visibleQueue = room.locator('[data-queue-dialog]');
  const visibleRows = visibleQueue.locator('[data-queue-entry]');
  const queueNames = () => visibleRows.locator('.lr-queue-info strong').allTextContents();
  const queueRow = id => visibleRows.filter({ hasText:title(id) });

  await launchOnline();
  await openPlaylist(playlistId);
  await trackRow(moveUp).waitFor();
  assert.deepEqual(network.playlistReads, [[playlistId,0],[playlistId,2]]);
  await trackRow(first).locator('[data-online-action="play"]').click();
  await waitForPlaying(first);
  const opened = await state();
  assert.equal(opened.customQueue,true);
  assert.deepEqual(opened.queue.map(track => track.name),orderedIds.map(title));
  assert.equal(opened.queue[0].entryId,opened.queueEntryId);

  await waitForPlaying(interrupted);
  assert.deepEqual([...new Set(network.audioRequests)],[first,unavailable,unrecognizedMedia,interrupted]);
  assert.ok(network.audioRequests.filter(id=>id===unavailable).length<=2);
  assert.ok(network.mediaRequests.includes(unrecognizedMedia));
  console.log('PASS both Qishui pages become an ordered queue and natural playback skips failures');

  await trackRow(duplicate).locator('[data-online-action="add"]').click();
  await page.keyboard.press('Escape');
  await room.getByRole('button',{ name:'查看全部' }).click();
  await visibleQueue.waitFor();
  assert.deepEqual(await queueNames(),orderedIds.map(title));
  await queueRow(moveUp).locator('[data-queue-command="up"]').click();
  await queueRow(removeFromQueue).locator('[data-queue-command="remove"]').click();
  const edited = [first,unavailable,unrecognizedMedia,interrupted,moveUp,duplicate];
  await queueRow(removeFromQueue).waitFor({ state:'detached' });
  assert.deepEqual(await queueNames(),edited.map(title));
  const originalDuplicate = (await state()).queue.find(track => track.name === title(duplicate));
  await page.keyboard.press('Escape');
  await room.getByRole('button',{ name:'音乐库',exact:true }).click();
  const libraryTrack = room.locator('[data-sl-id]').filter({ hasText:title(duplicate) });
  await libraryTrack.locator('[data-sl-command="queue"]').click();
  await room.locator('[data-sl-command="queue-next"]').click();
  await room.locator('[data-sl-queue]').waitFor({ state:'hidden' });
  const withDuplicate = await state();
  assert.deepEqual(withDuplicate.queue.map(track => track.name),[...edited.slice(0,4),duplicate,...edited.slice(4)].map(title));
  const inserted = withDuplicate.queue[4];
  assert.notEqual(inserted.entryId,originalDuplicate.entryId);
  assert.equal(withDuplicate.track.name,title(interrupted));
  assert.equal(withDuplicate.playing,true);
  assert.deepEqual(network.edits,[]);
  await room.getByRole('button',{ name:'工作陪伴',exact:true }).click();
  console.log('PASS active queue supports moves, removal and duplicate insert-next without editing the source');

  await page.evaluate(() => document.querySelector('#audio').dispatchEvent(new Event('error')));
  await waitForPlaying(duplicate);
  assert.equal((await state()).queueEntryId,inserted.entryId);
  assert.ok(network.audioRequests.filter(id => id === interrupted).length <= 2);
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/api/qishui/tracks/${moveUp}/audio`) && response.ok()),
    page.evaluate(() => SonicPlayback.seek(18)),
  ]);
  assert.ok(!network.mediaRequests.includes(moveUp),'The next song should not request audio bytes before switching');
  await room.locator('[data-action="next"]').click();
  await waitForPlaying(moveUp);
  assert.equal(network.audioRequests.filter(id=>id===moveUp).length,1,'Switching should reuse the ticket');
  console.log('PASS an audio failure during playback continues with the edited queue order');
  console.log('PASS the next song prepares a single ticket without fetching audio before switching');

  await launchOnline();
  await openPlaylist(unavailablePlaylistId);
  await trackRow(allUnavailable.at(-1)).waitFor();
  await page.locator('#onlinePlayPlaylistBtn').click();
  await page.waitForFunction(lastTitle => {
    const state = SonicPlayback.snapshot();
    return state.track?.name === lastTitle && !state.busy && !state.playing;
  },title(allUnavailable.at(-1)));
  assert.deepEqual(network.audioRequests.filter(id => allUnavailable.includes(id)),allUnavailable);
  assert.deepEqual(errors,[]);
  console.log('PASS a fully unavailable playlist stops after one pass');
}

withinPlayer(verifyQueue).catch(error => { console.error(error); process.exitCode = 1; });
