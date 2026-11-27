'use strict';

const { Converter } = require('opencc-js/t2cn');
const simplifyChinese = Converter({ from: 'tw', to: 'cn' });

const SEARCH_PAGE_SIZE = 20;
const SEARCH_PAGE_LIMIT = 3;
const CANDIDATE_LIMIT = 15;
const DURATION_TOLERANCE = 2;

function chartText(value) {
  if (typeof value !== 'string' || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) return '';
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function titleKey(value) {
  return simplifyChinese(chartText(value)).toLowerCase();
}

function artistKey(value) {
  // The Qishui adapter joins artists with 、. Apple sometimes joins the
  // same ordered credits with a spaced ampersand. Keep the full credit.
  return titleKey(value).split(/\s*、\s*|\s+&\s+/)
    .map(credit => /^g\.e\.m\.\s*(?:邓紫棋)?$/.test(credit) ? '邓紫棋' : credit)
    .join('、');
}

function knownDuration(value) {
  return Number.isFinite(value) && value > 0 && value <= 86400;
}

function recordingRank(track, duration, album) {
  const hasDuration = knownDuration(track.duration);
  const trackAlbum = titleKey(track.album);
  if ((duration && hasDuration && Math.abs(track.duration - duration) > DURATION_TOLERANCE)
    || (album && trackAlbum && trackAlbum !== album)) return 2;
  if ((duration && !hasDuration) || (album && !trackAlbum)) return 1;
  return 0;
}

function matchResult(matches, includeCandidates, incomplete = false) {
  const ranked = [...matches.values()].sort((left, right) => left.rank - right.rank);
  const compatible = ranked.filter(candidate => candidate.rank === 0);
  const item = !incomplete && compatible.length === 1 ? compatible[0].track : null;
  if (!includeCandidates) return { item };
  const reason = incomplete ? 'incomplete' : item ? 'matched' : compatible.length > 1 ? 'ambiguous' : 'no-match';
  return { item, reason, candidates: ranked.slice(0, CANDIDATE_LIMIT).map(candidate => candidate.track) };
}

async function matchChartSong(search, input) {
  const name = chartText(input?.name), artist = chartText(input?.artist);
  if (!name || !artist) {
    throw Object.assign(new Error('榜单歌曲需要有效的歌名和歌手。'), { status: 400, code: 'invalid-chart-song' });
  }
  const duration = input.duration ?? 0;
  const album = titleKey(input.album);
  const invalidAlbum = input.album != null && !album
    && (typeof input.album !== 'string' || input.album.trim() !== '');
  if ((duration !== 0 && !knownDuration(duration)) || invalidAlbum) {
    throw Object.assign(new Error('曲目时长或专辑格式不正确。'), { status: 400, code: 'invalid-chart-song' });
  }

  const expectedTitle = titleKey(name), expectedArtist = artistKey(artist);
  const includeCandidates = input.includeCandidates === true;
  const matches = new Map();
  let offset = 0;
  for (let page = 0; page < SEARCH_PAGE_LIMIT; page++) {
    const result = await search({ query: `${name} ${artist}`, limit: SEARCH_PAGE_SIZE, offset });
    if (!Array.isArray(result?.items)) {
      throw Object.assign(new Error('汽水音乐返回的搜索结果无法读取。'), { status: 502, code: 'upstream-invalid-response' });
    }
    for (const track of result.items) {
      if (track?.provider !== 'qishui' || typeof track.mediaId !== 'string' || !/^\d{1,30}$/.test(track.mediaId)) continue;
      if (titleKey(track.name) !== expectedTitle || artistKey(track.artist) !== expectedArtist) continue;
      if (!matches.has(track.mediaId)) {
        matches.set(track.mediaId, { track, rank: recordingRank(track, duration, album) });
      }
    }
    if (result.hasMore !== true) return matchResult(matches, includeCandidates);
    if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset) break;
    offset = result.nextOffset;
  }

  // A title and artist alone cannot confirm an incomplete result set. When
  // both reference fields identify the recording, apply the same rank rules.
  return matchResult(matches, includeCandidates, !(duration && album && [...matches.values()].some(candidate => candidate.rank === 0)));
}

module.exports = { matchChartSong };
