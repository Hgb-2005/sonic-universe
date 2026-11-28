(function(root,factory){
  const library=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=library;
  else root.SonicPlaybackBackgrounds=library;
})(globalThis,function(root){
  'use strict';
  const groups=Object.freeze([
    ['space','星空与宇宙'],['nature','自然风景'],['water','天气与水景'],
    ['paper','水墨与纸面'],['light','光影与材质'],['geometry','几何与建筑'],['quiet','简洁与静态'],
  ].map(([id,label])=>Object.freeze({id,label})));
  // Each palette is authored for the subject: canvas, sky/paper, second plane, foreground, highlight.
  // Cover tint, when present, is applied to the highlight only.
  const designs={
    space:[
      ['orbit-particles','星尘轨道','orbit','dark','slow','#141a2b #242743 #646da3 #292f55 #b4bfe9',.18],
      ['ion-nebula','离子星云','nebula','dark','slow','#171a31 #263354 #645986 #211d39 #e0b7de',.18],
      ['meteor-garden','流星花园','meteors','dark','slow','#152438 #253e57 #486c8a #394c62 #dcf3fb',.17],
      ['singularity','黑洞边界','accretion','dark','slow','#231b27 #35293e #d38150 #462f49 #ffd794',.23],
      ['outer-eclipse','外环日蚀','eclipse','dark','slow','#172329 #30414c #6a999b #111b29 #bffbe7',.22],
    ],
    nature:[
      ['mist-valley','晨雾山谷','valley','light','slow','#e2e8df #a6bdbe #a9bbb0 #647d73 #fbefd7',.08],
      ['white-coast','浅色海岸','coast','light','slow','#eee7cb #dae9dc #86c5b9 #4a9e9a #fffdf2',.05],
      ['amber-dunes','金色沙海','dunes','light','slow','#edd3a3 #f9deb3 #c88654 #955c46 #fff2ce',.07],
      ['forest-light','森林逆光','forest','dark','slow','#34483c #94a481 #597353 #20352c #f8e3a7',.11,'',.20],
      ['summer-meadow','夏日草甸','meadow','light','slow','#e5eabf #b7d5d8 #94ae66 #507147 #fff3c2',.07],
      ['alpine-snow','雪岭晴空','peaks','light','static','#e4eef4 #aac6e3 #b8cddd #728daa #f9fbfb',.06],
      ['river-bend','河湾鸟瞰','river','light','slow','#d6e0c4 #c3cf9d #7fb8ba #738c62 #e5f8ea',.05,'',.12],
      ['pink-bluffs','霞色断崖','cliffs','light','static','#f0d4c7 #f6d8c9 #d7907d #a55c59 #fceada',.06],
      ['blue-fjord','蓝湾峡地','fjord','mid','slow','#b5cad8 #c9d9e3 #819caf #627a91 #eff6f2',.07,'',.13],
      ['cedar-lake','杉林暮湖','cedarLake','dark','slow','#27474c #7f9b92 #547976 #233d3d #e1dcc0',.09,'',.35],
      ['terrace-fields','梯田青岚','terraces','mid','static','#c4d2a0 #dce4ba #acbf81 #66844f #e9ebb3',.05,'',.18],
      ['afterglow','地平余晖','sunset','dark','slow','#513248 #684059 #a86468 #372d43 #ffcca7',.15],
    ],
    water:[
      ['jiangnan-rain','烟雨江南','riverRain','mid','slow','#b7c7bf #c6d4cf #91a79d #4d6c65 #edeee1',.06],
      ['jade-current','青玉潮汐','current','dark','slow','#173e3b #356560 #40877a #194f47 #b0e4c7',.11,'',.18],
      ['blue-rain','蓝窗细雨','rainGlass','mid','slow','#c0d1da #91adbb #7895a2 #456171 #f6fbff',.10,'',.30],
      ['still-lake','静水涟漪','ripples','mid','slow','#9ebdb5 #c5d7c6 #9abdb4 #5d847c #f5f8de',.08],
      ['silk-fog','水岸烟岚','fog','light','slow','#ded9df #eee7e8 #c4bdcc #8c8ba7 #faf2eb',0],
      ['silver-squall','斜线骤雨','squall','dark','slow','#303e51 #606c82 #56677d #293446 #d8edf5',.08],
      ['tidal-circles','潮边重环','tide','dark','slow','#213e53 #487f96 #39728a #22475d #c3e3ed',.06,'',.22],
      ['refracted-pool','浅池折光','caustics','light','slow','#c4e4dd #e4f2d6 #73baae #4d9d93 #f9ffdf',.06],
      ['estuary-waves','河口波带','waterlines','light','slow','#dce1ce #e8e8d4 #96b7a3 #5f8a80 #fff5d5',.08],
      ['glacial-plate','冰纹水面','ice','light','static','#dfecf1 #ecf3f2 #afcbd8 #789caf #fafff9',.05],
    ],
    paper:[
      ['rice-paper','宣纸纤维','fibers','light','static','#eee4d0 #f7efdc #dcc5aa #7e5e50 #af5740'],
      ['slow-ink','缓墨','ink','light','slow','#eae3d8 #f4ece1 #b6adb2 #443e4a #d6a38a'],
      ['torn-horizons','撕纸群山','torn','light','static','#e7debc #f1e8cd #c5a279 #676f57 #fff6e0'],
      ['silkscreen','丝网印刷','screen','light','static','#e7dabe #f5e8ce #bb6150 #344d59 #e4a446',0,'',.15],
      ['misregistered','错版色栅','overprint','light','static','#e9e5d9 #f5eddf #71a7ab #be616c #cc913f'],
      ['charcoal-bank','炭墨石岸','charcoal','light','static','#e6e0d6 #f1ece1 #a59d91 #605e5c #faf4e3'],
      ['paper-fan','折纸屏风','paperFan','light','static','#ead8c0 #f4e5cf #d0b496 #ab886d #fef1dc'],
      ['ink-silhouette','远山剪影','inkHills','light','static','#e3e5d8 #f1eddf #a0abb0 #536c73 #e5c0a1'],
      ['halftone-blocks','半调网印','halftone','light','static','#ebdedd #f6edf0 #b292b2 #635375 #d98f8b'],
      ['stenciled-shards','套版剪片','stencil','light','static','#e0e2cf #eff2db #9bab81 #566558 #d69965'],
    ],
    light:[
      ['cathedral-beams','穹顶斜光','shafts','dark','music','#413842 #594753 #8c7165 #2a252f #ffe3ac',.15,'',.30],
      ['silk-threads','丝绸褶皱','silk','mid','slow','#c5b2ca #e8d9e1 #b892ab #936788 #fff1ee',.14,'',.22],
      ['crystal-glass','半透明晶片','glass','light','slow','#d5e1eb #e9eef2 #b5bfdf #94a4c0 #eefbff',.17],
      ['amber-slits','窄缝灯影','slits','dark','music','#37303c #5e4350 #986c62 #282735 #fbd49b',.17],
      ['polished-foil','拉丝金属','metal','mid','music','#b1bfbd #e2e7dc #889e9b #5e757b #f7f8df',.10,'',.36],
      ['liquid-caustic','玻璃水光','liquid','mid','slow','#b3ccc7 #dedbd1 #9cb5c2 #729ba3 #f9efc8',.16,'',.23],
      ['parallel-rays','平行追光','rails','dark','music','#232847 #40466c #7165a0 #1e263f #f4c3ed',.18],
      ['frosted-edge','磨砂暗帘','frost','dark','slow','#394656 #728690 #526877 #2c3546 #d4e5dc',.10,'',.21],
      ['folded-haze','雾面层光','folds','light','slow','#dcd2c2 #f1e7d7 #c8b7a4 #9d8d7f #fff4db',.11],
      ['reed-glass','条纹玻璃','reedGlass','mid','slow','#c8d3cc #a9c2c3 #8eaba8 #65837a #ffedc6',.12],
    ],
    geometry:[
      ['neon-grid','赛博夜航','neon','dark','music','#222c45 #393552 #5a6197 #263750 #94cdde',.20],
      ['prism-tunnel','棱镜隧道','prism','dark','slow','#32324d #5c526c #7d739f #222842 #d4e2fa',.14,'',.13],
      ['lantern-windows','夜廊灯窗','lanterns','dark','music','#493b4d #685064 #8d5c69 #312938 #fcd5a2',.11],
      ['long-gallery','长廊光窗','gallery','mid','slow','#ccbda9 #e7cab0 #bfaa96 #80685e #fff0cc',.09,'',.36],
      ['hex-vault','六角穹道','vault','dark','slow','#314146 #4d5d62 #72888b #26393d #c6eadc',.10,'',.14],
      ['graph-lattice','连线花窗','lattice','light','static','#e2ddd4 #f4ebdf #b5a79e #8e817d #fff6db',.05],
      ['vanishing-grid','透视网格','draft','dark','static','#2a4053 #425a6d #6a8da3 #263a52 #a4c6cf',0],
      ['marble-steps','悬浮阶梯','steps','light','static','#dcded8 #edece2 #aebeb6 #637c79 #f8f1db',.06,'',.17],
      ['square-room','方形天井','atrium','light','slow','#e3dccc #f7eadb #c7aa92 #9e826f #fff4d5',.08],
      ['rotated-bays','斜列舷窗','bays','dark','slow','#363b52 #666880 #758ca4 #282f47 #f7deb8',.12],
    ],
    quiet:[
      ['warm-white','暖白留白','calm','light','static','#f4efe6 #fffbf4 #eae2d5 #e1d7c8 #fffdf8'],
      ['mist-blue','雾蓝留白','split','light','static','#dee9ef #edf6f5 #d2e1ea #c6d8e5 #f9fcf4'],
      ['light-gray','浅灰素面','linen','light','static','#e2e3e4 #eeeeec #d5d7da #c3c7cb #fbfaf5'],
      ['pale-duotone','柔和双色','calm','light','static','#ede4e9 #f7e3d7 #d3e1ea #cfbeca #fff4e8',0,'diagonal'],
      ['diffused-morning','晨光漫射','diffusion','light','slow','#e5e9d8 #f3eed8 #cbdcc9 #bfceb8 #fffbe4',.04],
      ['silhouette-dawn','天色将明','stillHorizon','mid','static','#cad4dd #ddccca #b8c2cd #8eabb8 #f3e4cf'],
      ['deep-violet','夜幕淡痕','quietNight','dark','static','#302c41 #484056 #3b3853 #24243c #6a5973'],
      ['candle-rays','静室斜光','quietRoom','dark','slow','#44392f #5d4e3c #77674d #342d2d #e5c892',.05],
      ['line-of-calm','静线留白','quietLine','light','static','#e7e7d9 #f0efdf #dae0cf #a7b6a0 #f9f6e4'],
    ],
  };
  const featured=Object.freeze(['warm-white','white-coast','blue-rain','rice-paper','reed-glass','long-gallery','ion-nebula']);
  const aliases=Object.freeze({
    'double-orbit':'orbit-particles','andromeda':'ion-nebula','binary-sunset':'outer-eclipse',
    'sparse-dust':'meteor-garden','outer-cartography':'orbit-particles',
    'violet-aurora':'silk-fog','rising-mist':'silk-fog','halftone-moon':'halftone-blocks',
    'signal-wave':'silk-threads','prism-bloom':'default','peripheral-lens':'reed-glass',
    'plasma-filaments':'folded-haze','blueprint':'vanishing-grid','crystal-lattice':'graph-lattice',
    'tide-dial':'tidal-circles','breath-halo':'diffused-morning','two-soft-circles':'pale-duotone',
    'distant-static':'deep-violet',
  });
  const photos=Object.freeze({
    'jiangnan-rain':{key:'jiangnanRain',landscape:[.62,.53],portrait:[.85,.54]},
    'white-coast':{key:'whiteCoast',landscape:[.52,.42],portrait:[.51,.50]},
    'blue-rain':{key:'blueRain',landscape:[.50,.36],portrait:[.55,.50]},
  });
  const defaults=[
    {id:'default',name:'自动画面',description:'随播放布局与歌词样式选择画面',motion:'music'},
    {id:'geometry',name:'几何微光',tone:'dark',motion:'music',
      preset:{design:'orbit',colors:['#141a2b','#242743','#646da3','#292f55','#b4bfe9'],cover:.18}},
    {id:'mist',name:'流动光雾',tone:'dark',motion:'music',
      preset:{design:'nebula',colors:['#161728','#252644','#494470','#302744','#beb3dc'],cover:.12}},
    {id:'clean',name:'纯净底色',description:'仅保留深色底面',tone:'dark',motion:'static'},
  ].map(Object.freeze);
  const catalogue=Object.freeze(Object.entries(designs).flatMap(([group,recipes])=>recipes.map(
    ([id,name,design,tone,motion,colors,cover=0,style='',veil=0])=>Object.freeze({
      id,name,group,tone,motion,thumbnail:'canvas',photo:photos[id],
      preset:Object.freeze({design,colors:Object.freeze(colors.split(' ')),cover,style,veil}),
    }),
  )));
  const entries=new Map([...defaults,...catalogue].map(entry=>[entry.id,entry]));
  const normalize=id=>entries.has(id)?id:Object.hasOwn(aliases,id)?aliases[id]:'default';
  const lightReadingSurface=entry=>entry?.group==='quiet'&&entry.tone==='light';
  function lyricBackdrop(entry,effect) {
    if(!effect||!entry||entry.id==='default')return 'theme';
    if(effect.id!=='still'&&(entry.photo||entry.tone==='light'||entry.tone==='mid'))return 'soft';
    return 'overlay';
  }
  let painters;
  const images=new Map();
  function loadPhoto(entry) {
    const url=root.document?.getElementById('playbackBackgroundPhotos')?.dataset[entry.photo.key];
    if(!url)return Promise.reject(Error('Missing playback background photo'));
    if(!images.has(url)){
      const image=new root.Image();
      image.alt='';image.draggable=false;image.decoding='async';
      image.src=url;
      let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Playback background photo timed out')),4500);});
      const ready=Promise.race([image.decode(),timeout]).then(()=>{
        if(!image.naturalWidth)throw Error('Empty playback background photo');
        return image;
      }).catch(error=>{images.delete(url);throw error;}).finally(()=>clearTimeout(timer));
      images.set(url,ready);
    }
    return images.get(url);
  }
  function load(entry) {
    if(!entry.preset)return Promise.resolve(null);
    const url=root.document?.getElementById('playbackBackgroundPainters')?.dataset.href;
    if(!url)return Promise.reject(Error('Missing playback background painters'));
    painters??=import(url).then(bundle=>bundle.paint).catch(error=>{painters=null;throw error;});
    return Promise.all([painters,entry.photo?loadPhoto(entry):null]).then(([paint,image])=>({paint,image}));
  }
  function photoPosition(entry,width,height) {
    return width/height<.8?entry.photo.portrait:entry.photo.landscape;
  }
  function photoRect(entry,image,width,height) {
    const zoom=Math.max(width/image.naturalWidth,height/image.naturalHeight);
    const w=image.naturalWidth*zoom,h=image.naturalHeight*zoom;
    const [x,y]=photoPosition(entry,width,height);
    return {x:(width-w)*x,y:(height-h)*y,width:w,height:h};
  }
  function draw(context,entry,frame,loaded) {
    if(entry.id==='clean'){
      context.fillStyle='#101019';context.fillRect(0,0,frame.width,frame.height);
      return true;
    }
    if(!loaded)return false;
    const {image,paint}=loaded;
    if(image){
      const rect=photoRect(entry,image,frame.width,frame.height);
      if(frame.thumbnail||frame.preview)context.drawImage(image,rect.x,rect.y,rect.width,rect.height);
      else context.clearRect(0,0,frame.width,frame.height);
      frame={...frame,photoRect:rect,photoImage:image};
    }
    paint(context,entry.preset,frame);
    return true;
  }

  const thumbnailArtwork={base:[17,19,34],primary:[150,169,241],secondary:[208,132,195]};
  const motionLabels={static:'静态',slow:'慢动',music:'随音乐'};
  function createPicker(dialog,select) {
    const options=dialog.querySelector('[data-player-bg-group]');
    const grid=dialog.querySelector('[data-player-bg-grid]');
    const status=dialog.querySelector('[data-player-bg-status]');
    let selected='default', group='featured', observer, revision=0, gallerySize='';
    const thumbnails=new Map();
    options.add(new Option('推荐 · 七类样张','featured'));
    for(const {id,label} of groups)options.add(new Option(label,id));

    const applySelection=(id,message)=>{
      selected=id;
      status.textContent=message||entries.get(id).name;
      for(const button of dialog.querySelectorAll('[data-player-bg-select]')){
        button.setAttribute('aria-pressed',String(button.dataset.playerBgSelect===id));
      }
    };
    async function thumbnail(card,entry,version) {
      try{
        const preview=card.querySelector('[data-player-bg-preview]');
        const bounds=preview.getBoundingClientRect();
        const scale=Math.min(3,root.devicePixelRatio||1);
        const width=Math.round(bounds.width*scale),height=Math.round(bounds.height*scale);
        if(!width||!height)return;
        const key=entry.id+'/'+width+'x'+height;
        let url=thumbnails.get(key);
        if(!url){
          const loaded=await load(entry);
          if(version!==revision||!dialog.open||!card.isConnected)return;
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
          const context=canvas.getContext('2d',{alpha:false});
          const frame={width:bounds.width,height:bounds.height,time:0,energy:0,quality:.48,brightness:.55,
            artwork:thumbnailArtwork,thumbnail:true,seed:root.SonicReactiveScenes?.seedFor(entry.id)||1};
          if(!context)return;
          context.scale(width/bounds.width,height/bounds.height);
          if(!draw(context,entry,frame,loaded))return;
          url=canvas.toDataURL('image/webp',.88);
          if(thumbnails.size>=84)thumbnails.delete(thumbnails.keys().next().value);
          thumbnails.set(key,url);
        }
        if(version!==revision||!dialog.open||!card.isConnected)return;
        const image=document.createElement('img');
        image.alt='';image.width=width;image.height=height;image.decoding='async';image.src=url;
        preview.replaceChildren(image);
      }catch{
        if(version===revision&&card.isConnected)card.querySelector('[data-player-bg-preview]').textContent='暂无预览';
      }
    }
    function renderGroup() {
      const version=++revision;
      observer?.disconnect();
      const shown=group==='featured'?featured.map(id=>entries.get(id)):catalogue.filter(entry=>entry.group===group);
      const cards=shown.map(entry=>{
        const button=document.createElement('button');
        button.type='button';button.className='lr-scene-card lr-player-bg-card';
        button.dataset.playerBgSelect=entry.id;
        const preview=document.createElement('span');preview.dataset.playerBgPreview='';
        const details=document.createElement('span');details.className='lr-player-bg-details';
        const name=document.createElement('strong');name.textContent=entry.name;
        const motion=document.createElement('small');motion.textContent=motionLabels[entry.motion];
        details.append(name,motion);
        button.append(preview,details);
        return [button,entry];
      });
      grid.replaceChildren(...cards.map(([button])=>button));
      if(typeof IntersectionObserver==='function'){
        const cardEntries=new Map(cards);
        observer=new IntersectionObserver((observations,source)=>{
          for(const {target,isIntersecting} of observations){
            if(!isIntersecting)continue;
            source.unobserve(target);void thumbnail(target,cardEntries.get(target),version);
          }
        },{root:grid,rootMargin:'120px'});
        for(const [button] of cards)observer.observe(button);
      }else for(const [button,entry] of cards)void thumbnail(button,entry,version);
      applySelection(selected,status.textContent);
    }
    const measureGallery=()=>{
      const size=grid.clientWidth+'/'+(root.devicePixelRatio||1);
      if(!dialog.open)return;
      if(size!==gallerySize){gallerySize=size;renderGroup();}
    };
    const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(measureGallery):null;
    root.addEventListener('resize',measureGallery);
    options.addEventListener('change',()=>{group=options.value;grid.scrollTop=0;renderGroup();});
    dialog.addEventListener('click',event=>{
      const button=event.target.closest('[data-player-bg-select]');
      if(button)select(normalize(button.dataset.playerBgSelect));
    });
    dialog.addEventListener('close',()=>{
      if(dialog.open)return;
      ++revision;
      observer?.disconnect();observer=null;resizeObserver?.disconnect();grid.replaceChildren();
      thumbnails.clear();
    });
    return {
      open(id){
        selected=normalize(id);
        const entry=entries.get(selected);
        group=entry.group&&!featured.includes(selected)?entry.group:'featured';
        options.value=group;grid.scrollTop=0;
        if(!dialog.open)dialog.showModal();
        gallerySize=grid.clientWidth+'/'+(root.devicePixelRatio||1);
        resizeObserver?.observe(grid);
        status.textContent=entries.get(selected).name;
        renderGroup();
      },
      update(id,message){
        const entry=entries.get(id);
        if(entry.group&&group==='featured'&&!featured.includes(id)){
          group=entry.group;options.value=group;grid.scrollTop=0;selected=id;renderGroup();
        }
        applySelection(id,message);
      },
      close(){if(dialog.open)dialog.close();},
    };
  }
  return Object.freeze({groups,catalogue,featured,aliases,defaults,get:id=>entries.get(id),normalize,load,loadPhoto,draw,photoPosition,photoRect,lyricBackdrop,lightReadingSurface,createPicker});
});
