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

  const versionMarkers=[
    ['现场版',/现场版|現場版|现场录音|現場錄音|演唱[会會]|\blive (?:at|from|version|recording|album)\b|(?:^|[-–—(\[（【]\s*|\s)live(?:\s*[)\]）】]|$)/i],
    ['翻唱版',/翻唱|\bcover\b/i],
    ['录音室版',/录音室版|\bstudio (?:version|recording)\b/i],
    ['伴奏版',/伴奏版|纯伴奏|[（(\s]伴奏(?:[)）\s]|$)|\binstrumental\b|\bkaraoke\b/i],
    ['重制版',/重制版|\bremaster(?:ed)?\b/i],
    ['混音版',/混音版|\bremix\b/i],
  ];

  function recordingVersion({name, artist, album, duration}) {
    if (!artist || !album || !(duration > 0)) return '版本待确认';
    // A provider's title alone can contain promotional text such as “原唱”.
    // Require the album to corroborate a version indicated by the title.
    const matches = versionMarkers.filter(([, marker]) => marker.test(name) && marker.test(album));
    return matches.length === 1 ? matches[0][0] : '版本待确认';
  }

  function searchRecordingVersion(track) {
    const version=recordingVersion(track);
    return version==='版本待确认'||[track.name,track.album].some(value=>text(value).includes(version))?'':version;
  }

  function recordingKey(value) {
    return text(value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function recordingAlbum(value) {
    const album=recordingKey(value);
    return /^\[?(?:unknown album|未知专辑|未知專輯)\]?$/.test(album)?'':album;
  }

  function recordingVersions(track) {
    return versionMarkers.filter(([,marker])=>[track.name,track.album,track.version].some(value=>marker.test(text(value))))
      .map(([label])=>label);
  }

  const searchVersionTerms = new Map([
    ['live','现场版'],['现场','现场版'],['現場','现场版'],['现场版','现场版'],['現場版','现场版'],
    ['dj','DJ 版'],['dj版','DJ 版'],['remix','混音版'],['混音','混音版'],['混音版','混音版'],
  ]);
  const djMarker = /\bdj(?:\s*版|\b)/i;
  const artistSeparator = /[、,;\/&]+/;

  function searchPhrase(value) {
    return recordingKey(value)
      .replace(/[\s,、;|/\\·()[\]【】]+/g,' ')
      .replace(/\s+[-–—]+\s*|[-–—]+\s+|(?<=\p{Script=Han})[-–—]+|[-–—]+(?=\p{Script=Han})/gu,' ')
      .replace(/\s+/g,' ').trim();
  }

  function searchVersionAnnotation(value) {
    return versionMarkers.some(([,marker])=>marker.test(value))||
      /\bdj\s*(?:版|mix\b|version\b)/i.test(value)||searchVersionTerms.has(value.trim());
  }

  function searchTitle(name) {
    const title = recordingKey(name);
    const bracket = /[\[（(【]([^\])）】]+)[\])）】]$/.exec(title);
    if(bracket&&searchVersionAnnotation(bracket[1]))return searchPhrase(title.slice(0,bracket.index));
    const dash=[...title.matchAll(/\s+[-–—]+\s+/g)].at(-1);
    if(dash&&searchVersionAnnotation(title.slice(dash.index+dash[0].length)))return searchPhrase(title.slice(0,dash.index));
    return searchPhrase(title.replace(/(?:[\s\-–—]+(?:live|dj(?:\s+mix)?|remix|studio (?:version|recording)|cover)|(?:现场版|現場版|录音室版|翻唱版|混音版|dj版))$/i,''));
  }

  function searchVersions(entry,title) {
    const {track}=entry;
    // A word inside the matched song title is not evidence of an edition.
    const name=entry.base===title&&entry.title.startsWith(title+' ')?entry.title.slice(title.length+1):
      entry.title===title?'':track.name;
    const album=searchPhrase(track.album)===title?'':track.album;
    const labels=recordingVersions({name,album,version:track.version});
    if([name,album,track.version].some(value=>djMarker.test(recordingKey(value))))labels.push('DJ 版');
    return labels;
  }

  const trackSearchEntries=new WeakMap();
  function searchEntry(track) {
    const cached=trackSearchEntries.get(track);
    if(cached&&cached.name===track.name&&cached.artist===track.artist)return cached.entry;
    const title=searchPhrase(track.name),artist=recordingKey(track.artist);
    const entry={
      track,title,base:searchTitle(track.name),
      artists:new Set([searchPhrase(artist),...artist.split(artistSeparator).map(searchPhrase)].filter(Boolean)),
    };
    trackSearchEntries.set(track,{name:track.name,artist:track.artist,entry});
    return entry;
  }

  function searchIndex(entries) {
    const titles=new Set(),artists=new Set(),pairs=new Set();
    for(const entry of entries) {
      for(const title of [entry.title,entry.base]) {
        if(!title)continue;
        titles.add(title);
        for(const artist of entry.artists)pairs.add(title+'\0'+artist);
      }
      for(const artist of entry.artists)artists.add(artist);
    }
    return {titles,artists,pairs};
  }

  function songArtistQuery(phrase,{titles,artists,pairs}) {
    const words=phrase.split(' ');
    const literal=titles.has(phrase)||artists.has(phrase);
    let best=null, bestScore=0;
    for(let split=1;split<words.length;split++) {
      const first=words.slice(0,split).join(' '),last=words.slice(split).join(' ');
      for(const [title,artist] of [[first,last],[last,first]]) {
        const exact=pairs.has(title+'\0'+artist);
        if(literal&&!exact)continue;
        const score=(exact?4:0)+(titles.has(title)?2:0)+(artists.has(artist)?1:0);
        if(score>bestScore){best={title,artist,exact};bestScore=score;}
      }
    }
    return best;
  }

  function searchQuery(phrase,index) {
    const literal={term:phrase,pair:songArtistQuery(phrase,index),versions:[]};
    if(literal.pair?.exact||index.titles.has(phrase)||index.artists.has(phrase))return literal;

    const words=phrase.split(' '), versions=words.map(word=>searchVersionTerms.get(word));
    if(!versions.some(Boolean))return literal;
    const onlyVersions=(start,end)=>versions.slice(start,end).every(Boolean);
    const spans=[];
    for(let start=0;start<words.length;start++) {
      for(let end=start+1;end<=words.length;end++) {
        const value=words.slice(start,end).join(' ');
        const title=index.titles.has(value),artist=index.artists.has(value);
        if(title||artist)spans.push({start,end,value,title,artist});
      }
    }

    let best;
    function consider(first,second,pair,priority) {
      const length=first.end-first.start+(second?second.end-second.start:0);
      if(best&&(priority<best.priority||priority===best.priority&&length<=best.length))return;
      const extra=versions.slice(0,first.start);
      if(second)extra.push(...versions.slice(first.end,second.start));
      extra.push(...versions.slice((second||first).end));
      best={priority,length,term:second?first.value+' '+second.value:first.value,pair,versions:extra};
    }
    for(const first of spans) {
      if(!onlyVersions(0,first.start))continue;
      if(onlyVersions(first.end,words.length))consider(first,null,null,2);
      for(const second of spans) {
        if(second.start<first.end||!onlyVersions(first.end,second.start)||!onlyVersions(second.end,words.length))continue;
        for(const [title,artist] of [[first,second],[second,first]]) {
          if(!title.title||!artist.artist)continue;
          const exact=index.pairs.has(title.value+'\0'+artist.value);
          consider(first,second,{title:title.value,artist:artist.value},exact?3:1);
        }
      }
    }
    return best||literal;
  }

  function searchMatch(entry,phrase,pair) {
    if(!phrase)return 0;
    const title=pair?.title||phrase;
    const exactTitle=entry.title===title||entry.base===title;
    const partialTitle=entry.title.includes(title);
    const exactArtist=entry.artists.has(pair?.artist||phrase);
    if(pair) {
      if(exactTitle)return exactArtist?6:5;
      if(partialTitle)return exactArtist?4:3;
      return exactArtist?2:0;
    }
    if(exactTitle)return 6;
    if(exactArtist)return 5;
    if(partialTitle)return 4;
    return [...entry.artists].some(artist=>artist.includes(phrase))?3:0;
  }

  function rankSearchTracks(tracks,query,{keepUnmatched=true,fallback=()=>false}={}) {
    const phrase=searchPhrase(query);
    if(!phrase)return tracks.slice();
    const entries=tracks.map(searchEntry);
    const {term,pair,versions}=searchQuery(phrase,searchIndex(entries));
    return entries.map(entry=>{
      const match=searchMatch(entry,term,pair);
      if(!match)return {track:entry.track,score:Number(Boolean(fallback(entry.track)))};
      const version=versions.length?Number(searchVersions(entry,pair?.title||term).some(value=>versions.includes(value))):
        Number(Boolean(pair)&&recordingVersion(entry.track)==='录音室版');
      return {track:entry.track,score:2+match*2+version};
    }).filter(item=>keepUnmatched||item.score>0).sort((a,b)=>b.score-a.score).map(item=>item.track);
  }

  function findOwnedRecording(reference, tracks) {
    const title = recordingKey(reference?.name), artist = recordingKey(reference?.artist);
    if (!title || !artist) return null;
    const album = recordingAlbum(reference.album), duration = reference.duration;
    const versions=recordingVersions(reference);
    const matches = tracks.filter(track => {
      if (recordingKey(track.name) !== title || recordingKey(track.artist) !== artist || !(track.duration > 0)) return false;
      const candidateAlbum = recordingAlbum(track.album);
      if (album && candidateAlbum && candidateAlbum !== album || duration > 0 && Math.abs(track.duration - duration) > 2) return false;
      const candidateVersions=recordingVersions(track);
      if(versions.some(version=>!candidateVersions.includes(version))||
        candidateVersions.some(version=>version!=='录音室版'&&!versions.includes(version)))return false;
      return duration>0||Boolean(album&&candidateAlbum);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function playbackSourceLabel(track) {
    if(track?.provider==='navidrome')return 'Navidrome';
    if(track?.provider==='qishui')return '汽水音乐';
    return ({online:'汽水音乐',file:'本地音乐',demo:'内置示例',chart:'在线榜单',soda:'汽水分享'})[track?.kind]||'';
  }

  function playbackStatusLabel(state) {
    return ({
      direct:'可播整曲', 'full-source':'可播整曲', full:'可播整曲',
      preview:'仅试听', 'preview-source':'仅试听',
      'auth-required':'需登录', unavailable:'打开原平台', official:'打开原平台',
    })[state] || '待确认';
  }

  function searchPlaybackStatusLabel(state) {
    if(!state||state==='unknown')return '可播状态待确认';
    if(state==='failed')return '播放失败';
    return playbackStatusLabel(state);
  }

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
    const provider=input?.provider,mediaId=String(input?.mediaId||'');
    const navidrome=provider==='navidrome';
    if(navidrome?!/^[a-f0-9]{20}_[a-zA-Z0-9_-]{1,128}$/.test(mediaId):provider!==PROVIDER||!/^\d{1,30}$/.test(mediaId))return null;
    const name = text(input.name, '未命名歌曲');
    const duration = Number(input.duration);
    return {
      id: `online:${provider}:${mediaId}`,
      kind: 'online',
      provider,
      mediaId,
      name,
      artist: text(input.artist),
      album: text(input.album),
      ...(navidrome&&text(input.version)?{version:text(input.version)}:{}),
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      cover: safeHttpsUrl(input.cover),
      externalUrl: navidrome?null:safeHttpsUrl(input.externalUrl) || `https://qishui.douyin.com/song/${encodeURIComponent(mediaId)}`,
      favorite: input.favorite === true,
      liked: input.liked === true,
      preview: input.preview === true,
      stored: true,
      sourcePath: navidrome?'Navidrome':'汽水音乐',
      signature: `${provider}:${mediaId}`,
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
    let available = null, providers = null;
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
          reject(Object.assign(new Error('音乐请求超时，请重试。'), { code: 'timeout' }));
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
          const timeout = new Error('音乐请求超时，请重试。');
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
      get qishuiAvailable() { return providers?.includes(PROVIDER) ?? null; },
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
            return { origin, providers: Array.isArray(data.providers) ? data.providers : null };
          }));
          if (generation !== detectionGeneration) return false;
          baseUrl = candidate.origin;
          providers = candidate.providers;
          available = true;
          detectionState = 'ready';
          return true;
        } catch (error) {
          if (generation !== detectionGeneration) return false;
          available = false;
          providers = null;
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
      loginCancel: sessionId => request('/api/qishui/login/cancel', { sessionId }, 7000),
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
      async charts({ country = 'cn', limit = 25, signal } = {}) {
        const params = new URLSearchParams({ country, limit: String(limit) });
        const origin = baseUrl;
        try {
          // Allow the feed and optional metadata lookup to reach the client.
          return await requestFrom(origin, '/api/discovery/charts?' + params, undefined, 12500, signal, 12500);
        } catch (error) {
          if (error.code !== 'timeout') throw error;
          const health = await requestFrom(origin, '/health', undefined, 1500, signal).catch(() => null);
          signal?.throwIfAborted();
          error.code = health?.companion && health?.ok ? 'upstream-timeout' : 'offline';
          throw error;
        }
      },
      matchChartTrack({ name, artist, duration, album }, { signal, includeCandidates } = {}) {
        const payload = { name, artist };
        if (Number.isFinite(duration) && duration > 0) payload.duration = duration;
        const albumName = typeof album === 'string' ? album.trim() : '';
        if (albumName) payload.album = albumName;
        if (includeCandidates === true) payload.includeCandidates = true;
        return requestFrom(baseUrl, '/api/discovery/charts/match', payload, 10000, signal);
      },
      chartRecording(mediaId,{country='cn',signal}={}) {
        const params=new URLSearchParams({id:mediaId,country});
        return requestFrom(baseUrl,'/api/discovery/charts/recording?'+params,undefined,5000,signal);
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
      audio: (mediaId, { signal, quality } = {}) => requestFrom(baseUrl, `/api/qishui/tracks/${encodeURIComponent(mediaId)}/audio`, quality ? { quality } : {}, 15000, signal),
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
    recordingVersion,
    searchRecordingVersion,
    rankSearchTracks,
    findOwnedRecording,
    playbackSourceLabel,
    playbackStatusLabel,
    searchPlaybackStatusLabel,
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
