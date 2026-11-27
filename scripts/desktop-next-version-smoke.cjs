'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const searchEditionCases = require('../tests/fixtures/search-editions.cjs');

const repo = path.resolve(__dirname, '..');
const binary = process.env.SONIC_DESKTOP_EXECUTABLE;
const evidence = process.env.SONIC_QA_OUTPUT;
const baseline = process.argv.includes('--baseline');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = page => page.evaluate(() => SonicPlayback.snapshot({queue:true}));
const dock = page => page.locator('#listeningRoom > .lr-player-wrap');
const resumeButton = page => page.locator('[data-home-resume]');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const {port} = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function desktop(profile, port, prepare) {
  const app = await _electron.launch({
    executablePath: binary ? path.resolve(binary) : require('electron'),
    args: [...(binary ? [] : [repo]), '--mute-audio'],
    cwd: repo,
    timeout: 30000,
    env: {...process.env, SONIC_DESKTOP_PROFILE:profile, SONIC_DESKTOP_PORT:String(port)}
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const origin = 'http://127.0.0.1:' + port;
    await page.waitForURL(url => url.origin === origin);
    if (prepare) {
      await prepare(page, origin);
      await page.reload({waitUntil:'domcontentloaded'});
    }
    await page.waitForFunction(() => window.SonicPlayback?.snapshot().ready);
    return {app,page};
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
}

async function quit(client) {
  const exited = once(client.app.process(), 'exit', {signal:AbortSignal.timeout(12000)});
  await client.app.evaluate(({app}) => { setTimeout(() => app.quit(), 0); });
  assert.deepEqual(await exited, [0,null]);
}

async function capture(page, name) {
  if (evidence) {
    await fs.mkdir(evidence, {recursive:true});
    await page.screenshot({path:path.join(evidence, name + '.png')});
  }
}

async function checkPlaying(page, id, start) {
  await page.waitForFunction(({id,start}) => {
    const state = SonicPlayback.snapshot();
    return state.track?.id === id && state.playing && state.position >= start;
  }, {id,start});
  const before = (await snapshot(page)).position;
  await page.waitForFunction(position => SonicPlayback.position() > position + .25, before);
  return snapshot(page);
}

async function launchNavidrome(directory, port, password) {
  const executable = process.env.SONIC_NAVIDROME_TEST_EXE;
  if (!executable) throw new Error('Set SONIC_NAVIDROME_TEST_EXE to the official portable Navidrome EXE.');
  const songs = path.join(directory, 'music');
  const data = path.join(directory, 'data');
  await Promise.all([fs.mkdir(songs), fs.mkdir(data)]);
  for (const [index, title] of ['续播验收一号', '续播验收二号'].entries()) {
    const target = path.join(songs, index + '.mp3');
    const result = spawnSync('ffmpeg', [
      '-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=' + (420 + index * 100) + ':duration=32',
      '-metadata','title=' + title,'-metadata','artist=本机验收','-metadata','album=续播验收专辑',
      '-metadata','track=' + (index + 1),'-codec:a','libmp3lame',target
    ], {windowsHide:true});
    if (result.error || result.status) throw result.error || new Error(result.stderr.toString());
    await fs.writeFile(path.join(songs, index + '.lrc'),
      '[00:00.00]验收歌词第一句\n[00:07.00]验收歌词第二句\n[00:14.00]验收歌词第三句\n[00:23.00]验收歌词第四句');
  }
  const address = 'http://127.0.0.1:' + port;
  const logs = [];
  function start() {
    const child = spawn(executable, [], {cwd:directory, windowsHide:true, stdio:['ignore','ignore','pipe'],
      env:{...process.env, ND_MUSICFOLDER:songs, ND_DATAFOLDER:data, ND_ADDRESS:'127.0.0.1', ND_PORT:String(port),
        ND_LOGLEVEL:'warn', ND_ENABLEINSIGHTSCOLLECTOR:'false', ND_DEVAUTOCREATEADMINPASSWORD:password}});
    child.stderr.on('data', bytes => { logs.push(bytes.toString()); if (logs.length > 10) logs.shift(); });
    return child;
  }
  let child = start();
  async function albumsReady() {
    const salt = randomBytes(12).toString('hex');
    const token = createHash('md5').update(password + salt).digest('hex');
    const query = new URLSearchParams({u:'admin',t:token,s:salt,f:'json',v:'1.16.1',c:'SonicUniverse-QA',type:'alphabeticalByArtist'});
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await fetch(address + '/rest/getAlbumList2.view?' + query,
        {signal:AbortSignal.timeout(1200)}).then(result => result.json()).catch(() => null);
      if (response?.['subsonic-response']?.albumList2?.album?.length) return;
      await wait(400);
    }
    throw new Error('Navidrome test server did not start or scan its test album. ' + logs.join('').replaceAll(password, '[hidden]'));
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit', {signal:AbortSignal.timeout(5000)});
    child.kill();
    await exited;
  }
  try { await albumsReady(); }
  catch (error) { await stop(); throw error; }
  return {address, stop, async restart(){ child = start(); await albumsReady(); }};
}

async function testResume(directory) {
  const password = randomBytes(20).toString('hex');
  const server = await launchNavidrome(directory, await freePort(), password);
  const port = await freePort();
  const profile = path.join(directory, 'profile');
  let client, qishuiAccepted = true, qishuiLogin = 0;
  const qishuiTrack = {provider:'qishui',mediaId:'78235123',name:'汽水验收曲目',artist:'本机验收',duration:32};
  const audio = await fs.readFile(path.join(directory, 'music', '0.mp3'));
  const connect = async dialog => {
    await dialog.getByLabel('服务器地址').fill(server.address);
    await dialog.getByLabel('用户名').fill('admin');
    await dialog.getByLabel('密码').fill(password);
    await dialog.getByRole('button',{name:'连接',exact:true}).click();
    return dialog.getByRole('button',{name:'续播验收专辑 · 本机验收',exact:true});
  };
  const open = async () => {
    client = await desktop(profile, port, async (page, origin) => {
      await page.route(origin + '/api/qishui/**', route => {
        const action = new URL(route.request().url()).pathname;
        if (action === '/api/qishui/login-status') return route.fulfill({json:{authenticated:qishuiAccepted,user:{nickname:'QA'}}});
        if (action === '/api/qishui/search') return route.fulfill({json:{items:[qishuiTrack]}});
        if (action === '/api/qishui/tracks/78235123/audio') {
          if (!qishuiAccepted) return route.fulfill({status:401,json:{code:'auth-required',error:'Fixture login expired'}});
          return route.fulfill({json:{streamPath:'/media/next-version-qishui'}});
        }
        if (action === '/api/qishui/login/start') {
          qishuiLogin++;
          return route.fulfill({json:{sessionId:'fixture',qrImage:'/assets/sonic-icon.png'}});
        }
        if (action === '/api/qishui/login/check') return route.fulfill({json:{state:'waiting'}});
        return route.fulfill({status:404,json:{error:'Fixture endpoint unavailable'}});
      });
      await page.route(origin + '/media/next-version-qishui', route => route.fulfill({
        contentType:'audio/mpeg', headers:{'Accept-Ranges':'bytes'},body:audio
      }));
    });
    await client.page.waitForFunction(accepted => SonicPlayback.snapshot().onlineLoggedIn === accepted, qishuiAccepted);
    return client.page;
  };
  const openLibrary = async page => {
    await page.getByRole('button',{name:'声波宇宙首页'}).click();
    await page.getByRole('button',{name:'Navidrome 曲库',exact:true}).click();
    return page.getByRole('dialog',{name:'Navidrome 曲库'});
  };
  try {
    let page = await open();
    let dialog = await openLibrary(page);
    await (await connect(dialog)).click();
    await dialog.getByRole('button',{name:'续播验收一号 · 本机验收',exact:true}).click();
    await page.waitForFunction(() => SonicPlayback.snapshot().track?.provider === 'navidrome' && SonicPlayback.position() > .5);
    const state = await snapshot(page);
    const ids = state.queue.map(item => item.id);
    assert.equal(ids.length, 2);
    await dock(page).locator('[data-seek]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => SonicPlayback.position() > 9);
    await dock(page).locator('[data-action=play]').click();
    await page.waitForFunction(() => !SonicPlayback.snapshot().playing);
    const saved = (await snapshot(page)).position;

    dialog = await openLibrary(page);
    await dialog.getByRole('button',{name:'断开',exact:true}).click();
    await dialog.getByLabel('服务器地址').waitFor();
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    await quit(client);
    client = null;

    page = await open();
    assert.match(await resumeButton(page).innerText(), /Navidrome/);
    await resumeButton(page).click();
    await page.locator('[data-resume-status]').waitFor();
    const failure = await page.locator('[data-resume-status]').innerText();
    console.log('01 ' + (baseline ? '改前' : '验收') + ' · ' + failure + ' · ' + (await resumeButton(page).locator('[data-resume-label]').innerText()));
    const pending = await snapshot(page);
    assert.ok(Math.abs(pending.position - saved) < .5, JSON.stringify({saved,position:pending.position}));
    assert.deepEqual(pending.queue.map(item => item.id), ids);
    if (baseline) {
      assert.match(failure, /汽水登录/);
      assert.equal(pending.onlineLoggedIn, false);
      await capture(page, '01-baseline');
      console.log('01 改前复现 · 真实 Navidrome 断开后首页错误清空汽水已登录状态，进度 ' + saved.toFixed(2) + ' 秒，队列两首。');
      return;
    }

    assert.match(failure, /请连接 Navidrome/);
    assert.equal(pending.onlineLoggedIn, true);
    await capture(page, '01-navidrome-reconnect');
    await resumeButton(page).click();
    dialog = page.getByRole('dialog',{name:'Navidrome 曲库'});
    await dialog.getByLabel('服务器地址').waitFor();
    await (await connect(dialog)).waitFor();
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();

    await server.stop();
    await resumeButton(page).click();
    await page.locator('[data-resume-status]').filter({hasText:'检查 Navidrome 服务器'}).waitFor();
    assert.ok(Math.abs((await snapshot(page)).position - saved) < .5);
    await capture(page, '01-navidrome-offline');
    assert.equal((await snapshot(page)).onlineLoggedIn, true);
    await server.restart();
    await resumeButton(page).click();
    const resumed = await checkPlaying(page, state.track.id, saved - .2);
    assert.ok(resumed.position < saved + 2);
    assert.deepEqual(resumed.queue.map(item => item.id), ids);
    await page.waitForFunction(() => SonicPlayback.snapshot().lyrics.some(line => line.text === '验收歌词第二句'));
    await page.locator('[data-small-line]').filter({hasText:'验收歌词第三句'}).waitFor();
    await dock(page).locator('[data-action=play]').click();
    assert.equal(qishuiLogin, 0);
    console.log('01 通过 · 真实 Navidrome 重新连接，停服务器出现检查提示，重开后从 ' + resumed.position.toFixed(2) + ' 秒接播，原队列和同步歌词齐全，汽水会话保留。');

    const localFiles = [1,0].map(index => path.join(directory, 'music', index + '.mp3'));
    await page.locator('#fileInput').setInputFiles(localFiles);
    await page.waitForFunction(() => SonicPlayback.library().tracks.filter(track => track.kind === 'file').length === 2
      && !SonicPlayback.library().importing);
    const localIds = await page.evaluate(() => ['续播验收二号','续播验收一号']
      .map(name => SonicPlayback.library().tracks.find(track => track.kind === 'file' && track.name === name).id));
    const localId = localIds[0];
    await page.evaluate(ids => SonicPlayback.playFromLibrary(ids[0], 'local', true, ids), localIds);
    await checkPlaying(page, localId, .1);
    await page.evaluate(() => SonicPlayback.toggle());
    await resumeButton(page).click();
    await checkPlaying(page, localId, .2);
    console.log('01 通过 · 本地曲目暂停后从首页续播。');

    await dock(page).locator('[data-seek]').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => SonicPlayback.position() > 5);
    await dock(page).getByRole('button',{name:'暂停音乐'}).click();
    const beforeMissing = await snapshot(page);
    await page.evaluate(id => new Promise((resolve, reject) => {
      const request = indexedDB.open('sonic-universe-library');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction('media','readwrite');
        transaction.objectStore('media').delete(id);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
    }), localId);
    await quit(client);
    client = null;
    page = await open();
    await resumeButton(page).getByText('重新定位音乐',{exact:true}).waitFor();
    await page.locator('[data-resume-skip]').waitFor();
    await capture(page, '01-local-missing');
    const choosing = page.waitForEvent('filechooser');
    await resumeButton(page).click();
    await (await choosing).setFiles(localFiles[0]);
    const relocated = await checkPlaying(page, localId, beforeMissing.position - .2);
    assert.ok(relocated.position < beforeMissing.position + 2);
    assert.deepEqual(relocated.queue.map(item => item.id), localIds);
    console.log('01 通过 · 删掉独立配置里的音频副本后，重新选择原文件，从 ' + relocated.position.toFixed(2) + ' 秒接播，曲目和队列编号原样保留。');

    const qishuiId = 'online:qishui:' + qishuiTrack.mediaId;
    await page.evaluate(track => SonicPlayback.playOnlineList([track], '汽水验收队列', track.mediaId), qishuiTrack);
    await checkPlaying(page, qishuiId, .1);
    await page.evaluate(() => SonicPlayback.toggle());
    await quit(client);
    client = null;
    page = await open();
    qishuiAccepted = false;
    await resumeButton(page).click();
    await page.locator('[data-resume-status]').filter({hasText:'汽水登录已失效'}).waitFor();
    assert.equal((await snapshot(page)).onlineLoggedIn, false);
    await resumeButton(page).click();
    await page.locator('#onlineLoginCard').waitFor();
    await page.locator('#onlineQrImage').waitFor();
    assert.ok(qishuiLogin > 0, 'expired Qishui must request its own login');
    console.log('01 通过 · 汽水测试会话可播放，模拟自己过期后出现汽水提示与登录入口。');
  } finally {
    await client?.app.close().catch(() => {});
    await server.stop();
  }
}

async function testFirstRun(directory) {
  const sample = 'demo-auld-lang-syne';
  const home = page => page.getByRole('button', {name:'声波宇宙首页'});
  const testPass = async offline => {
    const profile = path.join(directory, offline ? 'offline' : 'new');
    const port = await freePort();
    const prepare = async (page, origin) => {
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return offline && /^https?:$/.test(url.protocol) ? route.abort() : route.continue();
        if (url.pathname.startsWith('/api/')) {
          if (offline) return route.abort('internetdisconnected');
          if (url.pathname === '/api/qishui/login-status') return route.fulfill({json:{authenticated:false}});
          return route.fulfill({json:{items:[]}});
        }
        return route.continue();
      });
    };
    let client = await desktop(profile, port, prepare);
    let {page} = client;
    try {
      await page.waitForFunction(() => !SonicPlayback.snapshot().onlineLoggedIn);
      assert.equal((await snapshot(page)).playing, false);
      const card = page.locator('.lr-home-card');
      const start = card.getByRole('button', {name:baseline ? '播放内置示例' : '听一首',exact:true});
      await start.waitFor();
      await card.getByRole('button', {name:'导入音乐',exact:true}).waitFor();
      assert.ok(await start.evaluate(button => {
        const rect = button.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      }));
      await capture(page, baseline ? '06-baseline' : offline ? '06-offline-home' : '06-first-open');
      await start.click();
      const started = await checkPlaying(page, sample, .1);
      assert.equal(started.track.name, '友谊地久天长');
      assert.ok(started.lyrics.length >= 3);
      assert.equal(await page.locator('#app').getAttribute('data-demo-audio'), 'asset');
      await page.locator('[data-work-caption][data-has-line=true]').waitFor();
      const firstLine = await page.locator('[data-small-line]').textContent();
      assert.ok(started.lyrics.some(line => line.text === firstLine));
      const stage = baseline ? page.locator('[data-room-mode=visual]') : card.getByRole('button',{name:'进入视觉舞台',exact:true});
      if (!baseline) {
        assert.ok(started.track.cover);
        await card.locator('img[data-art-cover]').waitFor();
        assert.equal(await page.locator('dialog[open]').count(), 0);
      }
      const toStage = (await snapshot(page)).position;
      await stage.click();
      await page.locator('#listeningRoom[data-mode=visual]').waitFor();
      const onStage = await checkPlaying(page, sample, toStage - .05);
      assert.ok(onStage.position < toStage + 2);
      assert.deepEqual(onStage.lyrics, started.lyrics);
      await page.locator('[data-scene-lyric]').waitFor();
      await page.waitForFunction(old => {
        const text = document.querySelector('[data-scene-line]').textContent;
        return text && text !== old && SonicPlayback.snapshot().lyrics.some(line => line.text === text);
      }, firstLine, {timeout:16000});
      if (!baseline) assert.equal(await page.locator('#listeningRoom').getAttribute('data-active-scene'), 'prism-bloom');
      await capture(page, baseline ? '06-baseline-stage' : offline ? '06-offline-stage' : '06-sample-stage');
      await page.mouse.move(30, 120);
      await page.locator('#listeningRoom[data-stage-chrome=true]').waitFor();
      await home(page).click();
      const pause = dock(page).getByRole('button', {name:'暂停音乐'});
      await pause.click();
      await page.waitForFunction(() => !SonicPlayback.snapshot().playing);
      const checkpoint = await snapshot(page);
      await wait(300);
      assert.ok(Math.abs((await snapshot(page)).position - checkpoint.position) < .1);
      assert.equal(checkpoint.track.id, sample);
      console.log('06 ' + (baseline ? '改前' : '通过') + ' · ' + (offline ? '在线接口不可用' : '新配置、来源未登录') +
        ' · 首页「' + (baseline ? '播放内置示例' : '听一首') + '」1 次点击开播，' +
        (baseline ? '从顶部导航' : '从首页卡片') + '再点 1 次进舞台，保持同一首和同步歌词。');
      if (baseline || offline) return;

      await quit(client);
      client = null;
      client = await desktop(profile, port, prepare);
      page = client.page;
      await resumeButton(page).getByText('继续听',{exact:true}).waitFor();
      assert.equal(await page.locator('[data-home-resume] [data-resume-title]').textContent(), started.track.name);
      assert.equal(await page.locator('[data-action=demo-play]').isVisible(), false);
      assert.equal(await page.evaluate(() => SonicPlayback.resumeInfo().cover), started.track.cover);
      await capture(page, '06-returning-home');
      await resumeButton(page).click();
      const resumed = await checkPlaying(page, sample, checkpoint.position - .15);
      assert.ok(resumed.position < checkpoint.position + 1.5);
      assert.deepEqual(resumed.queue.map(item => item.id), checkpoint.queue.map(item => item.id));
      console.log('06 通过 · 关闭窗口再启动，首页优先「继续听」，从 ' + resumed.position.toFixed(2) + ' 秒接上原曲和队列。');
    } finally {
      await client?.app.close().catch(() => {});
    }
  };
  await testPass(false);
  if (!baseline) await testPass(true);
}

