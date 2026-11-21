'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { enrichLocalTrack, resolveTimedLyrics } = require('../outputs/track-enrichment.js');
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
      assert.deepEqual(input, { name: track.name, artist: track.artist, duration:track.duration,
        ...(calls.includes('match')?{album:candidate.album}:{}) });
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
      assert.deepEqual(input, { name: track.name, artist: track.artist, duration:track.duration });
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

test('recognizes YRC and QRC in a KRC field and prefers explicit word timing', () => {
  const yrc = '[14690,900](14690,310,0)这段(15170,420,0)故事';
  const qrc = '[14690,900]这段(14690,310)故事(15170,420)';
  for (const raw of [yrc, qrc]) {
    const result = resolveTimedLyrics({ krc: raw, timedLrc: plain, lrc: timed }, 180);
    assert.equal(result.raw, raw);
    assert.equal(result.timing, 'word');
    assert.equal(result.lines[0].text, '这段故事');
    assert.deepEqual(result.lines[0].points, [
      { index: 0, time: 14.69, end: 15 },
      { index: 2, time: 15.17, end: 15.59 },
    ]);
  }
  assert.equal(resolveTimedLyrics({ timedLrc: plain, lrc: timed }, 180).raw, timed);
});

test('validates generic timed subtitles and keeps markup out of the rendered text', () => {
  const vtt = 'WEBVTT\n\n00:14.690 --> 00:15.590\n<b>这段</b><00:15.170>故事';
  const ttml = '<tt><body><p begin="1s" end="2s"><span begin="0s" end="0.5s">故</span><span begin="0.5s" end="1s">事</span></p></body></tt>';
  for (const [raw, text] of [[vtt, '这段故事'], [ttml, '故事']]) {
    const selected = resolveTimedLyrics({ raw, lrc: plain }, 180);
    assert.equal(selected.timing, 'word');
    assert.equal(selected.raw, raw);
    assert.equal(selected.lines[0].text, text);
    assert.equal(selected.lines[0].points.length, 2);
  }
  assert.equal(resolveTimedLyrics('WEBVTT\n\n00:01.000 --> 00:02.000\n<i>故事</i>', 10).timing, 'line');
  assert.equal(resolveTimedLyrics({ krc: '<!DOCTYPE tt [<!ENTITY example "unexpected">]>' + ttml, lrc: plain }, 180).raw, plain);
  assert.equal(resolveTimedLyrics({ timedLrc: '[00:01.00]<span>乱码</span>', lrc: plain }, 180).raw, plain);
  assert.equal(resolveTimedLyrics({ timedLrc: '[00:01.00](1000,400,0)乱码', lrc: plain }, 180).raw, plain);
  assert.equal(resolveTimedLyrics({ timedLrc: '[00:01.00]<?xml?>乱码', lrc: plain }, 180).raw, plain);
});

test('bounds timed starts and ends and rejects reversed, zero and overlong word ranges', () => {
  const overhang = '[2400,850]<0,900,0>最后';
  const valid = resolveTimedLyrics(overhang, 3);
  assert.equal(valid.timing, 'word');
  assert.equal(valid.lines[0].end, 3);
  assert.equal(valid.lines[0].points[0].end, 3);
  for (const raw of [
    '[3000,100]<0,100,0>起点不可播放',
    '[2400,1200]<0,200,0>行尾越界',
    '[2400,500]<0,9000,0>字尾越界',
    '[1000,1500]<800,100,0>后<100,100,0>退',
    '[1000,500]<0,0,0>零时长',
    '[14690,900]没有逐字点',
    'krc1\n' + overhang,
    overhang + ' '.repeat(250000),
  ]) assert.equal(resolveTimedLyrics(raw, 3), null, raw.slice(0, 60));
  assert.equal(resolveTimedLyrics({ timedLrc: '[00:02.00]<00:02.80>后<00:02.40>退', lrc: plain }, 180).raw, plain);
  assert.equal(resolveTimedLyrics({ lrc: '[12:99.00]无效秒数' }, 180), null);
  assert.equal(resolveTimedLyrics({ lrc: plain }, NaN), null);
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
