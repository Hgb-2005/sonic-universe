'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const { _electron }=require('playwright');

const repo=path.resolve(__dirname,'..');
const port=19021;
const longLine='当海浪沿着窗边轻轻回响，这一句很长，我们要把窗前的细雨和声波一同留下。';
const translation='As waves echo softly along the windowsill, we keep the rain and the music together for a moment.';
const shortLine='夜色';
const audio=(tone=330)=>{
  const rate=8000,samples=rate*40;
  const wav=Buffer.alloc(44+2*samples);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length-8,4);
  wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);
  wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24);
  wav.writeUInt32LE(rate*2,28);
  wav.writeUInt16LE(2,32);
  wav.writeUInt16LE(16,34);
  wav.write('data',36);
  wav.writeUInt32LE(2*samples,40);
  for(let sample=0;sample<samples;sample++)wav.writeInt16LE(Math.round(Math.sin(sample*Math.PI*2*tone/rate)*1600),44+2*sample);
  return wav;
};

async function fixtures(folder) {
  await fs.mkdir(folder);
  const more=Array.from({length:17},(_,i)=>'[00:'+String(20+i).padStart(2,'0')+'.00]第 '+(i+1)+' 段测试歌词');
  await Promise.all([
    fs.writeFile(path.join(folder,'01-Sonic-QA.wav'),audio()),
    fs.writeFile(path.join(folder,'02-No-Lyrics.wav'),audio(550)),
    fs.writeFile(path.join(folder,'01-Sonic-QA.lrc'),['[00:02.00]海风起',
      '[00:06.00]<00:06.00>当海浪<00:07.10>'+longLine.slice(3),
      '[00:11.00]'+shortLine,'[00:12.00]走过雨季','[00:14.00]微光在窗边',...more].join('\n')),
    fs.writeFile(path.join(folder,'01-Sonic-QA.translation.lrc'),'[00:02.00]The sea breeze rises.\n[00:06.00]'+translation+'\n[00:12.00]We walk through the season of rain.'),
  ]);
}

const session=page=>page.evaluate(()=>{
  const state=SonicPlayback.snapshot({queue:true});
  return {track:state.track?.id,position:state.position,playing:state.playing,queue:state.queue,entry:state.queueEntryId,revision:state.queueRevision};
});
const sameTransport=(before,after)=>{
  assert.equal(after.track,before.track);
  assert.equal(after.playing,before.playing);
  assert.equal(after.entry,before.entry);
  assert.deepEqual(after.queue,before.queue);
  if(before.playing)assert.ok(after.position>=before.position&&after.position<before.position+5);
  else assert.ok(Math.abs(after.position-before.position)<.06);
};
const waitReport=(page,message)=>page.waitForFunction(expected=>!SonicPlayback.library().importing&&
  SonicPlayback.importReport()?.message.includes(expected),message);