function testTone(seconds, frequency) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
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
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let index = 0; index < samples; index++) {
    wav.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * frequency / sampleRate) * 1300), 44 + index * 2);
  }
  return wav;
}

async function seedLocalFileRecovery(page) {
  const names = ['重定位验收原曲', '队列测试前曲', '队列测试后曲'];
  const lyric = '原曲手写同步歌词';
  const tones = names.map((name,index) => ({
    name:name+'.wav', mimeType:'audio/wav', buffer:testTone(32, 440 + index * 110),
  }));
  await page.locator('#fileInput').setInputFiles(tones);
  await page.waitForFunction(names => !SonicPlayback.library().importing
    && names.every(name => SonicPlayback.library().tracks.some(track => track.name === name)), names);
  const data = await page.evaluate(async ({names,lyric}) => {
    const ids = names.map(name => SonicPlayback.library().tracks.find(track => track.name === name).id);
    const [original,before,after] = ids;
    const draft = await SonicPlayback.localTrackDetails(original);
    const saved = await SonicPlayback.saveLocalTrackDetails(original,{...draft,lyricsIntent:'manual',lyricsRaw:'[00:00.00]'+lyric});
    if (!saved) throw new Error('Fixture lyric could not be saved');
    const orders = [[before,original,after],[original,after,before],[original]];
    const lists = [];
    for (const [index,order] of orders.entries()) {
      const list = SonicPlayback.savePlaylist('重定位验收歌单 '+(index+1));
      const result = await SonicPlayback.editPlaylistMembership(list,order,true);
      if (!result.saved) throw new Error('Fixture playlist could not be saved');
      lists.push(list);
    }
    await SonicPlayback.playFromLibrary(original,lists[0],true,orders[0]);
    return {original,lists,orders};
  },{names,lyric});
  await checkPlaying(page,data.original,.1);
  await page.evaluate(() => SonicPlayback.seek(5.5));
  await dock(page).getByRole('button',{name:'暂停音乐'}).click();
  const held = await snapshot(page);
  assert.equal(held.playing,false);
  assert.ok(held.position >= 5.4 && held.position < 6.2);
  assert.deepEqual(held.queue.map(track => track.id),data.orders[0]);
  return {...data,title:names[0],lyric,file:tones[0],position:held.position,queue:held.queue.map(track => track.id)};
}

