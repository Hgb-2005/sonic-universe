(function(){
  'use strict';
  function mount(root,launcher,api,openPlayer,onConnect){
    if(!window.sonicDesktop){launcher.hidden=true;return;}
    const dialog=document.createElement('dialog');
    dialog.className='lr-dialog';
    dialog.setAttribute('aria-labelledby','sl-nav-title');
    dialog.innerHTML='<h2 id="sl-nav-title">Navidrome 曲库</h2>'+
      '<form data-nav-connect><label>服务器地址 <input name="url" type="url" placeholder="https://music.example.com" required></label> '+
      '<label>用户名 <input name="user" autocomplete="username" required></label> '+
      '<label>密码 <input name="password" type="password" autocomplete="current-password" required></label> '+
      '<button class="sl-button">连接</button></form>'+
      '<div class="lr-choice-row" data-nav-actions hidden><button data-nav-action="artists">艺人</button><button data-nav-action="browse">专辑与歌单</button>'+
      '<button data-nav-action="starred">服务器收藏</button><button data-nav-action="resume">从服务器继续听</button>'+
      '<button data-nav-action="sync">同步当前进度</button><button data-nav-action="back" hidden>上一页</button>'+
      '<button data-nav-action="next" hidden>下一页</button><button data-nav-action="disconnect">断开</button></div>'+
      '<p role="status" data-nav-status></p><div data-nav-results></div><button class="sl-button" data-nav-action="close">关闭</button>';
    for(const button of dialog.querySelectorAll('button'))button.className='sl-button';
    root.append(dialog);
    const $=selector=>dialog.querySelector(selector),form=$('form'),actions=$('[data-nav-actions]'),status=$('[data-nav-status]'),results=$('[data-nav-results]');
    let busy=false,offset=0,connected=false,connectionView=null,draft=null;
    const recentSaves=new Map();
    async function request(action,body={}){
      const response=await fetch('/api/navidrome/'+action,{method:'POST',headers:{'Content-Type':'application/json'},
        signal:AbortSignal.timeout(12000),body:JSON.stringify(body)});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Navidrome 暂不可用。');
      return data;
    }
    function account(value){
      connected=value.connected;
      form.hidden=connected;actions.hidden=!connected;
      status.textContent=connected?'已连接 · '+value.user:'连接你自己的 Navidrome 服务器。';
      if(!connected){results.replaceChildren();connectionView=null;offset=0;draft=null;recentSaves.clear();}
      actions.hidden=!connected||Boolean(draft);
    }
    async function run(fn){
      if(busy)return;
      busy=true;dialog.setAttribute('aria-busy','true');
      try{await fn();}catch(error){status.textContent=error.message||'Navidrome 暂不可用。';}
      finally{busy=false;dialog.removeAttribute('aria-busy');}
    }
    function button(label,action){
      const node=document.createElement('button');
      node.className='sl-button';node.type='button';node.textContent=label;
      node.addEventListener('click',action);
      return node;
    }
    function list(title,items,row){
      const section=document.createElement('section'),head=document.createElement('h3'),ordered=document.createElement('ul');
      head.textContent=title;
      for(const [index,item] of items.entries()){
        const li=document.createElement('li');li.append(...row(item,index));ordered.append(li);
      }
      section.append(head,ordered);
      return section;
    }
    function pages(previous,next){
      $('[data-nav-action="back"]').hidden=!previous;
      $('[data-nav-action="next"]').hidden=!next;
    }
    async function browse(){
      const data=await request('browse',{offset});
      const groups=(items,type)=>item=>[button([item.name,item.artist].filter(Boolean).join(' · '),()=>run(()=>songs(type,{id:item.id})))];
      results.replaceChildren(list('专辑',data.items,groups(data.items,'album')),list('服务器歌单',data.playlists,groups(data.playlists,'playlist')));
      pages(offset>0,data.items.length===30);
      status.textContent='专辑第 '+(offset/30+1)+' 页';
    }
    async function artists(){
      const {items}=await request('artists');
      results.replaceChildren(list('艺人',items,artist=>[button(artist.name,()=>run(()=>artistAlbums(artist.id)))]));
      connectionView={kind:'artists'};
      pages(false,false);
      status.textContent=items.length?'已连接 · '+items.length+' 位艺人':'服务器曲库还没有艺人。';
    }
    async function artistAlbums(id){
      const artist=await request('artist',{id});
      results.replaceChildren(list(artist.name,artist.items,album=>[button(album.name,()=>run(()=>songs('album',{id:album.id})))]));
      connectionView={kind:'artist',body:{id}};
      pages(false,false);
      status.textContent='已连接 · '+artist.items.length+' 张专辑';
    }
    async function songs(kind,body){
      const data=await request(kind,body);
      connectionView={kind,body};
      draft=null;actions.hidden=false;
      pages(false,false);
      if(kind==='playlist'){
        const previous=recentSaves.get(body.id);
        if(previous?.revision!==data.revision&&previous&&!sameOrder(previous.items,data.items)){
          recentSaves.delete(body.id);
          draft={id:body.id,base:previous,items:previous.items.slice(),conflict:data,results:[],query:''};
          renderEditor();return;
        }
      }
      const playList=list(data.name||'歌曲',data.items,(song,index)=>{
        const play=button([song.name,song.artist].filter(Boolean).join(' · '),async()=>{
          if(busy)return;
          await run(async()=>{
            const success=await api.playNavidromeList(data.items,data.name,song.mediaId,{index});
            if(!success)throw new Error('暂时无法播放，请检查服务器后重试。');
            dialog.close();openPlayer();
          });
        });
        const star=button(song.liked?'取消服务器收藏':'收藏到服务器',()=>run(async()=>{
          const value=await request('star',{mediaId:song.mediaId,liked:!song.liked});
          if(kind==='starred'&&!value.liked){await songs(kind,body);return;}
          song.liked=value.liked;
          star.textContent=song.liked?'取消服务器收藏':'收藏到服务器';
          status.textContent=song.liked?'已保存到服务器。':'已取消服务器收藏。';
        }));
        star.setAttribute('title',song.name);
        return [play,star];
      });
      if(kind==='playlist'){
        const controls=document.createElement('div');controls.className='lr-choice-row';
        controls.append(button('刷新歌单',()=>run(()=>songs(kind,body))));
        if(data.editable)controls.append(button('编辑歌单',()=>{
          draft={id:body.id,base:data,items:data.items.slice(),conflict:null,results:[],query:''};
          renderEditor();
        }));
        results.replaceChildren(controls,playList);
      }else results.replaceChildren(playList);
      status.textContent=data.items.length+' 首歌曲';
    }
    function sameOrder(first,second){
      return first.length===second.length&&first.every((song,index)=>song.mediaId===second[index].mediaId);
    }
    function songLabel(song){return [song.name,song.artist].filter(Boolean).join(' · ');}
    async function saveDraft(revision){
      const {id,items}=draft;
      const value=await request('playlist-save',{id,revision,items:items.map(song=>song.mediaId)});
      if(value.conflict){
        draft.conflict=value.playlist;
        renderEditor();return;
      }
      recentSaves.delete(id);recentSaves.set(id,value.playlist);
      if(recentSaves.size>12)recentSaves.delete(recentSaves.keys().next().value);
      await songs('playlist',{id});
      if(!draft)status.textContent='歌单已保存到服务器。';
    }
    function renderEditor(focus){
      actions.hidden=true;
      const {id,base,items,conflict}=draft;
      const controls=document.createElement('div');controls.className='lr-choice-row';
      let rows;
      if(conflict){
        rows=[list('我的版本',items,song=>[songLabel(song)]),list('服务器版本',conflict.items,song=>[songLabel(song)])];
        controls.append(
          button('保留服务器版本',()=>run(async()=>{recentSaves.delete(id);await songs('playlist',{id});})),
          button('保存我的版本',()=>run(()=>saveDraft(conflict.revision))));
        status.textContent='歌单冲突。另一台设备修改过这张歌单，请选择保留哪份。';
      }else{
        const mine=list('编辑 '+base.name,items,(song,index)=>{
          const name=document.createElement('span');name.textContent=(index+1)+'. '+songLabel(song)+' ';
          const adjust=(label,delta)=>{
            const control=button(label,()=>{
              if(busy)return;
              const from=items.splice(index,1)[0];
              if(delta)items.splice(index+delta,0,from);
              renderEditor([Math.max(0,Math.min(items.length-1,index+delta)),label]);
            });
            control.setAttribute('aria-label',label+' '+(index+1)+'. '+song.name);
            if(delta)control.disabled=!items[index+delta];
            return control;
          };
          return [name,adjust('上移',-1),adjust('下移',1),adjust('移除',0)];
        });
        mine.dataset.navDraft='';
        const search=document.createElement('form');
        search.className='lr-choice-row';
        const query=document.createElement('input');query.type='search';query.maxLength=160;query.value=draft.query;
        query.placeholder='按歌名或艺人搜索';query.setAttribute('aria-label','搜索可加入的歌曲');
        const submit=document.createElement('button');submit.type='submit';submit.textContent='搜索';submit.className='sl-button';
        search.append(query,submit);
        search.addEventListener('submit',event=>{
          event.preventDefault();
          draft.query=query.value.trim();
          void run(async()=>{
            draft.results=(await request('search',{query:draft.query})).items;
            renderEditor();
            status.textContent=draft.results.length+' 首搜索结果。';
            results.querySelector('input[type=search]')?.focus();
          });
        });
        rows=[mine,search];
        if(draft.results.length)rows.push(list('可加入的歌曲',draft.results,song=>{
          const add=button('添加 '+songLabel(song),()=>{
            if(busy)return;
            if(items.length>=400){status.textContent='每张歌单最多同步 400 首。';return;}
            items.push(song);renderEditor();status.textContent='已加入草稿。';
            results.querySelector('input[type=search]')?.focus();
          });
          return [add];
        }));
        controls.append(
          button('保存歌单',()=>run(()=>saveDraft(base.revision))),
          button('放弃此稿',()=>run(()=>songs('playlist',{id}))));
        status.textContent=items.length+' 首歌曲';
      }
      results.replaceChildren(controls,...rows);
      if(focus){
        const row=results.querySelector('[data-nav-draft] ul')?.children[focus[0]];
        const buttons=[...(row?.querySelectorAll('button')||[])];
        (buttons.find(node=>!node.disabled&&node.textContent===focus[1])||buttons.find(node=>!node.disabled))?.focus();
      }
    }
    function timestamp(value){
      const time=value?new Date(value):null;
      return time&&!Number.isNaN(time.valueOf())?time.toLocaleString():'时间未知';
    }
    function checkpointLabel(record){
      const position=window.SonicListeningCore.formatTime(record.position);
      return [record.name,position,record.device||'设备未知',timestamp(record.updatedAt)].join(' · ');
    }
    async function openServerProgress(remote){
      const item=remote.items[remote.index];
      const played=await api.playNavidromeList(remote.items,'Navidrome 续播',item.mediaId,{index:remote.index,position:remote.position});
      if(!played)throw new Error('暂时无法继续播放，请检查服务器后重试。');
      dialog.close();openPlayer();
    }
    async function chooseProgress(action){
      const remote=await request('resume');
      const stored=remote.items[remote.index];
      const local=api.navidromeProgress();
      const corresponding=local&&(!stored||local.items[local.index].slice(0,21)===stored.mediaId.slice(0,21));
      const upload=async()=>{
        if(!await api.syncNavidromeResume({revision:remote.revision||'',checkpoint:local})){
          status.textContent='请先播放这份 Navidrome 曲库里的歌曲。';return;
        }
        status.textContent='进度已同步到服务器 · '+checkpointLabel(local);
      };
      if(action==='sync'&&!corresponding){status.textContent='请先播放这份 Navidrome 曲库里的歌曲。';return;}
      if(!stored){
        if(action==='sync')await upload();
        else status.textContent='服务器上还没有续播位置。';
        return;
      }
      const distinct=corresponding&&(local.items[local.index]!==stored.mediaId||Math.abs(local.position-remote.position)>2||
        local.items.join()!==remote.items.map(item=>item.mediaId).join());
      if(!distinct){
        if(action==='sync')await upload();
        else await openServerProgress(remote);
        return;
      }
      const controls=document.createElement('div');controls.className='lr-choice-row';
      const details=document.createElement('ul');
      for(const [label,record] of [['本机',local],['服务器',{...remote,name:stored.name}]]){
        const row=document.createElement('li');row.textContent=label+' · '+checkpointLabel(record);details.append(row);
      }
      controls.append(button('继续用本机记录',()=>run(async()=>{
        if(action==='sync')await upload();
        else if(!api.snapshot().playing){
          const played=await api.continueListening();
          if(played===false)throw new Error('暂时无法从本机续播，请检查 Navidrome 连接。');
          if(api.snapshot().playing){dialog.close();openPlayer();return;}
          status.textContent='已保留本机续播点。';
        }else status.textContent='已保留本机续播点。';
        controls.remove();details.remove();
      })),button('使用服务器记录',()=>run(()=>openServerProgress(remote))));
      results.replaceChildren(details,controls);
      status.textContent='本机和服务器的续播记录不同，请选择。';
    }
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const values=Object.fromEntries(new FormData(form));
      void run(async()=>{
        account(await request('connect',values));form.elements.password.value='';
        onConnect();
        window.dispatchEvent(new Event('sonic:navidrome-connection'));
        connectionView=null;await browse();
      });
    });
    dialog.addEventListener('click',event=>{
      const action=event.target.closest('[data-nav-action]')?.dataset.navAction;
      if(action==='close'){dialog.close();return;}
      if(!action||!connected||draft)return;
      void run(async()=>{
        if(action==='disconnect'){
          account(await request('disconnect'));
          window.dispatchEvent(new Event('sonic:navidrome-connection'));
          return;
        }
        if(action==='starred'){await songs('starred',{});return;}
        if(action==='artists'){await artists();return;}
        if(action==='sync'||action==='resume'){await chooseProgress(action);return;}
        if(action==='browse')offset=0;
        if(action==='back')offset=Math.max(0,offset-30);
        if(action==='next')offset+=30;
        connectionView=null;await browse();
      });
    });
    function open({reconnect=false}={}){
      dialog.showModal();
      if(reconnect){
        account({connected:false});
        status.textContent='请连接这首歌所属的 Navidrome 曲库。';
        form.elements.url.focus();
        return;
      }
      void run(async()=>{
        account(await request('status'));
        if(!connected)return;
        if(draft){renderEditor();return;}
        if(connectionView?.kind==='artists')await artists();
        else if(connectionView?.kind==='artist')await artistAlbums(connectionView.body.id);
        else if(connectionView)await songs(connectionView.kind,connectionView.body);
        else await browse();
      });
    }
    launcher.addEventListener('click',()=>open());
    return {open};
  }
  window.SonicNavidrome=Object.freeze({mount});
})();

