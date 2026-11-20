'use strict';

const caption = window.sonicDesktopLyrics;
const track = document.getElementById('track');
const status = document.getElementById('status');
const current = document.getElementById('current');
const next = document.getElementById('next');
const controls = document.getElementById('controls');

caption.onState(state => {
  track.textContent = state.trackName || (state.external ? '外部音乐' : '声波宇宙');
  current.textContent = state.lyric || (state.nextLyric ? '歌词即将开始' : '暂无同步歌词');
  current.dataset.empty = String(!state.lyric);
  next.textContent = state.nextLyric;
  next.hidden = !state.nextLyric;
  status.textContent = state.playing || state.external ? '' : '已暂停';
  status.hidden = !status.textContent;
  controls.hidden = state.locked;
});

document.getElementById('close').addEventListener('click', () => caption.close());
document.getElementById('lock').addEventListener('click', () => caption.lock());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') caption.close();
});
