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
  const working=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'sonic-navidrome-sync-'));
  const songs=path.join(working,'music'),data=path.join(working,'data');
  await fs.mkdir(songs);await fs.mkdir(data);
  for(const [number,title] of [[1,'真实服务器曲目一'],[2,'真实服务器曲目二'],[3,'真实服务器曲目三']]){
    const ffmpeg=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency='+(350+number*90)+':duration=30',
      '-metadata','title='+title,'-metadata','artist=本机验收','-metadata','album=真实服务器验收专辑',
      '-metadata','track='+number,'-codec:a','libmp3lame',path.join(songs,number+'.mp3')],{windowsHide:true});
    if(ffmpeg.error||ffmpeg.status)throw ffmpeg.error||new Error(ffmpeg.stderr.toString());
  }
  const password=randomBytes(20).toString('hex');
  const server=spawn(binary,[],{cwd:working,windowsHide:true,stdio:['ignore','ignore','pipe'],
    env:{...process.env,ND_MUSICFOLDER:songs,ND_DATAFOLDER:data,ND_ADDRESS:'127.0.0.1',ND_PORT:'18994',
      ND_LOGLEVEL:'warn',ND_ENABLEINSIGHTSCOLLECTOR:'false',ND_DEVAUTOCREATEADMINPASSWORD:password}});
  const logs=[];server.stderr.on('data',value=>{logs.push(value.toString());if(logs.length>10)logs.shift();});
  let first,second;
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
    await d.getByRole('button',{name:'编辑歌单',exact:true}).waitFor();
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
    assert.equal(albumData.song.length,3);
    const names=['真实服务器曲目一','真实服务器曲目二','真实服务器曲目三'];
    const label=(index)=>names[index]+' · 本机验收';
    const {playlist}=await api('createPlaylist',{name:'真实服务器共享歌单',songId:albumData.song.slice(0,2).map(item=>item.id)});
    first=await launch(18995,path.join(working,'first'));
    second=await launch(18996,path.join(working,'second'));
    const a=await open(first.page),b=await open(second.page);
    const click=(view,name)=>view.getByRole('button',{name,exact:true}).click();
    const message=(view,expected)=>view.getByRole('status').filter({hasText:expected}).waitFor();
    const order=async(view,expected)=>{
      const region=view.getByRole('heading',{name:'真实服务器共享歌单',exact:true}).locator('..');
      assert.deepEqual(await region.locator('li button:first-child').allTextContents(),expected.map(label));
    };
    const add=async(view,index)=>{
      const search=view.getByRole('searchbox',{name:'搜索可加入的歌曲'});
      await search.fill(names[index]);await search.press('Enter');
      await click(view,'添加 '+label(index));
    };
    const save=async view=>{await click(view,'保存歌单');await message(view,'歌单已保存到服务器');};
    await click(a,'编辑歌单');await add(a,2);
    await click(a,'上移 3. '+names[2]);await click(a,'上移 2. '+names[2]);
    await click(a,'移除 3. '+names[1]);await save(a);await order(a,[2,0]);
    await click(b,'刷新歌单');await message(b,'2 首歌曲');await order(b,[2,0]);
    console.log('PASS A add, remove, reorder. B refresh [3, 1].');

    await click(a,'编辑歌单');await click(b,'编辑歌单');
    await click(a,'下移 1. '+names[2]);await click(b,'移除 2. '+names[0]);await save(a);
    await click(b,'保存歌单');await message(b,'歌单冲突');
    assert.deepEqual(await b.getByRole('heading',{name:'我的版本'}).locator('..').locator('li').allTextContents(),[label(2)]);
    assert.deepEqual(await b.getByRole('heading',{name:'服务器版本'}).locator('..').locator('li').allTextContents(),[0,2].map(label));
    await click(b,'保留服务器版本');await message(b,'2 首歌曲');await order(b,[0,2]);
    console.log('PASS concurrent drafts, conflict compares both orders, keep server.');

    await click(a,'编辑歌单');await click(b,'编辑歌单');
    await add(a,1);await save(a);
    await click(b,'上移 2. '+names[2]);
    await click(b,'保存歌单');await message(b,'歌单冲突');
    await click(b,'保存我的版本');await message(b,'歌单已保存到服务器');await order(b,[2,0]);
    const verified=(await api('getPlaylist',{id:playlist.id})).playlist.entry.map(song=>song.title);
    assert.deepEqual(verified,[names[2],names[0]]);
    await click(a,'刷新歌单');
    await message(a,'歌单冲突');
    await click(a,'保留服务器版本');await message(a,'2 首歌曲');await order(a,[2,0]);
    console.log('PASS explicit keep mine writes the ordered list. The other desktop detects it on refresh.');

    await a.getByRole('button',{name:'收藏到服务器',exact:true}).first().click();
    await message(a,'已保存到服务器');
    await click(b,'服务器收藏');
    await b.getByRole('button',{name:label(2),exact:true}).waitFor();
    await click(a,label(2));
    const seek=first.page.locator('#listeningRoom > .lr-player-wrap [data-seek]');
    await first.page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.position()>.2);
    const box=await seek.boundingBox();
    assert.ok(box);
    await first.page.mouse.click(box.x+box.width*.31,box.y+box.height/2);
    await first.page.waitForFunction(()=>SonicPlayback.position()>7);
    const before=await first.page.evaluate(()=>SonicPlayback.position());
    const exited=once(first.app.process(),'exit',{signal:AbortSignal.timeout(12000)});
    await first.app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});
    assert.deepEqual(await exited,[0,null]);first=null;
    const checkpoint=(await api('getPlayQueueByIndex')).playQueueByIndex;
    assert.equal(checkpoint.entry[checkpoint.currentIndex].title,names[2]);
    assert.deepEqual(checkpoint.entry.map(song=>song.title),[2,0].map(index=>names[index]));
    assert.ok(Math.abs(checkpoint.position/1000-before)<.5,JSON.stringify({before,saved:checkpoint.position/1000}));
    await click(b,'从服务器继续听');
    await second.page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.position()>7);
    const resumed=await second.page.evaluate(()=>({name:SonicPlayback.snapshot().track.name,position:SonicPlayback.position()}));
    assert.equal(resumed.name,names[2]);assert.ok(Math.abs(resumed.position-checkpoint.position/1000)<.5,JSON.stringify(resumed));
    console.log('PASS real Navidrome 0.64.2, A at '+before.toFixed(3)+' s, server saved '+(checkpoint.position/1000).toFixed(3)+' s, B resumed '+resumed.position.toFixed(3)+' s.');
  }catch(error){console.error('Navidrome recent log:',...logs.map(line=>line.replaceAll(password,'[hidden]')));throw error;}
  finally{
    await Promise.allSettled([first?.app.close(),second?.app.close()]);
    if(server.exitCode===null){
      const stopped=once(server,'exit',{signal:AbortSignal.timeout(3000)}).catch(()=>{});
      server.kill();await stopped;
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
