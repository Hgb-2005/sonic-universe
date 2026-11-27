
(() => {
  'use strict';
  try {
    if (!window.SonicMusicMotion || !window.SonicVisualPresets || !window.SonicVisualSystem) throw new Error('视觉系统脚本未能载入。');
  } catch (error) {
    window.reportVisualFatal?.('完整画面没有载入，已切换轻量星光。可以播放示例，或点「重试完整效果」。');
    console.error(error);
    return;
  }
  const $ = id => document.getElementById(id);
  let listeningPresentation = !new URLSearchParams(location.search).has('sharedViewer') && new URLSearchParams(location.search).get('interface') !== 'legacy';
  const featureScripts = new Map();
  function loadFeatureScript(file, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (featureScripts.has(file)) return featureScripts.get(file);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const metaName = {'project-pack.js':'sonic-project-pack-revision','local-file-tags.js':'sonic-file-tags-revision'}[file];
      const revision = metaName ? document.querySelector('meta[name="'+metaName+'"]')?.content || '34' : '33';
      script.src = './' + file + '?v=' + revision;
      script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error('功能脚本未能载入'));
      script.onerror = () => reject(new Error('功能脚本未能载入'));
      document.head.append(script);
    }).catch(error => { featureScripts.delete(file); throw error; });
    featureScripts.set(file, promise);
    return promise;
  }
  const app = $('app'), canvas = $('universe');let ctx = canvas && canvas.getContext('2d', { alpha:false });
  if (!ctx) { window.reportVisualFatal?.('当前浏览器暂时无法显示完整画面，已启用轻量星光。可播放示例或重试。'); return; }
  const NEBULA_ASSET_REVISION='27';
  // A sandboxed shared viewer has an opaque origin; ask its same-origin host for safe assets.
  const sharedAssetViewer=new URLSearchParams(location.search).has('sharedViewer')&&window.parent!==window;
  let sharedPortPromise=null;
  function getSharedPort(){
    if(sharedPortPromise)return sharedPortPromise;
    sharedPortPromise=new Promise((resolve,reject)=>{const channel=new MessageChannel();try{parent.postMessage({type:'sonic-share-connect'},location.origin,[channel.port2]);channel.port1.start();resolve(channel.port1)}catch(error){channel.port1.close();channel.port2.close();reject(error)}});
    return sharedPortPromise;
  }
  function sendSharedMessage(message){return getSharedPort().then(port=>port.postMessage(message)).catch(()=>{});}
  let sharedAssetSequence=0;
  function resolveSharedAsset(path){
    if(!sharedAssetViewer)return Promise.resolve(new URL(path,location.href).href);
    return new Promise((resolve,reject)=>{
      const id=++sharedAssetSequence;
      let port;const timer=setTimeout(()=>{if(port)port.removeEventListener('message',receive);reject(new Error('素材加载超时'))},12000);
      function receive(event){
        if(event.data?.type!=='sonic-share-asset-result'||event.data.id!==id)return;
        clearTimeout(timer);port?.removeEventListener('message',receive);
        if(event.data.url)resolve(event.data.url);else reject(new Error('素材加载失败'));
      }
      getSharedPort().then(connectedPort=>{port=connectedPort;port.addEventListener('message',receive);port.start?.();port.postMessage({type:'sonic-share-asset',id,path})}).catch(()=>{clearTimeout(timer);reject(new Error('分享页连接失败'))});
    });
  }
  const nebulaAssetSources=Object.freeze({ring:'./assets/nebula-ring.webp',galaxy:'./assets/nebula-galaxy.webp',peaks:'./assets/nebula-landscape.webp',blackhole:'./assets/nebula-blackhole.webp'});
  const nebulaImages={},nebulaRecolored=new Map();
  let nebulaAssetsState='loading',nebulaAssetsSettled=false,nebulaAssetFailures=0,visualFirstFrameReady=false;
  function validNebulaImage(image){
    return Boolean(image&&Number.isFinite(image.naturalWidth)&&Number.isFinite(image.naturalHeight)&&image.naturalWidth>0&&image.naturalHeight>0);
  }
  function nebulaAssetAvailable(scene){
    return validNebulaImage(nebulaImages[scene]);
  }
  function updateNebulaAssetDiagnostics(progress){
    app.dataset.nebulaAssets=nebulaAssetsState;
    if(progress!==undefined)app.dataset.nebulaAssetsProgress=progress;
  }
  function refreshNebulaAssetState(){
    const keys=Object.keys(nebulaAssetSources),loaded=keys.filter(nebulaAssetAvailable).length;
    nebulaAssetsState=loaded===keys.length?'ready':loaded?'partial':nebulaAssetFailures>=keys.length?'fallback':'loading';
    updateNebulaAssetDiagnostics();
    return nebulaAssetsState;
  }
  function maybeFinishVisualLoading(){
    if(!visualFirstFrameReady)return;
    app.dataset.visualReady='true';window.deactivateVisualFallback?.();
  }
  const nebulaAssetRequests=new Map(),nebulaAssetErrors=new Set(),nebulaRetryAfter=new Map();
  function loadNebulaAsset(key){
    const source=nebulaAssetSources[key];
    if(!source)return Promise.resolve(false);
    if(nebulaAssetAvailable(key))return Promise.resolve(true);
    if(nebulaAssetRequests.has(key))return nebulaAssetRequests.get(key);
    if(Date.now()<(nebulaRetryAfter.get(key)||0))return Promise.resolve(false);
    const request=new Promise(resolve=>{
      const image=new Image();let settled=false;
      image.decoding='async';image.alt='';
      const publish=()=>{
        nebulaAssetFailures=nebulaAssetErrors.size;
        app.dataset.nebulaAssetFailures=String(nebulaAssetFailures);
        refreshNebulaAssetState();
        updateNebulaAssetDiagnostics(Object.keys(nebulaImages).length+'/'+Object.keys(nebulaAssetSources).length);
      };
      const fail=()=>{if(settled)return;settled=true;nebulaAssetErrors.add(key);nebulaRetryAfter.set(key,Date.now()+15000);publish();resolve(false)};
      image.onload=()=>{
        if(!validNebulaImage(image)){fail();return}
        nebulaImages[key]=image;nebulaAssetErrors.delete(key);nebulaRetryAfter.delete(key);publish();
        if(!settled){settled=true;resolve(true)}
      };
      image.onerror=fail;
      setTimeout(()=>{if(settled)return;fail()},sharedAssetViewer?15000:3000);
      if(sharedAssetViewer)resolveSharedAsset(source).then(url=>{image.src=url}).catch(fail);
      else{const assetUrl=new URL(source,location.href);assetUrl.searchParams.set('v',NEBULA_ASSET_REVISION);image.src=assetUrl.href;}
    });
    nebulaAssetRequests.set(key,request);
    request.then(()=>{if(nebulaAssetRequests.get(key)===request)nebulaAssetRequests.delete(key)});
    return request;
  }
  function loadNebulaAssets(){
    updateNebulaAssetDiagnostics('0/'+Object.keys(nebulaAssetSources).length);
    return loadNebulaAsset(nebulaAssetSources[visualMode]?visualMode:'ring').then(()=>{
      nebulaAssetsSettled=true;maybeFinishVisualLoading();return nebulaAssetsState;
    });
  }
  window.addEventListener('error',event=>{if(!visualFirstFrameReady)window.reportVisualFatal?.('星空引擎启动失败：'+(event.message||'未知错误'))});
  window.addEventListener('unhandledrejection',event=>{if(!visualFirstFrameReady)window.reportVisualFatal?.('星空引擎启动失败：'+(event.reason?.message||'未知错误'))});
  const audio = $('audio'), playBtn = $('playBtn'), seek = $('seek');
  let playbackRate=1,sleepTimeout=0,sleepDeadline=0,sleepRevision=0;
  const themes = {
    nebula:{name:'紫色星云',index:1,shadow:[7,5,20],second:[72,32,145],core:[181,91,255],cool:[55,166,255],hot:[255,184,246],ui:[199,175,255],accent:'#c7afff',bg:'#171329'},
    galaxy:{name:'蓝色银河',index:2,shadow:[3,9,24],second:[20,70,145],core:[65,171,255],cool:[106,225,255],hot:[218,248,255],ui:[157,204,255],accent:'#9dccff',bg:'#0d1c30'},
    solar:{name:'金色光海',index:3,shadow:[21,10,5],second:[135,61,20],core:[249,139,42],cool:[226,92,40],hot:[255,237,180],ui:[241,197,143],accent:'#f1c58f',bg:'#251b13'}
  };
  const visualModes={ring:{name:'星环',english:'STAR RING',number:'01',description:'低频托起星云呼吸，中频推动环带流动，高频点亮局部亮脊'},galaxy:{name:'银河粒子',english:'GALACTIC FLOW',number:'02',description:'低频撑开银河，中频缠绕旋臂，高频点亮星云外侧亮脊'},peaks:{name:'山峰声波',english:'SONIC LANDSCAPE',number:'03',description:'低频抬起山云，中频推动山脊起伏，高频扫亮峰顶'},blackhole:{name:'引力黑洞',english:'EVENT HORIZON',number:'04',description:'低频脉动视界，中频搅动吸积流，高频强化近黑洞亮脊'}};
  let visualMode='ring',particleCount=2400,motionSpeed=1,galaxyParticles=[],terrainHistory=[],terrainClock=0;
  const terrainBands=new Float32Array(96);
  let beatPulse=0,treblePulse=0,bassFloor=.12,previousBass=0,previousHigh=0,lastBeatAt=-1000,lastTrebleAt=-1000,beatAge=10,beatWaves=[],modeOpacity=1,previousMode='ring';
  let themeKey='nebula', palette={...themes.nebula,ui:[...themes.nebula.ui]}, targetPalette=themes.nebula;
  const cloudTextures={};let cloudBlend=1,previousTheme='nebula',mistOrigins=[];
  let w=0,h=0,dpr=1,centerX=0,centerY=0,baseR=190,stars=[],dust=[],ring=[],shooting=[];
  let renderProfile=SonicVisualSystem.performanceProfile({width:innerWidth,dpr:devicePixelRatio||1,deviceMemory:navigator.deviceMemory,hardwareConcurrency:navigator.hardwareConcurrency,coarsePointer:matchMedia('(pointer: coarse)').matches});
  let energySaver=renderProfile.recommendEnergySaver,effectiveParticleCount=0,rafId=0,animationRunning=false,energyUserChoice=false,slowFrameCount=0,overloadFrames=0,exportParticleCache=null;
  let frame=0,lastFrame=0,sceneTime=0,drawTime=0,mouse={x:0,y:0,tx:0,ty:0};
  let bass=0,mid=0,high=0,power=0,intensity=.7,pausedVisualTime=0;
  const musicResponse=SonicMusicMotion.create(),music=musicResponse.state;
  const beatTracker=SonicMusicMotion.createBeatTracker();
  let beatInputNode,beatInputTrack,beatInputGeneration,beatAnalyser,externalBeatAnalyser,beatFrequencyData,beatTimeData;
  const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
  let reduced=motionQuery.matches;
  app.classList.toggle('reduced',reduced);
  motionQuery.addEventListener('change',e=>{reduced=e.matches;app.classList.toggle('reduced',reduced)});
  const bundledSample=Object.freeze({id:'demo-auld-lang-syne',kind:'demo',name:'友谊地久天长',artist:'Bautsch',duration:42.733583,cover:'./assets/nebula-galaxy.webp',stored:true});
  const bundledLyrics=Object.freeze({
    // Word cues follow the recording's phrase starts and the traditional melody's note values.
    raw:`[1030,4820](1030,600,0)Should (1630,900,0)old (2530,1500,0)acquaintance (4030,900,0)be (4930,920,0)forgot,
[5850,4800](5850,600,0)And (6450,1200,0)never (7650,600,0)brought (8250,600,0)to (8850,1800,0)mind?
[10650,4790](10650,600,0)Should (11250,900,0)old (12150,1500,0)acquaintance (13650,900,0)be (14550,890,0)forgot,
[15440,4790](15440,600,0)And (16040,1200,0)auld (17240,1200,0)lang (18440,1790,0)syne?
[20230,4800](20230,600,0)For (20830,900,0)auld (21730,300,0)lang (22030,600,0)syne, (22630,600,0)my (23230,1800,0)dear
[25030,4790](25030,600,0)For (25630,1200,0)auld (26830,1200,0)lang (28030,1790,0)syne,
[29820,4810](29820,600,0)We'll (30420,900,0)take (31320,300,0)a (31620,600,0)cup (32220,600,0)of (32820,1200,0)kindness (34020,610,0)yet,
[34630,5160](34630,600,0)For (35230,1200,0)auld (36430,1200,0)lang (37630,2160,0)syne.`,
    translationRaw:`[00:01.03]怎能忘记昔日的朋友，
[00:05.85]从此再不想起？
[00:10.65]怎能忘记昔日的朋友，
[00:15.44]和那过去的时光？
[00:20.23]亲爱的朋友，为了往日的时光，
[00:25.03]为了往日的时光，
[00:29.82]让我们举杯共敬这份情谊，
[00:34.63]为了往日的时光。`,
    origin:'bundled',offset:0,size:'medium',only:true,enabled:true
  });
  const demoBuffers=new Map(),demoBuilds=new Map();
  let audioContext=null,analyser=null,masterGain=null,normGain=null,mediaNode=null,freqData=null,timeData=null,demoSource=null;
  const loudnessCache=new Map(),loudnessMeasuring=new Set(),LOUDNESS_KEY='sonic-loudness-v1';
  let mode='demo',playing=false,busy=false,duration=0,offset=0,startedAt=0,repeat=true,volume=.65,lastVolume=.65,objectUrl=null;
  let generation=0,loadGeneration=0,currentFile=null,pendingFile=null,seeking=false,toastTimer=0,dragDepth=0,lastUIUpdate=0;
  let onlinePending=null,onlineClipStart=0,onlineRetrying=false,onlineRetryCount=0,onlineSwitching=false,onlineClient=null,onlineReady=false,onlineLoggedIn=false,onlineLoginPoll=0,onlineLoginGeneration=0,onlinePlaylistCache=[],onlineCurrentPlaylistId='';
  let onlineMediaStart=0,onlineRecordingDuration=0;
  let onlineStall=null,onlineStallRetried=false,standaloneRecovery=null,playbackRetryAttempt=null;
  const noOnlineLyrics=[];
  const lyricOrigins={manual:'手动歌词',sidecar:'同名歌词文件',embedded:'音频内嵌歌词',online:'在线补全',lrclib:'LRCLIB',bundled:'内置歌词'};
  let onlineTimedLyrics=noOnlineLyrics,onlineLyricRequest=null,onlineLyricInfo=null,onlineLyricTrackId=null;
  let onlineLyricDismissed=false,onlineLyricPositionFrame=0,onlineLyricActiveIndex=-1,onlineLyricRenderedLines=null;
  const defaultSpace={title:'让音乐\n成为星空。',description:'旋律有了形状，情绪有了引力。\n在声音的宇宙里，遇见属于你的那片星海。',caption:'YOUR SOUND. YOUR UNIVERSE.',darkness:60};
  let space={...defaultSpace},playbackMode='list',tracks=initialDemoTracks(),activeId=null;
  let backgroundImage=null,backgroundData=null,libraryReady=false,libraryReadFailed=false,restoring=true,libraryPromise=null,importing=false;
  let libraryImportReport=null,lastImportedIds=[];
  const libraryReadError='暂时无法读取本机曲库，已保留原有内容。';
  let dbPromise=null,storageChain=Promise.resolve(),savingCount=0,lastSessionSave=0,coverTargetId=null,backgroundRequest=0;
  const storageIssues=new Set(),playbackLabels={sequence:'顺序播放',list:'列表循环',single:'单曲循环',shuffle:'随机播放'};
  let playlists=[],libraryView='all',playbackScope='all',libraryQuery='',editingPlaylistId=null,membershipTrackId=null;
  const legacyQueuePageSize=40;
  let legacyQueuePage=0,legacyQueueView=null;
  let playbackScopeOrder=null;
  let sessionQueue=null,queueRevision=0,queueRun=0,queueEntrySerial=0;
  let trackLoading=false,loadAbort=null,loadingTrack=null;
  const recentKey='sonic-library-recent-v1',lyricSearchText=new WeakMap();
  let recentTrackIds=[];
  try {
    const saved=JSON.parse(localStorage.getItem(recentKey)||'[]');
    if(Array.isArray(saved))recentTrackIds=[...new Set(saved.filter(id=>typeof id==='string'&&id.length<=160))].slice(0,60);
  }catch{}
  const smartKey='sonic-library-smart-v1';
  const smartCounts=new Map(),smartSkips=new Map();
  let smartExcluded=[];
  try {
    const saved=JSON.parse(localStorage.getItem(smartKey)||'{}');
    for(const [id,count] of (Array.isArray(saved.counts)?saved.counts:[]).slice(0,500)){
      if(typeof id==='string'&&Number.isInteger(count)&&count>0)smartCounts.set(id,Math.min(count,99));
    }
    for(const [id,count] of (Array.isArray(saved.skips)?saved.skips:[]).slice(0,500)){
      if(typeof id==='string'&&Number.isInteger(count)&&count>0)smartSkips.set(id,Math.min(count,99));
    }
    if(Array.isArray(saved.excluded))smartExcluded=[...new Set(saved.excluded.filter(id=>typeof id==='string'))].slice(0,500);
  }catch{}
  function saveSmartMusic(){
    try{localStorage.setItem(smartKey,JSON.stringify({counts:[...smartCounts],skips:[...smartSkips],excluded:smartExcluded}));}catch{}
  }
  let editingSodaId=null,sodaBatchPreview=null,sodaBatchText='';
  let shuffleBag=[],shuffleHistory=[],shuffleCursor=-1;
  let externalStream=null,externalNode=null,externalAnalyser=null,externalSink=null,externalPending=false,externalGeneration=0,externalStartedAt=0,externalSilentSince=0;
  const externalPlayback=window.SonicExternalNowPlaying?.create(window.sonicDesktop?.externalNowPlaying,()=>{
    window.dispatchEvent(new Event('sonic:transport-state'));
  });
  function isPlayableTrack(track){return track?.kind==='demo'||track?.kind==='file'||track?.kind==='online'}
  function makeDemo(){return {id:'demo',kind:'demo',name:'星际漫游',duration:96,cover:null,stored:true}}
  function initialDemoTracks(){return sharedAssetViewer?[makeDemo()]:[{...bundledSample},makeDemo()]}
  function currentTrack(){return tracks.find(t=>t.id===activeId&&isPlayableTrack(t))||null}
  function normalizeSodaUrl(value){return globalThis.SonicSodaLibrary?.normalizeSodaUrl(value)||null}
  function openSodaUrl(value){
    const url=normalizeSodaUrl(value);
    if(!url){showToast('链接无效，请重新粘贴汽水音乐分享链接。',true);return false}
    const link=document.createElement('a');
    link.href=url;link.target='_blank';link.rel='noopener noreferrer';
    document.body.append(link);link.click();link.remove();
    return true;
  }
  function updateStorageStatus(){
    const problem=storageIssues.size>0;
    const saving=savingCount||app.dataset.draftState==='saving';
    const message=!libraryReady?'正在读取本机收藏…':libraryReadFailed?'曲库读取失败，点击重新读取':problem?'保存失败，点这里重试':saving?'正在保存在本机…':'已保存在本机';
    document.querySelectorAll('.storage-status').forEach(el=>{el.textContent=message;el.setAttribute('role',problem?'button':'status');if(problem){el.tabIndex=0;el.title=libraryReadFailed?libraryReadError:'重试保存；请保留当前页面'}else{el.removeAttribute('tabindex');el.removeAttribute('title')}});
    document.querySelectorAll('.space-dialog').forEach(el=>el.classList.toggle('storage-problem',problem));
    app.dataset.saveState=!libraryReady?'loading':problem?'error':saving?'saving':'saved';if(app.dataset.recoveryReady==='true')updateRecoveryButtons();
  }
  const missingResumeTracks=new Map();
  let fileRecoverySave=null;
  let backupRestoring=false, resumePoint=null, preparedTrackId=null, resumeQueueCheckpoint=null, deferredResume=false;
  function persistResumePoint(){
    try{localStorage.setItem('sonic-universe-session',JSON.stringify(resumePoint));storageIssues.delete('session')}
    catch{storageIssues.add('session')}
    updateStorageStatus();
  }
  function saveSession(){
    if(backupRestoring||libraryReadFailed||!libraryReady||restoring||externalStream||pendingFile||onlinePending)return;
    const current=resolveQueueItem(sessionQueue?.currentId);
    const recovery=sessionQueue?.recovery||(!sessionQueue&&standaloneRecovery?.id===activeId?standaloneRecovery:null);
    if(deferredResume&&!playing){
      if(resumePoint&&current?.trackId===resumePoint.id&&resumeQueueCheckpoint?.revision!==queueRevision){
        resumePoint.queue=checkpointQueue();
        if(recovery)resumePoint.position=recovery.position;
        persistResumePoint();
      }
      return;
    }
    const id=recovery&&current?current.trackId:activeId;
    if(isTrackPlaybackFailure(recovery?.reason)&&id!==resumePoint?.id)return;
    if(!recovery&&activeId&&preparedTrackId!==activeId)return;
    const position=recovery?.position??getLocalPosition();
    // A selected track is only a listening history entry after it played or was sought.
    if(activeId&&!playing&&!position&&resumePoint?.id!==activeId&&!sessionQueue)return;
    if(sessionQueue&&(!current||!recovery&&current.trackId!==activeId))return;
    const track=resumeTrackMetadata(current?queueTrackDetails(current):currentTrack());
    let clipStart;
    if(track?.provider==='qishui'){
      if(preparedTrackId===id)clipStart=onlineClipStart;
      else if(resumePoint?.id===id&&resumePoint.track?.provider==='qishui'){
        track.preview=resumePoint.track.preview;
        clipStart=resumePoint.clipStart;
      }
    }
    const standalone=!current&&validQueueRecovery(recovery);
    deferredResume=false;
    const scopeOrder=playbackScopeOrder?.scope===playbackScope?playbackScopeOrder.ids:null;
    resumePoint=id?{id,position,savedAt:Date.now(),queue:current?checkpointQueue():null,scope:playbackScope,
      ...(track?{track}:{}),...(Number.isFinite(clipStart)?{clipStart}:{}),...(scopeOrder?{scopeOrder}:{}),...(standalone?{recovery:standalone}:{})}:null;
    persistResumePoint();
  }
  function openLibraryDB(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      let settled=false;
      const timer=setTimeout(()=>fail(new Error('存储打开超时')),8000);
      function fail(error){if(settled)return;settled=true;clearTimeout(timer);reject(error)}
      let request;
      try{request=indexedDB.open('sonic-universe-library',1)}catch(error){fail(error);return}
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('state'))db.createObjectStore('state');if(!db.objectStoreNames.contains('media'))db.createObjectStore('media')};
      request.onerror=()=>fail(request.error);
      request.onblocked=()=>fail(new Error('请关闭其他旧版页面后重试保存'));
      request.onsuccess=()=>{
        if(settled){request.result.close();return}
        settled=true;clearTimeout(timer);const db=request.result;
        db.onversionchange=()=>{db.close();dbPromise=null;storageIssues.add('library');updateStorageStatus()};
        resolve(db);
      };
    });
    dbPromise.catch(()=>{dbPromise=null});
    return dbPromise;
  }
  function requestValue(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
  function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('保存被取消'));tx.onerror=()=>{}})}
  function queueStorage(area,write){if(backupRestoring||libraryReadFailed)return Promise.resolve(false);
    savingCount++;updateStorageStatus();
    const task=storageChain.then(async()=>{
      const db=await openLibraryDB();
      if(libraryReadFailed)throw new Error(libraryReadError);
      await write(db);
    });
    storageChain=task.catch(()=>{});
    return task.then(()=>{storageIssues.delete(area);return true},()=>{
      const first=!storageIssues.has(area);storageIssues.add(area);
      if(first)showToast('本机保存未完成：浏览器存储不可用或容量不足。本页仍可继续使用。',true);
      return false;
    }).finally(()=>{savingCount--;updateStorageStatus()});
  }
  function persistentLibraryTrack(track){
    if(track.kind==='online')return globalThis.SonicOnlineMusic?.persistentTrack(track)||null;
    return {id:track.id,kind:track.kind,name:track.name,artist:track.artist||'',album:track.album||'',
      externalUrl:track.externalUrl||'',duration:track.kind==='soda'?0:track.duration,cover:track.cover||null,
      size:track.blob?.size||track.savedSize||0,favorite:Boolean(track.favorite),sourcePath:track.sourcePath||'',
      signature:track.signature||'',...(track.audioDigest?{audioDigest:track.audioDigest}:{}),
      ...SonicFolderLibrary.folderMetadata(track),manualFields:SonicFolderLibrary.manualFields(track)};
  }
  function persistLibrary(saveLyrics=false){
    if(!libraryReady||libraryReadFailed)return Promise.resolve(false);
    if(fileRecoverySave)return fileRecoverySave.then(()=>persistLibrary(saveLyrics));
    const snapshot=[...tracks,...missingResumeTracks.values()];
    const metadata=snapshot.map(persistentLibraryTrack).filter(Boolean);
    const collections=playlists.map(p=>({id:p.id,name:p.name,trackIds:p.trackIds.slice()})),view=libraryView,scope=playbackScope;
    const lyricState=saveLyrics?JSON.parse(JSON.stringify(atelier)):null;
    const blobs=snapshot.filter(track=>track.kind==='file'&&!track.stored).map(track=>({track,blob:track.blob}));
    return queueStorage('library',async db=>{
      const tx=db.transaction(['state','media'],'readwrite'),done=transactionDone(tx),media=tx.objectStore('media'),ids=new Set(snapshot.map(t=>t.id));
      try{
        tx.objectStore('state').put({version:7,tracks:metadata,playlists:collections,libraryView:view,playbackScope:scope},'library');
        if(lyricState)tx.objectStore('state').put(lyricState,'atelier');
        for(const {track,blob} of blobs)media.put(blob,track.id);
        const cursor=media.openKeyCursor();
        cursor.onsuccess=()=>{const entry=cursor.result;if(entry){if(!ids.has(entry.key))media.delete(entry.key);entry.continue()}};
      }catch(error){
        try{tx.abort()}catch{}
        await done.catch(()=>{});
        throw error;
      }
      await done;
      if(blobs.length){
        // Use the database copy even if the imported folder is moved while the app is open.
        const read=db.transaction('media','readonly'),media=read.objectStore('media');
        await Promise.all(blobs.map(async({track,blob})=>{
          const copy=await requestValue(media.get(track.id)).catch(()=>null);
          if(track.blob!==blob)return;
          track.stored=true;
          if(copy instanceof Blob)track.blob=copy;
        }));
      }
    });
  }
  function persistBackground(){
    const data=backgroundData;
    return queueStorage('background',async db=>{const tx=db.transaction('state','readwrite'),done=transactionDone(tx);if(data)tx.objectStore('state').put(data,'background');else tx.objectStore('state').delete('background');await done});
  }
  function retryLibraryRead(){if(libraryReadFailed)location.reload()}
  async function restoreLibrary(){
    let missing=0;
    missingResumeTracks.clear();
    try{
      const db=await openLibraryDB(),tx=db.transaction(['state','media'],'readonly'),done=transactionDone(tx);
      const values=await Promise.all([requestValue(tx.objectStore('state').get('library')),requestValue(tx.objectStore('state').get('background')),requestValue(tx.objectStore('media').getAll()),requestValue(tx.objectStore('media').getAllKeys()),done]);
      const [saved,bg,blobs,keys]=values,media=new Map(keys.map((key,i)=>[key,blobs[i]]));
      if(saved===undefined?media.size>0:!Array.isArray(saved?.tracks))throw new Error(libraryReadError);
      if(saved&&Array.isArray(saved.tracks)){
        const seen=new Set(),seenSodaUrls=new Set(),seenOnlineIds=new Set();tracks=[];
        for(const meta of saved.tracks){
          if(!meta||typeof meta.id!=='string'||seen.has(meta.id))continue;
          if(meta.kind==='online'){
            const onlineTrack=globalThis.SonicOnlineMusic?.normalizeTrack(meta);
            if(!onlineTrack||seenOnlineIds.has(onlineTrack.mediaId))continue;
            seenOnlineIds.add(onlineTrack.mediaId);seen.add(onlineTrack.id);
            tracks.push(onlineTrack);
            continue;
          }
          if(meta.kind==='soda'){
            const valid=globalThis.SonicSodaLibrary?.validateSodaRecord(meta);
            if(!valid?.ok)continue;
            const key=valid.value.externalUrl.toLocaleLowerCase();
            if(seenSodaUrls.has(key))continue;
            seenSodaUrls.add(key);seen.add(meta.id);
            tracks.push({id:meta.id,kind:'soda',name:valid.value.name,artist:valid.value.artist,album:valid.value.album,externalUrl:valid.value.externalUrl,duration:0,cover:null,blob:null,stored:true,favorite:meta.favorite===true,sourcePath:'汽水音乐 · 分享链接',signature:typeof meta.signature==='string'?meta.signature:'soda:'+key});
            continue;
          }
          if(meta.kind!=='demo'&&meta.kind!=='file')continue;
          const blob=meta.kind==='file'?media.get(meta.id):null;
          seen.add(meta.id);
          const track={id:meta.id,kind:meta.kind,name:String(meta.name||'未命名音乐'),artist:typeof meta.artist==='string'?meta.artist:'',album:typeof meta.album==='string'?meta.album:'',duration:Number.isFinite(meta.duration)&&meta.duration>0?meta.duration:96,cover:typeof meta.cover==='string'&&meta.cover.startsWith('data:image/')?meta.cover:null,blob,stored:true,savedSize:Number.isSafeInteger(meta.size)&&meta.size>0?meta.size:0,audioDigest:typeof meta.audioDigest==='string'&&/^[a-f0-9]{64}$/.test(meta.audioDigest)?meta.audioDigest:null,favorite:meta.favorite===true,sourcePath:typeof meta.sourcePath==='string'?meta.sourcePath:'',signature:typeof meta.signature==='string'?meta.signature:'',...SonicFolderLibrary.folderMetadata(meta),manualFields:SonicFolderLibrary.manualFields(meta)};
          if(meta.kind==='file'&&(!(blob instanceof Blob)||!blob.size)){
            if(resumeFileMetadata(meta))missingResumeTracks.set(meta.id,track);
            missing++;continue;
          }
          tracks.push(track);
        }
      }
      if(Array.isArray(saved?.playlists)){
        const seen=new Set(),ids=new Set([...tracks.map(t=>t.id),...missingResumeTracks.keys()]);
        playlists=saved.playlists.filter(p=>p&&typeof p.id==='string'&&p.id.startsWith('playlist-')&&!seen.has(p.id)&&seen.add(p.id)&&typeof p.name==='string'&&Array.isArray(p.trackIds)).map(p=>({id:p.id,name:p.name.slice(0,32)||'未命名歌单',trackIds:[...new Set(p.trackIds.filter(id=>ids.has(id)))]}));
      }
      libraryView=validCollection(saved?.libraryView)?saved.libraryView:'all';playbackScope=validPlaybackScope(saved?.playbackScope)?saved.playbackScope:'all';resetShuffle();
      if(typeof bg==='string'&&bg.startsWith('data:image/')){try{await applyBackground(bg)}catch{storageIssues.add('background')}}
    }catch{
      libraryReadFailed=true;
      storageIssues.add('library');
      tracks=initialDemoTracks();playlists=[];libraryView=playbackScope='all';
    }
    let session=null;
    try{session=JSON.parse(localStorage.getItem('sonic-universe-session')||'null')}catch{storageIssues.add('session')}
    playbackScopeOrder=null;
    if(validPlaybackScope(session?.scope))playbackScope=session.scope;
    if(!session?.queue&&session?.scope===playbackScope&&Array.isArray(session.scopeOrder)){
      const playableIds=new Set(tracks.filter(isPlayableTrack).map(track=>track.id));
      playbackScopeOrder={scope:playbackScope,ids:[...new Set(session.scopeOrder.filter(id=>playableIds.has(id)))]};
    }
    const previous=resumeTrack(session);
    resumePoint=null;
    if(previous){
      const position=finite(session.position,0,0,86400);
      const recovery=validQueueRecovery(session.recovery);
      const track=resumeTrackMetadata(previous);
      if(previous.kind==='online'&&session.track?.mediaId===previous.mediaId&&typeof session.track.preview==='boolean'){
        track.preview=session.track.preview;
      }
      resumePoint={id:session.id,position,savedAt:Number.isFinite(session.savedAt)?session.savedAt:null,
        queue:session.queue,scope:validPlaybackScope(session.scope)?session.scope:playbackScope,
        track,...(previous.kind==='online'&&Number.isFinite(session.clipStart)?{clipStart:clamp(session.clipStart,0,86400)}:{}),
        ...(playbackScopeOrder?{scopeOrder:playbackScopeOrder.ids}:{}),
        ...(recovery?{recovery}:{})};
    }
    const stored=previous&&tracks.find(track=>track.id===previous.id);
    const missingFile=previous?.kind==='file'&&!stored;
    const savedFailure=validQueueRecovery(session?.queue?.recovery)||resumePoint?.recovery;
    deferredResume=Boolean(previous&&(savedFailure||missingFile||previous.kind==='online'||previous.kind==='chart'));
    const selected=previous||tracks.find(isPlayableTrack)||null;
    activeId=null;
    if(deferredResume){
      if(previous.kind==='online'&&!stored)mergeOnlineTrack(previous);
      activeId=previous.id;mode=previous.kind==='file'?'file':previous.kind==='demo'?'demo':'online';
      duration=previous.duration||0;preparedTrackId=null;
      renderActiveTrack();updateTimeline();updatePlaying();
    }else if(selected){
      const outcome=await selectTrack(selected.id,false,resumePoint?.position??0,false,{reportFailure:Boolean(resumePoint)});
      if(resumePoint&&!outcome?.ok)deferredResume=true;
    }
    else clearActiveTrack();
    if(resumePoint){
      restoreResumeQueue();
      if(deferredResume&&!savedFailure&&previous.kind==='file'){
        if(sessionQueue)holdQueueFailure(sessionQueue,'file',resumePoint.position,true);
        else resumePoint.recovery={reason:'file',position:resumePoint.position,manual:true};
      }
    }
    libraryReady=true;restoring=false;updateExternalUI();resetShuffle();
    if(deferredResume&&resumePoint){persistResumePoint();updatePlaying();}
    renderPlaylist();updateStorageStatus();
    app.dataset.libraryReady='true';
    if(libraryReadFailed)showToast(libraryReadError,true);
    if(missing){$('importStatus').textContent=missing+' 首音乐的本机文件缺失，请重新导入。';showToast('有 '+missing+' 首音乐需要重新导入。',true)}
  }

  let storyEnabled=true,postcardAuthor='',postcardStyle='night';
  const camera={yaw:0,pitch:0,zoom:1,targetYaw:0,targetPitch:0,targetZoom:1};
  const story={phase:'intro',number:'01',label:'序曲 · 星光初醒',progress:0,light:.34,surge:0,reveal:1,nebula:1};
  let quietOwnedFullscreen=false,quietScroll=0,quietFocus=null,roamTimer=0,roamSeeking=false,roamPointers=new Map(),pinchDistance=0;
  let capturedScene=null,capturedMoment=null,postcardBlobUrl=null,exportingPostcard=false;
  const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v)};
  function loadExperiencePreferences(){
    try{
      const prefs=JSON.parse(localStorage.getItem('sonic-universe-preferences')||'null');
      if(prefs){
        if(typeof prefs.storyEnabled==='boolean')storyEnabled=prefs.storyEnabled;
        if(typeof prefs.journeyAuto==='boolean')journeyAuto=prefs.journeyAuto;
        if(typeof prefs.postcardAuthor==='string')postcardAuthor=prefs.postcardAuthor.slice(0,24);
        if(['night','moon'].includes(prefs.postcardStyle))postcardStyle=prefs.postcardStyle;
      }
    }catch{}
    $('postcardAuthor').value=postcardAuthor;updateStoryToggle();updateJourneyToggle();
  }
  function updateStoryToggle(){
    $('storyToggle').setAttribute('aria-pressed',String(storyEnabled));
    $('storyToggle').setAttribute('aria-label',storyEnabled?'关闭音乐剧情':'开启音乐剧情');
    $('storyToggleText').textContent=storyEnabled?'已开启':'已关闭';
  }
  let journeyAuto=true,cameraHeld=false;
  const cinema={yaw:0,pitch:0,zoom:1};
  const sceneWeights={ring:1,galaxy:0,peaks:0,blackhole:0};
  let renderedMode='ring',journeyTrack=null,journeyPosition=0,burstParticles=[],burstSerial=0,emittedBeat=-1000,emittedTreble=-1000;
  function storyVisualsActive(){return storyEnabled||Boolean(clipSession?.storyTimeline&&!clipSession.instrument)}
  function automaticJourney(){return storyEnabled&&journeyAuto&&!externalStream&&!instrumentOpen&&Boolean(currentTrack())}
  function updateJourneyToggle(){
    $('journeyToggle').setAttribute('aria-pressed',String(journeyAuto&&!externalStream));
    $('journeyToggle').setAttribute('aria-label',externalStream?'外部联动没有歌曲进度，请手动选择形态':journeyAuto?'关闭自动旅程，手动选择形态':'开启星环、银河、山峰自动旅程');
    $('journeyToggleText').textContent=externalStream?'LIVE · 手选形态':journeyAuto?'随曲切换':'手选形态';
    $('journeyToggle').disabled=!storyEnabled||Boolean(externalStream);
  }
  function holdCamera(){cameraHeld=true;updateCameraButton()}
  function updateCameraButton(){
    const held=cameraHeld||(!automaticJourney()&&!moodCameraActive())||reduced;
    $('roamCameraBtn').setAttribute('aria-pressed',String(!held));
    $('roamCameraBtn').textContent=reduced?'低动态视角':cameraHeld?'继续运镜 ↗':automaticJourney()?'自动运镜 · 暂停':moodCameraActive()?'心情运镜 · 暂停':'手动视角';
    $('roamCameraBtn').disabled=reduced||(!automaticJourney()&&!moodCameraActive());
    $('roamCameraBtn').title=cameraHeld?'回到自动镜头，重新居中':'停住自动镜头，保留当前视角';
  }
  function emitBurst(strength,treble=false){
    if(reduced||!storyVisualsActive())return;
    const count=Math.round((w<=760?5:9)*clamp(strength,.4,1));
    for(let i=0;i<count;i++)burstParticles.push({angle:rand()*Math.PI*2,start:.5+rand()*.38,speed:.16+rand()*.42,life:.8+rand()*.65,age:0,size:.35+rand()*.75,strength,hot:treble||rand()>.84});
    if(burstParticles.length>72)burstParticles.splice(0,burstParticles.length-72);
    burstSerial++;
  }
  function updateStory(dt){
    const position=getLocalPosition();let progress=duration>0?clamp(position/duration,0,1):0;
    const trackKey=externalStream?'external':activeId;
    if(trackKey!==journeyTrack||Math.abs(position-journeyPosition)>.7){burstParticles=[];emittedBeat=lastBeatAt;emittedTreble=lastTrebleAt}
    journeyTrack=trackKey;journeyPosition=position;
    const sounding=Boolean(playing||externalStream||instrumentSoundActive());
    const energy=sounding?clamp(power*.58+bass*.32+beatPulse*.6+treblePulse*.17,0,1):0;
    const forcedChapter=clipSession?.storyTimeline&&!clipSession.instrument?SonicFilmStory.chapterAt(clipSession.storyTimeline,getLocalPosition(),true):null;
    let phase='free',number='—',label='自由漫游',light=1,reveal=1,nebula=1,surge=0;
    if(forcedChapter){
      phase=forcedChapter.chapter.id;number=forcedChapter.chapter.number;label=forcedChapter.chapter.label;progress=forcedChapter.progress;surge=energy;
    }else if(instrumentOpen){phase='perform';number='✧';label='即兴 · 指尖成星';light=1;reveal=1;nebula=1;surge=energy}
    else if(externalStream){phase='live';number='∞';label='共鸣 · 万籁成星';surge=storyVisualsActive()?energy:0}
    else if(storyEnabled&&currentTrack()){
      surge=energy;
      if(progress<.14){
        const opening=smooth(progress/.14);phase='intro';number='01';label='序曲 · 星光初醒';light=.18+.82*opening;reveal=.12+.88*opening;nebula=.12+.7*opening;
      }else if(progress<.48){phase='travel';number='02';label='漫游 · 旋律成河';nebula=.82+.18*smooth((progress-.14)/.22)}
      else if(progress<.82){phase='bloom';number='03';label='盛放 · 星河共鸣'}
      else{phase='outro';number='04';label='余晖 · 光尘归寂';light=1-smooth((progress-.82)/.18);reveal=light;surge*=light}
    }
    Object.assign(story,{phase,number,label,progress,reveal,nebula});
    const ease=1-Math.exp(-dt*5);story.light+=(light-story.light)*ease;
    story.surge+=(surge-story.surge)*(1-Math.exp(-dt*(reduced?1.5:7)));
    const motionEase=reduced?1:1-Math.exp(-dt*12);
    camera.yaw+=(camera.targetYaw-camera.yaw)*motionEase;camera.pitch+=(camera.targetPitch-camera.pitch)*motionEase;camera.zoom+=(camera.targetZoom-camera.zoom)*motionEase;
    const auto=forcedChapter||automaticJourney(),weights={ring:0,galaxy:0,peaks:0,blackhole:0};
    if(forcedChapter)weights[forcedChapter.chapter.mode]=1;
    else if(auto)Object.assign(weights,SonicVisualSystem.journeyWeights(progress));
    else weights[visualMode]=1;
    for(const key of Object.keys(sceneWeights))sceneWeights[key]+=(weights[key]-sceneWeights[key])*(1-Math.exp(-dt*(reduced?5:2.8)));
    renderedMode=Object.keys(sceneWeights).reduce((a,b)=>sceneWeights[a]>sceneWeights[b]?a:b);
    let yaw=0,pitch=0,zoom=1;
    if(auto&&!reduced){
      const entrance=smooth(progress/.14);
      yaw=-.18*(1-entrance)+Math.sin(progress*Math.PI*2)*.14;
      pitch=.09*(1-entrance)+Math.sin(progress*Math.PI*3)*.045;
      zoom=.72+.28*entrance+Math.sin(progress*Math.PI)*.07;
    }
    if(!auto&&moodCameraActive()&&!reduced){yaw=Math.sin(sceneTime*.065)*.10;pitch=Math.sin(sceneTime*.043)*.035;zoom=1+Math.sin(sceneTime*.028)*.035}
    if(reduced){cinema.yaw=0;cinema.pitch=0;cinema.zoom=1}
    else if(!cameraHeld){const ease=1-Math.exp(-dt*3.6);cinema.yaw+=(yaw-cinema.yaw)*ease;cinema.pitch+=(pitch-cinema.pitch)*ease;cinema.zoom+=(zoom-cinema.zoom)*ease}
    if(visualEffects.beat&&sounding&&storyVisualsActive()&&!reduced){
      if(lastBeatAt!==emittedBeat){emittedBeat=lastBeatAt;if(beatPulse>.18)emitBurst(clamp(energy+beatPulse*.4,0,1))}
      if(lastTrebleAt!==emittedTreble){emittedTreble=lastTrebleAt;if(treblePulse>.22&&power>.08)emitBurst(clamp(energy*.7+treblePulse*.25,0,1),true)}
    }
    for(const particle of burstParticles)particle.age+=dt;
    burstParticles=burstParticles.filter(p=>p.age<p.life);
    if(!storyVisualsActive()||reduced)burstParticles=[];
  }

  function updateJourneyUI(){
    if(!$('roamTrack'))return;
    $('storyChapter').textContent=story.number+' / '+story.label;
    $('roamChapter').textContent=busy&&mode==='demo'?'正在准备音景…':story.label.split(' · ')[0];
    $('roamTrack').textContent=externalStream?'外部声音 · 实时联动':currentTrack()?.name||'静候一首音乐';
    $('roamZoom').textContent=(camera.zoom*cinema.zoom).toFixed(2)+'× 视距';
    updateCameraButton();updateJourneyToggle();
    const info=visualModes[renderedMode];$('sceneName').textContent=info.english;$('sceneNumber').textContent=info.number;
    canvas.setAttribute('aria-label',info.name+'：'+info.description);
    app.dataset.storyChapter=story.number;app.dataset.storyLabel=story.label;
    const shownMode=clipSession?.storyTimeline&&!clipSession.instrument||automaticJourney()?renderedMode:visualMode;
    document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===shownMode)));
    Array.from($('chapterRail').children).forEach((el,i)=>el.classList.toggle('active',story.number===String(i+1).padStart(2,'0')));
    const button=$('roamPlayBtn');button.setAttribute('aria-label',busy&&mode==='demo'?'正在准备音景，请稍候':playing?'暂停音乐':'播放音乐');
    button.innerHTML=playing?'<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>':'<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>';
    button.disabled=!currentTrack()||busy||Boolean(pendingFile)||Boolean(externalStream);if(externalStream)button.setAttribute('aria-label','外部声音联动中，请在原播放器控制');
    app.dataset.storyPhase=story.phase;app.dataset.storyLight=story.light.toFixed(3);app.dataset.storySurge=story.surge.toFixed(3);
    app.dataset.journeyAuto=String(automaticJourney());app.dataset.renderedMode=renderedMode;app.dataset.sceneWeights=JSON.stringify(sceneWeights);
    app.dataset.cinemaYaw=cinema.yaw.toFixed(4);app.dataset.cinemaPitch=cinema.pitch.toFixed(4);app.dataset.cinemaZoom=cinema.zoom.toFixed(4);app.dataset.cameraHeld=String(cameraHeld);app.dataset.nebula=story.nebula.toFixed(3);app.dataset.starReveal=story.reveal.toFixed(3);app.dataset.burstCount=String(burstParticles.length);app.dataset.burstSerial=String(burstSerial);
    app.dataset.cameraYaw=camera.yaw.toFixed(3);app.dataset.cameraPitch=camera.pitch.toFixed(3);app.dataset.cameraZoom=camera.zoom.toFixed(3);
    syncRoamLooks();
  }
  function updateJourneyTimeline(){
    if(!$('roamSeek'))return;
    if(externalStream){$('roamCurrentTime').textContent=formatTime(getPosition());$('roamDuration').textContent='LIVE';$('roamSeek').disabled=true;$('roamSeek').value=0;setFill($('roamSeek'));$('roamSeek').setAttribute('aria-valuetext','外部声音实时联动，进度由原播放器控制');return}
    $('roamCurrentTime').textContent=formatTime(getPosition());$('roamDuration').textContent=formatTime(duration);
    const range=$('roamSeek');range.max=duration||96;range.disabled=!currentTrack();
    if(!roamSeeking){range.value=getPosition();setFill(range)}
    range.setAttribute('aria-valuetext',formatTime(getPosition())+' / '+formatTime(duration));
  }
  function wakeRoam(){
    if(!app.classList.contains('quiet'))return;
    clearTimeout(roamTimer);app.classList.remove('roam-idle');
    roamTimer=setTimeout(()=>{
      if(!app.classList.contains('quiet')||document.querySelector('dialog[open]'))return;
      if(app.classList.contains('look-open')||roamPointers.size||document.activeElement?.closest('.roam-ui')||document.querySelector('.roam-dock:hover')){wakeRoam();return}
      app.classList.add('roam-idle');
    },2800);
  }
  function resetCamera(){
    holdCamera();cinema.yaw=0;cinema.pitch=0;cinema.zoom=1;
    camera.targetYaw=0;camera.targetPitch=0;camera.targetZoom=1;
    if(reduced){camera.yaw=0;camera.pitch=0;camera.zoom=1}
    updateJourneyUI();wakeRoam();
  }
  function setQuiet(value){
    const wasQuiet=app.classList.contains('quiet');if(value===wasQuiet)return;
    if(!value)setRoamLookOpen(false,false);
    if(value){quietScroll=scrollY;quietFocus=document.activeElement}
    beginLayoutTransition();app.classList.toggle('quiet',value);document.body.classList.toggle('roaming',value);
    document.querySelectorAll('.header,.stage,.player-wrap,.footer').forEach(el=>el.inert=value);
    app.classList.remove('roam-idle','dragging');roamPointers.clear();pinchDistance=0;resize();
    if(value){
      $('roamSurface').focus({preventScroll:true});wakeRoam();
      if(!document.fullscreenElement&&typeof app.requestFullscreen==='function'){
        quietOwnedFullscreen=true;
        app.requestFullscreen().then(()=>{if(!app.classList.contains('quiet')&&document.fullscreenElement===app)document.exitFullscreen().catch(()=>{})}).catch(()=>{quietOwnedFullscreen=false});
      }
    }else{
      clearTimeout(roamTimer);
      if(quietOwnedFullscreen&&document.fullscreenElement===app){quietOwnedFullscreen=false;document.exitFullscreen().catch(()=>{})}
      quietOwnedFullscreen=false;
      requestAnimationFrame(()=>{scrollTo(0,quietScroll);(quietFocus?.isConnected?quietFocus:$('enterUniverseBtn')).focus({preventScroll:true})});
    }
  }
  function enterUniverse(){setQuiet(true);if(!externalStream&&!playing&&currentTrack()&&!busy&&!pendingFile)play()}
  let clipPhase='idle',clipSession=null,clipShape='portrait',clipLength=30,clipUrl=null,clipBlob=null,clipMeta=null,clipBackground=null,clipBackgroundKey=null,exportRendering=false;
  let clipAuthor='',clipMood='',clipShowingResult=false,clipLastDraw=0,clipBackgroundDarkness=-1;
  let filmAnalysis=null,filmAnalyzing=false,filmAnalysisToken=0;
  function clipLocked(){return Boolean(clipSession)&&['preparing','recording','stopping'].includes(clipPhase)}
  function clipSupported(){return typeof MediaRecorder!=='undefined'&&typeof $('clipCanvas').captureStream==='function'&&typeof MediaStream!=='undefined'}
  function clipSetStatus(message,error=false){$('clipStatus').textContent=message;$('clipStatus').classList.toggle('error',error)}
  function filmSourceLength(){const total=Number(filmAnalysis?.sourceDuration||duration||currentTrack()?.duration||0);return Number.isFinite(total)&&total>0?total:0}
  function filmEditLength(total=filmSourceLength()){return Math.min(total,clipLength||Math.min(30,total))}
  function filmSafeStart(value,total=filmSourceLength(),length=filmEditLength(total)){
    return clamp(Number.isFinite(Number(value))?Number(value):0,0,Math.max(0,total-length));
  }
  function filmSetStatus(message,state='等待分析',error=false){
    $('filmStoryStatus').textContent=message;$('filmStoryStatus').classList.toggle('error',error);$('filmStoryState').textContent=state;
  }
  function filmCurrentAnalysis(){return filmAnalysis&&filmAnalysis.trackId===activeId?filmAnalysis:null}
  function renderFilmAnalysis(){
    const analysis=filmCurrentAnalysis(),locked=clipLocked(),instrument=clipInstrumentMode;
    const pick=$('filmStoryPick'),chapters=$('filmStoryChapters'),start=$('filmStoryStart');
    const buttons=[$('filmStoryAnalyze'),$('filmStoryUseStart'),$('filmStoryUseRecommendation')];
    pick.hidden=!analysis||instrument;chapters.hidden=!analysis||instrument;
    buttons.forEach(button=>{button.disabled=locked||filmAnalyzing||instrument||(!currentTrack()&&!instrument)});
    if(instrument){filmSetStatus('演奏短片沿用实时画面，不进行歌曲章节分析。','现场演奏');return}
    if(!currentTrack()){filmSetStatus('先从音乐库选择或导入一首本地歌曲。','尚未选歌',true);start.value='';return}
    if(filmAnalyzing){filmSetStatus('正在读取旋律、估算能量并寻找最完整的高潮段落…','分析中');return}
    if(!analysis){filmSetStatus('等待歌曲分析。分析只在本机进行。','等待分析');start.value='';return}
    const recommendation=analysis.recommendation,timeline=analysis.timeline;
    pick.hidden=false;chapters.hidden=false;$('filmStoryRange').textContent=formatTime(recommendation.start)+' – '+formatTime(recommendation.end);
    $('filmStoryReason').textContent=recommendation.reason+(recommendation.confidence?` · 可信度 ${Math.round(recommendation.confidence*100)}%`:'');
    start.min='0';start.max=String(Math.max(0,analysis.sourceDuration-timeline.section.length));start.value=String(Number(timeline.section.start.toFixed(2)));
    chapters.replaceChildren();
    timeline.chapters.forEach(chapter=>{
      const item=document.createElement('li'),number=document.createElement('b'),label=document.createElement('span'),time=document.createElement('time'),energy=document.createElement('small');
      item.style.setProperty('--energy',Math.round(chapter.energy*100)+'%');number.textContent=chapter.number;label.textContent=chapter.label;time.textContent=formatTime(chapter.start)+'–'+formatTime(chapter.end);energy.textContent=Math.round(chapter.energy*100)+'%';
      item.title=chapter.label+' · 能量 '+Math.round(chapter.energy*100)+'%';item.append(number,label,time,energy);chapters.append(item);
    });
    filmSetStatus(analysis.fallback?'浏览器未能深入解码这首歌，已按时值生成可编辑的四章结构。':'分析完成。四章会随音乐能量依次切换，也可以手动改起点。',analysis.fallback?'备用编排':'分析完成',analysis.fallback);
  }
  function calculateFilmEdit(energy,total,startValue,requestedLength){
    const sectionLength=Math.min(total,Math.max(.25,Number(requestedLength)||filmEditLength(total)));
    const picked=SonicFilmStory.pickBestSection(energy,total,sectionLength);
    const start=filmSafeStart(startValue===undefined||startValue===null?picked.start:startValue,total,sectionLength);
    const end=Math.min(total,start+sectionLength);
    const timeline=SonicFilmStory.buildChapterTimeline(energy,total,start,Math.max(.25,end-start));
    return{recommendation:{...picked,start:Number(start.toFixed(3)),end:Number(end.toFixed(3)),length:Number((end-start).toFixed(3))},timeline};
  }
  function applyFilmEdit(startValue,requestedLength){
    const analysis=filmCurrentAnalysis();if(!analysis)return false;
    const edit=calculateFilmEdit(analysis.energy,analysis.sourceDuration,startValue,requestedLength);
    analysis.recommendation=edit.recommendation;analysis.timeline=edit.timeline;
    const section=edit.timeline.section;
    clipSegment=clipLength||requestedLength!==undefined?{id:activeId,start:section.start,end:section.end}:null;
    if(!clipLocked()){pause();seekTo(section.start);cueTrack=null;cuePosition=-1;cueActive=null;segmentPreview=false}
    renderFilmAnalysis();
    return true;
  }
  function invalidateFilmAnalysis(message='切换歌曲后，等待重新分析。'){
    filmAnalysisToken++;filmAnalyzing=false;filmAnalysis=null;clipSegment=null;segmentPreview=false;
    if($('filmStoryPanel'))filmSetStatus(message,'等待分析');
  }
  async function analyzeFilmStory({force=false,start=null}={}){
    const track=currentTrack();if(instrumentOpen||clipInstrumentMode){renderFilmAnalysis();return false}
    if(!track){filmAnalysis=null;renderFilmAnalysis();return false}
    if(!force&&filmCurrentAnalysis()&&!filmAnalyzing){renderFilmAnalysis();return true}
    const token=++filmAnalysisToken;filmAnalyzing=true;filmAnalysis=null;renderFilmAnalysis();
    try{
      await loadFeatureScript('film-story.js','SonicFilmStory');
      initAudio();await audioContext.resume();
      let buffer;
      if(track.kind==='demo')buffer=await buildDemo(track);
      else{
        if(!track.blob)throw new Error('这首歌没有可分析的本地音频文件。');
        buffer=await audioContext.decodeAudioData(await track.blob.arrayBuffer());
      }
      if(token!==filmAnalysisToken||activeId!==track.id)return false;
      const total=Number(buffer.duration)||track.duration;
      if(!(total>=1))throw new Error('歌曲太短，至少需要 1 秒才能编排四章。');
      const energy=SonicFilmStory.analyzeEnergy(buffer,buffer.sampleRate,total);
      const edit=calculateFilmEdit(energy,total,start);
      filmAnalysis={trackId:track.id,trackName:track.name,sourceDuration:total,energy,recommendation:edit.recommendation,timeline:edit.timeline,createdAt:Date.now(),fallback:Boolean(energy.fallback)};
      filmAnalyzing=false;applyFilmEdit(edit.timeline.section.start);
      clipSetStatus('已找到推荐片段 '+formatTime(edit.timeline.section.start)+' → '+formatTime(edit.timeline.section.end)+'。确认后即可开始录制。');
      return true;
    }catch(error){
      if(token!==filmAnalysisToken||activeId!==track.id)return false;
      const total=Number(track.duration||duration);
      if(total>=1&&window.SonicFilmStory){
        const energy=SonicFilmStory.createFallbackAnalysis(total),edit=calculateFilmEdit(energy,total,start);
        filmAnalysis={trackId:track.id,trackName:track.name,sourceDuration:total,energy,recommendation:edit.recommendation,timeline:edit.timeline,createdAt:Date.now(),fallback:true};
        filmAnalyzing=false;applyFilmEdit(edit.timeline.section.start);
        clipSetStatus('这首歌无法深入解码，已生成可用的四章备用编排。',true);
        return true;
      }
      filmAnalyzing=false;filmAnalysis=null;renderFilmAnalysis();filmSetStatus(error.message||'歌曲分析失败，请换一首本地音乐。','分析失败',true);clipSetStatus(error.message||'歌曲分析失败，请重试。',true);
      return false;
    }
  }
  function clipSaveSettings(){
    clipAuthor=$('clipAuthor').value;clipMood=$('clipMood').value;
    try{localStorage.setItem('sonic-universe-film',JSON.stringify({version:27,filmToolVersion:1,shape:clipShape,length:clipLength,author:clipAuthor,mood:clipMood}))}catch{clipSetStatus('短片设置未能保存；本次仍可录制。',true)}
  }
  function clipUpdateControls(){
    const locked=clipLocked(),external=Boolean(externalStream||externalPending),supported=clipSupported();
    $('clipDialog').dataset.state=clipPhase;app.dataset.clipState=clipPhase;if(instrumentReady){updateInstrumentControls();renderInstrumentLayers()}
    $('clipFields').disabled=locked;$('clipRecordBtn').hidden=clipPhase==='recording'||clipPhase==='stopping';
    const perform=instrumentOpen&&(clipInstrumentMode||clipSession?.instrument),needsStory=!perform&&!clipMoment&&(!filmCurrentAnalysis()||filmAnalyzing);
    $('clipRecordBtn').disabled=locked||external||!supported||!libraryReady||busy||Boolean(pendingFile)||needsStory||(!currentTrack()&&!clipInstrumentMode);
    $('clipRecordBtn').querySelector('span').textContent=clipPhase==='preparing'?'正在准备…':clipBlob?'重新录制':'开始录制';
    $('clipStopBtn').hidden=clipPhase!=='recording'&&clipPhase!=='stopping';$('clipStopBtn').disabled=clipPhase==='stopping';
    $('clipSaveBtn').disabled=!clipBlob||locked;$('clipViewBtn').hidden=!clipBlob||locked||clipShowingResult;
    $('clipNote').textContent=external?'请先停止外部联动并选择本地歌曲。本版短片暂不录制外部声音。':!supported?'当前浏览器不支持短片录制，请用新版 Edge 或 Chrome 打开本机网址。':'本地音乐与原创音景 · 短片自带音乐，独立于播放器音量。录完暂停在结束位置；手动录制最长 3 分钟。';
    $('instrumentFilmControls').hidden=!perform;if(perform)$('clipNote').textContent='演奏短片自带你的音符与循环；节拍提示音不会录入。录制时直接用下方音垫或键盘演奏。';$('clipHeading').textContent=perform?'把自己的旋律，留在星空里。':'把这首歌，变成星空短片。';
    $('clipPreviewTag').hidden=clipShowingResult;const shape=clipShowingResult&&!locked&&clipMeta?clipMeta.shape:clipSession?.shape||clipShape,width=shape==='portrait'?720:1280,height=shape==='portrait'?1280:720;
    $('clipPreview').dataset.shape=shape;$('clipSpec').textContent=width+' × '+height+' · '+(shape==='portrait'?'竖屏':'横屏');
    if(!locked){$('clipElapsed').textContent=clipShowingResult&&clipMeta?formatTime(clipMeta.seconds)+' · '+clipMeta.extension.toUpperCase():formatTime(0)+' / '+(clipLength?formatTime(clipLength):'手动结束')}
    document.querySelectorAll('[data-clip-shape]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.clipShape===clipShape)));
    document.querySelectorAll('[data-clip-length]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.clipLength)===clipLength)));
  }
  function clipShowLive(){
    clipShowingResult=false;$('clipVideo').pause();$('clipVideo').hidden=true;$('clipCanvas').hidden=false;
    $('clipPreviewTag').textContent=clipPhase==='recording'?'● 正在录制':'画面预览';$('clipPreviewTag').classList.toggle('recording',clipPhase==='recording');
    if(clipBlob&&clipMeta)$('clipResult').textContent='上次短片：'+clipMeta.song+' · '+formatTime(clipMeta.seconds)+'。重新录制成功前仍保留。';
  }
  function clipShowResult(){
    if(!clipBlob)return;$('clipVideo').hidden=false;$('clipCanvas').hidden=true;clipShowingResult=true;
    $('clipResult').textContent=clipMeta.song+' · '+formatTime(clipMeta.seconds)+' · '+clipMeta.width+' × '+clipMeta.height+' · '+(clipBlob.size/1048576).toFixed(1)+' MB · '+clipMeta.extension.toUpperCase();clipUpdateControls();
  }
  let clipMoment=null;
  function openClip(){
    if(!clipLocked()){$('clipSong').value=clipInstrumentMode?instrumentProject.title:currentTrack()?.name||'';$('clipAuthor').value=clipAuthor||postcardAuthor;$('clipMood').value=clipMood;if(!clipBlob)clipShowLive();restoreFilmDraft()}
    if(clipMoment){$('clipMood').value=clipMoment.lyric||'';clipShowLive();}
    clipUpdateControls();if(!$('clipDialog').open)$('clipDialog').showModal();renderClipFrame(true);
    if(externalStream||externalPending)clipSetStatus('外部联动中。请停止联动后录制本地音乐。');
    else if(!clipSupported())clipSetStatus('当前浏览器暂不支持录制。请在 Edge 或 Chrome 打开本机地址。',true);
    else if(!clipLocked()&&!clipBlob)clipSetStatus('正在准备这首歌的四章星空…');
    renderFilmAnalysis();
    if(clipMoment)clipSetStatus('短片从 '+formatTime(clipMoment.position)+' 开始。开始录制后才会定位。');
    else if(!clipLocked()&&!clipInstrumentMode&&!filmCurrentAnalysis())analyzeFilmStory();
  }
  function clipTextLines(context,text,maxWidth,maxLines){
    const lines=[];let line='';
    for(const character of Array.from(text.replace(/\s+/g,' ').trim())){
      if(context.measureText(line+character).width>maxWidth&&line){lines.push(line);line='';if(lines.length===maxLines){let last=lines.pop();while(context.measureText(last+'…').width>maxWidth)last=last.slice(0,-1);lines.push(last+'…');return lines}}line+=character;
    }
    if(line)lines.push(line);return lines;
  }
  function renderClipFrame(force=false){
    if(!$('clipDialog').open&&!clipLocked())return;if(clipShowingResult&&!clipLocked())return;
    const now=performance.now();if(!force&&now-clipLastDraw<1000/(reduced?15:30)-1)return;clipLastDraw=now;
    const surface=$('clipCanvas'),shape=clipSession?.shape||clipShape,width=shape==='portrait'?720:1280,height=shape==='portrait'?1280:720;
    if(surface.width!==width||surface.height!==height){surface.width=width;surface.height=height;clipBackgroundKey=null}
    const g=surface.getContext('2d',{alpha:false}),saved={ctx,w,h,dpr,centerX,centerY,baseR,backgroundLayer};
    const moment=clipSession?.moment||clipMoment;
    if(moment){
      const image=moment.frame,scale=Math.max(width/image.width,height/image.height);
      g.drawImage(image,(width-image.width*scale)/2,(height-image.height*scale)/2,image.width*scale,image.height*scale);
    }else try{
      if(clipBackgroundKey!==backgroundImage||clipBackgroundDarkness!==space.darkness||clipBackground?.width!==width||clipBackground?.height!==height){
        clipBackgroundKey=backgroundImage;clipBackgroundDarkness=space.darkness;clipBackground=null;
        if(backgroundImage){const bg=document.createElement('canvas');bg.width=width;bg.height=height;const c=bg.getContext('2d'),scale=Math.max(width/backgroundImage.naturalWidth,height/backgroundImage.naturalHeight);c.drawImage(backgroundImage,(width-backgroundImage.naturalWidth*scale)/2,(height-backgroundImage.naturalHeight*scale)/2,backgroundImage.naturalWidth*scale,backgroundImage.naturalHeight*scale);c.fillStyle='rgba(8,9,17,'+(space.darkness/100)+')';c.fillRect(0,0,width,height);clipBackground=bg}
      }
      ctx=g;w=width;h=height;dpr=1;centerX=width*.5;centerY=height*(shape==='portrait'?.43:.44);baseR=Math.min(width*.34,height*.29,340);backgroundLayer=clipBackground;exportRendering=true;g.setTransform(1,0,0,1,0,0);draw(sceneTime,0);
    }finally{ctx=saved.ctx;w=saved.w;h=saved.h;dpr=saved.dpr;centerX=saved.centerX;centerY=saved.centerY;baseR=saved.baseR;backgroundLayer=saved.backgroundLayer;exportRendering=false}
    const portrait=shape==='portrait',margin=portrait?58:78,font='"Microsoft YaHei UI","Microsoft YaHei",sans-serif',meta=clipSession||{song:$('clipSong').value,author:$('clipAuthor').value,mood:$('clipMood').value};
    const shade=g.createLinearGradient(0,height*.63,0,height);shade.addColorStop(0,'rgba(8,9,17,0)');shade.addColorStop(1,'rgba(8,9,17,.89)');g.fillStyle=shade;g.fillRect(0,height*.63,width,height*.37);
    g.textAlign='left';g.textBaseline='top';g.font='13px '+font;g.fillStyle=rgba(palette.core,.72);g.fillText('SONIC UNIVERSE  /  32',margin,portrait?58:42);
    const activeTimeline=clipSession?.storyTimeline||(filmCurrentAnalysis()?.timeline),filmFrame=activeTimeline&&!clipSession?.instrument?SonicFilmStory.chapterAt(activeTimeline,getLocalPosition(),true):null;
    if(moment){
      g.font='600 15px '+font;g.fillStyle='#f0e8fc';
      g.fillText(moment.mode+' · '+formatTime(clipSession?.startedAt?getLocalPosition():moment.position),margin,portrait?82:64);
    }else if(filmFrame){
      g.font='600 12px '+font;g.fillStyle=rgba(palette.hot,.82);
      g.fillText(filmFrame.chapter.number+' / '+filmFrame.chapter.label,margin,portrait?82:64);
    }
    let y=height-(portrait?294:225);g.fillStyle='#f0e8fc';g.font='500 '+(portrait?36:30)+'px '+font;
    for(const line of clipTextLines(g,meta.song,width-margin*2,2)){g.fillText(line,margin,y);y+=portrait?46:38}
    y+=12;g.font=(portrait?'20':'18')+'px '+font;g.fillStyle='#c0aecf';for(const line of clipTextLines(g,meta.mood,width-margin*2,portrait?3:2)){g.fillText(line,margin,y);y+=portrait?29:25}
    g.strokeStyle=rgba(palette.core,.45);g.lineWidth=1;g.beginPath();g.moveTo(margin,height-(portrait?62:34));g.lineTo(margin+25,height-(portrait?62:34));g.stroke();g.fillStyle='#baa4cc';g.font='15px '+font;
    g.fillText(meta.author.trim()||'声波宇宙',margin+38,height-(portrait?71:43));
    app.dataset.clipWidth=String(width);app.dataset.clipHeight=String(height);
  }
  function clipCleanup(session){
    clearInterval(session.timer);clearTimeout(session.watchdog);
    if(session.gain){try{analyser.disconnect(session.gain)}catch{}try{session.gain.disconnect()}catch{}}
    session.stream?.getTracks().forEach(t=>t.stop());session.capture?.getTracks().forEach(t=>t.stop());session.destination?.stream.getTracks().forEach(t=>t.stop());
  }
  function clipTick(session){
    if(clipSession!==session||clipPhase!=='recording')return;session.seconds=(performance.now()-session.startedAt)/1000;
    $('clipElapsed').textContent=formatTime(session.seconds)+' / '+(session.length?formatTime(session.length):'手动结束');app.dataset.clipSeconds=session.seconds.toFixed(2);
    if(session.seconds>=(session.length||180))finishClip(session.length?'录制时长已到':'已达到 3 分钟，录制已结束');
    else if(activeId!==session.trackId||externalStream)finishClip('音乐来源变化，已结束录制');
    else if(audioContext?.state==='suspended')finishClip('音频暂停，已结束录制');
  }
  function finishClip(reason='录制已结束',discard=false){
    const session=clipSession;if(!session||clipPhase==='stopping')return;
    session.reason=reason;session.discard=discard;session.seconds=session.startedAt?(performance.now()-session.startedAt)/1000:0;
    clipPhase='stopping';clearInterval(session.timer);clipUpdateControls();
    if(session.instrument)endInstrumentFilm();else if(playing&&(session.recorder||session.startedPlayback))pause();
    clipSetStatus(discard?reason:'正在整理短片，请稍候…');
    if(session.recorder&&session.recorder.state!=='inactive'){session.recorder.stop();session.watchdog=setTimeout(()=>clipFail(session,'浏览器没有完成短片，请重新录制。'),8000)}
    else if(session.recorder&&session.startedAt)completeClip(session);else{clipCleanup(session);clipSession=null;clipPhase=clipBlob?'preview':'idle';clipSetStatus(reason);clipUpdateControls()}
  }
  function clipFail(session,message){
    if(clipSession!==session)return;if(session.instrument)endInstrumentFilm();session.discard=true;try{session.recorder?.stop()}catch{}clipCleanup(session);clipSession=null;clipPhase=clipBlob?'preview':'error';if(playing&&session.startedPlayback)pause();if(clipBlob)clipShowResult();else clipShowLive();clipSetStatus(message,true);clipUpdateControls();
  }
  async function completeClip(session){
    if(clipSession!==session)return;
    if(clipPhase==='recording'){clipPhase='stopping';session.seconds=(performance.now()-session.startedAt)/1000;session.reason='录制已结束';if(session.instrument)endInstrumentFilm();else if(playing)pause()}
    clipCleanup(session);
    if(session.discard){clipSession=null;clipPhase=clipBlob?'preview':'idle';clipSetStatus(session.reason);clipUpdateControls();return}
    try{
      if(session.seconds<.5||!session.chunks.length)throw new Error('录制时间太短，请录制至少一秒再结束。');
      const mime=session.recorder.mimeType||session.chunks[0].type||'video/webm';let blob=new Blob(session.chunks,{type:mime});if(blob.size<1000)throw new Error('短片没有生成完整内容，请再试一次。');
      if(mime.includes('webm'))blob=await clipWebmDuration(blob,session.seconds);
      if(clipSession!==session)return;const newUrl=URL.createObjectURL(blob),oldUrl=clipUrl;
      $('clipVideo').pause();$('clipVideo').removeAttribute('src');$('clipVideo').load();clipBlob=blob;clipUrl=newUrl;clipMeta={song:session.song||session.trackName,seconds:session.seconds,width:session.width,height:session.height,shape:session.shape,extension:mime.includes('mp4')?'mp4':'webm'};
      $('clipVideo').src=newUrl;$('clipVideo').hidden=false;$('clipCanvas').hidden=true;clipShowingResult=true;clipSession=null;clipPhase='preview';if(oldUrl)URL.revokeObjectURL(oldUrl);
      $('clipResult').textContent=clipMeta.song+' · '+formatTime(session.seconds)+' · '+clipMeta.width+' × '+clipMeta.height+' · '+(blob.size/1048576).toFixed(1)+' MB · '+clipMeta.extension.toUpperCase();
      clipSetStatus((session.reason||'录制完成')+'。点击画面播放，满意后下载。');clipUpdateControls();
    }catch(error){clipFail(session,error.message||'短片整理失败，请重新录制。')}
  }
  // MediaRecorder WebM omits its duration. Add Info Duration only for a stream
  // with an unknown Segment length and no seek table to invalidate.
  async function clipWebmDuration(blob,seconds){
    const bytes=new Uint8Array(await blob.arrayBuffer());
    function element(at){let n=1;while(n<=8&&!(bytes[at]&(128>>(n-1))))n++;if(n>8)return null;const idLen=n;let id=0;for(let i=0;i<n;i++)id=id*256+bytes[at+i];at+=n;n=1;while(n<=8&&!(bytes[at]&(128>>(n-1))))n++;if(n>8)return null;let size=bytes[at]&((128>>(n-1))-1),unknown=size===((128>>(n-1))-1);for(let i=1;i<n;i++){unknown=unknown&&bytes[at+i]===255;size=size*256+bytes[at+i]}return{id,idLen,sizeLen:n,size,unknown,header:at+n}}
    let at=0,segment=null;while(at<bytes.length){const el=element(at);if(!el)break;if(el.id===0x18538067){segment=el;break}at=el.header+el.size}
    if(!segment?.unknown)return blob;at=segment.header;
    while(at<bytes.length){const el=element(at);if(!el||el.id===0x114d9b74)return blob;if(el.id===0x1549a966){
        const end=el.header+el.size;let child=el.header,scale=1000000;while(child<end){const c=element(child);if(!c)return blob;if(c.id===0x4489)return blob;if(c.id===0x2ad7b1){scale=0;for(let i=c.header;i<c.header+c.size;i++)scale=scale*256+bytes[i]}child=c.header+c.size}
        if(!scale)return blob;const durationBytes=new Uint8Array(11);durationBytes.set([0x44,0x89,0x88]);new DataView(durationBytes.buffer).setFloat64(3,seconds*1000000000/scale,false);
        let value=el.size+11;if(value>=Math.pow(2,7*el.sizeLen)-1)return blob;const sizeBytes=new Uint8Array(el.sizeLen);for(let i=sizeBytes.length-1;i>=0;i--){sizeBytes[i]=value%256;value=Math.floor(value/256)}sizeBytes[0]|=128>>(el.sizeLen-1);
        const prefix=bytes.slice(0,el.header);prefix.set(sizeBytes,el.header-el.sizeLen);return new Blob([prefix,bytes.slice(el.header,end),durationBytes,bytes.slice(end)],{type:blob.type});
      }if(el.unknown)return blob;at=el.header+el.size}
    return blob;
  }
  async function startClip(){
    if(clipLocked()||filmAnalyzing||externalStream||externalPending||!clipSupported()||!libraryReady||busy||pendingFile||(!currentTrack()&&!clipInstrumentMode))return;
    const moment=clipMoment;
    const beforePlaying=playing;
    if(moment&&(moment.trackId!==activeId||moment.position>=duration-.8)){
      clipSetStatus('这段音乐已切换或临近结尾，请重新收藏一刻。',true);return;
    }
    let pendingSegment=clipSegment?.id===activeId&&clipSegment.end>clipSegment.start?clipSegment:null;
    if(!moment&&!clipInstrumentMode&&!filmCurrentAnalysis()){
      clipSetStatus('正在分析歌曲，请稍候…');clipUpdateControls();
      await analyzeFilmStory();
      if(!filmCurrentAnalysis()){clipSetStatus('歌曲分析没有完成，请重新分析后再录制。',true);return}
    }
    if(!moment&&!clipInstrumentMode){
      const analysis=filmCurrentAnalysis();
      if(pendingSegment){
        applyFilmEdit(pendingSegment.start,Math.min(analysis.sourceDuration,pendingSegment.end)-pendingSegment.start);
      }else if(!clipSegment||clipSegment.id!==activeId||clipSegment.end>analysis.sourceDuration||clipSegment.end-clipSegment.start<.25){
        applyFilmEdit(analysis.timeline.section.start);
      }
    }
    if(!moment&&!clipInstrumentMode)prepareSegmentFilm();
    if(!moment)clipSaveSettings();
    const sessionLength=moment?Math.min(15,duration-moment.position):clipInstrumentMode?clipLength:
      (clipLength?Math.min(clipLength,filmCurrentAnalysis()?.timeline.section.length||filmSourceLength()):0);
    const session={instrument:clipInstrumentMode&&instrumentOpen,trackId:activeId,
      trackName:clipInstrumentMode?instrumentProject.title:currentTrack().name,shape:clipShape,
      width:clipShape==='portrait'?720:1280,height:clipShape==='portrait'?1280:720,length:sessionLength,
      song:$('clipSong').value.slice(0,80),author:$('clipAuthor').value.slice(0,24),mood:$('clipMood').value.slice(0,90),
      chunks:[],bytes:0,seconds:0,beforePlaying,moment,storyTimeline:clipInstrumentMode?null:filmCurrentAnalysis()?.timeline||null};
    clipSession=session;clipPhase='preparing';clipShowLive();clipUpdateControls();clipSetStatus('正在准备音乐与画面…');
    try{
      initAudio();await audioContext.resume();if(clipSession!==session)return;
      if(session.instrument)initInstrumentAudio();else if(mode==='demo'&&!demoBuffers.has(activeId)){busy=true;try{await buildDemo(currentTrack())}finally{busy=false;renderActiveTrack()}}
      if(clipSession!==session)return;if(activeId!==session.trackId||externalStream)throw new Error('音乐来源已变化，请重新开始。');
      if(moment){
        if(Math.abs(getLocalPosition()-moment.position)>.03){
          if(!seekTo(moment.position,{allowClip:true}))throw new Error('无法定位到收藏的位置。');
          if(audio.seeking)await new Promise((resolve,reject)=>{
            const complete=()=>{clearTimeout(timer);resolve();};
            const timer=setTimeout(()=>{
              audio.removeEventListener('seeked',complete);
              reject(new Error('定位收藏位置超时。'));
            },3000);
            audio.addEventListener('seeked',complete,{once:true});
          });
        }
        if(clipSession!==session)return;
      }else if(!session.instrument&&getLocalPosition()>=duration-.05){if(mode==='demo')offset=0;else audio.currentTime=0}
      // Prefer VP8 for reliable startup across consecutive landscape/portrait recordings.
      const types=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/webm','video/mp4'];const mime=types.find(t=>MediaRecorder.isTypeSupported(t));if(!mime)throw new Error('浏览器没有可用的视频编码，请在新版 Edge 或 Chrome 重试。');
      session.destination=audioContext.createMediaStreamDestination();session.gain=audioContext.createGain();session.gain.gain.value=.9;analyser.connect(session.gain);session.gain.connect(session.destination);
      renderClipFrame(true);session.capture=$('clipCanvas').captureStream(reduced?15:30);session.stream=new MediaStream([...session.capture.getVideoTracks(),...session.destination.stream.getAudioTracks()]);
      session.recorder=new MediaRecorder(session.stream,{mimeType:mime,videoBitsPerSecond:4000000,audioBitsPerSecond:192000});
      session.recorder.ondataavailable=e=>{if(clipSession!==session||!e.data.size)return;session.chunks.push(e.data);session.bytes+=e.data.size;if(session.bytes>80*1048576&&clipPhase==='recording')finishClip('短片达到 80 MB，已结束录制')};
      session.recorder.onerror=()=>clipFail(session,'浏览器录制失败，原有短片仍保留，请重新录制。');session.recorder.onstop=()=>completeClip(session);
      if(!session.instrument&&!playing){session.startedPlayback=true;await play(true)}
      if(clipSession!==session||clipPhase!=='preparing'){if(session.startedPlayback&&playing)pause();return}
      if(!session.instrument&&!playing)throw new Error('音乐未能播放，请先确认歌曲能正常播放后再录制。');
      session.startedAt=performance.now();session.recorder.start(500);clipPhase='recording';session.timer=setInterval(()=>clipTick(session),100);clipShowLive();clipUpdateControls();startAnimation();
      if(session.instrument){beginInstrumentFilm();clipSetStatus("正在录制你的演奏，点音垫或用键盘开始。");updateInstrumentControls();renderInstrumentLayers();return}
      if(clipSession!==session)return;
      const remaining=Math.max(0,duration-getLocalPosition());clipSetStatus('正在录制'+(session.length?'，目标 '+session.length+' 秒':'，点「结束并预览」完成')+'。'+(session.length&&remaining<session.length?'歌曲会先结束，届时自动停止。':'请保持页面在前台。'));
    }catch(error){clipFail(session,error.message||'无法开始录制，请重试。')}
  }
  function setupFilm(){
    try{const prefs=JSON.parse(localStorage.getItem('sonic-universe-film')||'null');if(prefs){if(prefs.version===27&&prefs.filmToolVersion===1){if(['landscape','portrait'].includes(prefs.shape))clipShape=prefs.shape;if([0,15,30].includes(prefs.length))clipLength=prefs.length}if(typeof prefs.author==='string')clipAuthor=prefs.author.slice(0,24);if(typeof prefs.mood==='string')clipMood=prefs.mood.slice(0,90)}}catch{}
    app.append($('clipDialog'));$('clipBtn').addEventListener('click',()=>{clipSegment=null;clipInstrumentMode=false;openClip()});$('roamClipBtn').addEventListener('click',()=>{clipSegment=null;clipInstrumentMode=false;openClip()});
    $('clipRecordBtn').addEventListener('click',startClip);$('clipStopBtn').addEventListener('click',()=>finishClip());$('clipViewBtn').addEventListener('click',clipShowResult);
    function close(){if(clipLocked())finishClip(clipPhase==='preparing'?'已取消准备':'录制已结束');$('clipDialog').close()}
    $('closeClipBtn').addEventListener('click',close);$('clipDialog').addEventListener('cancel',e=>{e.preventDefault();close()});
    $('clipDialog').addEventListener('close',()=>{clipMoment=null;$('clipVideo').pause();wakeRoam();if(app.classList.contains('quiet'))$('roamSurface').focus({preventScroll:true})});
    document.querySelectorAll('[data-clip-shape]').forEach(b=>b.addEventListener('click',()=>{if(clipLocked())return;clipShape=b.dataset.clipShape;clipSaveSettings();clipShowLive();clipUpdateControls();renderClipFrame(true)}));
    document.querySelectorAll('[data-clip-length]').forEach(b=>b.addEventListener('click',async()=>{if(clipLocked())return;clipLength=Number(b.dataset.clipLength);clipSaveSettings();if(filmCurrentAnalysis()){applyFilmEdit(null);clipSetStatus('已按 '+clipLength+' 秒重新编排四章：'+formatTime(filmCurrentAnalysis().timeline.section.start)+' → '+formatTime(filmCurrentAnalysis().timeline.section.end)+'。');renderClipFrame(true)}else{clipUpdateControls();await analyzeFilmStory()}clipUpdateControls()}));
    $('filmStoryAnalyze').addEventListener('click',()=>analyzeFilmStory({force:true}));
    $('filmStoryUseRecommendation').addEventListener('click',()=>{const analysis=filmCurrentAnalysis();if(!analysis)return;applyFilmEdit(analysis.recommendation.start);clipSetStatus('已使用推荐片段 '+formatTime(analysis.timeline.section.start)+' → '+formatTime(analysis.timeline.section.end)+'。');renderClipFrame(true)});
    $('filmStoryUseStart').addEventListener('click',()=>{if(!filmCurrentAnalysis())return;applyFilmEdit($('filmStoryStart').value);clipSetStatus('已应用新的起点 '+formatTime(filmCurrentAnalysis().timeline.section.start)+'，四章已重新排列。');renderClipFrame(true)});
    $('filmStoryStart').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('filmStoryUseStart').click()}});
    for(const id of ['clipSong','clipAuthor','clipMood'])$(id).addEventListener('input',()=>{clipSaveSettings();clipShowLive();clipUpdateControls();renderClipFrame(true)});
    $('clipSaveBtn').addEventListener('click',()=>{if(!clipBlob||!clipMeta||clipLocked())return;const link=document.createElement('a');link.href=clipUrl;link.download='声波宇宙-'+clipMeta.song.replace(/[<>:"/\\|?*]/g,'').slice(0,60)+'-'+(clipMeta.shape==='portrait'?'竖屏':'横屏')+'.'+clipMeta.extension;document.body.append(link);link.click();link.remove();clipSetStatus('已请求下载 '+clipMeta.extension.toUpperCase()+' 短片，可在浏览器下载列表查看。')});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&clipLocked())finishClip('页面切到后台，已结束录制')});
    window.addEventListener('pagehide',()=>{const session=clipSession;if(session){session.discard=true;session.recorder&&(session.recorder.onstop=null);try{session.recorder?.stop()}catch{}clipCleanup(session);clipSession=null}if(clipUrl)URL.revokeObjectURL(clipUrl)});clipUpdateControls();
  }

  // Versioned creative data lives beside the library, so older metadata stays intact.
  const moodPresets={
    night:{mood:'night',name:'深夜独处',theme:'nebula',visualMode:'ring',motionSpeed:.55,particleCount:1800,intensity:.55,sensitivity:1.3,journeyAuto:false,storyEnabled:true},
    travel:{mood:'travel',name:'星际远行',theme:'galaxy',visualMode:'galaxy',motionSpeed:1.2,particleCount:3400,intensity:.8,sensitivity:1,journeyAuto:false,storyEnabled:true},
    heal:{mood:'heal',name:'温柔治愈',theme:'solar',visualMode:'ring',motionSpeed:.45,particleCount:2200,intensity:.6,sensitivity:1.25,journeyAuto:false,storyEnabled:true},
    burst:{mood:'burst',name:'能量爆发',theme:'nebula',visualMode:'peaks',motionSpeed:1.5,particleCount:4400,intensity:.95,sensitivity:.8,journeyAuto:false,storyEnabled:true}
  };
  let atelier={version:1,settings:{sensitivity:1,interaction:.65,breathing:true,transition:true,mood:null},custom:{},songs:{},memories:[]};
  let atelierReady=false,atelierPromise=null,atelierTab='mood',moodSlot=null,breath=.6,lifeMotion=0,seekVisualTarget=null,seekVisualLeft=0;
  let trackGain=null,trackTravel=0,trackTravelAge=2,lyricIndex=-1,lyricTrack=null,lyricPosition=0,lyricDust=[],lyricCache=null;
  let touchDust=[],touchRipples=[],touchHold=null,touchPlanet=0,touchLastAt=0,cueActive=null,cueTrack=null,cuePosition=-1,cueText='',cueTextUntil=0;
  let clipSegment=null,segmentPreview=false,atelierReadoutAt=0,memoryHold=false;
  function finite(v,fallback,lo,hi){return Number.isFinite(v)?clamp(v,lo,hi):fallback}
  function validLook(v){
    if(!v||typeof v!=='object')return null;
    return {mood:Object.hasOwn(moodPresets,v.mood)?v.mood:null,theme:Object.hasOwn(themes,v.theme)?v.theme:'nebula',visualMode:Object.hasOwn(visualModes,v.visualMode)?v.visualMode:'ring',motionSpeed:finite(v.motionSpeed,1,.25,2),particleCount:Math.round(finite(v.particleCount,2400,400,6000)/200)*200,intensity:finite(v.intensity,.7,.2,1),energySaver:typeof v.energySaver==='boolean'?v.energySaver:energySaver,sensitivity:finite(v.sensitivity,1,.4,2.4),journeyAuto:typeof v.journeyAuto==='boolean'?v.journeyAuto:true,storyEnabled:typeof v.storyEnabled==='boolean'?v.storyEnabled:true,depth:finite(v.depth,.65,0,1),glow:finite(v.glow,.6,0,1),trail:finite(v.trail,.55,0,1),response:['soft','balanced','strong'].includes(v.response)?v.response:'balanced',beat:v.beat===true};
  }
  function captureLook(){return{mood:moodSlot,theme:themeKey,visualMode,motionSpeed,particleCount,intensity,energySaver,sensitivity:atelier.settings.sensitivity,journeyAuto,storyEnabled,...visualEffects}}
  function moodCameraActive(){return Boolean(moodSlot&&!journeyAuto&&!externalStream&&!instrumentOpen)}
  function applyLook(raw,save=false){
    const look=validLook(raw);if(!look)return;
    if(energySaver!==look.energySaver){energySaver=look.energySaver;resize()}
    visualEffects={depth:look.depth,glow:look.glow,trail:look.trail,response:look.response,beat:look.beat};syncEffects();moodSlot=look.mood;atelier.settings.mood=moodSlot;setTheme(look.theme,false);setVisualMode(look.visualMode,false);motionSpeed=look.motionSpeed;intensity=look.intensity;refinement.profile=look.response;
    if(particleCount!==look.particleCount){particleCount=look.particleCount;rebuildParticles()}
    atelier.settings.sensitivity=look.sensitivity;journeyAuto=typeof look.journeyAuto==='boolean'?look.journeyAuto:journeyAuto;storyEnabled=typeof look.storyEnabled==='boolean'?look.storyEnabled:storyEnabled;
    $('intensity').value=Math.round(intensity*100);$('intensityValue').value=Math.round(intensity*100)+'%';setFill($('intensity'));updateVisualControls();updateStoryToggle();updateJourneyToggle();
    if(save){savePreferences();rememberLook()}syncMoodControls();
  }
  function songArt(create=false){
    if(!activeId)return null;
    if(!Object.hasOwn(atelier.songs,activeId)&&create)atelier.songs[activeId]={};
    return Object.hasOwn(atelier.songs,activeId)?atelier.songs[activeId]:null;
  }
  function rememberLook(){if(!atelierReady||restoring||externalStream||!activeId)return;songArt(true).look=captureLook();persistAtelier()}
  function persistAtelier(){
    if(!atelierReady)return Promise.resolve(false);
    const snapshot=JSON.parse(JSON.stringify(atelier));
    return queueStorage('atelier',async db=>{const tx=db.transaction('state','readwrite'),done=transactionDone(tx);tx.objectStore('state').put(snapshot,'atelier');await done});
  }
  function restoreLyricSettings(value){
    return {raw:value.raw.slice(0,160000),translationRaw:typeof value.translationRaw==='string'?value.translationRaw.slice(0,160000):'',origin:['sidecar','embedded','online','manual','bundled'].includes(value.origin)?value.origin:'',offset:finite(value.offset,0,-30,30),size:['small','medium','large'].includes(value.size)?value.size:'medium',only:value.only!==false,enabled:value.enabled!==false};
  }
  async function loadAtelier(){
    try{
      const db=await openLibraryDB(),tx=db.transaction('state','readonly'),done=transactionDone(tx),v=await requestValue(tx.objectStore('state').get('atelier'));await done;
      if(v&&v.version===1){
        const s=v.settings||{};Object.assign(atelier.settings,{sensitivity:finite(s.sensitivity,1,.4,2.4),interaction:finite(s.interaction,.65,0,1),breathing:s.breathing!==false,transition:s.transition!==false,mood:Object.hasOwn(moodPresets,s.mood)?s.mood:null});
        for(const key of Object.keys(moodPresets)){const look=validLook(v.custom?.[key]);if(look)atelier.custom[key]=look}
        if(v.songs&&typeof v.songs==='object')for(const [id,song] of Object.entries(v.songs)){
          if(id!=='demo'&&id!==bundledSample.id&&!id.startsWith('track-')&&!/^online:qishui:\d{1,30}$/.test(id))continue;
          if(!song||typeof song!=='object')continue;
          const result={};if(song.look)result.look=validLook(song.look);
          if(song.lyrics&&typeof song.lyrics.raw==='string')result.lyrics=restoreLyricSettings(song.lyrics);
          if(Number.isFinite(song.lyricOffset))result.lyricOffset=finite(song.lyricOffset,0,-30,30);
          if(song.segment)result.segment={a:finite(song.segment.a,0,0,86400),b:finite(song.segment.b,15,0,86400),loop:song.segment.loop===true};
          result.cuesEnabled=song.cuesEnabled!==false;result.base=validCue(song.base);result.cues=Array.isArray(song.cues)?song.cues.map(validCue).filter(Boolean).slice(0,60).sort((a,b)=>a.time-b.time):[];atelier.songs[id]=result;
        }
        atelier.memories=Array.isArray(v.memories)?v.memories.filter(m=>m&&typeof m.id==='string'&&typeof m.trackId==='string'&&Number.isFinite(m.position)&&validLook(m.look)).slice(0,50).map(m=>({...m,note:String(m.note||'').slice(0,100),name:String(m.name||'未命名音乐').slice(0,160),thumb:typeof m.thumb==='string'&&m.thumb.startsWith('data:image/')?m.thumb:null,look:validLook(m.look)})):[];
      }
    }catch{storageIssues.add('atelier')}
    atelierReady=true;moodSlot=atelier.settings.mood;await libraryPromise;atelierTrackReady(false);syncMoodControls();renderMemories();updateStorageStatus();app.dataset.atelierReady='true';
  }
  function syncMoodControls(){
    if(!$('atelierTheme'))return;
    $('atelierTheme').value=themeKey;$('atelierMode').value=visualMode;
    const values={atelierIntensity:Math.round(intensity*100),atelierSpeed:Math.round(motionSpeed*100),atelierParticles:particleCount,sensitivity:Math.round(atelier.settings.sensitivity*100),touchStrength:Math.round(atelier.settings.interaction*100)};
    for(const [id,value] of Object.entries(values)){$(id).value=value;setFill($(id))}
    $('atelierIntensityValue').textContent=values.atelierIntensity+'%';$('atelierSpeedValue').textContent=motionSpeed.toFixed(2)+'×';$('atelierParticlesValue').textContent=particleCount.toLocaleString('en-US');$('sensitivityValue').textContent=atelier.settings.sensitivity.toFixed(2)+'×';$('touchStrengthValue').textContent=values.touchStrength+'%';
    $('breathingToggle').checked=atelier.settings.breathing;$('travelToggle').checked=atelier.settings.transition;
    document.querySelectorAll('[data-mood]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mood===moodSlot)));
    $('atelierMoodLabel').textContent=moodSlot?moodPresets[moodSlot].name:'让星空有你的心情';
    $('saveMoodBtn').textContent=moodSlot?'保存到「'+moodPresets[moodSlot].name+'」':'保存这份心情';$('resetMoodBtn').disabled=!moodSlot;
  }
  function showAtelierTab(tab){atelierTab=tab;document.querySelectorAll('[data-atelier-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.atelierTab===tab)));document.querySelectorAll('[data-atelier-panel]').forEach(p=>p.hidden=p.dataset.atelierPanel!==tab)}
  async function openAtelier(){
    await atelierPromise;await libraryPromise;if(clipLocked()){showToast('请先结束短片录制，再打开创作台。');return}
    syncMoodControls();syncSongControls();renderMemories();showAtelierTab(atelierTab);$('atelierDialog').showModal();wakeRoam();
  }
  function atelierTrackReady(transition=true){
    memoryHold=false;lyricTrack=null;lyricCache=null;lyricIndex=-1;lyricDust=[];cueTrack=null;cueActive=null;cuePosition=-1;cueText='';clipSegment=null;segmentPreview=false;
    if(atelierReady&&!restoring&&songArt()?.look)applyLook(songArt().look);
    if(atelierReady&&transition&&!restoring&&atelier.settings.transition){trackTravelAge=0;trackTravel=1}
    syncSongControls();
  }
  function fadeLocalIn(){
    if(!trackGain||!audioContext)return;const t=audioContext.currentTime;trackGain.gain.cancelScheduledValues(t);trackGain.gain.setValueAtTime(atelier.settings.transition&&!clipLocked()?0:1,t);trackGain.gain.linearRampToValueAtTime(1,t+.35);
  }
  async function fadeLocalOut(token){
    if(!playing||!trackGain||!atelier.settings.transition||restoring)return true;
    const t=audioContext.currentTime,g=generation;trackGain.gain.cancelScheduledValues(t);trackGain.gain.setValueAtTime(trackGain.gain.value,t);trackGain.gain.linearRampToValueAtTime(0,t+.18);
    await new Promise(resolve=>setTimeout(resolve,185));return token===loadGeneration&&g===generation&&!clipLocked();
  }
  function beginSeekVisual(position){
    seekVisualTarget=position*.8*motionSpeed;seekVisualLeft=reduced?0:.85;cuePosition=-1;lyricPosition=-1;lyricDust=[];musicResponse.reset();
    if(reduced){sceneTime=seekVisualTarget;seekVisualTarget=null}
  }
  function parseLRC(raw){return SonicLyricKaraoke.parse(raw)}
  function lyricOffset(){const art=songArt();return art?.lyrics?.offset??art?.lyricOffset??0;}
  function nudgeLyrics(delta){
    if(!atelierReady||externalStream||instrumentOpen||!activeId||![-.1,0,.1].includes(delta))return null;
    const saved=currentLyrics();
    if(saved?.enabled===false||!(saved?.lines.length||(mode==='online'&&onlineTimedLyrics.length)))return null;
    const next=delta===0?0:clamp((Math.round(lyricOffset()*10)+Math.sign(delta))/10,-30,30);
    const art=songArt(true);
    if(art.lyrics)art.lyrics.offset=next;else art.lyricOffset=next;
    $('lyricOffset').value=$('lyricOffsetRange').value=next;
    lyricIndex=-1;lyricTrack=null;lyricPosition=-1;
    void persistAtelier();updateTimeline();window.dispatchEvent(new Event('sonic:transport-state'));
    return next;
  }
  function currentLyrics(){if(instrumentOpen)return null;
    const saved=songArt()?.lyrics||(activeId===bundledSample.id?bundledLyrics:null);
    if(!saved)return null;
    const translationRaw=saved.translationRaw||'';
    if(!lyricCache||lyricCache.raw!==saved.raw||lyricCache.translationRaw!==translationRaw){
      const lines=parseLRC(saved.raw);
      lyricCache={raw:saved.raw,translationRaw,lines:translationRaw?SonicLyricKaraoke.mergeTranslations(lines,parseLRC(translationRaw)):lines};
    }
    return{...saved,offset:lyricOffset(),lines:lyricCache.lines};
  }
  function syncSongControls(restoreDraft=true){
    $('atelierSong').textContent=externalStream?'外部声音 · 氛围与触碰可用；歌词、收藏和排练用于本地歌曲':currentTrack()?.name||'先导入一首音乐，开始创作';
    const art=songArt(),lyrics=art?.lyrics||(activeId===bundledSample.id?currentLyrics():null),segment=art?.segment||{a:0,b:Math.min(15,duration),loop:false};
    $('lyricSource').value=lyrics?.raw||'';$('lyricOffset').value=lyrics?.offset||0;$('lyricOffsetRange').value=lyrics?.offset||0;$('lyricSize').value=lyrics?.size||'medium';$('lyricOnly').checked=lyrics?.only!==false;$('lyricEnabled').checked=lyrics?.enabled!==false;
    $('lyricStatus').textContent=lyrics?parseLRC(lyrics.raw).length+' 个时间点 · '+(lyrics.origin==='bundled'?'内置歌词':'已为这首歌保存'):'支持逐行 LRC 和逐字 YRC，歌词保存在本机。';$('lyricStatus').classList.remove('error');
    $('segmentA').value=segment.a;$('segmentB').value=segment.b;$('segmentLoop').checked=segment.loop;$('cuesEnabled').checked=art?.cuesEnabled!==false;for(const id of ['segmentA','segmentB','cueTime'])$(id).max=duration;
    const disabled=Boolean(externalStream||externalPending||!currentTrack()||pendingFile||busy);
    for(const id of ['saveLyricBtn','importLyricBtn','clearLyricBtn','saveMemoryBtn','previewSegmentBtn','recordSegmentBtn','addCueBtn','markABtn','markBBtn','cueNowBtn','segmentLoop','cuesEnabled','lyricOffset','lyricOffsetRange','lyricSize','lyricOnly','lyricEnabled'])$(id).disabled=disabled;
    renderCues();restoreSongDraft(restoreDraft);
  }
  function dissolveLyric(text){
    if(reduced||!text)return;const c=document.createElement('canvas');c.width=500;c.height=62;const g=c.getContext('2d');g.font='26px "Microsoft YaHei",sans-serif';g.textAlign='center';g.fillText(text,250,38,470);const data=g.getImageData(0,0,500,62).data;
    const dots=[];for(let y=9;y<52;y+=4)for(let x=5;x<495;x+=5)if(data[(y*500+x)*4+3]>90)dots.push({x:(x-250)/26,y:(y-31)/26,vx:(Math.random()-.5)*2,vy:-.3-Math.random()*1.5,age:0,life:1.1+Math.random()*.7});
    lyricDust=dots.filter((_,i)=>i%Math.max(1,Math.ceil(dots.length/120))===0);
  }
  function lyricLayout(){const immersive=exportRendering||app.classList.contains('quiet'),scale={small:.82,medium:1,large:1.25}[songArt()?.lyrics?.size||'medium'];return{x:centerX,y:centerY+baseR*(immersive?.92:.85),font:Math.max(12,Math.min(w*(immersive?.029:.025),26))*scale,width:Math.min(w*(immersive?.82:.52),610)}}
  function drawLyrics(){
    const lyrics=currentLyrics();if(externalStream||!lyrics?.enabled||!lyrics.lines.length)return;
    const {x,y,font,width}=lyricLayout(),line=lyrics.lines[lyricIndex],pos=getLocalPosition()-(lyrics.offset||0),end=line?Math.min(lyrics.lines[lyricIndex+1]?.time??duration,line.time+9):0;
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='400 '+font+'px "Microsoft YaHei UI",sans-serif';ctx.shadowColor=rgba(palette.core,.5);ctx.shadowBlur=12;
    if(line?.text&&pos<end){
      const fade=clamp((pos-line.time)/.35,0,1)*clamp((end-pos)/.65,0,1),lines=cardLines(ctx,line.text,width,2),lit=SonicLyricKaraoke.count(line,pos,end);let consumed=0;
      for(let i=0;i<lines.length;i++){const text=lines[i],chars=SonicLyricKaraoke.split(text),prefix=chars.slice(0,Math.max(0,lit-consumed)).join('');consumed+=chars.length;const yy=y+i*font*1.6;ctx.fillStyle=rgba(palette.hot,fade*.25);ctx.fillText(text,x,yy);if(prefix){const left=x-ctx.measureText(text).width/2;ctx.save();ctx.beginPath();ctx.rect(left-2,yy-font,ctx.measureText(prefix).width+2,font*2);ctx.clip();ctx.fillStyle=rgba(palette.hot,fade*.96);ctx.fillText(text,x,yy);ctx.restore()}}
      if(!lyrics.only){ctx.font='400 '+font*.65+'px "Microsoft YaHei",sans-serif';ctx.fillStyle=rgba(palette.core,fade*.3);ctx.fillText(lyrics.lines[lyricIndex-1]?.text||'',x,y-font*1.8,width);ctx.fillText(lyrics.lines[lyricIndex+1]?.text||'',x,y+font*(lines.length>1?3.3:2),width)}
    }
    ctx.shadowBlur=0;for(const p of lyricDust){const u=p.age/p.life;ctx.fillStyle=rgba(palette.hot,Math.pow(1-u,2)*.6);ctx.fillRect(x+(p.x+p.vx*p.age)*font,y+(p.y+p.vy*p.age)*font,1.3,1.3)}ctx.restore();
  }
  function saveView(){return{look:captureLook(),camera:{...camera},cinema:{...cinema},sceneTime,weights:{...sceneWeights}}}
  function restoreView(view){
    if(!view)return;applyLook(view.look);
    const c=view.camera||{},ci=view.cinema||{};camera.yaw=finite(c.yaw,0,-20,20);camera.pitch=finite(c.pitch,0,-1.2,1.2);camera.zoom=finite(c.zoom,1,.55,2.8);camera.targetYaw=camera.yaw;camera.targetPitch=camera.pitch;camera.targetZoom=camera.zoom;
    cinema.yaw=finite(ci.yaw,0,-20,20);cinema.pitch=finite(ci.pitch,0,-1.2,1.2);cinema.zoom=finite(ci.zoom,1,.5,2);cameraHeld=true;updateCameraButton();
  }
  async function saveMemory(){
    if(externalStream||!currentTrack()||clipLocked())return;if(atelier.memories.length>=50){$('memoryStatus').textContent='已收藏 50 个瞬间，移除一些后再收藏。';return}
    const preview=document.createElement('canvas');preview.width=256;preview.height=160;const g=preview.getContext('2d'),sw=Math.min(canvas.width,canvas.height*1.6),sh=sw/1.6;g.drawImage(canvas,clamp(centerX*dpr-sw/2,0,canvas.width-sw),clamp(centerY*dpr-sh/2,0,canvas.height-sh),sw,sh,0,0,256,160);
    const moment={...saveView(),id:newId('memory'),trackId:activeId,name:currentTrack().name,position:getLocalPosition(),note:$('memoryNote').value.trim().slice(0,100),date:new Date().toISOString(),thumb:preview.toDataURL('image/jpeg',.72)};
    atelier.memories.unshift(moment);renderMemories();$('memoryStatus').textContent='正在收藏…';const ok=await persistAtelier();$('memoryStatus').textContent=ok?'已收藏，未来可以回到这一刻。':'保留在本页，暂时未能存入本机。';if(ok)$('memoryNote').value='';captureSongDraft();saveDrafts();commitRecovery('atelier');
  }
  function renderMemories(){
    const list=$('memoryList');list.replaceChildren();$('memoryCount').textContent=atelier.memories.length+' / 50';if(!atelier.memories.length){const empty=document.createElement('li');empty.className='memory-empty';empty.textContent='星光还没有坐标。\n在喜欢的那一秒，留下一句心情。';list.append(empty);return}
    for(const m of atelier.memories){
      const item=document.createElement('li');item.className='memory-card';if(m.thumb){const img=document.createElement('img');img.src=m.thumb;img.alt='收藏时的星空';item.append(img)}
      const content=document.createElement('div'),title=document.createElement('strong'),note=document.createElement('p'),meta=document.createElement('small'),actions=document.createElement('div');actions.className='memory-actions';title.textContent=m.name+' · '+formatTime(m.position);note.textContent=m.note||'那一刻，星光刚好。';meta.textContent=(m.date||'').slice(0,10)+' · '+(themes[m.look?.theme]?.name||'星空');
      const back=document.createElement('button'),remove=document.createElement('button');back.className=remove.className='text-btn';back.textContent='回到此刻 ↗';back.disabled=!tracks.some(t=>t.id===m.trackId);if(back.disabled)back.title='这首歌已从音乐库移除';remove.textContent='移除';back.addEventListener('click',()=>recallMemory(m));remove.addEventListener('click',()=>{atelier.memories=atelier.memories.filter(v=>v.id!==m.id);persistAtelier();renderMemories()});actions.append(back,remove);content.append(title,note,meta,actions);item.append(content);list.append(item);
    }
  }
  async function recallMemory(m){
    if(clipLocked())return;await selectTrack(m.trackId,false,m.position);if(activeId!==m.trackId||pendingFile)return;
    restoreView(m);sceneTime=finite(m.sceneTime,0,0,100000);seekVisualTarget=null;seekVisualLeft=0;
    if(m.weights)for(const key of Object.keys(sceneWeights))sceneWeights[key]=finite(m.weights[key],key==='ring'?1:0,0,1);
    memoryHold=true;cueTrack=activeId;cueActive='memory';cuePosition=getLocalPosition();savePreferences();$('atelierDialog').close();setQuiet(true);showToast('已回到 '+formatTime(m.position)+' · 按播放，让这段记忆继续。');
  }
  function validCue(c){if(!c||!validLook(c.look))return null;return{...c,id:typeof c.id==='string'?c.id:newId('cue'),time:finite(c.time,0,0,86400),text:String(c.text||'').slice(0,60),burst:c.burst!==false,look:validLook(c.look)}}
  function readSegment(){
    const a=Number($('segmentA').value),b=Number($('segmentB').value);if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>duration+.01||b-a<1){$('segmentStatus').textContent='请设置有效的 A、B：起点不小于 0，终点在歌曲内，间隔至少 1 秒。';$('segmentStatus').classList.add('error');return null}
    $('segmentStatus').classList.remove('error');return{a,b,loop:$('segmentLoop').checked};
  }
  function saveSegment(){const segment=readSegment();if(!segment)return null;songArt(true).segment=segment;persistAtelier();$('segmentStatus').textContent=formatTime(segment.a)+' → '+formatTime(segment.b)+' · '+(segment.loop?'循环排练已开启':'片段已记住');return segment}
  async function previewSegment(record=false){
    if(externalStream||clipLocked()||!currentTrack())return;const segment=saveSegment();if(!segment)return;
    if(record&&segment.b-segment.a>180){$('segmentStatus').textContent='短片最长 3 分钟，请把片段缩短到 180 秒内再录制。';return}
    pause();seekTo(segment.a);cueTrack=null;cueActive=null;cuePosition=-1;$('atelierDialog').close();
    if(record){clipSegment={id:activeId,start:segment.a,end:segment.b};clipLength=0;openClip();clipSetStatus('已准备 '+formatTime(segment.a)+' → '+formatTime(segment.b)+'。开始录制后到 B 自动收片。')}
    else{segmentPreview=true;setQuiet(true);await play();showToast(segment.loop?'循环排练已开始，创作台可关闭循环。':'正在预演，到 B 暂停。')}
  }
  function prepareSegmentFilm(){
    if(!clipSegment)return;if(clipSegment.id!==activeId||clipSegment.end>duration||clipSegment.end-clipSegment.start<1){clipSegment=null;return}
    pause();seekTo(clipSegment.start);cueTrack=null;cuePosition=-1;cueActive=null;segmentPreview=false;
  }
  function atelierLoopAtEnd(){const s=songArt()?.segment;if(!externalStream&&!clipLocked()&&s&&s.b>=duration-.12&&s.b-s.a>=1){if(s.loop){seekTo(s.a);play();return true}if(segmentPreview){segmentPreview=false;updatePlaying();updateTimeline();saveSession();return true}}return false}
  let selectedCueId='',selectedCueTrack='',cueDrag=null;
  function selectedCue(){return selectedCueTrack===activeId?(songArt()?.cues||[]).find(c=>c.id===selectedCueId):null}
  function cueEditable(){return Boolean(activeId&&currentTrack()&&!externalStream&&!externalPending&&!pendingFile&&!busy&&!clipLocked())}
  function cueEditorMessage(text,error=false){$('cueEditorStatus').textContent=text;$('cueEditorStatus').classList.toggle('error',error)}
  function updateCuePlayhead(){const el=$('cuePlayhead');if(el)el.style.left=(clamp(getLocalPosition()/Math.max(.1,duration),0,1)*100)+'%'}
  function selectCue(id,preview=true){
    selectedCueTrack=activeId;selectedCueId=id||'';const c=selectedCue();
    if(c){$('cueTime').value=c.time.toFixed(1);$('cueText').value=c.text;$('cueBurst').checked=c.burst;cueEditorMessage('已选中 '+c.time.toFixed(1)+' 秒 · 拖动、方向键或输入秒数调整；修改会自动保存。');if(preview&&cueEditable()){pause();seekTo(c.time);cueTrack=null;cuePosition=-1;updateCues(c.time)}}
    else{selectedCueId='';$('cueTime').value=getLocalPosition().toFixed(1);$('cueText').value='';$('cueBurst').checked=true;cueEditorMessage('点击轨道或「记下当前配色与视角」添加时间点。')}
    app.dataset.selectedCueId=selectedCueId;renderCues();
  }
  function finishCueEdit(gesture=null){const art=songArt();if(art?.cues)art.cues.sort((a,b)=>a.time-b.time);cueTrack=null;cuePosition=-1;persistAtelier();captureSongDraft();scheduleDraftSave();commitRecovery('atelier',gesture);renderCues()}
  function addCueAt(time){
    if(!cueEditable())return;const art=songArt(true);if(!Number.isFinite(time)||time<0||time>duration){cueEditorMessage('时间点需要在这首歌的长度内。',true);return}
    art.cues||=[];if(art.cues.length>=60){cueEditorMessage('已添加 60 个时间点，请先移除一些。',true);return}
    historyFor('atelier');if(!art.base)art.base={...saveView(),id:'base',time:0,text:'',burst:false};
    const c={...saveView(),id:newId('cue'),time:Math.round(time*10)/10,text:$('cueText').value.trim().slice(0,60),burst:$('cueBurst').checked};art.cues.push(c);selectedCueTrack=activeId;selectedCueId=c.id;selectCue(c.id,false);finishCueEdit();cueEditorMessage('已添加 '+c.time.toFixed(1)+' 秒的画面、视角和文字，可撤销。');
  }
  function removeCue(id=selectedCueId){if(!cueEditable()||!(songArt()?.cues||[]).some(c=>c.id===id))return;historyFor('atelier');songArt().cues=songArt().cues.filter(c=>c.id!==id);if(selectedCueId===id)selectedCueId='';finishCueEdit();cueEditorMessage('已删除时间点，可撤销恢复。')}
  function renderCues(){
    const list=$('cueList'),track=$('cueTimelineTrack');if(!list||!track)return;list.replaceChildren();track.querySelectorAll('.cue-marker').forEach(el=>el.remove());const cues=songArt()?.cues||[];
    if(selectedCueTrack!==activeId||!cues.some(c=>c.id===selectedCueId)){selectedCueId='';selectedCueTrack=activeId}app.dataset.selectedCueId=selectedCueId;app.dataset.cueCount=String(cues.length);
    $('cueDeleteBtn').disabled=!selectedCueId||!cueEditable();$('cueNewBtn').disabled=!cueEditable();$('cueTimeline').dataset.disabled=String(!cueEditable());
    $('cueTimelineScale').replaceChildren(...[0,.25,.5,.75,1].map(part=>{const el=document.createElement('span');el.textContent=formatTime(duration*part);return el}));updateCuePlayhead();
    if(!cues.length){const li=document.createElement('li');li.className='memory-empty';li.textContent='点击上方轨道，给星空添加第一个时间点。';list.append(li)}
    for(const c of cues){
      const marker=document.createElement('button');marker.type='button';marker.className='cue-marker';marker.dataset.cueId=c.id;marker.style.left=(clamp(c.time/Math.max(.1,duration),0,1)*100)+'%';marker.setAttribute('aria-label',c.time.toFixed(1)+' 秒，'+(c.text||'镜头变换')+'；方向键微调，Delete 删除');marker.setAttribute('aria-pressed',String(c.id===selectedCueId));marker.disabled=!cueEditable();track.append(marker);
      const li=document.createElement('li');li.className='cue-row';li.dataset.selected=String(c.id===selectedCueId);const time=document.createElement('time'),body=document.createElement('span'),small=document.createElement('small'),back=document.createElement('button'),remove=document.createElement('button');time.textContent=c.time.toFixed(1)+'s';body.textContent=c.text||'一次镜头变换';small.textContent=themes[c.look.theme].name+' · '+visualModes[c.look.visualMode].name+(c.burst?' · 星尘绽放':'');back.textContent='↗';back.setAttribute('aria-label','选择并预览 '+formatTime(c.time)+' 的时间点');back.addEventListener('click',()=>selectCue(c.id));time.addEventListener('click',()=>selectCue(c.id));remove.textContent='×';remove.setAttribute('aria-label','移除此时间点');remove.addEventListener('click',()=>removeCue(c.id));back.disabled=remove.disabled=!cueEditable();body.append(small);li.append(time,body,back,remove);list.append(li);
    }
  }
  function setupCueTimeline(){
    const track=$('cueTimelineTrack');let suppressClick=false;
    const markerFor=id=>Array.from(track.querySelectorAll('.cue-marker')).find(el=>el.dataset.cueId===id);
    const timeAt=e=>Math.round(clamp((e.clientX-track.getBoundingClientRect().left)/Math.max(1,track.getBoundingClientRect().width),0,1)*duration*10)/10;
    track.addEventListener('pointerdown',e=>{const marker=e.target.closest('.cue-marker');if(!marker||!cueEditable()||e.button!==0)return;e.preventDefault();selectCue(marker.dataset.cueId);historyFor('atelier');cueDrag={id:selectedCueId,pointer:e.pointerId,startX:e.clientX,startTime:selectedCue().time,moved:false};track.setPointerCapture(e.pointerId)});
    track.addEventListener('pointermove',e=>{if(!cueDrag||cueDrag.pointer!==e.pointerId)return;if(Math.abs(e.clientX-cueDrag.startX)>2)cueDrag.moved=true;if(!cueDrag.moved)return;const c=selectedCue();if(!c)return;c.time=timeAt(e);$('cueTime').value=c.time.toFixed(1);const marker=markerFor(c.id);if(marker)marker.style.left=(c.time/Math.max(.1,duration)*100)+'%';cueEditorMessage('移动到 '+c.time.toFixed(1)+' 秒 · 松开后自动保存。')});
    const finish=e=>{if(!cueDrag||cueDrag.pointer!==e.pointerId)return;const moved=cueDrag.moved;cueDrag=null;suppressClick=true;setTimeout(()=>suppressClick=false,0);if(track.hasPointerCapture(e.pointerId))track.releasePointerCapture(e.pointerId);if(moved){finishCueEdit();cueEditorMessage('时间已更新，可撤销。')}markerFor(selectedCueId)?.focus()};
    track.addEventListener('pointerup',finish);track.addEventListener('pointercancel',finish);track.addEventListener('lostpointercapture',finish);
    track.addEventListener('click',e=>{if(suppressClick)return;const marker=e.target.closest('.cue-marker');if(marker)selectCue(marker.dataset.cueId);else addCueAt(timeAt(e))});
    track.addEventListener('keydown',e=>{const marker=e.target.closest('.cue-marker');if(!marker||!cueEditable())return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();selectedCueId=marker.dataset.cueId;selectedCueTrack=activeId;const c=selectedCue();historyFor('atelier');c.time=Math.round(clamp(c.time+(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1)*(e.shiftKey?1:.1),0,duration)*10)/10;$('cueTime').value=c.time.toFixed(1);finishCueEdit('cue-key:'+c.id);markerFor(c.id)?.focus();cueEditorMessage('时间已调整到 '+c.time.toFixed(1)+' 秒。')}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeCue(marker.dataset.cueId)}});
    $('cueNewBtn').addEventListener('click',()=>selectCue(''));$('cueDeleteBtn').addEventListener('click',()=>removeCue());
    for(const id of ['cueTime','cueText','cueBurst'])$(id).addEventListener(id==='cueBurst'?'change':'input',()=>{if(!cueEditable())return;const c=selectedCue();historyFor('atelier');if(!c){captureSongDraft();scheduleDraftSave();commitRecovery('atelier','cue-new-field:'+id);return}const time=Number($('cueTime').value);if(id==='cueTime'&&(!Number.isFinite(time)||time<0||time>duration)){cueEditorMessage('时间点需要在 0 到 '+duration.toFixed(1)+' 秒之间。',true);return}c.time=Math.round(time*10)/10;c.text=$('cueText').value.slice(0,60);c.burst=$('cueBurst').checked;finishCueEdit('cue-field:'+c.id+':'+id)});
  }
  function updateCues(pos){if(instrumentOpen){cueText="";return}
    if(memoryHold&&!playing)return;
    const art=songArt(),cues=art?.cues||[];if(externalStream||art?.cuesEnabled===false||!cues.length){cueText='';cueTrack=null;return}
    const discontinuous=cueTrack!==activeId||cuePosition<0||Math.abs(pos-cuePosition)>.5;let cue=null;for(const c of cues){if(c.time<=pos+.015)cue=c;else break}
    const key=cue?.id||'base';if(cueTrack!==activeId||cueActive!==key||discontinuous){
      const snapshot=cue||art.base;if(snapshot)restoreView(snapshot);
      if(cue?.burst&&playing&&!discontinuous&&!reduced)emitBurst(.95,true);
      cueActive=key;cueTrack=activeId;
    }
    cueText=cue&&pos<cue.time+5?cue.text:'';cueTextUntil=cue?cue.time+5:0;cuePosition=pos;app.dataset.cueId=cue?.id||'';
  }
  function pointerAllowed(e){return !instrumentOpen&&atelierReady&&atelier.settings.interaction>0&&!document.querySelector('dialog[open]')&&!e.target.closest('button,input,label,select,textarea,.roam-ui,.header,.player-wrap,.footer,.themes,.intro')&&(!app.classList.contains('quiet')||e.target===$('roamSurface'))}
  function pointerPoint(e){const r=app.getBoundingClientRect();return{x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)}}
  function addTouchDust(point,count=3,burst=false){
    if(reduced)return;for(let i=0;i<count;i++){const angle=Math.random()*Math.PI*2,speed=burst?.025+Math.random()*.1:.008+Math.random()*.02;touchDust.push({x:point.x,y:point.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,age:0,life:burst?1.1+Math.random()*.5:.6+Math.random()*.4,size:.7+Math.random()*1.4})}if(touchDust.length>190)touchDust.splice(0,touchDust.length-190);
  }
  function releaseTouch(cancel=false){if(!touchHold)return;if(!cancel&&touchPlanet>.15)addTouchDust(touchHold,Math.round(60*atelier.settings.interaction),true);touchHold=null;touchPlanet=0}
  function drawAtelierEffects(t){
    ctx.save();const strength=atelier.settings.interaction;ctx.globalCompositeOperation='lighter';
    if(strength>0){
      for(const p of touchDust){ctx.fillStyle=rgba(palette.hot,(1-p.age/p.life)*strength*.7);ctx.fillRect(p.x*w,p.y*h,p.size,p.size)}
      for(const p of touchRipples){const u=p.age/p.life,r=(reduced?20:12+u*105)*(.4+strength);ctx.strokeStyle=rgba(palette.core,(1-u)*strength*.45);ctx.lineWidth=.8;ctx.beginPath();ctx.ellipse(p.x*w,p.y*h,r,r*.68,-.25,0,Math.PI*2);ctx.stroke()}
      if(touchHold&&touchPlanet>.01&&!reduced){const x=touchHold.x*w,y=touchHold.y*h,r=9+touchPlanet*17,glow=ctx.createRadialGradient(x,y,0,x,y,r*3);glow.addColorStop(0,rgba(palette.hot,touchPlanet*.7*strength));glow.addColorStop(.2,rgba(palette.core,touchPlanet*.55*strength));glow.addColorStop(1,rgba(palette.core,0));ctx.fillStyle=glow;ctx.fillRect(x-r*3,y-r*3,r*6,r*6);for(let i=0;i<52;i++){const a=i*2.39996+t,rr=r*(1.2+(1-touchPlanet)*3+Math.sin(i*2)*.1);ctx.fillStyle=rgba(palette.core,touchPlanet*.7*strength);ctx.fillRect(x+Math.cos(a)*rr,y+Math.sin(a)*rr*.55,1.5,1.5)}}
    }
    if(trackTravel>.001){
      const amount=trackTravel*(reduced?.15:1);if(!reduced)for(let i=0;i<72;i++){const a=i*2.39996,phase=(i*.618+trackTravelAge*.9)%1,rr=(.04+phase*phase)*Math.max(w,h)*.65,x=centerX+Math.cos(a)*rr,y=centerY+Math.sin(a)*rr*.7,len=(10+phase*60)*trackTravel;ctx.strokeStyle=rgba(palette.core,amount*(1-phase)*.6);ctx.lineWidth=.6+phase;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*len,y+Math.sin(a)*len*.7);ctx.stroke()}
      const g=ctx.createRadialGradient(centerX,centerY,0,centerX,centerY,baseR*1.7);g.addColorStop(0,rgba(palette.core,amount*.2));g.addColorStop(1,rgba(palette.core,0));ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    }
    ctx.restore();drawLyrics();
    if(cueText&&!externalStream){ctx.save();const immersive=exportRendering||app.classList.contains('quiet'),font=Math.max(12,Math.min(25,w*.022)),y=centerY-baseR*(w<=760&&!immersive?.5:.83);ctx.textAlign='center';ctx.font='400 '+font+'px "Microsoft YaHei UI",sans-serif';ctx.fillStyle=rgba(palette.hot,clamp(cueTextUntil-getLocalPosition(),0,1)*.82);cardLines(ctx,cueText,Math.min(w*(immersive?.8:.5),580),2).forEach((text,i)=>ctx.fillText(text,centerX,y+i*font*1.55));ctx.restore()}
  }
  function updateAtelier(dt,now){
    const active=Boolean(playing||externalStream||instrumentSoundActive()),target=active?1:.36;breath+=(target-breath)*(1-Math.exp(-dt*(active?2.5:1.45)));
    lifeMotion+=((active?1:0)-lifeMotion)*(1-Math.exp(-dt*(active?2.8:2.1)));if(lifeMotion<.002)lifeMotion=0;
    if(seekVisualTarget!==null){sceneTime+=(seekVisualTarget-sceneTime)*(1-Math.exp(-dt*6));seekVisualLeft-=dt;if(seekVisualLeft<=0){sceneTime=seekVisualTarget;seekVisualTarget=null}}
    if(trackTravelAge<1.5){trackTravelAge+=dt;trackTravel=Math.sin(Math.PI*clamp(trackTravelAge/1.5,0,1))}else trackTravel=0;
    const pos=getLocalPosition(),lyrics=currentLyrics();if($('atelierDialog').open)updateCuePlayhead();if(lyrics&&!externalStream){let index=-1;const adjusted=pos-(lyrics.offset||0);for(let i=0;i<lyrics.lines.length;i++){if(lyrics.lines[i].time<=adjusted)index=i;else break}if(index!==lyricIndex||lyricTrack!==activeId){if(lyrics.enabled&&playing&&lyricTrack===activeId&&Math.abs(pos-lyricPosition)<.5)dissolveLyric(lyrics.lines[lyricIndex]?.text);lyricIndex=index;lyricTrack=activeId}lyricPosition=pos}
    for(const p of lyricDust){p.age+=dt}lyricDust=lyricDust.filter(p=>p.age<p.life);if(reduced)lyricDust=[];
    for(const p of touchDust){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt}touchDust=touchDust.filter(p=>p.age<p.life);for(const p of touchRipples)p.age+=dt;touchRipples=touchRipples.filter(p=>p.age<p.life);
    if(touchHold){touchHold.age+=dt;if(touchHold.age>.48)touchPlanet=Math.min(1,touchPlanet+dt*1.8)}if(reduced){touchDust=[];touchPlanet=0}
    if(!clipLocked()||clipPhase==='recording')updateCues(pos);
    const segment=songArt()?.segment;
    if(clipPhase==='recording'&&clipSegment?.id===activeId&&pos>=clipSegment.end-.025)finishClip('片段到达 B，已结束录制');
    else if(playing&&!externalStream&&!clipLocked()&&segment&&segment.b-segment.a>=1&&pos>=segment.b-.025){if(segment.loop){seekTo(segment.a)}else if(segmentPreview){pause();seekTo(segment.b);segmentPreview=false}}
    app.dataset.breath=breath.toFixed(3);app.dataset.motionLife=lifeMotion.toFixed(3);app.dataset.sceneTime=sceneTime.toFixed(3);app.dataset.trackTravel=trackTravel.toFixed(3);app.dataset.lyricIndex=String(externalStream?-1:lyricIndex);app.dataset.lyricDust=String(lyricDust.length);app.dataset.touchDust=String(touchDust.length);app.dataset.touchPlanet=touchPlanet.toFixed(3);app.dataset.sensitivity=String(atelier.settings.sensitivity);
    if(now-atelierReadoutAt>120){atelierReadoutAt=now;if($('atelierDialog').open){$('atelierTime').textContent=externalStream?'LIVE · 实时声音':formatTime(pos)+' / '+formatTime(duration);$('rehearsalClock').textContent=formatTime(pos);$('atelierPlayBtn').textContent=externalStream?'LIVE · 原播放器控制':playing?'暂停，听星空呼吸':'播放，唤醒星空';$('atelierPlayBtn').disabled=Boolean(externalStream||busy||pendingFile||!currentTrack());const g=$('atelierPreview').getContext('2d'),sw=Math.min(canvas.width,canvas.height*1.6),sh=sw/1.6;g.drawImage(canvas,clamp(centerX*dpr-sw/2,0,canvas.width-sw),clamp(centerY*dpr-sh/2,0,canvas.height-sh),sw,sh,0,0,640,400);$('atelierCurrentLyric').textContent=lyrics?.enabled&&lyrics.lines[lyricIndex]?.text||'移动留下星尘，轻点泛起涟漪。\n停留长按，让一颗小星球慢慢聚拢。'}}
  }
  function setupAtelier(){
    app.append($('atelierDialog'));$('atelierBtn').addEventListener('click',openAtelier);$('roamAtelierBtn').addEventListener('click',openAtelier);$('atelierBackBtn').addEventListener('click',()=>{$('atelierDialog').close();wakeRoam()});$('atelierDialog').addEventListener('close',wakeRoam);
    document.querySelectorAll('[data-atelier-tab]').forEach(b=>b.addEventListener('click',()=>showAtelierTab(b.dataset.atelierTab)));
    document.querySelectorAll('[data-mood]').forEach(b=>b.addEventListener('click',()=>{moodSlot=b.dataset.mood;atelier.settings.mood=moodSlot;cameraHeld=false;camera.targetYaw=0;camera.targetPitch=0;camera.targetZoom=1;applyLook(atelier.custom[moodSlot]||moodPresets[moodSlot],true);$('moodSaveStatus').textContent=atelier.custom[moodSlot]?'已载入你保存的微调':'已选择 '+moodPresets[moodSlot].name;persistAtelier()}));
    $('saveMoodBtn').addEventListener('click',async()=>{if(moodSlot)atelier.custom[moodSlot]=captureLook();rememberLook();const ok=await persistAtelier();$('moodSaveStatus').textContent=ok?moodSlot?'微调已保存，下次一键回到这里。':'已为这首歌保存当前氛围。':'本页已保留，本机保存暂不可用。'});
    $('resetMoodBtn').addEventListener('click',()=>{if(!moodSlot)return;delete atelier.custom[moodSlot];applyLook(moodPresets[moodSlot],true);persistAtelier();$('moodSaveStatus').textContent='已恢复这套预设。'});
    $('atelierTheme').addEventListener('change',()=>{setTheme($('atelierTheme').value,false);savePreferences();rememberLook()});$('atelierMode').addEventListener('change',()=>{journeyAuto=false;setVisualMode($('atelierMode').value,true);rememberLook()});
    for(const [id,target] of [['atelierIntensity','intensity'],['atelierSpeed','motionSpeed'],['atelierParticles','particleCount']])$(id).addEventListener('input',()=>{$(target).value=$(id).value;$(target).dispatchEvent(new Event('input'));syncMoodControls();rememberLook()});
    $('sensitivity').addEventListener('input',()=>{atelier.settings.sensitivity=Number($('sensitivity').value)/100;syncMoodControls();rememberLook();persistAtelier()});$('touchStrength').addEventListener('input',()=>{atelier.settings.interaction=Number($('touchStrength').value)/100;if(!atelier.settings.interaction){touchDust=[];touchRipples=[];releaseTouch(true)}syncMoodControls();persistAtelier()});
    $('breathingToggle').addEventListener('change',()=>{atelier.settings.breathing=$('breathingToggle').checked;persistAtelier()});$('travelToggle').addEventListener('change',()=>{atelier.settings.transition=$('travelToggle').checked;if(!atelier.settings.transition){trackTravelAge=2;trackTravel=0}persistAtelier()});$('atelierPlayBtn').addEventListener('click',()=>play());
    let lyricImportTrack=null;
    $('importLyricBtn').addEventListener('click',()=>{lyricImportTrack=activeId;$('lyricInput').click();});
    $('lyricInput').addEventListener('change',async()=>{
      const file=$('lyricInput').files[0],id=lyricImportTrack;
      lyricImportTrack=null;$('lyricInput').value='';
      if(!file||!id||activeId!==id||externalStream)return;if(file.size>256*1024){$('lyricStatus').textContent='歌词文件超过 256 KB，请选择较小的歌词文件。';return}try{const raw=await file.text();if(activeId!==id||externalStream)return;$('lyricSource').value=raw.slice(0,160000);saveLyrics(true)}catch{$('lyricStatus').textContent='文件读取失败，请重新选择。'}});
    function persistLyrics(manual){
      const track=currentTrack();
      if(manual&&track?.kind==='file'){
        (track.manualFields||={}).lyrics=true;
        void persistLibrary(true);
      }else void persistAtelier();
      lyricCache=null;lyricIndex=-1;lyricTrack=null;lyricDust=[];
      window.dispatchEvent(new Event('sonic:transport-state'));
    }
    function saveLyrics(explicitImport=false){
      if(externalStream||!activeId)return;
      const raw=$('lyricSource').value,lines=parseLRC(raw);
      if(!lines.length){$('lyricStatus').textContent='没有找到有效时间点。请选择 UTF-8 的 LRC、YRC、明文 KRC/QRC、TTML 或 VTT。';$('lyricStatus').classList.add('error');return}
      const song=songArt(true);
      const manual=explicitImport||song.lyrics?.raw!==raw;
      song.lyrics={...lyricRecord(song,raw,song.lyrics?.translationRaw||'',manual?'manual':song.lyrics.origin),
        offset:finite(Number($('lyricOffset').value),0,-30,30),size:$('lyricSize').value,only:$('lyricOnly').checked,enabled:$('lyricEnabled').checked};
      persistLyrics(manual);$('lyricStatus').classList.remove('error');$('lyricStatus').textContent=lines.length+' 个时间点 · 已应用并保存在本机。';captureSongDraft();scheduleDraftSave();commitRecovery('atelier')
    }
    $('saveLyricBtn').addEventListener('click',()=>saveLyrics());
    $('clearLyricBtn').addEventListener('click',()=>{
      if(externalStream||!activeId)return;
      const song=songArt(true);
      song.lyrics=lyricRecord(song,'','','manual');
      persistLyrics(true);
      syncResetFields(songDraftFields.filter(id=>id.startsWith('lyric')));
      $('lyricStatus').textContent='已清空这首歌的歌词。';
      scheduleDraftSave();
    });
    for(const id of ['lyricOffset','lyricSize','lyricOnly','lyricEnabled'])$(id).addEventListener('change',()=>{
      const song=songArt(activeId===bundledSample.id);
      if(!song)return;
      if(!song.lyrics&&activeId===bundledSample.id)song.lyrics={...bundledLyrics};
      const s=song.lyrics;
      if(!s)return;
      s.offset=finite(Number($('lyricOffset').value),0,-30,30);$('lyricOffsetRange').value=s.offset;s.size=$('lyricSize').value;s.only=$('lyricOnly').checked;s.enabled=$('lyricEnabled').checked;lyricDust=[];persistAtelier()
    });
    $('lyricOffsetRange').addEventListener('input',()=>{$('lyricOffset').value=$('lyricOffsetRange').value;$('lyricOffset').dispatchEvent(new Event('change',{bubbles:true}));$('lyricOffset').dispatchEvent(new Event('input',{bubbles:true}))});
    $('saveMemoryBtn').addEventListener('click',saveMemory);for(const id of ['segmentA','segmentB','segmentLoop'])$(id).addEventListener('change',saveSegment);$('markABtn').addEventListener('click',()=>{$('segmentA').value=getLocalPosition().toFixed(1);saveSegment()});$('markBBtn').addEventListener('click',()=>{$('segmentB').value=getLocalPosition().toFixed(1);saveSegment()});$('previewSegmentBtn').addEventListener('click',()=>previewSegment());$('recordSegmentBtn').addEventListener('click',()=>previewSegment(true));
    $('cuesEnabled').addEventListener('change',()=>{songArt(true).cuesEnabled=$('cuesEnabled').checked;cueTrack=null;cueText='';persistAtelier()});$('cueNowBtn').addEventListener('click',()=>{$('cueTime').value=getLocalPosition().toFixed(1);$('cueTime').dispatchEvent(new Event('input',{bubbles:true}))});
    $('addCueBtn').addEventListener('click',()=>addCueAt(Number($('cueTime').value)));setupCueTimeline();
    app.addEventListener('pointermove',e=>{if(!pointerAllowed(e))return;const point=pointerPoint(e),now=performance.now();if(touchHold&&touchHold.id===e.pointerId){if(Math.hypot((point.x-touchHold.x)*w,(point.y-touchHold.y)*h)>14)releaseTouch(true)}if(now-touchLastAt>38){touchLastAt=now;addTouchDust(point,Math.ceil(4*atelier.settings.interaction))}});
    app.addEventListener('pointerdown',e=>{if(!pointerAllowed(e)||e.pointerType==='mouse'&&e.button!==0)return;if(touchHold){releaseTouch(true);return}const point=pointerPoint(e);touchHold={...point,id:e.pointerId,age:0};touchRipples.push({...point,age:0,life:1.15});if(touchRipples.length>6)touchRipples.shift()});window.addEventListener('pointerup',e=>{if(touchHold?.id===e.pointerId)releaseTouch()});window.addEventListener('pointercancel',()=>releaseTouch(true));window.addEventListener('blur',()=>releaseTouch(true));document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseTouch(true)});
    atelierPromise=loadAtelier();
  }

  // An independent synthesizer feeds the shared analyser and film recorder.
  const instrumentNotes=[['C4','Do',60,'A',[183,161,255]],['D4','Re',62,'S',[145,174,255]],['E4','Mi',64,'D',[119,204,239]],['G4','Sol',67,'F',[129,219,197]],['A4','La',69,'G',[206,219,151]],['C5','Do',72,'H',[245,205,146]],['D5','Re',74,'J',[240,167,187]],['E5','Mi',76,'K',[209,158,244]]];
  const instrumentDrums=[['深空鼓','Z','kick'],['星砂鼓','X','snare'],['碎星镲','C','hat']];
  let instrumentOpen=false,instrumentReady=false,instrumentBus=null,instrumentCompressor=null,instrumentNoise=null,instrumentTimer=0,instrumentLoad=null,instrumentViewBefore=null;
  let instrumentProject={version:1,title:'我的星际即兴',tone:'bell',octave:0,tempo:96,bars:2,quantize:true,metronome:true,volume:.7,layers:[]};
  let instrumentVoices=new Map(),instrumentHeld=new Map(),instrumentVisualQueue=[],instrumentPlanets=[],instrumentRipples=[],instrumentSerial=0,instrumentLastSound=0,instrumentPreviewAt=0,instrumentActivePads=new Map();
  let instrumentLooping=false,instrumentAnchor=0,instrumentScheduledUntil=0,instrumentTake=null,instrumentUndo=null,instrumentLayerSerial=0,clipInstrumentMode=false;
  function instrumentSoundActive(){return instrumentOpen&&(instrumentLooping||instrumentVoices.size>0||(audioContext&&audioContext.currentTime-instrumentLastSound<.5))}
  function instrumentStatus(text,error=false){$('instrumentStatus').textContent=text;$('instrumentStatus').classList.toggle('error',error)}
  function instrumentNoteName(pad,octave=instrumentProject.octave){return instrumentNotes[pad][0].replace(/\d+$/,n=>String(Number(n)+octave))}
  function instrumentBeatSeconds(){return 60/instrumentProject.tempo}
  function instrumentLoopBeats(){return instrumentProject.bars*4}
  function sanitizeInstrument(v){
    if(!v||v.version!==1)return null;const p={version:1,title:String(v.title||'我的星际即兴').slice(0,60),tone:['bell','air','pluck'].includes(v.tone)?v.tone:'bell',octave:[-1,0,1].includes(v.octave)?v.octave:0,tempo:Math.round(finite(v.tempo,96,60,160)),bars:[1,2,4].includes(v.bars)?v.bars:2,quantize:v.quantize!==false,metronome:v.metronome!==false,volume:finite(v.volume,.7,0,1),layers:[]};
    if(Array.isArray(v.layers))for(const layer of v.layers.slice(0,6)){if(!layer||!Array.isArray(layer.events))continue;const events=layer.events.filter(e=>e&&Number.isInteger(e.pad)&&e.pad>=0&&e.pad<11&&Number.isFinite(e.at)&&e.at>=0&&e.at<p.bars*4).slice(0,512).map(e=>({pad:e.pad,at:e.at,len:finite(e.len,.4,.06,4),tone:['bell','air','pluck'].includes(e.tone)?e.tone:'bell',octave:[-1,0,1].includes(e.octave)?e.octave:0,velocity:finite(e.velocity,.8,.15,1)}));if(events.length)p.layers.push({id:newId('layer'),name:String(layer.name||'一层星光').slice(0,30),muted:layer.muted===true,events})}return p;
  }
  function saveInstrument(){if(backupRestoring)return;
    try{localStorage.setItem('sonic-universe-instrument',JSON.stringify(instrumentProject));storageIssues.delete('instrument')}catch{storageIssues.add('instrument');instrumentStatus('旋律保留在本页，本机保存暂不可用；请先录成短片带走。',true)}updateStorageStatus();
  }
  function initInstrumentAudio(){
    initAudio();if(instrumentBus)return;instrumentBus=audioContext.createGain();instrumentBus.gain.value=instrumentProject.volume*.55;instrumentCompressor=audioContext.createDynamicsCompressor();instrumentCompressor.threshold.value=-16;instrumentCompressor.knee.value=18;instrumentCompressor.ratio.value=7;instrumentCompressor.attack.value=.003;instrumentCompressor.release.value=.2;instrumentBus.connect(instrumentCompressor);instrumentCompressor.connect(analyser);
    instrumentNoise=audioContext.createBuffer(1,audioContext.sampleRate,audioContext.sampleRate);const d=instrumentNoise.getChannelData(0);let seed=93811;for(let i=0;i<d.length;i++){seed=seed*16807%2147483647;d[i]=seed/2147483647*2-1}
  }
  function stopInstrumentVoice(id,at=null){
    const v=instrumentVoices.get(id);if(!v||v.released)return;v.released=true;const t=Math.max(at??audioContext.currentTime,v.start+.025),end=Math.min(t+.18,v.end);if(t<v.end){try{v.gain.gain.cancelAndHoldAtTime(t);v.gain.gain.linearRampToValueAtTime(0,end);for(const s of v.sources)s.stop(end+.02)}catch{}}v.releaseAt=end;
  }
  function triggerInstrument(pad,time,len=.45,tone=instrumentProject.tone,octave=instrumentProject.octave,velocity=.8,source='live'){
    if(!instrumentBus||instrumentVoices.size>=48)return null;const id=++instrumentSerial,start=Math.max(time,audioContext.currentTime),drum=pad>=8,duration=drum?(pad===8?.55:pad===9?.24:.14):clamp(len,.08,2),end=start+duration+.2,gain=audioContext.createGain(),sources=[],nodes=[gain];gain.connect(instrumentBus);
    if(!drum){
      const hz=440*Math.pow(2,(instrumentNotes[pad][2]+octave*12-69)/12),filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.value=tone==='air'?1800:tone==='pluck'?2800:6500;filter.Q.value=.6;filter.connect(gain);nodes.push(filter);
      const harmonics=tone==='bell'?[[1,.72,'sine'],[2,.2,'sine'],[3.003,.055,'sine']]:tone==='air'?[[1,.5,'triangle'],[1.003,.35,'sine']]:[[1,.7,'triangle'],[2,.12,'sine']];
      for(const [ratio,amp,type] of harmonics){const o=audioContext.createOscillator(),mix=audioContext.createGain();o.type=type;o.frequency.value=hz*ratio;mix.gain.value=amp;o.connect(mix);mix.connect(filter);o.start(start);o.stop(end+.03);sources.push(o);nodes.push(mix)}
      const attack=tone==='air'?.045:.008,peak=velocity*.55;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(peak,start+attack);gain.gain.exponentialRampToValueAtTime(Math.max(.001,peak*(tone==='air'?.65:.2)),start+Math.min(duration,.35));gain.gain.setValueAtTime(Math.max(.001,peak*.18),start+duration);gain.gain.exponentialRampToValueAtTime(.0001,end);
    }else if(pad===8){const o=audioContext.createOscillator();o.type='sine';o.frequency.setValueAtTime(145,start);o.frequency.exponentialRampToValueAtTime(42,start+.18);gain.gain.setValueAtTime(velocity*.85,start);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);o.connect(gain);o.start(start);o.stop(end);sources.push(o)}
    else{const noise=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter();noise.buffer=instrumentNoise;filter.type='highpass';filter.frequency.value=pad===9?1400:7000;noise.connect(filter);filter.connect(gain);nodes.push(filter);gain.gain.setValueAtTime(velocity*(pad===9?.5:.3),start);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);noise.start(start);noise.stop(end);sources.push(noise);if(pad===9){const o=audioContext.createOscillator(),m=audioContext.createGain();o.type='triangle';o.frequency.value=185;m.gain.value=.16;o.connect(m);m.connect(gain);o.start(start);o.stop(end);sources.push(o);nodes.push(m)}}
    const voice={id,pad,gain,sources,nodes,start,end,source,released:false};instrumentVoices.set(id,voice);let remaining=sources.length;for(const s of sources)s.onended=()=>{try{s.disconnect()}catch{}if(--remaining===0){for(const n of nodes)try{n.disconnect()}catch{}instrumentVoices.delete(id);app.dataset.instrumentVoices=String(instrumentVoices.size)}};instrumentVisualQueue.push({pad,time:start,velocity,serial:id,octave});return id;
  }
  async function instrumentNoteOn(pad,token){
    if(!instrumentOpen||document.hidden||instrumentHeld.has(token)||clipPhase==='preparing'||clipPhase==='stopping')return;if($('clipDialog').open&&clipShowingResult){$('clipVideo').pause();clipShowLive();clipUpdateControls()}const held={pad,pending:true,cancelled:false};instrumentHeld.set(token,held);
    try{initInstrumentAudio();await audioContext.resume();if(held.cancelled||!instrumentOpen||document.hidden||!instrumentHeld.has(token))return;const now=audioContext.currentTime,velocity=pad>=8?.9:.82;held.start=now;held.tone=instrumentProject.tone;held.octave=instrumentProject.octave;held.voice=triggerInstrument(pad,now,2,held.tone,held.octave,velocity);held.pending=false;held.velocity=velocity;
      if(instrumentTake&&now>=instrumentTake.start&&now<instrumentTake.end&&instrumentTake.events.length<512){const beat=(now-instrumentTake.start)/instrumentBeatSeconds(),quantized=instrumentProject.quantize?Math.round(beat*2)/2:beat;held.event={pad,at:Math.min(quantized,instrumentLoopBeats()-.06),len:.25,tone:held.tone,octave:held.octave,velocity};instrumentTake.events.push(held.event)}
      if(pad>=8)setTimeout(()=>{if(instrumentHeld.get(token)===held)instrumentNoteOff(token)},160);
    }catch(error){instrumentHeld.delete(token);instrumentStatus(error.message||'声音暂未启动，请再点一次音垫。',true)}
  }
  function instrumentNoteOff(token){const held=instrumentHeld.get(token);if(!held)return;held.cancelled=true;instrumentHeld.delete(token);if(held.voice)stopInstrumentVoice(held.voice);if(held.event){let len=(audioContext.currentTime-held.start)/instrumentBeatSeconds();if(instrumentProject.quantize)len=Math.max(.25,Math.round(len*4)/4);held.event.len=clamp(len,.06,Math.min(2/instrumentBeatSeconds(),instrumentLoopBeats()-held.event.at))}}
  function instrumentReleaseAll(){for(const token of [...instrumentHeld.keys()])instrumentNoteOff(token)}
  function instrumentStopVoices(){instrumentReleaseAll();instrumentVisualQueue=[];for(const v of instrumentVoices.values()){try{v.gain.gain.cancelScheduledValues(0);v.gain.gain.setTargetAtTime(0,audioContext.currentTime,.01);for(const s of v.sources)s.stop(audioContext.currentTime+.04)}catch{}}}
  function instrumentMetronome(time,strong){if(!instrumentProject.metronome)return;const o=audioContext.createOscillator(),g=audioContext.createGain();o.frequency.value=strong?1050:760;g.gain.setValueAtTime(.06,time);g.gain.exponentialRampToValueAtTime(.0001,time+.045);o.connect(g);g.connect(masterGain);o.start(time);o.stop(time+.05);o.onended=()=>{o.disconnect();g.disconnect()};instrumentMetros.push({o,g,time})}
  let instrumentMetros=[];
  function instrumentSchedule(){
    if(!instrumentLooping||!instrumentOpen||!audioContext)return;const now=audioContext.currentTime;if(document.hidden||audioContext.state!=='running'){stopInstrumentLoop('页面或声音已暂停，循环停止；已完成的旋律仍保留。');return}
    if(instrumentTake&&now>=instrumentTake.end)finishInstrumentTake();
    const beatSec=instrumentBeatSeconds(),beats=instrumentLoopBeats(),from=instrumentScheduledUntil,to=now+.10;if(to<from)return;
    const first=Math.max(0,Math.floor((from-instrumentAnchor)/beatSec/beats)),last=Math.max(0,Math.floor((to-instrumentAnchor)/beatSec/beats));
    // Include the active take in the lookahead beyond its end, so beat zero of
    // the first replay is scheduled before the layer is committed to storage.
    const layers=instrumentTake?[...instrumentProject.layers,{events:instrumentTake.events,take:true}]:instrumentProject.layers;
    for(let cycle=first;cycle<=last;cycle++)for(const layer of layers){if(layer.muted||(layer.take&&cycle===0))continue;for(const event of layer.events){const t=instrumentAnchor+(cycle*beats+event.at)*beatSec;if(t>=from&&t<to&&t>=now-.015)triggerInstrument(event.pad,t,event.len*beatSec,event.tone,event.octave,event.velocity,'loop')}}
    const metroStart=instrumentAnchor-(instrumentTake?4*beatSec:0);let beat=Math.max(0,Math.ceil((from-metroStart)/beatSec-1e-7));for(;metroStart+beat*beatSec<to;beat++){const t=metroStart+beat*beatSec;if(t>=now-.015)instrumentMetronome(Math.max(now,t),beat%4===0)}
    instrumentScheduledUntil=to;instrumentMetros=instrumentMetros.filter(m=>m.time>now-.2);
  }
  async function startInstrumentLoop(record=false){
    if(!instrumentOpen||clipLocked()||instrumentLoad)return;if(record&&instrumentProject.layers.length>=6){instrumentStatus('已经叠了 6 层，先移除一层再录新旋律。');return}if(!record&&!instrumentProject.layers.some(l=>!l.muted)){instrumentStatus('先录下一层旋律，或取消某一层的静音。');return}
    stopInstrumentLoop('',true);const token={};instrumentLoad=token;updateInstrumentControls();try{initInstrumentAudio();await audioContext.resume();if(instrumentLoad!==token||!instrumentOpen||document.hidden)return;const count=record?4:0,beat=instrumentBeatSeconds();instrumentAnchor=audioContext.currentTime+.10+count*beat;instrumentScheduledUntil=audioContext.currentTime;instrumentLooping=true;
      if(record){instrumentUndo=JSON.parse(JSON.stringify(instrumentProject.layers));instrumentTake={start:instrumentAnchor,end:instrumentAnchor+instrumentLoopBeats()*beat,events:[],tone:instrumentProject.tone};instrumentStatus('准备，数 4 拍。亮起后演奏，录满一圈自动循环。')}else instrumentStatus('正在循环。可试奏，也可点「叠录一层」加入新旋律。');instrumentSchedule();renderInstrumentLayers();updateInstrumentControls();
    }catch(error){instrumentStatus(error.message||'暂时无法启动循环。',true)}finally{if(instrumentLoad===token)instrumentLoad=null;updateInstrumentControls()}
  }
  function finishInstrumentTake(){
    const take=instrumentTake;if(!take)return;instrumentReleaseAll();instrumentTake=null;if(take.events.length){instrumentProject.layers.push({id:newId('layer'),name:'第 '+(++instrumentLayerSerial)+' 层',muted:false,events:take.events.sort((a,b)=>a.at-b.at)});saveInstrument();instrumentStatus('已录下 '+take.events.length+' 个音符 / 鼓点。正在循环，可以再叠一层。')}else instrumentStatus('这一圈没有音符，保留原来的循环。再录一层试试。');renderInstrumentLayers();updateInstrumentControls();commitRecovery('instrument');
  }
  function stopInstrumentLoop(message='已停止。旋律保留在本机。',cancelTake=true){
    instrumentLoad=null;if(cancelTake&&instrumentTake){instrumentTake=null;if(message)message='已取消本次叠录，已完成的旋律保留。'}instrumentLooping=false;app.dataset.instrumentLoop='false';app.dataset.instrumentTake='idle';instrumentStopVoices();for(const m of instrumentMetros)try{m.o.stop()}catch{}instrumentMetros=[];if(message)instrumentStatus(message);updateInstrumentControls();
  }
  function renderInstrumentLayers(){
    const list=$('instrumentLayers');list.replaceChildren();if(!instrumentProject.layers.length){const li=document.createElement('li');li.className='instrument-empty';li.textContent='还没有录下的旋律。第一层可以是几个音符，也可以是一圈鼓点。';list.append(li);return}
    for(const layer of instrumentProject.layers){const li=document.createElement('li');li.className='instrument-layer'+(layer.muted?' muted':'');const label=document.createElement('span');label.textContent=layer.name;const meta=document.createElement('small');meta.textContent=layer.events.length+' 个音符 / 鼓点'+(layer.muted?' · 已静音':'');label.append(meta);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 70 23');for(const event of layer.events){const rect=document.createElementNS(svg.namespaceURI,'rect');rect.setAttribute('x',String(event.at/instrumentLoopBeats()*65));rect.setAttribute('y',String(3+(10-event.pad)*1.4));rect.setAttribute('width',String(Math.max(1.5,event.len/instrumentLoopBeats()*65)));rect.setAttribute('height','2');svg.append(rect)}
      const mute=document.createElement('button'),remove=document.createElement('button');mute.textContent=layer.muted?'恢复':'静音';mute.setAttribute('aria-pressed',String(layer.muted));mute.setAttribute('aria-label',(layer.muted?'恢复':'静音')+layer.name);remove.textContent='×';remove.setAttribute('aria-label','移除'+layer.name);for(const b of [mute,remove])b.disabled=Boolean(instrumentTake||clipLocked());mute.addEventListener('click',()=>{instrumentUndo=JSON.parse(JSON.stringify(instrumentProject.layers));layer.muted=!layer.muted;saveInstrument();renderInstrumentLayers()});remove.addEventListener('click',()=>{instrumentUndo=JSON.parse(JSON.stringify(instrumentProject.layers));instrumentProject.layers=instrumentProject.layers.filter(l=>l.id!==layer.id);saveInstrument();renderInstrumentLayers();updateInstrumentControls()});li.append(label,svg,mute,remove);list.append(li)}
  }
  function updateInstrumentControls(){
    for(const id of ['instrumentMonitor','instrumentFilmMonitor']){const b=$(id);if(b){b.textContent=volume===0?'试听已静音 · 点此恢复':'试听中 · 点此静音';b.setAttribute('aria-pressed',String(volume===0))}}
    for(const b of document.querySelectorAll('[data-note-pad]')){const p=Number(b.dataset.notePad);if(p<8){const n=instrumentNoteName(p);if(b.querySelector('strong').textContent!==n){b.querySelector('strong').textContent=n;b.setAttribute('aria-label',n+' '+instrumentNotes[p][1]+'，键盘 '+instrumentNotes[p][3])}}}
    for(const b of document.querySelectorAll('.instrument-layer button'))b.disabled=Boolean(instrumentTake||clipLocked());
    if(!$('instrumentDialog'))return;const locked=clipLocked(),running=instrumentLooping||Boolean(instrumentLoad),recording=Boolean(instrumentTake);$('instrumentDialog').dataset.recording=String(recording);$('instrumentRecordBtn').disabled=locked||instrumentProject.layers.length>=6;$('instrumentRecordBtn').querySelector('span').textContent=recording?'取消本次叠录':instrumentProject.layers.length?'叠录一层':'录下第一层';$('instrumentLoopBtn').disabled=locked||!instrumentProject.layers.length||recording;$('instrumentLoopBtn').textContent=running?'暂停循环':'播放循环';$('instrumentStopBtn').disabled=locked||(!running&&!instrumentVoices.size);$('instrumentUndoBtn').disabled=locked||running||!instrumentUndo;$('instrumentClearBtn').disabled=locked||running||!instrumentProject.layers.length;for(const id of ['instrumentTempo','instrumentBars'])$(id).disabled=running||locked;$('instrumentFilmBtn').disabled=running||locked||!clipSupported();$('instrumentFilmBtn').title=clipSupported()?'先停止循环，再将演奏录成短片':'当前浏览器不支持短片录制，请使用新版 Edge 或 Chrome';$('instrumentTitle').disabled=locked;
    $('instrumentTakeClock').textContent=instrumentLoopBeats()+' 拍 / '+(instrumentLoopBeats()*instrumentBeatSeconds()).toFixed(1)+' 秒';$('instrumentVolumeValue').textContent=Math.round(instrumentProject.volume*100)+'%';setFill($('instrumentVolume'));
  }
  function buildInstrumentPads(target,drums=false){
    const container=$(target);container.replaceChildren();const defs=drums?instrumentDrums:instrumentNotes;defs.forEach((note,index)=>{const pad=drums?index+8:index,b=document.createElement('button');b.type='button';b.className='instrument-pad';b.dataset.notePad=String(pad);b.style.setProperty('--pad-rgb',(drums?[[196,163,238],[143,190,239],[237,203,153]][index]:note[4]).join(','));const k=document.createElement('kbd'),planet=document.createElement('i'),name=document.createElement('strong'),small=document.createElement('small');planet.className='pad-planet';k.textContent=drums?note[1]:note[3];name.textContent=note[0];small.textContent=drums?'':note[1];b.setAttribute('aria-label',(drums?note[0]:note[0]+' '+note[1])+'，键盘 '+k.textContent);b.append(k,planet,name,small);b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();b.focus({preventScroll:true});b.setPointerCapture(e.pointerId);instrumentNoteOn(pad,'pointer-'+e.pointerId)});for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,e=>instrumentNoteOff('pointer-'+e.pointerId));b.addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();if(!e.repeat)instrumentNoteOn(pad,'button-'+pad)}});b.addEventListener('keyup',e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();instrumentNoteOff('button-'+pad)}});container.append(b)});
  }
  async function openInstrument(){
    if(clipLocked()){showToast('先结束当前短片录制，再打开乐器台。');return}if(externalStream||externalPending){showToast('请先停止外部声音联动，再开始自己的演奏。');return}if(busy||pendingFile||!libraryReady){showToast('音乐正在准备，请稍候再打开乐器台。');return}
    if(instrumentOpen)return;primeHistory('instrument');pause();instrumentViewBefore={...saveView(),held:cameraHeld};instrumentOpen=true;clipInstrumentMode=false;instrumentPlanets=[];instrumentRipples=[];instrumentVisualQueue=[];instrumentLastSound=-100;seekVisualTarget=null;seekVisualLeft=0;cinema.yaw=0;cinema.pitch=0;cinema.zoom=1;camera.yaw=camera.targetYaw=0;camera.pitch=camera.targetPitch=0;camera.zoom=camera.targetZoom=1;cameraHeld=true;app.classList.add('instrument-open');$('instrumentDialog').showModal();renderInstrumentLayers();updateInstrumentControls();instrumentStatus(instrumentProject.layers.length?'上次的旋律已在这里，点「播放循环」重新听见它。':'点音垫试奏。准备好后，录下一圈旋律。');
  }
  function closeInstrument(){
    if(!instrumentOpen)return;stopInstrumentLoop('',true);instrumentOpen=false;clipInstrumentMode=false;instrumentPlanets=[];instrumentRipples=[];instrumentVisualQueue=[];app.classList.remove('instrument-open');if(instrumentViewBefore){restoreView(instrumentViewBefore);sceneTime=instrumentViewBefore.sceneTime;Object.assign(sceneWeights,instrumentViewBefore.weights);cameraHeld=instrumentViewBefore.held;updateCameraButton()}app.dataset.instrumentOpen='false';app.dataset.instrumentLoop='false';app.dataset.instrumentTake='idle';saveInstrument();wakeRoam();
  }
  function prepareInstrumentFilm(){
    if(!instrumentOpen||instrumentLooping||instrumentTake||!clipSupported())return;instrumentReleaseAll();clipSegment=null;clipInstrumentMode=true;openClip();clipSetStatus('开始录制后直接点下方音垫或用键盘演奏；已有旋律会从头循环。节拍提示音不会录入短片。');
  }
  function beginInstrumentFilm(){
    stopInstrumentLoop('',true);if(instrumentProject.layers.some(l=>!l.muted)){instrumentAnchor=audioContext.currentTime+.12;instrumentScheduledUntil=audioContext.currentTime;instrumentLooping=true;instrumentSchedule()}
  }
  function endInstrumentFilm(){stopInstrumentLoop('',true);updateInstrumentControls();renderInstrumentLayers()}
  function drawInstrumentScene(g,width,height){
    const saved={ctx,w,h,dpr,centerX,centerY,baseR,backgroundLayer,exportRendering};try{ctx=g;w=width;h=height;dpr=1;centerX=width*.5;centerY=height*.5;baseR=Math.min(width*.30,height*.34);backgroundLayer=null;exportRendering=true;g.setTransform(1,0,0,1,0,0);draw(sceneTime,0)}finally{ctx=saved.ctx;w=saved.w;h=saved.h;dpr=saved.dpr;centerX=saved.centerX;centerY=saved.centerY;baseR=saved.baseR;backgroundLayer=saved.backgroundLayer;exportRendering=saved.exportRendering}
  }
  function drawInstrumentStars(t){
    if(!instrumentOpen)return;const cx=centerX,cy=centerY,r=baseR;ctx.save();
    for(const p of instrumentPlanets){const life=clamp(1-p.age/7,0,1),grow=reduced?1:smooth(p.age/.28),angle=p.angle+(reduced?0:t*.035),rr=r*(p.radius+(reduced?0:p.age*.013)),x=cx+Math.cos(angle)*rr*1.25,y=cy+Math.sin(angle)*rr*.68,size=(5+p.velocity*7)*grow*(exportRendering?1.2:1),color=instrumentNotes[p.pad][4];const g=ctx.createRadialGradient(x-size*.28,y-size*.3,0,x,y,size*1.3);g.addColorStop(0,rgba([247,235,255],life*.95));g.addColorStop(.2,rgba(color,life*.9));g.addColorStop(.68,rgba(color,life*.38));g.addColorStop(1,rgba(color,0));ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,size*1.3,0,Math.PI*2);ctx.fill();ctx.strokeStyle=rgba(color,life*.55);ctx.lineWidth=.6;ctx.beginPath();ctx.ellipse(x,y,size*1.9,size*.5,-.3,0,Math.PI*2);ctx.stroke();if(p.age<2){ctx.font='9px ui-monospace,monospace';ctx.textAlign='center';ctx.fillStyle=rgba(color,life*.65);ctx.fillText(instrumentNoteName(p.pad,p.octave),x,y+size*2.5)}}
    for(const p of instrumentRipples){const u=p.age/1.5,rr=r*(reduced?.9:.35+u*1.8),alpha=(1-u)*.6,color=p.pad===8?palette.hot:p.pad===9?palette.core:[151,200,242];ctx.strokeStyle=rgba(color,alpha);ctx.lineWidth=p.pad===8?1.5:.8;ctx.beginPath();ctx.ellipse(cx,cy,rr*1.23,rr*.7,-.25,0,Math.PI*2);ctx.stroke()}ctx.restore();
  }
  function updateInstrument(dt,now){
    if(!instrumentOpen)return;const time=audioContext?.currentTime||0;for(let i=instrumentVisualQueue.length-1;i>=0;i--){const e=instrumentVisualQueue[i];if(e.time>time)continue;instrumentVisualQueue.splice(i,1);instrumentLastSound=time;instrumentActivePads.set(e.pad,time+.15);if(e.pad<8){instrumentPlanets.push({...e,age:0,angle:e.pad/8*Math.PI*2-.8+(e.serial%3)*.14,radius:.65+(e.serial%4)*.17});if(instrumentPlanets.length>32)instrumentPlanets.shift();$('instrumentLastNote').textContent=instrumentNoteName(e.pad,e.octave)+' · '+instrumentNotes[e.pad][1]+'，一颗新的星球'}else{instrumentRipples.push({...e,age:0});if(instrumentRipples.length>8)instrumentRipples.shift();$('instrumentLastNote').textContent=instrumentDrums[e.pad-8][0]+' · 星环正在扩散'}}
    for(const p of instrumentPlanets)p.age+=dt;instrumentPlanets=instrumentPlanets.filter(p=>p.age<7);for(const p of instrumentRipples)p.age+=dt;instrumentRipples=instrumentRipples.filter(p=>p.age<1.5);
    for(const [token,held] of instrumentHeld)if(!held.pending&&Number.isFinite(held.start)&&time-held.start>2)instrumentNoteOff(token);
    for(const b of document.querySelectorAll('[data-note-pad]')){const pad=Number(b.dataset.notePad),held=[...instrumentHeld.values()].some(v=>v.pad===pad&&!v.pending);b.classList.toggle('active',held||(instrumentActivePads.get(pad)||0)>time);b.setAttribute('aria-pressed',String(held))}
    let position=instrumentLooping?(time-instrumentAnchor)/instrumentBeatSeconds():0;const beat=position<0?Math.floor(position)+4:Math.floor(position)%instrumentLoopBeats();document.querySelectorAll('#instrumentBeat i').forEach((dot,i)=>dot.classList.toggle('active',instrumentLooping&&(position<0?i===beat%4:i===beat)));$('instrumentProgress').style.width=instrumentLooping&&position>=0?((position%instrumentLoopBeats())/instrumentLoopBeats()*100)+'%':'0%';
    if(instrumentTake){$('instrumentTakeClock').textContent=position<0?'准备 '+Math.max(1,Math.ceil(-position)):'录制 '+Math.min(instrumentLoopBeats(),Math.floor(position)+1)+' / '+instrumentLoopBeats()+' 拍'}
    if(now-instrumentPreviewAt>65){instrumentPreviewAt=now;if($('instrumentDialog').open)drawInstrumentScene($('instrumentCanvas').getContext('2d'),1000,450);if(!instrumentTake&&!clipLocked())updateInstrumentControls()}
    app.dataset.instrumentOpen=String(instrumentOpen);app.dataset.instrumentLoop=String(instrumentLooping);app.dataset.instrumentTake=instrumentTake?(position<0?'countdown':'recording'):'idle';app.dataset.instrumentLayers=String(instrumentProject.layers.length);app.dataset.instrumentVoices=String(instrumentVoices.size);app.dataset.instrumentPlanets=String(instrumentPlanets.length);app.dataset.instrumentSerial=String(instrumentSerial);app.dataset.instrumentPosition=position.toFixed(3);
  }
  function setupInstrument(){
    try{const p=sanitizeInstrument(JSON.parse(localStorage.getItem('sonic-universe-instrument')||'null'));if(p)instrumentProject=p}catch{storageIssues.add('instrument')}instrumentLayerSerial=instrumentProject.layers.length;instrumentReady=true;
    app.append($('instrumentDialog'));$('instrumentBtn').addEventListener('click',openInstrument);$('roamInstrumentBtn').addEventListener('click',openInstrument);$('instrumentDialog').addEventListener('close',closeInstrument);$('instrumentDialog').addEventListener('cancel',e=>{if(clipLocked()){e.preventDefault();return}stopInstrumentLoop('',true)});
    for(const id of ['instrumentMonitor','instrumentFilmMonitor'])$(id).addEventListener('click',()=>{$('muteBtn').click();updateInstrumentControls()});
    buildInstrumentPads('instrumentPads');buildInstrumentPads('instrumentDrums',true);buildInstrumentPads('instrumentFilmPads');buildInstrumentPads('instrumentFilmDrums',true);
    const controls={instrumentTitle:'title',instrumentTone:'tone',instrumentOctave:'octave',instrumentTempo:'tempo',instrumentBars:'bars',instrumentQuantize:'quantize',instrumentMetronome:'metronome',instrumentVolume:'volume'};for(const [id,key] of Object.entries(controls)){const el=$(id);if(el.type==='checkbox')el.checked=instrumentProject[key];else el.value=key==='volume'?instrumentProject[key]*100:instrumentProject[key];el.addEventListener(id==='instrumentVolume'?'input':'change',()=>{if((key==='tempo'||key==='bars')&&(instrumentLooping||clipLocked()))return;if(key==='bars'&&instrumentProject.layers.length){instrumentStatus('已有旋律时保留原循环长度；清空后可以改变小节数。');el.value=instrumentProject.bars;return}let value=el.type==='checkbox'?el.checked:el.value;if(['octave','tempo','bars','volume'].includes(key))value=Number(value);if(key==='tempo')value=Math.round(clamp(value||96,60,160));if(key==='volume')value/=100;instrumentProject[key]=value;if(key==='volume'&&instrumentBus)instrumentBus.gain.setTargetAtTime(value*.55,audioContext.currentTime,.02);el.value=key==='volume'?value*100:value;if(key==='metronome'&&!value)for(const m of instrumentMetros)try{m.o.stop()}catch{}if(key==='bars')renderInstrumentBeat();saveInstrument();updateInstrumentControls()})}
    $('instrumentRecordBtn').addEventListener('click',()=>{if(instrumentTake)stopInstrumentLoop('已取消本次叠录。');else startInstrumentLoop(true)});$('instrumentLoopBtn').addEventListener('click',()=>{if(instrumentLooping)stopInstrumentLoop();else startInstrumentLoop()});$('instrumentStopBtn').addEventListener('click',()=>stopInstrumentLoop());$('instrumentUndoBtn').addEventListener('click',()=>{if(!instrumentUndo||instrumentLooping||clipLocked())return;const swap=instrumentProject.layers;instrumentProject.layers=instrumentUndo;instrumentUndo=swap;saveInstrument();renderInstrumentLayers();updateInstrumentControls();instrumentStatus('已撤销上一处改动，再点一次可恢复。')});$('instrumentClearBtn').addEventListener('click',()=>{if(instrumentLooping||clipLocked())return;instrumentUndo=JSON.parse(JSON.stringify(instrumentProject.layers));instrumentProject.layers=[];saveInstrument();renderInstrumentLayers();updateInstrumentControls();instrumentStatus('已清空旋律，可用撤销恢复。')});$('instrumentFilmBtn').addEventListener('click',prepareInstrumentFilm);
    document.addEventListener('keydown',e=>{if(!instrumentOpen||e.altKey||e.ctrlKey||e.metaKey||e.target.closest('input,textarea,select'))return;const dialog=e.target.closest('dialog[open]')||document.activeElement?.closest('dialog[open]');if(dialog&&dialog!==$('instrumentDialog')&&dialog!==$('clipDialog'))return;const keys=['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyZ','KeyX','KeyC'],pad=keys.indexOf(e.code);if(pad>=0){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)instrumentNoteOn(pad,e.code)}else if(e.code==='Space'&&!e.target.closest('button')){e.preventDefault();e.stopImmediatePropagation();if(!clipLocked()){if(instrumentLooping)stopInstrumentLoop();else startInstrumentLoop()}}},true);document.addEventListener('keyup',e=>{if(instrumentHeld.has(e.code)){instrumentNoteOff(e.code);e.preventDefault();e.stopImmediatePropagation()}},true);
    window.addEventListener('blur',()=>{if(instrumentOpen){if(clipLocked())finishClip('窗口失焦，已结束演奏录制');stopInstrumentLoop('窗口失焦，演奏已停止。')}});document.addEventListener('visibilitychange',()=>{if(document.hidden&&instrumentOpen){if(clipLocked())finishClip('页面切到后台，已结束演奏录制');stopInstrumentLoop('页面切到后台，演奏已停止。')}});window.addEventListener('pagehide',()=>{stopInstrumentLoop('',true);saveInstrument()});instrumentTimer=setInterval(instrumentSchedule,25);renderInstrumentBeat();renderInstrumentLayers();updateInstrumentControls();app.dataset.instrumentReady='true';
  }
  function renderInstrumentBeat(){$('instrumentBeat').replaceChildren();for(let i=0;i<instrumentLoopBeats();i++){const dot=document.createElement('i');if(i%4===0)dot.className='downbeat';$('instrumentBeat').append(dot)}}

  // Visual calibration never touches any audio gain node.
  const polishKey='sonic-universe-refinement',draftKey='sonic-universe-drafts';
  let refinement={profile:'balanced',auto:true},drafts={version:2,songs:{},films:{},tab:'mood'};
  try{const v=JSON.parse(localStorage.getItem(polishKey)||'null');if(v){if(['soft','balanced','strong'].includes(v.profile))refinement.profile=v.profile;refinement.auto=v.auto!==false}}catch{}
  try{const v=JSON.parse(localStorage.getItem(draftKey)||'null');if(v?.version===1&&v.songs&&v.films)drafts={version:2,songs:v.songs,films:Object.fromEntries(Object.entries(v.films).map(([id,draft])=>[id,{fields:draft?.fields||{}}])),tab:v.tab};else if(v?.version===2&&v.songs&&v.films)drafts=v}catch{}
  const responseProfiles={soft:{name:'柔和',gain:.72,cap:.74,cooldown:600},balanced:{name:'均衡',gain:1,cap:.92,cooldown:380},strong:{name:'强烈',gain:1.24,cap:1,cooldown:280}};
  let rawRms=0,calibrationGain=1,calibrationLevel=.12,calibrationAge=0,calibrationSource='',calibrationReadout=0,externalHealth='waiting',externalHelpDismissed=false;
  let cloudOrigin=null,spiralOrigin=null,layoutTransition=null,immersiveMix=0;
  function persistRefinement(){try{localStorage.setItem(polishKey,JSON.stringify(refinement));storageIssues.delete('refinement')}catch{storageIssues.add('refinement')}updateStorageStatus();syncResponseControls()}
  function resetCalibration(){calibrationLevel=.12;calibrationAge=0;calibrationGain=1;bassFloor=.12;previousBass=0;previousHigh=0;beatPulse=0;treblePulse=0;musicResponse.reset();syncResponseControls()}
  function calibrateVisual(rms,dt){
    rawRms=rms;const source=externalStream?'external-'+externalGeneration:instrumentOpen?'instrument':activeId;
    if(source!==calibrationSource){calibrationSource=source;resetCalibration()}
    if(rms>.003){calibrationAge+=dt;calibrationLevel+=(rms-calibrationLevel)*(1-Math.exp(-dt*(rms>calibrationLevel?1.5:.35)))}
    const target=refinement.auto?clamp(.14/Math.max(.025,calibrationLevel),.5,3):1;
    calibrationGain+=(target-calibrationGain)*(1-Math.exp(-dt*1.5));
    app.dataset.rawRms=rms.toFixed(5);app.dataset.calibrationGain=calibrationGain.toFixed(3);app.dataset.responseProfile=refinement.profile;
  }
  function visualSignal(value){const p=responseProfiles[refinement.profile],noise=clamp((rawRms-.0015)/.003,0,1);return p.cap*(1-Math.exp(-Math.max(0,value)*calibrationGain*atelier.settings.sensitivity*p.gain*1.55))*noise}
  function responsePanel(){const box=document.createElement('section');box.className='response-panel';box.setAttribute('aria-label','音乐画面响应');box.innerHTML='<div class="response-heading"><strong>音乐画面响应</strong><small>只调星光，不改音量</small></div><div class="response-profiles" role="group" aria-label="画面响应强度"><button type="button" data-response="soft">柔和</button><button type="button" data-response="balanced">均衡</button><button type="button" data-response="strong">强烈</button></div><div class="response-bottom"><label><input type="checkbox" data-auto-response>自动校准</label><button type="button" data-recalibrate>重新校准 ↻</button></div><span class="response-readout" aria-live="off"></span>';return box}
  function syncResponseControls(){document.querySelectorAll('[data-response]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.response===refinement.profile)));document.querySelectorAll('[data-auto-response]').forEach(b=>b.checked=refinement.auto);document.querySelectorAll('.response-readout').forEach(el=>el.textContent=!refinement.auto?'手动响应 · 可在创作台微调灵敏度':rawRms>.003?(calibrationAge<3?'正在随音乐校准…':'已适应当前声音 · '+responseProfiles[refinement.profile].name):'等待音乐 · 安静时让星光休息')}
  function setExternalHealth(value){
    const changed=externalHealth!==value;externalHealth=value;if(changed)externalHelpDismissed=false;
    const label={waiting:'等待连接',sound:'正在接收声音',silent:'暂时无声',ended:'连接结束'}[value];
    app.dataset.externalHealth=value;const box=$('externalHealth');if(!box)return;box.dataset.health=value;box.querySelector('span').textContent=label;
    $('externalStateTitle').textContent=value==='sound'?'外界的声音，正在成为星光':value==='silent'?'旋律暂歇，星空仍在这里':value==='ended'?'这段联动已结束':externalPending?'在浏览器弹窗中选择声音来源':'等待一束来自外界的声音';
    $('externalHelp').hidden=externalHelpDismissed||!['silent','ended'].includes(value);$('externalReconnectBtn').disabled=externalPending||clipLocked();
    const ribbon=$('sourceRibbon').querySelector('span');if(ribbon)ribbon.textContent=value==='sound'?'外部声音 · 正在接收声音':value==='silent'?'外部声音 · 暂时无声':'外部声音 · 等待旋律';
  }
  function blendTexture(origin,target,mix){const c=document.createElement('canvas');c.width=target.width;c.height=target.height;const g=c.getContext('2d');g.globalAlpha=1-mix;g.drawImage(origin,0,0,c.width,c.height);g.globalCompositeOperation='lighter';g.globalAlpha=mix;g.drawImage(target,0,0,c.width,c.height);return c}
  function preservePaletteOrigin(){cloudOrigin=blendTexture(cloudOrigin||cloudTexture(previousTheme),cloudTexture(themeKey),cloudBlend);spiralOrigin=blendTexture(spiralOrigin||galaxyTexture(previousTheme),galaxyTexture(themeKey),cloudBlend);mistOrigins=[0,1,2].map(layer=>blendTexture(mistOrigins[layer]||mistTexture(previousTheme,layer),mistTexture(themeKey,layer),smooth(cloudBlend)))}
  function beginLayoutTransition(){if(reduced)return;const rect=app.getBoundingClientRect();layoutTransition={x:rect.left+centerX,y:rect.top+centerY,r:baseR,age:0}}
  function updatePolish(dt,now){
    const quiet=app.classList.contains('quiet');immersiveMix+=((quiet?1:0)-immersiveMix)*(1-Math.exp(-dt*6));
    if(layoutTransition){layoutTransition.age+=dt;const u=1-Math.exp(-layoutTransition.age*6),mobile=w<=760,extra=mobile?Math.max(0,document.querySelector('.intro').offsetTop+document.querySelector('.intro').offsetHeight+20-205):0;
      const x=w*(mobile||quiet?.5:.647),y=quiet?h*.5:mobile?406+extra:Math.min(h*.443,430),r=quiet?Math.min(w*.31,h*.31,340):mobile?Math.min(w*.30,152):Math.min(w*.185,h*.225,255);
      const rect=app.getBoundingClientRect(),fromX=layoutTransition.x-rect.left,fromY=layoutTransition.y-rect.top;centerX=fromX+(x-fromX)*u;centerY=fromY+(y-fromY)*u;baseR=layoutTransition.r+(r-layoutTransition.r)*u;if(layoutTransition.age>1.3)layoutTransition=null;
    }
    app.dataset.renderCenter=JSON.stringify({x:centerX,y:centerY,r:baseR,immersive:immersiveMix});if(now-calibrationReadout>450){calibrationReadout=now;syncResponseControls();updateRecoveryButtons()}
  }
  // Stable particle identities move between the three existing geometries.
  function reformPoint(i,key,r,t){
    const p=ring[i],g=galaxyParticles[i];
    if(key==='ring'){const a=p.a+t*.018*(p.layer>.5?1:-.45),signal=visualSignal(freqData?.[2+Math.floor(((a%6.283+6.283)%6.283)/6.283*130)]/255||0),rr=r*(1+p.band*.14)+Math.sin(a*5+t*.7+p.phase)*1.8+signal*(8+mid*15)*intensity+Math.sin(a*13-beatAge*30)*(reduced?0:beatPulse*intensity)*6+(reduced?0:music.percussion*r*.024*Math.sin(a*3-t*.8));const x=Math.cos(a)*rr*1.23,y=Math.sin(a)*rr*.78,tilt=-.31+mouse.x*.13;return[x*Math.cos(tilt)-y*Math.sin(tilt),x*Math.sin(tilt)+y*Math.cos(tilt)]}
    if(key==='galaxy'){const a=g.arm*Math.PI/2+g.radial*5.7+t*.012+g.scatter*.31+music.drift*.025*Math.sin(g.radial*8+p.phase),rr=g.radial*r*1.17*(1+(reduced?0:beatPulse)*.06*intensity),x=Math.cos(a)*rr*1.3,y=Math.sin(a)*rr*.7+g.height*r*.45+Math.sin(t*.3+g.phase)*1.2,tilt=-.31+mouse.x*.16+Math.sin(t*.06)*.04;return[x*Math.cos(tilt)-y*Math.sin(tilt),x*Math.sin(tilt)+y*Math.cos(tilt)]}
    if(key==='blackhole'){const a=p.a+t*(.09+.08*(1-g.radial)),rr=r*(.40+g.radial*.97)*(1+beatPulse*.035*intensity),z=Math.sin(a)*.35;return[Math.cos(a)*rr*1.44*(1+z*.12),Math.sin(a)*rr*.30+g.height*r*.16-Math.cos(a)*rr*.20]}
    const u=p.a/6.283185307,z=p.layer,row=Math.floor(z*28),symmetric=1-Math.abs(u-.5)*2,band=clamp(Math.floor((1-symmetric)*62+3),0,95),history=terrainHistory[Math.min(terrainHistory.length-1,Math.floor(row/29*35))],v=history?.[band]||0,shape=Math.pow(Math.max(0,Math.sin(u*Math.PI)),.8),ridge=(.17+.11*Math.sin(u*17+z*9+t*.24)+.055*Math.cos(u*33-z*5))*shape,height=(ridge+Math.pow(v,1.6)*(.45+mid*.35)*intensity+Math.sin(u*24+z*7+t*.2)*.018)*r*(.45+z*.65);
    return[(u-.5)*r*2.9*(.33+z*.76)+mouse.x*(z-.5)*16,r*.45-r*1.12*(1-z)-height+mouse.y*z*8];
  }
  function drawReformingStars(cx,cy,r,t){
    if(reduced)return;if(drawGpuStars(cx,cy,r,t))return;ctx.save();ctx.globalCompositeOperation='lighter';const weights=Object.entries(sceneWeights);for(let i=0;i<ring.length;i++){let x=0,y=0;for(const [key,weight] of weights){if(weight<.0001)continue;const point=reformPoint(i,key,r,t);x+=point[0]*weight;y+=point[1]*weight}const p=ring[i],g=galaxyParticles[i],spark=music.shimmer*Math.pow(Math.max(0,Math.sin(p.phase*7.13)),14),alpha=(sceneWeights.ring*p.alpha*.7+sceneWeights.galaxy*(.3+g.depth*.3)+sceneWeights.peaks*(.2+p.layer*.45)+sceneWeights.blackhole*(.25+g.depth*.50))*intensity,size=(.5+p.r*.7+spark*1.3)*(1+visualEffects.glow*.65)*(1+(g.depth-.5)*visualEffects.depth*.5),depth=1+(g.depth-.5)*visualEffects.depth*.13;x*=depth;y*=depth;ctx.fillStyle=rgba(p.layer>.85?palette.hot:palette.core,clamp(alpha+spark*.5,0,.9));ctx.fillRect(cx+x,cy+y,size,size)}ctx.restore();
  }
  const songDraftFields=['lyricSource','lyricOffset','lyricSize','lyricOnly','lyricEnabled','memoryNote','segmentA','segmentB','segmentLoop','cuesEnabled','cueTime','cueText','cueBurst'];
  const filmDraftFields=['clipSong','clipAuthor','clipMood'];
  function syncResetFields(ids){const before=readFields(songDraftFields);syncSongControls(false);const retain=songDraftFields.filter(id=>!ids.includes(id));writeFields(before,retain);captureSongDraft()}
  const histories=new Map();let draftOwner=null,filmOwner=null,recoveryApplying=false,draftTimer=0,polishReady=false;
  const clone=v=>JSON.parse(JSON.stringify(v));
  function readFields(ids){const v={};for(const id of ids){const el=$(id);v[id]=el.type==='checkbox'?el.checked:el.value}return v}
  function writeFields(values,ids){if(!values||typeof values!=='object')return;for(const id of ids){const el=$(id),v=values[id];if(el.type==='checkbox'){if(typeof v==='boolean')el.checked=v}else if(typeof v==='string')el.value=v.slice(0,id==='lyricSource'?160000:1000)}}
  function filmDraftId(){return clipInstrumentMode?'instrument':'song:'+activeId}
  function captureSongDraft(){if(!polishReady||!draftOwner)return;drafts.songs[draftOwner]=readFields(songDraftFields);drafts.tab=atelierTab;if(atelierReady&&!restoring&&draftOwner===activeId){drafts.creations||={};drafts.creations[draftOwner]=clone(songArt()||{})}}
  function captureFilmDraft(){if(!polishReady||!filmOwner)return;drafts.films[filmOwner]={fields:readFields(filmDraftFields),shape:clipShape,length:clipLength}}
  function saveDrafts(){if(backupRestoring)return;clearTimeout(draftTimer);captureSongDraft();captureFilmDraft();try{localStorage.setItem(draftKey,JSON.stringify(drafts));storageIssues.delete('drafts');app.dataset.draftState='saved'}catch{storageIssues.add('drafts');app.dataset.draftState='error'}updateStorageStatus();updateRecoveryButtons()}
  function scheduleDraftSave(){app.dataset.draftState='saving';clearTimeout(draftTimer);draftTimer=setTimeout(saveDrafts,240);updateStorageStatus()}
  function restoreCreativeDrafts(){
    if(!drafts.creations||typeof drafts.creations!=='object')return;
    for(const [id,raw] of Object.entries(drafts.creations)){
      const track=tracks.find(item=>item.id===id);
      if(!raw||typeof raw!=='object'||!track)continue;
      const art={},stored=atelier.songs[id];
      if(raw.look)art.look=validLook(raw.look);
      // Library edits and scans can commit newer lyrics for an inactive song.
      if(stored?.lyrics)art.lyrics=stored.lyrics;
      else if(!track.manualFields?.lyrics&&typeof raw.lyrics?.raw==='string')art.lyrics=restoreLyricSettings(raw.lyrics);
      const lyricOffset=stored?.lyricOffset??raw.lyricOffset;
      if(Number.isFinite(lyricOffset))art.lyricOffset=finite(lyricOffset,0,-30,30);
      if(raw.segment)art.segment={a:finite(raw.segment.a,0,0,86400),b:finite(raw.segment.b,15,0,86400),loop:raw.segment.loop===true};art.cuesEnabled=raw.cuesEnabled!==false;art.base=validCue(raw.base);art.cues=Array.isArray(raw.cues)?raw.cues.map(validCue).filter(Boolean).slice(0,60).sort((a,b)=>a.time-b.time):[];atelier.songs[id]=art;
    }
    lyricCache=null;cueTrack=null;cuePosition=-1;persistAtelier();
  }
  async function retryPendingSaves(){
    if(libraryReadFailed){retryLibraryRead();return}
    if(backupRestoring)return;app.dataset.draftState='saving';updateStorageStatus();saveDrafts();savePreferences();saveSession();saveInstrument();persistRefinement();persistVisualPresets();
    if(storageIssues.has('particle-engine'))try{localStorage.setItem('sonic-universe-particle-engine',particleEngine);storageIssues.delete('particle-engine')}catch{}
    await Promise.all([persistLibrary(),persistAtelier(),persistBackground()]);updateStorageStatus();updateRecoveryButtons();
  }
  function flushCreativeChanges(){if(!polishReady||backupRestoring)return;if(cueDrag){cueDrag=null;finishCueEdit()}saveDrafts();savePreferences();saveSession();saveInstrument();persistAtelier()}
  function restoreSongDraft(keep=true){if(!polishReady)return;const changed=draftOwner!==activeId;if(changed){$('memoryNote').value='';$('cueTime').value='0';$('cueText').value='';$('cueBurst').checked=false}draftOwner=activeId;if(keep)writeFields(drafts.songs[activeId],songDraftFields);else drafts.songs[activeId]=readFields(songDraftFields);const note=$('draftRestored');if(note)note.textContent=drafts.songs[activeId]?'已恢复这首歌的草稿 · 应用歌词后才会显示到星空':'未应用的文字也会自动保存，下次继续。';if(changed||!histories.has(historyKey('atelier')))primeHistory('atelier')}
  function restoreFilmDraft(){if(!polishReady)return;filmOwner=filmDraftId();const v=drafts.films[filmOwner];if(v){writeFields(v.fields,filmDraftFields);if(['landscape','portrait'].includes(v.shape))clipShape=v.shape;if([0,15,30].includes(v.length))clipLength=v.length}primeHistory('clip');clipUpdateControls()}
  function recoveryScope(el){const d=el.closest('dialog');return d?.id==='atelierDialog'?'atelier':d?.id==='studioDialog'?'studio':d?.id==='instrumentDialog'?'instrument':d?.id==='clipDialog'?'clip':el.closest('.themes,#roamLookPanel')?'visual':null}
  function historyKey(scope){return scope+(scope==='atelier'?':'+activeId:scope==='clip'?':'+filmDraftId():'')}
  function recoverySnapshot(scope){
    if(scope==='visual')return{look:captureLook(),profile:clone(refinement)};
    if(scope==='atelier')return{look:captureLook(),settings:clone(atelier.settings),custom:clone(atelier.custom),art:clone(songArt()||{}),memories:clone(atelier.memories),fields:readFields(songDraftFields),profile:clone(refinement),cueSelection:selectedCueTrack===activeId?selectedCueId:''};
    if(scope==='studio')return{space:clone(space),look:captureLook()};
    if(scope==='instrument')return{project:clone(instrumentProject),title:$('instrumentTitle').value};
    return{fields:readFields(filmDraftFields),shape:clipShape,length:clipLength};
  }
  function historyFor(scope){const key=historyKey(scope);if(!histories.has(key))histories.set(key,{past:[],future:[],last:recoverySnapshot(scope),gesture:null,at:0});return histories.get(key)}
  function primeHistory(scope){if(!polishReady||recoveryApplying)return;const h=historyFor(scope);h.last=recoverySnapshot(scope);h.gesture=null;updateRecoveryButtons()}
  function commitRecovery(scope,gesture=null){if(!polishReady||recoveryApplying)return;const h=historyFor(scope),next=recoverySnapshot(scope);if(JSON.stringify(next)===JSON.stringify(h.last))return;const now=performance.now();if(!gesture||gesture!==h.gesture||now-h.at>850){h.past.push(h.last);if(h.past.length>16)h.past.shift()}h.future=[];h.last=next;h.gesture=gesture;h.at=now;updateRecoveryButtons()}
  function restoreRecovery(scope,s){recoveryApplying=true;try{
    if(scope==='visual'){refinement=clone(s.profile);applyLook(s.look,true);persistRefinement()}
    if(scope==='atelier'){Object.assign(atelier.settings,s.settings);atelier.custom=clone(s.custom);atelier.songs[activeId]=clone(s.art);atelier.memories=clone(s.memories);refinement=clone(s.profile);applyLook(s.look,true);lyricCache=null;lyricTrack=null;cueTrack=null;cuePosition=-1;cueText='';syncSongControls(false);writeFields(s.fields,songDraftFields);selectedCueTrack=activeId;selectedCueId=s.cueSelection||'';renderCues();renderMemories();persistAtelier();persistRefinement();captureSongDraft()}
    if(scope==='studio'){space=clone(s.space);applySpace(true);applyLook(s.look,true);savePreferences();rebuildBackground()}
    if(scope==='instrument'){stopInstrumentLoop('',true);instrumentProject=clone(s.project);instrumentProject.title=s.title;syncInstrumentFields();instrumentUndo=null;saveInstrument();renderInstrumentLayers();renderInstrumentBeat();updateInstrumentControls()}
    if(scope==='clip'){writeFields(s.fields,filmDraftFields);clipShape=s.shape;clipLength=s.length;clipSaveSettings();clipUpdateControls();renderClipFrame(true)}
    syncEffects();if($('presetDialog')?.open)renderVisualPresets();saveDrafts();
  }finally{recoveryApplying=false}}
  function undoRecovery(scope,redo=false){if(recoveryLocked(scope))return;const h=historyFor(scope),from=redo?h.future:h.past,to=redo?h.past:h.future;if(!from.length)return;to.push(recoverySnapshot(scope));const next=from.pop();restoreRecovery(scope,next);h.last=recoverySnapshot(scope);h.gesture=null;updateRecoveryButtons();showToast(redo?'已重做，可继续创作。':'已撤销，草稿已保留。')}
  function recoveryLocked(scope){return clipLocked()||scope==='instrument'&&Boolean(instrumentTake||instrumentLooping||instrumentLoad)}
  function syncInstrumentFields(){for(const [id,key] of Object.entries({instrumentTitle:'title',instrumentTone:'tone',instrumentOctave:'octave',instrumentTempo:'tempo',instrumentBars:'bars',instrumentQuantize:'quantize',instrumentMetronome:'metronome',instrumentVolume:'volume'})){const el=$(id);if(el.type==='checkbox')el.checked=instrumentProject[key];else el.value=key==='volume'?instrumentProject[key]*100:instrumentProject[key]}if(instrumentBus&&audioContext)instrumentBus.gain.setTargetAtTime(instrumentProject.volume*.55,audioContext.currentTime,.02)}
  function resetRecovery(scope){if(recoveryLocked(scope))return;historyFor(scope);recoveryApplying=true;try{
    if(scope==='visual'){applyLook({theme:'nebula',visualMode:'ring'},true);refinement={profile:'balanced',auto:true};persistRefinement();resetCalibration()}
    if(scope==='studio'){space={...defaultSpace};applySpace(true);applyLook({theme:'nebula',visualMode:'ring'},true);savePreferences();rebuildBackground()}
    if(scope==='atelier'){
      if(atelierTab==='mood'){Object.assign(atelier.settings,{sensitivity:1,interaction:.65,breathing:true,transition:true,mood:null});applyLook({theme:'nebula',visualMode:'ring'},true);refinement={profile:'balanced',auto:true};persistRefinement();resetCalibration()}
      else if(atelierTab==='lyrics'){delete songArt(true).lyrics;lyricCache=null;lyricIndex=-1;lyricDust=[];syncResetFields(songDraftFields.filter(id=>id.startsWith('lyric')))}
      else if(atelierTab==='memories')$('memoryNote').value='';
      else{Object.assign(songArt(true),{segment:{a:0,b:Math.min(15,duration),loop:false},cues:[],base:null,cuesEnabled:true});cueTrack=null;cueText='';syncResetFields(songDraftFields.filter(id=>id.startsWith('segment')||id.startsWith('cue')));$('cueTime').value='0';$('cueText').value='';$('cueBurst').checked=false}
      syncMoodControls();persistAtelier();captureSongDraft();
    }
    if(scope==='instrument'){const layers=instrumentProject.layers,bars=instrumentProject.bars;instrumentProject={version:1,title:'我的星际即兴',tone:'bell',octave:0,tempo:96,bars:layers.length?bars:2,quantize:true,metronome:true,volume:.7,layers};syncInstrumentFields();saveInstrument();renderInstrumentBeat();updateInstrumentControls()}
    if(scope==='clip'){clipShape='portrait';clipLength=30;invalidateFilmAnalysis('已恢复短片默认设置，按当前歌曲重新分析后可录制。');$('clipSong').value=clipInstrumentMode?instrumentProject.title:currentTrack()?.name||'';$('clipAuthor').value='';$('clipMood').value='';clipSaveSettings();clipUpdateControls();renderClipFrame(true)}
  }finally{recoveryApplying=false}syncEffects();if($('presetDialog')?.open)renderVisualPresets();commitRecovery(scope);saveDrafts();showToast('已恢复当前栏目默认，可撤销。')}
  function updateRecoveryButtons(){if(!polishReady)return;document.querySelectorAll('.edit-recovery').forEach(box=>{const scope=box.dataset.scope,h=historyFor(scope),locked=recoveryLocked(scope);box.querySelector('[data-edit-undo]').disabled=locked||!h.past.length;box.querySelector('[data-edit-redo]').disabled=locked||!h.future.length;box.querySelector('[data-edit-reset]').disabled=locked;const el=box.querySelector('.recovery-save'),bad=storageIssues.size>0;el.classList.toggle('error',bad);el.textContent=bad?'保存失败，点这里重试':app.dataset.draftState==='saving'||savingCount?'正在保存在本机…':'已保存在本机';el.setAttribute('role',bad?'button':'status');if(bad){el.tabIndex=0;el.title='重试未完成的本机保存'}else{el.removeAttribute('tabindex');el.removeAttribute('title')}box.dataset.undoCount=h.past.length})}
  function addRecoveryToolbar(scope,id,description){const box=document.createElement('div');box.className='edit-recovery';box.dataset.scope=scope;box.innerHTML='<button type="button" data-edit-undo>撤销 ↶</button><button type="button" data-edit-redo>重做 ↷</button><button type="button" data-edit-reset>恢复默认</button><span class="recovery-save" role="status"></span><small></small>';box.querySelector('small').textContent=description;$(id).querySelector('.dialog-heading').after(box);box.querySelector('[data-edit-undo]').addEventListener('click',()=>undoRecovery(scope));box.querySelector('[data-edit-redo]').addEventListener('click',()=>undoRecovery(scope,true));box.querySelector('[data-edit-reset]').addEventListener('click',()=>resetRecovery(scope))}
  function setupPolish(){
    document.querySelector('.themes').append(responsePanel());document.querySelector('[data-atelier-panel="mood"]').append(responsePanel());$('externalStatus').before(responsePanel());
    const health=document.createElement('div');health.id='externalHealth';health.className='external-health';health.setAttribute('role','status');health.innerHTML='<i></i><span>等待连接</span>';$('externalDialog').querySelector('.external-hero').before(health);
    const help=document.createElement('div');help.id='externalHelp';help.className='external-help';help.hidden=true;help.innerHTML='<strong>让声音重新抵达星空</strong><ol><li>回到汽水音乐或原播放器，确认正在播放、音量未静音。</li><li>重新选择来源，在共享弹窗中勾选「共享音频／系统音频」。</li><li>如果共享窗口没有声音，试试「整个屏幕」并开启系统音频；也可用 Chrome 或 Edge 打开本机网址。</li></ol><div class="external-help-actions"><button type="button" class="secondary-btn" id="externalReconnectBtn">重新连接 ↗</button><button type="button" class="text-btn" id="externalKeepBtn">继续等待旋律</button></div><div class="external-help-note">连接由你选择来源；暂时无声不会中断共享，恢复播放后星空会自动响应。</div>';$('externalStatus').before(help);
    $('externalReconnectBtn').addEventListener('click',()=>{if(externalStream||externalPending)stopExternal('正在重新选择声音来源。');resetCalibration();connectExternal()});$('externalKeepBtn').addEventListener('click',()=>{externalHelpDismissed=true;help.hidden=true});
    document.querySelectorAll('[data-response]').forEach(b=>b.addEventListener('click',()=>{refinement.profile=b.dataset.response;persistRefinement()}));document.querySelectorAll('[data-auto-response]').forEach(b=>b.addEventListener('change',()=>{refinement.auto=b.checked;persistRefinement()}));document.querySelectorAll('[data-recalibrate]').forEach(b=>b.addEventListener('click',()=>{resetCalibration();showToast('已重新开始画面校准，不影响音乐音量。')}));
    addRecoveryToolbar('atelier','atelierDialog','撤销与默认作用于当前歌曲和栏目；关闭面板保留未应用的文字。');addRecoveryToolbar('studio','studioDialog','恢复默认会重置空间文字与画面设置，保留音乐、封面和背景图片。');addRecoveryToolbar('instrument','instrumentDialog','设置与旋律可撤销；恢复默认保留录好的层，播放需由你重新开始。');addRecoveryToolbar('clip','clipDialog','短片文字按歌曲／演奏分别保存；恢复默认保留上次录好的短片。');
    const mainTools=document.createElement('div');mainTools.className='edit-recovery visual-recovery';mainTools.dataset.scope='visual';mainTools.innerHTML='<button type="button" data-edit-undo>撤销 ↶</button><button type="button" data-edit-redo>重做 ↷</button><button type="button" data-edit-reset>恢复默认</button><span class="recovery-save"></span>';document.querySelector('.themes').append(mainTools);mainTools.querySelector('[data-edit-undo]').addEventListener('click',()=>undoRecovery('visual'));mainTools.querySelector('[data-edit-redo]').addEventListener('click',()=>undoRecovery('visual',true));mainTools.querySelector('[data-edit-reset]').addEventListener('click',()=>resetRecovery('visual'));
    const note=document.createElement('p');note.id='draftRestored';note.className='draft-restored';$('atelierDialog').querySelector('.atelier-tabs').after(note);
    polishReady=true;app.dataset.recoveryReady='true';atelierTab=['mood','lyrics','memories','rehearsal'].includes(drafts.tab)?drafts.tab:'mood';syncResponseControls();setExternalHealth('waiting');
    for(const id of ['atelierDialog','studioDialog','clipDialog','instrumentDialog'])$(id).addEventListener('close',()=>{saveDrafts();primeHistory('visual')});
    $('instrumentTitle').addEventListener('input',()=>{instrumentProject.title=$('instrumentTitle').value;saveInstrument()});
    for(const event of ['input','change','click'])document.addEventListener(event,e=>{const scope=recoveryScope(e.target);if(!scope||e.target.closest('.edit-recovery,.cue-timeline,#cueList')||e.target.closest('[data-note-pad]')||e.target.matches('input[type=file],#cueTime,#cueText,#cueBurst,#addCueBtn,#cueNewBtn,#cueDeleteBtn'))return;historyFor(scope);const gesture=event==='input'?scope+':'+e.target.id:null;setTimeout(()=>{commitRecovery(scope,gesture);captureSongDraft();captureFilmDraft();scheduleDraftSave()},0)},true);
    document.addEventListener('click',e=>{if(e.target.closest('.recovery-save[role=button],.storage-status[role=button]'))retryPendingSaves()});document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.recovery-save[role=button],.storage-status[role=button]')){e.preventDefault();retryPendingSaves()}});
    window.addEventListener('pagehide',flushCreativeChanges);document.addEventListener('visibilitychange',()=>{if(document.hidden)flushCreativeChanges()});
    Promise.all([atelierPromise,libraryPromise]).then(()=>{restoreCreativeDrafts();syncSongControls();restoreSongDraft();primeHistory('studio');primeHistory('instrument');updateRecoveryButtons()});
    const localPreview=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
    const connection=document.createElement('div');connection.className='preview-connection';connection.hidden=true;connection.setAttribute('role','status');
    connection.textContent=localPreview?'本机预览服务已断开 · 请双击项目文件夹里的「打开声波宇宙.cmd」，再刷新页面。':'暂时无法连接网站 · 请检查网络后重试；页面中的音乐仍可继续使用。';
    document.body.append(connection);let checking=false;setInterval(async()=>{if(document.hidden||checking||!/^https?:$/.test(location.protocol))return;checking=true;try{const healthUrl=new URL(location.href);healthUrl.hash='';healthUrl.searchParams.set('health',Date.now());const r=await fetch(healthUrl,{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(4000)});connection.hidden=r.ok}catch{connection.hidden=false}finally{checking=false}},15000);
  }

  // Native WebGL particles, composited into the shared canvas for live and exported frames.
  let visualEffects={depth:.65,glow:.6,trail:.55,response:refinement.profile,beat:false},gpuDirty=true,gpuLayer=null,gpuUnavailable=false;
  let particleEngine='auto';try{if(localStorage.getItem('sonic-universe-particle-engine')==='canvas')particleEngine='canvas'}catch{}
  function rendererStatus(value){if(app.dataset.particleRenderer===value)return;app.dataset.particleRenderer=value;const el=$('particleRenderer');if(el)el.textContent=value==='webgl'?'GPU 星尘':value==='reduced'?'低动态星尘':'兼容星尘'}
  function makeGpuLayer(existing){
    const surface=existing||document.createElement('canvas');
    const gl=surface.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
    if(!gl)throw new Error('WebGL unavailable');
    const vs='precision highp float; attribute vec4 seed; attribute vec4 galaxy; attribute vec3 misc; uniform vec4 weights; uniform vec4 sound; uniform vec4 music; uniform vec4 character; uniform vec3 control; uniform float clock; uniform float pixels; uniform sampler2D terrain; varying float opacity; varying float warmth; void main(){ float a=seed.x+clock*.018*(seed.z>.5?1.:-.45); float signalRing=texture2D(terrain,vec2(fract(seed.x/6.2831853),0.)).r; float rr=1.+seed.y*.14+sin(a*5.+clock*.7+misc.x)*.008+signalRing*.065*control.z+music.x*.025+character.y*.024*sin(a*3.-clock*.8); vec2 ring=vec2(cos(a)*rr*1.23,sin(a)*rr*.78); float tilt=-.31; ring=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*ring; float ga=galaxy.y*1.5707963+galaxy.x*5.7+clock*.012+galaxy.z*.31+music.y*sin(galaxy.x*11.+misc.x)*.04+character.w*.025*sin(galaxy.x*8.+misc.x); vec2 spiral=vec2(cos(ga)*galaxy.x*1.52,sin(ga)*galaxy.x*.82+galaxy.w*.45); spiral=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*spiral; float u=seed.x/6.2831853; float z=seed.z; float band=(abs(u-.5)*124.+3.)/96.; float signal=texture2D(terrain,vec2(clamp(band,0.,1.),z)).r; float ridge=(.17+.11*sin(u*17.+z*9.+clock*.24)+.055*cos(u*33.-z*5.))*pow(max(0.,sin(u*3.141593)),.8); vec2 peaks=vec2((u-.5)*2.9*(.33+z*.76),.45-1.12*(1.-z)-(ridge+pow(signal,1.6)*(.45+sound.y*.35)*control.z)*(.45+z*.65)); float ba=seed.x+clock*(.09+.08*(1.-galaxy.x)); float br=(.40+galaxy.x*.97)*(1.+sound.w*.035*control.z); vec2 hole=vec2(cos(ba)*br*1.44*(1.+sin(ba)*.042),sin(ba)*br*.30+galaxy.w*.16-cos(ba)*br*.20); vec2 pos=ring*weights.x+spiral*weights.y+peaks*weights.z+hole*weights.w; float depth=(misc.z-.5)*control.x; pos*=1.+depth*(.13+music.x*.035+character.x*.035); gl_Position=vec4(pos.x*.5,-pos.y*.5,0.,1.); gl_PointSize=clamp((.65+seed.w*.9+music.z*pow(max(0.,sin(misc.x*7.13)),14.)*2.4)*(1.+depth*.5)*(1.+control.y*.65+character.z*.08)*pixels,1.,12.); opacity=(weights.x*misc.y*.7+weights.y*(.3+misc.z*.3)+weights.z*(.2+z*.45)+weights.w*(.25+misc.z*.5))*control.z*(.8+music.w*.2)+music.z*pow(max(0.,sin(misc.x*7.13)),14.)*.6; warmth=step(.85,z); }';
    const fs='precision mediump float; uniform vec3 core; uniform vec3 hot; uniform float glow; varying float opacity; varying float warmth; void main(){ float d=length(gl_PointCoord-vec2(.5))*2.; if(d>1.)discard; float a=(exp(-d*d*5.)*.75+pow(max(0.,1.-d),3.)*.5)*opacity; vec3 color=mix(core,hot,warmth); gl_FragColor=vec4(color*a*(1.+glow*.35),a); }';
    function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}
    const program=gl.createProgram(),vertex=shader(gl.VERTEX_SHADER,vs),fragment=shader(gl.FRAGMENT_SHADER,fs);gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const buffer=gl.createBuffer(),texture=gl.createTexture(),uniforms={};for(const name of ['weights','sound','music','character','control','clock','pixels','terrain','core','hot','glow'])uniforms[name]=gl.getUniformLocation(program,name);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(const [name,size,offset] of [['seed',4,0],['galaxy',4,16],['misc',3,32]]){const id=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(id);gl.vertexAttribPointer(id,size,gl.FLOAT,false,44,offset)}
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(uniforms.terrain,0);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    if(!existing){surface.addEventListener('webglcontextlost',e=>{e.preventDefault();gpuUnavailable=true;rendererStatus('canvas')});surface.addEventListener('webglcontextrestored',()=>{try{gpuLayer=makeGpuLayer(surface);gpuDirty=true;gpuUnavailable=false}catch{gpuUnavailable=true}})}
    return{surface,gl,program,buffer,texture,uniforms,terrain:new Uint8Array(96*36)};
  }
  function drawGpuStars(cx,cy,r,t){
    if(particleEngine==='canvas'||gpuUnavailable){rendererStatus('canvas');return false}
    try{
      if(!gpuLayer)gpuLayer=makeGpuLayer();const {surface,gl,uniforms,terrain}=gpuLayer;if(gl.isContextLost()){rendererStatus('canvas');return false}
      // Keep one framebuffer size across live, instrument and video draws to avoid reallocating it every frame.
      const size=1024;if(surface.width!==size||surface.height!==size){surface.width=surface.height=size;gl.viewport(0,0,size,size)}
      if(gpuDirty){const data=new Float32Array(ring.length*11);for(let i=0;i<ring.length;i++){const p=ring[i],g=galaxyParticles[i];data.set([p.a,p.band,p.layer,p.r,g.radial,g.arm,g.scatter,g.height,p.phase,p.alpha,g.depth],i*11)}gl.bindBuffer(gl.ARRAY_BUFFER,gpuLayer.buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gpuDirty=false}
      for(let row=0;row<36;row++){const history=terrainHistory[Math.min(terrainHistory.length-1,Math.floor(row/35*35))]||terrainBands;for(let i=0;i<96;i++)terrain[row*96+i]=Math.round(clamp(history[i]||0,0,1)*255)}gl.bindTexture(gl.TEXTURE_2D,gpuLayer.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,96,36,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,terrain);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform4f(uniforms.weights,sceneWeights.ring,sceneWeights.galaxy,sceneWeights.peaks,sceneWeights.blackhole);gl.uniform4f(uniforms.sound,bass,mid,treblePulse,beatPulse);gl.uniform4f(uniforms.music,music.cloud,music.flow,music.shimmer,music.presence);gl.uniform4f(uniforms.character,music.sustain,music.percussion,music.air,music.drift);gl.uniform3f(uniforms.control,visualEffects.depth,visualEffects.glow,intensity);gl.uniform1f(uniforms.clock,t);gl.uniform1f(uniforms.pixels,size/(4*r));gl.uniform1f(uniforms.glow,visualEffects.glow);gl.uniform3fv(uniforms.core,palette.core.map(v=>v/255));gl.uniform3fv(uniforms.hot,palette.hot.map(v=>v/255));gl.drawArrays(gl.POINTS,0,ring.length);
      ctx.save();ctx.globalCompositeOperation='lighter';ctx.drawImage(surface,cx-r*2,cy-r*2,r*4,r*4);ctx.restore();rendererStatus('webgl');return true;
    }catch(error){gpuUnavailable=true;rendererStatus('canvas');return false}
  }
  function drawBlackhole(cx,cy,r,t){
    const pulse=reduced?0:beatPulse,spin=reduced?0:t*.024;ctx.save();ctx.translate(cx,cy);ctx.rotate(-.20);ctx.globalCompositeOperation='lighter';
    const halo=ctx.createRadialGradient(0,0,r*.32,0,0,r*1.7);halo.addColorStop(0,rgba(palette.second,0));halo.addColorStop(.35,rgba(palette.core,.10+power*.06));halo.addColorStop(1,rgba(palette.second,0));ctx.fillStyle=halo;ctx.fillRect(-r*1.8,-r*1.8,r*3.6,r*3.6);
    ctx.save();ctx.scale(1.44,.31);const disk=ctx.createRadialGradient(0,0,r*.32,0,0,r*1.46);disk.addColorStop(0,rgba(palette.hot,0));disk.addColorStop(.12,rgba(palette.hot,(.30+mid*.16)*intensity));disk.addColorStop(.32,rgba(palette.core,(.19+power*.14)*intensity));disk.addColorStop(.72,rgba(palette.second,.065*intensity));disk.addColorStop(1,rgba(palette.core,0));ctx.fillStyle=disk;ctx.fillRect(-r*1.5,-r*1.5,r*3,r*3);ctx.restore();
    for(let j=0;j<32;j++){const u=j/31,rad=r*(.43+u*.99)*(1+pulse*.026*intensity);ctx.beginPath();ctx.ellipse(0,0,rad*1.43,rad*(.25+u*.08),0,0,Math.PI*2);ctx.strokeStyle=rgba(j%5===0?palette.hot:palette.core,(.012+Math.pow(1-u,2)*.075)*intensity);ctx.lineWidth=r*(.004+(1-u)*.007);ctx.stroke()}
    for(let j=0;j<7;j++){const rad=r*(.62+j*.11);ctx.beginPath();ctx.ellipse(0,0,rad*1.43,rad*.3,0,Math.PI+spin+j*.13,Math.PI*1.85+spin+j*.13);ctx.strokeStyle=rgba(palette.hot,(.09+high*.14)*intensity);ctx.lineWidth=1+j*.12;ctx.stroke()}
    ctx.restore();if(reduced){rendererStatus('reduced');ctx.save();ctx.globalCompositeOperation='lighter';for(let i=0;i<ring.length;i+=3){const p=ring[i],point=reformPoint(i,'blackhole',r,0);ctx.fillStyle=rgba(palette.core,p.alpha*.6*intensity);ctx.fillRect(cx+point[0],cy+point[1],1,1)}ctx.restore()}
  }
  function drawBlackholeCore(cx,cy,r,t,weight){
    if(weight<.003)return;ctx.save();ctx.globalAlpha*=weight;ctx.translate(cx,cy);ctx.rotate(-.20);const radius=r*(.315+bass*.015*intensity);
    ctx.globalCompositeOperation='source-over';const shadow=ctx.createRadialGradient(0,0,radius*.82,0,0,radius*1.13);shadow.addColorStop(0,'#03040a');shadow.addColorStop(.88,'#03040a');shadow.addColorStop(1,'#03040a00');ctx.fillStyle=shadow;ctx.beginPath();ctx.arc(0,0,radius*1.13,0,Math.PI*2);ctx.fill();
    ctx.globalCompositeOperation='lighter';ctx.shadowColor=rgba(palette.core,.8);ctx.shadowBlur=r*(.055+visualEffects.glow*.06);ctx.strokeStyle=rgba(palette.hot,.65+high*.22);ctx.lineWidth=r*(.009+visualEffects.glow*.006);ctx.beginPath();ctx.ellipse(0,0,radius*1.09,radius*1.04,0,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
    ctx.beginPath();ctx.ellipse(0,-r*.01,r*.67,r*.39,0,Math.PI*1.03,Math.PI*1.97);ctx.strokeStyle=rgba(palette.core,.24+mid*.12);ctx.lineWidth=r*.018;ctx.stroke();
    for(let j=0;j<5;j++){ctx.beginPath();ctx.ellipse(0,r*.015,r*(.52+j*.075),r*(.13+j*.018),0,0,Math.PI);ctx.strokeStyle=rgba(j%2?palette.hot:palette.core,(.10+(4-j)*.025)*intensity);ctx.lineWidth=r*.009;ctx.stroke()}ctx.restore();
  }

  const presetStorageKey='sonic-universe-visual-presets-v1';let customVisualPresets=[],presetStorageError=false;
  const builtinVisualPresets=SonicVisualPresets.map(preset=>({...preset,look:{...preset.look}}));
  let roamLookSignature='';
  function setRoamLookOpen(open,restoreFocus=true){
    const panel=$('roamLookPanel');
    if(open&&(!app.classList.contains('quiet')||clipLocked()))return;
    if(!open&&panel.hidden)return;
    panel.hidden=!open;app.classList.toggle('look-open',open);
    $('roamLookBtn').setAttribute('aria-expanded',String(open));
    if(open){
      roamLookSignature='';syncRoamLooks();
      $('roamLookStatus').textContent='切换星空，音乐继续流动。';
      (panel.querySelector('[data-roam-preset][aria-pressed=true]')||panel.querySelector('[data-roam-preset]')).focus({preventScroll:true});
    }else if(restoreFocus&&app.classList.contains('quiet'))$('roamLookBtn').focus({preventScroll:true});
    wakeRoam();
  }
  function syncRoamLooks(){
    if($('roamLookPanel').hidden)return;
    const signature=presetSignature(captureLook()),key=signature+'|'+renderedMode;
    if(key===roamLookSignature)return;roamLookSignature=key;
    const selected=builtinVisualPresets.find(p=>presetSignature(p.look)===signature);
    document.querySelectorAll('[data-roam-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.roamPreset===selected?.id)));
    $('roamLookCurrent').textContent=selected?'此刻 · '+selected.name:themes[themeKey].name+' · '+visualModes[automaticJourney()?renderedMode:visualMode].name;
  }
  function setupRoamLooks(){
    const artworks={
      ring:'<ellipse cx="56" cy="32" rx="38" ry="16" transform="rotate(-22 56 32)"/><ellipse cx="56" cy="32" rx="35" ry="13" transform="rotate(-22 56 32)" opacity=".45"/><path d="m22 46 5-3m51-25 6-2" stroke-width="2"/>',
      galaxy:'<path d="M54 33c-18-10-31 5-21 14 15 14 57-4 47-26C68-4 17 9 13 32m45-1c18 10 31-5 21-14C64 3 22 21 32 43c12 25 63 12 67-11"/><circle cx="56" cy="32" r="2" fill="currentColor"/>',
      blackhole:'<ellipse cx="56" cy="34" rx="43" ry="10" transform="rotate(-10 56 34)"/><path d="M31 30c0-29 50-29 50 0M31 37c6 14 44 14 50-8"/><circle cx="56" cy="30" r="15" fill="#0b0c15"/><path d="M42 34a15 15 0 1 1 28-7" stroke-width="1.3"/>',
      peaks:'<path d="m10 49 16-20 9 10 18-24 17 26 9-11 23 19M10 55l16-17 9 8 18-22 17 24 9-9 23 16M10 60l16-13 9 5 18-17 17 20 9-7 23 12"/>'
    };
    for(const preset of builtinVisualPresets){
      const button=document.createElement('button');button.type='button';button.className='roam-look-card';button.dataset.roamPreset=preset.id;
      button.setAttribute('aria-pressed','false');button.style.setProperty('--look-rgb',themes[preset.look.theme].core.join(','));
      const art=document.createElement('span');art.className='roam-look-art';art.setAttribute('aria-hidden','true');art.innerHTML='<svg viewBox="0 0 112 65">'+artworks[preset.look.visualMode]+'</svg>';
      const title=document.createElement('strong'),note=document.createElement('small');title.textContent=preset.name;note.textContent={ring:'让声音温柔铺开',galaxy:'让旋律流进银河',blackhole:'听低音推开光环',peaks:'让频谱留下山峦'}[preset.look.visualMode];button.append(art,title,note);
      button.addEventListener('click',()=>{
        if(clipLocked())return;historyFor('visual');applyLook(preset.look,true);commitRecovery('visual');syncSongControls();syncRoamLooks();
        $('roamLookStatus').textContent=storageIssues.has('preferences')||storageIssues.has('atelier')?'已切换「'+preset.name+'」；本机保存未完成。':'已进入「'+preset.name+'」 · 画面会缓缓相融。';
        wakeRoam();
      });
      $('roamLookGrid').append(button);
    }
    $('roamLookBtn').addEventListener('click',()=>setRoamLookOpen($('roamLookPanel').hidden));
    $('roamLookClose').addEventListener('click',()=>setRoamLookOpen(false));
    document.addEventListener('pointerdown',e=>{if(!$('roamLookPanel').hidden&&!e.target.closest('#roamLookPanel,#roamLookBtn'))setRoamLookOpen(false,false)});
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&!$('roamLookPanel').hidden&&!document.querySelector('dialog[open]')){
        e.preventDefault();e.stopImmediatePropagation();setRoamLookOpen(false);
      }
    },true);
  }
  function syncEffects(){
    if($('energySaver'))$('energySaver').checked=energySaver;
    for(const key of ['depth','glow']){const el=$('effect'+key);if(el){el.value=Math.round(visualEffects[key]*100);$('effect'+key+'Value').value=el.value+'%';setFill(el)}}
    for(const id of ['trail','atelierTrail']){const el=$(id);if(el){el.value=Math.round(visualEffects.trail*100);const out=$(id+'Value');if(out)out.value=Math.round(visualEffects.trail*100)+'%';setFill(el)}}
    for(const id of ['beatTrigger','atelierBeat']){const el=$(id);if(el)el.checked=visualEffects.beat}
    if(!visualEffects.beat){beatPulse=0;beatWaves.length=0}
    $('beatTriggerValue').value=visualEffects.beat?'开启':'关闭';
    refinement.profile=visualEffects.response;
    document.querySelectorAll('[data-response]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.response===visualEffects.response)));
  }
  function presetStatus(text,error=false){const el=$('presetStatus');if(el){el.textContent=text;el.dataset.error=String(error)}}
  function strictPresetLook(v){
    if(!v||typeof v!=='object'||Array.isArray(v)||!Object.hasOwn(themes,v.theme)||!Object.hasOwn(visualModes,v.visualMode))throw new Error('预设中的色彩或形态不受支持。');
    for(const [key,lo,hi] of [['motionSpeed',.25,2],['particleCount',400,6000],['intensity',.2,1],['sensitivity',.4,2.4],['depth',0,1],['glow',0,1],['trail',0,1]]){if(v[key]!==undefined&&(!Number.isFinite(v[key])||v[key]<lo||v[key]>hi))throw new Error('预设中的画面参数超出范围。')}
    if(v.energySaver!==undefined&&typeof v.energySaver!=='boolean')throw new Error('预设中的省电设置无效。');
    if(typeof v.storyEnabled!=='boolean'||typeof v.journeyAuto!=='boolean')throw new Error('预设中的剧情设置不完整。');return validLook(v);
  }
  function readPresetFile(data){if(!data||data.format!=='sonic-universe-presets'||data.version!==1||!Array.isArray(data.presets)||data.presets.length<1||data.presets.length>24)throw new Error('请选择声波宇宙导出的第 1 版预设文件（最多 24 个）。');return data.presets.map(p=>{if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>32)throw new Error('预设名称应为 1–32 个字符。');return{name:p.name.trim(),look:strictPresetLook(p.look)}})}
  function persistVisualPresets(){try{localStorage.setItem(presetStorageKey,JSON.stringify({format:'sonic-universe-presets',version:1,presets:customVisualPresets}));presetStorageError=false;storageIssues.delete('presets');updateStorageStatus();return true}catch{presetStorageError=true;storageIssues.add('presets');updateStorageStatus();return false}}
  function presetSignature(look){return JSON.stringify(validLook(look))}
  function renderVisualPresets(){
    const signature=presetSignature(captureLook());for(const [id,list,custom] of [['builtinPresets',builtinVisualPresets,false],['customPresets',customVisualPresets,true]]){const box=$(id);if(!box)continue;box.replaceChildren();list.forEach((preset,index)=>{const card=document.createElement('div');card.className='preset-card';card.dataset.current=String(presetSignature(preset.look)===signature);const button=document.createElement('button');button.className='preset-apply';button.type='button';button.dataset.preset=custom?'custom-'+index:preset.id;const tag=document.createElement('em'),name=document.createElement('strong'),note=document.createElement('small');tag.textContent=custom?'MY UNIVERSE':'0'+(index+1)+' / '+visualModes[preset.look.visualMode].english;name.textContent=preset.name;note.textContent=preset.note||themes[preset.look.theme].name+' · '+visualModes[preset.look.visualMode].name;button.append(tag,name,note);button.addEventListener('click',()=>{if(clipLocked())return;historyFor('visual');applyLook(preset.look,true);commitRecovery('visual');syncSongControls();renderVisualPresets();presetStatus('已应用「'+preset.name+'」，可撤销；按下播放，让旋律点亮它。')});card.append(button);if(custom){const remove=document.createElement('button');remove.className='preset-remove';remove.textContent='×';remove.setAttribute('aria-label','删除预设 '+preset.name);remove.addEventListener('click',()=>{if(clipLocked())return;customVisualPresets.splice(index,1);const saved=persistVisualPresets();renderVisualPresets();presetStatus(saved?'已删除这个本机预设。':'删除仅在本次页面生效，本机存储未完成。',!saved)});card.append(remove)}box.append(card)});if(custom&&!list.length){const empty=document.createElement('p');empty.className='preset-intro';empty.textContent='还没有收藏。调好画面后，给这片宇宙起个名字。';box.append(empty)}}app.dataset.visualPresetCount=String(customVisualPresets.length);app.dataset.builtinVisualPresetCount=String(builtinVisualPresets.length);
  }
  function setupVisualPresets(){
    const energyControl=document.createElement('div');energyControl.className='energy-control';energyControl.innerHTML='<label><input type="checkbox" id="energySaver">省电模式</label><span>减少星尘 · 30 帧预览</span>';document.querySelector('.visual-share').before(energyControl);
    $('energySaver').checked=energySaver;$('energySaver').addEventListener('change',()=>{if(clipLocked()){syncEffects();return}historyFor('visual');energyUserChoice=true;energySaver=$('energySaver').checked;slowFrameCount=0;resize();savePreferences();rememberLook();commitRecovery('visual');syncEffects();renderVisualPresets()});
    for(const preset of builtinVisualPresets)preset.look=validLook({...preset.look,sensitivity:1});
    const dialog=document.createElement('dialog');dialog.id='presetDialog';dialog.className='preset-dialog';dialog.setAttribute('aria-labelledby','presetTitle');dialog.innerHTML='<div class="dialog-heading"><div><div class="preset-eyebrow">A UNIVERSE FOR EVERY MOOD</div><h2 id="presetTitle">收藏一种星空</h2></div><button id="presetCloseBtn" class="icon-btn" aria-label="关闭视觉预设">×</button></div><p class="preset-intro">从一种氛围出发，调节空间与光晕。形态、色彩、粒子和灵敏度都能存进你的预设。</p><div id="builtinPresets" class="preset-grid"></div><div class="preset-controls"><label>空间纵深<output id="effectdepthValue"></output><input id="effectdepth" class="range" type="range" min="0" max="100" step="5"></label><label>星尘光晕<output id="effectglowValue"></output><input id="effectglow" class="range" type="range" min="0" max="100" step="5"></label></div><div class="preset-save"><input id="presetName" maxlength="32" aria-label="预设名称" placeholder="为这片宇宙起个名字"><button id="saveVisualPreset">保存当前画面</button></div><div class="preset-transfer"><button id="exportVisualPresets">导出我的预设</button><button id="importVisualPresets">导入预设</button><label>星尘绘制<select id="particleEngine"><option value="auto">自动 · 优先 GPU</option><option value="canvas">兼容模式</option></select></label></div><input id="presetFile" type="file" accept=".json,application/json" hidden><p id="presetStatus" class="preset-status" role="status"></p><div class="preset-library-label">MY UNIVERSES / 我的收藏</div><div id="customPresets" class="preset-grid"></div>';app.append(dialog);
    try{const raw=localStorage.getItem(presetStorageKey);if(raw){const parsed=JSON.parse(raw);if(parsed?.format==='sonic-universe-presets'&&parsed.version===1&&Array.isArray(parsed.presets)&&!parsed.presets.length)customVisualPresets=[];else customVisualPresets=readPresetFile(parsed)}}catch{presetStorageError=true;storageIssues.add('presets')}
    addRecoveryToolbar('visual','presetDialog','撤销与默认作用于画面设置；保留已收藏的预设。');$('presetBtn').addEventListener('click',()=>{if(clipLocked()){showToast('请先结束短片录制，再调整视觉预设。');return}primeHistory('visual');syncEffects();renderVisualPresets();presetStatus(presetStorageError?'本机预设读取或保存未完成，可导出本次收藏备份。':'预设只包含画面参数；音乐和个人文字保存在原处。',presetStorageError);dialog.showModal()});$('presetCloseBtn').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>primeHistory('visual'));
    for(const key of ['depth','glow'])$('effect'+key).addEventListener('input',()=>{if(clipLocked())return;historyFor('visual');visualEffects[key]=Number($('effect'+key).value)/100;syncEffects();savePreferences();commitRecovery('visual','effect'+key);renderVisualPresets()});
    for(const id of ['trail','atelierTrail'])$(id).addEventListener('input',()=>{if(clipLocked())return;historyFor('visual');visualEffects.trail=Number($(id).value)/100;syncEffects();savePreferences();commitRecovery('visual','trail');renderVisualPresets()});
    for(const id of ['beatTrigger','atelierBeat'])$(id).addEventListener('change',()=>{if(clipLocked())return;historyFor('visual');visualEffects.beat=$(id).checked;syncEffects();savePreferences();commitRecovery('visual','beat');renderVisualPresets()});
    document.addEventListener('click',event=>{const button=event.target.closest('[data-response]');if(!button||clipLocked())return;historyFor('visual');visualEffects.response=button.dataset.response;refinement.profile=visualEffects.response;syncEffects();syncResponseControls();persistRefinement();savePreferences();commitRecovery('visual','response');renderVisualPresets()});
    $('saveVisualPreset').addEventListener('click',()=>{if(clipLocked())return;const name=$('presetName').value.trim();if(!name){presetStatus('先给预设起个名字。',true);$('presetName').focus();return}if(customVisualPresets.length>=24){presetStatus('已收藏 24 个预设，请先导出或删除一些。',true);return}customVisualPresets.push({name,look:captureLook()});const saved=persistVisualPresets();$('presetName').value='';renderVisualPresets();presetStatus(saved?'「'+name+'」已保存在本机。':'预设暂存于当前页面；本机保存失败，请导出备份。',!saved)});
    $('exportVisualPresets').addEventListener('click',()=>{if(!customVisualPresets.length){presetStatus('先保存至少一个自己的预设，再导出。',true);return}const blob=new Blob([JSON.stringify({format:'sonic-universe-presets',version:1,presets:customVisualPresets},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='声波宇宙-视觉预设.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);presetStatus('已请求下载预设文件，可在浏览器下载列表查看。')});
    $('importVisualPresets').addEventListener('click',()=>{if(!clipLocked())$('presetFile').click()});$('presetFile').addEventListener('change',async()=>{const file=$('presetFile').files[0];$('presetFile').value='';if(!file||clipLocked())return;try{if(file.size>128*1024)throw new Error('预设文件应小于 128 KB。');const presets=readPresetFile(JSON.parse(await file.text()));if(clipLocked())return;const existing=new Set(customVisualPresets.map(p=>p.name+'|'+presetSignature(p.look))),added=presets.filter(p=>{const key=p.name+'|'+presetSignature(p.look);if(existing.has(key))return false;existing.add(key);return true});if(customVisualPresets.length+added.length>24)throw new Error('导入后超过 24 个收藏，请先整理本机预设。');customVisualPresets.push(...added);const saved=persistVisualPresets();renderVisualPresets();presetStatus(saved?'已导入 '+added.length+' 个预设，自动跳过重复项。':'已读入当前页面；本机保存失败，请导出备份。',!saved)}catch(error){presetStatus(error instanceof SyntaxError?'文件不是有效的 JSON，原有收藏已保留。':error.message,true)}});
    $('particleEngine').value=particleEngine;$('particleEngine').addEventListener('change',()=>{if(clipLocked())return;particleEngine=$('particleEngine').value;try{localStorage.setItem('sonic-universe-particle-engine',particleEngine);storageIssues.delete('particle-engine')}catch{storageIssues.add('particle-engine');presetStatus('绘制方式已切换，本机保存未完成。',true)}updateStorageStatus()});
    const shareInput=document.createElement('input');shareInput.id='shareLookInput';shareInput.className='text-input';shareInput.readOnly=true;shareInput.hidden=true;shareInput.setAttribute('aria-label','可复制的星空分享链接');document.querySelector('.visual-share').append(shareInput);
    $('shareLookBtn').addEventListener('click',async()=>{const status=$('shareStatus'),url=SonicVisualSystem.serializeShare(captureLook(),location.href);try{await navigator.clipboard.writeText(url);shareInput.hidden=true;status.textContent='链接已复制 · 只包含画面参数'}catch{shareInput.value=url;shareInput.hidden=false;shareInput.focus();shareInput.select();status.textContent='浏览器拒绝剪贴板，请复制下方链接';shareInput.onkeydown=event=>{if(event.key==='Escape'){shareInput.hidden=true;status.textContent='只分享画面参数'}}}});
    const workShare=document.createElement('button');workShare.type='button';workShare.id='shareWorkBtn';workShare.textContent='分享《星际漫游》编排 ↗';document.querySelector('.visual-share').prepend(workShare);
    workShare.addEventListener('click',async()=>{
      const status=$('shareStatus');
      if(activeId!=='demo'||externalStream){status.textContent='播放《星际漫游》时可以分享这首音景的编排。';return}
      const art=songArt()||{}, cleanView=v=>({look:validLook(v.look),camera:v.camera,cinema:v.cinema});
      const base=art.base?cleanView(art.base):cleanView(saveView());
      const cues=art.cuesEnabled===false?[]:(art.cues||[]).map(c=>({...cleanView(c),time:c.time,text:String(c.text||'').slice(0,60),burst:c.burst===true}));
      const data={version:1,base,cues};
      const bytes=new TextEncoder().encode(JSON.stringify(data));let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
      const hash=btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const url=new URL('share.html',location.href);url.search='';url.hash=hash;
      if(url.href.length>8000){status.textContent='编排太长，链接超过 8000 字符，请减少时间点。';return}
      try{await navigator.clipboard.writeText(url.href);shareInput.hidden=true;status.textContent='已复制：示例音乐、画面与时间点；不含歌词和背景图'}catch{shareInput.value=url.href;shareInput.hidden=false;shareInput.focus();shareInput.select();status.textContent='请复制下方链接；不含歌词和背景图'}
    });
    syncEffects();syncResponseControls();renderVisualPresets();setupRoamLooks();if(reduced)rendererStatus('reduced');
    const shared=SonicVisualSystem.parseShare(location.search,SonicVisualSystem.DEFAULTS);if(shared.hasVisualState){applyLook(shared.look,false);refinement.auto=false;syncEffects();syncResponseControls();$('shareStatus').textContent='已恢复分享的星空画面';updateVisualControls();}
  }

  function setupJourney(){
    loadExperiencePreferences();
    $('enterUniverseBtn').addEventListener('click',enterUniverse);
    $('storyToggle').addEventListener('click',()=>{storyEnabled=!storyEnabled;updateStoryToggle();updateJourneyToggle();savePreferences();showToast(storyEnabled?'音乐剧情已开启：序曲、漫游、盛放、余晖。':'已切换为自由漫游。')});
    $('journeyToggle').addEventListener('click',()=>{journeyAuto=!journeyAuto;if(!journeyAuto)setVisualMode(renderedMode,false);updateJourneyToggle();savePreferences();showToast(journeyAuto?'自动旅程：星环 → 银河 → 山峰 → 黑洞。':'已停留在当前形态，可自由切换。')});
    $('roamCameraBtn').addEventListener('click',()=>{if((!automaticJourney()&&!moodCameraActive())||reduced)return;if(cameraHeld){cameraHeld=false;camera.targetYaw=0;camera.targetPitch=0;camera.targetZoom=1}else holdCamera();updateCameraButton();wakeRoam()});
    $('roamPlayBtn').addEventListener('click',()=>{play();wakeRoam()});
    $('roamPrevBtn').addEventListener('click',()=>navigateTrack(-1));$('roamNextBtn').addEventListener('click',()=>navigateTrack(1));
    $('resetViewBtn').addEventListener('click',resetCamera);
    $('roamSeek').addEventListener('input',()=>{roamSeeking=true;setFill($('roamSeek'));$('roamCurrentTime').textContent=formatTime(Number($('roamSeek').value));wakeRoam()});
    $('roamSeek').addEventListener('change',()=>{roamSeeking=false;seekTo(Number($('roamSeek').value));wakeRoam()});
    const surface=$('roamSurface');
    document.querySelectorAll('.roam-ui button').forEach(button=>button.addEventListener('pointerup',()=>{
      if(button.closest('#roamLookPanel')||button.id==='roamLookBtn')return;
      setTimeout(()=>{if(app.classList.contains('quiet')&&!document.querySelector('dialog[open]'))surface.focus({preventScroll:true})},0);
    }));
    surface.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      e.preventDefault();surface.focus({preventScroll:true});surface.setPointerCapture(e.pointerId);
      roamPointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,dragged:false});wakeRoam();
      if(roamPointers.size===2){holdCamera();app.classList.add('dragging');const points=Array.from(roamPointers.values());points.forEach(p=>p.dragged=true);pinchDistance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)}
    });
    surface.addEventListener('pointermove',e=>{
      if(!app.classList.contains('quiet'))return;
      wakeRoam();const old=roamPointers.get(e.pointerId);if(!old)return;
      const point={...old,x:e.clientX,y:e.clientY};roamPointers.set(e.pointerId,point);
      if(roamPointers.size===2){
        const points=Array.from(roamPointers.values()),distance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
        if(pinchDistance>4)camera.targetZoom=clamp(camera.targetZoom*distance/pinchDistance,.55,2.8);
        pinchDistance=distance;
      }else{
        // A tap wakes the interface. Only a deliberate drag takes over the camera.
        if(!old.dragged&&Math.hypot(e.clientX-old.startX,e.clientY-old.startY)<6)return;
        if(!old.dragged){holdCamera();app.classList.add('dragging');point.dragged=true}
        camera.targetYaw+=(e.clientX-(old.dragged?old.x:old.startX))/Math.max(w,320)*3.4;
        camera.targetPitch=clamp(camera.targetPitch+(e.clientY-(old.dragged?old.y:old.startY))/Math.max(h,320)*2.6,-.85,.85);
      }
      updateJourneyUI();
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,e=>{
      roamPointers.delete(e.pointerId);pinchDistance=0;if(!roamPointers.size)app.classList.remove('dragging');wakeRoam();
    });
    surface.addEventListener('wheel',e=>{if(!app.classList.contains('quiet'))return;holdCamera();e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?h:1);camera.targetZoom=clamp(camera.targetZoom*Math.exp(-delta*.0012),.55,2.8);wakeRoam();updateJourneyUI()},{passive:false});
    surface.addEventListener('dblclick',resetCamera);
    document.addEventListener('fullscreenchange',()=>{if(quietOwnedFullscreen&&document.fullscreenElement!==app){quietOwnedFullscreen=false;setQuiet(false)}});
    document.addEventListener('keydown',e=>{
      if(!app.classList.contains('quiet')||document.querySelector('dialog[open]')||e.target.closest('input,textarea,select')||e.ctrlKey||e.metaKey||e.altKey)return;
      wakeRoam();
      if(e.key==='+'||e.key==='='){holdCamera();camera.targetZoom=clamp(camera.targetZoom*1.15,.55,2.8);e.preventDefault()}
      else if(e.key==='-'){holdCamera();camera.targetZoom=clamp(camera.targetZoom/1.15,.55,2.8);e.preventDefault()}
      else if(e.key==='0')resetCamera();
      else if(e.key.toLowerCase()==='c')openPostcard();
    });
    app.addEventListener('pointermove',()=>{if(app.classList.contains('quiet'))wakeRoam()});
    app.addEventListener('focusin',()=>{if(app.classList.contains('quiet'))wakeRoam()});
  }

  function capturePostcard(){
    if(!w||!h||!canvas.width)throw new Error('星空还在准备，请稍后再定格。');
    const frozen=document.createElement('canvas');frozen.width=canvas.width;frozen.height=canvas.height;
    frozen.getContext('2d').drawImage(canvas,0,0);
    const quiet=app.classList.contains('quiet');
    capturedScene=frozen;
    capturedMoment={date:new Date(),song:externalStream?'外部旋律 · 万籁成星':currentTrack()?.name||'无声的星海',position:getPosition(),phase:story.label,mode:visualModes[renderedMode].name,quiet,focusX:centerX/w,focusY:centerY/h,radius:baseR/w,zoom:cinema.zoom*(quiet?camera.zoom:1)};
    $('postcardSong').value=capturedMoment.song.slice(0,80);
    $('captureMoment').textContent=formatTime(capturedMoment.position)+' / '+capturedMoment.mode;
    $('postcardClipBtn').hidden=true;
    $('postcardStatus').textContent='画面已定格，音乐继续流动。';
    renderPostcard();
  }
  function cardLines(context,text,maxWidth,maxLines){
    const lines=[];let line='';
    for(const character of Array.from(text)){
      if(character==='\n'){lines.push(line);line='';continue}
      const next=line+character;
      if(line&&context.measureText(next).width>maxWidth){lines.push(line);line=character}else line=next;
    }
    lines.push(line);
    if(lines.length>maxLines){
      lines.length=maxLines;let last=lines[maxLines-1];
      while(last&&context.measureText(last+'…').width>maxWidth)last=Array.from(last).slice(0,-1).join('');
      lines[maxLines-1]=last+'…';
    }
    return lines;
  }
  function renderPostcard(){
    if(!capturedScene||!capturedMoment)return;
    const surface=$('postcardCanvas'),g=surface.getContext('2d'),night=postcardStyle==='night';
    const bg=night?'#100d1a':'#f1ece5',ink=night?'#e5d9f5':'#3b3448',muted=night?'#a18eaf':'#7b6e82',line=night?'#a893c13b':'#78648c40',accent=night?'#c8a9ed':'#766084';
    g.fillStyle=bg;g.fillRect(0,0,1800,1350);
    g.strokeStyle=line;g.lineWidth=1;g.strokeRect(29.5,29.5,1741,1291);
    g.fillStyle=muted;g.font='16px ui-monospace,Consolas,monospace';
    g.fillText('SONIC UNIVERSE  /  A POSTCARD FROM THE STARS',69,78);
    g.textAlign='right';g.fillText('VOL.32',1731,78);g.textAlign='left';
    const art={x:69,y:109,w:1662,h:842},source=capturedScene,aspect=art.w/art.h;
    let sw,sh;
    if(capturedMoment.quiet){sw=source.width;sh=sw/aspect;if(sh>source.height){sh=source.height;sw=sh*aspect}}
    else{sw=Math.min(source.width,Math.max(source.width*.64,source.width*capturedMoment.radius*4.8));sh=sw/aspect;if(sh>source.height){sh=source.height;sw=sh*aspect}}
    const sx=clamp(source.width*capturedMoment.focusX-sw/2,0,Math.max(0,source.width-sw)),sy=clamp(source.height*capturedMoment.focusY-sh/2,0,Math.max(0,source.height-sh));
    g.save();g.beginPath();g.rect(art.x,art.y,art.w,art.h);g.clip();g.drawImage(source,sx,sy,sw,sh,art.x,art.y,art.w,art.h);
    const shade=g.createLinearGradient(0,art.y+art.h*.6,0,art.y+art.h);shade.addColorStop(0,'#08091100');shade.addColorStop(1,'#08091199');g.fillStyle=shade;g.fillRect(art.x,art.y,art.w,art.h);
    g.fillStyle='#d4c4e8';g.font='16px ui-monospace,Consolas,monospace';g.fillText('✧  '+capturedMoment.phase,art.x+31,art.y+art.h-32);
    g.textAlign='right';g.fillText(capturedMoment.mode+'  /  '+formatTime(capturedMoment.position),art.x+art.w-31,art.y+art.h-32);g.textAlign='left';g.restore();
    g.fillStyle=accent;g.font='16px ui-monospace,Consolas,monospace';g.fillText('A SONG, A SKY, A MOMENT.',69,1001);
    const song=$('postcardSong').value.trim()||capturedMoment.song;
    g.fillStyle=ink;
    let titleSize=43;
    do{g.font='500 '+titleSize+'px "Microsoft YaHei UI","Microsoft YaHei",sans-serif';if(cardLines(g,song,1540,3).length<=2)break;titleSize--}while(titleSize>30);
    cardLines(g,song,1540,2).forEach((text,index)=>g.fillText(text,69,1060+index*53));
    const mood=$('postcardMood').value.trim()||'把这一刻，寄给未来的自己。';
    g.font='23px "Microsoft YaHei UI","Microsoft YaHei",sans-serif';g.fillStyle=muted;
    cardLines(g,mood.replace(/\n/g,' '),1540,2).forEach((text,index)=>g.fillText(text,69,1175+index*37));
    g.strokeStyle=line;g.beginPath();g.moveTo(69,1250);g.lineTo(1731,1250);g.stroke();
    const author=$('postcardAuthor').value.trim()||'一位星际旅人';
    g.fillStyle=ink;g.font='19px "Microsoft YaHei UI","Microsoft YaHei",sans-serif';
    g.fillText('FROM  '+author,69,1290);
    const date=capturedMoment.date,pad=n=>String(n).padStart(2,'0');
    const stamp=date.getFullYear()+'.'+pad(date.getMonth()+1)+'.'+pad(date.getDate())+'  '+pad(date.getHours())+':'+pad(date.getMinutes());
    g.fillStyle=muted;g.font='17px ui-monospace,Consolas,monospace';g.textAlign='right';g.fillText(stamp+'  /  只此一刻',1731,1290);g.textAlign='left';
    surface.setAttribute('aria-label','星空明信片：'+song+'。'+mood+'。署名：'+author);
    document.querySelectorAll('[data-card-style]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.cardStyle===postcardStyle)));
  }
  function capturePlaybackMoment(surface,{mode:scene,lyric}={}){
    const track=currentTrack();
    if(!track||!surface?.width||!surface.height||clipLocked())return false;
    const frame=document.createElement('canvas');frame.width=surface.width;frame.height=surface.height;
    frame.getContext('2d').drawImage(surface,0,0);
    capturedScene=frame;
    capturedMoment={date:new Date(),song:track.name,trackId:track.id,position:getLocalPosition(),lyric,
      mode:scene||'正在播放',phase:scene||'正在播放',focusX:.5,focusY:.5,radius:.28,zoom:1,frame};
    $('postcardSong').value=track.name.slice(0,80);
    $('postcardMood').value=String(lyric||'').slice(0,80);
    $('captureMoment').textContent=formatTime(capturedMoment.position)+' / '+capturedMoment.mode;
    $('postcardClipBtn').hidden=track.kind!=='file';
    $('postcardStatus').textContent='画面已定格，音乐保持当前状态。';
    renderPostcard();
    if(!$('postcardDialog').open)$('postcardDialog').showModal();
    wakeRoam();return true;
  }
  function openPostcard(){
    try{
      capturePostcard();
      if(!$('postcardDialog').open)$('postcardDialog').showModal();
      wakeRoam();
    }catch(error){showToast(error.message||'暂时无法定格，请重试。',true)}
  }
  async function savePostcard(){
    if(exportingPostcard||!capturedScene)return;
    exportingPostcard=true;$('savePostcardBtn').disabled=true;$('postcardStatus').textContent='正在生成 PNG 图片…';
    try{
      renderPostcard();
      const blob=await new Promise((resolve,reject)=>{$('postcardCanvas').toBlob(value=>value?resolve(value):reject(new Error('图片生成失败，请重新定格。')),'image/png')});
      if(postcardBlobUrl)URL.revokeObjectURL(postcardBlobUrl);
      postcardBlobUrl=URL.createObjectURL(blob);
      const date=capturedMoment.date,pad=n=>String(n).padStart(2,'0');
      const name=($('postcardSong').value.trim()||capturedMoment.song).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').slice(0,48)||'此刻';
      const link=document.createElement('a');link.href=postcardBlobUrl;
      link.download='声波宇宙-'+name+'-'+date.getFullYear()+pad(date.getMonth()+1)+pad(date.getDate())+'-'+pad(date.getHours())+pad(date.getMinutes())+pad(date.getSeconds())+'.png';
      document.body.append(link);link.click();link.remove();
      $('postcardStatus').textContent='PNG 已生成，请在浏览器下载中查看。';
    }catch(error){$('postcardStatus').textContent=error.message||'保存失败，请重试。'}
    finally{exportingPostcard=false;$('savePostcardBtn').disabled=false}
  }
  function setupPostcards(){
    $('postcardBtn').addEventListener('click',openPostcard);$('roamPostcardBtn').addEventListener('click',openPostcard);
    $('retakePostcardBtn').addEventListener('click',()=>{try{capturePostcard()}catch(error){$('postcardStatus').textContent=error.message}});
    $('savePostcardBtn').addEventListener('click',savePostcard);
    $('postcardClipBtn').addEventListener('click',()=>{
      if(!capturedMoment?.frame||capturedMoment.trackId!==activeId||currentTrack()?.kind!=='file'){
        $('postcardStatus').textContent='当前曲目已变化，请重新收藏这一刻。';return;
      }
      clipMoment=capturedMoment;clipSegment=null;clipInstrumentMode=false;
      $('postcardDialog').close();openClip();
    });
    for(const id of ['postcardSong','postcardMood'])$(id).addEventListener('input',renderPostcard);
    $('postcardAuthor').addEventListener('input',()=>{postcardAuthor=$('postcardAuthor').value;savePreferences();renderPostcard()});
    document.querySelectorAll('[data-card-style]').forEach(button=>button.addEventListener('click',()=>{postcardStyle=button.dataset.cardStyle;savePreferences();renderPostcard()}));
    $('postcardDialog').addEventListener('close',()=>{wakeRoam();if(app.classList.contains('quiet'))$('roamSurface').focus({preventScroll:true})});
    window.addEventListener('pagehide',()=>{if(postcardBlobUrl)URL.revokeObjectURL(postcardBlobUrl)});
  }

  function collectionTracks(view='all'){
    if(view==='local')return tracks.filter(t=>t.kind==='file');
    if(view==='soda')return tracks.filter(t=>t.kind==='soda'||t.kind==='online');
    if(view==='favorites')return tracks.filter(t=>t.favorite);
    const collection=playlists.find(p=>p.id===view);
    if(!collection)return tracks.slice();
    const tracksById=new Map(tracks.map(track=>[track.id,track]));
    return collection.trackIds.map(id=>tracksById.get(id)).filter(Boolean);
  }
  function playableTracks(view='all'){return collectionTracks(view).filter(isPlayableTrack)}
  function scopedPlaybackTracks(){
    if(playbackScopeOrder?.scope!==playbackScope)return playableTracks(playbackScope);
    const byId=new Map(tracks.map(track=>[track.id,track]));
    return playbackScopeOrder.ids.map(id=>byId.get(id)).filter(isPlayableTrack);
  }
  function usePlaybackScope(scope){
    const changed=playbackScope!==scope||Boolean(playbackScopeOrder);
    playbackScope=scope;playbackScopeOrder=null;
    return changed;
  }
  function collectionName(view){return view==='local'?'本地音乐':view==='soda'?'多平台音乐':view==='favorites'?'我的收藏':playlists.find(p=>p.id===view)?.name||'全部音乐'}
  function validCollection(view){return view==='all'||view==='favorites'||view==='soda'||playlists.some(p=>p.id===view)}
  function validPlaybackScope(view){return view==='local'||validCollection(view)}
  function effectivePlaybackMode(){return sessionQueue?.mode??playbackMode}
  let queueChartMatch=null,nextOnlinePreparation=null,albumRun=null;
  function albumContinuation(track){
    if(!track?.album||clipLocked()||!['sequence','list'].includes(effectivePlaybackMode()))return null;
    const queue=sessionQueue;
    const index=queue?.items.findIndex(item=>item.entryId===queue.currentId);
    const entry=queue?.items[index+1];
    const next=queue?queueTrackDetails(entry):tracks.find(item=>item.id===adjacentScopedTrack(track.id,1,false));
    return next?.kind==='file'&&next.id!==track.id&&next.album===track.album?{next,queue,entry}:null;
  }
  function cancelChangedAlbumRun(){
    const run=albumRun;
    if(!run||run.start||trackLoading||run.firstId!==activeId)return;
    const target=albumContinuation(currentTrack());
    if(target?.next.id===run.next.id&&target.queue===run.queue&&target.entry===run.entry)return;
    const position=getLocalPosition(),resume=playing;
    albumRun=null;
    void selectTrack(activeId,resume,position,true,{queue:sessionQueue,skipAlbum:true});
  }
  function advanceAlbumRun(){
    const run=albumRun;
    if(!run||run.start||activeId!==run.firstId||audio.currentTime<run.first)return;
    const target=albumContinuation(currentTrack());
    if(target?.next.id!==run.next.id||target.queue!==run.queue||target.entry!==run.entry){
      cancelChangedAlbumRun();
      return;
    }
    captureSongDraft();
    run.start=run.first;
    activeId=preparedTrackId=run.next.id;duration=run.second;offset=0;
    if(run.queue){run.queue.currentId=run.entry.entryId;queueChanged();}
    invalidateFilmAnalysis('已切换歌曲，开始录制时会自动分析新的推荐片段。');
    atelierTrackReady(false);syncLoudness(run.next);
    renderActiveTrack();renderPlaylist();refreshQueueState();updateTimeline();updatePlaying();saveSession();
  }
  const NEXT_ONLINE_WINDOW=10,ONLINE_TICKET_REUSE_MS=20000;
  function cancelNextOnlinePreparation(){
    const preparation=nextOnlinePreparation;
    nextOnlinePreparation=null;
    preparation?.controller.abort();
  }
  function queueChanged(){
    cancelNextOnlinePreparation();
    queueRevision++;
    saveSession();
    window.dispatchEvent(new Event('sonic:queue-change'));
    queueMicrotask(cancelChangedAlbumRun);
  }
  function leaveSessionQueue(){
    if(!sessionQueue)return;
    queueChartMatch?.abort();
    sessionQueue=null;queueRun++;resetShuffle();updatePlaybackMode();queueChanged();
  }
  function queueItem(track,remote=false){
    return {entryId:'queue-'+(++queueEntrySerial),trackId:track.id,remote:remote?track:null};
  }
  function setSessionQueue(items,currentId,label,{fullOnly=false}={}){
    queueChartMatch?.abort();
    playbackScopeOrder=null;
    sessionQueue={items,currentId,label,mode:'sequence',autoplay:playing,failed:false,recovery:null,fullOnly};
    queueRun++;resetShuffle();updatePlaybackMode();queueChanged();
    return sessionQueue;
  }
  function safeChartEntry(item){
    if(!item||typeof item.id!=='string'||!/^chart:[a-z\d_-]{1,60}$/i.test(item.id)||typeof item.name!=='string'||typeof item.artist!=='string')return null;
    const mediaId=item.id.slice(6);
    return {id:item.id,name:item.name.slice(0,160),artist:item.artist.slice(0,160),album:typeof item.album==='string'?item.album.slice(0,160):'',
      duration:finite(item.duration,0,0,86400),kind:'chart',
      ...(/^\d{1,30}$/.test(mediaId)?{provider:'apple',mediaId}:{}),
      ...(/^[a-z]{2}$/.test(item.country||'')?{country:item.country}:{})};
  }
  function validQueueRecovery(value){
    return SonicPlaybackQueueState.recovery(value);
  }
  function resumeFileMetadata(track){
    if(track?.kind!=='file'||typeof track.id!=='string'||!track.id||track.id.length>256||typeof track.name!=='string')return null;
    return {id:track.id,kind:'file',name:track.name.slice(0,200)||'本地音乐',artist:typeof track.artist==='string'?track.artist.slice(0,160):'',
      duration:finite(track.duration,0,0,86400)};
  }
  function resumeOnlineMetadata(track){
    const remote=SonicOnlineMusic.normalizeTrack(track);
    return remote?{provider:remote.provider,mediaId:remote.mediaId,name:remote.name,artist:remote.artist,album:remote.album,
      duration:remote.duration,preview:remote.preview}:null;
  }
  function resumeTrackMetadata(track){
    return resumeFileMetadata(track)||safeChartEntry(track)||(track?.kind==='online'?resumeOnlineMetadata(track):null);
  }
  function queueTrackDetails(entry){
    return entry&&(tracks.find(track=>track.id===entry.trackId)||entry.remote||entry.chart||entry.file);
  }
  function resumeTrack(point=resumePoint){
    if(typeof point?.id!=='string')return null;
    const stored=tracks.find(track=>track.id===point.id&&isPlayableTrack(track));
    if(stored)return stored;
    const saved=point.queue?.entries?.[point.queue.current];
    const backup=[SonicOnlineMusic.normalizeTrack(saved?.remote),safeChartEntry(saved?.chart),resumeFileMetadata(saved?.file),
      SonicOnlineMusic.normalizeTrack(point.track),safeChartEntry(point.track),resumeFileMetadata(point.track),missingResumeTracks.get(point.id)];
    return backup.find(track=>track?.id===point.id)||null;
  }
  function serializeResumeQueue(queue){
    return SonicPlaybackQueueState.checkpoint(queue,{remote:resumeOnlineMetadata,chart:safeChartEntry,file:resumeFileMetadata});
  }
  function checkpointQueue(){
    if(resumeQueueCheckpoint?.revision!==queueRevision)resumeQueueCheckpoint={revision:queueRevision,data:serializeResumeQueue(sessionQueue)};
    return resumeQueueCheckpoint.data;
  }
  function restoreResumeQueue(){
    const saved=SonicPlaybackQueueState.restore(resumePoint,{
      library:new Map(tracks.map(track=>[track.id,track])),missing:missingResumeTracks,playable:isPlayableTrack,
      codecs:{remote:SonicOnlineMusic.normalizeTrack,chart:safeChartEntry,file:resumeFileMetadata},
    });
    if(!saved)return null;
    const items=saved.entries.map(({candidate,remote,chart,file})=>{
      const entry=queueItem(candidate,Boolean(remote));
      if(chart)entry.chart=chart;
      if(file)entry.file=file;
      return entry;
    });
    const current=items[saved.at].entryId;
    const queue=setSessionQueue(items,current,saved.label,{fullOnly:saved.fullOnly});
    if(saved.mode)queue.mode=saved.mode;
    queue.autoplay=false;queue.recovery=saved.recovery;queue.failed=Boolean(queue.recovery);
    updatePlaybackMode();refreshQueueState();
    resumeQueueCheckpoint={revision:queueRevision,data:serializeResumeQueue(queue)};
    resumePoint.queue=resumeQueueCheckpoint.data;return current;
  }
  function continueListening(){
    if(!resumePoint||externalStream||externalPending||trackLoading||queueChartMatch||playing)return;
    const attempt=playbackRetryAttempt;
    if(playbackRetryIsCurrent(attempt,attempt?.phase==='resuming'))return false;
    cancelOnlinePick();
    const {id,position}=resumePoint;
    const current=resolveQueueItem(sessionQueue?.currentId);
    if(sessionQueue?.recovery&&current?.trackId===id)return retryQueue();
    if(deferredResume||resumeTrack()?.kind==='online'){
      deferredResume=true;
      if(validPlaybackScope(resumePoint.scope)&&playbackScope!==resumePoint.scope){
        playbackScope=resumePoint.scope;resetShuffle(id);renderLibraryControls();
      }
      const entry=current?.trackId===id?current.entryId:restoreResumeQueue();
      const recovery=resumePoint.recovery||{reason:null,position};
      return beginPlaybackRetry({checkpoint:resumePoint,queue:entry?sessionQueue:null,id:entry||id,trackId:id,recovery,name:resumeTrack()?.name||'当前歌曲'});
    }
    if(preparedTrackId===id&&activeId===id)return play();
    const entry=restoreResumeQueue();
    return entry?playQueueFrom(entry,{position}):selectTrack(id,true,position);
  }
  function prepareSessionQueue(){
    if(sessionQueue)return sessionQueue;
    const songs=scopedPlaybackTracks(),current=currentTrack();
    if(current&&!songs.some(track=>track.id===current.id))songs.unshift(current);
    const items=songs.map(track=>queueItem(track));
    const resume=deferredResume&&!currentTrack()?resumeTrack():null;
    const missing=resume?.kind==='file'?resume:null;
    if(missing&&!items.some(entry=>entry.trackId===missing.id))items.unshift({...queueItem(missing),file:missing});
    const queue=setSessionQueue(items,items.find(entry=>entry.trackId===activeId)?.entryId??null,collectionName(playbackScope));
    if(deferredResume&&validQueueRecovery(resumePoint?.recovery)){
      queue.recovery=validQueueRecovery(resumePoint.recovery);
      queue.failed=true;
      queueChanged();
    }
    return queue;
  }
  function resolveQueueItem(id,queue=sessionQueue){
    return queue?.items.find(item=>item.entryId===id)||queue?.items.find(item=>item.trackId===id);
  }
  let queueUndo=null;
  function captureQueueUndo(){
    return {queue:sessionQueue,items:sessionQueue?.items.slice(),id:activeId,scopeOrder:playbackScopeOrder,
      shuffle:{bag:shuffleBag.slice(),history:shuffleHistory.slice(),cursor:shuffleCursor}};
  }
  function rememberQueueUndo(previous){queueUndo={...previous,revision:queueRevision+1};}
  function canUndoQueue(){
    return Boolean(queueUndo&&queueUndo.revision===queueRevision&&queueUndo.id===activeId&&!trackLoading&&!queueChartMatch);
  }
  function undoQueue(){
    if(!canUndoQueue())return false;
    const previous=queueUndo;queueUndo=null;
    sessionQueue=previous.queue;
    if(sessionQueue)sessionQueue.items=previous.items;
    playbackScopeOrder=previous.scopeOrder;
    shuffleBag=previous.shuffle.bag;shuffleHistory=previous.shuffle.history;shuffleCursor=previous.shuffle.cursor;
    updatePlaybackMode();queueChanged();
    return true;
  }
  function addSessionTrack(selection,placement){
    const remote=typeof selection==='object'?SonicOnlineMusic.normalizeTrack(selection):null;
    const chart=selection?.provider==='apple'?safeChartEntry({...selection,id:'chart:'+selection.mediaId}):null;
    const trackId=remote?.id||chart?.id||selection;
    if(!libraryReady||externalStream||externalPending||!['next','end'].includes(placement))return false;
    const track=remote||chart||tracks.find(item=>item.id===trackId);
    if(!chart&&!isPlayableTrack(track))return false;
    const newEntry=()=>chart?{...queueItem(chart),chart}:queueItem(track,Boolean(remote));
    if(placement==='next'&&trackId===(resolveQueueItem(sessionQueue?.currentId)?.trackId??activeId))return 'current';
    const previous=captureQueueUndo();
    const queue=prepareSessionQueue();
    if(placement==='end'){
      const entry=newEntry();
      queue.items.push(entry);
      if(queue.mode==='shuffle')shuffleBag.push(entry.entryId);
    }else{
      const position=queue.items.findIndex(item=>item.entryId===queue.currentId)+1;
      const waiting=queue.items.findIndex((item,index)=>index>=position&&item.trackId===trackId);
      if(waiting===position&&queue.mode!=='shuffle')return true;
      const entry=waiting<0?newEntry():queue.items.splice(waiting,1)[0];
      queue.items.splice(position,0,entry);
      if(queue.mode==='shuffle'){
        const before=shuffleHistory.slice(0,shuffleCursor+1);
        shuffleHistory=[...before,entry.entryId,...shuffleHistory.slice(shuffleCursor+1).filter(id=>id!==entry.entryId)];
        shuffleBag=shuffleBag.filter(id=>id!==entry.entryId);
      }
    }
    rememberQueueUndo(previous);
    queueChanged();
    return true;
  }
  function moveSessionEntry(id,beforeId){
    if(!sessionQueue&&!scopedPlaybackTracks().some(track=>track.id===id))return false;
    const previous=captureQueueUndo();
    const queue=prepareSessionQueue(),entry=resolveQueueItem(id,queue),before=resolveQueueItem(beforeId,queue);
    if(!entry||(beforeId!==null&&!before)||entry===before)return false;
    queue.items.splice(queue.items.indexOf(entry),1);
    queue.items.splice(before?queue.items.indexOf(before):queue.items.length,0,entry);
    resetShuffle();rememberQueueUndo(previous);queueChanged();
    return true;
  }
  function removeSessionEntry(id){
    if(!sessionQueue&&(!scopedPlaybackTracks().some(track=>track.id===id)||id===activeId))return false;
    const previous=captureQueueUndo();
    const queue=prepareSessionQueue(),entry=resolveQueueItem(id,queue);
    if(!entry||entry.entryId===queue.currentId)return false;
    queue.items.splice(queue.items.indexOf(entry),1);
    resetShuffle();rememberQueueUndo(previous);queueChanged();
    return true;
  }
  function shuffleIds(){return sessionQueue?sessionQueue.items.map(item=>item.entryId):scopedPlaybackTracks().map(track=>track.id)}
  function saveLibraryPlaylist(name,id=null) {
    const title=String(name||'').trim().slice(0,32);
    if(!title||!libraryReady||libraryReadFailed)return null;
    const playlist=id?playlists.find(item=>item.id===id):{id:newId('playlist'),name:title,trackIds:[]};
    if(!playlist)return null;
    playlist.name=title;
    if(!id)playlists.push(playlist);
    return playlist.id;
  }
  function setPlaylistTracks(trackId,selectedIds) {
    if(!libraryReady||libraryReadFailed||!missingResumeTracks.has(trackId)&&!tracks.some(track=>track.id===trackId))return;
    const selected=new Set(selectedIds);
    let changed=false;
    for(const playlist of playlists) {
      const exists=playlist.trackIds.includes(trackId);
      if(exists===selected.has(playlist.id))continue;
      if(exists)playlist.trackIds=playlist.trackIds.filter(id=>id!==trackId);
      else playlist.trackIds.push(trackId);
      if(playbackScope===playlist.id){playbackScopeOrder=null;resetShuffle();}
      changed=true;
    }
    if(changed){persistLibrary();renderPlaylist();}
  }
  async function savePlaylistTrackOrder(playlist,order,changed) {
    if(!changed)return {saved:true,changed:0};
    playlist.trackIds=order;
    if(!sessionQueue&&playbackScope===playlist.id){playbackScopeOrder=null;resetShuffle();}
    const saved=await persistLibrary();
    renderPlaylist();
    return {saved,changed};
  }
  function editPlaylistMembership(playlistId,trackIds,add) {
    const playlist=playlists.find(item=>item.id===playlistId);
    if(!libraryReady||libraryReadFailed||backupRestoring||!playlist)return {saved:false,changed:0};
    const valid=add?new Set([...tracks.map(track=>track.id),...missingResumeTracks.keys()]):null;
    const selected=new Set(valid?trackIds.filter(id=>valid.has(id)):trackIds);
    const before=playlist.trackIds;
    const existing=new Set(before);
    const order=add
      ? [...before,...[...selected].filter(id=>!existing.has(id))]
      : before.filter(id=>!selected.has(id));
    return savePlaylistTrackOrder(playlist,order,Math.abs(order.length-before.length));
  }
  function movePlaylistTracks(playlistId,trackIds,direction) {
    const playlist=playlists.find(item=>item.id===playlistId);
    if(!libraryReady||libraryReadFailed||backupRestoring||!playlist||(direction!==-1&&direction!==1))return {saved:false,changed:0};
    const selected=new Set(trackIds),order=playlist.trackIds.slice();
    let changed=0;
    for(let index=direction<0?1:order.length-2;index>=0&&index<order.length;index-=direction) {
      const target=index+direction;
      if(!selected.has(order[index])||selected.has(order[target]))continue;
      [order[index],order[target]]=[order[target],order[index]];
      changed++;
    }
    return savePlaylistTrackOrder(playlist,order,changed);
  }
  function toggleTrackFavorite(id) {
    const track=tracks.find(item=>item.id===id);
    if(!libraryReady||libraryReadFailed||!track)return;
    track.favorite=!track.favorite;
    if(playbackScope==='favorites'){playbackScopeOrder=null;resetShuffle();}
    persistLibrary();renderPlaylist();renderActiveTrack();
  }
  function updateRecentTrack() {
    if(!libraryReady||libraryReadFailed||!playing||externalStream||!activeId||recentTrackIds[0]===activeId)return;
    recentTrackIds=[activeId,...recentTrackIds.filter(id=>id!==activeId)].slice(0,60);
    try{localStorage.setItem(recentKey,JSON.stringify(recentTrackIds));}catch{}
    if(currentTrack()?.kind==='file'){
      const count=smartCounts.get(activeId)||0;
      smartCounts.delete(activeId);
      smartCounts.set(activeId,Math.min(count+1,99));
      if(smartCounts.size>500)smartCounts.delete(smartCounts.keys().next().value);
      saveSmartMusic();
    }
    window.dispatchEvent(new Event('sonic:library-change'));
  }
  function newId(prefix){return prefix+'-'+(typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2))}
  function shuffled(ids){const result=ids.slice();for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result}
  function resetShuffle(id=sessionQueue?.currentId??activeId){
    const ids=shuffleIds();
    shuffleBag=shuffled(ids.filter(value=>value!==id));shuffleHistory=ids.includes(id)?[id]:[];shuffleCursor=shuffleHistory.length-1;
  }
  function nextShuffle(direction=1){
    const ids=shuffleIds(),current=sessionQueue?.currentId??activeId;if(!ids.length)return null;
    if(direction<0){if(shuffleCursor>0)return shuffleHistory[--shuffleCursor];showToast('已经是随机播放记录的第一首。');return null}
    if(shuffleCursor<shuffleHistory.length-1)return shuffleHistory[++shuffleCursor];
    shuffleBag=shuffleBag.filter(id=>ids.includes(id)&&id!==current);
    if(!shuffleBag.length)shuffleBag=shuffled(ids.filter(id=>id!==current));
    const id=shuffleBag.shift()||ids[0];shuffleHistory.push(id);shuffleCursor=shuffleHistory.length-1;return id;
  }
  function setLibraryView(view){
    libraryView=validCollection(view)?view:'all';$('membershipPanel').hidden=true;$('playlistEditor').hidden=true;
    $('sodaPanel').hidden=libraryView!=='soda';
    persistLibrary();renderPlaylist();
  }
  function renderLibraryControls(){
    for(const id of ['libraryPlaylist','newPlaylistBtn','renamePlaylistBtn','deletePlaylistBtn'])$(id).disabled=!libraryReady;
    document.querySelectorAll('button[data-library-view]').forEach(button=>button.disabled=!libraryReady);
    document.querySelectorAll('button[data-library-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.libraryView==='playlists'?libraryView!=='all'&&libraryView!=='favorites'&&libraryView!=='soda':button.dataset.libraryView===libraryView)));
    const select=$('libraryPlaylist'),previous=select.value;select.replaceChildren();
    const placeholder=new Option(playlists.length?'选择一个歌单':'还没有歌单，创建一个吧','');select.add(placeholder);
    playlists.forEach(p=>select.add(new Option(p.name+' · '+p.trackIds.length+' 首',p.id)));
    select.value=playlists.some(p=>p.id===libraryView)?libraryView:playlists.some(p=>p.id===previous)?previous:'';
    const playlist=playlists.find(p=>p.id===libraryView);
    $('renamePlaylistBtn').hidden=!playlist;$('deletePlaylistBtn').hidden=!playlist;
    $('libraryViewName').textContent=collectionName(libraryView);
    $('sodaPanel').hidden=libraryView!=='soda';
    const localCount=playableTracks(libraryView).length;
    if(libraryView==='soda'){
      const onlineCount=collectionTracks('soda').filter(t=>t.kind==='online').length;
      $('playCollectionBtn').textContent=onlineCount?'在星空中播放 ↗':'打开第一首汽水音乐 ↗';
      $('playCollectionBtn').disabled=!collectionTracks('soda').length||!libraryReady;
      $('playCollectionBtn').title=onlineCount?'播放本页第一首可在线播放的歌曲；需要本机音乐入口':'旧版分享条目会在新标签页打开汽水音乐';
    }else{
      $('playCollectionBtn').textContent=libraryView==='favorites'||libraryView==='all'?'播放此列表 ↗':'播放本地音乐 ↗';
      $('playCollectionBtn').disabled=!localCount||!libraryReady;
      $('playCollectionBtn').title='只播放本地音频与内置音景';
    }
    $('playbackScope').textContent='正在使用的播放范围：'+(sessionQueue?.label||collectionName(playbackScope))+' · 本地与汽水在线歌曲都可驱动星空';
    app.dataset.collectionView=libraryView;app.dataset.playbackScope=playbackScope;
  }
  function setSodaStatus(message,error=false){$('sodaStatus').textContent=message;$('sodaStatus').classList.toggle('error',error)}
  function resetSodaEditor(){
    editingSodaId=null;$('sodaEditor').reset();$('sodaSaveBtn').textContent='加入我的汽水歌单';$('sodaCancelBtn').hidden=true;
  }
  function beginSodaEdit(id){
    const track=tracks.find(t=>t.id===id&&t.kind==='soda');if(!track)return;
    editingSodaId=id;$('sodaName').value=track.name;$('sodaArtist').value=track.artist||'';$('sodaAlbum').value=track.album||'';$('sodaUrl').value=track.externalUrl;
    $('sodaSaveBtn').textContent='保存汽水信息';$('sodaCancelBtn').hidden=false;setSodaStatus('正在编辑「'+track.name+'」。保存后不会改变收藏与歌单归属。');
    $('sodaPanel').scrollIntoView({block:'nearest'});$('sodaName').focus();
  }
  function saveSodaRecord(event){
    event.preventDefault();
    const checked=globalThis.SonicSodaLibrary?.validateSodaRecord({name:$('sodaName').value,artist:$('sodaArtist').value,album:$('sodaAlbum').value,externalUrl:$('sodaUrl').value});
    if(!checked?.ok){setSodaStatus(checked?.error||'汽水音乐入口暂时不可用，请刷新页面后重试。',true);return}
    const value=checked.value,duplicate=tracks.find(t=>t.kind==='soda'&&t.id!==editingSodaId&&t.externalUrl.toLocaleLowerCase()===value.externalUrl.toLocaleLowerCase());
    if(duplicate){setSodaStatus('这个分享链接已经在「'+duplicate.name+'」中，未重复加入。',true);return}
    if(editingSodaId){
      const track=tracks.find(t=>t.id===editingSodaId&&t.kind==='soda');if(!track){resetSodaEditor();setSodaStatus('这首汽水歌曲已不存在，请重新添加。',true);return}
      Object.assign(track,value,{sourcePath:'汽水音乐',signature:'soda:'+value.externalUrl.toLocaleLowerCase()});
      setSodaStatus('已保存「'+track.name+'」的新信息。');
    }else{
      tracks.push({id:newId('soda'),kind:'soda',...value,duration:0,cover:null,blob:null,stored:true,favorite:false,sourcePath:'汽水音乐',signature:'soda:'+value.externalUrl.toLocaleLowerCase()});
      setSodaStatus('已加入「'+value.name+'」。点击歌曲即可在新标签页打开汽水音乐。');
    }
    libraryView='soda';resetSodaEditor();resetShuffle();persistLibrary();renderPlaylist();
  }
  function sodaBatchSummary(result){
    const parts=['可加入 '+result.items.length+' 首'];
    if(result.duplicates.length)parts.push('重复 '+result.duplicates.length+' 首');
    if(result.invalid.length)parts.push('未识别 '+result.invalid.length+' 行');
    if(result.limited)parts.push('超出单次上限 '+result.limited+' 首');
    const names=result.items.slice(0,6).map((item,index)=>(index+1)+'. '+item.name+(item.artist?' · '+item.artist:''));
    return parts.join('；')+'。'+(names.length?'\n'+names.join('\n')+(result.items.length>names.length?'\n…':'') :'');
  }
  function previewSodaBatch(){
    const existing=tracks.filter(t=>t.kind==='soda').map(t=>t.externalUrl);
    sodaBatchText=$('sodaBatch').value;
    sodaBatchPreview=globalThis.SonicSodaLibrary?.parseSodaLines(sodaBatchText,existing);
    if(!sodaBatchPreview){setSodaStatus('批量整理暂时不可用，请刷新页面后重试。',true);return}
    $('sodaBatchPreview').textContent=sodaBatchSummary(sodaBatchPreview);
    $('sodaBatchConfirmBtn').hidden=!sodaBatchPreview.items.length;
    setSodaStatus(sodaBatchPreview.items.length?'请核对预览；确认后只保存歌曲信息与分享链接。':'没有可加入的新歌曲，请检查格式与链接。',!sodaBatchPreview.items.length);
  }
  function confirmSodaBatch(){
    if(!sodaBatchPreview)return;
    if($('sodaBatch').value!==sodaBatchText){setSodaStatus('批量内容已改动，请重新检查后再确认。',true);$('sodaBatchConfirmBtn').hidden=true;sodaBatchPreview=null;return}
    const existing=tracks.filter(t=>t.kind==='soda').map(t=>t.externalUrl),latest=globalThis.SonicSodaLibrary?.parseSodaLines(sodaBatchText,existing);
    if(!latest?.items.length){setSodaStatus('没有可加入的新歌曲，请重新检查内容。',true);return}
    for(const value of latest.items)tracks.push({id:newId('soda'),kind:'soda',...value,duration:0,cover:null,blob:null,stored:true,favorite:false,sourcePath:'汽水音乐',signature:'soda:'+value.externalUrl.toLocaleLowerCase()});
    libraryView='soda';sodaBatchPreview=null;sodaBatchText='';$('sodaBatch').value='';$('sodaBatchPreview').textContent='';$('sodaBatchConfirmBtn').hidden=true;
    setSodaStatus('已加入 '+latest.items.length+' 首汽水音乐。列表只保存你填写的歌曲信息与分享链接。');
    resetShuffle();persistLibrary();renderPlaylist();
  }
  function setupSodaLibrary(){
    $('sodaEditor').addEventListener('submit',saveSodaRecord);
    $('sodaCancelBtn').addEventListener('click',()=>{resetSodaEditor();setSodaStatus('已取消编辑。')});
    $('sodaPasteBtn').addEventListener('click',async()=>{
      try{
        if(!navigator.clipboard?.readText)throw new Error('当前浏览器没有开放剪贴板读取。');
        const text=await navigator.clipboard.readText(),match=String(text||'').match(/https?:\/\/[^\s<>"']+/i);
        $('sodaUrl').value=(match?.[0]||'').replace(/[),.;，。；）}\]]+$/g,'');
        if(!$('sodaUrl').value)throw new Error('剪贴板里没有找到 http/https 分享链接。');
        setSodaStatus('已从剪贴板填入分享链接，请补充歌曲名称后保存。');
      }catch(error){setSodaStatus(error.message||'无法读取剪贴板，请手动粘贴分享链接。',true)}
    });
    $('sodaBatch').addEventListener('input',()=>{
      if($('sodaBatch').value===sodaBatchText)return;
      sodaBatchPreview=null;$('sodaBatchPreview').textContent='';$('sodaBatchConfirmBtn').hidden=true;
    });
    $('sodaBatchParseBtn').addEventListener('click',previewSodaBatch);
    $('sodaBatchConfirmBtn').addEventListener('click',confirmSodaBatch);
    $('openSodaLibraryBtn').addEventListener('click',async()=>{
      if($('externalDialog').open)$('externalDialog').close();
      if(!$('queueDialog').open)$('queueDialog').showModal();
      if(!libraryReady&&libraryPromise)await libraryPromise;
      setLibraryView('soda');
    });
  }
  function openPlaylistEditor(edit=false){
    const playlist=playlists.find(p=>p.id===libraryView);editingPlaylistId=edit&&playlist?playlist.id:null;
    $('playlistEditorTitle').textContent=editingPlaylistId?'给歌单换个名字':'为下一段旅程，建一个歌单';
    $('playlistName').value=editingPlaylistId?playlist.name:'';$('playlistEditor').hidden=false;$('membershipPanel').hidden=true;$('playlistName').focus();
  }
  function openMembership(id){
    membershipTrackId=id;const track=tracks.find(t=>t.id===id);if(!track)return;
    $('membershipTitle').textContent='将「'+track.name+'」加入歌单';
    const select=$('songPlaylistSelect');select.replaceChildren();
    playlists.forEach(p=>select.add(new Option(p.name+(p.trackIds.includes(id)?' · 已加入':''),p.id)));
    $('membershipHint').textContent=playlists.length?'歌曲可同时属于多个歌单。':'先点「新建歌单」，再回来添加这首歌。';
    $('addMembershipBtn').disabled=!playlists.length;$('membershipPanel').hidden=false;$('playlistEditor').hidden=true;
    $('membershipPanel').scrollIntoView({block:'nearest'});(playlists.length?select:$('closeMembershipBtn')).focus();
  }
  function setupLibraryFive(){
    $('folderImportBtn').addEventListener('click',openMusicFolder);
    $('playImportedBtn').addEventListener('click',playImportedMusic);
    $('folderInput').addEventListener('change',()=>{const files=Array.from($('folderInput').files);$('folderInput').value='';importFiles(files,[],false,true)});
    $('librarySearch').addEventListener('input',()=>{
      libraryQuery=$('librarySearch').value;
      legacyQueuePage=0;
      renderLegacyQueue();
      $('queueList').scrollTop=0;
    });
    $('legacyQueuePrevious').addEventListener('click',()=>changeLegacyQueuePage(-1));
    $('legacyQueueNext').addEventListener('click',()=>changeLegacyQueuePage(1));
    $('queueDialog').addEventListener('close',()=>{
      if($('queueDialog').open)return;
      $('queueList').replaceChildren();
      $('legacyQueuePagination').hidden=true;
    });
    document.querySelectorAll('button[data-library-view]').forEach(button=>button.addEventListener('click',()=>{
      const view=button.dataset.libraryView;
      if(view==='playlists'){if(playlists.length)setLibraryView($('libraryPlaylist').value||playlists[0].id);else openPlaylistEditor()}
      else setLibraryView(view);
    }));
    $('libraryPlaylist').addEventListener('change',()=>{if($('libraryPlaylist').value)setLibraryView($('libraryPlaylist').value)});
    $('newPlaylistBtn').addEventListener('click',()=>openPlaylistEditor());$('renamePlaylistBtn').addEventListener('click',()=>openPlaylistEditor(true));
    $('cancelPlaylistBtn').addEventListener('click',()=>{$('playlistEditor').hidden=true});
    $('playlistForm').addEventListener('submit',e=>{
      e.preventDefault();const id=saveLibraryPlaylist($('playlistName').value,editingPlaylistId);
      if(!id){$('playlistName').focus();return}
      if(!editingPlaylistId)libraryView=id;
      $('playlistEditor').hidden=true;persistLibrary();renderPlaylist();showToast('歌单已保存。');
    });
    $('deletePlaylistBtn').addEventListener('click',()=>{
      const playlist=playlists.find(p=>p.id===libraryView);if(!playlist)return;
      playlists=playlists.filter(p=>p!==playlist);if(playbackScope===playlist.id){playbackScope='all';resetShuffle()}
      libraryView='all';$('playlistEditor').hidden=true;persistLibrary();renderPlaylist();showToast('已删除歌单，歌曲保留在全部音乐中。');
    });
    $('closeMembershipBtn').addEventListener('click',()=>{$('membershipPanel').hidden=true});
    $('addMembershipBtn').addEventListener('click',()=>{
      const playlist=playlists.find(p=>p.id===$('songPlaylistSelect').value),track=tracks.find(t=>t.id===membershipTrackId);if(!playlist||!track)return;
      if(playlist.trackIds.includes(track.id)){showToast('这首歌已经在该歌单里。');return}
      playlist.trackIds.push(track.id);if(playbackScope===playlist.id){playbackScopeOrder=null;resetShuffle();}
      persistLibrary();renderPlaylist();$('membershipPanel').hidden=true;showToast('已加入「'+playlist.name+'」。');
    });
    $('playCollectionBtn').addEventListener('click',()=>{
      cancelOnlinePick();
      if(libraryView==='soda'){
        const songs=collectionTracks('soda'),firstOnline=songs.find(t=>t.kind==='online');
        if(firstOnline){
          usePlaybackScope('soda');persistLibrary();resetShuffle(firstOnline.id);selectTrack(firstOnline.id,true);renderLibraryControls();
          showToast('正在让第一首汽水音乐成为星空。');
          return;
        }
        const first=songs[0];if(!first)return;
        openSodaUrl(first.externalUrl);showToast('已打开第一首汽水分享链接。旧链接无法直接驱动星空。');
        return;
      }
      const songs=playableTracks(libraryView);if(!songs.length)return;usePlaybackScope(libraryView);persistLibrary();resetShuffle(songs[0].id);
      selectTrack(songs[0].id,true);renderLibraryControls();
    });
    setupSodaLibrary();
  }

  let onlineConnectAttempt=0,onlineConnection=null,onlineSearchGeneration=0,onlineProvider='qishui';
  const onlineResultAvailability=new Map();
  let onlineAccountRevision=0,onlineLoginSessionId=null;
  let onlinePick=null,onlinePickTrack=null;
  let onlinePlaylistView=null,onlinePlaylistAbort=null;
  let onlineSearchView=null,onlineSearchAbort=null;
  const onlineProviderNames={qishui:'汽水音乐',netease:'网易云音乐',qq:'QQ 音乐',kugou:'酷狗音乐'};
  function onlineProviderName(){return onlineProviderNames[onlineProvider]||'汽水音乐'}
  function clearOnlinePlaylistView(){
    onlinePlaylistAbort?.abort();onlinePlaylistAbort=null;onlinePlaylistView=null;onlineCurrentPlaylistId='';
    $('onlinePlayPlaylistBtn').hidden=true;
    $('onlineSyncPlaylistBtn').hidden=true;
  }
  function beginOnlineViewRequest(){
    cancelOnlinePick();
    clearOnlinePlaylistView();
    onlineSearchAbort?.abort();onlineSearchAbort=null;onlineSearchView=null;
    onlineSearchGeneration++;$('onlineSearchBtn').removeAttribute('aria-busy');syncOnlineProvider();syncOnlineControls();return onlineSearchGeneration;
  }
  function syncOnlineProvider(){
    const qishui=onlineProvider==='qishui';
    document.querySelectorAll('[data-online-provider]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.onlineProvider===onlineProvider)));
    $('onlineProviderHint').textContent=qishui?(onlineClient?.qishuiAvailable===false?qishuiDisabledMessage:'可搜索汽水公开歌曲，登录后还能读取收藏与歌单。'):'可在原平台播放。已登录汽水时，也可查找同版本并在应用内播放。';
    $('onlineExternalLinkBtn').hidden=qishui;$('onlineAccountActions').hidden=!qishui;$('onlinePlaylists').hidden=!qishui;
    $('onlineSearchInput').setAttribute('aria-label','搜索'+onlineProviderName());
    if($('onlineSearchBtn').getAttribute('aria-busy')!=='true')$('onlineSearchBtn').textContent='搜索'+onlineProviderName();
  }
  function setOnlineProvider(provider){
    if(!Object.hasOwn(onlineProviderNames,provider)||provider===onlineProvider)return;
    if(provider!=='qishui'&&playbackRetryAttempt?.phase==='login')clearPlaybackRetry(playbackRetryAttempt);
    onlineProvider=provider;beginOnlineViewRequest();hideOnlineLoginCard();
    $('onlineSearchBtn').removeAttribute('aria-busy');onlineCurrentPlaylistId='';renderOnlinePlaylists([]);
    $('onlineResults').replaceChildren();const empty=document.createElement('div');empty.className='online-empty';empty.textContent='输入歌名或歌手，搜索'+onlineProviderName()+'。';$('onlineResults').append(empty);
    setOnlineResultStatus(provider==='qishui'?'未登录也可以搜索公开歌曲；登录后可读取收藏和歌单。':'可在'+onlineProviderName()+'播放，或在声波宇宙内播放匹配的汽水版本。');
    syncOnlineProvider();syncOnlineControls();
  }
  function setOnlineResultStatus(message,error=false){
    const status=$('onlineResultStatus');status.textContent=message;status.classList.toggle('error',error);
  }
  function isLocalOnlinePage(){
    const host=String(location.hostname||'').toLowerCase();
    return host==='127.0.0.1'||host==='localhost'||host==='[::1]';
  }
  function localOnlineEntryUrl(){
    return 'http://127.0.0.1:8765/?v=33';
  }
  function showOnlineUnavailable(message='本机音乐入口没有连接。'){
    setOnlineResultStatus(message+' 星空和本地音乐仍可使用；搜索、扫码登录需要运行本机 Companion。点「重新连接」再试。',true);
    $('onlineLocalCallout').hidden=false;
  }
  const qishuiDisabledMessage='汽水音乐未启用。可播放本地音乐，或切换其他在线平台。';
  function syncOnlineControls(){
    const qishuiDisabled=onlineProvider==='qishui'&&onlineClient?.qishuiAvailable===false;
    const ready=onlineReady&&!qishuiDisabled&&$('onlineService').dataset.state==='ready',busy=el=>el.getAttribute('aria-busy')==='true',qishui=onlineProvider==='qishui';
    $('onlineSearchInput').disabled=!ready;$('onlineSearchBtn').disabled=!ready||busy($('onlineSearchBtn'));
    $('onlineSearchInput').placeholder=ready?'搜索歌曲、歌手或专辑…':qishuiDisabled?'汽水音乐未启用':'先连接本机音乐入口，再搜索歌曲';
    $('onlineLoginBtn').disabled=!ready||busy($('onlineLoginBtn'));$('onlineLoginBtn').hidden=!qishui||onlineLoggedIn;
    $('onlineLogoutBtn').disabled=!ready||busy($('onlineLogoutBtn'));$('onlineLogoutBtn').hidden=!qishui||!onlineLoggedIn;$('onlineAccount').hidden=!qishui||!onlineLoggedIn;
    $('onlineLikedBtn').disabled=!ready||!onlineLoggedIn||busy($('onlineLikedBtn'));$('onlinePlaylistsBtn').disabled=!ready||!onlineLoggedIn||busy($('onlinePlaylistsBtn'));
    $('onlinePlayPlaylistBtn').hidden=!qishui||!onlinePlaylistView?.items.length;
    $('onlinePlayPlaylistBtn').disabled=!ready||!onlineLoggedIn||!onlinePlaylistView?.items.length||busy($('onlinePlayPlaylistBtn'));
    $('onlinePlayPlaylistBtn').textContent=onlinePlaylistView?.kind==='liked'?'播放全部收藏':'播放整个歌单';
    const playSearch=$('onlinePlaySearchResultsBtn');
    if(playSearch){
      playSearch.hidden=!onlineSearchView?.items.length;
      playSearch.disabled=!ready||busy(playSearch);
    }
    $('onlineSyncPlaylistBtn').hidden=!qishui||!onlinePlaylistView?.id;
    $('onlineSyncPlaylistBtn').disabled=!ready||!onlineLoggedIn||!onlinePlaylistView?.id||busy($('onlineSyncPlaylistBtn'));
    $('onlineLocalCallout').hidden=onlineReady||$('onlineService').dataset.state==='pending';
    $('onlineReconnectBtn').disabled=$('onlineService').dataset.state==='pending';
    document.querySelectorAll('[data-online-playlist-id]').forEach(el=>el.disabled=!ready||!onlineLoggedIn||busy(el));
    document.querySelectorAll('[data-online-action]').forEach(el=>{const remote=['play','like','remote-add','remote-remove'].includes(el.dataset.onlineAction);if(remote)el.disabled=!ready||busy(el)||(['like','remote-add','remote-remove'].includes(el.dataset.onlineAction)&&!onlineLoggedIn)});
  }
  function setOnlineServiceState(state,title,status){
    onlineReady=state==='ready';
    if(!onlineReady)cancelNextOnlinePreparation();
    $('onlineService').dataset.state=state;$('onlineServiceTitle').textContent=title;$('onlineServiceStatus').textContent=status;
    app.dataset.onlineMusic=state;syncOnlineControls();
  }
  function isOnlineAuthError(error){return !isNavidromeFailure(null,error)&&(error?.status===401||error?.code==='auth-required');}
  function onlineRequestFailure(error,attempt=onlineConnectAttempt){
    const message=onlineErrorMessage(error);
    if(attempt!==onlineConnectAttempt)return message;
    if(isOnlineAuthError(error)){
      setOnlineAccount(null);app.dataset.onlineLogin='expired';
      setOnlineResultStatus('登录已失效，请重新扫码登录。',true);
      return message;
    }
    if(error instanceof TypeError){
      setOnlineServiceState('offline','连不上本机音乐入口','星空和本地音乐仍可使用。确认 Companion 已启动，点「重新连接」再试。');
      setOnlineResultStatus(message+' 可点「重新连接」后重试。',true);
    }else setOnlineResultStatus((error?.code==='timeout'?'本次请求超时。':message)+' 请重新操作，也可以切换音乐平台。',true);
    return message;
  }
  function setOnlineLoginStatus(title,status,state='waiting'){
    $('onlineLoginTitle').textContent=title;$('onlineLoginStatus').textContent=status;
    $('onlineLoginCard').dataset.state=state;app.dataset.onlineLogin=state;
  }
  function setOnlineAccount(user=null){
    const changed=onlineLoggedIn!==Boolean(user);
    if(!user||changed){cancelNextOnlinePreparation();onlineResultAvailability.clear();window.SonicMusicDiscovery?.invalidateDaily();}
    if(changed)onlineAccountRevision++;
    onlineLoggedIn=Boolean(user);
    const account=$('onlineAccount'),avatar=$('onlineAvatar'),name=$('onlineUserName');
    account.hidden=!user;avatar.hidden=true;avatar.removeAttribute('src');
    if(user){
      name.textContent=String(user.nickname||'汽水音乐用户').slice(0,80)+(user.isVip?' · SVIP':'');
      const safeAvatar=globalThis.SonicOnlineMusic?.safeHttpsUrl(user.avatar);
      if(safeAvatar){avatar.src=safeAvatar;avatar.referrerPolicy='no-referrer';avatar.hidden=false}
    }else name.textContent='';
    syncOnlineControls();
    if(changed)window.dispatchEvent(new Event('sonic:online-account'));
  }
  function stopOnlineLoginPolling(){
    if(onlineLoginPoll)clearTimeout(onlineLoginPoll);
    onlineLoginPoll=0;onlineLoginGeneration++;
  }
  function cancelOnlineLoginSession(){
    const id=onlineLoginSessionId;
    onlineLoginSessionId=null;
    if(id)void onlineClient?.loginCancel(id).catch(()=>{});
  }
  function hideOnlineLoginCard(){
    stopOnlineLoginPolling();cancelOnlineLoginSession();$('onlineLoginCard').hidden=true;$('onlineQrImage').removeAttribute('src');
    $('onlineLoginBtn').removeAttribute('aria-busy');$('onlineLoginBtn').textContent='扫码登录';
  }
  async function refreshOnlineAccount(preferredUser=null){
    if(!onlineReady||!onlineClient||onlineClient.qishuiAvailable===false){setOnlineAccount(null);return null}
    const attempt=onlineConnectAttempt;
    try{
      const data=await onlineClient.loginStatus();
      if(attempt!==onlineConnectAttempt||!onlineReady)return null;
      if(data?.authenticated&&data.user){
        setOnlineAccount(data.user);
        setTimeout(()=>{if(attempt===onlineConnectAttempt&&onlineLoggedIn)window.SonicMusicDiscovery?.warmDaily(onlineClient);},700);
        return data.user;
      }
      setOnlineAccount(null);return null;
    }catch(error){
      if(attempt!==onlineConnectAttempt)return null;
      if(preferredUser){setOnlineAccount(preferredUser);return preferredUser}
      if(error?.status===401||error?.code==='auth-required')setOnlineAccount(null);
      else if(onlineProvider==='qishui')onlineRequestFailure(error);
      return null;
    }
  }
  function requireOnlineLogin(message='请先扫码登录汽水音乐，再使用收藏和歌单。'){
    if(!onlineReady){showOnlineUnavailable();return false}
    if(onlineLoggedIn)return true;
    setOnlineResultStatus(message,true);showToast(message,true);return false;
  }
  function mergeOnlineTrack(track){
    if(!track)return null;
    const previous=tracks.find(item=>item.kind==='online'&&item.mediaId===track.mediaId);
    if(previous?.liked)track={...track,liked:true};
    if(previous&&previous.id===preparedTrackId)track={...track,preview:previous.preview};
    const merged=globalThis.SonicOnlineMusic?.mergeTracks(tracks,[track])||tracks;
    tracks=merged;return tracks.find(item=>item.kind==='online'&&item.mediaId===track.mediaId)||null;
  }
  function normalizeOnlineItems(items){
    return (Array.isArray(items)?items:[]).map(item=>globalThis.SonicOnlineMusic?.normalizeTrack(item)).filter(Boolean);
  }
  async function saveQishuiSearchTrack(source,{favorite,playlistId}={}){
    const rejected=reason=>({ok:false,saved:false,changed:false,reason});
    if(!libraryReady||libraryReadFailed||backupRestoring)return rejected('library-unavailable');
    if((favorite!==undefined&&typeof favorite!=='boolean')||(favorite===undefined&&playlistId===undefined))return rejected('invalid-action');
    const {provider,mediaId,name,artist,album,duration,preview}=source||{};
    const candidate=SonicOnlineMusic.normalizeTrack({provider,mediaId,name,artist,album,duration,preview});
    if(!candidate)return rejected('invalid-track');
    const playlist=playlistId===undefined?null:playlists.find(item=>item.id===playlistId);
    if(playlistId!==undefined&&!playlist)return rejected('playlist-not-found');
    const existing=tracks.find(track=>track.kind==='online'&&track.mediaId===candidate.mediaId);
    const track=existing||candidate;
    const newTrack=!existing&&(favorite===true||Boolean(playlist));
    const membership=Boolean(playlist&&!playlist.trackIds.includes(track.id));
    const favoriteChanged=favorite!==undefined&&favorite!==track.favorite;
    const changed=newTrack||membership||favoriteChanged;
    const scopeWillChange=(newTrack&&['all','soda'].includes(playbackScope))||
      (favoriteChanged&&playbackScope==='favorites')||(membership&&playbackScope===playlist.id);
    if(scopeWillChange&&!sessionQueue&&activeId&&playbackScopeOrder?.scope!==playbackScope){
      // Collection writes must not change the order of a session already selected from that collection.
      playbackScopeOrder={scope:playbackScope,ids:playableTracks(playbackScope).map(item=>item.id)};
      if(deferredResume&&resumePoint?.scope===playbackScope){
        resumePoint.scopeOrder=playbackScopeOrder.ids;persistResumePoint();
      }else saveSession();
    }
    if(newTrack)tracks.push(track);
    if(favoriteChanged)track.favorite=favorite;
    if(membership)playlist.trackIds.push(track.id);
    const saved=changed||savingCount||storageIssues.has('library')?await persistLibrary():true;
    if(changed)renderPlaylist();
    return {ok:saved,saved,changed,id:track.id,favorite:Boolean(track.favorite),
      ...(favorite===undefined?{}:{requestedFavorite:favorite}),...(playlist?{playlistId:playlist.id}:{}),
      ...(saved?{}:{reason:'storage'})};
  }
  function onlineToolButton(label,action){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.onlineAction=action;return button;
  }
  function onlineResultBadge(title,kind,label=SonicOnlineMusic.playbackStatusLabel){
    const heading=document.createElement('div'),badge=document.createElement('span');
    heading.className='online-result-heading';badge.className='online-result-badge';
    const update=value=>{badge.dataset.state=value;badge.textContent=label(value);};
    update(kind);heading.append(title,badge);return {heading,update};
  }
  function cancelOnlinePick(){
    onlinePick?.abort();
    onlinePick=null;
    if(onlinePickTrack){
      onlinePickTrack=null;
      window.dispatchEvent(new Event('sonic:transport-state'));
    }
  }
  function recordingKey(value){return String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();}
  function confirmsRecording(source,track){
    return Boolean(track&&(!source.duration||track.duration>0&&Math.abs(source.duration-track.duration)<=2)&&
      (!source.album||recordingKey(source.album)===recordingKey(track.album)));
  }
  async function searchNavidrome(query,{signal}={}){
    const items=[];
    if(signal?.aborted)return {status:'cancelled',items};
    if(!window.sonicDesktop)return {status:'disconnected',items};
    try{
      const response=await fetch('/api/navidrome/search',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({query}),signal:AbortSignal.any([signal,AbortSignal.timeout(5500)].filter(Boolean))});
      const result=await response.json();
      if(response.ok)return {status:'ok',items:normalizeOnlineItems(result.items).filter(track=>track.provider==='navidrome')};
      const disconnected=response.status===401||result.code==='navidrome-auth';
      return {status:disconnected?'disconnected':'error',items};
    }catch{
      return {status:signal?.aborted?'cancelled':'error',items};
    }
  }
  async function resolveChartRecording(source,signal){
    const sameTitle=track=>recordingKey(track.name)===recordingKey(source.name);
    const local=tracks.filter(track=>track.kind==='file'&&track.blob&&sameTitle(track));
    let remote=[];
    if(window.sonicDesktop)try{
      const response=await fetch('/api/navidrome/search',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({query:source.name}),signal:AbortSignal.any([signal,AbortSignal.timeout(3500)].filter(Boolean))});
      if(response.ok){
        const result=await response.json();
        remote=normalizeOnlineItems(result.items).filter(track=>track.provider==='navidrome'&&sameTitle(track));
      }
    }catch{signal?.throwIfAborted();}
    let reference=source;
    if((!source.duration||!source.album)&&source.provider==='apple'&&onlineClient?.chartRecording&&
      [...local,...remote].some(track=>recordingKey(track.artist)===recordingKey(source.artist))){
      const details=await onlineClient.chartRecording(source.mediaId,{country:source.country,signal}).catch(()=>null);
      signal?.throwIfAborted();
      if(details?.item)reference={...source,album:source.album||details.item.album,duration:source.duration||details.item.duration};
    }
    const owned=SonicOnlineMusic.findOwnedRecording(reference,local)||SonicOnlineMusic.findOwnedRecording(reference,remote);
    if(owned)return {track:owned,candidates:[]};
    const candidates=[...remote,...local];
    if(!onlineReady||!onlineClient)return {candidates,reason:'unavailable'};
    try{
      const result=await onlineClient.matchChartTrack(source,{includeCandidates:true,signal});
      const track=SonicOnlineMusic.normalizeTrack(result?.item);
      if(track&&(result?.reason==='matched'||confirmsRecording(source,track)))return {track,candidates};
      return {candidates:[...candidates,...normalizeOnlineItems(result?.candidates)],reason:result?.reason};
    }catch(error){
      signal?.throwIfAborted();
      if(!candidates.length)throw error;
      return {candidates,reason:'unavailable'};
    }
  }
  function selectedRecording(source){
    return source?.kind==='file'?tracks.find(track=>track.id===source.id&&track.kind==='file'&&track.blob):
      SonicOnlineMusic.normalizeTrack(source);
  }
  function unconfirmedRecording(candidates){
    return candidates.length?'无法确认版本，请手动选择要播放的录音。':'无法确认版本，可手动搜索或打开原平台。';
  }
  async function playRecording(source,{signal:parentSignal,label='汽水音乐',singleQueue=true,preserveCurrent=false,holdOnFailure=false}={}){
    if(instrumentOpen||clipLocked())return {status:'failed',message:'请先退出乐器台或结束短片录制。'};
    cancelOnlinePick();
    const pick=new AbortController();
    let attempt=onlineConnectAttempt;
    onlinePick=pick;
    let signal=parentSignal?AbortSignal.any([parentSignal,pick.signal]):pick.signal;
    const isCurrent=()=>onlinePick===pick&&!signal.aborted&&attempt===onlineConnectAttempt;
    const canceled={status:'cancelled'};
    let candidates=[], heldFailure=false;
    const keepCurrent=preserveCurrent&&(playing||externalStream||preparedTrackId!==null&&preparedTrackId===activeId&&!deferredResume);
    try{
      signal.throwIfAborted();
      if(preserveCurrent&&!onlineReady&&onlineClient&&source?.provider!=='navidrome'&&source?.kind!=='file'){
        const connecting=connectOnlineMusic();
        attempt=onlineConnectAttempt;
        await connecting;
        if(!isCurrent())return canceled;
      }
      let track=selectedRecording(source);
      if(track||typeof source?.name==='string'){
        onlinePickTrack=track||{id:source.id||('chart:'+source.mediaId),name:source.name,artist:source.artist};
        window.dispatchEvent(new Event('sonic:transport-state'));
      }
      if(!track){
        const resolved=await resolveChartRecording(source,signal);
        if(!isCurrent())return canceled;
        ({track,candidates}=resolved);
        if(!track)return {status:'unmatched',candidates,reason:resolved.reason,message:unconfirmedRecording(candidates)};
      }
      let onlineData,preflightError;
      try{
        if(track.kind==='file'){
          if(keepCurrent){
            const probe=new Audio(),url=URL.createObjectURL(track.blob);
            try{await waitForMetadata(probe,url,10000,signal);}
            finally{probe.removeAttribute('src');probe.load();URL.revokeObjectURL(url);}
          }
        }else{
          const prepared=nextOnlinePreparation;
          const ticket=prepared?.result?.ticket;
          const sameTrack=prepared?.result?.track?.id===track.id;
          const mayReuse=prepared&&prepared.queue===sessionQueue&&sameTrack&&ticket?.validUntil>Date.now()&&
            prepared.attempt===attempt&&prepared.accountRevision===onlineAccountRevision;
          onlineData=mayReuse?ticket.data:await requestOnlineAudio(track,{signal});
        }
        if(!isCurrent())return canceled;
        if(keepCurrent&&onlineData){
          const probe=new Audio();probe.preload='metadata';
          try{({data:onlineData}=await loadOnlineMetadata(probe,track,onlineData,signal,12000));}
          finally{probe.removeAttribute('src');probe.load();}
        }
      }catch(error){
        if(keepCurrent||!holdOnFailure||!isCurrent())throw error;
        preflightError=error;
      }
      if(!isCurrent())return canceled;
      // Before the switch, leaving search can cancel the selection. Once committed, only another playback action supersedes it.
      if(preserveCurrent)signal=pick.signal;
      const previous=externalStream||externalPending?null:{
        track:currentTrack(),queue:sessionQueue,scope:playbackScope,scopeOrder:playbackScopeOrder,position:getLocalPosition(),playing,
      };
      const local=track.kind==='file'?track:mergeOnlineTrack(track);
      let queue;
      if(singleQueue){
        const entry=queueItem(track,track.kind==='online');
        queue=setSessionQueue([entry],entry.entryId,label);
      }
      const commitRevision=queueRevision+Number(!queue&&Boolean(previous?.queue));
      const outcome=await selectTrack(local.id,true,0,false,{queue,scope:track.kind==='file'?'local':'soda',reportFailure:true,onlineData,preflightError,signal});
      if(!isCurrent())return canceled;
      const canRestore=previous?.track&&previous.track.id!==local.id&&sessionQueue===(queue||null)&&queueRevision===commitRevision;
      if(outcome?.error&&canRestore&&(!holdOnFailure||keepCurrent&&outcome.error.name!=='NotAllowedError')){
        playbackScope=previous.scope;playbackScopeOrder=previous.scopeOrder;
        sessionQueue=previous.queue;queueRun++;
        resetShuffle();updatePlaybackMode();queueChanged();renderLibraryControls();
        await selectTrack(previous.track.id,previous.playing,previous.position,true,{queue:previous.queue,reportFailure:true,signal});
        if(!isCurrent())return canceled;
      }else if(outcome?.error&&holdOnFailure){
        if(outcome.error.name!=='NotAllowedError'){
          if(queue){
            if(!recoverableQueueFailure(queue,outcome.error,0,true))holdQueueFailure(queue,'unplayable',0,true);
          }else holdScopedFailure(local,outcome.error,0,{manual:true});
          heldFailure=true;
        }
      }
      if(outcome?.error)throw outcome.error;
      if(!outcome?.ok||!playing||activeId!==local.id)return {status:'failed',candidates,message:'播放未开始，请重试或选择其他版本。'};
      return {status:currentTrack()?.preview?'preview':'full',track:currentTrack()};
    }catch(error){
      if(!isCurrent())return canceled;
      if(isNavidromeFailure(null,error))return {status:'unavailable',availability:'unknown',message:navidromeFailureMessage(null,error)};
      const status=isOnlineAuthError(error)?'auth-required':error instanceof TypeError||error?.code==='unavailable'||
        preserveCurrent&&Boolean(playbackFailureReason(error))?'unavailable':'failed';
      return {status,candidates,officialOnly:error?.status===422||error?.code==='not-playable',message:heldFailure?onlineErrorMessage(error):onlineRequestFailure(error,attempt)};
    }finally{
      if(onlinePick===pick){
        onlinePick=null;onlinePickTrack=null;
        window.dispatchEvent(new Event('sonic:transport-state'));
      }
    }
  }
  async function playQishuiSearchTrack(track,{signal}={}){
    if(signal?.aborted)return {status:'cancelled'};
    const recording=SonicOnlineMusic.normalizeTrack(track);
    if(!recording)return {status:'failed',message:'这条汽水歌曲结果无效，请重新搜索。'};
    const outcome=await playRecording(recording,{signal,singleQueue:false,preserveCurrent:true,holdOnFailure:true});
    if(signal?.aborted)return {status:'cancelled'};
    if(['full','preview','cancelled'].includes(outcome.status))return {status:outcome.status};
    if(outcome.officialOnly){
      rememberOnlineAvailability(recording.mediaId,'unavailable');
      return {status:'unavailable',availability:'unavailable',message:'这首歌暂无法在应用内播放。'};
    }
    rememberOnlineAvailability(recording.mediaId,outcome.status==='auth-required'?'auth-required':'unknown');
    const message={unavailable:'暂时无法连接汽水音乐，请重试。',
      'auth-required':'这首歌需要登录汽水音乐。',failed:'这首歌未能开始播放，请重试。'}[outcome.status];
    return {status:outcome.status,message};
  }
  function rememberOnlineAvailability(mediaId,availability){
    onlineResultAvailability.delete(mediaId);
    if(onlineResultAvailability.size>=300)onlineResultAvailability.delete(onlineResultAvailability.keys().next().value);
    onlineResultAvailability.set(mediaId,availability);
  }
  async function checkQishuiSearchTrack(track,{signal}={}){
    const recording=SonicOnlineMusic.normalizeTrack(track);
    if(!recording)return {message:'这条结果已失效，请重新搜索。'};
    const revision=onlineAccountRevision;
    const result=await checkRecording(recording,{signal});
    if(revision!==onlineAccountRevision||signal?.aborted)return {};
    if(result.availability&&result.availability!=='unknown')rememberOnlineAvailability(recording.mediaId,result.availability);
    return result;
  }
  async function checkRecording(source,{signal}={}){
    let track=selectedRecording(source),candidates=[];
    try{
      if(!track){
        ({track,candidates}=await resolveChartRecording(source,signal));
        if(!track)return {status:'unmatched',availability:'unknown',candidates,message:unconfirmedRecording(candidates)};
      }
      if(track.kind==='file')return {availability:'full-source',track,candidates};
      const ticket=await requestOnlineAudio(track,{signal,retry:false});
      const probe=new Audio();probe.preload='metadata';
      try{
        const {data}=await loadOnlineMetadata(probe,track,ticket,signal,12000);
        signal?.throwIfAborted();
        return {availability:data.preview===true?'preview-source':'full-source',track,candidates};
      }finally{probe.removeAttribute('src');probe.load();}
    }catch(error){
      if(signal?.aborted)return {};
      if(error?.code==='navidrome-auth')return {availability:'unknown',message:'请重新连接 Navidrome 后再查找。'};
      if(isOnlineAuthError(error))return {availability:'auth-required',message:'请登录汽水音乐后重试。'};
      if(error?.status!==422&&error?.code!=='not-playable')
        return {availability:'unknown',message:'暂时无法检查音源，可以再试一次。'};
      return {availability:'unavailable',candidates,message:'这首歌暂无法在应用内播放，可打开原平台。'};
    }
  }
  function nextSearchAction(index){
    const rows=$('onlineResults').querySelectorAll('.online-result');
    for(let i=index+1;i<rows.length;i++){
      const action=rows[i].querySelector('[data-result-start]');if(action&&!action.disabled)return action;
    }
    return null;
  }
  function addResultRecovery(tools,track,index,candidates){
    let choose=tools.querySelector('[data-result-recovery]');
    if(choose){choose.onclick=()=>chooseQishuiVersion(track,choose,candidates);return}
    choose=onlineToolButton('选其他版本','choose-qishui');
    choose.dataset.resultRecovery='';
    choose.onclick=()=>chooseQishuiVersion(track,choose,candidates);tools.append(choose);
    if(!nextSearchAction(index))return;
    const skip=onlineToolButton('跳到下一首','skip-result');
    skip.addEventListener('click',()=>{const button=nextSearchAction(index);if(button){button.focus();button.click();}});
    tools.append(skip);
  }
  async function chooseQishuiVersion(track,control,candidates){
    if(!onlineReady){showOnlineUnavailable();return;}
    const attempt=onlineConnectAttempt,view=onlineSearchGeneration;
    const current=()=>attempt===onlineConnectAttempt&&view===onlineSearchGeneration&&control.isConnected&&$('queueDialog').open;
    control.disabled=true;
    try{
      const response=candidates?.length?null:await onlineClient.matchChartTrack(track,{includeCandidates:true});
      if(!current())return;
      const list=normalizeOnlineItems(candidates?.length?candidates:response?.candidates||[response?.item])
        .filter(song=>track.provider!=='qishui'||song.mediaId!==track.mediaId).slice(0,15);
      if(!list.length){setOnlineResultStatus('汽水暂时没有候选版本。');return;}
      const dialog=document.createElement('dialog');dialog.className='lr-dialog';dialog.setAttribute('aria-labelledby','chooseQishuiVersionTitle');
      dialog.innerHTML='<div class="lr-dialog-heading"><h2 id="chooseQishuiVersionTitle">选择汽水版本</h2><form method="dialog"><button class="lr-icon" aria-label="关闭候选版本">×</button></form></div><ol class="sd-items"></ol>';
      for(const song of list){
        const row=document.createElement('li'),button=document.createElement('button');
        button.type='button';button.className='lr-choice';
        button.textContent=[song.name,song.artist,song.album,song.duration?formatTime(song.duration):'',song.preview?'仅试听':''].filter(Boolean).join(' · ');
        button.addEventListener('click',async()=>{
          dialog.close();if(!current())return;
          const result=await playRecording(song,{label:'汽水音乐 · 手动选择',holdOnFailure:true});
          if(current()&&result.status!=='cancelled'){
            const started=['full','preview'].includes(result.status);
            setOnlineResultStatus(started?'正在播放「'+song.name+'」'+(result.status==='preview'?' · 试听。':'。'):result.message,!started);
          }
        });
        row.append(button);dialog.querySelector('ol').append(row);
      }
      (document.getElementById('listeningRoom')||app).append(dialog);
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
    }catch(error){if(current())showToast(onlineRequestFailure(error,attempt),true);}
    finally{control.disabled=false;}
  }
  async function playExternalSearchMatch(track,button,badge,resultIndex){
    const attempt=onlineConnectAttempt,generation=onlineSearchGeneration;
    const isCurrent=()=>attempt===onlineConnectAttempt&&generation===onlineSearchGeneration&&button.isConnected;
    button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='核对版本中…';
    try{
      const result=await playRecording(track,{label:'汽水音乐 · 匹配版本',holdOnFailure:true});
      if(!isCurrent()||result.status==='cancelled')return;
      if(result.status==='full'||result.status==='preview'){
        badge(result.status==='preview'?'preview':'direct');
        setOnlineResultStatus(result.status==='preview'?'正在试听汽水音乐匹配版本。':'正在播放汽水音乐匹配版本的全曲。');
      }else{
        addResultRecovery(button.parentElement,track,resultIndex,result.candidates);
        setOnlineResultStatus(result.message,true);
      }
    }finally{button.disabled=false;button.removeAttribute('aria-busy');button.textContent='匹配汽水版本';}
  }
  function externalOnlineItems(items,provider){
    return (Array.isArray(items)?items:[]).filter(item=>item?.provider===provider).map(item=>SonicOnlineMusic.normalizeExternalTrack(item)).filter(Boolean);
  }
  function renderExternalOnlineResults(items,provider){
    const root=$('onlineResults');root.replaceChildren();
    const list=externalOnlineItems(items,provider);
    if(!list.length){const empty=document.createElement('div');empty.className='online-empty';empty.textContent='没有找到相关歌曲，换一个歌名或歌手试试。';root.append(empty);return 0}
    list.forEach((track,resultIndex)=>{
      const card=document.createElement('article');card.className='online-result';card.dataset.provider=provider;card.dataset.searchMediaId=track.mediaId;
      const cover=document.createElement(track.cover?'img':'span');cover.className='online-result-cover';
      if(track.cover){cover.src=track.cover;cover.alt='';cover.loading='lazy';cover.referrerPolicy='no-referrer';cover.onerror=()=>{cover.removeAttribute('src');cover.hidden=true}}else cover.setAttribute('aria-hidden','true');
      const copy=document.createElement('div');copy.className='online-result-copy';
      const title=document.createElement('div');title.className='online-result-title';title.textContent=track.name;title.title=track.name;
      const meta=document.createElement('div');meta.className='online-result-meta';meta.textContent=[track.artist||'歌手未知',track.album||'专辑未知',track.duration?formatTime(track.duration):'时长未知',SonicOnlineMusic.recordingVersion(track)].join(' · ');meta.title=meta.textContent;
      const badge=onlineResultBadge(title,track.artist?'match':'official');copy.append(badge.heading,meta);
      const tools=document.createElement('div');tools.className='online-result-tools';
      if(track.artist&&track.duration){
        const match=onlineToolButton('匹配汽水版本','match-qishui');
        match.dataset.resultStart='';match.addEventListener('click',()=>playExternalSearchMatch(track,match,badge.update,resultIndex));tools.append(match);
      }
      else if(track.artist){
        const choose=onlineToolButton('选择汽水版本','choose-qishui');
        choose.dataset.resultStart='';choose.addEventListener('click',()=>chooseQishuiVersion(track,choose));tools.append(choose);
      }
      const url=globalThis.SonicOnlineMusic?.officialTrackUrl(provider,track.externalUrl);
      if(url){const link=document.createElement('a');link.className='official-song-link';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='打开'+onlineProviderNames[provider]+'播放 ↗';link.setAttribute('aria-label','在'+onlineProviderNames[provider]+'官方页面播放「'+track.name+'」');tools.append(link)}
      card.append(cover,copy,tools);root.append(card);
    });return list.length;
  }
  function renderOnlineResults(items,emptyMessage='没有找到可用的汽水音乐结果。',playlistContext=null,page=0){
    const root=$('onlineResults');root.replaceChildren();
    const list=playlistContext?.items??normalizeOnlineItems(items);
    if(!list.length){const empty=document.createElement('div');empty.className='online-empty';empty.textContent=emptyMessage;root.append(empty);return}
    // Keep large playlists usable without mounting thousands of artwork cards at once.
    const pageSize=100,pageCount=playlistContext?Math.ceil(list.length/pageSize):1;
    const currentPage=clamp(page,0,pageCount-1);
    const visible=playlistContext?list.slice(currentPage*pageSize,(currentPage+1)*pageSize):list;
    visible.forEach((track,resultIndex)=>{
      const card=document.createElement('article');card.className='online-result';card.dataset.searchMediaId=track.mediaId;
      if(track.cover||onlineClient?.coverUrl(track.mediaId)){
        const sources=trackCoverSources(track),cover=document.createElement('img');cover.className='online-result-cover';cover.src=sources.primary;cover.alt='';cover.loading='lazy';cover.referrerPolicy='no-referrer';if(sources.fallback)cover.onerror=()=>{cover.onerror=null;cover.src=sources.fallback};card.append(cover);
      }else{
        const cover=document.createElement('span');cover.className='online-result-cover';cover.setAttribute('aria-hidden','true');card.append(cover);
      }
      const copy=document.createElement('div');copy.className='online-result-copy';
      const title=document.createElement('div');title.className='online-result-title';title.textContent=track.name;title.title=track.name;
      const meta=document.createElement('div');meta.className='online-result-meta';
      meta.textContent=[track.artist||'歌手未知',track.album||'专辑未知',track.duration?formatTime(track.duration):'时长未知',
        playlistContext?SonicOnlineMusic.recordingVersion(track):SonicOnlineMusic.searchRecordingVersion(track)].filter(Boolean).join(' · ');
      meta.title=meta.textContent;
      const badge=onlineResultBadge(title,onlineResultAvailability.get(track.mediaId)||(track.preview?'preview':'unknown'),
        playlistContext?SonicOnlineMusic.playbackStatusLabel:SonicOnlineMusic.searchPlaybackStatusLabel);
      copy.append(badge.heading,meta);
      const tools=document.createElement('div');tools.className='online-result-tools';
      const play=onlineToolButton('在星空中播放','play'),add=onlineToolButton('加入本机曲库','add'),playlist=onlineToolButton('加入本机歌单','local-playlist'),like=onlineToolButton(track.liked?'取消汽水收藏':'汽水收藏','like'),open=onlineToolButton('打开汽水 ↗','open');
      like.setAttribute('aria-pressed',String(Boolean(track.liked)));
      if(tracks.some(item=>item.kind==='online'&&item.mediaId===track.mediaId))add.textContent='已在本机曲库';
      tools.append(play,add,playlist,like);
      if(onlineCurrentPlaylistId){
        const remote=onlineToolButton('加入当前汽水歌单','remote-add'),remove=onlineToolButton('从当前歌单移除','remote-remove');
        tools.append(remote,remove);
      }
      tools.append(open);
      play.dataset.resultStart='';
      play.addEventListener('click',async()=>{
        if(!onlineReady){showToast('本机音乐入口没有启动。',true);return;}
        const attempt=onlineConnectAttempt;
        play.setAttribute('aria-busy','true');syncOnlineControls();
        try{
          let started;
          if(playlistContext){
            if(onlinePlaylistView!==playlistContext)return;
            started=await playOnlinePlaylist(playlistContext,track.mediaId);
          }else{
            const outcome=await playRecording(track,{singleQueue:false,preserveCurrent:true,holdOnFailure:true});
            if(outcome.status==='cancelled')return;
            started=outcome.status==='full'||outcome.status==='preview';
            if(!started&&play.isConnected&&attempt===onlineConnectAttempt){
              onlineResultAvailability.delete(track.mediaId);
              badge.update(outcome.officialOnly?'official':outcome.status==='auth-required'?'auth-required':'failed');
              setOnlineResultStatus(outcome.message,true);
            }
          }
          if(!play.isConnected||!$('queueDialog').open||attempt!==onlineConnectAttempt)return;
          if(started&&currentTrack()?.mediaId===track.mediaId){
            badge.update(currentTrack().preview?'preview':'direct');
            setOnlineResultStatus('正在播放「'+track.name+'」'+(currentTrack().preview?' · 试听。':'。'));
            return;
          }
          addResultRecovery(tools,track,resultIndex);
        }finally{play.removeAttribute('aria-busy');syncOnlineControls();}
      });
      add.addEventListener('click',async()=>{
        const local=mergeOnlineTrack(track);if(!local)return;
        await persistLibrary();renderPlaylist();add.textContent='已在本机曲库';showToast('「'+local.name+'」已加入本机曲库，可继续收藏或加入歌单。');
      });
      playlist.addEventListener('click',async()=>{
        const local=mergeOnlineTrack(track);if(!local)return;
        await persistLibrary();renderPlaylist();openMembership(local.id);
      });
      like.addEventListener('click',async()=>{
        if(!requireOnlineLogin())return;
        const attempt=onlineConnectAttempt,next=!Boolean(track.liked);like.disabled=true;like.setAttribute('aria-busy','true');
        try{
          await onlineClient.like(track.mediaId,next);
          if(attempt!==onlineConnectAttempt)return;
          const local=mergeOnlineTrack({...track,liked:next});
          if(local){local.liked=next;persistLibrary();renderPlaylist()}
          track.liked=next;like.textContent=next?'取消汽水收藏':'汽水收藏';like.setAttribute('aria-pressed',String(next));
          setOnlineResultStatus(next?'已收藏到汽水音乐「我的收藏」。':'已从汽水音乐「我的收藏」移除。');
        }catch(error){if(attempt===onlineConnectAttempt)showToast(onlineRequestFailure(error,attempt),true)}
        finally{like.removeAttribute('aria-busy');syncOnlineControls()}
      });
      if(onlineCurrentPlaylistId){
        tools.querySelector('[data-online-action="remote-add"]').addEventListener('click',async event=>{
          if(!requireOnlineLogin())return;const attempt=onlineConnectAttempt,button=event.currentTarget;button.disabled=true;button.setAttribute('aria-busy','true');
          try{await onlineClient.playlistEdit('add',onlineCurrentPlaylistId,[track.mediaId]);if(attempt!==onlineConnectAttempt)return;setOnlineResultStatus('已将「'+track.name+'」加入当前汽水歌单。');button.textContent='已加入当前歌单'}
          catch(error){if(attempt===onlineConnectAttempt)showToast(onlineRequestFailure(error,attempt),true)}
          finally{button.removeAttribute('aria-busy');syncOnlineControls()}
        });
        tools.querySelector('[data-online-action="remote-remove"]').addEventListener('click',async event=>{
          if(!requireOnlineLogin())return;const attempt=onlineConnectAttempt,button=event.currentTarget;button.disabled=true;button.setAttribute('aria-busy','true');
          try{
            await onlineClient.playlistEdit('remove',onlineCurrentPlaylistId,[track.mediaId]);
            if(attempt!==onlineConnectAttempt||onlinePlaylistView!==playlistContext)return;
            playlistContext.items=playlistContext.items.filter(item=>item.mediaId!==track.mediaId);
            renderOnlineResults(playlistContext.items,'这个歌单暂时没有可读取的歌曲。',playlistContext,currentPage);
            setOnlineResultStatus('已将「'+track.name+'」从当前汽水歌单移除。');
          }
          catch(error){if(attempt===onlineConnectAttempt)showToast(onlineRequestFailure(error,attempt),true)}
          finally{button.removeAttribute('aria-busy');syncOnlineControls()}
        });
      }
      open.addEventListener('click',()=>openSodaUrl(track.externalUrl));
      card.append(copy,tools);root.append(card);
    });
    if(pageCount>1){
      const pager=document.createElement('div'),counter=document.createElement('span');
      pager.className='online-actions';pager.setAttribute('role','group');pager.setAttribute('aria-label',playlistContext.kind==='liked'?'收藏歌曲分页':'歌单歌曲分页');
      counter.textContent=(currentPage+1)+' / '+pageCount;
      const pageButton=(label,direction)=>{
        const button=document.createElement('button');button.type='button';button.className='text-btn';button.textContent=label;
        button.disabled=currentPage+direction<0||currentPage+direction>=pageCount;
        button.addEventListener('click',()=>{
          if(onlinePlaylistView!==playlistContext)return;
          renderOnlineResults(list,emptyMessage,playlistContext,currentPage+direction);
          root.querySelector('[data-online-action="play"]')?.focus();
        });
        return button;
      };
      pager.append(pageButton('上一页',-1),counter,pageButton('下一页',1));root.append(pager);
    }
    syncOnlineControls();
  }
  async function playOnlineList(songs,label,mediaId,{fullOnly=false}={}){
    const list=normalizeOnlineItems(songs);
    if(!list.length||!onlineReady||instrumentOpen||clipLocked())return false;
    cancelOnlinePick();
    if(externalStream||externalPending)stopExternal(undefined,true);
    const items=list.map(track=>queueItem(track,true));
    const index=mediaId?list.findIndex(track=>track.mediaId===mediaId):0;
    const first=items[Math.max(0,index)];
    playbackScope='soda';void persistLibrary();renderLibraryControls();
    setSessionQueue(items,first.entryId,String(label||'汽水音乐').slice(0,80),{fullOnly});
    return playQueueFrom(first.entryId,{holdOnFailure:Boolean(mediaId)});
  }
  async function playNavidromeList(songs,label,mediaId,{index,position=0}={}){
    const list=normalizeOnlineItems(songs).filter(track=>track.provider==='navidrome');
    if(!list.length||instrumentOpen||clipLocked())return false;
    cancelOnlinePick();
    if(externalStream||externalPending)stopExternal(undefined,true);
    const items=list.map(track=>queueItem(track,true));
    const chosen=Number.isInteger(index)&&items[index]?index:Math.max(0,list.findIndex(track=>track.mediaId===mediaId));
    const first=items[chosen];
    setSessionQueue(items,first.entryId,String(label||'Navidrome').slice(0,80),{fullOnly:true});
    return playQueueFrom(first.entryId,{holdOnFailure:true,position});
  }
  const navidromeDevice=(()=>{
    const storageKey='sonic-navidrome-device-v1';
    let id=newId('device').slice(-6).toUpperCase();
    try{
      const stored=localStorage.getItem(storageKey);
      if(/^[A-Z0-9]{6}$/.test(stored))id=stored;
      else localStorage.setItem(storageKey,id);
    }catch{}
    return 'SonicUniverse Windows '+id;
  })();
  function navidromeCheckpoint(){
    const track=currentTrack(),position=getLocalPosition();
    if(track?.provider!=='navidrome'||externalStream||preparedTrackId!==track.id||deferredResume||!playing&&position<=0)return null;
    const prefix=track.mediaId.slice(0,21);
    const items=[];
    let index=-1;
    for(const entry of sessionQueue?.items||[]){
      const song=queueTrackDetails(entry);
      if(song?.provider!=='navidrome'||!song.mediaId.startsWith(prefix))continue;
      if(entry.entryId===sessionQueue.currentId)index=items.length;
      items.push(song.mediaId);
    }
    if(index<0)return {items:[track.mediaId],index:0,position};
    if(items.length>400){
      const start=Math.max(0,index-200);
      return {items:items.slice(start,start+400),index:index-start,position};
    }
    return {items,index,position};
  }
  function navidromeProgress(){
    const live=navidromeCheckpoint();
    if(live)return {...live,name:currentTrack().name,updatedAt:new Date().toISOString(),device:navidromeDevice};
    if(resumePoint?.track?.provider!=='navidrome')return null;
    const saved=resumePoint.queue;
    const tracks=(saved?.entries||[]).map(entry=>findNavidromeResumeTrack(entry.remote)).filter(Boolean);
    const mediaId=resumePoint.track.mediaId;
    const candidate=tracks.findIndex(item=>item.mediaId===mediaId);
    const items=candidate<0?[mediaId]:tracks.map(item=>item.mediaId);
    return {items,index:Math.max(0,candidate),position:resumePoint.position,name:resumePoint.track.name,device:navidromeDevice,
      updatedAt:Number.isFinite(resumePoint.savedAt)?new Date(resumePoint.savedAt).toISOString():null};
  }
  function findNavidromeResumeTrack(track){
    return track?.provider==='navidrome'?SonicOnlineMusic.normalizeTrack(track):null;
  }
  async function syncNavidromeResume(options=4000){
    const checkpoint=options?.checkpoint||(typeof options==='number'?navidromeCheckpoint():navidromeProgress());
    if(!checkpoint)return false;
    const signal=AbortSignal.timeout(typeof options==='number'?options:8500);
    const headers={'Content-Type':'application/json'};
    let revision=options?.revision;
    if(typeof revision!=='string'){
      const response=await fetch('/api/navidrome/resume',{method:'POST',headers,body:'{}',signal});
      if(!response.ok)return false;
      const remote=await response.json();
      if(remote.index>=0&&remote.device!==navidromeDevice)return false;
      revision=remote.revision||'';
    }
    const response=await fetch('/api/navidrome/resume-save',{method:'POST',headers,
      body:JSON.stringify({...checkpoint,revision,device:navidromeDevice}),signal});
    const value=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(value?.error||'无法同步续播。');
    if(value?.conflict)throw new Error('服务器续播点刚刚变了，请重新比较后再选。');
    return value?.saved===true;
  }
  async function playChartList(songs,label,{fullOnly=false}={}){
    if(instrumentOpen||clipLocked())return false;
    const seen=new Set(), items=[];
    for(const song of songs){
      if(!song?.mediaId||!song.name||!song.artist||seen.has(song.mediaId))continue;
      seen.add(song.mediaId);
      const track=safeChartEntry({...song,id:'chart:'+song.mediaId});
      if(track)items.push({...queueItem(track),chart:track});
    }
    if(!items.length)return false;
    cancelOnlinePick();
    if(externalStream||externalPending)stopExternal(undefined,true);
    playbackScope='soda';
    setSessionQueue(items,items[0].entryId,String(label||'热门榜单').slice(0,80),{fullOnly});
    return playQueueFrom(items[0].entryId);
  }
  async function playOnlinePlaylist(playlist,mediaId){
    if(!playlist?.items.length||!requireOnlineLogin())return;
    setOnlineResultStatus('已将「'+playlist.name+'」的 '+playlist.items.length+' 首歌曲加入临时队列。');
    return playOnlineList(playlist.items,playlist.name,mediaId);
  }
  function qishuiMirrorSource(id){
    const match=/^playlist-qishui-(\d{1,30})(?:-(\d{1,30}))?$/.exec(id||'');
    return match?{id:match[1],ownerId:match[2]}:null;
  }
  function reviewMirrorChange(mirror,items){
    const previous=mirror.trackIds.slice(),next=items.map(item=>item.id);
    if(previous.length===next.length&&previous.every((id,index)=>id===next[index]))return Promise.resolve('unchanged');
    const known=new Set(previous),remote=new Set(next),titles=new Map([...tracks,...items].map(item=>[item.id,item.name]));
    const added=next.filter(id=>!known.has(id)),removed=previous.filter(id=>!remote.has(id));
    const before=previous.filter(id=>remote.has(id)),after=next.filter(id=>known.has(id));
    const reordered=after.filter((id,index)=>id!==before[index]);
    const dialog=document.createElement('dialog');dialog.className='lr-dialog';dialog.setAttribute('aria-labelledby','mirrorReviewTitle');
    dialog.innerHTML='<form method="dialog"><div class="lr-dialog-heading"><h2 id="mirrorReviewTitle">预览歌单变化</h2></div><div data-mirror-changes></div><div class="lr-choice-row"><button class="lr-choice" value="">取消</button><button class="lr-choice" value="keep">保留本机编排，只追加新增</button><button class="lr-primary" value="remote">采用远端曲目和顺序</button></div></form>';
    const changes=dialog.querySelector('[data-mirror-changes]');
    for(const [label,ids] of [['新增',added],['远端已移除',removed],['顺序变化',reordered]]){
      const group=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ol');
      summary.textContent=label+' '+ids.length+' 首';group.append(summary);
      for(const id of ids){const item=document.createElement('li');item.textContent=titles.get(id)||id;list.append(item);}
      group.append(list);group.open=ids.length>0&&ids.length<=5;changes.append(group);
    }
    (document.getElementById('listeningRoom')||app).append(dialog);
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>{const choice=dialog.returnValue;dialog.remove();resolve({choice,previous});},{once:true});
      dialog.showModal();
    });
  }
  async function writeQishuiMirror(playlist){
    const id='playlist-qishui-'+playlist.id+(playlist.ownerId?'-'+playlist.ownerId:'');
    const items=[...new Map(normalizeOnlineItems(playlist.items).map(item=>[item.id,item])).values()];
    let mirror=playlists.find(item=>item.id===id);
    let next=items.map(item=>item.id),useRemoteName=true;
    if(mirror){
      const attempt=onlineConnectAttempt,review=await reviewMirrorChange(mirror,items);
      if(review!=='unchanged'){
        if(!review.choice||attempt!==onlineConnectAttempt||!playlists.includes(mirror))return false;
        if(mirror.trackIds.length!==review.previous.length||mirror.trackIds.some((item,index)=>item!==review.previous[index])){
          showToast('歌单在预览期间发生了变化，请重新刷新。',true);return false;
        }
        if(review.choice==='keep'){next=[...new Set([...review.previous,...next])];useRemoteName=false;}
      }
    }
    tracks=SonicOnlineMusic.mergeTracks(tracks,items);
    if(!mirror){mirror={id,name:'',trackIds:[]};playlists.push(mirror)}
    if(useRemoteName)mirror.name=playlist.name.slice(0,32)||'汽水歌单';
    mirror.trackIds=next;
    resetShuffle();
    const saved=await persistLibrary();
    renderPlaylist();
    if(saved)showToast('已同步「'+mirror.name+'」 · '+mirror.trackIds.length+' 首。');
    return saved;
  }
  async function refreshQishuiMirror(id){
    const source=qishuiMirrorSource(id),mirror=playlists.find(item=>item.id===id);
    if(!source||!mirror||!requireOnlineLogin())return false;
    const attempt=onlineConnectAttempt;
    try{
      const data=await onlineClient.playlistAllTracks(source.id,{ownerId:source.ownerId});
      if(attempt!==onlineConnectAttempt||!onlineLoggedIn||!playlists.includes(mirror))return false;
      return await writeQishuiMirror({...source,name:String(data?.playlist?.name||mirror.name),items:data.items});
    }catch(error){if(attempt===onlineConnectAttempt)showToast(onlineRequestFailure(error,attempt),true);return false}
  }
  function renderOnlinePlaylists(items=[]){
    onlinePlaylistCache=Array.isArray(items)?items.filter(item=>item&&/^\d{1,30}$/.test(String(item.id||''))):[];
    const root=$('onlinePlaylists');root.replaceChildren();
    onlinePlaylistCache.forEach(item=>{
      const button=document.createElement('button');button.type='button';button.className='online-playlist-chip';button.dataset.onlinePlaylistId=String(item.id);
      button.textContent=String(item.name||'未命名歌单').slice(0,80)+(Number(item.trackCount)>0?' · '+Number(item.trackCount)+' 首':'');
      button.setAttribute('aria-pressed',String(String(item.id)===onlineCurrentPlaylistId));
      button.title=String(item.description||button.textContent).slice(0,240);
      button.addEventListener('click',()=>void loadOnlinePlaylist(String(item.id),button));
      root.append(button);
    });
    syncOnlineControls();
  }
  async function loadOnlinePlaylist(id,button=null){
    if(onlineProvider!=='qishui'||!requireOnlineLogin())return;
    const attempt=onlineConnectAttempt,generation=beginOnlineViewRequest(),old=button?.textContent||'读取歌单';
    const controller=new AbortController();onlinePlaylistAbort=controller;
    const selected=onlinePlaylistCache.find(item=>String(item.id)===id);
    if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='正在读取…'}
    setOnlineResultStatus('正在读取汽水歌单…');
    $('onlineResults').replaceChildren();
    try{
      const data=await onlineClient.playlistAllTracks(id,{ownerId:selected?.ownerId,signal:controller.signal});
      if(attempt!==onlineConnectAttempt||generation!==onlineSearchGeneration)return;
      const name=String(data?.playlist?.name||selected?.name||'汽水歌单').slice(0,80);
      const owner=String(selected?.ownerId||data?.playlist?.ownerId||'');
      onlinePlaylistView={id,ownerId:/^\d{1,30}$/.test(owner)?owner:undefined,name,items:normalizeOnlineItems(data?.items)};
      onlineCurrentPlaylistId=id;renderOnlinePlaylists(onlinePlaylistCache);
      renderOnlineResults(onlinePlaylistView.items,'这个歌单暂时没有可读取的歌曲。',onlinePlaylistView);
      setOnlineResultStatus('已读取「'+name+'」中的 '+onlinePlaylistView.items.length+' 首歌曲。');
    }catch(error){if(attempt===onlineConnectAttempt&&generation===onlineSearchGeneration)showToast(onlineRequestFailure(error,attempt),true)}
    finally{if(onlinePlaylistAbort===controller)onlinePlaylistAbort=null;if(button){button.removeAttribute('aria-busy');button.textContent=old}syncOnlineControls()}
  }
  async function loadOnlineLiked(){
    if(onlineProvider!=='qishui'||!requireOnlineLogin('请先扫码登录汽水音乐，再读取你的收藏。'))return;
    const attempt=onlineConnectAttempt,generation=beginOnlineViewRequest(),button=$('onlineLikedBtn'),old=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='正在读取收藏…';
    const controller=new AbortController();onlinePlaylistAbort=controller;
    const current=()=>attempt===onlineConnectAttempt&&generation===onlineSearchGeneration&&!controller.signal.aborted;
    renderOnlinePlaylists([]);$('onlineResults').replaceChildren();setOnlineResultStatus('正在读取汽水音乐收藏…');
    try{
      const data=await onlineClient.likedAll({signal:controller.signal,onProgress:({scanned,total})=>{
        if(current())setOnlineResultStatus('正在读取汽水音乐收藏 · '+scanned+' / '+total+' 首');
      }});
      if(!current())return;
      onlinePlaylistView={kind:'liked',name:'我的收藏',items:data.items};
      renderOnlineResults(data.items,'汽水音乐收藏里暂时没有可读取的歌曲。',onlinePlaylistView);
      setOnlineResultStatus('已读取 '+data.items.length+' 首收藏歌曲。'+(data.skipped?' 另有 '+data.skipped+' 首已下架或暂不提供曲目信息。':''));
    }catch(error){
      if(!current())return;
      if(error?.code==='auth-required'||error?.status===401||error instanceof TypeError)showToast(onlineRequestFailure(error,attempt),true);
      else {const message=error?.message||'暂时无法读取汽水音乐收藏。';setOnlineResultStatus(message+' 可再次点击「读取我的收藏」重试。',true);showToast(message,true)}
    }
    finally{if(onlinePlaylistAbort===controller)onlinePlaylistAbort=null;button.removeAttribute('aria-busy');button.textContent=old;syncOnlineControls()}
  }
  async function loadOnlinePlaylists(){
    if(onlineProvider!=='qishui'||!requireOnlineLogin('请先扫码登录汽水音乐，再读取你的歌单。'))return;
    const attempt=onlineConnectAttempt,generation=beginOnlineViewRequest(),button=$('onlinePlaylistsBtn'),old=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='正在读取歌单…';
    setOnlineResultStatus('正在读取你的汽水歌单…');
    try{
      const data=await (onlineClient.playlistsAll?.()||onlineClient.playlists()),items=Array.isArray(data?.items)?data.items:[];
      if(attempt!==onlineConnectAttempt||generation!==onlineSearchGeneration)return;
      renderOnlinePlaylists(items);
      setOnlineResultStatus(items.length?'已读取 '+items.length+' 个汽水歌单，点歌单名称继续读取歌曲。':'这个汽水账号里暂时没有可读取的歌单。',!items.length);
    }catch(error){if(attempt===onlineConnectAttempt&&generation===onlineSearchGeneration)showToast(onlineRequestFailure(error,attempt),true)}
    finally{button.removeAttribute('aria-busy');button.textContent=old;syncOnlineControls()}
  }
  function onlineLoginStateCopy(state){
    if(state==='scanned')return ['已扫码，请在手机确认','汽水音乐已识别这次登录，请在手机上确认授权。'];
    if(state==='confirmed')return ['登录成功','正在读取汽水音乐账号与歌单…'];
    if(state==='expired')return ['二维码已过期','点「扫码登录」重新生成二维码。'];
    if(state==='error')return ['登录服务异常','手机端拒绝了授权，或登录服务暂时不可用，请重新生成二维码。'];
    return ['用汽水音乐 App 扫码','等待扫码。二维码只用于本次授权的账号登录。'];
  }
  async function startOnlineLogin(){
    if(!onlineReady||!onlineClient){showOnlineUnavailable('本机音乐入口没有启动，暂时不能扫码登录。');return}
    hideOnlineLoginCard();
    const generation=onlineLoginGeneration;
    const recovery=playbackRetryAttempt?.phase==='login'?playbackRetryAttempt:null;
    $('onlineLoginCard').hidden=false;$('onlineQrImage').hidden=true;$('onlineQrImage').removeAttribute('src');setOnlineLoginStatus('正在生成二维码','最多等待 8 秒；连接失败后可以直接重试。','pending');
    const button=$('onlineLoginBtn');button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='正在生成…';
    if(recovery)$('onlineLoginCancelBtn').focus();
    try{
      const data=await onlineClient.loginStart();
      const sessionId=String(data?.sessionId||''),qr=String(data?.qrImage||'');
      if(generation!==onlineLoginGeneration){if(sessionId)void onlineClient.loginCancel(sessionId).catch(()=>{});return;}
      onlineLoginSessionId=sessionId;
      if(!sessionId||!qr)throw new Error('登录二维码没有生成，请重试。');
      const expiresAt=Date.now()+120000;
      $('onlineQrImage').hidden=false;$('onlineQrImage').onerror=()=>{if(generation!==onlineLoginGeneration)return;stopOnlineLoginPolling();cancelOnlineLoginSession();$('onlineQrImage').hidden=true;setOnlineLoginStatus('二维码加载失败','点「扫码登录」重新生成二维码。','error')};
      $('onlineQrImage').src=qr;setOnlineLoginStatus('用汽水音乐 App 扫码','二维码已生成。请打开汽水音乐 App 扫描，并在手机上确认。');
      const poll=async()=>{
        if(generation!==onlineLoginGeneration)return;
        if(Date.now()>=expiresAt){setOnlineLoginStatus(...onlineLoginStateCopy('expired'),'expired');stopOnlineLoginPolling();cancelOnlineLoginSession();return}
        try{
          const result=await onlineClient.loginCheck(sessionId);
          if(generation!==onlineLoginGeneration)return;
          const state=String(result?.state||'waiting'),[title,status]=onlineLoginStateCopy(state);setOnlineLoginStatus(title,status,state);
          if(state==='confirmed'){
            onlineLoginSessionId=null;
            const authorizedGeneration=++onlineLoginGeneration;
            if(onlineLoginPoll)clearTimeout(onlineLoginPoll);onlineLoginPoll=0;
            await refreshOnlineAccount(result?.user||null);
            if(authorizedGeneration!==onlineLoginGeneration)return;
            if(recovery&&onlineLoggedIn&&$('queueDialog').open&&playbackRetryIsCurrent(recovery)){
              recovery.phase='resuming';
              $('queueDialog').close();
              await resumePlaybackRetry(recovery);
              return;
            }
            if(recovery)clearPlaybackRetry(recovery);
            void loadOnlinePlaylists();
            setTimeout(()=>{if(authorizedGeneration===onlineLoginGeneration&&onlineLoggedIn)$('onlineLoginCard').hidden=true},1200);
            showToast('汽水音乐登录成功，收藏和歌单已经可用。');return;
          }
          if(state==='expired'||state==='error'){stopOnlineLoginPolling();cancelOnlineLoginSession();return}
        }catch(error){
          if(generation!==onlineLoginGeneration)return;
          setOnlineLoginStatus('登录连接已中断',onlineRequestFailure(error),'error');stopOnlineLoginPolling();cancelOnlineLoginSession();return;
        }
        if(generation===onlineLoginGeneration)onlineLoginPoll=setTimeout(poll,1800);
      };
      onlineLoginPoll=setTimeout(poll,1800);
    }catch(error){
      if(generation===onlineLoginGeneration){
        cancelOnlineLoginSession();
        setOnlineLoginStatus('二维码生成失败',onlineRequestFailure(error),'error');
        if(!onlineReady)showOnlineUnavailable('登录请求没有完成，本机音乐入口可能已经断开。');
      }
    }
    finally{if(generation===onlineLoginGeneration){button.removeAttribute('aria-busy');button.textContent='扫码登录';syncOnlineControls()}}
  }
  function connectOnlineMusic(){
    onlineConnection ||= refreshOnlineConnection().finally(()=>{onlineConnection=null;});
    return onlineConnection;
  }
  async function refreshOnlineConnection(){
    const attempt=++onlineConnectAttempt;beginOnlineViewRequest();hideOnlineLoginCard();
    onlineResultAvailability.clear();window.SonicMusicDiscovery?.invalidateDaily();
    setOnlineServiceState('pending','正在连接本机音乐入口','最多等待 7 秒，星空和本地音乐可以继续使用。');
    setOnlineResultStatus('正在检查 Companion；连接结果会在 7 秒内显示。');
    try{
      const available=await onlineClient?.detect();
      if(attempt!==onlineConnectAttempt)return;
      if(!available){
        setOnlineAccount(null);
        const state=onlineClient?.detectionState==='timeout'?'timeout':'offline';
        setOnlineServiceState(state,'连不上，点「重新连接」再试','请先双击「启动音乐入口.cmd」。公开网页的星空和本地音乐仍可使用。');
        showOnlineUnavailable('本机 Companion 没有响应。');return;
      }
      setOnlineServiceState('ready','本机音乐入口已连接','可搜索汽水、网易云、QQ 音乐和酷狗。登录汽水后可播放其提供的歌曲。');
      syncOnlineProvider();
      setOnlineResultStatus(onlineProvider==='qishui'?(onlineClient.qishuiAvailable===false?qishuiDisabledMessage:'入口已连接。可不登录搜索汽水公开歌曲，登录后可读取收藏、歌单与歌词。'):'入口已连接。输入歌名或歌手，搜索'+onlineProviderName()+'。');
      renderActiveTrack();renderPlaylist();
      await refreshOnlineAccount();
    }catch(error){
      if(attempt!==onlineConnectAttempt)return;
      setOnlineServiceState('error','连接失败，点「重新连接」再试',onlineErrorMessage(error));
      showOnlineUnavailable('音乐入口检测没有完成。');
    }finally{
      if(attempt===onlineConnectAttempt)syncOnlineControls();
    }
  }
  async function searchQishui(query,{signal}={}){
    const keyword=typeof query==='string'?query.trim().slice(0,100):'';
    const cancelled={status:'cancelled',items:[]};
    if(signal?.aborted)return cancelled;
    if(!keyword)return {status:'ok',items:[]};
    if(!onlineReady&&onlineClient){
      const connecting=connectOnlineMusic();
      if(signal){
        let abort;
        const cancelledWait=new Promise(resolve=>{
          abort=resolve;
          signal.addEventListener('abort',abort,{once:true});
          if(signal.aborted)abort();
        });
        try{await Promise.race([connecting,cancelledWait]);}
        finally{signal.removeEventListener('abort',abort);}
      }else await connecting;
    }
    if(signal?.aborted)return cancelled;
    if(!onlineReady){
      const timedOut=onlineClient?.detectionState==='timeout';
      return timedOut?{status:'timeout',items:[],message:'连接汽水音乐超时，请重试。'}
        :{status:'unavailable',items:[],message:'暂时连不上汽水音乐，请重试。'};
    }
    try{
      if(onlineClient.qishuiAvailable===false)return {status:'error',items:[],message:qishuiDisabledMessage};
      const data=await onlineClient.searchByProvider('qishui',keyword,{signal});
      if(signal?.aborted)return cancelled;
      const seen=new Set(),items=[];
      for(const track of normalizeOnlineItems(data?.items)){
        if(seen.has(track.id))continue;
        seen.add(track.id);
        const {id,provider,mediaId,name,artist,album,duration}=track;
        const availability=onlineResultAvailability.get(mediaId)||(track.preview?'preview':'unknown');
        items.push({id,provider,mediaId,name,artist,album,duration,preview:availability==='preview',availability});
      }
      return {status:'ok',items};
    }catch(error){
      if(signal?.aborted||error?.name==='AbortError')return cancelled;
      if(error?.code==='timeout'||error?.status===408||error?.status===504)return {status:'timeout',items:[],message:'汽水音乐搜索超时，请重试。'};
      if(playbackFailureReason(error)||error?.status>=500)return {status:'unavailable',items:[],message:'暂时无法搜索汽水音乐，请重试。'};
      return {status:'error',items:[],message:'汽水音乐搜索失败，请重试。'};
    }
  }
  function onlineSearchPlaceholder(message){
    const empty=document.createElement('div');
    empty.className='online-empty';empty.textContent=message;
    $('onlineResults').replaceChildren(empty);
  }
  async function runOnlineSearch(){
    const input=$('onlineSearchInput'),query=input.value.trim();
    if(!query){input.focus();return;}
    if(!onlineReady){showOnlineUnavailable('本机音乐入口没有连接，暂时无法搜索。');return;}
    const attempt=onlineConnectAttempt,generation=beginOnlineViewRequest(),provider=onlineProvider,providerName=onlineProviderName();
    const controller=new AbortController(),{signal}=controller,button=$('onlineSearchBtn');
    onlineSearchAbort=controller;
    const current=()=>!signal.aborted&&attempt===onlineConnectAttempt&&generation===onlineSearchGeneration&&$('queueDialog').open&&libraryView==='soda';
    button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='正在搜索…';
    setOnlineResultStatus('正在'+providerName+'中搜索「'+query+'」…');
    renderOnlinePlaylists([]);
    onlineSearchPlaceholder('正在读取结果…');
    try{
      const data=await onlineClient.searchByProvider(provider,query,{signal});
      if(!current())return;
      const items=provider==='qishui'?SonicOnlineMusic.rankSearchTracks(normalizeOnlineItems(data?.items),query):externalOnlineItems(data?.items,provider);
      onlineSearchView={provider,query,items};
      if(provider==='qishui')renderOnlineResults(items,'没有找到相关歌曲，换一个歌名或歌手试试。');
      else renderExternalOnlineResults(items,provider);
      setOnlineResultStatus('找到 '+items.length+' 首与「'+query+'」相关的歌曲。'+
        (provider==='qishui'?'':'可匹配汽水版本在应用内播放，或打开'+providerName+'。'));
    }catch(error){
      if(!current())return;
      onlineSearchPlaceholder('搜索未完成，可以重试。');
      if(provider==='qishui')showToast(onlineRequestFailure(error,attempt),true);
      else{
        const message=error?.status===404?'本机音乐入口版本较旧，还没有'+providerName+'搜索。请更新项目、重新双击「启动音乐入口.cmd」，再点「重新连接」。':error?.code==='timeout'?providerName+'搜索超时，请重新点击搜索；也可以切换到其他平台。':providerName+'暂时搜不到：'+(error?.message||'连接失败')+' 请重新点击搜索，或切换其他平台。';
        setOnlineResultStatus(message,true);showToast(message,true);
      }
    }finally{
      if(onlineSearchAbort===controller)onlineSearchAbort=null;
      if(generation===onlineSearchGeneration){button.removeAttribute('aria-busy');syncOnlineProvider();syncOnlineControls();}
    }
  }
  async function playCurrentOnlineSearch(){
    const view=onlineSearchView;
    if(!view?.items.length)return;
    const badges=new Map([...$('onlineResults').querySelectorAll('[data-search-media-id]')].map(card=>
      [card.dataset.searchMediaId,card.querySelector('.online-result-badge')?.dataset.state]));
    let previews=0,external=0;
    const ordered=view.items.filter(track=>{
      const status=badges.get(track.mediaId);
      if(status==='preview'||track.preview){previews++;return false;}
      if(status==='official'||view.provider!=='qishui'&&(!track.artist||!track.duration)){external++;return false;}
      return true;
    });
    const omitted=[previews&&previews+' 首仅试听',external&&external+' 首需前往原平台或手选汽水版本'].filter(Boolean);
    const suffix=omitted.length?'已排除'+omitted.join('、')+'。':'';
    if(!ordered.length){setOnlineResultStatus('没有可顺序播放的候选歌曲。'+suffix);return;}
    const title=onlineProviderNames[view.provider]+'搜索 · '+view.query;
    const button=$('onlinePlaySearchResultsBtn');
    button.setAttribute('aria-busy','true');syncOnlineControls();
    setOnlineResultStatus('按搜索结果顺序尝试 '+ordered.length+' 首歌曲。'+suffix);
    try{
      if(view.provider==='qishui')await playOnlineList(ordered,title,undefined,{fullOnly:true});
      else await playChartList(ordered,title,{fullOnly:true});
    }finally{button.removeAttribute('aria-busy');syncOnlineControls();}
  }
  let onlineSearchOpener=null;
  function setOnlineSearchPresentation(searchOnly){
    const dialog=$('queueDialog');
    dialog.toggleAttribute('data-search-only',searchOnly);
    dialog.querySelector('[data-legacy-queue-heading]').hidden=searchOnly;
    $('onlineSearchHeading').hidden=!searchOnly;
    $('onlineBackToLocalBtn').hidden=!searchOnly;
    dialog.setAttribute('aria-labelledby',searchOnly?'onlineSearchHeading':'queueHeading');
  }
  function setupOnlineMusic(){
    const baseUrls=globalThis.SonicOnlineMusic?.companionBaseUrls(location)||[''];
    onlineClient=globalThis.SonicOnlineMusic?.createClient({baseUrls,timeoutMs:7500})||null;
    $('onlineReconnectBtn').addEventListener('click',()=>void connectOnlineMusic());
    document.querySelectorAll('[data-online-provider]').forEach(button=>button.addEventListener('click',()=>setOnlineProvider(button.dataset.onlineProvider)));
    $('onlineExternalLinkBtn').addEventListener('click',()=>{if($('queueDialog').open)$('queueDialog').close();updateExternalUI();openSpaceDialog('externalDialog')});
    const searchForm=$('onlineSearchForm'),playSearch=document.createElement('button');
    playSearch.type='button';playSearch.id='onlinePlaySearchResultsBtn';playSearch.className='primary-btn';
    playSearch.hidden=true;playSearch.textContent='顺序播放搜索结果';
    playSearch.addEventListener('click',()=>void playCurrentOnlineSearch().catch(error=>showToast(error.message,true)));
    $('onlinePlayPlaylistBtn').after(playSearch);
    const localSearch=document.createElement('button');
    localSearch.type='button';localSearch.className='secondary-btn';
    localSearch.hidden=true;localSearch.id='onlineSearchLibraryBtn';localSearch.textContent='搜本地';
    const searchLocal=()=>{
      const query=$('onlineSearchInput').value.trim();
      const dialog=$('queueDialog'),searchOnly=dialog.hasAttribute('data-search-only');
      dialog.close();
      window.dispatchEvent(new CustomEvent('sonic:library-search',{detail:{query,searchOnly}}));
    };
    localSearch.addEventListener('click',searchLocal);
    $('onlineBackToLocalBtn').addEventListener('click',searchLocal);
    searchForm.append(localSearch);
    searchForm.addEventListener('submit',event=>{event.preventDefault();void runOnlineSearch();});
    const clearSearch=()=>{
      if(!onlineSearchAbort&&!onlineSearchView)return;
      beginOnlineViewRequest();
      onlineSearchPlaceholder('输入关键词后，搜索当前音乐平台。');
      setOnlineResultStatus('');
    };
    $('onlineSearchInput').addEventListener('input',clearSearch);
    $('onlineSearchClearBtn').addEventListener('click',()=>{
      const input=$('onlineSearchInput');
      input.value='';clearSearch();input.focus();
    });
    $('queueDialog').addEventListener('cancel',event=>{
      if(!onlineSearchOpener)return;
      event.preventDefault();
      const opener=onlineSearchOpener;
      onlineSearchOpener=null;
      $('queueDialog').close();
      opener.focus({preventScroll:true});
    });
    $('queueDialog').addEventListener('close',()=>{
      if($('queueDialog').open)return;
      onlineSearchOpener=null;
      setOnlineSearchPresentation(false);
      clearSearch();
      if(playbackRetryAttempt?.phase==='login')clearPlaybackRetry(playbackRetryAttempt);
      if(!$('onlineLoginCard').hidden)hideOnlineLoginCard();
    });
    document.querySelectorAll('button[data-library-view]').forEach(button=>{
      if(button.dataset.libraryView!=='soda')button.addEventListener('click',clearSearch);
    });
    $('onlineLoginBtn').addEventListener('click',()=>void startOnlineLogin());
    $('onlineLoginCancelBtn').addEventListener('click',()=>{
      const closeRecovery=playbackRetryAttempt?.phase==='login';
      if(closeRecovery)clearPlaybackRetry(playbackRetryAttempt);
      hideOnlineLoginCard();setOnlineLoginStatus('已取消扫码登录','需要时点「扫码登录」重新开始。','cancelled');
      setOnlineResultStatus('已取消本次扫码登录，账号状态没有改变。');syncOnlineControls();
      if(closeRecovery&&$('queueDialog').open)$('queueDialog').close();
    });
    $('onlineLocalEntryBtn').addEventListener('click',()=>{const url=localOnlineEntryUrl();const opened=window.open(url,'_blank','noopener');if(!opened)location.href=url});
    $('onlineLogoutBtn').addEventListener('click',async()=>{
      if(!onlineReady)return;hideOnlineLoginCard();const attempt=onlineConnectAttempt,button=$('onlineLogoutBtn');button.disabled=true;button.setAttribute('aria-busy','true');
      try{await onlineClient.logout();if(attempt!==onlineConnectAttempt)return;beginOnlineViewRequest();setOnlineAccount(null);renderOnlinePlaylists([]);setOnlineResultStatus('已退出汽水音乐账号，本机曲库不受影响。');showToast('已退出汽水音乐账号。')}
      catch(error){if(attempt===onlineConnectAttempt)showToast(onlineRequestFailure(error,attempt),true)}
      finally{button.removeAttribute('aria-busy');syncOnlineControls()}
    });
    $('onlineLikedBtn').addEventListener('click',()=>void loadOnlineLiked());
    $('onlinePlaylistsBtn').addEventListener('click',()=>void loadOnlinePlaylists());
    $('onlinePlayPlaylistBtn').addEventListener('click',()=>{
      const button=$('onlinePlayPlaylistBtn');button.setAttribute('aria-busy','true');syncOnlineControls();
      playOnlinePlaylist(onlinePlaylistView).finally(()=>{button.removeAttribute('aria-busy');syncOnlineControls()});
    });
    $('onlineSyncPlaylistBtn').addEventListener('click',()=>{
      if(!onlinePlaylistView?.id||!requireOnlineLogin())return;
      const button=$('onlineSyncPlaylistBtn');button.setAttribute('aria-busy','true');syncOnlineControls();
      writeQishuiMirror(onlinePlaylistView).finally(()=>{button.removeAttribute('aria-busy');syncOnlineControls()});
    });
    $('onlineLyricClose').addEventListener('click',()=>{onlineLyricDismissed=true;$('onlineLyrics').hidden=true});
    window.addEventListener('pagehide',hideOnlineLoginCard);
    syncOnlineProvider();syncOnlineControls();
    void connectOnlineMusic();
  }

  function stopStream(stream){stream?.getTracks().forEach(track=>track.stop())}
  function setExternalStatus(message,error=false){$('externalStatus').textContent=message;$('externalStatus').classList.toggle('error',error)}
  function updateExternalUI(){
    const live=Boolean(externalStream),supported=Boolean(navigator.mediaDevices?.getDisplayMedia)&&window.isSecureContext;
    $('externalDialog').dataset.state=live?'live':externalPending?'pending':'idle';app.dataset.externalState=live?'live':externalPending?'pending':'idle';
    $('externalBtn').classList.toggle('connected',live);$('externalBtn').setAttribute('aria-label',live?'管理外部音乐联动':'外部音乐联动');
    $('connectExternalBtn').hidden=live;$('connectExternalBtn').disabled=!supported||!libraryReady||Boolean(pendingFile)||busy;
    $('connectExternalBtn').textContent=externalPending?'取消本次接入':supported?'选择声音来源 ↗':'当前环境无法共享声音';
    $('stopExternalBtn').hidden=!live;$('externalExploreBtn').hidden=!live;$('sourceRibbon').classList.toggle('visible',live);
    $('externalStateTitle').textContent=live?'外界的声音，正在成为星光':externalPending?'在浏览器弹窗中选择声音来源':'等待一束来自外界的声音';
    if(!live)$('externalSignal').textContent=externalPending?'选择带音频的来源，并开启共享音频。':supported?'选择声音来源，让它成为星河。':'请在桌面版 Chrome 或 Edge 中通过 HTTPS 或本机预览地址打开作品，再选择共享音频。';
    for(const id of ['restartBtn','forwardBtn','roamPrevBtn','roamNextBtn','repeatBtn','volume','muteBtn']){$(id).disabled=live;$(id).title=live?'请在原播放器操作':''}
    const hint=document.querySelector('.keyboard-hint');hint.textContent=live?'LIVE · 在原播放器控制音乐':'SPACE 播放 / 暂停';hint.classList.toggle('external',live);
    if(!live)updatePlaybackMode();setExternalHealth(live&&externalHealth!=='ended'?externalHealth:externalPending?'waiting':externalHealth==='ended'?'ended':'waiting');
  }
  function stopExternal(message='已停止联动。本地歌曲仍停在原来的位置。',silent=false){
    const wasConnected=Boolean(externalStream||externalPending);++externalGeneration;externalPending=false;
    const stream=externalStream;externalStream=null;
    externalPlayback?.setActive(false);
    if(externalNode){externalNode.disconnect();externalNode=null}if(externalAnalyser){externalAnalyser.disconnect();externalAnalyser=null}if(externalSink){externalSink.disconnect();externalSink=null}
    externalBeatAnalyser=null;
    stopStream(stream);externalStartedAt=0;externalSilentSince=0;
    if(silent)return;
    if(wasConnected)externalHealth='ended';updateExternalUI();renderActiveTrack();updatePlaying();updateTimeline();setExternalStatus(message);saveSession();
  }
  async function connectExternal(){if(instrumentOpen){showToast("请先关闭乐器台，再接入外部声音。");return}
    if(clipLocked()){showToast('请先结束本地音乐短片录制。');return}
    if(externalPending){stopExternal('本次接入已取消。若浏览器弹窗仍打开，可以直接关闭；迟到的共享会自动释放。');return}
    if(externalStream||!libraryReady||pendingFile||busy)return;
    if(!navigator.mediaDevices?.getDisplayMedia||!window.isSecureContext){setExternalStatus('当前环境不支持声音共享，请在 Chrome 或 Edge 打开本机地址。',true);return}
    cancelOnlinePick();
    const token=++externalGeneration;externalPending=true;updateExternalUI();setExternalStatus('请选择带声音的来源，并勾选「共享音频」。取消选择会保留当前播放。');
    let stream=null;
    try{
      // Call inside the click gesture; the user chooses the sharing source in browser UI.
      stream=await navigator.mediaDevices.getDisplayMedia({
        video:window.sonicDesktop?{frameRate:{max:1}}:true,
        audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},
        systemAudio:'include',selfBrowserSurface:window.sonicDesktop?'include':'exclude',
      });
      if(token!==externalGeneration){stopStream(stream);return}
      const audioTracks=stream.getAudioTracks().filter(track=>track.readyState==='live');
      if(!audioTracks.length)throw new Error('这个来源没有共享声音。请重新选择带音频的标签页，或尝试整个屏幕并开启系统音频。');
      initAudio();await audioContext.resume();
      if(token!==externalGeneration){stopStream(stream);return}
      if(!audioTracks.some(track=>track.readyState==='live')||stream.getVideoTracks().some(track=>track.readyState!=='live'))throw new Error('共享已经结束，请重新选择声音来源。');
      if(window.sonicDesktop){const captured=stream;stream=new MediaStream(audioTracks);captured.getVideoTracks().forEach(track=>track.stop());}
      // Dedicated analyser with a silent output: captured audio never returns to speakers.
      const analysis=audioContext.createAnalyser();analysis.fftSize=2048;analysis.smoothingTimeConstant=.62;analysis.minDecibels=-90;analysis.maxDecibels=-15;
      const sink=audioContext.createGain();sink.gain.value=0;
      const node=audioContext.createMediaStreamSource(new MediaStream(audioTracks));node.connect(analysis);analysis.connect(sink);sink.connect(audioContext.destination);
      const beatAnalysis=createBeatAnalysisTap(analysis);node.connect(beatAnalysis);
      pause();externalNode=node;externalAnalyser=analysis;externalBeatAnalyser=beatAnalysis;externalSink=sink;externalStream=stream;externalStartedAt=performance.now();externalPending=false;
      externalPlayback?.setActive(true);
      const ended=()=>{if(externalStream===stream)stopExternal('共享已由浏览器或原来源结束。本地歌曲仍停在原来的位置。')};
      stream.getTracks().forEach(track=>{track.addEventListener('ended',ended,{once:true});track.addEventListener('mute',()=>{if(externalStream===stream)setExternalStatus('来源暂时没有提供声音，请检查原播放器与共享音频设置。')})});
      updateExternalUI();renderActiveTrack();updatePlaying();updateTimeline();setExternalStatus('联动已开启。切歌、暂停和音量请在原播放器操作；停止联动后可继续本地歌曲。');showToast('外部声音已接入，让星空跟着旋律流动。');
    }catch(error){
      stopStream(stream);if(token!==externalGeneration)return;externalPending=false;updateExternalUI();
      const message=error.name==='NotAllowedError'||error.name==='AbortError'?'未开始共享。可以再次选择声音来源，当前本地播放继续。':error.name==='NotSupportedError'?'当前浏览器不支持这个来源的声音共享。请换用 Chrome 或 Edge，选择带音频的来源。':error.message||'未能接入声音，请重新选择带音频的来源。';
      setExternalStatus(message,true);setExternalHealth(error.name==='NotAllowedError'||error.name==='AbortError'?'waiting':'ended');
    }
  }
  function updateExternalSignal(now){
    if(!externalStream)return;
    externalPlayback?.poll();
    const muted=externalStream.getAudioTracks().every(t=>t.muted||t.readyState!=='live')||audioContext?.state!=='running';
    if(rawRms>.003&&!muted){externalSilentSince=0;$('externalSignal').textContent='正在接收声音 · 实时驱动星空';app.dataset.externalSignal='sound';setExternalHealth('sound')}
    else{if(!externalSilentSince)externalSilentSince=now;const silent=muted||now-externalSilentSince>4000;$('externalSignal').textContent=silent?'暂未检测到声音 · 检查原播放器和共享音频':'正在聆听 · 等待旋律抵达';app.dataset.externalSignal=silent?'silent':'waiting';setExternalHealth(silent?'silent':'waiting')}
  }
  function setupExternalFive(){
    for(const id of ['externalBtn','sourceManageBtn'])$(id).addEventListener('click',()=>{updateExternalUI();openSpaceDialog('externalDialog')});
    $('connectExternalBtn').addEventListener('click',connectExternal);$('stopExternalBtn').addEventListener('click',()=>stopExternal());
    $('externalExploreBtn').addEventListener('click',()=>{$('externalDialog').close();setQuiet(true)});
    $('externalDialog').addEventListener('close',()=>{if(externalPending)stopExternal('已取消本次接入。迟到的共享会自动释放。')});
    updateExternalUI();
  }

  let randState=104729;
  function rand(){randState=(randState*16807)%2147483647;return(randState-1)/2147483646}
  function rgba(c,a){return `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`}
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  function formatTime(v){v=Math.max(0,Number.isFinite(v)?v:0);return `${String(Math.floor(v/60)).padStart(2,'0')}:${String(Math.floor(v%60)).padStart(2,'0')}`}
  function showToast(message,error=false,playNew=false,importResult=false){
    if(listeningPresentation&&window.SonicListeningRoom){
      window.dispatchEvent(new CustomEvent('sonic:toast',{detail:{message,error,playNew,importResult}}));return;
    }
    clearTimeout(toastTimer);const el=$('toast');el.textContent=message;el.setAttribute('role',error?'alert':'status');el.classList.add('visible');toastTimer=setTimeout(()=>el.classList.remove('visible'),4400);
  }
  function setFill(el){const v=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--fill',v+'%')}
  function savePreferences(){if(backupRestoring)return;
    try{localStorage.setItem('sonic-universe-preferences',JSON.stringify({preferencesVersion:2,theme:themeKey,volume,lastVolume,intensity,repeat,visualMode,particleCount,motionSpeed,energySaver,playbackMode,space,storyEnabled,journeyAuto,postcardAuthor,postcardStyle,visualEffects,refinement:{...refinement}}));storageIssues.delete('preferences')}
    catch{const first=!storageIssues.has('preferences');storageIssues.add('preferences');if(first)showToast('设置未能保存，当前浏览器可能限制了本机存储。',true)}
    updateStorageStatus();
  }
  function setVisualMode(key,announce=true){
    if(!visualModes[key])return;
    void loadNebulaAsset(key);
    if(announce){journeyAuto=false;updateJourneyToggle()}
    if(visualMode!==key){previousMode=visualMode;modeOpacity=reduced?1:0;visualMode=key}
    document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===key)));
    const info=visualModes[key];$('sceneName').textContent=info.english;$('sceneNumber').textContent=info.number;
    canvas.setAttribute('aria-label',info.name+'：'+info.description);app.dataset.visualMode=key;
    if(announce){$('modeAnnouncement').textContent='已切换至'+info.name+'。'+info.description;savePreferences()}
  }
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>setVisualMode(button.dataset.mode)));
  function updateVisualControls(){
    $('particleCount').value=particleCount;$('particleCountValue').value=particleCount.toLocaleString('en-US');
    $('particleCount').setAttribute('aria-valuetext',particleCount+' 颗粒子');setFill($('particleCount'));
    $('motionSpeed').value=Math.round(motionSpeed*100);$('motionSpeedValue').value=motionSpeed.toFixed(2)+'×';
    $('motionSpeed').setAttribute('aria-valuetext',motionSpeed.toFixed(2)+' 倍');setFill($('motionSpeed'));
  }
  $('particleCount').addEventListener('input',()=>{particleCount=Number($('particleCount').value);rebuildParticles();updateVisualControls();savePreferences()});
  $('motionSpeed').addEventListener('input',()=>{motionSpeed=Number($('motionSpeed').value)/100;updateVisualControls();savePreferences()});
  function setTheme(key,announce=true){
    if(!themes[key])return;if(themeKey!==key){preservePaletteOrigin();previousTheme=themeKey;cloudBlend=0}themeKey=key;targetPalette=themes[key];
    document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===key)));
    $('themeCount').textContent=`0${targetPalette.index} / 03`;
    if(announce){savePreferences();showToast('已进入'+targetPalette.name)}
  }
  document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>setTheme(b.dataset.theme)));
  $('intensity').addEventListener('input',()=>{intensity=Number($('intensity').value)/100;$('intensityValue').value=Math.round(intensity*100)+'%';setFill($('intensity'));savePreferences()});
  try{const prefs=JSON.parse(localStorage.getItem('sonic-universe-preferences')||'null');if(prefs){if(themes[prefs.theme])setTheme(prefs.theme,false);if(Number.isFinite(prefs.volume))volume=clamp(prefs.volume,0,1);if(volume>0)lastVolume=volume;else if(Number.isFinite(prefs.lastVolume)&&prefs.lastVolume>0)lastVolume=clamp(prefs.lastVolume,0,1);if(Number.isFinite(prefs.intensity))intensity=clamp(prefs.intensity,.2,1);if(typeof prefs.repeat==='boolean')repeat=prefs.repeat}}catch{}
  palette={...targetPalette,core:[...targetPalette.core],second:[...targetPalette.second],shadow:[...targetPalette.shadow],cool:[...targetPalette.cool],hot:[...targetPalette.hot],ui:[...targetPalette.ui]};
  try{const prefs=JSON.parse(localStorage.getItem('sonic-universe-preferences')||'null');if(prefs){if(prefs.visualEffects){const savedResponse=['soft','balanced','strong'].includes(prefs.visualEffects.response)?prefs.visualEffects.response:refinement.profile,legacyTrail=prefs.preferencesVersion!==2&&finite(prefs.visualEffects.trail,-1)===0;visualEffects={depth:finite(prefs.visualEffects.depth,.65,0,1),glow:finite(prefs.visualEffects.glow,.6,0,1),trail:legacyTrail?.55:finite(prefs.visualEffects.trail,.55,0,1),response:savedResponse,beat:prefs.visualEffects.beat===true}}if(visualModes[prefs.visualMode])visualMode=prefs.visualMode;if(Number.isFinite(prefs.particleCount))particleCount=Math.round(clamp(prefs.particleCount,400,6000)/200)*200;if(Number.isFinite(prefs.motionSpeed))motionSpeed=clamp(prefs.motionSpeed,.25,2);if(prefs.preferencesVersion!==2)localStorage.setItem('sonic-universe-preferences',JSON.stringify({...prefs,preferencesVersion:2,visualEffects}))}}catch{}
  try{const prefs=JSON.parse(localStorage.getItem('sonic-universe-preferences')||'null');if(typeof prefs?.energySaver==='boolean'){energySaver=prefs.energySaver;energyUserChoice=true}const shared=SonicVisualSystem.parseShare(location.search,captureLook());if(new URLSearchParams(location.search).has('energySaver')){energySaver=shared.look.energySaver;energyUserChoice=true}}catch{}
  setVisualMode(visualMode,false);updateVisualControls();loadNebulaAssets();
  $('volume').value=Math.round(volume*100);$('intensity').value=Math.round(intensity*100);$('intensityValue').value=Math.round(intensity*100)+'%';setFill($('volume'));setFill($('intensity'));

  function createBeatAnalysisTap(source){
    const tap=audioContext.createAnalyser();
    tap.fftSize=source.fftSize;tap.minDecibels=source.minDecibels;tap.maxDecibels=source.maxDecibels;
    tap.smoothingTimeConstant=.12;
    return tap;
  }
  // 音量滑块走感知曲线；没有音频调音模块时退回线性，保证旧环境仍能出声。
  function masterGainFor(value){return window.SonicAudioTuning?.perceptualGain?window.SonicAudioTuning.perceptualGain(value):value}
  // 响度补偿：导入/首次播放时测一次，按 ±9dB 拉平不同音源的响度差。
  function loudnessStore(){
    if(!loudnessCache.size){
      try{
        const saved=JSON.parse(localStorage.getItem(LOUDNESS_KEY)||'{}');
        for(const [id,db] of Object.entries(saved))if(Number.isFinite(db))loudnessCache.set(id,db);
      }catch{}
    }
    return loudnessCache;
  }
  function persistLoudness(){
    try{localStorage.setItem(LOUDNESS_KEY,JSON.stringify(Object.fromEntries(loudnessCache)))}catch{}
  }
  function applyLoudnessGain(db){
    if(!normGain||!audioContext)return;
    const value=window.SonicAudioTuning?.gainOfDb?window.SonicAudioTuning.gainOfDb(db):Math.pow(10,(Number.isFinite(db)?db:0)/20);
    const now=audioContext.currentTime;
    normGain.gain.cancelScheduledValues(now);
    normGain.gain.setTargetAtTime(value,now,.25);
  }
  function syncLoudness(track){
    const db=loudnessStore().get(track?.id);
    applyLoudnessGain(Number.isFinite(db)?db:0);
  }
  async function measureLoudness(track,url){
    if(!track||!url||!window.SonicAudioLoudness||loudnessStore().has(track.id)||loudnessMeasuring.has(track.id))return;
    loudnessMeasuring.add(track.id);
    try{
      const response=await fetch(url);
      const buffer=await response.arrayBuffer();
      if(buffer.byteLength>120*1024*1024)return;
      const decoded=await audioContext.decodeAudioData(buffer.slice(0));
      const channels=[];
      for(let c=0;c<Math.min(2,decoded.numberOfChannels);c++)channels.push(decoded.getChannelData(c));
      const loudness=window.SonicAudioLoudness.estimateLoudnessDb(channels,decoded.sampleRate);
      const peak=window.SonicAudioLoudness.peakOf(channels);
      // 目标 -16 dBFS（近似响度），提升幅度同时受峰值余量限制，避免削波。
      const wanted=window.SonicAudioLoudness.gainForLoudness(loudness,-16,6,9);
      const headroom=peak>1e-6?20*Math.log10(.95/peak):wanted;
      const gain=Math.min(wanted,headroom);
      loudnessCache.set(track.id,gain);persistLoudness();
      if(track.id===activeId)applyLoudnessGain(gain);
    }catch{}
    finally{loudnessMeasuring.delete(track.id)}
  }
  function scheduleLoudness(track,url){
    const gain=loudnessStore().get(track?.id);
    if(Number.isFinite(gain)){applyLoudnessGain(gain);return}
    applyLoudnessGain(0);
    if(mode==='online')return;
    setTimeout(()=>measureLoudness(track,url),1500);
  }
  function initAudio(){
    if(audioContext)return;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)throw new Error('这个浏览器暂不支持音频分析，请使用新版 Chrome、Edge 或 Safari。');
    audioContext=new AC();analyser=audioContext.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.62;analyser.minDecibels=-90;analyser.maxDecibels=-15;
    trackGain=audioContext.createGain();
    normGain=audioContext.createGain();normGain.gain.value=1;
    const tone=window.SonicEqualizer?.create(audioContext);
    if(tone){trackGain.connect(tone.input);tone.output.connect(normGain)}
    else trackGain.connect(normGain);
    normGain.connect(analyser);
    masterGain=audioContext.createGain();masterGain.gain.value=masterGainFor(volume);analyser.connect(masterGain);masterGain.connect(audioContext.destination);
    beatAnalyser=createBeatAnalysisTap(analyser);
    freqData=new Uint8Array(analyser.frequencyBinCount);timeData=new Uint8Array(analyser.fftSize);
    beatFrequencyData=new Uint8Array(beatAnalyser.frequencyBinCount);beatTimeData=new Float32Array(beatAnalyser.fftSize);
    mediaNode=audioContext.createMediaElementSource(audio);mediaNode.connect(trackGain);mediaNode.connect(beatAnalyser);
  }
  function buildDemo(track){
    if(demoBuffers.has(track.id))return demoBuffers.get(track.id);
    if(demoBuilds.has(track.id))return demoBuilds.get(track.id);
    const build=decodeDemo(track).then(buffer=>{demoBuffers.set(track.id,buffer);return buffer})
      .finally(()=>demoBuilds.delete(track.id));
    demoBuilds.set(track.id,build);
    return build;
  }
  async function decodeDemo(track){
    const isSample=track.id===bundledSample.id;
    const asset=demoSrcFor(track);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      app.dataset.demoAudio='loading';
      const response=await fetch(await resolveSharedAsset(asset),{signal:controller.signal});
      if(!response.ok)throw new Error('Missing demo audio');
      const buffer=await audioContext.decodeAudioData(await response.arrayBuffer());
      if(Math.abs(buffer.duration-(isSample?bundledSample.duration:96))>.25||buffer.numberOfChannels!==2)throw new Error('Incomplete demo audio');
      app.dataset.demoAudio='asset';return buffer;
    }catch(error){
      if(isSample){
        app.dataset.demoAudio='unavailable';
        throw new Error('示例音频暂时无法加载，请重新试听。',{cause:error});
      }
    }finally{clearTimeout(timer)}
    app.dataset.demoAudio='synthesizing';
    const sampleRate=22050, length=96, Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    const off=new Offline(2,sampleRate*length,sampleRate);
    const dry=off.createGain();dry.gain.value=.64;
    const comp=off.createDynamicsCompressor();comp.threshold.value=-20;comp.knee.value=20;comp.ratio.value=3;comp.attack.value=.02;comp.release.value=.3;dry.connect(comp);comp.connect(off.destination);
    const reverb=off.createConvolver(),impulse=off.createBuffer(2,sampleRate*3.8,sampleRate);let seed=42577;
    const noise=()=>{seed=(seed*16807)%2147483647;return(seed/2147483647*2-1)};
    for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=noise()*Math.pow(1-i/data.length,3.2)*.7}
    reverb.buffer=impulse;const wet=off.createGain();wet.gain.value=.37;reverb.connect(wet);wet.connect(dry);
    const hz=n=>440*Math.pow(2,(n-69)/12),beat=.75,bar=3;
    function tone(note,t,len,level,type='sine',pan=0){
      const osc=off.createOscillator(),env=off.createGain(),panner=off.createStereoPanner();
      osc.type=type;osc.frequency.value=hz(note);panner.pan.value=pan;
      const end=Math.min(length-.01,t+len);if(end<=t+.02)return;
      env.gain.setValueAtTime(.0001,t);env.gain.exponentialRampToValueAtTime(level,t+Math.min(.035,len*.15));env.gain.exponentialRampToValueAtTime(.0001,end);
      osc.connect(env);env.connect(panner);panner.connect(dry);panner.connect(reverb);osc.start(t);osc.stop(end);
    }
    const chords=[[48,55,59,64],[45,52,55,60],[40,47,55,59],[41,48,57,60]];
    for(let b=0;b<32;b++){
      const chord=chords[Math.floor(b/2)%4],t=b*bar;
      chord.forEach((note,i)=>{
        const osc=off.createOscillator(),filter=off.createBiquadFilter(),env=off.createGain(),p=off.createStereoPanner();
        osc.type='triangle';osc.frequency.value=hz(note);osc.detune.value=(i-1.5)*3;filter.type='lowpass';filter.frequency.value=550+90*Math.sin(b);p.pan.value=(i-1.5)*.36;
        env.gain.setValueAtTime(.0001,t);env.gain.linearRampToValueAtTime(.075,t+.85);env.gain.linearRampToValueAtTime(.045,t+2.3);env.gain.exponentialRampToValueAtTime(.0001,Math.min(t+4.5,95.95));
        osc.connect(filter);filter.connect(env);env.connect(p);p.connect(dry);p.connect(reverb);osc.start(t);osc.stop(Math.min(t+4.6,96));
      });
      for(let step=0;step<8;step++){
        const pos=t+step*beat/2,pattern=[0,2,1,3,2,1,3,2],n=chord[pattern[step]]+24;
        tone(n,pos,1.7,.055+(step%4===0?.025:0),'sine',Math.sin(step*2.4)*.6);
        if(step%2===0){const kick=off.createOscillator(),env=off.createGain();kick.frequency.setValueAtTime(100,pos);kick.frequency.exponentialRampToValueAtTime(39,pos+.22);env.gain.setValueAtTime(.0001,pos);env.gain.exponentialRampToValueAtTime(.22,pos+.008);env.gain.exponentialRampToValueAtTime(.0001,pos+.43);kick.connect(env);env.connect(dry);kick.start(pos);kick.stop(pos+.5)}
        if(step%2===1){const nbuf=off.createBuffer(1,2205,sampleRate),ndata=nbuf.getChannelData(0);for(let i=0;i<ndata.length;i++)ndata[i]=noise()*Math.exp(-i/360)*.075;const ns=off.createBufferSource(),hp=off.createBiquadFilter();ns.buffer=nbuf;hp.type='highpass';hp.frequency.value=6200;ns.connect(hp);hp.connect(dry);ns.start(pos)}
      }
      if(b%2===0)tone(chord[1]+36,t+.01,4.5,.045,'sine',b%4===0?-.75:.75);
    }
    const result=await off.startRendering();
    const fade=sampleRate*2;
    for(let ch=0;ch<result.numberOfChannels;ch++){const data=result.getChannelData(ch);for(let i=0;i<fade;i++){data[i]*=i/fade;data[data.length-1-i]*=i/fade}}
    app.dataset.demoAudio='synthesized';return result;
  }
  function onlineErrorMessage(error){
    if(error?.code==='not-playable'||error?.status===422)return '这首歌没有可播放的音源，可以去汽水音乐听。';
    if(error?.code==='auth-required'||error?.status===401)return '汽水登录已失效或尚未登录，请重新扫码。';
    if(error?.code==='provider-unavailable')return qishuiDisabledMessage;
    if(error?.code==='network')return '暂时无法连接汽水音乐。请检查网络后重试。';
    if(error?.code==='timeout')return error.message||'本机音乐入口响应超时。请确认启动窗口仍然打开，再重新打开本机完整入口。';
    if(error instanceof TypeError||error?.code==='offline')return '本机音乐入口已断开，请重新连接。';
    if(error?.status>=500)return error.message||'音乐服务暂不可用，请稍后重试。';
    return error?.message||'这首歌暂时无法在线播放，请稍后重试或打开汽水音乐收听。';
  }
  function positionOnlineLyrics(){
    const panel=$('onlineLyrics'),player=document.querySelector('.player');
    if(panel.hidden||!player)return;
    const playerRect=player.getBoundingClientRect(),height=panel.offsetHeight||100;
    const desired=innerHeight-playerRect.top+12,max=Math.max(12,innerHeight-height-16);
    panel.style.bottom=Math.min(max,Math.max(12,desired))+'px';
  }
  function scheduleOnlineLyricsPosition(){
    if(onlineLyricPositionFrame)return;
    onlineLyricPositionFrame=requestAnimationFrame(()=>{onlineLyricPositionFrame=0;positionOnlineLyrics()});
  }
  function hideOnlineLyrics(){
    onlineLyricRequest?.abort();onlineLyricRequest=null;onlineLyricInfo=null;
    onlineTimedLyrics=noOnlineLyrics;onlineLyricTrackId=null;onlineLyricDismissed=false;onlineLyricActiveIndex=-1;onlineLyricRenderedLines=null;
    $('onlineLyrics').hidden=true;$('onlineLyricTrackList').replaceChildren();$('onlineLyricTrackList').style.transform='';
    $('onlineLyricsViewport').classList.remove('is-empty');$('onlineLyricStatus').textContent='';$('onlineLyricNumber').textContent='00 / 00';$('onlineLyricSource').textContent='LIVE LYRIC';
  }
  function focusOnlineLyric(index){
    const row=$('onlineLyricTrackList').children[index];
    if(!row)return;
    requestAnimationFrame(()=>{
      if(onlineLyricActiveIndex!==index||!row.isConnected)return;
      const shift=-(row.offsetTop+row.offsetHeight/2);
      $('onlineLyricTrackList').style.transform='translate3d(0,'+shift+'px,0)';
    });
  }
  function syncOnlineLyricMeta(track){
    const meta=[track?.artist,track?.album].filter(Boolean).join(' · ');
    $('onlineLyricTrack').textContent=track?(track.name+(meta?' · '+meta:'')):'正在连接歌曲';
    $('onlineLyricTrack').title=$('onlineLyricTrack').textContent;
  }
  function lyricInfo(saved,lines,externalMetadata=null){
    if(!externalStream&&!saved)return mode==='online'?onlineLyricInfo:null;
    const timing=lines.some(line=>line.points?.length)?'word':'line';
    if(externalStream)return lines.length?{state:'ready',source:externalMetadata?.lyricsSource||'外部声音',timing}:null;
    return {
      state:saved.enabled===false?'disabled':lines.length?'ready':saved.origin==='manual'?'cleared':'missing',
      source:Object.hasOwn(lyricOrigins,saved.origin)?lyricOrigins[saved.origin]:'本机歌词',
      timing,
    };
  }
  function updateOnlineLyricDisplay(){
    if(listeningPresentation||mode!=='online'||!onlineLyricTrackId||onlineLyricDismissed){$('onlineLyrics').hidden=true;return}
    $('onlineLyrics').hidden=false;
    const track=tracks.find(item=>item.id===onlineLyricTrackId)||currentTrack();
    syncOnlineLyricMeta(track);
    const viewport=$('onlineLyricsViewport'),rows=$('onlineLyricTrackList');
    const saved=currentLyrics(),lines=saved?(saved.enabled===false?noOnlineLyrics:saved.lines):onlineTimedLyrics;
    const info=lyricInfo(saved,lines);
    $('onlineLyricSource').textContent=lines.length?`${info?.source||'同步歌词'} · ${info?.timing==='word'?'逐字':'逐行'}`:'同步歌词';
    if(!lines.length){
      viewport.classList.add('is-empty');
      $('onlineLyricStatus').textContent=info?.state==='loading'?'正在获取当前录音的歌词…':
        info?.state==='unavailable'?'歌词服务暂时不可用。':
        info?.state==='cleared'?'这首歌的歌词已手动清除。':info?.state==='disabled'?'这首歌的歌词已关闭。':'暂未找到这版录音的同步歌词。';
      if(onlineLyricRenderedLines){rows.replaceChildren();onlineLyricRenderedLines=null;onlineLyricActiveIndex=-1;}
      $('onlineLyricNumber').textContent='00 / 00';
      scheduleOnlineLyricsPosition();return;
    }
    viewport.classList.remove('is-empty');$('onlineLyricStatus').textContent='';
    if(lines!==onlineLyricRenderedLines){
      const fragment=document.createDocumentFragment();
      lines.forEach((line,index)=>{
        const row=document.createElement('p');row.className='online-lyrics-row';row.setAttribute('role','listitem');row.dataset.lyricIndex=String(index);row.textContent=line.text;fragment.append(row);
      });
      rows.replaceChildren(fragment);rows.style.transform='translate3d(0,'+(-(rows.children[0]?.offsetHeight||43)/2)+'px,0)';
      onlineLyricRenderedLines=lines;onlineLyricActiveIndex=-1;
    }
    const position=getLocalPosition()+onlineClipStart-lyricOffset();
    let activeIndex=-1;
    for(let index=0;index<lines.length;index++){
      if(lines[index].time>position+.03)break;
      activeIndex=index;
    }
    if(activeIndex<0)activeIndex=0;
    if(activeIndex!==onlineLyricActiveIndex){
      Array.from(rows.children).forEach((row,index)=>{
        row.classList.toggle('is-current',index===activeIndex);
        row.classList.toggle('is-past',index<activeIndex);
        row.classList.toggle('is-next',index===activeIndex+1);
        if(index===activeIndex)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
      });
      onlineLyricActiveIndex=activeIndex;
      $('onlineLyricNumber').textContent=String(activeIndex+1).padStart(2,'0')+' / '+String(lines.length).padStart(2,'0');
      focusOnlineLyric(activeIndex);
    }
    scheduleOnlineLyricsPosition();
  }
  async function loadNavidromeLyrics(track,duration,signal){
    const response=await fetch('/api/navidrome/lyrics',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mediaId:track.mediaId}),signal:AbortSignal.any([signal,AbortSignal.timeout(9000)])});
    if(!response.ok)throw Object.assign(new Error('无法读取 Navidrome 歌词。'),{status:response.status});
    const data=await response.json();
    const lines=data.lines.filter(line=>Number.isFinite(line.time)&&line.time>=0&&line.time<duration&&line.text)
      .map(line=>({...line,points:[]}));
    return lines.length?{lines,timing:'line'}:null;
  }
  async function loadOnlineLyrics(track){
    onlineLyricRequest?.abort();
    const request=new AbortController(),{signal}=request;
    onlineLyricRequest=request;
    // A playback preflight may fail while this recording is still active.
    const isCurrent=()=>!signal.aborted&&request===onlineLyricRequest&&activeId===track.id;
    const publish=info=>{
      onlineLyricInfo=info;updateOnlineLyricDisplay();
      window.dispatchEvent(new Event('sonic:transport-state'));
    };
    onlineLyricTrackId=track.id;onlineTimedLyrics=noOnlineLyrics;onlineLyricDismissed=false;
    const navidrome=track.provider==='navidrome';
    if(currentLyrics()||!navidrome&&(!onlineReady||!onlineClient)){
      onlineLyricRequest=null;
      publish(currentLyrics()?{state:'missing'}:{state:'unavailable',reason:'connection'});
      return false;
    }
    publish({state:'loading'});
    const enrichment=window.SonicTrackEnrichment;
    const recordingDuration=onlineRecordingDuration;
    let resolved,source=navidrome?'Navidrome':'汽水音乐',outage=null;
    const noteFailure=error=>{
      const status=error?.status;
      if(outage||error?.name==='AbortError'||(status&&![401,403,408,429].includes(status)&&status<500))return;
      outage=status===401||status===403?'auth':status===429?'rate-limit':
        status===408||error?.code==='timeout'||error?.name==='TimeoutError'?'timeout':'connection';
    };
    try{
      resolved=navidrome?await loadNavidromeLyrics(track,recordingDuration,signal):
        enrichment.resolveTimedLyrics(await onlineClient.lyrics(track.mediaId,{signal}),recordingDuration);
    }catch(error){noteFailure(error);}
    if(!isCurrent())return false;
    if(!navidrome&&!resolved&&track.album&&recordingDuration>0&&recordingDuration<=3600&&!currentLyrics()){
      try{
        const raw=await enrichment.findTimedLyrics({...track,duration:recordingDuration},signal,{reportUnavailable:true});
        resolved=enrichment.resolveTimedLyrics(raw,recordingDuration);
        if(resolved)source='LRCLIB';
      }catch(error){noteFailure(error);}
    }
    if(!isCurrent())return false;
    onlineLyricRequest=null;
    if(resolved)onlineTimedLyrics=resolved.lines;
    publish(resolved?{state:'ready',source,timing:resolved.timing}:outage?{state:'unavailable',reason:outage}:{state:'missing'});
    return Boolean(resolved);
  }
  async function retryOnlineLyrics(){
    const track=currentTrack(),token=loadGeneration;
    if(track?.kind!=='online'||onlineLyricRequest||onlineLyricInfo?.state!=='unavailable'||currentLyrics())return false;
    if(track.provider!=='navidrome'&&!onlineReady)await connectOnlineMusic();
    if(token!==loadGeneration||track.id!==activeId||onlineLyricRequest)return false;
    return loadOnlineLyrics(track);
  }
  const audioQualityLevels=['standard','high','lossless','hires'];
  let actualOnlineQuality=null,activeOnlineTicket=null;
  async function requestOnlineAudio(track,{signal,retry=true,quality,verify=false}={}){
    if(!quality&&track.id===activeId&&actualOnlineQuality)quality=actualOnlineQuality;
    if(track.provider==='navidrome'){
      const response=await fetch('/api/navidrome/audio',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({mediaId:track.mediaId,quality,verify}),signal:AbortSignal.any([signal,AbortSignal.timeout(10000)].filter(Boolean))});
      const data=await response.json();
      if(!response.ok)throw Object.assign(new Error(data.error||'Navidrome 请求失败。'),{code:data.code,status:response.status});
      const stream=new URL(data.streamPath,location.origin);
      if(stream.origin!==location.origin||!stream.pathname.startsWith('/media/'))throw new Error('Navidrome 播放地址无效。');
      return {...data,url:stream.href};
    }
    if(!onlineReady||!onlineClient){
      throw Object.assign(new Error('本机音乐入口没有启动。'),{code:'unavailable'});
    }
    let lastError=null;
    const attempts=retry?2:1;
    for(let attempt=0;attempt<attempts;attempt++){
      signal?.throwIfAborted();
      try{
        const data=await onlineClient.audio(track.mediaId,{signal,quality}),stream=new URL(onlineClient.resolveUrl(data?.streamPath)||'');
        const expectedOrigin=new URL(onlineClient.baseUrl||location.origin).origin;
        if(stream.origin!==expectedOrigin||!stream.pathname.startsWith('/media/'))throw Object.assign(new Error('播放凭据来源无效。'),{code:'unavailable'});
        return {...data,url:stream.href};
      }catch(error){
        signal?.throwIfAborted();
        lastError=error;
        if(error?.status&&error.status<500)break;
        if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,260));
      }
    }
    throw lastError||Object.assign(new Error('本机音乐入口没有返回播放地址。'),{code:'unavailable'});
  }
  async function loadOnlineMetadata(element,track,data,signal,timeout){
    if(Number(data.expiresAt)>0&&Number(data.expiresAt)<=Date.now()){
      data=await requestOnlineAudio(track,{signal,retry:false});
      return {data,duration:await waitForMetadata(element,data.url,timeout,signal)};
    }
    try{
      return {data,duration:await waitForMetadata(element,data.url,timeout,signal)};
    }catch(error){
      signal.throwIfAborted();
      if(error.code==='timeout')throw error;
      const response=await fetch(data.url,{method:'HEAD',cache:'no-store',
        signal:AbortSignal.any([signal,AbortSignal.timeout(1500)])}).catch(()=>null);
      if(response?.status!==404)throw error;
      data=await requestOnlineAudio(track,{signal,retry:false});
      return {data,duration:await waitForMetadata(element,data.url,timeout,signal)};
    }
  }
  function validOnlineTicket(ticket){
    return onlineReady&&ticket&&ticket.attempt===onlineConnectAttempt&&ticket.validUntil>Date.now();
  }
  function previewOnlyError(){
    return Object.assign(new Error('只有试听音源。'),{code:'preview-only'});
  }
  function onlineResumeAnchor(id,position){
    const current=id===activeId&&preparedTrackId===id?currentTrack():null;
    if(current?.kind==='online')return {full:!current.preview,time:onlineClipStart+position};
    const saved=resumePoint?.id===id?resumePoint:null;
    if(saved?.track?.provider!=='qishui')return null;
    const clipStart=saved.track.preview? saved.clipStart:0;
    return {full:!saved.track.preview,time:Number.isFinite(clipStart)?clipStart+position:null};
  }
  function resumeSourceError(){
    return Object.assign(new Error('当前音源不包含上次的播放进度。'),{code:'resume-source'});
  }
  async function prepareOnlineAudio(track,position,signal,ticket,preparedData,fullOnly,resume){
    onlineResultAvailability.delete(track.mediaId);
    function checkPreview(data){
      if(data.preview!==true)return;
      if(fullOnly)throw previewOnlyError();
      if(resume?.full)throw resumeSourceError();
    }
    let data,mediaDuration;
    if(validOnlineTicket(ticket)){
      checkPreview(ticket.data);
      try{
        ({data,duration:mediaDuration}=await loadOnlineMetadata(audio,track,ticket.data,signal,18000));
        checkPreview(data);
      }catch{
        signal.throwIfAborted();
      }
    }
    if(!data){
      data=preparedData||await requestOnlineAudio(track,{signal});
      checkPreview(data);
      if(signal.aborted||activeId!==track.id)return false;
      ({data,duration:mediaDuration}=await loadOnlineMetadata(audio,track,data,signal,18000));
      checkPreview(data);
    }
    if(signal.aborted||activeId!==track.id)return false;
    const preview=data.preview===true;
    const catalogDuration=Number(track.duration)||0;
    const clipStart=preview?clamp((Number(data.clipStartMs)||0)/1000,0,86400):0;
    // The provider may send an already-cut stream with a recording-relative start.
    const wholeRecording=clipStart>0&&catalogDuration>clipStart&&mediaDuration>=catalogDuration-.5&&mediaDuration>clipStart;
    const mediaStart=wholeRecording?clipStart:0;
    const recordingDuration=preview?(catalogDuration>clipStart?catalogDuration:0):Math.max(catalogDuration,mediaDuration);
    const playableEnd=clipStart+mediaDuration-mediaStart;
    const end=preview?Math.min(recordingDuration||Infinity,playableEnd):recordingDuration;
    const target=Number.isFinite(resume?.time)?resume.time-clipStart:position;
    const playableLength=Math.min(end-clipStart,mediaDuration-mediaStart);
    if(resume&&(target<-.03||target>playableLength+.15))throw resumeSourceError();
    track.preview=preview;
    actualOnlineQuality=audioQualityLevels.includes(data.quality)?data.quality:null;
    activeOnlineTicket=data;
    if(!preview)track.duration=recordingDuration;
    onlineClipStart=clipStart;onlineMediaStart=mediaStart;onlineRecordingDuration=recordingDuration;duration=end;
    const start=mediaStart+clamp(target,0,Math.max(0,playableLength-.02));
    if(audio.currentTime!==start)audio.currentTime=start;
    return true;
  }
  function getPosition(){return externalStream?(externalPlayback?.position()??(performance.now()-externalStartedAt)/1000):getLocalPosition()}
  function localDuration(){return mode==='online'?Math.max(0,duration-onlineClipStart):duration}
  function getLocalPosition(){
    const recovery=sessionQueue?.recovery||(!sessionQueue&&standaloneRecovery?.id===activeId?standaloneRecovery:null);
    if(recovery&&!playing)return recovery.position;
    if(deferredResume&&!playing&&activeId===resumePoint?.id)return resumePoint.position;
    if(mode==='file')return Number.isFinite(audio.currentTime)?Math.max(0,Math.min(duration,audio.currentTime-(albumRun?.start||0))):0;
    if(mode==='online'){
      return clamp((Number.isFinite(audio.currentTime)?audio.currentTime:onlineMediaStart)-onlineMediaStart,0,localDuration());
    }
    if(mode==='demo')return clamp(Number.isFinite(audio.currentTime)?audio.currentTime:offset,0,duration);
    return clamp(offset+(playing&&audioContext?(audioContext.currentTime-startedAt)*playbackRate:0),0,duration);
  }
  function stopDemo(){if(mode==='demo')audio.pause()}
  function updatePlaying(){
    app.classList.toggle('playing',playing||Boolean(externalStream));playBtn.setAttribute('aria-label',playing?'暂停音乐':'播放音乐');
    playBtn.innerHTML=playing?'<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6Zm8 0h4v16h-4Z"/></svg>':'<svg class="play-icon" viewBox="0 0 24 24"><path d="m7 3 15 9-15 9Z"/></svg>';
    $('liveTitle').textContent=playing?'音乐正在点亮星空':getPosition()>0?'宇宙，稍作停留':'静候第一束声音';
    $('liveSub').textContent=playing?'SOUND REACTIVE · LIVE':'READY TO EXPLORE';
    $('orbitHint').textContent=playing?'每一颗星，都在回应此刻的旋律':getPosition()>0?'再次播放，继续星际漫游':'点击播放，唤醒这片星空';
    if(externalStream){$('liveTitle').textContent='外部声音，正在点亮星空';$('liveSub').textContent='EXTERNAL SOUND · LIVE';$('orbitHint').textContent='正在聆听外部旋律 · 选歌请在原播放器操作';playBtn.setAttribute('aria-label','外部声音联动中，请在原播放器控制')}
    refreshQueueState();
    updateRecentTrack();
    if(listeningPresentation)window.dispatchEvent(new Event('sonic:transport-state'));
  }
  function updateTimeline(){if(externalStream){const info=externalPlayback?.snapshot(), timed=Number.isFinite(info?.position);$('currentTime').textContent=timed?formatTime(info.position):'LIVE';$('duration').textContent=timed?formatTime(info.duration):'外部播放';seek.disabled=true;seek.max=timed?info.duration:96;seek.value=timed?info.position:0;setFill(seek);seek.setAttribute('aria-valuetext',timed?formatTime(info.position)+' / '+formatTime(info.duration):'外部声音实时联动，进度由原播放器控制');updateJourneyTimeline();return}const pos=getPosition(),length=localDuration();$('currentTime').textContent=formatTime(pos);$('duration').textContent=formatTime(length);seek.max=length||96;if(!seeking){seek.value=pos;setFill(seek)}seek.setAttribute('aria-valuetext',formatTime(pos)+' / '+formatTime(length));updateJourneyTimeline();if(mode==='online')updateOnlineLyricDisplay()}
  // 内置示例也走 <audio>：播放速度天然保调，也不必把整首解码进内存。
  // 示例音频可以指向外部地址：在控制台 localStorage.setItem('sonic-asset-base','https://cdn.example.com/') 即可。
  function assetBase(){
    try{const value=localStorage.getItem('sonic-asset-base');return typeof value==='string'&&/^https?:\/\//i.test(value)?value.replace(/\/+$/,'')+'/':''}catch{return ''}
  }
  function demoAssetPath(track){return track?.id===bundledSample.id?'assets/auld-lang-syne.m4a':'interstellar-drift.mp3'}
  function demoSrcFor(track){const base=assetBase();return base?base+demoAssetPath(track):'./'+demoAssetPath(track)}
  async function startDemoAt(position){
    const asset=demoSrcFor(currentTrack()),url=await resolveSharedAsset(asset);
    const absolute=new URL(url,location.href).href;
    // 必须和音频元素当前真实地址比：从本地文件切回同一首示例时，dataset 里的旧值不能作数。
    if(audio.src!==absolute){audio.dataset.demoAsset=asset;audio.src=url;audio.load()}
    offset=clamp(position,0,Math.max(0,duration-.001));
    audio.playbackRate=playbackRate;audio.defaultPlaybackRate=playbackRate;
    if(Number.isFinite(offset)&&Math.abs(audio.currentTime-offset)>.2)audio.currentTime=offset;
    await audio.play();
    app.dataset.demoAudio='asset';playing=true;updatePlaying();
  }
  function setPlaybackRate(value){
    if(externalStream||instrumentOpen||clipLocked()||![.75,1,1.25,1.5,2].includes(value))return false;
    playbackRate=value;
    audio.defaultPlaybackRate=value;audio.playbackRate=value;
    beatTracker.reset();window.dispatchEvent(new Event('sonic:transport-state'));return true;
  }
  function setSleepTimer(minutes){
    if(![0,15,30,45,60,90,120].includes(minutes))return;
    clearTimeout(sleepTimeout);sleepDeadline=minutes?Date.now()+minutes*60000:0;
    if(!minutes)return;
    sleepTimeout=setTimeout(()=>{
      sleepDeadline=0;sleepRevision++;queueRun++;queueChartMatch?.abort();
      if(!externalStream){pause();showToast('定时结束，已暂停播放。');}
      window.dispatchEvent(new Event('sonic:transport-state'));
    },minutes*60000);
  }
  async function audioOutputs(){
    if(typeof globalThis.AudioContext?.prototype.setSinkId!=='function'||!navigator.mediaDevices?.enumerateDevices)return null;
    return (await navigator.mediaDevices.enumerateDevices()).filter(item=>item.kind==='audiooutput'&&item.deviceId&&item.deviceId!=='default'&&item.deviceId!=='communications');
  }
  async function setAudioOutput(device){
    if(externalStream||typeof device!=='string')return false;
    if(device&&!(await audioOutputs())?.some(item=>item.deviceId===device))throw Error('这个输出设备当前不可用。');
    initAudio();
    if(typeof audioContext.setSinkId!=='function')return false;
    await audioContext.setSinkId(device);return true;
  }
  navigator.mediaDevices?.addEventListener('devicechange',async()=>{
    const sink=audioContext?.sinkId;
    if(typeof sink!=='string'||!sink)return;
    const devices=await audioOutputs().catch(()=>null);
    if(devices&&audioContext?.sinkId===sink&&!devices.some(device=>device.deviceId===sink)){
      try{await audioContext.setSinkId('');showToast('输出设备已断开，已切换到系统默认。');}catch{}
    }
  });
  async function play(allowClip=false,queueSignal=null){if(instrumentOpen){showToast("请先关闭乐器台，再播放本地歌曲。");return}
    if(clipLocked()&&allowClip!==true){showToast('请先结束短片录制。');return}
    if(externalStream){showToast('外部声音已接入，请在原播放器控制音乐。');return}
    if(!libraryReady||busy||pendingFile||onlinePending||queueChartMatch)return;
    if(playing){pause();return}
    if(!queueSignal&&deferredResume&&activeId===resumePoint?.id)return continueListening();
    if(!queueSignal&&(sessionQueue?.recovery||standaloneRecovery?.id===activeId))return retryPlayback();
    if(!currentTrack())return;
    if(!queueSignal&&sessionQueue?.failed)return playQueueFrom(sessionQueue.currentId);
    if(sessionQueue)sessionQueue.autoplay=true;
    memoryHold=false;const token=++generation;
    try{
      initAudio();await audioContext.resume();if(token!==generation)return;fadeLocalIn();
      if(mode==='demo'){
        if(offset>=duration-.05)offset=0;
        await startDemoAt(offset);
        if(token!==generation)return;
      }else{
        if(getLocalPosition()>=localDuration()-.05)audio.currentTime=mode==='online'?onlineMediaStart:albumRun?.start||0;
        if(queueSignal||mode==='online')await startQueuedAudio(queueSignal||loadAbort?.signal);else await audio.play();
        if(token!==generation)return;
        const track=currentTrack();
        if(mode==='online'&&track){
          rememberOnlineAvailability(track.mediaId,track.preview?'preview':'direct');
        }
        playing=true;updatePlaying();
      }
      syncLoudness(currentTrack());
      if(!albumRun)scheduleLoudness(currentTrack(),audio.currentSrc);
      saveSession();
      return true;
    }catch(error){
      if(token!==generation)return;
      if(mode!=='demo')audio.pause();
      busy=false;playing=false;renderActiveTrack();updatePlaying();
      if(queueSignal)throw error;
      if(sessionQueue&&error.name!=='NotAllowedError'){
        skipFailedCurrent();
        return;
      }
      if(sessionQueue)sessionQueue.autoplay=false;
      showToast(error.name==='NotAllowedError'?'音乐已准备好，请点击播放按钮开始。':error.message||'播放失败，请重新导入音乐。',true);
    }
  }
  function startQueuedAudio(signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(signal.reason);return}
      const needsProgress=mode==='online';
      let start=audio.currentTime,started=false,settled=false,progressTimer=0;
      const timer=setTimeout(()=>settle(reject,Object.assign(new Error('连接音频超时。'),{code:'timeout'})),15000);
      const aborted=()=>settle(reject,signal.reason);
      const sought=()=>{start=audio.currentTime;};
      const failed=()=>settle(reject,Object.assign(new Error('音频连接中断。'),{code:audio.error?.code===2?'unavailable':'media-error'}));
      function confirmProgress(){
        const remaining=audio.duration-start;
        const threshold=Number.isFinite(remaining)?Math.max(.01,Math.min(.08,remaining*.4)):.08;
        if(started&&!audio.paused&&!audio.seeking&&audio.currentTime-start>=threshold)settle(resolve);
      }
      function settle(complete,value){
        if(settled)return;
        settled=true;
        clearTimeout(timer);clearInterval(progressTimer);
        signal?.removeEventListener('abort',aborted);
        audio.removeEventListener('seeked',sought);audio.removeEventListener('error',failed);
        complete(value);
      }
      signal?.addEventListener('abort',aborted,{once:true});
      if(needsProgress){
        audio.addEventListener('seeked',sought);audio.addEventListener('error',failed);
        progressTimer=setInterval(confirmProgress,40);
      }
      audio.play().then(()=>{
        if(!needsProgress){settle(resolve);return;}
        started=true;confirmProgress();
      },error=>settle(reject,error));
    });
  }
  function pause(preserveQueueIntent=false){
    cancelNextOnlinePreparation();
    clearOnlineStall(false);
    if(sessionQueue&&!preserveQueueIntent)sessionQueue.autoplay=false;
    generation++;if(mode==='demo'){offset=getPosition();stopDemo()}else audio.pause();playing=false;updatePlaying();updateTimeline();saveSession();
  }
  function seekTo(position,{allowClip=false}={}){
    if(!Number.isFinite(position)||!allowClip&&clipLocked()||externalStream||pendingFile||onlinePending||busy||trackLoading||
      sessionQueue?.recovery||standaloneRecovery?.id===activeId||deferredResume&&activeId===resumePoint?.id)return false;
    const pos=clamp(position,0,localDuration());
    if(mode!=='demo'){
      try{audio.currentTime=pos+(mode==='online'?onlineMediaStart:albumRun?.start||0);}
      catch{return false;}
    }
    beatTracker.reset();memoryHold=false;beginSeekVisual(pos);
    if(mode==='demo'){offset=pos;audio.currentTime=pos>=duration?0:pos;}
    updateTimeline();updatePlaying();saveSession();
    return true;
  }
  function handleEnded(){
    advanceAlbumRun();
    clearOnlineStall(false);
    if(externalStream)return;playing=false;offset=duration;
    if(clipLocked()){finishClip('歌曲已结束');updatePlaying();updateTimeline();saveSession();return}
    if(atelierLoopAtEnd())return;
    if(sessionQueue){
      const queue=sessionQueue;
      if(queueChartMatch||trackLoading)return;
      if(queue.recovery||!queue.autoplay){updatePlaying();updateTimeline();saveSession();return}
      const next=queue.mode==='single'?queue.currentId:queue.mode==='shuffle'?nextShuffle():adjacentSessionEntry(queue,queue.currentId,1);
      if(next){void playQueueFrom(next,{keepShuffle:true,automatic:true});return}
      queue.autoplay=false;updatePlaying();updateTimeline();saveSession();return;
    }
    const songs=scopedPlaybackTracks(),index=songs.findIndex(t=>t.id===activeId);
    if(playbackMode==='single'&&currentTrack()){seekTo(0);play();return}
    const next=playbackMode==='shuffle'?nextShuffle():songs[index+1]?.id||(playbackMode==='list'?songs[0]?.id:null);
    if(next){void playScopedFrom(next,{automatic:true,keepShuffle:playbackMode==='shuffle'});return}
    updatePlaying();updateTimeline();saveSession();
  }

  function clearOnlineStall(notify=true){
    if(!onlineStall)return;
    clearTimeout(onlineStall.timer);onlineStall=null;
    if(notify)window.dispatchEvent(new Event('sonic:transport-state'));
  }
  function mediaMatchesQueue(){
    return !queueChartMatch&&(!sessionQueue||resolveQueueItem(sessionQueue.currentId)?.trackId===activeId);
  }
  function canMonitorOnlineStall(){
    return mode==='online'&&playing&&!audio.paused&&!audio.seeking&&!audio.ended
      &&!document.hidden&&!trackLoading&&!onlineRetrying&&!clipLocked()&&mediaMatchesQueue()&&audio.duration-audio.currentTime>.15;
  }
  function monitorOnlineStall(){
    if(onlineStall||!canMonitorOnlineStall()||audio.readyState>=HTMLMediaElement.HAVE_FUTURE_DATA)return;
    const position=audio.currentTime,token=loadGeneration;
    onlineStall={position,timer:setTimeout(()=>{
      clearOnlineStall();
      if(token===loadGeneration&&canMonitorOnlineStall()&&audio.currentTime-position<.08)recoverOnlineStall();
    },4500)};
    window.dispatchEvent(new Event('sonic:transport-state'));
  }
  function holdStandaloneOnline(recovery,error){
    const track=currentTrack();
    const reason=error?.code==='resume-source'?'resume-source':playbackFailureReason(error,track)||recovery.reason;
    standaloneRecovery={...recovery,reason,manual:true};
    pause();
    if(error&&!isNavidromeFailure(track,error))onlineRequestFailure(error);
    showToast(reason==='resume-source'?error.message:navidromeFailureMessage(track,error,reason)||'在线音频暂时中断，已保留播放进度。点击播放可重试。',true);
  }
  async function retryStandaloneOnline(recovery,recoveringStream=false){
    const token=loadGeneration;
    if(trackLoading||activeId!==recovery.id||mode!=='online')return false;
    if(currentTrack()?.provider!=='navidrome'){
      if(!onlineReady)await connectOnlineMusic();
      if(token!==loadGeneration||activeId!==recovery.id)return false;
      if(!onlineReady){holdStandaloneOnline(recovery);return false;}
    }
    const outcome=await selectTrack(recovery.id,true,recovery.position,true,{retry:true,reportFailure:true,recoveringStream});
    if(outcome&&!outcome.ok&&loadGeneration===token+1&&activeId===recovery.id)holdStandaloneOnline(recovery,outcome.error);
    return Boolean(outcome?.ok);
  }
  function recoverOnlineStall(reason='timeout'){
    const position=getLocalPosition();
    if(sessionQueue?.currentId){
      if(!onlineStallRetried)void playQueueFrom(sessionQueue.currentId,{position,retry:true,keepShuffle:true,recoveringStream:true});
      else recoverableQueueFailure(sessionQueue,{code:reason,message:'在线音频播放中断。'},position,true);
      return;
    }
    const recovery={id:activeId,position,reason};
    if(!onlineStallRetried)void retryStandaloneOnline(recovery,true);
    else holdStandaloneOnline(recovery);
  }
  audio.addEventListener('ended',handleEnded);
  audio.addEventListener('timeupdate',()=>{
    advanceAlbumRun();
    if(onlineStall&&(!canMonitorOnlineStall()||audio.currentTime-onlineStall.position>=.08))clearOnlineStall();
    refreshNextOnlinePreparation();
  });
  audio.addEventListener('seeked',()=>{advanceAlbumRun();monitorOnlineStall();refreshNextOnlinePreparation();});
  audio.addEventListener('seeking',()=>clearOnlineStall());
  audio.addEventListener('waiting',monitorOnlineStall);
  audio.addEventListener('stalled',monitorOnlineStall);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearOnlineStall();else monitorOnlineStall();});
  audio.addEventListener('pause',()=>{if(clipSession&&clipPhase==='recording'&&!audio.ended)finishClip('音乐暂停，已结束录制')});
  audio.addEventListener('error',()=>{
    const wasWaiting=Boolean(onlineStall);
    clearOnlineStall();
    if(trackLoading||!mediaMatchesQueue())return;
    if(mode==='online'&&!onlineSwitching&&(playing||wasWaiting||sessionQueue?.autoplay)&&audio.error?.code===2){
      recoverOnlineStall('unavailable');return;
    }
    if(sessionQueue?.currentId&&(mode==='file'||mode==='online')){
      if(!sessionQueue.autoplay){sessionQueue.failed=true;updatePlaying();return}
      if(mode==='online'&&onlineRetryCount<1){
        void playQueueFrom(sessionQueue.currentId,{position:getLocalPosition(),retry:true,keepShuffle:true});
      }else skipFailedCurrent();
      return;
    }
    if(mode==='file'&&!pendingFile&&currentTrack()){
      holdScopedFailure(currentTrack(),audio.error,getLocalPosition(),{manual:true});return;
    }
    if(mode==='online'&&!onlineSwitching&&!onlineRetrying&&activeId&&onlineRetryCount<1){
      const id=activeId,wasPlaying=playing,position=getLocalPosition();onlineRetrying=true;onlineRetryCount++;
      void selectTrack(id,wasPlaying,position,true,{retry:true});
      return;
    }
    if(mode==='online'&&!onlineSwitching){onlineRetrying=false;pause();showToast('这首歌的版权或会员保护内容无法在声波宇宙内播放，可打开汽水音乐收听。',true)}
  });
  audio.addEventListener('pause',()=>{clearOnlineStall();if((mode==='file'||mode==='online')&&playing&&!audio.ended){playing=false;generation++;updatePlaying()}});
  playBtn.addEventListener('click',play);
  $('restartBtn').addEventListener('click',()=>navigateTrack(-1));$('forwardBtn').addEventListener('click',()=>navigateTrack(1));
  seek.addEventListener('input',()=>{seeking=true;setFill(seek);$('currentTime').textContent=formatTime(Number(seek.value))});
  seek.addEventListener('change',()=>{const pos=Number(seek.value);seeking=false;seekTo(pos)});
  function updateVolume(){
    if(masterGain)masterGain.gain.setTargetAtTime(masterGainFor(volume),audioContext.currentTime,.025);
    const db=window.SonicAudioTuning?.formatDb?window.SonicAudioTuning.formatDb(window.SonicAudioTuning.dbOf(masterGainFor(volume))):'';
    $('volume').value=Math.round(volume*100);$('volume').setAttribute('aria-valuetext',Math.round(volume*100)+'%'+(db?' · '+db:''));setFill($('volume'));
    $('muteBtn').setAttribute('aria-label',volume===0?'恢复音量':'静音');$('muteBtn').setAttribute('aria-pressed',String(volume===0));
    $('muteBtn').innerHTML=volume===0?'<svg viewBox="0 0 24 24"><path d="m11 4-6 5H2v6h3l6 5Zm5 5 6 6m0-6-6 6"/></svg>':'<svg viewBox="0 0 24 24"><path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
  }
  $('volume').addEventListener('input',()=>{volume=Number($('volume').value)/100;if(volume>0)lastVolume=volume;updateVolume();savePreferences()});
  function toggleMute(){
    if(externalStream)return;
    if(volume>0){lastVolume=volume;volume=0;}else volume=lastVolume||.65;
    updateVolume();savePreferences();
  }
  $('muteBtn').addEventListener('click',toggleMute);
  $('repeatBtn').addEventListener('click',()=>{
    const modes=['sequence','list','single','shuffle'];setPlaybackMode(modes[(modes.indexOf(effectivePlaybackMode())+1)%modes.length]);
    showToast(playbackLabels[effectivePlaybackMode()]);
  });
  updateVolume();
  function trackCoverSources(track){
    const direct=track?.cover||(track?.id===bundledSample.id?bundledSample.cover:null);
    const proxied=track?.provider==='qishui'&&onlineReady&&onlineClient
      ?onlineClient.coverUrl?.(track.mediaId)
      :'';
    return {primary:proxied||direct,fallback:proxied&&direct?direct:null};
  }
  function paintCover(img,data,fallback=null){
    const parent=img.parentElement,player=document.querySelector('.player'),ambientImage=$('playerAmbienceImage');
    img.dataset.coverSrc=data||'';
    parent.classList.remove('cover-ready');
    parent.classList.toggle('has-cover',Boolean(data));
    if(!data){
      img.hidden=true;img.removeAttribute('src');
      if(img.id==='albumImage'){player?.classList.remove('has-cover');if(ambientImage){ambientImage.hidden=true;ambientImage.removeAttribute('src')}}
      return;
    }
    img.hidden=false;img.referrerPolicy='no-referrer';
    img.onload=()=>{
      if(img.dataset.coverSrc!==data)return;
      img.hidden=false;parent.classList.add('has-cover','cover-ready');
    };
    img.onerror=()=>{
      if(img.dataset.coverSrc!==data)return;
      if(fallback&&fallback!==data){paintCover(img,fallback,null);return}
      img.hidden=true;parent.classList.remove('has-cover','cover-ready');
      if(img.id==='albumImage'){player?.classList.remove('has-cover');if(ambientImage)ambientImage.hidden=true}
    };
    img.src=data;
    if(img.id==='albumImage'){
      player?.classList.add('has-cover');
      if(ambientImage){
        ambientImage.dataset.coverSrc=data;ambientImage.hidden=true;ambientImage.referrerPolicy='no-referrer';
        ambientImage.onload=()=>{if(ambientImage.dataset.coverSrc===data)ambientImage.hidden=false};
        ambientImage.onerror=()=>{if(ambientImage.dataset.coverSrc===data)ambientImage.hidden=true};
        ambientImage.src=data;
      }
    }
  }
  function renderActiveTrack(){
    const track=currentTrack();
    const coverSources=trackCoverSources(track);
    $('trackTitle').textContent=track?track.name:'星空，等待一首歌';
    $('trackTitle').title=track?track.name:'导入音乐或加入内置音景';
    if(track?.kind==='demo'){const tag=document.createElement('span');tag.className='track-tag';tag.textContent='DEMO';$('trackTitle').append(tag)}
    const trackMeta=track?[track.artist,track.album].filter((value,index,list)=>value&&list.indexOf(value)===index).join(' · '):'';
    const trackSource=track?.kind==='online'?'汽水音乐 · 在线':track?.kind==='soda'?'汽水音乐 · 链接':track?.id===bundledSample.id?'内置示例 · CC0 1.0':track?.kind==='demo'?'原创合成音景':'本地音乐';
    $('trackSub').textContent=track?[trackMeta||(track.kind==='demo'?'Interstellar Drift':''),trackSource,(track.kind==='demo'?'':(tracks.indexOf(track)+1)+' / '+tracks.length)].filter(Boolean).join(' · '):'打开播放列表，开始你的收藏';
    $('albumImage').alt=track?.cover||coverSources.primary?track.name+' 的歌曲封面':'';
    $('playerAmbienceImage').alt='';
    $('coverTrackName').textContent=track?track.name:'请先选择一首音乐';
    paintCover($('albumImage'),coverSources.primary,coverSources.fallback);
    paintCover($('coverThumb'),coverSources.primary,coverSources.fallback);
    $('chooseCoverBtn').disabled=!track;$('coverPreview').disabled=!track;$('removeCoverBtn').disabled=!track?.cover;
    $('albumButton').setAttribute('aria-label',track?'更换「'+track.name+'」的封面':'布置音乐空间');
    seek.disabled=!track||Boolean(externalStream);playBtn.disabled=!track||Boolean(pendingFile)||busy||Boolean(externalStream);
    if(externalStream){$('trackTitle').textContent='外部声音 · 实时联动';$('trackTitle').title='外部声音联动';$('trackSub').textContent='选歌、暂停与音量请在原播放器操作';$('albumImage').alt='';paintCover($('albumImage'),null)}
    app.dataset.activeTrack=activeId||'';
    updateJourneyUI();
  }
  function refreshQueueState(){
    $('queueList').querySelectorAll('.queue-row').forEach(row=>{
      const index=tracks.findIndex(t=>t.id===row.dataset.trackId),track=tracks[index];
      const current=!externalStream&&row.dataset.trackId===activeId;
      row.classList.toggle('current',current);
      if(current)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
      const soda=track?.kind==='soda';
      row.querySelector('.queue-number').textContent=soda?'↗':current&&playing?'▥':String(index+1).padStart(2,'0');
      row.querySelector('.queue-select').setAttribute('aria-label',soda?'打开汽水音乐「'+(track?.name||'')+'」':(current&&playing?'暂停「':'播放「')+(track?.name||'')+'」');
      row.querySelector('.queue-select').setAttribute('aria-pressed',String(!soda&&current&&playing));
    });
  }
  function renderPlaylist(revealTrackId){
    renderLibraryControls();
    $('queueCount').textContent=String(tracks.length).padStart(2,'0');
    renderLegacyQueue(revealTrackId);
    renderActiveTrack();
    window.dispatchEvent(new Event('sonic:library-change'));
  }
  function changeLegacyQueuePage(direction){
    legacyQueuePage+=direction;
    renderLegacyQueue();
    $('queueList').scrollTop=0;
    const button=$(direction<0?'legacyQueuePrevious':'legacyQueueNext');
    if(button.disabled)$(direction<0?'legacyQueueNext':'legacyQueuePrevious').focus();
  }
  function renderLegacyQueue(revealTrackId){
    const dialog=$('queueDialog');
    if(!dialog.open||dialog.hasAttribute('data-search-only'))return;
    if(legacyQueueView!==libraryView){
      legacyQueueView=libraryView;
      legacyQueuePage=0;
    }
    const list=$('queueList');
    list.replaceChildren();
    const collection=collectionTracks(libraryView),query=libraryQuery.trim().toLocaleLowerCase();
    const visible=query?collection.filter(t=>[t.name,t.artist,t.album,t.sourcePath].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)):collection;
    const pageCount=Math.max(1,Math.ceil(visible.length/legacyQueuePageSize));
    const revealIndex=revealTrackId?visible.findIndex(track=>track.id===revealTrackId):-1;
    if(revealIndex>=0)legacyQueuePage=Math.floor(revealIndex/legacyQueuePageSize);
    legacyQueuePage=clamp(legacyQueuePage,0,pageCount-1);
    const start=legacyQueuePage*legacyQueuePageSize;
    $('legacyQueuePagination').hidden=pageCount===1;
    $('legacyQueuePageStatus').textContent='第 '+(legacyQueuePage+1)+' / '+pageCount+' 页';
    $('legacyQueuePrevious').disabled=legacyQueuePage===0;
    $('legacyQueueNext').disabled=legacyQueuePage===pageCount-1;
    const sodaCount=tracks.filter(t=>t.kind==='soda').length,onlineCount=tracks.filter(t=>t.kind==='online').length,localTracks=tracks.filter(t=>t.kind==='file');
    $('queueSummary').textContent='共 '+tracks.length+' 首 · 本地 '+localTracks.length+' 首 '+formatTime(localTracks.reduce((sum,t)=>sum+(t.duration||0),0))+(onlineCount?' · 在线 '+onlineCount+' 首':'')+(sodaCount?' · 分享入口 '+sodaCount+' 首':'');
    $('libraryResultCount').textContent=query?'找到 '+visible.length+' / '+collection.length+' 首':collection.length+' 首音乐';
    if(!visible.length){const empty=document.createElement('li');empty.className='queue-empty';empty.textContent=query?'没有找到这首歌，试试歌名、歌手、专辑或其他关键词。':libraryView==='soda'?'这里还没有汽水音乐。在上方粘贴分享链接，或展开「批量整理」一次加入多首。':libraryView==='favorites'?'点歌曲旁的星星，把喜欢的歌留在这里。':libraryView==='all'?'这里还没有音乐。添加歌曲或选择音乐文件夹。':'这个歌单还没有歌。在全部音乐里点 ＋ 添加，或直接导入音乐。';list.append(empty)}
    visible.slice(start,start+legacyQueuePageSize).forEach(track=>{
      const index=collection.indexOf(track),soda=track.kind==='soda',online=track.kind==='online',row=document.createElement('li');row.className='queue-row'+(soda||online?' soda-row':'');row.dataset.trackId=track.id;
      const select=document.createElement('button');select.className='queue-select';select.disabled=!libraryReady;
      const number=document.createElement('span');number.className='queue-number';number.setAttribute('aria-hidden','true');
      const art=document.createElement('span');art.className='queue-art';art.setAttribute('aria-hidden','true');art.textContent=soda?'↗':online?'◉':'✧';
      const coverSources=trackCoverSources(track);if(coverSources.primary){const img=document.createElement('img');img.src=coverSources.primary;img.alt='';img.referrerPolicy='no-referrer';if(coverSources.fallback)img.onerror=()=>{img.onerror=null;img.src=coverSources.fallback};art.append(img)}
      const info=document.createElement('span');info.className='queue-info';
      const title=document.createElement('span');title.className='queue-title';title.textContent=track.name;title.title=track.name;
      const meta=document.createElement('span');meta.className='queue-meta';
      meta.textContent=online?['汽水音乐 · 可在线播放',track.artist,track.album].filter(Boolean).join(' · ')+(track.preview?' · 试听':''):soda?['汽水音乐 · 分享链接',track.artist,track.album].filter(Boolean).join(' · '):(track.id===bundledSample.id?track.artist+' · 内置示例':track.kind==='demo'?'原创音景':track.sourcePath||'本地音乐')+' · '+formatTime(track.duration);meta.title=meta.textContent;
      info.append(title,meta);select.append(number,art,info);
      select.addEventListener('click',()=>{
        if(soda){openSodaUrl(track.externalUrl);return}
        cancelOnlinePick();
        if(usePlaybackScope(libraryView))resetShuffle(track.id);persistLibrary();renderLibraryControls();
        if(activeId===track.id&&!externalStream&&!externalPending)play();else void playScopedFrom(track.id);
      });
      const controls=document.createElement('div');controls.className='queue-tools';
      const favorite=document.createElement('button');favorite.className='icon-btn favorite-song';favorite.dataset.action='favorite';favorite.textContent=track.favorite?'★':'☆';favorite.setAttribute('aria-pressed',String(Boolean(track.favorite)));favorite.setAttribute('aria-label',(track.favorite?'取消收藏':'收藏')+'「'+track.name+'」');favorite.title=track.favorite?'取消收藏':'收藏';
      favorite.addEventListener('click',()=>{toggleTrackFavorite(track.id);const target=list.querySelector('[data-track-id="'+CSS.escape(track.id)+'"] [data-action=favorite]');(target||$('librarySearch')).focus()});
      const add=document.createElement('button');add.className='icon-btn membership-song';add.dataset.action='playlist';add.textContent='＋';add.title='加入歌单';add.setAttribute('aria-label','将「'+track.name+'」加入歌单');add.addEventListener('click',()=>openMembership(track.id));
      controls.append(favorite,add);
      if(soda){
        const edit=document.createElement('button');edit.className='icon-btn edit-song';edit.dataset.action='edit';edit.textContent='✎';edit.title='编辑汽水歌曲信息';edit.setAttribute('aria-label','编辑「'+track.name+'」的汽水歌曲信息');edit.addEventListener('click',()=>beginSodaEdit(track.id));controls.append(edit);
      }
      [[-1,'↑','上移'],[1,'↓','下移'],[0,'×',playlists.some(p=>p.id===libraryView)?'移出歌单':'从音乐库移除']].forEach(([direction,text,label])=>{
        const button=document.createElement('button');button.className='icon-btn '+(direction?'move-song':'remove-song');button.textContent=text;
        button.setAttribute('aria-label',label+'「'+track.name+'」');button.title=label;button.dataset.action=direction<0?'up':direction>0?'down':'remove';
        if(direction)button.disabled=direction<0?index===0:index===collection.length-1;
        button.addEventListener('click',()=>direction?moveTrack(track.id,direction):removeTrack(track.id));controls.append(button);
      });
      row.append(select,controls);list.append(row);
    });
    const hasSoundscape=tracks.some(t=>t.id==='demo');
    $('queueDemoBtn').disabled=hasSoundscape;$('queueDemoBtn').textContent=hasSoundscape?'✧ 内置音景已在列表中':'＋ 加入内置音景';
    $('libraryRemoveHint').textContent=playlists.some(p=>p.id===libraryView)?'× 只移出当前歌单 · 歌曲仍在全部音乐中':libraryView==='soda'?'× 从本页移除歌曲入口 · 不会操作汽水账号':'× 从本机音乐库移除 · 不会删除原始文件';
    refreshQueueState();
  }
  function moveTrack(id,direction){
    const collection=collectionTracks(libraryView),index=collection.findIndex(t=>t.id===id),target=index+direction;
    if(index<0||target<0||target>=collection.length)return;
    const playlist=playlists.find(p=>p.id===libraryView);
    if(playlist){const order=playlist.trackIds,a=order.indexOf(id),b=order.indexOf(collection[target].id);[order[a],order[b]]=[order[b],order[a]]}
    else{const a=tracks.findIndex(t=>t.id===id),b=tracks.findIndex(t=>t.id===collection[target].id);[tracks[a],tracks[b]]=[tracks[b],tracks[a]]}
    persistLibrary();renderPlaylist(id);const row=Array.from($('queueList').children).find(el=>el.dataset.trackId===id);
    const moveButton=row?.querySelector('[data-action="'+(direction<0?'up':'down')+'"]:enabled');
    (moveButton||row?.querySelector('.queue-select'))?.focus();
  }
  async function removeTrack(id){
    const index=tracks.findIndex(t=>t.id===id);if(index<0)return;
    const list=$('queueList');
    const rowIndex=Array.from(list.children).findIndex(row=>row.dataset.trackId===id);
    const playlist=playlists.find(p=>p.id===libraryView);
    if(playlist){playlist.trackIds=playlist.trackIds.filter(value=>value!==id);resetShuffle();persistLibrary();renderPlaylist();showToast('已移出歌单，音乐保留在全部音乐中。');return}
    const wasCurrent=activeId===id,wasPlaying=playing,name=tracks[index].name,removedKind=tracks[index].kind,localBefore=playableTracks(),localIndex=localBefore.findIndex(t=>t.id===id);
    tracks.splice(index,1);playlists.forEach(p=>p.trackIds=p.trackIds.filter(value=>value!==id));resetShuffle();persistLibrary();renderPlaylist();
    if(editingSodaId===id)resetSodaEditor();
    if(wasCurrent){
      const replacement=localBefore.filter(t=>t.id!==id)[Math.min(Math.max(localIndex,0),Math.max(0,localBefore.length-2))];
      if(replacement)await selectTrack(replacement.id,wasPlaying);else clearActiveTrack();
    }
    persistLibrary();saveSession();renderPlaylist();
    if(rowIndex>=0&&$('queueDialog').open){
      const row=list.children[Math.min(rowIndex,list.children.length-1)];
      (row?.querySelector('.queue-select')||$('librarySearch')).focus();
    }
    showToast((removedKind==='soda'?'已从汽水音乐入口删除「':'已从音乐库移除「')+name+'」');
  }

  function clearActiveTrack(){
    if(externalStream||externalPending)stopExternal();
    invalidateFilmAnalysis('当前歌曲已移除，请选择或导入一首歌曲后重新分析。');
    leaveSessionQueue();pause();loadGeneration++;loadAbort?.abort();trackLoading=false;loadingTrack=null;pendingFile=null;activeId=null;mode='demo';duration=0;offset=0;
    onlinePending=null;onlineSwitching=false;onlineRetrying=false;onlineRetryCount=0;
    onlineClipStart=onlineMediaStart=onlineRecordingDuration=0;standaloneRecovery=null;
    hideOnlineLyrics();preparedTrackId=null;
    audio.removeAttribute('src');audio.load();
    if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
    renderActiveTrack();updatePlaying();updateTimeline();saveSession();
  }
  function waitForMetadata(element,url,timeout=15000,signal=null,readyEvent='loadedmetadata'){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(signal.reason);return}
      const timer=setTimeout(()=>finish(false,Object.assign(new Error('读取音频超时。'),{code:'timeout'})),timeout);
      const loaded=()=>finish(true),failed=()=>finish(false,element.error?.code===2
        ?Object.assign(new Error('音频连接中断。'),{code:'unavailable'}):undefined);
      const aborted=()=>finish(false,signal.reason);
      function finish(ok,error){
        clearTimeout(timer);element.removeEventListener(readyEvent,loaded);element.removeEventListener('error',failed);
        signal?.removeEventListener('abort',aborted);
        if(ok&&Number.isFinite(element.duration)&&element.duration>0)resolve(element.duration);
        else reject(error||new Error('无法读取音频。'));
      }
      signal?.addEventListener('abort',aborted,{once:true});
      element.addEventListener(readyEvent,loaded);element.addEventListener('error',failed);
      element.src=url;element.load();
    });
  }
  async function selectTrack(id,autoplay=true,position=0,keepShuffle=false,selection={}){
    const sleepAtSelection=sleepRevision;
    const requested=tracks.find(t=>t.id===id);
    const onlineResume=requested?.kind==='online'&&(position>0||selection.retry)?onlineResumeAnchor(id,position):null;
    if(requested?.kind==='soda'){openSodaUrl(requested.externalUrl);return}
    if(!isPlayableTrack(requested))return;
    if(instrumentOpen){showToast("请先关闭乐器台，再切换歌曲。");return}
    if(clipLocked()){showToast('请先结束短片录制，再切换歌曲。');return}
    if(selection.queue&&selection.queue!==sessionQueue)return;
    const token=++loadGeneration;
    loadAbort?.abort();loadAbort=new AbortController();
    const signal=selection.signal?AbortSignal.any([loadAbort.signal,selection.signal]):loadAbort.signal;
    trackLoading=true;loadingTrack=requested;
    onlineSwitching=requested?.kind==='online';
    window.dispatchEvent(new Event('sonic:transport-state'));
    const ticket=selection.ticket;
    try{
      let onlineData=selection.onlineData, selectionError=selection.preflightError;
      if(onlineSwitching&&!selectionError&&!onlineData&&!validOnlineTicket(ticket)){
        try{
          if(requested.provider!=='navidrome'&&selection.reconnectOnline&&!onlineReady&&onlineClient)await connectOnlineMusic();
          if(signal.aborted||token!==loadGeneration)return;
          onlineData=await requestOnlineAudio(requested,{signal,verify:position>0||selection.retry});
        }
        catch(error){
          if(signal.aborted||token!==loadGeneration)return;
          if(selection.keepMediaOnTicketFailure)return {ok:false,error};
          if(selection.queue||selection.holdFailure)selectionError=error;
          else{
            if(selection.reportFailure)return {ok:false,error};
            showToast(navidromeFailureMessage(requested,error)||onlineRequestFailure(error),true);return;
          }
        }
      }
      if(signal.aborted||token!==loadGeneration||selection.queue&&selection.queue!==sessionQueue)return;
      if(selection.queue?.fullOnly&&(validOnlineTicket(ticket)?ticket.data:onlineData)?.preview===true){
        return {ok:false,error:previewOnlyError()};
      }
      const faded=await fadeLocalOut(token);
      if(!faded||signal.aborted||token!==loadGeneration){
        if(token===loadGeneration){loadAbort.abort();if(playing)fadeLocalIn();}
        return;
      }
      if(!selection.queue)leaveSessionQueue();
      if(selection.scope){usePlaybackScope(selection.scope);void persistLibrary();renderLibraryControls();}
      if(externalStream||externalPending)stopExternal();
      if(!keepShuffle)resetShuffle(id);
      pause(Boolean(selection.queue));
      if(busy){try{await demoBuilds.get(activeId)}catch{}}
      if(token!==loadGeneration)return;
      const track=tracks.find(t=>t.id===id);if(!track)return;
      albumRun=null;
      audio.preload=onlineSwitching&&autoplay?'auto':'metadata';
      audio.removeAttribute('src');audio.load();
      if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
      hideOnlineLyrics();standaloneRecovery=null;
      const sourceChanged=activeId!==id;
      if(sourceChanged||!onlineSwitching){actualOnlineQuality=null;activeOnlineTicket=null;}
      captureSongDraft();saveDrafts();activeId=id;preparedTrackId=null;if(sourceChanged)invalidateFilmAnalysis('已切换歌曲，开始录制时会自动分析新的推荐片段。');
      mode=track.kind==='demo'?'demo':track.kind==='online'?'online':'file';duration=track.duration||0;offset=0;
      onlineClipStart=onlineMediaStart=onlineRecordingDuration=0;
      onlineRetryCount=selection.retry?1:0;onlineRetrying=Boolean(selection.retry);
      onlineStallRetried=Boolean(selection.recoveringStream);
      pendingFile=mode==='file'?track:null;onlinePending=mode==='online'?track:null;
      renderActiveTrack();refreshQueueState();updateTimeline();updatePlaying();
      try{
        if(selectionError)throw selectionError;
        if(mode==='file'){
          const next=autoplay&&!selection.skipAlbum&&albumContinuation(track);
          const joined=next?await window.SonicAlbumAudio?.join(track.blob,next.next.blob,signal).catch(()=>null):null;
          if(signal.aborted||token!==loadGeneration)return;
          if(joined)albumRun={...joined,...next,firstId:track.id,start:0};
          objectUrl=URL.createObjectURL(joined?.blob||track.blob);
          const actualDuration=await waitForMetadata(audio,objectUrl,15000,signal);
          if(token!==loadGeneration)return;
          const trackDuration=joined?.first||actualDuration;
          const durationChanged=Math.abs(trackDuration-track.duration)>.1;duration=trackDuration;track.duration=trackDuration;if(durationChanged)invalidateFilmAnalysis('歌曲时长发生变化，开始录制时会重新分析推荐片段。');audio.currentTime=clamp(position,0,duration);
        }else if(mode==='online'){
          const prepared=await prepareOnlineAudio(track,position,signal,ticket,onlineData,selection.queue?.fullOnly,onlineResume);
          if(!prepared||token!==loadGeneration)return;
        }else offset=clamp(position,0,duration);
        if(token!==loadGeneration)return;
        pendingFile=null;onlinePending=null;preparedTrackId=id;atelierTrackReady();renderActiveTrack();updateTimeline();updatePlaying();saveSession();
        if(autoplay&&sleepAtSelection===sleepRevision){
          try{
            const started=await play(false,selection.queue||selection.reportFailure?signal:null);
            if((selection.queue||selection.reportFailure)&&!started)return;
          }finally{
            if(token===loadGeneration&&track.kind==='online')void loadOnlineLyrics(track);
          }
        }else if(mode==='online')void loadOnlineLyrics(track);
        if(token===loadGeneration)return {ok:true};
      }catch(error){
        if(token!==loadGeneration)return;
        pendingFile=null;onlinePending=null;playing=false;renderActiveTrack();updatePlaying();
        if(signal.aborted)return;
        if(selection.queue||selection.reportFailure){audio.pause();return {ok:false,error}}
        showToast(mode==='online'?(navidromeFailureMessage(track,error)||onlineErrorMessage(error)):error.message||'音乐读取失败，请重新导入。',true);
      }
    }finally{
      if(token===loadGeneration){
        trackLoading=false;loadingTrack=null;onlineSwitching=false;onlineRetrying=false;
        if(selection.queue)updatePlaying();
        else window.dispatchEvent(new Event('sonic:transport-state'));
      }
    }
  }
  function adjacentSessionEntry(queue,id,direction){
    const length=queue.items.length,index=queue.items.findIndex(entry=>entry.entryId===id);
    const next=index<0?(direction>0?0:length-1):index+direction;
    if(next>=0&&next<length)return queue.items[next].entryId;
    if(length&&(queue.mode==='list'||queue.mode==='shuffle'))return queue.items[(next+length)%length].entryId;
    return null;
  }
  async function prepareNextOnlineEntry(entry,track,{attempt,controller:{signal}}){
    if(!track){
      try{
        track=await resolveChartEntry(entry.chart,signal);
      }catch{return null}
    }
    if(signal.aborted||!track)return null;
    if(track.kind==='file')return {track};
    try{
      const data=await requestOnlineAudio(track,{signal,retry:false});
      const validUntil=Math.min(Date.now()+ONLINE_TICKET_REUSE_MS,Number(data.expiresAt)>0?Number(data.expiresAt)-1500:Infinity);
      return {track,ticket:{data,validUntil,attempt}};
    }catch{return {track}}
  }
  async function resolveChartEntry(source,signal){
    return (await resolveChartRecording(source,signal)).track;
  }
  function refreshNextOnlinePreparation(){
    const queue=sessionQueue;
    if(!queue?.autoplay||queue.failed||!playing||audio.paused||mode==='demo'||trackLoading||queueChartMatch||clipLocked()||externalStream||instrumentOpen)return;
    // The media element reports the actual file or preview length.
    const remaining=(audio.duration-audio.currentTime)/audio.playbackRate;
    if(!Number.isFinite(remaining)||remaining>NEXT_ONLINE_WINDOW){cancelNextOnlinePreparation();return}
    if(remaining<=0||audio.seeking||nextOnlinePreparation||!['sequence','list'].includes(queue.mode))return;
    const id=adjacentSessionEntry(queue,queue.currentId,1);
    if(!id||id===queue.currentId)return;
    const entry=resolveQueueItem(id,queue);
    if(!entry)return;
    const candidate=entry.remote||tracks.find(item=>item.id===entry.trackId);
    const track=candidate?.kind==='online'?candidate:null;
    if(!entry.chart&&!track)return;
    const preparation={queue,entry,attempt:onlineConnectAttempt,loggedIn:onlineLoggedIn,
      accountRevision:onlineAccountRevision,controller:new AbortController(),result:null};
    preparation.promise=prepareNextOnlineEntry(entry,track,preparation).then(result=>{
      preparation.result=result;
      return result;
    });
    nextOnlinePreparation=preparation;
  }
  function showSkippedTracks(skipped,finished,previews=0,unverified=0){
    if(!skipped.length)return;
    const names=skipped.slice(0,3).map(name=>'「'+name+'」').join('、');
    const label=names+(skipped.length>3?'等 '+skipped.length+' 首歌曲':'');
    const reasons=[previews&&previews+' 首仅试听',unverified&&unverified+' 首未找到可确认的同版本'].filter(Boolean);
    showToast((reasons.length?'已跳过':'已跳过无法播放的')+label+(reasons.length?'（其中'+reasons.join('、')+'）':'')+
      (finished?'，队列里已没有可继续播放的歌曲。':'。'),finished);
  }
  function isNavidromeFailure(track,error){
    return track?.provider==='navidrome'||typeof error?.code==='string'&&error.code.startsWith('navidrome-');
  }
  function playbackFailureReason(error,track){
    if(isNavidromeFailure(track,error)&&[401,403].includes(error?.status))return 'auth';
    if(error?.code==='navidrome-auth'||error?.code==='navidrome-library'||isOnlineAuthError(error))return 'auth';
    if(error instanceof TypeError||error?.code==='unavailable'||error?.code==='network')return 'connection';
    if(error?.code==='timeout'||error?.name==='TimeoutError'||error?.status===429||error?.status===503)return 'timeout';
    if(error?.status>=500)return 'connection';
    return null;
  }
  function navidromeFailureMessage(track,error,reason=playbackFailureReason(error,track)){
    if(!isNavidromeFailure(track,error))return null;
    if(reason==='auth')return '请连接这首歌所属的 Navidrome 曲库。';
    if(reason==='connection'||reason==='timeout')return '请检查 Navidrome 服务器后重试。';
    return error?.message||'Navidrome 暂时无法播放这首歌。';
  }
  function isTrackPlaybackFailure(reason){return reason==='file'||reason==='unplayable'||reason==='resume-source';}
  function trackFailureReason(track,error){return error?.code==='resume-source'?'resume-source':track?.kind==='file'?'file':'unplayable';}
  function holdQueueFailure(queue,reason,position,manual,exhausted=false){
    queue.recovery={reason,position,...(manual?{manual:true}:{}),...(exhausted?{exhausted:true}:{})};
    queue.autoplay=false;queue.failed=true;
    if(playing||!audio.paused)pause(true);
    queueChanged();updatePlaying();
  }
  function recoverableQueueFailure(queue,error,position,manual=false){
    const track=queueTrackDetails(resolveQueueItem(queue.currentId,queue));
    const reason=playbackFailureReason(error,track);
    if(!reason)return false;
    const navidromeMessage=navidromeFailureMessage(track,error,reason);
    if(!navidromeMessage)onlineRequestFailure(error);
    holdQueueFailure(queue,reason,position,manual);
    const text=navidromeMessage?navidromeMessage+'当前歌曲和队列已保留。':reason==='auth'?'汽水登录已失效。当前歌曲和队列已保留，重新登录后可重试。'
      :'音乐入口暂时不可用。当前歌曲和队列已保留，可在播放器重试。';
    showToast(text,true);
    return true;
  }
  function retryTargetTrack(target){
    if(target.queue)return queueTrackDetails(resolveQueueItem(target.id,target.queue));
    return target.checkpoint?resumeTrack(target.checkpoint):currentTrack();
  }
  function holdResumeFailure(target,error){
    const track=retryTargetTrack(target);
    const online=track?.kind==='online'||track?.kind==='chart';
    const reason=(online&&playbackFailureReason(error,track))||trackFailureReason(track,error);
    if(target.queue){
      if(online&&recoverableQueueFailure(target.queue,error,target.recovery.position,true))return;
      holdQueueFailure(target.queue,reason,target.recovery.position,true);
      return;
    }
    target.checkpoint.recovery={reason,position:target.recovery.position,manual:true};
    persistResumePoint();
    if(online&&error&&!isNavidromeFailure(track,error))onlineRequestFailure(error);
    updatePlaying();
  }
  function currentPlaybackRecovery(){
    const queue=sessionQueue;
    if(queue?.recovery){
      const entry=resolveQueueItem(queue.currentId,queue);
      if(!entry)return null;
      const track=queueTrackDetails(entry);
      return {queue,id:entry.entryId,trackId:entry.trackId,recovery:queue.recovery,name:track?.name||'当前歌曲'};
    }
    const recovery=!queue&&standaloneRecovery;
    if(recovery&&recovery.id===activeId)return {queue:null,id:activeId,trackId:activeId,recovery,name:currentTrack()?.name||'当前歌曲'};
    if(deferredResume&&resumePoint?.recovery){
      return {checkpoint:resumePoint,queue:null,id:resumePoint.id,trackId:resumePoint.id,recovery:resumePoint.recovery,name:resumeTrack()?.name||'当前歌曲'};
    }
    return null;
  }
  function playbackRetryIsCurrent(attempt,resuming=false){
    if(!attempt||attempt!==playbackRetryAttempt||playing||externalStream||externalPending)return false;
    if(loadGeneration!==attempt.generation&&(!resuming||loadGeneration!==attempt.generation+1))return false;
    const {queue,id,recovery,checkpoint}=attempt.target;
    if(checkpoint)return deferredResume&&resumePoint===checkpoint&&(!queue||sessionQueue===queue&&queue.currentId===id);
    return queue?sessionQueue===queue&&queue.currentId===id&&(resuming||queue.recovery===recovery)
      :!sessionQueue&&activeId===id&&(resuming||standaloneRecovery===recovery);
  }
  function recoveryNext(target){
    if(!target||target.recovery.exhausted||
      (!target.recovery.manual&&!isTrackPlaybackFailure(target.recovery.reason)&&!(deferredResume&&resumePoint?.id===target.trackId)))return null;
    const next=target.queue?adjacentSessionEntry(target.queue,target.id,1):adjacentScopedTrack(target.id,1);
    return next!==target.id?next:null;
  }
  function canSkipRecovery(target){
    return !playing&&!busy&&!trackLoading&&!queueChartMatch&&!onlinePickTrack&&!externalStream&&!externalPending&&
      !instrumentOpen&&!clipLocked()&&Boolean(recoveryNext(target));
  }
  function playbackRecoveryView(){
    const attempt=playbackRetryAttempt;
    const pending=playbackRetryIsCurrent(attempt,attempt?.phase==='resuming');
    const target=currentPlaybackRecovery()||(pending?attempt.target:null);
    if(!target||externalStream||externalPending)return null;
    return {name:target.name,trackId:target.trackId,provider:retryTargetTrack(target)?.provider,reason:target.recovery.reason,position:target.recovery.position,
      phase:pending?attempt.phase:null,canSkip:!pending&&canSkipRecovery(target),exhausted:target.recovery.exhausted===true};
  }
  function recoveryTrack(){
    const queue=sessionQueue,entry=queue?.recovery&&resolveQueueItem(queue.currentId,queue);
    if(entry&&entry.trackId!==activeId)return queueTrackDetails(entry);
    if(deferredResume&&!playing&&activeId===resumePoint?.id&&!currentTrack())return resumeTrack();
    return null;
  }
  function queueTargetView(){
    const entry=queueChartMatch&&resolveQueueItem(sessionQueue?.currentId);
    const track=entry?.remote||entry?.chart||loadingTrack||onlinePickTrack;
    return track?{id:track.id,name:track.name,artist:track.artist||''}:null;
  }
  function clearPlaybackRetry(attempt){
    if(attempt!==playbackRetryAttempt)return;
    playbackRetryAttempt=null;
    window.dispatchEvent(new Event('sonic:transport-state'));
  }
  async function resumePlaybackRetry(attempt){
    try{
      if(!playbackRetryIsCurrent(attempt))return false;
      attempt.phase='resuming';
      window.dispatchEvent(new Event('sonic:transport-state'));
      const {queue,id,recovery,checkpoint}=attempt.target;
      if(queue)return await playQueueFrom(id,{position:recovery.position,retry:true,keepShuffle:true,retainEntryOnFailure:true,
        holdOnFailure:Boolean(checkpoint||deferredResume||recovery.manual||isTrackPlaybackFailure(recovery.reason))});
      if(!checkpoint){
        if(recovery.manual||isTrackPlaybackFailure(recovery.reason)){
          return await playScopedFrom(id,{position:recovery.position,keepShuffle:true,retry:true});
        }
        return await retryStandaloneOnline(recovery);
      }
      const outcome=await selectTrack(id,true,recovery.position,true,{retry:true,reportFailure:true,holdFailure:true});
      if(!outcome?.ok&&playbackRetryIsCurrent(attempt,true))holdResumeFailure(attempt.target,outcome?.error);
      return Boolean(outcome?.ok);
    }finally{clearPlaybackRetry(attempt);}
  }
  function retryPlayback(){return beginPlaybackRetry(currentPlaybackRecovery());}
  async function beginPlaybackRetry(target){
    if(!target||trackLoading||queueChartMatch||externalStream||externalPending||playing
      ||playbackRetryIsCurrent(playbackRetryAttempt,playbackRetryAttempt?.phase==='resuming'))return false;
    cancelOnlinePick();
    const attempt={target,generation:loadGeneration,phase:'connecting'};
    playbackRetryAttempt=attempt;window.dispatchEvent(new Event('sonic:transport-state'));
    try{
      const track=retryTargetTrack(target);
      const needsOnline=track?.kind==='chart'||track?.kind==='online'&&track.provider!=='navidrome';
      if(needsOnline&&!onlineReady)await connectOnlineMusic();
      if(!playbackRetryIsCurrent(attempt))return false;
      if(needsOnline&&!onlineReady){
        if(target.checkpoint&&!target.recovery.reason)holdResumeFailure(target,{code:'unavailable'});
        return false;
      }
      if(needsOnline&&target.recovery.reason==='auth'&&!onlineLoggedIn){
        const dialog=$('queueDialog');
        if(!dialog.open)$('queueBtn').click();
        document.querySelector('[data-library-view="soda"]')?.click();
        setOnlineProvider('qishui');
        attempt.phase='login';
        await startOnlineLogin();
        return false;
      }
      return await resumePlaybackRetry(attempt);
    }finally{
      if(attempt.phase!=='login'&&attempt.phase!=='resuming')clearPlaybackRetry(attempt);
    }
  }
  function retryQueue(){return sessionQueue?.recovery?retryPlayback():false;}
  function skipPlayback(){
    let target=currentPlaybackRecovery();
    if(!canSkipRecovery(target)||playbackRetryIsCurrent(playbackRetryAttempt,playbackRetryAttempt?.phase==='resuming'))return false;
    cancelOnlinePick();
    if(target.checkpoint&&!target.queue){
      prepareSessionQueue();
      target=currentPlaybackRecovery();
      if(!canSkipRecovery(target))return false;
    }
    const next=recoveryNext(target),excluded={id:target.id,name:target.name};
    return target.queue?playQueueFrom(next,{keepShuffle:true,excluded,skipFrom:target}):
      playScopedFrom(next,{automatic:true,keepShuffle:true,excluded});
  }
  async function playQueueFrom(id,{autoplay=true,direction=1,position=0,retry=false,keepShuffle=false,excluded=null,
    recoveringStream=false,retainEntryOnFailure=false,holdOnFailure=false,skipIneligible=false,skipFrom=null,automatic=false}={}){
    const queue=sessionQueue,first=resolveQueueItem(id,queue);
    if(!first||externalStream||externalPending||instrumentOpen||clipLocked())return false;
    queueChartMatch?.abort();
    if(trackLoading)loadAbort?.abort();
    const run=++queueRun;
    const preparation=nextOnlinePreparation;
    const usePreparation=autoplay&&!retry&&preparation?.queue===queue&&preparation.entry===first;
    if(usePreparation)nextOnlinePreparation=null;
    const tried=new Set(excluded?[excluded.id]:[]),skipped=excluded?[excluded.name]:[];
    let next=first.entryId,previews=0,unverified=0,automaticFailure=null;
    function holdOnlineFailure(error,at,manual){
      if(skipFrom)return false;
      if(!automatic)return recoverableQueueFailure(queue,error,at,manual);
      const track=queueTrackDetails(resolveQueueItem(next,queue));
      const reason=playbackFailureReason(error,track);
      if(reason&&!automaticFailure){
        automaticFailure={id:next,reason,position:at};
        if(!isNavidromeFailure(track,error))onlineRequestFailure(error);
      }
      return false;
    }
    while(next&&!tried.has(next)){
      const entry=resolveQueueItem(next,queue);
      if(!entry)break;
      tried.add(next);
      queue.currentId=next;queue.autoplay=autoplay;queue.failed=false;queue.recovery=null;
      if(!keepShuffle&&entry===first)resetShuffle();
      queueChanged();
      let prepared;
      if(entry===first&&usePreparation){
        const {controller}=preparation;
        queueChartMatch=controller;updatePlaying();
        try{
          prepared=await preparation.promise;
          if(controller.signal.aborted||run!==queueRun||queue!==sessionQueue)return false;
          if(preparation.attempt!==onlineConnectAttempt||(preparation.loggedIn&&!onlineLoggedIn))prepared=null;
          if(prepared?.track&&entry.chart&&!entry.remote){
            if(prepared.track.kind==='online')entry.remote=prepared.track;
            entry.trackId=prepared.track.id;queueChanged();
          }
        }finally{if(queueChartMatch===controller){queueChartMatch=null;updatePlaying();}}
      }
      if(entry.chart&&!entry.remote&&!tracks.some(track=>track.id===entry.trackId&&track.kind==='file'&&track.blob)){
        const abort=new AbortController();queueChartMatch=abort;updatePlaying();
        try{
          const matched=await resolveChartEntry(entry.chart,abort.signal);
          if(abort.signal.aborted||run!==queueRun||queue!==sessionQueue)return false;
          if(matched){
            if(matched.kind==='online')entry.remote=matched;
            entry.trackId=matched.id;queueChanged();
          }
        }catch(error){
          if(abort.signal.aborted||run!==queueRun||queue!==sessionQueue)return false;
          if(holdOnlineFailure(error,entry===first?position:0,holdOnFailure&&entry===first)){
            showSkippedTracks(skipped,false,previews,unverified);return false;
          }
        }finally{if(queueChartMatch===abort){queueChartMatch=null;updatePlaying();}}
      }
      const track=entry.remote?mergeOnlineTrack(entry.remote):tracks.find(item=>item.id===entry.trackId);
      if(entry.remote&&track)void persistLibrary();
      const ticket=track?.mediaId===prepared?.track?.mediaId?prepared?.ticket:null;
      const outcome=track?await selectTrack(track.id,autoplay,entry===first?position:0,true,
        {queue,retry:entry===first&&retry,ticket,recoveringStream:entry===first&&recoveringStream,
          keepMediaOnTicketFailure:automatic,reconnectOnline:entry===first&&!automatic&&!skipFrom}):{ok:false};
      if(run!==queueRun||queue!==sessionQueue||!outcome)return false;
      if(outcome.ok){showSkippedTracks(skipped,false,previews,unverified);return true}
      if(track?.kind==='online'&&holdOnlineFailure(outcome.error,entry===first?position:0,(holdOnFailure||recoveringStream)&&entry===first)){
        showSkippedTracks(skipped,false,previews,unverified);return false;
      }
      if(outcome.error?.name==='NotAllowedError'){
        queue.autoplay=false;showToast('音乐已准备好，请点击播放按钮开始。');return false;
      }
      const previewOnly=outcome.error?.code==='preview-only';
      const unmatchedChart=entry.chart&&!track;
      if(holdOnFailure&&entry===first&&!(skipIneligible&&(unmatchedChart||queue.fullOnly&&previewOnly))){
        holdQueueFailure(queue,trackFailureReason(track||entry.file,outcome.error),position,true);return false;
      }
      if((recoveringStream||retainEntryOnFailure)&&entry===first){
        if(outcome.error?.code==='resume-source'){
          holdQueueFailure(queue,'resume-source',position,true);
          showToast(outcome.error.message,true);
        }else recoverableQueueFailure(queue,{code:'timeout',message:'在线音频播放中断。'},position,true);
        return false;
      }
      if(previewOnly)previews++;
      if(unmatchedChart)unverified++;
      queue.failed=true;
      skipped.push(track?.name||entry.remote?.name||entry.chart?.name||entry.file?.name||'已移除的歌曲');
      next=adjacentSessionEntry(queue,next,direction);
    }
    if(skipFrom){
      queue.currentId=skipFrom.id;
      holdQueueFailure(queue,skipFrom.recovery.reason,skipFrom.recovery.position,true,true);
    }else if(automaticFailure){
      queue.currentId=automaticFailure.id;
      holdQueueFailure(queue,automaticFailure.reason,automaticFailure.position,true,true);
    }else{queue.autoplay=false;updatePlaying();saveSession();}
    showSkippedTracks(skipped,true,previews,unverified);
    return false;
  }
  function skipFailedCurrent(){
    const queue=sessionQueue,entry=resolveQueueItem(queue?.currentId,queue);
    if(!entry)return;
    const name=currentTrack()?.name||entry.remote?.name||'当前歌曲';
    const next=adjacentSessionEntry(queue,entry.entryId,1);
    pause(true);queue.failed=true;
    if(next&&next!==entry.entryId){void playQueueFrom(next,{excluded:{id:entry.entryId,name},keepShuffle:true,automatic:true});return}
    queue.autoplay=false;showSkippedTracks([name],true);
  }
  function adjacentScopedTrack(id,direction,wrap=playbackMode!=='sequence'){
    const songs=scopedPlaybackTracks(),index=songs.findIndex(track=>track.id===id);
    const next=index<0?(direction>0?0:songs.length-1):index+direction;
    return songs[next]?.id||(songs.length&&wrap?songs[(next+songs.length)%songs.length].id:null);
  }
  function holdScopedFailure(track,error,position,{manual=false,exhausted=false}={}){
    const globalReason=track.kind==='online'?playbackFailureReason(error,track):null;
    if(globalReason&&!isNavidromeFailure(track,error))onlineRequestFailure(error);
    standaloneRecovery={id:track.id,position,reason:globalReason||trackFailureReason(track,error),manual,exhausted};
    if(playing||!audio.paused)pause();
    updatePlaying();
  }
  function nextUntriedShuffle(tried){
    if(!shuffleIds().some(id=>!tried.has(id)))return null;
    let next;
    do{next=nextShuffle();}while(next&&tried.has(next));
    return next;
  }
  async function playScopedFrom(id,{autoplay=true,position=0,automatic=false,keepShuffle=false,retry=false,excluded=null}={}){
    if(tracks.some(track=>track.id===id&&track.kind==='soda'))return selectTrack(id,autoplay,position,keepShuffle);
    const tried=new Set(excluded?[excluded.id]:[]),skipped=excluded?[excluded.name]:[];
    let next=id;
    while(next&&!tried.has(next)){
      const track=tracks.find(item=>item.id===next&&isPlayableTrack(item));
      if(!track)break;
      const first=next===id,targetPosition=first?position:0;
      tried.add(next);
      const token=loadGeneration+1;
      const outcome=await selectTrack(next,autoplay,targetPosition,keepShuffle||!first,
        {retry:first&&retry,reportFailure:true,holdFailure:true,reconnectOnline:first&&!automatic});
      if(token!==loadGeneration||sessionQueue||!outcome)return false;
      if(outcome.ok){showSkippedTracks(skipped,false);return true}
      if(outcome.error?.name==='NotAllowedError'){
        showToast('音乐已准备好，请点击播放按钮开始。');return false;
      }
      if(!automatic){
        holdScopedFailure(track,outcome.error,targetPosition,{manual:!automatic});
        showSkippedTracks(skipped,false);return false;
      }
      skipped.push(track.name);
      next=playbackMode==='shuffle'?nextUntriedShuffle(tried):
        adjacentScopedTrack(next,1,playbackMode==='list');
      if(!next||tried.has(next))holdScopedFailure(track,outcome.error,targetPosition,{exhausted:true});
    }
    updatePlaying();saveSession();showSkippedTracks(skipped,true);
    return false;
  }
  function navigateTrack(direction){
    if(externalStream){showToast('请在原播放器切换歌曲。');return}
    cancelOnlinePick();
    if(sessionQueue){
      if(trackLoading||queueChartMatch){showToast('正在准备音乐，请稍候。');return}
      const mode=sessionQueue.mode;
      const next=mode==='shuffle'?nextShuffle(direction):adjacentSessionEntry(sessionQueue,sessionQueue.currentId,direction);
      if(next)void playQueueFrom(next,{autoplay:playing,direction,keepShuffle:true,holdOnFailure:true,skipIneligible:true});
      else if(mode!=='shuffle')showToast(direction>0?'已经是队列最后一首。':'已经是队列第一首。');
      return;
    }
    const songs=scopedPlaybackTracks();if(!songs.length){showToast('当前播放范围里还没有可播放歌曲。');return}
    if(trackLoading||pendingFile||onlinePending||busy){showToast('正在准备音乐，请稍候。');return}
    const next=playbackMode==='shuffle'?nextShuffle(direction):adjacentScopedTrack(activeId,direction);
    if(next)void playScopedFrom(next,{autoplay:playing,keepShuffle:playbackMode==='shuffle'});
    else if(playbackMode!=='shuffle')showToast(direction>0?'已经是列表最后一首。':'已经是列表第一首。');
  }

  function isImportAudio(file){return file.type.startsWith('audio/')||['mp3','wav','ogg','m4a','aac','flac','opus','webm','aif','aiff','mp4'].includes(file.name.split('.').pop().toLowerCase())}
  function importFilePath(file){return folderPaths.get(file)||file.webkitRelativePath||file.name}
  function importStem(file){return importFilePath(file).replaceAll('\\','/').replace(/\.[^.\/]+$/,'').toLowerCase()}
  const importedLyricOrigins=['online','embedded','sidecar'];
  function hasProtectedLocalLyrics(track,lyrics=atelier.songs[track?.id]?.lyrics){
    return Boolean(track?.manualFields?.lyrics||lyrics&&!importedLyricOrigins.includes(lyrics.origin));
  }
  function lyricRecord(art,raw,translationRaw,origin){
    return {offset:art?.lyricOffset??0,size:'medium',only:true,enabled:true,...art?.lyrics,raw,translationRaw,origin};
  }
  function validImportedLyrics(raw){
    return typeof raw==='string'&&raw.length>0&&raw.length<=160000&&parseLRC(raw).some(line=>line.text);
  }
  function attachImportedLyrics(id,raw,translationRaw='',origin='online',managed=false){
    const art=atelier.songs[id],existing=art?.lyrics;
    if(hasProtectedLocalLyrics(tracks.find(track=>track.id===id),existing))return false;
    const acceptsSource=!existing||importedLyricOrigins.indexOf(origin)>importedLyricOrigins.indexOf(existing.origin)||
      managed&&origin===existing.origin;
    const replaces=acceptsSource&&((raw&&raw===existing?.raw)||validImportedLyrics(raw));
    if(!existing&&!replaces)return false;
    const previousTranslation=existing?.translationRaw||'';
    const acceptsTranslation=!previousTranslation||managed&&replaces&&origin==='sidecar';
    const translation=acceptsTranslation&&validImportedLyrics(translationRaw)?translationRaw:previousTranslation;
    const nextRaw=replaces?raw:existing.raw;
    const nextOrigin=replaces?origin:existing.origin;
    if(existing&&nextRaw===existing.raw&&nextOrigin===existing.origin&&translation===previousTranslation)return false;
    (atelier.songs[id]||={}).lyrics=lyricRecord(art,nextRaw,translation,nextOrigin);
    return true;
  }
  async function refreshFolderLyrics(track,sidecar,embedded,managed){
    if(hasProtectedLocalLyrics(track))return false;
    const read=async file=>await file?.text().catch(()=>'')||'';
    const translation=await read(sidecar?.translation);
    const existing=atelier.songs[track.id]?.lyrics;
    if(managed||existing?.origin!=='sidecar'){
      for(const format of ['yrc','krc','qrc','ttml','vtt','lrc']){
        const raw=await read(sidecar?.[format]);
        if(!raw||raw!==existing?.raw&&!validImportedLyrics(raw))continue;
        if(hasProtectedLocalLyrics(track))return false;
        return {matched:true,translation:validImportedLyrics(translation),changed:attachImportedLyrics(track.id,raw,translation,'sidecar',managed)};
      }
    }
    if(hasProtectedLocalLyrics(track))return false;
    const changed=attachImportedLyrics(track.id,embedded,translation,'embedded',managed);
    return {matched:validImportedLyrics(embedded),translation:changed&&validImportedLyrics(translation),changed};
  }
  function refreshImportBusy(){
    const busy=importing||folderScanning;
    for(const id of ['uploadBtn','queueImportBtn','folderImportBtn'])$(id).disabled=busy;
    $('queueDialog').setAttribute('aria-busy',String(busy));
    window.dispatchEvent(new Event('sonic:library-change'));
  }
  function importBlockedReason(fromScan=false){
    if(libraryReadFailed)return libraryReadError;
    if(instrumentOpen)return '请先关闭乐器台，再导入音乐。';
    if(clipLocked())return '请先结束短片录制，再导入音乐。';
    if(importing||folderScanning&&!fromScan)return '这一批音乐正在读取，请稍候再添加。';
    return '';
  }
  function showImportFailure(item){
    const li=document.createElement('li');li.textContent=item.path+'：'+item.reason;$('importFailureList').append(li);
    $('importFailures').hidden=false;$('importFailures').open=true;
  }
  function reportImport(message,{busy=false,completed=0,total=0,details=[],error=false,addedIds=[]}={}){
    $('importStatus').textContent=message;
    $('importStatus').classList.toggle('error',error);
    lastImportedIds=addedIds;
    $('playImportedBtn').hidden=!addedIds.length;
    libraryImportReport={message,busy,completed,total,error,added:addedIds.length,details:details.slice(0,50),detailCount:details.length};
    window.dispatchEvent(new Event('sonic:import-progress'));
  }
  function probeImportedAudio(file,position=null){
    return new Promise((resolve,reject)=>{
      const probe=new Audio();let url=null,settled=false;
      const timer=setTimeout(()=>finish(new Error('音频读取超时（12 秒），请检查文件是否能在本机播放后重试。')),12000);
      function finish(error){
        if(settled)return;settled=true;clearTimeout(timer);
        const length=probe.duration;
        probe.onloadedmetadata=probe.onloadeddata=probe.oncanplay=probe.onseeked=probe.onerror=null;
        probe.removeAttribute('src');probe.load();
        if(url)URL.revokeObjectURL(url);
        if(error)reject(error);else resolve(length);
      }
      function readyAtPosition(){
        if(!probe.seeking&&probe.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA&&Math.abs(probe.currentTime-position)<.1)finish();
      }
      probe.preload=position===null?'metadata':'auto';
      probe.onloadedmetadata=()=>{
        if(!Number.isFinite(probe.duration)||probe.duration<=0){
          finish(new Error('音频没有有效时长，可能已损坏或不是完整的音频文件。'));
        }else if(position===null)finish();
        else if(probe.duration<=position)finish(new Error('这份音频无法跳到上次的进度，请选择原曲文件。'));
        else if(position>0)probe.currentTime=position;
        else readyAtPosition();
      };
      if(position!==null)probe.onloadeddata=probe.oncanplay=probe.onseeked=readyAtPosition;
      probe.onerror=()=>{
        const code=probe.error?.code;
        const reasons={1:'音频读取被中断，请重新导入。',2:'无法读取音频数据，请检查文件访问权限后重试。',3:'音频解码失败，文件可能已损坏。',4:'无法解码：文件可能已损坏，或当前浏览器不支持其音频编码。'};
        finish(new Error(reasons[code]||'浏览器未能读取这首音频，请确认文件完整且编码受支持。'));
      };
      try{url=URL.createObjectURL(file);probe.src=url;probe.load()}catch(error){finish(new Error('无法读取文件：'+(error.message||'请检查访问权限')))}
    });
  }
  function playImportedMusic(){
    const ids=lastImportedIds.filter(id=>tracks.some(track=>track.id===id&&isPlayableTrack(track)));
    if(!ids.length){showToast('这次导入的歌曲已不在曲库。');return;}
    return window.SonicPlayback.playFromLibrary(ids[0],'imported',true,ids);
  }
  function confirmFolderChanges(summary,details){
    const dialog=document.createElement('dialog');
    dialog.className='lr-dialog';dialog.setAttribute('aria-labelledby','folderReviewTitle');
    dialog.innerHTML='<h2 id="folderReviewTitle">确认文件夹扫描结果</h2><p role="status"></p><ul></ul>'+
      '<form method="dialog" class="lr-choice-row"><button type="submit" class="lr-choice" value="cancel">取消</button>'+
      '<button type="submit" class="lr-primary" value="apply">应用扫描结果</button></form>';
    dialog.querySelector('[role=status]').textContent=summary;
    const list=dialog.querySelector('ul');
    for(const detail of details.slice(0,200)){
      const entry=document.createElement('li');entry.textContent=[detail.path,detail.reason].filter(Boolean).join(' · ');
      list.append(entry);
    }
    if(details.length>200){
      const extra=document.createElement('li');extra.textContent='另有 '+(details.length-200)+' 条，可在应用后查看导入记录。';list.append(extra);
    }
    (document.getElementById('listeningRoom')||app).append(dialog);
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='apply';dialog.remove();resolve(accepted);},{once:true});
      dialog.showModal();
    });
  }
  async function importFiles(selection,scanErrors=[],fromScan=false,managedFolder=false,folderKey=null){
    const blocked=importBlockedReason(fromScan);
    if(blocked){if(fromScan){reportImport(blocked,{error:true});$('importProgress').hidden=true}showToast(blocked);return false}
    const selected=Array.from(selection||[]);if(!selected.length&&!scanErrors.length&&!folderKey)return false;
    importing=true;refreshImportBusy();
    const {files,sidecars,other}=SonicFolderLibrary.groupFiles(selected,isImportAudio,importFilePath,SonicLyricKaraoke.classifySidecar);
    const added=[],failed=scanErrors.slice(),importedIds=new Set(),details=[];
    const skippedFiles=other.map(file=>({path:importFilePath(file),reason:SonicLyricKaraoke.classifySidecar(importFilePath(file))
      ?'歌词没有匹配的音频，或超出大小限制。':'不是受支持的音频格式。'}));
    let duplicates=0,relinked=0,restored=0;
    let lyricMatches=0,lyricChanges=0,translationMatches=0;
    const progress=$('importProgress');progress.hidden=!files.length;progress.max=Math.max(1,files.length);progress.value=0;
    reportImport('准备导入 · 共 '+files.length+' 首音频',{busy:true,total:files.length});
    $('importFailures').hidden=true;$('importFailures').open=false;$('importFailureList').replaceChildren();
    for(const item of failed)showImportFailure(item);
    for(const item of skippedFiles)showImportFailure(item);
    try{
      if(!libraryReady)await libraryPromise;
      if(libraryReadFailed)throw new Error(libraryReadError);
      await atelierPromise;
      const anchor=selected.find(file=>importFilePath(file).includes('/'));
      const sourceFolder=folderKey||(managedFolder&&anchor?await window.sonicDesktop?.folderImportKey?.(anchor,importFilePath(anchor)).catch(()=>null):null);
      const review=Boolean(folderKey&&tracks.some(track=>track.sourceFolder));
      const originals=review?new Map(tracks.map(track=>[track.id,track])):null;
      const staged=review?tracks.map(track=>({...track})):tracks;
      const scan=SonicFolderLibrary.reconcile(staged,sourceFolder,files,importFilePath);
      const draftEdits=new Set(),pendingLyrics=[];
      const tagReader=files.length?await loadFeatureScript('local-file-tags.js','SonicFileTags').catch(()=>null):null;
      const targetPlaylist=playlists.find(p=>p.id===libraryView);
      const refreshed=new Set();
      let unchangedScan=0,scanMetadataChanged=false;
      for(let i=0;i<files.length;i++){
        const source=files[i],filePath=importFilePath(source);
        reportImport('正在读取 '+(i+1)+' / '+files.length+' · '+filePath,{busy:true,completed:i,total:files.length});
        try{
          if(!source.size)throw new Error('文件为空（0 字节），无法读取音频。');
          const verified=folderKey&&scan.unchanged(source,filePath);
          const file=verified?source:source.getFile?await source.getFile():source;
          const signature=SonicFolderLibrary.fingerprint(file);
          const match=verified||await scan.match(file,filePath);
          if(verified)unchangedScan++;
          if(match.ambiguous)throw new Error('有多个旧条目与此文件匹配，已跳过以保留原有记录。');
          if(match.duplicateCopy){
            duplicates++;
            details.push({path:filePath,reason:'内容与仍在原位置的文件相同，跳过副本'});
            continue;
          }
          let track=match.track;
          let embeddedLyrics='';
          if(match.unchanged){
            if(match.relinked){
              Object.assign(track,{sourceFolder,sourcePath:filePath,signature,sourceMissing:false});
              relinked++;
              details.push({path:filePath,reason:'已接回原曲库条目。'});
            }else if(sourceFolder&&track.sourceMissing){
              track.sourceMissing=false;
              restored++;
              details.push({path:filePath,reason:'已找回原文件。'});
            }else{
              duplicates++;
              if(review&&details.length<200)details.push({path:filePath,reason:'已存在或原文件未改'});
            }
            if(sourceFolder&&(track.signature!==signature||track.sourcePath!==filePath)){
              Object.assign(track,{signature,sourcePath:filePath});
              scanMetadataChanged=true;
            }
          }
          else {
            const length=await probeImportedAudio(file);
            const audioDigest=await SonicFolderLibrary.audioDigest(file);
            const tags=await tagReader?.read(file).catch(()=>null);
            const labels={name:tags?.title||file.name.replace(/\.[^.]+$/,'')||file.name,artist:tags?.artist||'',album:tags?.album||'',cover:tags?.cover||null};
            embeddedLyrics=tags?.lyrics||'';
            if(track){
              for(const field of Object.keys(SonicFolderLibrary.manualFields(track)))delete labels[field];
              refreshed.add(track.id);
              details.push({path:filePath,reason:'已更新音频。'});
            }else{
              track={id:newId('track'),kind:'file',favorite:false,sourceFolder};
              added.push(track);
              details.push({path:filePath,reason:'新增音频'});
            }
            Object.assign(track,labels,{duration:length,blob:file,stored:false,signature,audioDigest,sourcePath:filePath,sourceMissing:false});
          }
          scan.remember(track);
          importedIds.add(track.id);
          const sidecar=sidecars.get(importStem(source));
          const stamp=folderKey?JSON.stringify(Object.entries(sidecar||{}).sort().map(([format,file])=>[format,SonicFolderLibrary.fingerprint(file)])):null;
          const readLyrics=!folderKey||!match.unchanged||track.sidecarStamp!==stamp;
          if(review&&readLyrics)pendingLyrics.push({track,sidecar,embeddedLyrics});
          const lyricResult=!review&&readLyrics&&await refreshFolderLyrics(track,sidecar,embeddedLyrics,Boolean(sourceFolder));
          if(review&&originals.has(track.id))draftEdits.add(track);
          if(folderKey&&stamp.length<=500&&track.sidecarStamp!==stamp){
            track.sidecarStamp=stamp;
            scanMetadataChanged=true;
          }
          if(lyricResult?.matched)lyricMatches++;
          if(lyricResult?.translation)translationMatches++;
          if(lyricResult?.changed)lyricChanges++;
        }catch(error){const failure={path:filePath,reason:error.message||'音频读取失败，请检查文件。'};failed.push(failure);showImportFailure(failure)}
        finally{
          progress.value=i+1;
          // Yield between files so progress and failures remain visible even for duplicates or empty files.
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      const missing=scanErrors.length?[]:scan.removed();
      for(const track of missing){
        track.sourceMissing=true;
        if(review)draftEdits.add(track);
        details.push({path:track.sourcePath,reason:'原文件已移走，本机副本仍可播放。'});
      }
      if(review){
        const summary=['新增 '+added.length+' 首','重新关联 '+relinked+' 首','重复或未改 '+duplicates+' 首',
          '更新 '+refreshed.size+' 首','原文件移走 '+missing.length+' 首','读取失败 '+failed.length+' 项'].join(' · ');
        const changed=added.length||relinked||refreshed.size||missing.length||restored||scanMetadataChanged;
        if(changed||failed.length){
          if(!await confirmFolderChanges(summary,[...details,...failed,...skippedFiles])){
            reportImport('已取消应用扫描结果，曲库和歌单未修改。');
            return false;
          }
        }
        for(const draft of draftEdits){
          const original=originals.get(draft.id);
          if(!tracks.includes(original))continue;
          const {favorite,...metadata}=draft;
          Object.assign(original,metadata);
        }
        for(const {track,sidecar,embeddedLyrics} of pendingLyrics){
          if(originals.has(track.id)&&!tracks.includes(originals.get(track.id)))continue;
          const result=await refreshFolderLyrics(track,sidecar,embeddedLyrics,Boolean(sourceFolder));
          if(result?.matched)lyricMatches++;
          if(result?.translation)translationMatches++;
          if(result?.changed)lyricChanges++;
        }
      }
      // Keep the implicit playback list and shuffle history independent of library writes.
      const scopedIds=!sessionQueue&&scopedPlaybackTracks().map(track=>track.id);
      tracks.push(...added);
      let memberships=0;
      if(targetPlaylist&&playlists.includes(targetPlaylist)){
        const existing=new Set(targetPlaylist.trackIds);
        for(const id of importedIds)if(!existing.has(id)){targetPlaylist.trackIds.push(id);memberships++}
      }
      if(scopedIds&&scopedPlaybackTracks().length!==scopedIds.length){
        playbackScopeOrder={scope:playbackScope,ids:scopedIds};
        if(deferredResume&&resumePoint){
          resumePoint.scopeOrder=scopedIds;
          persistResumePoint();
        }else saveSession();
      }
      let saved=true;
      if(added.length||memberships||refreshed.size||missing.length||restored||relinked||lyricChanges||scanMetadataChanged)saved=await persistLibrary(Boolean(lyricChanges));
      renderPlaylist();
      if(lyricChanges){lyricCache=null;lyricIndex=-1;window.dispatchEvent(new Event('sonic:transport-state'));}
      if(lyricChanges||refreshed.has(activeId))renderActiveTrack();
      const skipped=duplicates+failed.length+skippedFiles.length;
      const changes=['新增 '+added.length+' 首','跳过 '+skipped+' 个文件'+(duplicates?'（含 '+duplicates+' 首重复）':''),'匹配 '+lyricMatches+' 份歌词'+(translationMatches?'（含 '+translationMatches+' 份译文）':''),
        unchangedScan&&unchangedScan+' 首原文件无改动',refreshed.size&&'更新 '+refreshed.size+' 首',relinked&&'重新关联 '+relinked+' 首',restored&&'恢复来源 '+restored+' 首',
        missing.length&&missing.length+' 首原文件已移走，本机副本可播放',memberships&&memberships+' 首加入歌单'].filter(Boolean);
      const message=(managedFolder?'文件夹扫描完成':'导入完成')+' · '+changes.join(' · ')+'。'+(saved?'':'更改尚未保存，请保留应用并重试保存。');
      progress.value=progress.max;
      reportImport(message,{error:!saved||failed.length>0,addedIds:added.map(track=>track.id),details:[...failed,...skippedFiles,...details]});
      showToast(message,!saved||!importedIds.size&&failed.length>0,added.length>0,true);
      return saved;
    }catch(error){reportImport('导入中断：'+(error.message||'请重试'),{error:true});progress.hidden=true;showToast('音乐导入中断，请重试。',true);return false}
    finally{importing=false;refreshImportBusy()}
  }

  async function addDemo(autoplay=false){
    if(!libraryReady)await libraryPromise;
    let demo=tracks.find(t=>t.id==='demo');
    if(!demo){demo=makeDemo();tracks.push(demo);persistLibrary();renderPlaylist()}
    if(autoplay){if(!collectionTracks(playbackScope).some(t=>t.id===demo.id)){playbackScope='all';persistLibrary();renderLibraryControls()}await selectTrack(demo.id,true)}else if(!activeId&&!externalStream&&!externalPending)await selectTrack(demo.id,false);
  }
  function updatePlaybackMode(){
    queueMicrotask(cancelChangedAlbumRun);
    repeat=playbackMode==='single';const button=$('repeatBtn'),effectiveMode=effectivePlaybackMode();
    button.classList.toggle('active',effectiveMode!=='sequence');button.setAttribute('aria-pressed',String(effectiveMode!=='sequence'));
    button.setAttribute('aria-label','播放方式：'+playbackLabels[effectiveMode]+'，点击切换');button.title=playbackLabels[effectiveMode];
    let mark=button.querySelector('.repeat-mark');
    if(!mark){mark=document.createElement('span');mark.className='repeat-mark';mark.setAttribute('aria-hidden','true');button.append(mark)}
    mark.textContent=effectiveMode==='single'?'1':effectiveMode==='sequence'?'→':effectiveMode==='shuffle'?'⤨':'';
    $('playbackMode').value=effectiveMode;
  }
  function setPlaybackMode(mode){
    if(!Object.hasOwn(playbackLabels,mode))return;
    if(sessionQueue)sessionQueue.mode=mode;
    else playbackMode=mode;
    resetShuffle();updatePlaybackMode();
    if(!sessionQueue)savePreferences();
    queueChanged();
  }

  let backgroundLayer=null;
  function loadPersonalPreferences(){
    try{
      const prefs=JSON.parse(localStorage.getItem('sonic-universe-preferences')||'null');
      if(prefs){
        if(Object.hasOwn(playbackLabels,prefs.playbackMode))playbackMode=prefs.playbackMode;
        else if(typeof prefs.repeat==='boolean')playbackMode=prefs.repeat?'single':'sequence';
        if(prefs.space&&typeof prefs.space==='object'){
          for(const [key,max] of [['title',32],['description',120],['caption',48]])if(typeof prefs.space[key]==='string')space[key]=prefs.space[key].slice(0,max);
          if(Number.isFinite(prefs.space.darkness))space.darkness=clamp(prefs.space.darkness,20,90);
        }
      }
    }catch{storageIssues.add('preferences')}
    applySpace(true);updatePlaybackMode();
  }
  function applySpace(syncFields=false){
    const title=space.title.trim()?space.title:defaultSpace.title,lines=title.split('\n'),heading=$('spaceTitle');
    heading.replaceChildren();
    lines.forEach((line,index)=>{if(index)heading.append(document.createElement('br'));const span=document.createElement('span');span.textContent=line;if(index<lines.length-1)span.style.color='inherit';heading.append(span)});
    heading.classList.toggle('long-title',title.replace(/\n/g,'').length>14||lines.length>2);
    $('spaceDescription').textContent=space.description;
    $('spaceCaption').textContent=space.caption;
    if(syncFields){$('spaceTitleInput').value=space.title;$('spaceDescriptionInput').value=space.description;$('spaceCaptionInput').value=space.caption}
    $('backgroundDarkness').value=space.darkness;$('backgroundDarknessValue').value=Math.round(space.darkness)+'%';setFill($('backgroundDarkness'));
    requestAnimationFrame(resize);
  }
  function rebuildBackground(){
    backgroundLayer=null;
    if(!backgroundImage||!w||!h)return;
    const surface=document.createElement('canvas');surface.width=Math.round(w*dpr);surface.height=Math.round(h*dpr);
    const context=surface.getContext('2d');context.setTransform(dpr,0,0,dpr,0,0);
    const scale=Math.max(w/backgroundImage.naturalWidth,h/backgroundImage.naturalHeight),width=backgroundImage.naturalWidth*scale,height=backgroundImage.naturalHeight*scale;
    context.fillStyle='#080911';context.fillRect(0,0,w,h);context.drawImage(backgroundImage,(w-width)/2,(h-height)/2,width,height);
    context.fillStyle='rgba(8,9,17,'+(space.darkness/100)+')';context.fillRect(0,0,w,h);
    backgroundLayer=surface;
  }
  async function applyBackground(data){
    const token=++backgroundRequest;
    if(!data){
      backgroundData=null;backgroundImage=null;backgroundLayer=null;
      $('backgroundThumb').hidden=true;$('backgroundThumb').removeAttribute('src');$('backgroundPlaceholder').hidden=false;
      app.dataset.background='starfield';$('removeBackgroundBtn').disabled=true;return;
    }
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('背景图片无法读取，请重新选择。'));image.src=data});
    if(token!==backgroundRequest)return;
    backgroundData=data;backgroundImage=image;rebuildBackground();
    $('backgroundThumb').src=data;$('backgroundThumb').hidden=false;$('backgroundPlaceholder').hidden=true;
    $('removeBackgroundBtn').disabled=false;app.dataset.background='custom';
  }
  async function prepareImage(file,cover=false){
    if(!file||!['image/jpeg','image/png','image/webp','image/avif','image/gif'].includes(file.type))throw new Error('请选择有效的图片文件。');
    if(file.size>40*1024*1024)throw new Error('图片超过 40 MB，请先缩小图片。');
    const url=URL.createObjectURL(file),image=new Image();
    try{
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('图片读取超时，请换一张。')),15000);
        image.onload=()=>{clearTimeout(timer);resolve()};image.onerror=()=>{clearTimeout(timer);reject(new Error('这张图片无法读取，请换一张。'))};image.src=url;
      });
      if(!image.naturalWidth||!image.naturalHeight)throw new Error('这张图片没有有效尺寸。');
      const surface=document.createElement('canvas'),context=surface.getContext('2d');
      if(cover){
        surface.width=surface.height=360;const side=Math.min(image.naturalWidth,image.naturalHeight);
        context.fillStyle='#080911';context.fillRect(0,0,360,360);context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,360,360);
      }else{
        const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
        surface.width=Math.max(1,Math.round(image.naturalWidth*scale));surface.height=Math.max(1,Math.round(image.naturalHeight*scale));
        context.fillStyle='#080911';context.fillRect(0,0,surface.width,surface.height);context.drawImage(image,0,0,surface.width,surface.height);
      }
      return surface.toDataURL('image/webp',.86);
    }finally{image.onload=null;image.onerror=null;URL.revokeObjectURL(url)}
  }
  function openSpaceDialog(id){
    if(id==='studioDialog'){renderActiveTrack();primeHistory('studio')}
    $(id).showModal();
    if(id==='queueDialog'){
      legacyQueuePage=0;
      renderLegacyQueue();
    }
  }
  function chooseCover(){
    const track=currentTrack();if(!track){showToast('先添加或选择一首音乐，再为它设置封面。');return}
    coverTargetId=track.id;$('coverInput').click();
  }
  function setupEditionThree(){
    loadPersonalPreferences();
    $('queueBtn').addEventListener('click',()=>openSpaceDialog('queueDialog'));
    $('studioBtn').addEventListener('click',()=>openSpaceDialog('studioDialog'));
    $('queueImportBtn').addEventListener('click',()=>$('fileInput').click());
    $('queueDemoBtn').addEventListener('click',()=>addDemo(false));
    $('playbackMode').addEventListener('change',()=>setPlaybackMode($('playbackMode').value));
    document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
    document.querySelectorAll('.space-dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}));
    for(const [id,key] of [['spaceTitleInput','title'],['spaceDescriptionInput','description'],['spaceCaptionInput','caption']]){
      $(id).addEventListener('input',()=>{space[key]=$(id).value;applySpace();savePreferences()});
    }
    $('resetTextBtn').addEventListener('click',()=>{for(const key of ['title','description','caption'])space[key]=defaultSpace[key];applySpace(true);savePreferences();showToast('空间文字已恢复默认。')});
    $('chooseBackgroundBtn').addEventListener('click',()=>$('backgroundInput').click());
    $('backgroundPreview').addEventListener('click',()=>$('backgroundInput').click());
    $('backgroundInput').addEventListener('change',async()=>{
      const file=$('backgroundInput').files[0];$('backgroundInput').value='';if(!file)return;
      if(!libraryReady)await libraryPromise;
      $('chooseBackgroundBtn').disabled=true;
      try{const data=await prepareImage(file);await applyBackground(data);persistBackground();showToast('背景已换好，你的星空有了新的风景。')}
      catch(error){showToast(error.message,true)}
      finally{$('chooseBackgroundBtn').disabled=false}
    });
    $('removeBackgroundBtn').addEventListener('click',async()=>{await applyBackground(null);persistBackground();showToast('已恢复原来的星空背景。')});
    $('backgroundDarkness').addEventListener('input',()=>{space.darkness=Number($('backgroundDarkness').value);$('backgroundDarknessValue').value=space.darkness+'%';setFill($('backgroundDarkness'));rebuildBackground();savePreferences()});
    $('chooseCoverBtn').addEventListener('click',chooseCover);$('coverPreview').addEventListener('click',chooseCover);
    $('albumButton').addEventListener('click',()=>openSpaceDialog('studioDialog'));
    $('coverInput').addEventListener('change',async()=>{
      const file=$('coverInput').files[0],id=coverTargetId;$('coverInput').value='';if(!file)return;
      $('chooseCoverBtn').disabled=true;
      try{
        const data=await prepareImage(file,true),track=tracks.find(t=>t.id===id);
        if(!track){showToast('这首歌已经从列表移除，请为其他歌曲选择封面。');return}
        track.cover=data;(track.manualFields||={}).cover=true;persistLibrary();renderPlaylist();showToast('已为「'+track.name+'」换上新封面。');
      }catch(error){showToast(error.message,true)}
      finally{renderActiveTrack()}
    });
    $('removeCoverBtn').addEventListener('click',()=>{const track=currentTrack();if(track){track.cover=null;(track.manualFields||={}).cover=true;persistLibrary();renderPlaylist();showToast('当前歌曲封面已恢复默认。')}});
    $('removeBackgroundBtn').disabled=true;
    window.setInterval(()=>{if(playing&&libraryReady&&!restoring){lastSessionSave=Date.now();saveSession()}},2000);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)saveSession()});
    libraryPromise=restoreLibrary();
  }

  $('uploadBtn').addEventListener('click',()=>$('fileInput').click());
  $('fileInput').addEventListener('change',()=>{const files=Array.from($('fileInput').files);$('fileInput').value='';importFiles(files)});
  const resumeFileInput=$('resumeFileInput');
  let locatingResumeFile=null;
  function locatePlaybackFile(confirmFile){
    const target=currentPlaybackRecovery();
    if(target?.recovery.reason!=='file'||locatingResumeFile||fileRecoverySave)return;
    const blocked=importBlockedReason();
    if(blocked){showToast(blocked,true);return;}
    locatingResumeFile={target,generation:loadGeneration,confirmFile};
    resumeFileInput.click();
  }
  function saveRecoveredAudio(id,file,duration,audioDigest,original,stillCurrent){
    let committed=false;
    const save=queueStorage('library',async db=>{
      if(!stillCurrent())return;
      const tx=db.transaction(['state','media'],'readwrite'),done=transactionDone(tx);
      const state=tx.objectStore('state');
      let replacement,stored;
      try{
        const library=await requestValue(state.get('library'));
        if(!stillCurrent()){await done;return;}
        if(library!==undefined&&!Array.isArray(library?.tracks))throw new Error(libraryReadError);
        stored=tracks.find(track=>track.id===id);
        replacement={...(stored||missingResumeTracks.get(id)||original),duration,blob:file,stored:true,
          savedSize:file.size,audioDigest,sourcePath:file.name,signature:SonicFolderLibrary.fingerprint(file),
          sourceFolder:null,sourceMissing:false,sidecarStamp:null};
        const metadata=persistentLibraryTrack(replacement);
        const entries=library?library.tracks.slice():tracks.map(persistentLibraryTrack).filter(Boolean);
        const index=entries.findIndex(track=>track.id===id);
        if(index<0)entries.push(metadata);
        else entries[index]=metadata;
        const next=library?{...library,tracks:entries}:{version:7,tracks:entries,playlists,libraryView,playbackScope};
        state.put(next,'library');
        tx.objectStore('media').put(file,id);
      }catch(error){
        try{tx.abort()}catch{}
        await done.catch(()=>{});
        throw error;
      }
      await done;
      // Publish the replacement only after both the library entry and its audio have committed.
      try{
        const copy=await requestValue(db.transaction('media').objectStore('media').get(id));
        if(copy instanceof Blob)replacement.blob=copy;
      }catch{}
      if(stored)Object.assign(stored,replacement);
      else tracks.push(replacement);
      missingResumeTracks.delete(id);
      committed=true;
    });
    fileRecoverySave=save.finally(()=>{fileRecoverySave=null;});
    return fileRecoverySave.then(saved=>saved&&committed);
  }
  resumeFileInput.addEventListener('cancel',()=>{locatingResumeFile=null;});
  resumeFileInput.addEventListener('change',async()=>{
    const file=resumeFileInput.files[0],request=locatingResumeFile;
    resumeFileInput.value='';
    if(!file||!request){locatingResumeFile=null;return;}
    const {target,generation,confirmFile}=request,id=target.trackId;
    const stillCurrent=()=>locatingResumeFile===request&&!backupRestoring&&generation===loadGeneration&&
      currentPlaybackRecovery()?.recovery===target.recovery;
    try{
      if(!stillCurrent())return;
      if(!file.size||!isImportAudio(file))throw new Error('请选择原曲的音频文件。');
      const original=tracks.find(track=>track.id===id)||missingResumeTracks.get(id)||retryTargetTrack(target);
      if(original?.kind!=='file')return;
      const audioDigest=await SonicFolderLibrary.audioDigest(file);
      if(!stillCurrent())return;
      const canCompare=original.audioDigest&&audioDigest;
      if(canCompare&&original.audioDigest!==audioDigest)throw new Error('所选文件与原文件不一致，请重新选择。');
      const duration=await probeImportedAudio(file,target.recovery.position);
      if(!stillCurrent())return;
      if(!canCompare&&!await confirmFile?.(original,file,duration))return;
      if(!stillCurrent())return;
      if(!await saveRecoveredAudio(id,file,duration,audioDigest,original,stillCurrent)){
        if(stillCurrent())showToast('未能保存音频，已保留原曲与上次进度。',true);
        return;
      }
      renderLibraryControls();
      window.dispatchEvent(new Event('sonic:library-change'));
      if(stillCurrent())await retryPlayback();
    }catch(error){if(stillCurrent())showToast(error.message||'无法读取选中的音频，已保留上次进度。',true);}
    finally{if(locatingResumeFile===request)locatingResumeFile=null;}
  });
  const folderPaths=new WeakMap();
  let folderScanning=false;
  async function openMusicFolder(){
    const desktop=window.sonicDesktop;
    if(!desktop?.selectMusicFolder){$('folderInput').click();return;}
    const blocked=importBlockedReason();
    if(blocked){showToast(blocked);return;}
    folderScanning=true;refreshImportBusy();
    let selection;
    try{
      selection=await desktop.selectMusicFolder();
      if(!selection)return;
      const {key,token,files,errors}=selection;
      const sources=files.map(item=>{
        const getFile=async()=>{
          const response=await fetch('sonic-local-music://'+token+'/'+item.index);
          if(!response.ok)throw new Error('文件已更改或无法读取，请重新扫描文件夹。');
          const blob=await response.blob();
          if(blob.size!==item.size)throw new Error('文件在扫描后已更改，请重新扫描文件夹。');
          return new File([blob],item.name,{lastModified:item.lastModified});
        };
        const source={...item,type:'',getFile,text:async()=>(await getFile()).text()};
        folderPaths.set(source,item.path);
        return source;
      });
      await importFiles(sources,errors,true,true,key);
    }catch(error){
      reportImport('文件夹读取失败：'+(error.message||'请重试'),{error:true});
      $('importProgress').hidden=true;
    }finally{
      if(selection)void desktop.releaseMusicFolder(selection.token).catch(()=>{});
      folderScanning=false;refreshImportBusy();
    }
  }
  async function collectDroppedEntries(items,fallback){
    const files=[],errors=[];let audioCount=0;
    function found(file,path){
      if(path)folderPaths.set(file,path);files.push(file);if(isImportAudio(file))audioCount++;
      reportImport('正在扫描文件夹 · 已找到 '+audioCount+' 首音频、'+(files.length-audioCount)+' 个其他文件',{busy:true});
    }
    function readEntry(request,timeoutMessage){
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error(timeoutMessage)),15000);
        try{request(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})}catch(error){clearTimeout(timer);reject(error)}
      });
    }
    async function walk(entry){
      const path=(entry.fullPath||entry.name||'未知文件').replace(/^\//,'');
      if(entry.isFile){try{found(await readEntry((resolve,reject)=>entry.file(resolve,reject),'读取文件超时（15 秒）'),path)}
        catch(error){errors.push({path,reason:'无法读取文件：'+(error?.message||'请检查访问权限')})}}
      else if(entry.isDirectory){let reader;try{reader=entry.createReader()}catch(error){errors.push({path,reason:'无法打开文件夹：'+(error?.message||'请检查访问权限')});return}
        while(true){let batch;try{batch=await readEntry((resolve,reject)=>reader.readEntries(resolve,reject),'读取文件夹超时（15 秒）')}catch(error){errors.push({path,reason:'无法读取文件夹：'+(error?.message||'请检查访问权限')});break}
          if(!batch.length)break;for(const child of batch)await walk(child)}
      }
    }
    if(items.length){for(const item of items){if(item.entry)await walk(item.entry);else if(item.file)found(item.file);else errors.push({path:'拖入的项目',reason:'浏览器未提供可读取的文件或文件夹，请使用「导入文件夹」重试。'})}}
    else for(const file of fallback)found(file);
    return {files,errors};
  }
  function isFileDrag(e){return Array.from(e.dataTransfer?.types||[]).includes('Files')}
  document.addEventListener('dragenter',e=>{if(isFileDrag(e)){e.preventDefault();dragDepth++;$('dropOverlay').classList.add('visible')}});
  document.addEventListener('dragover',e=>{if(isFileDrag(e)){e.preventDefault();e.dataTransfer.dropEffect='copy'}});
  document.addEventListener('dragleave',e=>{if(isFileDrag(e)){dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dropOverlay').classList.remove('visible')}});
  document.addEventListener('drop',async e=>{if(isFileDrag(e)){
    e.preventDefault();dragDepth=0;$('dropOverlay').classList.remove('visible');
    const blocked=importBlockedReason();if(blocked){showToast(blocked);return}
    const fallback=Array.from(e.dataTransfer.files||[]);
    // Capture entry/file handles synchronously while the drop data store is readable.
    const items=Array.from(e.dataTransfer.items||[]).filter(item=>item.kind==='file').map(item=>{
      let entry=null,file=null;try{entry=item.webkitGetAsEntry?.()||null}catch{}try{file=item.getAsFile()}catch{}return {entry,file};
    });
    folderScanning=true;refreshImportBusy();
    try{
      if(!$('queueDialog').open&&!document.querySelector('[data-music-library]:not([hidden])'))openSpaceDialog('queueDialog');
      reportImport('正在扫描文件夹…',{busy:true});$('importProgress').hidden=false;$('importProgress').removeAttribute('value');$('importFailures').hidden=true;$('importFailureList').replaceChildren();
      const result=await collectDroppedEntries(items,fallback);
      await importFiles(result.files,result.errors,true,items.length===1&&items[0].entry?.isDirectory===true);
      if(!result.files.length&&!result.errors.length){reportImport('文件夹里没有可导入的文件。');$('importProgress').hidden=true}
    }catch(error){reportImport('文件夹读取失败：'+(error.message||'请重试'),{error:true});$('importProgress').hidden=true}
    finally{folderScanning=false;refreshImportBusy()}
  }});
  window.addEventListener('blur',()=>{dragDepth=0;$('dropOverlay').classList.remove('visible')});
  $('demoBtn').addEventListener('click',()=>{$('helpDialog').close();addDemo(true)});
  async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else showToast('当前环境未开放全屏，可以使用沉浸模式。')}catch{showToast('当前预览环境未开放全屏，请用浏览器打开作品后重试。')}}
  $('fullscreenBtn').addEventListener('click',toggleFullscreen);
  document.addEventListener('fullscreenchange',()=>{$('fullscreenBtn').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'进入全屏')});
  $('quietBtn').addEventListener('click',enterUniverse);$('quietExit').addEventListener('click',()=>setQuiet(false));
  $('flightBtn').addEventListener('click',()=>{
    if(clipLocked()){showToast('请先结束当前录制，再开始航行。');return}
    if(busy||pendingFile||!libraryReady){showToast('音乐正在准备，请稍候再启航。');return}
    pause();stopExternal('',true);saveSession();saveDrafts();location.assign(new URL('./flight.html?v=13',location.href).href);
  });
  $('helpBtn').addEventListener('click',()=>$('helpDialog').showModal());$('closeHelpBtn').addEventListener('click',()=>$('helpDialog').close());
  $('helpDialog').addEventListener('click',e=>{if(e.target===$('helpDialog')){const r=$('helpDialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('helpDialog').close()}});
  document.addEventListener('keydown',e=>{
    if(listeningPresentation||e.target.closest('input,textarea,select')||e.altKey||e.ctrlKey||e.metaKey||document.querySelector('dialog[open]'))return;
    if(e.code==='Space'&&e.target.closest('button'))return;
    if(e.code==='Space'){e.preventDefault();play()}else if(['1','2','3','4'].includes(e.key)){setVisualMode(['ring','galaxy','peaks','blackhole'][Number(e.key)-1])}else if(e.key.toLowerCase()==='m')$('muteBtn').click();else if(e.key.toLowerCase()==='f')toggleFullscreen();else if(e.key.toLowerCase()==='h')setQuiet(!app.classList.contains('quiet'));else if(e.key==='Escape'&&app.classList.contains('quiet'))setQuiet(false);else if(e.key==='ArrowRight'){e.preventDefault();seekTo(getPosition()+5)}else if(e.key==='ArrowLeft'){e.preventDefault();seekTo(getPosition()-5)}
  });

  function resize(){
    w=app.clientWidth;
    const intro=document.querySelector('.intro'),mobileExtra=w<=760?Math.max(0,intro.offsetTop+intro.offsetHeight+20-205):0;
    const extraValue=Math.round(mobileExtra)+'px';if(app.style.getPropertyValue('--mobile-extra')!==extraValue)app.style.setProperty('--mobile-extra',extraValue);
    renderProfile=SonicVisualSystem.performanceProfile({width:w,dpr:devicePixelRatio||1,deviceMemory:navigator.deviceMemory,hardwareConcurrency:navigator.hardwareConcurrency,coarsePointer:matchMedia('(pointer: coarse)').matches});
    h=app.classList.contains('quiet')?app.getBoundingClientRect().height:app.clientHeight;dpr=energySaver?Math.min(1,renderProfile.pixelRatio):renderProfile.pixelRatio;
    const pixelWidth=Math.round(w*dpr),pixelHeight=Math.round(h*dpr),canvasResized=canvas.width!==pixelWidth||canvas.height!==pixelHeight;
    if(canvasResized){canvas.width=pixelWidth;canvas.height=pixelHeight}ctx.setTransform(dpr,0,0,dpr,0,0);
    const perfLabel={mobile:'移动端性能模式',balanced:'平衡性能模式',desktop:'完整性能模式'}[renderProfile.tier];
    $('performanceStatus').textContent=perfLabel+(energySaver?' · 省电 30 帧':' · 流畅预览')+' · 最多 '+Math.min(renderProfile.maxParticles,energySaver?1000:Infinity).toLocaleString('en-US')+' 颗星尘';app.dataset.performanceTier=renderProfile.tier;app.dataset.effectiveParticleCap=String(renderProfile.maxParticles);app.dataset.effectiveTrailCap=String(Math.min(renderProfile.maxTrail,energySaver?.28:1));app.dataset.energySaver=String(energySaver);app.dataset.targetFps=String(reduced?15:energySaver?30:60);
    const mobile=w<=760,quiet=app.classList.contains('quiet');centerX=w*(mobile||quiet?.5:.647);centerY=quiet?h*.5:mobile?406+mobileExtra:Math.min(h*.47,500);baseR=quiet?Math.min(w*.31,h*.31,340):mobile?Math.min(w*.30,152):Math.min(w*.185,h*.225,255);
    randState=104729;stars=Array.from({length:Math.min(energySaver?180:850,Math.round(w*h/(energySaver?4000:1450)))},()=>({x:rand(),y:rand(),r:.35+rand()*1.15,alpha:.12+rand()*.64,speed:.2+rand()*.8,phase:rand()*Math.PI*2}));
    dust=Array.from({length:energySaver?70:mobile?210:390},()=>({angle:rand()*Math.PI*2,distance:.65+rand()*2.2,z:rand(),size:.3+rand()*1.5,phase:rand()*6.28}));app.dataset.backgroundStarCount=String(stars.length);app.dataset.pixelRatio=String(dpr);
    rebuildParticles();rebuildBackground();scheduleOnlineLyricsPosition();
    // Resizing clears a canvas immediately. Paint it before exposing that clear frame.
    if(canvasResized&&visualFirstFrameReady)try{draw(sceneTime,1/60)}catch(error){console.error(error);stopAnimation();window.activateVisualFallback('画面尺寸更新失败，已换成轻量星光。可重试完整效果。')}
  }
  function rebuildParticles(){
    effectiveParticleCount=Math.min(particleCount,renderProfile.maxParticles,energySaver?1000:Infinity);exportParticleCache=null;
    randState=824287;
    ring=Array.from({length:effectiveParticleCount},()=>({a:rand()*Math.PI*2,band:(rand()+rand()+rand()-1.5),r:rand()*.95+.25,alpha:rand()*.65+.2,phase:rand()*Math.PI*2,layer:rand()}));
    galaxyParticles=Array.from({length:effectiveParticleCount},()=>({radial:Math.pow(rand(),.65),arm:Math.floor(rand()*4),scatter:(rand()+rand()+rand()-1.5),height:(rand()+rand()-1)*.12,size:.35+rand()*1.3,phase:rand()*Math.PI*2,depth:rand()}));
    gpuDirty=true;app.dataset.particleCount=String(particleCount);app.dataset.effectiveParticleCount=String(effectiveParticleCount);
  }
  function exportParticles(){
    if(exportParticleCache?.count===particleCount)return exportParticleCache;
    // Build only when exporting; preview quality never changes the saved settings.
    const saved=randState;randState=824287;
    const exportRing=Array.from({length:particleCount},()=>({a:rand()*Math.PI*2,band:(rand()+rand()+rand()-1.5),r:rand()*.95+.25,alpha:rand()*.65+.2,phase:rand()*Math.PI*2,layer:rand()}));
    const exportGalaxy=Array.from({length:particleCount},()=>({radial:Math.pow(rand(),.65),arm:Math.floor(rand()*4),scatter:(rand()+rand()+rand()-1.5),height:(rand()+rand()-1)*.12,size:.35+rand()*1.3,phase:rand()*Math.PI*2,depth:rand()}));
    randState=saved;exportParticleCache={count:particleCount,ring:exportRing,galaxy:exportGalaxy};return exportParticleCache;
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(app);
  window.addEventListener('scroll',scheduleOnlineLyricsPosition,{passive:true});
  app.addEventListener('pointermove',e=>{if(app.classList.contains('quiet')){wakeRoam();return}const rect=app.getBoundingClientRect();mouse.tx=(e.clientX-rect.left-w/2)/w;mouse.ty=(e.clientY-rect.top-h/2)/h});
  app.addEventListener('pointerleave',()=>{mouse.tx=0;mouse.ty=0});

  function readAudio(dt,now,lightweight=false){
    const analysisNode=externalAnalyser||analyser;
    const sounding=Boolean(playing||externalStream||instrumentSoundActive());
    if(beatInputNode!==analysisNode||beatInputTrack!==activeId||beatInputGeneration!==generation){
      beatTracker.reset();beatInputNode=analysisNode;beatInputTrack=activeId;beatInputGeneration=generation;
    }
    let b=0,m=0,hi=0,p=0;rawRms=0;
    if(sounding&&analysisNode){
      analysisNode.getByteFrequencyData(freqData);analysisNode.getByteTimeDomainData(timeData);
      const binHz=audioContext.sampleRate/analysisNode.fftSize;
      function band(lo,hz,peakWeight,data=freqData){
        const start=Math.max(1,Math.floor(lo/binHz)),end=Math.min(data.length,Math.ceil(hz/binHz));let sum=0,peak=0;
        for(let i=start;i<end;i++){const value=data[i]/255;sum+=value*value;peak=Math.max(peak,value)}
        return end>start?Math.sqrt(sum/(end-start))*(1-peakWeight)+peak*peakWeight:0;
      }
      for(let i=0;i<timeData.length;i++){const n=(timeData[i]-128)/128;p+=n*n}calibrateVisual(Math.sqrt(p/timeData.length),dt);
      const buffering=playing&&mode!=='demo'&&(audio.seeking||audio.readyState<HTMLMediaElement.HAVE_FUTURE_DATA);
      if(seeking||buffering||audioContext.state!=='running'||!(playing||externalStream))beatTracker.reset();
      else{
        // The silent tap listens before transport fades, EQ and volume.
        const beatNode=externalBeatAnalyser||beatAnalyser;
        beatNode.getByteFrequencyData(beatFrequencyData);beatNode.getFloatTimeDomainData(beatTimeData);
        let beatPower=0;
        for(const value of beatTimeData)beatPower+=value*value;
        beatTracker.update({
          active:true,rms:Math.sqrt(beatPower/beatTimeData.length),sub:band(32,108,.16,beatFrequencyData),kick:band(108,240,.22,beatFrequencyData),
          body:band(240,1650,.12,beatFrequencyData),edge:band(1650,6600,.18,beatFrequencyData),
        },playing?getLocalPosition():audioContext.currentTime);
      }
      b=visualSignal(band(30,200,.16));m=visualSignal(band(200,2500,.12));hi=visualSignal(band(2500,12000,.38));p=visualSignal(rawRms*3.3);
      // Detect a low-frequency onset against its recent energy floor, then let it decay.
      // The cooldown prevents a sustained bass note from behaving like repeated drum hits.
      if(visualEffects.beat&&b>.13&&b>bassFloor*1.13+.018&&b-previousBass>.014&&now-lastBeatAt>responseProfiles[refinement.profile].cooldown){
        beatPulse=clamp(.35+(b-bassFloor)*1.5,.35,responseProfiles[refinement.profile].cap)*responseProfiles[refinement.profile].gain;lastBeatAt=now;beatAge=0;
        if(!reduced){beatWaves.push({age:0,strength:beatPulse});if(beatWaves.length>4)beatWaves.shift()}
      }
      const trebleAttack=Math.max(0,hi-previousHigh);
      if(hi>.10)treblePulse=Math.max(treblePulse,clamp(hi*.75+trebleAttack*4,0,1));
      if(trebleAttack>.025)lastTrebleAt=now;
      // The listening room needs only the broad bands, not a rolling terrain history.
      if(!lightweight)for(let i=0;i<terrainBands.length;i++){
        const low=38*Math.pow(12500/38,i/terrainBands.length),upper=38*Math.pow(12500/38,(i+1)/terrainBands.length);
        const first=clamp(Math.floor(low/binHz),1,freqData.length-1),last=clamp(Math.ceil(upper/binHz),first+1,freqData.length);let value=0;
        for(let j=first;j<last;j++)value=Math.max(value,freqData[j]/255);
        value=visualSignal(value);terrainBands[i]+=(value-terrainBands[i])*(1-Math.exp(-dt*13));
      }
    }else{beatTracker.reset();calibrateVisual(0,dt);if(freqData)freqData.fill(0);for(let i=0;i<terrainBands.length;i++)terrainBands[i]*=Math.exp(-dt*4)}
    musicResponse.update({active:sounding,rms:rawRms,bass:b,mid:m,high:hi,spectrum:terrainBands},dt);
    bassFloor+=(b-bassFloor)*(1-Math.exp(-dt*1.5));previousBass=b;previousHigh=hi;
    bass+=(b-bass)*(1-Math.exp(-dt*(b>bass?14:3.8)));mid+=(m-mid)*(1-Math.exp(-dt*(m>mid?12:4.8)));high+=(hi-high)*(1-Math.exp(-dt*(hi>high?18:6)));power+=(p-power)*(1-Math.exp(-dt*(p>power?12:4)));
    beatPulse*=Math.exp(-dt*5.5);treblePulse*=Math.exp(-dt*5);beatAge+=dt;
    for(const wave of beatWaves)wave.age+=dt;beatWaves=beatWaves.filter(wave=>wave.age<1.35);
    if(lightweight)return;
    terrainClock+=dt*motionSpeed*(atelier.settings.breathing?lifeMotion:1);
    if(terrainClock>.052){terrainClock%=.052;terrainHistory.unshift(Float32Array.from(terrainBands));if(terrainHistory.length>38)terrainHistory.pop()}
  }
  function cloudTexture(key){
    if(cloudTextures[key])return cloudTextures[key];
    const surface=document.createElement('canvas');surface.width=surface.height=768;const g=surface.getContext('2d'),colors=themes[key];
    let seed=71237;const random=()=>{seed=seed*16807%2147483647;return(seed-1)/2147483646};
    g.globalCompositeOperation='lighter';
    for(let i=0;i<360;i++){
      const a=random()*Math.PI*2,scatter=(random()+random()+random()-1.5),rr=217+scatter*18;
      const x=384+Math.cos(a)*rr*1.23,y=384+Math.sin(a)*rr*.78;
      const size=12+random()*33,front=(Math.sin(a)+1)/2;
      const color=i%5===0?colors.hot:i%3===0?colors.second:colors.core;
      const glow=g.createRadialGradient(x,y,0,x,y,size);glow.addColorStop(0,rgba(color,(.045+front*.055)*(i%5===0?.65:1)));glow.addColorStop(.35,rgba(color,.025+front*.025));glow.addColorStop(1,rgba(color,0));
      g.fillStyle=glow;g.fillRect(x-size,y-size,size*2,size*2);
    }
    cloudTextures[key]=surface;return surface;
  }
  // Cache the soft field once; a frame only composites three small textures.
  function mistTexture(key,layer){
    const id='mist-'+key+'-'+layer;if(cloudTextures[id])return cloudTextures[id];
    const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d'),colors=themes[key];
    let seed=43913+layer*197;const random=()=>{seed=seed*16807%2147483647;return(seed-1)/2147483646};
    g.globalCompositeOperation='lighter';
    for(let i=0;i<54;i++){
      const u=random(),angle=u*6.283+layer*.9,radial=72+u*91;
      const x=256+Math.cos(angle)*radial*1.15,y=256+Math.sin(angle)*radial*.64+(random()-.5)*38;
      const size=28+random()*53,color=i%6===0?colors.core:colors.second;
      const glow=g.createRadialGradient(x,y,0,x,y,size);glow.addColorStop(0,rgba(color,.045));glow.addColorStop(.4,rgba(color,.022));glow.addColorStop(1,rgba(color,0));g.fillStyle=glow;g.fillRect(x-size,y-size,size*2,size*2);
    }
    // Uneven transparent lanes separate clouds instead of brightening the entire sky.
    g.globalCompositeOperation='destination-out';
    for(let i=0;i<5;i++){
      const x=135+random()*230,y=155+random()*200,size=35+random()*42;
      const gap=g.createRadialGradient(x,y,0,x,y,size);gap.addColorStop(0,'#000b');gap.addColorStop(1,'#0000');g.fillStyle=gap;g.fillRect(x-size,y-size,size*2,size*2);
    }
    cloudTextures[id]=c;return c;
  }
  function drawDepthMist(cx,cy,r,t,yaw,pitch,foreground=false){
    ctx.save();ctx.globalCompositeOperation='lighter';
    const alpha=ctx.globalAlpha,depth=visualEffects.depth,still=reduced?0:1;
    for(const layer of foreground?[2]:[0,1]){
      const z=layer-1,drift=still*music.drift;
      const px=mouse.x*(layer+1)*8*depth-Math.sin(yaw*.35)*(layer+1)*r*.07*depth;
      const py=mouse.y*(layer+1)*5*depth+pitch*z*r*.08*depth;
      const width=r*(layer===0?6.4:layer===1?4.6:3.8)*(1+music.sustain*(reduced?.015:.10));
      const opacity=(layer===0?.34:layer===1?.30:.12)*(1-sceneWeights.peaks*.5)*(.7+intensity*.3+music.sustain*.42);
      ctx.save();ctx.translate(cx+px,cy+py);ctx.rotate(-.28+z*.32+still*Math.sin(t*.035+layer)*.018+drift*z*.016);
      const height=width*(.76+z*.04),mix=smooth(cloudBlend);
      if(mix<.999){ctx.globalAlpha=alpha*opacity*(1-mix);ctx.drawImage(mistOrigins[layer]||mistTexture(previousTheme,layer),-width/2,-height/2,width,height)}
      ctx.globalAlpha=alpha*opacity*mix;ctx.drawImage(mistTexture(themeKey,layer),-width/2,-height/2,width,height);ctx.restore();
    }
    ctx.restore();
  }
  function drawNebula(cx,cy,r,t,opacity=1){
    const layerAlpha=ctx.globalAlpha;r*=storyVisualsActive()?(.75+.25*story.nebula):1;
    const ambient=ctx.createRadialGradient(cx,cy,r*.4,cx,cy,r*2.25);ambient.addColorStop(0,rgba(palette.second,.016));ambient.addColorStop(.48,rgba(palette.second,.09+power*.025));ambient.addColorStop(1,rgba(palette.second,0));ctx.fillStyle=ambient;ctx.fillRect(cx-r*2.3,cy-r*2.3,r*4.6,r*4.6);
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-.36+mouse.x*.12);ctx.scale(1,.79);
    for(let k=0;k<4;k++){
      ctx.beginPath();const rr=r*(.97+k*.022);ctx.ellipse(0,0,rr*1.36,rr*.89,0,0,Math.PI*2);ctx.strokeStyle=rgba(k%2?palette.core:palette.second,(.022+k*.005)*intensity);ctx.lineWidth=r*(.13-k*.019);ctx.stroke();
    }
    ctx.restore();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-.31+mouse.x*.13+(reduced?0:music.cloud*.012));ctx.scale(1+music.cloud*.04+music.sustain*.035,1+music.cloud*.02);ctx.globalCompositeOperation='lighter';
    const scale=r/217,size=768*scale,brightness=.58+intensity*.6+music.cloud*.20+music.sustain*.16;
    if(cloudBlend<1){ctx.globalAlpha=layerAlpha*Math.min(1,brightness*(1-cloudBlend));ctx.drawImage(cloudOrigin||cloudTexture(previousTheme),-size/2,-size/2,size,size)}
    ctx.globalAlpha=layerAlpha*Math.min(1,brightness*cloudBlend);ctx.drawImage(cloudTexture(themeKey),-size/2,-size/2,size,size);ctx.restore();
    const black=ctx.createRadialGradient(cx-r*.08,cy-r*.12,0,cx,cy,r*.91);black.addColorStop(0,'rgba(7,7,17,.96)');black.addColorStop(.78,'rgba(8,8,20,.76)');black.addColorStop(1,'rgba(8,8,20,0)');ctx.fillStyle=black;ctx.beginPath();ctx.arc(cx,cy,r*.91,0,6.283);ctx.fill();
  }
  function drawRing(cx,cy,r,t){
    const shake=reduced?0:beatPulse*intensity;
    const tilt=-.31+mouse.x*.13;
    ctx.save();ctx.translate(cx,cy);ctx.rotate(tilt);
    // Thin orbit paths give the cloud a clear, sculptural silhouette.
    for(let j=0;j<3;j++){
      ctx.beginPath();const rr=r*(.94+j*.13);ctx.ellipse(0,0,rr*1.22,rr*.76,.05,0,Math.PI*2);ctx.strokeStyle=rgba(palette.core,j===0?.09:.035);ctx.lineWidth=j===0?.8:.6;ctx.stroke();
    }
    const rot=t*.018;
    ctx.globalCompositeOperation='lighter';
    for(const p of (reduced?ring:[])){
      const a=p.a+rot*(p.layer>.5?1:-.45),freqIndex=freqData?Math.floor(((a%6.283+6.283)%6.283)/6.283*130)+2:2;
      const signal=(playing||externalStream||instrumentSoundActive())&&freqData?(visualSignal(freqData[Math.min(freqIndex,freqData.length-1)]/255)):0;
      const ripple=Math.sin(a*5+t*.7+p.phase)*1.8+signal*(8+mid*15)*intensity+Math.sin(a*13-beatAge*30)*shake*6;
      const radius=r*(1+p.band*.14)+ripple;
      const x=Math.cos(a)*radius*1.23,y=Math.sin(a)*radius*.78;
      const front=(Math.sin(a)+1)/2;
      const twinkle=.62+.38*Math.sin(p.phase+t*(.35+high*2));
      const sparkle=treblePulse*Math.pow((Math.sin(p.phase*7+t*.4)+1)/2,12);
      const alpha=clamp(p.alpha*(.51+front*.49)*twinkle*(.75+intensity*.75+signal*.8)+sparkle*.55,0,.95);
      const size=p.r*(.55+intensity*.75+signal*1.1+sparkle*.7)*(front*.45+.7);
      ctx.fillStyle=rgba(p.layer>.88?palette.hot:p.layer>.35?palette.core:palette.second,alpha);
      ctx.fillRect(x,y,size*1.15,size);
      if(p.r>1.02&&p.alpha>.74){ctx.fillStyle=rgba(palette.core,alpha*.075);ctx.beginPath();ctx.arc(x,y,size*4,0,6.283);ctx.fill()}
    }
    // A filament wave follows actual spectrum bins.
    for(let k=0;k<2;k++){
      ctx.beginPath();for(let i=0;i<=256;i++){const a=i/256*Math.PI*2;const signal=(playing||externalStream||instrumentSoundActive())&&freqData?visualSignal(freqData[Math.min(2+Math.floor(i*.53),freqData.length-1)]/255):0;const radius=r*(.99+k*.035)+Math.sin(a*7+t*.3)*1.2+signal*13*intensity;const x=Math.cos(a)*radius*1.23,y=Math.sin(a)*radius*.78;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.closePath();ctx.strokeStyle=rgba(k?palette.hot:palette.core,k?.11:.25);ctx.lineWidth=k?.5:.8;ctx.stroke();
    }
    if(!reduced){
      for(const wave of beatWaves){const rr=r*(1+wave.age*.35),alpha=Math.pow(1-wave.age/1.35,2)*wave.strength*.32*intensity;ctx.beginPath();ctx.ellipse(0,0,rr*1.23,rr*.78,0,0,Math.PI*2);ctx.lineWidth=.6;ctx.strokeStyle=rgba(palette.hot,alpha);ctx.stroke()}
    }
    ctx.globalCompositeOperation='source-over';ctx.restore();
    // Detached stardust is pulled along wide, slow orbits.
    for(const p of dust){const a=p.angle+t*(.006+p.z*.006),rr=r*p.distance+power*12;const x=cx+Math.cos(a)*rr*1.22,y=cy+Math.sin(a)*rr*.72;const alpha=(.05+p.z*.25)*(.6+.4*Math.sin(p.phase+t*.3))*(.7+intensity*.5+high);ctx.fillStyle=rgba(palette.core,alpha);ctx.beginPath();ctx.arc(x,y,p.size*(.65+high),0,6.283);ctx.fill()}
    // A tiny star in the centre anchors the otherwise open ring.
    const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,r*.23);glow.addColorStop(0,rgba(palette.core,.07+power*.04));glow.addColorStop(1,rgba(palette.core,0));ctx.fillStyle=glow;ctx.beginPath();ctx.arc(cx,cy,r*.23,0,6.283);ctx.fill();
    ctx.strokeStyle=rgba(palette.core,.32);ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(cx-5,cy);ctx.lineTo(cx+5,cy);ctx.moveTo(cx,cy-5);ctx.lineTo(cx,cy+5);ctx.stroke();ctx.fillStyle=rgba(palette.hot,.8);ctx.fillRect(cx-.7,cy-.7,1.4,1.4);
  }
  function galaxyTexture(key){
    const cacheKey='spiral-'+key;if(cloudTextures[cacheKey])return cloudTextures[cacheKey];
    const surface=document.createElement('canvas');surface.width=surface.height=768;const g=surface.getContext('2d'),colors=themes[key];
    let seed=90127;const random=()=>{seed=seed*16807%2147483647;return(seed-1)/2147483646};
    g.globalCompositeOperation='lighter';
    for(let arm=0;arm<4;arm++)for(let i=0;i<100;i++){
      const u=(i+random())/100,angle=arm*Math.PI/2+u*5.7+(random()-.5)*.2,rr=u*255;
      const x=384+Math.cos(angle)*rr*1.3,y=384+Math.sin(angle)*rr*.7,size=9+u*19+random()*10;
      const color=i%5===0?colors.hot:arm%2?colors.second:colors.core;
      const glow=g.createRadialGradient(x,y,0,x,y,size);glow.addColorStop(0,rgba(color,.085*(1-u*.4)));glow.addColorStop(.4,rgba(color,.028));glow.addColorStop(1,rgba(color,0));g.fillStyle=glow;g.fillRect(x-size,y-size,size*2,size*2);
    }
    cloudTextures[cacheKey]=surface;return surface;
  }
  function drawGalaxy(cx,cy,r,t,opacity){
    const layerAlpha=ctx.globalAlpha;
    const pulse=reduced?0:beatPulse;
    const aura=ctx.createRadialGradient(cx,cy,0,cx,cy,r*2);aura.addColorStop(0,rgba(palette.second,.16+power*.05));aura.addColorStop(.5,rgba(palette.second,.05));aura.addColorStop(1,rgba(palette.second,0));ctx.fillStyle=aura;ctx.fillRect(cx-r*2,cy-r*2,r*4,r*4);
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-.31+mouse.x*.16+Math.sin(t*.06)*.04);
    const size=768*r/217;
    ctx.save();ctx.globalCompositeOperation='lighter';
    ctx.rotate(t*.012);
    if(cloudBlend<1){ctx.globalAlpha=layerAlpha*(1-cloudBlend)*(.6+intensity*.35);ctx.drawImage(spiralOrigin||galaxyTexture(previousTheme),-size/2,-size/2,size,size)}
    ctx.globalAlpha=layerAlpha*cloudBlend*(.6+intensity*.35);ctx.drawImage(galaxyTexture(themeKey),-size/2,-size/2,size,size);ctx.restore();
    ctx.globalCompositeOperation='lighter';
    for(const p of (reduced?galaxyParticles:[])){
      const rr=p.radial*r*1.17*(1+pulse*.06*intensity),angle=p.arm*Math.PI/2+p.radial*5.7+t*.012+p.scatter*.31;
      const drift=Math.sin(t*.3+p.phase)*1.2;
      const x=Math.cos(angle)*rr*1.3,y=Math.sin(angle)*rr*.7+p.height*r*.45+drift;
      const spark=treblePulse*Math.pow((Math.sin(p.phase*9+t*.8)+1)/2,14);
      const luminosity=clamp((.25+(1-p.radial)*.35+p.depth*.3)*(.6+intensity*.7)+spark*.5,0,1);
      const size=p.size*(.5+intensity*.5+pulse*.15+spark*.7);
      ctx.fillStyle=rgba(p.depth>.85?palette.hot:p.depth>.3?palette.core:palette.second,luminosity);
      ctx.fillRect(x,y,size,size);
      if(p.depth>.94){ctx.fillStyle=rgba(palette.core,luminosity*.09);ctx.beginPath();ctx.arc(x,y,size*4.5,0,Math.PI*2);ctx.fill()}
      if(spark>.2&&p.depth>.7){ctx.strokeStyle=rgba(palette.hot,spark*.65);ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x-3-spark*3,y);ctx.lineTo(x+3+spark*3,y);ctx.moveTo(x,y-3-spark*3);ctx.lineTo(x,y+3+spark*3);ctx.stroke()}
    }
    const nucleus=ctx.createRadialGradient(0,0,0,0,0,r*.4);nucleus.addColorStop(0,rgba(palette.hot,.77));nucleus.addColorStop(.06,rgba(palette.hot,.5));nucleus.addColorStop(.25,rgba(palette.core,.23+power*.07));nucleus.addColorStop(1,rgba(palette.core,0));ctx.fillStyle=nucleus;ctx.beginPath();ctx.ellipse(0,0,r*.4,r*.31,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=rgba(palette.hot,.7);ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(-r*.11,0);ctx.lineTo(r*.11,0);ctx.moveTo(0,-r*.06);ctx.lineTo(0,r*.06);ctx.stroke();
    if(!reduced)for(const wave of beatWaves){ctx.beginPath();const rr=r*(.25+wave.age*.8);ctx.ellipse(0,0,rr*1.3,rr*.7,0,0,Math.PI*2);ctx.strokeStyle=rgba(palette.core,Math.pow(1-wave.age/1.35,2)*wave.strength*.17);ctx.lineWidth=.7;ctx.stroke()}
    ctx.restore();
  }
  function drawPeaks(cx,cy,r,t){
    const cols=76,rows=29,points=[];
    const width=r*2.9,depth=r*1.12,baseY=cy+r*.45;
    const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,r*1.7);glow.addColorStop(0,rgba(palette.second,.14));glow.addColorStop(.6,rgba(palette.second,.05));glow.addColorStop(1,rgba(palette.second,0));ctx.fillStyle=glow;ctx.fillRect(cx-r*1.9,cy-r*1.8,r*3.8,r*3.6);
    function getHeight(u,z,row){
      const symmetric=1-Math.abs(u-.5)*2,band=clamp(Math.floor((1-symmetric)*62+3),0,95);
      const history=terrainHistory[Math.min(terrainHistory.length-1,Math.floor(row/rows*35))];
      const value=history?history[band]:0;
      const shape=Math.pow(Math.max(0,Math.sin(u*Math.PI)),.8);
      const ridge=(.17+.11*Math.sin(u*17+z*9+t*.24)+.055*Math.cos(u*33-z*5))*shape;
      return (ridge+Math.pow(value,1.6)*(.45+mid*.35)*intensity+Math.sin(u*24+z*7+t*.2)*.018)*r*(.45+z*.65);
    }
    for(let row=0;row<rows;row++){
      const z=row/(rows-1),rowPoints=[],perspective=.33+z*.76;
      for(let col=0;col<cols;col++){
        const u=col/(cols-1),x=cx+(u-.5)*width*perspective+mouse.x*(z-.5)*16;
        const y=baseY-depth*(1-z)-getHeight(u,z,row)+mouse.y*z*8;
        rowPoints.push({x,y});
      }
      points.push(rowPoints);
    }
    // A translucent filled slope and thin contours make a continuous sound landscape.
    for(let row=0;row<rows;row++){
      const z=row/(rows-1),line=points[row];ctx.beginPath();line.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.lineTo(line[cols-1].x,baseY-depth*(1-z)+12);ctx.lineTo(line[0].x,baseY-depth*(1-z)+12);ctx.closePath();
      ctx.fillStyle=rgba(palette.second,.014+z*.016);ctx.fill();
      ctx.beginPath();line.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.strokeStyle=rgba(row%4===0?palette.hot:palette.core,(.11+z*.29+power*.10)*intensity);ctx.lineWidth=row%4===0?.85:.65;ctx.stroke();
    }
    for(let col=0;col<cols;col+=3){ctx.beginPath();for(let row=0;row<rows;row++){const p=points[row][col];row?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)}ctx.strokeStyle=rgba(palette.core,.07+intensity*.055);ctx.lineWidth=.6;ctx.stroke()}
    ctx.save();ctx.globalCompositeOperation='lighter';
    // Particle count also controls how densely the terrain is sprinkled with stars.
    for(let i=0;i<(reduced?ring.length:0);i++){
      const particle=ring[i],u=particle.a/(Math.PI*2),z=particle.layer,row=Math.min(rows-1,Math.floor(z*(rows-1))),perspective=.33+z*.76;
      const x=cx+(u-.5)*width*perspective+mouse.x*(z-.5)*16;
      const height=getHeight(u,z,row),spark=treblePulse*Math.pow((Math.sin(particle.phase*8+t*.5)+1)/2,12);
      const y=baseY-depth*(1-z)-height+mouse.y*z*8;
      const size=(.45+particle.r*.65)*(1+spark*.6);
      ctx.fillStyle=rgba(particle.alpha>.7?palette.hot:palette.core,(.2+z*.45+spark*.3)*intensity);ctx.fillRect(x,y,size,size);
      if(spark>.45&&particle.alpha>.75){ctx.fillStyle=rgba(palette.hot,spark*.12);ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill()}
    }
    ctx.restore();
    // The horizon is quiet; the moving contours carry the spectrum, not a fabricated beat.
    ctx.strokeStyle=rgba(palette.core,.12);ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(cx-width*.55,baseY+13);ctx.lineTo(cx+width*.55,baseY+13);ctx.stroke();
  }
  function drawScene(key,cx,cy,r,t,opacity){
    if(opacity<=.003)return;ctx.save();ctx.globalAlpha*=opacity;
    if(key==='ring'){drawNebula(cx,cy,r,t,opacity);drawRing(cx,cy,r,t)}else if(key==='galaxy')drawGalaxy(cx,cy,r,t,opacity);else if(key==='blackhole')drawBlackhole(cx,cy,r,t);else drawPeaks(cx,cy,r,t);
    ctx.restore();
  }
  // These trails retain the recent midrange spectrum, not note or pitch guesses.
  // They are drawn in the shared scene so recordings and postcards retain the same layers.
  function drawMusicFilaments(cx,cy,r,t){
    if(music.presence<.002&&music.flow<.002){if(!exportRendering)app.dataset.musicTrails='0';return}
    const peakWeight=sceneWeights.peaks,tilt=-.31+mouse.x*.13;
    ctx.save();ctx.translate(cx,cy);ctx.rotate(tilt);ctx.globalCompositeOperation='lighter';
    let visible=0;
    for(let lane=0;lane<music.history.length;lane++){
      const row=music.history[lane],strength=Math.max(...row);
      if(strength<.015)continue;visible++;
      const start=lane*.79+(reduced?0:t*.018+music.phase),radius=r*(.72+lane*.038);
      ctx.beginPath();
      const samples=reduced?12:row.length;
      for(let j=0;j<samples;j++){
        const u=j/(samples-1),index=u*(row.length-1),at=Math.floor(index),amplitude=reduced?music.lanes[lane]:at===0?music.lanes[lane]:row[at]*(1-music.historyMix)+row[at-1]*music.historyMix;
        const a=start-u*.74,rr=radius+r*amplitude*.11*Math.sin(u*Math.PI);
        let x=Math.cos(a)*rr*1.23,y=Math.sin(a)*rr*.78;
        const landX=(lane/(music.history.length-1)-.5)*r*2.6,landY=r*(.32-u*.9)-amplitude*r*.23;
        x=x*(1-peakWeight)+landX*peakWeight;y=y*(1-peakWeight)+landY*peakWeight;
        j?ctx.lineTo(x,y):ctx.moveTo(x,y);
      }
      ctx.strokeStyle=rgba(lane%4?palette.core:palette.hot,strength*(reduced?.12:.27)*intensity*music.presence);ctx.lineWidth=.6+strength*.7;ctx.stroke();
    }
    ctx.restore();if(!exportRendering)app.dataset.musicTrails=String(visible);
  }
  function drawStoryBloom(cx,cy,r,t){
    if(!storyVisualsActive())return;
    ctx.save();ctx.globalCompositeOperation='lighter';
    const layerAlpha=ctx.globalAlpha;
    if(!reduced)for(const p of burstParticles){
      const u=p.age/p.life,radial=r*(p.start+p.speed*u*1.8),angle=p.angle;
      const x=cx+Math.cos(angle)*radial*1.25,y=cy+Math.sin(angle)*radial*.78;
      const alpha=Math.pow(1-u,2)*p.strength*.56*intensity;
      const length=(2+p.speed*5)*(1-u),color=p.hot?palette.hot:palette.core;
      ctx.strokeStyle=rgba(color,alpha);ctx.lineWidth=p.size;
      ctx.beginPath();ctx.moveTo(x-Math.cos(angle)*length,y-Math.sin(angle)*length*.62);ctx.lineTo(x,y);ctx.stroke();
      if(p.hot){ctx.fillStyle=rgba(color,alpha*.08);ctx.beginPath();ctx.arc(x,y,p.size*2.5,0,Math.PI*2);ctx.fill()}
    }
    const surge=story.surge*(reduced?.35:1);
    if(surge>.005){
      const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,r*1.9);glow.addColorStop(0,rgba(palette.hot,surge*.045));glow.addColorStop(.48,rgba(palette.second,surge*.025));glow.addColorStop(1,rgba(palette.second,0));
      ctx.globalAlpha=layerAlpha;ctx.fillStyle=glow;ctx.fillRect(cx-r*1.9,cy-r*1.9,r*3.8,r*3.8);
    }
    ctx.restore();
  }
  const fluidTrails=new WeakMap(),fluidSprites=new Map();
  function fluidSprite(key){
    if(fluidSprites.has(key))return fluidSprites.get(key);
    const surface=document.createElement('canvas');surface.width=surface.height=96;const g=surface.getContext('2d'),c=themes[key].hot;
    const gradient=g.createRadialGradient(48,48,0,48,48,48);
    gradient.addColorStop(0,'rgba(255,255,255,.98)');
    gradient.addColorStop(.08,rgba(c,.96));
    gradient.addColorStop(.36,rgba(themes[key].core,.38));
    gradient.addColorStop(1,rgba(themes[key].second,0));
    g.fillStyle=gradient;g.fillRect(0,0,96,96);fluidSprites.set(key,surface);return surface;
  }
  function fluidTrailContext(target,nx,ny,pixelRatio){
    let state=fluidTrails.get(target);
    const width=Math.max(1,Math.round(nx*pixelRatio)),height=Math.max(1,Math.round(ny*pixelRatio));
    if(!state){const surface=document.createElement('canvas');state={surface,ctx:surface.getContext('2d'),width:0,height:0,dpr:1};fluidTrails.set(target,state)}
    if(state.width!==width||state.height!==height||state.dpr!==pixelRatio){state.surface.width=state.width=width;state.surface.height=state.height=height;state.dpr=pixelRatio;state.ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0)}
    return state;
  }
  function nebulaSafeNumber(value,fallback=0){
    return typeof value==='number'&&Number.isFinite(value)?value:fallback;
  }
  function validNebulaSurface(surface){
    try{
      return Boolean(
        surface&&
        Number.isFinite(surface.width)&&
        Number.isFinite(surface.height)&&
        surface.width>0&&
        surface.height>0&&
        typeof surface.getContext==='function'&&
        surface.getContext('2d')
      );
    }catch{
      return false;
    }
  }
  function recolorNebula(scene,key){
    const image=nebulaImages[scene],colors=themes[key];
    if(!image||!colors||!Number.isFinite(image.naturalWidth)||!Number.isFinite(image.naturalHeight)||image.naturalWidth<=0||image.naturalHeight<=0)return null;
    const cacheKey=scene+'-'+key;if(nebulaRecolored.has(cacheKey))return nebulaRecolored.get(cacheKey);
    try{
      const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;
      const sourceCtx=source.getContext('2d',{willReadFrequently:true});
      if(!sourceCtx)throw new Error('星云着色画布不可用');
      sourceCtx.drawImage(image,0,0);
      const frame=sourceCtx.getImageData(0,0,source.width,source.height),data=frame.data;
      if(!data||data.length!==source.width*source.height*4)throw new Error('星云像素读取不完整');
      const shadow=colors.shadow,body=colors.second,core=colors.core,cool=colors.cool,hot=colors.hot;
      const soft=(edge0,edge1,value)=>{const x=clamp((value-edge0)/(edge1-edge0),0,1);return x*x*(3-2*x)};
      for(let i=0;i<data.length;i+=4){
        const value=data[i]/255,warm=data[i+1]/255,coolMask=data[i+2]/255,alpha=data[i+3]/255;
        if(alpha<.014){data[i]=data[i+1]=data[i+2]=data[i+3]=0;continue}
        // R is the shared cloud luminance. G and B identify warm and cool
        // filaments, so every palette keeps the exact same ridges and dust gaps.
        const bodyRamp=soft(.015,.74,value),coreRamp=soft(.18,.95,value),ridgeRamp=soft(.18,.92,value);
        let red=shadow[0]+(body[0]-shadow[0])*bodyRamp;
        let green=shadow[1]+(body[1]-shadow[1])*bodyRamp;
        let blue=shadow[2]+(body[2]-shadow[2])*bodyRamp;
        red+=(core[0]-red)*coreRamp*.54;green+=(core[1]-green)*coreRamp*.54;blue+=(core[2]-blue)*coreRamp*.54;
        const coolAmount=coolMask*ridgeRamp*.48;
        red+=(cool[0]-red)*coolAmount;green+=(cool[1]-green)*coolAmount;blue+=(cool[2]-blue)*coolAmount;
        const hotAmount=warm*ridgeRamp*.58;
        red+=(hot[0]-red)*hotAmount;green+=(hot[1]-green)*hotAmount;blue+=(hot[2]-blue)*hotAmount;
        data[i]=Math.round(clamp(red,0,255));data[i+1]=Math.round(clamp(green,0,255));data[i+2]=Math.round(clamp(blue,0,255));
        data[i+3]=Math.round(alpha*247);
      }
      sourceCtx.putImageData(frame,0,0);
      nebulaRecolored.set(cacheKey,source);return source;
    }catch(error){
      console.warn('星云着色失败，已切换为程序化画面。',error);
      nebulaRecolored.set(cacheKey,null);return null;
    }
  }
  function nebulaRenderMotion(scene,t,look){
    return SonicVisualSystem.nebulaMotion(scene,{
      active:Boolean(playing||externalStream||instrumentSoundActive()),
      presence:music.presence,
      bass,mid,high,spectrum:terrainBands,
    },t,{
      intensity:look.intensity,
      glow:look.glow,
      motionSpeed:look.motionSpeed,
      reduced,
    });
  }
  function drawNebulaAsset(scene,cx,cy,r,t,opacity,look){
    const config={
      ring:{width:3.80,height:2.94,x:.060,y:-.01,rotate:-.055},
      galaxy:{width:4.05,height:3.08,x:.035,y:0,rotate:.06},
      peaks:{width:4.10,height:3.05,x:.025,y:.035,rotate:-.018},
      blackhole:{width:4.05,height:3.02,x:.035,y:0,rotate:-.05}
    }[scene];
    const safeOpacity=nebulaSafeNumber(opacity,0),safeR=nebulaSafeNumber(r,0),safeT=nebulaSafeNumber(t,0),safeLook=look&&typeof look==='object'?look:{};
    if(!config||!Number.isFinite(cx)||!Number.isFinite(cy)||safeR<=4||safeOpacity<=.002)return false;
    const surface=recolorNebula(scene,themeKey);if(!validNebulaSurface(surface))return false;
    const rawMotion=nebulaRenderMotion(scene,safeT,safeLook);
    const motion={
      activity:clamp(nebulaSafeNumber(rawMotion&&rawMotion.activity,0),0,1),
      bass:clamp(nebulaSafeNumber(rawMotion&&rawMotion.bass,0),0,1),
      mid:clamp(nebulaSafeNumber(rawMotion&&rawMotion.mid,0),0,1),
      high:clamp(nebulaSafeNumber(rawMotion&&rawMotion.high,0),0,1),
      scaleX:clamp(nebulaSafeNumber(rawMotion&&rawMotion.scaleX,1),.86,1.18),
      scaleY:clamp(nebulaSafeNumber(rawMotion&&rawMotion.scaleY,1),.84,1.22),
      rotation:clamp(nebulaSafeNumber(rawMotion&&rawMotion.rotation,0),-.22,.22),
      ambient:clamp(nebulaSafeNumber(rawMotion&&rawMotion.ambient,0),-1,1),
      bend:clamp(nebulaSafeNumber(rawMotion&&rawMotion.bend,0),0,1),
      ridge:clamp(nebulaSafeNumber(rawMotion&&rawMotion.ridge,0),0,1),
      glow:clamp(nebulaSafeNumber(rawMotion&&rawMotion.glow,0),0,1),
    };
    const calm=reduced?0:1,phase=scene==='ring'?0:scene==='galaxy'?1.7:scene==='peaks'?3.1:4.5;
    const width=safeR*config.width*(1+motion.ambient*.0016*calm),height=safeR*config.height*(1+motion.ambient*.0012*calm);
    const driftX=cx+safeR*(config.x+(Math.sin(safeT*.039+phase)*.004+mouse.x*.0035)*calm);
    const driftY=cy+safeR*(config.y+(Math.cos(safeT*.034+phase)*.003+mouse.y*.0025)*calm);
    const motionSpeed=clamp(nebulaSafeNumber(safeLook.motionSpeed,1),.25,2);
    const rotation=config.rotate+motion.rotation+(Math.sin(safeT*.034+phase)*.0025)*calm*Math.min(1.12,motionSpeed);
    const intensity=clamp(nebulaSafeNumber(safeLook.intensity,.7),.2,1);
    let saved=false;
    try{
      ctx.save();saved=true;ctx.globalCompositeOperation='source-over';
      ctx.globalAlpha=safeOpacity*clamp(.92+intensity*.075+visualEffects.glow*.02,0,1);
      ctx.translate(driftX,driftY);ctx.rotate(rotation);ctx.scale(motion.scaleX,motion.scaleY);
      ctx.drawImage(surface,0,0,surface.width,surface.height,-width/2,-height/2,width,height);
      // Music lifts a few soft highlights from the existing ridges. The full
      // atlas stays intact, avoiding partial-image seams on older GPUs.
      if(!reduced&&motion.ridge>.035){
        const count=scene==='peaks'?5:6,highlightAlpha=safeOpacity*clamp(motion.ridge*(.055+intensity*.055),0,.09);
        ctx.globalCompositeOperation='lighter';
        for(let index=0;index<count;index++){
          const angle=phase+index/count*Math.PI*2+Math.sin(safeT*.18+index*1.7)*.22;
          const x=scene==='peaks'?(index/(count-1)-.5)*width*.68:Math.cos(angle)*width*(scene==='blackhole'?.22:scene==='galaxy'?.25:.34);
          const y=scene==='peaks'?-height*.12+Math.sin(angle)*height*.11:Math.sin(angle)*height*(scene==='blackhole'?.18:scene==='galaxy'?.20:.28);
          const radius=width*(scene==='peaks'?.052:.044);
          const glow=ctx.createRadialGradient(x,y,0,x,y,radius);
          glow.addColorStop(0,rgba(palette.hot,highlightAlpha));
          glow.addColorStop(.38,rgba(palette.core,highlightAlpha*.44));
          glow.addColorStop(1,rgba(palette.core,0));
          ctx.fillStyle=glow;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
        }
      }
    }catch(error){
      console.warn('星云主体绘制失败，已切换为程序化画面。',error);
      return false;
    }finally{
      if(saved)ctx.restore();
    }
    if(scene===renderedMode)app.dataset.nebulaReaction=JSON.stringify({scene,activity:+motion.activity.toFixed(3),bass:+motion.bass.toFixed(3),mid:+motion.mid.toFixed(3),high:+motion.high.toFixed(3),scaleX:+motion.scaleX.toFixed(4),scaleY:+motion.scaleY.toFixed(4),bend:+motion.bend.toFixed(3),glow:+motion.glow.toFixed(3)});
    drawNebulaFlow(scene,surface,cx,cy,safeR,safeT,safeOpacity,safeLook,motion);return true;
  }
  const nebulaFlowCache=new Map();
  function nebulaFlowSurface(surface,scene,r){
    const safeR=nebulaSafeNumber(r,0);
    if(!validNebulaSurface(surface)||safeR<=0)return null;
    const crop={
      ring:{x:.48,y:.20,w:.52,h:.75,flip:true,rotate:-.16},
      galaxy:{x:.64,y:.14,w:.32,h:.80,flip:false,rotate:.11},
      peaks:{x:.55,y:.28,w:.45,h:.67,flip:false,rotate:-.045},
      blackhole:{x:.58,y:.15,w:.42,h:.78,flip:true,rotate:-.12}
    }[scene];
    if(!crop)return null;
    const viewportW=nebulaSafeNumber(w,1280),viewportH=nebulaSafeNumber(h,720);
    const key=[scene,themeKey,Math.round(viewportW),Math.round(viewportH),Math.round(safeR)].join('-');
    if(nebulaFlowCache.has(key))return nebulaFlowCache.get(key);
    const width=Math.round(clamp(Math.max(680,viewportW*.76),680,2400));
    const height=Math.round(clamp(Math.max(340,Math.min(viewportH*.50,safeR*2.30)),340,1400));
    let layer=null,g=null,saved=false;
    try{
      layer=document.createElement('canvas');layer.width=width;layer.height=height;
      g=layer.getContext('2d');
      if(!g)throw new Error('星云回流浪画布不可用');
      const sx=clamp(surface.width*crop.x,0,surface.width-1);
      const sy=clamp(surface.height*crop.y,0,surface.height-1);
      const sw=clamp(surface.width*crop.w,1,surface.width-sx);
      const sh=clamp(surface.height*crop.h,1,surface.height-sy);
      if(![sx,sy,sw,sh,width,height].every(Number.isFinite))throw new Error('星云回流尺寸无效');
      g.save();saved=true;g.translate(width*.52,height*.50);g.rotate(crop.rotate);g.scale(crop.flip?-1.10:1.10,1.02);
      g.globalAlpha=.72;
      g.drawImage(surface,sx,sy,sw,sh,-width*.49,-height*.45,width*.98,height*.90);
      nebulaFlowCache.set(key,layer);return layer;
    }catch(error){
      console.warn('星云回流生成失败，已保留主体星云。',error);
      nebulaFlowCache.set(key,null);return null;
    }finally{
      if(saved)g.restore();
    }
  }
  function drawNebulaFlow(scene,surface,cx,cy,r,t,opacity,look,motion){
    const safeR=nebulaSafeNumber(r,0),safeT=nebulaSafeNumber(t,0),safeOpacity=nebulaSafeNumber(opacity,0);
    if(!validNebulaSurface(surface)||!Number.isFinite(cx)||!Number.isFinite(cy)||safeR<=4||safeOpacity<=.002)return false;
    const safeLook=look&&typeof look==='object'?look:{};
    const sourceMotion=motion&&typeof motion==='object'?motion:{};
    const safeMotion={
      rotation:clamp(nebulaSafeNumber(sourceMotion.rotation,0),-.22,.22),
      ambient:clamp(nebulaSafeNumber(sourceMotion.ambient,0),-1,1),
      scaleX:clamp(nebulaSafeNumber(sourceMotion.scaleX,1),.86,1.18),
      scaleY:clamp(nebulaSafeNumber(sourceMotion.scaleY,1),.84,1.22),
    };
    const mobile=w<=760,calm=reduced?0:1;
    const phase=scene==='ring'?.7:scene==='galaxy'?2.1:scene==='peaks'?3.9:5.3;
    const startX=mobile?w*.06:Math.max(w*.34,cx-safeR*2.0),endX=w*.985;
    const yBase=cy+safeR*(mobile?2.1:1.72),ySpan=Math.max(0,Math.min(h-yBase-safeR*.18,safeR*(mobile?1.25:2.36)));
    const intensity=clamp(nebulaSafeNumber(safeLook.intensity,.7),.2,1);
    const alpha=clamp(safeOpacity*(.20+intensity*.08)*(.92+visualEffects.glow*.1),0,1);
    if(alpha<.004||ySpan<=0||endX<=startX)return false;
    const layer=nebulaFlowSurface(surface,scene,safeR);
    if(!validNebulaSurface(layer))return false;
    const flowX=startX+(Math.sin(safeT*.026+phase)*safeR*.008+mouse.x*safeR*.006)*calm;
    const flowY=yBase+(Math.cos(safeT*.031+phase)*safeR*.006+mouse.y*safeR*.005)*calm;
    const centerX=(startX+endX)*.5+flowX-startX,centerY=yBase+ySpan*.5+flowY-yBase;
    let saved=false;
    try{
      ctx.save();saved=true;ctx.globalCompositeOperation='source-over';
      ctx.globalAlpha=alpha;
      ctx.translate(centerX,centerY);ctx.rotate(safeMotion.rotation*.42+safeMotion.ambient*.0015*calm);ctx.scale(1+(safeMotion.scaleX-1)*.55,1+(safeMotion.scaleY-1)*.42);
      ctx.drawImage(layer,-(endX-startX)/2,-ySpan/2,endX-startX,ySpan);
    }catch(error){
      console.warn('星云回流绘制失败，已保留主体星云。',error);
      return false;
    }finally{
      if(saved)ctx.restore();
    }
    const fract=value=>value-Math.floor(value),hash=(value,salt=0)=>fract(Math.sin(value*127.1+salt*311.7)*43758.5453);
    saved=false;
    try{
      ctx.save();saved=true;ctx.globalCompositeOperation='lighter';
      const count=mobile?48:112;
      for(let i=0;i<count;i++){
        const u=hash(i,phase),v=hash(i,phase+2.7),wgt=hash(i,phase+5.1);
        const centerY=yBase+ySpan*(.04+u*.72+.08*Math.sin(u*8.2+phase+safeT*.022)*calm);
        const spread=(v+v*v+hash(i,phase+8.2)*.7-.85)*safeR*(.18+wgt*.30);
        const x=startX+(endX-startX)*(.04+u*.94)+Math.sin(safeT*.022+phase+i*.13)*calm*1.8;
        const y=clamp(centerY+spread,yBase,yBase+ySpan);
        const cluster=.65+.35*Math.sin(u*15.5+phase*2.1);
        const twinkle=.76+.24*Math.sin(safeT*(.38+wgt*.42)+i*1.73+phase);
        const a=alpha*(.028+v*.08)*cluster*twinkle;
        const size=.34+wgt*.95+(v>.985?1.8:0);
        ctx.fillStyle=rgba(v>.92?palette.hot:palette.core,a);
        ctx.fillRect(x,y,size,size);
        if(v>.992){
          const ray=2.4+wgt*3.5;ctx.strokeStyle=rgba(palette.hot,a*.5);ctx.lineWidth=.45;
          ctx.beginPath();ctx.moveTo(x-ray,y+.5);ctx.lineTo(x+ray+1,y+.5);ctx.moveTo(x+.5,y-ray);ctx.lineTo(x+.5,y+ray+1);ctx.stroke();
        }
      }
      for(let i=0;i<(mobile?12:24);i++){
        const u=hash(i,phase+11.3),v=hash(i,phase+14.8);
        const x=startX+(endX-startX)*(.05+u*.9),y=yBase+ySpan*(.08+hash(i,phase+17.2)*.64);
        const radius=.8+v*2.2;
        ctx.fillStyle=rgba(palette.hot,alpha*(.05+v*.11));ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=rgba(palette.core,alpha*.026);ctx.beginPath();ctx.arc(x,y,radius*5,0,Math.PI*2);ctx.fill();
      }
    }catch(error){
      console.warn('星云回流点缀绘制失败，已保留主体星云。',error);
      return false;
    }finally{
      if(saved)ctx.restore();
    }
    return true;
  }
  function drawEventHorizon(cx,cy,r,t,opacity){
    if(opacity<=.002)return;
    const pulse=1+bass*.012*intensity;
    ctx.save();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=Math.min(.92,opacity*.88);
    ctx.translate(cx,cy);ctx.rotate(-.11);ctx.scale(1,.57);
    const radius=r*.68*pulse;
    const halo=ctx.createRadialGradient(0,0,0,0,0,radius*1.34);
    halo.addColorStop(0,'rgba(1,2,6,.98)');
    halo.addColorStop(.50,'rgba(2,3,8,.92)');
    halo.addColorStop(.73,'rgba(3,4,10,.72)');
    halo.addColorStop(.90,'rgba(4,5,12,.16)');
    halo.addColorStop(1,'rgba(4,5,12,0)');
    ctx.fillStyle=halo;ctx.beginPath();
    for(let i=0;i<=72;i++){
      const a=i/72*Math.PI*2;
      const wobble=1+Math.sin(a*3.1+t*.015)*.026+Math.sin(a*7.4-t*.022)*.014+Math.sin(a*13.0+t*.008)*.007;
      const rr=radius*1.22*wobble,x=Math.cos(a)*rr,y=Math.sin(a)*rr;
      i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.closePath();ctx.fill();ctx.restore();
  }
  function drawFluidUniverse(cx,cy,r,t,dt,useAssets=false){
    const profile=exportRendering?SonicVisualSystem.performanceProfile({width:1280}):renderProfile,look=SonicVisualSystem.effectiveLook({...captureLook(),energySaver:exportRendering?false:energySaver},profile);
    const particles=exportRendering?exportParticles():{ring,galaxy:galaxyParticles},renderRing=particles.ring,renderGalaxy=particles.galaxy;
    const state=fluidTrailContext(ctx,w,h,Math.max(1,dpr)),g=state.ctx,sprite=fluidSprite(themeKey),count=Math.min(renderRing.length,look.effectiveParticleCount);
    const assetScenes=['ring','galaxy','peaks','blackhole'];
    if(useAssets)for(const scene of assetScenes)if(sceneWeights[scene]>.002)void loadNebulaAsset(scene);
    const loadedScenes=assetScenes.filter(nebulaAssetAvailable),activeSceneLoaded=Boolean(useAssets&&nebulaAssetAvailable(visualMode)),anySceneLoaded=Boolean(useAssets&&loadedScenes.length);
    g.save();g.setTransform(state.dpr,0,0,state.dpr,0,0);g.globalCompositeOperation='destination-out';g.globalAlpha=SonicVisualSystem.trailAlpha(look.effectiveTrail,Math.max(.012,dt||1/60));g.fillStyle='#000';g.fillRect(0,0,w,h);g.restore();
    const strength=(anySceneLoaded?.23:.42)+look.intensity*(anySceneLoaded?.38:.72)+look.glow*(anySceneLoaded?.08:.18),time=t*.16*look.motionSpeed,bassLift=bass*look.intensity,midFlow=mid*.7+music.flow*.22,flow=midFlow*look.motionSpeed;
    const overlayCount=anySceneLoaded?Math.max(w<=760?10:14,Math.min(w<=760?24:42,Math.round(count*(w<=760?.012:.018)))):count;
    app.dataset.nebulaAccentCount=String(overlayCount);
    app.dataset.nebulaFramesLoaded=loadedScenes.join(',');
    app.dataset.nebulaStructureMode=loadedScenes.length===assetScenes.length?'fixed-material-mask':loadedScenes.length?'asset-partial':'procedural-fallback';
    function pixel(x,y,size,alpha,hot=false){
      if(alpha<.008)return;g.globalAlpha=clamp(alpha,0,1);const scale=size*(hot?1.7:1);g.drawImage(sprite,x-scale/2,y-scale/2,scale,scale);
    }
    g.save();g.setTransform(state.dpr,0,0,state.dpr,0,0);g.globalCompositeOperation='lighter';
    const ringWeight=sceneWeights.ring;
    if(useAssets&&nebulaAssetAvailable('ring'))drawNebulaAsset('ring',cx,cy,r,t,ringWeight,look);
    if(ringWeight>.002)for(let i=0;i<overlayCount;i++){
      const p=renderRing[i],wave=SonicVisualSystem.fbm2(i*.031+time*.18,p.layer*2.2-time*.08,3),angle=p.a+time*.035+p.layer*.7+flow*.07,radius=r*(.56+p.r*.52+p.band*.055+wave*.025+bassLift*.025),squash=.83+visualEffects.depth*.06,flash=Math.pow(Math.max(0,Math.sin(p.phase*7+t*.5)),18)*treblePulse;
      pixel(cx+Math.cos(angle)*radius*1.32,cy+Math.sin(angle)*radius*squash,(anySceneLoaded?.72:1.7)+look.glow*(anySceneLoaded?.7:2.2)+p.layer*(anySceneLoaded?.55:1.8)+flash*(anySceneLoaded?1.8:4),(anySceneLoaded?.022:.1)+p.alpha*(anySceneLoaded?.08:.28)+flash*(anySceneLoaded?.22:.42),(flash>.08&&(anySceneLoaded?p.layer>.68:p.layer>.4)));
    }
    const galaxyWeight=sceneWeights.galaxy;
    if(useAssets&&nebulaAssetAvailable('galaxy'))drawNebulaAsset('galaxy',cx,cy,r,t,galaxyWeight,look);
    if(galaxyWeight>.002)for(let i=0;i<overlayCount;i++){
      const p=renderGalaxy[i],noise=SonicVisualSystem.fbm2(i*.027+time*.11,p.phase-time*.035,3),radius=r*(.08+Math.pow(p.radial,.72)*1.3*(1+bassLift*.025)),angle=p.arm*Math.PI*.5+Math.log1p(radius/r)*2.35+time*.032+flow*.11+noise*.08+p.scatter*.12,flash=Math.pow(Math.max(0,Math.sin(p.phase*9+t*.7)),20)*treblePulse;
      pixel(cx+Math.cos(angle)*radius*1.36,cy+Math.sin(angle)*radius*(.62+visualEffects.depth*.16),(anySceneLoaded?.58:1.2)+look.glow*(anySceneLoaded?.65:1.8)+p.size*(anySceneLoaded?.44:1)+flash*(anySceneLoaded?1.9:4),(anySceneLoaded?.018:.06)+(1-p.radial)*(anySceneLoaded?.09:.35)+flash*(anySceneLoaded?.24:.45),flash>.06||(p.radial<.1&&(anySceneLoaded?p.depth>.55:true)));
    }
    const peakWeight=sceneWeights.peaks;
    if(useAssets&&nebulaAssetAvailable('peaks'))drawNebulaAsset('peaks',cx,cy,r,t,peakWeight,look);
    if(peakWeight>.002)for(let i=0;i<overlayCount;i++){
      const u=((i*.61803398875)%1)*2-1,phase=(i*.381966)%1,band=terrainBands[Math.min(terrainBands.length-1,Math.floor((u+1)*.5*terrainBands.length))],noise=SonicVisualSystem.fbm2(i*.021+time*.1,phase-time*.035,3),layer=phase,base=cy+r*(.38-layer*.26)+bassLift*r*.03,height=(band*.34+SonicVisualSystem.smoothstep(-.6,.7,noise)*.2+midFlow*.06)*r*(.7+look.intensity*.45),x=cx+u*r*1.46,flash=Math.pow(Math.max(0,Math.sin(phase*15+t*.8)),22)*treblePulse;
      pixel(x,base-height,(anySceneLoaded?.42:r*(.6+layer*.7))+look.glow*.5,peakWeight*((anySceneLoaded?.018:.035)+(anySceneLoaded?.011:.07)*(1-layer)+flash*(anySceneLoaded?.14:.12))*strength,flash>.08);
      if(!anySceneLoaded&&layer<.42)pixel(x+noise*r*.1,base-height*.84,r*(.95+layer),peakWeight*.045*strength,false);
    }
    const holeWeight=sceneWeights.blackhole;
    if(useAssets&&nebulaAssetAvailable('blackhole'))drawNebulaAsset('blackhole',cx,cy,r,t,holeWeight,look);
    if(holeWeight>.002)for(let i=0;i<overlayCount;i++){
      const p=renderGalaxy[i],cycle=(p.radial-time*(.014+midFlow*.02))%1,inward=cycle<0?cycle+1:cycle,radius=r*(.13+Math.pow(inward,1.8)*1.45),noise=SonicVisualSystem.fbm2(i*.025+time*.12,inward*3-time*.06,3),angle=p.arm*Math.PI*.5+inward*5.2-time*.08-flow*.18+noise*.09,heat=1-inward,flash=Math.pow(Math.max(0,Math.sin(p.phase*11+t*.9)),18)*treblePulse,halo=.025+Math.max(0,.5-Math.abs(inward-.13))*.12+bassLift*.025;
      if(inward>.38)pixel(cx+Math.cos(angle)*radius*1.42,cy+Math.sin(angle)*radius*.68,(anySceneLoaded?.62:1.4)+heat*(anySceneLoaded?1.4:3.8)+look.glow*(anySceneLoaded?.65:2)+flash*(anySceneLoaded?2:5),(anySceneLoaded?.018:.055)+heat*(anySceneLoaded?.09:.32)+flash*(anySceneLoaded?.2:.4)+bassLift*halo,heat>.64||flash>.08);
    }
    g.restore();
    ctx.save();ctx.globalAlpha=lightAlpha();ctx.drawImage(state.surface,0,0,w,h);ctx.restore();
    if(!activeSceneLoaded&&holeWeight>.08)drawEventHorizon(cx,cy,r,t,holeWeight);
  }
  function lightAlpha(){return (storyVisualsActive()?clamp(story.light,0,1):1)*(atelier.settings.breathing?(.46+breath*.54):1)}
  function draw(t,dt){
    const quiet=exportRendering||app.classList.contains('quiet'),manualZoom=exportRendering?camera.zoom:1+(camera.zoom-1)*immersiveMix;
    const yaw=cinema.yaw+camera.yaw*(exportRendering?1:immersiveMix),pitch=cinema.pitch+camera.pitch*(exportRendering?1:immersiveMix),zoom=cinema.zoom*manualZoom;
    const light=(storyVisualsActive()?clamp(story.light,0,1):1)*(atelier.settings.breathing?.46+breath*.54:1);
    ctx.fillStyle='#080911';ctx.fillRect(0,0,w,h);
    if(backgroundLayer&&light>.001){ctx.save();ctx.globalAlpha=light;ctx.drawImage(backgroundLayer,0,0,w,h);ctx.restore()}
    const cx=centerX+mouse.x*12+Math.sin(yaw)*baseR*.18,cy=centerY+mouse.y*9+pitch*baseR*.18;
    const pulse=reduced?0:beatPulse,r=baseR*(1+bass*.018*intensity+music.sustain*.008+pulse*.012*intensity+(reduced?0:Math.sin(t*.4)*.0025));
    ctx.save();ctx.globalAlpha=light;
    if(!nebulaAssetAvailable(visualMode))drawDepthMist(cx,cy,baseR,t,yaw,pitch);
    for(const s of stars){
      const depth=.35+s.speed*.65,scale=1+(zoom-1)*depth;
      let x=(s.x*w-w/2)*scale+w/2+mouse.x*s.speed*9-Math.sin(yaw*.4)*w*depth*.3;
      let y=(s.y*h-h/2)*scale+h/2+mouse.y*s.speed*6-pitch*h*depth*.2;
      x=((x%(w+12))+(w+12))%(w+12)-6;y=((y%(h+12))+(h+12))%(h+12)-6;
      const dist=Math.hypot((x-cx)/1.2,y-cy),near=dist<baseR*.7?.35:1,twinkle=.72+.28*Math.sin(t*s.speed*.55+s.phase);
      const spark=music.shimmer*Math.pow((Math.sin(s.phase*8+t*.3)+1)/2,16)*(reduced?.15:1);
      const reveal=storyVisualsActive()&&story.phase==='intro'?smooth((story.reveal-s.phase/6.283)*6):1;
      const a=clamp(s.alpha*twinkle*near*(.7+intensity*.4)+spark*.65,0,1)*reveal;
      if(a<.003)continue;
      ctx.fillStyle=rgba(s.r>1.25?palette.hot:[176,173,204],a);const size=(s.r+spark)*Math.sqrt(zoom);ctx.fillRect(x,y,size,size);
      if(s.r>1.4&&s.alpha>.6||spark>.5){ctx.strokeStyle=rgba(palette.hot,(a*.25+spark*.45*reveal+music.air*.12*reveal)*intensity);ctx.lineWidth=.5;const ray=3+spark*5+music.air*.8;ctx.beginPath();ctx.moveTo(x-ray,y+.5);ctx.lineTo(x+ray+1,y+.5);ctx.moveTo(x+.5,y-ray);ctx.lineTo(x+.5,y+ray+1);ctx.stroke()}
    }
    ctx.restore();
    ctx.save();ctx.globalAlpha=light;
    ctx.translate(cx,cy);ctx.rotate(yaw*.36);ctx.scale(zoom,zoom*(1+pitch*.38));ctx.translate(-cx,-cy);
    if(storyVisualsActive()&&story.nebula>.1){
      ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha*=story.nebula*.055*(1-sceneWeights.peaks*.65);
      const glow=ctx.createRadialGradient(cx,cy,baseR*.08,cx,cy,baseR*1.7);
      glow.addColorStop(0,rgba(palette.core,.42));glow.addColorStop(.34,rgba(palette.second,.16));glow.addColorStop(1,rgba(palette.shadow,0));
      ctx.fillStyle=glow;ctx.fillRect(cx-baseR*1.7,cy-baseR*1.7,baseR*3.4,baseR*3.4);ctx.restore();
    }
    const fluid=Boolean(window.SonicVisualSystem);
    if(!fluid){
      const constellations=w<=760?[[.06,.26,.13,.29,.08,.34]]:[[.41,.25,.45,.29,.43,.37,.47,.4],[.87,.5,.91,.47,.94,.55,.92,.6],[.37,.65,.42,.7,.46,.67]];
      ctx.strokeStyle=rgba(palette.core,.09);ctx.lineWidth=.6;
      for(const points of constellations){ctx.beginPath();for(let i=0;i<points.length;i+=2){const x=points[i]*w,y=points[i+1]*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke();for(let i=0;i<points.length;i+=2){ctx.fillStyle=rgba(palette.hot,.35);ctx.fillRect(points[i]*w-1,points[i+1]*h-1,2,2)}}
      for(const key of Object.keys(sceneWeights))drawScene(key,cx,cy,r,t,sceneWeights[key]);
      drawMusicFilaments(cx,cy,r,t);drawReformingStars(cx,cy,r,t);drawDepthMist(cx,cy,r,t,yaw,pitch,true);drawBlackholeCore(cx,cy,r,t,sceneWeights.blackhole);
    }else drawFluidUniverse(cx,cy,r,t,dt,true);
    drawStoryBloom(cx,cy,r,t);
    for(let i=shooting.length-1;i>=0;i--){const p=shooting[i];p.life-=dt/p.ttl;if(p.life<=0){shooting.splice(i,1);continue}p.x+=p.vx*dt;p.y+=p.vy*dt;ctx.fillStyle=rgba(palette.hot,p.life*.7);ctx.fillRect(p.x,p.y,1.6,1.6)}
    ctx.restore();
    drawAtelierEffects(t);drawInstrumentStars(t);
    if(w>760&&!quiet){const shade=ctx.createLinearGradient(0,0,w*.4,0);shade.addColorStop(0,'rgba(8,9,17,.65)');shade.addColorStop(1,'rgba(8,9,17,0)');ctx.fillStyle=shade;ctx.fillRect(0,0,w*.4,h)}
  }

  function animate(now){
    rafId=0;if(!animationRunning)return;
    try{
      if(document.hidden){stopAnimation();return}
      if(listeningPresentation&&!clipLocked()&&!instrumentOpen&&!$('atelierDialog').open){stopAnimation();return}
      const dt=Math.min((now-(lastFrame||now))/1000,.05);lastFrame=now;
      const interval=reduced?1000/15:energySaver&&!clipLocked()?1000/30:1000/60;if(now-drawTime<interval-1){rafId=requestAnimationFrame(animate);return}const elapsed=Math.min((now-(drawTime||now))/1000,.1);drawTime=now;const renderStarted=performance.now();
      updateInstrument(elapsed,now);updateAtelier(elapsed,now);readAudio(elapsed,now);updateStory(elapsed);if(!reduced&&seekVisualTarget===null)sceneTime+=elapsed*(.065+music.presence*.19+music.drift*.20+music.percussion*.12)*motionSpeed*(atelier.settings.breathing?lifeMotion:1);
      mouse.x+=(mouse.tx-mouse.x)*(reduced?0:.04);mouse.y+=(mouse.ty-mouse.y)*(reduced?0:.04);
      cloudBlend=Math.min(1,cloudBlend+elapsed*.65);
      modeOpacity=Math.min(1,modeOpacity+elapsed*2.2);
      ['core','second','shadow','cool','hot','ui'].forEach(k=>{for(let i=0;i<3;i++)palette[k][i]+=(targetPalette[k][i]-palette[k][i])*(1-Math.exp(-elapsed*3))});
      const uiRgb=palette.ui.map(Math.round),inkRgb=palette.shadow.map(v=>Math.min(255,Math.round(v+18))),themeBgRgb=palette.shadow.map((v,i)=>Math.min(255,Math.round(v+(palette.core[i]-v)*.12))),rootStyle=document.documentElement.style;rootStyle.setProperty('--accent',rgba(palette.core,1));rootStyle.setProperty('--accent-rgb',palette.core.map(Math.round).join(','));rootStyle.setProperty('--accent-ui',`rgb(${uiRgb.join(',')})`);rootStyle.setProperty('--accent-ui-rgb',uiRgb.join(','));rootStyle.setProperty('--accent-ink',`rgb(${inkRgb.join(',')})`);rootStyle.setProperty('--theme-bg-rgb',themeBgRgb.join(','));
      updatePolish(elapsed,now);draw(sceneTime,elapsed);renderClipFrame();frame++;
      if(now-lastUIUpdate>95){lastUIUpdate=now;updateTimeline();updateJourneyUI();updateExternalSignal(now);if($('clipDialog').open)clipUpdateControls();const values=[bass,mid,high];['bass','mid','high'].forEach((name,i)=>{const value=Math.round(values[i]*100);$(name+'Value').textContent=value+'%';$(name+'Fill').style.width=value+'%'});$('beatLight').style.opacity=.2+music.cloud*.8;$('melodyLight').style.opacity=.2+music.flow*.8;$('trebleLight').style.opacity=.2+music.shimmer*.8;app.dataset.musicLayers=JSON.stringify({cloud:+music.cloud.toFixed(3),flow:+music.flow.toFixed(3),shimmer:+music.shimmer.toFixed(3),presence:+music.presence.toFixed(3)});app.dataset.musicCharacter=JSON.stringify({sustain:+music.sustain.toFixed(3),percussion:+music.percussion.toFixed(3),air:+music.air.toFixed(3),drift:+music.drift.toFixed(3)});app.dataset.musicState=music.presence>.12?'listening':'resting';app.dataset.beatPulse=beatPulse.toFixed(3);app.dataset.treblePulse=treblePulse.toFixed(3)}
      if(!visualFirstFrameReady){visualFirstFrameReady=true;maybeFinishVisualLoading()}
      const renderCost=performance.now()-renderStarted;app.dataset.frameCost=renderCost.toFixed(1);
      if(energySaver&&!clipLocked()){overloadFrames=renderCost>90?overloadFrames+1:Math.max(0,overloadFrames-2);if(overloadFrames>=30){stopAnimation();app.dataset.qualityReason='overloaded';window.activateVisualFallback('设备运行完整画面较吃力，已自动换成轻量星光。音乐可继续播放。');return}}
      if(!energySaver&&!energyUserChoice&&!clipLocked()){slowFrameCount=renderCost>25?slowFrameCount+1:Math.max(0,slowFrameCount-1);if(slowFrameCount>=45){energySaver=true;resize();syncEffects();savePreferences();app.dataset.qualityReason='slow-device';showToast('检测到画面吃力，已自动开启省电模式。')}}
      rafId=requestAnimationFrame(animate);
    }catch(error){stopAnimation();console.error(error);window.reportVisualFatal?.('完整画面运行中断，已切换轻量星光。可继续听音乐，或重试完整效果。')}
  }
  function startAnimation(){if(animationRunning||document.hidden||(listeningPresentation&&!clipLocked()&&!instrumentOpen&&!$('atelierDialog').open))return;animationRunning=true;lastFrame=0;drawTime=0;app.dataset.rafRunning='true';rafId=requestAnimationFrame(animate)}
  function stopAnimation(){animationRunning=false;if(rafId)cancelAnimationFrame(rafId);rafId=0;app.dataset.rafRunning='false'}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAnimation();else if(app.dataset.visualFallback!=='active')startAnimation()});
  window.__retryVisualEngine=()=>{stopAnimation();visualFirstFrameReady=false;slowFrameCount=0;overloadFrames=0;energySaver=true;resize();syncEffects();startAnimation()};
  window.sonicDesktop?.onQuitCheckpoint?.(async()=>{
    saveSession();
    await syncNavidromeResume(2500).catch(()=>{});
  });
  window.addEventListener('pagehide',()=>{cancelNextOnlinePreparation();queueChartMatch?.abort();loadAbort?.abort();saveSession();stopExternal('',true);generation++;loadGeneration++;stopDemo();audio.pause();if(objectUrl)URL.revokeObjectURL(objectUrl);if(audioContext)audioContext.close()});
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});

  function setupProjectPack(){
    const dialog=document.createElement('dialog');dialog.id='projectDialog';dialog.className='space-dialog';dialog.setAttribute('aria-labelledby','projectTitle');
    dialog.innerHTML='<div class="dialog-heading"><div><div class="dialog-kicker">MAKE A UNIVERSE OF YOUR OWN</div><h2 id="projectTitle">从一首歌，到你的星空作品</h2></div><button class="icon-btn" id="projectClose" aria-label="关闭创作与备份">×</button></div><p class="project-note">按自己的节奏完成四步。示例音乐也可以创作。</p><ol class="project-steps"><li><button data-project-action="uploadBtn">选一首音乐 ↗</button><small id="projectSong"></small></li><li><button data-project-action="presetBtn">挑选星空与光感 ↗</button><small>从预设出发，调整粒子、色彩与空间。</small></li><li><button data-project-action="atelierBtn">写歌词，收藏片刻 ↗</button><small>把一句话和一个时间点留在音乐里。</small></li><li><button data-project-action="postcardBtn">制作星空明信片 ↗</button><small>预览画面、填写署名，再保存图片。</small></li></ol><hr><h3>完整作品备份</h3><p class="project-note">把本地音乐文件、封面、歌词、歌单、收藏片刻、演奏和草稿一起保存。备份仅保存在你下载的文件里，最多 1 GB；已导出的视频和图片请另行保管。</p><div class="project-actions"><button class="primary-btn" id="backupExport">导出完整备份</button><button class="secondary-btn" id="backupImport">从文件恢复</button></div><input type="file" id="backupFile" accept=".sonicpack" hidden><section id="backupPreview" hidden><p id="backupSummary"></p><p class="project-note">恢复将替换这个浏览器里的曲库和创作。请先导出当前备份，并关闭其他声波宇宙页面。</p><div class="project-actions"><button class="primary-btn" id="backupRestore">恢复并替换本机内容</button><button class="secondary-btn" id="backupCancel">取消恢复</button></div></section><p id="backupStatus" class="project-note" role="status" aria-live="polite"></p>';
    app.append(dialog);let pending=null,locked=false;
    const status=text=>$('backupStatus').textContent=text;
    function lock(value){locked=value;dialog.querySelectorAll('button').forEach(b=>b.disabled=value);}
    $('projectBtn').onclick=()=>{if(clipLocked()||importing){showToast('请先完成音乐导入或录制。');return}$('projectSong').textContent='当前：'+(currentTrack()?.name||'星际漫游');dialog.showModal()};
    $('projectClose').onclick=()=>dialog.close();dialog.addEventListener('cancel',e=>{if(locked)e.preventDefault()});
    dialog.querySelectorAll('[data-project-action]').forEach(button=>button.onclick=()=>{dialog.close();$(button.dataset.projectAction).click()});
    $('backupCancel').onclick=()=>{pending=null;$('backupPreview').hidden=true;status('已取消，当前内容保持原样。')};
    $('backupImport').onclick=()=>$('backupFile').click();
    $('backupExport').onclick=async()=>{
      lock(true);status('正在保存草稿和打包音乐，请稍候…');
      try{
        await loadFeatureScript('project-pack.js','SonicProjectPack');
        await libraryPromise;if(!libraryReady||restoring||!atelierReady)throw Error('作品仍在载入，请稍候重试。');
        saveSession();savePreferences();saveDrafts();saveInstrument();
        const writes=await Promise.all([persistLibrary(),persistAtelier(),persistBackground()]);await storageChain;
        if(writes.some(ok=>!ok)||storageIssues.size)throw Error('部分内容尚未保存，请解决存储提示后重试，避免导出不完整作品。');
        const blob=await SonicProjectPack.encode(await SonicProjectPack.snapshot(await openLibraryDB(),localStorage));
        const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='我的声波宇宙-'+new Date().toISOString().slice(0,10)+'.sonicpack';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
        status('完整备份已生成（'+(blob.size/1048576).toFixed(1)+' MB），请保存下载文件。');
      }catch(error){status('未能导出：'+error.message)}finally{lock(false)}
    };
    $('backupFile').onchange=async()=>{
      const file=$('backupFile').files[0];$('backupFile').value='';pending=null;$('backupPreview').hidden=true;if(!file)return;
      lock(true);status('正在检查备份完整性…');
      try{await loadFeatureScript('project-pack.js','SonicProjectPack');pending=await SonicProjectPack.decode(file);const library=pending.state.find(e=>e[0]==='library')[1];$('backupSummary').textContent='备份包含 '+library.tracks.length+' 首音乐，其中 '+pending.media.length+' 个本地音频文件，以及创作设置和草稿。';$('backupPreview').hidden=false;status('检查通过，确认后才会替换本机内容。')}
      catch(error){status('无法恢复：'+error.message)}finally{lock(false)}
    };
    $('backupRestore').onclick=async()=>{
      if(!pending)return;lock(true);status('正在恢复，请保持页面打开…');
      try{await libraryPromise;await storageChain;clearTimeout(draftTimer);backupRestoring=true;await SonicProjectPack.restore(await openLibraryDB(),localStorage,pending);status('恢复完成，正在重新打开作品…');location.reload()}
      catch(error){backupRestoring=false;status('恢复失败，原有内容已保留：'+error.message);lock(false)}
    };
  }

  try{setupProjectPack();setupJourney();setupPostcards();app.append($('postcardDialog'));setupLibraryFive();setupOnlineMusic();setupEditionThree();setupExternalFive();setupFilm();setupAtelier();setupInstrument();setupPolish();setupVisualPresets();updateTimeline();resize();startAnimation();}catch(error){console.error(error);window.reportVisualFatal?.('完整画面初始化未完成，已启用轻量星光。可播放示例或重试。')}
  async function localTrackDetails(id) {
    await Promise.all([libraryPromise,atelierPromise]);
    const track=tracks.find(item=>item.id===id&&item.kind==='file');
    if(!track)throw new Error('这首本地歌曲已不在曲库。');
    const {name,artist='',album='',cover=null,duration,sourcePath='',sourceMissing=false}=track;
    const lyrics=atelier.songs[id]?.lyrics;
    return {id,kind:'file',name,artist,album,cover,duration,sourcePath,sourceMissing,lyricsRaw:lyrics?.raw||'',translationRaw:lyrics?.translationRaw||'',
      lyricsOrigin:lyrics?.origin||''};
  }
  async function saveLocalTrackDetails(id,draft) {
    await localTrackDetails(id);
    if(importing||folderScanning)throw new Error('文件夹正在扫描，请稍后保存。');
    const track=tracks.find(item=>item.id===id&&item.kind==='file');
    if(!track)throw new Error('这首本地歌曲已不在曲库。');
    function editedLabel(field,label) {
      const original=track[field]||'';
      const next=draft[field];
      if(typeof next!=='string'||next===original)return original;
      const value=next.trim();
      if(value.length>200)throw new Error(label+'最多 200 个字符。');
      return value;
    }
    const title=editedLabel('name','歌名'),artist=editedLabel('artist','歌手'),album=editedLabel('album','专辑');
    if(!title.trim())throw new Error('请输入歌名。');
    const art=atelier.songs[id],previous=art?.lyrics;
    const raw=typeof draft.lyricsRaw==='string'?draft.lyricsRaw.trim():previous?.raw||'';
    const translationRaw=typeof draft.translationRaw==='string'?draft.translationRaw.trim():previous?.translationRaw||'';
    const lyricsChanged=raw.trim()!==(previous?.raw||'').trim(),translationChanged=translationRaw.trim()!==(previous?.translationRaw||'').trim();
    const nextLyrics=lyricsChanged&&raw?parseLRC(raw):[];
    if(lyricsChanged&&raw&&(raw.length>160000||!nextLyrics.some(line=>line.text)))throw new Error('请填写带时间轴的歌词，支持 LRC、YRC、KRC、QRC、TTML 和 VTT。');
    if(translationChanged&&translationRaw&&(!raw||translationRaw.length>160000||!parseLRC(translationRaw).some(line=>line.text)))throw new Error('请同时填写原文和带时间轴的翻译歌词。');
    if(draft.cover!==track.cover&&draft.cover!==null&&!(typeof draft.cover==='string'&&draft.cover.length<=1048576&&/^data:image\/(?:webp|png|jpeg);base64,[a-z0-9+/=]+$/i.test(draft.cover)))throw new Error('封面图片无效，请重新选择。');

    const fields={name:title,artist,album,cover:draft.cover};
    for(const [field,value] of Object.entries(fields))if((track[field]??(field==='cover'?null:''))!==value)(track.manualFields||={})[field]=true;
    Object.assign(track,fields);
    const onlineSuggestion=draft.lyricsIntent==='online';
    const manualLyrics=draft.lyricsIntent==='manual'||translationChanged||lyricsChanged&&!onlineSuggestion;
    const addOnlineLyrics=onlineSuggestion&&lyricsChanged&&raw&&!previous?.raw&&!hasProtectedLocalLyrics(track,previous);
    if(manualLyrics||addOnlineLyrics) {
      if(manualLyrics)(track.manualFields||={}).lyrics=true;
      (atelier.songs[id]||={}).lyrics=lyricRecord(art,raw,raw?translationRaw:'',manualLyrics?'manual':'online');
      if(id===activeId){lyricCache=null;lyricIndex=-1;lyricTrack=null;}
    }
    const saved=persistLibrary(true);
    if(id===activeId)renderActiveTrack();
    renderPlaylist();
    window.dispatchEvent(new Event('sonic:transport-state'));
    return saved;
  }
  async function enrichLocalTrackDetails(draft,signal) {
    const enrichment=SonicTrackEnrichment;
    const identity=enrichment.localIdentity(draft);
    if(!identity)return {status:'insufficient'};
    const track=tracks.find(item=>item.id===draft.id&&item.kind==='file');
    const lyrics=atelier.songs[draft.id]?.lyrics;
    const includeLyrics=draft.lyricsIntent!=='manual'&&!draft.lyricsRaw?.trim()&&!lyrics?.raw?.trim()&&!hasProtectedLocalLyrics(track,lyrics);
    let result;
    try{result=await enrichment.enrichLocalTrack(draft,{client:onlineClient,includeLyrics,signal});}
    catch(error){signal?.throwIfAborted();result={status:'unavailable'};}
    if(result.status==='matched'&&result.cover) {
      try {
        const response=await fetch(onlineClient.coverUrl(result.mediaId),{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)].filter(Boolean))});
        if(!response.ok)throw new Error('封面读取失败');
        result.cover=await prepareImage(await response.blob(),true);
      }catch{signal?.throwIfAborted();result.cover=null;result.coverUnavailable=true;}
    }
    if(includeLyrics&&!result.lyricsRaw){
      try {
        const lyricsRaw=await enrichment.findTimedLyrics({...identity,album:draft.album},signal);
        if(lyricsRaw)result={...result,...identity,status:'matched',lyricsRaw,lyricsSource:'LRCLIB'};
      }catch{signal?.throwIfAborted();}
    }
    return result;
  }
  function localEnrichmentCandidates(ids){
    const wanted=new Set(ids);
    return tracks.filter(track=>track.kind==='file'&&wanted.has(track.id)&&
      ((!track.cover&&!track.manualFields?.cover)||(!atelier.songs[track.id]?.lyrics&&!track.manualFields?.lyrics)))
      .map(track=>track.id);
  }
  async function previewLocalEnrichment(id,signal){
    const draft=await localTrackDetails(id);
    const track=tracks.find(item=>item.id===id);
    if(!track||!localEnrichmentCandidates([id]).length)return null;
    const result=await enrichLocalTrackDetails({...draft,cover:draft.cover||(track.manualFields?.cover?true:null)},signal);
    if(result.status!=='matched'||(!result.cover&&!result.lyricsRaw))return null;
    return {draft,cover:result.cover||null,lyricsRaw:result.lyricsRaw||'',lyricsSource:result.lyricsSource||'汽水音乐'};
  }
  async function applyLocalEnrichment(matches){
    if(importing||folderScanning)throw new Error('文件夹正在扫描，请稍后保存。');
    let count=0;
    for(const {draft,cover,lyricsRaw} of matches){
      const track=tracks.find(item=>item.id===draft.id&&item.kind==='file');
      if(!track||['name','artist','album','duration'].some(field=>(track[field]??'')!==draft[field]))continue;
      const addedCover=cover&&!track.cover&&!track.manualFields?.cover;
      if(addedCover){track.cover=cover;(track.manualFields||={}).cover=true;}
      const addedLyrics=lyricsRaw&&!hasProtectedLocalLyrics(track)&&attachImportedLyrics(track.id,lyricsRaw);
      if(addedCover||addedLyrics)count++;
    }
    if(!count)return {count,saved:!storageIssues.has('library')||await persistLibrary(true)};
    const saved=await persistLibrary(true);
    renderActiveTrack();renderPlaylist();window.dispatchEvent(new Event('sonic:transport-state'));
    return {count,saved};
  }
  // One playback engine serves the listening room, legacy creator and desktop mini player.
  // Only public track metadata crosses this boundary; blobs, cookies and signed URLs stay private.
  // 只读诊断：音量曲线与响度补偿的实际增益，供自测与问题排查。
  window.SonicAudioDiagnostics = () => ({
    volumeGain: masterGain ? Number(masterGain.gain.value.toFixed(4)) : null,
    loudnessGain: normGain ? Number(normGain.gain.value.toFixed(4)) : null,
    loudnessDb: normGain && normGain.gain.value > 0 ? Number((20 * Math.log10(normGain.gain.value)).toFixed(2)) : null,
    measuredTracks: [...loudnessCache.keys()],
    measuring: [...loudnessMeasuring],
  });
  function homeMixes(){
    const excluded=new Set(smartExcluded),recent=new Map(recentTrackIds.map((id,index)=>[id,index]));
    const local=tracks.filter(track=>track.kind==='file'&&track.blob&&track.duration>0&&!excluded.has(track.id));
    if(!local.length)return [];
    const mixes=[
      ['focus','专注',(a,b)=>b.duration-a.duration],
      ['relax','放松',(a,b)=>Number(b.favorite||false)-Number(a.favorite||false)],
      ['night','夜听',(a,b)=>(recent.get(a.id)??recent.size)-(recent.get(b.id)??recent.size)],
    ];
    return mixes.map(([id,name,compare])=>({id,name,
      trackIds:local.slice().sort(compare).slice(0,20).map(track=>track.id)}));
  }
  window.SonicPlayback = Object.freeze({
    library() {
      return {
        ready:libraryReady,
        readFailed:libraryReadFailed,
        saveFailed:storageIssues.has('library')&&!libraryReadFailed,
        importing:importing||folderScanning,
        tracks:tracks.map(track=>({id:track.id,name:track.name,artist:track.artist||'',album:track.album||'',kind:track.kind,
          favorite:Boolean(track.favorite),duration:track.duration,cover:trackCoverSources(track).primary||null,sourcePath:track.sourcePath||'',sourceMissing:track.sourceMissing===true,
          provider:track.provider,mediaId:track.mediaId,externalUrl:track.externalUrl})),
        playlists:playlists.map(({id,name,trackIds})=>({id,name,trackIds:trackIds.slice(),synced:Boolean(qishuiMirrorSource(id))})),
        recent:recentTrackIds.slice(),
      };
    },
    importReport:()=>libraryImportReport,playImportedMusic,
    homeMixes,
    playHomeDemos(){
      if(currentTrack()?.kind==='demo'&&(playing||sessionQueue?.label==='内置示例'))return play();
      const ids=initialDemoTracks().map(track=>track.id);
      return this.playFromLibrary(ids[0],'all',true,ids,'内置示例');
    },
    recentTracks(limit=4){
      const maximum=Math.max(0,Math.min(4,Math.floor(limit)));
      if(!maximum)return [];
      const recent=[];
      for(const id of recentTrackIds){
        const track=tracks.find(item=>item.id===id&&item.stored&&isPlayableTrack(item));
        if(!track)continue;
        recent.push({id,name:track.name,artist:track.artist||'',kind:track.kind,provider:track.provider,cover:trackCoverSources(track).primary||null});
        if(recent.length===maximum)break;
      }
      return recent;
    },
    smartMusic(mode='familiar'){
      const recent=new Map(recentTrackIds.map((id,index)=>[id,index]));
      const excluded=new Set(smartExcluded),current=currentTrack();
      const familiar=track=>track.favorite||smartCounts.has(track.id)||recent.has(track.id);
      const similar=track=>Number(Boolean(current?.artist)&&recordingKey(track.artist)===recordingKey(current.artist))*2+
        Number(Boolean(current?.album)&&recordingKey(track.album)===recordingKey(current.album));
      const skipPenalty=track=>Math.min(21,(smartSkips.get(track.id)||0)*7);
      const score=track=>(mode==='similar'?similar(track)*16:0)+(track.favorite?12:0)+(smartCounts.get(track.id)||0)*3+
        (recent.has(track.id)?4/(recent.get(track.id)+1):0)-skipPenalty(track);
      const items=tracks.filter(track=>track.kind==='file'&&track.blob&&!excluded.has(track.id)&&
        (mode==='new'?!familiar(track):mode==='similar'?track.id!==activeId&&similar(track)>0:familiar(track)));
      return {items:items.sort((first,second)=>score(second)-score(first)).slice(0,6),
        available:tracks.some(track=>track.kind==='file'&&track.blob),
        excluded:smartExcluded.map(id=>tracks.find(track=>track.id===id)).find(Boolean)||null};
    },
    skipFromPlayer(){
      const track=currentTrack(),position=getLocalPosition();
      if(playing&&track?.kind==='file'&&position<Math.min(15,track.duration/3)){
        const previous=smartSkips.get(track.id)||0;
        smartSkips.delete(track.id);smartSkips.set(track.id,Math.min(previous+1,99));
        if(smartSkips.size>500)smartSkips.delete(smartSkips.keys().next().value);
        saveSmartMusic();
        window.dispatchEvent(new Event('sonic:library-change'));
      }
      return navigateTrack(1);
    },
    setSmartInterest(id,interested){
      if(!tracks.some(track=>track.kind==='file'&&track.id===id))return;
      smartExcluded=smartExcluded.filter(value=>value!==id);
      if(!interested)smartExcluded.unshift(id);
      smartExcluded=smartExcluded.slice(0,500);
      saveSmartMusic();
      window.dispatchEvent(new Event('sonic:library-change'));
    },
    playFromLibrary(id, view='all', keepPlaying=false, resultIds=null, queueLabel='') {
      if(!libraryReady||busy||trackLoading||pendingFile||onlinePending||instrumentOpen||clipLocked())return;
      const track=tracks.find(item=>item.id===id);
      if(!track)return;
      if(track.kind==='soda'){openSodaUrl(track.externalUrl);return;}
      cancelOnlinePick();
      const sameTrack=id===activeId&&!externalStream&&!externalPending;
      if(sameTrack&&!keepPlaying)return play();
      if(Array.isArray(resultIds)){
        const byId=new Map(tracks.map(item=>[item.id,item]));
        const entries=[...new Set(resultIds)].map(resultId=>byId.get(resultId)).filter(isPlayableTrack).map(item=>queueItem(item));
        const current=entries.find(entry=>entry.trackId===id);
        if(!current)return;
        if(externalStream||externalPending)stopExternal(undefined,true);
        setSessionQueue(entries,current.entryId,queueLabel||(view==='recent'?'最近播放':view==='imported'?'新导入':view==='smart'?'为你推荐':'曲库搜索结果'));
        if(sameTrack&&preparedTrackId===id)return playing?undefined:play();
        return playQueueFrom(current.entryId,{holdOnFailure:true});
      }
      leaveSessionQueue();
      const scope=validPlaybackScope(view)?view:'all';
      if(usePlaybackScope(scope)){resetShuffle(id);persistLibrary();renderLibraryControls();}
      if(sameTrack)return playing?undefined:play();
      return playScopedFrom(id);
    },
    savePlaylist(name,id) {
      const saved=saveLibraryPlaylist(name,id);
      if(saved){persistLibrary();renderPlaylist();}
      return saved;
    },
    setMembership:setPlaylistTracks,
    editPlaylistMembership,movePlaylistTracks,
    async retryPlaylistSave(){
      await atelierPromise;
      return persistLibrary(true);
    },
    retryLibraryRead,
    toggleFavorite:toggleTrackFavorite,
    lyricSearch(query){
      if(typeof query!=='string'||query.length<2)return [];
      const term=query.normalize('NFKC').toLocaleLowerCase();
      const ids=[];
      for(const [id,song] of Object.entries(atelier.songs||{})){
        if(!song?.lyrics?.raw||song.lyrics.enabled===false)continue;
        const {lyrics}=song,raw=lyrics.raw;
        let indexed=lyricSearchText.get(lyrics);
        if(indexed?.raw!==raw){
          indexed={raw,plain:raw.replace(/\[[^\]\r\n]*\]|<[^>\r\n]*>/g,'').normalize('NFKC').toLocaleLowerCase()};
          lyricSearchText.set(lyrics,indexed);
        }
        if(indexed.plain.includes(term))ids.push(id);
      }
      return ids;
    },
    localTrackDetails,saveLocalTrackDetails,enrichLocalTrackDetails,
    localEnrichmentCandidates,previewLocalEnrichment,applyLocalEnrichment,
    prepareTrackCover:file=>prepareImage(file,true),
    snapshot(options = {}) {
      const heldTrack=recoveryTrack();
      const track=heldTrack||currentTrack(), saved=heldTrack?null:currentLyrics();
      const externalMetadata = externalStream ? externalPlayback?.snapshot() : null;
      const lines = externalStream ? externalPlayback?.lyrics(externalMetadata)||[] : heldTrack||saved?.enabled===false ? [] : saved?.lines || (mode === 'online' ? onlineTimedLyrics : []);
      const externalTrack = externalMetadata?.status==='ready' ? externalMetadata : null;
      const position = externalStream ? externalTrack?.position??0 : getLocalPosition();
      const mediaStart = mode === 'online'&&!heldTrack ? onlineClipStart : 0;
      const offset = externalStream||heldTrack?0:lyricOffset();
      const clean = item => ({ id:item.id, name:item.name, artist:item.artist||'', album:item.album||'', kind:item.kind, provider:item.provider, favorite:Boolean(item.favorite), cover:trackCoverSources(item).primary||null });
      let scopedQueue;
      if(options.queue){
        if(sessionQueue){
          const byId=new Map(tracks.map(item=>[item.id,item]));
          scopedQueue=sessionQueue.items.flatMap(entry=>{
            const item=byId.get(entry.trackId)||entry.remote||entry.chart||entry.file;
            return item?[{...clean(item),entryId:entry.entryId}]:[];
          });
        }else scopedQueue=scopedPlaybackTracks().map(item=>({...clean(item),entryId:item.id}));
      }
      const queueLimit=options.queueLimit||scopedQueue?.length||1;
      const queueEntryId=sessionQueue?sessionQueue.currentId:activeId;
      const activeIndex=scopedQueue?.findIndex(item=>item.entryId===queueEntryId)??-1;
      const queueStart=Math.max(0,Math.min(activeIndex,(scopedQueue?.length||0)-queueLimit));
      return {
        ready:libraryReady, busy:Boolean(busy||pendingFile||onlinePending||restoring||trackLoading||queueChartMatch||onlinePickTrack),
        playing, demoOnly:tracks.length>0&&tracks.every(track=>track.kind==='demo'), importing:importing||folderScanning,
        external:Boolean(externalStream), externalPending, externalSignal:externalHealth, externalMetadata, volume,
        buffering:Boolean(onlineStall), playbackInterrupted:Boolean(standaloneRecovery?.id===activeId),
        duration:externalStream?(externalTrack?.duration??0):heldTrack?(heldTrack.duration||0):localDuration(),
        lyricDuration:externalStream?(externalTrack?.duration??0):heldTrack?(heldTrack.duration||0):duration,
        position, lyricPosition:position+mediaStart-offset,
        lyricsInfo:heldTrack?null:lyricInfo(saved,lines,externalMetadata),
        lyricOffset:offset,lyricMediaStart:mediaStart,canNudgeLyrics:atelierReady&&!externalStream&&!instrumentOpen&&!trackLoading&&Boolean(lines.length),
        track:externalStream?{id:externalTrack?'external:'+JSON.stringify([externalTrack.sourceId,externalTrack.title,externalTrack.artist]):'external',name:externalTrack?.title||'外部音乐',artist:externalTrack?.artist||externalTrack?.sourceApp||'在原播放器中控制',album:externalTrack?.album||'',kind:'external',cover:null,favorite:false}:track?clean(track):null,
        lyrics:lines, playbackMode:effectivePlaybackMode(),
        customQueue:Boolean(sessionQueue),queueRevision,queueEntryId,
        queueRecovery:sessionQueue?.recovery?{...sessionQueue.recovery}:null,
        playbackRecovery:playbackRecoveryView(),queueTarget:queueTargetView(),
        resumePending:Boolean(deferredResume&&!playing&&activeId===resumePoint?.id),
        queueCount:scopedQueue?.length,
        queueScope:scopedQueue?(sessionQueue?.label||collectionName(playbackScope)):undefined,
        queue:scopedQueue?.slice(queueStart,queueStart+queueLimit),
        onlineReady, onlineLoggedIn,
        audioQuality:!heldTrack&&!externalStream&&mode==='online'&&preparedTrackId===activeId?actualOnlineQuality:null,
        audioPreview:!heldTrack&&!externalStream&&mode==='online'&&preparedTrackId===activeId?Boolean(track?.preview):null,
        navidromeAudio:!heldTrack&&!externalStream&&track?.provider==='navidrome'&&preparedTrackId===activeId&&activeOnlineTicket?.delivery?
          {source:activeOnlineTicket.sourceFormat,delivery:activeOnlineTicket.delivery}:null,
      };
    },
    sample(seconds) {
      if (!animationRunning) {
        const now=performance.now(),dt=Math.min(.1,Math.max(0,seconds));
        readAudio(dt,now,true);
        updateExternalSignal(now);
      }
      return { bass, mid, high, pulse:beatPulse, beat:{...beatTracker.state}, rms:rawRms, presence:music.presence, sustain:music.sustain, air:music.air, flow:music.flow };
    },
    readSpectrum(bands) {
      const source=externalAnalyser||analyser;
      if(!source||!freqData||!(playing||externalStream)) { bands.fill(0); return; }
      const binHz=audioContext.sampleRate/source.fftSize;
      for(let band=0;band<bands.length;band++) {
        const start=Math.max(1,Math.floor(50*200**(band/bands.length)/binHz));
        const end=Math.min(freqData.length,Math.max(start+1,Math.ceil(50*200**((band+1)/bands.length)/binHz)));
        let peak=0;
        for(let bin=start;bin<end;bin++)peak=Math.max(peak,freqData[bin]);
        bands[band]=visualSignal(peak/255);
      }
    },
    position: () => externalStream ? externalPlayback?.position()??0 : getLocalPosition(),
    continueListening,
    resumeInfo(){
      const track=resumeTrack();
      if(!track)return null;
      const queue=resumePoint.queue,remaining=Array.isArray(queue?.entries)?Math.max(0,queue.entries.length-1-queue.current):0;
      const activeRecovery=currentPlaybackRecovery();
      const target=activeRecovery?.queue?resolveQueueItem(activeRecovery.id,activeRecovery.queue)?.trackId:activeRecovery?.id;
      const recovery=target===track.id?activeRecovery.recovery.reason:(queue?.recovery||resumePoint.recovery)?.reason||null;
      const attempt=playbackRetryAttempt;
      const phase=playbackRetryIsCurrent(attempt,attempt?.phase==='resuming')?attempt.phase:null;
      return {id:track.id,name:track.name,artist:track.artist||'',kind:track.kind,provider:track.provider,cover:trackCoverSources(track).primary||null,
        position:resumePoint.position,remaining,retry:Boolean(recovery),recovery,phase,
        canSkip:target===track.id&&canSkipRecovery(activeRecovery),exhausted:target===track.id&&activeRecovery.recovery.exhausted===true};
    },
    async localAudioFormat(id){
      const track=currentTrack();
      if(track?.kind!=='file'||track.id!==id||!track.blob)return null;
      const reader=await loadFeatureScript('local-file-tags.js','SonicFileTags');
      return await reader.readAudioFormat(track.blob);
    },
    async audioQualities(){
      const track=currentTrack(),generation=loadGeneration;
      if(track?.kind!=='online'||trackLoading||!actualOnlineQuality)return [];
      const current=actualOnlineQuality;
      const alternate=track.provider==='navidrome'?(current==='lossless'?'standard':'lossless'):'hires';
      const data=await requestOnlineAudio(track,{quality:alternate,retry:false});
      if(loadGeneration!==generation||data.preview!==track.preview||!audioQualityLevels.includes(data.quality))return [];
      return [...new Set([current,data.quality])];
    },
    async switchAudioQuality(quality){
      const track=currentTrack(),generation=loadGeneration,previous=activeOnlineTicket;
      if(track?.kind!=='online'||!previous||trackLoading||!audioQualityLevels.includes(quality)||quality===actualOnlineQuality)return false;
      const controller=new AbortController(), probe=new Audio();
      probe.preload='metadata';
      let data;
      try{
        data=await requestOnlineAudio(track,{quality,retry:false,signal:controller.signal});
        ({data}=await loadOnlineMetadata(probe,track,data,controller.signal,8000));
      }catch{return false;}
      finally{probe.removeAttribute('src');probe.load();}
      if(generation!==loadGeneration||data.quality!==quality||data.preview!==previous.preview)return false;
      const resume=playing,position=getLocalPosition(),queue=sessionQueue;
      const result=await selectTrack(track.id,resume,position,true,{queue,reportFailure:true,onlineData:data});
      if(result?.ok)return true;
      if(loadGeneration===generation+1&&activeId===track.id){
        await selectTrack(track.id,resume,position,true,{queue,reportFailure:true,onlineData:previous});
      }
      return false;
    },
    nudgeLyrics,retryOnlineLyrics,capturePlaybackMoment,
    toggle: () => {cancelOnlinePick();return play();}, previous: () => navigateTrack(-1), next: () => navigateTrack(1),
    select: id => {cancelOnlinePick();usePlaybackScope(playbackScope);return playScopedFrom(id);}, seek: position => seekTo(Number(position)),
    openDiscovery: (root,options)=>window.SonicMusicDiscovery.open(root,onlineClient,window.SonicPlayback,options),
    playNavidromeList,navidromeProgress,syncNavidromeResume,searchNavidrome,searchQishui,checkQishuiSearchTrack,playQishuiSearchTrack,saveQishuiSearchTrack,playOnlineList,playChartList,playRecording,checkRecording,refreshSyncedPlaylist:refreshQishuiMirror,
    retryQueue,retryPlayback,skipPlayback,
    selectQueueEntry: id => {cancelOnlinePick();return sessionQueue?playQueueFrom(id,{holdOnFailure:true}):playScopedFrom(id);},
    moveQueueEntry:moveSessionEntry,removeQueueEntry:removeSessionEntry,queueTrack:addSessionTrack,canUndoQueue,undoQueue,
    toggleMute,
    setVolume(value) { volume=clamp(Number(value),0,1);if(volume>0)lastVolume=volume;updateVolume();savePreferences(); },
    audioOutputs,setAudioOutput,setPlaybackRate,setSleepTimer,
    playbackSettings(){return {rate:playbackRate,sleepDeadline,output:typeof audioContext?.sinkId==='string'?audioContext.sinkId:''};},
    favorite() { toggleTrackFavorite(activeId); },
    cyclePlayback() { $('repeatBtn').click(); },
    importMusic() { $('fileInput').click(); }, importFolder:openMusicFolder, locatePlaybackFile,
    openLibrary() { $('queueBtn').click(); },
    openOnline(query,{searchOnly=false,opener=document.activeElement}={}) {
      onlineSearchOpener=opener;
      setOnlineSearchPresentation(searchOnly);
      $('queueBtn').click();document.querySelector('[data-library-view="soda"]')?.click();
      $('onlineSearchLibraryBtn').hidden=!listeningPresentation;
      const input=$('onlineSearchInput');
      if(typeof query==='string'){
        input.value=query.trim().slice(0,100);
        if(input.value&&onlineReady)void runOnlineSearch();
      }
      if(input.disabled&&searchOnly)$('queueDialog').querySelector('[data-close="queueDialog"]').focus();
      else input.focus();
    },
    editLyrics() { $('atelierBtn').click();document.querySelector('[data-atelier-tab="lyrics"]')?.click();startAnimation(); },
    importCurrentLyrics(){
      if(currentTrack()?.kind!=='file'||externalStream||externalPending||trackLoading)return;
      window.SonicPlayback.editLyrics();
      $('importLyricBtn').click();
    },
    connectExternal, stopExternal, selectExternalMetadata:sourceId=>externalPlayback?.select(sourceId),
    findExternalLyrics() {
      const info=externalPlayback?.snapshot();
      if(!info?.lyricsKey||!info.artist||info.duration>3600)return Promise.resolve({ok:false,message:'需要播放器提供完整的曲名、歌手和时长。'});
      return externalPlayback.loadLyrics((track,signal)=>window.SonicTrackEnrichment.findTimedLyrics(track,signal),parseLRC,'LRCLIB');
    },
    importExternalLyrics(file) {
      if(!file||!file.size||file.size>250000)return Promise.resolve({ok:false,message:'请选择 250 KB 以内的同步歌词文件。'});
      if(!externalPlayback)return Promise.resolve({ok:false,message:'外部歌词需要 Windows 播放器提供进度。'});
      return externalPlayback.loadLyrics(()=>file.text(),parseLRC,'本地歌词');
    },
    toast: showToast,
    presentation(active) {
      listeningPresentation=Boolean(active);
      if(active){stopAnimation();app.dataset.visualReady='true';window.deactivateVisualFallback?.();}
      else{resize();updateTimeline();startAnimation();}
    },
    refreshLegacy() { if(listeningPresentation&&($('atelierDialog').open||instrumentOpen||clipLocked()))startAnimation(); },
  });
  window.dispatchEvent(new CustomEvent('sonic:playback-ready'));
  if(new URLSearchParams(location.search).has('sharedViewer')&&window.parent!==window){
    document.documentElement.classList.add('shared-viewer');
    Promise.all([atelierPromise,libraryPromise]).then(()=>{
      try{
        const hash=location.hash.slice(1);if(!hash||hash.length>8000||!/^[A-Za-z0-9_-]+$/.test(hash))throw Error('链接内容无效');
        const str=atob(hash.replace(/-/g,'+').replace(/_/g,'/'));const bytes=Uint8Array.from(str,c=>c.charCodeAt(0));
        const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(data.version!==1||!data.base||!validLook(data.base.look)||!Array.isArray(data.cues)||data.cues.length>60)throw Error('链接内容无效');
        const cues=data.cues.map((c,i)=>validCue({...c,id:'shared-'+i}));if(cues.some(c=>!c))throw Error('时间点无效');
        atelier.songs.demo={base:validCue({...data.base,id:'base',time:0,burst:false}),cues,cuesEnabled:true};
        cues.sort((a,b)=>a.time-b.time);restoreView(atelier.songs.demo.base);cueTrack=null;cuePosition=-1;updateCues(0);
        sendSharedMessage({type:'sonic-share-ready'});
        getSharedPort().then(port=>{port.addEventListener('message',async event=>{if(event.data?.type!=='sonic-share-toggle')return;await play();sendSharedMessage({type:'sonic-share-state',playing})});port.start?.()});
      }catch(error){sendSharedMessage({type:'sonic-share-error',message:error.message})}
    }).catch(()=>sendSharedMessage({type:'sonic-share-error',message:'画面加载失败'}));
  }

})();
