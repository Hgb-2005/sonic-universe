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
const authOrder = ['9301', '9302', '9303'];
const [authStarter, authBlocked, authLater] = authOrder;
const crossProviderIds = ['9401', '9402'];
const [earlierMatch, latestMatch] = crossProviderIds;
const orderedIds = [first, unavailable, unrecognizedMedia, interrupted, removeFromQueue, duplicate, moveUp];
const playlistId = '9100';
const unavailablePlaylistId = '9200';
const authPlaylistId = '9300';
const title = id => `队列样例 ${id}`;
const crossAlbum = '跨平台验证专辑';

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
  const matchRequests = [];
  const loginRequests = [];
  const delayedMatch = Promise.withResolvers();
  const delayedMatchFinished = Promise.withResolvers();
  let authenticated = true, serviceInterrupted = false, upstreamOffline = false, pendingLogin = null;
  const shortWav = silentWav(1.2);
  const longWav = silentWav(25);
  const tracks = ids => ids.map(mediaId => ({
    provider: 'qishui', mediaId, name: title(mediaId), artist: '本机测试音源', duration: mediaId === first ? 1.2 : 25,
  }));
  const playlists = [
    { id:playlistId, name:'连续播放测试', trackCount:orderedIds.length },
    { id:unavailablePlaylistId, name:'不可播测试', trackCount:allUnavailable.length },
    { id:authPlaylistId, name:'登录过期测试', trackCount:authOrder.length },
  ];
  const user = { nickname:'本机测试账号' };
  const crossMatches = tracks(crossProviderIds).map(track => ({...track,album:crossAlbum}));
  const crossResults = crossMatches.map(track => ({...track,provider:'qq',mediaId:`QqFixture${track.mediaId}`}));

  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      return ['http:', 'https:'].includes(url.protocol) ? route.abort() : route.continue();
    }
    if (url.pathname === '/health') return route.fulfill({ json:{ ok:true, companion:true } });
    if (url.pathname === '/api/qishui/login-status') {
      return route.fulfill({ json:{ authenticated, user:authenticated ? user : null } });
    }
    if (url.pathname === '/api/qishui/login/start') {
      return route.fulfill({ json:{ sessionId:'fixture-session', qrImage:'/queue-smoke-qr.svg' } });
    }
    if (url.pathname === '/api/qishui/login/check') {
      loginRequests.push(request.postDataJSON());
      const confirm = () => {
        authenticated = true;
        return route.fulfill({ json:{ state:'confirmed', user } });
      };
      const pending = pendingLogin;
      pendingLogin = null;
      return pending?pending.gate.promise.then(confirm).then(pending.finished.resolve,pending.finished.reject):confirm();
    }
    if (url.pathname === '/queue-smoke-qr.svg') {
      return route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M0 0h32v32H0z"/></svg>' });
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
      if (playlist?.id === authPlaylistId && offset === 0) {
        return route.fulfill({ json:{ playlist, items:tracks(authOrder), hasMore:false } });
      }
      return route.fulfill({ status:404, json:{ error:'未预期的歌单分页' } });
    }
    if (url.pathname === '/api/qq/search') {
      return route.fulfill({ json:{ items:crossResults } });
    }
    if (url.pathname === '/api/discovery/charts/match') {
      const payload = request.postDataJSON();
      matchRequests.push(payload);
      const item = crossMatches.find(track => track.name === payload.name);
      if (!item) return route.fulfill({ status:404, json:{ error:'未预期的歌曲匹配' } });
      const result = { json:{ item, reason:'matched', candidates:[item] } };
      if (item.mediaId !== earlierMatch) return route.fulfill(result);
      return delayedMatch.promise.then(() => route.fulfill(result))
        .then(delayedMatchFinished.resolve, error => {
          if (request.failure()?.errorText === 'net::ERR_ABORTED') delayedMatchFinished.resolve();
          else delayedMatchFinished.reject(error);
        });
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
      if (!authenticated) return route.fulfill({ status:401, json:{ code:'auth-required', error:'登录已失效' } });
      if (upstreamOffline) return route.fulfill({ status:502, json:{ code:'network', error:'Qishui service could not be reached' } });
      if (serviceInterrupted && id === authLater) {
        return route.fulfill({ status:503, json:{ error:'音乐服务暂时不可用' } });
      }
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
  return { playlistReads, audioRequests, mediaRequests, edits, matchRequests, loginRequests,
    expireSession(){ authenticated = false; },
    setServiceInterrupted(value){ serviceInterrupted = value; },
    setUpstreamOffline(value){ upstreamOffline = value; },
    postponeAuthorization(){
      const pending = {gate:Promise.withResolvers(),finished:Promise.withResolvers()};
      pendingLogin = pending;
      return ()=>{pending.gate.resolve();return pending.finished.promise;};
    },
    releaseEarlierMatch(){
      delayedMatch.resolve();
      return delayedMatchFinished.promise;
    },
  };
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
  if (process.argv.includes('--packaged')) {
    await page.waitForURL(url => url.origin === origin);
    await page.reload();
  } else await page.goto(origin);
  await page.waitForFunction(() => window.SonicPlayback?.snapshot().ready);
  const room = page.locator('#listeningRoom');
  await page.evaluate(() => SonicPlayback.setVolume(0));
  const launchOnline = async () => {
    await room.getByRole('button',{name:'声波宇宙首页',exact:true}).click();
    await room.getByRole('button',{name:'打开汽水音乐库',exact:true}).click();
  };

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
  const recoveryPanel = room.locator('[data-playback-recovery]');
  const recoveryStatus = recoveryPanel.locator('[data-playback-recovery-status]');
  const retryPlayback = recoveryPanel.locator('[data-action="playback-retry"]');
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
  console.log('PASS a fully unavailable playlist stops after one pass');

  await openPlaylist(authPlaylistId);
  await trackRow(authLater).waitFor();
  await trackRow(authStarter).locator('[data-online-action="play"]').click();
  await waitForPlaying(authStarter);
  const beforeExpiry = await state();
  const originalEntries = beforeExpiry.queue.map(track => [track.entryId, track.name]);
  assert.deepEqual(originalEntries.map(([,name]) => name),authOrder.map(title));
  const blockedEntry = originalEntries[1][0];
  const firstAuthRequest = network.audioRequests.length;
  await page.keyboard.press('Escape');
  network.expireSession();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/api/qishui/tracks/${authBlocked}/audio`) && response.status()===401),
    room.locator('[data-action="next"]').click(),
  ]);
  try {
    await page.waitForFunction(expected => {
      const state = SonicPlayback.snapshot();
      return state.queueEntryId === expected && !state.playing && !state.busy && !state.onlineLoggedIn;
    },blockedEntry);
  } catch (error) {
    const {queueEntryId,playing,busy,onlineLoggedIn} = await state();
    const requests = network.audioRequests.slice(firstAuthRequest);
    throw new Error(`Expected expired session to pause on ${blockedEntry}: ${JSON.stringify({queueEntryId,playing,busy,onlineLoggedIn,requests})}`,{cause:error});
  }
  const pausedQueue = await state();
  assert.deepEqual(pausedQueue.queue.map(track => [track.entryId, track.name]),originalEntries);
  assert.deepEqual(network.audioRequests.slice(firstAuthRequest),[authBlocked]);
  assert.ok(!network.mediaRequests.includes(authBlocked) && !network.mediaRequests.includes(authLater));
  assert.equal(pausedQueue.playbackRecovery.name,title(authBlocked));
  await recoveryPanel.waitFor();
  assert.match(await recoveryStatus.textContent(),new RegExp(title(authBlocked)));
  assert.ok(!(await recoveryStatus.textContent()).includes(title(authStarter)));

  await page.reload();
  await page.waitForFunction(() => {
    const state = window.SonicPlayback?.snapshot();
    return state?.ready && state.queueRecovery?.reason === 'auth' && !state.playing;
  });
  const restoredQueue = await state();
  const restoredEntries = restoredQueue.queue.map(track => [track.entryId, track.name]);
  assert.deepEqual(restoredEntries.map(([,name]) => name),authOrder.map(title));
  const restoredBlockedEntry = restoredEntries[1][0];
  assert.equal(restoredQueue.queueEntryId,restoredBlockedEntry);
  assert.deepEqual(network.audioRequests.slice(firstAuthRequest),[authBlocked]);

  const finishStaleLogin = network.postponeAuthorization();
  const loginPoll = page.waitForRequest(request=>request.url().endsWith('/api/qishui/login/check'));
  await retryPlayback.focus();
  await retryPlayback.press('Enter');
  await page.locator('#onlineLoginCard').waitFor();
  await loginPoll;
  await page.locator('#onlineLoginCancelBtn').click();
  await page.locator('#queueDialog').waitFor({state:'hidden'});
  await finishStaleLogin();
  assert.equal((await state()).onlineLoggedIn,false);
  assert.equal((await state()).queueEntryId,restoredBlockedEntry);
  assert.deepEqual(network.audioRequests.slice(firstAuthRequest),[authBlocked]);
  await page.waitForFunction(()=>document.activeElement?.dataset.action==='playback-retry');
  network.expireSession();
  await retryPlayback.press('Enter');
  await waitForPlaying(authBlocked);
  await page.locator('#queueDialog').waitFor({state:'hidden'});
  await recoveryPanel.waitFor({state:'hidden'});
  assert.deepEqual(network.loginRequests,[{sessionId:'fixture-session'},{sessionId:'fixture-session'}]);
  const retriedQueue = await state();
  assert.equal(retriedQueue.queueEntryId,restoredBlockedEntry);
  assert.deepEqual(retriedQueue.queue.map(track => [track.entryId, track.name]),restoredEntries);
  assert.deepEqual(network.audioRequests.slice(firstAuthRequest),[authBlocked,authBlocked]);
  assert.ok(network.mediaRequests.includes(authBlocked));
  assert.ok(!network.mediaRequests.includes(authLater));
  console.log('PASS playback-bar QR recovery survives reload, ignores cancelled approval, and resumes from keyboard login');

  await room.locator('[data-action="previous"]').click();
  await waitForPlaying(authStarter);
  const upstreamRequestStart = network.audioRequests.length;
  network.setUpstreamOffline(true);
  await room.locator('[data-action="next"]').click();
  await page.waitForFunction(() => {
    const state = SonicPlayback.snapshot();
    return !state.busy && !state.playing && state.queueRecovery?.reason === 'connection';
  });
  assert.equal((await state()).queueEntryId,restoredBlockedEntry);
  assert.deepEqual((await state()).queue.map(track => [track.entryId,track.name]),restoredEntries);
  assert.deepEqual(network.audioRequests.slice(upstreamRequestStart),[authBlocked,authBlocked]);
  await room.locator('[data-action="home"]').click();
  const homeRetry=room.locator('.lr-home-card [data-home-resume]');
  await homeRetry.waitFor();
  assert.equal(await homeRetry.locator('[data-resume-title]').textContent(),title(authBlocked));
  assert.equal(await homeRetry.locator('[data-resume-source]').textContent(),'汽水音乐');
  assert.equal(await homeRetry.locator('[data-resume-label]').textContent(),'重试续听');
  network.setUpstreamOffline(false);
  await homeRetry.click();
  await waitForPlaying(authBlocked);
  assert.equal((await state()).queueEntryId,restoredBlockedEntry);
  assert.equal((await state()).queueRecovery,null);
  assert.deepEqual(network.audioRequests.slice(upstreamRequestStart),[authBlocked,authBlocked,authBlocked]);
  console.log('PASS the homepage retries the same Qishui track and keeps the queue after an upstream outage');

  network.setServiceInterrupted(true);
  await room.locator('[data-action="next"]').click();
  await page.waitForFunction(() => {
    const state = SonicPlayback.snapshot();
    return !state.busy && !state.playing && state.queueRecovery?.reason === 'connection';
  });
  const interruptedQueue = await state();
  assert.equal(interruptedQueue.queueEntryId,restoredEntries[2][0]);
  assert.deepEqual(interruptedQueue.queue.map(track => [track.entryId,track.name]),restoredEntries);
  await room.locator('[data-room-mode="listen"]').click();
  await retryPlayback.waitFor();
  assert.match(await recoveryStatus.textContent(),new RegExp(title(authLater)));
  network.setServiceInterrupted(false);
  await retryPlayback.click();
  await waitForPlaying(authLater);
  assert.equal((await state()).queueRecovery,null);
  await recoveryPanel.waitFor({state:'hidden'});
  console.log('PASS the now-playing bar retries temporary service failure on its held queue entry');

  async function exerciseStall(id) {
    await page.evaluate(()=>SonicPlayback.seek(4));
    await page.waitForFunction(()=>{
      const media=document.querySelector('#audio');
      return !document.hidden&&!media.seeking&&!media.paused&&SonicPlayback.snapshot().position>=4;
    });
    const before = await state();
    const retryOffset = network.audioRequests.length;
    const streamRetry = page.waitForResponse(response=>response.url().endsWith(`/api/qishui/tracks/${id}/audio`)&&response.ok(),{timeout:15000});
    const stalledAt = await page.evaluate(()=>{
      const media=document.querySelector('#audio'),position=media.currentTime;
      const nativeTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
      Object.defineProperties(media,{
        currentTime:{configurable:true,get:()=>position,set:value=>nativeTime.set.call(media,value)},
        readyState:{configurable:true,get:()=>HTMLMediaElement.HAVE_CURRENT_DATA},
      });
      media.dispatchEvent(new Event('waiting'));
      return position;
    });
    try {
      await page.waitForFunction(()=>SonicPlayback.snapshot().buffering);
      await streamRetry;
    } finally {
      await page.evaluate(()=>{
        const media=document.querySelector('#audio');
        delete media.currentTime;delete media.readyState;
      });
    }
    await waitForPlaying(id);
    const after = await state();
    assert.deepEqual(network.audioRequests.slice(retryOffset),[id]);
    assert.ok(Math.abs(after.position-stalledAt)<1);
    assert.equal(after.buffering,false);
    return {before,after};
  }
  const {before:beforeStall,after:afterStall} = await exerciseStall(authLater);
  assert.equal(afterStall.queueEntryId,beforeStall.queueEntryId);
  assert.deepEqual(afterStall.queue.map(track=>track.entryId),beforeStall.queue.map(track=>track.entryId));
  console.log('PASS a stalled media clock reopens the same stream at its last position and preserves the queue');

  await launchOnline();
  await page.locator('[data-online-provider="qq"]').click();
  await page.locator('#onlineSearchInput').fill('匹配竞态测试');
  await page.locator('#onlineSearchBtn').click();
  const earlierButton = trackRow(earlierMatch).locator('[data-online-action="match-qishui"]');
  const latestButton = trackRow(latestMatch).locator('[data-online-action="match-qishui"]');
  await Promise.all([
    page.waitForRequest(request => new URL(request.url()).pathname==='/api/discovery/charts/match' &&
      request.postDataJSON()?.name===title(earlierMatch)),
    earlierButton.click(),
  ]);
  try {
    await latestButton.click();
    await waitForPlaying(latestMatch);
  } finally {
    await network.releaseEarlierMatch();
  }
  await page.waitForFunction(expected => {
    const row = [...document.querySelectorAll('#onlineResults .online-result')].find(item=>item.textContent.includes(expected));
    return row?.querySelector('[data-online-action="match-qishui"]')?.getAttribute('aria-busy')!=='true';
  },title(earlierMatch));
  const finalSelection = await state();
  assert.equal(finalSelection.track.name,title(latestMatch));
  assert.equal(finalSelection.playing,true);
  assert.ok(!network.audioRequests.includes(earlierMatch) && !network.mediaRequests.includes(earlierMatch));
  assert.deepEqual(network.matchRequests,crossProviderIds.map(id=>({
    name:title(id),artist:'本机测试音源',duration:25,album:crossAlbum,includeCandidates:true,
  })));
  console.log('PASS a late cross-provider match cannot replace the latest selection');
  await page.keyboard.press('Escape');
  await page.locator('#queueDialog').waitFor({state:'hidden'});
  await page.evaluate(id=>SonicPlayback.select('online:qishui:'+id),authLater);
  await waitForPlaying(authLater);
  const direct = await exerciseStall(authLater);
  assert.equal(direct.before.customQueue,false);
  assert.equal(direct.after.customQueue,false);
  console.log('PASS direct library playback reconnects to the same recording without creating a queue');

  network.expireSession();
  await page.evaluate(()=>{
    const media=document.querySelector('#audio');
    Object.defineProperty(media,'error',{configurable:true,value:{code:2}});
    media.dispatchEvent(new Event('error'));
    delete media.error;
  });
  await recoveryPanel.waitFor();
  await retryPlayback.click();
  await page.waitForFunction(()=>SonicPlayback.snapshot().playbackRecovery?.reason==='auth');
  const standalone = await state();
  assert.equal(standalone.customQueue,false);
  assert.equal(standalone.playbackRecovery.name,title(authLater));
  assert.ok(Math.abs(standalone.playbackRecovery.position-direct.after.position)<1);

  const finishLateAuthorization = network.postponeAuthorization();
  const latePoll = page.waitForRequest(request=>request.url().endsWith('/api/qishui/login/check'));
  await retryPlayback.click();
  await latePoll;
  const oldAudioRequests=network.audioRequests.length;
  await page.evaluate(()=>SonicPlayback.select('demo'));
  await page.waitForFunction(()=>SonicPlayback.snapshot().track?.kind==='demo'&&SonicPlayback.snapshot().playing);
  await finishLateAuthorization();
  await page.waitForFunction(()=>SonicPlayback.snapshot().onlineLoggedIn);
  assert.deepEqual(network.audioRequests.slice(oldAudioRequests),[]);
  assert.equal((await state()).track.id,'demo');
  await recoveryPanel.waitFor({state:'hidden'});
  await page.keyboard.press('Escape');
  console.log('PASS standalone recovery retains its position but late QR approval cannot replace a newer song');

  await page.evaluate(id=>SonicPlayback.select('online:qishui:'+id),authLater);
  await waitForPlaying(authLater);
  await page.evaluate(()=>SonicPlayback.seek(4));
  await page.waitForFunction(()=>SonicPlayback.snapshot().position>=4);
  const chart = { mediaId:'late-audio-fixture', name:title('9501'), artist:'本机测试音源', duration:25 };
  const recording = { ...chart, provider:'qishui', mediaId:'9501' };
  const matchUrl = origin+'/api/discovery/charts/match';
  const releaseMatch = Promise.withResolvers();
  let matchCount = 0;
  const provideMatch = async route => {
    matchCount++;
    if(matchCount===1)await releaseMatch.promise;
    try { await route.fulfill({json:{item:recording}}); }
    catch(error) {
      if(route.request().failure()?.errorText!=='net::ERR_ABORTED')throw error;
    }
  };
  await page.route(matchUrl,provideMatch);
  const requestedMatch = page.waitForRequest(matchUrl);
  const selectChart = page.evaluate(track=>SonicPlayback.playChartList([track],'切歌时音源断流'),chart);
  try {
    await requestedMatch;
    await page.evaluate(()=>{
      const media=document.querySelector('#audio');
      Object.defineProperty(media,'error',{configurable:true,value:{code:2}});
      media.dispatchEvent(new Event('error'));
      delete media.error;
    });
    releaseMatch.resolve();
    assert.equal(await selectChart,true,'A stale media error must not cancel an active chart selection');
    await waitForPlaying(recording.mediaId);
    assert.equal(matchCount,1);
    assert.ok((await state()).position<1,'The new song must not inherit the old song position');
  } finally {
    releaseMatch.resolve();
    await page.unroute(matchUrl,provideMatch);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS a late error from the old audio does not restart or seek a pending chart selection');
}

withinPlayer(verifyQueue).catch(error => { console.error(error); process.exitCode = 1; });
