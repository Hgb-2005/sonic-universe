(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SonicExternalNowPlaying = api;
})(globalThis, function () {
  'use strict';

  const pollMs = 1050;
  const staleMs = 4000;
  const noLyrics = Object.freeze([]);

  function lyricIdentity(info) {
    if (!info?.sourceId || !info.title || !Number.isFinite(info.position) || !Number.isFinite(info.duration) || info.duration < 1) return '';
    return JSON.stringify([info.sourceId,info.title,info.artist,info.album,Math.round(info.duration)]);
  }

  function positionAt(report, now) {
    if (!Number.isFinite(report?.position) || !Number.isFinite(report.duration) || report.duration <= 0) return null;
    const age = Number.isFinite(report.timestamp) ? Math.max(0, now - report.timestamp) : 0;
    const rate = Number.isFinite(report.rate) && report.rate > 0 ? report.rate : 1;
    return Math.max(0, Math.min(report.duration, report.position + (report.playing ? Math.min(staleMs, age) * rate / 1000 : 0)));
  }

  function create(read, onChange = () => {}, now = Date.now) {
    const supported = typeof read === 'function';
    let active = false, preferred = null, value = null, sessions = [], pending = null;
    let received = 0, nextPoll = 0, revision = 0;
    let lyricData, lyricRequest;

    function clearLyrics() {
      lyricRequest?.abort();
      lyricData = lyricRequest = null;
    }

    function setActive(enabled) {
      if (active === enabled) return;
      active = enabled;
      revision++;
      preferred = value = pending = null;
      sessions = [];
      received = nextPoll = 0;
      clearLyrics();
      onChange();
    }

    function snapshot() {
      if (!active || !supported) return null;
      if (!value || now() - received > staleMs) return { preferred, sessions, status:'waiting' };
      const status = value.available ? (value.sourceId ? 'ready' : (value.selectionMissing ? 'missing' : 'empty')) : 'unavailable';
      const lyricsKey = lyricIdentity(value);
      return { ...value, preferred, sessions, status, position:positionAt(value, now()), lyricsKey,
        lyricsSource:lyricData?.key===lyricsKey ? lyricData.source : '' };
    }

    function poll() {
      if (!active || !supported || pending || now() < nextPoll) return pending;
      const request = revision;
      const sourceId = preferred;
      nextPoll = now() + pollMs;
      pending = Promise.resolve().then(() => read({ sourceId })).then(report => {
        if (!active || request !== revision || !report) return;
        if (lyricIdentity(value) !== lyricIdentity(report)) clearLyrics();
        value = report;
        sessions = Array.isArray(report.sessions) ? report.sessions : [];
        received = now();
        onChange();
      }).catch(() => {}).finally(() => {
        if (request === revision) pending = null;
      });
      return pending;
    }

    function select(sourceId) {
      const selected = sourceId && sessions.some(session => session.sourceId === sourceId) ? sourceId : null;
      if (!active || !supported || preferred === selected) return null;
      preferred = selected;
      pending = value = null;
      nextPoll = 0;
      revision++;
      clearLyrics();
      onChange();
      return poll();
    }

    async function loadLyrics(load, parse, source) {
      const info = snapshot(), key = info?.lyricsKey;
      if (!key) return {ok:false,message:'播放器正在提供曲名和进度时，可同步歌词。'};
      lyricRequest?.abort();
      const request = new AbortController();
      lyricRequest = request;
      const changed = () => request.signal.aborted || snapshot()?.lyricsKey !== key;
      const canceled = {ok:false,message:'曲目或来源已改变，请重新选择歌词。'};
      try {
        const raw = await load({name:info.title,artist:info.artist,album:info.album,duration:info.duration},request.signal);
        if (changed()) return canceled;
        const lines = typeof raw==='string' && raw.length<=250000 ? parse(raw).filter(line => line.text && line.time>=0 && line.time<=info.duration+.5) : noLyrics;
        if (!lines.length) return {ok:false,message:source==='LRCLIB'?'暂未找到匹配的同步歌词，可导入本地文件。':'歌词文件里没有可用的时间点。'};
        lyricData = {key, lines, source};
        onChange();
        return {ok:true,message:'同步歌词已载入。'};
      } catch (error) {
        return changed() ? canceled : {ok:false,message:source==='LRCLIB'?'暂时无法查询歌词，可导入本地文件。':error.message||'读取歌词文件失败。'};
      } finally {
        if (lyricRequest===request) lyricRequest = null;
      }
    }

    function lyrics(info = snapshot()) {
      return lyricData && info?.lyricsKey === lyricData.key ? lyricData.lines : noLyrics;
    }

    function position() {
      const time = now();
      return active && time - received <= staleMs ? positionAt(value, time) : null;
    }

    return { setActive, snapshot, poll, select, loadLyrics, lyrics, position };
  }

  return { create, positionAt };
});
