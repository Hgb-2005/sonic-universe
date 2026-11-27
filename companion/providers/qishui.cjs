'use strict';

const { randomUUID } = require('node:crypto');
const { EncryptedQishuiSessionStore } = require('../session-store.cjs');

const MAX_TEXT = 180;
const MAX_LYRIC_LENGTH = 250000;
const DEFAULT_COVER_TEMPLATE = 'tplv-b829550vbb';
const COVER_SIZE = 360;
const LIKED_SNAPSHOT_TTL = 5 * 60 * 1000;
const LIKED_TRACK_BATCH_SIZE = 6;
const LIKED_OFFSET_LIMIT = 50000;

function likedError(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

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

function krcToLrc(source, timedWords = false) {
  if (typeof source !== 'string') return '';
  const timestamp = (ms) => [
    String(Math.floor(ms / 60000)).padStart(2, '0'),
    String(Math.floor(ms % 60000 / 1000)).padStart(2, '0') + '.' +
      String(Math.floor(ms % 1000 / (timedWords ? 1 : 10))).padStart(timedWords ? 3 : 2, '0'),
  ].join(':');
  const result = [];
  for (const line of source.replace(/\r/g, '').split('\n').slice(0, 3000)) {
    const match = /^\s*\[(\d{1,10}),(\d{1,10})\](.*)$/.exec(line);
    if (!match) continue;
    const start = Math.min(Number(match[1]), 24 * 60 * 60 * 1000);
    if (!Number.isFinite(start)) continue;
    const lyric = match[3].replace(/<(\d{1,10}),\d+(?:,\d+)?>/g, (_, offset) =>
      timedWords ? '<' + timestamp(Math.min(24 * 60 * 60 * 1000, start + Number(offset))) + '>' : '').trim();
    result.push(`[${timestamp(start)}]${lyric}`);
  }
  return result.join('\n');
}

function lyricData(value) {
  const info = value?.lyric_info || value;
  const entity = info?.lyric_entity || info?.lyricEntity || {};
  const content = entity.content || entity.lyric_content || info?.content || '';
  const type = text(entity.type || info?.type).toLowerCase();
  const raw = typeof content === 'string' ? content : '';
  const generic = type !== 'lrc' && raw.length <= MAX_LYRIC_LENGTH
    && /^\s*(?:<|WEBVTT(?:\s|$))/.test(raw);
  return {
    type,
    lrc: type === 'lrc' ? raw : krcToLrc(raw),
    timedLrc: type === 'lrc' ? undefined : krcToLrc(raw, true),
    krc: type !== 'lrc' && /^\s*\[\d{1,10},\d{1,10}\]/m.test(raw) ? raw.slice(0, MAX_LYRIC_LENGTH) : undefined,
    ...(generic ? { raw } : {}),
  };
}

function loginQrKey(value) {
  const key = typeof value?.key === 'string' ? value.key.trim().toLowerCase() : '';
  return /^[a-f0-9]{32}$/.test(key) ? key : '';
}

async function sharedSongId(code, fetchImpl) {
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(code)) {
    throw Object.assign(new Error('汽水音乐分享链接格式有误。'), { code: 'invalid-share', status: 400 });
  }
  const shortUrl = `https://qishui.douyin.com/s/${code}/`;
  let response;
  try {
    response = await fetchImpl(shortUrl, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError';
    throw Object.assign(new Error('暂时无法读取汽水音乐分享链接，请稍后重试。'), {
      code: timedOut ? 'upstream-timeout' : 'upstream-unavailable', status: timedOut ? 504 : 502,
    });
  }
  const location = response.headers.get('location');
  await response.body?.cancel().catch(() => {});
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    try {
      const target = new URL(location, shortUrl);
      if (target.protocol === 'https:' && !target.username && !target.password && !target.port) {
        const canonical = target.hostname === 'qishui.douyin.com' ? /^\/song\/(\d{1,30})\/?$/.exec(target.pathname)?.[1] : '';
        const shared = target.hostname === 'music.douyin.com' && target.pathname === '/qishui/share/track' ? target.searchParams.get('track_id') : '';
        const id = canonical || shared;
        if (/^\d{1,30}$/.test(id || '')) return id;
      }
    } catch {}
  }
  throw Object.assign(new Error('这条汽水音乐分享链接已失效，或对应的内容不是单首歌曲。'), { code: 'not-found', status: 404 });
}

