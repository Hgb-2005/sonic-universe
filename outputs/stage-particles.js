/* A stage voice uses the same line breaks and timed word spans as the text renderer. */
(() => {
  'use strict';
  const clamp = n => Math.max(0, Math.min(1, n));
  const margin = 104;
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity:'grapheme'}) : null;
  const palettes = {
    dark: ['#becad8', '#fff0b6', '#ffe0a1', '#edf5f7'],
    light: ['#405062', '#713306', '#854510', '#1c3539']
  };

  // A range can wrap in the middle of a timed word. Keep each visual row together
  // so shaping, CJK line breaks and the word's original time survive rasterization.
  function paintRun(ctx, node, group, origin, font) {
    if (!node?.length) return;
    const text = node.data;
    const range = document.createRange();
    const step = segmenter ? Array.from(segmenter.segment(text), s => s.index) : [];
    if (!segmenter) {
      let offset = 0;
      for (const char of text) { step.push(offset); offset += char.length; }
    }
    step.push(text.length);
    let rowStart = 0, rowTop;
    // A full nibble per channel leaves room for rounding at antialiased edges.
    ctx.fillStyle = 'rgb(' + ((group%16)*16+8) + ',' + ((Math.floor(group/16)%16)*16+8) + ',0)';
    function flush(end) {
      range.setStart(node, rowStart);
      range.setEnd(node, end);
      const rect = range.getBoundingClientRect();
      const baseline = rect.top - origin.top + (rect.height + font.fontBoundingBoxAscent - font.fontBoundingBoxDescent) / 2;
      ctx.fillText(text.slice(rowStart,end), rect.left-origin.left, baseline);
    }
    for (let i=0; i<step.length-1; i++) {
      range.setStart(node,step[i]); range.setEnd(node,step[i+1]);
      const top = range.getBoundingClientRect().top;
      if (i && Math.abs(top-rowTop)>1) { flush(step[i]); rowStart=step[i]; }
      rowTop=top;
    }
    flush(text.length);
  }

  function build(voice, canvas, mask) {
    const rect = voice.line.getBoundingClientRect();
    if (rect.width<1 || rect.height<1) return null;
    const style = getComputedStyle(voice.line);
    const w = Math.ceil(rect.width), h = Math.ceil(rect.height);
    mask.canvas.width=w; mask.canvas.height=h;
    mask.font = style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
    mask.letterSpacing=style.letterSpacing==='normal'?'0px':style.letterSpacing;
    const metrics = mask.measureText('国Mg');
    const groups = [{start:voice.source.time,end:voice.end,points:[]}];
    const nodes = new Map();
    for (const word of voice.words) {
      nodes.set(word.node,groups.length);
      groups.push({start:word.start,end:word.end,points:[]});
    }
    for (const child of voice.line.childNodes) {
      const node = child.nodeType===Node.TEXT_NODE ? child : child.firstChild;
      paintRun(mask,node,nodes.get(child)||0,rect,metrics);
    }
    const pixels=mask.getImageData(0,0,w,h).data;
    const pitch=Math.max(1.6,Math.min(3.3,parseFloat(style.fontSize)/17),Math.sqrt(w*h/24500));
    let seed=Math.round(voice.source.time*1000)+13;
    for (const char of voice.source.text) seed=(Math.imul(seed,31)+char.codePointAt(0))>>>0;
    function random() { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }
    let count=0;
    for (let y=pitch/2; y<h; y+=pitch) {
      for (let x=pitch/2; x<w; x+=pitch) {
        const px=x+(random()-.5)*pitch*.32, py=y+(random()-.5)*pitch*.32;
        if (px<0 || py<0 || px>=w || py>=h) continue;
        const i=4*(Math.floor(py)*w+Math.floor(px));
        if (pixels[i+3]<95) continue;
        const group=groups[(pixels[i]>>4)+16*(pixels[i+1]>>4)] || groups[0];
        const angle=random()*Math.PI*2, distance=22+random()*60;
        group.points.push({x:px+margin,y:py+margin,dx:Math.cos(angle)*distance,dy:Math.sin(angle)*distance,
          bend:(random()-.5)*32,delay:random()*.24,r:pitch*(.33+random()*.2),spark:random()<.16});
        count++;
      }
    }
    if (!count) return null;
    const box=voice.box.getBoundingClientRect(), dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.style.left=(rect.left-box.left-margin)+'px';
    canvas.style.top=(rect.top-box.top-margin)+'px';
    canvas.style.width=(w+2*margin)+'px'; canvas.style.height=(h+2*margin)+'px';
    canvas.width=Math.ceil((w+2*margin)*dpr); canvas.height=Math.ceil((h+2*margin)*dpr);
    return {groups,dpr,first:groups.find(g=>g.points.length)};
  }

  function mount(box) {
    const line=box.querySelector('[data-scene-line]');
    const canvas=document.createElement('canvas');
    canvas.className='lr-grain-type'; canvas.setAttribute('aria-hidden','true');
    const ctx=canvas.getContext('2d');
    const mask=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
    if (!ctx || !mask) return null;
    box.append(canvas);
    let layout,source,end,dirty=true,last='',lastDpr=0;
    new ResizeObserver(()=>{dirty=true;}).observe(line);
    document.fonts?.addEventListener('loadingdone',()=>{dirty=true;});
    function hide() {
      if (!box.hasAttribute('data-particles-ready')) return;
      box.removeAttribute('data-particles-ready'); dirty=true;
    }
    function draw(voice,time,motion,phase) {
      if (dirty || source!==voice.source || end!==voice.end || lastDpr!==devicePixelRatio) {
        layout=build(voice,canvas,mask); source=voice.source; end=voice.end;
        lastDpr=devicePixelRatio; dirty=false; last='';
        box.toggleAttribute('data-particles-ready',Boolean(layout));
      }
      if (!layout) return;
      const tone=box.dataset.ink==='light'?'light':'dark', colors=palettes[tone];
      const frame=[Math.floor(time*60),motion,tone,phase].join('/');
      if (frame===last) return;
      last=frame;
      ctx.setTransform(layout.dpr,0,0,layout.dpr,0,0);
      ctx.clearRect(0,0,canvas.width/layout.dpr,canvas.height/layout.dpr);
      const age=phase==='cue'?0:Math.max(0,time-source.time);
      const intro=Math.min(.62,Math.max(.1,(end-source.time)*.32));
      const amplitude=motion>0 ? .48+motion*.52 : 0;
      const upcoming=phase==='upcoming',outgoing=phase==='outgoing';
      const scatter=outgoing ? amplitude*(.14+1.2*clamp((time-end)/.42)**.72) : 0;
      const soloTimed=voice.words.length>0 && source.singer!=='left' && source.singer!=='right';
      const byOnset=upcoming || (soloTimed && phase==='sing');
      for (const group of layout.groups) {
        if (!group.points.length) continue;
        if(upcoming && group!==layout.first)continue;
        const onset=group===layout.first?source.time:group.start;
        const anticipation=group===layout.first ? .78 : .42;
        const forming=clamp((time-onset+anticipation)/anticipation);
        if(amplitude && soloTimed && !outgoing && phase==='sing' && forming===0)continue;
        const active=phase!=='cue' && time>=group.start && time<group.end;
        const passed=phase!=='cue' && time>=group.end;
        const after=passed?clamp(1-(time-group.end)/.38):0;
        const color=active?colors[1]:after>.35?colors[2]:passed?colors[3]:colors[0];
        const approach=active ? amplitude*(1-clamp((time-group.start)/.24))**2 : 0;
        const assembling=byOnset ? forming<1 : age<intro*1.25;
        const moving=amplitude>0 && (assembling || approach>.002 || scatter>0);
        const key=active?'brightPath':'basePath';
        let path=moving?null:group[key];
        const trails=moving?new Path2D():null;
        if (!path) {
          path=new Path2D();
          for (const p of group.points) {
            const gathering=byOnset ? amplitude*(1-clamp(forming*(1+p.delay)-p.delay))**2 :
              amplitude*(1-clamp(age/intro-p.delay))**3;
            const travel=outgoing?scatter:gathering+(p.spark?approach*.32:0);
            const x=p.x+p.dx*travel+p.bend*travel*(1-travel);
            const y=p.y+p.dy*travel-approach*1.6;
            const r=p.r*(active?1.09:1);
            if(trails && p.spark && travel>.06){
              const tail=Math.min(.18,travel*.30)*(outgoing?-1:1);
              trails.moveTo(x+p.dx*tail,y+p.dy*tail);trails.lineTo(x,y);
            }
            path.moveTo(x+r,y); path.arc(x,y,r,0,Math.PI*2);
          }
          if (!moving) group[key]=path;
        }
        // The bloom uses a second pass. The crisp dot cores stay legible over it.
        if(trails){
          ctx.strokeStyle=color;ctx.globalAlpha=.32;ctx.lineWidth=1;ctx.stroke(trails);
        }
        if (active || after>.05) {
          ctx.strokeStyle=color; ctx.globalAlpha=active?.16:after*.12; ctx.lineWidth=2.5;
          ctx.stroke(path);
        }
        ctx.fillStyle=color; ctx.globalAlpha=active||passed?1:byOnset?.52+.43*forming:.91; ctx.fill(path);
      }
      ctx.globalAlpha=1;
    }
    return {draw,hide};
  }
  window.SonicStageParticles={mount};
})();
