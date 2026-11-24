'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const karaoke = require('../outputs/lyric-karaoke.js');

const join = line => (line.words || []).map(word => word.text).join('');

test('every timed line carries words whose text rebuilds the line', () => {
  const lines = karaoke.parseKrc('[1000,5000]<0,1200,0>风与海 <1800,700,0>Stay! <4200,500,0>𠮷');
  assert.equal(join(lines[0]), lines[0].text);
  assert.deepEqual(lines[0].words.map(({ text, start, end }) => [text, start, end]), [
    ['风与海 ', 1, 2.2],
    ['Stay! ', 2.8, 3.5],
    ['𠮷', 5.2, 5.7],
  ]);
});

test('repeated characters keep separate times instead of collapsing', () => {
  const [line] = karaoke.parse('[00:01.00]<00:01.00>啊<00:02.00>啊<00:03.00>');
  assert.equal(line.words.length, 2);
  assert.deepEqual(line.words.map(word => word.text), ['啊', '啊']);
  assert.deepEqual(line.words.map(word => word.start), [1, 2]);
  assert.equal(join(line), line.text);
});

test('spaces, CJK punctuation and half-width marks survive', () => {
  const [line] = karaoke.parse('[00:01.00]<00:01.00>风与海， <00:02.40>Stay! ');
  assert.equal(join(line), line.text);
  assert.ok(line.words.every(word => word.text.length > 0));
  assert.ok(line.words[0].text.endsWith('， '));
  assert.equal(line.words[0].end, 2.4);
});

test('qrc words use the duration carried by each stamp', () => {
  // QRC 的时间标记是该段文字的后缀：你(1000,500)好(1500,800)
  const [line] = karaoke.parseQrc('[1000,3000]你(1000,500)好(1500,800)');
  assert.equal(join(line), '你好');
  assert.deepEqual(line.words.map(({ text, start, end }) => [text, start, end]), [
    ['你', 1, 1.5],
    ['好', 1.5, 2.3],
  ]);
});

test('translation merging does not disturb the words', () => {
  const lines = karaoke.parse('[00:01.00]<00:01.00>Hello<00:03.00>');
  const before = JSON.stringify(lines[0].words);
  const merged = karaoke.mergeTranslations(lines, [{ time: 1.0, text: '你好' }]);
  assert.equal(merged[0].translation, '你好');
  assert.equal(JSON.stringify(merged[0].words), before);
});

test('timed spans prefer words over the old character indexes', () => {
  const [line] = karaoke.parse('[00:01.00]<00:01.00>音乐<00:02.50>');
  const spans = karaoke.timedSpans(line, 8);
  assert.deepEqual(spans, [{ text: '音乐', start: 1, end: 2.5, index: 0 }]);
  // 就算有人事后改了文字，词对象也不受影响
  line.text = '音乐！';
  assert.deepEqual(karaoke.timedSpans(line, 8), [{ text: '音乐', start: 1, end: 2.5, index: 0 }]);
});

test('lines without word timing keep the plain fallback', () => {
  const [plain] = karaoke.parse('[00:03.00]Back in the night');
  assert.equal(plain.words, undefined);
  assert.deepEqual(karaoke.timedSpans(plain, 7), []);
  assert.equal(karaoke.count(plain, 3, 7), plain.text.length);
});