const playlistOrders = (page,lists) => page.evaluate(lists => {
  const library = SonicPlayback.library();
  return lists.map(id => library.playlists.find(playlist => playlist.id === id)?.trackIds);
},lists);

async function removeFixtureAudio(page,id) {
  await page.evaluate(id => new Promise((resolve,reject) => {
    const request = indexedDB.open('sonic-universe-library');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('media','readwrite');
      transaction.objectStore('media').delete(id);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }),id);
}

async function chooseRecoveryFile(page,file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'),resumeButton(page).click()]);
  await chooser.setFiles(file);
}

async function testLocalFilePlaylists(directory) {
  const profile = path.join(directory,'profile'), port = await freePort();
  let client = await desktop(profile,port);
  const reopen = async () => {
    await quit(client);
    client = null;
    client = await desktop(profile,port);
    return client.page;
  };
  try {
    let page = client.page;
    const fixture = await seedLocalFileRecovery(page);
    await removeFixtureAudio(page,fixture.original);
    page = await reopen();
    await resumeButton(page).getByText('重新定位音乐',{exact:true}).waitFor();
    const missing = await playlistOrders(page,fixture.lists);
    if (baseline) {
      assert.deepEqual(missing,fixture.orders.map(order => order.filter(id => id !== fixture.original)));
    } else {
      assert.deepEqual(missing,fixture.orders);
      const removed = await page.evaluate(({list,id}) => SonicPlayback.editPlaylistMembership(list,[id],false),
        {list:fixture.lists[2],id:fixture.original});
      assert.deepEqual(removed,{saved:true,changed:1});
      page = await reopen();
      assert.deepEqual(await playlistOrders(page,fixture.lists),[...fixture.orders.slice(0,2),[]]);
    }
    await chooseRecoveryFile(page,fixture.file);
    const resumed = await checkPlaying(page,fixture.original,fixture.position-.2);
    assert.ok(resumed.position < fixture.position+2);
    assert.deepEqual(resumed.queue.map(track => track.id),fixture.queue);
    assert.equal(resumed.lyrics[0]?.text,fixture.lyric);
    if (baseline) {
      assert.deepEqual(await playlistOrders(page,fixture.lists),missing);
      console.log('改前复现 · 正确文件原位接播，两个歌单各少原曲一首，第三个歌单从 1 首变成 0 首。');
      return;
    }
    assert.deepEqual(await playlistOrders(page,fixture.lists),[...fixture.orders.slice(0,2),[]]);
    await dock(page).getByRole('button',{name:'暂停音乐'}).click();
    page = await reopen();
    assert.deepEqual(await playlistOrders(page,fixture.lists),[...fixture.orders.slice(0,2),[]]);
    await page.getByRole('button',{name:'音乐库',exact:true}).click();
    await page.locator('[data-sl-view="'+fixture.lists[0]+'"]').click();
    const row = page.locator('[data-sl-id="'+fixture.original+'"]');
    assert.equal(await row.count(),1);
    await row.locator('[data-sl-command=play]').click();
    await checkPlaying(page,fixture.original,.1);
    await capture(page,'file-playlists-restored');
    console.log('通过 · 缺失时保留两个歌单的位置，主动移除的第三个歌单仍为空。选回原文件约 '+resumed.position.toFixed(2)+' 秒续播，再重启从歌单点播成功，原曲只出现一次。');
  } finally {
    await client?.app.close().catch(() => {});
  }
}

async function localFileRecord(page,id,forgetDigest=false) {
  return page.evaluate(({id,forgetDigest}) => new Promise((resolve,reject) => {
    const request = indexedDB.open('sonic-universe-library');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['state','media'],forgetDigest?'readwrite':'readonly');
      const state = transaction.objectStore('state');
      const library = state.get('library'), atelier = state.get('atelier');
      const audio = transaction.objectStore('media').get(id);
      if (forgetDigest) {
        library.onsuccess = () => {
          delete library.result.tracks.find(track => track.id === id).audioDigest;
          state.put(library.result,'library');
        };
      }
      transaction.onabort = () => { database.close(); reject(transaction.error); };
      transaction.oncomplete = async () => {
        database.close();
        try {
          const mediaHash = audio.result ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
            await audio.result.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('') : null;
          resolve({
            metadata:library.result.tracks.find(track => track.id === id),
            playlists:library.result.playlists,
            lyric:atelier.result.songs[id].lyrics.raw,
            mediaHash,
          });
        } catch (error) { reject(error); }
      };
    };
  }),{id,forgetDigest});
}

async function testLocalFileSafety(directory) {
  const profile = path.join(directory,'profile'), port = await freePort();
  let client = await desktop(profile,port);
  const reopen = async () => {
    await quit(client);
    client = null;
    client = await desktop(profile,port);
    const page = client.page;
    await resumeButton(page).getByText('重新定位音乐',{exact:true}).waitFor();
    return page;
  };
  try {
    let page = client.page;
    const fixture = await seedLocalFileRecovery(page);
    const wrong = {name:'不同的 32 秒录音.wav',mimeType:'audio/wav',buffer:testTone(32,880)};
    assert.equal(wrong.buffer.length,fixture.file.buffer.length);
    const wrongHash = createHash('sha256').update(wrong.buffer).digest('hex');
    const correctHash = createHash('sha256').update(fixture.file.buffer).digest('hex');
    assert.notEqual(wrongHash,correctHash);
    const original = await localFileRecord(page,fixture.original);
    assert.equal(original.mediaHash,correctHash);
    await removeFixtureAudio(page,fixture.original);
    page = await reopen();
    await chooseRecoveryFile(page,wrong);
    if (baseline) {
      await checkPlaying(page,fixture.original,fixture.position-.2);
      const replaced = await localFileRecord(page,fixture.original);
      assert.equal(replaced.mediaHash,wrongHash);
      assert.equal(replaced.metadata.name,fixture.title);
      console.log('改前复现 · 两份 WAV 均为 32 秒，选错后直接用原歌名播错音频，数据库里的原曲音频也被替换。');
      return;
    }
    assert.match(original.metadata.audioDigest || '',/^[a-f0-9]{64}$/);
    const warning = () => page.locator('.lr-toasts');
    const comparison = () => page.getByRole('dialog',{name:'核对音频文件'});
    const checkHeld = async expected => {
      const held = await snapshot(page);
      assert.equal(held.playing,false);
      assert.equal(held.track.id,fixture.original);
      assert.equal(held.track.name,fixture.title);
      assert.ok(Math.abs(held.position-fixture.position)<.3);
      assert.deepEqual(held.queue.map(track => track.id),fixture.queue);
      assert.deepEqual(await playlistOrders(page,fixture.lists),fixture.orders);
      assert.deepEqual(await localFileRecord(page,fixture.original),expected);
    };
    await warning().filter({hasText:'所选文件与原文件不一致'}).waitFor();
    assert.equal(await comparison().isVisible(),false);
    await checkHeld({...original,mediaHash:null});
    console.log('通过 · 发现已知原文件和所选的 32 秒音频内容不同，明确拒绝，原记录未写入错文件。');

    await localFileRecord(page,fixture.original,true);
    const legacy = {...original,metadata:{...original.metadata},mediaHash:null};
    delete legacy.metadata.audioDigest;
    page = await reopen();
    await chooseRecoveryFile(page,{name:'损坏.wav',mimeType:'audio/wav',buffer:Buffer.from('not a playable WAV')});
    await warning().filter({hasText:/无法解码|音频解码失败|无法读取音频/}).waitFor();
    await checkHeld(legacy);

    await chooseRecoveryFile(page,wrong);
    await comparison().waitFor();
    await comparison().getByText(fixture.title,{exact:false}).first().waitFor();
    await comparison().getByText(wrong.name,{exact:false}).first().waitFor();
    assert.match(await comparison().innerText(),/0:32/);
    assert.ok(await comparison().getByRole('button',{name:'取消',exact:true}).evaluate(button=>document.activeElement===button));
    await checkHeld(legacy);
    await capture(page,'file-recovery-confirmation');
    await comparison().getByRole('button',{name:'取消',exact:true}).click();
    await comparison().waitFor({state:'hidden'});
    await checkHeld(legacy);
    page = await reopen();
    await checkHeld(legacy);
    console.log('通过 · 旧曲库未保存核对信息，展示原曲和所选 WAV，点击取消、关闭并重启后，歌名、歌词、队列、歌单、续播点和空音频副本均保持原样。损坏文件同样未写入。');

    const moved = path.join(directory,'移动后的文件夹','改名后的原曲.wav');
    await fs.mkdir(path.dirname(moved));
    await fs.writeFile(moved,fixture.file.buffer);
    await page.evaluate(id => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value,key) {
        if (this.name === 'media' && key === id) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException('Simulated storage failure','QuotaExceededError');
        }
        return put.apply(this,arguments);
      };
    },fixture.original);
    await chooseRecoveryFile(page,moved);
    await comparison().getByRole('button',{name:'确认使用此文件',exact:true}).click();
    await warning().filter({hasText:'未能保存音频'}).waitFor();
    await checkHeld(legacy);
    page = await reopen();
    await checkHeld(legacy);

    await chooseRecoveryFile(page,moved);
    await comparison().getByRole('button',{name:'确认使用此文件',exact:true}).click();
    const resumed = await checkPlaying(page,fixture.original,fixture.position-.2);
    assert.equal(resumed.lyrics[0]?.text,fixture.lyric);
    assert.ok(resumed.position<fixture.position+2);
    assert.deepEqual(await playlistOrders(page,fixture.lists),fixture.orders);
    const restored = await localFileRecord(page,fixture.original);
    assert.equal(restored.mediaHash,correctHash);
    assert.equal(restored.metadata.name,fixture.title);
    assert.equal(restored.metadata.audioDigest,original.metadata.audioDigest);
    console.log('通过 · 模拟保存失败时数据库没有留下半次修改，重启后手动确认改名、移位的原文件，约 '+resumed.position.toFixed(2)+' 秒续播。');

    await dock(page).getByRole('button',{name:'暂停音乐'}).click();
    const paused = await snapshot(page);
    await removeFixtureAudio(page,fixture.original);
    page = await reopen();
    await chooseRecoveryFile(page,moved);
    const verified = await checkPlaying(page,fixture.original,paused.position-.2);
    assert.ok(verified.position<paused.position+2);
    assert.equal(await comparison().isVisible(),false);
    assert.deepEqual(await playlistOrders(page,fixture.lists),fixture.orders);
    console.log('通过 · 已有内容核对信息时，改名或移位的原文件通过核对后直接接播。');
  } finally {
    await client?.app.close().catch(() => {});
  }
}

