'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, _electron } = require('playwright');
const { createAppServer } = require('../companion/server.cjs');

const root = path.resolve(__dirname,'..');
const port = Number(process.env.SONIC_LIBRARY_SMOKE_PORT || 18880);
const origin = `http://127.0.0.1:${port}`;
const sample = {id:'demo-auld-lang-syne',name:'友谊地久天长',artist:'Bautsch',path:'/assets/auld-lang-syne.ogg'};
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
const inlineQuery='Inline Catalog Only';
const inlinePlaylist='Inline Versions';
const inlineVersions=[
  {...qishui[1],album:'Cover Version'},
  remote('8488',qishui[1].name,{album:'Live at the Test Hall'})
];
const recoveryQuery='Playback Recovery Fixture';
const recoveryTracks=[
  remote('8491','Recovery First'),remote('8492','Recovery Second'),remote('8493','Recovery Third'),
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
  const failedTickets=new Set(),failedMedia=new Set(),pendingTickets=new Map();
  const slowQuery=Promise.withResolvers(),slowDone=Promise.withResolvers();
  let inlineAttempts=0;
  await page.route('**/*', async route => {
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin)return ['http:','https:'].includes(url.protocol)?route.abort():route.continue();
    if(url.pathname==='/health')return route.fulfill({json:{ok:true,companion:true}});
    if(url.pathname==='/api/qishui/login-status')return route.fulfill({json:{authenticated:true,user:{nickname:'Fixture'}}});
    const search=/^\/api\/(qishui|qq)\/search$/.exec(url.pathname);
    if(search) {
      const {query}=request.postDataJSON(),provider=search[1];
      searches.push([provider,query]);
      if(provider==='qishui'&&query===inlineQuery){
        if(inlineAttempts++===0)return route.fulfill({status:504,json:{error:'Fixture search timed out'}});
        return route.fulfill({json:{items:inlineVersions}});
      }
      if(provider==='qishui'&&query===recoveryQuery)return route.fulfill({json:{items:recoveryTracks}});
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
      const id=ticket[1];
      tickets.push(id);
      const pending=pendingTickets.get(id);
      if(pending)await pending.promise;
      if(failedTickets.has(id))return route.fulfill({status:422,json:{code:'not-playable',error:'Fixture unavailable'}});
      try{return await route.fulfill({json:{streamPath:`/media/library-search/${id}`,preview:previewIds.has(id)}});}
      catch(error){if(request.failure()?.errorText!=='net::ERR_ABORTED')throw error;}
    }
    const audio=/^\/media\/library-search\/(\d+)$/.exec(url.pathname);
    if(audio){
      media.push(audio[1]);
      if(failedMedia.has(audio[1]))return route.fulfill({contentType:'audio/wav',body:'Invalid audio contents'});
      return provideWav(route,wav);
    }
    if(/^\/api\/qishui\/songs\/\d+\/lyrics$/.test(url.pathname))return route.fulfill({json:{lrc:''}});
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,json:{error:'Fixture endpoint not configured'}});
    return route.continue();
  });
  return {searches,tickets,media,matchRequests,failedTickets,failedMedia,releaseSlow:()=>{slowQuery.resolve();return slowDone.promise;},
    delayTicket(id){
      const pending=Promise.withResolvers();
      pendingTickets.set(id,pending);
      return ()=>{pendingTickets.delete(id);pending.resolve();};
    }};
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

  await room.getByRole('button',{name:'音乐库',exact:true}).click();
  await room.getByRole('button',{name:'搜在线',exact:true}).click();
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
  const sharedSearch=room.getByRole('searchbox',{name:'搜索音乐',exact:true});
  const oldPlayback=await state();
  const ticketCount=network.tickets.length;
  await sharedSearch.fill(inlineQuery);
  assert.match(await room.locator('[data-sl-empty-text]').innerText(),/本机没有匹配/);
  await room.locator('[data-sl-search-source="qishui"]').click();
  await room.locator('[data-sl-qishui-status]').filter({hasText:'超时'}).waitFor();
  await room.locator('[data-sl-qishui-retry]').click();
  const previewResult=room.locator('[data-sl-qishui-track="'+qishui[1].mediaId+'"]');
  await previewResult.waitFor();
  assert.match(await previewResult.textContent(),/汽水音乐.*翻唱版.*仅试听/);
  const live=room.locator('[data-sl-qishui-track="'+inlineVersions[1].mediaId+'"]');
  assert.equal(await live.locator('.sl-qishui-title').textContent(),qishui[1].name);
  assert.match(await live.textContent(),/汽水音乐.*现场版.*可播状态待确认/);
  assert.deepEqual(network.searches.slice(-2),[['qishui',inlineQuery],['qishui',inlineQuery]]);
  assert.equal(await sharedSearch.inputValue(),inlineQuery);
  assert.equal(await page.locator('dialog[open]').count(),0);
  const previewRow=previewResult.locator('..'),liveRow=live.locator('..');
  const favorite=previewRow.locator('[data-sl-qishui-action="favorite"]');
  await favorite.click();
  await previewRow.locator('[data-sl-qishui-action="favorite"][aria-pressed="true"]:not([aria-busy])').waitFor();
  await liveRow.locator('[data-sl-qishui-action="membership"]').click();
  const create=room.getByRole('dialog',{name:'新建歌单',exact:true});
  await create.getByRole('textbox',{name:'歌单名称'}).fill(inlinePlaylist);
  await create.getByRole('button',{name:'保存歌单'}).click();
  const memberId='online:qishui:'+inlineVersions[1].mediaId;
  await page.waitForFunction(({name,id})=>SonicPlayback.library().playlists.find(list=>list.name===name)?.trackIds.includes(id),{name:inlinePlaylist,id:memberId});
  const add=liveRow.locator('[data-sl-qishui-action="membership"]:not([aria-busy])');
  await add.click();
  const picker=room.getByRole('dialog',{name:'加入歌单',exact:true});
  await picker.getByRole('combobox',{name:'选择歌单'}).selectOption({label:inlinePlaylist});
  await picker.getByRole('button',{name:'加入',exact:true}).click();
  await add.waitFor();
  const collection=await page.evaluate(()=>SonicPlayback.library());
  assert.deepEqual(collection.playlists.find(list=>list.name===inlinePlaylist).trackIds,[memberId]);
  assert.equal(collection.tracks.find(track=>track.id==='online:qishui:'+qishui[1].mediaId).favorite,true);
  const beforePick=await state();
  assert.equal(beforePick.track.id,oldPlayback.track.id);
  assert.equal(beforePick.playing,true);
  assert.equal(beforePick.queueRevision,oldPlayback.queueRevision);
  assert.deepEqual(beforePick.queue.map(({id,entryId})=>({id,entryId})),oldPlayback.queue.map(({id,entryId})=>({id,entryId})));
  assert.equal(network.tickets.length,ticketCount);
  await previewResult.click();
  await waitForTrack(qishui[1].name);
  assert.ok(network.media.includes(qishui[1].mediaId));
  await page.evaluate(names=>{
    const library=SonicPlayback.library();
    const ids=names.map(name=>library.tracks.find(track=>track.name===name).id);
    return SonicPlayback.playFromLibrary(ids[0],'local',true,ids);
  },[alpha,delta,echo]);
  const protectedPlayback=await state();
  assert.equal(protectedPlayback.track.name,alpha);
  await sharedSearch.fill(recoveryQuery);
  await sharedSearch.press('Enter');
  const [firstRecovery,secondRecovery,thirdRecovery]=recoveryTracks;
  const result=track=>room.locator('[data-sl-qishui-track="'+track.mediaId+'"]');
  const playbackRetry=room.locator('[data-sl-qishui-retry-track]');
  network.failedTickets.add(firstRecovery.mediaId);
  await result(firstRecovery).click();
  await playbackRetry.waitFor();
  assert.match(await result(firstRecovery).innerText(),/暂不可播/);
  const afterTicketFailure=await state();
  assert.equal(afterTicketFailure.track.id,protectedPlayback.track.id);
  assert.equal(afterTicketFailure.playing,true);
  assert.equal(afterTicketFailure.queueRevision,protectedPlayback.queueRevision);
  assert.deepEqual(afterTicketFailure.queue.map(item=>item.entryId),protectedPlayback.queue.map(item=>item.entryId));
  network.failedTickets.clear();
  await playbackRetry.click();
  await waitForTrack(firstRecovery.name);
  assert.match(await result(firstRecovery).innerText(),/可播全曲/);

  network.failedMedia.add(secondRecovery.mediaId);
  await result(secondRecovery).click();
  await playbackRetry.waitFor();
  assert.equal((await state()).track.name,firstRecovery.name);
  assert.equal((await state()).playing,true);
  await room.locator('[data-sl-qishui-skip-track]').click();
  await waitForTrack(thirdRecovery.name);

  network.failedMedia.clear();
  const release=network.delayTicket(firstRecovery.mediaId);
  try{
    await Promise.all([page.waitForRequest(request=>request.url().endsWith('/tracks/'+firstRecovery.mediaId+'/audio')),result(firstRecovery).click()]);
    const cancelled=page.waitForEvent('requestfailed',request=>request.url().endsWith('/tracks/'+firstRecovery.mediaId+'/audio'));
    await result(secondRecovery).click();
    await cancelled;
    await waitForTrack(secondRecovery.name);
  }finally{release();}
  assert.equal((await state()).track.name,secondRecovery.name);
  assert.deepEqual(errors,[]);
  console.log('PASS legacy search still verifies public versions; inline Qishui results keep the active song until an explicit preview pick');
  console.log('PASS failed online tickets and corrupt media keep current playback, retry and skip work, and a later selection wins');
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
  await command('select-filtered').click();
  assert.match(await room.locator('[data-sl-selection-count]').textContent(),/已选 43 首.*3 首未在当前显示/);
  await command('select-clear').click();
  const selectSong=name=>room.getByRole('checkbox',{name:'选择 '+name,exact:true});
  await selectSong(addedNames[0]).press('Space');
  await selectSong(addedNames[1]).check();
  await command('more').click();
  await selectSong(addedNames[2]).check();
  await selectSong(addedNames[3]).check();
  assert.ok(await selectSong(addedNames[0]).isChecked());
  const waitForSave=text=>page.waitForFunction(expected=>document.querySelector('[data-sl-save-status]')?.textContent===expected,text);
  await page.evaluate(async ({name,titles})=>{
    const library=SonicPlayback.library();
    const playlist=library.playlists.find(item=>item.name===name);
    const ids=titles.map(title=>library.tracks.find(track=>track.name===title).id);
    await SonicPlayback.editPlaylistMembership(playlist.id,ids,true);
  },{name:savedList,titles:addedNames.slice(0,2)});
  async function addTo(name,status,preview) {
    await command('batch-add').click();
    const dialog=room.getByRole('dialog',{name:'加入歌单',exact:true});
    await dialog.getByRole('combobox',{name:'选择歌单'}).selectOption({label:name});
    assert.equal(await dialog.locator('[data-sl-batch-preview]').textContent(),preview);
    await dialog.getByRole('button',{name:'加入',exact:true}).click();
    await waitForSave(status);
  }
  await addTo(savedList,'已加入 2 首歌曲。另有 2 首已在歌单中。','待加入 2 首 · 已在歌单 2 首');
  await addTo(savedList,'所选歌曲均已在歌单中。','待加入 0 首 · 已在歌单 4 首');
  await addTo(otherList,'已加入 4 首歌曲。','待加入 4 首 · 已在歌单 0 首');

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

