'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const { _electron }=require('playwright');
const mode=process.argv[2],port=Number(process.env.SONIC_QA_PORT||18946);
const origin='http://127.0.0.1:'+port;
const title='Windows 本地续播验收';
const lyric='本地手写歌词与续播';
const playlist='Windows 验收歌单';

function audio(){
  const samples=8000*30, wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);
  wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*Math.PI*440/8000)*700),44+i*2);
  return wav;
}

async function main(){
  const profile=process.env.SONIC_QA_PROFILE||await fs.mkdtemp(path.join(os.tmpdir(),'sonic-local-profile-'));
  const launch=async(executablePath)=>{
    const app=await _electron.launch({executablePath,
      args:['--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
      env:{...process.env,SONIC_DISABLE_QISHUI:'1',SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)}});
    try{
      const page=await app.firstWindow();
      page.setDefaultTimeout(18000);
      await page.waitForURL(url=>url.origin===origin,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready);
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
      return {app,page,room:page.locator('#listeningRoom')};
    }catch(error){
      const urls=app.windows().map(window=>window.url());
      await app.close().catch(()=>{});
      throw new Error('Expected startup at '+origin+'; windows '+JSON.stringify(urls),{cause:error});
    }
  };
  const search=async(room,term,source)=>{
    await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
    await room.getByRole('searchbox',{name:'搜索音乐',exact:true}).fill(term);
    const tab=room.locator('[data-sl-search-source="'+source+'"]');
    if(await tab.getAttribute('aria-pressed')!=='true')await tab.click();
    else if(source==='qishui')await room.locator('[data-sl-qishui-submit]').click();
  };
  let instance=await launch(process.env.SONIC_DESKTOP_EXECUTABLE);
  try{
    const {page,room,app}=instance;
    const check=async({page,room})=>{
      await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&!SonicPlayback.snapshot().playing,title);
      const restored=await page.evaluate(()=>SonicPlayback.snapshot());
      const saved=JSON.parse(await fs.readFile(path.join(profile,'qa-paused-position.json'),'utf8'));
      assert.ok(Math.abs(restored.position-saved)<.18,JSON.stringify({saved,position:restored.position}));
      assert.ok(restored.lyrics.some(line=>line.text===lyric));
      const lib=await page.evaluate(()=>SonicPlayback.library());
      assert.ok(lib.playlists.find(item=>item.name===playlist).trackIds.includes(restored.track.id));
      await room.locator('[data-home-resume]').click();
      await page.waitForFunction(saved=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().position>saved+.03,saved);
      console.log('PASS '+(mode||'candidate')+' 启动→导入→搜索→播放→编辑并查看歌词→暂停→退出→续播，歌单 1 首，续播 '+restored.position.toFixed(2)+' 秒');
    };
    if(mode==='--resume-only'){await check(instance);return;}
    await page.locator('#fileInput').setInputFiles({name:title+'.wav',mimeType:'audio/wav',buffer:audio()});
    await page.waitForFunction(name=>!SonicPlayback.library().importing&&SonicPlayback.library().tracks.some(t=>t.name===name),title);
    await search(room,title,'local');
    await room.locator('[data-sl-id] [data-sl-command="play"]').filter({hasText:title}).click();
    await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing,title);
    await page.evaluate(async name=>{
      const id=SonicPlayback.snapshot().track.id,list=SonicPlayback.savePlaylist(name);
      await SonicPlayback.editPlaylistMembership(list,[id],true);
    },playlist);
    await room.locator('.lr-more-lyrics > summary').click();
    await room.locator('.lr-more-lyrics [data-action="lyrics"]').click();
    await page.locator('#lyricSource').fill('[00:00.00]'+lyric);
    await page.locator('#saveLyricBtn').click();
    await page.keyboard.press('Escape');
    await room.locator('[data-lyric-preview]').getByText(lyric,{exact:true}).waitFor();
    await page.evaluate(()=>SonicPlayback.seek(6.2));
    await room.locator('.lr-player-wrap [data-action="play"]').click();
    await page.waitForFunction(()=>!SonicPlayback.snapshot().playing);
    const paused=await page.evaluate(()=>SonicPlayback.snapshot().position);
    await fs.writeFile(path.join(profile,'qa-paused-position.json'),JSON.stringify(paused));
    await app.close();
    if(mode==='--seed-only'){console.log('PASS 旧版已写入测试歌单、手改歌词及 '+paused.toFixed(2)+' 秒续播点');return;}
    instance=await launch(process.env.SONIC_QA_NEXT_EXE||process.env.SONIC_DESKTOP_EXECUTABLE);
    await check(instance);
  }finally{await instance.app.close().catch(()=>{});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
