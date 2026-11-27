(() => {
  'use strict';
  const {lyricAt,formatTime}=window.SonicListeningCore;
  const karaoke=window.SonicLyricKaraoke;
  const empty=[];

  function mount(root,seek) {
    const preview=root.querySelector('[data-lyric-preview]');
    const rows=Array.from(preview.querySelectorAll('[data-preview-line]'));
    const previewButtons=Array.from(preview.querySelectorAll('[data-preview-row]'));
    const previewTranslation=preview.querySelector('[data-preview-translation]');
    // 「全文歌词」已收进「更多」菜单，不再和预览行同处一个容器。
    const fullEntry=root.querySelector('[data-now-lyrics]');
    const importEntry=preview.querySelector('[data-import-current-lyrics]');
    const seekPreview=root.querySelector('[data-seek-lyrics]');
    const seekTime=seekPreview.querySelector('[data-seek-time]');
    const seekText=seekPreview.querySelector('[data-seek-line]');
    const seekTranslation=seekPreview.querySelector('[data-seek-translation]');
    const scroll=root.querySelector('[data-full-lyrics]');
    const follow=root.querySelector('[data-lyric-follow]');
    const fullTools=root.querySelector('[data-lyric-full-tools]');
    const fullNotice=document.createElement('p');
    let lines, trackId, queueEntryId, active=-2, fullIndex=-2, lastPosition=0, groups=[], currentNode;
    let view, following=true, readingTop=0, previewMessage='';
    let autoReturn=false, returnTimer=0, pointerHeld=false;
    let targetLine, targetEnd, targetMessage, targetGroups=[];
    let scrollFrame=0;
    let scrollMode='smooth', lineTracks=[];
    let immersionMotion=[];
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    const immersionLines=preview.querySelector('.lr-now-lines');
    const immersionSizes=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{
      for(const {target,contentRect} of entries){
        const property=target===rows[1]?'--lr-immersion-body-height':'--lr-immersion-caption-height';
        immersionLines.style.setProperty(property,contentRect.height+'px');
      }
    }):null;

    function stopImmersionMotion() {
      for(const animation of immersionMotion)animation.cancel();
      immersionMotion=[];
    }

    function animateImmersionLine(secondsLeft) {
      if(reducedMotion.matches||!rows[1].animate)return;
      const duration=Math.max(65,Math.min(160,secondsLeft*152));
      immersionMotion=[previewButtons[1].animate(
        [{transform:'translateY(3px)'},{transform:'none'}],
        {duration,easing:'cubic-bezier(.22,.61,.36,1)'}
      )];
    }
    reducedMotion.addEventListener('change',()=>{
      stopImmersionMotion();
      if(reducedMotion.matches&&view==='full'&&following)centerLine(true);
    });

    function emptyMessage(state,nextLines) {
      if(nextLines.length)return '歌词即将开始';
      const status={
        loading:'正在查找同步歌词…',unavailable:'暂时无法获取歌词',disabled:'此曲歌词已关闭',cleared:'此曲歌词已清除',
      }[state.lyricsInfo?.state];
      if(status)return status;
      if(state.external)return '正在联动外部声音';
      if(state.track&&/纯音乐|纯伴奏|伴奏版|\binstrumental\b/i.test([state.track.name,state.track.album].join(' ')))
        return '这版录音为纯音乐或伴奏，暂无同步歌词';
      return state.track?'此曲暂无同步歌词':'播放一首歌后显示歌词';
    }

    function makeHighlight(container,line,end) {
      const timed=karaoke.timedSpans(line,end);
      if(!timed.length){container.textContent=line.text;return [];}
      const glyphs=Array.from(line.text), fragment=document.createDocumentFragment();
      let offset=0;
      const highlights=timed.map(span=>{
        if(span.index>offset)fragment.append(glyphs.slice(offset,span.index).join(''));
        const node=document.createElement('span');node.className='lr-timed-group';node.textContent=span.text;
        fragment.append(node);offset=span.index+Array.from(span.text).length;
        return {...span,node,fill:-1};
      });
      if(offset<glyphs.length)fragment.append(glyphs.slice(offset).join(''));
      container.replaceChildren(fragment);
      return highlights;
    }

    function updateGroups(highlights,position) {
      for(const group of highlights) {
        const fill=Math.round(karaoke.progress(group,position)*100);
        if(fill===group.fill)continue;
        group.fill=fill;group.node.style.setProperty('--lr-word-fill',fill+'%');
      }
    }

    function showSeek(state,position) {
      const visible=view!=='hidden'&&Number.isFinite(position);
      if(seekPreview.hidden===visible){
        seekPreview.hidden=!visible;
        if(visible){root.dataset.lyricSeeking='true';stopImmersionMotion();}
        else delete root.dataset.lyricSeeking;
      }
      if(!visible)return;
      const time=formatTime(position);
      if(seekTime.textContent!==time)seekTime.textContent=time;
      const lyricPosition=position+state.lyricPosition-state.position;
      const {line,end}=lyricAt(state.lyrics,lyricPosition,state.lyricDuration);
      const message=line?'':state.lyrics.length?'前奏':emptyMessage(state,state.lyrics);
      if(line!==targetLine||end!==targetEnd||message!==targetMessage){
        targetLine=line;targetEnd=end;targetMessage=message;
        targetGroups=line?makeHighlight(seekText,line,end):[];
        if(line)seekText.dataset.timing=targetGroups.length?'word':'line';
        else {
          delete seekText.dataset.timing;
          seekText.textContent=message;
        }
        seekTranslation.textContent=line?.translation||'';
        seekTranslation.hidden=!line?.translation;
      }
      updateGroups(targetGroups,lyricPosition);
    }

    function fillFull(nextLines) {
      const fragment=document.createDocumentFragment();
      nextLines.forEach((line,index)=>{
        const row=document.createElement('button');row.type='button';row.dataset.fullLine=String(index);
        const time=document.createElement('span'),content=document.createElement('span'),text=document.createElement('span');
        time.className='lr-full-time';time.textContent=formatTime(line.time);
        content.className='lr-full-content';
        text.className='lr-full-text';text.textContent=line.text;
        content.append(text);
        if(line.translation){
          const translation=document.createElement('span');translation.className='lr-full-translation';translation.textContent=line.translation;
          content.append(translation);
        }
        row.append(time,content);fragment.append(row);
      });
      if(!nextLines.length)fragment.append(fullNotice);
      scroll.replaceChildren(fragment);
      scroll.scrollTo({top:following?0:readingTop,behavior:'instant'});
    }

    function stopScroll() {
      cancelAnimationFrame(scrollFrame);
      scrollFrame=0;
      for(const animation of lineTracks)animation.cancel();
      lineTracks=[];
    }

    function centerLine(immediate, secondsLeft=.65, previousIndex=-1) {
      stopScroll();
      const row=fullIndex>=0?scroll.children[fullIndex]:null;
      let nextTop=0;
      if(row){
        const bounds=row.getBoundingClientRect();
        nextTop=scroll.scrollTop+bounds.top-scroll.getBoundingClientRect().top-scroll.clientTop+(bounds.height-scroll.clientHeight)/2;
      }
      const from=scroll.scrollTop;
      const target=Math.max(0,Math.min(nextTop,scroll.scrollHeight-scroll.clientHeight));
      const distance=target-from;
      if(immediate||reducedMotion.matches||root.dataset.modMotion==='still'||Math.abs(distance)<1){
        scroll.scrollTo({top:target,behavior:'instant'});
        return;
      }
      if(scrollMode!=='smooth'){
        moveLyricRows(target,secondsLeft,previousIndex);
        return;
      }
      // Leave part of each phrase at rest, including lines sung in quick succession.
      const duration=Math.max(72,Math.min(410,secondsLeft*660));
      const started=performance.now();
      function step(now) {
        const progress=reducedMotion.matches?1:Math.min(1,(now-started)/duration);
        scroll.scrollTop=from+distance*(1-(1-progress)**3);
        scrollFrame=progress<1?requestAnimationFrame(step):0;
      }
      scrollFrame=requestAnimationFrame(step);
    }

    function moveLyricRows(target,secondsLeft,previousIndex) {
      const first=Math.max(0,Math.min(previousIndex,fullIndex)-3);
      const last=Math.min(scroll.children.length,Math.max(previousIndex,fullIndex)+4);
      const rows=Array.from(scroll.children).slice(first,last);
      const before=rows.map(row=>row.getBoundingClientRect().top);
      scroll.scrollTo({top:target,behavior:'instant'});
      const duration=scrollMode==='track'?Math.max(100,Math.min(385,secondsLeft*610)):
        Math.max(75,Math.min(255,secondsLeft*430));
      for(const [index,row] of rows.entries()){
        if(!row.animate)continue;
        const move=before[index]-row.getBoundingClientRect().top;
        const current=first+index===fullIndex, outgoing=first+index===previousIndex;
        if(Math.abs(move)<1||scrollMode==='track'&&current)continue;
        let frames;
        if(scrollMode==='track'){
          const bounce=Math.max(-8,Math.min(8,-move*.10));
          frames=[{transform:`translateY(${move}px)`},{transform:`translateY(${bounce}px)`,offset:.72},{transform:'none'}];
        }else{
          const distance=Math.max(-30,Math.min(30,move*(outgoing?.54:.4)));
          frames=current?[{transform:`translateY(${distance}px)`,opacity:.42},{transform:'none',opacity:1}]:
            outgoing?[{transform:`translateY(${distance}px)`,opacity:1},{transform:'translateY(-8px)',opacity:.48,offset:.72},{transform:'none',opacity:1}]:
            [{transform:`translateY(${distance}px)`},{transform:'none'}];
        }
        lineTracks.push(row.animate(frames,{duration,easing:'cubic-bezier(.22,.63,.32,1)'}));
      }
    }

    function markNeighbors(index, enabled) {
      for(const offset of [-2,-1,1,2]){
        const row=scroll.children[index+offset];
        if(!row?.hasAttribute('data-full-line'))continue;
        if(enabled)row.dataset.lyricDistance=Math.abs(offset)===1?'near':'context';
        else delete row.dataset.lyricDistance;
      }
    }

    function showFollowButton(visible) {
      if(follow.hidden===!visible)return;
      if(!visible&&!scroll.hidden&&document.activeElement===follow)scroll.focus({preventScroll:true});
      follow.hidden=!visible;
    }

    function resumeFollowing() {
      clearTimeout(returnTimer);
      following=true;
      readingTop=0;
      scroll.removeAttribute('data-reading');
      showFollowButton(false);
    }

    function rememberReading() {
      if(view==='full'&&!following&&lines?.length)readingTop=scroll.scrollTop;
    }

    function sync(state,position,{full=false,force=false}={}) {
      if(force&&view==='immersive')stopImmersionMotion();
      const trackChanged=trackId!==state.track?.id||queueEntryId!==state.queueEntryId;
      trackId=state.track?.id;
      queueEntryId=state.queueEntryId;
      if(trackChanged)resumeFollowing();
      if(view==='hidden'||view==='stage')return;
      const nextLines=state.lyrics.length?state.lyrics:empty;
      const {index,line,end}=lyricAt(nextLines,position,state.lyricDuration);
      const changed=trackChanged||lines!==nextLines;
      if(changed) {
        rememberReading();
        lines=nextLines;active=fullIndex=-2;groups=[];currentNode=null;
        if(full)fillFull(lines);
      }
      const canImport=!nextLines.length&&state.track?.kind==='file'&&!state.external;
      importEntry.hidden=!canImport;
      // 菜单里的「全文歌词」常驻显示，没有歌词时置灰，避免整个入口忽隐忽现。
      fullEntry.hidden=false;
      fullEntry.disabled=!nextLines.length;
      if(canImport)importEntry.setAttribute('aria-label','为《'+state.track.name+'》导入歌词');
      if(full) {
        const previousIndex=fullIndex;
        const currentChanged=index!==previousIndex;
        if(currentChanged) {
          const previous=scroll.children[previousIndex];
          if(previous){previous.removeAttribute('aria-current');previous.querySelector('.lr-full-text').textContent=lines[previousIndex]?.text||'';}
          if(previousIndex>=0)markNeighbors(previousIndex,false);
          fullIndex=index;
          const row=scroll.children[index];
          if(row){
            row.setAttribute('aria-current','true');
            markNeighbors(index,true);
            currentNode=row.querySelector('.lr-full-text');
            groups=makeHighlight(currentNode,line,end);
          }
          else {groups=[];currentNode=null;}
        }
        if(!lines.length){
          const message=emptyMessage(state,lines);
          if(fullNotice.textContent!==message)fullNotice.textContent=message;
        }
        showFollowButton(!following&&Boolean(lines.length));
        if(following&&(currentChanged||force)){
          const jumped=Math.abs(index-previousIndex)>1||Math.abs(lastPosition-position)>1.3;
          centerLine(force||changed||jumped,end-position,previousIndex);
        }
      }else if(active!==index||currentNode!==rows[1]||(!line&&previewMessage!==emptyMessage(state,nextLines))) {
        const natural=view==='immersive'&&!force&&!changed&&active>=0&&index===active+1&&
          position>=lastPosition&&position-lastPosition<.35&&seekPreview.hidden;
        if(view==='immersive')stopImmersionMotion();
        active=index;
        previewMessage=line?'':emptyMessage(state,nextLines);
        for(const [slot,button] of previewButtons.entries()) {
          const text=lines[index+slot-1]?.text;
          const isCurrent=slot===1;
          button.hidden=!isCurrent&&!text;
          button.disabled=!text;
          rows[slot].textContent=text||(isCurrent?previewMessage:'');
          if(isCurrent&&text)button.setAttribute('aria-current','true');
          else button.removeAttribute('aria-current');
        }
        previewTranslation.textContent=line?.translation||'';
        previewTranslation.hidden=!line?.translation;
        currentNode=rows[1];
        groups=line?makeHighlight(currentNode,line,end):[];
        if(natural)animateImmersionLine(end-position);
      }
      lastPosition=position;updateGroups(groups,position);
    }

    preview.addEventListener('click',event=>{
      const row=event.target.closest('[data-preview-row]');
      if(!row||row.disabled)return;
      const line=lines?.[active+Number(row.dataset.previewRow)];
      if(line)seek(line.time);
    });
    scroll.addEventListener('click',event=>{
      const row=event.target.closest('[data-full-line]');
      const line=lines?.[Number(row?.dataset.fullLine)];
      if(line)seek(line.time);
    });
    function scheduleReturn() {
      clearTimeout(returnTimer);
      if(!autoReturn||following||pointerHeld||view!=='full'||!lines?.length)return;
      returnTimer=setTimeout(()=>{
        resumeFollowing();
        centerLine(false,.65,fullIndex);
      },4000);
    }

    function pauseFollow() {
      if(!lines?.length||scroll.scrollHeight<=scroll.clientHeight)return;
      if(following){
        following=false;
        stopScroll();
        scroll.setAttribute('data-reading','');
        showFollowButton(true);
      }
      scheduleReturn();
    }
    scroll.addEventListener('scroll',scheduleReturn,{passive:true});
    scroll.addEventListener('wheel',event=>{if(event.deltaY&&!event.ctrlKey)pauseFollow();},{passive:true});
    scroll.addEventListener('touchmove',event=>{if(event.touches.length===1)pauseFollow();},{passive:true});
    scroll.addEventListener('keydown',event=>{
      if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key))pauseFollow();
    });
    scroll.addEventListener('pointerdown',event=>{
      if(event.pointerType==='touch')return;
      if(event.button===1){pauseFollow();return;}
      if(event.button!==0)return;
      const left=scroll.getBoundingClientRect().left+scroll.clientLeft;
      const right=left+scroll.clientWidth;
      const overlayEdge=getComputedStyle(scroll).direction==='rtl'?event.clientX-left:right-event.clientX;
      if(event.clientX<left||event.clientX>=right||event.target===scroll&&overlayEdge<=12){
        pointerHeld=true;
        pauseFollow();
      }
    });
    for(const event of ['pointerup','pointercancel','blur']){
      window.addEventListener(event,()=>{
        if(!pointerHeld)return;
        pointerHeld=false;
        scheduleReturn();
      });
    }
    follow.addEventListener('click',()=>{resumeFollowing();centerLine(true);});

    return {
      sync,showSeek,followPlayback:resumeFollowing,
      setAutoReturn(enabled) {
        if(autoReturn===enabled)return;
        autoReturn=enabled;
        scheduleReturn();
      },
      setScrollMode(mode) {
        if(mode===scrollMode)return;
        scrollMode=mode;scroll.dataset.scrollEffect=mode;
        stopScroll();
        if(view==='full'&&following)centerLine(true);
      },
      setView(nextView) {
        if(view===nextView)return;
        stopImmersionMotion();
        immersionSizes?.disconnect();
        stopScroll();
        rememberReading();
        view=nextView;
        preview.hidden=view!=='preview'&&view!=='immersive';scroll.hidden=view!=='full';fullTools.hidden=scroll.hidden;
        if(view==='immersive'){
          immersionSizes?.observe(rows[1]);
          immersionSizes?.observe(previewTranslation);
        }
        showFollowButton(false);lines=null;
        clearTimeout(returnTimer);
      },
    };
  }

  window.SonicNowPlaying=Object.freeze({mount});
})();
