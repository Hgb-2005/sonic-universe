'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const requireCompanion = createRequire(require.resolve('../companion/package.json'));
const { createQishuiDeviceId } = requireCompanion('qishui-music-api');
const {
  createQishuiProvider,
  coverUrl,
  krcToLrc,
  lyricData,
  loginQrKey,
  normalizeTrack,
  normalizePlaylist
} = require('../companion/providers/qishui.cjs');
const { parseRange, corsHeaders, isTrustedCoverUrl } = require('../companion/server.cjs');
const { createPublicSearchProvider, normalizeNeteaseTrack, normalizeQqTrack, normalizeKugouTrack, searchParams } = require('../companion/providers/public-search.cjs');
const { createDiscoveryProvider } = require('../companion/providers/discovery.cjs');

test('converts KRC character timing to ordinary LRC', () => {
  const output = krcToLrc('[14690,6530]<0,210,0>故<210,200,0>事');
  assert.equal(krcToLrc('[14690,6530]<0,210,0>故<210,200,0>事', true), '[00:14.690]<00:14.690>故<00:14.900>事');
  assert.equal(output, '[00:14.69]故事');
});

test('keeps bounded WebVTT and XML lyric sources alongside the existing LRC/KRC fields', () => {
  const normalize = (type, content) => lyricData({ lyric_info: { lyric_entity: { type, content } } });
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\n故事';
  const ttml = '<tt><body><p begin="1s" end="2s">故事</p></body></tt>';
  assert.deepEqual(normalize('vtt', vtt), { type: 'vtt', lrc: '', timedLrc: '', krc: undefined, raw: vtt });
  assert.equal(normalize('krc', ttml).raw, ttml);
  assert.equal(normalize('vtt', vtt + ' '.repeat(250000)).raw, undefined);
  assert.deepEqual(normalize('lrc', '[00:01.00]故事'), {
    type: 'lrc', lrc: '[00:01.00]故事', timedLrc: undefined, krc: undefined,
  });
  const krc = '[1000,500]<0,210,0>故<210,290,0>事';
  assert.deepEqual(normalize('krc', krc), {
    type: 'krc', lrc: '[00:01.00]故事', timedLrc: '[00:01.000]<00:01.000>故<00:01.210>事', krc,
  });
});

test('extracts the QR session key from the provider response envelope', () => {
  const key = '0123456789abcdef0123456789abcdef';
  assert.equal(loginQrKey({ key }), key);
  assert.equal(loginQrKey({ key: key.toUpperCase() }), key);
  assert.equal(loginQrKey({ key: 'short' }), '');
  assert.equal(loginQrKey(null), '');
});

test('normalizes a provider track to a sanitized public shape', () => {
  const track = normalizeTrack({
    base_info: { id: '123', name: '歌名', duration_ms: 90000 },
    related_info: { artist_links: [{ name: '歌手' }], album_link: { name: '专辑' } },
    display_info: {
      cover_url: { uri: 'cover.jpg', urls: ['https://p3-luna.douyinpic.com/img/'] },
      lyric_info: { lyric_entity: { content: 'secret lyric' } },
    },
    player_info: { secret: true },
  });
  assert.equal(track.mediaId, '123');
  assert.equal(track.duration, 90);
  assert.equal(track.artist, '歌手');
  assert.equal(track.player_info, undefined);
  assert.match(track.cover, /~tplv-b829550vbb-resize:360:360\.image$/);
});

test('normalizes playlist fields and parses range headers', () => {
  const playlist = normalizePlaylist({ base_info: { id: '8', name: '夜航', track_count: 4 }, playlist: {} });
  assert.equal(playlist.trackCount, 4);
  assert.deepEqual(parseRange('bytes=2-9', 20), { start: 2, end: 9 });
  assert.deepEqual(parseRange('bytes=-5', 20), { start: 15, end: 19 });
  assert.deepEqual(parseRange('bytes=20-30', 20), { invalid: true });
});