async function testNavigation(directory) {
  const client = await desktop(path.join(directory, 'profile'), await freePort());
  const {page,app} = client;
  const title = '导航验收歌曲';
  const instrumental = '导航验收无歌词';
  const raw = testTone(60,350);
  const songs = [title, instrumental].map(name => path.join(directory, name + '.wav'));
  const lyricFile = path.join(directory, title + '.lrc');
  const lyricText = index => '导航验收歌词第 ' + (index + 1) + ' 句';
  await Promise.all([
    ...songs.map(song => fs.writeFile(song, raw)),
    fs.writeFile(lyricFile, Array.from({length:29}, (_,index) =>
      '[00:' + String(index * 2).padStart(2, '0') + '.00]' + lyricText(index)).join('\n'))
  ]);

  const room = page.locator('#listeningRoom');
  const player = dock(page);
  const current = room.locator('[data-preview-row="0"]');
  const full = room.locator('[data-full-lyrics]');
  const line = index => full.locator('[data-full-line="' + index + '"]');
  const follow = room.getByRole('button',{name:'回到当前句'});
  const enterImmersion = room.locator('[data-lyric-full-tools] [data-action=enter-immersion]');
  const exitImmersion = room.getByRole('button',{name:'退出沉浸'});
  const scrollTop = () => full.evaluate(element => element.scrollTop);
  const focused = control => control.evaluate(element => document.activeElement === element);
  const readAt = index => page.waitForFunction(index => document.querySelector('[data-full-line="' + index + '"]')?.getAttribute('aria-current') === 'true', index);
  const positionNear = async target => {
    const {position} = await snapshot(page);
    assert.ok(Math.abs(position-target)<.8, JSON.stringify({position,target}));
  };
  const pause = async () => {
    await player.getByRole('button',{name:'暂停音乐'}).click();
    await page.waitForFunction(() => !SonicPlayback.snapshot().playing);
  };
  try {
    await page.locator('#fileInput').setInputFiles([songs[0], lyricFile, songs[1]]);
    await page.waitForFunction(names => names.every(name => SonicPlayback.library().tracks.some(track => track.name === name))
      && !SonicPlayback.library().importing, [title,instrumental]);
    const ids = await page.evaluate(names => names.map(name => SonicPlayback.library().tracks.find(track => track.name === name).id), [title,instrumental]);
    await page.evaluate(ids => SonicPlayback.playFromLibrary(ids[0], 'local', true, ids, '导航验收队列'), ids);
    await checkPlaying(page, ids[0], .6);
    await player.getByRole('button',{name:'打开正在播放'}).click();
    await page.locator('#listeningRoom[data-now-view=preview]').waitFor();
    await current.filter({hasText:lyricText(0)}).waitFor();
    const originalSettings = await page.evaluate(() => {
      const {lyricStyle,lyricEffect} = SonicListeningRoom.settings();
      return {lyricStyle,lyricEffect};
    });
    await current.press('Enter');

    if (baseline) {
      assert.equal(await full.isVisible(), false);
      assert.equal(await room.getAttribute('data-now-view'), 'preview');
      await positionNear(0);
      await capture(page, '12-baseline');
      await room.locator('[data-now-lyrics]').click();
      await full.waitFor();
      await pause();
      await line(10).click();
      await positionNear(20);
      assert.equal((await snapshot(page)).playing, false);
      await full.hover();
      await page.mouse.wheel(0, 260);
      await follow.waitFor();
      const savedReading = await scrollTop();
      await enterImmersion.click();
      await page.keyboard.press('Escape');
      await full.waitFor();
      assert.equal(await scrollTop(), savedReading);
      assert.equal(await focused(enterImmersion), true);
      await room.locator('[data-room-mode=visual]').click();
      assert.equal(await room.locator('[data-visual-view] button').count(), 2);
      console.log('12 改前 · 底栏可打开正在播放；点当前歌词跳回本句开头，需另点「全文歌词」。暂停点句、沉浸退出保留阅读位置已经可用；舞台需用顶部导航返回。');
      return;
    }

    await full.waitFor();
    assert.equal(await focused(full), true);
    await full.hover();
    await page.mouse.wheel(0, 270);
    await follow.waitFor();
    await line(10).click();
    await readAt(10);
    await positionNear(20);
    assert.equal((await snapshot(page)).playing, true);
    await full.hover();
    await page.mouse.wheel(0, 220);
    await follow.waitFor();
    await follow.click();
    await follow.waitFor({state:'hidden'});
    assert.equal(await focused(full), true);
    await pause();
    await line(15).click();
    await readAt(15);
    await positionNear(30);
    const paused = await snapshot(page);
    await wait(275);
    assert.equal((await snapshot(page)).playing, false);
    assert.ok(Math.abs((await snapshot(page)).position - paused.position) < .1);
    await page.keyboard.press('Escape');
    await page.locator('#listeningRoom[data-now-view=preview]').waitFor();
    assert.equal(await focused(current), true);
    await current.press('Enter');
    await full.waitFor();
    console.log('12 通过 · 键盘可用当前歌词展开全文和 Escape 收起，焦点回到当前歌词。播放中点句跳到约 20 秒，暂停时点句跳到约 30 秒并保持暂停。');

    const checkRoundTrip = async playing => {
      const visualEntry = room.locator('[data-lyric-full-tools] [data-action=visual-stage]');
      await full.hover();
      await page.mouse.wheel(0, 230);
      await follow.waitFor();
      const reading = await scrollTop();
      const before = await snapshot(page);
      await enterImmersion.click();
      await exitImmersion.waitFor();
      if (!playing) await capture(page, '12-immersive');
      if (playing) await page.keyboard.press('Escape');
      else await exitImmersion.click();
      await full.waitFor();
      assert.equal(await scrollTop(), reading);
      assert.equal(await focused(enterImmersion), true);
      await visualEntry.click();
      await room.locator('[data-visual-view]').waitFor();
      const back = room.getByRole('button',{name:'返回全文歌词',exact:true});
      await back.waitFor();
      if (playing) await page.keyboard.press('Escape');
      else await back.click();
      await full.waitFor();
      assert.equal(await scrollTop(), reading);
      assert.equal(await focused(visualEntry), true);
      const after = await snapshot(page);
      assert.equal(after.playing, playing);
      assert.equal(after.track.id, ids[0]);
      assert.equal(after.queueEntryId, before.queueEntryId);
      assert.deepEqual(after.queue, before.queue);
      assert.ok(after.position >= before.position - .07);
      if (!playing) assert.ok(after.position <= before.position + .1);
      const afterSettings = await page.evaluate(() => {
        const {lyricStyle,lyricEffect} = SonicListeningRoom.settings();
        return {lyricStyle,lyricEffect};
      });
      assert.deepEqual(afterSettings, originalSettings);
    };
    await checkRoundTrip(false);
    await player.getByRole('button',{name:'播放音乐'}).click();
    await checkPlaying(page, ids[0], 29.9);
    await checkRoundTrip(true);
    await capture(page, '12-full-lyrics');
    console.log('12 通过 · 播放和暂停各完成全文 → 沉浸 → 全文 → 舞台 → 全文，阅读位置、焦点、队列和歌词样式均保留。');

    const dimensions = await app.evaluate(({BrowserWindow}) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.isMaximized()) window.unmaximize();
      window.setSize(760, 580);
      return {size:window.getSize(), content:window.getContentSize()};
    });
    assert.ok(dimensions.size.every((size,index) => Math.abs(size - [760,580][index]) <= 3), JSON.stringify(dimensions));
    await page.waitForFunction(([width,height]) => Math.abs(innerWidth-width)<=2 && Math.abs(innerHeight-height)<=2, dimensions.content);
    await enterImmersion.click();
    await exitImmersion.click();
    await full.waitFor();
    await room.locator('[data-action=collapse-lyrics]').click();
    await player.locator('[data-action=next]').click();
    await checkPlaying(page, ids[1], .2);
    await current.filter({hasText:'暂无同步歌词'}).waitFor();
    assert.equal(await full.locator('[data-full-line]').count(), 0);
    assert.equal((await snapshot(page)).lyrics.length, 0);
    await room.locator('[data-lyric-preview] [data-action=visual-stage]').click();
    await room.locator('[data-visual-view]').waitFor();
    await room.getByRole('button',{name:'返回正在播放',exact:true}).click();
    await current.filter({hasText:'暂无同步歌词'}).waitFor();
    await pause();
    await room.locator('.lr-toasts').waitFor({state:'hidden'});
    await capture(page, '12-narrow-no-lyrics');
    console.log('12 通过 · 760 × 580 窄桌面窗里，无歌词曲目已清掉上一首文字，还能进出舞台并暂停。');
  } finally {
    await client.app.close().catch(() => {});
  }
}

