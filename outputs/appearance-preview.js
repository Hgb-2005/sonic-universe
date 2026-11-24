(() => {
  'use strict';

  const core=window.SonicListeningCore, karaoke=window.SonicLyricKaraoke;
  const backgrounds=window.SonicPlaybackBackgrounds, effects=window.SonicLyricEffects;
  const sample=[
    {time:0,text:'夜色漫过窗沿',points:[{index:0,time:0},{index:2,time:.48},{index:4,time:1.16}]},
    {time:2.5,text:'远处还有一束光',points:[{index:0,time:2.5},{index:2,time:3.1},{index:4,time:3.8}]},
  ];

  function mount(dialog,state) {
    const view=dialog.querySelector('[data-player-bg-composition]');
    const canvas=view.querySelector('canvas'), context=canvas.getContext('2d');
    const stage=view.querySelector('[data-player-bg-effect]'), tide=view.querySelector('[data-player-bg-tide]');
    const cover=view.querySelector('[data-design-cover]'), fallback=view.querySelector('[data-design-cover-fallback]');
    const title=view.querySelector('[data-design-title]'), artist=view.querySelector('[data-design-artist]');
    const before=view.querySelector('[data-design-before]'), after=view.querySelector('[data-design-after]');
    const lyric=view.querySelector('strong'), translation=lyric.nextElementSibling;
    const style=view.querySelector('.lr-player-bg-style'), progress=view.querySelector('[data-design-progress]');
    const replay=dialog.querySelector('[data-design-replay]');
    const loading=dialog.querySelector('[data-design-load]');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let current, loaded, pendingId, sequence=0, frame=0, last=0, painted='', shownLine, shownEnd, groups=[];
    let clip=null, playbackPosition=0, coverUrl;

    function setText(node,value='') {
      if(node.textContent!==value)node.textContent=value;
    }
    function setCover(url) {
      if(url===coverUrl)return;
      coverUrl=url;
      cover.hidden=true;fallback.hidden=false;
      if(!url){cover.removeAttribute('src');return;}
      cover.referrerPolicy='no-referrer';
      cover.src=url;
      void cover.decode().then(()=>{
        if(dialog.open&&url===coverUrl){cover.hidden=false;fallback.hidden=true;}
      }).catch(()=>{});
    }
    function setLine(line,end) {
      if(line===shownLine&&end===shownEnd)return;
      shownLine=line;shownEnd=end;groups=[];
      const text=line?.text||'等待歌词';
      const units=line?karaoke.timedSpans(line,end):[];
      lyric.title=text;
      lyric.style.setProperty('--design-line-length',Math.max(10,karaoke.split(text).reduce((length,char)=>length+(/\p{ASCII}/u.test(char)?.52:1),0)));
      if(!units.length)lyric.textContent=text;
      else {
        const glyphs=karaoke.split(text);
        let index=0;
        const fragment=document.createDocumentFragment();
        for(const unit of units){
          fragment.append(glyphs.slice(index,unit.index).join(''));
          const node=document.createElement('span');
          node.className='lr-design-word';node.textContent=unit.text;
          fragment.append(node);groups.push({...unit,node});
          index=unit.index+karaoke.split(unit.text).length;
        }
        fragment.append(glyphs.slice(index).join(''));
        lyric.replaceChildren(fragment);
      }
    }

    function stopClip() {
      clip=null;
      replay.setAttribute('aria-pressed','false');
      setText(replay.lastElementChild,'试看动效');
    }

    function update(now=performance.now()) {
      if(!dialog.open)return;
      const data=state(), settings=data.settings;
      const desired=backgrounds.get(backgrounds.normalize(settings.playbackBackground));
      if(desired.id!==pendingId){
        pendingId=desired.id;
        const request=++sequence;
        if(desired.photo)setText(loading,'正在加载');
        else setText(loading);
        void backgrounds.load(desired).then(resource=>{
          if(request!==sequence||!dialog.open)return;
          current=desired;loaded=resource;painted='';setText(loading);update();
        }).catch(()=>{
          if(request!==sequence||!dialog.open)return;
          setText(loading,'背景暂不可用');
        });
      }
      const entry=current||backgrounds.get('default');
      const effect=settings.lyricStyle==='effects'?effects.get(settings.lyricEffect):null;
      const layout=['list','compact','stage'].includes(settings.lyricStyle)?settings.lyricStyle:'single';
      const elapsed=clip?(now-clip.started)/1000:0;
      if(clip&&(elapsed>=clip.length||clip.trackId!==data.trackId))stopClip();
      const usingSample=Boolean(clip?.sample)||!data.lines.length;
      const lines=usingSample?sample:data.lines;
      playbackPosition=clip?clip.position+elapsed:usingSample ? .55 : data.position;
      if(!clip&&!data.playing&&lines.length&&playbackPosition<lines[0].time)playbackPosition=lines[0].time;
      const {index,line,end}=core.lyricAt(lines,playbackPosition,usingSample?5:data.duration);
      const treatment=backgrounds.lyricBackdrop(entry,effect);
      const adaptive=backgrounds.lightReadingSurface(entry)||Boolean(entry.photo);
      view.dataset.tone=entry.tone||'dark';view.dataset.layout=layout;view.dataset.background=entry.id;
      view.dataset.look=effect?.id||settings.lyricStyle;
      view.dataset.lyricBackdrop=treatment;
      view.toggleAttribute('data-light-reading-surface',adaptive);
      view.toggleAttribute('data-effect',Boolean(effect&&effect.id!=='still'));
      view.style.setProperty('--design-accent',data.accent);
      effects.applyBackdrop(stage,effect,treatment==='soft');
      tide.hidden=effect?.id!=='tide'||Boolean(entry.photo);
      setCover(data.cover);
      setText(title,data.title||'歌词示例');setText(artist,data.artist);
      setText(before,lines[index-1]?.text);setText(after,lines[index+1]?.text);
      setLine(line,end);
      const animated=!reduced.matches&&(Boolean(clip)||data.playing);
      const motion=line?effects.lineFrame(playbackPosition,line.time,end,animated):{enter:1,phase:0,direction:0};
      stage.style.setProperty('--fx-enter',motion.enter.toFixed(3));
      stage.style.setProperty('--fx-phase',motion.phase.toFixed(3));
      stage.style.setProperty('--fx-direction',motion.direction.toFixed(3));
      const response=settings.response/100, signal=animated?data.energy():0;
      stage.style.setProperty('--fx-beat',(signal*response).toFixed(3));
      view.style.setProperty('--design-enter',motion.enter.toFixed(3));
      for(const unit of groups)unit.node.style.setProperty('--design-sung',Math.round(karaoke.progress(unit,playbackPosition)*100)+'%');
      translation.hidden=!line?.translation||settings.lyricStyle==='fly';setText(translation,line?.translation);
      setText(style,data.style);setText(progress,usingSample?'示例歌词':core.formatTime(Math.max(0,playbackPosition-data.offset)));
      replay.disabled=reduced.matches;

      const width=view.clientWidth,height=view.clientHeight;
      if(!context||!width||!height)return;
      const moving=animated&&entry.motion!=='static';
      const time=moving?(clip?elapsed:data.position):0;
      const artwork=entry.id==='default'?[...data.artwork.base,...data.artwork.primary,...data.artwork.secondary]:
        entry.preset?.cover&&!entry.photo?data.artwork.primary:[];
      const key=[entry.id,width,height,settings.brightness,data.energySaver,...artwork.map(Math.round)].join('/');
      if(key!==painted||moving){
        painted=key;
        const scale=core.playbackRenderScale(width,height,Math.min(1.5,devicePixelRatio||1),{energySaver:data.energySaver,photo:Boolean(entry.photo)});
        const w=Math.round(width*scale),h=Math.round(height*scale);
        if(w!==canvas.width||h!==canvas.height){canvas.width=w;canvas.height=h;}
        context.setTransform(w/width,0,0,h/height,0,0);
        if(entry.id==='default')data.drawDefault(context,width,height,time,signal);
        else backgrounds.draw(context,entry,{width,height,time,energy:signal*response,quality:.56,
          brightness:settings.brightness/100,artwork:data.artwork,preview:true,
          seed:window.SonicReactiveScenes?.seedFor(entry.id)||1},loaded);
      }
    }
    function tick(now) {
      if(!dialog.open||document.hidden){frame=0;return;}
      if(now-last>=(state().energySaver?66:42)){last=now;update(now);}
      frame=requestAnimationFrame(tick);
    }
    function start() {
      if(!frame&&dialog.open&&!document.hidden){update();frame=requestAnimationFrame(tick);}
    }
    replay.addEventListener('click',()=>{
      if(reduced.matches)return;
      if(clip){stopClip();update();return;}
      const data=state();
      const {index}=core.lyricAt(data.lines,data.position,data.duration);
      const first=data.lines[Math.min(Math.max(0,index),Math.max(0,data.lines.length-2))];
      const next=data.lines[data.lines.indexOf(first)+1];
      const useSample=!next||next.time-first.time>4.5;
      clip={started:performance.now(),position:useSample?0:first.time,length:useSample?5:Math.min(8,next.time-first.time+2),
        sample:useSample,trackId:data.trackId};
      replay.setAttribute('aria-pressed','true');
      setText(replay.lastElementChild,'停止试看');update();start();
    });
    replay.setAttribute('aria-pressed','false');
    document.addEventListener('visibilitychange',start);
    reduced.addEventListener('change',()=>{if(reduced.matches)stopClip();update();});
    dialog.addEventListener('close',()=>{
      if(dialog.open)return;
      sequence++;cancelAnimationFrame(frame);frame=0;
      current=loaded=pendingId=clip=undefined;painted='';shownLine=undefined;shownEnd=undefined;
      canvas.width=canvas.height=0;
      coverUrl=undefined;cover.removeAttribute('src');cover.hidden=true;fallback.hidden=false;
      stopClip();setText(loading);
    });
    return {start,update};
  }
  window.SonicAppearancePreview=Object.freeze({mount});
})();
