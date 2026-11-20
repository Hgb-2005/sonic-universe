'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReport, createExternalNowPlaying } = require('../desktop/external-now-playing.cjs');
const { create, positionAt } = require('../outputs/external-now-playing.js');
const { parse } = require('../outputs/lyric-karaoke.js');

const active = 'session-12345678-1', pinned = 'session-12345678-2', self = 'session-12345678-3';
const clock = 1_795_000_000_000;
const ownExecutable = 'C:\\Users\\Example\\Private\\sonic.exe';
const data = {available:true, currentId:active, sessions:[
  {sourceId:active,sourceApp:'MSEdge',title:'First track',artist:'Singer',playing:true,rate:1.25,duration:120,position:10,updatedAt:clock-1600},
  {sourceId:pinned,sourceApp:'C:\\Users\\Example\\Private\\Player.exe',title:'Paused track',playing:false,duration:210,position:104,updatedAt:clock-1600},
  {sourceId:self,sourceApp:ownExecutable,title:'Internal playback',playing:true,duration:90,position:10},
]};

test('follows Windows by default, pins paused sessions, removes internal playback, and keeps private paths in the host', () => {
  const current = normalizeReport(data, null, clock, ownExecutable);
  assert.equal(current.title, 'First track');
  assert.equal(current.sourceApp, 'Microsoft Edge');
  assert.equal(current.position, 12);
  assert.equal(current.timestamp, clock);
  assert.equal(current.sessions.length, 2);
  assert.ok(!JSON.stringify(current).includes('Private'));
  const fixed = normalizeReport(data, pinned, clock, ownExecutable);
  assert.equal(fixed.title, 'Paused track');
  assert.equal(fixed.sourceApp, 'Player');
  assert.equal(fixed.position, 104);
});

test('an unavailable pinned player stays missing and a timeline-less stream stays live', () => {
  const absent = normalizeReport(data, 'session-01020304-9', clock, ownExecutable);
  assert.equal(absent.selectionMissing, true);
  assert.equal(absent.sourceId, null);
  const report = {...data, sessions:[{...data.sessions[0],duration:0,position:0}]};
  const result = normalizeReport(report, null, clock);
  assert.equal(result.position, null);
  assert.equal(result.duration, null);
  assert.equal(positionAt(result, clock+500), null);
});

test('timeline projection advances only during playback and clamps to the reported duration', () => {
  const playing = normalizeReport(data, null, clock);
  assert.equal(positionAt(playing, clock+800), 13);
  assert.equal(positionAt({...playing,playing:false}, clock+5000), 12);
  assert.equal(positionAt({...playing,position:119}, clock+5000), 120);
});

test('external followers read only while connected and ignore late replies after a switch or disconnect', async () => {
  let now = clock;
  const calls = [];
  const follower = create(options => new Promise(done => calls.push({done,options})), undefined, () => now);
  assert.equal(follower.poll(), null);
  follower.setActive(true);
  let first = follower.poll();
  await Promise.resolve();
  calls[0].done(normalizeReport(data, null, now));
  await first;
  assert.equal(follower.snapshot().sourceId, active);
  now += 1100;
  const old = follower.poll();
  await Promise.resolve();
  const newer = follower.select(pinned);
  await Promise.resolve();
  assert.equal(calls[2].options.sourceId, pinned);
  calls[2].done(normalizeReport(data, pinned, now));
  await newer;
  calls[1].done(normalizeReport(data, null, now));
  await old;
  assert.equal(follower.snapshot().title, 'Paused track');
  now += 4500;
  assert.equal(follower.snapshot().status, 'waiting');
  const late = follower.poll();
  await Promise.resolve();
  follower.setActive(false);
  calls[3].done(normalizeReport(data, pinned, now));
  await late;
  assert.equal(follower.snapshot(), null);
});

test('an unsupported desktop never starts the helper', async () => {
  const controller = createExternalNowPlaying({ platform:'linux', helper:'unused', spawnProcess:() => assert.fail('unexpected spawn') });
  assert.equal((await controller.query()).available, false);
});

test('opt-in external lyrics use exact track identity and clear when that session changes songs', async () => {
  let now = clock;
  let report = normalizeReport(data, null, now, ownExecutable);
  const follower = create(async () => report, undefined, () => now);
  follower.setActive(true);
  await follower.poll();
  assert.deepEqual(follower.lyrics(), []);
  const matched = await follower.loadLyrics(async (track, signal) => {
    assert.equal(track.name, 'First track');
    assert.equal(track.artist, 'Singer');
    assert.equal(track.duration, 120);
    assert.equal(signal.aborted, false);
    return '[00:03.00]First lyric\n[00:12.00]Second lyric\n[08:01.00]Outside song';
  }, parse, 'LRCLIB');
  assert.equal(matched.ok, true);
  assert.equal(follower.snapshot().lyricsSource, 'LRCLIB');
  assert.deepEqual(follower.lyrics().map(line => line.text), ['First lyric','Second lyric']);

  let finishOld, oldSignal;
  const waiting = follower.loadLyrics((_track,signal) => new Promise(resolve => { finishOld=resolve;oldSignal=signal; }), parse, '本地歌词');
  report = {...report,title:'Other song'};
  now += 1200;
  await follower.poll();
  assert.equal(oldSignal.aborted, true);
  assert.deepEqual(follower.lyrics(), []);
  finishOld('[00:03.00]Old song');
  assert.equal((await waiting).ok, false);
  assert.deepEqual(follower.lyrics(), []);
});
