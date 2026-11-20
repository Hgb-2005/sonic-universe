(function () {
  'use strict';
  const tabs = {daily:'每日推荐',charts:'热门榜单',mv:'MV',resolve:'解析链接'};
  const bilibiliVideoId = /^BV[A-Za-z0-9]{10}$/;
  const youtubeVideoId = /^[A-Za-z0-9_-]{11}$/;
  let dialog,client,player,tab,controller,chartMatch,objectUrl,musicBeforeVideo,videoSequence=0;

  function officialUrl(value,hosts) {
    try {
      const url=new URL(value);
      return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&hosts.includes(url.hostname)?url:null;
    } catch {return null}
  }
  function parseLink(value) {
    const text=String(value).trim();
    const id=window.SonicOnlineMusic?.qishuiSongId(text);
    if(id)return {song:id};
    if(window.SonicOnlineMusic?.isQishuiShareLink?.(text))return {song:text};
    const url=officialUrl(text,['music.163.com','y.qq.com','music.apple.com','itunes.apple.com','geo.itunes.apple.com']);
    return url?{url}:null;
  }
  function youtubeId(value) {
    const url=officialUrl(value,['youtube.com','www.youtube.com','m.youtube.com','youtu.be']);
    if(!url)return null;
    const id=url.hostname==='youtu.be'?url.pathname.match(/^\/([^/]+)\/?$/)?.[1]:url.pathname==='/watch'?
      url.searchParams.get('v'):url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
    return youtubeVideoId.test(id||'')?id:null;
  }
  function bilibiliLink(value) {
    const url=officialUrl(value,['www.bilibili.com','m.bilibili.com','bilibili.com']);
    if(!url)return null;
    const id=url.pathname.match(/^\/video\/([^/]+)\/?$/)?.[1];
    if(!bilibiliVideoId.test(id||''))return null;
    const page=Number(url.searchParams.get('p'));
    return { id, page:Number.isSafeInteger(page)&&page>1&&page<=1000?page:1 };
  }
  function button(label,action) {
    const node=document.createElement('button');node.type='button';node.className='lr-choice';node.textContent=label;
    node.addEventListener('click',action);return node;
  }
  function get(selector){return dialog.querySelector(selector)}
  function status(message,error=false) {
    const node=get('[data-discovery-status]');node.textContent=message;node.dataset.error=String(error);
  }
  function chooseTab(value) {
    chartMatch?.abort();chartMatch=null;
    tab=value;
    for(const item of dialog.querySelectorAll('[data-discovery-tab]'))item.setAttribute('aria-pressed',String(item.dataset.discoveryTab===value));
    get('[data-discovery-form]').hidden=!['mv','resolve'].includes(value);
    get('[data-discovery-video-tools]').hidden=value!=='mv';
    const input=get('[data-discovery-query]');input.value='';input.type=value==='resolve'?'text':'search';
    input.placeholder=value==='mv'?'输入歌名或歌手':'粘贴歌曲链接或输入汽水歌曲 ID';
    input.setAttribute('aria-label',input.placeholder);
    get('[data-discovery-submit]').textContent=value==='mv'?'查找 MV':'解析';
    if(value==='daily'||value==='charts')void load(value);
    else{
      controller?.abort();controller=null;get('[data-discovery-items]').replaceChildren();
      status(value==='resolve'?'支持汽水歌曲详情与官方音乐链接。':'输入歌名或歌手，搜索可在这里播放的 MV。');
    }
  }
  async function playChartTrack(item,control,label) {
    chartMatch?.abort();
    const request=new AbortController();chartMatch=request;
    control.disabled=true;label.textContent='匹配中…';
    status('正在汽水音乐中匹配「'+item.name+'」…');
    try {
      const result=await client.matchChartTrack(item,{signal:request.signal});
      if(chartMatch!==request||request.signal.aborted)return;
      if(!result?.item){status('汽水音乐暂无可确认的同名同歌手版本。',true);return}
      const started=await player.playOnlineList([result.item],'热门榜单 · 汽水音乐',result.item.mediaId);
      if(chartMatch!==request||request.signal.aborted)return;
      status(started?'正在播放「'+result.item.name+'」 · 汽水音乐':'已匹配曲目，汽水音乐当前无法播放该版本。',!started);
    } catch(error) {
      if(chartMatch===request&&!request.signal.aborted)status(error?.status===401?'请先在在线搜索中登录汽水音乐。':error.message||'匹配失败，请重试。',true);
    } finally {
      control.disabled=false;label.textContent='播放';
      if(chartMatch===request)chartMatch=null;
    }
  }
  function showItems(items,kind,title) {
    const root=get('[data-discovery-items]');root.replaceChildren();
    if(!items.length){status('暂时没有相关内容。');return}
    status(title||'已找到 '+items.length+' 条结果。');
    if(kind==='daily'){
      const playAll=button('播放推荐',()=>void player.playOnlineList(items,'每日推荐'));
      playAll.className='lr-primary';root.append(playAll);
    }
    const list=document.createElement('ol');list.className='sd-items';
    for(const item of items){
      const row=document.createElement('li'),info=document.createElement('span'),name=document.createElement('strong'),artist=document.createElement('small');
      name.textContent=item.name||'未命名歌曲';artist.textContent=[item.artist,item.album].filter(Boolean).join(' · ');
      info.className='sd-row-info';info.append(name,artist);row.append(info);
      function makePlayable(label,kind,play) {
        const action=document.createElement('span');action.className='sd-row-action';action.textContent=label;
        const control=button('',()=>play(control,action));
        control.className='sd-play-row';control.setAttribute('data-discovery-play-'+kind,'');
        control.append(info,action);row.append(control);
      }
      if(item.provider==='qishui')row.append(button(kind==='resolve'?'播放这首':'从这里播放',()=>void player.playOnlineList(items,title||'汽水音乐',item.mediaId)));
      else if(kind==='charts'){
        makePlayable('播放','chart',(control,label)=>void playChartTrack(item,control,label));
      }else if(kind==='mv'&&item.provider==='commons'){
        const video=officialUrl(item.videoUrl,['upload.wikimedia.org']);
        if(video&&video.pathname.startsWith('/wikipedia/commons/')){
          if(item.licenseName)artist.textContent=[item.artist,item.licenseName].filter(Boolean).join(' · ');
          makePlayable('在这里播放','mv',()=>void playVideo(video.href,null,item));
        }
      }else if(kind==='mv'&&item.provider==='bilibili'&&bilibiliVideoId.test(item.mediaId||'')){
        const duration=Number.isFinite(item.duration)&&item.duration>0?window.SonicListeningCore.formatTime(item.duration):'';
        artist.textContent=[item.artist&&'UP 主 '+item.artist,duration,'哔哩哔哩'].filter(Boolean).join(' · ');
        makePlayable('在这里播放','mv',()=>void playBilibili(item.mediaId,item.name));
      }else if(kind==='mv'&&item.provider==='youtube'&&youtubeVideoId.test(item.mediaId||'')){
        makePlayable('在这里播放','mv',()=>void playYouTube(item.mediaId,item.name));
      }
      else{
        const url=officialUrl(item.externalUrl,['music.apple.com','itunes.apple.com','geo.itunes.apple.com']);
        if(url)row.append(button(kind==='mv'?'打开官方 MV':'打开官方歌曲',()=>window.open(url.href,'_blank','noopener,noreferrer')));
      }
      list.append(row);
    }
    root.append(list);
  }
  async function load(kind,query='') {
    controller?.abort();const request=new AbortController();controller=request;
    get('[data-discovery-items]').replaceChildren();
    status('正在读取…');
    try{
      let result,title;
      const options={signal:request.signal};
      if(kind==='daily'){result=await client.discovery(options);title='汽水每日推荐'}
      else if(kind==='charts'){result=await client.charts(options);title=(result?.title||'Apple Music 热门榜单')+' · 使用汽水音乐播放匹配版本'}
      else if(kind==='mv'){
        const source=get('[data-discovery-mv-source]').value;
        result=source==='apple'?await client.musicVideos(query,options):await client.playableVideos(query,{...options,source});
      }
      else{
        const parsed=parseLink(query);
        if(!parsed){status('请输入汽水歌曲 ID 或支持的官方歌曲链接。',true);return}
        if(parsed.url){
          status('已识别官方音乐链接。');
          get('[data-discovery-items]').append(button('打开原曲',()=>window.open(parsed.url.href,'_blank','noopener,noreferrer')));
          return;
        }
        const song=await client.song(parsed.song,options);result={items:song?.item?[song.item]:[]};
      }
      if(controller!==request||request.signal.aborted)return;
      showItems(Array.isArray(result?.items)?result.items:[],kind,title);
    }catch(error){
      if(controller!==request||request.signal.aborted)return;
      status(error?.status===401?'请先在在线搜索中登录汽水音乐。':error?.message||'音乐入口暂时不可用，请稍后重试。',true);
    }
  }
  function stopVideo(resume) {
    videoSequence++;
    const video=get('video');video.pause();video.removeAttribute('src');video.load();video.hidden=true;
    const embed=get('[data-discovery-embed]');embed.replaceChildren();embed.hidden=true;
    get('[data-discovery-video-bar]').hidden=true;get('[data-discovery-video-credit]').replaceChildren();
    if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
    const previous=musicBeforeVideo;musicBeforeVideo=null;
    const now=player.snapshot();
    if(resume&&previous&&previous===now.track?.id&&!now.playing&&!now.external&&!now.busy)void player.toggle();
  }
  async function beginVideo() {
    const resumeTrack=musicBeforeVideo;
    stopVideo(false);
    const sequence=videoSequence;
    const before=player.snapshot();
    musicBeforeVideo=before.playing&&!before.external?before.track?.id:resumeTrack;
    if(before.playing&&!before.external)await player.toggle();
    if(sequence!==videoSequence||!dialog.open||tab!=='mv')return null;
    get('[data-discovery-video-bar]').hidden=false;
    return sequence;
  }
  function showCredit(item) {
    const credit=get('[data-discovery-video-credit]');
    credit.textContent=[item.name,item.artist,item.licenseName].filter(Boolean).join(' · ');
    const source=officialUrl(item.externalUrl,['commons.wikimedia.org']);
    const license=officialUrl(item.licenseUrl,['creativecommons.org']);
    for(const [label,url] of [['来源',source],['许可',license]]){
      if(!url)continue;
      const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=label;credit.append(' ',link);
    }
  }
  async function playVideo(source,file=null,item=null) {
    const sequence=await beginVideo();
    if(sequence===null)return;
    const video=get('video');
    if(item)showCredit(item);
    else get('[data-discovery-video-credit]').textContent=file?.name||'视频播放';
    if(file)objectUrl=URL.createObjectURL(file);
    video.src=objectUrl||source;video.hidden=false;
    video.scrollIntoView({block:'nearest'});
    try{await video.play();if(sequence===videoSequence)status('正在播放 MV。')}
    catch{if(sequence===videoSequence&&!video.error)status('无法自动播放，请点击视频播放按钮。',true)}
  }
  async function playEmbedded(url,title,source) {
    const sequence=await beginVideo();
    if(sequence===null)return;
    const frame=document.createElement('iframe'),embed=get('[data-discovery-embed]');
    frame.title=title||source+' MV';
    frame.referrerPolicy='strict-origin-when-cross-origin';
    frame.setAttribute('allow','autoplay; encrypted-media; picture-in-picture; fullscreen');
    frame.setAttribute('allowfullscreen','');
    frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation allow-popups');
    frame.src=url;
    get('[data-discovery-video-credit]').textContent=(title?title+' · ':'')+source;
    embed.replaceChildren(frame);embed.hidden=false;embed.scrollIntoView({block:'nearest'});
    status('已打开'+source+'播放器。');
  }
  function playYouTube(id,title) {
    if(youtubeVideoId.test(id))return playEmbedded('https://www.youtube.com/embed/'+id+'?autoplay=1&playsinline=1',title,'YouTube');
  }
  function playBilibili(id,title,page=1) {
    if(!bilibiliVideoId.test(id))return;
    const url='https://player.bilibili.com/player.html?bvid='+id+'&autoplay=1&danmaku=0'+(page>1?'&p='+page:'');
    return playEmbedded(url,title,'哔哩哔哩');
  }
  function create(root) {
    dialog=document.createElement('dialog');dialog.className='lr-dialog sd-dialog';dialog.setAttribute('aria-labelledby','sonicDiscoveryTitle');
    dialog.innerHTML=`<div class="lr-dialog-heading"><h2 id="sonicDiscoveryTitle">音乐发现</h2><button type="button" class="lr-icon" data-discovery-close aria-label="关闭音乐发现">×</button></div>
      <div class="lr-choice-row" role="group" aria-label="发现分类"></div>
      <form class="sd-form" data-discovery-form hidden><input class="lr-search-input" data-discovery-query maxlength="2048" required><button class="lr-primary" data-discovery-submit type="submit"></button></form>
      <div class="sd-video-tools" data-discovery-video-tools hidden>
        <label class="sd-mv-source">MV 来源 <select class="lr-search-input" data-discovery-mv-source><option value="bilibili">哔哩哔哩</option><option value="commons">维基共享资源</option><option value="youtube">YouTube 可嵌入视频</option><option value="apple">Apple Music 官方索引</option></select></label>
        <label class="lr-choice sd-file">打开本地 MV<input type="file" accept="video/*,.mp4,.webm" aria-label="选择本地 MV"></label>
        <form class="sd-form" data-discovery-video-form><input class="lr-search-input" type="url" required maxlength="2048" placeholder="哔哩哔哩、YouTube 或视频直链" aria-label="可播放的视频地址"><button class="lr-choice" type="submit">播放链接</button></form>
      </div>
      <div class="sd-video-bar" data-discovery-video-bar hidden><span data-discovery-video-credit></span><button type="button" class="lr-choice" data-discovery-video-close>关闭视频</button></div>
      <video class="sd-video" controls playsinline preload="metadata" hidden></video>
      <div class="sd-embed" data-discovery-embed hidden></div>
      <p class="lr-status" data-discovery-status role="status" aria-live="polite"></p><div data-discovery-items></div>`;
    for(const [key,label] of Object.entries(tabs)){
      const choice=button(label,()=>{if(tab==='mv'&&key!=='mv')stopVideo(true);chooseTab(key)});
      choice.dataset.discoveryTab=key;get('.lr-choice-row').append(choice);
    }
    get('[data-discovery-close]').addEventListener('click',()=>dialog.close());
    get('[data-discovery-video-close]').addEventListener('click',()=>{stopVideo(true);status('已关闭视频。')});
    get('[data-discovery-mv-source]').addEventListener('change',()=>{
      controller?.abort();controller=null;get('[data-discovery-items]').replaceChildren();
      const query=get('[data-discovery-query]').value.trim();
      if(query)void load('mv',query.slice(0,100));
    });
    get('[data-discovery-form]').addEventListener('submit',event=>{
      event.preventDefault();const query=get('[data-discovery-query]').value.trim();
      if(query)void load(tab,tab==='mv'?query.slice(0,100):query);
    });
    get('[data-discovery-video-form]').addEventListener('submit',event=>{
      event.preventDefault();
      const value=event.currentTarget.querySelector('input').value;
      const bilibili=bilibiliLink(value);
      if(bilibili){void playBilibili(bilibili.id,null,bilibili.page);return}
      const id=youtubeId(value);
      if(id){void playYouTube(id);return}
      let url;
      try{url=new URL(value)}catch{}
      if(!url||url.protocol!=='https:'||url.username||url.password){status('请输入可直接播放的 HTTPS 视频链接。',true);return}
      void playVideo(url.href);
    });
    get('input[type=file]').addEventListener('change',event=>{
      const [file]=event.currentTarget.files;event.currentTarget.value='';if(file)void playVideo('',file);
    });
    get('video').addEventListener('ended',()=>stopVideo(true));
    get('video').addEventListener('error',()=>{
      if(!dialog.open||!get('video').getAttribute('src'))return;
      stopVideo(true);status('视频无法播放，请检查格式和访问权限。',true);
    });
    dialog.addEventListener('close',()=>{controller?.abort();controller=null;chartMatch?.abort();chartMatch=null;stopVideo(true)});
    root.append(dialog);
  }
  function open(root,companion,playback) {
    client=companion;player=playback;
    if(!dialog)create(root);
    if(!dialog.open)dialog.showModal();
    chooseTab('daily');
  }
  window.SonicMusicDiscovery=Object.freeze({open});
})();
