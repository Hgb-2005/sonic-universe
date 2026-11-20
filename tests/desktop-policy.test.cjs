'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trustedFrame, externalUrl, playerState } = require('../desktop/policy.cjs');
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
