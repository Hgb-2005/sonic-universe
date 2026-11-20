'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { enrichLocalTrack } = require('../outputs/track-enrichment.js');
const { parse } = require('../outputs/lyric-karaoke.js');
const { matchChartSong } = require('../companion/providers/chart-playback.cjs');

const track = Object.freeze({ id: 'local-1', kind: 'file', name: '夜航（录音室）', artist: '甲 & 乙', duration: 180.4 });
const candidate = Object.freeze({
  provider: 'qishui', mediaId: '231', name: '夜航(录音室)', artist: '甲、乙',
  duration: 180, album: '第一张专辑', cover: 'https://p3-luna.douyinpic.com/img/night.jpg',
});
const timed = '[00:12.00]<00:12.00>夜<00:12.40>航';
const plain = '[00:12.00]夜航';
const fakeClient = (overrides = {}) => ({
  loginStatus: async () => ({ authenticated: true }),
  matchChartTrack: async () => ({ item: candidate }),
  lyrics: async () => ({ timedLrc: timed, lrc: plain }),
  ...overrides,
});

test('returns suggestions and timed lyrics without touching established local fields or requesting audio', async () => {
  const calls = [];
  const client = fakeClient({
    loginStatus: async () => { calls.push('status'); return { authenticated: true }; },
    matchChartTrack: async input => {
      assert.deepEqual(input, { name: track.name, artist: track.artist });
      calls.push('match');
      return { item: candidate };
    },
    lyrics: async id => {
      assert.equal(id, candidate.mediaId);
      calls.push('lyrics');
      return { timedLrc: timed, lrc: plain };
    },
    audio: () => assert.fail('A metadata request must not resolve an audio stream'),
  });
  assert.deepEqual(await enrichLocalTrack(track, { client }), {
    status: 'matched', source: 'qishui', mediaId: '231', name: track.name, artist: track.artist, inferred: false,
    album: candidate.album, cover: candidate.cover, lyricsRaw: timed, lyricsStatus: 'available',
  });
  assert.deepEqual(calls, ['status', 'match', 'lyrics']);

  const edited = { ...track, album: candidate.album, cover: 'data:image/png;base64,fixture' };
  const result = await enrichLocalTrack(edited, { client, includeLyrics: false });
  assert.equal(result.album, '');
  assert.equal(result.cover, null);
  assert.equal(result.lyricsStatus, 'skipped');
  assert.equal(edited.cover, 'data:image/png;base64,fixture');
  assert.equal(calls.filter(value => value === 'lyrics').length, 1);
});

test('infers one explicit artist-title filename split only for an untagged title', async () => {
  const basename = '甲 & 乙 - 夜航（录音室）';
  const inferred = { ...track, name: basename, artist: '', sourcePath: 'Album\\' + basename + '.flac' };
  const result = await enrichLocalTrack(inferred, { client: fakeClient({
    matchChartTrack: async input => {
      assert.deepEqual(input, { name: track.name, artist: track.artist });
      return { item: candidate };
    },
  }) });
  assert.equal(result.status, 'matched');
  assert.equal(result.inferred, true);
  assert.equal(result.name, track.name);
  assert.equal(result.artist, track.artist);

  const unused = fakeClient({ loginStatus: () => assert.fail('Insufficient local identity reached the network') });
  for (const local of [
    { ...inferred, sourcePath: 'other.flac' },
    { ...inferred, sourcePath: '' },
    { ...inferred, name: '甲 - 乙 - 歌', sourcePath: '甲 - 乙 - 歌.flac' },
    { ...inferred, name: '甲-歌', sourcePath: '甲-歌.flac' },
    { ...track, kind: 'online' },
    { ...track, duration: Infinity },
    { ...track, duration: 0 },
  ]) assert.deepEqual(await enrichLocalTrack(local, { client: unused }), { status: 'insufficient' });
});

