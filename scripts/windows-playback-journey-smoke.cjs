'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');

const repo = path.resolve(__dirname,'..');
const port = 18983;
const origin = 'http://127.0.0.1:'+port;
const binary = process.env.SONIC_DESKTOP_EXECUTABLE;
const titles = Array.from({length:30},(_,index) => 'Windows Flow '+String(index+1).padStart(2,'0'));
const testedTitle = titles[13];
const timedLine = '沿着星光望见林间最亮的一片夜空，把这一段很长很长的歌词也和它的译文完整地留在眼前。';
const translation = 'We watch the brightest stretch of night sky between the trees and let the whole line stay in view.';
const ordinary = '这是一句普通 LRC 歌词';
const tests = [
  {name:'普通窗口', width:1360, height:900},
  {name:'最小桌面窗口', width:760, height:580},
  {name:'Windows 原生全屏', width:1360, height:900, fullscreen:true, checkIdle:true},
  {name:'最小桌面窗口与省电', width:760, height:580, energy:true, checkIdle:true},
];

async function writeFixtures(directory) {
  const samples = 8000*30;
  const wav = Buffer.alloc(44+samples*2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28);
  wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
  for(let index=0;index<samples;index++)wav.writeInt16LE(Math.round(Math.sin(index*Math.PI*440/8000)*1500),44+index*2);
  const tail = Array.from({length:18},(_,index) =>
    '[00:'+String(index+12).padStart(2,'0')+'.00]第 '+(index+1)+' 段全文阅读歌词').join('\n');
  await Promise.all(titles.flatMap(title=>[
    fs.writeFile(path.join(directory,title+'.wav'),wav),
    fs.writeFile(path.join(directory,title+'.lrc'),title===testedTitle?
      '[00:00.00]夜幕降临\n[00:08.00]<00:08.00>沿着<00:09.00>'+timedLine.slice(2)+'\n'+tail:
      '[00:00.00]'+ordinary+'\n[00:08.00]远处的星光'),
    ...(title===testedTitle?[fs.writeFile(path.join(directory,title+'.translation.lrc'),'[00:08.00]'+translation)]:[]),
  ]));
}

const state = page => page.evaluate(() => SonicPlayback.snapshot({queue:true}));
const pageScroll = page => page.evaluate(() => window.scrollY);
const nativeFullscreen = app => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isFullScreen());

async function quit(app) {
  const exited=once(app.process(),'exit',{signal:AbortSignal.timeout(12000)});
  await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});
  assert.deepEqual(await exited,[0,null]);
}

async function launch(profile,config) {
  const app=await _electron.launch({executablePath:binary?path.resolve(binary):require('electron'),
    args:[...(binary?[]:[repo]),'--mute-audio'], cwd:repo,timeout:30000,
    env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)}});
  try {
    const page=await app.firstWindow();
    page.setDefaultTimeout(9000);
    await page.waitForURL(url=>url.origin===origin);
    await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready);
    const dimensions=await app.evaluate(({BrowserWindow},{width,height})=>{
      const window=BrowserWindow.getAllWindows()[0];
      window.setSize(width,height);
      return {window:window.getSize(),content:window.getContentSize()};
    },config);
    assert.ok(dimensions.window.every((size,index)=>Math.abs(size-[config.width,config.height][index])<=3),dimensions.window.join('×'));
    await page.waitForFunction(([width,height])=>Math.abs(innerWidth-width)<=2&&Math.abs(innerHeight-height)<=2,dimensions.content);
    await page.emulateMedia({reducedMotion:'no-preference'});
    return {app,page,child:app.process()};
  }catch(error){await app.close();throw error;}
}

async function revealQueue(room,dock) {
  await dock.locator('[data-action="queue"]').click();
  const dialog=room.locator('[data-queue-dialog]');
  await dialog.waitFor();
  return dialog;
}

