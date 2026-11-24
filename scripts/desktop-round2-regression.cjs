'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {_electron}=require('playwright');

const repo=path.resolve(__dirname,'..');
const fixtures=process.env.SONIC_R2_FIXTURES;
const shots=process.env.SONIC_QA_SCREENSHOTS;
const nativePaste=process.argv.includes('--native-paste');
const coverNames=['QA2-Cover-Red','QA2-Cover-Blue'];
const coverLyrics=['红封面测试歌词','蓝封面测试歌词'];
const morning='晨曲',night='夜曲';
const libraryNames=Array.from({length:24},(_,i)=>'R2-'+(i<12?morning:night)+'-'+String(i+1).padStart(2,'0'));

function clipboard(command){
  return execFileSync('powershell.exe',['-NoProfile','-Sta','-Command','Add-Type -AssemblyName System.Windows.Forms; '+command],{encoding:'utf8',windowsHide:true}).trim();
}

function writeClipboard(base64){
  if(base64)clipboard("$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+base64+"')); [Windows.Forms.Clipboard]::SetText($text)");
  else clipboard('[Windows.Forms.Clipboard]::Clear()');
}

function audio(seconds){
  const rate=8000,size=rate*seconds*2,wav=Buffer.alloc(44+size);
  wav.write('RIFF');wav.writeUInt32LE(36+size,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(size,40);
  for(let i=0;i<size/2;i++)wav.writeInt16LE(Math.round(Math.sin(i/9)*900),44+2*i);
  return wav;
}

async function inputFiles(temporary,group,names){
  const folder=path.join(fixtures||temporary,group);
  if(fixtures)return (await fs.readdir(folder)).sort().map(file=>path.join(folder,file));
  await fs.mkdir(folder);
  const wave=audio(8);
  const files=names.map(name=>path.join(folder,name+'.wav'));
  await Promise.all(files.map(file=>fs.writeFile(file,wave)));
  return files;
}

async function run(){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sonic-r2-regression-'));
  const profile=path.join(temporary,'profile');
  let app,savedClipboard;
  try{
    app=await _electron.launch({args:[repo,'--mute-audio','--disable-backgrounding-occluded-windows'],cwd:repo,
      env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:process.env.SONIC_R2_PORT||'19036'}});
    const page=await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready&&window.SonicListeningRoom);
    if(shots)await fs.mkdir(shots,{recursive:true});
    const capture=async name=>{
      if(!shots)return;
      const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await fs.writeFile(path.join(shots,name+'.png'),Buffer.from(png,'base64'));
    };
    const resize=async(width,height)=>{
      const [w,h]=await app.evaluate(({BrowserWindow},size)=>{
        const window=BrowserWindow.getAllWindows()[0];window.setSize(...size);return window.getContentSize();
      },[width,height]);
      await page.waitForFunction(([w,h])=>Math.abs(innerWidth-w)<2&&Math.abs(innerHeight-h)<2,[w,h]);
    };
    const room=page.locator('#listeningRoom');
    const library=room.locator('[data-sl-tracks]');
    const listRow=name=>library.locator('[data-sl-id]').filter({has:page.getByText(name,{exact:true})});
    const mode=value=>room.locator('[data-room-mode="'+value+'"]').click();
    const state=()=>page.evaluate(()=>SonicPlayback.snapshot({queue:true}));
    const importFiles=async(group,names)=>{
      await page.locator('#fileInput').setInputFiles(await inputFiles(temporary,group,names));
      await page.waitForFunction(names=>{
        const library=SonicPlayback.library();
        return !library.importing&&names.every(name=>library.tracks.some(track=>track.name===name));
      },names);
      const report=room.locator('[data-sl-import-report]');
      if(await report.isVisible())await report.locator('[data-sl-command=dismiss-import]').click();
    };

    await resize(1360,900);
    await mode('library');
    await importFiles('换歌预览',coverNames);
    if(!fixtures)await page.evaluate(async({names,lyrics})=>{
      for(const [index,name] of names.entries()){
        const track=SonicPlayback.library().tracks.find(track=>track.name===name);
        const canvas=document.createElement('canvas');canvas.width=canvas.height=48;
        const ctx=canvas.getContext('2d');ctx.fillStyle=index?'#2260ff':'#f33a23';ctx.fillRect(0,0,48,48);
        await SonicPlayback.saveLocalTrackDetails(track.id,{cover:canvas.toDataURL(),lyricsRaw:'[00:00.00]'+lyrics[index]});
      }
    },{names:coverNames,lyrics:coverLyrics});
    const gallery=room.locator('[data-player-bg-dialog]');
    const lyricDesign=room.locator('[data-effect-dialog]');
    const headerSettings=room.locator('.lr-header [data-action=settings]');
    const auto=gallery.locator('[data-player-bg-select=default]');
    const composition=gallery.locator('[data-player-bg-composition]');
    const previewCanvas=composition.locator('canvas');
    const previewLine=composition.locator('strong');
    const playOrder=names=>page.evaluate(async names=>{
      const tracks=SonicPlayback.library().tracks;
      const ids=names.map(name=>tracks.find(track=>track.name===name).id);
      await SonicPlayback.playFromLibrary(ids[0],'all',true,ids);
    },names);
    const seekTo=position=>page.evaluate(position=>SonicPlayback.seek(position),position);
    const waitCover=index=>page.waitForFunction(({name,index})=>{
      const state=SonicPlayback.snapshot();
      const rgb=getComputedStyle(document.querySelector('#listeningRoom')).getPropertyValue('--lr-cover-rgb').split(',').map(Number);
      return state.track?.name===name&&state.playing&&(index?rgb[2]-rgb[0]>35:rgb[0]-rgb[2]>35);
    },{name:coverNames[index],index},{timeout:19000});
    const previewColor=()=>previewCanvas.evaluate(canvas=>{
      const {width,height}=canvas;
      return [...canvas.getContext('2d').getImageData(Math.round(width*.26),Math.round(height*.38),1,1).data].slice(0,3);
    });
    const expectColor=async index=>page.waitForFunction(index=>{
      const canvas=document.querySelector('[data-player-bg-dialog] canvas');
      const {width,height}=canvas;
      const rgb=canvas.getContext('2d').getImageData(Math.round(width*.26),Math.round(height*.38),1,1).data;
      return index?rgb[2]-rgb[0]>14:rgb[0]-rgb[2]>14;
    },index);
    await mode('listen');
    await page.emulateMedia({reducedMotion:'reduce'});
    await room.locator('.lr-now-actions [data-action=lyric-effects]').click();
    await room.locator('button[data-lyric-style=list]').click();
    await lyricDesign.locator('[data-effect-apply]').click();
    await room.locator('[data-action=collapse-lyrics]').click();
    for(const [first,second] of [[0,1],[1,0]]){
      await playOrder([coverNames[first],coverNames[second]]);
      await waitCover(first);
      await headerSettings.click();await auto.click();
      await expectColor(first);
      await page.waitForFunction(line=>document.querySelector('[data-player-bg-dialog] strong').textContent===line,coverLyrics[first]);
      const oldColor=await previewColor();
      if(first===0)await capture('after-red');
      await waitCover(second);
      await page.waitForFunction(line=>document.querySelector('[data-player-bg-dialog] strong').textContent===line,coverLyrics[second]);
      assert.equal(await gallery.evaluate(el=>el.open),true);
      await expectColor(second);
      const newColor=await previewColor();
      if(first===0)await capture('after-blue');
      await auto.click();
      assert.deepEqual(await previewColor(),newColor);
      console.log(coverNames[first]+' → '+coverNames[second]+': '+oldColor.join(',')+' → '+newColor.join(',')+'; '+await previewLine.textContent());
      await page.keyboard.press('Escape');
    }

    {
      const track=await page.evaluate(name=>SonicPlayback.library().tracks.find(track=>track.name===name),coverNames[0]);
      await page.evaluate(async track=>{
        await SonicPlayback.saveLocalTrackDetails(track.id,{cover:track.cover,lyricsRaw:'[00:00.00]第一行\n[00:04.00]第二行',
          translationRaw:'[00:00.00]First line\n[00:04.00]Second line'});
      },track);
      await playOrder(coverNames);await waitCover(0);
      await headerSettings.click();await auto.click();
      await expectColor(0);
      const initial=await previewColor();
      await previewCanvas.evaluate(canvas=>{
        const context=canvas.getContext('2d'),fill=context.fillRect.bind(context);
        canvas.dataset.paints='0';
        context.fillRect=(...args)=>{canvas.dataset.paints=String(Number(canvas.dataset.paints)+1);return fill(...args);};
      });
      await page.waitForFunction(()=>document.querySelector('[data-player-bg-dialog] strong').textContent==='第二行');
      assert.equal(await composition.locator('.lr-player-bg-sample span').textContent(),'Second line');
      assert.equal(await previewCanvas.getAttribute('data-paints'),'0');
      assert.deepEqual(await previewColor(),initial);
      await gallery.locator('[data-picture-tuning] summary').click();
      await gallery.locator('[data-brightness]').press('ArrowRight');
      await page.waitForFunction(()=>Number(document.querySelector('[data-player-bg-dialog] canvas').dataset.paints)>0);
      await gallery.locator('[data-player-bg-select=white-coast]').click();
      await composition.and(page.locator('[data-background=white-coast]')).waitFor();
      const photo=await previewCanvas.evaluate(canvas=>canvas.toDataURL());
      await waitCover(1);
      await page.waitForFunction(line=>document.querySelector('[data-player-bg-dialog] strong').textContent===line,coverLyrics[1]);
      assert.ok(await previewCanvas.evaluate((canvas,photo)=>canvas.toDataURL()===photo,photo),'the paused photo should stay put when the artwork changes');
      assert.equal(await room.getAttribute('data-playback-background-rendered'),'default');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.querySelector('[data-player-bg-dialog] canvas').width===0);
      console.log('PASS 双语自然换句不重绘，照片换歌不重绘，关闭弹窗释放画布');
    }
    await page.emulateMedia({reducedMotion:'no-preference'});

    await mode('library');await resize(760,620);
    await importFiles('曲库定位',libraryNames);
    await page.evaluate(async name=>{
      const track=SonicPlayback.library().tracks.find(track=>track.name===name);
      const lyricsRaw=Array.from({length:23},(_,index)=>'[00:'+(index/4).toFixed(2).padStart(5,'0')+']第 '+(index+1)+' 行').join('\n');
      await SonicPlayback.saveLocalTrackDetails(track.id,{cover:track.cover,lyricsRaw});
    },coverNames[1]);
    await playOrder([...coverNames].reverse());await waitCover(1);
    await page.evaluate(()=>SonicPlayback.toggle());
    await seekTo(2.4);
    await page.waitForFunction(()=>!SonicPlayback.snapshot().playing&&Math.abs(SonicPlayback.snapshot().position-2.4)<.08);
    const transport=await state();
    const search=room.locator('[data-sl-search]');
    await room.locator('[data-sl-sort]').selectOption('name');
    const topRow=()=>library.evaluate(list=>{
      const edge=document.querySelector('.lr-header').getBoundingClientRect().bottom;
      const row=[...list.children].find(row=>row.getBoundingClientRect().bottom>edge);
      return row?{name:row.querySelector('strong').textContent,offset:Math.round(row.getBoundingClientRect().top-edge),y:scrollY}:null;
    });
    const wheelTo=async name=>{
      const row=listRow(name);
      assert.equal(await row.count(),1);
      const point=await row.evaluate(row=>{
        const dock=document.querySelector('.lr-player-wrap').getBoundingClientRect().top;
        const header=document.querySelector('.lr-header').getBoundingClientRect();
        return {x:Math.min(innerWidth-40,660),y:Math.round((dock+header.bottom)/2),
          delta:Math.round(row.getBoundingClientRect().top-header.height+4)};
      });
      await page.mouse.move(point.x,point.y);
      await page.mouse.wheel(0,point.delta);
      await page.waitForFunction(({name})=>{
        const edge=document.querySelector('.lr-header').getBoundingClientRect().bottom;
        const row=[...document.querySelector('[data-sl-tracks]').children].find(row=>row.getBoundingClientRect().bottom>edge);
        return row?.querySelector('strong').textContent===name&&Math.abs(row.getBoundingClientRect().top-edge+4)<=3;
      },{name});
      return topRow();
    };
    const assertPosition=(actual,expected)=>{
      assert.equal(actual.name,expected.name);
      assert.ok(Math.abs(actual.offset-expected.offset)<=3,JSON.stringify({actual,expected}));
    };
    if(nativePaste){
      savedClipboard=clipboard("$data=[Windows.Forms.Clipboard]::GetDataObject(); if($data -and ($data.GetFormats($false) | Where-Object {$_ -notin @('UnicodeText','Text','Locale','OEMText','System.String','Chromium internal source RFH token','Chromium internal source URL')})) { throw 'Native paste check requires an empty or plain-text clipboard' }; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Windows.Forms.Clipboard]::GetText()))");
    }
    const replace=async value=>{
      assert.equal(await search.evaluate(el=>document.activeElement===el),true);
      await page.keyboard.press('Control+a');
      if(!value)await page.keyboard.press('Backspace');
      else if(nativePaste){
        writeClipboard(Buffer.from(value).toString('base64'));
        await page.keyboard.press('Control+v');
      }else await page.keyboard.insertText(value);
      assert.equal(await search.inputValue(),value);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await search.evaluate(el=>document.activeElement===el),true);
      return topRow();
    };
    await search.click();await replace(morning);
    const morningPosition=await wheelTo('R2-晨曲-03');
    await replace(night);
    const nightPosition=await wheelTo('R2-夜曲-15');
    const morningRestored=await replace(morning);
    assertPosition(morningRestored,morningPosition);
    const nightRestored=await replace(night);
    assertPosition(nightRestored,nightPosition);
    await replace('');
    const unfiltered=await wheelTo('R2-晨曲-09');
    await replace(morning);
    const unfilteredRestored=await replace('');
    assertPosition(unfilteredRestored,unfiltered);
    console.log('曲库顶部 '+[morningPosition,morningRestored,nightPosition,nightRestored,unfiltered,unfilteredRestored].map(p=>p.name+'@'+p.offset).join(' | '));
    {
      await replace(morning);
      await mode('visual');await mode('library');
      assertPosition(await topRow(),morningPosition);
      await page.evaluate(async names=>{
        const tracks=SonicPlayback.library().tracks;
        for(const name of names)await SonicPlayback.toggleFavorite(tracks.find(track=>track.name===name).id);
      },libraryNames.slice(0,12));
      await room.locator('[data-sl-view=favorites]').click();
      await room.locator('[data-sl-sort]').selectOption('name');
      const anchor=await wheelTo('R2-晨曲-03');
      const favorite=listRow(anchor.name).locator('[data-sl-command=favorite]');
      const neighbor=await listRow('R2-晨曲-04').evaluate(row=>Math.round(row.getBoundingClientRect().top));
      await favorite.click();
      await listRow(anchor.name).waitFor({state:'detached'});
      const neighborAfter=await listRow('R2-晨曲-04').evaluate(row=>Math.round(row.getBoundingClientRect().top));
      assert.ok(Math.abs(neighbor-neighborAfter)<=3,JSON.stringify({neighbor,neighborAfter}));
      await page.emulateMedia({reducedMotion:'reduce'});
      await mode('listen');
      await room.locator('[data-now-lyrics]').click();
      const full=room.locator('[data-full-lyrics]');
      const startingTop=await full.evaluate(el=>el.scrollTop);
      await full.hover();await page.mouse.wheel(0,165);
      await page.waitForFunction(top=>document.querySelector('[data-full-lyrics]').scrollTop>top+80,startingTop);
      const follow=room.locator('[data-lyric-follow]');
      await follow.waitFor();
      const lyricTop=await full.evaluate(el=>el.scrollTop);
      await mode('visual');await mode('listen');
      await follow.waitFor();
      assert.ok(Math.abs(await full.evaluate(el=>el.scrollTop)-lyricTop)<=3);
      const after=await state();
      assert.equal(after.track.id,transport.track.id);
      assert.equal(after.playing,transport.playing);
      assert.ok(Math.abs(after.position-transport.position)<.08);
      assert.deepEqual(after.queue.map(entry=>entry.id),transport.queue.map(entry=>entry.id));
      console.log('PASS 筛选切页、原定位歌曲取消收藏后保留相邻行、全文手动阅读和播放状态');
    }
  }finally{
    if(app){
      if(savedClipboard!==undefined)writeClipboard(savedClipboard);
      await app.close();
    }
    await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
