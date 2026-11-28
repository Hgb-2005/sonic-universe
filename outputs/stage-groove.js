/* One playback clock drives the outgoing line, record grooves and tonearm.
   The small audition in the settings panel uses the same renderer. */
(() => {
  'use strict';
  const tau=Math.PI*2;
  const unit=x=>Math.max(0,Math.min(1,x));
  const ease=x=>1-(1-unit(x))**3;
  const fraction=(time,start,end)=>unit((time-start)/Math.max(.01,end-start));

  function circle(ctx,x,y,r,paint) {
    ctx.beginPath();ctx.arc(x,y,r,0,tau);ctx.fillStyle=paint;ctx.fill();
  }
  function stroke(ctx,points,color,width) {
    ctx.beginPath();ctx.moveTo(...points[0]);
    for(const point of points.slice(1))ctx.lineTo(...point);
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
  }
  function bearing(ctx,x,y,radius) {
    const metal=ctx.createLinearGradient(x-radius,y-radius,x+radius,y+radius);
    metal.addColorStop(0,'#eee0c3');metal.addColorStop(.31,'#a99f8c');
    metal.addColorStop(.5,'#474846');metal.addColorStop(.77,'#8d8b7e');metal.addColorStop(1,'#292c2b');
    circle(ctx,x,y,radius,metal);circle(ctx,x,y,radius*.63,'#343634');circle(ctx,x,y,radius*.37,metal);
  }
  function platter(size) {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d');ctx.scale(size/240,size/240);
    // The specular bands belong to the lighting; the paper label rotates separately.
    ctx.translate(113,124);ctx.save();
    const g=ctx.createConicGradient(-.38,0,0);
    for(const [a,c] of [[0,'#14191d'],[.13,'#0f1317'],[.22,'#56514a'],[.27,'#22292c'],[.37,'#0f1418'],[.59,'#181b20'],[.68,'#4b5457'],[.72,'#282f33'],[.88,'#101519'],[1,'#14191d']])g.addColorStop(a,c);
    circle(ctx,0,0,98,g);ctx.strokeStyle='#ded8bd65';ctx.lineWidth=.65;ctx.stroke();
    for(let i=0;i<70;i++){
      const r=32+i*.91;ctx.beginPath();ctx.arc(0,0,r,0,tau);
      ctx.strokeStyle=i%13===0?'#c6b9a95f':i%4===0?'#d9d1ba27':'#00000053';
      ctx.lineWidth=i%13===0?.48:.32;ctx.stroke();
    }
    const paper=ctx.createLinearGradient(-32,-30,27,30);
    paper.addColorStop(0,'#e1c698');paper.addColorStop(.6,'#b9996c');paper.addColorStop(1,'#91724e');
    circle(ctx,0,0,30,paper);
    for(let i=0;i<160;i++){
      const a=i*2.39996,r=29*Math.sqrt(i/160);circle(ctx,Math.cos(a)*r,Math.sin(a)*r,.23,'#64483147');
    }
    ctx.restore();return canvas;
  }
  function groupPhrases(line,timed) {
    const text=line.textContent;
    if(!/\p{Script=Han}/u.test(text) || !/[，。！？；：、]/u.test(text))return;
    const nodes=timed?Array.from(line.childNodes):
      (text.match(/[^，。！？；：、]+[，。！？；：、]*|[，。！？；：、]+/gu)||[]).map(s=>document.createTextNode(s));
    const groups=[];let group=[];
    for(const node of nodes){
      group.push(node);
      if(/[，。！？；：、][”’」』）]*\s*$/u.test(node.textContent)){groups.push(group);group=[];}
    }
    if(group.length)groups.push(group);
    if(groups.length<2)return;
    line.replaceChildren(...groups.map(parts=>{
      const span=document.createElement('span');span.className='gr-phrase';span.append(...parts);return span;
    }));
  }
  function mount(host,box,line) {
    const record=document.createElement('canvas'),last=document.createElement('span');
    record.className='gr-disc';record.setAttribute('aria-hidden','true');
    last.className='gr-last';last.setAttribute('aria-hidden','true');box.prepend(last);
    box.classList.add('gr-voice');line.classList.add('gr-line');host.prepend(record);
    const ghost=document.createElement('span');ghost.className='gr-turn';ghost.hidden=true;ghost.setAttribute('aria-hidden','true');host.append(ghost);
    const cue=document.createElement('span');
    cue.className='gr-cue';cue.setAttribute('aria-hidden','true');cue.hidden=true;box.append(cue);
    const ctx=record.getContext('2d');let texture,side=0,cssSize=0,lastFrame='';
    let layout=null,transfer=null,cuePose=null,arrivalPose=null,oldTime=-10;
    const observer=new ResizeObserver(entries=>{cssSize=entries[0].contentRect.width;lastFrame='';});
    observer.observe(record);
    function drawRecord(position,songProgress,lineProgress,artist,title,motion) {
      if(!ctx)return;
      const size=Math.min(1200,Math.ceil((cssSize || record.clientWidth)*Math.min(devicePixelRatio||1,2)));
      if(!size)return;
      if(size!==side){side=size;record.width=record.height=size;texture=platter(size);lastFrame='';}
      const angle=motion?position*.41:0;
      const key=[Math.round(angle*90),Math.round(songProgress*500),Math.round(lineProgress*180),artist,title].join('|');
      if(key===lastFrame)return;lastFrame=key;
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,size,size);ctx.drawImage(texture,0,0);
      ctx.setTransform(size/240,0,0,size/240,0,0);ctx.translate(113,124);
      ctx.save();ctx.rotate(angle);
      // Split the printed label with a low horizon, like the coast in a record sleeve.
      ctx.save();ctx.beginPath();ctx.arc(0,0,29.6,0,tau);ctx.clip();
      ctx.fillStyle='#585c51';ctx.beginPath();ctx.moveTo(-32,0);
      ctx.bezierCurveTo(-20,-6,-14,7,-1,4);ctx.bezierCurveTo(8,2,17,-5,32,-3);
      ctx.lineTo(32,7);ctx.bezierCurveTo(13,0,4,14,-7,9);ctx.bezierCurveTo(-17,7,-23,3,-32,7);
      ctx.closePath();ctx.fill();ctx.restore();
      ctx.fillStyle='#332a21';ctx.textAlign='center';
      ctx.font='600 5.8px "Microsoft YaHei", sans-serif';ctx.fillText(title||'',0,-9,45);
      ctx.font='4px "Microsoft YaHei", sans-serif';ctx.fillText(artist||'',0,16,42);
      stroke(ctx,[[-9,20],[9,20]],'#4e3e2a80',.44);ctx.restore();
      circle(ctx,0,0,2.35,'#483d31');circle(ctx,-.35,-.35,1.25,'#dddbca');
      // A short trace marks this phrase; the stylus tracks progress through the song.
      ctx.beginPath();ctx.arc(0,0,100.5,.58,.58+.93*lineProgress);ctx.strokeStyle='#edc690c9';ctx.lineWidth=1;ctx.stroke();
      // All parts rotate around the same bearing, so the arm stays rigid as it tracks inward.
      ctx.save();ctx.translate(103,-89);ctx.rotate(songProgress*.27);
      const arm=[[0,0],[-4,27],[-43,132],[-45,142]];
      stroke(ctx,arm.map(([a,b])=>[a+1.6,b+2]),'#090d148f',3.6);
      stroke(ctx,arm,'#333639',3.4);stroke(ctx,arm,'#b5ad99',1.9);
      stroke(ctx,[[-4.5,27],[-43.5,132]],'#f5ead5',.53);
      ctx.translate(-45,142);ctx.rotate(.31);
      ctx.fillStyle='#393b36';ctx.fillRect(-2.7,-5.3,5.4,11);
      ctx.fillStyle='#ae9471';ctx.fillRect(-2.2,-3,4.4,6.6);
      stroke(ctx,[[0,4.1],[0,7]],'#e2d4b5',.76);
      circle(ctx,0,7,.83,'#fff0c8');ctx.restore();
      bearing(ctx,103,-89,6.2);
    }
    function paint({entry,previous,next,position,duration,artist,title,motion,phase='sing',duet=false}) {
      if(!entry){hide();return;}
      host.dataset.groove='';host.toggleAttribute('data-groove-duet',duet);
      const {line:source,end}=entry;
      const contiguous=previous?.text?.trim() && (!Number.isFinite(previous.end) || source.time-previous.end<=2.5);
      const prev=contiguous && phase==='sing' && !duet ? previous.text.trim() : '';
      if(last.textContent!==prev)last.textContent=prev;
      const age=Math.max(0,position-source.time);
      const durationIn=Math.min(.52,Math.max(.12,(end-source.time)*.24))*(.72+.28*motion);
      const t=motion?ease(age/durationIn):1;
      // Carry the actual previous typesetting up into the margin. The audio clock
      // owns the interpolation so pausing also freezes the departing sentence.
      if(!layout || layout.source!==source || layout.size!==cssSize){
        const from=layout,origin=host.getBoundingClientRect(),group=box.getBoundingClientRect(),type=getComputedStyle(line);
        layout={source,size:cssSize,x:group.left-origin.left+line.offsetLeft,y:group.top-origin.top+line.offsetTop,
          width:line.offsetWidth,font:type.font,fontSize:parseFloat(type.fontSize),spacing:type.letterSpacing,
          phrases:Array.from(line.children).filter(n=>n.classList.contains('gr-phrase')).map(n=>n.textContent)};
        transfer=null;arrivalPose=null;
        if(prev && motion && from?.source===previous && Math.abs(position-oldTime)<.45 && age<durationIn){
          if(cuePose?.source===source && from.size===cssSize){
            arrivalPose={dy:cuePose.y-layout.y,scale:Math.min(1,cuePose.fontSize/layout.fontSize)};
          }
          const targetFont=parseFloat(getComputedStyle(last).fontSize);
          const x=group.left-origin.left+last.offsetLeft,y=group.top-origin.top+last.offsetTop;
          transfer={x:x-from.x,y:y-from.y,scale:targetFont/from.fontSize};
          ghost.textContent=prev;
          if(from.phrases.length)ghost.replaceChildren(...from.phrases.map(text=>{
            const span=document.createElement('span');span.className='gr-phrase';span.textContent=text;return span;
          }));
          Object.assign(ghost.style,{left:from.x+'px',top:from.y+'px',width:from.width+'px',
            font:from.font,letterSpacing:from.spacing});
        }
        cuePose=null;
      }
      if(Math.abs(position-oldTime)>.5){transfer=null;arrivalPose=null;cuePose=null;}
      oldTime=position;
      const flying=Boolean(transfer && t<1 && phase==='sing' && !duet && motion);
      ghost.hidden=!flying;
      if(flying){
        const scale=1+(transfer.scale-1)*t;
        ghost.style.transform='translate('+transfer.x*t+'px,'+transfer.y*t+'px) scale('+scale+')';
        ghost.style.opacity=String(.9*(1-t)**1.45);
      }
      const p=fraction(position,source.time,Math.min(end,source.end??end));
      // The incoming line starts at the actual type size and baseline of its cue.
      // Keep each word tied to the media clock throughout the exchange.
      const arrival=flying?t:1;
      const rise=arrivalPose?arrivalPose.dy/layout.fontSize:0.34;
      const scale=arrivalPose?arrivalPose.scale:1;
      box.style.setProperty('--gr-rise',((1-arrival)*rise*(arrivalPose?1:motion)).toFixed(3)+'em');
      box.style.setProperty('--gr-scale',(1-(1-scale)*(1-arrival)).toFixed(3));
      box.style.setProperty('--gr-recall',((1-t)*1.3*motion).toFixed(3)+'em');
      box.style.setProperty('--gr-last-scale',(1+(1-t)*1.1*motion).toFixed(3));
      box.style.setProperty('--gr-arrive',(flying?.48+.52*arrival:1).toFixed(3));
      box.style.setProperty('--gr-level',(p*100).toFixed(2)+'%');
      const remaining=next?.time-position;
      const lead=Math.min(1.15,(end-source.time)*.32);
      const showCue=phase==='sing' && !duet && next?.text?.trim() && remaining>0 && remaining<=lead &&
        !(Number.isFinite(source.end)&&next.time-source.end>2.5) && next.singer!=='left' && next.singer!=='right';
      const ink=showCue?ease((lead-remaining)/Math.min(.32,lead)):0;
      last.style.opacity=String(.58*(flying?t**3:1)*(1-.75*ink));
      cue.hidden=!showCue;
      if(showCue){
        if(cue.textContent!==next.text)cue.textContent=next.text;
        cue.style.opacity=String(.72*ink);
        if(cuePose?.source!==next){
          cuePose={source:next,y:cue.getBoundingClientRect().top-host.getBoundingClientRect().top,
            fontSize:parseFloat(getComputedStyle(cue).fontSize)};
        }
      }else cuePose=null;
      host.toggleAttribute('data-groove-quiet',phase==='quiet');
      drawRecord(position,duration>0?unit(position/duration):0,p,artist,title,motion);
    }
    function hide(){
      if(host.hasAttribute('data-groove')){delete host.dataset.groove;delete host.dataset.grooveDuet;delete host.dataset.grooveQuiet;}
      ghost.hidden=true;cue.hidden=true;layout=transfer=cuePose=arrivalPose=null;
    }
    return {paint,hide};
  }

  function audition(host,button,replay) {
    const box=host.querySelector('.gr-voice'),line=box.querySelector('.gr-line');
    const renderer=mount(host,box,line);
    const samples=[
      ['风从海面来',['风从','海面','来']],
      ['把晚霞唱成一封信',['把晚霞','唱成','一封信']],
      ['寄给等候的你',['寄给','等候的','你']],
    ].map(([text,words],i)=>({text,words,time:i*3.6,end:(i+1)*3.6}));
    let running=false,paused=false,raf=0,time=1.4,stamp=0,lastSample=-1;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    function render(){
      const i=Math.floor(time/3.6)%samples.length,source=samples[i],elapsed=time-source.time;
      if(lastSample!==i){
        line.replaceChildren(...source.words.map(text=>{const span=document.createElement('span');span.textContent=text;return span;}));
        lastSample=i;
      }
      Array.from(line.children).forEach((node,n)=>{
        const progress=fraction(elapsed,n*1.08,(n+1)*1.08);
        node.dataset.sing=progress===1?'sung':progress===0?'waiting':'voicing';
        node.style.setProperty('--lr-sung',(progress*100)+'%');
      });
      renderer.paint({entry:{line:source,end:source.end},previous:samples[i-1],next:samples[i+1],position:time,
        duration:10.8,artist:'声波宇宙',title:'海面来信',motion:reduced.matches?0:1});
    }
    function tick(now){
      if(!running||paused)return;
      if(!stamp||now-stamp>=32){time=(time+(stamp?(now-stamp)/1000:0))%10.8;stamp=now;render();}
      raf=requestAnimationFrame(tick);
    }
    function resume(){
      cancelAnimationFrame(raf);stamp=0;
      if(running){render();if(!paused)raf=requestAnimationFrame(tick);}
    }
    function label(){button.textContent=paused?'播放预览':'暂停预览';button.setAttribute('aria-pressed',String(paused));}
    paused=reduced.matches;label();
    button.addEventListener('click',()=>{paused=!paused;label();resume();});
    replay.addEventListener('click',()=>{
      renderer.hide();time=samples[1].time-.9;paused=false;label();resume();
    });
    reduced.addEventListener('change',()=>{paused=reduced.matches;label();resume();});
    return show=>{running=show;resume();};
  }
  window.SonicGroove=Object.freeze({mount,audition,groupPhrases});
})();
