'use strict';

const RESPONSE_LIMIT = 512 * 1024;
const APPLE_LINK_HOSTS = new Set(['music.apple.com', 'itunes.apple.com', 'geo.itunes.apple.com']);

function failure(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

function text(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) : '';
}

function safeUrl(value, allowedHost) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedHost(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function countryCode(value) {
  const country = (value || 'cn').toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) throw failure('请选择有效的 Apple Music 地区。', 'invalid-country', 400);
  return country;
}

function resultLimit(value, fallback, maximum) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), maximum) : fallback;
}

function normalizeChartEntry(value) {
  const name = text(value?.name);
  const mediaId = String(value?.id ?? '');
  const externalUrl = safeUrl(value?.url, host => APPLE_LINK_HOSTS.has(host));
  if (!/^\d{1,30}$/.test(mediaId) || !name || !externalUrl) return null;
  return {
    provider: 'apple', mediaId, name, artist: text(value.artistName), externalUrl, linkedOnly: true,
    cover: safeUrl(value.artworkUrl100, host => host.endsWith('.mzstatic.com')),
  };
}

function normalizeVideo(value) {
  if (value?.kind !== 'music-video') return null;
  const name = text(value.trackName);
  const mediaId = String(value.trackId ?? '');
  const externalUrl = safeUrl(value.trackViewUrl, host => APPLE_LINK_HOSTS.has(host));
  if (!/^\d{1,30}$/.test(mediaId) || !name || !externalUrl) return null;
  // Search API previews and artwork are promotional assets. Results link to the official video page.
  return { provider: 'apple', mediaId, name, artist: text(value.artistName), externalUrl, linkedOnly: true };
}

function createDiscoveryProvider(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 8000;

  async function readJson(url) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchImpl(url, { signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw failure('Apple Music 暂时无法返回结果，请稍后重试。', 'upstream-unavailable', 502);
      if (!response.body || Number(response.headers.get('content-length')) > RESPONSE_LIMIT) {
        throw failure('Apple Music 返回的数据格式有误。', 'upstream-invalid-response', 502);
      }
      const decoder = new TextDecoder();
      let size = 0;
      let source = '';
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > RESPONSE_LIMIT) throw failure('Apple Music 返回的数据过大。', 'upstream-invalid-response', 502);
        source += decoder.decode(chunk, { stream: true });
      }
      return JSON.parse(source + decoder.decode());
    } catch (error) {
      if (signal.aborted) throw failure('Apple Music 请求超时，请稍后重试。', 'upstream-timeout', 504);
      if (error.code?.startsWith('upstream-')) throw error;
      if (error instanceof SyntaxError) throw failure('Apple Music 没有返回有效结果。', 'upstream-invalid-response', 502);
      throw failure('Apple Music 暂时无法连接，请稍后重试。', 'upstream-unavailable', 502);
    }
  }

  return {
    async charts(input = {}) {
      const country = countryCode(input.country);
      const limit = resultLimit(input.limit, 25, 50);
      const feedSize = limit <= 25 ? 25 : 50;
      const url = `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/${feedSize}/songs.json`;
      const data = await readJson(url);
      if (!Array.isArray(data?.feed?.results)) throw failure('Apple Music 榜单的数据格式有误。', 'upstream-invalid-response', 502);
      const items = data.feed.results.map(normalizeChartEntry).filter(Boolean).slice(0, limit);
      return { provider: 'apple', title: text(data.feed.title) || 'Apple Music 热门歌曲', country, items };
    },
    async musicVideos(input = {}) {
      const country = countryCode(input.country);
      const limit = resultLimit(input.limit, 20, 30);
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (!query || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) {
        throw failure('请输入 1～100 字的 MV 名称或歌手。', 'invalid-query', 400);
      }
      const url = new URL('https://itunes.apple.com/search');
      url.search = new URLSearchParams({ term: query, country, limit: String(limit), media: 'musicVideo', entity: 'musicVideo' }).toString();
      const data = await readJson(url.href);
      if (!Array.isArray(data?.results)) throw failure('Apple Music MV 的数据格式有误。', 'upstream-invalid-response', 502);
      const items = data.results.map(normalizeVideo).filter(Boolean).slice(0, limit);
      return { provider: 'apple', items };
    },
  };
}

module.exports = { createDiscoveryProvider };
