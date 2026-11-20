'use strict';

const SEARCH_PAGE_SIZE = 20;
const SEARCH_PAGE_LIMIT = 3;

function chartText(value) {
  if (typeof value !== 'string' || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) return '';
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function titleKey(value) {
  return chartText(value).toLowerCase();
}

function artistKey(value) {
  // The Qishui adapter joins artists with 、. Apple sometimes joins the
  // same ordered credits with a spaced ampersand. Keep the full credit.
  return titleKey(value).replace(/\s*、\s*|\s+&\s+/g, '、');
}

async function matchChartSong(search, input) {
  const name = chartText(input?.name), artist = chartText(input?.artist);
  if (!name || !artist) {
    throw Object.assign(new Error('榜单歌曲需要有效的歌名和歌手。'), { status: 400, code: 'invalid-chart-song' });
  }

  const expectedTitle = titleKey(name), expectedArtist = artistKey(artist);
  let match = null;
  let offset = 0;
  for (let page = 0; page < SEARCH_PAGE_LIMIT; page++) {
    const result = await search({ query: `${name} ${artist}`, limit: SEARCH_PAGE_SIZE, offset });
    if (!Array.isArray(result?.items)) {
      throw Object.assign(new Error('汽水音乐返回的搜索结果无法读取。'), { status: 502, code: 'upstream-invalid-response' });
    }
    for (const track of result.items) {
      if (track?.provider !== 'qishui' || typeof track.mediaId !== 'string' || !/^\d{1,30}$/.test(track.mediaId)) continue;
      if (titleKey(track.name) !== expectedTitle || artistKey(track.artist) !== expectedArtist) continue;
      // Never choose between two editions with identical titles and credits.
      if (match && match.mediaId !== track.mediaId) return { item: null };
      match ||= track;
    }
    if (result.hasMore !== true) return { item: match };
    if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset) return { item: null };
    offset = result.nextOffset;
  }

  // An incomplete result set cannot establish an unambiguous match.
  return { item: null };
}

module.exports = { matchChartSong };
