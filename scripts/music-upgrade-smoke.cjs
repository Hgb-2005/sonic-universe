'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium, _electron } = require('playwright');
const { createAppServer } = require('../companion/server.cjs');

const root = path.resolve(__dirname, '..');
const port = 18869;
const origin = `http://127.0.0.1:${port}`;
const recommendation = { provider:'qishui', mediaId:'8101', name:'日推测试歌曲', artist:'镜湖', duration:25 };
const resolvedSong = { ...recommendation, mediaId:'8102', name:'解析测试歌曲' };
const chart = { provider:'apple', mediaId:'8103', name:'榜单测试歌曲', artist:'镜湖', linkedOnly:true,
  externalUrl:'https://music.apple.com/cn/song/8103' };
const matchedChartSong = { ...recommendation, mediaId:'8105', name:chart.name, artist:chart.artist };
const matchingPublicSong = { ...matchedChartSong, provider:'netease', mediaId:'9411', linkedOnly:true, externalUrl:'https://music.163.com/song?id=9411' };
const livePublicSong = { ...matchingPublicSong, mediaId:'9412', duration:47, externalUrl:'https://music.163.com/song?id=9412' };
const unmatchedChartSong = { ...chart, mediaId:'8106', name:'暂无汽水同版的榜单歌曲', externalUrl:'https://music.apple.com/cn/song/8106' };
const lastChartSong = { ...chart, mediaId:'8107',name:'榜单下一首' };
const matchedLastChartSong = { ...matchedChartSong, mediaId:'8108', name:lastChartSong.name };
const musicVideo = { ...chart, mediaId:'8104', name:'测试 MV', externalUrl:'https://music.apple.com/cn/music-video/8104' };
const inlineVideo = { provider:'commons', mediaId:'41356', name:'可在应用内播放的 MV', artist:'镜湖',
  videoUrl:'https://upload.wikimedia.org/wikipedia/commons/1/11/Inline-test.webm',
  externalUrl:'https://commons.wikimedia.org/wiki/File:Inline-test.webm',
  licenseName:'CC BY 4.0', licenseUrl:'https://creativecommons.org/licenses/by/4.0/' };
const failedInlineVideo = { ...inlineVideo, mediaId:'41357', name:'已下线的 MV',
  videoUrl:'https://upload.wikimedia.org/wikipedia/commons/1/11/Unavailable-test.webm',
  externalUrl:'https://commons.wikimedia.org/wiki/File:Unavailable-test.webm' };
const bilibiliVideo = { provider:'bilibili', mediaId:'BV1ki4y1d7Ln', name:'哔哩哔哩测试 MV', artist:'镜湖', duration:85 };
const bilibiliEmbedUrl = `https://player.bilibili.com/player.html?bvid=${bilibiliVideo.mediaId}&autoplay=1&danmaku=0`;
const bilibiliSecondPageUrl = bilibiliEmbedUrl + '&p=2';
const youtubeVideo = { provider:'youtube', mediaId:'TestMvID001', name:'允许嵌入的测试 MV', artist:'镜湖' };
const youtubeEmbedUrl = `https://www.youtube.com/embed/${youtubeVideo.mediaId}?autoplay=1&playsinline=1`;
const videoSearchFixtures = {
  commons:[inlineVideo,failedInlineVideo],
  bilibili:[bilibiliVideo],
  youtube:[youtubeVideo],
};
const localSong = { name:'Local Smoke Title', artist:'Fixture Artist', album:'Fixture Album' };
const localLyric = 'Matching folder lyrics';
const playlistSource = { id:'8120', ownerId:'8121', name:'同步测试歌单' };
const refreshedSong = { ...recommendation, mediaId:'8122', name:'刷新新增歌曲' };

function testAudio() {
  const sampleRate = 8000;
  const pcmBytes = sampleRate * 25 * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBytes, 40);
  return wav;
}