const searchFixture = [
  {mediaId:'79101',name:'当你',artist:'王心凌',album:'爱你'},
  {mediaId:'79102',name:'江南',artist:'林俊杰',album:'第二天堂'},
  {mediaId:'79103',name:'当你',artist:'林俊杰',album:'她说 概念自选辑'},
  {mediaId:'79104',name:'当你',artist:'陈布灵',album:'当你'},
  {mediaId:'79105',name:'当你（Live）',artist:'林俊杰',album:'现场版 Live at the Test Hall'},
  {mediaId:'79106',name:'当你（DJ 版）',artist:'林俊杰',album:'舞曲合集'},
  {mediaId:'79107',name:'Always Online',artist:'林俊杰',album:'JJ陆'},
  {mediaId:'79108',name:'Always Online',artist:'测试翻唱歌手',album:'测试合集'},
  {mediaId:'79109',name:'当你（Remix）',artist:'林俊杰',album:'Remix 合集'},
].map(track=>({...track,duration:32,provider:'qishui'}));

async function importSearchRecordings(page,recordings,tone) {
  await page.locator('#fileInput').setInputFiles(recordings.map((track,index)=>({
    name:'search-fixture-'+track.mediaId+'.wav',mimeType:'audio/wav',buffer:tone(track,index),
  })));
  await page.waitForFunction(count=>!SonicPlayback.library().importing
    && SonicPlayback.library().tracks.filter(track=>track.kind==='file').length===count,recordings.length);
  return page.evaluate(async candidates=>{
    const library=SonicPlayback.library();
    const ids={};
    for(const track of candidates){
      const id=library.tracks.find(entry=>entry.name==='search-fixture-'+track.mediaId).id;
      const draft=await SonicPlayback.localTrackDetails(id);
      if(!await SonicPlayback.saveLocalTrackDetails(id,{...draft,name:track.name,artist:track.artist,album:track.album}))
        throw new Error('Could not save search test metadata');
      ids[track.mediaId]=id;
    }
    return ids;
  },recordings);
}

async function testSearchRanking(directory,withLabels=false) {
  const queryA='当你 林俊杰', queryB='当你 王心凌';
  const padding=withLabels?Array.from({length:20},(_,index)=>({provider:'qishui',mediaId:String(79200+index),
    name:'滚动验收录音 '+(index+1),artist:'测试歌手',album:'滚动验收',duration:32})):[];
  const wav=testTone(32,440);
  const tickets=[];
  let blockOld=false, release;
  const delay=new Promise(resolve=>{release=resolve;});
  const client=await desktop(path.join(directory,'profile'),await freePort(),async (page,origin)=>{
    await page.addInitScript(query=>{
      const nativeFetch=window.fetch.bind(window);
      window.fetch=(url,options)=>{
        const old=window.deferSearchResponse&&typeof url==='string'&&url.endsWith('/api/qishui/search')&&
          JSON.parse(options.body).query===query;
        return nativeFetch(url,old?{...options,signal:undefined}:options);
      };
    },queryA);
    await page.route(origin+'/api/qishui/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.endsWith('/login-status'))return route.fulfill({json:{authenticated:true,user:{nickname:'验收'}}});
      if(url.pathname.endsWith('/search')){
        if(blockOld&&route.request().postDataJSON()?.query===queryA)await delay;
        return route.fulfill({json:{items:[...searchFixture,...padding]}});
      }
      const ticket=/\/tracks\/(\d+)\/audio$/.exec(url.pathname);
      if(ticket){
        tickets.push(ticket[1]);
        if(withLabels&&ticket[1]==='79104')return route.fulfill({status:401,json:{code:'auth-required',error:'测试需登录'}});
        if(withLabels&&ticket[1]==='79102')return route.fulfill({status:502,json:{code:'network',error:'测试音源失败'}});
        return route.fulfill({json:{streamPath:'/media/search-fixture/'+ticket[1],preview:ticket[1]==='79103'}});
      }
      return route.fulfill({json:{}});
    });
    await page.route(origin+'/media/search-fixture/**',route=>route.fulfill({contentType:'audio/wav',body:wav}));
  });
  const {page}=client;
  const room=page.locator('#listeningRoom'),openSearch=()=>room.getByRole('button',{name:'搜索音乐',exact:true}).click();
  const search=room.getByRole('searchbox',{name:'搜索音乐',exact:true});
  const suggestions=room.locator('#sl-suggestions [data-suggestion-track]');
  const topIds=async selector=>(await selector.evaluateAll(elements=>elements.slice(0,5)
    .map(e=>e.dataset.suggestionTrack||e.dataset.trackId||e.dataset.slId)));
  const checkResults=async ({query,first,source,required=[]})=>{
    const rows=source==='本机'?room.locator('[data-sl-local-results] .sl-track'):room.locator('[data-sl-qishui-row]');
    await search.fill(query);
    await suggestions.first().waitFor();
    const before=await topIds(suggestions);
    assert.equal(before[0],first,query+' '+source+' 联想');
    assert.deepEqual(before,await topIds(rows));
    const suggested=await suggestions.first().innerText();
    await search.press('Enter');
    if(source==='汽水')await room.locator('[data-sl-qishui-status]').filter({hasText:'找到'}).waitFor();
    assert.equal((await topIds(rows))[0],first,query+' '+source+' 正式');
    for(const id of required)assert.ok(await rows.locator('xpath=self::*[@data-track-id="'+id+'" or @data-sl-id="'+id+'"]').count(),query+' 包含 '+id);
    const formal=await rows.evaluateAll(elements=>elements.slice(0,5).map(row=>[row.querySelector('strong')?.textContent,
      row.querySelector('.sl-qishui-meta,.sl-song-copy small')?.textContent]));
    console.log(source+' '+query+' · 联想首位 '+suggested+' · 正式前五 '+JSON.stringify(formal));
  };
  try {
    const local=await importSearchRecordings(page,searchFixture,(_,index)=>testTone(32,350+index*50));
    const online=id=>'online:qishui:'+id;
    await openSearch();
    for(const [source,id] of [['本机',mediaId=>local[mediaId]],['汽水',online]]){
      if(source==='汽水')await room.locator('[data-sl-search-source=qishui]').click();
      await checkResults({query:queryA,first:id('79103'),source});
      assert.match(await suggestions.first().innerText(),/她说 概念自选辑/);
      await checkResults({query:queryB,first:id('79101'),source});
      await checkResults({query:'当你',first:id('79101'),source,required:[id('79101'),id('79103')]});
      await checkResults({query:'Always Online / 林俊杰',first:id('79107'),source});
      await checkResults({query:'当你 林俊杰 Live',first:id('79105'),source});
      await checkResults({query:'当你 · 林俊杰 DJ',first:id('79106'),source});
      await checkResults({query:'当你 林俊杰 Remix',first:id('79109'),source});
      await suggestions.first().click();
      await checkPlaying(page,id('79109'),.1);
      if(source==='汽水')assert.equal(tickets.at(-1),'79109');
      await openSearch();
      assert.equal(await search.inputValue(),'当你 林俊杰 Remix');
      console.log(source+' · 从联想点播的确是所选 Remix，返回保留原关键词。');
    }
    blockOld=true;
    await page.evaluate(()=>{window.deferSearchResponse=true;});
    await Promise.all([
      page.waitForRequest(request=>request.url().endsWith('/api/qishui/search')&&request.postDataJSON()?.query===queryA),
      search.fill(queryA),
    ]);
    await checkResults({query:queryB,first:online('79101'),source:'汽水'});
    const oldArrived=page.waitForResponse(response=>response.url().endsWith('/api/qishui/search')
      && response.request().postDataJSON()?.query===queryA);
    release();
    assert.equal((await oldArrived).status(),200);
    await wait(200);
    assert.equal((await topIds(suggestions))[0],online('79101'));
    assert.equal((await topIds(room.locator('[data-sl-qishui-row]')))[0],online('79101'));
    console.log('汽水 · 让较早的林俊杰请求在王心凌结果之后返回，联想和正式结果仍是王心凌。');
    await capture(page,'search-ranking');
    if(withLabels){
      const query=queryA;
      await search.fill(query);
      await suggestions.first().waitFor();
      const row=id=>room.locator('[data-sl-qishui-row="'+id+'"]');
      const badge=(id,kind)=>row(id).locator('[data-kind="'+kind+'"]');
      const check=id=>row(id).getByRole('button',{name:/检查可播状态/}).click();
      const status=room.locator('[data-sl-qishui-status]');
      const ids=await page.evaluate(local=>[local['79102'],local['79101'],local['79109']],local);
      await page.evaluate(ids=>SonicPlayback.playFromLibrary(ids[0],'local',true,ids,'搜索验收队列'),ids);
      const held=await checkPlaying(page,ids[0],.1);
      const heldQueue=held.queue.map(entry=>[entry.id,entry.entryId]);
      assert.equal(await badge('79103','unknown').textContent(),'可播状态待确认');
      assert.match(await row('79103').innerText(),/林俊杰 · 她说 概念自选辑 · 00:32/);
      assert.match(await row('79105').innerText(),/当你（Live）/);
      assert.match(await row('79106').innerText(),/当你（DJ 版）/);
      assert.equal(await badge('79103','source').textContent(),'汽水音乐');
      assert.equal(await badge('79103','version').count(),0);
      await check('79105');
      await badge('79105','full-source').getByText('可播整曲',{exact:true}).waitFor();
      await check('79103');
      await badge('79103','preview-source').getByText('仅试听',{exact:true}).waitFor();
      await check('79104');
      await badge('79104','auth-required').getByText('需登录',{exact:true}).waitFor();
      assert.equal(await badge('79106','unknown').textContent(),'可播状态待确认');
      assert.equal((await topIds(suggestions))[0],online('79103'));
      await capture(page,'search-playback-labels');
      console.log('汽水四种状态已实测 · Live 可播整曲、林俊杰《当你》仅试听、另一条需登录、DJ 版本可播状态待确认。仅试听的准确录音保持首位。');

      const assertHeld=async()=>{
        const active=await snapshot(page);
        assert.equal(active.track.id,held.track.id);
        assert.equal(active.playing,true);
        assert.deepEqual(active.queue.map(entry=>[entry.id,entry.entryId]),heldQueue);
      };
      await assertHeld();
      await row('79102').locator('[data-sl-qishui-track]').click();
      await badge('79102','failed').getByText('播放失败',{exact:true}).waitFor();
      await assertHeld();
      await row('79104').locator('[data-sl-qishui-track]').click();
      await status.filter({hasText:'需要登录汽水音乐'}).waitFor();
      await assertHeld();
      const loginDialog=page.locator('#queueDialog');
      await row('79104').locator('[data-sl-qishui-track]').click();
      await loginDialog.waitFor();
      await assertHeld();
      await page.keyboard.press('Escape');
      await loginDialog.waitFor({state:'hidden'});
      console.log('汽水 · 播放失败和需登录前后，原曲继续播放，三个队列条目和顺序都保留。');

      await suggestions.locator('xpath=self::*[@data-suggestion-track="'+online('79103')+'"]').click();
      const preview=await checkPlaying(page,online('79103'),.1);
      assert.equal(preview.audioPreview,true);
      assert.equal(tickets.at(-1),'79103');
      await openSearch();
      assert.equal(await search.inputValue(),query);

      const picked=padding.at(-1);
      const play=row(picked.mediaId).locator('[data-sl-qishui-track]');
      await play.evaluate(button=>button.scrollIntoView({block:'center',behavior:'instant'}));
      const scroll=await page.evaluate(()=>window.scrollY);
      assert.ok(scroll>100);
      await play.click();
      const full=await checkPlaying(page,online(picked.mediaId),.1);
      assert.equal(full.audioPreview,false);
      assert.equal(tickets.at(-1),picked.mediaId);
      await openSearch();
      assert.equal(await search.inputValue(),query);
      assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-scroll)<=5);
      await search.fill('');
      await room.locator('#sl-suggestions').getByRole('button',{name:query+' · 最近搜索',exact:true}).waitFor();
      console.log('汽水 · 从联想实际试听所选录音，从正式结果播放所选整曲。返回保留关键词和约 '+scroll.toFixed(0)+' px 浏览位置，近期搜索仍在。');
    }
  } finally {
    release();
    await client.app.close().catch(()=>{});
  }
}

