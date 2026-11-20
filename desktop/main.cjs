'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, screen, powerMonitor, dialog } = require('electron');
const path = require('node:path');
const { createAppServer } = require('../companion/server.cjs');
const { trustedFrame, externalUrl, playerState } = require('./policy.cjs');
const { createWallpaperController } = require('./wallpaper.cjs');
const { createDesktopLyrics } = require('./desktop-lyrics.cjs');
const { createExternalNowPlaying } = require('./external-now-playing.cjs');

const port=Number(process.env.SONIC_DESKTOP_PORT||17865),origin='http://127.0.0.1:'+port;
let window=null,mini=null,tray=null,server=null,quitting=false,captureUntil=0,lastState=playerState(null),normalBounds=null;
let desktopCovered=false,screenSleeping=false,captureMetadataApproved=false,captureMetadataEpoch=0;
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
const send=(channel,value)=>{if(window&&!window.isDestroyed())window.webContents.send(channel,value);};
const desktopLyrics = createDesktopLyrics({
  onState({ visible }) {
    send('sonic:desktop-lyrics-state', visible);
    rebuildTray();
  },
});
async function showMain(command='show') {
  if(!window||window.isDestroyed())return;
  if(wallpaper.pending)await wallpaper.detach();
  if(!window||window.isDestroyed()||quitting)return;
  if(window.isMinimized())window.restore();
  window.show();
  window.focus();
  publishVisibility();
  send('sonic:command',command);
}
function publishVisibility(){
  if(!window||window.isDestroyed())return;
  const visible=!screenSleeping&&window.isVisible()&&!window.isMinimized()&&(!wallpaper.active||!desktopCovered);
  send('sonic:visibility',visible);
}
const wallpaper=createWallpaperController({
  onState(active){
    if(window&&!window.isDestroyed()){
      window.setIgnoreMouseEvents(active);window.setSkipTaskbar(active);
      if(!active&&normalBounds){window.setBounds(normalBounds);normalBounds=null;}
      desktopCovered=false;
      if(active)send('sonic:command','show');
      send('sonic:wallpaper-state',active);
      publishVisibility();
    }
    rebuildTray();
  },
  onCoverage(covered){desktopCovered=covered;publishVisibility();},
  onFailure(message){console.warn('[DesktopWallpaper]',message);showMain();},
});
async function setWallpaper(enabled){
  if(!enabled)return wallpaper.detach();
  if(!window||window.isDestroyed())return {ok:false,message:'主窗口没有打开。'};
  if(!wallpaper.pending){
    if(window.isMinimized())window.restore();
    if(window.isFullScreen())return {ok:false,message:'请先退出全屏，再开启动态桌面。'};
    if(window.isMaximized())window.unmaximize();
    normalBounds=window.getBounds();
    window.showInactive();
  }
  return wallpaper.attach(window);
}
function valid(event){return trustedFrame(event,window,origin);}
function externalMetadataAllowed(event){return valid(event)&&captureMetadataApproved&&lastState.external&&
  !screenSleeping&&window.isVisible()&&!window.isMinimized()&&(!wallpaper.active||!desktopCovered);}
