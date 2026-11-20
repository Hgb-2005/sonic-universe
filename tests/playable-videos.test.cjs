'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayableVideoProvider } = require('../companion/providers/playable-videos.cjs');

function commonsPage(pageid, index, overrides = {}) {
  return {
    pageid, index, ns: 6, title: `File:Music ${pageid}.webm`, imageinfo: [{
      mime: 'video/webm',
      url: `https://upload.wikimedia.org/wikipedia/commons/1/12/Music_${pageid}.webm`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:Music_${pageid}.webm`,
      extmetadata: { LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' }, Artist: { value: '<a href="/wiki/User:Artist">Alice &amp; Bob</a>' } },
      ...overrides,
    }],
  };
}

test('Commons looks up native WebM files and only sends trusted licensed results ordered by relevance', async () => {
  const provider = createPlayableVideoProvider({ fetch: (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, 'https://commons.wikimedia.org');
    assert.equal(endpoint.pathname, '/w/api.php');
    assert.equal(endpoint.searchParams.get('gsrsearch'), 'filetype:video filemime:"video/webm" Piano music');
    assert.equal(endpoint.searchParams.get('gsrnamespace'), '6');
    assert.equal(options.redirect, 'error');
    return Response.json({ query: { pages: [
      commonsPage(1, 8),
      commonsPage(2, 5, { url: 'https://upload.wikimedia.org.attacker.com/wikipedia/commons/1/12/fake.webm' }),
      commonsPage(3, 6, { extmetadata: { LicenseUrl: { value: 'https://creativecommons.org/licenses/by-nc/4.0/' } } }),
      commonsPage(4, 3, { mime: 'application/ogg' }),
      commonsPage(5, 9, { descriptionurl: 'https://commons.wikimedia.org/outside' }),
      commonsPage(6, 1),
      commonsPage(7, 7, { url: 'https://upload.wikimedia.org/wikipedia/commons/1/12/fake.webm?other=1' }),
      commonsPage(9, 2, { extmetadata: { LicenseUrl: { value: 'http://creativecommons.org/publicdomain/zero/1.0/' } } }),
      commonsPage(6, 10),
    ] } });
  } });
  const result = await provider.search({ query: ' Piano music ', limit: 5 });
  assert.equal(result.provider, 'commons');
  assert.deepEqual(result.items.map(item => item.mediaId), ['6', '9', '1']);
  assert.deepEqual(result.items[0], {
    provider: 'commons', mediaId: '6', name: 'Music 6', artist: 'Alice & Bob',
    videoUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Music_6.webm',
    externalUrl: 'https://commons.wikimedia.org/wiki/File:Music_6.webm',
    licenseName: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  });
  assert.equal(result.items[1].licenseName, 'CC0 1.0');
  assert.equal(result.items[1].licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
});

test('YouTube search sends a server-side key and only requests embeddable music videos', async () => {
  const match = {
    id: { kind: 'youtube#video', videoId: 'abcDEF-123_' },
    snippet: { title: 'Rock &amp; &#x266B;', channelTitle: 'Music Channel' },
  };
  const provider = createPlayableVideoProvider({ youtubeApiKey: ' fixture-key ', fetch: (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin + endpoint.pathname, 'https://www.googleapis.com/youtube/v3/search');
    assert.equal(options.headers['X-Goog-Api-Key'], 'fixture-key');
    assert.equal(endpoint.searchParams.get('q'), '歌名 & 歌手');
    assert.equal(endpoint.searchParams.get('type'), 'video');
    assert.equal(endpoint.searchParams.get('videoCategoryId'), '10');
    assert.equal(endpoint.searchParams.get('videoEmbeddable'), 'true');
    assert.equal(endpoint.searchParams.get('videoSyndicated'), 'true');
    assert.equal(endpoint.searchParams.get('maxResults'), '30');
    assert.doesNotMatch(url, /fixture-key/);
    return Response.json({ items: [
      match, match,
      { ...match, id: { kind: 'youtube#channel', videoId: '222DEF-123_' } },
      { ...match, id: { kind: 'youtube#video', videoId: '..\u002fDEF-123_' } },
    ] });
  } });
  assert.deepEqual(await provider.search({ query: '歌名 & 歌手', source: 'youtube', limit: 100 }), { provider: 'youtube', items: [{
    provider: 'youtube', mediaId: 'abcDEF-123_', name: 'Rock & ♫', artist: 'Music Channel',
    externalUrl: 'https://www.youtube.com/watch?v=abcDEF-123_',
  }] });
});

test('Bilibili uses anonymous search and keeps eligible music videos in upstream order', async () => {
  const row = {
    type: 'video', typeid: '193', typename: 'MV', tag: '音乐', bvid: 'BV1ki4y1d7Ln',
    title: '张芸京《<em class="keyword">偏爱</em>》 &amp; 原声', author: '音乐馆', duration: '3:32',
    is_pay: 0, is_charge_video: 0, badgepay: '',
  };
  const keywords = [];
  const provider = createPlayableVideoProvider({ fetch: (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin + endpoint.pathname, 'https://api.bilibili.com/x/web-interface/search/all/v2');
    assert.deepEqual([...endpoint.searchParams.keys()], ['keyword', 'page']);
    assert.equal(endpoint.searchParams.get('page'), '1');
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, undefined);
    keywords.push(endpoint.searchParams.get('keyword'));
    return Response.json({ code: 0, data: { result: [
      { result_type: 'live', data: [row] },
      { result_type: 'video', data: [
        row, row,
        { ...row, bvid: 'BV1L4411H7Pd', typename: '音乐综合', typeid: '130', tag: '华语MV,音乐', duration: '3:33' },
        { ...row, bvid: 'BV1f4411j719', typename: '出行', typeid: '250', tag: 'MV' },
        { ...row, bvid: 'BV1ma411n7cx', is_pay: 1 },
        { ...row, bvid: 'BV1qx411y7H9', is_charge_video: true },
        { ...row, bvid: 'BV1zx411R7ro', badgepay: '付费观看' },
        { ...row, bvid: 'https://bad.url' },
      ] },
    ] } });
  } });
  assert.deepEqual(await provider.search({ query: '偏爱', source: 'bilibili' }), { provider: 'bilibili', items: [
    { provider: 'bilibili', mediaId: 'BV1ki4y1d7Ln', name: '张芸京《偏爱》 & 原声', artist: '音乐馆', duration: 212 },
    { provider: 'bilibili', mediaId: 'BV1L4411H7Pd', name: '张芸京《偏爱》 & 原声', artist: '音乐馆', duration: 213 },
  ] });
  assert.equal((await provider.search({ query: '偏爱MV', source: 'bilibili', limit: 1 })).items.length, 1);
  assert.deepEqual(keywords, ['偏爱 MV', '偏爱MV']);
});

test('Bilibili status errors surface as unavailable without retrying against a challenge', async () => {
  const replies = [new Response('<html>', { status: 412 }), Response.json({ code: -352 }), Response.json({ code: 0, data: { result: [] } })];
  const provider = createPlayableVideoProvider({ fetch: () => replies.shift() });
  await assert.rejects(provider.search({ query: '偏爱', source: 'bilibili' }), { status: 502, code: 'upstream-unavailable' });
  assert.equal(replies.length, 2);
  await assert.rejects(provider.search({ query: '偏爱', source: 'bilibili' }), { status: 502, code: 'upstream-unavailable' });
  assert.equal(replies.length, 1);
  assert.deepEqual(await provider.search({ query: '偏爱', source: 'bilibili' }), { provider: 'bilibili', items: [] });
});

test('invalid queries and unavailable YouTube settings do not request the network', async () => {
  const provider = createPlayableVideoProvider({ fetch: () => assert.fail('Unexpected network request') });
  await assert.rejects(provider.search({ query: 'Piano', source: 'invalid' }), { status: 400, code: 'invalid-source' });
  await assert.rejects(provider.search({ query: '  ' }), { status: 400, code: 'invalid-query' });
  await assert.rejects(provider.search({ query: '\nPiano' }), { status: 400, code: 'invalid-query' });
  await assert.rejects(provider.search({ query: '中'.repeat(101) }), { status: 400, code: 'invalid-query' });
  await assert.rejects(provider.search({ query: 'Piano', source: 'youtube' }), { status: 503, code: 'video-source-unconfigured' });
});

test('a valid empty response stays empty and invalid or stalled upstream requests report their error', async () => {
  const empty = createPlayableVideoProvider({ fetch: () => Response.json({ batchcomplete: true }) });
  assert.deepEqual(await empty.search({ query: 'Piano' }), { provider: 'commons', items: [] });
  const malformed = createPlayableVideoProvider({ fetch: () => new Response('Not JSON') });
  await assert.rejects(malformed.search({ query: 'Piano' }), { status: 502, code: 'upstream-invalid-response' });
  const unavailable = createPlayableVideoProvider({ fetch: () => new Response('', { status: 403 }) });
  await assert.rejects(unavailable.search({ query: 'Piano' }), { status: 502, code: 'upstream-unavailable' });
  let signal;
  const stalled = createPlayableVideoProvider({ timeoutMs: 50, fetch: (url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(stalled.search({ query: 'Piano' }), { status: 504, code: 'upstream-timeout' });
  assert.equal(signal.aborted, true);
});
