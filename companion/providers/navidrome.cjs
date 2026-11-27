'use strict';
const {createHash,randomBytes}=require('node:crypto');

function createNavidrome(){
  let account=null;
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
    url.search=new URLSearchParams({u:state.user,t:token,s:salt,c:'SonicUniverse',v:'1.16.1',f:'json',...params});
    return url;
  }
  async function json(state,name,params){
    let response,result;
    try{
      response=await fetch(endpoint(state,name,params),{redirect:'error',signal:AbortSignal.timeout(8500)});
      result=(await response.json())['subsonic-response'];
    }catch{throw invalid('Navidrome 未响应，请检查服务器地址和网络。',502,'connection');}
    if(result?.status==='ok'&&response.ok)return result;
    if([40,41,50].includes(result?.error?.code)||response.status===401||response.status===403)throw invalid('Navidrome 登录失败，请核对账号和权限。',401,'navidrome-auth');
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
  async function operation(name,body){
    if(name==='connect'){
      const candidate=credentials(body);
      await json(candidate,'ping');
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
    const key=id(body.id);
    if((name==='album'||name==='playlist')&&key){
      const isAlbum=name==='album';
      const result=await json(state,isAlbum?'getAlbum':'getPlaylist',{id:key});
      const group=result[name];
      return {name:text(group?.name||group?.title),items:array(isAlbum?group?.song:group?.entry).map(item=>song(item,state)).filter(Boolean)};
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

