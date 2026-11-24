'use strict';
const assert=require('node:assert/strict');
const { once }=require('node:events');
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
async function verifyResumeRestart(launch,profile){
  const titles=['Resume Alpha','Resume Birch','Resume Cedar','Resume Drift'];
  const audio=Buffer.alloc(44+8000*2*32);
  audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
  audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);
  audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
  const snapshot=page=>page.evaluate(()=>SonicPlayback.snapshot({queue:true}));
  const open=async()=>{
    const app=await launch(profile),page=await app.firstWindow();
    await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready);
    return {app,page,child:app.process()};
  };
  async function quit(app){
    const exited=once(app.process(),'exit',{signal:AbortSignal.timeout(10000)});
    await app.evaluate(({app})=>{setTimeout(()=>app.quit(),25);});
    assert.deepEqual(await exited,[0,null]);
  }

  let {app,page,child}=await open();
  let saved,sourceIds;
  try{
    await page.locator('#fileInput').setInputFiles(titles.map(title=>({name:title+'.wav',mimeType:'audio/wav',buffer:audio})));
    await page.waitForFunction(titles=>titles.every(title=>SonicPlayback.library().tracks.some(track=>track.name===title)),titles);
    sourceIds=await page.evaluate(async titles=>{
      const ids=titles.map(name=>SonicPlayback.library().tracks.find(track=>track.name===name).id);
      const playlist=SonicPlayback.savePlaylist('续听测试歌单');
      await SonicPlayback.editPlaylistMembership(playlist,ids,true);
      await SonicPlayback.playFromLibrary(ids[0],playlist,true);
      SonicPlayback.queueTrack(ids[0],'end');
      const queue=SonicPlayback.snapshot({queue:true}).queue;
      const duplicate=queue.at(-1);
      if(duplicate?.id!==ids[0]||!SonicPlayback.moveQueueEntry(duplicate.entryId,queue[1].entryId)){
        throw new Error('Could not place the explicitly appended duplicate after the current song');
      }
      await SonicPlayback.selectQueueEntry(duplicate.entryId);
      SonicPlayback.seek(12.4);
      return ids;
    },titles);
    await page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.position()>=12.4);
    saved=await page.evaluate(([,birch,,drift])=>{
      const before=SonicPlayback.snapshot({queue:true});
      const entry=id=>before.queue.find(item=>item.id===id).entryId;
      if(!SonicPlayback.moveQueueEntry(entry(drift),entry(birch)))throw new Error('Could not reorder the queue');
      const after=SonicPlayback.snapshot({queue:true});
      return {position:after.position,ids:after.queue.map(item=>item.id),index:after.queue.findIndex(item=>item.entryId===after.queueEntryId)};
    },sourceIds);
    await quit(app);
  }finally{if(child.exitCode===null)await app.close();}

  ({app,page,child}=await open());
  try{
    const resume=page.locator('[data-home-resume]');
    await resume.waitFor();
    assert.equal(await resume.locator('[data-resume-label]').textContent(),'继续听');
    assert.equal(await resume.locator('[data-resume-title]').textContent(),titles[0]);
    assert.deepEqual(saved.ids,[sourceIds[0],sourceIds[0],sourceIds[3],sourceIds[1],sourceIds[2]]);
    assert.equal(saved.index,1);
    const paused=await snapshot(page);
    assert.equal(paused.playing,false);
    assert.equal(paused.queueScope,'续听测试歌单');
    assert.deepEqual(paused.queue.map(item=>item.id),saved.ids);
    assert.equal(paused.queueEntryId,paused.queue[saved.index].entryId);
    assert.ok(paused.position>=saved.position-.05&&paused.position<saved.position+1.5,`${saved.position} -> ${paused.position}`);
    assert.equal(await page.evaluate(()=>document.getElementById('audio').paused),true);
    await page.locator('.lr-player [data-action="queue"]').click();
    assert.equal(await page.locator('[data-queue-next-title]').textContent(),titles[3]);
    await page.keyboard.press('Escape');
    await resume.click();
    await page.waitForFunction(position=>SonicPlayback.snapshot().playing&&SonicPlayback.position()>position+.1,paused.position);
    const continued=await snapshot(page);
    assert.equal(continued.queueEntryId,paused.queueEntryId);
    assert.deepEqual(await page.evaluate(()=>SonicPlayback.library().playlists.find(item=>item.name==='续听测试歌单').trackIds),sourceIds);
    await page.locator('.lr-player [data-action="play"]').click();
    saved.position=await page.evaluate(()=>SonicPlayback.position());
    await page.evaluate(ids=>new Promise((resolve,reject)=>{
      const open=indexedDB.open('sonic-universe-library',1);
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const db=open.result,tx=db.transaction('media','readwrite'),store=tx.objectStore('media');
        ids.forEach(id=>store.delete(id));
        tx.oncomplete=()=>{db.close();resolve();};
        tx.onabort=()=>{db.close();reject(tx.error);};
      };
    }),[sourceIds[0],sourceIds[3]]);
    await quit(app);
  }finally{if(child.exitCode===null)await app.close();}
  console.log('PASS real quit immediately after reorder restores the paused position and exact duplicate queue entry');

  ({app,page}=await open());
  try{
    const resume=page.locator('[data-home-resume]');
    await page.locator('[data-resume-skip]').waitFor();
    assert.equal(await resume.locator('[data-resume-title]').textContent(),titles[0]);
    assert.equal(await resume.locator('[data-resume-label]').textContent(),'重试续听');
    assert.deepEqual((await snapshot(page)).queue.map(item=>item.id),saved.ids);
    await resume.click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().playbackRecovery?.reason==='file'&&!SonicPlayback.snapshot().playbackRecovery?.phase);
    const held=await snapshot(page);
    assert.equal(held.track.id,sourceIds[0]);
    assert.equal(held.playing,false);
    assert.ok(Math.abs(held.position-saved.position)<.1);
    await page.locator('[data-resume-skip]').click();
    await page.waitForFunction(id=>SonicPlayback.snapshot().track?.id===id&&SonicPlayback.snapshot().playing,sourceIds[1]);
    const next=await snapshot(page);
    assert.deepEqual(next.queue.map(item=>item.id),saved.ids);
    assert.ok(next.position<2,'the accepted next song starts at its own beginning');
  }finally{await app.close();}
  console.log('PASS missing saved audio can be retried in place or skipped in the stored order');
}
async function main(){
  const qa=path.join(repo,'work','desktop-qa');
  await fs.mkdir(qa,{recursive:true});
  const profile=await fs.mkdtemp(path.join(qa,'lifecycle-profile-'));
  const launch=profile=>_electron.launch({
    executablePath,args:packaged?[]:[repo],cwd:repo,timeout:25000,
    env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)},
  });
  const app=await launch(profile);
  app.process().stderr?.on('data',chunk=>{const content=chunk.toString();if(/\[Desktop\]|Unhandled|Warning/.test(content))process.stderr.write(content);});
  try {await verify(app);}
  finally {await app.close();}
  await assert.rejects(fetch(origin+'/health'));
  console.log('PASS isolated desktop quit closes its loopback service');
  await verifyResumeRestart(launch,await fs.mkdtemp(path.join(qa,'resume-profile-')));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
