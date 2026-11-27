'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { matchChartSong } = require('../companion/providers/chart-playback.cjs');

const track = (mediaId, name, artist, provider = 'qishui') => ({ provider, mediaId, name, artist });

test('chart matching keeps the Qishui track and only normalizes equivalent titles and credits', async () => {
  const expected = { ...track('22', 'ＤＥＥＰ Sea（录音室）', '甲、乙'), cover: null, duration: 126 };
  const result = await matchChartSong(async input => {
    assert.deepEqual(input, { query: 'Deep Sea(录音室) 甲 & 乙', limit: 20, offset: 0 });
    return { items: [
      track('1', 'Deep Sea', '甲、乙'),
      track('2', 'Deep Sea(录音室)', '甲'),
      track('3', 'Deep Sea(录音室)', '乙、甲'),
      track('4', 'Deep Sea(录音室)', '甲、乙', 'apple'),
      expected,
    ], hasMore: false };
  }, { name: 'Deep    Sea（录音室）', artist: ' 甲 & 乙 ' });
  assert.deepEqual(result, { item: expected });
});

test('equivalent Chinese spellings and artist labels do not merge different recordings', async () => {
  const expected = { ...track('12', '唯一', 'G.E.M. 鄧紫棋'), album: '啓示錄', duration: 253.74 };
  const input = { name: '唯一', artist: '邓紫棋', album: '启示录', duration: 254, includeCandidates: true };
  const other = [
    { ...expected, mediaId: '1', name: '唯一 (Live)' },
    { ...expected, mediaId: '2', artist: 'G.E.M. 鄧紫棋、其他艺人' },
    { ...expected, mediaId: '3', duration: 60 },
  ];
  assert.deepEqual(await matchChartSong(async () => ({ items: [...other, expected] }), input), {
    item: expected, reason: 'matched', candidates: [expected, other[2]],
  });
  const hongKong = track('41', 'Hong Kong (feat. 王菲季候风）', 'The Weeknd');
  assert.deepEqual(await matchChartSong(async () => ({ items: [hongKong] }), {
    name: 'Hong Kong (feat. 王菲季候風)', artist: 'The Weeknd',
  }), { item: hongKong });
});

test('chart matching rejects wrong versions, wrong artists and distinct same-credit recordings', async () => {
  const input = { name: '一首歌', artist: '歌手' };
  const match = items => matchChartSong(async () => ({ items, hasMore: false }), input);
  assert.deepEqual(await match([track('1', '一首歌 (Live)', '歌手'), track('2', '一首歌', '其他歌手')]), { item: null });
  assert.deepEqual(await match([track('1', '一首歌', '歌手'), track('2', '一首歌', '歌手')]), { item: null });
});

test('chart matching uses album and duration before deciding which same-credit recording matches', async () => {
  const input = { name: '一首歌', artist: '歌手', album: 'Ａ  Album', duration: 190 };
  const wrongDuration = { ...track('1', '一首歌', '歌手'), album: 'A Album', duration: 192.01 };
  const wrongAlbum = { ...track('2', '一首歌', '歌手'), album: '另一张专辑', duration: 190 };
  const missing = track('3', '一首歌', '歌手');
  const expected = { ...track('4', '一首歌', '歌手'), album: 'a album', duration: 192 };
  const pages = [
    { items: [wrongDuration, wrongAlbum, track('5', '一首歌 (Live)', '歌手')], hasMore: true, nextOffset: 20 },
    { items: [missing, expected, track('6', '一首歌', '其他歌手'), expected] },
  ];
  const search = async ({ offset }) => pages[offset / 20];
  assert.deepEqual(await matchChartSong(search, input), { item: expected });
  assert.deepEqual(await matchChartSong(search, { ...input, includeCandidates: true }), {
    item: expected, reason: 'matched', candidates: [expected, missing, wrongDuration, wrongAlbum],
  });
});

test('chart matching exposes ambiguity and keeps incomplete metadata out of automatic playback', async () => {
  const input = { name: '一首歌', artist: '歌手', album: '专辑', duration: 190, includeCandidates: true };
  const candidate = { ...track('1', '一首歌', '歌手'), album: '专辑', duration: 190 };
  const tied = { ...candidate, mediaId: '2' };
  const noAlbum = { ...candidate, mediaId: '3', album: '' };
  const noDuration = { ...candidate, mediaId: '4', duration: 0 };
  const wrongAlbum = { ...candidate, mediaId: '5', album: '其他专辑' };
  const match = (items, hints = input) => matchChartSong(async () => ({ items }), hints);
  assert.deepEqual(await match([noAlbum, candidate, tied]), {
    item: null, reason: 'ambiguous', candidates: [candidate, tied, noAlbum],
  });
  assert.deepEqual(await match([wrongAlbum, noAlbum, noDuration]), {
    item: null, reason: 'no-match', candidates: [noAlbum, noDuration, wrongAlbum],
  });
  assert.deepEqual(await match([noAlbum, candidate], { ...input, album: '' }), {
    item: null, reason: 'ambiguous', candidates: [noAlbum, candidate],
  });
  assert.deepEqual(await match([noDuration], { ...input, duration: 0 }), {
    item: noDuration, reason: 'matched', candidates: [noDuration],
  });
});