async function verifyOnlineInPowerMode(page,wav) {
  const tracks=['9831','9832','9833'].map((mediaId,index)=>({
    provider:'qishui', mediaId, name:'Online flow '+(index+1), artist:'QA', duration:30,
  }));
  const failed=new Set(),outages=new Set(),disconnections=new Set(),previews=new Map(),requests=[];
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return /^https?:$/.test(url.protocol)?route.abort():route.continue();
    if(url.pathname==='/health')return route.fulfill({json:{ok:true,companion:true}});
    if(url.pathname==='/api/qishui/login-status')return route.fulfill({json:{authenticated:true,user:{nickname:'QA'}}});
    if(url.pathname==='/api/qishui/search')return route.fulfill({json:{items:tracks}});
    const ticket=/^\/api\/qishui\/tracks\/(\d+)\/audio$/.exec(url.pathname);
    if(ticket){
      const id=ticket[1];
      requests.push(id);
      if(disconnections.has(id))return route.abort('internetdisconnected');
      if(failed.has(id))return route.fulfill({status:422,json:{code:'not-playable',error:'Fixture unavailable'}});
      if(outages.has(id))return route.fulfill({status:502,json:{code:'network',error:'Fixture network cut'}});
      return route.fulfill({json:{streamPath:'/media/windows-flow/'+id,preview:previews.has(id),clipStartMs:previews.get(id)}});
    }
    if(url.pathname.startsWith('/media/windows-flow/')){
      const range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range||'');
      if(!range)return route.fulfill({contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'},body:wav});
      const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
      if(start>end)return route.fulfill({status:416,headers:{'Content-Range':'bytes */'+wav.length}});
      return route.fulfill({status:206,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',
        'Content-Range':'bytes '+start+'-'+end+'/'+wav.length},body:wav.subarray(start,end+1)});
    }
    if(/^\/api\/qishui\/songs\/\d+\/lyrics$/.test(url.pathname))return route.fulfill({json:{lrc:'[00:00.00]'+ordinary}});
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,json:{error:'Fixture has no endpoint'}});
    return route.continue();
  });
  const reopen=async()=>{
    await page.reload();
    await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready&&window.SonicListeningRoom?.settings().energySaver);
  };
  await reopen();
  const room=page.locator('#listeningRoom'),home=room.locator('[data-home-resume]');
  await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
  await room.getByRole('searchbox',{name:'搜索音乐',exact:true}).fill('Online flow');
  await room.locator('[data-sl-search-source="qishui"]').click();
  await room.locator('[data-sl-qishui-track="'+tracks[0].mediaId+'"]').click();
  const waitPlaying=track=>page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing,track.name);
  await waitPlaying(tracks[0]);
  await page.waitForFunction(()=>document.querySelector('#listeningRoom').dataset.mode==='listen');
  await page.waitForFunction(text=>document.querySelector('[data-preview-line="0"]').textContent===text,ordinary);
  await page.evaluate(items=>SonicPlayback.playOnlineList(items,'窄窗在线测试',items[0].mediaId),tracks);
  await waitPlaying(tracks[0]);
  await page.evaluate(async()=>{SonicPlayback.seek(11);await SonicPlayback.toggle();});
  const position=(await state(page)).position;
  assert.ok(Math.abs(position-11)<.15);
  const before=requests.length;
  await reopen();
  assert.equal(requests.length,before);
  failed.add(tracks[0].mediaId);
  await home.click();
  await room.locator('[data-resume-skip]').waitFor();
  assert.ok(Math.abs((await state(page)).position-position)<.15);
  failed.clear();
  await home.click();
  await waitPlaying(tracks[0]);
  assert.ok((await state(page)).position>=position-.05);
  await room.locator('.lr-player-wrap [data-action="play"]').click();
  await reopen();
  failed.add(tracks[0].mediaId);
  failed.add(tracks[1].mediaId);
  await home.click();
  await room.locator('[data-resume-skip]').click();
  await waitPlaying(tracks[2]);
  assert.ok((await state(page)).position<2);
  console.log('PASS 窄窗与省电下的在线搜索、歌词、音源失败后原位重试和按队列跳过（模拟音源）');

  failed.clear();
  const {localIds,playlist,localDetails}=await page.evaluate(async names=>{
    const localIds=names.map(name=>SonicPlayback.library().tracks.find(track=>track.name===name).id);
    const [first,second]=localIds;
    const playlist=SonicPlayback.savePlaylist('混合队列本地资料验收');
    await SonicPlayback.editPlaylistMembership(playlist,[second,first],true);
    const draft=await SonicPlayback.localTrackDetails(second);
    const icon=await fetch('/assets/sonic-icon.png').then(response=>response.blob());
    const cover=await SonicPlayback.prepareTrackCover(new File([icon],'local-cover.png',{type:'image/png'}));
    await SonicPlayback.saveLocalTrackDetails(second,{...draft,cover,lyricsIntent:'manual',lyricsRaw:'[00:00.00]混合队列手改歌词'});
    return {localIds,playlist,localDetails:await SonicPlayback.localTrackDetails(second)};
  },titles.slice(0,2));
  const remoteIds=tracks.map(track=>'online:qishui:'+track.mediaId);
  const startQueue=ids=>page.evaluate(ids=>SonicPlayback.playFromLibrary(ids[0],'all',true,ids),ids);
  const waitId=id=>page.waitForFunction(id=>SonicPlayback.snapshot().track?.id===id&&SonicPlayback.snapshot().playing,id);
  const mixed=[localIds[0],remoteIds[0],localIds[1]];
  disconnections.add(tracks[0].mediaId);
  await startQueue(mixed);
  await waitId(localIds[0]);
  await page.evaluate(()=>SonicPlayback.seek(SonicPlayback.snapshot().duration-.3));
  await waitId(localIds[1]);
  await room.locator('.lr-toasts').filter({hasText:tracks[0].name}).waitFor();
  assert.deepEqual((await state(page)).queue.map(item=>item.id),mixed);
  assert.equal((await state(page)).onlineReady,false);
  disconnections.clear();

  const onlineThenLocal=[remoteIds[0],remoteIds[1],localIds[1]];
  await startQueue(onlineThenLocal);
  await waitId(remoteIds[0]);
  assert.equal((await state(page)).onlineReady,true);
  await page.evaluate(async()=>{SonicPlayback.seek(11);await SonicPlayback.toggle();});
  const checkpoint=(await state(page)).position;
  const ticketsBeforeReload=requests.length;
  await reopen();
  assert.equal(requests.length,ticketsBeforeReload);
  previews.set(tracks[0].mediaId,20000);
  await home.click();
  await room.locator('[data-resume-status]').filter({hasText:'当前音源不包含上次的播放进度'}).waitFor();
  assert.ok(Math.abs((await state(page)).position-checkpoint)<.15);
  previews.clear();
  await home.click();
  await waitId(remoteIds[0]);
  assert.ok((await state(page)).position>=checkpoint-.05);
  await page.evaluate(()=>SonicPlayback.toggle());
  await reopen();
  outages.add(tracks[0].mediaId);
  outages.add(tracks[1].mediaId);
  await home.click();
  await room.locator('[data-resume-skip]').click();
  await waitId(localIds[1]);
  assert.deepEqual((await state(page)).queue.map(item=>item.id),onlineThenLocal);
  outages.clear();
  assert.deepEqual(await page.evaluate(({id,playlist})=>Promise.all([
    SonicPlayback.localTrackDetails(id), SonicPlayback.library().playlists.find(item=>item.id===playlist).trackIds,
  ]),{id:localIds[1],playlist}),[localDetails,localIds.toReversed()]);
  console.log('PASS 混合队列遇到在线断网继续播本地歌曲，恢复原进度并保留本地歌单、手改歌词和封面');

  previews.set(tracks[2].mediaId,6000);
  await startQueue([remoteIds[2]]);
  await waitId(remoteIds[2]);
  await page.evaluate(async()=>{SonicPlayback.seek(9);await SonicPlayback.toggle();});
  const priorClip=(await state(page)).lyricPosition;
  assert.ok(Math.abs(priorClip-15)<.15);
  await reopen();
  previews.set(tracks[2].mediaId,10000);
  await home.click();
  await waitId(remoteIds[2]);
  const afterClip=await state(page);
  assert.ok(Math.abs(afterClip.lyricPosition-priorClip)<1.0);
  assert.ok(afterClip.position<6);
  console.log('PASS 试听起点变化后，续听定位到原录音的同一时间');
}

