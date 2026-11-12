'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const online = require('../outputs/online-music.js');

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
