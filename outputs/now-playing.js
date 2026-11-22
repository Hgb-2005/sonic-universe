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
    let targetLine, targetEnd, targetMessage, targetGroups=[];

    function emptyMessage(state,nextLines) {
      if(nextLines.length)return '歌词即将开始';
      if(state.lyricsInfo?.state==='loading')return '正在查找同步歌词…';
      if(state.external)return '正在联动外部声音';
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
        if(visible)root.dataset.lyricSeeking='true';
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
        time.className='lr-full-time';time.textContent=formatTime(line.time);time.setAttribute('aria-hidden','true');
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

    function centerLine(immediate) {
      const row=fullIndex>=0?scroll.children[fullIndex]:null;
      let nextTop=0;
      if(row){
        const bounds=row.getBoundingClientRect();
        nextTop=scroll.scrollTop+bounds.top-scroll.getBoundingClientRect().top-scroll.clientTop+(bounds.height-scroll.clientHeight)/2;
      }
      scroll.scrollTo({top:Math.max(0,nextTop),behavior:immediate||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }

    function showFollowButton(visible) {
      if(follow.hidden===!visible)return;
      if(!visible&&!scroll.hidden&&document.activeElement===follow)scroll.focus({preventScroll:true});
      follow.hidden=!visible;
    }

    function resumeFollowing() {
      following=true;
      readingTop=0;
      showFollowButton(false);
    }

    function rememberReading() {
      if(view==='full'&&!following&&lines?.length)readingTop=scroll.scrollTop;
    }

    function sync(state,position,{full=false,force=false}={}) {
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
      if(full) {
        const currentChanged=index!==fullIndex;
        if(currentChanged) {
          const previous=scroll.children[fullIndex];
          if(previous){previous.removeAttribute('aria-current');previous.querySelector('.lr-full-text').textContent=lines[fullIndex]?.text||'';}
          fullIndex=index;
          const row=scroll.children[index];
          if(row){
            row.setAttribute('aria-current','true');
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
        if(following&&(currentChanged||force))centerLine(force||changed||Math.abs(lastPosition-position)>1.3);
      }else if(active!==index||currentNode!==rows[1]||(!line&&previewMessage!==emptyMessage(state,nextLines))) {
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
      if(line){resumeFollowing();seek(line.time);}
    });
    function pauseFollow() {
      if(!following||!lines?.length||scroll.scrollHeight<=scroll.clientHeight)return;
      following=false;
      scroll.scrollTo({top:scroll.scrollTop,behavior:'instant'});
      showFollowButton(true);
    }
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
      if(event.clientX<left||event.clientX>=right||event.target===scroll&&overlayEdge<=12)pauseFollow();
    });
    follow.addEventListener('click',()=>{resumeFollowing();centerLine(true);});

    return {
      sync,showSeek,
      followAfterSeek(){if(view==='full')resumeFollowing();},
      setView(nextView) {
        if(view===nextView)return;
        rememberReading();
        if(nextView==='preview')resumeFollowing();
        view=nextView;
        preview.hidden=view!=='preview'&&view!=='immersive';scroll.hidden=view!=='full';fullTools.hidden=scroll.hidden;
        showFollowButton(false);lines=null;
      },
    };
  }

  window.SonicNowPlaying=Object.freeze({mount});
})();