async function testSearchEditions(directory) {
  let served=[];
  const tickets=[];
  const tone=track=>testTone(32,350+(Number(track.mediaId)%20)*30);
  const recordings=searchEditionCases.flatMap(({tracks})=>tracks);
  const client=await desktop(path.join(directory,'profile'),await freePort(),async (page,origin)=>{
    await page.route(origin+'/api/qishui/**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname.endsWith('/login-status'))return route.fulfill({json:{authenticated:true,user:{nickname:'验收'}}});
      if(url.pathname.endsWith('/search'))return route.fulfill({json:{items:served}});
      const ticket=/\/tracks\/(\d+)\/audio$/.exec(url.pathname);
      if(ticket){
        tickets.push(ticket[1]);
        return route.fulfill({json:{streamPath:'/media/search-editions/'+ticket[1],preview:false}});
      }
      return route.fulfill({json:{}});
    });
    await page.route(origin+'/media/search-editions/**',route=>{
      const id=new URL(route.request().url()).pathname.split('/').at(-1);
      return route.fulfill({contentType:'audio/wav',body:tone(recordings.find(track=>track.mediaId===id))});
    });
  });
  const {page,app}=client;
  const room=page.locator('#listeningRoom');
  const openSearch=()=>room.getByRole('button',{name:'搜索音乐',exact:true}).click();
  const input=room.getByRole('searchbox',{name:'搜索音乐',exact:true});
  const suggestions=room.locator('#sl-suggestions [data-suggestion-track]');
  const remoteRows=room.locator('[data-sl-qishui-row]');
  const localRows=room.locator('[data-sl-local-results] .sl-track');
  const online=id=>'online:qishui:'+id;
  const readRows=rows=>rows.evaluateAll(elements=>elements.map(row=>({
    id:row.dataset.suggestionTrack||row.dataset.trackId||row.dataset.slId,
    label:row.querySelector('strong')?[row.querySelector('strong').textContent,
      row.querySelector('.sl-qishui-meta,.sl-song-copy small').textContent].join(' · '):row.textContent,
  })));
  const choose=async (query,rows,expected,label)=>{
    await input.fill('');
    const submit=async action=>{
      if(rows===remoteRows){
        const request=page.waitForResponse(response=>response.url().endsWith('/api/qishui/search')
          && response.request().postDataJSON()?.query===query);
        await action();
        const response=await request;
        assert.equal(response.status(),200);
        assert.deepEqual((await response.json()).items.map(track=>track.mediaId),served.map(track=>track.mediaId));
        await room.locator('[data-sl-qishui-status]').filter({hasText:'找到'}).waitFor();
      }else await action();
    };
    await submit(()=>input.fill(query));
    await suggestions.first().waitFor();
    const suggested=await readRows(suggestions);
    await submit(()=>input.press('Enter'));
    const formal=await readRows(rows);
    console.log(label+' · '+query+' · 联想 '+JSON.stringify(suggested.slice(0,3))+' · 正式 '+JSON.stringify(formal.slice(0,3)));
    assert.deepEqual(suggested.map(row=>row.id),formal.slice(0,suggested.length).map(row=>row.id));
    assert.ok(expected.includes(suggested[0].id),label+' 联想首位 '+query);
    assert.ok(expected.includes(formal[0].id),label+' 正式首位 '+query);
    return formal;
  };
  try {
    const version=await app.evaluate(({app})=>app.getVersion());
    assert.equal(new URL(page.url()).searchParams.get('v'),version);
    if(process.env.SONIC_EXPECTED_VERSION)assert.equal(version,process.env.SONIC_EXPECTED_VERSION);
    console.log('窗口版本 '+version+' · '+new URL(page.url()).pathname+'?v='+version);
    await openSearch();
    await room.locator('[data-sl-search-source=qishui]').click();
    for(const [index,{query,unqualified,tracks}] of searchEditionCases.entries()){
      const [distractor,plain,live]=tracks;
      served=tracks;
      let formal=await choose(query,remoteRows,[online((baseline?distractor:live).mediaId)],'汽水固定数据');
      assert.deepEqual(new Set(formal.map(row=>row.id)),new Set(tracks.map(track=>online(track.mediaId))));
      await capture(page,'search-editions-'+(baseline?'before-':'after-')+(index+1));
      if(baseline)continue;
      served=tracks.slice().reverse();
      await choose(query,remoteRows,[online(live.mediaId)],'汽水候选反序');
      await choose(unqualified,remoteRows,[online(plain.mediaId),online(live.mediaId)],'汽水未指定版本');

      served=[distractor,plain];
      formal=await choose(query,remoteRows,[online(plain.mediaId)],'汽水目标现场版缺席');
      assert.ok(formal[0].label.startsWith(plain.name+' · '+plain.artist+' · '+plain.album));
      const first=remoteRows.first();
      assert.equal(await first.locator('[data-kind=unknown]').textContent(),'可播状态待确认');
      assert.equal(await first.locator('[data-kind=source]').textContent(),'汽水音乐');

      const namedMix={...plain,name:plain.name+' - Guest Producer Remix',artist:'Guest Producer、'+plain.artist};
      served=[distractor,namedMix];
      formal=await choose(query,remoteRows,[online(plain.mediaId)],'汽水目标现场版缺席，有署名混音版');
      assert.ok(formal[0].label.startsWith(namedMix.name+' · '+namedMix.artist+' · '));

      served=tracks;
      await choose(query,remoteRows,[online(live.mediaId)],'汽水点播前');
      if(index===0)await suggestions.first().click();
      else await remoteRows.first().locator('[data-sl-qishui-track]').click();
      const active=await checkPlaying(page,online(live.mediaId),.1);
      assert.equal(tickets.at(-1),live.mediaId);
      assert.equal(active.audioPreview,false);
      console.log('汽水'+(index===0?'联想':'正式')+'点播 · '+active.track.id+' · 进度 '+active.position.toFixed(2)+' 秒');
      await openSearch();
      assert.equal(await input.inputValue(),query);
    }
    if(baseline)return;
    const local=await importSearchRecordings(page,recordings,tone);
    await room.locator('[data-sl-search-source=local]').click();
    for(const [index,{query,tracks}] of searchEditionCases.entries()){
      const live=tracks.at(-1),id=local[live.mediaId];
      await choose(query,localRows,[id],'本机合成音频');
      if(index===0)await suggestions.first().click();
      else await localRows.first().getByRole('button',{name:'播放 '+live.name,exact:true}).click();
      const active=await checkPlaying(page,id,.1);
      console.log('本机'+(index===0?'联想':'正式')+'点播 · '+active.track.id+' · 进度 '+active.position.toFixed(2)+' 秒');
      await openSearch();
      assert.equal(await input.inputValue(),query);
    }
  }finally{await client.app.close().catch(()=>{});}
}

