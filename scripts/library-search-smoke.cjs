'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, _electron } = require('playwright');
const { createAppServer } = require('../companion/server.cjs');

const root = path.resolve(__dirname,'..');
const port = 18880;
const origin = `http://127.0.0.1:${port}`;
const localNames = ['Orbit Delta','Orbit Alpha','Other Track','Orbit Echo'];
const [delta,alpha,other,echo] = localNames;
const savedList = 'Fixture Saved Order';
const otherList = 'Fixture Other Playlist';
const editNames = Array.from({length:43},(_,index)=>'Playlist Fixture '+String(index+1).padStart(2,'0'));
const addedNames = [editNames[0],editNames[1],editNames[40],editNames[42]];
const remainingNames = [editNames[40],editNames[0]];
const remote = (mediaId,name,extra={}) => ({
  provider:'qishui',mediaId,name,artist:'Fixture Artist',album:'Fixture Album',duration:25,...extra,
});
const qishui = [
  remote('8401','Qishui First'),
  remote('8402','Qishui Known Preview',{preview:true}),
  remote('8403','Qishui Pending Preview'),
  remote('8404','Qishui Last'),
];
const matches = [
  remote('8411','QQ Wrong Version',{album:'A Different Album'}),
  remote('8412','QQ First'),
  remote('8413','QQ Pending Preview'),
  remote('8414','QQ Last'),
];
const publicRows = [
  {...matches[0],provider:'qq',mediaId:'FixtureOfficial',name:'QQ Official Only',artist:'',duration:0},
  ...matches.map((track,index)=>({...track,provider:'qq',mediaId:'FixtureQQ'+index,album:'Fixture Album'})),
];
const previewIds = new Set([qishui[1].mediaId,qishui[2].mediaId,matches[2].mediaId]);

function silentWav(duration=25) {
  const sampleRate=8000, samples=sampleRate*duration, body=Buffer.alloc(44+samples*2);
  body.write('RIFF',0);body.writeUInt32LE(body.length-8,4);body.write('WAVEfmt ',8);
  body.writeUInt32LE(16,16);body.writeUInt16LE(1,20);body.writeUInt16LE(1,22);
  body.writeUInt32LE(sampleRate,24);body.writeUInt32LE(sampleRate*2,28);
  body.writeUInt16LE(2,32);body.writeUInt16LE(16,34);body.write('data',36);body.writeUInt32LE(samples*2,40);
  return body;
}

function provideWav(route,body) {
  const headers={'Accept-Ranges':'bytes'};
  const range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range||'');
  if(!range)return route.fulfill({contentType:'audio/wav',headers,body});
  const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;
  if(start>end)return route.fulfill({status:416,headers:{'Content-Range':`bytes */${body.length}`}});
  headers['Content-Range']=`bytes ${start}-${end}/${body.length}`;
  return route.fulfill({status:206,contentType:'audio/wav',headers,body:body.subarray(start,end+1)});
}

async function mockOnline(page,wav) {
  const searches=[],tickets=[],media=[],matchRequests=[];
  const slowQuery=Promise.withResolvers(),slowDone=Promise.withResolvers();
  await page.route('**/*', async route => {
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin)return ['http:','https:'].includes(url.protocol)?route.abort():route.continue();
    if(url.pathname==='/health')return route.fulfill({json:{ok:true,companion:true}});
    if(url.pathname==='/api/qishui/login-status')return route.fulfill({json:{authenticated:true,user:{nickname:'Fixture'}}});
    const search=/^\/api\/(qishui|qq)\/search$/.exec(url.pathname);
    if(search) {
      const {query}=request.postDataJSON(),provider=search[1];
      searches.push([provider,query]);
      if(query==='Delayed'){
        await slowQuery.promise;
        try{await route.fulfill({json:{items:[remote('8499','Stale Result')]}});}
        catch(error){if(request.failure()?.errorText!=='net::ERR_ABORTED')throw error;}
        finally{slowDone.resolve();}
        return;
      }
      return route.fulfill({json:{items:provider==='qishui'?qishui:publicRows}});
    }
    if(url.pathname==='/api/discovery/charts/match'){
      const input=request.postDataJSON();
      matchRequests.push(input);
      return route.fulfill({json:{item:matches.find(track=>track.name===input.name)||null}});
    }
    const ticket=/^\/api\/qishui\/tracks\/(\d+)\/audio$/.exec(url.pathname);
    if(ticket){
      tickets.push(ticket[1]);
      return route.fulfill({json:{streamPath:`/media/library-search/${ticket[1]}`,preview:previewIds.has(ticket[1])}});
    }
    const audio=/^\/media\/library-search\/(\d+)$/.exec(url.pathname);
    if(audio){media.push(audio[1]);return provideWav(route,wav);}
    if(/^\/api\/qishui\/songs\/\d+\/lyrics$/.test(url.pathname))return route.fulfill({json:{lrc:''}});
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,json:{error:'Fixture endpoint not configured'}});
    return route.continue();
  });
  return {searches,tickets,media,matchRequests,releaseSlow:()=>{slowQuery.resolve();return slowDone.promise;}};
}

