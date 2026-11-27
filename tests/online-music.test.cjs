'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const online = require('../outputs/online-music.js');
const searchEditionCases = require('./fixtures/search-editions.cjs');

for(const {query,unqualified,tracks} of searchEditionCases) {
  test('search preserves literal words with an edition in '+query,()=>{
    const [distractor,plain,live]=tracks;
    for(const candidates of [tracks,[...tracks].reverse(),[plain,distractor,live]]) {
      const ranked=online.rankSearchTracks(candidates,query);
      assert.deepEqual(ranked,[live,plain,distractor]);
      assert.deepEqual(new Set(online.rankSearchTracks(candidates,unqualified).slice(0,2)),new Set([plain,live]));
    }
    assert.deepEqual(online.rankSearchTracks([distractor,plain],query),[plain,distractor]);
    assert.equal(online.rankSearchTracks([distractor,live],query)[0],live);
  });
}

test('search only treats edition words outside the matched song and artist as editions',()=>{
  const plain={name:'DJ Set',artist:'Live Signal',album:'DJ Set'};
  const dj={...plain,name:'DJ Set (DJ)',album:'Variants'};
  const remix={...plain,name:'DJ Set (Remix)',album:'Variants'};
  for(const query of ['DJ Set Live Signal DJ','Live Signal / DJ Set / DJ','DJ Set DJ Live Signal','DJ DJ Set Live Signal']) {
    assert.equal(online.rankSearchTracks([plain,remix,dj],query)[0],dj);
  }
  assert.equal(online.rankSearchTracks([plain,dj,remix],'DJ Set Live Signal Remix')[0],remix);
  assert.equal(online.rankSearchTracks([{...plain,artist:'Signal'},plain],'DJ Set Live Signal')[0],plain);
  assert.equal(online.rankSearchTracks([remix,dj,plain],'DJ Set DJ')[0],dj);
});

test('cached search metadata follows edited song titles and artists',()=>{
  const recording={kind:'file',name:'Original Title',artist:'Original Artist'};
  const onlyMatches={keepUnmatched:false};
  assert.deepEqual(online.rankSearchTracks([recording],'Original Title',onlyMatches),[recording]);
  recording.name='Renamed Recording';recording.artist='Updated Artist';
  assert.deepEqual(online.rankSearchTracks([recording],'Original Title',onlyMatches),[]);
  assert.deepEqual(online.rankSearchTracks([recording],'Renamed Recording Updated Artist',onlyMatches),[recording]);
});

test('search source labels identify remote result metadata without a stored track type',()=>{
  assert.equal(online.playbackSourceLabel({provider:'qishui'}),'汽水音乐');
  assert.equal(online.playbackSourceLabel({provider:'navidrome'}),'Navidrome');
});

test('search recognizes named editions while keeping the title and artist ahead of the requested version',()=>{
  const otherLive={name:'Skyline - Live From the Hall',artist:'Other Artist'};
  const remix={name:'Skyline - Guest Producer Remix',artist:'Lead Singer、Guest Producer'};
  const live={name:'Skyline - Live From the Hall',artist:'Lead Singer'};
  const query='Skyline Lead Singer Live';
  assert.deepEqual(online.rankSearchTracks([otherLive,remix],query),[remix,otherLive]);
  assert.deepEqual(online.rankSearchTracks([otherLive,remix,live],query),[live,remix,otherLive]);
});

test('search ranks the exact title and artist ahead of same titles and other artist songs', () => {
  const wang={name:'当你',artist:'王心凌',album:'爱你'};
  const jiangnan={name:'江南',artist:'林俊杰'};
  const jj={name:'当你',artist:'林俊杰',album:'她说 概念自选辑',availability:'preview'};
  const another={name:'当你',artist:'陈布灵',availability:'full'};
  const recordings=[wang,jiangnan,another,jj];
  for(const query of ['当你 林俊杰','当你-林俊杰','当你 ／ 林俊杰','当你，林俊杰']){
    assert.deepEqual(online.rankSearchTracks(recordings,query),[jj,wang,another,jiangnan]);
  }
  assert.equal(online.rankSearchTracks(recordings,'当你 王心凌')[0],wang);
  assert.deepEqual(online.rankSearchTracks(recordings,'当你',{keepUnmatched:false}),[wang,another,jj]);
});

