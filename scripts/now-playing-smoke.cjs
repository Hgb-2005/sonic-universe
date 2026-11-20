'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium, _electron } = require('playwright');
const { createAppServer } = require('../companion/server.cjs');

const root = path.resolve(__dirname, '..');
const port = 18879;
const origin = `http://127.0.0.1:${port}`;
const packaged = process.argv.includes('--packaged');
const desktop = packaged || process.argv.includes('--electron');
const originalLyrics = [
  '[00:00.00]引子', '[00:02.00]<00:02.00>逐<00:02.80>字<00:03.50>推进',
  '[00:05.00]夜色', '[00:07.00]起风', '[00:09.00]普通整行',
  '[00:11.00]回声', '[00:13.00]远山', '[00:15.00]尾声',
].join('\n');
const edited = {
  name:'修改后的歌名',
  artist:'修改后的歌手',
  album:'修改后的专辑',
  lyricsRaw:'[00:00.00]在编辑器保存的歌词\n[00:03.00]源文件重扫后依旧存在',
};
const enrichment = {
  mediaId:'81201',
  album:'汽水同版本专辑',
  krc:'[0,3500]<0,800,0>逐字<900,1100,0>歌词',
};
const customMod = {
  format:'sonic-lyric-style', version:1, id:'acceptance-fixture', name:'验收样式',
  layout:'stage', alignment:'left', accent:'#4bd1ab', fontScale:1.1, motion:'still',
};
const longTags = {
  name:'Existing title ' + 't'.repeat(165) + ' ending',
  artist:'Existing artist ' + 'a'.repeat(170) + ' ending',
  album:'Existing album ' + 'b'.repeat(167) + ' ending',
};
const longTagsFile = 'legacy-tags.wav';

function audioFixture() {
  const sampleRate = 8000;
  const bodyLength = sampleRate * 25 * 2;
  const wav = Buffer.alloc(44 + bodyLength);
  wav.write('RIFF',0);
  wav.writeUInt32LE(wav.length - 8,4);
  wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);
  wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(sampleRate,24);
  wav.writeUInt32LE(sampleRate * 2,28);
  wav.writeUInt16LE(2,32);
  wav.writeUInt16LE(16,34);
  wav.write('data',36);
  wav.writeUInt32LE(bodyLength,40);
  return wav;
}

function longTagAudioFixture() {
  const wav = audioFixture();
  const fields = [['INAM',longTags.name],['IART',longTags.artist],['IPRD',longTags.album]];
  const chunks = fields.map(([tag,value]) => {
    const data = Buffer.from(value + '\0');
    const chunk = Buffer.alloc(8 + data.length + data.length % 2);
    chunk.write(tag);
    chunk.writeUInt32LE(data.length,4);
    data.copy(chunk,8);
    return chunk;
  });
  const info = Buffer.concat([Buffer.from('INFO'),...chunks]);
  const header = Buffer.alloc(8);
  header.write('LIST');
  header.writeUInt32LE(info.length,4);
  const tagged = Buffer.concat([wav.subarray(0,36),header,info,wav.subarray(36)]);
  tagged.writeUInt32LE(tagged.length - 8,4);
  return tagged;
}

function savedDetails(page, id) {
  return page.evaluate(async id => {
    const state = SonicPlayback.library();
    const track = await SonicPlayback.localTrackDetails(id);
    return {
      ids:state.tracks.filter(track => track.kind === 'file').map(track => track.id),
      name:track.name, artist:track.artist, album:track.album, lyricsRaw:track.lyricsRaw, cover:track.cover,
    };
  }, id);
}