async function verifyDockSearchReturn(page) {
  const room=page.locator('#listeningRoom');
  const dock=room.locator(':scope > .lr-player-wrap');
  const searchButton=room.getByRole('button',{name:'搜索音乐',exact:true});
  const search=room.getByRole('searchbox',{name:'搜索音乐',exact:true});
  await searchButton.click();
  await room.locator('[data-sl-search-source="local"]').click();
  await search.fill('Playlist Fixture');
  await room.getByRole('button',{name:'播放 '+editNames[14],exact:true}).click();
  await page.waitForFunction(name=>SonicPlayback.snapshot().track?.name===name&&SonicPlayback.snapshot().playing,editNames[14]);
  const scroll=await page.evaluate(()=>{window.scrollTo({top:780,behavior:'instant'});return window.scrollY;});
  assert.ok(scroll>0);
  const queueButton=dock.getByRole('button',{name:'打开当前播放队列',exact:true});
  const bounds=await queueButton.boundingBox();
  await dock.getByRole('button',{name:'打开正在播放',exact:true}).click();
  assert.equal(await room.getAttribute('data-mode'),'listen');
  assert.deepEqual(await queueButton.boundingBox(),bounds);
  await searchButton.click();
  assert.equal(await search.inputValue(),'Playlist Fixture');
  assert.equal(await page.evaluate(()=>window.scrollY),scroll);
  assert.deepEqual(await queueButton.boundingBox(),bounds);
  await queueButton.click();
  const queue=room.locator('[data-queue-dialog]');
  await queue.waitFor();
  assert.equal(await queue.locator('[data-queue-current-title]').textContent(),editNames[14]);
  assert.equal(await queue.locator('[data-queue-next-title]').textContent(),editNames[15]);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>window.scrollY),scroll);
  assert.equal(await page.evaluate(()=>SonicPlayback.snapshot().playing),true);
  console.log('PASS fixed dock keeps search keyword, scrolled results and matching current/next queue while audio continues');
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
  await openPlaylist(await openLibrary(page),savedList);
  assert.deepEqual(await displayedNames(room),remainingNames);
  console.log('PASS failed write aborts metadata and media together; unread library remains intact and can reload safely');
}