test('search retains English titles with spaces and treats ordinary titles and artist names literally', () => {
  const intended={name:'Always Online',artist:'林俊杰'};
  const other={name:'Always Online',artist:'其他歌手'};
  const offline={name:'Always Offline',artist:'林俊杰'};
  const literal={name:'Live Forever',artist:'Oasis'};
  const live={name:'Forever (Live)',artist:'Oasis'};
  const djArtist={name:'Let Me Love You',artist:'DJ Snake'};
  assert.deepEqual(online.rankSearchTracks([offline,other,intended],'Always Online 林俊杰'),[intended,other,offline]);
  assert.equal(online.rankSearchTracks([live,literal],'Live Forever Oasis')[0],literal);
  assert.equal(online.rankSearchTracks([other,djArtist],'Let Me Love You DJ Snake')[0],djArtist);
});

test('search favors requested editions and only confirmed studio evidence affects an unspecified edition', () => {
  const studio={name:'当你 (Studio Version)',artist:'林俊杰',album:'Studio Recording',duration:251};
  const live={name:'当你（现场版）',artist:'林俊杰',album:'现场版',duration:242};
  const dj={name:'当你（DJ 版）',artist:'林俊杰',album:'舞曲合集',duration:219};
  const remix={name:'当你 (Remix)',artist:'林俊杰',duration:210};
  const plain={name:'当你',artist:'林俊杰',duration:251};
  const jiangnan={name:'江南（Live）',artist:'林俊杰'};
  const list=[plain,dj,remix,live,jiangnan,studio];
  for(const [term,expected] of [['Live',live],['现场',live],['DJ',dj],['Remix',remix]]){
    assert.equal(online.rankSearchTracks(list,'当你 林俊杰 '+term)[0],expected);
  }
  assert.equal(online.rankSearchTracks(list,'当你 林俊杰')[0],studio);
  assert.deepEqual(online.rankSearchTracks([live,plain],'当你 林俊杰'),[live,plain]);
});

test('search distinguishes a pending playback status from missing version evidence', () => {
  assert.equal(online.searchPlaybackStatusLabel('unknown'),'可播状态待确认');
  assert.equal(online.searchPlaybackStatusLabel('full-source'),'可播整曲');
  assert.equal(online.searchPlaybackStatusLabel('preview-source'),'仅试听');
  assert.equal(online.searchPlaybackStatusLabel('auth-required'),'需登录');
  assert.equal(online.searchPlaybackStatusLabel('failed'),'播放失败');
  assert.equal(online.searchRecordingVersion({name:'夜曲（原唱）',artist:'本机艺人',album:'原唱合集',duration:25}),'');
  assert.equal(online.searchRecordingVersion({name:'夜曲（现场版）',artist:'本机艺人',album:'Live at the Test Hall',duration:25}),'');
  assert.equal(online.searchRecordingVersion({name:'夜曲（Live）',artist:'本机艺人',album:'Live at the Test Hall',duration:25}),'现场版');
});

test('owned recordings require an exact artist and available recording metadata', () => {
  const reference = { name:'晴天', artist:'周杰伦', album:'叶惠美', duration:269.747 };
  const original = { ...reference, duration:269.9 };
  const cover = { ...original, artist:'其他歌手' };
  const backing = { ...original, album:'晴天 (伴奏)' };
  const wrongLength = { ...original, duration:212 };
  assert.equal(online.findOwnedRecording(reference, [cover, backing, wrongLength, original]), original);
  assert.equal(online.findOwnedRecording(reference, [cover, backing, wrongLength]), null);
  assert.equal(online.findOwnedRecording(reference, [original, { ...original }]), null);
  assert.equal(online.findOwnedRecording({ name:reference.name, artist:reference.artist }, [backing]), null);
});

test('confirms Navidrome recordings with reference evidence and treats its unknown album as missing',()=>{
  const reference={name:'晴天',artist:'周杰伦',album:'叶惠美',duration:269.747};
  const original={name:'晴天',artist:'周杰伦',album:'[Unknown Album]',duration:269};
  const otherArtist={...original,artist:'验收歌手',album:'叶惠美'};
  const live={...original,version:'演唱会版'};
  const cover={...original,album:'翻唱版'};
  assert.equal(online.findOwnedRecording(reference,[otherArtist,live,cover,original]),original);
  assert.equal(online.findOwnedRecording(reference,[otherArtist,live,cover]),null);
  assert.equal(online.findOwnedRecording({name:'晴天',artist:'周杰伦'},[original]),null);
  assert.equal(online.findOwnedRecording({...reference,version:'录音室版'},[original,live]),null);
  assert.equal(online.findOwnedRecording({...reference,version:'演唱会版'},[original,live]),live);
  assert.equal(online.findOwnedRecording({...reference,duration:0},[original]),null);
});

