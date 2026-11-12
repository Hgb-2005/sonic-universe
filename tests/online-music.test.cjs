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
  await assert.rejects(client.search('test'), error => error.code === 'timeout' && /重新连接/.test(error.message));
});
