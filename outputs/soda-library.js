(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SonicSodaLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({
    name: 100,
    artist: 80,
    album: 100,
    url: 2048,
    batch: 100
  });

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .trim()
      .slice(0, maxLength);
  }

  function normalizeSodaUrl(value) {
    const raw = cleanText(value, LIMITS.url);
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (!url.hostname || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function validateSodaRecord(input) {
    const name = cleanText(input?.name, LIMITS.name);
    const artist = cleanText(input?.artist, LIMITS.artist);
    const album = cleanText(input?.album, LIMITS.album);
    const externalUrl = normalizeSodaUrl(input?.externalUrl);
    if (!name) return { ok: false, error: '请填写歌曲名称。' };
    if (!externalUrl) return { ok: false, error: '请粘贴以 http:// 或 https:// 开头的汽水音乐分享链接。' };
    return { ok: true, value: { name, artist, album, externalUrl } };
  }

  function extractUrl(value) {
    const match = String(value || '').match(/https?:\/\/[^\s<>"']+/i);
    if (!match) return '';
    return match[0].replace(/[),.;，。；）}\]]+$/g, '');
  }

  function parseLine(line) {
    const url = extractUrl(line);
    const normalizedUrl = normalizeSodaUrl(url);
    if (!normalizedUrl) return null;
    const prefix = line.slice(0, line.indexOf(url)).trim();
    const parts = prefix
      .split(/\s*(?:\||｜|\t)\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    return {
      name: cleanText(parts[0] || '未命名汽水歌曲', LIMITS.name),
      artist: cleanText(parts[1] || '', LIMITS.artist),
      album: cleanText(parts[2] || '', LIMITS.album),
      externalUrl: normalizedUrl
    };
  }

  function parseSodaLines(text, existingUrls) {
    const seen = new Set(
      Array.from(existingUrls || [])
        .map(normalizeSodaUrl)
        .filter(Boolean)
        .map((url) => url.toLocaleLowerCase())
    );
    const items = [];
    const duplicates = [];
    const invalid = [];
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let limited = 0;

    for (const line of lines) {
      const item = parseLine(line);
      if (!item) {
        invalid.push(line);
        continue;
      }
      const key = item.externalUrl.toLocaleLowerCase();
      if (seen.has(key)) {
        duplicates.push(item);
        continue;
      }
      seen.add(key);
      if (items.length >= LIMITS.batch) {
        limited += 1;
        continue;
      }
      items.push(item);
    }

    return { items, duplicates, invalid, limited };
  }

  return {
    LIMITS,
    cleanText,
    normalizeSodaUrl,
    validateSodaRecord,
    parseSodaLines
  };
});
