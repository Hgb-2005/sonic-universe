'use strict';
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const {_electron}=require('playwright');
const binary=process.env.SONIC_NAVIDROME_TEST_EXE;
if(!binary)throw new Error('Set SONIC_NAVIDROME_TEST_EXE to an official portable Navidrome EXE.');
const address='http://127.0.0.1:18994';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function launch(port,profile){
  const app=await _electron.launch({executablePath:process.env.SONIC_DESKTOP_EXECUTABLE,args:['--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
    env:{...process.env,SONIC_DESKTOP_PORT:String(port),SONIC_DESKTOP_PROFILE:profile,SONIC_DISABLE_QISHUI:'1'}});
  try{
    const page=await app.firstWindow();
    await app.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows()[0];main.hide();main.showInactive();});
    page.setDefaultTimeout(15000);
    await page.waitForURL(url=>url.origin==='http://127.0.0.1:'+port);
    await page.waitForFunction(()=>SonicPlayback.snapshot().ready);
    return {app,page};
  }catch(error){await app.close().catch(()=>{});throw error;}
}

async function main(){
  const working=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'sonic-navidrome-quality-'));
  const songs=path.join(working,'music'),data=path.join(working,'data');
  await fs.mkdir(songs);await fs.mkdir(data);
  for(const [number,title] of [[1,'真实服务器曲目一'],[2,'真实服务器曲目二']]){
    const ffmpeg=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency='+(350+number*90)+':duration=30',
      '-metadata','title='+title,'-metadata','artist=本机验收','-metadata','album=真实服务器验收专辑',
      '-metadata','track='+number,'-codec:a','flac',path.join(songs,number+'.flac')],{windowsHide:true});
    if(ffmpeg.error||ffmpeg.status)throw ffmpeg.error||new Error(ffmpeg.stderr.toString());
  }
  const password=randomBytes(20).toString('hex');
  const server=spawn(binary,[],{cwd:working,windowsHide:true,stdio:['ignore','ignore','pipe'],
    env:{...process.env,ND_MUSICFOLDER:songs,ND_DATAFOLDER:data,ND_ADDRESS:'127.0.0.1',ND_PORT:'18994',
      ND_LOGLEVEL:'warn',ND_ENABLEINSIGHTSCOLLECTOR:'false',ND_DEVAUTOCREATEADMINPASSWORD:password}});
  const logs=[];server.stderr.on('data',value=>{logs.push(value.toString());if(logs.length>10)logs.shift();});
  let first;
  async function api(method,params={}){
    const salt=randomBytes(12).toString('hex'),token=createHash('md5').update(password+salt).digest('hex');
    const query=new URLSearchParams({u:'admin',t:token,s:salt,f:'json',v:'1.16.1',c:'SonicUniverse-QA'});
    for(const [name,items] of Object.entries(params))for(const item of [items].flat())query.append(name,item);
    const response=await fetch(address+'/rest/'+method+'.view?'+query,{signal:AbortSignal.timeout(3000)});
    const document=(await response.json())['subsonic-response'];
    if(document?.status!=='ok')throw new Error(method+' failed, code '+document?.error?.code);
    return document;
  }
  async function open(client){
    await client.getByRole('button',{name:'Navidrome 曲库',exact:true}).click();
    const d=client.getByRole('dialog',{name:'Navidrome 曲库'});
    await d.getByLabel('服务器地址').fill(address);
    await d.getByLabel('用户名').fill('admin');
    await d.getByLabel('密码').fill(password);
    await d.getByRole('button',{name:'连接',exact:true}).click();
    await d.getByRole('button',{name:'真实服务器验收专辑 · 本机验收',exact:true}).waitFor();
    await d.getByRole('button',{name:'真实服务器共享歌单',exact:true}).click();
    await d.getByRole('button',{name:'真实服务器曲目一 · 本机验收',exact:true}).waitFor();
    return d;
  }
  try{
    let album;
    for(let attempts=0;attempts<45&&!album;attempts++){
      const list=await api('getAlbumList2',{type:'alphabeticalByArtist'}).catch(()=>null);
      album=list?.albumList2?.album?.[0];
      if(!album)await delay(700);
    }
    assert.equal(album?.name,'真实服务器验收专辑');
    const {album:albumData}=await api('getAlbum',{id:album.id});
    assert.equal(albumData.song.length,2);
    await api('createPlaylist',{name:'真实服务器共享歌单',songId:albumData.song.map(item=>item.id)});
    first=await launch(18995,path.join(working,'first'));
    const dialog=await open(first.page),page=first.page;
    await dialog.getByRole('button',{name:'真实服务器曲目一 · 本机验收',exact:true}).click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().audioQuality==='lossless');
    await page.getByRole('button',{name:'正在播放',exact:true}).click();
    const label=page.locator('[data-now-audio-label]'),codecOption=page.getByRole('combobox',{name:'切换音质'});
    const seek=page.locator('#listeningRoom > .lr-player-wrap [data-seek]');
    const seekBox=await seek.boundingBox();
    assert.ok(seekBox);
    await page.mouse.click(seekBox.x+seekBox.width*.30,seekBox.y+seekBox.height/2);
    await page.waitForFunction(()=>SonicPlayback.position()>8);
    const current=()=>page.evaluate(()=>{
      const s=SonicPlayback.snapshot({queue:true});
      return {id:s.track.id,queue:s.queue?.map(item=>item.entryId),position:s.position,uri:document.querySelector('#audio').currentSrc};
    });
    const original=await current();
    const inspect=async(name)=>{
      const {uri}=await current();
      const response=await fetch(uri,{signal:AbortSignal.timeout(12000)});
      assert.equal(response.status,200);
      const file=path.join(working,name+'.bin');
      await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));
      const result=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_name,bit_rate,sample_rate','-of','json',file],{windowsHide:true});
      assert.equal(result.status,0,result.stderr.toString());
      return JSON.parse(result.stdout.toString()).streams[0];
    };
    assert.equal(await label.textContent(),'无损 · 全曲');
    const details=page.locator('[data-audio-format-info]');
    if(process.argv.includes('--format-detail')){
      await details.filter({hasText:'播放器收到源文件流 FLAC'}).waitFor();
      assert.match(await details.textContent(),/服务器源文件 FLAC/);
    }
    const flac=await inspect('desktop-original');
    assert.equal(flac.codec_name,'flac');
    await page.getByRole('button',{name:'查音质',exact:true}).click();
    await codecOption.waitFor();
    assert.deepEqual(await codecOption.locator('option').allTextContents(),['无损','标准']);
    const setQuality=async(quality,expected,labelText)=>{
      const before=await current();
      await codecOption.selectOption(quality);
      await page.waitForFunction(expected=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().audioQuality===expected,expected).catch(async error=>{
        const actual=await page.evaluate(()=>{
          const state=SonicPlayback.snapshot(),audio=document.getElementById('audio');
          return {status:document.querySelector('[data-audio-quality-status]').textContent,quality:state.audioQuality,playing:state.playing,
            position:state.position,duration:audio.duration,error:audio.error?.message};
        });
        throw new Error('Expected '+expected+' playing. Actual '+JSON.stringify(actual),{cause:error});
      });
      const after=await current();
      assert.equal(after.id,original.id);
      assert.equal(original.queue?.length,2);
      assert.deepEqual(after.queue,original.queue);
      assert.ok(after.position>=before.position-.35&&after.position<before.position+1,JSON.stringify({before:before.position,after:after.position}));
      assert.equal(await label.textContent(),labelText);
      return [before.position.toFixed(3),after.position.toFixed(3)];
    };
    const toStandard=await setQuality('standard','standard','标准 · 全曲'),mp3=await inspect('desktop-standard');
    assert.equal(mp3.codec_name,'mp3');
    assert.equal(mp3.bit_rate,'128000');
    if(process.argv.includes('--format-detail')){
      await details.filter({hasText:'播放器收到服务器转码 MP3'}).waitFor();
      assert.match(await details.textContent(),/服务器源文件 FLAC.*MP3.*最高 128 kbps/);
    }
    const toLossless=await setQuality('lossless','lossless','无损 · 全曲');
    assert.deepEqual(await inspect('desktop-restored'),flac);
    console.log('PASS real Navidrome FLAC 44100 Hz → MP3 128 kbps → FLAC, same song/queue, profile Windows seek/resume',JSON.stringify({toStandard,toLossless,flac,mp3}));
  }catch(error){console.error('Navidrome recent log:',...logs.map(line=>line.replaceAll(password,'[hidden]')));throw error;}
  finally{
    await first?.app.close().catch(()=>{});
    if(server.exitCode===null){
      const stopped=once(server,'exit',{signal:AbortSignal.timeout(3000)}).catch(()=>{});
      server.kill();await stopped;
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