test('normalizes an online Qishui track without signed playback fields', () => {
  const track = online.normalizeTrack({
    provider: 'qishui',
    mediaId: '7676337516358617115',
    name: '晴天',
    artist: '晚风纯音',
    cover: 'https://p3-luna.douyinpic.com/example.jpg',
    streamPath: '/media/secret',
  });
  assert.equal(track.kind, 'online');
  assert.equal(track.id, 'online:qishui:7676337516358617115');
  assert.equal(track.streamPath, undefined);
  assert.equal(online.persistentTrack({ ...track, streamPath: '/media/secret' }).streamPath, undefined);
});

test('rejects insecure track data and invalid media ids', () => {
  assert.equal(online.normalizeTrack({ provider: 'qishui', mediaId: '../x', name: 'x' }), null);
  assert.equal(online.normalizeTrack({
    provider: 'qishui', mediaId: '1', name: 'x', cover: 'javascript:alert(1)',
  }).cover, null);
});

test('external music results preserve QQ ids without entering the playable library', () => {
  const qq = online.normalizeExternalTrack({ provider: 'qq', mediaId: '0039MnYb0qxYhV', name: '晴天', artist: '周杰伦', externalUrl: 'https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV' });
  assert.equal(qq.mediaId, '0039MnYb0qxYhV');
  assert.equal(qq.linkedOnly, true);
  assert.equal(online.normalizeTrack(qq), null);
  assert.equal(online.persistentTrack({ ...qq, kind: 'online' }), null);
  assert.equal(online.mergeTracks([], [qq]).length, 0);
  assert.equal(online.normalizeExternalTrack({ provider: 'netease', mediaId: '../file' }), null);
  assert.equal(online.normalizeExternalTrack({ provider: 'unknown', mediaId: '1' }), null);
  assert.equal(online.normalizeExternalTrack({ provider: 'constructor', mediaId: '1' }), null);
});

test('official music destinations reject unrelated hosts and unsafe URLs', () => {
  for (const value of ['https://y.qq.com.attacker.test/song', 'https://attacker.test/y.qq.com', 'https://user:pass@y.qq.com/song', 'http://y.qq.com/song', 'javascript:alert(1)', 'https://y.qq.com:8443/song']) {
    assert.equal(online.officialTrackUrl('qq', value), null, value);
  }
  assert.equal(online.officialTrackUrl('netease', 'https://music.163.com/#/song?id=123'), 'https://music.163.com/#/song?id=123');
  const repaired = online.normalizeExternalTrack({ provider: 'netease', mediaId: '123', name: 'A', externalUrl: 'https://attacker.test/song' });
  assert.equal(repaired.externalUrl, 'https://music.163.com/#/song?id=123');
});

test('provider searches use distinct routes while legacy search stays on Qishui', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ items: [] }) };
  };
  const client = online.createClient({ baseUrl: 'http://127.0.0.1:8765' });
  await client.searchByProvider('netease', '晴天');
  await client.searchByProvider('qq', '夜曲');
  await client.search('老歌');
  await assert.rejects(client.searchByProvider('../bad', 'x'), /不支持/);
  await assert.rejects(client.searchByProvider('__proto__', 'x'), /不支持/);
  assert.deepEqual(calls.map(item => item.url), ['http://127.0.0.1:8765/api/netease/search', 'http://127.0.0.1:8765/api/qq/search', 'http://127.0.0.1:8765/api/qishui/search']);
  assert.equal(calls[0].body.query, '晴天');
});

test('an old Companion 404 is preserved so the UI can ask for an update', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'Route not found' }) });
  await assert.rejects(online.createClient().searchByProvider('qq', 'test'), error => error.status === 404);
});

