'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright');

const repo=path.resolve(__dirname,'..');
const port=Number(process.env.SONIC_APPEARANCE_PORT||19032);
const shots=process.env.SONIC_QA_SCREENSHOTS;
const longLine='窗外的雨落得很轻，整句原文和它的译文一起留在画面里。';

async function makeMusic(folder){
  const rate=8000,seconds=35,pcm=Buffer.alloc(44+rate*seconds*2);
  pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);
  pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);
  pcm.writeUInt32LE(rate,24);pcm.writeUInt32LE(rate*2,28);pcm.writeUInt16LE(2,32);
  pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40);
  for(let index=0;index<rate*seconds;index++){
    const scale=index%4000<350?2200:550;
    pcm.writeInt16LE(Math.round(Math.sin(index/8)*scale),44+index*2);
  }
  await fs.mkdir(folder);
  const paths=Array.from({length:12},(_,i)=>path.join(folder,'QA Round '+String(i+1).padStart(2,'0')+'.wav'));
  const lyrics=path.join(folder,'QA Round 01.lrc');
  const translation=path.join(folder,'QA Round 01.translation.lrc');
  const timed=path.join(folder,'QA Round 02.yrc');
  const lines=Array.from({length:22},(_,i)=>'[00:'+String(i+10).padStart(2,'0')+'.00]第 '+(i+3)+' 句');
  await Promise.all([...paths.map(file=>fs.writeFile(file,pcm)),
    fs.writeFile(lyrics,['[00:02.00]第一句','[00:06.00]'+longLine,...lines].join('\n')),
    fs.writeFile(translation,'[00:02.00]First line\n[00:06.00]The rain falls softly outside.'),
    fs.writeFile(timed,'[2000,1400](2000,500,0)窗外(2500,900,0)落雨\n[8000,2000](8000,700,0)下一句(8700,1300,0)开始\n[21000,1200](21000,1200,0)尾声'),
  ]);
  return [...paths,lyrics,translation,timed];
}

