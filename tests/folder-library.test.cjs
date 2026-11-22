'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { reconcile } = require('../outputs/folder-library.js');

function track(sourcePath, contents, sourceFolder = 'original') {
  return { kind: 'file', sourcePath, sourceFolder, blob: new Blob([contents]) };
}

test('folder relocation matches the original relative path and verifies the complete audio', async () => {
  const prefix = new Uint8Array(1024 * 1024);
  const original = track('Original/Disc 1/Song.wav', new Blob([prefix, 'a']));
  const other = track('Original/Disc 2/Song.wav', new Blob([prefix, 'a']));
  const same = new Blob([prefix, 'a']);
  const changed = new Blob([prefix, 'b']);
  const path = 'Renamed/Disc 1/Song.wav';
  const scan = reconcile([original, other], 'new', [same], () => path);

  assert.deepEqual(await scan.match(same, path), { track: original, unchanged: true, relinked: true });
  assert.deepEqual(await scan.match(changed, path), { track: null, unchanged: false });
  assert.deepEqual(scan.removed(), []);
});

test('a known path keeps its record for changed audio and keeps same-named subfolders separate', async () => {
  const original = track('Root/Disc 1/Song.wav', 'old bytes');
  const removed = track('Root/Older.wav', 'old copy');
  const same = new Blob(['old bytes']);
  const changed = new Blob(['new bytes']);
  const path = 'Root/Disc 1/Song.wav';
  const scan = reconcile([original, removed], 'original', [changed], () => path);

  assert.deepEqual(await scan.match(changed, path), { track: original, unchanged: false });
  assert.deepEqual(await scan.match(same, 'Root/Disc 2/Song.wav'), { track: null, unchanged: false });
  assert.deepEqual(scan.removed(), [removed]);
});

test('folder import leaves ambiguous matches and individual import deduplicates by bytes', async () => {
  const first = track('First/Song.wav', 'recording', 'first');
  const second = track('Second/Song.wav', 'recording', 'second');
  const same = new Blob(['recording']);
  const different = new Blob(['different']);
  const scan = reconcile([first, second], 'third', [same], () => 'Third/Song.wav');
  assert.deepEqual(await scan.match(same, 'Third/Song.wav'), { ambiguous: true });

  const individual = reconcile([first], null, [same], () => 'Song.wav');
  assert.deepEqual(await individual.match(same, 'Song.wav'), { track: first, unchanged: true });
  assert.deepEqual(await individual.match(different, 'Song.wav'), { track: null, unchanged: false });
  const ambiguous = reconcile([first, second], null, [same], () => 'Song.wav');
  assert.deepEqual(await ambiguous.match(same, 'Song.wav'), { ambiguous: true });
});

test('a unique track moved to another subfolder keeps its identity and source availability', async () => {
  const original = track('Root/Old/Song.wav', 'recording');
  const file = new Blob(['recording']);
  const path = 'Root/New/Song.wav';
  const scan = reconcile([original], 'original', [file], () => path);
  assert.deepEqual(await scan.match(file, path), { track: original, unchanged: true, relinked: true });
  original.sourcePath = path;
  scan.remember(original);
  assert.deepEqual(scan.removed(), []);
});

test('individual imports can match older records that only carry a fingerprint', async () => {
  const original = {...track('', 'recording', null), signature: 'Song.wav|9|1234'};
  const file = new Blob(['recording']);
  const scan = reconcile([original], null, [file], () => 'Song.wav');
  assert.deepEqual(await scan.match(file, 'Song.wav'), { track: original, unchanged: true });
});