test('discovery requests use local routes and parse official Qishui song links', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(new URL(url));
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    return Response.json({ items: [] });
  };
  const client = online.createClient({ baseUrl: 'http://127.0.0.1:8765' });
  assert.equal(online.qishuiSongId('汽水音乐 · 星光 https://qishui.douyin.com/song/123?share=1。'), '123');
  assert.equal(online.qishuiSongId('https://qishui.douyin.com.offsite.test/song/123'), '');
  assert.equal(online.qishuiSongId('https://qishui.douyin.com/song/123abc'), '');
  assert.equal(online.qishuiSongId('https://music.douyin.com/qishui/share/track?track_id=123'), '123');
  assert.equal(online.isQishuiShareLink('分享歌曲 https://qishui.douyin.com/s/ValidShare/'), true);
  assert.equal(online.isQishuiShareLink('https://qishui.douyin.com.bad.test/s/ValidShare/'), false);
  assert.equal(online.isQishuiShareLink('123'), false);
  await assert.rejects(client.song('https://third-party.test/song/123'), /官方歌曲链接/);
  await client.song('https://qishui.douyin.com/song/123#demo');
  await client.song('汽水音乐 · 星光 https://qishui.douyin.com/s/example/');
  await client.discovery({ preference: 'fresh' });
  await client.charts({ country: 'hk' });
  await client.musicVideos('测试 & MV');
  assert.deepEqual(calls.map(url => url.pathname), [
    '/api/qishui/songs/123', '/api/qishui/songs/resolve', '/api/qishui/discovery', '/api/discovery/charts', '/api/discovery/music-videos',
  ]);
  assert.ok(calls.every(url => url.origin === 'http://127.0.0.1:8765'));
  assert.equal(calls[1].searchParams.get('share'), 'example');
  assert.equal(calls[2].searchParams.get('preference'), 'fresh');
  assert.equal(calls[3].searchParams.get('country'), 'hk');
  assert.equal(calls[4].searchParams.get('query'), '测试 & MV');
});

test('chart matching forwards supplied recording hints and opts into candidates explicitly', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  const legacy = { item: null };
  const detailed = { item: null, reason: 'ambiguous', candidates: [{ mediaId: '123' }] };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8765/api/discovery/charts/match');
    assert.equal(options.method, 'POST');
    const payload = JSON.parse(options.body);
    calls.push(payload);
    return Response.json(payload.includeCandidates ? detailed : legacy);
  };

  const client = online.createClient({ baseUrl: 'http://127.0.0.1:8765' });
  const identity = { name: '夜曲', artist: '周杰伦' };
  assert.deepEqual(await client.matchChartTrack(identity), legacy);
  await client.matchChartTrack({ ...identity, duration: Infinity, album: '   ' }, { includeCandidates: false });
  await client.matchChartTrack({ ...identity, duration: 226.36, album: ' 十一月的萧邦 ' });
  assert.deepEqual(await client.matchChartTrack(identity, { includeCandidates: true }), detailed);
  assert.deepEqual(calls, [
    identity,
    identity,
    { ...identity, duration: 226.36, album: '十一月的萧邦' },
    { ...identity, includeCandidates: true },
  ]);
});

test('canceling a chart match aborts the in-flight Companion request', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let fetchSignal;
  globalThis.fetch = (_url, options) => {
    fetchSignal = options.signal;
    return new Promise(() => {});
  };

  const client = online.createClient();
  const controller = new AbortController();
  const match = client.matchChartTrack({ name: '夜曲', artist: '周杰伦' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(match, { name: 'AbortError' });
  assert.equal(fetchSignal?.aborted, true);
});

test('loads every Qishui playlist page in source order using server offsets', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  const track = id => ({ provider: 'qishui', mediaId: id, name: id });
  globalThis.fetch = async url => {
    const { pathname, searchParams } = new URL(url);
    calls.push(Number(searchParams.get('offset')));
    assert.equal(pathname, '/api/qishui/playlists/8');
    assert.equal(searchParams.get('limit'), '100');
    assert.equal(searchParams.get('ownerId'), 'someone_1');
    const page = calls.length === 1
      ? { playlist: { id: '8', name: '夜航' }, items: [track('1'), track('bad')], hasMore: true, nextOffset: 100 }
      : { items: [track('1'), track('2')], hasMore: false, nextOffset: 102 };
    return Response.json(page);
  };
  const client = online.createClient({ baseUrl: 'http://127.0.0.1:8765' });
  const data = await client.playlistAllTracks('8', { ownerId: 'someone_1' });
  assert.deepEqual(calls, [0, 100]);
  assert.equal(data.playlist.name, '夜航');
  assert.deepEqual(data.items.map(item => item.mediaId), ['1', '2']);
  assert.equal(data.hasMore, false);
  assert.equal(data.nextOffset, 102);
});

