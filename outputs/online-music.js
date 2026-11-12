(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SonicOnlineMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROVIDER = 'qishui';
  const MAX_TEXT = 240;

  function text(value, fallback = '') {
    return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : fallback;
  }

  function safeHttpsUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.toString() : null;
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

  function createClient(options = {}) {
    let baseUrl = String(options.baseUrl || '');
    let available = null;

    async function request(path, payload) {
      const method = payload === undefined ? 'GET' : 'POST';
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: 'no-store',
        credentials: 'omit',
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
    }

    return {
      get available() { return available; },
      async detect() {
        try {
          const data = await request('/health');
          available = data?.ok === true && data?.companion === true;
        } catch {
          available = false;
        }
        return available;
      },
      loginStatus: () => request('/api/qishui/login-status'),
      loginStart: () => request('/api/qishui/login/start', {}),
      loginCheck: sessionId => request('/api/qishui/login/check', { sessionId }),
      logout: () => request('/api/qishui/logout', {}),
      search: query => request('/api/qishui/search', { query, limit: 30, offset: 0 }),
      liked: () => request('/api/qishui/library/liked?limit=50&offset=0'),
      playlists: () => request('/api/qishui/library/playlists?limit=50&offset=0'),
      playlist: id => request(`/api/qishui/playlists/${encodeURIComponent(id)}?limit=100&offset=0`),
      lyrics: id => request(`/api/qishui/songs/${encodeURIComponent(id)}/lyrics`),
      audio: mediaId => request(`/api/qishui/tracks/${encodeURIComponent(mediaId)}/audio`, {}),
      like: (mediaId, liked) => request('/api/qishui/like', { id: mediaId, liked }),
      playlistEdit: (operation, id, ids) => request(`/api/qishui/playlist/${operation}`, { id, ids }),
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
    createClient,
    safeHttpsUrl,
  };
});
