'use strict';

const { createQishuiApi, createQishuiDeviceId } = require('qishui-music-api');
const { EncryptedQishuiSessionStore } = require('../session-store.cjs');

const MAX_TEXT = 180;
const DEFAULT_COVER_TEMPLATE = 'tplv-b829550vbb';
const COVER_SIZE = 360;

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : fallback;
}

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function coverTemplate(raw) {
  if (raw && typeof raw === 'object') {
    const prefix = typeof raw.template_prefix === 'string' ? raw.template_prefix.trim() : '';
    if (/^[a-z0-9_-]{1,120}$/i.test(prefix)) return prefix;
    const template = typeof raw.template === 'string' ? raw.template.trim() : '';
    const match = /^~([a-z0-9_-]{1,120})(?:-|$)/i.exec(template);
    if (match) return match[1];
  }
  return DEFAULT_COVER_TEMPLATE;
}

function completeCoverUrl(value, template = DEFAULT_COVER_TEMPLATE) {
  const url = httpsUrl(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/^p\d+-luna\.douyinpic\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith('/img/')) return url;
    if (parsed.pathname.includes('~tplv-')) return url;
    parsed.pathname += `~${template}-resize:${COVER_SIZE}:${COVER_SIZE}.image`;
    return httpsUrl(parsed.toString());
  } catch {
    return null;
  }
}

function coverUrl(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return completeCoverUrl(raw);
  const base = Array.isArray(raw.urls) ? raw.urls.find(item => typeof item === 'string') : '';
  if (!base) return null;
  if (typeof raw.uri !== 'string') return completeCoverUrl(base, coverTemplate(raw));
  try {
    return completeCoverUrl(
      new URL(raw.uri, base.endsWith('/') ? base : `${base}/`).toString(),
      coverTemplate(raw),
    );
  } catch {
    return null;
  }
}

function artists(raw) {
  const links = raw?.related_info?.artist_links;
  if (!Array.isArray(links)) return '';
  return links.map(item => text(item?.name)).filter(Boolean).join('、').slice(0, 240);
}

function normalizeTrack(value) {
  const raw = value?.track_entity || value?.entity?.media?.track_entity || value?.track || value;
  const base = raw?.base_info || {};
  const related = raw?.related_info || {};
  const display = raw?.display_info || {};
  const id = String(base.id || raw?.id || '');
  if (!/^\d{1,30}$/.test(id)) return null;
  const durationMs = Number(base.duration_ms || base.duration || 0);
  const rawCover = display.cover_url || related.album_link?.cover_url || raw.cover_url;
  return {
    provider: 'qishui',
    mediaId: id,
    name: text(base.name, '未命名歌曲'),
    artist: artists(raw),
    album: text(related.album_link?.name),
    duration: Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0,
    cover: coverUrl(rawCover),
    externalUrl: `https://qishui.douyin.com/song/${encodeURIComponent(id)}`,
  };
}

function normalizePlaylist(value) {
  const raw = value?.playlist?.base_info || value?.playlist?.id ? value.playlist : value;
  const base = raw?.base_info || raw;
  const id = String(base?.id || '');
  if (!/^\d{1,30}$/.test(id)) return null;
  return {
    provider: 'qishui',
    id,
    name: text(base?.name, '未命名歌单'),
    cover: coverUrl(base?.cover_url || raw?.cover_url),
    description: text(base?.desc || base?.description),
    trackCount: Math.max(0, Number(base?.track_count || raw?.track_count || 0) || 0),
    ownerId: String(base?.owner_id || raw?.owner_id || ''),
  };
}

function krcToLrc(source) {
  if (typeof source !== 'string') return '';
  const result = [];
  for (const line of source.replace(/\r/g, '').split('\n').slice(0, 3000)) {
    const match = /^\s*\[(\d{1,10}),(\d{1,10})\](.*)$/.exec(line);
    if (!match) continue;
    const start = Math.min(Number(match[1]), 24 * 60 * 60 * 1000);
    if (!Number.isFinite(start)) continue;
    const lyric = match[3].replace(/<\d+,\d+(?:,\d+)?>/g, '').trim();
    const minutes = Math.floor(start / 60000);
    const seconds = Math.floor(start % 60000 / 1000);
    const centis = Math.floor(start % 1000 / 10);
    result.push(`[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}]${lyric}`);
  }
  return result.join('\n');
}

function lyricData(value) {
  const info = value?.lyric_info || value;
  const entity = info?.lyric_entity || info?.lyricEntity || {};
  const content = entity.content || entity.lyric_content || info?.content || '';
  const type = text(entity.type || info?.type).toLowerCase();
  const raw = typeof content === 'string' ? content : '';
  return {
    type,
    lrc: type === 'lrc' ? raw : krcToLrc(raw),
  };
}

function loginQrKey(value) {
  const key = typeof value?.key === 'string' ? value.key.trim().toLowerCase() : '';
  return /^[a-f0-9]{32}$/.test(key) ? key : '';
}