test('Qishui playlist pages pass the owner and resume at the SDK cursor after 100 songs', async t => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sonic-qishui-playlist-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const requests = [];
  const track = id => ({ track_entity: { base_info: { id: String(id), name: `歌曲 ${id}` } } });
  const provider = await createQishuiProvider({ dataDirectory: directory, fetch: async (url, request) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/client/token/get/')) return Response.json({ client_token: 'fixture-token' });
    assert.ok(pathname.endsWith('/playlist/detail/'));
    const { cursor, playlist_id, owner_id, count } = JSON.parse(request.body);
    requests.push({ cursor, playlist_id, owner_id, count });
    if (cursor === '0') return Response.json({ data: {
      playlist: { base_info: { id: '8', name: '夜航', track_count: 101 } },
      media_entities: Array.from({ length: 100 }, (_, index) => track(index + 1)),
      has_more: true, next_cursor: 'second_page',
    } });
    return Response.json({ data: { media_entities: [track(101)], has_more: false } });
  } });
  const first = await provider.playlist('8', { limit: '100', offset: '0', ownerId: 'owner_1' });
  const second = await provider.playlist('8', { limit: '100', offset: String(first.nextOffset), ownerId: 'owner_1' });
  assert.equal(first.items.length, 100);
  assert.equal(first.hasMore, true);
  assert.equal(first.playlist.name, '夜航');
  assert.deepEqual(second.items.map(song => song.mediaId), ['101']);
  assert.equal(second.hasMore, false);
  assert.deepEqual(requests, [
    { cursor: '0', playlist_id: '8', owner_id: 'owner_1', count: 100 },
    { cursor: 'second_page', playlist_id: '8', owner_id: 'owner_1', count: 100 },
  ]);
});

test('Qishui recommendations use a signed-in library and expose only normalized track metadata', async t => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { EncryptedQishuiSessionStore } = require('../companion/session-store.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sonic-qishui-discovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const anonymous = await createQishuiProvider({ dataDirectory: directory, fetch: () => assert.fail('Network used before login') });
  await assert.rejects(anonymous.discovery(), error => error.status === 401 && error.code === 'auth-required');
  const session = await new EncryptedQishuiSessionStore({ directory }).init(createQishuiDeviceId);
  session.set({ userId: '86420' });
  await session.flush();

  const requests = [];
  const raw = { base_info: { id: '123', name: '晚风', duration_ms: 106000 }, player_info: { opaque: true } };
  const provider = await createQishuiProvider({ dataDirectory: directory, fetch: async (url, options) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/client/token/get/')) return Response.json({ client_token: 'fixture-token' });
    if (pathname.startsWith('/s/')) {
      assert.equal(options.redirect, 'manual');
      const target = pathname === '/s/ValidShare/'
        ? 'https://music.douyin.com/qishui/share/track?track_id=123'
        : 'https://not-qishui.example/qishui/share/track?track_id=123';
      return new Response(null, { status: 302, headers: { Location: target } });
    }
    const request = JSON.parse(options.body);
    requests.push({ pathname, request });
    if (pathname.endsWith('/feed/song-tab/')) return Response.json({ data: { items: [raw, raw] } });
    assert.ok(pathname.endsWith('/media/mget/'));
    return Response.json({ data: { media_list: [{ media_id: '123', track_entity: raw }] } });
  } });
  await assert.rejects(provider.discovery({ preference: 'anything' }), error => error.status === 400);
  const discovery = await provider.discovery({ limit: 6, preference: 'fresh' });
  assert.equal(discovery.mode, 'fresh');
  assert.deepEqual(discovery.items.map(({ mediaId }) => mediaId), ['123']);
  assert.equal(requests[0].request.feed_preference.preference_mode, 'fresh');
  assert.equal(requests[0].request.common_params.user_id, '86420');
  assert.equal(requests[0].request.count, 6);
  const song = await provider.song('123');
  assert.equal(song.item.player_info, undefined);
  assert.equal(song.item.duration, 106);
  await assert.rejects(provider.songFromShare('../rejected'), error => error.status === 400);
  await assert.rejects(provider.songFromShare('WrongRedirect'), error => error.status === 404);
  assert.equal((await provider.songFromShare('ValidShare')).item.mediaId, '123');
});

