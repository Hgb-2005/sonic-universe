(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SonicOnlineMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROVIDER = 'qishui';
  const MAX_TEXT = 240;
  const DEFAULT_COVER_TEMPLATE = 'tplv-b829550vbb';
  const EXTERNAL_PROVIDERS = Object.freeze({
    netease: { name: '网易云音乐', host: 'music.163.com', id: /^\d{1,30}$/, url: id => `https://music.163.com/#/song?id=${id}` },
    qq: { name: 'QQ 音乐', host: 'y.qq.com', id: /^[a-zA-Z0-9]{1,40}$/, url: id => `https://y.qq.com/n/ryqq/songDetail/${id}` },
    kugou: { name: '酷狗音乐', host: 'www.kugou.com', id: /^[1-9]\d{0,29}$/, url: (_id,track) => `https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=${encodeURIComponent([text(track.name),text(track.artist)].filter(Boolean).join(' '))}` },
  });

  function officialTrackUrl(provider, value) {
    const expected = Object.hasOwn(EXTERNAL_PROVIDERS, provider) ? EXTERNAL_PROVIDERS[provider] : null;
    if (!expected || typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === expected.host && !url.username && !url.password && (!url.port || url.port === '443') ? url.toString() : null;
    } catch { return null; }
  }

  function normalizeExternalTrack(input) {
    const provider = input?.provider, spec = Object.hasOwn(EXTERNAL_PROVIDERS, provider) ? EXTERNAL_PROVIDERS[provider] : null;
    const mediaId = String(input?.mediaId || '');
    if (!spec || !spec.id.test(mediaId)) return null;
    const fallback = spec.url(mediaId,input);
    const length = Number(input.duration);
    const duration = Number.isFinite(length) && length > 0 && length < 86400 ? length : 0;
    return { provider, mediaId, name: text(input.name, '未命名歌曲'), artist: text(input.artist), album: text(input.album), duration, cover: safeHttpsUrl(input.cover), externalUrl: officialTrackUrl(provider, input.externalUrl) || fallback, linkedOnly: true };
  }

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

  function qishuiSongId(input) {
    const value = typeof input === 'string' ? input.trim() : '';
    if (/^\d{1,30}$/.test(value)) return value;
    if (value.length > 4000) return '';
    // Sharing copy may wrap the canonical song URL in a title or punctuation.
    const canonical = /https:\/\/qishui\.douyin\.com\/song\/(\d{1,30})(?=$|[/?#\s"'，。！？）】])/i.exec(value)?.[1];
    if (canonical) return canonical;
    const shareUrl = /https:\/\/music\.douyin\.com\/qishui\/share\/track\?[^\s"'<>,，。！？）】]+/i.exec(value)?.[0];
    if (!shareUrl) return '';
    const id = new URL(shareUrl).searchParams.get('track_id') || '';
    return /^\d{1,30}$/.test(id) ? id : '';
  }

  function qishuiShareCode(input) {
    const value = typeof input === 'string' ? input.trim() : '';
    if (value.length > 4000) return '';
    return /https:\/\/qishui\.douyin\.com\/s\/([A-Za-z0-9_-]{2,64})(?=$|[/?#\s"'，。！？）】])/i.exec(value)?.[1] || '';
  }

  function isQishuiShareLink(input) {
    return Boolean(qishuiShareCode(input) || (qishuiSongId(input) && !/^\d{1,30}$/.test(input.trim())));
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
    let detectionState = 'pending', detectionGeneration = 0, detectionController = null;
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(1500, Number(options.timeoutMs)) : 8000;

    async function requestFrom(origin, path, payload, requestTimeout = timeoutMs, parentSignal = null, timeoutCap = timeoutMs) {
      const method = payload === undefined ? 'GET' : 'POST';
      const controller = new AbortController();
      let timedOut = false, timer, rejectAbort;
      const cancel = () => controller.abort();
      parentSignal?.addEventListener('abort', cancel, { once: true });
      if (parentSignal?.aborted) cancel();
      const cancellation = new Promise((_, reject) => {
        rejectAbort = () => {
          const error = new Error('这次请求已取消。');
          error.name = 'AbortError';
          reject(error);
        };
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
        if (controller.signal.aborted) rejectAbort();
      });
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          const error = new Error('连不上本机音乐入口，点「重新连接」再试。');
          error.code = 'timeout';
          reject(error);
        }, Math.min(timeoutCap, requestTimeout));
      });
      try {
        return await Promise.race([deadline, cancellation, (async () => {
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
        })()]);
      } catch (error) {
        if (timedOut) {
          const timeout = new Error('连不上本机音乐入口，点「重新连接」再试。');
          timeout.code = 'timeout';
          throw timeout;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', cancel);
        controller.signal.removeEventListener('abort', rejectAbort);
      }
    }

    async function request(path, payload, requestTimeout = timeoutMs) {
      return requestFrom(baseUrl, path, payload, requestTimeout);
    }

    function playlistPage(id, offset = 0, ownerId = '', signal) {
      const query = new URLSearchParams({ limit: '100', offset: String(offset) });
      if (ownerId) query.set('ownerId', ownerId);
      return requestFrom(baseUrl, `/api/qishui/playlists/${encodeURIComponent(id)}?${query}`, undefined, 12000, signal);
    }

    async function playlistAllTracks(id, { ownerId, signal } = {}) {
      const items = [];
      const seen = new Set();
      let playlist = null;
      let offset = 0;
      for (;;) {
        signal?.throwIfAborted();
        const page = await playlistPage(id, offset, ownerId, signal);
        if (!Array.isArray(page?.items)) throw new Error('汽水歌单返回的数据不完整，请重试。');
        playlist ||= page.playlist || null;
        for (const item of page.items) {
          const track = normalizeTrack(item);
          if (!track || seen.has(track.mediaId)) continue;
          seen.add(track.mediaId);
          items.push(track);
        }
        const nextOffset = Number(page.nextOffset);
        if (page.hasMore !== true) {
          return {
            playlist, items, hasMore: false,
            nextOffset: Number.isSafeInteger(nextOffset) && nextOffset >= offset ? nextOffset : offset + page.items.length,
          };
        }
        if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
          throw new Error('汽水歌单翻页没有前进，请重试。');
        }
        // The Qishui SDK accepts offsets up to 50,000. Do not return a partial playlist as complete.
        if (nextOffset > 50000) throw new Error('歌曲数量超过汽水当前支持的读取范围。');
        offset = nextOffset;
      }
    }

    async function playlistsAll({ signal } = {}) {
      const items = [];
      const seen = new Set();
      let offset = 0;
      for (;;) {
        signal?.throwIfAborted();
        const params = new URLSearchParams({ limit: '100', offset: String(offset) });
        const page = await requestFrom(baseUrl, '/api/qishui/library/playlists?' + params, undefined, 12000, signal);
        if (!Array.isArray(page?.items)) throw new Error('汽水歌单列表返回的数据不完整，请重试。');
        for (const item of page.items) {
          const id = String(item?.id ?? '');
          if (!/^\d{1,30}$/.test(id) || seen.has(id)) continue;
          seen.add(id);
          items.push({ ...item, id });
        }
        const nextOffset = Number(page.nextOffset);
        if (page.hasMore !== true) {
          return { items, hasMore: false, nextOffset: Number.isSafeInteger(nextOffset) && nextOffset >= offset ? nextOffset : offset + page.items.length };
        }
        if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > 50000) {
          throw new Error('汽水歌单列表无法继续翻页，请重试。');
        }
        offset = nextOffset;
      }
    }

    async function likedAll({ signal, onProgress } = {}) {
      const items = [];
      const seen = new Set();
      let offset = 0, snapshot = '', total;
      async function readPage(refresh) {
        const params = new URLSearchParams({ limit: '25', offset: String(offset) });
        if (snapshot) params.set('snapshot', snapshot);
        if (refresh) params.set('refresh', '1');
        const wait = offset === 0 ? 45000 : 15000;
        return requestFrom(baseUrl, '/api/qishui/library/liked?' + params, undefined, wait, signal, wait);
      }
      for (;;) {
        signal?.throwIfAborted();
        let page;
        try {
          page = await readPage(offset === 0);
        } catch (error) {
          signal?.throwIfAborted();
          if (!(error instanceof TypeError || error?.code === 'timeout' || error?.status === 429 || error?.status >= 500)) throw error;
          page = await readPage(false);
        }
        signal?.throwIfAborted();
        if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.nextOffset) || !Number.isSafeInteger(page.total)
          || typeof page.snapshot !== 'string' || !/^[a-f0-9-]{36}$/.test(page.snapshot)) {
          throw new Error('本机音乐入口没有返回完整的收藏分页，请更新后重试。');
        }
        if ((snapshot && snapshot !== page.snapshot) || (total !== undefined && total !== page.total)
          || page.total < 0 || page.total > 50000 || page.nextOffset < offset || page.nextOffset > page.total
          || page.nextOffset - offset > 25 || (page.hasMore !== (page.nextOffset < page.total))
          || (page.hasMore && page.nextOffset === offset)
          || !Number.isSafeInteger(page.skipped) || page.skipped < 0 || page.items.length + page.skipped !== page.nextOffset - offset) {
          throw new Error('汽水音乐收藏分页有变动，请重新读取。');
        }
        total = page.total;
        snapshot = page.snapshot;
        offset = page.nextOffset;
        for (const item of page.items) {
          const track = normalizeTrack(item);
          if (!track || seen.has(track.mediaId)) continue;
          seen.add(track.mediaId);
          items.push({ ...track, liked: true });
        }
        onProgress?.({ scanned: offset, total, loaded: items.length });
        if (!page.hasMore) return { items, total, hasMore: false, nextOffset: offset, skipped: total - items.length };
      }
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
      get detectionState() { return detectionState; },
      async detect() {
        const generation = ++detectionGeneration;
        detectionController?.abort();
        const controller = new AbortController();
        detectionController = controller;
        detectionState = 'pending';
        try {
          const candidate = await Promise.any(candidates.map(async origin => {
            const data = await requestFrom(origin, '/health', undefined, Math.min(timeoutMs, 6500), controller.signal);
            if (data?.ok !== true || data?.companion !== true) {
              const error = new Error('这个网址不是本机音乐入口。');
              error.code = 'offline';
              throw error;
            }
            return origin;
          }));
          if (generation !== detectionGeneration) return false;
          baseUrl = candidate;
          available = true;
          detectionState = 'ready';
          return true;
        } catch (error) {
          if (generation !== detectionGeneration) return false;
          available = false;
          detectionState = error.errors?.some(item => item.code === 'timeout') ? 'timeout' : 'offline';
          return false;
        } finally {
          controller.abort();
          if (generation === detectionGeneration) detectionController = null;
        }
      },
      loginStatus: () => request('/api/qishui/login-status', undefined, 7000),
      loginStart: () => request('/api/qishui/login/start', {}, 15000),
      loginCheck: sessionId => request('/api/qishui/login/check', { sessionId }, 7000),
      logout: () => request('/api/qishui/logout', {}, 7000),
      search: query => request('/api/qishui/search', { query, limit: 30, offset: 0 }, 12000),
      discovery({ limit = 24, preference = 'familiar', signal } = {}) {
        const params = new URLSearchParams({ limit: String(limit), preference });
        return requestFrom(baseUrl, `/api/qishui/discovery?${params}`, undefined, 12000, signal);
      },
      async song(input) {
        const id = qishuiSongId(input);
        if (id) return request(`/api/qishui/songs/${id}`, undefined, 10000);
        const share = qishuiShareCode(input);
        if (share) return request(`/api/qishui/songs/resolve?share=${encodeURIComponent(share)}`, undefined, 10000);
        throw new Error('请输入汽水音乐的官方歌曲链接或歌曲 ID。');
      },
      charts({ country = 'cn', limit = 25, signal } = {}) {
        const params = new URLSearchParams({ country, limit: String(limit) });
        return requestFrom(baseUrl,'/api/discovery/charts?' + params,undefined,10000,signal);
      },
      matchChartTrack({ name, artist, duration, album }, { signal, includeCandidates } = {}) {
        const payload = { name, artist };
        if (Number.isFinite(duration) && duration > 0) payload.duration = duration;
        const albumName = typeof album === 'string' ? album.trim() : '';
        if (albumName) payload.album = albumName;
        if (includeCandidates === true) payload.includeCandidates = true;
        return requestFrom(baseUrl, '/api/discovery/charts/match', payload, 10000, signal);
      },
      musicVideos(query, { country = 'cn', limit = 20, signal } = {}) {
        const params = new URLSearchParams({ query, country, limit: String(limit) });
        return requestFrom(baseUrl,'/api/discovery/music-videos?' + params,undefined,10000,signal);
      },
      playableVideos(query,{source='commons',limit=20,signal}={}) {
        const params=new URLSearchParams({query,source,limit:String(limit)});
        return requestFrom(baseUrl,'/api/discovery/playable-videos?'+params,undefined,10000,signal);
      },
      searchByProvider(provider, query, { signal } = {}) {
        if (provider !== PROVIDER && !Object.hasOwn(EXTERNAL_PROVIDERS, provider)) return Promise.reject(new Error('不支持这个音乐平台。'));
        return requestFrom(baseUrl, `/api/${provider}/search`, { query, limit: 30, offset: 0 }, 12000, signal);
      },
      liked: () => request('/api/qishui/library/liked?limit=50&offset=0', undefined, 12000),
      likedAll,
      playlists: () => request('/api/qishui/library/playlists?limit=50&offset=0', undefined, 12000),
      playlistsAll,
      playlist: id => playlistPage(id),
      playlistAllTracks,
      lyrics: (id,{signal}={}) => requestFrom(baseUrl,`/api/qishui/songs/${encodeURIComponent(id)}/lyrics`,undefined,10000,signal),
      audio: (mediaId, { signal } = {}) => requestFrom(baseUrl, `/api/qishui/tracks/${encodeURIComponent(mediaId)}/audio`, {}, 15000, signal),
      coverUrl,
      like: (mediaId, liked) => request('/api/qishui/like', { id: mediaId, liked }, 12000),
      playlistEdit: (operation, id, ids) => request(`/api/qishui/playlist/${operation}`, { id, ids }, 12000),
      resolveUrl,
    };
  }

  return {
    PROVIDER,
    EXTERNAL_PROVIDERS,
    officialTrackUrl,
    normalizeExternalTrack,
    normalizeTrack,
    migrateLegacyLink,
    mergeTracks,
    persistentTrack,
    parseLrc,
    activeLyric,
    companionBaseUrls,
    createClient,
    qishuiSongId,
    isQishuiShareLink,
    safeHttpsUrl,
  };
});