test('rejects a different recording, mismatched album, ambiguity and incomplete paginated matches', async () => {
  for (const item of [
    null,
    { ...candidate, duration: 177.8 },
    { ...candidate, duration: 0 },
    { ...candidate, name: '夜航（现场）' },
    { ...candidate, artist: '乙、甲' },
    { ...candidate, provider: 'qq' },
    { ...candidate, mediaId: '../unsafe' },
  ]) {
    const client = fakeClient({
      matchChartTrack: async () => ({ item }),
      lyrics: () => assert.fail('Lyrics must not be queried for a different recording'),
    });
    assert.deepEqual(await enrichLocalTrack(track, { client }), { status: 'no-match' });
  }
  const wrongAlbum = await enrichLocalTrack({ ...track, album: '原声带' }, { client: fakeClient() });
  assert.equal(wrongAlbum.status, 'no-match');

  for (const search of [
    async () => ({ items: [candidate, { ...candidate, mediaId: '232' }], hasMore: false }),
    async ({ offset, limit }) => ({ items: [candidate], hasMore: true, nextOffset: offset + limit }),
  ]) {
    const client = fakeClient({ matchChartTrack: input => matchChartSong(search, input) });
    assert.deepEqual(await enrichLocalTrack(track, { client }), { status: 'no-match' });
  }
});

test('only accepts provider cover hosts and valid LRC within the recording', async () => {
  const client = fakeClient({
    matchChartTrack: async () => ({ item: { ...candidate, cover: 'https://douyinpic.com.evil.example/cover' } }),
    lyrics: async () => ({ timedLrc: '[05:00.00]过长', lrc: plain }),
  });
  const result = await enrichLocalTrack(track, { client });
  assert.equal(result.cover, null);
  assert.equal(result.lyricsRaw, plain);

  const invalid = await enrichLocalTrack(track, { client: fakeClient({ lyrics: async () => ({ lrc: '没有时间点' }) }) });
  assert.equal(invalid.lyricsStatus, 'not-found');
  const unavailable = await enrichLocalTrack(track, { client: fakeClient({ lyrics: async () => { throw new Error('upstream'); } }) });
  assert.equal(unavailable.status, 'matched');
  assert.equal(unavailable.lyricsStatus, 'unavailable');
});

test('prefers plaintext KRC and retains duration and multi-character groups after saving', async () => {
  const krc = '[14690,900]<0,310,0>这段<480,420,0>故事';
  const client = fakeClient({ lyrics: async () => ({ krc, timedLrc: timed, lrc: plain }) });
  const suggestion = await enrichLocalTrack(track, { client });
  assert.equal(suggestion.lyricsStatus, 'available');
  assert.equal(suggestion.lyricsRaw, krc);
  const [line] = parse(suggestion.lyricsRaw);
  assert.equal(line.text, '这段故事');
  assert.deepEqual(line.points, [{ index: 0, time: 14.69, end: 15 }, { index: 2, time: 15.17, end: 15.59 }]);
});

test('falls back to timed LRC when KRC is encrypted, markless or outside the recording', async () => {
  const line = '[14690,900]<0,310,0>这段<480,420,0>故事';
  for (const krc of [
    'krc1\n' + line,
    '\x00\n' + line,
    '[14690,900]这段故事',
    '[200000,900]<0,310,0>太迟',
    '[14690,900]<0,0,0>零时长',
    '[14690,900]<900,310,0>在本行结束后',
  ]) {
    const client = fakeClient({ lyrics: async () => ({ krc, timedLrc: timed }) });
    assert.equal((await enrichLocalTrack(track, { client })).lyricsRaw, timed);
  }
});

test('requires a signed-in session and handles expiry without sending further requests', async () => {
  const noMatchCall = fakeClient({
    loginStatus: async () => ({ authenticated: false }),
    matchChartTrack: () => assert.fail('Song details were sent without authorization'),
  });
  assert.deepEqual(await enrichLocalTrack(track, { client: noMatchCall }), { status: 'unauthenticated' });

  const expired = Object.assign(new Error('Please sign in'), { status: 401, code: 'auth-required' });
  for (const method of ['loginStatus', 'matchChartTrack', 'lyrics']) {
    const client = fakeClient({ [method]: async () => { throw expired; } });
    assert.deepEqual(await enrichLocalTrack(track, { client }), { status: 'unauthenticated' });
  }

  const controller = new AbortController();
  const client = fakeClient({
    matchChartTrack: async () => { controller.abort(); return { item: candidate }; },
    lyrics: () => assert.fail('An aborted completion reached the lyrics service'),
  });
  await assert.rejects(enrichLocalTrack(track, { client, signal: controller.signal }), { name: 'AbortError' });
});
