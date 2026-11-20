'use strict';
const desktop=window.sonicDesktop;
const format=value=>{const seconds=Math.floor(Math.max(0,value||0));return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
desktop.onPlayerState(state=>{
  document.getElementById('title').textContent=state.track.name;document.getElementById('artist').textContent=state.track.artist||'声波宇宙 · 当前播放';
  document.getElementById('lyric').textContent=state.lyric||'把喜欢的声音，留在身边。';document.getElementById('time').textContent=state.external&&!state.duration?'外部声音 · LIVE':format(state.position)+' / '+format(state.duration);
  document.getElementById('play').textContent=state.playing?'Ⅱ':'▶';document.getElementById('play').setAttribute('aria-label',state.playing?'暂停音乐':'播放音乐');
  for(const button of document.querySelectorAll('.controls button'))button.disabled=state.external;
});
document.addEventListener('click',event=>{const command=event.target.closest('[data-command]')?.dataset.command;if(command)desktop.command(command);});