async function createQishuiProvider(options = {}) {
  const sessions = await new EncryptedQishuiSessionStore({
    directory: options.dataDirectory,
    onError: options.onError,
  }).init(createQishuiDeviceId);
  const api = createQishuiApi({
    deviceId: sessions.deviceId,
    sessions,
    fetch: options.fetch || globalThis.fetch,
    log() {},
    warn() {},
  });
  const request = async (operation, params = {}) => {
    const result = await api.request(operation, params);
    if (!result.ok) {
      const error = new Error(result.error?.message || 'Music service request failed');
      error.code = result.error?.code || 'unavailable';
      error.status = error.code === 'auth-required' ? 401 : error.code === 'unsupported' ? 422 : 502;
      throw error;
    }
    return result.data;
  };
  const pageParams = input => ({
    limit: Math.min(50, Math.max(1, Number(input?.limit) || 20)),
    offset: Math.max(0, Number(input?.offset) || 0),
  });

  return {
    async authStatus() {
      if (!sessions.get()) return { authenticated: false };
      await request('login_status');
      const session = sessions.get();
      if (!session) return { authenticated: false };
      return {
        authenticated: true,
        user: {
          nickname: text(session.user?.nickname, '汽水音乐用户'),
          avatar: httpsUrl(typeof session.user?.avatar === 'string' ? session.user.avatar : ''),
          isVip: session.user?.isVip === true,
        },
      };
    },
    async loginStart() {
      const loginKey = await request('login_qr_key');
      const key = loginQrKey(loginKey);
      const qr = await request('login_qr_create', { key });
      const sessionId = key;
      const imageUrl = typeof qr?.imageUrl === 'string' ? qr.imageUrl : '';
      if (!sessionId || !imageUrl) {
        const error = new Error('Qishui login QR could not be created');
        error.code = 'invalid-response';
        throw error;
      }
      return { sessionId, qrImage: imageUrl };
    },
    async loginCheck(sessionId) {
      return request('login_qr_check', { key: String(sessionId || '') });
    },
    async logout() {
      await request('logout');
      return { ok: true };
    },
    async search(input) {
      const query = text(input?.query);
      if (!query) return { items: [], hasMore: false };
      const data = await request('search', { query, ...pageParams(input) });
      return {
        items: Array.isArray(data?.items) ? data.items.map(normalizeTrack).filter(Boolean) : [],
        hasMore: data?.hasMore === true,
        nextOffset: Number(data?.nextOffset || 0),
      };
    },
    async liked(input) {
      const data = await request('liked_songs');
      const ids = Array.isArray(data?.ids) ? data.ids.slice(pageParams(input).offset, pageParams(input).offset + pageParams(input).limit) : [];
      const tracks = await Promise.all(ids.map(async id => {
        try { return normalizeTrack(await request('song_detail', { id })); } catch { return null; }
      }));
      return { items: tracks.filter(Boolean), hasMore: data?.whole !== true, total: Number(data?.total || ids.length) };
    },
    async playlists(input) {
      const data = await request('user_playlists', pageParams(input));
      return {
        items: Array.isArray(data?.items) ? data.items.map(normalizePlaylist).filter(Boolean) : [],
        hasMore: data?.hasMore === true,
        nextOffset: Number(data?.nextOffset || 0),
      };
    },
    async playlist(id, input) {
      const data = await request('playlist_tracks', { id: String(id || ''), ...pageParams(input) });
      return {
        playlist: normalizePlaylist(data?.collection),
        items: Array.isArray(data?.items) ? data.items.map(normalizeTrack).filter(Boolean) : [],
        hasMore: data?.hasMore === true,
        nextOffset: Number(data?.nextOffset || 0),
      };
    },
    async lyrics(id) {
      return lyricData(await request('lyrics', { id: String(id || '') }));
    },
    async cover(id) {
      const track = normalizeTrack(await request('song_detail', { id: String(id || '') }));
      if (!track?.cover) {
        const error = new Error('Qishui cover art is not available');
        error.code = 'not-found';
        error.status = 404;
        throw error;
      }
      return { url: track.cover };
    },
    async audio(id) {
      const source = await request('audio', { id: String(id || ''), quality: 'standard' });
      const url = httpsUrl(source?.url);
      if (!url) {
        const error = new Error('Protected Qishui audio is not available for in-app playback');
        error.code = 'not-playable';
        error.status = 422;
        throw error;
      }
      return {
        mediaUrl: url,
        quality: text(source.quality, 'standard'),
        fetchedAt: Number(source.fetchedAt || Date.now()),
        expiresAt: Number(source.expiresAt || 0),
        preview: source.preview === true,
        clipStartMs: Number(source.clipStartMs || 0),
      };
    },
    async like(id, liked) {
      await request('like_song', { id: String(id || ''), liked: liked === true });
      return { ok: true };
    },
    async playlistEdit(operation, id, ids) {
      await request(operation === 'add' ? 'playlist_add_tracks' : 'playlist_remove_tracks', {
        id: String(id || ''),
        ids: Array.isArray(ids) ? ids.map(String).slice(0, 100) : [],
      });
      return { ok: true };
    },
  };
}

module.exports = {
  createQishuiProvider,
  krcToLrc,
  loginQrKey,
  lyricData,
  normalizeTrack,
  normalizePlaylist,
  coverUrl,
};