test('Qishui liked library paginates a complete account snapshot after 50 tracks', async t => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { generateKeyPairSync } = require('node:crypto');
  const { EncryptedQishuiSessionStore } = require('../companion/session-store.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sonic-qishui-liked-'));
  t.after(async () => {
    await fs.unlink(path.join(directory, 'qishui-session.enc'));
    await fs.unlink(path.join(directory, 'session-key'));
    await fs.rmdir(directory);
  });
  const store = await new EncryptedQishuiSessionStore({ directory }).init(createQishuiDeviceId);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  store.set({
    userId: '12345', ticket: 'test-ticket', guardCert: 'test-cert', guardTsSign: 'test-sign',
    guardKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  await store.flush();
  const inventoryCursors = [], detailIds = [];
  const track = id => ({ track_entity: { base_info: { id: String(id), name: '收藏 '+id } } });
  const provider = await createQishuiProvider({ dataDirectory: directory, fetch: async (url, req) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/client/token/get/')) return Response.json({ client_token: 'fixture-token' });
    const body = JSON.parse(req.body);
    if (pathname.endsWith('/me/playlist/')) {
      return Response.json({ data: { playlists: [{ base_info: { id: '98', type: 1, owner_id: '12345' } }], has_more: false } });
    }
    if (pathname.endsWith('/playlist/detail/')) {
      inventoryCursors.push(body.cursor);
      assert.equal(body.playlist_id, '98');
      const first = body.cursor === '';
      return Response.json({ data: {
        media_entities: first ? Array.from({ length: 100 }, (_, index) => track(index + 1)) : [track(100), track(101), track(102)],
        has_more: first, next_cursor: first ? 'cursor-2' : '',
      } });
    }
    assert.ok(pathname.endsWith('/media/mget/'));
    const id = body.media_list[0].id;
    detailIds.push(id);
    return Response.json({ data: { media_list: id === '51' ? [] : [track(id)] } });
  } });
  await assert.rejects(provider.liked({ limit: 51 }), { status: 400, code: 'invalid-liked-page' });
  const first = await provider.liked({ limit: 50, offset: 0, refresh: true });
  const second = await provider.liked({ limit: 50, offset: first.nextOffset, snapshot: first.snapshot });
  const last = await provider.liked({ limit: 50, offset: second.nextOffset, snapshot: first.snapshot });
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 50);
  assert.equal(first.total, 102);
  assert.equal(second.nextOffset, 100);
  assert.equal(second.items[0].mediaId, '52');
  assert.equal(second.skipped, 1);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextOffset, 102);
  assert.deepEqual(last.items.map(item => [item.mediaId,item.liked]), [['101',true],['102',true]]);
  assert.deepEqual(inventoryCursors, ['', 'cursor-2']);
  assert.equal(detailIds.length, 102);
  await assert.rejects(provider.liked({ offset: 50, snapshot: '123e4567-e89b-12d3-a456-426614174000' }), { status: 409, code: 'liked-list-changed' });
});

