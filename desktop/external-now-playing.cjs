'use strict';

const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

const MAX_TIME = 48 * 3600;
const SESSION_ID = /^session-[a-f0-9]{8}-\d{1,10}$/;
const string = (value, size) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, size) : '';
const idle = () => ({ available:false, sessions:[], sourceId:null, title:'', artist:'', album:'', sourceApp:'', position:null, duration:null, playing:false, timestamp:null, rate:1, selectionMissing:false });

function sourceLabel(value) {
  const label = string(value,512).split(/[\\/]/).at(-1).split('!')[0].split('_')[0].replace(/\.exe$/i, '');
  return /^(?:MSEdge|Microsoft\.MicrosoftEdge\.Stable)$/i.test(label) ? 'Microsoft Edge' : label.slice(0, 72);
}

function normalizeReport(report, sourceId, now, executablePath = '') {
  if (report?.available !== true || !Array.isArray(report.sessions)) return idle();
  const preferred = SESSION_ID.test(sourceId || '') ? sourceId : null;
  const self = String(executablePath).toLowerCase();
  const rows = report.sessions.slice(0, 24).filter(row => {
    const app = string(row?.sourceApp, 512).toLowerCase();
    return SESSION_ID.test(row?.sourceId || '') && app && app !== 'com.sonicuniverse.desktop' && app !== self;
  });
  const sessions = rows.map(row => ({
    sourceId:row.sourceId, sourceApp:sourceLabel(row.sourceApp),
    title:string(row.title, 160), artist:string(row.artist, 140), playing:row.playing === true,
  }));
  const row = preferred ? rows.find(value => value.sourceId === preferred) :
    rows.find(value => value.sourceId === report.currentId) || rows.find(value => value.playing === true);
  if (!row) return {...idle(), available:true, sessions, selectionMissing:Boolean(preferred)};
  const playing = row.playing === true;
  const rate = Number.isFinite(row.rate) && row.rate > 0 && row.rate <= 5 ? row.rate : 1;
  const duration = Number.isFinite(row.duration) && row.duration > .05 && row.duration <= MAX_TIME ? row.duration : null;
  let position = duration !== null && Number.isFinite(row.position) && row.position >= 0 && row.position <= duration + 1 ? row.position : null;
  if (position !== null) {
    const elapsed = Number.isFinite(row.updatedAt) && row.updatedAt > 0 && row.updatedAt <= now ? (now - row.updatedAt) / 1000 : 0;
    const advance = playing && elapsed <= duration ? elapsed * rate : 0;
    position = Math.min(duration, position + advance);
  }
  return {
    available:true, sessions, sourceId:row.sourceId, sourceApp:sourceLabel(row.sourceApp),
    title:string(row.title, 160), artist:string(row.artist, 140), album:string(row.album, 140),
    position, duration, playing, timestamp:Number.isFinite(now) ? now : null, rate, selectionMissing:false,
  };
}

function createExternalNowPlaying({ helper, executablePath, platform = process.platform, spawnProcess = spawn, now = Date.now } = {}) {
  let child, pending, cached, refreshed = 0, retryAfter = 0;

  function resolveScan(report) {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    cached = report;
    refreshed = now();
    current.resolve(report);
  }

  function stop(target, retry = false) {
    if (!target || target !== child) return;
    child = null;
    retryAfter = retry ? now() + 3500 : 0;
    resolveScan(null);
    cached = null;
    target.stdin.destroy();
    if (target.exitCode === null && !target.killed) target.kill();
  }

  function start() {
    if (child) return child;
    const target = spawnProcess(helper, [], { windowsHide:true, stdio:['pipe', 'pipe', 'ignore'] });
    child = target;
    const lines = createInterface({ input:target.stdout, crlfDelay:Infinity });
    lines.on('line', line => {
      if (target !== child || !pending) return;
      if (line.length > 130000) { stop(target, true); return; }
      try { resolveScan(JSON.parse(line)); }
      catch { stop(target, true); }
    });
    target.on('error', () => stop(target, true));
    target.on('exit', () => stop(target, true));
    target.stdin.on('error', () => stop(target, true));
    return target;
  }

  async function scan() {
    if (platform !== 'win32' || !helper || now() < retryAfter) return null;
    if (cached && now() - refreshed < 575) return cached;
    if (pending) return pending.promise;
    const target = start();
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pending = { promise, resolve, timer:setTimeout(() => stop(target, true), 1600) };
    target.stdin.write('scan\n');
    return promise;
  }

  return {
    async query(sourceId) {
      try { return normalizeReport(await scan(), sourceId, now(), executablePath); }
      catch { stop(child, true); return idle(); }
    },
    close() { stop(child); },
  };
}

module.exports = { createExternalNowPlaying, normalizeReport };
