(function () {
  'use strict';
  const tabs = {daily:'每日推荐',charts:'热门榜单',mv:'MV',resolve:'解析链接'};
  const bilibiliVideoId = /^BV[A-Za-z0-9]{10}$/;
  const youtubeVideoId = /^[A-Za-z0-9_-]{11}$/;
  let dialog,client,player,tab,controller,chartMatch,objectUrl,musicBeforeVideo,videoSequence=0;
  const feedCache=new Map(),feedRequests=new Map();
  const isFeed=kind=>kind==='daily'||kind==='charts';
  const freshFor={daily:5*60000,charts:10*60000};
  const keepFor={daily:30*60000,charts:2*60*60000};
  function invalidateDaily(){
    feedCache.delete('daily');feedRequests.get('daily')?.abort.abort();feedRequests.delete('daily');
    if(dialog?.open&&tab==='daily'){
      controller?.abort();controller=null;get('[data-discovery-items]').replaceChildren();get('[data-discovery-retry]').hidden=true;
      status('请在在线搜索中确认汽水音乐登录状态。',true);
    }
  }
  function cachedFeed(kind){
    const value=feedCache.get(kind);
    return value&&Date.now()-value.at<keepFor[kind]?value:null;
  }
  function fetchFeed(kind,companion){
    const previous=feedRequests.get(kind);
    if(previous?.client===companion)return previous.promise;
    previous?.abort.abort();
    const abort=new AbortController(), request={abort,client:companion};
    request.promise=(async()=>{
      const result=await (kind==='daily'?companion.discovery({signal:abort.signal}):companion.charts({signal:abort.signal}));
      abort.signal.throwIfAborted();
      const value={result,at:Date.now()};feedCache.set(kind,value);return value;
    })().finally(()=>{if(feedRequests.get(kind)===request)feedRequests.delete(kind);});
    feedRequests.set(kind,request);return request.promise;
  }
  function warmDaily(companion){
    if(companion&&!(Date.now()-(cachedFeed('daily')?.at||0)<freshFor.daily))void fetchFeed('daily',companion).catch(()=>{});
  }
  function feedTitle(kind,result){return kind==='daily'?'汽水每日推荐':(result?.title||'Apple Music 热门榜单')+' · 使用汽水音乐播放匹配版本';}

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
  function abortChartMatch() {
    chartMatch?.abort();chartMatch=null;
  }
  function chooseTab(value) {
    abortChartMatch();
    tab=value;
    get('[data-discovery-retry]').hidden=true;
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
  async function playChartTrack(item,control,label,showResult) {
    abortChartMatch();
    const request=new AbortController();chartMatch=request;
    const idleLabel=label.textContent;
    const matching=item.provider!=='qishui';
    control.disabled=true;control.setAttribute('aria-busy','true');
    label.textContent=matching?'匹配中…':'正在打开…';
    status(matching?'正在汽水音乐中匹配「'+item.name+'」…':'正在打开所选汽水版本「'+item.name+'」…');
    let result;
    try {
      result=await player.playRecording(item,{signal:request.signal,label:'热门榜单 · 汽水音乐'});
    } catch(error) {
      const state=error?.status===401||error?.code==='auth-required'?'auth-required':error?.name==='AbortError'?'cancelled':'failed';
      result={status:state};
    } finally {
      control.disabled=false;control.removeAttribute('aria-busy');label.textContent=idleLabel;
      if(chartMatch===request){
        chartMatch=null;
        if(!request.signal.aborted&&dialog.open&&tab==='charts'&&control.isConnected)showResult(result,item);
      }
    }
  }
  function playableRow(info,label,kind,play) {
    const action=document.createElement('span');action.className='sd-row-action';action.textContent=label;
    const control=button('',()=>play(control,action));
    control.className='sd-play-row';control.setAttribute('data-discovery-play-'+kind,'');
    control.append(info,action);
    return control;
  }
  function chartPlayback(row,item,info) {
    const content=document.createElement('div');content.className='sd-row-info';content.style.flex='1';
    const message=document.createElement('p');message.className='lr-status';message.style.marginTop='0';message.hidden=true;
    const choices=document.createElement('details'),summary=document.createElement('summary'),versions=document.createElement('div');
    choices.dataset.discoveryChartCandidates='';choices.hidden=true;
    summary.className='lr-choice';choices.append(summary,versions);
    const online=button('打开汽水音乐搜索',()=>{dialog.close();player.openOnline();});online.hidden=true;
    const main=playableRow(info,'播放','chart',(control,label)=>void playChartTrack(item,control,label,showResult));
    content.append(main,message,choices,online);row.append(content);

    const url=officialUrl(item.externalUrl,['music.apple.com','itunes.apple.com','geo.itunes.apple.com']);
    if(url){
      const original=document.createElement('a');original.className='lr-choice';
      original.href=url.href;original.target='_blank';original.rel='noopener noreferrer';
      original.textContent='打开官方歌曲';original.setAttribute('aria-label','在 Apple Music 打开「'+item.name+'」');
      original.style.cssText='flex:0 0 auto;align-self:flex-start;text-decoration:none';
      row.append(original);
    }

    function showResult(result,target) {
      const state=result?.status||'failed', title=result?.track?.name||target.name;
      const error=!['full','preview','cancelled'].includes(state);
      const actions={
        unmatched:'汽水音乐暂无可确认的同一录音版本。',
        'auth-required':'请登录汽水音乐后重试。',
        unavailable:'本机音乐入口暂不可用，请重新连接后重试。',
        failed:'这个汽水版本暂时无法播放，可以重试或选择其他版本。',
      };
      const text=state==='full'?'已开始播放完整歌曲「'+title+'」。':
        state==='preview'?'已开始试听「'+title+'」，当前版本仅提供试听片段。':
        state==='cancelled'?'已取消这次播放。':result?.message||actions[state]||actions.failed;
      message.textContent=text;message.dataset.error=String(error);message.hidden=false;
      status(text,error);

      const tracks=new Map();
      for(const input of Array.isArray(result?.candidates)?result.candidates:[]){
        const track=window.SonicOnlineMusic.normalizeTrack(input);
        if(track&&!tracks.has(track.mediaId))tracks.set(track.mediaId,track);
      }
      if(tracks.size){
        const available=[...tracks.values()].slice(0,15);
        summary.textContent='选择汽水版本（'+available.length+'）';
        versions.replaceChildren(...available.map(track=>{
          const info=document.createElement('span'),name=document.createElement('strong'),meta=document.createElement('small');
          info.className='sd-row-info';name.textContent=track.name;
          const duration=track.duration>0?window.SonicListeningCore.formatTime(track.duration):'时长未知';
          meta.textContent=[track.artist||'歌手未知',track.album||'专辑未知',duration].join(' · ');
          meta.style.whiteSpace='normal';
          info.append(name,meta);
          return playableRow(info,'播放','chart-candidate',(control,label)=>void playChartTrack(track,control,label,showResult));
        }));
      }
      const focusInChoices=choices.contains(document.activeElement);
      choices.hidden=!versions.childElementCount||state==='auth-required'||state==='full';
      if(!choices.hidden&&(state==='unmatched'||state==='failed'))choices.open=true;
      if(choices.hidden&&focusInChoices)main.focus();
      const needsSearch=choices.hidden&&(state==='unmatched'||state==='failed');
      online.hidden=typeof player.openOnline!=='function'||!(state==='auth-required'||needsSearch);
      online.textContent=state==='auth-required'?'去汽水音乐登录':'打开汽水音乐搜索';
      const action=main.querySelector('.sd-row-action');
      if(!main.disabled)action.textContent=error?'重试':'播放';
    }
  }
  function showItems(items,kind,title) {
    abortChartMatch();
    const root=get('[data-discovery-items]');root.replaceChildren();
    if(!items.length){status('暂时没有相关内容。');return}
    status(title||'已找到 '+items.length+' 条结果。');
    if(kind==='daily'){
      const playAll=button('播放推荐',()=>void player.playOnlineList(items,'每日推荐'));
      playAll.className='lr-primary';root.append(playAll);
    }
    if(kind==='charts'){
      const playAll=button('播放整榜',async()=>{
        abortChartMatch();
        const request=new AbortController();chartMatch=request;
        playAll.disabled=true;
        status('已建立榜单队列，正在匹配第一首可播放的歌曲…');
        try{
          const started=await player.playChartList(items,'热门榜单 · 汽水音乐');
          if(chartMatch===request&&playAll.isConnected)status(started?'已开始整榜连播。尚未匹配的歌曲会在轮到时查找。':'暂时无法开始榜单连播，请检查汽水登录或换一个榜单。',!started);
        }finally{
          playAll.disabled=false;
          if(chartMatch===request)chartMatch=null;
        }
      });
      playAll.className='lr-primary';root.append(playAll);
    }
    const list=document.createElement('ol');list.className='sd-items';
    for(const item of items){
      const row=document.createElement('li'),info=document.createElement('span'),name=document.createElement('strong'),artist=document.createElement('small');
      name.textContent=item.name||'未命名歌曲';artist.textContent=[item.artist,item.album].filter(Boolean).join(' · ');
      info.className='sd-row-info';info.append(name,artist);row.append(info);
      function makePlayable(label,kind,play) {
        row.append(playableRow(info,label,kind,play));
      }
      if(item.provider==='qishui')row.append(button(kind==='resolve'?'播放这首':'从这里播放',()=>void player.playOnlineList(items,title||'汽水音乐',item.mediaId)));
      else if(kind==='charts'){
        chartPlayback(row,item,info);
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
    const cached=isFeed(kind)?cachedFeed(kind):null;
    if(cached){
      showItems(Array.isArray(cached.result?.items)?cached.result.items:[],kind,feedTitle(kind,cached.result));
      if(Date.now()-cached.at<freshFor[kind])return;
      if(cached.result?.items?.length)status('已显示上次结果，正在更新…');
    }else{get('[data-discovery-items]').replaceChildren();status('正在读取…');}
    const refresh=get('[data-discovery-retry]');refresh.hidden=true;
    try{
      let result,title;
      const options={signal:request.signal};
      if(isFeed(kind)){result=(await fetchFeed(kind,client)).result;title=feedTitle(kind,result);}
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
      const auth=kind==='daily'&&(error?.status===401||error?.code==='auth-required');
      if(auth){
        feedCache.delete('daily');
        // 未登录时别只留一句提示：直接给一个能落地的入口。
        get('[data-discovery-items]').replaceChildren(button('去登录汽水音乐',()=>{
          dialog.close();
          window.SonicListeningRoom?.setMode?.('search');
          setTimeout(()=>{document.querySelector('[data-sl-search-source="qishui"]')?.click();},150);
        }));
      }
      const offline=error instanceof TypeError||error?.code==='offline';
      const chartTimeout=kind==='charts'&&error?.code==='upstream-timeout';
      const message=auth?'汽水登录已失效或尚未登录，请重新扫码。':
        offline?'本机音乐入口已断开，请重新连接并重试。':
        chartTimeout?'Apple Music 热门榜单加载超时，请重试榜单。':
        error?.message||'暂时无法读取，请重试。';
      status(message+(cached?.result?.items?.length&&!auth?' 仍可查看上次结果。':''),true);
      refresh.textContent=offline?'重新连接并重试':kind==='charts'?'重试榜单':'重试';
      refresh.hidden=auth||error?.code==='provider-unavailable';
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
      <p class="lr-status" data-discovery-status role="status" aria-live="polite"></p><button type="button" class="lr-choice" data-discovery-retry hidden>重试</button><div data-discovery-items></div>`;
    for(const [key,label] of Object.entries(tabs)){
      const choice=button(label,()=>{if(tab==='mv'&&key!=='mv')stopVideo(true);chooseTab(key)});
      choice.dataset.discoveryTab=key;get('.lr-choice-row').append(choice);
    }
    get('[data-discovery-close]').addEventListener('click',()=>dialog.close());
    get('[data-discovery-retry]').addEventListener('click',()=>void load(tab,get('[data-discovery-query]').value.trim()));
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
    dialog.addEventListener('close',()=>{controller?.abort();controller=null;abortChartMatch();stopVideo(true)});
    root.append(dialog);
  }
  function open(root,companion,playback) {
    if(client&&client!==companion){invalidateDaily();feedCache.delete('charts');}
    client=companion;player=playback;
    if(!dialog)create(root);
    if(!dialog.open)dialog.showModal();
    chooseTab('daily');
  }
  window.SonicMusicDiscovery=Object.freeze({open,warmDaily,invalidateDaily});
})();