test('can enumerate the whole Qishui playlist library and ignore repeated collections', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async url => {
    const { pathname, searchParams } = new URL(url);
    assert.equal(pathname, '/api/qishui/library/playlists');
    assert.equal(searchParams.get('limit'), '100');
    calls.push(Number(searchParams.get('offset')));
    return Response.json(calls.length === 1
      ? { items: [{ id: '151', name: '歌单一' }], hasMore: true, nextOffset: 100 }
      : { items: [{ id: '151' }, { id: '156' }], hasMore: false });
  };
  const client = online.createClient({ baseUrl: 'http://127.0.0.1:8765' });
  const library = await client.playlistsAll();
  assert.deepEqual(calls, [0, 100]);
  assert.deepEqual(library.items.map(playlist => playlist.id), ['151', '156']);
  assert.equal(library.items[0].name, '歌单一');
});

test('loads past the first 50 liked tracks and retries only a temporarily unavailable page', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [], progress = [];
  const snapshot = '123e4567-e89b-12d3-a456-426614174000';
  let failed = false;
  globalThis.fetch = async (url, options) => {
    const { pathname, searchParams } = new URL(url);
    assert.equal(pathname, '/api/qishui/library/liked');
    assert.equal(options.credentials, 'omit');
    const offset = Number(searchParams.get('offset'));
    const limit = Number(searchParams.get('limit'));
    calls.push(offset);
    assert.equal(searchParams.get('snapshot'), offset ? snapshot : null);
    assert.equal(searchParams.get('refresh'), offset ? null : '1');
    if (offset === 50 && !failed) {
      failed = true;
      return Response.json({ error: '暂时无法读取' }, { status: 503 });
    }
    const total = 108, nextOffset = Math.min(total, offset + limit);
    const items = Array.from({ length: nextOffset - offset }, (_, i) => ({
      provider: 'qishui', mediaId: String(offset + i + 1), name: '收藏 '+ (offset + i + 1),
    })).filter(track => track.mediaId !== '58');
    return Response.json({ items, total, nextOffset, hasMore: nextOffset < total, snapshot, skipped: nextOffset - offset - items.length });
  };
  const client = online.createClient({ baseUrl: 'http://127.0.0.1:8765' });
  const library = await client.likedAll({ onProgress: update => progress.push(update) });
  assert.deepEqual(calls, [0, 25, 50, 50, 75, 100]);
  assert.deepEqual(progress.map(update => update.scanned), [25, 50, 75, 100, 108]);
  assert.equal(library.items.length, 107);
  assert.equal(library.total, 108);
  assert.equal(library.skipped, 1);
  assert.equal(library.items.at(-1).mediaId, '108');
  assert.ok(library.items.every(item => item.liked));
});

test('liked pagination rejects an old truncated response and does not retry expired sign-in or cancellation', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = online.createClient({ baseUrl: 'http://127.0.0.1:8765' });
  globalThis.fetch = async () => Response.json({ items: [], hasMore: false, total: 60 });
  await assert.rejects(client.likedAll(), /更新后重试/);

  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: '请登录', code: 'auth-required' }, { status: 401 });
  };
  await assert.rejects(client.likedAll(), { status: 401 });
  assert.equal(calls, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.likedAll({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('Qishui playlist reads reject a stalled offset and can be canceled between pages', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = online.createClient({ baseUrl: 'http://127.0.0.1:8765' });
  const signal = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ items: [], hasMore: true, nextOffset: 0 });
  };
  await assert.rejects(client.playlistAllTracks('8'), /翻页没有前进/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => {
    calls++;
    signal.abort();
    return Response.json({ items: [], hasMore: true, nextOffset: 100 });
  };
  await assert.rejects(client.playlistAllTracks('8', { signal: signal.signal }), { name: 'AbortError' });
  assert.equal(calls, 2);
});

test('repairs legacy Qishui cover URLs and exposes the local cover route', () => {
  const track = online.normalizeTrack({
    provider: 'qishui',
    mediaId: '7676337516358617115',
    name: '晴天',
    cover: 'https://p3-luna.douyinpic.com/img/cover-id',
  });
  assert.match(track.cover, /~tplv-b829550vbb-resize:360:360\.image$/);
  const client = online.createClient({ baseUrls: ['http://127.0.0.1:8765'] });
  assert.equal(client.coverUrl(track.mediaId), 'http://127.0.0.1:8765/api/qishui/tracks/7676337516358617115/cover');
  assert.equal(client.coverUrl('../bad'), '');
});

