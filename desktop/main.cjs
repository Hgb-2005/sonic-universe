'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, screen, powerMonitor, dialog, net, protocol } = require('electron');
const path = require('node:path');
const { createAppServer } = require('../companion/server.cjs');
const { trustedFrame, externalUrl, playerState, lyricDocument } = require('./policy.cjs');
const { createDesktopLyrics } = require('./desktop-lyrics.cjs');
const { createExternalNowPlaying } = require('./external-now-playing.cjs');
const { scheme: musicFolderScheme, createMusicFolderPicker } = require('./music-folder.cjs');
protocol.registerSchemesAsPrivileged([{scheme:musicFolderScheme,privileges:{
  standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,
}}]);
const { createReleaseCheck, downloadUpdate, latestReleaseUrl } = require('./release-update.cjs');
const checkRelease=createReleaseCheck((...args)=>net.fetch(...args),app.getVersion());
let releaseDownloading=false;

const port=Number(process.env.SONIC_DESKTOP_PORT||17865),origin='http://127.0.0.1:'+port;
const musicFolder=createMusicFolderPicker(dialog,origin);
let window=null,mini=null,tray=null,server=null,quitting=false,captureUntil=0,lastState=playerState(null);
let screenLocked=false,systemSuspended=false,captureMetadataApproved=false,captureMetadataEpoch=0;
let mainReady=false,mainNeedsReload=false,mainCommand=null,mainReloadTimer=null;
let quitCheckpointTimer=null,quitCheckpointComplete=false;
let lastLyricState=null;
const externalNowPlaying=createExternalNowPlaying({
  helper:path.join(__dirname,'native','NowPlayingHost.exe').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep),
  executablePath:process.execPath,
});
if(process.env.SONIC_DESKTOP_PROFILE)app.setPath('userData',path.resolve(process.env.SONIC_DESKTOP_PROFILE));
app.setName('声波宇宙');
if(!app.requestSingleInstanceLock()){app.quit();}
else {
  app.on('second-instance',()=>showMain());
  app.whenReady().then(start).catch(error=>{dialog.showErrorBox('声波宇宙未能启动',error.message);quitting=true;app.quit();});
}
function sendTo(target,channel,value){
  if(!target||target.isDestroyed())return;
  const contents=target.webContents;
  if(!contents.isDestroyed()&&!contents.isCrashed())contents.send(channel,value);
}
const send=(channel,value)=>sendTo(window,channel,value);
const desktopLyrics = createDesktopLyrics({
  onState({ visible }) {
    send('sonic:desktop-lyrics-state', visible);
    rebuildTray();
  },
});
function showMain(command='show') {
  if(!window||window.isDestroyed()||quitting)return;
  const ready=mainReady&&!mainNeedsReload;
  if(!ready){
    mainCommand=command;
    if(mainNeedsReload)loadMain(window);
  }
  if(window.isMinimized())window.restore();
  window.show();
  window.focus();
  publishVisibility();
  if(ready)send('sonic:command',command);
}
function screenInactive(){return screenLocked||systemSuspended;}
function publishVisibility(){
  if(!mainReady||!window||window.isDestroyed())return;
  const visible=!screenInactive()&&window.isVisible()&&!window.isMinimized();
  send('sonic:visibility',visible);
}
function valid(event){return trustedFrame(event,window,origin);}
function externalMetadataAllowed(event){return valid(event)&&captureMetadataApproved&&lastState.external&&
  !screenInactive()&&window.isVisible()&&!window.isMinimized();}