function taggedAudio() {
  const wav = testAudio();
  const fields = [['INAM',localSong.name],['IART',localSong.artist],['IPRD',localSong.album]];
  const tagChunks = fields.map(([tag,value]) => {
    const data = Buffer.from(`${value}\0`);
    const chunk = Buffer.alloc(8 + data.length + data.length % 2);
    chunk.write(tag);
    chunk.writeUInt32LE(data.length,4);
    data.copy(chunk,8);
    return chunk;
  });
  const info = Buffer.concat([Buffer.from('INFO'),...tagChunks]);
  const header = Buffer.alloc(8);
  header.write('LIST');
  header.writeUInt32LE(info.length,4);
  const tagged = Buffer.concat([wav.subarray(0,36),header,info,wav.subarray(36)]);
  tagged.writeUInt32LE(tagged.length - 8,4);
  return tagged;
}

async function mockCompanion(page) {
  const requests = [];
  const providerWrites = [];
  const chartMatches = [];
  const mediaRequests = [];
  let videoBuffer = null;
  let playlistName = playlistSource.name;
  let playlistItems = [recommendation, resolvedSong];
  const playlist = () => ({ ...playlistSource, name:playlistName, trackCount:playlistItems.length });
  const audio = testAudio();
  await page.addInitScript(() => {
    window.musicUpgradeOfficialLinks = [];
    window.open = url => { window.musicUpgradeOfficialLinks.push(String(url)); return null; };
  });
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.href === inlineVideo.videoUrl) {
      mediaRequests.push(url.href);
      assert.ok(videoBuffer);
      return route.fulfill({ contentType:'video/webm', headers:{ 'Access-Control-Allow-Origin':'*' }, body:videoBuffer });
    }
    if (url.href === failedInlineVideo.videoUrl) {
      mediaRequests.push(url.href);
      return route.fulfill({ status:404, headers:{ 'Access-Control-Allow-Origin':'*' } });
    }
    if ([bilibiliEmbedUrl,bilibiliSecondPageUrl,youtubeEmbedUrl].includes(url.href)) {
      mediaRequests.push(url.href);
      return route.fulfill({ contentType:'text/html', body:'<p>Test embedded video player</p>' });
    }
    if (url.origin !== origin) return url.protocol.startsWith('http') ? route.abort() : route.continue();
    if (url.pathname === '/health') return route.fulfill({ json:{ ok:true, companion:true } });
    if (url.pathname === '/api/providers') return route.fulfill({ json:{ musicApiVersion:2, items:[] } });
    if (url.pathname === '/api/qishui/login-status') return route.fulfill({ json:{ authenticated:true, user:{ nickname:'本机测试账号' } } });
    if (url.pathname.startsWith('/api/')) requests.push(url.pathname + url.search);
    if (url.pathname === '/api/qishui/discovery') return route.fulfill({ json:{ provider:'qishui', items:[recommendation] } });
    if (url.pathname === '/api/netease/search') return route.fulfill({json:{items:[matchingPublicSong,livePublicSong]}});
    if (url.pathname === '/api/qishui/search') return route.fulfill({json:{items:[matchedLastChartSong]}});
    if (url.pathname === '/api/qishui/library/playlists') return route.fulfill({ json:{ items:[playlist()], hasMore:false } });
    if (url.pathname === `/api/qishui/playlists/${playlistSource.id}`) {
      return route.fulfill({ json:{ playlist:playlist(), items:playlistItems, hasMore:false } });
    }
    if (/^\/api\/qishui\/playlist\/(add|remove)$/.test(url.pathname)) {
      providerWrites.push(request.postData());
      return route.fulfill({ status:500, json:{ error:'同步测试不允许写入汽水歌单' } });
    }
    if (url.pathname === `/api/qishui/songs/${resolvedSong.mediaId}`) return route.fulfill({ json:{ item:resolvedSong } });
    if (url.pathname === '/api/discovery/charts') return route.fulfill({ json:{ title:'测试热门榜单', items:[chart,unmatchedChartSong,lastChartSong] } });
    if (url.pathname === '/api/discovery/charts/match') {
      assert.equal(request.method(),'POST');
      const input = request.postDataJSON();
      chartMatches.push(input);
      const item = [matchedChartSong,matchedLastChartSong].find(song=>song.name===input?.name&&song.artist===input?.artist)||null;
      return route.fulfill({ json:{ item } });
    }
    if (url.pathname === '/api/discovery/music-videos') return route.fulfill({ json:{ items:[musicVideo] } });
    if (url.pathname === '/api/discovery/playable-videos') {
      const provider = url.searchParams.get('source');
      return route.fulfill({ json:{ provider, items:videoSearchFixtures[provider] ?? [] } });
    }
    if ([recommendation,matchedChartSong,matchedLastChartSong].some(track => url.pathname === `/api/qishui/tracks/${track.mediaId}/audio`)) {
      return route.fulfill({ json:{ streamPath:'/media/music-upgrade-test', preview:false } });
    }
    if (url.pathname === '/media/music-upgrade-test') {
      return route.fulfill({ contentType:'audio/wav', headers:{ 'Accept-Ranges':'bytes' }, body:audio });
    }
    if (/^\/api\/qishui\/songs\/\d+\/lyrics$/.test(url.pathname)) return route.fulfill({ json:{ lrc:'' } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status:404, json:{ error:'测试接口未配置' } });
    return route.continue();
  });
  return { requests, providerWrites, chartMatches, mediaRequests, setVideoBuffer(buffer){videoBuffer=buffer}, refreshFixture(){
    playlistName = '刷新后的同步歌单';
    playlistItems = [resolvedSong, refreshedSong];
  } };
}