async function verifySampleLyrics(page, room) {
  const {lyrics, duration}=await page.evaluate(()=>SonicPlayback.snapshot());
  assert.ok(lyrics.length>=3,'The packaged sample offers several timed lyric lines');
  assert.ok(lyrics.every(line=>line.points.length>=4),'Each sample line has explicit word cues');
  const first=lyrics.findIndex((line,index)=>{
    const next=lyrics[index+1];
    return line.time>=1.3&&next&&next.time<duration/2&&line.text&&next.text&&line.text!==next.text&&next.time-line.time>=1.4;
  });
  assert.ok(first>=0,'An early phrase gives time to observe a live line change');
  const preview=room.locator('[data-lyric-preview]');
  await room.locator(':scope > .lr-player-wrap [data-action="now-playing"]').click();
  await preview.waitFor();
  await room.locator('[data-now-lyrics]').click();
  const full=room.locator('[data-full-lyrics]');
  await full.waitFor();
  const line=index=>full.locator(`[data-full-line="${index}"]`);
  assert.deepEqual(await full.locator('.lr-full-text').allTextContents(),lyrics.map(item=>item.text));
  assert.ok(lyrics.every(item=>item.translation));
  assert.deepEqual(await full.locator('.lr-full-translation').allTextContents(),lyrics.map(item=>item.translation));

  await line(first).click();
  const seeked=await page.waitForFunction(({index,time})=>{
    const state=SonicPlayback.snapshot();
    const row=document.querySelector(`[data-full-line="${index}"]`);
    return state.playing&&Math.abs(state.position-time)<.8&&row?.getAttribute('aria-current')==='true'&&state.position;
  },{index:first,time:lyrics[first].time});
  assert.ok(await line(first).locator('.lr-timed-group').count()>=4,'The active sample line renders word highlights');
  const timed=await page.waitForFunction(({index,time})=>{
    const state=SonicPlayback.snapshot();
    const row=document.querySelector(`[data-full-line="${index}"]`);
    return state.playing&&state.position>=time-.1&&row?.getAttribute('aria-current')==='true'&&state.position;
  },{index:first+1,time:lyrics[first+1].time},{timeout:Math.ceil((lyrics[first+1].time-lyrics[first].time+3)*1000)});
  assert.ok(await timed.jsonValue()>await seeked.jsonValue());

  const slider=room.locator(':scope > .lr-player-wrap [data-seek]');
  const bounds=await slider.boundingBox();
  assert.ok(bounds&&bounds.width>60,'The dock progress slider is available on the lyric page');
  const progressX=time=>bounds.x+bounds.width*time/duration;
  const y=bounds.y+bounds.height/2;
  const target=lyrics.findIndex((item,index)=>item.time>duration/2&&lyrics[index+1]);
  assert.ok(target>first+1);
  await page.mouse.move(progressX(await timed.jsonValue()),y);
  await page.mouse.down();
  await page.mouse.move(progressX((lyrics[target].time+lyrics[target+1].time)/2),y,{steps:4});
  assert.equal(await room.locator('[data-seek-line]').getAttribute('data-timing'),'word');
  await page.mouse.up();
  await page.waitForFunction(({index,start,end})=>{
    const {position,playing}=SonicPlayback.snapshot();
    return playing&&position>=start&&position<end&&document.querySelector(`[data-full-line="${index}"]`)?.getAttribute('aria-current')==='true';
  },{index:target,start:lyrics[target].time,end:lyrics[target+1].time});

  await room.locator('[data-action="collapse-lyrics"]').click();
  await preview.waitFor();
  await page.waitForFunction(()=>{
    const {lyrics,lyricPosition,lyricDuration,playing}=SonicPlayback.snapshot();
    const {line}=SonicListeningCore.lyricAt(lyrics,lyricPosition,lyricDuration);
    return playing&&line?.text&&document.querySelector('[data-preview-line="0"]').textContent===line.text;
  });
}