test('Apple charts and MV discovery use official links and do not expose promotional video streams', async () => {
  const calls = [];
  const provider = createDiscoveryProvider({ fetch: async (url, options) => {
    const parsed = new URL(url);
    calls.push(parsed.href);
    assert.equal(options.redirect, 'error');
    if (parsed.hostname === 'rss.marketingtools.apple.com') return Response.json({ feed: { title: '热门歌曲', results: [
      { id: '123', name: '星光', artistName: '测试', url: 'https://music.apple.com/cn/album/test/1?i=123', artworkUrl100: 'https://is1-ssl.mzstatic.com/image.jpg' },
      { id: '456', name: '无效链接', url: 'https://music.apple.com.bad.test/cn/album/test/2' },
    ] } });
    assert.equal(parsed.origin, 'https://itunes.apple.com');
    assert.equal(parsed.searchParams.get('term'), '星光 & 夜晚');
    assert.equal(parsed.searchParams.get('media'), 'musicVideo');
    return Response.json({ results: [
      { kind: 'music-video', trackId: 1, trackName: '夜晚', artistName: '作者', trackViewUrl: 'https://music.apple.com/cn/music-video/night/1', previewUrl: 'https://video-ssl.itunes.apple.com/preview.m4v' },
      { kind: 'song', trackId: 2, trackName: '歌曲', trackViewUrl: 'https://music.apple.com/cn/song/test/2' },
    ] });
  } });
  await assert.rejects(provider.charts({ country: '../bad' }), error => error.status === 400);
  await assert.rejects(provider.musicVideos({ query: ' ' }), error => error.status === 400);
  const charts = await provider.charts({ country: 'CN', limit: 8 });
  assert.equal(calls[0], 'https://rss.marketingtools.apple.com/api/v2/cn/music/most-played/25/songs.json');
  assert.equal(charts.title, '热门歌曲');
  assert.deepEqual(charts.items.map(item => [item.mediaId, item.linkedOnly]), [['123', true]]);
  const videos = await provider.musicVideos({ query: '星光 & 夜晚' });
  assert.deepEqual(videos.items, [{ provider: 'apple', mediaId: '1', name: '夜晚', artist: '作者', externalUrl: 'https://music.apple.com/cn/music-video/night/1', linkedOnly: true }]);
});

test('allows only the local app and published site for cross-origin requests', () => {
  assert.equal(corsHeaders('http://127.0.0.1:8765', 8765)['Access-Control-Allow-Origin'], 'http://127.0.0.1:8765');
  const published = corsHeaders('https://hgb-2005.github.io', 8765);
  assert.equal(published['Access-Control-Allow-Origin'], 'https://hgb-2005.github.io');
  assert.equal(published['Access-Control-Allow-Private-Network'], 'true');
  assert.match(published['Access-Control-Allow-Headers'], /Range/);
  assert.deepEqual(corsHeaders('https://example.com', 8765), {});
});

test('completes Qishui covers and restricts image proxy destinations', () => {
  const cover = coverUrl({
    uri: 'cover-id',
    urls: ['https://p3-luna.douyinpic.com/img/'],
    template_prefix: 'tplv-example',
  });
  assert.equal(cover, 'https://p3-luna.douyinpic.com/img/cover-id~tplv-example-resize:360:360.image');
  assert.equal(isTrustedCoverUrl('https://p3-luna.douyinpic.com/img/cover'), true);
  assert.equal(isTrustedCoverUrl('http://p3-luna.douyinpic.com/img/cover'), false);
  assert.equal(isTrustedCoverUrl('https://127.0.0.1/cover'), false);
  assert.equal(isTrustedCoverUrl('https://douyinpic.com.evil.example/cover'), false);
});

