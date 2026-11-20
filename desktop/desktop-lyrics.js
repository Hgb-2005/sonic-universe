'use strict';

const caption = window.sonicDesktopLyrics;
const track = document.getElementById('track');
const status = document.getElementById('status');
const current = document.getElementById('current');
const next = document.getElementById('next');
const previous = document.getElementById('previous');
const translation = document.getElementById('translation');
const controls = document.getElementById('controls');
const layout = document.getElementById('layout');
const translationToggle = document.getElementById('translationToggle');
const modes = { single:'单行', double:'双行', scroll:'滚动' };
const key = 'sonic-desktop-caption-v1';
let mode='double', showTranslation=true, state={};
try {
  const saved=JSON.parse(localStorage.getItem(key));
  if(saved&&Object.hasOwn(modes,saved.mode))mode=saved.mode;
  if(typeof saved?.showTranslation==='boolean')showTranslation=saved.showTranslation;
} catch {}

function render(){
  document.body.dataset.layout=mode;
  layout.textContent=modes[mode];
  layout.setAttribute('aria-label','切换歌词布局，当前'+modes[mode]);
  translationToggle.setAttribute('aria-pressed',String(showTranslation));
  track.textContent = state.trackName || (state.external ? '外部音乐' : '声波宇宙');
  const line=state.lyric || (state.nextLyric ? '歌词即将开始' : '暂无同步歌词');
  if(current.textContent!==line){
    current.textContent=line;
    if(mode==='scroll'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      current.getAnimations().forEach(animation=>animation.cancel());
      current.animate([{transform:'translateY(7px)',opacity:.55},{transform:'translateY(0)',opacity:1}],{duration:240,easing:'ease-out'});
    }
  }
  current.dataset.empty = String(!state.lyric);
  previous.textContent=state.previousLyric||'';previous.hidden=mode!=='scroll'||!state.previousLyric;
  next.textContent = state.nextLyric||'';
  next.hidden = mode==='single'||!state.nextLyric;
  translation.textContent=state.translation||'';translation.hidden=!showTranslation||!state.translation;
  status.textContent = state.playing || state.external ? '' : '已暂停';
  status.hidden = !status.textContent;
  controls.hidden = state.locked;
}
function save(){try{localStorage.setItem(key,JSON.stringify({mode,showTranslation}));}catch{}render();}
caption.onState(value=>{state=value;render();});
layout.addEventListener('click',()=>{const keys=Object.keys(modes);mode=keys[(keys.indexOf(mode)+1)%keys.length];save();});
translationToggle.addEventListener('click',()=>{showTranslation=!showTranslation;save();});

document.getElementById('close').addEventListener('click', () => caption.close());
document.getElementById('lock').addEventListener('click', () => caption.lock());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') caption.close();
});
