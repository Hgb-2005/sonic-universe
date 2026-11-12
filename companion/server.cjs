'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createProviders } = require('./providers/index.cjs');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const BODY_LIMIT = 64 * 1024;
const MEDIA_LIMIT = 256;
const COVER_LIMIT = 4 * 1024 * 1024;
const COVER_HOSTS = Object.freeze([
  'douyinpic.com',
  'douyinstatic.com',
  'byteimg.com',
  'qishui.com',
  'douyin.com',
]);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
};

function corsHeaders(origin, port) {
  const allowed = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'https://hgb-2005.github.io',
  ];
  return origin && allowed.includes(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    'Access-Control-Allow-Private-Network': 'true',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Vary': 'Origin',
  } : {};
}

function sendJson(response, status, data, extra = {}) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        const error = new Error('Request body is too large');
        error.status = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value || ''));
  if (!match) return null;
  let start = match[1] === '' ? NaN : Number(match[1]);
  let end = match[2] === '' ? size - 1 : Number(match[2]);
  if (!match[1] && Number.isFinite(end)) {
    const suffix = end;
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

function createMediaCache(provider, options = {}) {
  const entries = new Map();
  const ttl = options.ttlMs || 10 * 60 * 1000;
  const max = options.max || MEDIA_LIMIT;
  const cleanup = () => {
    const now = Date.now();
    for (const [token, entry] of entries) if (entry.expiresAt <= now) entries.delete(token);
  };
  return {
    async issue(id) {
      const source = await provider.audio(id);
      cleanup();
      while (entries.size >= max) entries.delete(entries.keys().next().value);
      const token = crypto.randomBytes(24).toString('base64url');
      const expiresAt = Math.min(Date.now() + ttl, Number(source.expiresAt) > 0 ? Number(source.expiresAt) : Infinity);
      entries.set(token, { ...source, expiresAt });
      return { streamPath: `/media/${token}`, preview: source.preview, quality: source.quality, clipStartMs: source.clipStartMs };
    },
    get(token) {
      const entry = entries.get(String(token || ''));
      if (!entry || entry.expiresAt <= Date.now()) {
        entries.delete(String(token || ''));
        return null;
      }
      return entry;
    },
    size() { return entries.size; },
  };
}

async function proxyMedia(request, response, entry, extraHeaders = {}) {
  const headers = { 'Accept': 'audio/*,application/octet-stream' };
  if (request.headers.range) headers.Range = request.headers.range;
  const upstream = await fetch(entry.mediaUrl, { headers, redirect: 'follow' });
  if (!upstream.ok && upstream.status !== 206) throw Object.assign(new Error('Media upstream failed'), { status: 502 });
  const length = Number(upstream.headers.get('content-length'));
  const finalHeaders = {
    'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  if (Number.isFinite(length)) finalHeaders['Content-Length'] = String(length);
  if (upstream.headers.get('content-range')) finalHeaders['Content-Range'] = upstream.headers.get('content-range');
  response.writeHead(upstream.status, finalHeaders);
  if (!upstream.body) return response.end();
  Readable.fromWeb(upstream.body).on('error', () => response.destroy()).pipe(response);
}

function isTrustedCoverUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    const host = url.hostname.toLowerCase();
    return COVER_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function proxyCover(response, sourceUrl, extraHeaders = {}) {
  let current = String(sourceUrl || '');
  let upstream = null;
  for (let redirect = 0; redirect < 4; redirect++) {
    if (!isTrustedCoverUrl(current)) {
      throw Object.assign(new Error('Cover source is not trusted'), { status: 502 });
    }
    upstream = await fetch(current, {
      redirect: 'manual',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
        Referer: 'https://qishui.douyin.com/',
        'User-Agent': 'Mozilla/5.0 SonicUniverse/31',
      },
    });
    if (upstream.status < 300 || upstream.status >= 400) break;
    const location = upstream.headers.get('location');
    if (!location) throw Object.assign(new Error('Cover redirect is incomplete'), { status: 502 });
    current = new URL(location, current).toString();
    upstream = null;
  }
  if (!upstream) throw Object.assign(new Error('Too many cover redirects'), { status: 502 });
  if (!upstream.ok) throw Object.assign(new Error('Cover upstream failed'), { status: 502 });
  const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
  if (!/^image\/(?:avif|gif|jpeg|png|webp)(?:;|$)/.test(contentType)) {
    throw Object.assign(new Error('Cover upstream did not return an image'), { status: 502 });
  }
  const declaredLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > COVER_LIMIT) {
    throw Object.assign(new Error('Cover image is too large'), { status: 502 });
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  if (!body.length || body.length > COVER_LIMIT) {
    throw Object.assign(new Error('Cover image is invalid or too large'), { status: 502 });
  }
  response.writeHead(200, {
    'Content-Type': contentType.split(';')[0],
    'Content-Length': String(body.length),
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

async function serveStatic(request, response, root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filename = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (!filename.startsWith(resolvedRoot + path.sep) && filename !== resolvedRoot) return false;
  try {
    const stat = await fsp.stat(filename);
    if (!stat.isFile()) return false;
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': path.basename(filename) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(filename).pipe(response);
    return true;
  } catch {
    return false;
  }
}

function createAppServer(options = {}) {
  const port = Number(options.port || DEFAULT_PORT);
  const root = path.resolve(options.root || path.join(__dirname, '..', 'outputs'));
  let providers = options.providers || null;
  let media = null;
  const ready = providers
    ? Promise.resolve(providers)
    : createProviders({ dataDirectory: options.dataDirectory, onError: options.onError });

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin || '';
    const cors = corsHeaders(origin, port);
    if (origin && !cors['Access-Control-Allow-Origin']) return sendJson(response, 403, { error: 'Origin is not allowed' });
    if (request.method === 'OPTIONS') return sendJson(response, 204, {}, cors);
    const host = String(request.headers.host || '').toLowerCase();
    const validHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
    if (!validHost) return sendJson(response, 403, { error: 'Invalid host' }, cors);
    const url = new URL(request.url || '/', `http://${host}`);
    try {
      if (!providers) providers = await ready;
      const qishui = providers.get('qishui');
      if (url.pathname === '/health') return sendJson(response, 200, { ok: true, companion: true, musicApiVersion: 2, providers: [...providers.keys()] }, cors);
      if (url.pathname === '/api/providers') return sendJson(response, 200, { musicApiVersion: 2, items: [
        { id: 'qishui', name: '汽水音乐', available: Boolean(qishui), capabilities: ['search', 'login', 'library', 'audio', 'lyrics'], playback: 'inline' },
        { id: 'netease', name: '网易云音乐', available: providers.has('netease'), capabilities: ['search', 'external-link'], playback: 'external' },
        { id: 'qq', name: 'QQ 音乐', available: providers.has('qq'), capabilities: ['search', 'external-link'], playback: 'external' },
      ] }, cors);
      const publicSearch = /^\/api\/(netease|qq)\/search$/.exec(url.pathname);
      if (publicSearch) {
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' }, cors);
        const provider = providers.get(publicSearch[1]);
        if (!provider) return sendJson(response, 503, { error: '这个音乐平台暂时不可用，请换个平台搜索。', code: 'provider-unavailable' }, cors);
        return sendJson(response, 200, await provider.search(await readJson(request)), cors);
      }
      if (!url.pathname.startsWith('/api/qishui/') && !url.pathname.startsWith('/media/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed' }, cors);
        if (await serveStatic(request, response, root, url.pathname)) return;
        return sendJson(response, 404, { error: 'Not found' }, cors);
      }
      if (!qishui) return sendJson(response, 503, { error: 'Qishui provider is unavailable' }, cors);
      if (url.pathname.startsWith('/media/')) {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' }, cors);
        media ||= createMediaCache(qishui);
        const entry = media.get(url.pathname.slice('/media/'.length));
        if (!entry) return sendJson(response, 404, { error: 'Media token expired' }, cors);
        return proxyMedia(request, response, entry, cors);
      }
      if (url.pathname === '/api/qishui/login-status' && request.method === 'GET') return sendJson(response, 200, await qishui.authStatus(), cors);
      if (url.pathname === '/api/qishui/login/start' && request.method === 'POST') return sendJson(response, 200, await qishui.loginStart(), cors);
      if (url.pathname === '/api/qishui/login/check' && request.method === 'POST') {
        const body = await readJson(request);
        return sendJson(response, 200, await qishui.loginCheck(body.sessionId), cors);
      }
      if (url.pathname === '/api/qishui/logout' && request.method === 'POST') return sendJson(response, 200, await qishui.logout(), cors);
      if (url.pathname === '/api/qishui/search' && request.method === 'POST') return sendJson(response, 200, await qishui.search(await readJson(request)), cors);
      if (url.pathname === '/api/qishui/library/liked' && request.method === 'GET') {
        return sendJson(response, 200, await qishui.liked({ limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }), cors);
      }
      if (url.pathname === '/api/qishui/library/playlists' && request.method === 'GET') {
        return sendJson(response, 200, await qishui.playlists({ limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }), cors);
      }
      let match = /^\/api\/qishui\/playlists\/(\d{1,30})$/.exec(url.pathname);
      if (match && request.method === 'GET') return sendJson(response, 200, await qishui.playlist(match[1], { limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }), cors);
      match = /^\/api\/qishui\/songs\/(\d{1,30})\/lyrics$/.exec(url.pathname);
      if (match && request.method === 'GET') return sendJson(response, 200, await qishui.lyrics(match[1]), cors);
      match = /^\/api\/qishui\/tracks\/(\d{1,30})\/cover$/.exec(url.pathname);
      if (match && request.method === 'GET') {
        const cover = await qishui.cover(match[1]);
        return proxyCover(response, cover.url, cors);
      }
      match = /^\/api\/qishui\/tracks\/(\d{1,30})\/audio$/.exec(url.pathname);
      if (match && request.method === 'POST') {
        media ||= createMediaCache(qishui);
        return sendJson(response, 200, await media.issue(match[1]), cors);
      }
      if (url.pathname === '/api/qishui/like' && request.method === 'POST') {
        const body = await readJson(request);
        return sendJson(response, 200, await qishui.like(body.id, body.liked), cors);
      }
      if (url.pathname === '/api/qishui/playlist/add' && request.method === 'POST') {
        const body = await readJson(request);
        return sendJson(response, 200, await qishui.playlistEdit('add', body.id, body.ids), cors);
      }
      if (url.pathname === '/api/qishui/playlist/remove' && request.method === 'POST') {
        const body = await readJson(request);
        return sendJson(response, 200, await qishui.playlistEdit('remove', body.id, body.ids), cors);
      }
      return sendJson(response, 404, { error: 'Route not found' }, cors);
    } catch (error) {
      if (options.onError) options.onError(error);
      return sendJson(response, Number(error.status) || 500, { error: String(error.message || 'Companion request failed'), code: String(error.code || 'error') }, cors);
    }
  });
  server.on('close', () => media = null);
  return {
    server,
    ready,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, HOST, () => resolve(server.address()));
    }),
  };
}

async function main() {
  const port = Number(process.env.SONIC_UNIVERSE_PORT || DEFAULT_PORT);
  const app = createAppServer({ port, onError: error => console.error(`[Companion] ${error.message}`) });
  await app.ready;
  await app.listen();
  console.log(`Sonic Universe Companion: http://${HOST}:${port}/`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[Companion] Startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createAppServer,
  createMediaCache,
  corsHeaders,
  isTrustedCoverUrl,
  parseRange,
  readJson,
  serveStatic,
};
