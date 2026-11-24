'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const qa = path.join(root, 'work', 'desktop-qa');
const packaged = process.argv.includes('--packaged');
const quarantineOnly = process.argv.includes('--quarantine-only');
const executablePath = packaged
  ? path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE || path.join(root, 'release', 'win-unpacked', '声波宇宙.exe'))
  : require('electron');
const capture = process.argv.includes('--capture');
const origin = 'http://127.0.0.1:18864';

async function checkQuarantinePackage() {
  const checkMain = main => {
    assert.doesNotMatch(main, /createWallpaperController|WallpaperHost|wallpaper\.cjs|getNativeWindowHandle\(|setIgnoreMouseEvents\(/i,
      'Desktop main code must not load the wallpaper controller or attach a native window');
  };
  const checkDescriptor = descriptor => {
    assert.ok(Object.values(descriptor.scripts||{}).every(script=>!script.includes('build-wallpaper')),
      'Desktop lifecycle scripts must not build the wallpaper helper');
    const unpack=descriptor.build?.asarUnpack||[];
    assert.ok(unpack.every(entry=>!entry.toLowerCase().includes('wallpaperhost')),
      'The wallpaper helper must not be unpacked');
  };
  checkDescriptor(JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')));
  if(!packaged){
    checkMain(await fs.readFile(path.join(root,'desktop','main.cjs'),'utf8'));
    return;
  }

  const {listPackage,extractFile}=require('@electron/asar');
  const resources=path.join(path.dirname(executablePath),'resources');
  const archive=path.join(resources,'app.asar');
  const files=listPackage(archive).map(file=>file.replaceAll('\\','/').toLowerCase());
  for(const filename of ['wallpaperhost.exe','wallpaper.cjs']){
    assert.ok(!files.some(file=>file.endsWith('/'+filename)),filename+' is still shipped in app.asar');
  }
  await assert.rejects(fs.access(path.join(resources,'app.asar.unpacked','desktop','native','WallpaperHost.exe')),{code:'ENOENT'});
  assert.ok(files.some(file=>file.endsWith('/desktop/native/nowplayinghost.exe')),
    'Now Playing metadata helper must still ship');
  await fs.access(path.join(resources,'app.asar.unpacked','desktop','native','NowPlayingHost.exe'));
  const manifest=JSON.parse(extractFile(archive,'package.json').toString('utf8'));
  assert.equal(manifest.main,'desktop/main.cjs');
  checkMain(extractFile(archive,'desktop/main.cjs').toString('utf8'));
}

async function verifyWallpaperQuarantine(app,page,room) {
  const settings=await page.evaluate(()=>sonicDesktop.settings());
  assert.equal(settings.wallpaper,false);
  assert.equal(settings.wallpaperAvailable,false);
  await room.locator('[data-action="desktop"]').click();
  const dialog=room.locator('[data-desktop-dialog]');
  await dialog.waitFor();
  const pauseNotice=/动态桌面.*(?:暂停|停用|关闭|不可用)/;
  await dialog.getByText(pauseNotice).waitFor();
  assert.equal(await dialog.locator('[data-wallpaper-enter], [data-wallpaper-exit]').count(),0);
  assert.ok(await dialog.getByRole('button',{name:'迷你播放器',exact:true}).isVisible());
  await dialog.getByRole('button',{name:'关闭桌面设置',exact:true}).click();

  const windowState=()=>app.evaluate(({BrowserWindow},url)=>{
    const window=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().startsWith(url));
    return {
      bounds:window.getBounds(),visible:window.isVisible(),
      minimized:window.isMinimized(),fullScreen:window.isFullScreen(),normal:window.isNormal(),
    };
  },origin);
  const before=await windowState();
  assert.ok(before.visible&&before.normal&&!before.minimized&&!before.fullScreen);
  if(packaged){
    // The archive and unpacked files were checked before any Electron process launched.
    const denial=await page.evaluate(()=>sonicDesktop.wallpaper(true));
    assert.equal(denial.ok,false,denial.message);
    assert.match(denial.message,pauseNotice);
  }
  assert.deepEqual(await windowState(),before);
  assert.equal(await page.evaluate(()=>SonicListeningRoom.stats().wallpaper),false);
  await room.locator('[data-room-mode="listen"]').click();
  assert.equal(await room.getAttribute('data-mode'),'listen');
  await room.locator('[data-room-mode="work"]').click();
  assert.equal(await room.getAttribute('data-mode'),'work');
  console.log('PASS wallpaper quarantine, disabled settings and ordinary window navigation');
}

async function run() {
  await checkQuarantinePackage();
  await fs.mkdir(qa, { recursive:true });
  const profile = await fs.mkdtemp(path.join(qa, 'profile-'));
  const app = await _electron.launch({
    executablePath, args:packaged?[]:[root], cwd:root, timeout:30000,
    env:{ ...process.env, SONIC_DESKTOP_PROFILE:profile, SONIC_DESKTOP_PORT:'18864' },
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error=>errors.push(error.message));
    const room = page.locator('#listeningRoom');
    if(quarantineOnly){
      await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready);
      await verifyWallpaperQuarantine(app,page,room);
      assert.deepEqual(errors,[]);
      return;
    }
    const fixtureAudio = await fs.readFile(path.join(root,'outputs','interstellar-drift.mp3'));
    await page.route('**/api/qishui/search',route=>route.fulfill({json:{items:[
      {provider:'qishui',mediaId:'1001',name:'测试歌曲',artist:'测试音源',duration:96},
    ]}}));
    await page.route('**/api/qishui/tracks/1001/audio',route=>route.fulfill({json:{streamPath:'/media/listening-room-smoke',preview:true,clipStartMs:10000}}));
    await page.route('**/api/qishui/tracks/1001/cover',route=>route.fulfill({path:path.join(root,'outputs','assets','sonic-icon.png')}));
    await page.route('**/api/qishui/songs/1001/lyrics',route=>route.fulfill({json:{
      type:'krc',lrc:'[00:10.000]入耳\n[00:15.000]再听一句',
      timedLrc:'[00:10.000]<00:10.000>入<00:11.000>耳\n[00:15.000]再听一句',
      krc:'[10000,4500]<0,800,0>入<2300,450,0>耳\n[15000,3400]<0,1200,0>再听<1200,1500,0>一句',
    }}));
    await page.route('**/media/listening-room-smoke',route=>{
      const bytes=fixtureAudio.subarray(0,fixtureAudio.length);
      return route.fulfill({status:206,contentType:'audio/mpeg',headers:{
        'Accept-Ranges':'bytes','Content-Range':`bytes 0-${bytes.length-1}/${bytes.length}`,
      },body:bytes});
    });
    await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready);
    await verifyWallpaperQuarantine(app,page,room);
    await room.locator('[data-art-cover]').waitFor();
    await room.locator('[data-work-queue] [aria-current=true]').waitFor();
    await page.waitForFunction(()=>{
      const color=document.querySelector('#listeningRoom').style.getPropertyValue('--lr-cover-rgb');
      return color&&color!=='196,176,249';
    });
    const countRedraws=()=>page.evaluate(async()=>{
      const start=SonicListeningRoom.stats().frames;
      await new Promise(resolve=>setTimeout(resolve,650));
      return SonicListeningRoom.stats().frames-start;
    });
    await page.waitForFunction(()=>{
      const {frames,fpsLimit}=SonicListeningRoom.stats(),now=performance.now();
      if(!window.lastSmokeFrame||fpsLimit||window.lastSmokeFrame.frames!==frames)window.lastSmokeFrame={frames,now};
      return !fpsLimit&&now-window.lastSmokeFrame.now>=500;
    });
    assert.equal(await countRedraws(),0);
    await room.locator('[data-volume]').fill('0');
    await room.locator('[data-action="play"]').click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().position>.3);
    await page.waitForFunction(()=>{
      const spectrum=document.querySelector('[data-spectrum]');
      const pixels=spectrum.getContext('2d').getImageData(0,0,spectrum.width,spectrum.height-3).data;
      return pixels.some((value,index)=>index%4===3&&value>0);
    });
    const workRendering = await page.evaluate(()=>SonicListeningRoom.stats());
    assert.equal(workRendering.fpsLimit,20);
    assert.equal(workRendering.legacyRendering,false);
    await room.locator('.lr-ambience [data-background=plain]').click();
    await page.waitForFunction(()=>{
      const [r,g,b]=document.querySelector('.lr-background').getContext('2d').getImageData(0,0,1,1).data;
      return r===16&&g===16&&b===25;
    });
    assert.equal(await countRedraws(),0);
    assert.ok(await page.evaluate(()=>SonicPlayback.snapshot().playing));
    await room.locator('.lr-ambience [data-background=geometry]').click();
    console.log('PASS background stays still when paused or plain while playback continues');
    const before = await page.evaluate(()=>SonicPlayback.snapshot().position);
    await room.getByRole('button',{name:'音乐库',exact:true}).click();
    await room.locator('[data-music-library]').waitFor();
    assert.ok(await page.evaluate(()=>SonicPlayback.snapshot().playing));
    assert.equal(await room.locator('[data-sl-tracks] [aria-current=true]').count(),1);
    await room.locator('[data-room-mode="listen"]').click();
    const after=await page.evaluate(()=>SonicPlayback.snapshot());
    assert.ok(after.playing&&after.position>=before);
    await room.locator('.lr-now-cover').click();
    assert.equal(await room.getAttribute('data-lyric-expanded'),'true');
    const selectLyricStyle=async id=>{
      await room.locator('[data-action=lyric-effects]:visible').click();
      await room.locator('button[data-lyric-style="'+id+'"]').click();
      await room.locator('[data-effect-apply]').click();
    };
    await selectLyricStyle('stage');
    assert.ok(await page.evaluate(()=>SonicPlayback.snapshot().playing));
    await room.locator('[data-action="play"]').click();
    await room.locator('.lr-more-lyrics > summary').click();
    await room.getByText('导入或调整歌词', { exact:false }).click();
    await page.locator('#lyricSource').fill('[00:00.00]风经过山脊\n[00:03.00]夜色落在湖面\n[00:08.00]<00:08.00>让<00:09.00>音乐<00:11.00>慢慢流动\n[00:16.00]把这一刻留在身边\n[00:23.00]等远处一点光亮');
    await page.locator('#saveLyricBtn').click();
    await page.locator('#atelierDialog [aria-label="关闭创作台"]').click();
    const beforeScrub=await page.evaluate(()=>SonicPlayback.position());
    await room.locator('[data-seek]').evaluate(slider=>{slider.value='5.5';slider.dispatchEvent(new Event('input',{bubbles:true}));});
    const seekPreview=room.locator('[data-seek-lyrics]');
    await seekPreview.waitFor();
    assert.equal(await seekPreview.locator('[data-seek-line]').textContent(),'夜色落在湖面');
    assert.equal(await page.evaluate(()=>SonicPlayback.position()),beforeScrub);
    await room.locator('[data-seek]').fill('10.5');
    await seekPreview.waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('[data-current-line]').textContent==='让音乐慢慢流动'&&
      [...document.querySelectorAll('[data-current-line] [data-sing="voicing"]')].some(word=>
        word.textContent==='音乐'&&parseFloat(word.style.getPropertyValue('--lr-sung'))===75));
    await room.locator('[data-next-line]').click();
    await page.waitForFunction(()=>document.querySelector('[data-current-line]').textContent==='把这一刻留在身边');
    console.log('PASS playback continuity, timed lyric, lyric seek');

    const lyricsOpened=app.waitForEvent('window',{predicate:window=>window!==page,timeout:15000});
    const desktopLyrics=room.getByRole('button',{name:'桌面歌词',exact:true});
    await desktopLyrics.click();
    const overlay=await lyricsOpened;
    await overlay.waitForFunction(()=>document.getElementById('current')?.textContent==='把这一刻留在身边'&&
      document.getElementById('next')?.textContent==='等远处一点光亮');
    assert.equal(await desktopLyrics.getAttribute('aria-pressed'),'true');
    await overlay.getByRole('button',{name:'关闭桌面歌词'}).click();
    await room.locator('[data-action="desktop-lyrics-window"][aria-pressed="false"]').waitFor();
    console.log('PASS desktop lyric overlay receives current and next lines from the player');

    await selectLyricStyle('fly');
    await room.locator('[data-seek]').fill('7.6');
    assert.equal(await room.locator('[data-flight-state=flying]').count(),0);
    await room.locator('[data-action="play"]').click();
    await page.waitForFunction(()=>{
      const row=document.querySelector('[data-current-line]');
      const glyphs=row?.querySelectorAll('.lr-flight-token');
      return row?.textContent==='让音乐慢慢流动' && !row.style.transform &&
        glyphs[0]?.dataset.flightState==='flying' && /rotate.*scale/.test(glyphs[0].style.transform) &&
        glyphs[1]?.dataset.flightState==='waiting';
    });
    await page.waitForFunction(()=>{
      const glyphs=document.querySelectorAll('[data-current-line] .lr-flight-token');
      return glyphs[0]?.dataset.flightState==='landed' && glyphs[1]?.textContent==='音乐' &&
        glyphs[1].dataset.flightState==='flying' && glyphs[2]?.dataset.flightState==='waiting';
    });
    await room.locator('[data-action="play"]').click();
    await page.waitForFunction(()=>!SonicPlayback.snapshot().playing&&!document.querySelector('[data-flight-state=flying]'));
    assert.equal(await room.locator('[data-current-line]').textContent(),'让音乐慢慢流动');
    console.log('PASS timed word groups enter at native timestamps and settle on pause');
    await selectLyricStyle('stage');

    const miniOpened = app.waitForEvent('window', { predicate:window=>window!==page, timeout:15000 });
    await room.getByRole('button',{name:'迷你播放器',exact:true}).click();
    const mini = await miniOpened;
    await mini.getByRole('button',{name:'播放音乐',exact:true}).click();
    await mini.getByRole('button',{name:'暂停音乐',exact:true}).waitFor();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('http://127.0.0.1:18864')).minimize());
    await page.waitForFunction(()=>SonicListeningRoom.stats().fpsLimit===0);
    const stopped=await page.evaluate(()=>SonicListeningRoom.stats().frames);
    const clock=await mini.locator('#time').textContent();
    await mini.waitForFunction(previous=>document.getElementById('time').textContent!==previous,clock);
    assert.equal(await page.evaluate(()=>SonicListeningRoom.stats().frames),stopped);
    await mini.getByRole('button',{name:'暂停音乐',exact:true}).click();
    await mini.getByRole('button',{name:'播放音乐',exact:true}).waitFor();
    await mini.getByRole('button',{name:'展开',exact:false}).click();
    await room.locator('[data-action="play"]').click();
    await page.waitForFunction(()=>SonicListeningRoom.stats().fpsLimit===30);
    console.log('PASS mini controls and time updates while main drawing is stopped');
    await mini.getByRole('button',{name:'收起迷你播放器'}).click();

    if(capture) {
      await room.locator('.lr-footer [data-action="external"]').click();
      await room.locator('[data-connect]').click();
      try { await page.waitForFunction(()=>SonicPlayback.snapshot().external,{},{timeout:4500}); }
      catch(error){throw new Error('Loopback failed: '+await page.locator('#externalStatus').textContent(),{cause:error});}
      await app.evaluate(async({ BrowserWindow })=>{
        const fixture = new BrowserWindow({show:false,webPreferences:{autoplayPolicy:'no-user-gesture-required',backgroundThrottling:false}});
        await fixture.loadURL('data:text/html,<title>Sonic test tone</title>');
        await fixture.webContents.executeJavaScript(`(async()=>{
          const audio=new AudioContext(); await audio.resume();
          const tone=audio.createOscillator(), volume=audio.createGain();
          tone.frequency.value=220; volume.gain.value=.012;
          tone.connect(volume); volume.connect(audio.destination);
          tone.start(); tone.stop(audio.currentTime+3);
        })()`);
      });
      await page.waitForFunction(()=>SonicPlayback.sample(.05).rms>.0015,{},{timeout:4000});
      await room.locator('[data-disconnect]').click();
      await page.waitForFunction(()=>!SonicPlayback.snapshot().external);
      await room.getByRole('button',{name:'关闭声音联动'}).click();
      console.log('PASS system loopback with a separate test audio source');
    }

    await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
    await room.getByRole('searchbox',{name:'搜索音乐',exact:true}).fill('测试歌曲');
    await room.locator('[data-sl-search-source="qishui"]').click();
    await room.locator('[data-sl-qishui-track]').click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().track?.name==='测试歌曲');
    assert.equal(await page.locator('dialog[open]').count(),0);
    await room.locator('[data-room-mode="listen"]').click();
    await selectLyricStyle('stage');
    await room.locator('[data-action="play"]').click();
    await room.locator('[data-seek]').fill('1.5');
    await page.waitForFunction(()=>{
      const words=document.querySelectorAll('[data-current-line] .lr-lyric-word');
      return words[0]?.dataset.sing==='sung'&&words[1]?.dataset.sing==='waiting';
    });
    await room.locator('[data-next-line]').click();
    await page.waitForFunction(()=>document.querySelector('[data-current-line]')?.textContent==='再听一句');
    const previewPosition=await page.evaluate(()=>SonicPlayback.snapshot().position);
    assert.ok(previewPosition>=5&&previewPosition<8);
    console.log('PASS online search, preview-relative seek and timed online lyrics using a local fixture');
    assert.deepEqual(errors,[]);
  } finally { await app.close(); }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