test('public search normalizes metadata and builds official links without playback fields', () => {
  const netease = normalizeNeteaseTrack({
    id: 123, name: '星空', artists: [{ name: '歌手' }], duration: 123000,
    album: { name: '专辑', picUrl: 'http://p1.music.126.net/cover.jpg' },
    url: 'https://secret.example/audio', cookie: 'private',
  });
  assert.equal(netease.provider, 'netease');
  assert.equal(netease.duration, 123);
  assert.equal(netease.cover, 'https://p1.music.126.net/cover.jpg');
  assert.equal(netease.externalUrl, 'https://music.163.com/#/song?id=123');
  assert.equal(netease.linkedOnly, true);
  assert.equal(netease.url, undefined);
  assert.equal(netease.cookie, undefined);
  const qq = normalizeQqTrack({ songmid: '001ABC123', songname: '海', singer: [{ name: '歌手' }], albummid: '002Album', interval: 201 });
  assert.equal(qq.provider, 'qq');
  assert.equal(qq.duration, 201);
  assert.equal(qq.externalUrl, 'https://y.qq.com/n/ryqq/songDetail/001ABC123');
  assert.equal(qq.cover, 'https://y.gtimg.cn/music/photo_new/T002R300x300M000002Album.jpg');
  assert.equal(normalizeQqTrack({ songmid: '../bad', songname: 'x' }), null);
  assert.equal(normalizeNeteaseTrack({ id: 'abc', name: 'x' }), null);
  assert.equal(normalizeNeteaseTrack({ id: '1', name: '' }), null);
  assert.equal(normalizeNeteaseTrack({ id: 1, name: 'x', album: { picUrl: 'https://music.126.net.evil.example/image' } }).cover, null);
  assert.equal(normalizeNeteaseTrack({ id: 1, name: 'x', album: { picUrl: 'https://user:pass@music.126.net/image' } }).cover, null);
  assert.equal(normalizeQqTrack({ songmid: '123', songname: 'x', albummid: '../bad' }).cover, null);
});

test('public search validates keywords and bounds requested pages', () => {
  assert.throws(() => searchParams({ query: ' '.repeat(3) }), error => error.status === 400);
  assert.throws(() => searchParams({ query: 'x'.repeat(101) }), /100/);
  assert.throws(() => searchParams({ query: 'x\u0000y' }), error => error.code === 'invalid-query');
  assert.deepEqual(searchParams({ query: ' 星光 ', limit: 1000, offset: Infinity }), { query: '星光', limit: 30, offset: 0 });
  assert.deepEqual(searchParams({ query: '海', limit: 0.1, offset: 999999 }), { query: '海', limit: 1, offset: 900 });
});

test('Netease search uses a fixed upstream, filters malformed rows and paginates', async () => {
  const calls = [];
  const provider = createPublicSearchProvider('netease', { fetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ code: 200, result: { songCount: 50, songs: [
      { id: 1, name: '第一首' }, { id: '../bad', name: 'bad' }, { id: 1, name: '重复' },
    ] } });
  } });
  const data = await provider.search({ query: '周杰伦', limit: 3, offset: 3, url: 'http://127.0.0.1/private' });
  assert.equal(calls[0].url, 'https://music.163.com/api/search/get/web');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(new URLSearchParams(calls[0].options.body).get('s'), '周杰伦');
  assert.equal(new URLSearchParams(calls[0].options.body).get('offset'), '3');
  assert.equal(data.items.length, 1);
  assert.equal(data.hasMore, true);
  assert.equal(data.nextOffset, 6);
});

test('QQ search encodes keywords and handles nonaligned offsets without duplicate pages', async () => {
  const pages = [];
  const provider = createPublicSearchProvider('qq', { fetch: async value => {
    const url = new URL(value), page = Number(url.searchParams.get('p'));
    assert.equal(url.origin, 'https://c.y.qq.com');
    assert.equal(url.searchParams.get('w'), '星 & 海');
    pages.push(page);
    const list = Array.from({ length: 3 }, (_, i) => ({ songmid: String((page - 1) * 3 + i + 1), songname: '歌曲' }));
    return Response.json({ code: 0, data: { song: { list, totalnum: 10 } } });
  } });
  const data = await provider.search({ query: '星 & 海', limit: 3, offset: 1 });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(data.items.map(item => item.mediaId), ['2', '3', '4']);
  assert.equal(data.nextOffset, 4);
  assert.equal(data.hasMore, true);
});

