"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const FilmStory = require("../outputs/film-story.js");

function channel(segments, sampleRate = 100) {
  const duration = segments.reduce((sum, item) => sum + item.seconds, 0);
  const data = new Float32Array(Math.ceil(duration * sampleRate));
  let cursor = 0;
  for (const segment of segments) {
    const end = Math.min(data.length, cursor + Math.ceil(segment.seconds * sampleRate));
    data.fill(segment.level, cursor, end);
    cursor = end;
  }
  return { data, duration, sampleRate };
}

test("analyzeEnergy produces normalized buckets and handles stereo channels", () => {
  const left = channel([{ seconds: 2, level: 0.02 }, { seconds: 3, level: 0.55 }]);
  const right = channel([{ seconds: 2, level: 0.01 }, { seconds: 3, level: 0.4 }]);
  const analysis = FilmStory.analyzeEnergy(
    [left.data, right.data],
    left.sampleRate,
    left.duration,
    { bucketSeconds: 0.5 }
  );

  assert.equal(analysis.version, 1);
  assert.ok(analysis.values.length >= 9);
  assert.ok(analysis.values.every((value) => value >= 0 && value <= 1));
  assert.ok(analysis.values.at(-1) > analysis.values[0] + 0.3);
  assert.equal(analysis.fallback, false);
});

test("pickBestSection avoids the quiet intro and faded ending", () => {
  const source = channel([
    { seconds: 8, level: 0.01 },
    { seconds: 8, level: 0.06 },
    { seconds: 22, level: 0.5 },
    { seconds: 10, level: 0.12 },
    { seconds: 8, level: 0.01 }
  ]);
  const analysis = FilmStory.analyzeEnergy([source.data], source.sampleRate, source.duration);
  const best = FilmStory.pickBestSection(analysis, source.duration, 15);

  assert.equal(best.end - best.start, 15);
  assert.ok(best.start >= 10);
  assert.ok(best.end <= source.duration - 5);
  assert.ok(best.confidence > 0.4);
  assert.match(best.reason, /高潮|能量|完整/);
});

test("pickBestSection returns the whole track when the requested clip is longer", () => {
  const analysis = FilmStory.createFallbackAnalysis(12);
  const best = FilmStory.pickBestSection(analysis, 12, 30);

  assert.deepEqual({ start: best.start, end: best.end }, { start: 0, end: 12 });
  assert.equal(best.confidence, 0);
});

test("buildChapterTimeline returns four ordered chapters inside the selected section", () => {
  const source = channel([
    { seconds: 10, level: 0.05 },
    { seconds: 15, level: 0.25 },
    { seconds: 18, level: 0.62 },
    { seconds: 12, level: 0.2 },
    { seconds: 5, level: 0.03 }
  ]);
  const analysis = FilmStory.analyzeEnergy([source.data], source.sampleRate, source.duration);
  const timeline = FilmStory.buildChapterTimeline(analysis, source.duration, 12, 30);

  assert.equal(timeline.chapters.length, 4);
  assert.equal(timeline.chapters[0].relativeStart, 0);
  assert.equal(timeline.chapters.at(-1).relativeEnd, 1);
  assert.deepEqual(
    timeline.chapters.map((chapter) => chapter.mode),
    ["ring", "galaxy", "peaks", "blackhole"]
  );
  for (let index = 0; index < timeline.chapters.length; index += 1) {
    const chapter = timeline.chapters[index];
    assert.ok(chapter.end > chapter.start);
    if (index > 0) assert.ok(chapter.start >= timeline.chapters[index - 1].end - 0.0001);
    assert.ok(chapter.start >= 12 - 0.001);
    assert.ok(chapter.end <= 42 + 0.001);
  }
});

test("chapterAt accepts relative and absolute song positions", () => {
  const timeline = FilmStory.buildChapterTimeline(
    FilmStory.createFallbackAnalysis(60),
    60,
    12,
    30
  );
  const relative = FilmStory.chapterAt(timeline, 0.82);
  const absolute = FilmStory.chapterAt(timeline, 12 + 30 * 0.82, true);

  assert.equal(relative.chapter.id, "outro");
  assert.equal(absolute.chapter.id, "outro");
  assert.ok(relative.localProgress > 0 && relative.localProgress < 1);
});

test("normalizeAnalysis accepts a numeric series and applies a fallback", () => {
  const normalized = FilmStory.normalizeAnalysis([0.1, 0.4, 0.8, 1.2], 8);
  assert.equal(normalized.duration, 8);
  assert.deepEqual(normalized.values, [0.1, 0.4, 0.8, 1]);

  const fallback = FilmStory.normalizeAnalysis([], 9);
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.duration, 9);
  assert.ok(fallback.values.length >= 18);
});
