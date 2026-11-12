'use strict';

// These adapters return metadata and official links, never playback credentials.
const DEFINITIONS = Object.freeze({
  netease: { name: '网易云音乐', referer: 'https://music.163.com/' },
  qq: { name: 'QQ 音乐', referer: 'https://y.qq.com/' },
});
const RESPONSE_LIMIT = 2 * 1024 * 1024;

function failure(message, code, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function text(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 240)
    : '';
}

function coverUrl(value, domains) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    // The public APIs still sometimes return HTTP for their own image CDN.
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (!domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    return url.href;
  } catch { return null; }
}

function duration(value, divisor = 1) {
  const seconds = Number(value) / divisor;
  return Number.isFinite(seconds) && seconds > 0 && seconds < 86400 ? seconds : 0;
}

function normalizeNeteaseTrack(raw) {
  const id = String(raw?.id || '');
  if (!/^\d{1,30}$/.test(id) || !text(raw?.name)) return null;
  const album = raw.album || raw.al || {};
  return {
    provider: 'netease', mediaId: id, name: text(raw.name),
    artist: (Array.isArray(raw.artists || raw.ar) ? (raw.artists || raw.ar) : []).map(item => text(item?.name)).filter(Boolean).join('、').slice(0, 240),
    album: text(album.name), duration: duration(raw.duration ?? raw.dt, 1000),
    cover: coverUrl(album.picUrl || album.blurPicUrl, ['music.126.net']),
    externalUrl: `https://music.163.com/#/song?id=${id}`,
    linkedOnly: true,
  };
}

function normalizeQqTrack(raw) {
  const id = typeof raw?.songmid === 'string' ? raw.songmid : '';
  if (!/^[a-zA-Z0-9]{1,40}$/.test(id) || !text(raw?.songname)) return null;
  const albumId = typeof raw.albummid === 'string' && /^[a-zA-Z0-9]{1,40}$/.test(raw.albummid) ? raw.albummid : '';
  return {
    provider: 'qq', mediaId: id, name: text(raw.songname),
    artist: (Array.isArray(raw.singer) ? raw.singer : []).map(item => text(item?.name)).filter(Boolean).join('、').slice(0, 240),
    album: text(raw.albumname), duration: duration(raw.interval),
    cover: albumId ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumId}.jpg` : null,
    externalUrl: `https://y.qq.com/n/ryqq/songDetail/${id}`,
    linkedOnly: true,
  };
}

function searchParams(input) {
  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!query || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw failure('请输入 1～100 字的歌名或歌手。', 'invalid-query', 400);
  }
  const rawLimit = Number(input?.limit), rawOffset = Number(input?.offset);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(30, Math.max(1, Math.floor(rawLimit))) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.min(900, Math.max(0, Math.floor(rawOffset))) : 0;
  return { query, limit, offset };
}

async function requestJson(fetchImpl, url, options, name, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(failure(`${name}连接超时，请稍后重试或换个平台搜索。`, 'upstream-timeout', 504));
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw failure(`${name}暂时连接不上，请稍后重试。`, 'upstream-unavailable');
      if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT) throw failure(`${name}返回的数据过大，请换个关键词重试。`, 'upstream-invalid-response');
      const source = await response.text();
      if (Buffer.byteLength(source) > RESPONSE_LIMIT) throw failure(`${name}返回的数据过大，请换个关键词重试。`, 'upstream-invalid-response');
      try { return JSON.parse(source); }
      catch { throw failure(`${name}没有返回有效搜索结果，请稍后重试。`, 'upstream-invalid-response'); }
    })()]);
  } catch (error) {
    if (error.code?.startsWith('upstream-')) throw error;
    throw failure(`${name}暂时连接不上，请稍后重试或换个平台搜索。`, 'upstream-unavailable');
  } finally { clearTimeout(timer); }
}

function createPublicSearchProvider(id, options = {}) {
  const definition = DEFINITIONS[id];
  if (!definition) throw new Error('Unknown public search provider');
  const fetchImpl = options.fetch || globalThis.fetch;
  const timeoutMs = Math.min(6000, Math.max(50, Number(options.searchTimeoutMs) || 6000));
  return {
    async search(input) {
      const { query, limit, offset } = searchParams(input);
      const headers = { Accept: 'application/json', Referer: definition.referer, 'User-Agent': 'Mozilla/5.0 SonicUniverse' };
      let rows, total;
      if (id === 'netease') {
        const data = await requestJson(fetchImpl, 'https://music.163.com/api/search/get/web', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ s: query, type: '1', offset: String(offset), limit: String(limit) }).toString(),
        }, definition.name, timeoutMs);
        if (data?.code !== 200 || !data.result || (data.result.songs !== undefined && !Array.isArray(data.result.songs))) {
          throw failure('网易云音乐没有返回有效搜索结果，请稍后重试。', 'upstream-invalid-response');
        }
        rows = data.result.songs || [];
        total = Number(data.result.songCount) || 0;
      } else {
        // QQ's endpoint paginates by page. Read two pages only if an offset crosses a page boundary.
        const page = Math.floor(offset / limit) + 1, within = offset % limit;
        const fetchPage = async p => {
          const url = new URL('https://c.y.qq.com/soso/fcgi-bin/client_search_cp');
          url.search = new URLSearchParams({ w: query, format: 'json', p: String(p), n: String(limit) }).toString();
          const data = await requestJson(fetchImpl, url.href, { headers }, definition.name, timeoutMs);
          if (data?.code !== 0 || !data.data?.song || !Array.isArray(data.data.song.list)) {
            throw failure('QQ 音乐没有返回有效搜索结果，请稍后重试。', 'upstream-invalid-response');
          }
          return data.data.song;
        };
        const [first, next] = await Promise.all([fetchPage(page), within ? fetchPage(page + 1) : null]);
        total = Number(first.totalnum) || 0;
        rows = first.list;
        if (next) rows = rows.concat(next.list);
        rows = rows.slice(within, within + limit);
      }
      const normalize = id === 'netease' ? normalizeNeteaseTrack : normalizeQqTrack;
      const seen = new Set();
      const items = rows.slice(0, limit).map(normalize).filter(item => item && !seen.has(item.mediaId) && seen.add(item.mediaId));
      if (id === 'netease') {
        const missing = items.filter(item => !item.cover);
        if (missing.length) {
          // One optional metadata request supplies album art for the entire page.
          // Its short independent deadline must never hold up usable search results.
          try {
            const url = new URL('https://music.163.com/api/song/detail');
            url.searchParams.set('ids', JSON.stringify(missing.map(item => item.mediaId)));
            const detail = await requestJson(fetchImpl, url.href, { headers }, definition.name, Math.min(900, timeoutMs));
            const covers = new Map((Array.isArray(detail?.songs) ? detail.songs : []).slice(0, 30)
              .map(normalizeNeteaseTrack).filter(Boolean).map(item => [item.mediaId, item.cover]));
            for (const item of missing) item.cover = covers.get(item.mediaId) || null;
          } catch { /* Album art is optional; preserve the successful search. */ }
        }
      }
      return { items, hasMore: offset + limit < total, nextOffset: offset + limit };
    },
  };
}

module.exports = { createPublicSearchProvider, normalizeNeteaseTrack, normalizeQqTrack, searchParams };