function fulfillSeekableWav(route,body){
  const headers={'Accept-Ranges':'bytes'};
  const range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range||'');
  if(!range)return route.fulfill({contentType:'audio/wav',headers,body});
  const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;
  if(start>end)return route.fulfill({status:416,headers:{'Content-Range':'bytes */'+body.length}});
  headers['Content-Range']='bytes '+start+'-'+end+'/'+body.length;
  return route.fulfill({status:206,contentType:'audio/wav',headers,body:body.subarray(start,end+1)});
}

async function testQishuiAuthAvailability(directory) {
  const first={provider:'qishui',mediaId:'79331',name:'权限刷新验收曲',artist:'验收艺人',album:'验收专辑',duration:32};
  const second={...first,mediaId:'79332',name:'试听切换验收曲'};
  const third={...first,mediaId:'79333',name:'迟到权限验收曲'};
  let loggedIn=false,release,lateResponse,expired=false,previewAfterLogin=false,holdLogin=false,approve;
  const late=new Promise(resolve=>{release=resolve;});
  const wav=testTone(32,440);
  const client=await desktop(path.join(directory,'profile'),await freePort(),async (page,origin)=>{
    await page.route(origin+'/api/qishui/**',async route=>{
      const url=new URL(route.request().url());
      const user={nickname:'模拟会话'};
      if(url.pathname.endsWith('/login-status'))return expired?route.fulfill({status:401,json:{code:'auth-required'}}):
        route.fulfill({json:{authenticated:loggedIn,...(loggedIn?{user}:{})}});
      if(url.pathname.endsWith('/login/start'))return route.fulfill({json:{sessionId:'fixture-authority',qrImage:'/assets/sonic-icon.png'}});
      if(url.pathname.endsWith('/login/check')){
        if(holdLogin)await new Promise(resolve=>{approve=resolve;});
        loggedIn=true;expired=false;
        return route.fulfill({json:{state:'confirmed'}});
      }
      if(url.pathname.endsWith('/search'))return route.fulfill({json:{items:[first,second,third]}});
      const match=/\/tracks\/(\d+)\/audio$/.exec(url.pathname);
      if(match){
        const guest=!loggedIn,id=match[1];
        if(expired)return route.fulfill({status:401,json:{code:'auth-required'}});
        if(guest&&id===third.mediaId){lateResponse=true;await late;}
        if(guest&&id===first.mediaId)return route.fulfill({status:422,json:{code:'not-playable'}});
        return route.fulfill({json:{streamPath:'/media/auth-refresh/'+id,preview:guest||previewAfterLogin}}).catch(()=>{});
      }
      if(url.pathname.endsWith('/library/playlists'))return route.fulfill({json:{items:[]}});
      return route.fulfill({json:{}});
    });
    await page.route(origin+'/media/auth-refresh/**',route=>fulfillSeekableWav(route,wav));
  });
  const {page}=client;
  const room=page.locator('#listeningRoom');
  const input=room.getByRole('searchbox',{name:'搜索音乐',exact:true});
  const row=id=>room.locator('[data-sl-qishui-row="'+id+'"]');
  const badge=id=>row(id).locator('.sl-qishui-badge:not([data-kind=source])');
  const check=id=>row(id).locator('[data-sl-qishui-action=check]').click();
  try{
    await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
    await room.locator('[data-sl-search-source=qishui]').click();
    await input.fill('验收曲');
    await input.press('Enter');
    await row(first.mediaId).waitFor();
    await check(first.mediaId);
    await badge(first.mediaId).getByText('打开原平台',{exact:true}).waitFor();
    await check(second.mediaId);
    await badge(second.mediaId).getByText('仅试听',{exact:true}).waitFor();
    await check(third.mediaId);
    await page.waitForFunction(()=>window.SonicPlayback.snapshot().onlineReady);
    await page.evaluate(()=>SonicPlayback.openOnline());
    await page.locator('#onlineLoginBtn').click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().onlineLoggedIn);
    await page.keyboard.press('Escape');
    const immediately=await Promise.all([first,second,third].map(track=>badge(track.mediaId).textContent()));
    assert.equal(lateResponse,true);
    release();
    await wait(300);
    const after=await Promise.all([first,second,third].map(track=>badge(track.mediaId).textContent()));
    console.log('登录前查出应用内不可播、仅试听和一个延迟请求；确认后即时 '+JSON.stringify(immediately)+' · 旧请求返回后 '+JSON.stringify(after));
    if(baseline){
      assert.deepEqual(after,['打开原平台','仅试听','仅试听']);
      return;
    }
    assert.deepEqual(immediately,['可播状态待确认','可播状态待确认','可播状态待确认']);
    assert.deepEqual(after,immediately);
    assert.equal(await input.inputValue(),'验收曲');
    assert.equal((await snapshot(page)).onlineLoggedIn,true);
    await check(first.mediaId);
    await badge(first.mediaId).getByText('可播整曲',{exact:true}).waitFor();
    await row(first.mediaId).locator('[data-sl-qishui-track]').click();
    const active=await checkPlaying(page,'online:qishui:'+first.mediaId,.1);
    assert.equal(active.audioPreview,false);
    console.log('登录后在原搜索结果重新检查，并按原曲目 ID 播放整曲 '+active.track.id+' · '+active.position.toFixed(2)+' 秒');
    const queue=[first,second,third];
    await page.evaluate(({queue,id})=>SonicPlayback.playOnlineList(queue,'恢复验收',id),{queue,id:first.mediaId});
    await checkPlaying(page,'online:qishui:'+first.mediaId,.1);
    await page.waitForFunction(()=>document.querySelector('#audio').seekable.length>0);
    assert.equal(await page.evaluate(()=>SonicPlayback.seek(20)),true);
    await page.waitForFunction(()=>SonicPlayback.snapshot().position>=19.9);
    await page.evaluate(()=>SonicPlayback.toggle());
    const paused=await snapshot(page);
    const order=state=>state.queue.map(entry=>[entry.id,entry.entryId]);
    assert.equal(paused.playing,false);
    assert.equal(order(paused).length,3);
    loggedIn=false;expired=true;
    await page.evaluate(()=>SonicPlayback.openOnline());
    await page.locator('#onlineReconnectBtn').click();
    await page.waitForFunction(()=>!SonicPlayback.snapshot().onlineLoggedIn);
    await page.locator('#onlineLoginBtn').click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().onlineLoggedIn);
    const authorized=await snapshot(page);
    assert.equal(authorized.playing,false);
    assert.equal(authorized.track.id,paused.track.id);
    assert.deepEqual(order(authorized),order(paused));
    assert.ok(Math.abs(authorized.position-paused.position)<.2);
    console.log('固定数据 · 原来暂停时重新登录仍暂停，位置 '+paused.position.toFixed(2)+' → '+authorized.position.toFixed(2)+' 秒，队列顺序一致。');
    await page.keyboard.press('Escape');

    const retry=room.locator('[data-playback-recovery] [data-action=playback-retry]');
    async function holdExpiredPlayback(){
      await page.evaluate(()=>SonicPlayback.toggle());
      await checkPlaying(page,paused.track.id,19.9);
      loggedIn=false;expired=true;holdLogin=true;
      await page.evaluate(()=>{
        const media=document.querySelector('#audio');
        Object.defineProperty(media,'error',{configurable:true,value:{code:2}});
        media.dispatchEvent(new Event('error'));
        delete media.error;
      });
      await page.waitForFunction(()=>SonicPlayback.snapshot().playbackRecovery);
      if((await snapshot(page)).playbackRecovery.phase!=='login')await retry.click();
      await page.waitForFunction(()=>SonicPlayback.snapshot().playbackRecovery?.reason==='auth');
      const held=await snapshot(page);
      assert.equal(held.playbackRecovery.trackId,paused.track.id);
      assert.deepEqual(order(held),order(paused));
      if(held.playbackRecovery.phase!=='login')await retry.click();
      return held.playbackRecovery.position;
    }
    async function authorizeRecovery(){
      for(let i=0;!approve&&i<100;i++)await wait(40);
      assert.ok(approve,'等待扫码状态');
      holdLogin=false;approve();approve=null;
    }
    const heldAt=await holdExpiredPlayback();
    await authorizeRecovery();
    const resumed=await checkPlaying(page,paused.track.id,heldAt-.15);
    assert.deepEqual(order(resumed),order(paused));
    assert.ok(Math.abs(resumed.position-heldAt)<2);
    console.log('固定数据 · 401 后重新扫码恢复同一曲目和三首队列，'+heldAt.toFixed(2)+' → '+resumed.position.toFixed(2)+' 秒。');

    await page.evaluate(()=>SonicPlayback.toggle());
    await page.evaluate(()=>SonicPlayback.seek(20));
    const secondHold=await holdExpiredPlayback();
    previewAfterLogin=true;
    await authorizeRecovery();
    await page.waitForFunction(()=>SonicPlayback.snapshot().playbackRecovery?.reason==='resume-source');
    const downgraded=await snapshot(page);
    assert.equal(downgraded.playbackRecovery.trackId,paused.track.id);
    assert.equal(downgraded.playing,false);
    assert.deepEqual(order(downgraded),order(paused));
    assert.ok(Math.abs(downgraded.playbackRecovery.position-secondHold)<.3);
    console.log('固定数据 · 重新登录后仅有试听音源时保留原 ID、队列及续播点。');
  }finally{release();await client.app.close().catch(()=>{});}
}

