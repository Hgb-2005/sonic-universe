(() => {
  'use strict';
  const ns='http://www.w3.org/2000/svg';
  function element(name,attrs) {
    const node=document.createElementNS(ns,name);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    return node;
  }

  // Red and green encode the inward normal of a rounded rim. The flat interior
  // stays at half intensity (zero displacement), independent of the aspect ratio.
  function lensMap(w,h,radius) {
    const canvas=document.createElement('canvas'), scale=Math.min(1,800/w);
    canvas.width=Math.ceil(w*scale); canvas.height=Math.ceil(h*scale);
    const ctx=canvas.getContext('2d');
    if (!ctx) return '';
    const pixels=ctx.createImageData(canvas.width,canvas.height);
    const radiusPx=Math.min(w/2,h/2,radius), band=Math.min(14,h*.26);
    for (let y=0;y<canvas.height;y++){
      for (let x=0;x<canvas.width;x++){
        const cx=(x+.5)/scale-w/2, cy=(y+.5)/scale-h/2;
        const qx=Math.abs(cx)-w/2+radiusPx, qy=Math.abs(cy)-h/2+radiusPx;
        const ex=Math.max(0,qx), ey=Math.max(0,qy), len=Math.hypot(ex,ey);
        const depth=radiusPx-len-Math.min(Math.max(qx,qy),0);
        const t=Math.min(1,Math.max(0,depth/band));
        const bend=depth<0?0:Math.sin(Math.PI*Math.sqrt(t))*(1-t);
        const nx=len?ex/len:Number(qx>qy), ny=len?ey/len:Number(qy>=qx);
        const i=4*(y*canvas.width+x);
        pixels.data[i]=128-126*Math.sign(cx)*nx*bend;
        pixels.data[i+1]=128-126*Math.sign(cy)*ny*bend;
        pixels.data[i+2]=128; pixels.data[i+3]=255;
      }
    }
    ctx.putImageData(pixels,0,0);
    return canvas.toDataURL();
  }

  function addLens(defs,panel,index) {
    const id='sonic-stage-lens-'+index;
    const filter=element('filter',{id,x:'0%',y:'0%',width:'100%',height:'100%','color-interpolation-filters':'sRGB'});
    const image=element('feImage',{x:'0%',y:'0%',width:'100%',height:'100%',preserveAspectRatio:'none',result:'rim'});
    filter.append(image);
    for (let channel=0;channel<3;channel++){
      filter.append(element('feDisplacementMap',{in:'SourceGraphic',in2:'rim',scale:30-channel*4,
        xChannelSelector:'R',yChannelSelector:'G',result:'bend'+channel}));
      const matrix=['0 0 0 0 0','0 0 0 0 0','0 0 0 0 0','0 0 0 1 0'];
      matrix[channel]=['1 0 0 0 0','0 1 0 0 0','0 0 1 0 0'][channel];
      filter.append(element('feColorMatrix',{in:'bend'+channel,values:matrix.join(' '),result:'color'+channel}));
    }
    filter.append(element('feBlend',{in:'color0',in2:'color1',mode:'screen',result:'rg'}),
      element('feBlend',{in:'rg',in2:'color2',mode:'screen'}));
    defs.append(filter);
    let last='';
    return function update() {
      const w=panel.offsetWidth,h=panel.offsetHeight;
      if (!w||!h) return;
      const radius=parseFloat(getComputedStyle(panel).borderTopLeftRadius)||0;
      const key=[w,h,radius].join('/');
      if (key===last) return;
      last=key;
      const url=lensMap(w,h,radius);
      if (!url) return;
      image.setAttribute('href',url);
      panel.style.setProperty('--lr-lens','url(#'+id+')');
    };
  }

  function mount(root,panels) {
    const usable=CSS.supports('backdrop-filter','url(#lens)');
    let active=false,frame=0,observer,refresh;
    function initialize() {
      const svg=element('svg',{width:0,height:0,'aria-hidden':'true',class:'lr-lens-defs'});
      const defs=element('defs',{});
      svg.append(defs); root.append(svg);
      const updates=panels.map((panel,i)=>addLens(defs,panel,i));
      refresh=()=>{frame=0; if(active) updates.forEach(update=>update());};
      observer=new ResizeObserver(()=>{if(active&&!frame)frame=requestAnimationFrame(refresh);});
    }
    return {enable(on) {
      if (active===on) return;
      active=on;
      root.toggleAttribute('data-liquid-glass',on);
      if (!usable) return;
      if (on){
        if (!observer) initialize();
        panels.forEach(panel=>observer.observe(panel));
        refresh();
      }else{
        observer.disconnect();
        cancelAnimationFrame(frame); frame=0;
      }
    }};
  }
  window.SonicStageGlass={mount};
})();
