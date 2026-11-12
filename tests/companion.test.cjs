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