async function testQishuiQrCancel(directory) {
  let release,completed,created=0,checking=false,authenticated=false;
  const paused=new Promise(resolve=>{release=resolve;});
  const settled=new Promise(resolve=>{completed=resolve;});
  const cancelled=new Set();
  const client=await desktop(path.join(directory,'profile'),await freePort(),async (page,origin)=>{
    await page.route(origin+'/api/qishui/**',async route=>{
      const url=new URL(route.request().url()).pathname;
      if(url.endsWith('/login-status'))return route.fulfill({json:{authenticated,
        ...(authenticated?{user:{nickname:'固定数据'}}:{})}});
      if(url.endsWith('/login/start'))return route.fulfill({json:{sessionId:'fixture-qr-'+(++created),qrImage:'/assets/sonic-icon.png'}});
      if(url.endsWith('/login/cancel')){
        cancelled.add(route.request().postDataJSON()?.sessionId);
        return route.fulfill({json:{ok:true}});
      }
      if(url.endsWith('/login/check')){
        const id=route.request().postDataJSON()?.sessionId;
        if(id!=='fixture-qr-1')return route.fulfill({json:{state:'expired'}});
        checking=true;
        await paused;
        if(!cancelled.has(id))authenticated=true;
        completed();
        return route.fulfill({json:{state:authenticated?'confirmed':'expired'}}).catch(()=>{});
      }
      return route.fulfill({json:{items:[]}});
    });
  });
  const {page}=client;
  try{
    await page.evaluate(()=>SonicPlayback.openOnline());
    const login=page.locator('#onlineLoginBtn');
    const check=page.waitForRequest(request=>request.url().endsWith('/login/check'));
    await login.click();
    await check;
    for(let i=0;!checking&&i<20;i++)await wait(25);
    assert.equal(checking,true);
    const cancelRequest=baseline?null:page.waitForResponse(response=>response.url().endsWith('/login/cancel'));
    await page.locator('#onlineLoginCancelBtn').click();
    if(cancelRequest)assert.equal((await cancelRequest).status(),200);
    await page.locator('#onlineLoginCard').waitFor({state:'hidden'});
    release();
    await settled;
    assert.equal((await snapshot(page)).onlineLoggedIn,false);
    assert.equal(authenticated,baseline);
    if(baseline){
      console.log('改前 · 取消时没有通知会话服务；迟到的确认已把会话变为登录，但窗口仍显示未登录。');
      return;
    }
    console.log('改后 · 取消已通知会话服务；迟到确认未建立会话。');
    await login.click();
    await page.locator('#onlineLoginCard[data-state=expired]').waitFor();
    assert.match(await page.locator('#onlineLoginTitle').innerText(),/过期|失效/);
    assert.match(await page.locator('#onlineLoginStatus').innerText(),/重新生成/);
    assert.equal((await snapshot(page)).onlineLoggedIn,false);
    console.log('固定数据 · 二维码过期后显示过期提示，可再次发起扫码。');
  }finally{release();await client.app.close().catch(()=>{});}
}

async function testLiveSearch(directory) {
  const client = await desktop(path.join(directory,'profile'),await freePort());
  const {page} = client;
  try {
    const room = page.locator('#listeningRoom');
    await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
    await room.locator('[data-sl-search-source=qishui]').click();
    const input = room.getByRole('searchbox',{name:'搜索音乐',exact:true});
    const feedback = room.locator('[data-sl-qishui-status]');
    const captureSearch = async (action,query) => {
      const received = page.waitForResponse(response => response.url().endsWith('/api/qishui/search')
        && response.request().postDataJSON()?.query === query,{timeout:20000}).catch(()=>null);
      await action();
      const response = await received;
      const body=response?await response.json().catch(()=>null):null;
      const sourceItems=body?.items||[];
      if(response)console.log('汽水 HTTP '+response.status()+'，来源前五条 '+JSON.stringify(sourceItems.slice(0,5).map(track=>
        [track.name,track.artist,track.album,track.duration])));
      await feedback.filter({hasNotText:'正在搜索汽水音乐'}).waitFor();
      return {
        sourceItems,
        suggestions:(await room.locator('#sl-suggestions button').allTextContents()).slice(0,5),
        submitted:await room.locator('[data-sl-qishui-track]').evaluateAll(rows=>rows.slice(0,5).map(row=>({
          title:row.querySelector('.sl-qishui-title').textContent,
          meta:row.querySelector('.sl-qishui-meta').textContent,
          status:[...row.querySelectorAll('.sl-qishui-badge')].map(badge=>badge.textContent),
        }))),
        status:await feedback.innerText(),
      };
    };
    const editionQueries=process.argv.includes('--edition-queries');
    const queries=editionQueries?['当你 林俊杰','Always Online 林俊杰',...searchEditionCases.map(({query})=>query)]:
      baseline?['当你 林俊杰']:['当你 林俊杰','当你 王心凌','当你','Always Online 林俊杰','当你 林俊杰 Live'];
    for (const query of queries) {
      const preview = await captureSearch(()=>input.fill(query),query);
      console.log(query+' · 联想 '+JSON.stringify(preview.suggestions)+' · '+preview.status);
      const formal = await captureSearch(()=>input.press('Enter'),query);
      console.log(query+' · 正式 '+JSON.stringify(formal.submitted)+' · '+formal.status);
      const rows = await room.locator('[data-sl-qishui-track]').evaluateAll(rows=>rows.map(row=>[
        row.querySelector('.sl-qishui-title').textContent,row.querySelector('.sl-qishui-meta').textContent,
      ]));
      console.log(query+' · 候选核对 '+JSON.stringify({
        wang:rows.filter(([title,meta])=>title==='当你'&&meta.startsWith('王心凌 ·')),
        jj:rows.filter(([title,meta])=>title==='当你'&&meta.startsWith('林俊杰 ·')),
        english:rows.filter(([title,meta])=>title.toLowerCase()==='always online'&&meta.startsWith('林俊杰 ·')),
        jjLive:rows.filter(([title,meta])=>title.startsWith('当你')&&meta.startsWith('林俊杰 ·')&&/现场|live/i.test(title+' '+meta)),
      }));
      if(editionQueries){
        if(query==='当你 林俊杰'||query==='Always Online 林俊杰'){
          const title=query==='当你 林俊杰'?'当你':'Always Online';
          assert.ok(preview.suggestions[0]?.startsWith(title+' · 林俊杰 · '));
          assert.equal(formal.submitted[0]?.title,title);
          assert.ok(formal.submitted[0].meta.startsWith('林俊杰 · '));
        }else{
          const {tracks}=searchEditionCases.find(test=>test.query===query);
          const plain=tracks[1];
          const matches=formal.sourceItems.filter(track=>{
            const title=track.name.normalize('NFKC').toLowerCase(), base=plain.name.toLowerCase();
            const artists=track.artist.toLowerCase().split(/[、,;\/&]+/).map(artist=>artist.trim());
            return title.startsWith(base)&&(title.length===base.length||/^[\s([\-–—]/.test(title.slice(base.length)))
              && artists.includes(plain.artist.toLowerCase());
          });
          const live=matches.filter(track=>{
            const suffix=track.name.normalize('NFKC').slice(plain.name.length);
            return /\blive\b|现场|現場/i.test(suffix)||/\blive(?:$| (?:at|from|version|recording|album)\b)|现场|現場|演唱[会會]/i.test(track.album);
          });
          const describe=items=>items.map(track=>[track.name,track.artist,track.album]);
          console.log('真实汽水目标核对 '+JSON.stringify({query,count:formal.sourceItems.length,targets:describe(matches),live:describe(live)}));
        }
      }
      if(query===queries[0])await capture(page,baseline?'search-live-before':'search-live-after');
    }
    if (process.argv.includes('--check-first')) {
      const term=queries[0];
      await captureSearch(()=>input.fill(term),term);
      const result=room.locator('[data-sl-qishui-row]').filter({hasText:'林俊杰 · 她说 概念自选辑'}).first();
      if(await result.count()){
        await result.getByRole('button',{name:/检查可播状态/}).click();
        await feedback.filter({hasNotText:'正在检查'}).waitFor();
        const labels=await result.locator('.sl-qishui-badge').allTextContents();
        console.log('真实汽水 · 检查林俊杰《当你》 '+JSON.stringify({labels,message:await feedback.innerText()}));
        if(process.argv.includes('--play-first')&&labels.some(label=>['仅试听','可播整曲'].includes(label))){
          const play=result.locator('[data-sl-qishui-track]');
          const id=await play.getAttribute('data-track-id');
          await play.click();
          const active=await checkPlaying(page,id,.1);
          assert.equal(active.audioPreview,labels.includes('仅试听'));
          await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
          assert.equal(await input.inputValue(),term);
          console.log('真实汽水 · 从正式结果点播林俊杰《当你》，所选音频开始'+(active.audioPreview?'试听':'播放整曲')+'，返回保留关键词。');
        }
      }
    }
  } finally { await client.app.close().catch(()=>{}); }
}

async function main() {
  const item = process.argv.find(value => /^(\d{2}|local-file-(?:playlists|safety)|search-live|search-ranking|search-labels|search-editions|qishui-auth-availability|qishui-qr-cancel)$/.test(value));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sonic-next-' + item + '-'));
  console.log('Electron ' + (binary || '开发版 ' + repo) + ' · 独立测试目录 ' + directory);
  if (item === '01') await testResume(directory);
  else if (item === '06') await testFirstRun(directory);
  else if (item === '12') await testNavigation(directory);
  else if (item === 'local-file-playlists') await testLocalFilePlaylists(directory);
  else if (item === 'local-file-safety') await testLocalFileSafety(directory);
  else if (item === 'search-live') await testLiveSearch(directory);
  else if (item === 'search-editions') await testSearchEditions(directory);
  else if (item === 'qishui-auth-availability') await testQishuiAuthAvailability(directory);
  else if (item === 'qishui-qr-cancel') await testQishuiQrCancel(directory);
  else if (item === 'search-ranking') await testSearchRanking(directory);
  else if (item === 'search-labels') await testSearchRanking(directory,true);
  else throw new Error('Provide a supported check number.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