async function verify(page,{electron=false}={}) {
  page.setDefaultTimeout(12000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const wav=silentWav(),network=await mockOnline(page,wav);
  if(electron){
    await page.waitForURL(url=>url.origin===origin);
    await page.reload();
  }else await page.goto(origin);
  await page.waitForFunction(()=>window.SonicPlayback?.library().ready);
  await page.evaluate(()=>SonicPlayback.setVolume(0));
  await page.locator('#fileInput').setInputFiles(localNames.map(name=>({name:name+'.wav',mimeType:'audio/wav',buffer:wav})));
  await page.waitForFunction(names=>{
    const library=SonicPlayback.library();
    return !library.importing&&names.every(name=>library.tracks.some(track=>track.name===name));
  },localNames);
  const room=page.locator('#listeningRoom');
  const online=page.locator('#queueDialog');
  const librarySearch=room.getByRole('searchbox',{name:'搜索曲库'});
  const onlineSearch=online.locator('#onlineSearchInput');
  const onlineRows=online.locator('#onlineResults .online-result-title');
  const resultsButton=room.getByRole('button',{name:'播放当前结果',exact:true});
  const mainButton=name=>room.locator(`[data-action="${name}"]`);
  const libSong=name=>room.locator('[data-sl-id] [data-sl-command="play"]').filter({hasText:name});
  const libraryNames=()=>room.locator('[data-sl-id] .sl-song-copy strong').allTextContents();
  const state=()=>page.evaluate(()=>SonicPlayback.snapshot({queue:true}));
  const queueNames=async()=> (await state()).queue.map(item=>item.name);
  const ids=async()=> (await state()).queue.map(item=>item.entryId);
  const waitForTrack=(name,playing=true)=>page.waitForFunction(({name,playing})=>{
    const state=SonicPlayback.snapshot();
    return state.track?.name===name&&!state.busy&&state.playing===playing;
  },{name,playing});
  const searchOnline=query=>onlineSearch.fill(query).then(()=>online.locator('#onlineSearchBtn').click());

  await room.getByRole('button',{name:'音乐库',exact:true}).click();
  await room.locator('[data-sl-view="local"]').click();
  await librarySearch.fill('Orbit');
  await room.locator('[data-sl-sort]').selectOption('name');
  assert.deepEqual(await libraryNames(),[alpha,delta,echo]);
  await resultsButton.click();
  await waitForTrack(alpha);
  assert.deepEqual(await queueNames(),[alpha,delta,echo]);
  const originalIds=await ids();
  await libSong(alpha).click();
  await waitForTrack(alpha,false);
  assert.deepEqual(await ids(),originalIds);
  await libSong(alpha).click();
  await waitForTrack(alpha);
  assert.deepEqual(await ids(),originalIds);
  await mainButton('next').click();
  await waitForTrack(delta);

  await room.locator('[data-sl-view="local"]').click();
  for(const name of [other,delta,echo]){await libSong(name).click();await waitForTrack(name);}
  await room.locator('[data-sl-view="recent"]').click();
  const recent=await libraryNames();
  assert.deepEqual(recent.slice(0,4),[echo,delta,other,alpha]);
  await resultsButton.click();
  assert.deepEqual(await queueNames(),recent);
  await mainButton('next').click();
  await waitForTrack(delta);
  console.log('PASS sorted and recent library results replay in displayed order and active-row toggles preserve queue identity');

  await room.locator('[data-sl-view="local"]').click();
  await librarySearch.fill('Orbit');
  await page.waitForFunction(()=>SonicPlayback.snapshot().onlineReady&&SonicPlayback.snapshot().onlineLoggedIn);
  await room.getByRole('button',{name:'搜在线',exact:true}).click();
  await onlineRows.first().waitFor();
  assert.equal(await onlineSearch.inputValue(),'Orbit');
  assert.deepEqual(network.searches,[['qishui','Orbit']]);
  await online.locator('#onlineSearchLibraryBtn').click();
  assert.equal(await librarySearch.inputValue(),'Orbit');
  assert.deepEqual(new Set(await libraryNames()),new Set([alpha,delta,echo]));
  await room.getByRole('button',{name:'搜在线',exact:true}).click();
  await online.locator('#onlinePlaySearchResultsBtn').click();
  await waitForTrack(qishui[0].name);
  const orderedQishui=[qishui[0].name,qishui[2].name,qishui[3].name];
  assert.deepEqual(await queueNames(),orderedQishui);
  assert.match(await online.locator('#onlineResultStatus').textContent(),/已排除1 首仅试听/);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(()=>window.SonicPlayback?.snapshot().ready);
  await waitForTrack(qishui[0].name,false);
  assert.deepEqual(await queueNames(),orderedQishui);
  await mainButton('play').click();
  await waitForTrack(qishui[0].name);
  await mainButton('next').click();
  await waitForTrack(qishui[3].name);
  assert.deepEqual(await queueNames(),orderedQishui);
  assert.ok(!network.tickets.includes(qishui[1].mediaId));
  assert.ok(network.tickets.includes(qishui[2].mediaId));
  assert.ok(!network.media.includes(qishui[2].mediaId));
  console.log('PASS shared keyword switches between local and online, ordered Qishui replay persists across reload and skips preview tickets');

  await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
  await Promise.all([
    page.waitForRequest(request=>request.url().endsWith('/api/qishui/search')&&request.postDataJSON()?.query==='Delayed'),
    searchOnline('Delayed'),
  ]);
  const canceled=page.waitForEvent('requestfailed',request=>
    request.url().endsWith('/api/qishui/search')&&request.postDataJSON()?.query==='Delayed');
  try{
    await online.locator('[data-online-provider="qq"]').click();
    await searchOnline('Orbit');
    await onlineRows.first().waitFor();
    await canceled;
  }finally{await network.releaseSlow();}
  assert.deepEqual(await onlineRows.allTextContents(),publicRows.map(song=>song.name));
  await online.locator('#onlinePlaySearchResultsBtn').click();
  await waitForTrack(matches[1].name);
  assert.match(await online.locator('#onlineResultStatus').textContent(),/1 首需前往原平台或手选/);
  await page.keyboard.press('Escape');
  await mainButton('next').click();
  await waitForTrack(matches[3].name);
  assert.deepEqual(await queueNames(),matches.map(track=>track.name));
  assert.deepEqual(network.matchRequests.map(({name})=>name),matches.map(track=>track.name));
  assert.deepEqual(network.matchRequests.map(({duration,album})=>[duration,album]),matches.map(()=>[25,'Fixture Album']));
  assert.ok(!network.tickets.includes(matches[0].mediaId));
  assert.ok(network.tickets.includes(matches[2].mediaId));
  assert.ok(!network.media.includes(matches[2].mediaId));

  await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
  await online.locator('[data-online-provider="qishui"]').click();
  await searchOnline('Orbit');
  await online.locator('[data-search-media-id="'+qishui[1].mediaId+'"] [data-result-start]').click();
  await waitForTrack(qishui[1].name);
  assert.ok(network.media.includes(qishui[1].mediaId));
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log('PASS stale online searches abort, public results verify version/order, and explicit selection still plays a preview');
}

async function openLibrary(page) {
  await page.waitForFunction(()=>window.SonicPlayback?.library().ready);
  const room=page.locator('#listeningRoom');
  await room.locator('[data-room-mode="library"]').click();
  return room;
}

function openPlaylist(room,name) {
  return room.locator('[data-sl-playlists] button').filter({hasText:name}).click();
}

function displayedNames(room) {
  return room.locator('[data-sl-id] .sl-song-copy strong').allTextContents();
}

async function verifyPlaylistEditing(page) {
  const room=await openLibrary(page);
  const wave=silentWav(8);
  const files=editNames.map(name=>({name:name+'.wav',mimeType:'audio/wav',buffer:wave}));
  await page.locator('#fileInput').setInputFiles(files);
  await page.waitForFunction(names=>{
    const library=SonicPlayback.library();
    const known=new Set(library.tracks.map(track=>track.name));
    return !library.importing&&names.every(name=>known.has(name));
  },editNames);

  const command=name=>room.locator('[data-sl-command="'+name+'"]').filter({visible:true});
  const search=room.getByRole('searchbox',{name:'搜索曲库'});
  await room.locator('[data-sl-view="local"]').click();
  await search.fill('Orbit');
  await room.locator('[data-sl-sort]').selectOption('name');
  await command('play-all').click();
  await page.waitForFunction(()=>SonicPlayback.snapshot().track?.name==='Orbit Alpha'&&SonicPlayback.snapshot().playing);
  await room.locator('[data-action="play"]').click();
  await page.waitForFunction(()=>!SonicPlayback.snapshot().playing);
  const temporaryQueue=()=>page.evaluate(()=>{
    const snapshot=SonicPlayback.snapshot({queue:true});
    return {current:snapshot.queueEntryId,items:snapshot.queue.map(item=>item.entryId)};
  });
  const before=await temporaryQueue();
  assert.ok(before.current&&before.items.length===3);

  for(const name of [savedList,otherList]){
    await room.getByRole('button',{name:'新建歌单',exact:true}).click();
    const editor=room.getByRole('dialog',{name:'新建歌单'});
    await editor.getByRole('textbox',{name:'歌单名称'}).fill(name);
    await editor.getByRole('button',{name:'保存歌单'}).click();
  }
  await room.locator('[data-sl-view="local"]').click();
  await search.fill('Playlist Fixture');
  await room.locator('[data-sl-sort]').selectOption('name');
  assert.deepEqual(await displayedNames(room),editNames.slice(0,40));
  await command('select').click();
  const selectSong=name=>room.getByRole('checkbox',{name:'选择 '+name,exact:true});
  await selectSong(addedNames[0]).press('Space');
  await selectSong(addedNames[1]).check();
  await command('more').click();
  await selectSong(addedNames[2]).check();
  await selectSong(addedNames[3]).check();
  assert.ok(await selectSong(addedNames[0]).isChecked());
  const waitForSave=text=>page.waitForFunction(expected=>document.querySelector('[data-sl-save-status]')?.textContent===expected,text);
  async function addTo(name,status) {
    await command('batch-add').click();
    const dialog=room.getByRole('dialog',{name:'加入歌单',exact:true});
    await dialog.getByRole('combobox',{name:'选择歌单'}).selectOption({label:name});
    await dialog.getByRole('button',{name:'加入',exact:true}).click();
    await waitForSave(status);
  }
  await addTo(savedList,'已加入 4 首歌曲。');
  await addTo(savedList,'所选歌曲均已在歌单中。');
  await addTo(otherList,'已加入 4 首歌曲。');

  await openPlaylist(room,savedList);
  assert.deepEqual(await displayedNames(room),addedNames);
  await command('select').click();
  await selectSong(addedNames[0]).check();
  await selectSong(addedNames[1]).check();
  await command('move-down').press('Enter');
  await waitForSave('已保存歌单顺序。');
  assert.deepEqual(await displayedNames(room),[addedNames[2],addedNames[0],addedNames[1],addedNames[3]]);
  await command('select-clear').click();
  await selectSong(addedNames[1]).check();
  await selectSong(addedNames[3]).check();
  await command('batch-remove').click();
  await waitForSave('已从当前歌单移出 2 首。');
  assert.deepEqual(await displayedNames(room),remainingNames);
  assert.deepEqual(await temporaryQueue(),before);

  await openPlaylist(room,otherList);
  assert.deepEqual(await displayedNames(room),addedNames);
  await room.locator('[data-sl-view="local"]').click();
  await search.fill('Playlist Fixture');
  await room.locator('[data-sl-sort]').selectOption('name');
  await command('more').click();
  assert.deepEqual(await displayedNames(room),editNames);
  console.log('PASS batch editing spans loaded pages, deduplicates, preserves other memberships and leaves the temporary queue intact');
}

async function verifySavedOrder(page) {
  const room=await openLibrary(page);
  await openPlaylist(room,otherList);
  assert.deepEqual(await displayedNames(room),addedNames);
  await openPlaylist(room,savedList);
  assert.deepEqual(await displayedNames(room),remainingNames);
  await room.locator('[data-sl-command="play-all"]').click();
  await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing,remainingNames[0]);
  await room.locator('[data-action="next"]').click();
  await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing,remainingNames[1]);
}

