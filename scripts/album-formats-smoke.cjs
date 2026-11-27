'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright');

const rate=44100,leftCount=95841,rightCount=185220,cut=leftCount/rate;
const mime={wav:'audio/wav',flac:'audio/flac',mp3:'audio/mpeg'};
const baseline=process.argv.includes('--baseline');
const codec={flac:['-c:a','flac'],mp3:['-c:a','libmp3lame','-q:a','2']};
const port=18993;
function wave(length,offset){
  const b=Buffer.alloc(44+length*4);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);
  b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(length*4,40);
  for(let i=0;i<length;i++){
    const sample=Math.round(Math.sin((i+offset)*2*Math.PI*437/rate)*9500);
    b.writeInt16LE(sample,44+i*4);b.writeInt16LE(sample,46+i*4);
  }
  return b;
}
async function fixtures(dir){
  const data={};
  for(const [part,size,offset,number] of [['前段',leftCount,0,0],['后段',rightCount,leftCount,1]]){
    const original=path.join(dir,part+'.wav');
    await fs.writeFile(original,wave(size,offset));
    for(const format of ['wav','flac','mp3']){
      const filename=path.join(dir,part+'.'+format);
      if(format!=='wav'){
        const conversion=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',original,...codec[format],filename],{windowsHide:true});
        assert.equal(conversion.status,0,conversion.error?.message||conversion.stderr?.toString());
      }
      (data[format]||=[])[number]=await fs.readFile(filename);
    }
    const raw=path.join(dir,part+'-no-xing.mp3');
    const conversion=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',original,...codec.mp3,'-write_xing','0',raw],{windowsHide:true});
    assert.equal(conversion.status,0,conversion.error?.message||conversion.stderr?.toString());
    (data.raw||=[])[number]=await fs.readFile(raw);
  }
  return data;
}
async function playCheck(dir,files,[leftFormat,rightFormat],joined,tag){
  const exe=process.env.SONIC_DESKTOP_EXECUTABLE;
  const profile=await fs.mkdtemp(path.join(dir,'profile-'));
  const app=await _electron.launch({executablePath:exe,args:['--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
    env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port),SONIC_DISABLE_QISHUI:'1'}});
  try{
    const page=await app.firstWindow();page.setDefaultTimeout(13000);
    await page.waitForURL(url=>url.origin==='http://127.0.0.1:'+port);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
    await page.addInitScript(()=>{
      const connect=AudioNode.prototype.connect;
      AudioNode.prototype.connect=function(destination,...args){
        if(destination===this.context.destination&&this.constructor.name==='GainNode')window.albumMaster=this;
        return connect.call(this,destination,...args);
      };
    });
    await page.reload();
    await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready);
    const room=page.locator('#listeningRoom');
    const picker=page.waitForEvent('filechooser');
    await room.locator('.lr-home-card').getByRole('button',{name:'导入音乐',exact:true}).click();
    const names=['连续音频 01','连续音频 02'];
    await (await picker).setFiles([leftFormat,rightFormat].map((key,index)=>{
      const format=key==='raw'?'mp3':key;
      return {name:names[index]+'.'+format,mimeType:mime[format],buffer:files[key][index]};
    }));
    await page.waitForFunction(names=>!SonicPlayback.library().importing&&names.every(name=>SonicPlayback.library().tracks.some(t=>t.name===name)),names);
    await page.evaluate(async names=>{
      for(const track of SonicPlayback.library().tracks.filter(t=>names.includes(t.name))){
        const details=await SonicPlayback.localTrackDetails(track.id);
        assertSaved(await SonicPlayback.saveLocalTrackDetails(track.id,{...details,album:'连续专辑'}));
      }
      function assertSaved(value){if(!value)throw new Error('Fixture metadata write failed');}
      SonicPlayback.setVolume(.65);
    },names);
    await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
    await room.getByRole('searchbox',{name:'搜索音乐',exact:true}).fill('连续音频');
    await room.getByRole('button',{name:'播放 '+names[0],exact:true}).click();
    await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing,names[0]);
    const start=await page.evaluate(()=>{
      const audio=document.getElementById('audio'),node=window.albumMaster,ctx=node.context;
      const sink=ctx.createGain();sink.gain.value=0;
      const tap=ctx.createScriptProcessor(256,1,1);
      const frames=[],stops=[];
      const initial=audio.currentSrc;
      let last=0;
      tap.onaudioprocess=event=>{
        const samples=event.inputBuffer.getChannelData(0);
        let ss=0,edge=0;
        for(const sample of samples){ss+=sample*sample;edge=Math.max(edge,Math.abs(sample-last));last=sample;}
        frames.push({media:audio.currentTime,same:audio.currentSrc===initial,rms:Math.sqrt(ss/samples.length),edge});
      };
      node.connect(tap);tap.connect(sink);sink.connect(ctx.destination);
      for(const event of ['ended','pause','emptied','error'])audio.addEventListener(event,()=>stops.push(event));
      window.albumData={frames,stops,seconds:tap.bufferSize/ctx.sampleRate};
      return {duration:audio.duration,initial};
    });
    await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing&&SonicPlayback.position()>.43,names[1]);
    const stats=await page.evaluate(cut=>{
      const {frames,stops,seconds}=window.albumData;
      const around=frames.filter(row=>row.same?row.media>=cut-.24&&row.media<=cut+.25:row.media<=.28);
      let silent=0,longest=0;
      for(const row of around){silent=row.rms<.002?silent+1:0;longest=Math.max(longest,silent);}
      return {stops:stops.slice(),frames:around.length,oneSource:frames.every(row=>row.same),
        quietMs:Math.round(1000*longest*seconds*100)/100,minimumRms:Math.min(...around.map(row=>row.rms)),
        maxSampleDelta:Math.max(...around.map(row=>row.edge))};
    },cut);
    assert.ok(stats.frames>=10,JSON.stringify(stats));
    assert.equal(stats.oneSource,joined,JSON.stringify({tag,start,stats}));
    if(joined){
      assert.ok(Math.abs(start.duration-(cut+rightCount/rate))<.004,JSON.stringify(start));
      assert.equal(stats.quietMs,0,JSON.stringify(stats));
      assert.deepEqual(stats.stops,[]);
    }else assert.ok(stats.stops.includes('ended')&&stats.quietMs>0,JSON.stringify(stats));
    console.log(JSON.stringify({tag,baseline,joinSeconds:cut,combinedDuration:start.duration,...stats}));
    if(!joined||tag==='flac')return;
    const dock=room.locator(':scope > .lr-player-wrap'),slider=dock.getByRole('slider',{name:'歌曲进度'});
    await dock.getByRole('button',{name:'暂停音乐',exact:true}).click();
    const box=await slider.boundingBox();
    await page.mouse.move(box.x+box.width*.40,box.y+box.height/2);
    await page.mouse.down();await page.mouse.move(box.x+box.width*.62,box.y+box.height/2,{steps:4});
    const expected=Number(await slider.inputValue());await page.mouse.up();
    await page.waitForFunction(time=>Math.abs(SonicPlayback.position()-time)<.07,expected);
    await dock.locator('[data-action="previous"]').click();
    await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name,names[0]);
    await dock.locator('[data-action="next"]').click();
    await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name,names[1]);
    if(await dock.getByRole('button',{name:'暂停音乐',exact:true}).isVisible())await dock.getByRole('button',{name:'暂停音乐',exact:true}).click();
    await room.locator('[data-room-mode="work"]:visible').first().click();
    const repeat=room.locator('.lr-queue-mode[data-action="repeat"]');
    for(let i=0;i<4&&!(await repeat.textContent()).includes('单曲循环');i++)await repeat.click();
    assert.match(await repeat.textContent(),/单曲循环/);
    const end=await slider.boundingBox();
    await page.mouse.click(end.x+end.width*.94,end.y+end.height/2);
    await page.waitForFunction(()=>SonicPlayback.position()>3.5);
    await dock.getByRole('button',{name:'播放音乐',exact:true}).click();
    await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing&&SonicPlayback.position()<1,names[1]);
    console.log('PASS '+tag+' UI pause, drag to '+expected.toFixed(2)+' s, previous/next, single-track repeat.');
  }finally{await app.close().catch(()=>{});}
}
async function main(){
  assert.ok(process.env.SONIC_DESKTOP_EXECUTABLE,'Set SONIC_DESKTOP_EXECUTABLE to the packaged Windows EXE');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sonic-album-smoke-'));
  const input=await fixtures(dir);
  await playCheck(dir,input,['flac','flac'],!baseline,'flac');
  await playCheck(dir,input,['mp3','mp3'],!baseline,'mp3');
  if(!baseline){
    await playCheck(dir,input,['wav','wav'],true,'pcm-wav');
    await playCheck(dir,input,['flac','mp3'],false,'flac-mp3');
    await playCheck(dir,input,['raw','raw'],false,'mp3-without-gapless-metadata');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
