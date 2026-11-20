'use strict';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3/search';
const BILIBILI_API = 'https://api.bilibili.com/x/web-interface/search/all/v2';
const RESPONSE_LIMIT = 512 * 1024;
const USER_AGENT = 'SonicUniverse/0.36 (https://github.com/hgb-2005/sonic-universe)';
const NAMED_ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };
const MUSIC_VIDEO_MARKER = /(?:^|[^a-z\d])(?:m[\/／]v|m(?:t)?v|music\s+video)(?=$|[^a-z\d])/i;

function failure(message, code, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function plainText(value, hasMarkup = false) {
  if (typeof value !== 'string') return '';
  const source = value.slice(0, 2048);
  const text = hasMarkup ? source.replace(/<\/?em(?:\s+[^<>]*)?>/gi, '').replace(/<[^<>]*>/g, ' ') : source;
  return text.replace(/&(#x[\da-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi, (original, entity) => {
    if (!entity.startsWith('#')) return NAMED_ENTITIES[entity.toLowerCase()] || original;
    const codePoint = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
  }).replace(/[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim().slice(0, 240);
}

function trustedUrl(value, hostname) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== hostname || url.username || url.password || url.port) return null;
    return url;
  } catch { return null; }
}

function commonsLicense(source) {
  if (typeof source !== 'string') return null;
  const url = trustedUrl(source.replace(/^(?:http:)?\/\//i, 'https://'), 'creativecommons.org');
  if (!url || url.search || url.hash) return null;
  const attribution = /^\/licenses\/(by|by-sa)\/(1\.0|2\.0|2\.5|3\.0|4\.0)\/?$/.exec(url.pathname);
  const publicDomain = /^\/publicdomain\/(zero|mark)\/1\.0\/?$/.exec(url.pathname);
  if (!attribution && !publicDomain) return null;
  return {
    licenseName: attribution ? `CC ${attribution[1].toUpperCase()} ${attribution[2]}` : (publicDomain[1] === 'zero' ? 'CC0 1.0' : 'Public Domain Mark 1.0'),
    licenseUrl: url.href,
  };
}

function commonsItem(page) {
  if (!Number.isSafeInteger(page?.pageid) || page.pageid < 1 || page.ns !== 6) return null;
  const info = page.imageinfo?.[0];
  if (info?.mime !== 'video/webm') return null;
  const video = trustedUrl(info.url, 'upload.wikimedia.org');
  const description = trustedUrl(info.descriptionurl, 'commons.wikimedia.org');
  const license = commonsLicense(info.extmetadata?.LicenseUrl?.value);
  const name = plainText(typeof page.title === 'string' ? page.title.replace(/^File:/i, '').replace(/\.webm$/i, '') : '');
  if (!name || !license || !video || !description || video.search || video.hash) return null;
  if (!video.pathname.startsWith('/wikipedia/commons/') || !/\.webm$/i.test(video.pathname)) return null;
  if (!/^\/wiki\/File(?::|%3a)/i.test(description.pathname)) return null;
  return {
    provider: 'commons', mediaId: String(page.pageid), name,
    artist: plainText(info.extmetadata?.Artist?.value, true),
    videoUrl: video.href, externalUrl: description.href, ...license,
  };
}

function youtubeItem(row) {
  const mediaId = row?.id?.videoId;
  const name = plainText(row?.snippet?.title);
  if (row?.id?.kind !== 'youtube#video' || typeof mediaId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(mediaId) || !name) return null;
  return {
    provider: 'youtube', mediaId, name, artist: plainText(row.snippet.channelTitle),
    externalUrl: `https://www.youtube.com/watch?v=${mediaId}`,
  };
}

function bilibiliItem(row) {
  const mediaId = row?.bvid;
  if (row?.type !== 'video' || typeof mediaId !== 'string' || !/^BV[a-zA-Z0-9]{10}$/.test(mediaId)) return null;
  const isPaywalled = [row.is_pay, row.is_charge_video, row.badgepay].some(flag => flag === true ||
    ((typeof flag === 'string' || typeof flag === 'number') && Number(flag) > 0));
  if (isPaywalled || plainText(row.badgepay)) return null;

  const name = plainText(row.title, true);
  const category = plainText(row.typename);
  const isMvCategory = row.typeid === '193' || row.typeid === 193 || category.toLowerCase() === 'mv';
  const musicCategory = /^(?:音乐(?:综合|现场|教学)?|乐评盘点|原创音乐|翻唱|演奏|电音)$/.test(category);
  const hasMvMarker = MUSIC_VIDEO_MARKER.test(`${name} ${plainText(row.tag)}`);
  if (!name || !(isMvCategory || (musicCategory && hasMvMarker))) return null;

  const durationParts = typeof row.duration === 'string' && /^\d{1,2}(?::[0-5]?\d){1,2}$/.test(row.duration)
    ? row.duration.split(':').map(Number) : [];
  const duration = durationParts.reduce((seconds, part) => seconds * 60 + part, 0);
  return {
    provider: 'bilibili', mediaId, name, artist: plainText(row.author),
    ...(duration > 0 && duration < 86400 ? { duration } : {}),
  };
}

async function requestJson(fetchImpl, url, headers, label, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(failure(`${label}搜索超时，请稍后重试。`, 'upstream-timeout', 504));
      controller.abort();
    }, timeoutMs);
  });
  const request = async () => {
    const response = await fetchImpl(url.href, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw failure(`${label}搜索暂时不可用，请稍后重试。`, 'upstream-unavailable');
    const invalidResponse = () => failure(`${label}返回了无法读取的视频搜索结果。`, 'upstream-invalid-response');
    if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT) throw invalidResponse();
    const body = await response.text();
    if (Buffer.byteLength(body) > RESPONSE_LIMIT) throw invalidResponse();
    try { return JSON.parse(body); }
    catch { throw invalidResponse(); }
  };
  try { return await Promise.race([request(), timeout]); }
  catch (error) {
    if (error?.code?.startsWith('upstream-')) throw error;
    throw failure(`${label}搜索暂时不可用，请稍后重试。`, 'upstream-unavailable');
  } finally { clearTimeout(timer); }
}