test('chart matching inspects bounded pagination, tolerates repeated IDs and fails closed on incomplete pages', async () => {
  const input = { name: '一首歌', artist: '歌手' };
  const song = track('12', '一首歌', '歌手');
  const offsets = [];
  const result = await matchChartSong(async ({ offset }) => {
    offsets.push(offset);
    return offset === 0 ? { items: [song], hasMore: true, nextOffset: 20 } : { items: [song] };
  }, input);
  assert.deepEqual(offsets, [0, 20]);
  assert.deepEqual(result, { item: song });

  const ambiguous = await matchChartSong(async ({ offset }) => offset === 0
    ? { items: [song], hasMore: true, nextOffset: 20 }
    : { items: [track('13', '一首歌', '歌手')] }, input);
  assert.deepEqual(ambiguous, { item: null });

  const stalled = await matchChartSong(async () => ({ items: [song], hasMore: true, nextOffset: 0 }), input);
  assert.deepEqual(stalled, { item: null });
  const incomplete = await matchChartSong(async ({ offset, limit }) => ({ items: [song], hasMore: true, nextOffset: offset + limit }), input);
  assert.deepEqual(incomplete, { item: null });
});

test('detailed chart matching caps deduplicated manual candidates and reports incomplete paging', async () => {
  const input = { name: '一首歌', artist: '歌手', includeCandidates: true };
  const candidates = Array.from({ length: 16 }, (_, index) => track(String(index + 1), input.name, input.artist));
  const offsets = [];
  const incomplete = await matchChartSong(async ({ offset, limit }) => {
    offsets.push(offset);
    return { items: [track('100', '一首歌（翻唱）', '歌手'), ...candidates], hasMore: true, nextOffset: offset + limit };
  }, input);
  assert.deepEqual(offsets, [0, 20, 40]);
  assert.deepEqual(incomplete, { item: null, reason: 'incomplete', candidates: candidates.slice(0, 15) });
});

test('chart matching rejects malformed input before any search and reports invalid service responses', async () => {
  const shouldNotRun = () => assert.fail('Invalid text reached the catalogue');
  for (const input of [null, { name: '歌曲' }, { name: '歌\n曲', artist: '歌手' }, { name: '啊'.repeat(241), artist: '歌手' }]) {
    await assert.rejects(matchChartSong(shouldNotRun, input), { status: 400, code: 'invalid-chart-song' });
  }
  await assert.rejects(matchChartSong(shouldNotRun, { name: '歌曲', artist: '歌手', duration: '190' }),
    { status: 400, code: 'invalid-chart-song' });
  await assert.rejects(matchChartSong(shouldNotRun, { name: '歌曲', artist: '歌手', album: {} }),
    { status: 400, code: 'invalid-chart-song' });
  await assert.rejects(matchChartSong(async () => null, { name: '歌', artist: '人' }), { status: 502, code: 'upstream-invalid-response' });
});

test('Companion exposes chart matching as a POST and returns the selected catalogue track', async t => {
  const { createAppServer } = require('../companion/server.cjs');
  const providers = new Map();
  const app = createAppServer({ providers });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));

  function request(method, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: app.server.address().port,
        path: '/api/discovery/charts/match', method,
        headers: { Host: '127.0.0.1:8765', 'Content-Type': 'application/json' },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  const candidate = { ...track('12', '一首歌', '歌手'), duration: 190 };
  assert.equal((await request('GET')).status, 405);
  assert.equal((await request('POST', { name: '一首歌', artist: '歌手' })).status, 503);
  providers.set('qishui', { search: async () => ({ items: [candidate] }) });
  assert.deepEqual(await request('POST', { name: '一首歌', artist: '歌手' }), { status: 200, data: { item: candidate } });
  assert.deepEqual(await request('POST', { name: '一首歌', artist: '歌手', duration: 190, includeCandidates: true }), {
    status: 200, data: { item: candidate, reason: 'matched', candidates: [candidate] },
  });
  assert.deepEqual(await request('POST', { name: '一首歌', artist: '陌生歌手' }), { status: 200, data: { item: null } });
  assert.equal((await request('POST', { name: '一首歌' })).status, 400);
});
