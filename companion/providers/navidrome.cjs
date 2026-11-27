'use strict';
const {createHash,randomBytes}=require('node:crypto');

function createNavidrome(){
  let account=null;
  const playlistWrites=new Map();
  const maxEntries=400;
  const invalid=(message,status=400,code='navidrome-error')=>Object.assign(new Error(message),{status,code});
  const array=value=>Array.isArray(value)?value:[];
  const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value)?value:'';
  const text=value=>typeof value==='string'?value.trim().slice(0,160):'';
  function song(item,state) {
    if(!id(item?.id)||!text(item.title))return null;
    const duration=Number(item.duration);
    return {provider:'navidrome',mediaId:state.key+'_'+item.id,name:text(item.title),artist:text(item.artist),
      album:text(item.album),duration:Number.isFinite(duration)&&duration>0?Math.min(duration,86400):0,liked:Boolean(item.starred)};
  }
  function credentials(body){
    let base;
    try{base=new URL(body.url);}catch{throw invalid('请输入完整的 Navidrome 地址。');}
    const loopback=['127.0.0.1','localhost','[::1]'].includes(base.hostname);
    const privateNetwork=/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(base.hostname)&&/^[\d.]+$/.test(base.hostname);
    if((base.protocol!=='https:'&&!(base.protocol==='http:'&&(loopback||privateNetwork)))||base.username||base.password||base.hash||base.search){
      throw invalid('请使用 HTTPS，或填写本机、局域网 IPv4 的 HTTP 地址。');
    }
    const user=text(body.user),password=typeof body.password==='string'?body.password:'';
    if(!user||!password||password.length>1024)throw invalid('请输入用户名和密码。');
    const root=base.href.replace(/\/+$/,'');
    const mediaRoot=createHash('sha256').update(root+'\0'+user).digest('hex').slice(0,20);
    return {root,user,password,key:mediaRoot};
  }
  function endpoint(state,name,params={}){
    const salt=randomBytes(12).toString('hex');
    const token=createHash('md5').update(state.password+salt).digest('hex');
    const url=new URL(state.root+'/rest/'+name+'.view');
    const query=new URLSearchParams({u:state.user,t:token,s:salt,c:'SonicUniverse',v:'1.16.1',f:'json'});
    for(const [name,values] of Object.entries(params)){
      for(const value of [values].flat())query.append(name,value);
    }
    url.search=query;
    return url;
  }
  async function json(state,name,params,write=false){
    const url=endpoint(state,name,params);
    const options={redirect:'error',signal:AbortSignal.timeout(8500)};
    if(write&&state.formPost){
      options.method='POST';
      options.body=new URLSearchParams(url.search);
      url.search='';
    }
    if(url.href.length>7500)throw invalid('当前服务器不支持表单请求，此列表过长。',400,'navidrome-limit');
    let response,result;
    try{
      response=await fetch(url,options);
      result=(await response.json())['subsonic-response'];
    }catch{throw invalid('Navidrome 未响应，请检查服务器地址和网络。',502,'connection');}
    if(result?.status==='ok'&&response.ok)return result;
    if([40,41,50].includes(result?.error?.code)||response.status===401||response.status===403)throw invalid('Navidrome 登录失败，请核对账号和权限。',401,'navidrome-auth');
    if(result?.error?.code===70)throw invalid('服务器上找不到这项内容。',404,'not-found');
    throw invalid('Navidrome 未能完成此操作。',502);
  }
  function requireAccount(){
    if(!account)throw invalid('请先连接 Navidrome。',401,'navidrome-auth');
    return account;
  }
  function songId(state,value){
    if(typeof value!=='string'||!value.startsWith(state.key+'_')||!id(value.slice(21)))throw invalid('请连接这首歌所属的 Navidrome 曲库。',404,'not-found');
    return value.slice(21);
  }
  async function playlist(state,key){
    const group=(await json(state,'getPlaylist',{id:key})).playlist;
    if(!group)throw invalid('服务器上找不到这张歌单。',404,'not-found');
    const ids=array(group.entry).map(item=>item.id);
    const items=array(group.entry).map(item=>song(item,state)).filter(Boolean);
    const revision=createHash('sha256').update(JSON.stringify([group.name,group.changed,ids])).digest('hex');
    return {name:text(group.name),items,ids,revision,editable:group.owner===state.user&&items.length===ids.length&&ids.length<=maxEntries};
  }
  function playlistView({ids,...view}){return view;}
  function orderedIds(state,values,{allowEmpty=false}={}){
    if(!Array.isArray(values)||values.length>maxEntries||!allowEmpty&&!values.length){
      throw invalid('无法保存这个列表。每次最多同步 '+maxEntries+' 首。');
    }
    return values.map(value=>songId(state,value));
  }
  function savePlaylist(state,key,body){
    const ids=orderedIds(state,body.items,{allowEmpty:true});
    if(!/^[a-f0-9]{64}$/.test(body.revision||''))throw invalid('请重新读取这张歌单。');
    const lock=state.key+':'+key;
    const prior=playlistWrites.get(lock)||Promise.resolve();
    const apply=prior.catch(()=>{}).then(async()=>{
      if(account!==state)throw invalid('连接已改变，请刷新后再试。',409);
      const latest=await playlist(state,key);
      if(!latest.editable)throw invalid('这张歌单不可编辑，请核对所有者或列表长度。',403,'navidrome-playlist-readonly');
      const desired=JSON.stringify(ids);
      if(JSON.stringify(latest.ids)===desired)return {playlist:playlistView(latest),conflict:false};
      if(latest.revision!==body.revision)return {playlist:playlistView(latest),conflict:true};
      if(ids.length)await json(state,'createPlaylist',{playlistId:key,songId:ids},true);
      else await json(state,'updatePlaylist',{playlistId:key,songIndexToRemove:latest.ids.map((_,index)=>index)},true);
      const saved=await playlist(state,key);
      return {playlist:playlistView(saved),conflict:JSON.stringify(saved.ids)!==desired};
    });
    playlistWrites.set(lock,apply);
    return apply.finally(()=>{if(playlistWrites.get(lock)===apply)playlistWrites.delete(lock);});
  }
  async function resume(state){
    const key=state.indexQueue?'playQueueByIndex':'playQueue';
    const queue=(await json(state,state.indexQueue?'getPlayQueueByIndex':'getPlayQueue'))[key];
    const entries=array(queue?.entry);
    const current=state.indexQueue?queue?.currentIndex:entries.findIndex(item=>item.id===queue?.current);
    const selected=entries[current];
    if(!Number.isInteger(current)||!selected)return {items:[],index:-1,position:0};
    const items=entries.map(item=>song(item,state)).filter(Boolean);
    const index=entries.slice(0,current).filter(item=>song(item,state)).length;
    if(!song(selected,state)||!items.length)return {items:[],index:-1,position:0};
    const ms=Number(queue.position);
    return {items,index,position:Number.isFinite(ms)?Math.max(0,Math.min(ms/1000,86400)):0};
  }
  async function saveResume(state,body){
    const ids=orderedIds(state,body.items);
    if(!Number.isInteger(body.index)||!ids[body.index]||!Number.isFinite(body.position)||body.position<0){
      throw invalid('无有效的 Navidrome 续播位置。');
    }
    const position=Math.round(Math.min(86400,body.position)*1000);
    const params={id:ids,position};
    if(state.indexQueue)params.currentIndex=body.index;
    else params.current=ids[body.index];
    await json(state,state.indexQueue?'savePlayQueueByIndex':'savePlayQueue',params,true);
    return {saved:true};
  }
  async function operation(name,body){
    if(name==='connect'){
      const candidate=credentials(body);
      await json(candidate,'ping');
      const response=await json(candidate,'getOpenSubsonicExtensions').catch(()=>null);
      const extensions=array(response?.openSubsonicExtensions);
      candidate.formPost=extensions.some(item=>item.name==='formPost');
      candidate.indexQueue=extensions.some(item=>item.name==='indexBasedQueue');
      account=candidate;
      return {connected:true,user:candidate.user};
    }
    if(name==='status')return {connected:Boolean(account),user:account?.user||''};
    if(name==='disconnect'){account=null;return {connected:false};}
    const state=requireAccount();
    if(name==='browse'){
      const offset=Number.isSafeInteger(body.offset)?Math.max(0,Math.min(body.offset,100000)):0;
      const [albums,lists]=await Promise.all([json(state,'getAlbumList2',{type:'alphabeticalByArtist',size:30,offset}),
        json(state,'getPlaylists')]);
      return {items:array(albums.albumList2?.album).filter(item=>id(item.id)).map(item=>({id:item.id,name:text(item.name||item.title),artist:text(item.artist)})),
        playlists:array(lists.playlists?.playlist).filter(item=>id(item.id)).slice(0,150).map(item=>({id:item.id,name:text(item.name)}))};
    }
    if(name==='starred'){
      const result=await json(state,'getStarred2');
      return {name:'Navidrome 收藏',items:array(result.starred2?.song).map(item=>song(item,state)).filter(Boolean)};
    }
    if(name==='star'){
      const key=songId(state,body.mediaId);
      await json(state,body.liked===true?'star':'unstar',{id:key});
      return {liked:body.liked===true};
    }
    if(name==='resume')return resume(state);
    if(name==='resume-save')return saveResume(state,body);
    if(name==='search'){
      const query=text(body.query);
      if(!query)return {items:[]};
      const result=await json(state,'search3',{query,songCount:30,artistCount:0,albumCount:0});
      return {items:array(result.searchResult3?.song).map(item=>song(item,state)).filter(Boolean)};
    }
    const key=id(body.id);
    if(key&&name==='playlist')return playlistView(await playlist(state,key));
    if(key&&name==='playlist-save')return savePlaylist(state,key,body);
    if(key&&name==='album'){
      const {album}=await json(state,'getAlbum',{id:key});
      return {name:text(album?.name||album?.title),items:array(album?.song).map(item=>song(item,state)).filter(Boolean)};
    }
    throw invalid('未知的 Navidrome 操作。',404);
  }
  function audio(mediaId){
    const state=requireAccount(),key=songId(state,mediaId);
    return {mediaUrl:endpoint(state,'stream',{id:key,format:'raw'}).href,preview:false,
      valid:()=>account===state,audioOnly:true};
  }
  return {operation,audio};
}
module.exports={createNavidrome};

