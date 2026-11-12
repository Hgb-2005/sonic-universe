(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SonicOnlineMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROVIDER = 'qishui';
  const MAX_TEXT = 240;
  const DEFAULT_COVER_TEMPLATE = 'tplv-b829550vbb';

  function text(value, fallback = '') {
    return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : fallback;
  }

  function safeHttpsUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      if (/^p\d+-luna\.douyinpic\.com$/i.test(url.hostname)
        && url.pathname.startsWith('/img/')
        && !url.pathname.includes('~tplv-')) {
        url.pathname += `~${DEFAULT_COVER_TEMPLATE}-resize:360:360.image`;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  function normalizeTrack(input) {
    if (!input || input.provider !== PROVIDER || !/^\d{1,30}$/.test(String(input.mediaId || ''))) return null;
    const mediaId = String(input.mediaId);
    const name = text(input.name, '未命名歌曲');
    const duration = Number(input.duration);
    return {
      id: `online:${PROVIDER}:${mediaId}`,
      kind: 'online',
      provider: PROVIDER,
      mediaId,
      name,
      artist: text(input.artist),
      album: text(input.album),
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      cover: safeHttpsUrl(input.cover),
      externalUrl: safeHttpsUrl(input.externalUrl) || `https://qishui.douyin.com/song/${encodeURIComponent(mediaId)}`,
      favorite: input.favorite === true,
      liked: input.liked === true,
      preview: input.preview === true,
      stored: true,
      sourcePath: '汽水音乐',
      signature: `qishui:${mediaId}`,
    };
  }

  function migrateLegacyLink(track) {
    if (!track || track.kind !== 'soda') return track;
    return {
      ...track,
      linkedOnly: true,
      sourcePath: '汽水音乐 · 分享链接',
    };
  }

  function mergeTracks(current, incoming) {
    const result = Array.isArray(current) ? current.slice() : [];
    const bySignature = new Map(result.map(track => [track.signature || track.id, track]));
    for (const candidate of Array.isArray(incoming) ? incoming : []) {
      const track = normalizeTrack(candidate);
      if (!track) continue;
      const existingIndex = result.findIndex(item => item.kind === 'online' && item.mediaId === track.mediaId);
      if (existingIndex >= 0) {
        const previous = result[existingIndex];
        result[existingIndex] = { ...previous, ...track, favorite: previous.favorite === true || track.favorite };
      } else if (!bySignature.has(track.signature)) {
        result.push(track);
        bySignature.set(track.signature, track);
      }
    }
    return result;
  }

  function persistentTrack(track) {
    if (!track || track.kind !== 'online') return null;
    const normalized = normalizeTrack(track);
    if (!normalized) return null;
    return {
      ...normalized,
      favorite: track.favorite === true,
      liked: track.liked === true,
      preview: track.preview === true,
    };
  }

  function parseLrc(source) {
    if (typeof source !== 'string') return [];
    const lines = [];
    for (const row of source.replace(/\r/g, '').split('\n').slice(0, 3000)) {
      const timePattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      const times = [];
      let match;
      while ((match = timePattern.exec(row))) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0;
        const at = minutes * 60 + seconds + fraction;
        if (Number.isFinite(at) && seconds < 60) times.push(at);
      }
      const lyric = row.replace(timePattern, '').trim();
      if (lyric) for (const at of times) lines.push({ at, text: lyric.slice(0, 180) });
    }
    return lines.sort((a, b) => a.at - b.at);
  }

  function activeLyric(lines, position) {
    if (!Array.isArray(lines) || !lines.length) return null;
    let active = null;
    for (const line of lines) {
      if (line.at > position + 0.03) break;
      active = line;
    }
    return active || lines[0];
  }

  function companionBaseUrls(locationLike = {}, configuredBaseUrl = '') {
    const requested = typeof configuredBaseUrl === 'string' ? configuredBaseUrl.trim().replace(/\/+$/, '') : '';
    const protocol = String(locationLike.protocol || '');
    const hostname = String(locationLike.hostname || '').toLowerCase();
    const localPage = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    if (requested || localPage || !/^https?:$/.test(protocol)) return [requested];
    return ['http://127.0.0.1:8765', ''];
  }

  function createClient(options = {}) {
    const candidates = Array.from(new Set(
      (Array.isArray(options.baseUrls) ? options.baseUrls : [String(options.baseUrl || '')])
        .map(value => String(value || '').trim().replace(/\/+$/, ''))
    ));
    let baseUrl = candidates[0] || '';
    let available = null;
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(1500, Number(options.timeoutMs)) : 10000;

    async function requestFrom(origin, path, payload, requestTimeout = timeoutMs) {
      const method = payload === undefined ? 'GET' : 'POST';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeout);
      try {
        const response = await fetch(`${origin}${path}`, {
          method,
          headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal,
        });
        let data = {};
        try { data = await response.json(); } catch {}
        if (!response.ok) {
          const error = new Error(data.error || '音乐入口暂时没有响应');
          error.code = data.code || 'unavailable';
          error.status = response.status;
          throw error;
        }
        return data;
      } catch (error) {
        if (controller.signal.aborted) {
          const timeout = new Error('本机音乐入口响应超时，请确认启动窗口仍然打开。');
          timeout.code = 'timeout';
          throw timeout;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function request(path, payload, requestTimeout = timeoutMs) {
      return requestFrom(baseUrl, path, payload, requestTimeout);
    }

    function resolveUrl(path) {
      const value = String(path || '');
      if (!value.startsWith('/')) return '';
      const pageBase = baseUrl || globalThis.location?.href || 'http://127.0.0.1:8765/';
      try {
        return new URL(value, pageBase).toString();
      } catch {
        return '';
      }
    }

    function coverUrl(mediaId) {
      const id = String(mediaId || '');
      return /^\d{1,30}$/.test(id)
        ? resolveUrl(`/api/qishui/tracks/${encodeURIComponent(id)}/cover`)
        : '';
    }

    return {
      get available() { return available; },
      get baseUrl() { return baseUrl; },
      async detect() {
        for (const candidate of candidates) {
          try {
            const data = await requestFrom(candidate, '/health', undefined, Math.min(timeoutMs, 5000));
            if (data?.ok === true && data?.companion === true) {
              baseUrl = candidate;
              available = true;
              return true;
            }
          } catch {}
        }
        available = false;
        return false;
      },
      loginStatus: () => request('/api/qishui/login-status', undefined, 7000),
      loginStart: () => request('/api/qishui/login/start', {}, 15000),
      loginCheck: sessionId => request('/api/qishui/login/check', { sessionId }, 7000),
      logout: () => request('/api/qishui/logout', {}, 7000),
      search: query => request('/api/qishui/search', { query, limit: 30, offset: 0 }, 12000),
      liked: () => request('/api/qishui/library/liked?limit=50&offset=0', undefined, 12000),
      playlists: () => request('/api/qishui/library/playlists?limit=50&offset=0', undefined, 12000),
      playlist: id => request(`/api/qishui/playlists/${encodeURIComponent(id)}?limit=100&offset=0`, undefined, 12000),
      lyrics: id => request(`/api/qishui/songs/${encodeURIComponent(id)}/lyrics`, undefined, 10000),
      audio: mediaId => request(`/api/qishui/tracks/${encodeURIComponent(mediaId)}/audio`, {}, 15000),
      coverUrl,
      like: (mediaId, liked) => request('/api/qishui/like', { id: mediaId, liked }, 12000),
      playlistEdit: (operation, id, ids) => request(`/api/qishui/playlist/${operation}`, { id, ids }, 12000),
      resolveUrl,
    };
  }

  return {
    PROVIDER,
    normalizeTrack,
    migrateLegacyLink,
    mergeTracks,
    persistentTrack,
    parseLrc,
    activeLyric,
    companionBaseUrls,
    createClient,
    safeHttpsUrl,
  };
});