async function verifyFirstRun(page,{electron=false}={}) {
  page.setDefaultTimeout(9000);
  const audioResponses=[];
  page.on('response',response=>{
    const url=new URL(response.url());
    if(url.origin===origin&&url.pathname===sample.path)audioResponses.push(response);
  });
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return /^https?:$/.test(url.protocol)&&url.origin!==origin?route.abort():route.continue();
  });
  await page.route('**/health',route=>route.abort());
  if(electron){
    await page.waitForURL(url=>url.origin===origin);
    await page.reload();
  }else await page.goto(origin);
  const room=page.locator('#listeningRoom');
  const homeCard=room.locator('.lr-home-card');
  const demo=homeCard.getByRole('button',{name:'试听示例',exact:true});
  const importMusic=homeCard.getByRole('button',{name:'导入音乐',exact:true});
  const homeLyrics=homeCard.locator('[data-demo-lyrics]');
  const home=room.getByRole('button',{name:'声波宇宙首页',exact:true});
  const searchButton=room.getByRole('button',{name:'搜索音乐',exact:true});
  const search=room.getByRole('searchbox',{name:'搜索音乐',exact:true});
  await demo.waitFor();
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  await homeLyrics.waitFor();
  assert.equal(await homeCard.locator('[data-home-title]').textContent(),sample.name);
  assert.equal(await homeCard.locator('[data-home-artist]').textContent(),sample.artist);
  const sampleLicense=homeCard.locator('[data-sample-license]');
  await sampleLicense.waitFor();
  assert.equal(await sampleLicense.getAttribute('href'),'https://creativecommons.org/publicdomain/zero/1.0/');
  for(const control of [demo,importMusic,homeLyrics]){
    const bounds=await control.boundingBox();
    assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,
      `${await control.innerText()} must be visible without scrolling`);
  }
  await homeLyrics.click();
  await room.locator('[data-effect-stage][data-fx="tide"]').waitFor();
  await room.locator('[data-stage-full-lyrics]').click();
  await room.locator('[data-full-lyrics]').waitFor();
  assert.ok(await room.locator('[data-full-line]').count()>=3);
  assert.equal(await page.evaluate(()=>SonicPlayback.snapshot().playing),false);
  await room.locator('[data-action="collapse-lyrics"]').click();
  await home.click();
  await page.evaluate(()=>SonicPlayback.setVolume(0));
  await demo.click();
  await page.waitForFunction(id=>{
    const playback=SonicPlayback.snapshot();
    return playback.track?.id===id&&playback.track.kind==='demo'&&playback.playing&&playback.position>.05&&
      document.getElementById('app').dataset.demoAudio==='asset'&&playback.lyrics.length>=3;
  },sample.id);
  assert.ok(audioResponses.some(response=>response.ok()&&response.headers()['content-type']==='audio/ogg'),
    'Decoded sample came from its local shipped Ogg recording');
  let navigations=0;
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  const state=()=>page.evaluate(()=>{
    const {track,playing,position,queueEntryId,queueRevision}=SonicPlayback.snapshot();
    const audio=document.getElementById('audio');
    return {id:track.id,name:track.name,playing,position,queueEntryId,queueRevision,src:audio.currentSrc};
  });
  await verifySampleLyrics(page,room);
  const before=await state();
  await home.click();
  await homeLyrics.click();
  await room.locator('[data-effect-stage][data-fx="tide"]').waitFor();
  await room.locator('[data-stage-full-lyrics]').click();
  await room.locator('[data-full-lyrics]').waitFor();
  await home.click();
  await searchButton.click();
  assert.equal(await search.evaluate(node=>node===document.activeElement),true);
  assert.equal(await page.locator('dialog[open]').count(),0);
  await search.fill(before.name);
  assert.deepEqual(await displayedNames(room),[before.name]);
  await search.fill('First Run Fixture');
  assert.match(await room.locator('[data-sl-empty-text]').innerText(),/本机没有匹配/);

  await room.locator('[data-sl-search-source="qishui"]').click();
  await room.locator('[data-sl-qishui-results]').waitFor();
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await search.inputValue(),'First Run Fixture');
  await room.locator('[data-sl-search-source="local"]').click();
  await room.locator('[data-sl-local-results]').waitFor();
  assert.equal(await search.inputValue(),'First Run Fixture');
  await home.click();
  await page.waitForFunction(position=>SonicPlayback.position()>position,before.position);
  const after=await state();
  assert.equal(navigations,0);
  assert.deepEqual({...after,position:before.position},before);
  assert.equal(await room.getAttribute('data-mode'),'work');

  const chooserPromise=page.waitForEvent('filechooser');
  await importMusic.click();
  await (await chooserPromise).setFiles({name:'First Run Fixture.wav',mimeType:'audio/wav',buffer:silentWav()});
  await page.waitForFunction(()=>{
    const playback=SonicPlayback.snapshot();
    return playback.track?.name==='First Run Fixture'&&playback.playing&&playback.position>.05;
  });
  await searchButton.click();
  assert.equal(await search.inputValue(),'First Run Fixture');
  assert.deepEqual(await displayedNames(room),['First Run Fixture']);
  const imported=await state();
  await page.evaluate(()=>{
    document.getElementById('audio').addEventListener('pause',()=>{document.body.dataset.auditPaused='true';},{once:true});
  });
  await home.click();
  await page.waitForFunction(position=>SonicPlayback.position()>position+.05,imported.position);
  assert.equal(navigations,0);
  assert.equal(await page.evaluate(()=>document.body.dataset.auditPaused==='true'),false);
  assert.deepEqual({...await state(),position:imported.position},imported);
  console.log(`PASS ${viewport.width}×${viewport.height} bundled first-run audio, compact and full synced lyrics, seek, file picker and search/home without audio interruption`);
}