async function makeVideo(page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(0);
    const [track] = stream.getVideoTracks();
    const recorder = new MediaRecorder(stream, { mimeType:'video/webm;codecs=vp8' });
    const parts = [];
    recorder.ondataavailable = event => parts.push(event.data);
    const finished = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    try {
      for (let frame = 0; frame < 12; frame++) {
        context.fillStyle = frame % 2 ? '#342248' : '#271b38';
        context.fillRect(0, 0, 64, 64);
        track.requestFrame();
        await new Promise(resolve => setTimeout(resolve, 90));
      }
    } finally {
      recorder.stop();
      stream.getTracks().forEach(item => item.stop());
    }
    await finished;
    return Array.from(new Uint8Array(await new Blob(parts).arrayBuffer()));
  });
  return { name:'music-video-fixture.webm', mimeType:'video/webm', buffer:Buffer.from(bytes) };
}

async function verifyPlaylistSync(page, companion) {
  const room = page.locator('#listeningRoom');
  await room.getByRole('button',{ name:'在线搜索',exact:true }).click();
  await page.locator('#onlinePlaylistsBtn').click();
  await page.locator(`[data-online-playlist-id="${playlistSource.id}"]`).click();
  await page.locator('#onlineSyncPlaylistBtn').click();
  const mirror = await page.waitForFunction(name => SonicPlayback.library().playlists.find(item => item.synced && item.name === name),playlistSource.name)
    .then(handle => handle.jsonValue());
  assert.deepEqual(mirror.trackIds,[`online:qishui:${recommendation.mediaId}`,`online:qishui:${resolvedSong.mediaId}`]);
  await page.keyboard.press('Escape');
  await room.getByRole('button',{ name:'音乐库',exact:true }).click();
  await room.locator(`[data-sl-view="${mirror.id}"]`).click();
  await room.getByRole('button',{ name:`播放 ${resolvedSong.name}`,exact:true }).waitFor();

  companion.refreshFixture();
  const review=page.getByRole('dialog',{name:'预览歌单变化'});
  await room.locator('[data-sl-command="refresh-synced"]').click();
  await review.getByText('新增 1 首',{exact:true}).waitFor();
  await review.getByRole('button',{name:'取消',exact:true}).click();
  assert.deepEqual(await page.evaluate(id=>SonicPlayback.library().playlists.find(list=>list.id===id).trackIds,mirror.id),mirror.trackIds);
  await room.locator('[data-sl-command="refresh-synced"]').click();
  await review.getByRole('button',{name:'保留本机编排，只追加新增'}).click();
  await room.getByRole('button',{ name:`播放 ${refreshedSong.name}`,exact:true }).waitFor();
  assert.deepEqual(await page.evaluate(id=>SonicPlayback.library().playlists.find(list=>list.id===id).trackIds,mirror.id),[...mirror.trackIds,`online:qishui:${refreshedSong.mediaId}`]);
  await room.locator('[data-sl-command="refresh-synced"]').click();
  await review.getByRole('button',{name:'采用远端曲目和顺序'}).click();
  await room.getByRole('button',{ name:`播放 ${recommendation.name}`,exact:true }).waitFor({state:'hidden'});
  const lists = await page.evaluate(() => SonicPlayback.library().playlists);
  assert.deepEqual(lists.filter(item => item.synced),[{
    id:mirror.id, name:'刷新后的同步歌单', trackIds:[`online:qishui:${resolvedSong.mediaId}`,`online:qishui:${refreshedSong.mediaId}`],synced:true,
  }]);
  const reads = companion.requests.filter(request => request.startsWith(`/api/qishui/playlists/${playlistSource.id}?`));
  assert.equal(reads.length,4);
  assert.ok(reads.every(request => new URL(request,origin).searchParams.get('ownerId') === playlistSource.ownerId));
  assert.deepEqual(companion.providerWrites,[]);
  console.log('PASS Qishui playlist sync refreshes tracks in place without writing to the provider');
}

