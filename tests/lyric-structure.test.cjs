'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const structure = require('../outputs/lyric-structure.js');

const line = (time, text) => ({ time, text });

test('credits at the top are recognised and hidden when the intro is short', () => {
  const lines = [
    line(0, '作词：张三'),
    line(0.1, '作曲：李四'),
    line(0.2, '编曲：王五'),
    line(1.2, '第一句歌词'),
  ];
  const decision = structure.staffDecision(lines);
  assert.deepEqual(decision.indexes, [0, 1, 2]);
  assert.equal(decision.verdict, 'hide', '3 lines need 2.7s but only 1.2s is available');
  assert.deepEqual(structure.decorate(lines).map(l => l.text), ['第一句歌词']);
});

test('credits stay when the intro leaves enough time to read them', () => {
  const lines = [
    line(0, '作词：张三'),
    line(0.1, '作曲：李四'),
    line(6.0, '第一句歌词'),
  ];
  const decision = structure.staffDecision(lines);
  assert.equal(decision.verdict, 'keep');
  const kept = structure.decorate(lines);
  assert.equal(kept.length, 3);
  assert.equal(kept[0].text, '作词：张三');
});

test('a lyric line that merely contains 曲 is not treated as credits', () => {
  assert.equal(structure.isStaffLine('这一曲唱给你听'), false);
  assert.equal(structure.isStaffLine('曲终人散'), false);
  assert.equal(structure.isStaffLine('作曲：李四'), true);
  assert.equal(structure.isStaffLine('制作人 : 王五'), true);
  assert.equal(structure.isStaffLine(''), false);
});

test('only the leading block counts as credits', () => {
  const lines = [line(0, '第一句'), line(3, '作词：张三'), line(6, '第二句')];
  assert.deepEqual(structure.staffDecision(lines).indexes, []);
  assert.equal(structure.decorate(lines).length, 3);
});

test('repeated lines become chorus and unique lines do not', () => {
  const lines = [
    line(0, '主歌第一句'),
    line(4, '副歌来了'),
    line(8, '主歌第二句'),
    line(12, '副歌来了！'),
    line(16, '副歌来了'),
  ];
  const decorated = structure.decorate(lines);
  assert.deepEqual(decorated.map(l => Boolean(l.isChorus)), [false, true, false, true, true]);
});

test('punctuation and spacing do not stop a chorus from matching', () => {
  const lines = [line(0, 'Hello World'), line(4, 'hello，world！'), line(8, '别的一句')];
  const decorated = structure.decorate(lines);
  assert.deepEqual(decorated.map(l => Boolean(l.isChorus)), [true, true, false]);
  assert.equal(structure.normalize('  啊，啊！ '), '啊啊');
});

test('single character and empty lines never become chorus', () => {
  const lines = [line(0, '啊'), line(1, '啊'), line(2, ''), line(3, '')];
  assert.deepEqual(structure.decorate(lines).map(l => Boolean(l.isChorus)), [false, false, false, false]);
});

test('instrumental markers are flagged but kept', () => {
  const lines = [line(0, '前一句'), line(4, '[间奏]'), line(30, 'Instrumental')];
  const decorated = structure.decorate(lines);
  assert.equal(decorated.length, 3);
  assert.equal(decorated[1].silent, true);
  assert.equal(decorated[2].silent, true);
});