async function verifyNowPlaying(page, folder, app) {
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const matchRequests = [];
  let lyricRequests = 0;
  await page.route('**/api/qishui/login-status', route =>
    route.fulfill({ json:{ authenticated:true, user:{ nickname:'本机测试账号' } } }));
  await page.route('**/api/discovery/charts/match', route => {
    const request = route.request();
    assert.equal(request.method(),'POST');
    matchRequests.push(request.postDataJSON());
    return route.fulfill({ json:{ item:{
      provider:'qishui',mediaId:enrichment.mediaId,name:edited.name,artist:edited.artist,album:enrichment.album,duration:25,
    } } });
  });
  await page.route(`**/api/qishui/songs/${enrichment.mediaId}/lyrics`, route => {
    lyricRequests++;
    return route.fulfill({ json:{ krc:enrichment.krc, lrc:'[00:00.00]普通时间轴' } });
  });
  if (desktop) await page.waitForURL(url => url.origin === origin);
  else await page.goto(origin);
  await page.waitForFunction(() => window.SonicPlayback?.snapshot().ready);
  await page.evaluate(() => SonicPlayback.setVolume(0));

  const room = page.locator('#listeningRoom');
  const setMode = mode => room.locator(`[data-room-mode="${mode}"]`).click();
  const play = room.locator('[data-action="play"]');
  const folderInput = page.locator('#folderInput');
  const preview = room.locator('[data-lyric-preview]');
  const full = room.locator('[data-full-lyrics]');
  const line = number => full.locator(`[data-full-line="${number}"]`);
  const openLyrics = () => preview.locator('.lr-now-cover').click();
  const closeLyrics = () => room.locator('[data-action="collapse-lyrics"]').click();
  const details = room.getByRole('dialog',{ name:'歌曲资料', exact:true });
  const openTrackDetails = async id => {
    await room.locator(`[data-sl-id="${id}"] [data-sl-command="queue"]`).click();
    await room.locator('[data-sl-command="track-details"]').click();
    await details.waitFor();
  };
  const saveTrackDetails = async () => {
    await details.getByRole('button',{ name:'保存资料', exact:true }).click();
    await details.waitFor({ state:'hidden' });
  };
  const mods = room.getByRole('dialog',{ name:'歌词样式模组', exact:true });
  const openMods = () => room.locator('[data-action="lyric-mods"]').click();
  const importMod = raw => mods.locator('[data-mod-file]').setInputFiles({
    name:'acceptance.json', mimeType:'application/json', buffer:Buffer.from(raw),
  });
  const verifyCustomMod = async () => {
    assert.equal(await room.getAttribute('data-lyric-mod'),customMod.id);
    assert.equal(await room.getAttribute('data-lyric-style'),customMod.layout);
    assert.equal(await room.getAttribute('data-mod-align'),customMod.alignment);
    assert.equal(await room.getAttribute('data-mod-motion'),customMod.motion);
    const properties = await room.evaluate(node => [
      node.style.getPropertyValue('--lr-mod-accent'),
      Number(node.style.getPropertyValue('--lr-mod-scale')),
    ]);
    assert.deepEqual(properties,[customMod.accent,customMod.fontScale]);
  };

  await folderInput.setInputFiles(folder);
  const id = await page.waitForFunction(() => {
    const library = SonicPlayback.library();
    const state = SonicPlayback.snapshot();
    return !library.importing && state.track?.kind === 'file' && state.lyrics.length === 8 && state.track.id;
  }).then(handle => handle.jsonValue());
  if (await page.evaluate(() => SonicPlayback.snapshot().playing)) await play.click();
  await setMode('listen');
  await page.evaluate(() => SonicPlayback.seek(2.4));
  await page.waitForFunction(() => document.querySelector('[data-preview-line="0"]')?.textContent === '逐字推进');
  assert.deepEqual(await preview.locator('[data-preview-line]').allTextContents(), ['引子','逐字推进','夜色']);
  assert.equal(await preview.locator('[data-preview-line="0"] .lr-timed-group').count(),3);
  assert.equal(await full.isVisible(),false);
  assert.equal(await room.getAttribute('data-lyric-expanded'),'false');

  await openLyrics();
  await full.waitFor();
  assert.equal(await preview.isVisible(),false);
  assert.deepEqual(await full.locator('.lr-full-text').allTextContents(),['引子','逐字推进','夜色','起风','普通整行','回声','远山','尾声']);
  assert.equal(await line(1).getAttribute('aria-current'),'true');
  assert.deepEqual(await line(1).locator('.lr-timed-group').allTextContents(),['逐','字','推进']);
  const lyricFill = await line(1).locator('.lr-timed-group').first().evaluate(node => parseFloat(node.style.getPropertyValue('--lr-word-fill')));
  assert.ok(lyricFill > 0 && lyricFill < 100);
  await line(4).click();
  await line(4).and(full.locator('[aria-current="true"]')).waitFor();
  assert.equal(await line(4).locator('.lr-timed-group').count(),0);
  assert.ok(Math.abs(await page.evaluate(() => SonicPlayback.snapshot().position) - 9) < .2);
  await room.locator('button[data-lyric-style="fly"]').click();
  assert.equal(await room.getAttribute('data-lyric-style'),'fly');
  const flightRows = room.locator('[data-lyric-timeline] .lr-lyric-row');
  assert.deepEqual(await flightRows.allTextContents(),['普通整行']);
  const centerOffset = await flightRows.evaluate(row => {
    const lyric = row.getBoundingClientRect(), stage = row.parentElement.getBoundingClientRect();
    return Math.abs((lyric.top + lyric.bottom - stage.top - stage.bottom) / 2);
  });
  assert.ok(centerOffset <= 1,'The lyric should sit in the center of the stage');
  await page.evaluate(() => SonicPlayback.seek(5.2));
  await flightRows.getByText('夜色',{ exact:true }).waitFor();
  assert.deepEqual(await flightRows.allTextContents(),['夜色']);
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.evaluate(() => SonicPlayback.seek(1.6));
  await play.click();
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('[data-lyric-timeline] .lr-lyric-row');
    return rows.length === 1 && rows[0].textContent === '逐字推进' &&
      rows[0].querySelector('.lr-flight-token[data-flight-state="flying"]');
  });
  await page.evaluate(() => {
    SonicPlayback.toggle();
    SonicPlayback.seek(9);
  });
  await flightRows.getByText('普通整行',{ exact:true }).waitFor();
  assert.deepEqual(await flightRows.allTextContents(),['普通整行']);
  console.log('PASS fly shows one centered lyric during word animation and after seeking');
  await closeLyrics();
  await preview.waitFor();
  assert.deepEqual(await preview.locator('[data-preview-line]').allTextContents(),['起风','普通整行','回声']);
  console.log('PASS compact preview, full lyrics, explicit word timing, line-only LRC, fly and collapse');

  await openLyrics();
  const effectButton=room.locator('[data-action="lyric-effects"]');
  const effectPicker=room.getByRole('dialog',{name:'歌词动效'});
  const effectChoices=effectPicker.locator('[data-effect-choice]');
  const stage=room.locator('[data-effect-stage]');
  await effectButton.click();
  assert.equal(await effectChoices.count(),18);
  const ids=await effectChoices.evaluateAll(nodes=>nodes.map(node=>node.dataset.effectChoice));
  assert.equal(new Set(ids).size,18);
  for(const [index,id] of ids.entries()){
    if(index>0)await effectButton.click();
    await effectChoices.nth(index).click();
    assert.equal(await room.getAttribute('data-lyric-effect'),id);
    assert.equal(await stage.getAttribute('data-fx'),id);
    assert.deepEqual(await flightRows.allTextContents(),['普通整行']);
    assert.equal(await flightRows.getAttribute('data-lyric-timing'),'line');
  }
  await effectButton.click();
  await effectPicker.getByRole('button',{name:'重拍',exact:true}).click();
  await page.evaluate(()=>SonicPlayback.seek(1.6));
  await play.click();
  await page.waitForFunction(()=>{
    const row=document.querySelector('[data-lyric-timeline] [data-current-line]');
    const token=row?.querySelector('.lr-effect-word');
    return row?.textContent==='逐字推进' && row.dataset.lyricTiming==='word' &&
      Number(token?.style.getPropertyValue('--fx-rest'))>0 && getComputedStyle(token).transform!=='none';
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>{
    const token=document.querySelector('[data-current-line] .lr-effect-word');
    return token && getComputedStyle(token).transform==='none';
  });
  await page.evaluate(()=>{
    SonicPlayback.toggle();
    SonicPlayback.seek(9);
  });
  await page.emulateMedia({reducedMotion:'no-preference'});
  await closeLyrics();
  await openLyrics();
  assert.equal(await room.getAttribute('data-lyric-effect'),'impact');
  await room.locator('button[data-lyric-style="list"]').click();
  await closeLyrics();
  console.log('PASS all 18 lyric looks select a single line, timed words animate, and reduced motion stays readable');

  if (desktop) {
    await openLyrics();
    await openMods();
    await mods.getByRole('button',{ name:'试用青瓷', exact:true }).click();
    await mods.getByRole('button',{ name:'青瓷', exact:true }).waitFor();
    assert.equal(await room.getAttribute('data-lyric-mod'),'celadon');
    assert.equal(await room.getAttribute('data-mod-motion'),'soft');
    assert.equal(await room.getAttribute('data-lyric-style'),'fly');
    assert.deepEqual(await room.locator('.lr-mod-shape').evaluateAll(nodes=>nodes.map(node=>node.dataset.shape)),['glow','glow','ring','ring','disc','stripe']);
    await importMod(JSON.stringify({ ...customMod, fontScale:4 }));
    await mods.getByText('样式格式有误。请检查版本、图层类型和参数范围。',{ exact:true }).waitFor();
    assert.equal(await room.getAttribute('data-lyric-mod'),'celadon');

    await importMod(JSON.stringify(customMod));
    await mods.getByRole('button',{ name:customMod.name, exact:true }).waitFor();
    await verifyCustomMod();
    assert.equal(await room.locator('.lr-mod-shape').count(),0);
    await importMod('{"format":');
    await mods.getByText('无法读取 JSON 样式。',{ exact:true }).waitFor();
    await verifyCustomMod();
    await mods.locator('[data-mod-close]').click();
    await closeLyrics();
    console.log('PASS desktop applies the built-in and custom lyric mods and rejects invalid JSON and settings');
    const updatedLines=originalLyrics+'\n[00:17.00]磁盘更新后的歌词';
    await fs.writeFile(path.join(folder,'smoke.lrc'),updatedLines);
    await folderInput.setInputFiles(folder);
    await page.waitForFunction(()=>!SonicPlayback.library().importing&&SonicPlayback.snapshot().lyrics.some(line=>line.text==='磁盘更新后的歌词'));
    assert.equal((await savedDetails(page,id)).lyricsRaw,updatedLines);
    await fs.writeFile(path.join(folder,'smoke.lrc'),originalLyrics);
    await folderInput.setInputFiles(folder);
    await page.waitForFunction(()=>!SonicPlayback.library().importing&&SonicPlayback.snapshot().lyrics.length===8);
    console.log('PASS changed disk lyrics appear on rescan with the original audio track ID');
    await setMode('work');
    await page.evaluate(()=>SonicPlayback.seek(5.2));
    const opened=app.waitForEvent('window',{predicate:other=>other!==page});
    await room.locator('[data-action="desktop-lyrics-window"]').click();
    const caption=await opened;
    await caption.getByText('测试翻译',{exact:true}).waitFor();
    await caption.locator('#layout').click();
    assert.equal(await caption.locator('body').getAttribute('data-layout'),'scroll');
    await caption.getByText('逐字推进',{exact:true}).waitFor();
    await caption.locator('#translationToggle').click();
    assert.equal(await caption.locator('#translation').isVisible(),false);
    await caption.locator('#layout').click();
    assert.equal(await caption.locator('#next').isVisible(),false);
    await caption.getByRole('button',{name:'关闭桌面歌词'}).click();
    console.log('PASS desktop overlay switches layouts and toggles a real timed translation');
  }

  await setMode('library');
  await room.locator('[data-sl-view="local"]').click();
  const row = room.locator(`[data-sl-id="${id}"]`);
  await openTrackDetails(id);
  assert.equal((await details.locator('textarea[name="lyrics"]').inputValue()).trim(),originalLyrics);
  await details.locator('input[name="title"]').fill(edited.name);
  await details.locator('input[name="artist"]').fill(edited.artist);
  await details.locator('textarea[name="lyrics"]').fill('');
  await page.waitForFunction(() => SonicPlayback.snapshot().onlineReady);
  await details.getByRole('button',{ name:'在线补全', exact:true }).click();
  await details.getByText('已填入专辑、歌词，核对后保存。',{ exact:true }).waitFor();
  assert.deepEqual(matchRequests,[{ name:edited.name, artist:edited.artist }]);
  assert.equal(lyricRequests,1);
  assert.equal(await details.locator('input[name="album"]').inputValue(),enrichment.album);
  assert.equal(await details.locator('textarea[name="lyrics"]').inputValue(),enrichment.krc);
  assert.equal(await page.evaluate(async id => (await SonicPlayback.localTrackDetails(id)).lyricsRaw,id),originalLyrics);
  console.log('PASS matching Qishui fixture fills album and timed lyrics in the editor draft');

  await details.locator('input[name="album"]').fill(edited.album);
  await details.locator('textarea[name="lyrics"]').fill(edited.lyricsRaw);
  await details.locator('[data-detail-artwork]').setInputFiles(path.join(root,'outputs','assets','sonic-icon.png'));
  await details.getByText('已选封面，保存后应用。',{ exact:true }).waitFor();
  const artwork = details.locator('[data-detail-cover]');
  await artwork.waitFor();
  const chosenCover = await artwork.getAttribute('src');
  assert.match(chosenCover,/^data:image\/(?:png|webp|jpeg);base64,[a-z0-9+/=]+$/i);
  assert.equal(await page.evaluate(async id => (await SonicPlayback.localTrackDetails(id)).cover,id),null);
  await saveTrackDetails();
  await row.getByText(edited.name,{ exact:true }).waitFor();
  await folderInput.setInputFiles(folder);
  await page.waitForFunction(() => !SonicPlayback.library().importing &&
    document.getElementById('importStatus').textContent.includes('1 首音频未变'));

  const expected = { ids:[id], ...edited, cover:chosenCover };
  assert.deepEqual(await savedDetails(page,id),expected);
  assert.equal(await fs.readFile(path.join(folder,'smoke.lrc'),'utf8'),originalLyrics);
  await page.reload();
  await page.waitForFunction(() => window.SonicPlayback?.library().ready);
  assert.deepEqual(await savedDetails(page,id),expected);
  console.log('PASS local metadata, lyrics and manually chosen cover retain the same track ID after rescan and reload');

  if (desktop) {
    await setMode('listen');
    await preview.waitFor();
    await openLyrics();
    await verifyCustomMod();
    await openMods();
    assert.equal(await mods.getByRole('button',{ name:customMod.name, exact:true }).getAttribute('aria-pressed'),'true');
    await mods.locator('[data-mod-close]').click();
    console.log('PASS custom imported lyric mod remains selected and renders after reload');
  }

  await fs.writeFile(path.join(folder,longTagsFile),longTagAudioFixture());
  await folderInput.setInputFiles(folder);
  const longId = await page.waitForFunction(name => {
    const library = SonicPlayback.library();
    return !library.importing && library.tracks.find(track => track.name === name)?.id;
  },longTags.name).then(handle => handle.jsonValue());
  await setMode('library');
  await room.locator('[data-sl-view="local"]').click();
  await page.route('https://lrclib.net/api/get?*',route=>{
    const query=new URL(route.request().url()).searchParams;
    assert.equal(query.get('track_name'),longTags.name);
    assert.equal(query.get('artist_name'),longTags.artist);
    assert.equal(query.get('album_name'),longTags.album);
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Lrclib-Client'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    return route.fulfill({json:{trackName:longTags.name,artistName:longTags.artist,albumName:longTags.album,duration:25,syncedLyrics:'[00:02.00]验收批量补全'},headers});
  });
  await room.getByRole('button',{name:'批量补全',exact:true}).click();
  const bulk=room.getByRole('dialog',{name:'批量补全封面和歌词'});
  await bulk.getByRole('button',{name:'查找匹配'}).click();
  await bulk.getByText('已查找 1 / 1 首，匹配 1 首。',{exact:true}).waitFor();
  assert.equal((await savedDetails(page,longId)).lyricsRaw,'');
  await bulk.getByRole('button',{name:'保存勾选项'}).click();
  await bulk.waitFor({state:'hidden'});
  assert.equal((await savedDetails(page,longId)).lyricsRaw,'[00:02.00]验收批量补全');
  console.log('PASS batch enrichment previews its exact LRCLIB match and persists only after approval');
  await openTrackDetails(longId);
  assert.equal(await details.locator('input[name="title"]').inputValue(),longTags.name);
  assert.equal(await details.locator('input[name="artist"]').inputValue(),longTags.artist);
  assert.equal(await details.locator('input[name="album"]').inputValue(),longTags.album);
  await details.locator('textarea[name="lyrics"]').fill(edited.lyricsRaw);
  await saveTrackDetails();
  const allIds = [id,longId];
  const expectedLong = { ids:allIds, ...longTags, lyricsRaw:edited.lyricsRaw, cover:null };
  assert.deepEqual(await savedDetails(page,longId),expectedLong);
  console.log('PASS changing only lyrics preserves existing imported metadata longer than 160 characters');
  if(desktop){
    const playlist=await page.evaluate(id=>{
      const list=SonicPlayback.savePlaylist('重扫测试');SonicPlayback.setMembership(id,[list]);return list;
    },id);
    await fs.writeFile(path.join(folder,'smoke.wav'),longTagAudioFixture());
    await fs.writeFile(path.join(folder,'smoke.lrc'),'[00:00.00]盘中修改不得覆盖明确手编版本');
    await fs.unlink(path.join(folder,longTagsFile));
    await folderInput.setInputFiles(folder);
    await page.waitForFunction(()=>!SonicPlayback.library().importing&&document.getElementById('importStatus').textContent.includes('更新 1 首'));
    assert.deepEqual(await savedDetails(page,id),{...expected,ids:allIds});
    const library=await page.evaluate(()=>SonicPlayback.library());
    assert.equal(library.tracks.find(track=>track.id===longId).sourceMissing,true);
    assert.deepEqual(library.playlists.find(item=>item.id===playlist).trackIds,[id]);
    console.log('PASS desktop rescan replaces changed audio, preserves manual data and playlist membership, and labels removed originals');
  }
  assert.deepEqual(errors,[]);
  return [{ id, data:{ ...expected, ids:allIds } },{ id:longId, data:expectedLong }];
}

