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
const onlineLyricsFile = 'online-lyrics.wav';
const onlineLyricsTags = {name:'Online lyric fixture',artist:'Local performer',album:''};
const verifiedSidecarFile = 'online-lyrics.lrc';
const verifiedSidecar = '[00:02.00]本机时间轴优先';

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

function longTagAudioFixture(tags=longTags) {
  const wav = audioFixture();
  const fields = [['INAM',tags.name],['IART',tags.artist],['IPRD',tags.album]];
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
    const query=request.postDataJSON();
    matchRequests.push(query);
    const track=query.name===onlineLyricsTags.name?onlineLyricsTags:edited;
    return route.fulfill({ json:{ item:{
      provider:'qishui',mediaId:enrichment.mediaId,name:track.name,artist:track.artist,album:enrichment.album,duration:25,
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
  const openLyrics = () => room.locator('.lr-now-cover').click();
  const closeLyrics = () => room.locator('[data-action="collapse-lyrics"]').click();
  const lyricOptions = room.locator('.lr-more-lyrics');
  const openLyricOptions = async () => {
    if(await lyricOptions.getAttribute('open')===null)await lyricOptions.locator(':scope > summary').click();
  };
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
  const openMods = async () => {
    await openLyricOptions();
    await room.locator('[data-action="lyric-mods"]').click();
  };
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
  await page.waitForFunction(()=>!SonicPlayback.library().importing&&SonicPlayback.importReport()?.added);
  await page.evaluate(()=>SonicPlayback.playImportedMusic());
  const id = await page.waitForFunction(() => {
    const state = SonicPlayback.snapshot();
    return state.track?.kind === 'file' && state.lyrics.length === 8 && state.track.id;
  }).then(handle => handle.jsonValue());
  if (await page.evaluate(() => SonicPlayback.snapshot().playing)) await play.click();
  await setMode('listen');
  await page.evaluate(() => SonicPlayback.seek(2.4));
  await page.waitForFunction(() => document.querySelector('[data-preview-line="0"]')?.textContent === '逐字推进');
  assert.deepEqual(await preview.locator('[data-preview-line]').allTextContents(), ['引子','逐字推进','夜色']);
  assert.equal(await preview.locator('[data-preview-line="0"] .lr-timed-group').count(),3);
  assert.equal(await full.isVisible(),false);
  assert.equal(await room.getAttribute('data-lyric-expanded'),'false');

  const seek = room.locator('[data-seek]');
  const seekPreview = room.locator('[data-seek-lyrics]');
  const seekLine = seekPreview.locator('[data-seek-line]');
  const seekTranslation = seekPreview.locator('[data-seek-translation]');
  const bounds = await seek.boundingBox();
  const beforeDrag = await page.evaluate(() => SonicPlayback.position());
  const seekX = position => bounds.x + 5 + (bounds.width - 10) * position / 25;
  await page.mouse.move(seekX(beforeDrag), bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(seekX(3.1), bounds.y + bounds.height / 2);
  await seekPreview.waitFor();
  assert.equal(await seekLine.textContent(),'逐字推进');
  assert.equal(await seekLine.getAttribute('data-timing'),'word');
  const fills = await seekLine.locator('.lr-timed-group').evaluateAll(words =>
    words.map(word => Number.parseFloat(word.style.getPropertyValue('--lr-word-fill'))));
  assert.ok(fills[0]===100 && fills[1]>0 && fills[1]<100 && fills[2]===0,`Seek word fills at 3.1s: ${fills}`);
  await page.mouse.move(seekX(5.2), bounds.y + bounds.height / 2);
  assert.equal(await seekLine.textContent(),'夜色');
  assert.equal(await seekLine.getAttribute('data-timing'),'line');
  assert.equal(await seekLine.locator('.lr-timed-group').count(),0);
  assert.equal(await seekTranslation.textContent(),'测试翻译');
  assert.equal(await seekTranslation.isVisible(),true);
  await page.mouse.move(seekX(8), bounds.y + bounds.height / 2, { steps:4 });
  assert.equal(await seekLine.textContent(),'起风');
  assert.equal(await seekTranslation.isVisible(),false);
  assert.equal(await page.evaluate(() => SonicPlayback.position()),beforeDrag);
  await page.mouse.up();
  await seekPreview.waitFor({state:'hidden'});
  await page.waitForFunction(() => Math.abs(SonicPlayback.position() - 8) < .4);
  await room.locator('[data-preview-row="-1"]').click();
  assert.ok(Math.abs(await page.evaluate(() => SonicPlayback.position()) - 5) < .2);
  await page.evaluate(() => SonicPlayback.seek(2.4));
  console.log('PASS native seek drag previews lyrics before committing audio and preview lines jump on click');

  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  try {
    const touchBounds = await seek.boundingBox();
    const sendTouch = (type,time) => touch.send('Input.dispatchTouchEvent',{
      type,touchPoints:time===undefined?[]:[{
        x:Math.round(touchBounds.x+5+(touchBounds.width-10)*time/25),y:Math.round(touchBounds.y+touchBounds.height/2),
      }],
    });
    await sendTouch('touchStart',2.4);
    await sendTouch('touchMove',10);
    assert.equal(await seekLine.textContent(),'普通整行');
    assert.ok(Math.abs(await page.evaluate(() => SonicPlayback.position())-2.4)<.05);
    await sendTouch('touchCancel');
    await seekPreview.waitFor({state:'hidden'});
    assert.ok(Math.abs(await page.evaluate(() => SonicPlayback.position())-2.4)<.05);
    await sendTouch('touchStart',2.4);
    await sendTouch('touchMove',10);
    await sendTouch('touchEnd');
    await seekPreview.waitFor({state:'hidden'});
    await page.waitForFunction(() => Math.abs(SonicPlayback.position()-10)<.4);
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await touch.detach();
  }
  await page.evaluate(() => SonicPlayback.seek(2.4));
  console.log('PASS native touch cancellation keeps the current position and release seeks after capture is lost');

  await openLyrics();
  assert.equal(await room.getAttribute('data-lyric-effect'),'tide');
  await page.evaluate(() => SonicPlayback.seek(5.2));
  await room.locator('[data-current-line] .lr-lyric-translation').getByText('测试翻译',{exact:true}).waitFor();
  await page.evaluate(() => SonicPlayback.seek(2.4));
  const stageFullLyrics=room.locator('[data-stage-full-lyrics]');
  await stageFullLyrics.click();
  await full.waitFor();
  assert.equal(await preview.isVisible(),false);
  assert.deepEqual(await full.locator('.lr-full-text').allTextContents(),['引子','逐字推进','夜色','起风','普通整行','回声','远山','尾声']);
  assert.equal(await line(1).getAttribute('aria-current'),'true');
  assert.deepEqual(await line(1).locator('.lr-timed-group').allTextContents(),['逐','字','推进']);
  const lyricFill = await line(1).locator('.lr-timed-group').first().evaluate(node => parseFloat(node.style.getPropertyValue('--lr-word-fill')));
  assert.ok(lyricFill > 0 && lyricFill < 100);
  const shortLyricList=await page.addStyleTag({content:'#listeningRoom [data-full-lyrics] { height: 120px; }'});
  await full.hover();
  await page.mouse.wheel(0,165);
  await page.waitForFunction(()=>document.querySelector('[data-full-lyrics]').scrollTop>=100);
  const readingPosition=await full.evaluate(element=>element.scrollTop);
  await room.getByRole('button',{name:'搜索音乐',exact:true}).click();
  await room.getByRole('button',{name:'声波宇宙首页',exact:true}).click();
  await setMode('listen');
  assert.equal(await full.isVisible(),true,'Returning should keep full lyrics expanded');
  assert.equal(await full.evaluate(element=>element.scrollTop),readingPosition);
  const follow = room.locator('[data-lyric-follow]');
  assert.equal(await follow.isVisible(),true);
  await page.evaluate(() => SonicPlayback.seek(15.4));
  await line(7).and(full.locator('[aria-current="true"]')).waitFor({state:'attached'});
  assert.equal(await full.evaluate(element=>element.scrollTop),readingPosition,'Playback updates should not interrupt manual reading');

  const enterImmersion = room.locator('[data-lyric-full-tools] [data-action="enter-immersion"]');
  await enterImmersion.click();
  assert.equal(await room.getAttribute('data-listen-immersive'),'true');
  await page.waitForFunction(()=>document.querySelector('#listeningRoom').dataset.activeScene==='prism-bloom');
  assert.equal(await full.isVisible(),false);
  await seek.fill('11.2');
  await page.waitForFunction(()=>document.querySelector('[data-preview-line="0"]').textContent==='回声');
  const immersionQueue = room.locator('[data-queue-dialog]');
  await room.locator('.lr-player [data-action="queue"]').click();
  await immersionQueue.waitFor();
  await page.keyboard.press('Escape');
  await immersionQueue.waitFor({state:'hidden'});
  assert.equal(await room.getAttribute('data-listen-immersive'),'true');
  await page.keyboard.press('Escape');
  assert.equal(await room.getAttribute('data-listen-immersive'),'false');
  await page.waitForFunction(()=>!document.querySelector('#listeningRoom').hasAttribute('data-active-scene'));
  assert.equal(await full.evaluate(element=>element.scrollTop),readingPosition);
  assert.equal(await follow.isVisible(),true);
  assert.equal(await enterImmersion.evaluate(element=>document.activeElement===element),true);
  assert.ok(Math.abs(await page.evaluate(()=>SonicPlayback.position())-11.2)<.2);
  await page.evaluate(()=>SonicPlayback.seek(15.4));
  await line(7).and(full.locator('[aria-current="true"]')).waitFor({state:'attached'});
  console.log('PASS immersion keeps the same track and restores full lyric reading after a seek and Escape');

  await follow.focus();
  await page.keyboard.press('Enter');
  await follow.waitFor({state:'hidden'});
  assert.equal(await full.evaluate(element=>document.activeElement===element),true);
  const centeredLine = async index => {
    await page.waitForFunction(index=>{
      const scroll=document.querySelector('[data-full-lyrics]'), row=scroll.children[index];
      return row?.getAttribute('aria-current')==='true'&&
        Math.abs(row.getBoundingClientRect().top+row.offsetHeight/2-scroll.getBoundingClientRect().top-scroll.clientHeight/2)<2;
    },index);
  };
  await centeredLine(7);
  await shortLyricList.evaluate(element=>element.remove());
  await page.evaluate(() => SonicPlayback.seek(.5));
  await centeredLine(0);
  console.log('PASS manual reading survives navigation and playback updates, and returning centers the first and last lyrics');
  await line(4).click();
  await line(4).and(full.locator('[aria-current="true"]')).waitFor();
  assert.equal(await line(4).locator('.lr-timed-group').count(),0);
  assert.ok(Math.abs(await page.evaluate(() => SonicPlayback.snapshot().position) - 9) < .2);
  await room.locator('[data-action="lyric-effects"]:visible').click();
  await room.locator('button[data-lyric-style="fly"]').click();
  await room.locator('[data-effect-apply]').click();
  assert.equal(await room.getAttribute('data-lyric-style'),'fly');
  const flightRows = room.locator('[data-lyric-timeline] .lr-lyric-row:visible');
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
  const effectButton=room.locator('[data-action="lyric-effects"]:visible');
  const effectPicker=room.getByRole('dialog',{name:'歌词样式',exact:true});
  const effectChoices=effectPicker.locator('[data-effect-choice]');
  const stage=room.locator('[data-effect-stage]');
  const effectCanvas=room.locator('[data-effect-surface] canvas:visible');
  const currentEffectLyric=flightRows.and(room.locator('[data-current-line]'));
  await effectButton.click();
  assert.equal(await effectChoices.count(),18);
  const ids=await effectChoices.evaluateAll(nodes=>nodes.map(node=>node.dataset.effectChoice));
  assert.equal(new Set(ids).size,18);
  const themed=['impact','cut','neon','echo','film','flare','tide','ink'];
  const stageBackgrounds=new Set();
  for(const [index,id] of ids.entries()){
    if(index>0)await effectButton.click();
    if(!await effectChoices.nth(index).isVisible())await effectPicker.locator('[data-effect-more] summary').click();
    await effectChoices.nth(index).click();
    await effectPicker.locator('[data-effect-apply]').click();
    assert.equal(await room.getAttribute('data-lyric-effect'),id);
    assert.equal(await stage.getAttribute('data-fx'),id);
    const theme=await room.evaluate(node=>({
      active:node.hasAttribute('data-lyric-theme'),
      background:getComputedStyle(node.querySelector('[data-tide-atmosphere]:not([hidden])')||node).backgroundImage,
      fallbackInk:getComputedStyle(node).getPropertyValue('--fx-lyric-sung'),
      ambientVisible:getComputedStyle(node.querySelector('.lr-background')).visibility==='visible',
    }));
    assert.equal(theme.active,themed.includes(id),id);
    assert.equal(theme.ambientVisible,!theme.active,id);
    assert.equal(Boolean(theme.fallbackInk),theme.active,id);
    if(theme.active)stageBackgrounds.add(theme.background);
    assert.deepEqual(await flightRows.allTextContents(),['普通整行']);
    assert.equal(await flightRows.getAttribute('data-lyric-timing'),'line');
  }
  assert.equal(stageBackgrounds.size,themed.length);
  assert.equal(await currentEffectLyric.getAttribute('aria-current'),'true');

  const captureEffect=()=>effectCanvas.screenshot({
    omitBackground:true,
    style:'* { background: transparent !important; visibility: hidden !important; } [data-effect-surface] canvas { visibility: visible !important; }',
  });
  const seekEffect=async position=>{
    await page.evaluate(time=>SonicPlayback.seek(time),position);
    await page.waitForFunction(time=>{
      const state=SonicPlayback.snapshot();
      return state.playing && Math.abs(state.lyricPosition-time)<.3;
    },position);
  };
  await effectButton.click();
  if(!await effectPicker.getByRole('button',{name:'重拍',exact:true}).isVisible())await effectPicker.locator('[data-effect-more] summary').click();
  await effectPicker.getByRole('button',{name:'重拍',exact:true}).click();
  await effectPicker.locator('[data-effect-apply]').click();
  await page.evaluate(()=>SonicPlayback.seek(1.6));
  await play.click();
  await currentEffectLyric.filter({hasText:/^逐字推进$/}).waitFor();
  await effectCanvas.waitFor();
  assert.match(await room.getAttribute('data-lyric-renderer'),/^(webgl|canvas2d)$/);
  assert.equal(await currentEffectLyric.getAttribute('data-lyric-timing'),'word');
  assert.deepEqual(await flightRows.allTextContents(),['逐字推进']);

  await seekEffect(2.2);
  const early=await captureEffect();
  const visiblePixels=await page.evaluate(async png=>{
    const image=await createImageBitmap(new Blob([Uint8Array.from(atob(png),char=>char.charCodeAt(0))],{type:'image/png'}));
    const paint=new OffscreenCanvas(image.width,image.height).getContext('2d');
    paint.drawImage(image,0,0);
    const pixels=paint.getImageData(0,0,image.width,image.height).data;
    return pixels.some((value,index)=>index%4===3&&value>64);
  },early.toString('base64'));
  assert.ok(visiblePixels,'The graphics surface should paint the current lyric');
  await seekEffect(3.1);
  const later=await captureEffect();
  assert.notDeepEqual(later,early,'The same lyric should redraw at a later word time');
  await seekEffect(2.42);
  assert.notDeepEqual(await captureEffect(),later,'Seeking backwards should render the earlier word state');
  assert.deepEqual(await flightRows.allTextContents(),['逐字推进']);

  await seekEffect(5.2);
  await currentEffectLyric.filter({hasText:/^夜色测试翻译$/}).waitFor();
  assert.equal(await currentEffectLyric.locator('.lr-lyric-translation').textContent(),'测试翻译');
  if(await room.getAttribute('data-lyric-renderer')==='webgl') {
    const simulatedLoss=await effectCanvas.evaluate(canvas=>{
      const extension=canvas.getContext('webgl')?.getExtension('WEBGL_lose_context');
      extension?.loseContext();
      return Boolean(extension);
    });
    if(simulatedLoss){
      await page.waitForFunction(()=>document.querySelector('#listeningRoom').dataset.lyricRenderer==='canvas2d');
      await effectCanvas.waitFor();
      assert.equal(await currentEffectLyric.getAttribute('aria-current'),'true');
    }
  }
  await play.click();
  await page.waitForFunction(()=>!SonicPlayback.snapshot().playing);
  await page.emulateMedia({reducedMotion:'reduce'});
  await effectCanvas.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#listeningRoom')?.dataset.lyricRenderer==='text');
  assert.equal(await currentEffectLyric.getAttribute('aria-current'),'true');
  await currentEffectLyric.filter({hasText:/^夜色测试翻译$/}).waitFor();
  await page.evaluate(()=>SonicPlayback.seek(9));
  await currentEffectLyric.filter({hasText:/^普通整行$/}).waitFor();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await closeLyrics();
  await room.locator('[data-now-lyrics]').click();
  await full.waitFor();
  await closeLyrics();
  await openLyrics();
  assert.equal(await room.getAttribute('data-lyric-effect'),'impact');
  await effectButton.click();
  await room.locator('button[data-lyric-style="list"]').click();
  await room.locator('[data-effect-apply]').click();
  await closeLyrics();
  console.log('PASS all 18 lyric looks, rendered canvas pixels, timed seeks and reduced motion');

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
  await details.getByText('已填入专辑，核对后保存。',{ exact:true }).waitFor();
  assert.deepEqual(matchRequests,[{ name:edited.name, artist:edited.artist, duration:25 }]);
  assert.equal(lyricRequests,0);
  assert.equal(await details.locator('input[name="album"]').inputValue(),enrichment.album);
  assert.equal(await details.locator('textarea[name="lyrics"]').inputValue(),'');
  assert.equal(await page.evaluate(async id => (await SonicPlayback.localTrackDetails(id)).lyricsRaw,id),originalLyrics);
  console.log('PASS online metadata suggestions leave a deliberately emptied lyric draft blank');

  await details.locator('input[name="album"]').fill(edited.album);
  await details.locator('[data-detail-lyrics-file="lyrics"]').setInputFiles({
    name:'manual.lrc',mimeType:'text/plain',buffer:Buffer.from(edited.lyricsRaw),
  });
  await details.getByText('已读取文件，保存后应用。',{ exact:true }).waitFor();
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
    document.getElementById('importStatus').textContent.includes('含 1 首重复'));

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
  let fallbackRequests=0;
  await page.route('https://lrclib.net/api/get?*',route=>{
    const query=new URL(route.request().url()).searchParams;
    assert.equal(query.get('track_name'),longTags.name);
    assert.equal(query.get('artist_name'),longTags.artist);
    assert.equal(query.get('album_name'),longTags.album);
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Lrclib-Client'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    fallbackRequests++;
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
  assert.equal(await page.evaluate(async id=>(await SonicPlayback.localTrackDetails(id)).lyricsOrigin,longId),'online');
  console.log('PASS batch enrichment previews its exact LRCLIB match and persists only after approval');

  const playLocal=id=>room.locator(`[data-sl-id="${id}"] [data-sl-command="play"]`).click();
  const waitForLocal=id=>page.waitForFunction(id=>SonicPlayback.snapshot().track?.id===id&&!SonicPlayback.snapshot().busy,id);
  await playLocal(longId);
  await waitForLocal(longId);
  await playLocal(id);
  await waitForLocal(id);
  await openTrackDetails(longId);
  await details.locator('textarea[name="lyrics"]').fill('');
  await saveTrackDetails();
  await page.reload();
  await page.waitForFunction(()=>window.SonicPlayback?.library().ready);
  const cleared=await page.evaluate(id=>SonicPlayback.localTrackDetails(id),longId);
  assert.equal(cleared.lyricsRaw,'');
  assert.equal(cleared.lyricsOrigin,'manual');
  await setMode('library');
  await room.locator('[data-sl-view="local"]').click();
  await page.waitForFunction(()=>SonicPlayback.snapshot().onlineReady);
  const lyricChecks=[lyricRequests,fallbackRequests];
  await openTrackDetails(longId);
  await details.getByRole('button',{name:'在线补全',exact:true}).click();
  await details.getByText('未找到能确认是同一版本的歌曲，可以手动修改资料。',{exact:true}).waitFor();
  assert.equal(await details.locator('textarea[name="lyrics"]').inputValue(),'');
  assert.deepEqual(await page.evaluate(async draft=>{
    const preview=await SonicPlayback.previewLocalEnrichment(draft.id);
    const stale=await SonicPlayback.applyLocalEnrichment([{draft,lyricsRaw:'[00:02.00]过时的已批准结果'}]);
    return {preview,applied:stale.count};
  },cleared),{preview:null,applied:0});
  assert.deepEqual([lyricRequests,fallbackRequests],lyricChecks);
  console.log('PASS an inactive song’s manual clear survives reload, single enrichment, and stale bulk approval');

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
  await fs.writeFile(path.join(folder,onlineLyricsFile),longTagAudioFixture(onlineLyricsTags));
  await folderInput.setInputFiles(folder);
  const autoId=await page.waitForFunction(file=>{
    const library=SonicPlayback.library();
    return !library.importing&&library.tracks.find(track=>track.sourcePath.endsWith(file))?.id;
  },onlineLyricsFile).then(handle=>handle.jsonValue());
  await openTrackDetails(autoId);
  await details.getByRole('button',{name:'在线补全',exact:true}).click();
  await details.getByText(/已填入专辑、歌词/).waitFor();
  assert.equal(await details.locator('textarea[name="lyrics"]').inputValue(),enrichment.krc);
  await saveTrackDetails();
  assert.equal(await page.evaluate(async id=>(await SonicPlayback.localTrackDetails(id)).lyricsOrigin,autoId),'online');
  await playLocal(autoId);
  await waitForLocal(autoId);
  assert.equal(await page.evaluate(()=>SonicPlayback.nudgeLyrics(.1)),.1);
  await fs.writeFile(path.join(folder,verifiedSidecarFile),verifiedSidecar);
  await folderInput.setInputFiles(folder);
  await page.waitForFunction(id=>{
    const snapshot=SonicPlayback.snapshot();
    return !SonicPlayback.library().importing&&snapshot.track?.id===id&&snapshot.lyrics[0]?.text==='本机时间轴优先';
  },autoId);
  const autoSource=await page.evaluate(async id=>({
    origin:(await SonicPlayback.localTrackDetails(id)).lyricsOrigin,
    offset:SonicPlayback.snapshot().lyricOffset,
  }),autoId);
  assert.deepEqual(autoSource,{origin:'sidecar',offset:.1});
  console.log('PASS saving an untouched online suggestion preserves provenance, and verified sidecar takes priority without changing offset');
  assert.deepEqual(errors,[]);
  const finalIds=[...allIds,autoId];
  let movedPlaylist;
  if(desktop){
    const order=[longId,id,autoId];
    const playlist=await page.evaluate(async order=>{
      const id=SonicPlayback.savePlaylist('文件夹搬迁测试');
      await SonicPlayback.editPlaylistMembership(id,order,true);
      return id;
    },order);
    movedPlaylist={id:playlist,order};
    const moved=folder+'-moved';
    await fs.rename(folder,moved);
    try{
      const movedAudio=path.join(moved,'smoke.wav');
      const changedTimestamp=new Date('2001-01-01T00:00:00Z');
      await fs.utimes(movedAudio,changedTimestamp,changedTimestamp);
      await folderInput.setInputFiles(moved);
      const report=room.locator('[data-sl-import-status]');
      await report.filter({hasText:/重新关联 2 首/}).waitFor();
      await room.locator('[data-sl-import-details] summary').click();
      await room.locator('[data-sl-import-details] li').filter({hasText:/smoke\.wav.*已接回原曲库条目/}).waitFor();
      assert.deepEqual(await savedDetails(page,id),{...expected,ids:finalIds});
      const library=await page.evaluate(()=>SonicPlayback.library());
      assert.deepEqual(library.playlists.find(item=>item.id===playlist).trackIds,order);
      assert.equal(library.tracks.find(track=>track.id===id).sourcePath,path.basename(moved)+'/smoke.wav');

      await page.locator('#fileInput').setInputFiles(movedAudio);
      await report.filter({hasText:/含 1 首重复/}).waitFor();
      assert.deepEqual(await savedDetails(page,id),{...expected,ids:finalIds});
      // The matching scan uses the stored copy even while the original directory is gone.
      await playLocal(longId);
      await waitForLocal(longId);
      console.log('PASS renamed folder reconnects tracks after a timestamp change, keeps manual edits and ordered playlists, and skips repeated file imports');
    }finally{
      await fs.rename(moved,folder);
    }
  }
  return [{id,data:{...expected,ids:finalIds},movedPlaylist},{id:longId,data:{...expectedLong,ids:finalIds}},
    {id:autoId,data:{ids:finalIds,...onlineLyricsTags,album:enrichment.album,lyricsRaw:verifiedSidecar,cover:null}}];
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
      for (const { id, data, movedPlaylist } of expected) {
        assert.deepEqual(await savedDetails(page,id),data);
        if(movedPlaylist){
          const lists=await page.evaluate(()=>SonicPlayback.library().playlists);
          assert.deepEqual(lists.find(item=>item.id===movedPlaylist.id).trackIds,movedPlaylist.order);
        }
      }
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
    for (const file of [wav,lrc,...['smoke.translation.lrc',longTagsFile,onlineLyricsFile,verifiedSidecarFile].map(name=>path.join(folder,name))]) {
      await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await fs.rmdir(folder);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