async function run(){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sonic-appearance-'));
  const profile=path.join(temporary,'profile');
  const folder=path.join(temporary,'music');
  const files=await makeMusic(folder);
  let app;
  async function launch(){
    app=await _electron.launch({args:[repo,'--mute-audio','--disable-backgrounding-occluded-windows'],cwd:repo,
      env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)}});
    const page=await app.firstWindow();
    page.setDefaultTimeout(11000);
    await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready&&window.SonicListeningRoom);
    return page;
  }
  try{
    let page=await launch();
    await page.route('**/api/**',route=>route.fulfill({json:{items:[]}}));
    await page.route('**/health',route=>route.fulfill({json:{ok:true,companion:true}}));
    await page.route('**/api/qishui/login-status',route=>route.fulfill({json:{authenticated:true,user:{nickname:'QA'}}}));
    await page.emulateMedia({reducedMotion:'reduce'});
    const room=page.locator('#listeningRoom'),gallery=room.locator('[data-player-bg-dialog]');
    const mode=value=>room.locator('[data-room-mode="'+value+'"]').click();
    const onScreen=selector=>room.locator(selector+':visible');
    const headerSettings=room.locator('.lr-header [data-action=settings]');
    const close=dialog=>dialog.locator('[data-close]').click();
    const state=()=>page.evaluate(()=>SonicPlayback.snapshot({queue:true}));
    const resize=async(width,height)=>{
      const bounds=await app.evaluate(({BrowserWindow},size)=>{
        const window=BrowserWindow.getAllWindows()[0];
        window.setSize(...size);return window.getContentSize();
      },[width,height]);
      await page.waitForFunction(([w,h])=>Math.abs(innerWidth-w)<2&&Math.abs(innerHeight-h)<2,bounds);
    };
    const capture=async name=>{
      if(!shots)return;
      const png=await app.evaluate(async({BrowserWindow})=>{
        return (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64');
      });
      await fs.writeFile(path.join(shots,name+'.png'),Buffer.from(png,'base64'));
    };
    const bg=id=>gallery.locator('[data-player-bg-select="'+id+'"]');
    const selectBg=async id=>{
      await bg(id).click();
      await page.waitForFunction(value=>document.querySelector('#listeningRoom').dataset.playbackBackgroundRendered===value,id);
      assert.equal(await bg(id).getAttribute('aria-pressed'),'true');
    };
    const style=async id=>{
      await onScreen('[data-action=lyric-effects]').click();
      await room.locator('[data-effect-choice="'+id+'"]').click();
      await page.waitForFunction(value=>document.querySelector('#listeningRoom').dataset.lyricEffect===value,id);
    };
    const accent=()=>room.evaluate(element=>getComputedStyle(element).getPropertyValue('--room-accent-rgb').trim());
    const waitAccent=value=>page.waitForFunction(rgb=>getComputedStyle(document.querySelector('#listeningRoom')).getPropertyValue('--room-accent-rgb').trim()===rgb,value);
    const visibleCanvas=()=>room.locator('.lr-background').evaluate(el=>getComputedStyle(el).visibility);

    await resize(1360,900);
    await mode('listen');
    await style('tide');
    await headerSettings.click();
    await selectBg('warm-white');
    assert.equal(await visibleCanvas(),'visible');
    assert.equal(await room.locator('[data-tide-atmosphere]').isVisible(),true);
    const pixel=await room.locator('.lr-background').evaluate(canvas=>[...canvas.getContext('2d').getImageData(25,130,1,1).data]);
    assert.ok(Math.min(...pixel.slice(0,3))>150,'warm background was not painted: '+pixel);
    await gallery.locator('[data-color=amber]').click();await waitAccent('229,196,131');
    await gallery.locator('[data-color=ocean]').click();await waitAccent('149,188,209');
    assert.equal(await gallery.locator('[data-response-field]').isVisible(),true);
    await close(gallery);
    assert.equal(await room.locator('[data-effect-stage]').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    await capture('warm-tide-prelude');
    await page.evaluate(async()=>{
      await SonicPlayback.toggle();
      SonicPlayback.seek(SonicPlayback.snapshot().lyrics[0].time+.1);
      await SonicPlayback.toggle();
    });
    await page.waitForFunction(()=>{
      const line=document.querySelector('[data-lyric-timeline] [data-current-line]');
      return line&&getComputedStyle(line).color==='rgb(23, 38, 52)';
    });
    await capture('warm-tide');
    await style('still');
    await page.evaluate(()=>SonicPlayback.seek(.25));
    await page.waitForFunction(()=>document.querySelector('[data-lyric-meta]').textContent==='前奏');
    assert.deepEqual(await room.locator('[data-lyric-meta]').evaluate(el=>{
      const css=getComputedStyle(el);return [css.color,css.backgroundColor];
    }),['rgb(255, 247, 237)','rgb(26, 33, 44)']);
    await headerSettings.click();
    assert.equal(await gallery.locator('[data-response-field]').isVisible(),false);
    await selectBg('geometry');await selectBg('mist');await selectBg('clean');
    await selectBg('warm-white');
    await gallery.evaluate(dialog=>{
      for(const id of ['white-coast','blue-rain','warm-white'])dialog.querySelector('[data-player-bg-select="'+id+'"]').click();
    });
    await selectBg('warm-white');
    await page.waitForTimeout(250);
    assert.equal(await room.getAttribute('data-playback-background-rendered'),'warm-white');
    await close(gallery);
    await style('paper');await headerSettings.click();await selectBg('white-coast');await close(gallery);
    assert.equal(await room.getAttribute('data-lyric-backdrop'),'soft');
    await style('impact');await headerSettings.click();await selectBg('blue-rain');await close(gallery);
    assert.equal(await room.getAttribute('data-lyric-backdrop'),'soft');
    assert.equal(await visibleCanvas(),'visible');
    await mode('work');await headerSettings.click();
    const work=room.locator('[data-settings]');
    await work.locator('[data-work-color=amber]').click();await waitAccent('229,196,131');await close(work);
    assert.equal(await room.locator('[data-desktop-lyrics]').isVisible(),true);
    await mode('listen');await waitAccent('149,188,209');
    assert.equal(await accent(),'149,188,209');
    console.log('PASS 显式背景与动效相容、迅速切换、纯净/基础背景、播放与工作配色独立、提示对比度');

    await resize(760,580);
    await mode('library');
    const previous=await state();
    await page.locator('#fileInput').setInputFiles(files);
    await page.waitForFunction(()=>SonicPlayback.importReport()?.added===12&&!SonicPlayback.library().importing);
    assert.equal((await state()).track.id,previous.track.id);
    assert.equal((await state()).playing,previous.playing);
    assert.deepEqual((await state()).queue,previous.queue);
    const report=room.locator('[data-sl-import-report]');
    await report.waitFor();
    assert.equal(await room.locator('[data-toast]').isVisible(),false);
    await capture('narrow-library-report');
    await page.evaluate(()=>window.scrollTo(0,document.scrollingElement.scrollHeight));
    const last=room.locator('[data-sl-id]').last();
    assert.match(await last.locator('strong').textContent(),/QA Round 12/);
    const covered=await last.locator('button:not([hidden])').evaluateAll(buttons=>buttons.filter(button=>{
      const {x,y,width,height}=button.getBoundingClientRect();
      return !button.contains(document.elementFromPoint(x+width/2,y+height/2));
    }).map(button=>button.getAttribute('aria-label')));
    assert.deepEqual(covered,[]);
    await capture('narrow-library');
    await last.locator('[data-sl-command=play]').click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().track?.name==='QA Round 12'&&SonicPlayback.snapshot().playing);
    await last.locator('[data-sl-command=favorite]').click();
    await last.locator('[data-sl-command=membership]').click();await page.keyboard.press('Escape');
    await last.locator('[data-sl-command=queue]').click();await page.keyboard.press('Escape');
    const initialScroll=await page.evaluate(()=>scrollY);
    const transport=await state();
    await mode('visual');
    assert.equal((await state()).playing,transport.playing);
    const sceneButton=room.locator('[data-visual-view] [data-action=scene-gallery]');
    await sceneButton.click();
    const scenes=room.locator('[data-scene-dialog]');
    await scenes.locator('[data-scene-select=jiangnan-rain]').click();
    await close(scenes);
    await page.waitForFunction(()=>document.querySelector('[data-visual-title]').textContent==='烟雨江南');
    assert.match(await room.locator('[data-beat-status]').textContent(),/正在分析节拍|正在响应音乐/);
    const beatClock=room.locator('[data-action=beat-clock]');
    await beatClock.click();
    await page.waitForFunction(()=>document.querySelector('[data-beat-status]').textContent==='正在响应音乐');
    await beatClock.click();
    await room.locator('.lr-player-wrap [data-action=play]').click();
    await page.waitForFunction(()=>document.querySelector('[data-beat-status]').textContent==='已暂停');
    await capture('paused-stage');
    await mode('library');
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-initialScroll)<=2);
    assert.equal((await state()).track.id,transport.track.id);
    assert.deepEqual((await state()).queue,transport.queue);
    assert.ok((await state()).position>=transport.position);
    console.log('PASS 窄窗导入 12 首，报告显示时最后一首立即播放，行按钮可点，舞台暂停及曲库定位');

    const search=room.locator('[data-sl-search]');
    await search.fill('QA Round');
    await page.evaluate(()=>window.scrollTo(0,Math.round((document.scrollingElement.scrollHeight-innerHeight)*.65)));
    const filteredY=await page.evaluate(()=>scrollY);
    assert.ok(filteredY>0);
    await mode('visual');await mode('library');
    assert.equal(await search.inputValue(),'QA Round');
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-filteredY)<=2);
    await search.fill('round2 unmatched fixture');
    const opener=room.locator('[data-sl-empty] [data-sl-command=search-online]');
    const onlineRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/qishui/search');
    await opener.click();
    const online=page.locator('#queueDialog'),input=online.locator('#onlineSearchInput');
    await input.waitFor();await input.focus();await page.keyboard.press('Escape');
    await online.waitFor({state:'hidden'});
    assert.equal((await onlineRequest).postDataJSON().query,'round2 unmatched fixture');
    assert.equal(await input.inputValue(),'round2 unmatched fixture');
    assert.equal(await opener.evaluate(el=>document.activeElement===el),true);
    await opener.click();await online.locator('#onlineSearchClearBtn').click();
    assert.equal(await input.inputValue(),'');
    await page.keyboard.press('Escape');
    await room.locator('.lr-player-wrap [data-action=queue]').click();
    const queue=room.locator('[data-queue-dialog]');
    await queue.locator('[data-queue-search]').fill('QA');
    await page.keyboard.press('Escape');await queue.waitFor({state:'hidden'});
    await mode('work');await room.locator('footer [data-action=playback-settings]').click();
    const general=room.locator('[data-playback-dialog]');
    await general.locator('[data-energy]').uncheck();
    await close(general);
    await page.evaluate(()=>SonicPlayback.setVolume(.47));
    const mute=room.locator('[data-action=mute]');
    await mute.focus();await page.keyboard.press('Space');
    assert.equal(await mute.getAttribute('aria-label'),'恢复音量');
    assert.equal(await room.locator('[data-volume]').inputValue(),'0');
    await mode('library');await mute.click();
    assert.equal(await room.locator('[data-volume]').inputValue(),'47');
    console.log('PASS 在线弹窗一次 Esc、原关键词和焦点、明确清空、队列 Esc、窄窗键盘静音与切页恢复');

    const testIds=await page.evaluate(()=>SonicPlayback.library().tracks.filter(track=>track.name.startsWith('QA Round')).slice(0,3).map(track=>track.id));
    await page.evaluate(async ids=>{await SonicPlayback.playFromLibrary(ids[0],'local',true,ids);SonicPlayback.seek(4.75);},testIds);
    await mode('listen');await headerSettings.click();
    await selectBg('warm-white');
    const preview=gallery.locator('.lr-player-bg-sample');
    await page.waitForFunction(()=>document.querySelector('.lr-player-bg-sample strong').textContent==='第一句');
    const canvas=gallery.locator('[data-player-bg-composition] canvas');
    await canvas.evaluate(el=>{const original=el.getContext.bind(el);el.getContext=(...args)=>{el.dataset.redraw='true';return original(...args);};});
    await page.waitForFunction(text=>document.querySelector('.lr-player-bg-sample strong').textContent===text,longLine);
    assert.equal(await preview.locator('span').textContent(),'The rain falls softly outside.');
    assert.equal(await canvas.getAttribute('data-redraw'),null,'lyric change repainted the canvas');
    await bg('warm-white').click();
    assert.equal(await preview.locator('strong').textContent(),longLine);
    await capture('live-gallery');
    await page.keyboard.press('Escape');await gallery.waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('[data-player-bg-composition] canvas').width===0);
    await page.evaluate(()=>SonicPlayback.toggle());
    if(await room.locator('[data-stage-full-lyrics]').isVisible())await room.locator('[data-stage-full-lyrics]').click();
    else await room.locator('[data-now-lyrics]').click();
    const full=room.locator('[data-full-lyrics]');
    await full.locator('[data-full-line]').first().click();
    assert.ok(Math.abs((await state()).position-2)<.1);
    await full.focus();await page.keyboard.press('PageDown');
    await room.locator('[data-lyric-follow]').waitFor();
    await mode('visual');await mode('listen');
    await room.locator('[data-lyric-follow]').waitFor();
    await room.locator('[data-lyric-follow]').click();
    await room.locator('[data-lyric-follow]').waitFor({state:'hidden'});
    const more=room.locator('.lr-more-lyrics');
    if(await more.getAttribute('open')===null)await more.locator('summary').first().click();
    await more.locator('[data-lyric-timing] summary').click();
    await more.locator('[data-lyric-adjust="0.1"]').click();
    assert.equal((await state()).lyricOffset,.1);
    await more.locator('[data-lyric-adjust="-0.1"]').click();
    assert.equal((await state()).lyricOffset,0);
    await more.locator('[data-lyric-adjust="0.1"]').click();
    await more.locator('[data-lyric-adjust="0"]').click();
    assert.equal((await state()).lyricOffset,0);
    await capture('lyrics-controls');
    await room.locator('.lr-header [data-action=fullscreen]').click();
    await page.waitForFunction(()=>document.querySelector('#listeningRoom').dataset.fullscreen==='true');
    await page.evaluate(()=>SonicPlayback.seek(2.2));
    await page.waitForFunction(()=>SonicPlayback.snapshot().position>=2.1);
    await room.locator('[data-lyric-full-tools] [data-action=enter-immersion]').click();
    await room.locator('[data-preview-translation]').waitFor();
    assert.equal(await room.locator('[data-preview-translation]').textContent(),'First line');
    await room.locator('.lr-immersion-atmosphere').click();
    await page.keyboard.press('Escape');await gallery.waitFor({state:'hidden'});
    assert.equal(await room.getAttribute('data-listen-immersive'),'true');
    await page.keyboard.press('Escape');await full.waitFor();
    assert.equal(await room.getAttribute('data-fullscreen'),'true');
    await room.locator('[data-lyric-full-tools] [data-action=lyric-effects]').click();
    await page.keyboard.press('Escape');
    await room.locator('[data-effect-dialog]').waitFor({state:'hidden'});
    assert.equal(await room.getAttribute('data-fullscreen'),'true');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('#listeningRoom').dataset.fullscreen==='false');
    console.log('PASS 双语预览跟随真实换句且不重绘、重选、清理资源、全文复位、校准、沉浸及多层 Esc');

    await page.evaluate(async id=>{await SonicPlayback.playFromLibrary(id,'local',true);await SonicPlayback.toggle();SonicPlayback.seek(4.6);},testIds[1]);
    await style('impact');await headerSettings.click();await selectBg('blue-rain');await close(gallery);
    const notice=room.locator('[data-lyric-meta]');
    assert.equal(await notice.textContent(),'间奏');
    const lyric=room.locator('[data-current-line]');
    assert.ok(await lyric.evaluate(el=>Number(getComputedStyle(el).opacity)<.6));
    await page.evaluate(()=>SonicPlayback.seek(8.2));
    await page.waitForFunction(()=>document.querySelector('[data-current-line]')?.textContent==='下一句开始');
    assert.equal(await lyric.evaluate(el=>Number(getComputedStyle(el).opacity)),1);
    await page.evaluate(async ids=>{
      await SonicPlayback.playFromLibrary(ids[0],'local',true,ids);
      SonicPlayback.queueTrack(ids[2],'next');
    },[testIds[2],testIds[0],testIds[1]]);
    assert.deepEqual((await state()).queue.map(entry=>entry.id),[testIds[2],testIds[1],testIds[0]]);
    await room.locator('[data-action=collapse-lyrics]').click();
    await room.locator('[data-import-current-lyrics]').waitFor();
    assert.match(await room.locator('[data-import-current-lyrics]').getAttribute('aria-label'),/QA Round 03/);
    console.log('PASS 逐字间奏降亮、下一句恢复、曲目专属入口回归');

    await app.close();app=null;
    page=await launch();
    const saved=await page.evaluate(()=>SonicListeningRoom.settings());
    assert.equal(saved.playbackColor,'ocean');assert.equal(saved.color,'amber');
    assert.equal(saved.playbackBackground,'blue-rain');assert.equal(saved.lyricEffect,'impact');
    assert.equal(saved.energySaver,false);
    await page.locator('[data-room-mode=listen]').click();
    await page.waitForFunction(()=>document.querySelector('#listeningRoom').dataset.playbackBackgroundRendered==='blue-rain');
    await page.locator('#listeningRoom .lr-header [data-action=settings]').click();
    assert.equal(await page.locator('[data-color=ocean]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-player-bg-select=blue-rain]').getAttribute('aria-pressed'),'true');
    console.log('PASS 退出并重启后恢复播放配色、工作配色、背景、样式、省电设置');
  }finally{
    if(app)await app.close();
    await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
