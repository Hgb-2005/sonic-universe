(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SonicFilmStory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const DEFAULT_BUCKET_SECONDS = 0.5;
  const CHAPTERS = Object.freeze([
    { id: "intro", number: "01", label: "序曲 · 星光初醒", short: "序曲", mode: "ring" },
    { id: "travel", number: "02", label: "漫游 · 旋律成河", short: "漫游", mode: "galaxy" },
    { id: "bloom", number: "03", label: "盛放 · 星河共鸣", short: "盛放", mode: "peaks" },
    { id: "outro", number: "04", label: "余晖 · 光尘归寂", short: "余晖", mode: "blackhole" }
  ]);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  function mean(values, start = 0, end = values.length) {
    let total = 0;
    let count = 0;
    for (let index = Math.max(0, start); index < Math.min(values.length, end); index += 1) {
      total += values[index];
      count += 1;
    }
    return count ? total / count : 0;
  }

  function standardDeviation(values, start = 0, end = values.length, average = mean(values, start, end)) {
    let total = 0;
    let count = 0;
    for (let index = Math.max(0, start); index < Math.min(values.length, end); index += 1) {
      const delta = values[index] - average;
      total += delta * delta;
      count += 1;
    }
    return count ? Math.sqrt(total / count) : 0;
  }

  function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = Array.from(values).sort((a, b) => a - b);
    const position = clamp(fraction, 0, 1) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const mix = position - lower;
    return sorted[lower] * (1 - mix) + sorted[upper] * mix;
  }

  function movingAverage(values, radius) {
    const result = new Array(values.length);
    for (let index = 0; index < values.length; index += 1) {
      const start = Math.max(0, index - radius);
      const end = Math.min(values.length, index + radius + 1);
      result[index] = mean(values, start, end);
    }
    return result;
  }

  function channelList(channelData) {
    if (!channelData) return [];
    if (ArrayBuffer.isView(channelData)) return [channelData];
    if (typeof channelData.getChannelData === "function") {
      const channels = [];
      for (let index = 0; index < channelData.numberOfChannels; index += 1) {
        channels.push(channelData.getChannelData(index));
      }
      return channels;
    }
    if (Array.isArray(channelData) || ArrayBuffer.isView(channelData?.[0])) {
      return Array.from(channelData).filter((channel) => channel && Number.isFinite(channel.length));
    }
    return [];
  }

  function analyzeEnergy(channelData, sampleRate, duration, options = {}) {
    const channels = channelList(channelData);
    const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    const sourceDuration = channels.reduce(
      (longest, channel) => Math.max(longest, channel.length / rate),
      Number.isFinite(duration) && duration > 0 ? duration : 0
    );
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : sourceDuration;
    if (!(safeDuration > 0)) return createFallbackAnalysis(30);

    const bucketSeconds = clamp(
      Number(options.bucketSeconds) || DEFAULT_BUCKET_SECONDS,
      0.15,
      1
    );
    const bucketCount = Math.max(2, Math.ceil(safeDuration / bucketSeconds));
    const bucketSamples = Math.max(1, Math.round(bucketSeconds * rate));
    const raw = new Array(bucketCount).fill(0);

    channels.forEach((channel) => {
      for (let bucket = 0; bucket < bucketCount; bucket += 1) {
        const start = bucket * bucketSamples;
        const end = Math.min(channel.length, start + bucketSamples);
        if (end <= start) continue;
        const stride = Math.max(1, Math.floor((end - start) / 3072));
        let sum = 0;
        let count = 0;
        for (let sample = start; sample < end; sample += stride) {
          const value = channel[sample] || 0;
          sum += value * value;
          count += 1;
        }
        if (count) raw[bucket] += Math.sqrt(sum / count) / Math.max(1, channels.length);
      }
    });

    const shrunk = raw.map((value) => Math.log1p(value * 24));
    const low = percentile(shrunk, 0.08);
    const high = percentile(shrunk, 0.96);
    const span = Math.max(0.0001, high - low);
    const normalized = shrunk.map((value) => clamp((value - low) / span, 0, 1));
    const values = movingAverage(normalized, bucketSeconds >= 0.75 ? 1 : 2);
    const average = mean(values);

    return {
      version: VERSION,
      duration: safeDuration,
      bucketSeconds,
      values,
      mean: average,
      peak: Math.max(...values),
      dynamicRange: clamp((high - low) / 2.2, 0, 1),
      fallback: channels.length === 0
    };
  }

  function createFallbackAnalysis(duration) {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 30;
    const bucketSeconds = DEFAULT_BUCKET_SECONDS;
    const count = Math.max(2, Math.ceil(safeDuration / bucketSeconds));
    const values = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const progress = index / Math.max(1, count - 1);
      values[index] = clamp(0.27 + Math.sin(progress * Math.PI) * 0.19 + progress * 0.08, 0, 1);
    }
    return {
      version: VERSION,
      duration: safeDuration,
      bucketSeconds,
      values,
      mean: mean(values),
      peak: Math.max(...values),
      dynamicRange: 0,
      fallback: true
    };
  }

  function normalizeAnalysis(input, duration) {
    const source = input && !Array.isArray(input) && !ArrayBuffer.isView(input) ? input : {};
    const values = Array.from(
      ArrayBuffer.isView(input) || Array.isArray(input) ? input : source.values || []
    )
      .map((value) => clamp(value, 0, 1))
      .filter(Number.isFinite);
    if (values.length < 2) return createFallbackAnalysis(duration || source.duration || 30);
    const safeDuration = Number.isFinite(duration)
      ? duration
      : Number.isFinite(source.duration) && source.duration > 0
        ? source.duration
        : values.length * DEFAULT_BUCKET_SECONDS;
    return {
      version: VERSION,
      duration: safeDuration,
      bucketSeconds:
        Number.isFinite(source.bucketSeconds) && source.bucketSeconds > 0
          ? source.bucketSeconds
          : safeDuration / values.length,
      values,
      mean: mean(values),
      peak: Math.max(...values),
      dynamicRange: clamp(Number(source.dynamicRange) || 0, 0, 1),
      fallback: source.fallback === true
    };
  }

  function valuesBetween(analysis, start, end) {
    const values = analysis.values;
    if (!values.length) return [];
    const duration = analysis.duration || values.length * analysis.bucketSeconds;
    const first = clamp(Math.floor((start / duration) * values.length), 0, values.length - 1);
    const last = clamp(Math.ceil((end / duration) * values.length), first + 1, values.length);
    return values.slice(first, last);
  }

  function pickBestSection(energy, duration, length = 30, options = {}) {
    const analysis = normalizeAnalysis(energy, duration);
    const targetLength = clamp(Number(length) || 30, 1, analysis.duration);
    if (analysis.duration <= targetLength + 0.25) {
      return {
        start: 0,
        end: analysis.duration,
        length: analysis.duration,
        score: 1,
        confidence: analysis.fallback ? 0 : 0.5,
        reason: "这首歌本身足够短，已使用完整段落"
      };
    }

    const fadeGuard = Math.min(8, Math.max(1.5, analysis.duration * 0.055));
    const searchStart = Math.min(analysis.duration - targetLength, Math.max(0, Math.min(2, analysis.duration * 0.025)));
    const searchEnd = Math.max(searchStart, analysis.duration - targetLength - fadeGuard);
    const step = Math.max(0.25, Math.min(1.5, analysis.bucketSeconds));
    const wholeAverage = Math.max(0.01, mean(analysis.values));
    let best = null;

    for (let start = searchStart; start <= searchEnd + 0.001; start += step) {
      const end = Math.min(analysis.duration, start + targetLength);
      const window = valuesBetween(analysis, start, end);
      if (window.length < 2) continue;
      const average = mean(window);
      const upper = mean(window.slice().sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(window.length * 0.28))));
      const deviation = standardDeviation(window, 0, window.length, average);
      const firstHalf = mean(window, 0, Math.floor(window.length / 2));
      const secondHalf = mean(window, Math.floor(window.length / 2), window.length);
      const lift = clamp(average / wholeAverage, 0.75, 1.45) / 1.45;
      const arc = clamp(0.5 + (secondHalf - firstHalf) * 0.75, 0, 1);
      const continuity = clamp(1 - deviation * 1.4, 0, 1);
      const centerBias = 1 - Math.abs((start + targetLength / 2) / analysis.duration - 0.5) * 0.08;
      const score =
        (average * 0.4 + upper * 0.24 + continuity * 0.13 + arc * 0.11 + lift * 0.12) *
        centerBias;
      if (!best || score > best.score) {
        best = { start, end, length: end - start, score, average, deviation };
      }
    }

    if (!best) best = { start: 0, end: targetLength, length: targetLength, score: 0, average: wholeAverage, deviation: 0 };
    const confidence = analysis.fallback
      ? 0
      : clamp((best.score - 0.38) / 0.42 + analysis.dynamicRange * 0.18, 0.12, 0.98);
    const reason =
      confidence >= 0.75
        ? "找到了持续高能量、层次变化明显的高潮段落"
        : confidence >= 0.45
          ? "已避开开头与结尾淡出，选用能量最完整的一段"
          : "这首歌段落起伏较小，已选用最稳定的完整片段";

    return {
      start: Number(best.start.toFixed(3)),
      end: Number(best.end.toFixed(3)),
      length: Number(best.length.toFixed(3)),
      score: Number(best.score.toFixed(4)),
      confidence: Number(confidence.toFixed(3)),
      reason
    };
  }

  function localEnergy(analysis, sectionStart, sectionLength, progress) {
    const position = sectionStart + sectionLength * clamp(progress, 0, 1);
    const index = clamp(
      Math.round((position / analysis.duration) * (analysis.values.length - 1)),
      0,
      analysis.values.length - 1
    );
    return analysis.values[index] || 0;
  }

  function findBoundary(analysis, sectionStart, sectionLength, low, high, mode) {
    let bestProgress = (low + high) / 2;
    let bestScore = -Infinity;
    for (let progress = low; progress <= high + 0.0001; progress += 0.01) {
      const before = mean([
        localEnergy(analysis, sectionStart, sectionLength, progress - 0.04),
        localEnergy(analysis, sectionStart, sectionLength, progress - 0.02)
      ]);
      const current = localEnergy(analysis, sectionStart, sectionLength, progress);
      const after = mean([
        localEnergy(analysis, sectionStart, sectionLength, progress + 0.02),
        localEnergy(analysis, sectionStart, sectionLength, progress + 0.04)
      ]);
      const change = mode === "rise" ? current + (current - before) : current + (current - after);
      const centered = 1 - Math.abs(progress - (low + high) / 2) * 0.35;
      const score = change * centered;
      if (score > bestScore) {
        bestScore = score;
        bestProgress = progress;
      }
    }
    return bestProgress;
  }

  function buildChapterTimeline(energy, duration, sectionStart, sectionLength) {
    const analysis = normalizeAnalysis(energy, duration);
    const start = clamp(Number(sectionStart) || 0, 0, Math.max(0, analysis.duration - 0.25));
    const length = clamp(Number(sectionLength) || 30, 0.25, analysis.duration - start);
    const end = start + length;
    const introEndProgress = findBoundary(analysis, start, length, 0.14, 0.28, "rise");
    const travelEndProgress = findBoundary(
      analysis,
      start,
      length,
      Math.min(0.56, introEndProgress + 0.15),
      Math.min(0.62, introEndProgress + 0.28),
      "rise"
    );
    const bloomEndProgress = findBoundary(
      analysis,
      start,
      length,
      Math.max(0.65, travelEndProgress + 0.12),
      0.84,
      "fall"
    );
    const ratios = [
      0,
      introEndProgress,
      travelEndProgress,
      bloomEndProgress,
      1
    ];
    const chapters = CHAPTERS.map((chapter, index) => {
      const relativeStart = ratios[index];
      const relativeEnd = ratios[index + 1];
      const chapterStart = start + length * relativeStart;
      const chapterEnd = start + length * relativeEnd;
      return {
        ...chapter,
        index: index + 1,
        start: Number(chapterStart.toFixed(3)),
        end: Number(chapterEnd.toFixed(3)),
        length: Number((chapterEnd - chapterStart).toFixed(3)),
        relativeStart,
        relativeEnd,
        energy: Number(mean(valuesBetween(analysis, chapterStart, Math.max(chapterEnd, chapterStart + 0.05))).toFixed(3))
      };
    });

    return {
      version: VERSION,
      section: {
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        length: Number(length.toFixed(3))
      },
      chapters,
      fallback: analysis.fallback
    };
  }

  function chapterAt(timeline, progressOrPosition, absolutePosition = false) {
    if (!timeline || !Array.isArray(timeline.chapters) || !timeline.chapters.length) return null;
    const section = timeline.section || {};
    const progress = absolutePosition
      ? (progressOrPosition - (section.start || 0)) / Math.max(0.001, section.length || 1)
      : progressOrPosition;
    const safeProgress = clamp(progress, 0, 0.999999);
    const chapter =
      timeline.chapters.find((item) => safeProgress >= item.relativeStart && safeProgress < item.relativeEnd) ||
      timeline.chapters[timeline.chapters.length - 1];
    return {
      chapter,
      progress: safeProgress,
      localProgress: clamp((safeProgress - chapter.relativeStart) / Math.max(0.001, chapter.relativeEnd - chapter.relativeStart), 0, 1)
    };
  }

  return Object.freeze({
    version: VERSION,
    chapters: CHAPTERS,
    analyzeEnergy,
    normalizeAnalysis,
    pickBestSection,
    buildChapterTimeline,
    createFallbackAnalysis,
    chapterAt
  });
});