function stopCaptureMetadata(){captureMetadataApproved=false;captureMetadataEpoch++;externalNowPlaying.close();}
function publishNativeState(state) {
  lastState=state;
  desktopLyrics.publish(lastState);
  sendTo(mini,'sonic:player-state',lastState);
}
function clearNativePlayback() {
  captureUntil=0;
  stopCaptureMetadata();
  publishNativeState(lastState.external?playerState(null):{...lastState,playing:false});
}
function completeQuitCheckpoint(){
  if(!quitCheckpointTimer)return;
  clearTimeout(quitCheckpointTimer);
  quitCheckpointTimer=null;
  quitCheckpointComplete=true;
  if(window&&!window.isDestroyed())window.webContents.session.flushStorageData();
  app.quit();
}
function validOrigin(value){try{return new URL(value).origin===origin;}catch{return false;}}
function trustedMini(event){return mini&&!mini.isDestroyed()&&event.sender===mini.webContents&&event.senderFrame===mini.webContents.mainFrame;}
function settings(){return {startup:app.getLoginItemSettings().openAtLogin,wallpaper:false,wallpaperAvailable:false,desktopLyrics:desktopLyrics.visible};}
function secureContents(contents) {
  contents.setWindowOpenHandler(({url})=>{const target=externalUrl(url);if(target)shell.openExternal(target).catch(console.warn);return {action:'deny'};});
  contents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin){event.preventDefault();const target=externalUrl(url);if(target)shell.openExternal(target).catch(console.warn);}}catch{event.preventDefault();}});
}
function parkFailedMain(target) {
  if(!target.isVisible()||target.isMinimized())return;
  target.hide();
  if(process.platform==='win32'&&tray&&!screenInactive()){
    tray.displayBalloon({
      title:'声波宇宙已收起',
      content:'播放界面遇到问题。可从系统托盘重新打开。',
    });
  }
}
function loadMain(target) {
  clearTimeout(mainReloadTimer);
  mainReloadTimer=null;
  if(quitting||target!==window||target.isDestroyed())return;
  mainReady=false;
  mainNeedsReload=false;
  target.loadURL(origin+'/?v='+app.getVersion()).catch(error=>{
    if(quitting||target!==window||target.isDestroyed()||error.code==='ERR_ABORTED')return;
    mainNeedsReload=true;
    console.warn('[Desktop]',error.message);
    if(!mainReloadTimer)parkFailedMain(target);
  });
}
function createMain() {
  if(quitting||window&&!window.isDestroyed())return;
  const candidate=new BrowserWindow({width:1360,height:900,minWidth:760,minHeight:580,title:'声波宇宙',icon:path.join(__dirname,'../outputs/assets/sonic-icon.png'),backgroundColor:'#101019',autoHideMenuBar:true,show:false,
    titleBarStyle:'hidden',titleBarOverlay:{color:'#101019',symbolColor:'#ded8e9',height:35},
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window=candidate;
  let nextAutomaticReload=0;
  secureContents(candidate.webContents);
  const rendererSession=candidate.webContents.session;
  function allowPermission(contents,permission,requestUrl,isMainFrame){
    return contents===window?.webContents&&isMainFrame&&validOrigin(requestUrl)&&
      (permission==='fullscreen'||permission==='speaker-selection'||(permission==='display-capture'&&Date.now()<=captureUntil));
  }
  rendererSession.setPermissionCheckHandler((contents,permission,requestOrigin,details)=>
    allowPermission(contents,permission,requestOrigin,details.isMainFrame));
  rendererSession.setPermissionRequestHandler((contents,permission,callback,details)=>
    callback(allowPermission(contents,permission,details.requestingUrl,details.isMainFrame)));
  rendererSession.setDisplayMediaRequestHandler((request,callback)=>{
    if(!window||window.isDestroyed()||screenInactive()||!window.isVisible()||window.isMinimized()||request.frame!==window.webContents.mainFrame||!validOrigin(request.securityOrigin)||!request.audioRequested||!request.userGesture||Date.now()>captureUntil){callback(null);return;}
    captureUntil=0;
    // Chromium requires a video source to start getDisplayMedia. Use this app's own frame
    // and discard that track immediately on the renderer side. No screen content is used.
    captureMetadataApproved=true;captureMetadataEpoch++;
    callback({video:request.frame,audio:'loopback'});
  });
  candidate.once('ready-to-show',()=>{if(!quitting)candidate.show();});
  candidate.on('close',event=>{if(!quitting){event.preventDefault();candidate.hide();}});
  for(const event of ['minimize','restore','show','hide'])candidate.on(event,publishVisibility);
  for(const event of ['enter-full-screen','leave-full-screen']){
    candidate.on(event,()=>sendTo(candidate,'sonic:fullscreen-state',candidate.isFullScreen()));
  }
  candidate.on('closed',()=>{
    if(window!==candidate)return;
    clearTimeout(mainReloadTimer);
    mainReady=false;
    window=null;
    if(!quitting){clearNativePlayback();setTimeout(createMain,300);}
  });
  candidate.webContents.on('did-start-navigation',({isMainFrame,isSameDocument})=>{
    if(isMainFrame&&!isSameDocument){mainReady=false;musicFolder.clear();}
  });
  candidate.webContents.on('render-process-gone',(_event,details)=>{
    if(quitting||window!==candidate)return;
    mainReady=false;
    mainNeedsReload=true;
    musicFolder.clear();
    clearNativePlayback();
    console.warn('[Desktop] Renderer stopped:',details.reason);
    const now=Date.now();
    if(now<nextAutomaticReload){parkFailedMain(candidate);return;}
    nextAutomaticReload=now+30000;
    // Reload in the existing window so a minimized or hidden window stays that way.
    mainReloadTimer=setTimeout(()=>loadMain(candidate),200);
  });
  loadMain(candidate);
}
function createMini() {
  if(quitting)return;
  if(mini&&!mini.isDestroyed()){mini.show();mini.focus();return;}
  const bounds=screen.getPrimaryDisplay().workArea;
  const candidate=new BrowserWindow({width:370,height:148,minWidth:330,minHeight:148,maxHeight:148,x:bounds.x+bounds.width-394,y:bounds.y+bounds.height-172,title:'声波宇宙 · 迷你播放器',frame:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,backgroundColor:'#151e2d',show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mini=candidate;
  candidate.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  candidate.webContents.on('will-navigate',event=>event.preventDefault());
  candidate.webContents.on('render-process-gone',()=>{if(!candidate.isDestroyed())candidate.destroy();});
  candidate.once('ready-to-show',()=>{
    if(quitting||candidate!==mini)return;
    candidate.show();
    sendTo(candidate,'sonic:player-state',lastState);
  });
  candidate.on('closed',()=>{if(mini===candidate)mini=null;});
  candidate.loadFile(path.join(__dirname,'mini.html')).catch(error=>{
    if(!quitting&&!candidate.isDestroyed()){console.warn('[Mini]',error.message);candidate.destroy();}
  });
}
function rebuildTray() {
  if(!tray)return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'打开声波宇宙',click:()=>showMain()},
    {label:'工作陪伴',click:()=>showMain('work')},{label:'歌词欣赏',click:()=>showMain('listen')},
    {label:'迷你播放器',click:createMini},
    {label:'桌面歌词',type:'checkbox',checked:desktopLyrics.visible,click:()=>void desktopLyrics.toggle()},
    {label:'锁定桌面歌词',type:'checkbox',checked:desktopLyrics.locked,enabled:desktopLyrics.visible,click:()=>desktopLyrics.toggleLock()},
    {type:'separator'},{label:'退出声波宇宙',click:()=>app.quit()},
  ]));
}
async function start() {
  app.setAppUserModelId('com.sonicuniverse.desktop');Menu.setApplicationMenu(null);
  const profile=process.env.SONIC_DESKTOP_PROFILE;
  server=createAppServer({port,root:path.join(__dirname,'..','outputs'),allowPublishedOrigin:false,
    dataDirectory:profile?path.join(app.getPath('userData'),'music-session'):undefined,
    lyricState:()=>{
      if(!lastLyricState)return null;
      const position=lastState.position;
      const lyricPosition=position+lastLyricState.mediaStart+lastLyricState.offset;
      let index=-1;
      for(let i=0;i<lastLyricState.lines.length;i+=1){
        if(lastLyricState.lines[i].time<=lyricPosition)index=i;
        else break;
      }
      return {...lastLyricState,position,playing:lastState.playing,index,line:lastLyricState.lines[index]||null};
    },
    onError:error=>console.warn('[Companion]',error.message)});
  await server.ready;await server.listen();
  console.log('[Desktop] '+origin);
  protocol.handle(musicFolderScheme,musicFolder.handle);
  createMain();
  const image=nativeImage.createFromPath(path.join(__dirname,'../outputs/assets/sonic-icon.png')).resize({width:32,height:32});
  tray=new Tray(image);tray.setToolTip('声波宇宙 · 音乐陪你一会儿');
  for(const event of ['double-click','balloon-click'])tray.on(event,()=>showMain());
  rebuildTray();
  ipcMain.handle('sonic:select-music-folder',event=>valid(event)?musicFolder.select(window):null);
  ipcMain.handle('sonic:release-music-folder',(event,token)=>{
    if(valid(event)&&typeof token==='string'&&token)musicFolder.clear(token);
  });
  ipcMain.handle('sonic:mini',event=>{if(!valid(event))return false;createMini();return true;});
  ipcMain.handle('sonic:desktop-lyrics',event=>valid(event)?desktopLyrics.toggle():{ok:false,message:'无效的窗口。'});
  ipcMain.handle('sonic:settings',event=>valid(event)?settings():{});
  ipcMain.handle('sonic:stage-frame',async event=>{
    if(!valid(event))return null;
    const frame=await event.sender.capturePage();
    return frame.isEmpty()?null:frame.toDataURL();
  });
  ipcMain.handle('sonic:check-release',event=>valid(event)?checkRelease():null);
  ipcMain.handle('sonic:open-update',async event=>{
    if(!valid(event))return false;
    await shell.openExternal(latestReleaseUrl);return true;
  });
  ipcMain.handle('sonic:download-update',async event=>{
    if(!valid(event)||releaseDownloading)return {message:'当前无法开始下载。'};
    releaseDownloading=true;
    try{
      const {available}=await checkRelease();
      const installer=available?.installer;
      if(!installer||!valid(event))return {message:'没有可校验的安装包，可查看发布页。'};
      const destination=await dialog.showSaveDialog(window,{title:'保存新版本安装包',defaultPath:path.join(app.getPath('downloads'),installer.filename),filters:[{name:'Windows 安装包',extensions:['exe']}]});
      if(destination.canceled||!destination.filePath)return {message:'已取消下载。'};
      await downloadUpdate((...args)=>net.fetch(...args),installer,destination.filePath);
      shell.showItemInFolder(destination.filePath);
      return {ok:true,message:'安装包已下载并通过校验。打开该文件可进行安装。'};
    }catch(error){return {message:error.message||'暂时无法下载。'};}
    finally{releaseDownloading=false;}
  });
  ipcMain.handle('sonic:startup',(event,enabled)=>{if(!valid(event))return {ok:false,message:'无效的窗口。'};try{app.setLoginItemSettings({openAtLogin:enabled===true});return {ok:true};}catch(error){return {ok:false,message:error.message};}});
  ipcMain.handle('sonic:fullscreen',(event,enabled)=>{
    if(!valid(event)||typeof enabled!=='boolean'||quitting)return false;
    window.setFullScreen(enabled);
    return true;
  });
  ipcMain.handle('sonic:capture',event=>{
    if(!valid(event)||screenInactive()||!window.isVisible()||window.isMinimized())throw Error('请从可见的主窗口连接声音。');
    captureUntil=Date.now()+5000;
    return true;
  });
  ipcMain.handle('sonic:external-now-playing',async(event,options)=>{
    if(!externalMetadataAllowed(event))return null;
    const epoch=captureMetadataEpoch;
    const details=await externalNowPlaying.query(typeof options?.sourceId==='string'?options.sourceId.slice(0,36):null);
    return epoch===captureMetadataEpoch&&externalMetadataAllowed(event)?details:null;
  });
  // Reject requests from an older renderer before making any native window changes.
  ipcMain.handle('sonic:wallpaper',(event,enabled)=>{
    if(!valid(event))return {ok:false,message:'无效的窗口。'};
    return enabled?{ok:false,active:false,message:'动态桌面已暂停。'}:{ok:true,active:false,message:'当前使用普通窗口。'};
  });
  ipcMain.on('sonic:lyrics',(event,value)=>{
    if(!valid(event))return;
    lastLyricState=lyricDocument(value);
  });
  ipcMain.on('sonic:state',(event,value)=>{
    if(!valid(event))return;
    const state=playerState(value);
    if(lastState.external&&!state.external)stopCaptureMetadata();
    publishNativeState(state);
    if(!mainReady){
      mainReady=true;
      mainNeedsReload=false;
      publishVisibility();
      send('sonic:desktop-lyrics-state',desktopLyrics.visible);
      send('sonic:fullscreen-state',window.isFullScreen());
      if(mainCommand){send('sonic:command',mainCommand);mainCommand=null;}
    }
  });
  ipcMain.on('sonic:desktop-lyrics-command',(event,command)=>desktopLyrics.command(event,command));
  ipcMain.on('sonic:quit-checkpoint-saved',event=>{if(valid(event))completeQuitCheckpoint();});
  ipcMain.on('sonic:command',(event,command)=>{if(!trustedMini(event))return;if(command==='hide-mini'){mini.hide();return;}if(command==='show'){showMain();return;}if(['play','previous','next','listen','work'].includes(command))send('sonic:command',command);});
  function syncScreenActivity() {
    if(screenInactive()){captureUntil=0;externalNowPlaying.close();}
    publishVisibility();
    desktopLyrics.suspend(screenInactive());
  }
  powerMonitor.on('lock-screen',()=>{screenLocked=true;syncScreenActivity();});
  powerMonitor.on('unlock-screen',()=>{screenLocked=false;syncScreenActivity();});
  powerMonitor.on('suspend',()=>{systemSuspended=true;syncScreenActivity();});
  powerMonitor.on('resume',()=>{systemSuspended=false;syncScreenActivity();});
  for(const event of ['display-metrics-changed','display-removed'])screen.on(event,()=>desktopLyrics.fitDisplay());
}
app.on('window-all-closed',()=>{});
app.on('before-quit',event=>{
  if(quitting)return;
  if(quitCheckpointTimer){event.preventDefault();return;}
  if(!quitCheckpointComplete&&mainReady&&window&&!window.isDestroyed()&&!window.webContents.isCrashed()){
    event.preventDefault();
    quitCheckpointTimer=setTimeout(completeQuitCheckpoint,3000);
    send('sonic:save-quit-checkpoint');
    return;
  }
  quitting=true;
  clearTimeout(mainReloadTimer);
  captureUntil=0;
  stopCaptureMetadata();
  desktopLyrics.dispose();
  server?.server.close();
  tray?.destroy();
});
