/* Three phrases share one coordinate system. Only the listening position moves. */
(() => {
  'use strict';
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => { const t=clamp(value); return t*t*t*(t*(6*t-15)+10); };
  const mix = (a,b,t) => a+(b-a)*t;
  // Two passes in opposite directions, with a change of distance within each pass.
  const verse = [
    {dx:.31,dy:-.13,x:.46,y:.62,zoom:1.10,backdrop:1.14},
    {dx:.29,dy:.15,x:.54,y:.54,zoom:.89,backdrop:1.075},
    {dx:-.31,dy:.15,x:.54,y:.60,zoom:1.12,backdrop:1.13},
    {dx:-.28,dy:-.17,x:.45,y:.53,zoom:.94,backdrop:1.085},
  ];
  const wide = {dx:.36,dy:-.025,x:.50,y:.47,zoom:1.04,backdrop:1.032};
  const plans = new WeakMap();
  function connected(a,b) {
    return a?.text?.trim() && b?.text?.trim() && !a.silent && !b.silent && b.time>a.time &&
      ![a.singer,b.singer].some(side=>side==='left'||side==='right') &&
      !(Number.isFinite(a.end) && b.time-a.end>2.5);
  }
  function plan(lines) {
    if(plans.has(lines))return plans.get(lines);
    // Keep the wide shot for a repeated passage. One repeated line can be an echo.
    const repeated=lines.map((line,i)=>{
      const prev=lines[i-1],next=lines[i+1];
      return (prev?.isChorus && connected(prev,line) && next?.isChorus && connected(line,next) && next.time-line.time<=3.5) ||
        (line.isChorus && ((prev?.isChorus && connected(prev,line)) || (next?.isChorus && connected(line,next))));
    });
    let routeX=0,routeY=0,verseIndex=0,lastDx=0,lastDy=0;
    const shots=lines.map((line,i)=>{
      const chorus=Boolean(repeated[i]);
      const pose=chorus?wide:verse[verseIndex++%verse.length];
      const start=chorus&&!repeated[i-1],exit=!chorus&&repeated[i-1];
      const followingVerse=verse[verseIndex%verse.length];
      const dx=exit ? wide.dx : pose.dx;
      let dy=pose.dy;
      // A reversal puts both neighbors on the same side. Give each a vertical lane.
      if(start)dy=lastDx<0&&lastDy>0 ? .17 : -.17;
      if(exit)dy=followingVerse.dx<0&&followingVerse.dy<0 ? -.17 : .17;
      routeX+=dx;routeY+=dy;lastDx=dx;lastDy=dy;
      return {...pose,dx,dy,routeX,routeY,chorus:Number(chorus),roll:Math.max(-7,Math.min(7,dy*45))};
    });
    for(const [i,shot] of shots.entries()){
      const next=shots[i+1]||shot;
      shot.tangentX=(i?shot.dx+next.dx:2*next.dx)*.34;
      shot.tangentY=(i?shot.dy+next.dy:2*next.dy)*.34;
    }
    plans.set(lines,shots);
    return shots;
  }
  function cameraAt(lines,shots,index,time,duration) {
    // Both sides of a downbeat sample the same curve, including after a seek.
    for(const to of [index,index+1]) {
      const a=lines[to-1],b=lines[to];
      if(!connected(a,b))continue;
      const sectionChange=shots[to].chorus!==shots[to-1].chorus;
      const before=Math.min(sectionChange ? .9 : .69,(b.time-a.time)*.34);
      const end=lines[to+1]?.time ?? (duration>b.time?duration:b.time+4);
      const after=Math.min(sectionChange ? .67 : .48,Math.max(.025,(end-b.time)*.29));
      if(time>=b.time-before && time<=b.time+after)
        return to-1+smooth((time-b.time+before)/(before+after));
    }
    return index;
  }
  function worldAt(shots,position) {
    const index=Math.max(0,Math.min(shots.length-1,Math.floor(position)));
    const from=shots[index],to=shots[index+1],fraction=position-index;
    if(!to||fraction<0){
      return {x:from.routeX+from.tangentX*fraction,y:from.routeY+from.tangentY*fraction};
    }
    const t=fraction,t2=t*t,t3=t2*t;
    const left=2*t3-3*t2+1,right=1-left;
    const departure=t3-2*t2+t,arrival=t3-t2;
    return {
      x:left*from.routeX+right*to.routeX+departure*from.tangentX+arrival*to.tangentX,
      y:left*from.routeY+right*to.routeY+departure*from.tangentY+arrival*to.tangentY
    };
  }
  function neighbor(host) {
    const box=document.createElement('span'),type=document.createElement('span'),sub=document.createElement('span');
    box.className='tr-caption tr-neighbor';type.className='tr-type';sub.className='tr-sub';
    box.setAttribute('aria-hidden','true');box.hidden=true;box.append(type,sub);host.append(box);
    return {box,type,sub};
  }
  function mount(host,lead) {
    const preview=host.classList.contains('tr-preview');
    const canvas=document.createElement('canvas');
    canvas.className='tr-route';canvas.setAttribute('aria-hidden','true');host.prepend(canvas);
    const ctx=canvas.getContext('2d'),back=neighbor(host),ahead=neighbor(host);
    let width=0,height=0,dpr=1,lastFrame='',lastPlan;
    new ResizeObserver(([entry])=>{
      width=entry.contentRect.width;height=entry.contentRect.height;lastFrame='';
    }).observe(host);

    function place(box,point,distance,source,zoom,roll) {
      const focus=1-smooth(Math.min(1,Math.abs(distance)));
      box.style.setProperty('--tr-x',(point.x*100).toFixed(3)+'%');
      box.style.setProperty('--tr-y',(point.y*100).toFixed(3)+'%');
      box.style.setProperty('--tr-scale',mix(.34,zoom,focus).toFixed(4));
      box.style.setProperty('--tr-roll',(roll*(1-focus)).toFixed(2)+'deg');
      box.style.setProperty('--tr-alpha',(.27+.73*focus).toFixed(3));
      box.toggleAttribute('data-tr-long',source.text.length>26);
      box.toggleAttribute('data-tr-dense',source.text.length>60);
    }
    function side(item,source,point,distance,translations,zoom,roll) {
      item.box.hidden=!source;
      if(!source)return;
      if(item.type.textContent!==source.text){
        item.type.textContent=source.text;
        window.SonicGroove.groupPhrases(item.type,false);
      }
      const sub=translations?source.translation||'':'';
      if(item.sub.textContent!==sub)item.sub.textContent=sub;
      item.sub.hidden=!sub;
      place(item.box,point,distance,source,zoom,roll);
    }
    function rail(project,camera,first,last,index,progress,phase,motion,chorus) {
      if(!ctx || width<1 || height<1)return;
      dpr=Math.min(window.devicePixelRatio||1,1.75,2200/width);
      const w=Math.round(width*dpr),h=Math.round(height*dpr);
      if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
      const color=ctx.createLinearGradient(0,0,width,0);
      color.addColorStop(0,'rgba(152,209,203,0)');
      const tinted=(a,b,alpha)=>'rgba('+a.map((v,i)=>Math.round(mix(v,b[i],chorus))).join(',')+','+alpha+')';
      color.addColorStop(.22,tinted([162,222,216],[237,200,139],.64));
      color.addColorStop(.50,tinted([224,248,235],[255,229,178],.91));
      color.addColorStop(.82,tinted([159,207,219],[224,193,151],.64));
      color.addColorStop(1,'rgba(147,191,207,0)');
      const unit=width<500 ? .69 : 1;
      const cursor=first===last?index:Math.max(first,Math.min(last,index+(progress-.35)*.38));
      ctx.strokeStyle=color;
      // A pulse opens a bundle of fine traces, then the traces meet again at each lyric.
      for(let strand=-2;strand<=2;strand++){
        ctx.beginPath();ctx.lineWidth=(strand===0?1.65:.84)*unit;
        ctx.globalAlpha=strand===0?.96:.50;
        for(let j=0;j<=88;j++){
          const world=mix(first-.6,last+.6,j/88);
          const p=project(world);
          const spread=Math.pow(Math.sin(Math.PI*world),2);
          const envelope=Math.exp(-15*(world-cursor)**2);
          const offset=spread*(height*mix(.012,.008,chorus)+height*.011*envelope)*
            Math.sin(world*5.4+strand*.52+phase*motion);
          const x=p.x*width,y=p.y*height+strand*offset;
          if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha=1;
      for(let stop=first;stop<=last;stop++){
        const p=project(stop),x=p.x*width,y=p.y*height;
        if(x<0||x>width)continue;
        const focus=1-clamp(Math.abs(stop-camera));
        ctx.strokeStyle=tinted([206,242,232],[255,226,164],.21+.5*focus);
        ctx.lineWidth=unit;ctx.beginPath();ctx.arc(x,y,(3+focus*4)*unit,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle=tinted([227,249,236],[255,230,179],1);ctx.beginPath();ctx.arc(x,y,(1.3+focus)*unit,0,Math.PI*2);ctx.fill();
      }
      if(motion){
        const p=project(cursor);
        ctx.fillStyle='rgba(211,249,234,.87)';ctx.beginPath();ctx.arc(p.x*width,p.y*height,1.9*unit,0,Math.PI*2);ctx.fill();
      }
    }
    function paint(lines,index,position,duration,motion,translations,phase='sing') {
      const source=lines[index];
      if(!source?.text?.trim()){hide();return;}
      host.dataset.trail='';
      if(!preview)host.parentElement.toggleAttribute('data-trail-camera',motion>0);
      const shots=plan(lines);
      const eye=motion&&phase==='sing'?cameraAt(lines,shots,index,position,duration):index;
      const from=shots[Math.floor(eye)],to=shots[Math.ceil(eye)],blend=eye%1;
      const chorus=mix(from.chorus,to.chorus,blend);
      const zoom=mix(from.zoom,to.zoom,blend);
      const world=worldAt(shots,eye);
      const compact=width>0&&width<620&&!preview;
      const amount=motion ? .63+.37*motion : 0;
      const centerX=mix(.5,mix(from.x,to.x,blend),amount);
      const centerY=mix(.58,mix(from.y,to.y,blend),amount);
      const project=n=>{
        const point=worldAt(shots,n);
        return {x:centerX+(point.x-world.x)*(compact ? .83 : 1),
          y:centerY+(point.y-world.y)*(preview ? .74 : 1)};
      };
      const end=source.end??lines[index+1]?.time??duration;
      const progress=clamp((position-source.time)/Math.max(.05,end-source.time));
      const context=motion && phase==='sing';
      const hasBack=context&&connected(lines[index-1],source);
      const hasAhead=context&&connected(source,lines[index+1]);
      const textZoom=mix(1,zoom,amount);
      place(lead,project(index),index-eye,source,textZoom,shots[index].roll);
      side(back,hasBack&&lines[index-1],project(index-1),index-1-eye,translations,textZoom,shots[index-1]?.roll);
      side(ahead,hasAhead&&lines[index+1],project(index+1),index+1-eye,translations,textZoom,shots[index+1]?.roll);
      host.style.setProperty('--tr-chorus',chorus.toFixed(3));
      if(!preview && motion){
        const style=host.parentElement.style;
        style.setProperty('--tr-parallax-x',((centerX-.5)*23*(1-chorus*.82)).toFixed(3)+'%');
        style.setProperty('--tr-parallax-y',((.58-centerY)*13*(1-chorus*.82)).toFixed(3)+'%');
        style.setProperty('--tr-backdrop',mix(1.02,mix(from.backdrop,to.backdrop,blend),amount).toFixed(4));
      }
      const stamp=[eye.toFixed(4),motion?Math.round(position*30):0,index,width,height,motion].join('/');
      if(shots!==lastPlan || stamp!==lastFrame){
        rail(project,eye,hasBack?index-1:index,hasAhead?index+1:index,index,progress,position*.52,motion,chorus);
        lastPlan=shots;lastFrame=stamp;
      }
    }
    function hide() {
      if(!host.hasAttribute('data-trail'))return;
      delete host.dataset.trail;back.box.hidden=ahead.box.hidden=true;
      if(!preview)host.parentElement.removeAttribute('data-trail-camera');
      lastFrame='';
    }
    return {paint,hide};
  }
  function audition(host) {
    const lead=host.querySelector('.tr-caption'),type=lead.querySelector('.tr-type');
    const stage=mount(host,lead);
    const lines=['远处有回声','我循着声音','向海面靠近','等浪花回答','让回声掠过海面','让海天连成一线']
      .map((text,i)=>({text,time:i*2.35,isChorus:i>=4}));
    let frame=0,start=0,shown=false;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    function tick(now){
      if(!shown)return;
      const time=reduced.matches?4.6:3+(now-start)/1000%10.6;
      const index=Math.floor(time/2.35);
      if(type.textContent!==lines[index].text)type.textContent=lines[index].text;
      stage.paint(lines,index,time,14.1,reduced.matches?0:.6,false);
      if(!reduced.matches)frame=requestAnimationFrame(tick);
    }
    function show(visible){
      shown=visible;cancelAnimationFrame(frame);
      if(shown){start=performance.now();tick(start);}
    }
    reduced.addEventListener('change',()=>show(shown));
    return show;
  }
  window.SonicTrail=Object.freeze({mount,audition});
})();