function createPlayableVideoProvider({ fetch: fetchImpl = globalThis.fetch, youtubeApiKey = '', timeoutMs = 6000 } = {}) {
  timeoutMs = Math.min(10000, Math.max(50, Number(timeoutMs) || 6000));
  const key = typeof youtubeApiKey === 'string' ? youtubeApiKey.trim() : '';
  return {
    async search({ query, source = 'commons', limit } = {}) {
      const isBilibili = source === 'bilibili', isCommons = source === 'commons', isYoutube = source === 'youtube';
      if (!isBilibili && !isCommons && !isYoutube) throw failure('请选择有效的视频来源。', 'invalid-source', 400);
      const term = typeof query === 'string' ? query.trim() : '';
      if (!term || term.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) {
        throw failure('请输入 1～100 字的视频名称或创作者。', 'invalid-query', 400);
      }
      const count = Math.max(1, Math.min(30, Math.floor(Number(limit)) || 12));
      if (isYoutube && !key) throw failure('YouTube 搜索需要在服务中配置 API 密钥。', 'video-source-unconfigured', 503);
      const url = new URL(isBilibili ? BILIBILI_API : isCommons ? COMMONS_API : YOUTUBE_API);
      const parameters = isCommons ? {
        action: 'query', generator: 'search', gsrsearch: `filetype:video filemime:"video/webm" ${term}`,
        gsrnamespace: '6', gsrlimit: String(Math.min(30, count + 5)), prop: 'imageinfo',
        iiprop: 'url|mime|extmetadata', iiextmetadatafilter: 'LicenseUrl|Artist', format: 'json', formatversion: '2',
      } : isBilibili ? {
        keyword: MUSIC_VIDEO_MARKER.test(term) ? term : `${term} MV`, page: '1',
      } : {
        part: 'snippet', q: term, type: 'video', videoCategoryId: '10', videoEmbeddable: 'true',
        videoSyndicated: 'true', maxResults: String(count), fields: 'items(id(kind,videoId),snippet(title,channelTitle))',
      };
      url.search = new URLSearchParams(parameters).toString();
      const label = isBilibili ? '哔哩哔哩' : isCommons ? '维基共享资源' : 'YouTube';
      const headers = isYoutube ? { 'X-Goog-Api-Key': key } : { 'User-Agent': USER_AGENT };
      const data = await requestJson(fetchImpl, url, headers, label, timeoutMs);
      let rows;
      if (isBilibili) {
        if (data?.code !== 0) throw failure(`${label}搜索暂时不可用，请稍后重试。`, 'upstream-unavailable');
        const groups = data.data?.result;
        if (Array.isArray(groups)) rows = groups.find(group => group?.result_type === 'video')?.data ?? [];
      } else {
        rows = isCommons ? (data?.query?.pages ?? (data?.batchcomplete === true ? [] : undefined)) : data?.items;
      }
      if (data?.error || !Array.isArray(rows)) throw failure(`${label}返回了无法读取的视频搜索结果。`, 'upstream-invalid-response');
      const ordered = isCommons ? rows.slice().sort((first, second) => (first?.index ?? Infinity) - (second?.index ?? Infinity)) : rows;
      const seen = new Set();
      const normalize = isBilibili ? bilibiliItem : isCommons ? commonsItem : youtubeItem;
      const items = ordered.map(normalize)
        .filter(item => item && !seen.has(item.mediaId) && seen.add(item.mediaId)).slice(0, count);
      return { provider: source, items };
    },
  };
}

module.exports = { createPlayableVideoProvider };