async function verifyJourney(profile,fixtures,config) {
  let {app,page,child}=await launch(profile,config);
  let saved;
  try {
    const room=page.locator('#listeningRoom');
    const dock=room.locator(':scope > .lr-player-wrap');
    const searchButton=room.getByRole('button',{name:'搜索音乐',exact:true});
    const settings=room.locator('.lr-header [data-action="settings"]');
    assert.deepEqual(await room.locator('.lr-header-actions button:visible').evaluateAll(buttons=>buttons.filter(button=>{
      const bounds=button.getBoundingClientRect();
      const hit=document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2);
      return bounds.right>innerWidth||!button.contains(hit);
    }).map(button=>button.getAttribute('aria-label'))),[]);
    await room.locator('footer [data-action="playback-settings"]').click();
    await room.locator('[data-energy]').setChecked(config.energy===true);
    await room.locator('[data-playback-dialog] [data-close]').click();
    await page.locator('#folderInput').setInputFiles(fixtures);
    await page.waitForFunction(count=>!SonicPlayback.library().importing&&
      SonicPlayback.library().tracks.filter(track=>track.kind==='file').length===count,titles.length);
    if(config.fullscreen) {
      await room.locator('[data-action="fullscreen"]').click();
      await page.waitForFunction(()=>document.getElementById('listeningRoom').dataset.fullscreen==='true');
      assert.equal(await nativeFullscreen(app),true);
    }
    await searchButton.click();
    const search=room.getByRole('searchbox',{name:'搜索音乐',exact:true});
    await search.fill('Windows Flow');
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await page.mouse.move(viewport.width*.48,viewport.height*.51);
    await page.mouse.wheel(0,650);
    await page.waitForFunction(()=>window.scrollY>100);
    const result=room.getByRole('button',{name:'播放 '+testedTitle,exact:true});
    await result.scrollIntoViewIfNeeded();
    const searchTop=await pageScroll(page);
    assert.ok(searchTop>100);
    await result.click();
    await page.waitForFunction(title=>SonicPlayback.snapshot().track?.name===title&&SonicPlayback.snapshot().playing&&
      SonicPlayback.position()>.1&&document.querySelector('#listeningRoom').dataset.mode==='listen',testedTitle);
    await page.evaluate(()=>{
      window.journeyAudioStops=[];
      const audio=document.getElementById('audio');
      for(const event of ['pause','emptied','error'])audio.addEventListener(event,()=>window.journeyAudioStops.push(event));
    });
    const initial=await state(page);
    await searchButton.click();
    assert.equal(await search.inputValue(),'Windows Flow');
    assert.equal(await pageScroll(page),searchTop);
    await dock.locator('[data-action="now-playing"]').click();
    await room.locator('.lr-more-lyrics > summary').click();
    await room.locator('[data-now-lyrics]').click();
    const full=room.locator('[data-full-lyrics]');
    await full.waitFor();
    await page.waitForFunction(limit=>SonicListeningRoom.stats().fpsLimit===limit,config.energy?30:45);
    const slider=dock.locator('[data-seek]');
    const dragStart=await slider.evaluate(input=>({
      x:6+(input.clientWidth-12)*Number(input.value)/Number(input.max),
      y:input.clientHeight/2,
    }));
    await slider.hover({position:dragStart});
    const sliderBounds=await slider.boundingBox();
    const progressX=time=>sliderBounds.x+6+(sliderBounds.width-12)*time/initial.duration;
    const progressY=sliderBounds.y+sliderBounds.height/2;
    await page.mouse.down();
    await page.mouse.move(progressX(9.8),progressY,{steps:6});
    const overlay=room.locator('[data-seek-lyrics]');
    try{await overlay.waitFor();}
    catch(error){
      const timing=await slider.evaluate(input=>{
        const {track,playing,busy,duration,position,lyrics}=SonicPlayback.snapshot();
        return {track:track?.name,playing,busy,duration,position,value:input.value,visible:document.visibilityState,
          preview:document.querySelector('[data-seek-line]').textContent,lyrics:lyrics.length};
      });
      throw new Error('Seek preview was not visible: '+JSON.stringify(timing),{cause:error});
    }
    assert.equal(await overlay.locator('[data-seek-line]').textContent(),timedLine);
    assert.equal(await overlay.locator('[data-seek-translation]').textContent(),translation);
    assert.ok(await overlay.locator('.lr-timed-group').count()>0);
    assert.ok((await overlay.boundingBox()).y+(await overlay.boundingBox()).height<=(await dock.boundingBox()).y);
    assert.ok((await state(page)).position<8);
    await page.mouse.up();
    await overlay.waitFor({state:'hidden'});
    await page.waitForFunction(()=>SonicPlayback.position()>=9.3&&SonicPlayback.position()<12);

    const beforeKeys=(await state(page)).position;
    await slider.press('ArrowRight');
    await page.waitForFunction(position=>SonicPlayback.position()>=position+4.7&&SonicPlayback.position()<position+6.5,beforeKeys);
    await slider.press('ArrowLeft');
    await page.waitForFunction(position=>Math.abs(SonicPlayback.position()-position)<1.4,beforeKeys);

    const fullBounds=await full.boundingBox();
    await page.mouse.move(fullBounds.x+fullBounds.width/2,fullBounds.y+fullBounds.height*.65);
    await page.mouse.wheel(0,270);
    await room.locator('[data-lyric-follow]').waitFor();
    const readingTop=await full.evaluate(node=>node.scrollTop);
    assert.ok(readingTop>100);
    await room.locator('[data-lyric-full-tools] [data-action="enter-immersion"]').click();
    await page.waitForFunction(()=>document.getElementById('listeningRoom').dataset.listenImmersive==='true');
    if(config.checkIdle) {
      await page.mouse.move(viewport.width*.4,viewport.height*.37);
      await page.waitForFunction(()=>document.getElementById('listeningRoom').dataset.listenControls==='hidden');
      await page.mouse.move(viewport.width*.47,viewport.height*.58);
      await page.waitForFunction(()=>document.getElementById('listeningRoom').dataset.listenControls==='visible');
    }
    const queued=await state(page);
    const index=queued.queue.findIndex(item=>item.entryId===queued.queueEntryId);
    const newNext=queued.queue[index+2];
    assert.ok(newNext&&queued.queue[index+1]);
    const dialog=await revealQueue(room,dock);
    assert.equal(await dialog.locator('[data-queue-current-title]').textContent(),testedTitle);
    assert.ok((await dialog.locator('[data-queue-source-label]').textContent()).trim());
    await dialog.locator('[data-queue-entry="'+newNext.entryId+'"] [data-queue-command="up"]').click();
    await page.waitForFunction(title=>document.querySelector('[data-queue-next-title]').textContent===title,newNext.name);
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.equal(await room.getAttribute('data-listen-immersive'),'true');
    assert.equal(await nativeFullscreen(app),config.fullscreen===true);
    assert.equal(await dock.locator('[data-action="queue"]').evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('Escape');
    await full.waitFor();
    assert.ok(Math.abs(await full.evaluate(node=>node.scrollTop)-readingTop)<3);
    assert.equal(await nativeFullscreen(app),config.fullscreen===true);
    if(config.fullscreen) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.getElementById('listeningRoom').dataset.fullscreen==='false');
      assert.equal(await nativeFullscreen(app),false);
    }
    const afterModes=await state(page);
    assert.equal(afterModes.track.id,initial.track.id);
    assert.equal(afterModes.playing,true);
    assert.deepEqual(await page.evaluate(()=>window.journeyAudioStops),[]);
    await page.evaluate(()=>SonicPlayback.seek(SonicPlayback.snapshot().duration-.45));
    await page.waitForFunction(id=>SonicPlayback.snapshot().track?.id===id&&SonicPlayback.snapshot().playing,newNext.id);
    try{await page.waitForFunction(text=>document.querySelector('[data-full-line][aria-current="true"] .lr-full-text')?.textContent===text,ordinary);}
    catch(error){
      const timing=await page.evaluate(()=>{
        const {track,position,lyricPosition,lyrics}=SonicPlayback.snapshot();
        return {track:track?.name,position,lyricPosition,firstLine:lyrics[0]?.text,
          activeLine:document.querySelector('[data-full-line][aria-current="true"] .lr-full-text')?.textContent};
      });
      throw new Error('Current lyric did not switch with the song: '+JSON.stringify(timing),{cause:error});
    }
    assert.equal(await room.locator('[data-full-line][aria-current="true"] .lr-timed-group').count(),0);
    saved=await page.evaluate(()=>{
      const before=SonicPlayback.snapshot({queue:true});
      const items=before.queue;
      const index=items.findIndex(item=>item.entryId===before.queueEntryId);
      if(!SonicPlayback.moveQueueEntry(items[index+2].entryId,items[index+1].entryId))throw Error('Could not reorder immediately before quit');
      const current=SonicPlayback.snapshot({queue:true});
      return {id:current.track.id,position:current.position,scope:current.queueScope,order:current.queue.map(item=>item.id),
        index:current.queue.findIndex(item=>item.entryId===current.queueEntryId)};
    });
    await quit(app);
  }finally{if(child.exitCode===null)await app.close();}

  ({app,page}=await launch(profile,config));
  try {
    const resume=page.locator('[data-home-resume]');
    await resume.waitFor();
    assert.equal(await resume.locator('[data-resume-label]').textContent(),'继续听');
    const paused=await state(page);
    assert.equal(paused.track.id,saved.id);
    assert.ok(Math.abs(paused.position-saved.position)<1.2);
    assert.equal(paused.queueScope,saved.scope);
    assert.deepEqual(paused.queue.map(item=>item.id),saved.order);
    assert.equal(paused.queueEntryId,paused.queue[saved.index].entryId);
    assert.equal(paused.playing,false);
    assert.equal(await page.evaluate(()=>document.getElementById('audio').paused),true);
    await resume.click();
    await page.waitForFunction(point=>SonicPlayback.snapshot().track?.id===point.id&&
      SonicPlayback.snapshot().playing&&SonicPlayback.position()>point.position+.1,saved);
    if(config.energy)await verifyOnlineInPowerMode(page,await fs.readFile(path.join(fixtures,titles[0]+'.wav')));
  }finally{await app.close();}
  console.log('PASS '+config.name+' search → lyrics → reorder → natural next → quit → paused resume');
}

async function main() {
  const qa=path.join(repo,'work','desktop-qa');
  await fs.mkdir(qa,{recursive:true});
  const workspace=await fs.mkdtemp(path.join(qa,'windows-journey-'));
  const fixtures=path.join(workspace,'audio');
  await fs.mkdir(fixtures);
  await writeFixtures(fixtures);
  const selection=process.argv[2]===undefined?tests:tests.slice(Number(process.argv[2]),Number(process.argv[2])+1);
  assert.ok(selection.length,'No Windows journey matches the selected index');
  for(const [index,config] of selection.entries()) {
    const profile=path.join(workspace,'profile-'+index);
    try{await verifyJourney(profile,fixtures,config);}
    catch(error){throw new Error(config.name+' failed',{cause:error});}
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