function stopCaptureMetadata(){captureMetadataApproved=false;captureMetadataEpoch++;externalNowPlaying.close();}
function validOrigin(value){try{return new URL(value).origin===origin;}catch{return false;}}
function trustedMini(event){return mini&&!mini.isDestroyed()&&event.sender===mini.webContents&&event.senderFrame===mini.webContents.mainFrame;}
function settings(){return {startup:app.getLoginItemSettings().openAtLogin,wallpaper:wallpaper.active,desktopLyrics:desktopLyrics.visible};}
function secureContents(contents) {
  contents.setWindowOpenHandler(({url})=>{const target=externalUrl(url);if(target)shell.openExternal(target).catch(console.warn);return {action:'deny'};});
  contents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin){event.preventDefault();const target=externalUrl(url);if(target)shell.openExternal(target).catch(console.warn);}}catch{event.preventDefault();}});
}
function createMain() {
  window=new BrowserWindow({width:1360,height:900,minWidth:760,minHeight:580,title:'声波宇宙',icon:path.join(__dirname,'../outputs/assets/sonic-icon.png'),backgroundColor:'#101019',autoHideMenuBar:true,show:false,
    titleBarStyle:'hidden',titleBarOverlay:{color:'#101019',symbolColor:'#ded8e9',height:35},
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  secureContents(window.webContents);
  const rendererSession=window.webContents.session;
  function allowPermission(contents,permission,requestUrl,isMainFrame){
    return contents===window?.webContents&&isMainFrame&&validOrigin(requestUrl)&&
      (permission==='fullscreen'||(permission==='display-capture'&&Date.now()<=captureUntil));
  }
  rendererSession.setPermissionCheckHandler((contents,permission,requestOrigin,details)=>
    allowPermission(contents,permission,requestOrigin,details.isMainFrame));
  rendererSession.setPermissionRequestHandler((contents,permission,callback,details)=>
    callback(allowPermission(contents,permission,details.requestingUrl,details.isMainFrame)));
  rendererSession.setDisplayMediaRequestHandler((request,callback)=>{
    if(!window||window.isDestroyed()||request.frame!==window.webContents.mainFrame||!validOrigin(request.securityOrigin)||!request.audioRequested||!request.userGesture||Date.now()>captureUntil){callback(null);return;}
    captureUntil=0;
    // Chromium requires a video source to start getDisplayMedia. Use this app's own frame
    // and discard that track immediately on the renderer side. No screen content is used.
    captureMetadataApproved=true;captureMetadataEpoch++;
    callback({video:request.frame,audio:'loopback'});
  });
  window.once('ready-to-show',()=>window.show());
  window.on('close',event=>{if(!quitting){event.preventDefault();wallpaper.detach().then(()=>window?.hide());}});
  for(const event of ['minimize','restore','show','hide'])window.on(event,publishVisibility);
  window.on('closed',()=>{stopCaptureMetadata();window=null;if(!quitting)setTimeout(createMain,300);});
  window.webContents.on('render-process-gone',stopCaptureMetadata);
  window.loadURL(origin+'/?v='+app.getVersion());
}
function createMini() {
  if(mini&&!mini.isDestroyed()){mini.show();mini.focus();return;}
  const bounds=screen.getPrimaryDisplay().workArea;
  mini=new BrowserWindow({width:370,height:148,minWidth:330,minHeight:148,maxHeight:148,x:bounds.x+bounds.width-394,y:bounds.y+bounds.height-172,title:'声波宇宙 · 迷你播放器',frame:false,resizable:true,alwaysOnTop:true,skipTaskbar:true,backgroundColor:'#151e2d',show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mini.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mini.webContents.on('will-navigate',event=>event.preventDefault());
  mini.loadFile(path.join(__dirname,'mini.html'));
  mini.once('ready-to-show',()=>{mini.show();mini.webContents.send('sonic:player-state',lastState);});
  mini.on('closed',()=>{mini=null;});
}
function rebuildTray() {
  if(!tray)return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'打开声波宇宙',click:()=>showMain()},
    {label:'工作陪伴',click:()=>showMain('work')},{label:'歌词欣赏',click:()=>showMain('listen')},
    {label:'迷你播放器',click:createMini},
    {label:'桌面歌词',type:'checkbox',checked:desktopLyrics.visible,click:()=>void desktopLyrics.toggle()},
    {label:'锁定桌面歌词',type:'checkbox',checked:desktopLyrics.locked,enabled:desktopLyrics.visible,click:()=>desktopLyrics.toggleLock()},
    {type:'separator'},
    {label:wallpaper.active?'退出动态桌面':'设为动态桌面',click:async()=>{const result=await setWallpaper(!wallpaper.active);if(!result.ok){await showMain();dialog.showMessageBox(window,{type:'info',message:result.message});}}},
    {type:'separator'},{label:'退出声波宇宙',click:()=>app.quit()},
  ]));
}
async function start() {
  app.setAppUserModelId('com.sonicuniverse.desktop');Menu.setApplicationMenu(null);
  const profile=process.env.SONIC_DESKTOP_PROFILE;
  server=createAppServer({port,root:path.join(__dirname,'..','outputs'),allowPublishedOrigin:false,
    dataDirectory:profile?path.join(app.getPath('userData'),'music-session'):undefined,
    onError:error=>console.warn('[Companion]',error.message)});
  await server.ready;await server.listen();
  console.log('[Desktop] '+origin);
  createMain();
  const image=nativeImage.createFromPath(path.join(__dirname,'../outputs/assets/sonic-icon.png')).resize({width:32,height:32});
  tray=new Tray(image);tray.setToolTip('声波宇宙 · 音乐陪你一会儿');tray.on('double-click',()=>showMain());rebuildTray();
  ipcMain.handle('sonic:mini',event=>{if(!valid(event))return false;createMini();return true;});
  ipcMain.handle('sonic:desktop-lyrics',event=>valid(event)?desktopLyrics.toggle():{ok:false,message:'无效的窗口。'});
  ipcMain.handle('sonic:settings',event=>valid(event)?settings():{});
  ipcMain.handle('sonic:startup',(event,enabled)=>{if(!valid(event))return {ok:false,message:'无效的窗口。'};try{app.setLoginItemSettings({openAtLogin:enabled===true});return {ok:true};}catch(error){return {ok:false,message:error.message};}});
  ipcMain.handle('sonic:capture',event=>{if(!valid(event)||wallpaper.active||!window.isVisible())throw Error('请从可见的主窗口连接声音。');captureUntil=Date.now()+5000;return true;});
  ipcMain.handle('sonic:external-now-playing',async(event,options)=>{
    if(!externalMetadataAllowed(event))return null;
    const epoch=captureMetadataEpoch;
    const details=await externalNowPlaying.query(typeof options?.sourceId==='string'?options.sourceId.slice(0,36):null);
    return epoch===captureMetadataEpoch&&externalMetadataAllowed(event)?details:null;
  });
  ipcMain.handle('sonic:wallpaper',(event,enabled)=>valid(event)?setWallpaper(enabled):{ok:false,message:'无效的窗口。'});
  ipcMain.on('sonic:state',(event,value)=>{
    if(!valid(event))return;
    const wasExternal=lastState.external;
    lastState=playerState(value);
    if(wasExternal&&!lastState.external)stopCaptureMetadata();
    desktopLyrics.publish(lastState);
    if(mini&&!mini.isDestroyed())mini.webContents.send('sonic:player-state',lastState);
  });
  ipcMain.on('sonic:desktop-lyrics-command',(event,command)=>desktopLyrics.command(event,command));
  ipcMain.on('sonic:command',(event,command)=>{if(!trustedMini(event))return;if(command==='hide-mini'){mini.hide();return;}if(command==='show'){showMain();return;}if(['play','previous','next','listen','work'].includes(command))send('sonic:command',command);});
  for(const event of ['lock-screen','suspend'])powerMonitor.on(event,()=>{screenSleeping=true;publishVisibility();desktopLyrics.suspend(true);});
  for(const event of ['unlock-screen','resume'])powerMonitor.on(event,()=>{screenSleeping=false;publishVisibility();desktopLyrics.suspend(false);});
  for(const event of ['display-metrics-changed','display-removed'])screen.on(event,()=>{if(wallpaper.active)showMain('work');desktopLyrics.fitDisplay();});
}
app.on('window-all-closed',()=>{});
app.on('before-quit',event=>{
  if(quitting)return;event.preventDefault();quitting=true;
  stopCaptureMetadata();
  desktopLyrics.dispose();
  wallpaper.detach().catch(console.warn).finally(()=>{if(server)server.server.close();tray?.destroy();app.quit();});
});