test('Kugou returns metadata and first-party links from unsigned public search', async () => {
  const calls = [];
  const provider = createPublicSearchProvider('kugou', { fetch: async (value, options) => {
    const url = new URL(value);
    const page = Number(url.searchParams.get('page'));
    assert.equal(url.origin + url.pathname, 'https://songsearch.kugou.com/song_search_v2');
    assert.equal(url.searchParams.get('keyword'), '海 & 天');
    assert.equal(url.searchParams.get('pagesize'), '2');
    assert.equal(url.searchParams.get('platform'), 'WebFilter');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    calls.push(page);
    const lists = Array.from({ length: 2 }, (_, index) => ({
      MixSongID: String(2 * (page - 1) + index + 1),
      SongName: '<em>海</em> & 天', SingerName: '歌手', AlbumName: '专辑', Duration: 195,
      Image: 'http://imge.kugou.com/stdmusic/{size}/album.jpg',
      EMixSongID: index ? 'abcd1234' : 'bad/path',
      FileHash: 'must-not-be-exposed',
    }));
    return Response.json({ status: 1, data: { lists, total: 4 } });
  } });
  const data = await provider.search({ query: '海 & 天', limit: 2, offset: 1 });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(data.nextOffset, 3);
  assert.equal(data.hasMore, true);
  assert.deepEqual(data.items[0], {
    provider: 'kugou', mediaId: '2', name: '海 & 天', artist: '歌手', album: '专辑', duration: 195,
    cover: 'https://imge.kugou.com/stdmusic/400/album.jpg',
    externalUrl: 'https://www.kugou.com/mixsong/abcd1234.html',
    linkedOnly: true,
  });
  const searchUrl = new URL(data.items[1].externalUrl);
  assert.equal(searchUrl.origin + searchUrl.pathname, 'https://www.kugou.com/yy/html/search.html');
  assert.equal(new URLSearchParams(searchUrl.hash.slice(1)).get('searchKeyWord'), '海 & 天 歌手');
  assert.equal(normalizeKugouTrack({ ID: '../../x', SongName: '歌曲' }), null);
  assert.equal(normalizeKugouTrack({ ID: 1, SongName: '歌曲', Image: 'https://imge.kugou.com.evil.example/image' }).cover, null);
});

test('Netease supplies page artwork in one optional metadata request and survives cover failure', async () => {
  for (const failCover of [false, true]) {
    const calls = [];
    const provider = createPublicSearchProvider('netease', { fetch: async url => {
      calls.push(url);
      if (url.includes('/api/song/detail')) {
        assert.deepEqual(JSON.parse(new URL(url).searchParams.get('ids')), ['1', '2']);
        if (failCover) throw new Error('Cover service offline');
        return Response.json({ code: 200, songs: [
          { id: 1, name: '一', album: { picUrl: 'https://p1.music.126.net/one.jpg' } },
          { id: 2, name: '二', album: { picUrl: 'https://evil.example/two.jpg' } },
        ] });
      }
      return Response.json({ code: 200, result: { songCount: 2, songs: [{ id: 1, name: '一' }, { id: 2, name: '二' }] } });
    } });
    const data = await provider.search({ query: '星空' });
    assert.equal(calls.length, 2);
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].cover, failCover ? null : 'https://p1.music.126.net/one.jpg');
    assert.equal(data.items[1].cover, null);
  }
});

test('upstream failures and stalled responses produce actionable bounded errors', async () => {
  for (const response of [new Response('down', { status: 503 }), new Response('not json'), Response.json({ code: 403 })]) {
    const provider = createPublicSearchProvider('netease', { fetch: async () => response });
    await assert.rejects(provider.search({ query: '星光' }), error => error.status === 502 && /^upstream-/.test(error.code));
  }
  const qq = createPublicSearchProvider('qq', { fetch: async () => Response.json({ code: 0, data: { song: { list: 'bad' } } }) });
  await assert.rejects(qq.search({ query: '海' }), error => error.code === 'upstream-invalid-response');
  const hanging = createPublicSearchProvider('qq', { fetch: () => new Promise(() => {}), searchTimeoutMs: 50 });
  await assert.rejects(hanging.search({ query: '海' }), error => error.status === 504 && /重试/.test(error.message));
  const hangingBody = createPublicSearchProvider('netease', {
    fetch: async () => ({ ok: true, headers: new Headers(), text: () => new Promise(() => {}) }), searchTimeoutMs: 50,
  });
  await assert.rejects(hangingBody.search({ query: '海' }), error => error.code === 'upstream-timeout');
});