function readStoredLibrary(page) {
  return page.evaluate(async()=>{
    const requestValue=request=>new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    const database=await requestValue(indexedDB.open('sonic-universe-library',1));
    try{
      const tx=database.transaction(['state','media'],'readonly');
      const [library,ids]=await Promise.all([
        requestValue(tx.objectStore('state').get('library')),
        requestValue(tx.objectStore('media').getAllKeys()),
      ]);
      return {tracks:library.tracks.map(({id,name})=>({id,name})),playlists:library.playlists,ids};
    }finally{database.close();}
  });
}

async function verifyStorageFailures(page) {
  const before=await readStoredLibrary(page);
  assert.ok(before.tracks.length>=editNames.length&&before.playlists.length>=2);
  await page.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      if(this.name!=='media')return put.apply(this,args);
      IDBObjectStore.prototype.put=put;
      throw new DOMException('QA media write failed','DataCloneError');
    };
  });
  await page.locator('#fileInput').setInputFiles({name:'Interrupted Save Fixture.wav',mimeType:'audio/wav',buffer:silentWav(2)});
  await page.waitForFunction(()=>document.querySelector('#app')?.dataset.saveState==='error'&&!SonicPlayback.library().importing);
  const afterFailedWrite=await readStoredLibrary(page);
  assert.deepEqual(afterFailedWrite,before,'a failed media write must roll back metadata and playlist changes');
  const library=await openLibrary(page);
  await library.getByRole('button',{name:'重试保存',exact:true}).click();
  await page.waitForFunction(()=>!SonicPlayback.library().saveFailed);
  const beforeRead=await readStoredLibrary(page);
  const imported=beforeRead.tracks.find(track=>track.name==='Interrupted Save Fixture');
  assert.ok(imported&&beforeRead.ids.includes(imported.id),'retry must save both metadata and the retained audio');

  await page.addInitScript(()=>{
    if(sessionStorage.getItem('sonic-qa-fail-library-read')!=='1')return;
    sessionStorage.removeItem('sonic-qa-fail-library-read');
    const get=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){
      if(this.name!=='state'||key!=='library')return get.call(this,key);
      IDBObjectStore.prototype.get=get;
      throw new DOMException('QA library read failed','UnknownError');
    };
  });
  await page.evaluate(()=>sessionStorage.setItem('sonic-qa-fail-library-read','1'));
  await page.reload();
  const room=await openLibrary(page);
  const failureState=await page.evaluate(async()=>({
    readFailed:SonicPlayback.library().readFailed,
    saveAllowed:await SonicPlayback.retryPlaylistSave(),
  }));
  const afterFailedRead=await readStoredLibrary(page);
  assert.deepEqual(
    {stored:afterFailedRead,state:failureState},
    {stored:beforeRead,state:{readFailed:true,saveAllowed:false}},
  );
  const retry=room.getByRole('button',{name:'重试读取曲库',exact:true});
  assert.ok(await retry.isVisible());
  await retry.click();
  await page.waitForFunction(()=>window.SonicPlayback?.library().ready&&!SonicPlayback.library().readFailed);
  assert.deepEqual(await readStoredLibrary(page),beforeRead);
  await openPlaylist(room,savedList);
  assert.deepEqual(await displayedNames(room),remainingNames);
  console.log('PASS failed write aborts metadata and media together; unread library remains intact and can reload safely');
}

