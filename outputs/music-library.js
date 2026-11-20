(function () {
  'use strict';

  const sections = { all:'全部歌曲',local:'本地音乐',favorites:'我的收藏',recent:'最近播放' };
  const sourceNames = { file:'本地音乐',online:'汽水音乐',soda:'汽水分享',demo:'原创音景' };
  const emptyMessages = {
    all:'导入音乐文件或文件夹，建立你的曲库。',local:'导入音乐文件或文件夹，本地歌曲会显示在这里。',
    favorites:'收藏歌曲后，就能在这里找到。',recent:'你播放过的歌曲会显示在这里。',
  };
  const pageSize=40;

  function mount(root,{api,icon,formatTime}) {
    root.innerHTML=`
      <aside class="sl-sidebar">
        <nav class="sl-sections" aria-label="曲库分类">
          <button data-sl-view="all">${icon('library')}全部歌曲</button>
          <button data-sl-view="local">${icon('folder')}本地音乐</button>
          <button data-sl-view="favorites">${icon('heart')}我的收藏</button>
          <button data-sl-view="recent">${icon('repeat')}最近播放</button>
        </nav>
        <div class="sl-sidebar-title"><h2>我的歌单</h2><button class="lr-icon" data-sl-command="new" aria-label="新建歌单" title="新建歌单">＋</button></div>
        <nav class="sl-playlists" data-sl-playlists aria-label="我的歌单"></nav>
        <button class="sl-sidebar-action" data-action="online">${icon('music')}搜索在线音乐 ${icon('arrow')}</button>
      </aside>
      <section class="sl-content" aria-labelledby="sl-title">
        <div class="sl-heading">
          <div><h1 id="sl-title">全部歌曲</h1><p data-sl-total></p></div>
          <div class="sl-heading-actions">
            <button class="sl-button" data-action="import">${icon('upload')}导入歌曲</button>
            <button class="sl-button" data-action="folder">${icon('folder')}导入文件夹</button>
          </div>
        </div>
        <div class="sl-tools">
          <button class="sl-button sl-play-all" data-sl-command="play-all">${icon('play')}播放列表</button>
          <button class="sl-button sl-queue-shortcut" data-action="queue">${icon('queue')}播放队列</button>
          <button class="sl-button" data-sl-command="rename" hidden>重命名歌单</button>
          <button class="sl-button" data-sl-command="refresh-synced" hidden>从汽水刷新</button>
          <button class="sl-button" data-sl-command="enrich" hidden>批量补全</button>
          <label class="sl-search"><span aria-hidden="true">⌕</span><input type="search" data-sl-search aria-label="搜索曲库" placeholder="搜索歌名、歌手或专辑" autocomplete="off"></label>
          <select class="sl-sort" data-sl-sort aria-label="排序方式"><option value="default">默认顺序</option><option value="name">按歌名</option><option value="artist">按歌手</option><option value="duration">按时长</option></select>
        </div>
        <div class="sl-table-head" aria-hidden="true"><span>歌曲</span><span>专辑</span><span>来源</span><span>时长</span><span></span></div>
        <ol class="sl-tracks" data-sl-tracks></ol>
        <div class="sl-empty" data-sl-empty hidden>${icon('music')}<p data-sl-empty-text></p></div>
        <button class="sl-button sl-more" data-sl-command="more" hidden>加载更多</button>
      </section>
      <dialog class="lr-dialog" data-sl-edit aria-labelledby="sl-edit-title"><form>
        <div class="lr-dialog-heading"><h2 id="sl-edit-title">新建歌单</h2><button class="lr-icon" type="button" data-sl-close aria-label="取消编辑">${icon('close')}</button></div>
        <label class="lr-field"><span class="lr-field-title">歌单名称</span><input class="lr-search-input" name="name" maxlength="32" required autocomplete="off"></label>
        <div class="sl-dialog-actions"><button class="sl-button" type="button" data-sl-close>取消</button><button class="sl-button sl-play-all" type="submit">保存歌单</button></div>
      </form></dialog>
      <dialog class="lr-dialog" data-sl-membership aria-labelledby="sl-member-title"><form>
        <div class="lr-dialog-heading"><div><h2 id="sl-member-title">管理所属歌单</h2><p data-sl-member-song></p></div><button class="lr-icon" type="button" data-sl-close aria-label="关闭歌单选项">${icon('close')}</button></div>
        <div class="sl-member-options" data-sl-member-options></div>
        <div class="sl-dialog-actions"><button class="sl-button" type="button" data-sl-command="new">新建歌单</button><button class="sl-button sl-play-all" type="submit">保存选择</button></div>
      </form></dialog>
      <dialog class="lr-dialog" data-sl-queue aria-labelledby="sl-queue-title">
        <div class="lr-dialog-heading"><div><h2 id="sl-queue-title">歌曲选项</h2><p data-sl-queue-song></p></div><button class="lr-icon" type="button" data-sl-close aria-label="关闭歌曲选项">${icon('close')}</button></div>
        <div class="sl-dialog-actions"><button class="sl-button" type="button" data-sl-command="track-details" hidden>编辑歌曲资料</button><button class="sl-button sl-play-all" type="button" data-sl-command="queue-next">下一首播放</button><button class="sl-button" type="button" data-sl-command="queue-end">加入队列末尾</button></div>
      </dialog>
      <dialog class="lr-dialog" data-sl-enrich aria-labelledby="sl-enrich-title">
        <div class="lr-dialog-heading"><h2 id="sl-enrich-title">批量补全封面和歌词</h2><button type="button" class="lr-icon" data-sl-close aria-label="关闭补全">${icon('close')}</button></div>
        <p class="lr-status" data-sl-enrich-status role="status"></p>
        <div class="sl-member-options" data-sl-enrich-results></div>
        <div class="sl-dialog-actions"><button type="button" class="sl-button" data-sl-command="scan-enrich">查找匹配</button><button type="button" class="sl-button sl-play-all" data-sl-command="apply-enrich" disabled>保存勾选项</button></div>
      </dialog>`;

    const $=selector=>root.querySelector(selector);
    const tracksList=$('[data-sl-tracks]'), search=$('[data-sl-search]'), sort=$('[data-sl-sort]');
    const edit=$('[data-sl-edit]'), membership=$('[data-sl-membership]'), queueOptions=$('[data-sl-queue]');
    const enrich=$('[data-sl-enrich]'), enrichStatus=$('[data-sl-enrich-status]'), enrichResults=$('[data-sl-enrich-results]');
    const scanButton=$('[data-sl-command="scan-enrich"]'), applyButton=$('[data-sl-command="apply-enrich"]');
    const details=window.SonicTrackDetails.mount(root,api);
    const demoCover=new URL('./assets/interstellar-drift-cover.webp',document.baseURI).href;
    const collate=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
    let database, view='all', shown=pageSize, filtered=[];
    let playback, playbackKey=[], editId=null, memberId=null, addingToNew=false, queueTrackId=null;
    let enrichJob, enrichIds=[], matches=[];

    function viewTracks() {
      const byId=ids=>{
        const index=new Map(database.tracks.map(track=>[track.id,track]));
        return ids.map(id=>index.get(id)).filter(Boolean);
      };
      if(view==='local')return database.tracks.filter(track=>track.kind==='file');
      if(view==='favorites')return database.tracks.filter(track=>track.favorite);
      if(view==='recent')return byId(database.recent);
      const playlist=database.playlists.find(item=>item.id===view);
      return playlist?byId(playlist.trackIds):database.tracks;
    }

    function setView(value) {
      view=value;
      search.value='';sort.value='default';shown=pageSize;
      render();
      root.querySelector('[data-sl-view="'+CSS.escape(view)+'"]')?.focus({preventScroll:true});
    }

    function renderNavigation() {
      const list=$('[data-sl-playlists]');
      const focused=list.contains(document.activeElement)?document.activeElement.dataset.slView:null;
      list.replaceChildren(...database.playlists.map(playlist=>{
        const button=document.createElement('button');
        button.type='button';button.dataset.slView=playlist.id;
        button.innerHTML=icon('queue')+'<span></span><small></small>';
        button.querySelector('span').textContent=playlist.name;
        button.querySelector('small').textContent=playlist.trackIds.length;
        return button;
      }));
      root.querySelectorAll('[data-sl-view]').forEach(button=>{
        if(button.dataset.slView===view)button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      });
      if(focused)list.querySelector('[data-sl-view="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
    }

    function makeTrack(track) {
      const row=document.createElement('li');
      row.className='sl-track';row.dataset.slId=track.id;
      row.innerHTML=`<button type="button" class="sl-song" data-sl-command="play"><span class="sl-art">${icon('music')}</span><span class="sl-song-copy"><strong></strong><small></small></span><span class="sl-active" aria-hidden="true">${icon('sound')}</span></button><span class="sl-album"></span><span class="sl-source"></span><span class="sl-duration"></span><div class="sl-track-actions"><button type="button" class="lr-icon" data-sl-command="favorite">${icon('heart')}</button><button type="button" class="lr-icon" data-sl-command="membership">＋</button><button type="button" class="lr-icon" data-sl-command="queue" aria-haspopup="dialog">${icon('queueAdd')}</button></div>`;
      const artist=track.artist||sourceNames[track.kind]||'未知歌手';
      row.querySelector('strong').textContent=track.name;
      row.querySelector('.sl-song-copy small').textContent=artist;
      row.querySelector('.sl-album').textContent=track.album||'—';
      const source=row.querySelector('.sl-source');
      source.textContent=track.sourceMissing?'本机副本':sourceNames[track.kind]||'';
      if(track.sourceMissing)source.title='原文件已移出导入的文件夹，已保存的副本仍可播放。';
      row.querySelector('.sl-duration').textContent=track.duration>0?formatTime(track.duration):'—';
      const play=row.querySelector('[data-sl-command="play"]');
      play.dataset.label=(track.kind==='soda'?'打开':'播放')+' '+track.name;
      play.setAttribute('aria-label',play.dataset.label);
      const favorite=row.querySelector('[data-sl-command="favorite"]');
      favorite.setAttribute('aria-label',(track.favorite?'取消收藏':'收藏')+' '+track.name);
      favorite.setAttribute('aria-pressed',String(track.favorite));
      favorite.title=track.favorite?'取消收藏':'收藏歌曲';
      const add=row.querySelector('[data-sl-command="membership"]');
      add.setAttribute('aria-label','管理 '+track.name+' 的所属歌单');add.title='管理所属歌单';
      const enqueue=row.querySelector('[data-sl-command="queue"]');
      enqueue.setAttribute('aria-label','将 '+track.name+' 加入播放队列');enqueue.title='加入播放队列';
      enqueue.hidden=track.kind==='soda';
      const cover=track.cover||(track.kind==='demo'?demoCover:'');
      if(cover) {
        const image=new Image();
        image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
        image.onerror=()=>image.hidden=true;
        image.src=cover;
        row.querySelector('.sl-art').append(image);
      }
      return row;
    }

    function renderTracks() {
      const list=viewTracks(),query=search.value.trim().toLocaleLowerCase();
      filtered=list.filter(track=>[track.name,track.artist,track.album,track.sourcePath].join(' ').toLocaleLowerCase().includes(query));
      $('[data-sl-command="enrich"]').hidden=!filtered.some(track=>track.kind==='file');
      if(sort.value==='duration')filtered.sort((a,b)=>(b.duration||0)-(a.duration||0));
      else if(sort.value!=='default')filtered.sort((a,b)=>collate.compare(a[sort.value]||'',b[sort.value]||''));
      const active=document.activeElement;
      const focus=tracksList.contains(active)?[active.closest('[data-sl-id]').dataset.slId,active.dataset.slCommand]:null;
      tracksList.replaceChildren(...filtered.slice(0,shown).map(makeTrack));
      if(focus){const row=tracksList.querySelector('[data-sl-id="'+CSS.escape(focus[0])+'"]');(row?.querySelector('[data-sl-command="'+CSS.escape(focus[1])+'"]')||search).focus({preventScroll:true});}
      $('[data-sl-total]').textContent=query?`找到 ${filtered.length} / ${list.length} 首`:`${list.length} 首歌曲`;
      $('[data-sl-empty]').hidden=filtered.length>0;
      $('[data-sl-empty-text]').textContent=!database.ready?'正在读取音乐库':query?'没有找到匹配的歌曲':emptyMessages[view]||'通过歌曲旁的「＋」把它加入这个歌单。';
      $('[data-sl-command="more"]').hidden=shown>=filtered.length;
      const playAll=$('[data-sl-command="play-all"]');
      playAll.hidden=view==='recent'||Boolean(query)||sort.value!=='default';
      updatePlayback(playback,true);
    }

    function render() {
      if(root.hidden)return;
      database=api.library();
      const playlist=database.playlists.find(item=>item.id===view);
      if(!playlist&&!sections[view])view='all';
      $('#sl-title').textContent=playlist?.name||sections[view];
      $('[data-sl-command="rename"]').hidden=!playlist;
      $('[data-sl-command="refresh-synced"]').hidden=!playlist?.synced;
      root.querySelectorAll('.sl-heading-actions button').forEach(button=>button.disabled=!database.ready||database.importing);
      root.querySelectorAll('[data-sl-command="new"]').forEach(button=>button.disabled=!database.ready);
      renderNavigation();renderTracks();
    }

    function updatePlayback(state,force=false) {
      playback=state;
      if(root.hidden||!state)return;
      const key=[state.track?.id,state.playing,state.busy,state.ready,state.external];
      if(!force&&key.every((part,index)=>part===playbackKey[index]))return;
      playbackKey=key;
      tracksList.querySelectorAll('[data-sl-id]').forEach(row=>{
        const current=row.dataset.slId===state.track?.id;
        const button=row.querySelector('[data-sl-command="play"]');
        if(current)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
        row.dataset.active=String(current);
        button.disabled=!state.ready||state.busy;
        row.querySelector('[data-sl-command="queue"]').disabled=!state.ready||state.busy||state.external;
        if(current)button.setAttribute('aria-label',(state.playing?'暂停 ':'播放 ')+row.querySelector('strong').textContent);
        else button.setAttribute('aria-label',button.dataset.label);
      });
      $('[data-sl-command="play-all"]').disabled=state.busy||!state.ready||!filtered.some(track=>track.kind!=='soda');
    }

    function openQueueOptions(id) {
      const song=database.tracks.find(track=>track.id===id);
      if (!song || song.kind==='soda') return;
      queueTrackId=id;
      $('[data-sl-queue-song]').textContent=song.name;
      $('[data-sl-command="track-details"]').hidden=song.kind!=='file';
      queueOptions.showModal();
    }

    async function enqueueSong(where) {
      try {
        const accepted=await api.queueTrack(queueTrackId,where);
        if (accepted===false) return;
        queueOptions.close();
        api.toast(where==='next'?'已设为下一首。':'已加入队列末尾。');
      } catch (error) {
        api.toast(error.message || '无法加入播放队列，请重试。',true);
      }
    }

    function openEditor(id=null) {
      addingToNew=membership.open;
      if(addingToNew)membership.close();
      editId=id;
      $('#sl-edit-title').textContent=id?'重命名歌单':'新建歌单';
      const input=edit.querySelector('input');input.value=database.playlists.find(item=>item.id===id)?.name||'';
      input.setCustomValidity('');edit.showModal();input.focus();
    }

    function openMembership(id) {
      memberId=id;
      const song=database.tracks.find(track=>track.id===id);
      if(!song)return;
      $('[data-sl-member-song]').textContent=song.name;
      const list=$('[data-sl-member-options]');
      list.replaceChildren(...database.playlists.map(playlist=>{
        const label=document.createElement('label');label.className='lr-check';
        const input=document.createElement('input');input.type='checkbox';input.value=playlist.id;input.checked=playlist.trackIds.includes(id);
        label.append(input,document.createTextNode(playlist.name));
        return label;
      }));
      if(!database.playlists.length)list.textContent='先新建一个歌单，再把这首歌加入。';
      membership.querySelector('[type="submit"]').disabled=!database.playlists.length;
      membership.showModal();
    }

    function openEnrichment(){
      enrichIds=api.localEnrichmentCandidates(filtered.map(track=>track.id));
      matches=[];enrichResults.replaceChildren();applyButton.disabled=true;
      scanButton.disabled=!enrichIds.length;scanButton.textContent='查找匹配';
      enrichStatus.textContent=enrichIds.length?`${enrichIds.length} 首待补全。查找时将向汽水音乐和 LRCLIB 查询歌名、歌手等曲目信息。`:'当前列表没有可以补全的曲目。';
      enrich.showModal();
    }

    async function scanEnrichment(){
      if(enrichJob){enrichJob.abort();return;}
      const job=new AbortController();enrichJob=job;scanButton.textContent='停止查找';
      let processed=0,failed=0;
      for(const id of enrichIds){
        if(job.signal.aborted)break;
        enrichStatus.textContent=`已查找 ${processed} / ${enrichIds.length} 首，匹配 ${matches.length} 首。`;
        try{
          const match=await api.previewLocalEnrichment(id,job.signal);
          if(match&&!job.signal.aborted){
            const label=document.createElement('label');label.className='lr-check';
            const input=document.createElement('input');input.type='checkbox';input.checked=true;input.value=String(matches.length);
            const fields=[match.cover&&'封面',match.lyricsRaw&&`歌词（${match.lyricsSource}）`].filter(Boolean).join('、');
            label.append(input,document.createTextNode(`${match.draft.name} · ${fields}`));
            matches.push(match);enrichResults.append(label);
          }
          processed++;
        }catch{if(!job.signal.aborted){processed++;failed++;}}
      }
      if(enrichJob!==job)return;
      enrichJob=null;scanButton.textContent='查找匹配';scanButton.disabled=true;applyButton.disabled=!matches.length;
      enrichStatus.textContent=`已查找 ${processed} / ${enrichIds.length} 首，匹配 ${matches.length} 首${failed?`，${failed} 首暂时无法查询`:''}。`;
    }

    enrich.addEventListener('close',()=>{enrichJob?.abort();enrichJob=null;});

    root.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(!button||button.disabled)return;
      if(button.hasAttribute('data-sl-close')){button.closest('dialog').close();return;}
      if(button.dataset.slView){setView(button.dataset.slView);return;}
      const command=button.dataset.slCommand,id=button.closest('[data-sl-id]')?.dataset.slId;
      if(command==='new'||command==='rename')openEditor(command==='rename'?view:null);
      if(command==='enrich')openEnrichment();
      if(command==='scan-enrich')scanEnrichment();
      if(command==='apply-enrich'){
        const selected=[...enrichResults.querySelectorAll('input:checked')].map(input=>matches[Number(input.value)]);
        if(!selected.length){enrichStatus.textContent='请先勾选要保存的歌曲。';return;}
        button.disabled=true;
        api.applyLocalEnrichment(selected).then(({count,saved})=>{
          if(!saved){enrichStatus.textContent='已补全资料，本机保存未完成。请重试保存。';button.disabled=false;return;}
          enrich.close();api.toast(count?`已补全 ${count} 首歌曲。`:'补全资料已保存。');
        },error=>{enrichStatus.textContent=error.message;button.disabled=false;});
      }
      if(command==='more'){shown+=pageSize;renderTracks();const next=tracksList.children[shown-pageSize];next?.querySelector('button').focus({preventScroll:true});}
      if(command==='play')Promise.resolve(api.playFromLibrary(id,view)).catch(error=>api.toast(error.message,true));
      if(command==='play-all') {
        const first=filtered.find(track=>track.kind!=='soda');
        if(first)Promise.resolve(api.playFromLibrary(first.id,view,true)).catch(error=>api.toast(error.message,true));
      }
      if(command==='favorite')api.toggleFavorite(id);
      if(command==='membership')openMembership(id);
      if(command==='queue')openQueueOptions(id);
      if(command==='track-details'){
        queueOptions.close();details.open(queueTrackId).catch(error=>api.toast(error.message,true));
      }
      if(command==='queue-next'||command==='queue-end')enqueueSong(command==='queue-next'?'next':'end');
      if(command==='refresh-synced'){
        button.disabled=true;
        Promise.resolve(api.refreshSyncedPlaylist(view)).catch(error=>api.toast(error.message,true)).finally(()=>button.disabled=false);
      }
    });
    search.addEventListener('input',()=>{shown=pageSize;renderTracks();});
    sort.addEventListener('change',()=>{shown=pageSize;renderTracks();});
    edit.querySelector('input').addEventListener('input',event=>event.target.setCustomValidity(''));
    edit.addEventListener('submit',event=>{
      event.preventDefault();
      const input=edit.querySelector('input'),id=api.savePlaylist(input.value,editId);
      if(!id){input.setCustomValidity('请输入歌单名称。');input.reportValidity();return;}
      edit.close();
      if(addingToNew&&memberId) {
        const previous=database.playlists.filter(item=>item.trackIds.includes(memberId)).map(item=>item.id);
        api.setMembership(memberId,[...previous,id]);
      }
      setView(id);
    });
    membership.addEventListener('submit',event=>{
      event.preventDefault();
      api.setMembership(memberId,[...membership.querySelectorAll('input:checked')].map(input=>input.value));
      membership.close();
    });
    window.addEventListener('sonic:library-change',render);
    return {
      setVisible(visible) {
        root.hidden=!visible;
        if(visible)render();
        else for(const dialog of root.querySelectorAll('dialog[open]'))dialog.close();
      },
      updatePlayback,
    };
  }

  window.SonicMusicLibrary=Object.freeze({mount});
})();