test('server exposes public searches and truthful capabilities even without Qishui', async t => {
  const http = require('node:http');
  const { createAppServer } = require('../companion/server.cjs');
  const inputs = [];
  const providers = new Map(['netease', 'kugou'].map(provider => [provider, { search: async input => {
    inputs.push(input);
    return { items: [{ provider, mediaId: '1' }], hasMore: false, nextOffset: 20 };
  } }]));
  const app = createAppServer({ providers, discoveryFetch: async () => Response.json({ feed: { results: [] } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const request = (path, method = 'GET', body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path, method, headers: { Host: '127.0.0.1:8765', 'Content-Type': 'application/json' } }, response => {
      let source = '';
      response.on('data', chunk => source += chunk);
      response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(source) }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const health = await request('/health');
  assert.equal(health.data.musicApiVersion, 2);
  assert.deepEqual(health.data.providers, ['netease', 'kugou']);
  const capabilities = (await request('/api/providers')).data.items;
  assert.equal(capabilities.find(item => item.id === 'qishui').available, false);
  assert.equal(capabilities.find(item => item.id === 'netease').playback, 'external');
  assert.equal(capabilities.find(item => item.id === 'kugou').available, true);
  assert.equal(capabilities.find(item => item.id === 'kugou').playback, 'external');
  const search = await request('/api/netease/search', 'POST', { query: '星光' });
  assert.equal(search.status, 200);
  assert.equal(search.data.items[0].mediaId, '1');
  const kugouSearch = await request('/api/kugou/search', 'POST', { query: '海阔天空' });
  assert.equal(kugouSearch.status, 200);
  assert.equal(kugouSearch.data.items[0].provider, 'kugou');
  assert.deepEqual(inputs, [{ query: '星光' }, { query: '海阔天空' }]);
  assert.equal((await request('/api/netease/search')).status, 405);
  assert.equal((await request('/api/qq/search', 'POST', { query: '星光' })).status, 503);
  assert.equal((await request('/api/qq/audio', 'POST', {})).status, 405);
  assert.equal((await request('/api/discovery/charts?country=cn')).data.provider, 'apple');
  assert.equal((await request('/api/discovery/charts', 'POST')).status, 405);
});

test('cover errors, body limits and timeouts leave the music service running', { timeout:5000 }, async t => {
  const http = require('node:http');
  const { once } = require('node:events');
  const { createAppServer } = require('../companion/server.cjs');
  const art = Buffer.from([1, 2, 3]);
  let oversizedCancelled = false;
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    const { hostname, pathname } = new URL(url);
    assert.equal(hostname, 'assets.douyinpic.com');
    if (pathname === '/2.png') return new Response(null, { status:302, headers:{ Location:'/image.png' } });
    if (pathname === '/image.png') return new Response(art, { headers:{ 'Content-Type':'image/png' } });
    if (pathname === '/3.png') {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once:true });
      });
    }
    assert.equal(pathname, '/4.png');
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { oversizedCancelled = true; },
    });
    return new Response(body, { headers:{ 'Content-Type':'image/png' } });
  });
  const providers = new Map([['qishui', {
    cover: async id => ({
      url:id === '1' ? 'https://cover.example.invalid/art.png' : `https://assets.douyinpic.com/${id}.png`,
    }),
  }]]);
  const { server } = createAppServer({ providers, coverTimeoutMs:150 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const get = endpoint => new Promise((resolve, reject) => {
    const request = http.get({
      hostname:'127.0.0.1', port:server.address().port, path:endpoint,
      headers:{ Host:'127.0.0.1:8765' },
    }, async response => {
      try {
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const type = response.headers['content-type'];
        resolve({ status:response.statusCode, type, body:type.startsWith('application/json') ? JSON.parse(bytes.toString()) : bytes });
      } catch (error) { reject(error); }
    });
    request.setTimeout(1000, () => request.destroy(new Error('Companion did not respond')));
    request.once('error', reject);
  });
  assert.equal((await get('/api/qishui/tracks/1/cover')).status, 502);
  assert.deepEqual(await get('/api/qishui/tracks/2/cover'), { status:200, type:'image/png', body:art });
  assert.equal((await get('/api/qishui/tracks/3/cover')).status, 504);
  assert.equal((await get('/api/qishui/tracks/4/cover')).status, 502);
  assert.equal(oversizedCancelled, true);
  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok:true, companion:true, musicApiVersion:2, providers:['qishui'] });
});