async function run() {
  const packaged=process.argv.includes('--packaged');
  if(packaged||process.argv.includes('--electron')){
    const qa=path.join(root,'work','desktop-qa');
    await fs.mkdir(qa,{recursive:true});
    const profile=await fs.mkdtemp(path.join(qa,'library-search-profile-'));
    const executablePath=packaged?path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE||path.join(root,'release','win-unpacked','声波宇宙.exe')):require('electron');
    const launch=()=>_electron.launch({executablePath,args:packaged?[]:[root],cwd:root,timeout:30000,
      env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)}});
    const app=await launch();
    try{
      const page=await app.firstWindow();
      await verify(page,{electron:true});
      await verifyPlaylistEditing(page);
    }
    finally{await app.close();}
    const restarted=await launch();
    try{
      const page=await restarted.firstWindow();
      await mockOnline(page,silentWav());
      await verifySavedOrder(page);
      console.log('PASS saved order and remaining memberships survive Electron quit/relaunch and play in order');
      await verifyStorageFailures(page);
    }finally{await restarted.close();}
    return;
  }
  const app=createAppServer({port,providers:new Map()});
  await app.listen();
  try{
    const channel=process.env.SONIC_TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined);
    const browser=await chromium.launch({channel,headless:true});
    try{
      const page=await browser.newPage({viewport:{width:1440,height:900}});
      await verify(page);
      await verifyPlaylistEditing(page);
      await page.reload();
      await verifySavedOrder(page);
      console.log('PASS saved order and remaining memberships survive browser reload and play in order');
      await verifyStorageFailures(page);
    }
    finally{await browser.close();}
  }finally{await new Promise(resolve=>app.server.close(resolve));}
}

run().catch(error=>{console.error(error);process.exitCode=1;});
