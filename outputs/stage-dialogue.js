/* Dialogue follows the media time, including when pausing or seeking mid-message. */
(() => {
  'use strict';
  const clamp = value => Math.max(0,Math.min(1,value));
  const ease = value => 1-(1-clamp(value))**3;
  function side(line,index) {
    return line.singer==='left'||line.singer==='right' ? line.singer : index%2===0?'right':'left';
  }
  function reactionAt(lines,index) {
    const line=lines[index],prior=lines[index-1];
    if(!line||line.silent)return '';
    if(line.isChorus&&!prior?.isChorus&&lines[index+1]?.isChorus)return 'spark';
    if(index%4===2)return 'wave';
    return '';
  }
  function textElement(className) {
    const span=document.createElement('span');
    span.className=className;
    return span;
  }
  function mount(host,lead,partner) {
    const anchor=partner?.nextSibling||lead.nextSibling;
    const live=partner?[lead,partner]:[lead];
    const thread=document.createElement('div'),history=document.createElement('div'),current=document.createElement('div');
    thread.className='du-thread';thread.hidden=true;
    history.className='du-history';history.setAttribute('aria-hidden','true');
    current.className='du-current';
    thread.append(history,current);host.append(thread);
    new ResizeObserver(([entry])=>{
      thread.style.setProperty('--du-message-height',entry.contentRect.height+'px');
    }).observe(current);
    let previousLines,previousIndex=-1,previousLead,previousPartner,reaction='';

    function pastLines(lines,index,active) {
      const rows=[];
      for(let i=index-1;i>=0&&rows.length<3;i--){
        const line=lines[i],next=lines[i+1];
        if(line.silent||!line.text.trim()||next.time-(line.end??line.time)>(Number.isFinite(line.end)?2.5:12))break;
        if(active.includes(line))continue;
        const bubble=textElement('du-msg du-past');
        const body=textElement('du-text');body.textContent=line.text;
        bubble.dataset.duSide=side(line,i);
        bubble.append(body);rows.unshift(bubble);
      }
      history.replaceChildren(...rows);
    }
    function paint(lines,index,entry,other,position,motion,phase='sing') {
      const line=entry.line,second=other?.line;
      const entering=thread.hidden;
      if(entering){
        thread.hidden=false;
        for(const bubble of live){
          bubble.classList.add('du-msg');
          current.append(bubble);
        }
      }
      if(entering||previousLines!==lines||previousIndex!==index||previousLead!==line||previousPartner!==second){
        lead.dataset.duSide=side(line,index);
        if(second)partner.dataset.duSide=side(second,index);
        reaction=second?'':reactionAt(lines,index);
        if(reaction)lead.dataset.duReaction=reaction;else delete lead.dataset.duReaction;
        pastLines(lines,index,[line,second]);
        previousLines=lines;previousIndex=index;previousLead=line;previousPartner=second;
      }
      const age=position-Math.max(line.time,second?.time??line.time);
      const span=Math.max(.16,Math.min(.52,(entry.end-line.time)*.41));
      const progress=motion&&phase==='sing'?ease(age/span):1;
      const movement=motion ? .70+.30*motion : 0;
      thread.style.setProperty('--du-enter',((1-progress)*movement).toFixed(4));
      thread.style.setProperty('--du-alpha',(.12+.88*ease((progress-.09)/.91)).toFixed(4));
      if(reaction){
        const length=entry.end-line.time;
        const appearAt=Math.min(.33,length*.21);
        const fadeAt=Math.min(1.95,length*.76);
        const show=phase==='sing'?ease((age-appearAt)/.28)*ease((fadeAt+.25-age)/.25):0;
        thread.style.setProperty('--du-reaction-alpha',show.toFixed(4));
        thread.style.setProperty('--du-reaction-lift',(motion ? (1-show)*.36 : 0).toFixed(4)+'em');
      }
    }
    function hide() {
      if(thread.hidden)return;
      thread.hidden=true;
      for(const bubble of live){
        bubble.classList.remove('du-msg');delete bubble.dataset.duSide;delete bubble.dataset.duReaction;
        host.insertBefore(bubble,anchor);
      }
    }
    return {paint,hide};
  }
  function audition(host,button,replay) {
    const lead=textElement('du-preview-message'),type=textElement('du-text');
    lead.append(type);host.append(lead);
    const renderer=mount(host,lead);
    const lines=['你听见海风了吗？','听见了，灯还亮着。','那就再听一会儿。','好，等潮声慢慢退去。']
      .map((text,i)=>({text,time:i*3.3,isChorus:i>=2}));
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let raf=0,stamp=0,time=7.4,visible=false,paused=reduced.matches,shown;
    function paint(){
      const index=Math.floor(time/3.3),line=lines[index];
      if(shown!==line){
        type.replaceChildren(...Array.from(line.text,char=>{
          const word=document.createElement('span');word.textContent=char;return word;
        }));
        shown=line;
      }
      const sung=(time-line.time)/2.75*type.childElementCount;
      for(const [i,word] of Array.from(type.children).entries()){
        const fill=clamp(sung-i);
        word.dataset.sing=fill===1?'sung':fill===0?'waiting':'voicing';
        word.style.setProperty('--lr-sung',(fill*100).toFixed(1)+'%');
      }
      renderer.paint(lines,index,{line,end:line.time+3.3},null,time,reduced.matches?0:.6);
    }
    function tick(now){
      if(!visible||paused)return;
      time+=stamp?(now-stamp)/1000:0;
      if(time>=13.2)time=4.3;
      stamp=now;paint();raf=requestAnimationFrame(tick);
    }
    function resume(){
      cancelAnimationFrame(raf);stamp=0;
      button.textContent=paused?'播放预览':'暂停预览';
      button.setAttribute('aria-pressed',String(paused));
      if(visible){paint();if(!paused)raf=requestAnimationFrame(tick);}
    }
    button.addEventListener('click',()=>{paused=!paused;resume();});
    replay.addEventListener('click',()=>{time=6.04;paused=false;resume();});
    reduced.addEventListener('change',()=>{paused=reduced.matches;resume();});
    return on=>{if(on!==visible){visible=on;resume();}};
  }
  window.SonicDialogue=Object.freeze({mount,audition});
})();
