(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./lyric-karaoke.js'));
  } else {
    root.SonicTrackEnrichment = factory(root.SonicLyricKaraoke);
  }
})(typeof globalThis === 'object' ? globalThis : this, function (karaoke) {
  'use strict';

  const COVER_DOMAINS = ['douyinpic.com', 'douyinstatic.com', 'byteimg.com', 'qishui.com', 'douyin.com'];
  const MAX_DURATION_DIFFERENCE = 2;
  const MAX_LYRIC_LENGTH = 250000;
  const LYRIC_END_TOLERANCE = .5;
  const LYRIC_MARKUP = /<(?:\/?[A-Za-z]|[\d!?])[^<>]*>|<!--|\(\d{1,10},\d{1,10}(?:,\d+)?\)/;
  const AUDIO_EXTENSION = /\.(?:mp3|wav|ogg|m4a|aac|flac|opus|webm|aif|aiff|mp4)$/i;
  const LYRIC_CLIENT = 'Sonic Universe/0.39 (https://github.com/Hgb-2005/sonic-universe)';
  let lyricQueue = Promise.resolve(), nextLookup = 0;

  function label(value) {
    if (typeof value !== 'string' || value.length > 240 || /[\x00-\x1f\x7f]/.test(value)) return '';
    return value.trim();
  }

  function key(value) {
    return label(value).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
  }

  function artistKey(value) {
    return key(value).replace(/\s*、\s*|\s+&\s+/g, '、');
  }

  function localIdentity(track) {
    const name = label(track?.name), artist = label(track?.artist), duration = Number(track?.duration);
    if (track?.kind !== 'file' || !name || !(duration > 0 && duration < 86400)) return null;
    if (artist) return { name, artist, duration, inferred: false };

    const source = track.sourcePath || track.blob?.name;
    if (typeof source !== 'string') return null;
    const basename = source.split(/[\\/]/).at(-1);
    if (!AUDIO_EXTENSION.test(basename) || label(basename.replace(AUDIO_EXTENSION, '')) !== name) return null;
    const parts = name.split(/ +\- +/).map(label);
    if (parts.length !== 2 || parts.some(part => !part)) return null;
    return { name: parts[1], artist: parts[0], duration, inferred: true };
  }

  function coverUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
      if (!COVER_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function validatedPoints(line, end) {
    const length = Array.from(line.text).length;
    const points = [];
    for (const [index, point] of line.points.entries()) {
      const previous = points.at(-1);
      const explicitEnd = point.end !== undefined;
      const stop = explicitEnd ? point.end : (line.points[index + 1]?.time ?? end);
      if (!Number.isInteger(point.index) || point.index <= (previous?.index ?? -1) || point.index >= length
        || !Number.isFinite(point.time) || point.time < (previous?.time ?? line.time) || point.time >= end
        || !Number.isFinite(stop) || stop <= point.time || stop > end + LYRIC_END_TOLERANCE) return [];
      points.push(explicitEnd ? { ...point, end: Math.min(stop, end) } : point);
    }
    return points;
  }

  function resolveTimedLyrics(data, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const sources = typeof data === 'string' ? [data] : [
      data?.krc, data?.yrc, data?.qrc, data?.ttml, data?.vtt, data?.raw,
      data?.timedLrc, data?.syncedLyrics, data?.lrc,
    ];
    let fallback = null;
    for (const raw of new Set(sources)) {
      if (typeof raw !== 'string' || !raw || raw.length > MAX_LYRIC_LENGTH
        || /^\s*krc1/i.test(raw) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw)) continue;
      let parsed;
      try { parsed = karaoke.parse(raw); }
      catch { continue; }
      if (parsed.some(line => LYRIC_MARKUP.test(line.text) || LYRIC_MARKUP.test(line.translation || ''))) continue;
      const bounded = parsed.filter(line => line.text?.trim() && Number.isFinite(line.time)
        && line.time >= 0 && line.time < duration && (line.end === undefined
          || (Number.isFinite(line.end) && line.end > line.time && line.end <= duration + LYRIC_END_TOLERANCE)));
      if (!bounded.length) continue;
      const lines = bounded.map((line, index) => {
        const end = Math.min(duration, line.end ?? bounded[index + 1]?.time ?? duration);
        const points = validatedPoints(line, end);
        return line.end === undefined ? { ...line, points } : { ...line, end, points };
      });
      if (lines.some(line => line.points.length)) return { raw, lines, timing: 'word' };
      const hasInvalidMarks = bounded.some(line => line.points.length);
      if (!fallback && !hasInvalidMarks && !/^\s*\[\d{1,10},\d{1,10}\]/m.test(raw)) {
        fallback = { raw, lines, timing: 'line' };
      }
    }
    return fallback;
  }

  function authExpired(error) {
    return error?.status === 401 || error?.code === 'auth-required';
  }

  function findTimedLyrics({ name, artist, album, duration }, signal, { reportUnavailable = false } = {}) {
    if (!label(name)||!label(artist)||!(duration >= 1 && duration <= 3600)) return Promise.resolve('');
    const lookup = lyricQueue.then(async () => {
      const wait = nextLookup - Date.now();
      if (wait > 1000) {
        if (reportUnavailable) throw Object.assign(new Error('歌词服务暂不可用。'), { status: 429 });
        return '';
      }
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      signal?.throwIfAborted();
      const url = new URL('https://lrclib.net/api/get');
      url.search = new URLSearchParams({track_name:name,artist_name:artist,duration:String(Math.round(duration))});
      if (label(album)) url.searchParams.set('album_name', album);
      try {
        const response = await fetch(url, { credentials:'omit', redirect:'error', headers:{'Lrclib-Client':LYRIC_CLIENT}, signal:AbortSignal.any([signal,AbortSignal.timeout(6000)].filter(Boolean)) });
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After');
          const seconds = Number(retry);
          const deadline = retry && Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry);
          const delay = Math.max(30000, (deadline || 0)-Date.now());
          nextLookup = Date.now()+delay*(1+Math.random()*.2);
        }
        if (!response.ok) {
          if (reportUnavailable && (response.status === 429 || response.status >= 500)) {
            throw Object.assign(new Error('歌词服务暂不可用。'), { status: response.status });
          }
          return '';
        }
        const match = await response.json();
        if (key(match.trackName)!==key(name)||artistKey(match.artistName)!==artistKey(artist)||
          Math.abs(Number(match.duration)-duration)>MAX_DURATION_DIFFERENCE||!Number.isFinite(Number(match.duration))||
          (label(album)&&key(match.albumName)!==key(album))) return '';
        const raw = match.syncedLyrics;
        return typeof raw === 'string' && raw.length <= 160000
          ? resolveTimedLyrics(raw, duration)?.raw || '' : '';
      } catch(error) {
        if(!signal?.aborted&&!error?.status)nextLookup=Math.max(nextLookup, Date.now()+15000);
        throw error;
      } finally {
        nextLookup = Math.max(nextLookup, Date.now()+750);
      }
    });
    lyricQueue = lookup.catch(()=>{});
    return lookup;
  }

  async function enrichLocalTrack(track, { client, includeLyrics = true, signal } = {}) {
    signal?.throwIfAborted();
    const identity = localIdentity(track);
    if (!identity) return { status: 'insufficient' };
    if (typeof client?.loginStatus !== 'function' || typeof client.matchChartTrack !== 'function') {
      throw Object.assign(new Error('请先连接本机音乐入口。'), { code: 'unavailable' });
    }
    const { name, artist, duration, inferred } = identity;
    const album = label(track.album);
    let candidate;
    try {
      const authorization = await client.loginStatus();
      signal?.throwIfAborted();
      if (authorization?.authenticated !== true) return { status: 'unauthenticated' };
      const match = await client.matchChartTrack({ name, artist, duration, ...(album?{album}:{}) }, { signal });
      signal?.throwIfAborted();
      candidate = match?.item;
    } catch (error) {
      signal?.throwIfAborted();
      if (authExpired(error)) return { status: 'unauthenticated' };
      throw error;
    }

    const mediaId = candidate?.mediaId;
    const candidateDuration = Number(candidate?.duration);
    if (candidate?.provider !== 'qishui' || typeof mediaId !== 'string' || !/^\d{1,30}$/.test(mediaId)
      || key(candidate.name) !== key(name) || artistKey(candidate.artist) !== artistKey(artist)
      || !(candidateDuration > 0 && Math.abs(candidateDuration - duration) <= MAX_DURATION_DIFFERENCE)
      || (album && key(candidate.album) !== key(album))) {
      return { status: 'no-match' };
    }

    const result = {
      status: 'matched', source: 'qishui', mediaId, name, artist, inferred,
      album: album ? '' : label(candidate.album),
      cover: track.cover ? null : coverUrl(candidate.cover),
      lyricsRaw: '', lyricsStatus: 'skipped',
    };
    if (!includeLyrics) return result;
    result.lyricsStatus = 'unavailable';
    if (typeof client.lyrics !== 'function') return result;
    try {
      const data = await client.lyrics(mediaId);
      signal?.throwIfAborted();
      result.lyricsRaw = resolveTimedLyrics(data, duration)?.raw || '';
      result.lyricsStatus = result.lyricsRaw ? 'available' : 'not-found';
    } catch (error) {
      signal?.throwIfAborted();
      if (authExpired(error)) return { status: 'unauthenticated' };
      if (error?.status === 404 || error?.code === 'not-found') result.lyricsStatus = 'not-found';
    }
    return result;
  }

  return { enrichLocalTrack, findTimedLyrics, localIdentity, resolveTimedLyrics };
});