async function run() {
  const packaged=process.argv.includes('--packaged');
  const firstRunOnly=process.argv.includes('--first-run-only');
  if(packaged||process.argv.includes('--electron')){
    const qa=path.join(root,'work','desktop-qa');
    await fs.mkdir(qa,{recursive:true});
    const executablePath=packaged?path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE||path.join(root,'release','win-unpacked','声波宇宙.exe')):require('electron');
    const launch=profile=>_electron.launch({executablePath,args:packaged?[]:[root],cwd:root,timeout:30000,
      env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)}});
    const freshProfile=await fs.mkdtemp(path.join(qa,'first-run-profile-'));
    const firstRun=await launch(freshProfile);
    try{await verifyFirstRun(await firstRun.firstWindow(),{electron:true});}
    finally{await firstRun.close();}
    if(firstRunOnly)return;
    const profile=await fs.mkdtemp(path.join(qa,'library-search-profile-'));
    const app=await launch(profile);
    try{
      const page=await app.firstWindow();
      await verify(page,{electron:true});
      await verifyPlaylistEditing(page);
      await verifyDockSearchReturn(page);
    }
    finally{await app.close();}
    const restarted=await launch(profile);
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
      for(const options of [{viewport:{width:1440,height:900}},{viewport:{width:320,height:568},isMobile:true,hasTouch:true}]){
        const firstRun=await browser.newPage(options);
        try{await verifyFirstRun(firstRun);}
        finally{await firstRun.close();}
      }
      if(firstRunOnly)return;
      const page=await browser.newPage({viewport:{width:1440,height:900}});
      await verify(page);
      await verifyPlaylistEditing(page);
      await verifyDockSearchReturn(page);
      await page.reload();
      await verifySavedOrder(page);
      console.log('PASS saved order and remaining memberships survive browser reload and play in order');
      await verifyStorageFailures(page);
    }
    finally{await browser.close();}
  }finally{await new Promise(resolve=>app.server.close(resolve));}
}

run().catch(error=>{console.error(error);process.exitCode=1;});
