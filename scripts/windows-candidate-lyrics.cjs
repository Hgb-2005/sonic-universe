'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const { _electron }=require('playwright');
const port=18942, origin='http://127.0.0.1:'+port;
const song={provider:'qishui',mediaId:'54801',name:'在线歌词晚到',artist:'验收艺人',album:'验收专辑',duration:90};
const lateLine='到达很晚的在线歌词';
const manualLine='手写的本地歌词';
const importedLine='从文件导入的歌词';

function wav(seconds){
  const samples=8000*seconds, audio=Buffer.alloc(44+samples*2);
  audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
  audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);
  audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(samples*2,40);
  return audio;
}

async function main(){
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'sonic-lyric-profile-'));
  const audio=await fs.readFile(path.join(path.resolve(__dirname,'..'),'outputs','interstellar-drift.mp3'));
  let gate;
  const launch=async()=>{
    const app=await _electron.launch({executablePath:process.env.SONIC_DESKTOP_EXECUTABLE,args:['--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
      env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)}});
    try{
    const page=await app.firstWindow();
    await page.waitForURL(url=>url.origin===origin,{waitUntil:'domcontentloaded',timeout:20000});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
    page.setDefaultTimeout(10000);
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url()), p=url.pathname;
      if(url.origin!==origin)return /^https?:$/.test(url.protocol)?route.abort():route.continue();
      if(p==='/api/qishui/login-status')return route.fulfill({json:{authenticated:true,user:{nickname:'QA'}}});
      if(p==='/api/qishui/search')return route.fulfill({json:{items:[song]}});
      if(p.endsWith('/audio'))return route.fulfill({json:{streamPath:'/media/lyrics-qa',preview:false}});
      if(p.endsWith('/lyrics')){
        if(gate)await gate.promise;
        return route.fulfill({json:{lrc:'[00:00.00]'+lateLine}});
      }
      if(p==='/media/lyrics-qa'){
        const range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range||'');
        if(!range)return route.fulfill({contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes'},body:audio});
        const start=Number(range[1]), end=range[2]?Math.min(Number(range[2]),audio.length-1):audio.length-1;
        return route.fulfill({status:206,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes','Content-Range':
          'bytes '+start+'-'+end+'/'+audio.length},body:audio.subarray(start,end+1)});
      }
      return route.continue();
    });
    await page.waitForURL(url=>url.origin===origin);await page.reload();
    await page.waitForFunction(()=>SonicPlayback.snapshot().ready&&SonicPlayback.snapshot().onlineReady);
    return {app,page,room:page.locator('#listeningRoom')};
    }catch(error){
      await app.close().catch(()=>{});
      throw error;
    }
  };
  const read=async()=>{const res=await fetch(origin+'/api/lyric');return res.ok?res.json():null;};
  async function until(check){
    const deadline=Date.now()+6000;
    do{const doc=await read();if(doc&&check(doc))return doc;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
    return read();
  }
  const id='online:qishui:'+song.mediaId;
  const assertPlaying=page=>page.waitForFunction(id=>SonicPlayback.snapshot().track?.id===id&&SonicPlayback.snapshot().playing,id);
  let bundle=await launch();
  try{
    const {page,room}=bundle;
    await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
    await room.getByRole('searchbox',{name:'搜索音乐',exact:true}).fill(song.name);
    await room.locator('[data-sl-search-source="qishui"]').click();
    await room.locator('[data-sl-qishui-track="'+song.mediaId+'"]').click();
    await assertPlaying(page);
    await page.evaluate(async()=>{SonicPlayback.seek(5.2);await SonicPlayback.toggle();});
    await bundle.app.close();
    gate=Promise.withResolvers();
    bundle=await launch();
    const {app,page:main,room:ui}=bundle;
    const [overlay]=await Promise.all([
      app.waitForEvent('window',{predicate:window=>window!==main}),
      ui.locator('.lr-footer [data-action="desktop-lyrics-window"]').click(),
    ]);
    await ui.locator('[data-home-resume]').click();await assertPlaying(main);
    const before=await until(doc=>doc.track.name===song.name&&!doc.lines.length);
    assert.equal(before.lines.length,0);
    assert.equal(await overlay.locator('#current').textContent(),'暂无同步歌词');
    assert.ok(await main.evaluate(()=>SonicPlayback.snapshot().position)>=5);
    gate.resolve();
    await main.waitForFunction(line=>SonicPlayback.snapshot().lyrics.some(item=>item.text===line),lateLine);
    if(!await ui.locator('[data-lyric-preview]').isVisible())
      await ui.locator('[data-home-now-playing]').click();
    await ui.locator('[data-lyric-preview]').getByText(lateLine,{exact:true}).waitFor();
    await overlay.locator('#current').getByText(lateLine,{exact:true}).waitFor();
    const after=await until(doc=>doc.line?.text===lateLine);
    assert.equal(await main.evaluate(()=>SonicPlayback.snapshot().track.id),id);
    assert.equal(after.line?.text,lateLine);
    console.log('PASS 同 ID 续播 '+after.position.toFixed(2)+' 秒，播放页、桌面歌词、接口由 0 行更新为 '+after.lines.length+' 行');
    await main.locator('#fileInput').setInputFiles(['本地歌词验收','本地无歌词'].map((name,i)=>({name:name+'.wav',mimeType:'audio/wav',buffer:wav(30+i)})));
    await main.waitForFunction(()=>!SonicPlayback.library().importing&&SonicPlayback.library().tracks.some(track=>track.name==='本地无歌词'));
    const localId=await main.evaluate(()=>SonicPlayback.library().tracks.find(track=>track.name==='本地歌词验收').id);
    const search=async name=>{
      await ui.getByRole('button',{name:'搜索音乐',exact:true}).click();
      await ui.locator('[data-sl-search-source="local"]').click();
      await ui.getByRole('searchbox',{name:'搜索音乐',exact:true}).fill(name);
      await ui.locator('[data-sl-id] [data-sl-command="play"]').filter({hasText:name}).click();
      await main.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing,name);
    };
    await search('本地歌词验收');
    await ui.locator('.lr-more-lyrics > summary').click();
    await ui.locator('.lr-more-lyrics [data-action="lyrics"]').click();
    await main.locator('#lyricSource').fill('[00:00.00]'+manualLine+'\n[00:12.00]第二句');
    await main.locator('#saveLyricBtn').click();
    await overlay.locator('#current').getByText(manualLine,{exact:true}).waitFor();
    assert.equal((await until(doc=>doc.line?.text===manualLine)).line?.text,manualLine);
    await main.locator('#lyricOffset').fill('0.4');
    await main.locator('#saveLyricBtn').click();
    assert.equal((await until(doc=>doc.offset===-.4)).offset,-.4);
    const pick=main.waitForEvent('filechooser');await main.locator('#importLyricBtn').click();
    await (await pick).setFiles({name:'caption.lrc',mimeType:'text/plain',buffer:Buffer.from('[00:00.00]'+importedLine)});
    await overlay.locator('#current').getByText(importedLine,{exact:true}).waitFor();
    assert.equal((await until(doc=>doc.line?.text===importedLine)).line?.text,importedLine);
    await main.keyboard.press('Escape');
    await ui.locator('[data-lyric-preview]').getByText(importedLine,{exact:true}).waitFor();
    assert.equal(await main.evaluate(()=>SonicPlayback.snapshot().track.id),localId);
    console.log('PASS 本地同 ID 手改、导入与延后 0.4 秒，桌面歌词与接口跟随');
    await search('本地无歌词');
    await overlay.locator('#current').getByText('暂无同步歌词',{exact:true}).waitFor();
    await ui.locator('[data-lyric-preview]').getByText('此曲暂无同步歌词',{exact:true}).waitFor();
    const cleared=await until(doc=>doc.track.name==='本地无歌词'&&doc.lines.length===0);
    assert.equal(cleared.track.name,'本地无歌词');assert.deepEqual(cleared.lines,[]);assert.equal(cleared.line,null);
    console.log('PASS 切到无歌词曲目，播放页、桌面歌词和接口均清空');
  }finally{gate?.resolve();await bundle.app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
