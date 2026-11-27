(function(){
  'use strict';
  function mount(root,launcher,api,openPlayer){
    if(!window.sonicDesktop){launcher.hidden=true;return;}
    const dialog=document.createElement('dialog');
    dialog.className='lr-dialog';
    dialog.setAttribute('aria-labelledby','sl-nav-title');
    dialog.innerHTML='<h2 id="sl-nav-title">Navidrome 曲库</h2>'+
      '<form data-nav-connect><label>服务器地址 <input name="url" type="url" placeholder="https://music.example.com" required></label> '+
      '<label>用户名 <input name="user" autocomplete="username" required></label> '+
      '<label>密码 <input name="password" type="password" autocomplete="current-password" required></label> '+
      '<button class="sl-button">连接</button></form>'+
      '<div class="lr-choice-row" data-nav-actions hidden><button data-nav-action="browse">专辑与歌单</button>'+
      '<button data-nav-action="starred">服务器收藏</button><button data-nav-action="back" hidden>上一页</button>'+
      '<button data-nav-action="next" hidden>下一页</button><button data-nav-action="disconnect">断开</button></div>'+
      '<p role="status" data-nav-status></p><div data-nav-results></div><button class="sl-button" data-nav-action="close">关闭</button>';
    for(const button of dialog.querySelectorAll('button'))button.className='sl-button';
    root.append(dialog);
    const $=selector=>dialog.querySelector(selector),form=$('form'),actions=$('[data-nav-actions]'),status=$('[data-nav-status]'),results=$('[data-nav-results]');
    let busy=false,offset=0,connected=false,connectionView=null;
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
      if(!connected){results.replaceChildren();connectionView=null;offset=0;}
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
      for(const item of items){
        const li=document.createElement('li');li.append(...row(item));ordered.append(li);
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
    async function songs(kind,body){
      const data=await request(kind,body);
      pages(false,false);
      results.replaceChildren(list(data.name||'歌曲',data.items,song=>{
        const play=button([song.name,song.artist].filter(Boolean).join(' · '),async()=>{
          if(busy)return;
          await run(async()=>{
            const success=await api.playNavidromeList(data.items,data.name,song.mediaId);
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
      }));
      status.textContent=data.items.length+' 首歌曲';
    }
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const values=Object.fromEntries(new FormData(form));
      void run(async()=>{
        account(await request('connect',values));form.elements.password.value='';
        connectionView='browse';await browse();
      });
    });
    dialog.addEventListener('click',event=>{
      const action=event.target.closest('[data-nav-action]')?.dataset.navAction;
      if(action==='close'){dialog.close();return;}
      if(!action||!connected)return;
      void run(async()=>{
        if(action==='disconnect'){account(await request('disconnect'));return;}
        if(action==='starred'){connectionView='starred';await songs('starred',{});return;}
        if(action==='browse')offset=0;
        if(action==='back')offset=Math.max(0,offset-30);
        if(action==='next')offset+=30;
        connectionView='browse';await browse();
      });
    });
    launcher.addEventListener('click',()=>{
      dialog.showModal();
      void run(async()=>{
        account(await request('status'));
        if(!connected)return;
        if(connectionView==='starred')await songs('starred',{});
        else await browse();
      });
    });
  }
  window.SonicNavidrome=Object.freeze({mount});
})();

