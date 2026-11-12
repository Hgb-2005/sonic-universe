'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  coverUrl,
  krcToLrc,
  loginQrKey,
  normalizeTrack,
  normalizePlaylist
} = require('../companion/providers/qishui.cjs');
const { parseRange, corsHeaders, isTrustedCoverUrl } = require('../companion/server.cjs');
const { createPublicSearchProvider, normalizeNeteaseTrack, normalizeQqTrack, searchParams } = require('../companion/providers/public-search.cjs');

test('converts KRC character timing to ordinary LRC', () => {
  const output = krcToLrc('[14690,6530]<0,210,0>故<210,200,0>事');
  assert.equal(output, '[00:14.69]故事');
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
  const providers = new Map([['netease', { search: async input => {
    inputs.push(input);
    return { items: [{ provider: 'netease', mediaId: '1' }], hasMore: false, nextOffset: 20 };
  } }]]);
  const app = createAppServer({ providers });
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
  assert.deepEqual(health.data.providers, ['netease']);
  const capabilities = (await request('/api/providers')).data.items;
  assert.equal(capabilities.find(item => item.id === 'qishui').available, false);
  assert.equal(capabilities.find(item => item.id === 'netease').playback, 'external');
  const search = await request('/api/netease/search', 'POST', { query: '星光' });
  assert.equal(search.status, 200);
  assert.equal(search.data.items[0].mediaId, '1');
  assert.deepEqual(inputs, [{ query: '星光' }]);
  assert.equal((await request('/api/netease/search')).status, 405);
  assert.equal((await request('/api/qq/search', 'POST', { query: '星光' })).status, 503);
  assert.equal((await request('/api/qq/audio', 'POST', {})).status, 405);
});