async function verifyFolderImport(page) {
  // Use a real directory so Chromium assigns webkitRelativePath to each matching pair.
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'sonic-upgrade-'));
  const audioFile = path.join(folder,'different-filename.wav');
  const lyricsFile = path.join(folder,'different-filename.lrc');
  const timedLyricsFile = path.join(folder,'different-filename.yrc');
  try {
    await fs.writeFile(audioFile,taggedAudio());
    await fs.writeFile(lyricsFile,'[00:00.00]Line-only fallback');
    await fs.writeFile(timedLyricsFile,`[0,3000](500,800,0)${localLyric}\n[5000,900](5000,900,0)Next line`);
    await page.locator('#folderInput').setInputFiles(folder);
    const track = await page.waitForFunction(name => {
      const library = SonicPlayback.library();
      return !library.importing && library.tracks.find(item => item.name === name);
    },localSong.name).then(handle => handle.jsonValue());
    assert.equal(track.artist,localSong.artist);
    assert.equal(track.album,localSong.album);

    const room = page.locator('#listeningRoom');
    await room.locator('[data-sl-view="local"]').click();
    await room.locator(`[data-sl-id="${track.id}"] [data-sl-command="play"]`).click();
    const snapshot = await page.waitForFunction(() => {
      const state = SonicPlayback.snapshot();
      return state.track?.kind === 'file' && state.playing && state.lyrics.length && state;
    }).then(handle => handle.jsonValue());
    assert.equal(snapshot.track.id,track.id);
    assert.equal(snapshot.lyrics[0].text,localLyric);
    assert.deepEqual(snapshot.lyrics[0].points,[{index:0,time:.5,end:1.3}]);
    console.log('PASS folder import indexes WAV tags and prefers matching YRC word timing');
  } finally {
    await fs.unlink(audioFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.unlink(lyricsFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.unlink(timedLyricsFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(folder);
  }
}

async function verifyUpgrade(page) {
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const companion = await mockCompanion(page);
  const { requests } = companion;
  await page.goto(origin);
  await page.waitForFunction(() => SonicPlayback.snapshot().ready && SonicPlayback.snapshot().onlineReady);
  await page.evaluate(() => SonicPlayback.setVolume(0));
  const discovery = page.locator('dialog.sd-dialog');
  const tab = name => discovery.locator(`[data-discovery-tab="${name}"]`);
  const query = discovery.locator('[data-discovery-query]');
  const submit = discovery.locator('[data-discovery-submit]');
  const status = discovery.locator('[data-discovery-status]');
  const items = discovery.locator('[data-discovery-items]');

  await page.locator('[data-action="discovery"]').filter({ visible:true }).first().click();
  await items.getByText(recommendation.name,{exact:true}).waitFor();
  assert.equal(await tab('daily').getAttribute('aria-pressed'),'true');
  await items.getByRole('button',{ name:'播放推荐',exact:true }).click();
  await page.waitForFunction(name => {
    const snapshot = SonicPlayback.snapshot();
    return snapshot.track?.name === name && snapshot.playing;
  }, recommendation.name);
  assert.ok(requests.some(request => request.startsWith('/api/qishui/discovery?')));
  console.log('PASS recommendations open in the normal player');

  await tab('charts').click();
  await items.getByText(chart.name,{exact:true}).waitFor();
  assert.match(await status.textContent(),/^测试热门榜单/);
  const chartRow = name => items.locator('li').filter({ has:page.getByText(name,{exact:true}) });
  await chartRow(chart.name).locator('[data-discovery-play-chart]').click();
  await page.waitForFunction(id => {
    const snapshot = SonicPlayback.snapshot();
    return snapshot.playing && snapshot.track?.id === `online:qishui:${id}`;
  },matchedChartSong.mediaId);
  assert.deepEqual(companion.chartMatches,[{name:chart.name,artist:chart.artist}]);
  assert.ok(requests.includes(`/api/qishui/tracks/${matchedChartSong.mediaId}/audio`));
  assert.deepEqual(await page.evaluate(() => window.musicUpgradeOfficialLinks),[]);

  if (!await discovery.isVisible()) {
    await page.locator('[data-action="discovery"]').filter({ visible:true }).first().click();
    await tab('charts').click();
  }
  await chartRow(unmatchedChartSong.name).locator('[data-discovery-play-chart]').click();
  await page.waitForFunction(() => document.querySelector('[data-discovery-status]').dataset.error === 'true');
  assert.deepEqual(companion.chartMatches.at(-1),{name:unmatchedChartSong.name,artist:unmatchedChartSong.artist});
  assert.equal(await page.evaluate(() => SonicPlayback.snapshot().track.id),`online:qishui:${matchedChartSong.mediaId}`);
  assert.deepEqual(await page.evaluate(() => window.musicUpgradeOfficialLinks),[]);
  console.log('PASS chart playback plays the matched Qishui track and keeps unmatched results in the app');

  const before=companion.chartMatches.length;
  await items.getByRole('button',{name:'播放整榜'}).click();
  await page.waitForFunction(()=>SonicPlayback.snapshot({queue:true}).queueCount===3&&SonicPlayback.snapshot().playing);
  assert.deepEqual(companion.chartMatches.slice(before).map(match=>match.name),[chart.name]);
  await page.evaluate(()=>SonicPlayback.next());
  await page.waitForFunction(id=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().track?.id==='online:qishui:'+id,matchedLastChartSong.mediaId);
  assert.deepEqual(companion.chartMatches.slice(before).map(match=>match.name),[chart.name,unmatchedChartSong.name,lastChartSong.name]);
  console.log('PASS whole chart queues all rows and skips the unmatched track on advance');

  await discovery.evaluate(dialog=>dialog.close());
  await page.locator('.lr-header [data-action="online"]').click();
  await page.locator('[data-online-provider="netease"]').click();
  await page.locator('#onlineSearchInput').fill(chart.name);
  await page.locator('#onlineSearchBtn').click();
  const matchingButtons=page.locator('[data-online-action="match-qishui"]');
  await matchingButtons.last().click();
  await page.getByText('汽水暂时没有可确认的同版本，仍可在原平台收听。',{exact:true}).waitFor();
  await page.locator('[data-online-action="choose-qishui"]').click();
  await page.getByRole('dialog',{name:'选择汽水版本'}).getByRole('button',{name:/榜单下一首/}).click();
  await page.waitForFunction(id=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().track?.id==='online:qishui:'+id,matchedLastChartSong.mediaId);
  await matchingButtons.first().click();
  await page.getByText('正在播放汽水音乐提供的匹配版本。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>SonicPlayback.snapshot().track.id),`online:qishui:${matchedChartSong.mediaId}`);
  assert.deepEqual(await page.evaluate(()=>window.musicUpgradeOfficialLinks),[]);
  await page.locator('[data-online-provider="qishui"]').click();
  await page.locator('#queueDialog').evaluate(dialog=>dialog.close());
  await page.locator('[data-action="discovery"]').filter({visible:true}).first().click();
  console.log('PASS a public search match plays in the app only for the same recording length');

  const fixtureVideo = await makeVideo(page);
  companion.setVideoBuffer(fixtureVideo.buffer);
  const mvSource = discovery.locator('[data-discovery-mv-source]');
  const videoForm = discovery.locator('[data-discovery-video-form]');
  const embeddedPlayer = discovery.locator('[data-discovery-embed] iframe');
  const videoRow = name => items.locator('li').filter({ has:page.getByText(name,{exact:true}) });
  const hasVideoSearch = (provider,keyword) => requests.some(request => {
    const search = new URL(request,origin);
    return search.pathname === '/api/discovery/playable-videos'
      && search.searchParams.get('source') === provider
      && search.searchParams.get('query') === keyword;
  });
  const verifyEmbeddedPlayer = async url => {
    await embeddedPlayer.contentFrame().getByText('Test embedded video player',{exact:true}).waitFor();
    assert.equal(await embeddedPlayer.getAttribute('src'),url);
    assert.equal(await page.evaluate(() => SonicPlayback.snapshot().playing),false);
    assert.deepEqual(await page.evaluate(() => window.musicUpgradeOfficialLinks),[]);
  };
  const closeEmbeddedPlayer = async () => {
    await discovery.locator('[data-discovery-video-close]').click();
    await embeddedPlayer.waitFor({state:'detached'});
    await page.waitForFunction(() => SonicPlayback.snapshot().playing);
    assert.equal(await page.evaluate(() => SonicPlayback.snapshot().track.id),`online:qishui:${matchedChartSong.mediaId}`);
  };

  await tab('mv').click();
  assert.equal(await mvSource.inputValue(),'bilibili');
  await query.fill('搜索哔哩哔哩的 MV');
  await submit.click();
  await videoRow(bilibiliVideo.name).locator('[data-discovery-play-mv]').click();
  await verifyEmbeddedPlayer(bilibiliEmbedUrl);
  assert.equal(await embeddedPlayer.getAttribute('title'),bilibiliVideo.name);
  assert.ok(hasVideoSearch('bilibili','搜索哔哩哔哩的 MV'));
  await closeEmbeddedPlayer();

  await videoForm.locator('input').fill(`https://www.bilibili.com/video/${bilibiliVideo.mediaId}/?p=2`);
  await videoForm.getByRole('button',{name:'播放链接',exact:true}).click();
  await verifyEmbeddedPlayer(bilibiliSecondPageUrl);
  await closeEmbeddedPlayer();
  assert.ok(companion.mediaRequests.includes(bilibiliEmbedUrl));
  assert.ok(companion.mediaRequests.includes(bilibiliSecondPageUrl));
  console.log('PASS Bilibili is the default MV search and both results and multipart links open inline');

  await mvSource.selectOption('commons');
  await query.fill('公开授权视频');
  await submit.click();
  await items.getByText(inlineVideo.name,{exact:true}).waitFor();
  assert.ok(hasVideoSearch('commons','公开授权视频'));
  const localVideoWasPlaying = () => page.waitForFunction(() => {
    const video = document.querySelector('dialog.sd-dialog video');
    return video.currentTime > .04 && !video.paused && !SonicPlayback.snapshot().playing;
  });
  await videoRow(inlineVideo.name).locator('[data-discovery-play-mv]').click();
  await localVideoWasPlaying();
  assert.ok(companion.mediaRequests.includes(inlineVideo.videoUrl));
  assert.deepEqual(await page.evaluate(() => window.musicUpgradeOfficialLinks),[]);
  await tab('resolve').click();
  await page.waitForFunction(() => SonicPlayback.snapshot().playing);
  assert.equal(await discovery.locator('video').isVisible(),false);
  assert.equal(await page.evaluate(() => SonicPlayback.snapshot().track.id),`online:qishui:${matchedChartSong.mediaId}`);

  await tab('mv').click();
  await query.fill('已下线的视频');
  await submit.click();
  await videoRow(failedInlineVideo.name).locator('[data-discovery-play-mv]').click();
  await page.waitForFunction(() => document.querySelector('[data-discovery-status]').dataset.error === 'true' && SonicPlayback.snapshot().playing);
  assert.ok(companion.mediaRequests.includes(failedInlineVideo.videoUrl));
  assert.deepEqual(await page.evaluate(() => window.musicUpgradeOfficialLinks),[]);
  assert.equal(await discovery.locator('video').isVisible(),false);
  console.log('PASS searched licensed MV plays inline, restores music when closed, and handles invalid media');

  await mvSource.selectOption('youtube');
  await query.fill('搜索可嵌入的 MV');
  await submit.click();
  await videoRow(youtubeVideo.name).locator('[data-discovery-play-mv]').click();
  await verifyEmbeddedPlayer(youtubeEmbedUrl);
  assert.equal(await embeddedPlayer.getAttribute('title'),youtubeVideo.name);
  assert.ok(hasVideoSearch('youtube','搜索可嵌入的 MV'));
  await closeEmbeddedPlayer();

  await videoForm.locator('input').fill(`https://youtu.be/${youtubeVideo.mediaId}`);
  await videoForm.getByRole('button',{name:'播放链接',exact:true}).click();
  await verifyEmbeddedPlayer(youtubeEmbedUrl);
  await closeEmbeddedPlayer();
  assert.equal(companion.mediaRequests.filter(url => url === youtubeEmbedUrl).length,2);
  console.log('PASS searched YouTube results and share links open the embedded player');

  await mvSource.selectOption('apple');
  await query.fill('镜湖的歌');
  await submit.click();
  await items.getByText(musicVideo.name,{exact:true}).waitFor();
  const mvRequest = requests.findLast(request => request.startsWith('/api/discovery/music-videos?'));
  assert.equal(new URL(mvRequest,origin).searchParams.get('query'),'镜湖的歌');
  await items.getByRole('button',{ name:'打开官方 MV',exact:true }).click();
  assert.deepEqual(await page.evaluate(() => window.musicUpgradeOfficialLinks),[musicVideo.externalUrl]);
  await discovery.locator('input[type=file]').setInputFiles(fixtureVideo);
  await localVideoWasPlaying();
  await tab('resolve').click();
  await page.waitForFunction(() => SonicPlayback.snapshot().playing);
  assert.equal(await discovery.locator('video').isVisible(),false);
  console.log('PASS official MV link remains available and local MV pauses and resumes the song');

  await query.fill('https://example.invalid/song/8102');
  await submit.click();
  await page.waitForFunction(() => document.querySelector('[data-discovery-status]').dataset.error === 'true');
  assert.equal(requests.some(request => request.includes(`/songs/${resolvedSong.mediaId}`)),false);
  await query.fill(`https://qishui.douyin.com/song/${resolvedSong.mediaId}`);
  await submit.click();
  await items.getByText(resolvedSong.name,{exact:true}).waitFor();
  assert.ok(requests.includes(`/api/qishui/songs/${resolvedSong.mediaId}`));
  assert.equal(await items.getByRole('button',{ name:'播放这首',exact:true }).isVisible(),true);
  await discovery.getByRole('button',{ name:'关闭音乐发现',exact:true }).click();
  console.log('PASS link parser rejects foreign hosts and retrieves official Qishui song details');

  const equalizerTrigger = page.locator('[data-action="equalizer"]');
  if (!await equalizerTrigger.first().isVisible()) {
    await page.getByRole('button',{ name:'调整氛围',exact:true }).click();
  }
  await equalizerTrigger.filter({ visible:true }).first().click();
  const equalizer = page.getByRole('dialog',{ name:'均衡器',exact:true });
  assert.equal(await equalizer.getByRole('slider').count(),10);
  await equalizer.getByRole('combobox',{ name:'均衡器预设' }).selectOption('bass');
  assert.equal(await equalizer.getByRole('checkbox').isChecked(),true);
  assert.equal(await equalizer.getByRole('slider',{ name:'62 Hz 增益' }).inputValue(),'5');
  assert.equal(await page.evaluate(() => SonicPlayback.snapshot().playing),true);
  console.log('PASS equalizer opens from player settings and changes the preset during playback');

  await equalizer.getByRole('button',{ name:'关闭均衡器',exact:true }).click();
  await page.keyboard.press('Escape');
  await page.locator('[data-action="playback-settings"]').click();
  await page.locator('[data-playback-rate]').selectOption('1.5');
  assert.equal(await page.evaluate(()=>SonicPlayback.playbackSettings().rate),1.5);
  await page.locator('[data-sleep-timer]').selectOption('15');
  assert.ok(await page.evaluate(()=>SonicPlayback.playbackSettings().sleepDeadline>Date.now()));
  await page.locator('[data-sleep-timer]').selectOption('0');
  assert.equal(await page.evaluate(()=>SonicPlayback.playbackSettings().sleepDeadline),0);
  await page.locator('[data-playback-rate]').selectOption('1');
  await page.getByRole('button',{name:'关闭播放设置'}).click();
  await page.evaluate(()=>{
    const real=window.setTimeout;
    window.setTimeout=(handler,delay,...args)=>real(handler,delay===900000?25:delay,...args);
    try{SonicPlayback.setSleepTimer(15);}finally{window.setTimeout=real;}
  });
  await page.waitForFunction(()=>!SonicPlayback.snapshot().playing&&SonicPlayback.playbackSettings().sleepDeadline===0);
  console.log('PASS playback rate and sleep timer settings control the active player');
  await verifyPlaylistSync(page,companion);
  await verifyFolderImport(page);
  assert.deepEqual(errors,[]);
}

async function run() {
  if (process.argv.includes('--packaged')) {
    const qa = path.join(root,'work','desktop-qa');
    await fs.mkdir(qa,{ recursive:true });
    const profile = await fs.mkdtemp(path.join(qa,'music-upgrade-profile-'));
    const executablePath = path.resolve(process.env.SONIC_DESKTOP_EXECUTABLE || path.join(root,'release','win-unpacked','声波宇宙.exe'));
    const app = await _electron.launch({ executablePath, cwd:root, timeout:30000,
      env:{ ...process.env, SONIC_DESKTOP_PROFILE:profile, SONIC_DESKTOP_PORT:String(port) } });
    try { await verifyUpgrade(await app.firstWindow()); }
    finally { await app.close(); }
    return;
  }

  const app = createAppServer({ port, providers:new Map() });
  await app.listen();
  try {
    const channel = process.env.SONIC_TEST_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
    const browser = await chromium.launch({ channel, headless:true });
    try { await verifyUpgrade(await browser.newPage({ viewport:{ width:1440,height:900 } })); }
    finally { await browser.close(); }
  } finally {
    await new Promise(resolve => app.server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
