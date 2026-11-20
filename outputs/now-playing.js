(() => {
  'use strict';
  const {lyricAt,formatTime}=window.SonicListeningCore;
  const karaoke=window.SonicLyricKaraoke;
  const empty=[];

  function mount(root,seek) {
    const preview=root.querySelector('[data-lyric-preview]');
    const rows=Array.from(preview.querySelectorAll('[data-preview-line]'));
    const previewTranslation=preview.querySelector('[data-preview-translation]');
    const scroll=root.querySelector('[data-full-lyrics]');
    const follow=root.querySelector('[data-lyric-follow]');
    const fullTools=root.querySelector('[data-lyric-full-tools]');
    let lines, active=-2, fullIndex=-2, lastPosition=0, followAfter=0, groups=[], currentNode;

    function makeHighlight(container,line,end) {
      currentNode=container;
      if(!line){groups=[];return;}
      const timed=karaoke.timedSpans?.(line,end)||[];
      if(!timed.length){container.textContent=line.text;groups=[];return;}
      const glyphs=Array.from(line.text), fragment=document.createDocumentFragment();
      let offset=0;
      groups=timed.map(span=>{
        if(span.index>offset)fragment.append(glyphs.slice(offset,span.index).join(''));
        const node=document.createElement('span');node.className='lr-timed-group';node.textContent=span.text;
        fragment.append(node);offset=span.index+Array.from(span.text).length;
        return {...span,node,fill:-1};
      });
      if(offset<glyphs.length)fragment.append(glyphs.slice(offset).join(''));
      container.replaceChildren(fragment);
    }

    function updateGroups(position) {
      for(const group of groups) {
        const fill=Math.round(karaoke.progress(group,position)*100);
        if(fill===group.fill)continue;
        group.fill=fill;group.node.style.setProperty('--lr-word-fill',fill+'%');
      }
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
      if(!nextLines.length){const blank=document.createElement('p');blank.textContent='此曲暂无同步歌词';fragment.append(blank);}
      scroll.replaceChildren(fragment);scroll.scrollTop=0;
    }

    function centerLine(immediate) {
      const row=fullIndex>=0?scroll.children[fullIndex]:null;
      if(!row)return;
      const nextTop=scroll.scrollTop+row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-(scroll.clientHeight-row.offsetHeight)/2;
      scroll.scrollTo({top:Math.max(0,nextTop),behavior:immediate||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }

    function sync(state,position,{expanded=false,full=false,force=false}={}) {
      const nextLines=state.lyrics.length?state.lyrics:empty;
      const {index,line,end}=lyricAt(nextLines,position,state.lyricDuration);
      if(expanded&&!full)return;
      const changed=lines!==nextLines;
      if(changed){lines=nextLines;active=fullIndex=-2;followAfter=0;groups=[];currentNode=null;if(full)fillFull(lines);}
      if(full) {
        if(index!==fullIndex) {
          const previous=scroll.children[fullIndex];
          if(previous){previous.removeAttribute('aria-current');previous.querySelector('.lr-full-text').textContent=lines[fullIndex]?.text||'';}
          fullIndex=index;
          const row=scroll.children[index];
          if(row){row.setAttribute('aria-current','true');makeHighlight(row.querySelector('.lr-full-text'),line,end);}
          else groups=[];
          if(performance.now()>=followAfter){follow.hidden=true;centerLine(force||changed||Math.abs(lastPosition-position)>1.3);}
        }
      }else if(active!==index||currentNode!==rows[1]) {
        active=index;
        rows[0].textContent=lines[index-1]?.text||'';
        rows[1].textContent=line?.text||(lines.length?'歌词即将开始':state.external?'正在联动外部声音':'此曲暂无同步歌词');
        rows[2].textContent=lines[index+1]?.text||'';
        previewTranslation.textContent=line?.translation||'';
        previewTranslation.hidden=!line?.translation;
        makeHighlight(rows[1],line,end);
      }
      lastPosition=position;updateGroups(position);
      if(full&&force)centerLine(true);
    }

    scroll.addEventListener('click',event=>{
      const row=event.target.closest('[data-full-line]');
      const line=lines?.[Number(row?.dataset.fullLine)];
      if(line){followAfter=0;follow.hidden=true;seek(line.time);}
    });
    function pauseFollow(){if(lines?.length){followAfter=performance.now()+6500;follow.hidden=false;}}
    scroll.addEventListener('wheel',pauseFollow,{passive:true});
    scroll.addEventListener('touchmove',pauseFollow,{passive:true});
    scroll.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key))pauseFollow();});
    follow.addEventListener('click',()=>{followAfter=0;follow.hidden=true;centerLine(true);});

    return {
      sync,
      setView(expanded,full) {
        preview.hidden=expanded;scroll.hidden=!full;fullTools.hidden=!full;
        follow.hidden=true;lines=null;
      },
    };
  }

  window.SonicNowPlaying=Object.freeze({mount});
})();
