'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trustedFrame, externalUrl, playerState, lyricDocument } = require('../desktop/policy.cjs');
test('desktop privileges reject remote pages, subframes and a second window', () => {
  const frame={url:'http://127.0.0.1:17865/'},contents={mainFrame:frame},window={isDestroyed:()=>false,webContents:contents};
  assert.equal(trustedFrame({sender:contents,senderFrame:frame},window,'http://127.0.0.1:17865'),true);
  assert.equal(trustedFrame({sender:contents,senderFrame:{url:frame.url}},window,'http://127.0.0.1:17865'),false);
  assert.equal(trustedFrame({sender:{},senderFrame:frame},window,'http://127.0.0.1:17865'),false);
  frame.url='https://example.com/';assert.equal(trustedFrame({sender:contents,senderFrame:frame},window,'http://127.0.0.1:17865'),false);
});
test('external navigation accepts web links and rejects executable schemes and credentials', () => {
  assert.equal(externalUrl('https://example.com/song/12'),'https://example.com/song/12');
  for(const url of ['javascript:alert(1)','file:///C:/secret.txt','https://user:password@example.com/','not a URL'])assert.equal(externalUrl(url),null);
});
test('mini player receives bounded metadata and never receives session credentials', () => {
  const state=playerState({track:{name:'A',artist:'B',cookie:'secret',url:'signed-url'},position:Infinity,duration:-2,lyric:'x'.repeat(1000),playing:'true',cookie:'secret'});
  assert.equal(state.position,0);assert.equal(state.duration,0);assert.equal(state.lyric.length,300);assert.equal(state.playing,false);
  assert.equal(JSON.stringify(state).includes('secret'),false);assert.equal(JSON.stringify(state).includes('signed-url'),false);
});

test('the lyric document is bounded and strips anything but lyric data', () => {
  const doc = lyricDocument({
    track: { name: 'x'.repeat(500), artist: 'A' },
    duration: 200,
    offset: 999,
    mediaStart: 301.5,
    cookie: 'secret',
    lines: Array.from({ length: 500 }, (_, i) => ({
      time: i, end: i + 1, text: 'line ' + i, translation: 'tr',
      isChorus: i % 2 === 0,
      words: Array.from({ length: 200 }, () => ({ text: 'w', start: 1, end: 2 })),
    })),
  });
  assert.equal(doc.lines.length, 400);
  assert.equal(doc.track.name.length, 160);
  assert.equal(doc.offset, 120);
  assert.equal(doc.mediaStart, 301.5);
  assert.equal(doc.lines[0].words.length, 120);
  assert.equal(JSON.stringify(doc).includes('secret'), false);
  assert.equal(doc.lines[1].isChorus, false);
});

test('a lyric document never accepts junk shapes', () => {
  assert.equal(lyricDocument(null), null);
  assert.equal(lyricDocument('text'), null);
  const empty = lyricDocument({ lines: 'nope' });
  assert.deepEqual(empty.lines, []);
  assert.equal(empty.track.name, '');
});