test('migrates legacy link-only soda records without making them playable', () => {
  const migrated = online.migrateLegacyLink({ id: 'soda-1', kind: 'soda', name: '旧链接' });
  assert.equal(migrated.kind, 'soda');
  assert.equal(migrated.linkedOnly, true);
});

test('merges repeated online results and keeps local favorites', () => {
  const first = online.normalizeTrack({ provider: 'qishui', mediaId: '1', name: 'A' });
  first.favorite = true;
  const merged = online.mergeTracks([first], [{ provider: 'qishui', mediaId: '1', name: 'A2' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'A2');
  assert.equal(merged[0].favorite, true);
});

test('recording labels need corroboration and never treat 原唱 in a title as a credit', () => {
  const live = { name: '夜曲（现场版）', artist: '艺人', album: '演唱会版', duration: 240 };
  assert.equal(online.recordingVersion(live), '现场版');
  assert.equal(online.recordingVersion({ ...live, album: '同名专辑' }), '版本待确认');
  assert.equal(online.recordingVersion({ ...live, duration: 0 }), '版本待确认');
  assert.equal(online.recordingVersion({ ...live, artist: '' }), '版本待确认');
  assert.equal(online.recordingVersion({ ...live, name: '夜曲（原唱）', album: '原唱合集' }), '版本待确认');
});

test('parses LRC and resolves the active lyric', () => {
  const lines = online.parseLrc('[00:01.00]第一句\n[00:03.50][00:05.00]第二句\n[ar:artist]');
  assert.equal(lines.length, 3);
  assert.equal(online.activeLyric(lines, 4).text, '第二句');
});

test('prefers the local companion first from the public page', () => {
  assert.deepEqual(
    online.companionBaseUrls({ protocol: 'https:', hostname: 'hgb-2005.github.io' }),
    ['http://127.0.0.1:8765', '']
  );
  assert.deepEqual(
    online.companionBaseUrls({ protocol: 'http:', hostname: '127.0.0.1' }),
    ['']
  );
});

test('detect probes candidates together and stops a hanging probe after another succeeds', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  let hangingSignal;
  globalThis.fetch = (url, options) => {
    calls.push(url);
    if (url.startsWith('http://slow')) {
      hangingSignal = options.signal;
      return new Promise(() => {});
    }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, companion: true }) });
  };
  const client = online.createClient({ baseUrls: ['http://slow', 'http://ready'], timeoutMs: 1500 });
  assert.equal(await client.detect(), true);
  assert.equal(calls.length, 2);
  assert.equal(client.baseUrl, 'http://ready');
  assert.equal(client.detectionState, 'ready');
  assert.equal(hangingSignal.aborted, true);
});

test('an older detection cannot override a newer successful retry', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let firstResolve, count = 0;
  globalThis.fetch = () => ++count === 1
    ? new Promise(resolve => { firstResolve = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ ok: true, companion: true }) });
  const client = online.createClient({ baseUrls: ['http://local'], timeoutMs: 1500 });
  const oldAttempt = client.detect();
  assert.equal(await client.detect(), true);
  firstResolve({ ok: false, status: 500, json: async () => ({}) });
  assert.equal(await oldAttempt, false);
  assert.equal(client.available, true);
  assert.equal(client.detectionState, 'ready');
});

test('a response with a stalled body reaches a timeout and can then reconnect', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: true, json: () => new Promise(() => {}) });
  const client = online.createClient({ baseUrls: ['http://local'], timeoutMs: 1500 });
  const began = Date.now();
  assert.equal(await client.detect(), false);
  assert.ok(Date.now() - began < 2400);
  assert.equal(client.available, false);
  assert.equal(client.detectionState, 'timeout');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, companion: true }) });
  assert.equal(await client.detect(), true);
  assert.equal(client.detectionState, 'ready');
});

test('a normal request ends with an actionable timeout instead of remaining busy', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = () => new Promise(() => {});
  const client = online.createClient({ timeoutMs: 1500 });
  await assert.rejects(client.search('test'), error => error.code === 'timeout' && /请重试/.test(error.message));
});
