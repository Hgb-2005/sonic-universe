(function (root) {
  'use strict';
  const effects = root.SonicLyricEffects;
  const karaoke = root.SonicLyricKaraoke;
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined,{granularity:'grapheme'}) : null;
  const white = [1,.98,1], muted = [.71,.75,.83];
  const rgb = hex => [1,3,5].map(channel => parseInt(hex.slice(channel,channel+2),16)/255);
  const palettes = new Map(effects.groups.flatMap(group => group.entries)
    .filter(preset => preset.palette)
    .map(({id,palette}) => [id,{waiting:rgb(palette.waiting), sung:rgb(palette.sung)}]));
  const shadows = {
    impact: [[.019,.048,[.09,.07,.05],.96]],
    neon: [[.036,.008,[.12,.46,.44],.48]],
    echo: [[-.085,.055,[.47,.26,.64],.45],[.075,-.05,[.79,.39,.61],.39]],
    flare: [[0,.043,[.68,.34,.15],.43]],
    ink: [[-.014,.022,[.53,.46,.33],.32]],
  };
  const noShadows = [];
  const maxSurfacePixels = 1_700_000;

  function glyphPose(id, word, position, animated) {
    const {rest:fade,note:lift,wave:swing}=animated?effects.wordFrame(word,position):{rest:0,note:0,wave:0};
    const side = word.order%2===0 ? 1 : -1;
    const pose = {x:0,y:0,sx:1,sy:1,angle:0,skew:0,opacity:1-fade*.44};
    switch(id) {
      case 'impact': pose.y=-.085*lift; pose.sx=pose.sy=1+.066*lift; pose.opacity=1-.11*fade; break;
      case 'cut': pose.x=side*fade*.074; pose.y=side*fade*.06-lift*.03; pose.opacity=1-.13*fade; break;
      case 'neon': pose.y=-.046*lift; pose.sx=1+.028*lift; pose.opacity=1-.08*fade; break;
      case 'echo': pose.y=-swing*.075; pose.opacity=1-.1*fade; break;
      case 'film': pose.y=.032*fade; pose.sy=1-.07*fade; pose.opacity=1-.18*fade; break;
      case 'flare': pose.y=-.061*lift; pose.sx=pose.sy=1+.047*lift; pose.opacity=1-.11*fade; break;
      case 'orbit': pose.x=side*fade*.20; pose.y=-swing*.29; pose.angle=side*fade*13; break;
      case 'tide': pose.y=-.027*lift; pose.opacity=1-.06*fade; break;
      case 'ink': pose.opacity=1-.12*fade; break;
      case 'mist': pose.opacity=1-.68*fade; break;
      case 'sunrise': pose.y=.21*fade; break;
      case 'petal': pose.x=swing*.22; pose.y=-.68*fade; pose.angle=side*fade*31; break;
      case 'prism': pose.sx=Math.cos(fade*.87); pose.skew=side*fade*.10; break;
      case 'stairs': pose.y=fade*((word.order%4)*.34-.43); break;
      case 'paper': pose.sy=Math.cos(fade*1.05); pose.skew=side*fade*.12; break;
      case 'clock': pose.x=side*fade*.13; pose.angle=side*fade*9; break;
      case 'wide': pose.sx=pose.sy=1+.09*lift; pose.x=side*fade*.18; break;
    }
    const radians=pose.angle*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
    return {x:pose.x,y:pose.y,opacity:pose.opacity,
      a:cos*pose.sx,b:sin*pose.sx,c:(cos*pose.skew-sin)*pose.sy,d:(sin*pose.skew+cos)*pose.sy};
  }

  function sliceWord(word, range) {
    const node=word.node.firstChild;
    range.selectNodeContents(word.node);
    const bounds=range.getClientRects();
    if(bounds.length===1)return [{text:word.text, bounds:bounds[0], from:0, to:1}];
    // DOM wrapping can split an unusually long timed word across several rows.
    const parts=segmenter ? Array.from(segmenter.segment(word.text),item=>item.segment) : Array.from(word.text);
    const groups=[];
    let offset=0;
    for(const [index,text] of parts.entries()){
      range.setStart(node,offset);
      offset+=text.length;
      range.setEnd(node,offset);
      const box=range.getBoundingClientRect(), previous=groups.at(-1);
      if(previous&&Math.abs(box.top-previous.top)<2){
        previous.text+=text;
        previous.end=offset;
        previous.to=(index+1)/parts.length;
      }else groups.push({text,top:box.top,start:offset-text.length,end:offset,from:index/parts.length,to:(index+1)/parts.length});
    }
    for(const group of groups){
      range.setStart(node,group.start);range.setEnd(node,group.end);
      group.bounds=range.getBoundingClientRect();
    }
    return groups;
  }

  function fontFor(context, style) {
    context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.textBaseline='alphabetic';
    context.textAlign='left';
    context.direction=style.direction;
    if('letterSpacing' in context)context.letterSpacing=style.letterSpacing==='normal'?'0px':style.letterSpacing;
  }

  function measureLine(row, host, id, highQuality, maxTextureSize) {
    const style=getComputedStyle(row.element), size=parseFloat(style.fontSize);
    const hostBounds=host.parentElement.getBoundingClientRect(), rowBounds=row.element.getBoundingClientRect();
    const range=document.createRange(), glyphs=[];
    let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
    for(const word of row.words)for(const piece of sliceWord(word,range)){
      if(!piece.bounds.width||!piece.bounds.height)continue;
      const x=piece.bounds.left-hostBounds.left,y=piece.bounds.top-hostBounds.top;
      left=Math.min(left,x);top=Math.min(top,y);
      right=Math.max(right,x+piece.bounds.width);bottom=Math.max(bottom,y+piece.bounds.height);
      glyphs.push({...piece,x,y,word});
    }
    if(!glyphs.length||!hostBounds.width||!hostBounds.height)return null;
    const bleed=size*1.05+3;
    const horizontal=bleed+(id==='wide'?(right-left)*.06:id==='prism'?(bottom-top)*.16:0);
    const vertical=bleed+(id==='clock'?(right-left)*.11:0);
    const x=Math.max(0,Math.floor(left-horizontal)),y=Math.max(0,Math.floor(top-vertical));
    const width=Math.min(Math.ceil(hostBounds.width),Math.ceil(right+horizontal))-x;
    const height=Math.min(Math.ceil(hostBounds.height),Math.ceil(bottom+vertical))-y;
    if(width<=0||height<=0)return null;
    const ratio=Math.min(devicePixelRatio||1,highQuality?1.5:1,Math.sqrt(1_350_000/(width*height)));
    const atlas=document.createElement('canvas'),context=atlas.getContext('2d');
    if(!context)return null;
    fontFor(context,style);
    const sprites=new Map();
    for(const glyph of glyphs){
      let sprite=sprites.get(glyph.text);
      if(!sprite){
        const metrics=context.measureText(glyph.text);
        const start=Math.floor(Math.min(0,-metrics.actualBoundingBoxLeft))-1;
        const end=Math.ceil(Math.max(metrics.width,metrics.actualBoundingBoxRight))+1;
        const ascent=Math.ceil(metrics.fontBoundingBoxAscent||size);
        const descent=Math.ceil(metrics.fontBoundingBoxDescent||size*.27);
        const glyphTop=Math.max(ascent,Math.ceil(metrics.actualBoundingBoxAscent))+1;
        const glyphBottom=Math.max(descent,Math.ceil(metrics.actualBoundingBoxDescent))+1;
        const pixelWidth=Math.max(1,Math.ceil((end-start)*ratio));
        const pixelHeight=Math.max(1,Math.ceil((glyphTop+glyphBottom)*ratio));
        const logicalWidth=pixelWidth/ratio;
        sprite={text:glyph.text,start,ascent,descent,glyphTop,width:pixelWidth,height:pixelHeight,
          sweepStart:-start/logicalWidth,sweepEnd:(metrics.width-start)/logicalWidth};
        sprites.set(glyph.text,sprite);
      }
      glyph.sprite=sprite;
      glyph.x+=sprite.start-x;
      glyph.y+=(glyph.bounds.height-sprite.ascent-sprite.descent)*.5+sprite.ascent-sprite.glyphTop-y;
      glyph.w=sprite.width/ratio;glyph.h=sprite.height/ratio;
    }
    const cells=[...sprites.values()].sort((a,b)=>b.height-a.height);
    const area=cells.reduce((total,sprite)=>total+(sprite.width+2)*(sprite.height+2),0);
    const atlasWidth=Math.min(maxTextureSize,Math.max(256,Math.ceil(Math.sqrt(area)*1.2),...cells.map(sprite=>sprite.width+2)));
    let cursorX=1,cursorY=1,shelfHeight=0;
    for(const sprite of cells) {
      if(sprite.width+2>atlasWidth)return null;
      if(cursorX+sprite.width+1>atlasWidth){cursorY+=shelfHeight;cursorX=1;shelfHeight=0;}
      sprite.x=cursorX;sprite.y=cursorY;
      cursorX+=sprite.width+2;
      shelfHeight=Math.max(shelfHeight,sprite.height+2);
    }
    const atlasHeight=cursorY+shelfHeight;
    if(atlasHeight>maxTextureSize||atlasWidth*atlasHeight>6_000_000)return null;
    atlas.width=atlasWidth;atlas.height=atlasHeight;
    fontFor(context,style);
    context.fillStyle='#fff';
    context.scale(ratio,ratio);
    for(const sprite of cells)context.fillText(sprite.text,sprite.x/ratio-sprite.start,sprite.y/ratio+sprite.glyphTop);
    return {atlas,glyphs,ratio,x,y,width,height,size,hostWidth:hostBounds.width,cx:rowBounds.left+rowBounds.width/2-hostBounds.left-x,
      cy:rowBounds.top+rowBounds.height/2-hostBounds.top-y};
  }

  function create2D(canvas) {
    const context=canvas.getContext('2d',{alpha:true});
    if(!context)return null;
    function tinted(atlas,color) {
      const layer=document.createElement('canvas');
      layer.width=atlas.width;layer.height=atlas.height;
      const mask=layer.getContext('2d');
      if(!mask)return atlas;
      mask.drawImage(atlas,0,0);
      mask.globalCompositeOperation='source-in';
      mask.fillStyle=`rgb(${color.map(channel=>Math.round(channel*255)).join(',')})`;
      mask.fillRect(0,0,layer.width,layer.height);
      return layer;
    }
    return {
      maxTextureSize:4096,
      upload(atlas,quads){
        const tints=new Map();
        for(const {color,highlight} of quads)for(const tint of [color,highlight]){
          if(!tints.has(tint))tints.set(tint,tinted(atlas,tint));
        }
        return tints;
      },
      release(tints){tints.clear();},
      draw(tints,quads,width,height){
        const scaleX=canvas.width/width,scaleY=canvas.height/height;
        context.resetTransform();
        context.clearRect(0,0,canvas.width,canvas.height);
        for(const quad of quads){
          const {sprite,x,y,w,h,a,b,c,d,color,highlight,fill,opacity}=quad;
          const step=fill<=0?0:fill>=1?1:sprite.sweepStart+fill*(sprite.sweepEnd-sprite.sweepStart);
          context.setTransform(a*scaleX,b*scaleY,c*scaleX,d*scaleY,x*scaleX,y*scaleY);
          context.globalAlpha=opacity;
          if(step>0)context.drawImage(tints.get(highlight),sprite.x,sprite.y,sprite.width*step,sprite.height,0,0,w*step,h);
          if(step<1)context.drawImage(tints.get(color),sprite.x+sprite.width*step,sprite.y,sprite.width*(1-step),sprite.height,w*step,0,w*(1-step),h);
        }
        return true;
      },
      close(){},
    };
  }

  function transformLine(id, enter) {
    const rest=1-enter;
    if(id==='film')return {x:rest*.12,y:0,a:1,b:0,c:0,d:1};
    if(id==='tide')return {x:0,y:rest*.046,a:1,b:0,c:0,d:1};
    if(id==='mist')return {x:0,y:rest*.32,a:1,b:0,c:0,d:1};
    if(id==='prism')return {x:0,y:0,a:1,b:0,c:Math.tan(rest*-.30),d:1};
    if(id==='clock'){
      const angle=rest*-.209;
      return {x:0,y:0,a:Math.cos(angle),b:Math.sin(angle),c:-Math.sin(angle),d:Math.cos(angle)};
    }
    return {x:0,y:0,a:id==='wide'?1+rest*.12:1,b:0,c:0,d:1};
  }

  function create(host, onContextLoss) {
    let canvas,backend,kind,layout,currentRow,currentId,currentPixelRatio,backendOpened=false;
    let nextLine=null,prepares=0,prewarmHits=0,surfaceResizes=0;
    function releaseLine(line) {
      if(!line?.resource)return;
      backend.release(line.resource);
      line.resource=null;
    }
    function clearPrewarm(){releaseLine(nextLine?.layout);nextLine=null;}
    function open(allowGPU) {
      clearPrewarm();
      releaseLine(layout);
      backend?.close();
      canvas=document.createElement('canvas');
      backend=allowGPU?root.SonicLyricGpu?.create(canvas):null;
      kind=backend?'webgl':'canvas2d';
      if(!backend){canvas=document.createElement('canvas');backend=create2D(canvas);}
      if(!backend)return false;
      if(kind==='webgl')canvas.addEventListener('webglcontextlost',event=>{
        if(event.currentTarget!==canvas)return;
        invalidate();
        onContextLoss?.();
      },{once:true});
      host.replaceChildren(canvas);
      return true;
    }
    function hide(){
      host.hidden=true;
      invalidate();
    }
    function invalidate(){currentRow=null;clearPrewarm();releaseLine(layout);layout=null;}
    function ensureBackend() {
      if(!backendOpened){backendOpened=true;open(true);}
      return Boolean(backend);
    }
    function configureSurface(next){
      const width=Math.max(1,Math.round(next.width*next.ratio));
      const height=Math.max(1,Math.round(next.height*next.ratio));
      if(width>canvas.width||height>canvas.height){
        // Reserve space for wider lines so their arrival does not recreate the drawing buffer.
        const reserveHeight=Math.max(canvas.height,Math.ceil(height/128)*128);
        const availableWidth=Math.floor(maxSurfacePixels/reserveHeight);
        const reserveWidth=Math.max(width,canvas.width,Math.min(Math.ceil(next.hostWidth*next.ratio),availableWidth));
        const fits=reserveWidth*reserveHeight<=maxSurfacePixels;
        const backingWidth=fits?reserveWidth:width,backingHeight=fits?reserveHeight:height;
        if(canvas.width!==backingWidth)canvas.width=backingWidth;
        if(canvas.height!==backingHeight)canvas.height=backingHeight;
        surfaceResizes++;
      }
      next.surfaceWidth=canvas.width*next.width/width;
      next.surfaceHeight=canvas.height*next.height/height;
      canvas.style.left=next.x+'px';canvas.style.top=next.y+'px';
      canvas.style.width=next.surfaceWidth+'px';canvas.style.height=next.surfaceHeight+'px';
    }
    function upload(next) {
      next.resource=backend.upload(next.atlas,next.quads);
      return Boolean(next.resource);
    }
    function prepare(row,id) {
      prepares++;
      const next=measureLine(row,host,id,kind==='webgl',backend.maxTextureSize);
      if(!next)return null;
      const styles=shadows[id]||noShadows;
      const {waiting=muted,sung=white}=palettes.get(id)||{};
      next.quads=[];
      next.words=new Map();
      for(const glyph of next.glyphs){
        glyph.poses=[];
        if(!next.words.has(glyph.word))next.words.set(glyph.word,{});
        glyph.frame=next.words.get(glyph.word);
        for(const [x,y,color,alpha] of styles)glyph.poses.push({sprite:glyph.sprite,w:glyph.w,h:glyph.h,color,highlight:color,shiftX:x,shiftY:y,alpha,shadow:true});
        glyph.poses.push({sprite:glyph.sprite,w:glyph.w,h:glyph.h,color:waiting,highlight:sung,shiftX:0,shiftY:0,alpha:1});
        next.quads.push(...glyph.poses);
      }
      return next;
    }
    function preparedLine(row,id,pixelRatio) {
      return nextLine&&nextLine.row===row&&nextLine.id===id&&nextLine.backend===backend&&nextLine.pixelRatio===pixelRatio
        ?nextLine.layout:null;
    }
    function prewarm(row,id) {
      if(!row?.element?.isConnected||!ensureBackend())return false;
      const pixelRatio=devicePixelRatio||1;
      if(row===currentRow&&id===currentId&&pixelRatio===currentPixelRatio&&layout)return false;
      if(preparedLine(row,id,pixelRatio))return true;
      clearPrewarm();
      const prepared=prepare(row,id);
      if(!prepared||!upload(prepared))return false;
      if(!layout&&host.hidden)configureSurface(prepared);
      nextLine={row,id,backend,pixelRatio,layout:prepared};
      return true;
    }
    function paint(row,id,position,enter,animated) {
      if(!ensureBackend()){host.hidden=true;return 'text';}
      const pixelRatio=devicePixelRatio||1;
      if(row!==currentRow||id!==currentId||pixelRatio!==currentPixelRatio){
        const prepared=preparedLine(row,id,pixelRatio);
        if(prepared)nextLine=null;
        else clearPrewarm();
        releaseLine(layout);
        currentRow=row;currentId=id;currentPixelRatio=pixelRatio;
        if(prepared)prewarmHits++;
        layout=prepared||prepare(row,id);
        if(layout&&!layout.resource&&!upload(layout)){
          layout=kind==='webgl'&&open(false)?prepare(row,id):null;
          if(layout&&!upload(layout))layout=null;
        }
        if(layout)configureSurface(layout);
      }
      if(!layout){host.hidden=true;return 'text';}
      if(position===layout.position&&animated===layout.animated)return kind;
      let dirty=!layout.drawn||layout.enter!==enter;
      const line=transformLine(id,enter);
      const {size,cx,cy}=layout;
      for(const [word,frame] of layout.words) {
        const moves=animated&&!word.leading&&(row.timed||id!=='tide');
        const {begin,finish}=word.motion;
        const interval=position<begin?-1:position<finish?0:1;
        if(!frame.pose||moves!==frame.moves||moves&&(interval===0||interval!==frame.interval)){
          frame.pose=glyphPose(id,word,position,moves);
          dirty=true;
        }
        const fill=word.leading?0:row.timed?karaoke.progress(word,position):1;
        if(frame.fill!==fill)dirty=true;
        frame.moves=moves;frame.interval=interval;frame.fill=fill;
      }
      layout.position=position;layout.animated=animated;layout.enter=enter;
      if(!dirty)return kind;
      for(const glyph of layout.glyphs){
        const {pose,fill}=glyph.frame;
        const {a,b,c,d}=pose;
        const pivotX=glyph.w*.5,pivotY=glyph.h*.69;
        const offsetX=id==='cut'?glyph.bounds.width:size;
        const left=glyph.x+pivotX-a*pivotX-c*pivotY+pose.x*offsetX;
        const top=glyph.y+pivotY-b*pivotX-d*pivotY+pose.y*size;
        for(const quad of glyph.poses){
          const x=left-cx+quad.shiftX*size,y=top-cy+quad.shiftY*size;
          quad.x=cx+line.a*x+line.c*y+line.x*size;quad.y=cy+line.b*x+line.d*y+line.y*size;
          quad.a=line.a*a+line.c*b;quad.b=line.b*a+line.d*b;
          quad.c=line.a*c+line.c*d;quad.d=line.b*c+line.d*d;
          const bleed=id==='ink'&&quad.shadow?Math.max(.22,1-enter):1;
          quad.opacity=pose.opacity*quad.alpha*bleed;
          quad.fill=quad.shadow?0:Math.max(0,Math.min(1,(fill-glyph.from)/(glyph.to-glyph.from)));
        }
      }
      if(!backend.draw(layout.resource,layout.quads,layout.surfaceWidth,layout.surfaceHeight)){
        if(kind==='webgl'&&open(false)&&upload(layout)){
          configureSurface(layout);
        } else {
          hide();
          return 'text';
        }
        backend.draw(layout.resource,layout.quads,layout.surfaceWidth,layout.surfaceHeight);
      }
      layout.drawn=true;host.hidden=false;
      return kind;
    }
    return {paint,hide,invalidate,prewarm,clearPrewarm,stats:()=>({prepares,prewarmHits,surfaceResizes})};
  }
  root.SonicLyricRenderer=Object.freeze({create});
})(globalThis);