async function run(folder) {
  if (desktop) {
    const qa = path.join(root,'work','desktop-qa');
    await fs.mkdir(qa,{ recursive:true });
    const profile = await fs.mkdtemp(path.join(qa,'now-playing-profile-'));
    const executablePath = packaged
      ? path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE || path.join(root,'release','win-unpacked','声波宇宙.exe'))
      : require('electron');
    const launch = () => _electron.launch({ executablePath, args:packaged ? [] : [root], cwd:root, timeout:30000,
      env:{ ...process.env, SONIC_DESKTOP_PROFILE:profile, SONIC_DESKTOP_PORT:String(port) } });
    const app = await launch();
    let expected;
    try { expected = await verifyNowPlaying(await app.firstWindow(),folder,app); }
    finally { await app.close(); }
    const reopened = await launch();
    try {
      const page = await reopened.firstWindow();
      await page.waitForFunction(() => window.SonicPlayback?.library().ready);
      for (const { id, data } of expected) assert.deepEqual(await savedDetails(page,id),data);
      console.log('PASS saved lyrics, cover and long metadata survive a full desktop application relaunch');
    } finally { await reopened.close(); }
    return;
  }

  const app = createAppServer({ port, providers:new Map() });
  await app.listen();
  try {
    const channel = process.env.SONIC_TEST_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
    const browser = await chromium.launch({ channel, headless:true });
    try { await verifyNowPlaying(await browser.newPage({ viewport:{ width:1440,height:900 } }),folder); }
    finally { await browser.close(); }
  } finally {
    await new Promise(resolve => app.server.close(resolve));
  }
}

async function main() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'sonic-now-playing-'));
  const wav = path.join(folder,'smoke.wav');
  const lrc = path.join(folder,'smoke.lrc');
  try {
    await fs.writeFile(wav,audioFixture());
    await fs.writeFile(lrc,originalLyrics);
    await fs.writeFile(path.join(folder,'smoke.translation.lrc'),'[00:05.00]测试翻译');
    await run(folder);
  } finally {
    for (const file of [wav,lrc,path.join(folder,'smoke.translation.lrc'),path.join(folder,longTagsFile)]) {
      await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await fs.rmdir(folder);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
