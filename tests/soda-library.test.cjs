const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('../outputs/soda-library.js');

test('汽水音乐链接只接受不含凭据的 HTTP(S) 地址', () => {
  assert.equal(library.normalizeSodaUrl('https://qishui.douyin.com/s/example'), 'https://qishui.douyin.com/s/example');
  assert.equal(library.normalizeSodaUrl('http://www.qishui.com/song/1'), 'http://www.qishui.com/song/1');
  assert.equal(library.normalizeSodaUrl('javascript:alert(1)'), null);
  assert.equal(library.normalizeSodaUrl('qishui://song/1'), null);
  assert.equal(library.normalizeSodaUrl('https://user:secret@example.com/song'), null);
  assert.equal(library.normalizeSodaUrl('not a link'), null);
});

test('单首汽水歌曲会清理字段并验证必填内容', () => {
  const valid = library.validateSodaRecord({
    name: '  千万人之中  ',
    artist: ' 王奕心 ',
    album: ' 收藏 ',
    externalUrl: ' https://qishui.douyin.com/s/example '
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value, {
    name: '千万人之中',
    artist: '王奕心',
    album: '收藏',
    externalUrl: 'https://qishui.douyin.com/s/example'
  });
  assert.equal(library.validateSodaRecord({ name: '', externalUrl: 'https://qishui.douyin.com/s/example' }).ok, false);
  assert.equal(library.validateSodaRecord({ name: '一首歌', externalUrl: 'qishui://song/1' }).ok, false);
});

test('批量整理支持竖线、制表符与已有链接去重', () => {
  const input = [
    '千万人之中 | 王奕心 | 单曲 | https://qishui.douyin.com/s/one',
    '第二首歌\t歌手乙\thttps://qishui.douyin.com/s/two',
    '重复歌曲 | https://qishui.douyin.com/s/one',
    '无效行，没有链接'
  ].join('\n');
  const result = library.parseSodaLines(input, ['https://qishui.douyin.com/s/already']);
  assert.deepEqual(result.items.map((item) => item.name), ['千万人之中', '第二首歌']);
  assert.deepEqual(result.items.map((item) => item.artist), ['王奕心', '歌手乙']);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.invalid.length, 1);
});

test('批量整理会用已有汽水链接去重并限制单次数量', () => {
  const existing = ['https://qishui.douyin.com/s/same'];
  const lines = ['同名 | https://qishui.douyin.com/s/same'];
  for (let index = 0; index < library.LIMITS.batch + 3; index += 1) {
    lines.push(`歌曲 ${index} | https://qishui.douyin.com/s/${index}`);
  }
  const result = library.parseSodaLines(lines.join('\n'), existing);
  assert.equal(result.items.length, library.LIMITS.batch);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.limited, 3);
});