async function createQishuiProvider(options = {}) {
  const { createQishuiApi, createQishuiDeviceId } = require('qishui-music-api');
  const fetchImpl = options.fetch || globalThis.fetch;
  const sessions = await new EncryptedQishuiSessionStore({
    directory: options.dataDirectory,
    onError: options.onError,
  }).init(createQishuiDeviceId);
  const api = createQishuiApi({
    deviceId: sessions.deviceId,
    sessions,
    fetch: fetchImpl,
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
  const pageParams = (input, maxLimit = 50) => ({
    limit: Math.min(maxLimit, Math.max(1, Number(input?.limit) || 20)),
    offset: Math.max(0, Number(input?.offset) || 0),
  });
  const song = async id => {
    const item = normalizeTrack(await request('song_detail', { id: String(id || '') }));
    if (!item) throw Object.assign(new Error('没有找到这首汽水音乐。'), { code: 'not-found', status: 404 });
    return { item };
  };
  let likedRevision = 0;
  let likedSnapshot;
  let likedPending;
  function clearLikedSnapshot() {
    likedRevision++;
    likedSnapshot = null;
    likedPending = null;
  }
  function assertLikedAccount(account, revision) {
    if (!sessions.get()) throw likedError('请先扫码登录汽水音乐。', 'auth-required', 401);
    if (sessions.get()?.userId !== account || likedRevision !== revision) {
      throw likedError('汽水收藏已变更，请重新读取。', 'liked-list-changed', 409);
    }
  }
  async function getLikedSnapshot(account, revision, token, refresh) {
    if (likedSnapshot?.account === account && likedSnapshot.expiresAt > Date.now()
      && (token === likedSnapshot.id || (!token && !refresh))) return likedSnapshot;
    if (token) throw likedError('汽水收藏的分页已过期，请重新读取。', 'liked-list-changed', 409);
    if (likedPending?.account === account && likedPending.revision === revision) return likedPending.promise;
    const pending = { account, revision };
    pending.promise = (async () => {
      const data = await request('liked_songs');
      assertLikedAccount(account, revision);
      if (data?.whole !== true || !Array.isArray(data.ids)
        || data.ids.some(id => typeof id !== 'string' || !/^\d{1,30}$/.test(id))) {
        throw likedError('汽水音乐未返回完整收藏列表，请重试。', 'liked-incomplete', 502);
      }
      const ids = [...new Set(data.ids)];
      if (ids.length > LIKED_OFFSET_LIMIT) {
        throw likedError('汽水收藏数量超过目前支持的读取范围。', 'liked-limit', 422);
      }
      likedSnapshot = { account, ids, id: randomUUID(), expiresAt: Date.now() + LIKED_SNAPSHOT_TTL };
      return likedSnapshot;
    })().finally(() => { if (likedPending === pending) likedPending = null; });
    likedPending = pending;
    return pending.promise;
  }

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
      const result = await request('login_qr_check', { key: String(sessionId || '') });
      if (result?.state === 'confirmed') clearLikedSnapshot();
      return result;
    },
    async loginCancel(sessionId) {
      await request('login_qr_cancel', { key: String(sessionId || '') });
      return { ok: true };
    },
    async logout() {
      clearLikedSnapshot();
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
    async discovery(input = {}) {
      if (!sessions.get()) {
        throw Object.assign(new Error('请先扫码登录汽水音乐，再查看个人推荐。'), {
          code: 'auth-required', status: 401,
        });
      }
      const mode = input.preference ?? 'familiar';
      if (!['familiar', 'fresh', 'default'].includes(mode)) {
        throw Object.assign(new Error('不支持这个推荐模式。'), { code: 'invalid-preference', status: 400 });
      }
      const { limit } = pageParams({ limit: input.limit ?? 24 }, 30);
      const data = await request('feed', {
        queue: 'explore',
        limit: Math.trunc(limit),
        first: true,
        ...(mode === 'default' ? {} : { preference: mode }),
      });
      const seen = new Set();
      const items = (Array.isArray(data?.items) ? data.items : []).map(normalizeTrack)
        .filter(track => track && !seen.has(track.mediaId) && seen.add(track.mediaId)).slice(0, limit);
      return { provider: 'qishui', mode, items };
    },
    song,
    async songFromShare(code) { return song(await sharedSongId(code, fetchImpl)); },
    async liked(input) {
      const account = sessions.get()?.userId;
      if (!account) throw likedError('请先扫码登录汽水音乐。', 'auth-required', 401);
      const limit = Number(input?.limit ?? 20), offset = Number(input?.offset ?? 0);
      const token = input?.snapshot ?? '';
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50
        || !Number.isSafeInteger(offset) || offset < 0 || offset > LIKED_OFFSET_LIMIT
        || typeof token !== 'string' || (token && !/^[a-f0-9-]{36}$/.test(token))) {
        throw likedError('汽水收藏分页参数不正确。', 'invalid-liked-page', 400);
      }
      const revision = likedRevision;
      const snapshot = await getLikedSnapshot(account, revision, token, input?.refresh === true);
      if (offset > snapshot.ids.length) throw likedError('汽水收藏已变更，请重新读取。', 'liked-list-changed', 409);
      const ids = snapshot.ids.slice(offset, offset + limit);
      const items = [];
      for (let index = 0; index < ids.length; index += LIKED_TRACK_BATCH_SIZE) {
        assertLikedAccount(account, revision);
        const tracks = await Promise.all(ids.slice(index, index + LIKED_TRACK_BATCH_SIZE).map(async id => {
          try {
            const track = normalizeTrack(await request('song_detail', { id }));
            if (track?.mediaId !== id) throw likedError('汽水音乐返回的收藏歌曲信息不完整。', 'liked-invalid-track', 502);
            return { ...track, liked: true };
          } catch (error) {
            if (error?.code === 'not-playable' || error?.code === 'not-found') return null;
            throw error;
          }
        }));
        items.push(...tracks.filter(Boolean));
      }
      assertLikedAccount(account, revision);
      const nextOffset = offset + ids.length, total = snapshot.ids.length;
      return { items, hasMore: nextOffset < total, nextOffset, total, snapshot: snapshot.id, skipped: ids.length - items.length };
    },
    async playlists(input) {
      const { limit, offset } = pageParams(input, 100);
      const data = await request('user_playlists', { limit: Math.trunc(limit), offset: Math.trunc(offset) });
      return {
        items: Array.isArray(data?.items) ? data.items.map(normalizePlaylist).filter(Boolean) : [],
        hasMore: data?.hasMore === true,
        nextOffset: Number(data?.nextOffset || 0),
      };
    },
    async playlist(id, input) {
      const { limit, offset } = pageParams(input, 100);
      const data = await request('playlist_tracks', {
        id: String(id || ''),
        limit: Math.trunc(limit),
        offset: Math.trunc(offset),
        ownerId: input?.ownerId || '',
      });
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
    async audio(id, quality = 'standard') {
      const source = await request('audio', { id: String(id || ''), quality });
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
      try { await request('like_song', { id: String(id || ''), liked: liked === true }); }
      finally { clearLikedSnapshot(); }
      return { ok: true };
    },
    async playlistEdit(operation, id, ids) {
      try {
        await request(operation === 'add' ? 'playlist_add_tracks' : 'playlist_remove_tracks', {
          id: String(id || ''),
          ids: Array.isArray(ids) ? ids.map(String).slice(0, 100) : [],
        });
      } finally { clearLikedSnapshot(); }
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