async function run() {
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'sonic-import-queue-'));
  const folder=path.join(work,'music');
  let app;
  try {
    await fixtures(folder);
    app=await _electron.launch({args:[repo,'--mute-audio','--disable-backgrounding-occluded-windows'],
      env:{...process.env,SONIC_DESKTOP_PROFILE:path.join(work,'profile'),SONIC_DESKTOP_PORT:String(port)},cwd:repo});
    const page=await app.firstWindow();
    await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready&&SonicPlayback.snapshot().track?.id==='demo-auld-lang-syne');
    page.setDefaultTimeout(8500);
    await page.emulateMedia({reducedMotion:'no-preference'});
    const room=page.locator('#listeningRoom');
    const library=room.locator('[data-music-library]');
    const fileInput=page.locator('#fileInput');
    const importButton=library.locator('[data-sl-command=play-imported]');
    await room.locator('[data-room-mode=listen]').click();
    await room.locator('.lr-player-wrap [data-action=play]').click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.position()>1.1);
    const sampleLine=room.locator('[data-preview-line="0"]');
    assert.match(await sampleLine.textContent(),/Should old acquaintance/);
    assert.ok(await sampleLine.locator('.lr-timed-group').count()>1);
    assert.equal(await room.locator('[data-preview-translation]').textContent(),'怎能忘记昔日的朋友，');
    await room.locator('.lr-player-wrap [data-action=play]').click();
    let before=await session(page);
    await room.locator('[data-room-mode=library]').click();
    const chooser=page.waitForEvent('filechooser');
    await library.locator('[data-action=import]').click();
    await (await chooser).setFiles((await fs.readdir(folder)).map(name=>path.join(folder,name)));
    await waitReport(page,'匹配 1 份歌词（含 1 份译文）');
    sameTransport(before,await session(page));
    assert.equal(await importButton.isVisible(),true);
    console.log('PASS 首次导入两首音频，保留暂停的示例、位置和隐式队列，汇报歌词与译文');

    // Use the real native import pipeline with a deterministic selection result.
    await app.evaluate(({dialog},folder)=>{
      dialog.showOpenDialog=async(_window,options)=>{
        if(options.title!=='选择音乐文件夹'||options.buttonLabel!=='导入')throw Error('unexpected dialog options');
        return {canceled:false,filePaths:[folder]};
      };
    },folder);
    const folderButton=library.locator('[data-action=folder]');
    before=await session(page);
    await folderButton.click();
    await waitReport(page,'新增 0 首');
    sameTransport(before,await session(page));
    assert.match(await library.locator('[data-sl-import-status]').textContent(),/跳过 0 个文件.*匹配 1 份歌词.*重新关联 2 首/);
    assert.equal(await importButton.isVisible(),false);
    await folderButton.click();
    await waitReport(page,'含 2 首重复');
    sameTransport(before,await session(page));
    console.log('PASS 桌面目录接回原条目，再扫同目录跳过两首重复，仍识别歌词与译文');

    await page.evaluate(async()=>{await SonicPlayback.toggle();SonicPlayback.seek(10);});
    await page.waitForFunction(()=>SonicPlayback.snapshot().playing);
    before=await session(page);
    await fileInput.setInputFiles({name:'03-While-Playing.wav',mimeType:'audio/wav',buffer:audio(425)});
    await waitReport(page,'新增 1 首');
    sameTransport(before,await session(page));
    await page.evaluate(()=>SonicPlayback.toggle());
    before=await session(page);
    await room.locator('[data-room-mode=work]').click();
    await fileInput.setInputFiles({name:'04-While-Paused.wav',mimeType:'audio/wav',buffer:audio(460)});
    await waitReport(page,'新增 1 首');
    sameTransport(before,await session(page));
    await room.locator('[data-toast]').getByRole('button',{name:'播放新导入'}).click();
    await room.locator('[data-room-mode=library]').click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().track?.name==='04-While-Paused'&&SonicPlayback.snapshot().playing);
    console.log('PASS 播放中继续走进度，暂停中保持进度，点播放新导入才切歌');

    const [a,b,c,d]=await page.evaluate(()=>SonicPlayback.library().tracks.filter(track=>track.kind==='file').map(track=>track.id));
    await page.evaluate(async ids=>{await SonicPlayback.playFromLibrary(ids[1],'all',true,ids);},[a,b,c,d]);
    await page.waitForFunction(id=>SonicPlayback.snapshot().track?.id===id&&SonicPlayback.snapshot().playing,b);
    await page.evaluate(async()=>{await SonicPlayback.toggle();SonicPlayback.seek(4);});
    before=await session(page);
    const row=library.locator('[data-sl-id="'+d+'"]');
    await row.locator('[data-sl-command=queue]').click();
    await room.locator('[data-sl-command=queue-next]').click();
    const moved=await session(page);
    assert.deepEqual(moved.queue.map(item=>item.id),[a,b,d,c]);
    assert.equal(moved.queue[2].entryId,before.queue[3].entryId);
    sameTransport({...before,queue:moved.queue},moved);
    await page.evaluate(async([a,b,d])=>{
      SonicPlayback.queueTrack(d,'next');
      SonicPlayback.queueTrack(d,'next');
      SonicPlayback.queueTrack(b,'next');
      SonicPlayback.queueTrack(a,'next');
      SonicPlayback.queueTrack(d,'end');
    },[a,b,d]);
    const edge=await session(page);
    assert.deepEqual(edge.queue.map(item=>item.id),[a,b,a,d,c,d]);
    assert.equal(edge.queue[0].entryId,before.queue[0].entryId);
    assert.notEqual(edge.queue[0].entryId,edge.queue[2].entryId);
    sameTransport({...before,queue:edge.queue},edge);
    console.log('PASS 移动原队列条目，已是下一首与重复点击无增项，历史项保留，当前项不重复，末尾可追加');

    await page.route('**/health',route=>route.fulfill({json:{ok:true,companion:true}}));
    await page.route('**/api/qishui/login-status',route=>route.fulfill({json:{authenticated:true,user:{nickname:'QA'}}}));
    await page.route('**/api/qishui/search',route=>{
      return route.fulfill({json:{items:[]}});
    });
    await room.locator('[data-action=search]').click();
    const search=library.locator('[data-sl-local-search]');
    await search.fill('Sonic-QA');
    assert.equal(await library.locator('[data-sl-id]').count(),1);
    await search.fill('no matching sonic fixture');
    const empty=library.locator('[data-sl-empty-actions]');
    await empty.waitFor();
    const onlineRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/qishui/search');
    await empty.locator('[data-sl-command=search-online]').click();
    assert.equal((await onlineRequest).postDataJSON().query,'no matching sonic fixture');
    assert.equal(await library.locator('[data-sl-search-source=qishui]').getAttribute('aria-pressed'),'true');
    assert.equal(await search.inputValue(),'no matching sonic fixture');
    await library.locator('[data-sl-search-source=local]').click();
    await empty.locator('[data-sl-command=clear-keyword]').click();
    assert.equal(await search.inputValue(),'');
    assert.ok(await library.locator('[data-sl-id]').count()>1);
    console.log('PASS 本机搜索匹配、无结果、沿用关键词切在线、清空恢复');

    await room.locator('[data-room-mode=listen]').click();
    const importLyrics=room.locator('[data-import-current-lyrics]');
    await importLyrics.waitFor();
    assert.match(await importLyrics.getAttribute('aria-label'),/02-No-Lyrics/);
    const lyricsChooser=page.waitForEvent('filechooser');
    await importLyrics.click();
    await (await lyricsChooser).setFiles({name:'manual.lrc',mimeType:'text/plain',buffer:Buffer.from('[00:00.00]手动导入的歌词')});
    await page.waitForFunction(()=>SonicPlayback.snapshot().lyrics[0]?.text==='手动导入的歌词');
    assert.equal(await page.locator('#atelierSong').textContent(),'02-No-Lyrics');
    await page.locator('#atelierDialog').evaluate(dialog=>dialog.close());
    await room.locator('[data-now-lyrics]').waitFor();
    console.log('PASS 无歌词曲目直接导入 LRC，显示曲名，保存后恢复全文入口');
  } finally {
    if(app)await app.close();
    await fs.rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
