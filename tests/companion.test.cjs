'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  krcToLrc,
  loginQrKey,
  normalizeTrack,
  normalizePlaylist
} = require('../companion/providers/qishui.cjs');
const { parseRange, corsHeaders } = require('../companion/server.cjs');

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
});

test('normalizes playlist fields and parses range headers', () => {
  const playlist = normalizePlaylist({ base_info: { id: '8', name: '夜航', track_count: 4 }, playlist: {} });
  assert.equal(playlist.trackCount, 4);
  assert.deepEqual(parseRange('bytes=2-9', 20), { start: 2, end: 9 });
  assert.deepEqual(parseRange('bytes=-5', 20), { start: 15, end: 19 });
  assert.deepEqual(parseRange('bytes=20-30', 20), { invalid: true });
});

test('allows only the local origin for cross-origin requests', () => {
  assert.equal(corsHeaders('http://127.0.0.1:8765', 8765)['Access-Control-Allow-Origin'], 'http://127.0.0.1:8765');
  assert.deepEqual(corsHeaders('https://example.com', 8765), {});
});