test('audio proxy forwards ranges and bounds stalled or abandoned upstream requests', { timeout:10000 }, async t => {
  const http = require('node:http');
  const { once } = require('node:events');
  const { createAppServer } = require('../companion/server.cjs');
  let onUpstreamClose;
  const upstream = http.createServer((request, response) => {
    if (request.url === '/1') {
      assert.equal(request.headers.range, 'bytes=1-3');
      response.writeHead(206, { 'content-range':'bytes 1-3/5', 'content-type':'audio/mpeg' });
      response.end('abc');
    } else if (request.url === '/2') {
      response.writeHead(416, { 'content-range':'bytes */5' }).end();
    } else {
      if (request.url !== '/3') response.writeHead(200, { 'content-type':'audio/mpeg' }).write('a');
      response.once('close', () => onUpstreamClose?.(request.url));
    }
  });
  const listen = async server => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    }));
    return server.address().port;
  };
  const upstreamPort = await listen(upstream);
  const app = createAppServer({
    mediaTimeoutMs:250,
    providers:new Map([['qishui', { audio:async id => ({
      mediaUrl:`http://127.0.0.1:${upstreamPort}/${id}`,
    }) }]]),
  });
  const port = await listen(app.server);
  const request = (path, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
    const client = http.request({ host:'127.0.0.1', port, path, method,
      headers:{ Host:'127.0.0.1:8765', ...headers } }, resolve);
    client.once('error', reject);
    client.end();
  });
  const body = async response => {
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    return Buffer.concat(chunks).toString();
  };
  const ticket = async id => JSON.parse(await body(await request(`/api/qishui/tracks/${id}/audio`, 'POST'))).streamPath;

  const partial = await request(await ticket(1), 'GET', { Range:'bytes=1-3' });
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.headers['content-range'], 'bytes 1-3/5');
  assert.equal(await body(partial), 'abc');
  const invalid = await request(await ticket(2), 'GET', { Range:'bytes=99-' });
  assert.equal(invalid.statusCode, 416);
  assert.equal(invalid.headers['content-range'], 'bytes */5');
  await body(invalid);

  let closed = new Promise(resolve => onUpstreamClose = resolve);
  const timeout = await request(await ticket(3));
  assert.equal(timeout.statusCode, 504);
  assert.equal(JSON.parse(await body(timeout)).code, 'timeout');
  assert.equal(await closed, '/3');

  closed = new Promise(resolve => onUpstreamClose = resolve);
  const stalled = await request(await ticket(4));
  assert.equal(stalled.statusCode, 200);
  await assert.rejects(body(stalled), /aborted|reset/i);
  assert.equal(await closed, '/4');

  closed = new Promise(resolve => onUpstreamClose = resolve);
  const abandoned = await request(await ticket(5));
  abandoned.destroy();
  assert.equal(await closed, '/5');
});
