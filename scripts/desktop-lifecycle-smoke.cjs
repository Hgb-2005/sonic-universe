'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const repo=path.resolve(__dirname,'..');
const { _electron }=require('playwright');
const port=18893;
const origin='http://127.0.0.1:'+port;
const packaged=process.argv.includes('--packaged');
const executablePath=packaged?
  path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE||path.join(repo,'release','win-unpacked','声波宇宙.exe')):
  require('electron');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=10000){
  const limit=performance.now()+timeout;
  let result;
  while(performance.now()<limit){result=await check();if(result)return result;await sleep(80);}
  throw Error('Timed out '+label+': '+JSON.stringify(result));
}
async function verify(app){
  const info=()=>app.evaluate(({BrowserWindow},origin)=>{
    return BrowserWindow.getAllWindows().map(window=>{
      const wc=window.webContents;
      const url=wc.getURL();
      const kind=url.startsWith(origin)?'main':url.includes('/mini.html')?'mini':url.includes('/desktop-lyrics.html')?'lyrics':'other';
      return {kind,id:window.id,visible:window.isVisible(),minimized:window.isMinimized(),pid:wc.getOSProcessId(),crashed:wc.isCrashed(),bounds:window.getBounds()};
    });
  },origin);
  const snapshot=async(id,expression)=>app.evaluate(({BrowserWindow},{id,expression})=>{
    const window=BrowserWindow.fromId(id);
    if(!window||window.isDestroyed()||window.webContents.isCrashed())return null;
    return window.webContents.executeJavaScript(expression).catch(()=>null);
  },{id,expression}).catch(()=>null);
  const appState=id=>snapshot(id,'(()=>{const p=window.SonicPlayback?.snapshot({queue:true}),s=window.SonicListeningRoom?.stats();return p&&s&&{ready:p.ready,playing:p.playing,time:p.position,track:p.track?.name,frames:s.frames,fps:s.fpsLimit,mode:document.querySelector("#listeningRoom").dataset.mode,lyrics:document.querySelector("[data-action=desktop-lyrics-window]").getAttribute("aria-pressed")}})()');
  const getWindow=(kind)=>info().then(rows=>rows.find(row=>row.kind===kind));
  const page=await app.firstWindow();
  await app.evaluate(({Tray})=>{
    Tray.prototype.displayBalloon=options=>{globalThis.sonicLifecycleNotice=options.title;};
  });
  await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready);
  const main=(await getWindow('main')).id;
  await page.evaluate(()=>SonicPlayback.setVolume(0));
  await page.locator('#listeningRoom [data-action="play"]').click();
  await page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().position>.15);
  await page.evaluate(()=>SonicPlayback.seek(8));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sonic-universe-session'))?.position>=7);
  await page.evaluate(()=>sonicDesktop.mini());
  const mini=await until(async()=>{
    const row=await getWindow('mini');
    return row?.visible&&row;
  },'mini');
  const opened=await page.evaluate(()=>sonicDesktop.desktopLyrics());
  assert.equal(opened.ok,true,opened.message);
  const lyrics=await until(async()=>{
    const row=await getWindow('lyrics');
    return row?.visible&&row;
  },'lyrics');
  await until(async()=>await snapshot(mini.id,'document.querySelector("#play")?.getAttribute("aria-label")')==='暂停音乐','mini playing');
  const event=name=>app.evaluate(({powerMonitor},name)=>powerMonitor.emit(name),name);
  await event('lock-screen');await event('suspend');await event('resume');
  await until(async()=>{
    const state=await appState(main),overlay=await getWindow('lyrics');
    return state?.fps===0&&state.playing&&!overlay?.visible&&true;
  },'resume is still locked');
  const stopped=await appState(main);
  await sleep(450);
  const still=await appState(main);
  assert.equal(still.frames,stopped.frames);
  assert.ok(still.time>stopped.time);
  await event('unlock-screen');
  await until(async()=>{
    const state=await appState(main),overlay=await getWindow('lyrics');
    return state?.fps>0&&overlay?.visible;
  },'unlock restores rendering and overlay');
  await event('suspend');await event('lock-screen');await event('unlock-screen');
  await until(async()=>!(await getWindow('lyrics'))?.visible&&(await appState(main))?.fps===0,'unlock is still asleep');
  await event('resume');
  await until(async()=>(await getWindow('lyrics'))?.visible&&(await appState(main))?.fps>0,'resume restores after unlock');
  console.log('PASS overlapping synthetic Windows lock/suspend events pause drawing and lyrics without interrupting audio');

  const after=(await getWindow('main'));
  assert.notEqual(after.pid,mini.pid);
  assert.notEqual(after.pid,lyrics.pid);
  await app.evaluate(({BrowserWindow},id)=>{
    const win=BrowserWindow.fromId(id);
    win.close();
  },main);
  await until(async()=>!(await getWindow('main'))?.visible,'close hides to tray');
  const initial=await appState(main);
  const crash=id=>app.evaluate(({BrowserWindow},id)=>{
    BrowserWindow.fromId(id)?.webContents.forcefullyCrashRenderer();
  },id);
  await page.evaluate(()=>sonicDesktop.authorizeCapture()).then(
    ()=>assert.fail('hidden window cannot authorize capture'),
    ()=>{});
  const crashed=page.waitForEvent('crash',{timeout:8000});
  await crash(main);
  await crashed;
  const recovered=await until(async()=>{
    const row=await getWindow('main'),state=await appState(main);
    return row?.id===main&&row?.pid!==after.pid&&state?.ready&&{row,state};
  },'main auto reload in same window',15000);
  assert.equal(recovered.row.visible,false);
  assert.deepEqual(recovered.row.bounds,after.bounds);
  assert.equal(recovered.state.playing,false);
  assert.equal(recovered.state.track,initial.track);
  assert.ok(recovered.state.time>=7,recovered.state.time);
  await until(async()=>await snapshot(mini.id,'document.querySelector("#play")?.getAttribute("aria-label")')==='播放音乐','mini stopped on main crash');
  await until(async()=> (await appState(main)).lyrics==='true','lyrics toolbar restores open status');
  await snapshot(mini.id,'document.querySelector("[data-command=show]").click()');
  await until(async()=>(await getWindow('main'))?.visible,'mini restores main');
  console.log('PASS real renderer crash reloads same hidden window, restores checkpoint/tray visibility, and stops stale mini playback');

  // Within the retry window a second crash must wait for a deliberate user action.
  const current=(await getWindow('main')).pid;
  await crash(main);
  await until(async()=>{
    const win=await getWindow('main');
    return win?.crashed&&!win.visible;
  },'second crash rate-limited');
  await sleep(650);
  assert.equal((await getWindow('main')).crashed,true);
  assert.equal(await app.evaluate(()=>globalThis.sonicLifecycleNotice),'声波宇宙已收起');
  await snapshot(mini.id,'document.querySelector("[data-command=show]").click()');
  await until(async()=>{
    const row=await getWindow('main'),state=await appState(main);
    return row?.id===main&&row?.pid!==current&&row?.visible&&state?.ready;
  },'manual reload via mini',15000);
  console.log('PASS repeated renderer crash stops automatic retries and mini Expand requests a user-driven reload');

  await crash(lyrics.id);
  await until(async()=>!(await info()).some(row=>row.id===lyrics.id),'discarded crashed overlay');
  assert.equal((await appState(main)).ready,true);
  await until(async()=> (await appState(main)).lyrics==='false','lyrics toolbar clears after crash');
  assert.equal((await snapshot(main,'sonicDesktop.desktopLyrics()')).ok,true);
  const overlay=await until(async()=>{
    const row=await getWindow('lyrics');
    return row?.id!==lyrics.id&&row?.visible&&row;
  },'fresh overlay after crash');
  if(overlay.pid===mini.pid)console.log('Mini and lyrics share a renderer in this profile');
  const currentMini=await getWindow('mini');
  if(currentMini){
    await crash(currentMini.id);
    await until(async()=>!(await info()).some(row=>row.id===currentMini.id),'discarded crashed mini');
  }
  assert.equal(await snapshot(main,'sonicDesktop.mini()'),true);
  await until(async()=> (await getWindow('mini'))?.visible,'fresh mini after crash');
  console.log('PASS crashed overlay and mini are discarded and can reopen without changing the main renderer');
}
async function main(){
  const qa=path.join(repo,'work','desktop-qa');
  await fs.mkdir(qa,{recursive:true});
  const profile=await fs.mkdtemp(path.join(qa,'lifecycle-profile-'));
  const app=await _electron.launch({
    executablePath,args:packaged?[]:[repo],cwd:repo,timeout:25000,
    env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)},
  });
  app.process().stderr?.on('data',chunk=>{const content=chunk.toString();if(/\[Desktop\]|Unhandled|Warning/.test(content))process.stderr.write(content);});
  try {await verify(app);}
  finally {await app.close();}
  await assert.rejects(fetch(origin+'/health'));
  console.log('PASS isolated desktop quit closes its loopback service');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
