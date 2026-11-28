/* The gallery and playback surface share the same crop and art direction. */
(function (root) {
  'use strict';
  const tau = Math.PI * 2;
  function base(ctx, frame, top, bottom) {
    const wash = ctx.createLinearGradient(0, 0, frame.width * .25, frame.height);
    wash.addColorStop(0, top); wash.addColorStop(1, bottom);
    ctx.fillStyle = wash; ctx.fillRect(0, 0, frame.width, frame.height);
  }
  function halo(ctx, x, y, rx, ry, angle, rgb, alpha) {
    ctx.save(); ctx.translate(x,y); ctx.rotate(angle); ctx.scale(rx,ry);
    const g = ctx.createRadialGradient(0,0,0,0,0,1);
    g.addColorStop(0,'rgba('+rgb+','+alpha+')');
    g.addColorStop(.46,'rgba('+rgb+','+(alpha*.63)+')');
    g.addColorStop(1,'rgba('+rgb+',0)');
    ctx.fillStyle=g; ctx.fillRect(-1,-1,2,2); ctx.restore();
  }

  function coast(ctx,f) {
    const {width:w,height:h,time:t,illustration:img}=f;
    base(ctx,f,'#244754','#647575');
    if(img && img.naturalWidth) {
      const z=1.017+.006*Math.sin(t*.059), fit=Math.max(w/img.naturalWidth,h/img.naturalHeight)*z;
      const iw=img.naturalWidth*fit,ih=img.naturalHeight*fit;
      ctx.imageSmoothingQuality='high';
      ctx.drawImage(img,(w-iw)*(.76+.011*Math.sin(t*.053)),(h-ih)*.51,iw,ih);
    }
    const shade=ctx.createLinearGradient(0,0,w,0);
    shade.addColorStop(0,'rgba(8,17,25,.34)');shade.addColorStop(.66,'rgba(8,17,25,.10)');shade.addColorStop(1,'rgba(8,17,25,.035)');
    ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
  }

  // All movement below uses coordinates on the source plate. Window borders,
  // grass roots and star cores keep their positions when the viewport is cropped.
  const looks={
    hall:{focus:.66, top:'#32271f', bottom:'#674527'},
    sleeve:{focus:.78, top:'#2f1e26', bottom:'#382420'},
    silk:{focus:.75, top:'#182432', bottom:'#44515c'},
    port:{focus:.55, top:'#292819', bottom:'#393136'},
    sky:{focus:.90, top:'#0a1523', bottom:'#1b2733'},
  };
  function photograph(ctx,f,look,effect) {
    const img=f.illustration, w=f.width, h=f.height;
    if(!img?.naturalWidth){base(ctx,f,look.top,look.bottom);return;}
    const fit=Math.max(w/img.naturalWidth,h/img.naturalHeight);
    const iw=img.naturalWidth*fit, ih=img.naturalHeight*fit;
    ctx.save();
    ctx.translate((w-iw)*look.focus,(h-ih)*.48);
    ctx.scale(iw,ih);
    ctx.imageSmoothingQuality=f.thumbnail?'high':'medium';
    ctx.drawImage(img,0,0,1,1);
    effect(ctx,f,img);
    ctx.restore();
    if(!f.thumbnail){
      // Keep the central lyric band readable, especially on a tight portrait crop.
      const shade=ctx.createLinearGradient(0,0,0,h);
      const alpha=w<h?.23:.12;
      shade.addColorStop(0,'rgba(9,12,17,0)');
      shade.addColorStop(.48,'rgba(9,12,17,'+alpha+')');
      shade.addColorStop(1,'rgba(9,12,17,.02)');
      ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
    }
  }

  function hallLight(ctx,f) {
    if(f.thumbnail)return;
    const t=f.time;
    for(let i=0;i<25;i++){
      const depth=(i*47%101)/101, y=(i*.618+t*(.008+depth*.004))%1;
      const x=.945-y*.205+Math.sin(i*31+t*.22)*.042;
      const opacity=Math.sin(y*Math.PI)**2*(.14+depth*.42);
      ctx.fillStyle='rgba(255,230,184,'+opacity+')';
      ctx.beginPath();ctx.ellipse(x,.07+y*.55,.00042+depth*.00042,.00072+depth*.0008,0,0,tau);ctx.fill();
    }
  }
  function sleeveLight(ctx,f,img) {
    const primary=f.artwork?.primary||[174,113,129], secondary=f.artwork?.secondary||[114,91,142];
    ctx.save();
    ctx.globalCompositeOperation='soft-light';
    halo(ctx,.45,.23,.64,.61,-.23,primary.map(Math.round).join(','),.87);
    halo(ctx,.18,.68,.52,.62,-.32,secondary.map(Math.round).join(','),.75);
    ctx.restore();
    if(f.thumbnail)return;
    // Spin the paper texture in the plane of the disc. The spindle and tonearm stay fixed.
    const cx=.663,cy=.541,rx=.094,ry=.084;
    ctx.save();ctx.translate(cx,cy);ctx.scale(rx,ry);
    ctx.beginPath();ctx.arc(0,0,.98,0,tau);ctx.arc(0,0,.21,0,tau,true);ctx.clip('evenodd');
    ctx.rotate(f.time*tau*5/9);ctx.globalAlpha=.62;
    ctx.drawImage(img,(cx-rx)*img.naturalWidth,(cy-ry)*img.naturalHeight,2*rx*img.naturalWidth,2*ry*img.naturalHeight,-1,-1,2,2);
    ctx.restore();
    // The highlight is a reflection on the groove annulus.
    ctx.save();ctx.translate(.663,.533);ctx.scale(.276,.253);
    ctx.beginPath();ctx.arc(0,0,1,0,tau);ctx.arc(0,0,.35,0,tau,true);ctx.clip('evenodd');
    const theta=-2.50+Math.sin(f.time*.18)*.16;
    halo(ctx,Math.cos(theta)*.69,Math.sin(theta)*.69,.43,.15,theta,'242,207,167',.12+(f.breath||0)*.08);
    ctx.restore();
  }
  function moonWind(ctx,f,img) {
    if(f.thumbnail || !f.time)return;
    // The moon and left hillside stay fixed. A gentle bend increases from root to tip.
    const start=.41, width=1-start, slices=f.quality<.7?28:44;
    const wind=Math.sin(f.time*.51)+.31*Math.sin(f.time*.97+.8);
    const sw=img.naturalWidth,sh=img.naturalHeight;
    for(let i=0;i<slices;i++){
      const top=Math.round(sh*i/slices), bottom=Math.min(sh,Math.round(sh*(i+1)/slices)+1);
      const y=top/sh, height=(bottom-top)/sh;
      const bend=(1-y)**1.7*wind*(.005+(f.breath||0)*.002);
      ctx.drawImage(img,start*sw,top,width*sw,bottom-top,start,y,width+bend,height);
    }
  }
  function windowView(ctx,f,img) {
    if(f.thumbnail)return;
    // Trace the inside of the photographed gasket so the carriage, lamp and seat stay still.
    ctx.save();ctx.beginPath();ctx.moveTo(.534,.118);ctx.lineTo(.899,.073);
    ctx.bezierCurveTo(.947,.065,.973,.112,.973,.189);ctx.lineTo(.973,.553);
    ctx.bezierCurveTo(.973,.625,.95,.665,.905,.665);ctx.lineTo(.532,.665);
    ctx.bezierCurveTo(.487,.665,.465,.63,.465,.555);ctx.lineTo(.465,.249);
    ctx.bezierCurveTo(.465,.173,.49,.124,.534,.118);ctx.closePath();ctx.clip();
    const zoom=1.095, dx=.017*Math.sin(f.time*.064),dy=.002*Math.sin(f.time*.105);
    ctx.drawImage(img,(1-zoom)*.72+dx,(1-zoom)*.38+dy,zoom,zoom);ctx.restore();
  }
  // These are measured star centers on the night-sky plate.
  const stars=[[.1752,.1615],[.3864,.1488],[.4779,.1679],[.6423,.0903],[.9079,.0468],
    [.2123,.3422],[.2883,.2253],[.5742,.2327],[.6244,.3369],[.8134,.2657],
    [.1059,.4315],[.2721,.5409],[.5197,.525],[.6196,.4729],[.9336,.4315]];
  function starlight(ctx,f) {
    if(f.thumbnail)return;
    stars.forEach(([x,y],i)=>{
      const light=.5+.5*Math.sin(f.time*(.26+i*.012)+i*2.37);
      halo(ctx,x,y,.0023,.0041,0,'190,210,233',.05+.28*light*light);
    });
  }
  root.SonicStageBackdrops=Object.freeze({
    'listening-hall':(ctx,f)=>photograph(ctx,f,looks.hall,hallLight),
    'sleeve-wash':(ctx,f)=>photograph(ctx,f,looks.sleeve,sleeveLight),
    'coast-radio':coast,
    'moon-silk':(ctx,f)=>photograph(ctx,f,looks.silk,moonWind),
    'view-port':(ctx,f)=>photograph(ctx,f,looks.port,windowView),
    'quiet-sky':(ctx,f)=>photograph(ctx,f,looks.sky,starlight),
  });
})(globalThis);
