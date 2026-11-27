(function () {
  'use strict';

  const sections = { all:'全部歌曲',local:'本地音乐',favorites:'我的收藏',recent:'最近播放' };
  const sourceNames = { file:'本地音乐',online:'汽水音乐',soda:'汽水分享',demo:'原创音景' };
  const emptyMessages = {
    all:'导入音乐文件或文件夹，建立你的曲库。',local:'导入音乐文件或文件夹，本地歌曲会显示在这里。',
    favorites:'收藏歌曲后，就能在这里找到。',recent:'你播放过的歌曲会显示在这里。',
  };
  const pageSize=40;
  function oneSpellingEdit(title,query){
    if(query.length<3||Math.abs(title.length-query.length)>1)return false;
    const [short,long]=title.length<query.length?[title,query]:[query,title];
    let left=0,right=0,edits=0;
    while(left<short.length&&right<long.length){
      if(short[left]===long[right]){left++;right++;continue;}
      if(++edits>1)return false;
      if(short.length===long.length)left++;
      right++;
    }
    return true;
  }
  const playbackStatusLabel=state=>window.SonicOnlineMusic.playbackStatusLabel(state);

  function mount(root,{api,icon,formatTime,openNowPlaying}) {
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
      </aside>
      <section class="sl-content" aria-labelledby="sl-title">
        <div class="sl-heading">
          <div><h1 id="sl-title">全部歌曲</h1><p data-sl-total role="status"></p></div>
          <div class="sl-heading-actions">
            <button class="sl-button" type="button" data-sl-command="transfer">导入 / 备份 / 分享歌单</button>
            <button class="sl-button" data-action="import">${icon('upload')}导入歌曲</button>
            <button class="sl-button" data-action="folder" title="选择新文件夹，或重新扫描已导入、已移动的文件夹">${icon('folder')}导入 / 重扫文件夹</button>
          </div>
        </div>
        <div class="sl-import-report" data-sl-import-report hidden>
          <div class="sl-import-heading">
            <p data-sl-import-status role="status"></p>
            <button type="button" class="lr-icon" data-sl-command="dismiss-import" aria-label="关闭导入结果">${icon('close')}</button>
          </div>
          <button class="sl-button sl-play-all" type="button" data-sl-command="play-imported" hidden>播放新导入</button>
          <progress data-sl-import-progress aria-label="导入进度" hidden></progress>
          <details data-sl-import-details hidden>
            <summary></summary>
            <ul></ul>
          </details>
        </div>
        <div class="sl-search-page" data-sl-search-page hidden>
          <form class="sl-search-actions" role="search" aria-label="音乐搜索">
            <label class="sl-search">${icon('search')}<input type="search" data-sl-local-search aria-label="搜索音乐" placeholder="搜索歌名、歌手或专辑" maxlength="100" autocomplete="off" aria-controls="sl-suggestions"></label>
            <button class="sl-button" type="submit" data-sl-qishui-submit hidden>搜索汽水</button>
          </form>
          <div id="sl-suggestions" class="lr-choice-row sl-suggestions" aria-label="搜索联想" hidden></div>
          <div class="sl-search-sources" role="group" aria-label="搜索来源">
            <button class="sl-source-tab" type="button" data-sl-search-source="local" aria-pressed="true" aria-controls="sl-local-results">本机</button>
            <button class="sl-source-tab" type="button" data-sl-search-source="qishui" aria-pressed="false" aria-controls="sl-qishui-results">汽水音乐</button>
          </div>
        </div>
        <div class="sl-tools">
          <button class="sl-button sl-play-all" data-sl-command="play-all">${icon('play')}<span>播放列表</span></button>
          <button class="sl-button" data-sl-command="rename" hidden>重命名歌单</button>
          <button class="sl-button" data-sl-command="refresh-synced" hidden>从汽水刷新</button>
          <button class="sl-button" data-sl-command="enrich" hidden>批量补全</button>
          <button class="sl-button" type="button" data-sl-command="select" aria-pressed="false" aria-controls="sl-selection">选择歌曲</button>
          <div class="sl-search-tools" role="search" aria-label="音乐搜索">
            <label class="sl-search"><span aria-hidden="true">⌕</span><input type="search" data-sl-search aria-label="搜索曲库" placeholder="搜索歌名、歌手或专辑" maxlength="100" autocomplete="off"></label>
            <button class="sl-button" type="button" data-action="online">搜在线</button>
          </div>
          <select class="sl-sort" data-sl-sort aria-label="排序方式"><option value="default">默认顺序</option><option value="name">按歌名</option><option value="artist">按歌手</option><option value="duration">按时长</option></select>
        </div>
        <div class="sl-selection" id="sl-selection" hidden>
          <button class="sl-button" type="button" data-sl-command="select-page">选择已显示歌曲</button>
          <button class="sl-button" type="button" data-sl-command="select-filtered" hidden>选择全部筛选结果</button>
          <button class="sl-button" type="button" data-sl-command="select-clear">清除选择</button>
          <button class="sl-button" type="button" data-sl-command="batch-add" aria-haspopup="dialog">加入歌单</button>
          <button class="sl-button" type="button" data-sl-command="batch-remove" hidden>移出当前歌单</button>
          <button class="sl-button" type="button" data-sl-command="move-up" hidden>上移</button>
          <button class="sl-button" type="button" data-sl-command="move-down" hidden>下移</button>
          <span class="sl-selection-count" role="status" data-sl-selection-count></span>
        </div>
        <div class="sl-selection-feedback">
          <span role="status" data-sl-save-status></span>
          <button class="sl-button" type="button" data-sl-command="retry-save" hidden>重试保存</button>
        </div>
        <div class="sl-selection-feedback" data-sl-read-failed hidden>
          <span role="status">暂时无法读取本机曲库，已保留原有内容。</span>
          <button class="sl-button" type="button" data-sl-command="retry-read">重试读取曲库</button>
        </div>
        <div class="sl-selection-feedback" data-sl-write-failed hidden>
          <span role="status">曲库更改尚未保存，请保留当前应用。</span>
          <button class="sl-button" type="button" data-sl-command="retry-library-save">重试保存</button>
        </div>
        <div id="sl-local-results" data-sl-local-results>
          <div class="sl-table-head" aria-hidden="true"><span>歌曲</span><span>专辑</span><span>来源</span><span>时长</span><span></span></div>
          <ol class="sl-tracks" data-sl-tracks></ol>
          <div class="sl-empty" data-sl-empty hidden>${icon('music')}<p data-sl-empty-text></p>
            <div class="sl-empty-actions" data-sl-empty-actions hidden>
              <button type="button" class="sl-button" data-sl-command="search-online">搜在线</button>
              <button type="button" class="sl-button" data-sl-command="clear-keyword">清空关键词</button>
            </div>
          </div>
          <button class="sl-button sl-more" data-sl-command="more" hidden>加载更多</button>
        </div>
        <section class="sl-qishui-results" id="sl-qishui-results" data-sl-qishui-results aria-label="汽水音乐搜索结果" hidden>
          <p class="sl-qishui-status" data-sl-qishui-status role="status"></p>
          <button class="sl-button" type="button" data-sl-qishui-retry hidden>重试搜索</button>
          <div class="sl-qishui-recovery" data-sl-qishui-recovery hidden>
            <button class="sl-button" type="button" data-sl-qishui-retry-track>重试播放</button>
            <button class="sl-button" type="button" data-sl-qishui-skip-track>试下一条结果</button>
          </div>
          <ol class="sl-qishui-list" data-sl-qishui-list></ol>
        </section>
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
      <dialog class="lr-dialog" data-sl-batch-add aria-labelledby="sl-batch-title"><form>
        <div class="lr-dialog-heading"><h2 id="sl-batch-title">加入歌单</h2><button class="lr-icon" type="button" data-sl-close aria-label="关闭加入歌单">${icon('close')}</button></div>
        <p class="lr-status" data-sl-batch-song hidden></p>
        <label class="lr-field"><span class="lr-field-title">选择歌单</span><select class="lr-search-input" name="playlistId" required></select></label>
        <p class="lr-status" data-sl-batch-preview role="status" hidden></p>
        <div class="sl-dialog-actions"><button class="sl-button" type="button" data-sl-close>取消</button><button class="sl-button sl-play-all" type="submit">加入</button></div>
      </form></dialog>
      <dialog class="lr-dialog sl-qishui-action-dialog" id="sl-qishui-more-dialog" data-sl-qishui-more-dialog aria-labelledby="sl-qishui-more-title">
        <div class="lr-dialog-heading"><div><h2 id="sl-qishui-more-title">歌曲选项</h2><p data-sl-qishui-more-song></p></div><button class="lr-icon" type="button" data-sl-close aria-label="关闭歌曲选项">${icon('close')}</button></div>
        <div class="sl-dialog-actions"><button class="sl-button sl-qishui-membership" type="button" data-sl-qishui-more-add>${icon('queueAdd')}加入歌单</button></div>
      </dialog>
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
    const tracksList=$('[data-sl-tracks]'), search=$('[data-sl-search]'), localSearch=$('[data-sl-local-search]'), sort=$('[data-sl-sort]');
    const searchPageElement=$('[data-sl-search-page]'), localResults=$('[data-sl-local-results]');
    const qishuiResults=$('[data-sl-qishui-results]'), qishuiList=$('[data-sl-qishui-list]');
    const qishuiSubmit=$('[data-sl-qishui-submit]'), qishuiRetry=$('[data-sl-qishui-retry]');
    const player=root.closest('#listeningRoom')?.querySelector('.lr-player-wrap');
    const edit=$('[data-sl-edit]'), membership=$('[data-sl-membership]'), queueOptions=$('[data-sl-queue]');
    const batchAdd=$('[data-sl-batch-add]'), selection=$('#sl-selection');
    const importReport=$('[data-sl-import-report]');
    let lastImportReport=null,dismissedImportReport=null;
    const qishuiMore=$('[data-sl-qishui-more-dialog]');
    const enrich=$('[data-sl-enrich]'), enrichStatus=$('[data-sl-enrich-status]'), enrichResults=$('[data-sl-enrich-results]');
    const scanButton=$('[data-sl-command="scan-enrich"]'), applyButton=$('[data-sl-command="apply-enrich"]');
    const details=window.SonicTrackDetails.mount(root,api);
    const header=root.closest('#listeningRoom').querySelector('.lr-header');
    const demoCover=new URL('./assets/interstellar-drift-cover.webp',document.baseURI).href;
    const collate=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
    let database, view='all', shown=pageSize, searchPage=false, searchShown=pageSize, filtered=[];
    const openTransfer=window.SonicPlaylistTransfer.mount(root,{api,currentPlaylist:()=>view});
    let playback, playbackKey=[], editId=null, memberId=null, addingToNew=false, queueTrackId=null;
    let enrichJob, enrichIds=[], matches=[];
    let selectionMode=false, playlistSaving=false, playlistSaveFailed=false;
    const selected=new Set();
    const browsePositions=new Map();
    let browseKey=null,browseLimit=pageSize,browseRestoreFrame=0,filterEditKey=null;
    const activeSearch=()=>searchPage?localSearch:search;
    const sharedQuery=()=>localSearch.value.trim();
    let searchSource='local', composing=false, suggestIndex=-1, suggestTimer=0;
    const suggestions=$('#sl-suggestions'),recentSearchKey='sonic-universe-recent-search-v1';
    let recentSearch=[],lyricHits=new Set();
    const trackSearchText=new WeakMap();
    function searchableTrack(track){
      let value=trackSearchText.get(track);
      if(!value){
        value={title:track.name.toLocaleLowerCase(),
          text:[track.name,track.artist,track.album,track.sourcePath].join(' ').toLocaleLowerCase()};
        trackSearchText.set(track,value);
      }
      return value;
    }
    try{
      const saved=JSON.parse(localStorage.getItem(recentSearchKey)||'[]');
      if(Array.isArray(saved))recentSearch=saved.filter(term=>typeof term==='string'&&term.length<=100).slice(0,12);
    }catch{}
    function rememberSearch(term){
      if(!term)return;
      recentSearch=[term,...recentSearch.filter(value=>value!==term)].slice(0,12);
      try{localStorage.setItem(recentSearchKey,JSON.stringify(recentSearch));}catch{}
    }
    function applySuggestion(value){
      localSearch.value=value;rememberSearch(value);sharedQueryChanged();
      if(searchSource==='qishui')void runQishuiSearch();
      localSearch.focus();
    }
    function renderSuggestions(){
      if(!searchPage)return;
      const query=sharedQuery().toLocaleLowerCase(),online=searchSource==='qishui';
      const choices=new Map();
      if(query){
        for(const track of (online?qishui.items:filtered).slice(0,6)){
          if(choices.size>=5)break;
          const name=track.name,artist=track.artist||'';
          if(name.toLocaleLowerCase()!==query)choices.set(name,artist?'歌曲 · '+artist:'歌曲');
          if(artist&&artist.toLocaleLowerCase()!==query&&artist.toLocaleLowerCase().includes(query))
            choices.set(artist,'艺人');
        }
      }
      for(const term of recentSearch){
        if(choices.size>=6)break;
        if(term.toLocaleLowerCase()!==query&&term.toLocaleLowerCase().includes(query)&&!choices.has(term))choices.set(term,'最近搜索');
      }
      const nodes=[...choices].slice(0,6).map(([term,kind],index)=>{
        const button=document.createElement('button');
        button.type='button';button.className='sl-button';button.id='sl-suggest-'+index;
        button.textContent=term+' · '+kind;
        button.addEventListener('click',()=>applySuggestion(term));
        return button;
      });
      suggestIndex=-1;localSearch.removeAttribute('aria-activedescendant');
      suggestions.replaceChildren(...nodes);suggestions.hidden=!nodes.length;
    }
    let qishui={query:'',status:'idle',items:[]}, qishuiRows=null, qishuiMessage='';
    let qishuiFailure=null;
    let qishuiSearchJob=null, qishuiPlayJob=null, qishuiCheckJob=null, localPick=0;
    let qishuiMoreTrack=null, qishuiBatchTrack=null, qishuiNewPlaylistTrack=null;
    const qishuiSaves=new Set();
    const qishuiFavoriteRetry=new Map();

    function viewTracks() {
      if(searchPage)return database.tracks.filter(track=>track.kind==='file'||track.kind==='demo');
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

    function setView(value,query='') {
      if(view!==value){selectionMode=false;selected.clear();}
      view=value;
      search.value=query;sort.value='default';shown=pageSize;
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
      row.innerHTML=`<div class="sl-track-name"><input type="checkbox" class="sl-track-check" data-sl-command="check" hidden><button type="button" class="sl-song" data-sl-command="play"><span class="sl-art">${icon('music')}</span><span class="sl-song-copy"><strong></strong><small></small></span><span class="sl-active" aria-hidden="true">${icon('sound')}</span></button></div><span class="sl-album"></span><span class="sl-source"></span><span class="sl-duration"></span><div class="sl-track-actions"><button type="button" class="lr-icon" data-sl-command="favorite">${icon('heart')}</button><button type="button" class="lr-icon" data-sl-command="membership">＋</button><button type="button" class="lr-icon" data-sl-command="queue" aria-haspopup="dialog">${icon('queueAdd')}</button></div>`;
      row.querySelector('[data-sl-command="check"]').setAttribute('aria-label','选择 '+track.name);
      const artist=track.artist||sourceNames[track.kind]||'未知歌手';
      row.querySelector('strong').textContent=track.name;
      const caption=row.querySelector('.sl-song-copy small');
      const showVersion=searchPage||track.kind==='online';
      caption.textContent=showVersion?artist+' · '+window.SonicOnlineMusic.recordingVersion(track):artist;
      if(showVersion&&track.album){
        const album=document.createElement('span');
        album.className='sl-search-album';album.textContent=' · '+track.album;
        caption.append(album);
      }
      if(searchPage){
        const state=track.kind==='soda'?'official':track.kind==='online'?'unknown':'full';
        const badge=document.createElement('span');
        badge.className='sl-playback-status';badge.textContent=playbackStatusLabel(state);
        caption.prepend(badge,' · ');
      }
      row.querySelector('.sl-album').textContent=track.album||'—';
      const source=row.querySelector('.sl-source');
      source.textContent=track.sourceMissing?'本机副本':track.provider==='navidrome'?'Navidrome':
        track.kind==='demo'&&track.id!=='demo'?'内置示例':sourceNames[track.kind]||'';
      if(track.sourceMissing)source.title='原文件已移出导入的文件夹，已保存的副本仍可播放。';
      row.querySelector('.sl-duration').textContent=track.duration>0?formatTime(track.duration):'—';
      const play=row.querySelector('[data-sl-command="play"]');
      play.dataset.label=(track.kind==='soda'?'打开':'播放')+' '+track.name;
      play.setAttribute('aria-label',play.dataset.label);
      if(track.kind==='online')play.setAttribute('aria-description',[artist,track.album].filter(Boolean).join(' · '));
      if(searchPage&&lyricHits.has(track.id)&&!track.name.toLocaleLowerCase().includes(sharedQuery().toLocaleLowerCase())){
        const match=document.createElement('span');match.className='sl-search-album';match.textContent=' · 歌词匹配';caption.append(match);
      }
      const favorite=row.querySelector('[data-sl-command="favorite"]');
      favorite.setAttribute('aria-label',(track.favorite?'取消收藏':'收藏')+' '+track.name);
      favorite.setAttribute('aria-pressed',String(track.favorite));
      favorite.title=track.favorite?'取消收藏':'收藏歌曲';
      const add=row.querySelector('[data-sl-command="membership"]');
      add.setAttribute('aria-label','管理 '+track.name+' 的所属歌单');add.title='管理所属歌单';
      favorite.disabled=add.disabled=database.readFailed;
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

    function rememberBrowse(){
      if(browseKey===null||root.hidden||browseRestoreFrame)return;
      const y=window.scrollY;
      const rows=[...tracksList.children];
      const edge=header.getBoundingClientRect().height;
      const index=y>0?rows.findIndex(row=>row.getBoundingClientRect().bottom>edge):-1;
      const nearby=index<0?[]:rows.slice(Math.max(0,index-2),index+4).map(row=>({
        id:row.dataset.slId,offset:row.getBoundingClientRect().top-edge,
      })).sort((a,b)=>Math.abs(a.offset)-Math.abs(b.offset));
      browsePositions.delete(browseKey);
      browsePositions.set(browseKey,{y,nearby,limit:browseLimit});
      if(browsePositions.size>80)browsePositions.delete(browsePositions.keys().next().value);
    }

    function restoreBrowse(position){
      const anchor=position.nearby.find(({id})=>tracksList.querySelector('[data-sl-id="'+CSS.escape(id)+'"]'));
      const row=anchor&&tracksList.querySelector('[data-sl-id="'+CSS.escape(anchor.id)+'"]');
      const top=row?window.scrollY+row.getBoundingClientRect().top-header.getBoundingClientRect().height-anchor.offset:position.y;
      window.scrollTo({top,behavior:'instant'});
    }

    function renderTracks({afterInput=false,savedBeforeInput=false}={}) {
      const input=activeSearch(),list=viewTracks(),query=input.value.trim().toLocaleLowerCase();
      const key=searchPage?null:JSON.stringify([view,query,sort.value]);
      if(key!==null&&!savedBeforeInput)rememberBrowse();
      const deferRestore=afterInput||Boolean(browseRestoreFrame);
      if(browseRestoreFrame){cancelAnimationFrame(browseRestoreFrame);browseRestoreFrame=0;}
      const position=browsePositions.get(key);
      if(key!==null&&key!==browseKey&&position)shown=position.limit;
      const rowLimit=searchPage?searchShown:shown;
      if(!searchPage){
        const visibleIds=new Set(list.map(track=>track.id));
        for(const id of selected)if(!visibleIds.has(id))selected.delete(id);
      }
      lyricHits=new Set(searchPage&&query.length>=2?(api.lyricSearch?.(query)||[]):[]);
      const matches=query?list.filter(track=>{
        const indexed=searchableTrack(track);
        return indexed.text.includes(query)||searchPage&&(lyricHits.has(track.id)||oneSpellingEdit(indexed.title,query));
      }):list.slice();
      filtered=searchPage?matches:sortTracks(matches);
      if(searchSource==='local')renderSuggestions();
      $('[data-sl-command="enrich"]').hidden=database.readFailed||!filtered.some(track=>track.kind==='file');
      const active=document.activeElement;
      const focus=tracksList.contains(active)?[active.closest('[data-sl-id]').dataset.slId,active.dataset.slCommand]:null;
      tracksList.replaceChildren(...filtered.slice(0,rowLimit).map(makeTrack));
      renderSelection();
      if(focus){
        const row=tracksList.querySelector('[data-sl-id="'+CSS.escape(focus[0])+'"]');
        const control=row?.querySelector('[data-sl-command="'+CSS.escape(focus[1])+'"]');
        (control&&!control.disabled?control:input).focus({preventScroll:true});
      }
      $('[data-sl-total]').textContent=query?`找到 ${filtered.length} / ${list.length} 首`:`${list.length} 首歌曲`;
      $('[data-sl-empty]').hidden=filtered.length>0;
      $('[data-sl-empty-actions]').hidden=!database.ready||!query;
      $('[data-sl-empty-text]').textContent=!database.ready?'正在读取音乐库':query?
        (searchPage?'本机没有找到匹配的歌曲':'没有找到匹配的歌曲'):
        searchPage?emptyMessages.local:emptyMessages[view]||'通过歌曲旁的「＋」把它加入这个歌单。';
      const onlineFallback=$('[data-sl-command="search-online"]');
      onlineFallback.textContent=searchPage?'用当前关键词搜汽水':'搜在线';
      onlineFallback.classList.toggle('sl-online-primary',searchPage);
      $('[data-sl-command="more"]').hidden=rowLimit>=filtered.length;
      const playAll=$('[data-sl-command="play-all"]');
      playAll.querySelector('span').textContent=usesVisibleOrder()?'播放当前结果':'播放列表';
      updatePlayback(playback,true);
      if(key!==null){
        if(position){
          if(deferRestore){
            // Restore the saved row after Chromium finishes scrolling the edited input into view.
            browseRestoreFrame=requestAnimationFrame(()=>{
              browseRestoreFrame=0;
              if(browseKey===key&&!root.hidden)restoreBrowse(position);
            });
          }else restoreBrowse(position);
        }else if(key!==browseKey)window.scrollTo({top:0,behavior:'instant'});
      }
      browseKey=key;
      browseLimit=rowLimit;
    }

    function sortTracks(list) {
      if(sort.value==='duration')return list.sort((a,b)=>(b.duration||0)-(a.duration||0));
      if(sort.value!=='default')return list.sort((a,b)=>collate.compare(a[sort.value]||'',b[sort.value]||''));
      return list;
    }

    function renderSelection() {
      if(searchPage)return;
      selection.hidden=!selectionMode;
      const toggle=$('[data-sl-command="select"]');
      toggle.setAttribute('aria-pressed',String(selectionMode));
      toggle.disabled=database.readFailed||playlistSaving||(!selectionMode&&!filtered.length);
      const playlist=database.playlists.find(item=>item.id===view);
      const reorder=playlist&&!search.value.trim()&&sort.value==='default';
      const displayed=filtered.slice(0,shown);
      const hiddenCount=selected.size-displayed.filter(track=>selected.has(track.id)).length;
      $('[data-sl-selection-count]').textContent='已选 '+selected.size+' 首'+(hiddenCount?'（'+hiddenCount+' 首未在当前显示）':'');
      $('[data-sl-command="select-page"]').disabled=playlistSaving||!displayed.some(track=>!selected.has(track.id));
      const selectFiltered=$('[data-sl-command="select-filtered"]');
      selectFiltered.hidden=filtered.length<=displayed.length;
      selectFiltered.disabled=playlistSaving||!filtered.some(track=>!selected.has(track.id));
      $('[data-sl-command="select-clear"]').disabled=playlistSaving||!selected.size;
      $('[data-sl-command="batch-add"]').disabled=playlistSaving||!selected.size||!database.playlists.length;
      const remove=$('[data-sl-command="batch-remove"]');
      remove.hidden=!playlist;
      remove.disabled=playlistSaving||!selected.size;
      for(const [direction,name] of [[-1,'move-up'],[1,'move-down']]){
        const button=$('[data-sl-command="'+name+'"]');
        button.hidden=!reorder;
        button.disabled=playlistSaving||!reorder||!playlist.trackIds.some((id,index)=>selected.has(id)&&playlist.trackIds[index+direction]&&!selected.has(playlist.trackIds[index+direction]));
      }
      const retry=$('[data-sl-command="retry-save"]');
      retry.hidden=!playlistSaveFailed;
      retry.disabled=playlistSaving;
      $('[data-sl-write-failed]').hidden=!database.saveFailed||playlistSaveFailed;
      $('[data-sl-command="retry-library-save"]').disabled=playlistSaving;
      for(const input of tracksList.querySelectorAll('.sl-track-check')){
        const row=input.closest('[data-sl-id]');
        input.hidden=!selectionMode;
        input.disabled=playlistSaving;
        input.checked=selected.has(row.dataset.slId);
        row.classList.toggle('sl-selected',selectionMode&&input.checked);
      }
    }

    function usesVisibleOrder() {
      return searchPage||view==='recent'||Boolean(search.value.trim())||sort.value!=='default';
    }

    async function playResult(id,keepPlaying=false) {
      if(searchPage)rememberSearch(sharedQuery());
      const resultIds=usesVisibleOrder()?filtered.map(track=>track.id):null;
      const directSearch=searchPage&&!keepPlaying;
      const pick=++localPick;
      try{
        await api.playFromLibrary(id,searchPage?'local':view,keepPlaying||directSearch,resultIds);
        const current=api.snapshot();
        if(directSearch&&localPick===pick&&searchPage&&searchSource==='local'&&current.playing&&current.track?.id===id)
          openNowPlaying();
      }catch(error){api.toast(error.message,true);}
    }

    function updateQishuiPlayback(){
      for(const button of qishuiList.querySelectorAll('[data-sl-qishui-track]')){
        const pending=qishuiPlayJob?.id===button.dataset.slQishuiTrack;
        if(pending)button.setAttribute('aria-busy','true');
        else button.removeAttribute('aria-busy');
        if(button.dataset.trackId===playback?.track?.id)button.setAttribute('aria-current','true');
        else button.removeAttribute('aria-current');
      }
    }

    const qishuiSongLabel=track=>[track.name,track.artist,track.album].filter(Boolean).join(' · ');

    function updateQishuiActions(){
      const favorites=new Set(database.tracks.filter(track=>track.favorite).map(track=>track.id));
      if(!database.saveFailed)qishuiFavoriteRetry.clear();
      for(const row of qishuiList.children){
        const favorite=row.querySelector('[data-sl-qishui-action="favorite"]');
        const desired=qishuiFavoriteRetry.get(row.dataset.slQishuiRow);
        const pressed=desired===undefined?favorites.has(row.dataset.trackId):!desired;
        const label=(desired===undefined?'':'重试')+(pressed?'取消收藏':'收藏');
        favorite.setAttribute('aria-pressed',String(pressed));
        favorite.setAttribute('aria-label',label+' '+row.dataset.slSongLabel);
        favorite.title=label;
        for(const control of row.querySelectorAll('[data-sl-qishui-action]')){
          if(control.dataset.slQishuiAction==='check'){
            const checking=qishuiCheckJob?.id===row.dataset.slQishuiRow;
            control.disabled=Boolean(qishuiPlayJob);
            if(checking)control.setAttribute('aria-busy','true');
            else control.removeAttribute('aria-busy');
            control.textContent=checking?'检查中…':'查可播';
            continue;
          }
          control.disabled=!database.ready||database.readFailed;
          if(qishuiSaves.has(row.dataset.slQishuiRow))control.setAttribute('aria-busy','true');
          else control.removeAttribute('aria-busy');
        }
      }
    }

    function makeQishuiRow(track){
      const row=document.createElement('li'),button=document.createElement('button');
      row.className='sl-qishui-row';button.type='button';button.className='sl-qishui-play';
      row.dataset.slQishuiRow=track.mediaId;row.dataset.trackId=track.id;row.dataset.slSongLabel=qishuiSongLabel(track);
      button.dataset.slQishuiTrack=track.mediaId;button.dataset.trackId=track.id;
      button.innerHTML=`${icon('play')}<span class="sl-qishui-copy"><strong class="sl-qishui-title"></strong><span class="sl-qishui-meta"></span></span><span class="sl-qishui-badges"></span>`;
      const version=window.SonicOnlineMusic.recordingVersion(track);
      const metadata=[track.artist||'歌手未知',track.album||'专辑未知',track.duration>0?formatTime(track.duration):'时长未知'];
      const title=button.querySelector('.sl-qishui-title'),meta=button.querySelector('.sl-qishui-meta');
      title.textContent=track.name;title.title=track.name;
      meta.textContent=metadata.join(' · ');meta.title=meta.textContent;meta.hidden=!metadata.length;
      const availability=track.availability||'unknown';
      const badges=button.querySelector('.sl-qishui-badges');
      for(const [kind,label] of [['source','汽水音乐'],['version',version],
        [availability,playbackStatusLabel(availability)]]){
        const badge=document.createElement('span');
        badge.className='sl-qishui-badge';badge.dataset.kind=kind;badge.textContent=label;
        badges.append(badge);
      }
      const actions=document.createElement('div');
      actions.className='sl-qishui-actions';
      actions.innerHTML=`<button class="lr-icon sl-qishui-favorite" type="button" data-sl-qishui-action="favorite">${icon('heart')}</button><button class="sl-button sl-qishui-membership" type="button" data-sl-qishui-action="membership" aria-haspopup="dialog">${icon('queueAdd')}加入歌单</button><button class="lr-icon sl-qishui-more" type="button" data-sl-qishui-action="more" aria-haspopup="dialog" aria-controls="sl-qishui-more-dialog" title="更多操作"><span aria-hidden="true">⋯</span></button>`;
      if(availability==='unknown'||availability==='failed'){
        const check=document.createElement('button');
        check.type='button';
        check.className='sl-button sl-qishui-check';
        check.dataset.slQishuiAction='check';
        check.setAttribute('aria-label','检查可播状态 '+row.dataset.slSongLabel);
        actions.prepend(check);
      }
      actions.querySelector('[data-sl-qishui-action="membership"]').setAttribute('aria-label','加入歌单 '+row.dataset.slSongLabel);
      actions.querySelector('[data-sl-qishui-action="more"]').setAttribute('aria-label','更多操作 '+row.dataset.slSongLabel);
      row.append(button,actions);
      return row;
    }

    function renderSearchSources(){
      const onQishui=searchPage&&searchSource==='qishui';
      localResults.hidden=onQishui;
      $('[data-sl-total]').hidden=onQishui;
      qishuiResults.hidden=!onQishui;
      qishuiSubmit.hidden=!onQishui;
      for(const button of searchPageElement.querySelectorAll('[data-sl-search-source]')){
        button.setAttribute('aria-pressed',String(button.dataset.slSearchSource===searchSource));
      }
      if(!onQishui){renderSuggestions();return;}
      renderSuggestions();
      qishuiSubmit.disabled=!sharedQuery()||qishui.status==='loading';
      qishuiRetry.hidden=!['timeout','unavailable','error'].includes(qishui.status);
      $('[data-sl-qishui-recovery]').hidden=!qishuiFailure;
      $('[data-sl-qishui-skip-track]').hidden=!nextQishuiResult();
      const feedback={
        idle:'输入歌名、歌手或专辑后搜索汽水音乐。',
        loading:'正在搜索汽水音乐…',
        ok:qishui.items.length?`找到 ${qishui.items.length} 首歌曲`:'汽水音乐没有匹配的歌曲。',
        timeout:'汽水搜索超时。',
        unavailable:'暂时无法连接汽水音乐。',
        error:qishui.message||'未能完成汽水搜索。'
      };
      const status=$('[data-sl-qishui-status]'),text=qishuiMessage||feedback[qishui.status];
      if(status.textContent!==text)status.textContent=text;
      if(qishuiRows!==qishui.items){
        const active=document.activeElement,focused=qishuiList.contains(active)?active.closest('[data-sl-qishui-row]'):null;
        const selector=active?.dataset.slQishuiAction?`[data-sl-qishui-action="${active.dataset.slQishuiAction}"]`:'[data-sl-qishui-track]';
        if(qishuiRows?.length===qishui.items.length){
          qishui.items.forEach((track,index)=>{
            if(track!==qishuiRows[index])qishuiList.children[index].replaceWith(makeQishuiRow(track));
          });
        }else qishuiList.replaceChildren(...qishui.items.map(makeQishuiRow));
        qishuiRows=qishui.items;
        if(focused){
          const row=qishuiList.querySelector('[data-sl-qishui-row="'+CSS.escape(focused.dataset.slQishuiRow)+'"]');
          (row?.querySelector(selector)||row?.querySelector('[data-sl-qishui-track]')||localSearch).focus({preventScroll:true});
        }
      }
      updateQishuiPlayback();
      updateQishuiActions();
    }

    function cancelQishuiPlay(){
      if(!qishuiPlayJob)return;
      qishuiPlayJob.controller.abort();
      qishuiPlayJob=null;
      qishuiMessage='';
    }

    function cancelQishuiCheck(){
      if(!qishuiCheckJob)return;
      qishuiCheckJob.controller.abort();
      qishuiCheckJob=null;
      qishuiMessage='';
    }

    function clearQishuiSearch(){
      qishuiSearchJob?.abort();
      qishuiSearchJob=null;
      cancelQishuiPlay();
      cancelQishuiCheck();
      qishui={query:'',status:'idle',items:[]};
      qishuiMessage='';
      qishuiFailure=null;
    }

    async function runQishuiSearch(){
      const query=sharedQuery();
      if(!searchPage||searchSource!=='qishui'||!query||composing||
        qishui.status==='loading'&&qishui.query===query)return;
      clearQishuiSearch();
      const job=new AbortController();
      qishuiSearchJob=job;
      qishui={query,status:'loading',items:[]};
      renderSearchSources();
      let result;
      try{result=await api.searchQishui(query,{signal:job.signal});}
      catch{result={status:'error',items:[]};}
      if(qishuiSearchJob!==job)return;
      qishuiSearchJob=null;
      qishui={query,status:result.status==='cancelled'?'idle':result.status,items:result.items,message:result.message};
      renderSearchSources();
    }

    function chooseSearchSource(source){
      if(!searchPage)return;
      if(searchSource!==source)localPick++;
      searchSource=source;
      if(source==='local'){cancelQishuiPlay();cancelQishuiCheck();}
      renderSearchSources();
      if(source==='qishui'&&(qishui.query!==sharedQuery()||qishui.status!=='ok'))void runQishuiSearch();
    }

    function sharedQueryChanged(){
      clearTimeout(suggestTimer);
      if(searchPage&&searchSource==='qishui'&&!composing&&sharedQuery().length>=2)
        suggestTimer=setTimeout(()=>{if(localSearch===document.activeElement)void runQishuiSearch();},330);
      localPick++;
      searchShown=pageSize;
      if(qishui.query!==sharedQuery())clearQishuiSearch();
      renderTracks();
      renderSearchSources();
    }

    function nextQishuiResult(){
      if(!qishuiFailure)return null;
      const index=qishui.items.findIndex(track=>track.mediaId===qishuiFailure);
      return qishui.items.slice(index+1).find(track=>track.availability!=='unavailable')||null;
    }

    async function checkQishuiResult(track){
      const id=track.mediaId;
      if(qishuiPlayJob||qishuiCheckJob?.id===id)return;
      cancelQishuiCheck();
      const job={id,controller:new AbortController()};
      qishuiCheckJob=job;
      qishuiMessage='正在检查《'+track.name+'》的音源…';
      renderSearchSources();
      let result;
      try{result=await api.checkQishuiSearchTrack(track,{signal:job.controller.signal});}
      catch{result={message:'暂时无法检查音源，可以再试一次。'};}
      if(qishuiCheckJob!==job)return;
      qishuiCheckJob=null;
      if(result.availability)qishui.items=qishui.items.map(item=>item===track?{...item,availability:result.availability}:item);
      qishuiMessage=result.message||'《'+track.name+'》'+
        playbackStatusLabel(result.availability)+'。';
      renderSearchSources();
    }

    async function playQishuiResult(id){
      rememberSearch(sharedQuery());
      const track=qishui.items.find(item=>item.mediaId===id);
      if(searchSource!=='qishui'||!searchPage||!track||qishuiPlayJob?.id===id)return;
      if(track.availability==='unavailable'){
        const url=window.SonicOnlineMusic.normalizeTrack(track)?.externalUrl;
        if(url)window.open(url,'_blank','noopener,noreferrer');
        return;
      }
      if(track.availability==='auth-required'&&!api.snapshot().onlineLoggedIn){api.openOnline(sharedQuery());return;}
      if(playback?.playing&&playback.track?.id===track.id){openNowPlaying();return;}
      cancelQishuiPlay();
      cancelQishuiCheck();
      const recovery=$('[data-sl-qishui-recovery]');
      if(recovery.contains(document.activeElement))qishuiList.querySelector('[data-sl-qishui-track="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});
      qishuiFailure=null;
      const job={id,controller:new AbortController()};
      qishuiPlayJob=job;
      qishuiMessage='正在获取《'+track.name+'》的音源…';
      renderSearchSources();
      let result;
      try{result=await api.playQishuiSearchTrack(track,{signal:job.controller.signal});}
      catch{result={status:'failed'};}
      if(qishuiPlayJob!==job)return;
      qishuiPlayJob=null;
      const failed=!['full','preview','cancelled'].includes(result.status);
      const availability={full:'direct',preview:'preview','auth-required':'auth-required'}[result.status]||result.availability||(failed?'failed':null);
      if(availability&&availability!==track.availability)qishui.items=qishui.items.map(item=>item===track?{...item,availability}:item);
      if(failed)qishuiFailure=id;
      qishuiMessage=result.status==='preview'?'正在试听《'+track.name+'》。':
        failed?'《'+qishuiSongLabel(track)+'》未能播放。'+(result.message||'可以重试。'):'';
      renderSearchSources();
      if(result.status==='full'||result.status==='preview'){
        openNowPlaying();
        if(result.status==='preview')api.toast(qishuiMessage);
      }
    }

    function renderImport() {
      const report=api.importReport();
      if(lastImportReport===report)return;
      lastImportReport=report;
      importReport.hidden=!report||report===dismissedImportReport;
      if(importReport.hidden)return;
      importReport.dataset.error=String(report.error);
      $('[data-sl-import-status]').textContent=report.message;
      $('[data-sl-command="dismiss-import"]').hidden=report.busy;
      $('[data-sl-command="play-imported"]').hidden=!report.added;
      const progress=$('[data-sl-import-progress]');
      progress.hidden=!report.busy;
      if(report.total){progress.max=report.total;progress.value=report.completed;}
      else progress.removeAttribute('value');
      const details=$('[data-sl-import-details]');
      details.open=false;
      details.hidden=!report.detailCount;
      const list=details.querySelector('ul');
      list.replaceChildren();
      if(report.detailCount){
        details.querySelector('summary').textContent='查看文件明细（'+report.detailCount+'）';
        for(const {path,reason} of report.details){
          const item=document.createElement('li');
          item.textContent=path+' · '+reason;
          list.append(item);
        }
        if(report.detailCount>report.details.length){
          const item=document.createElement('li');
          item.textContent='显示前 '+report.details.length+' 条明细。';
          list.append(item);
        }
      }
    }

    function render() {
      if(root.hidden)return;
      database=api.library();
      const playlist=database.playlists.find(item=>item.id===view);
      if(!playlist&&!sections[view]){view='all';selectionMode=false;selected.clear();}
      $('#sl-title').textContent=searchPage?'搜索音乐':playlist?.name||sections[view];
      $('[data-sl-read-failed]').hidden=!database.readFailed;
      $('[data-sl-command="rename"]').hidden=!playlist;
      $('[data-sl-command="refresh-synced"]').hidden=!playlist?.synced;
      root.querySelectorAll('.sl-heading-actions button').forEach(button=>button.disabled=!database.ready||database.readFailed||database.importing);
      root.querySelectorAll('[data-sl-command="new"]').forEach(button=>button.disabled=!database.ready||database.readFailed);
      renderImport();renderNavigation();renderTracks();renderSearchSources();
    }

    function updatePlayback(state,force=false) {
      playback=state;
      if(root.hidden||!state)return;
      const key=[state.track?.id,state.playing,state.busy,state.ready,state.external,state.onlineReady];
      if(!force&&key.every((part,index)=>part===playbackKey[index]))return;
      playbackKey=key;
      if(searchPage&&searchSource==='qishui')updateQishuiPlayback();
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
        api.toast(accepted==='current'?'这首歌是当前曲目。':where==='next'?'已设为下一首。':'已加入队列末尾。');
      } catch (error) {
        api.toast(error.message || '无法加入播放队列，请重试。',true);
      }
    }

    function openEditor(id=null,qishuiTrack=null) {
      addingToNew=membership.open;
      if(addingToNew)membership.close();
      editId=id;
      qishuiNewPlaylistTrack=qishuiTrack;
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

    function openBatchAdd(qishuiTrack=null) {
      const select=batchAdd.querySelector('select');
      select.replaceChildren(...database.playlists.map(playlist=>new Option(playlist.name,playlist.id)));
      if(!select.options.length){
        if(qishuiTrack)openEditor(null,qishuiTrack);
        return;
      }
      qishuiBatchTrack=qishuiTrack;
      const song=$('[data-sl-batch-song]');song.hidden=!qishuiTrack;
      song.textContent=qishuiTrack?qishuiSongLabel(qishuiTrack):'';
      renderBatchPreview();
      batchAdd.showModal();
      select.focus();
    }

    function renderBatchPreview(){
      const preview=$('[data-sl-batch-preview]');
      preview.hidden=Boolean(qishuiBatchTrack);
      if(preview.hidden)return;
      const target=database.playlists.find(playlist=>playlist.id===batchAdd.querySelector('select').value);
      const existing=new Set(target?.trackIds);
      const already=[...selected].filter(id=>existing.has(id)).length;
      preview.textContent='待加入 '+(selected.size-already)+' 首 · 已在歌单 '+already+' 首';
    }

    async function saveQishuiSelection(track,options) {
      if(qishuiSaves.has(track.mediaId))return;
      const playlistName=database.playlists.find(playlist=>playlist.id===options.playlistId)?.name;
      qishuiSaves.add(track.mediaId);
      updateQishuiActions();
      try {
        const result=await api.saveQishuiSearchTrack(track,options);
        if(result.saved){
          if(typeof options.favorite==='boolean')qishuiFavoriteRetry.delete(track.mediaId);
          const message=options.playlistId?(result.changed?`已加入「${playlistName}」。`:`已在「${playlistName}」中。`):
            options.favorite?'已收藏到本机。':'已取消本机收藏。';
          api.toast(message);
        }else{
          if(result.reason==='storage'&&typeof options.favorite==='boolean')qishuiFavoriteRetry.set(track.mediaId,options.favorite);
          api.toast(result.reason==='playlist-not-found'?'这个歌单已不存在，请重新选择。':'本机保存未完成，请重试。',true);
        }
      }catch{
        api.toast('本机保存未完成，请重试。',true);
      }finally{
        qishuiSaves.delete(track.mediaId);
        database=api.library();
        if(searchPage&&searchSource==='qishui')updateQishuiActions();
      }
    }

    async function saveSelection(operation,message,button) {
      if(playlistSaving)return;
      const originalView=view;
      playlistSaving=true;
      renderSelection();
      const status=$('[data-sl-save-status]');
      status.textContent='正在保存歌单…';
      try {
        const {saved,changed}=await operation();
        playlistSaveFailed=!saved&&(changed>0||playlistSaveFailed);
        const failure=button.dataset.slCommand==='retry-library-save'?'曲库仍未保存，可以重试。':
          playlistSaveFailed?'歌单保存未完成，可以重试。':'歌单当前不可用，请重新选择。';
        status.textContent=saved?message(changed):failure;
      } catch {
        status.textContent='歌单保存遇到问题，请重试。';
      } finally {
        playlistSaving=false;
        if(!root.hidden){
          database=api.library();
          renderSelection();
        }
        if(!root.hidden&&view===originalView&&document.activeElement===document.body){
          const next=playlistSaveFailed?$('[data-sl-command="retry-save"]'):button;
          (next.disabled||!next.getClientRects().length?tracksList.querySelector('.sl-track-check:checked:not([hidden])')||$('[data-sl-command="select"]'):next).focus({preventScroll:true});
        }
      }
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
      if(button.dataset.slSearchSource){chooseSearchSource(button.dataset.slSearchSource);return;}
      if(button.hasAttribute('data-sl-qishui-retry')){void runQishuiSearch();return;}
      if(button.hasAttribute('data-sl-qishui-retry-track')&&qishuiFailure){void playQishuiResult(qishuiFailure);return;}
      if(button.hasAttribute('data-sl-qishui-skip-track')){
        const next=nextQishuiResult();
        if(next)void playQishuiResult(next.mediaId);
        return;
      }
      if(button.dataset.slQishuiTrack){void playQishuiResult(button.dataset.slQishuiTrack);return;}
      if(button.hasAttribute('data-sl-qishui-more-add')){
        const track=qishuiMoreTrack;
        qishuiMore.close();
        if(track)openBatchAdd(track);
        return;
      }
      const qishuiAction=button.dataset.slQishuiAction;
      if(qishuiAction){
        const id=button.closest('[data-sl-qishui-row]').dataset.slQishuiRow;
        const track=qishui.items.find(item=>item.mediaId===id);
        if(!track)return;
        if(qishuiAction!=='check'&&qishuiSaves.has(id))return;
        if(qishuiAction==='check'){
          void checkQishuiResult(track);
        }else if(qishuiAction==='favorite'){
          const favorite=qishuiFavoriteRetry.get(id)??(button.getAttribute('aria-pressed')!=='true');
          void saveQishuiSelection(track,{favorite});
        }else if(qishuiAction==='membership')openBatchAdd(track);
        else{
          qishuiMoreTrack=track;
          $('[data-sl-qishui-more-song]').textContent=qishuiSongLabel(track);
          qishuiMore.showModal();
          $('[data-sl-qishui-more-add]').focus({preventScroll:true});
        }
        return;
      }
      if(button.dataset.slView){setView(button.dataset.slView);return;}
      const command=button.dataset.slCommand,id=button.closest('[data-sl-id]')?.dataset.slId;
      if(command==='new'||command==='rename')openEditor(command==='rename'?view:null);
      if(command==='enrich')openEnrichment();
      if(command==='transfer')openTransfer();
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
      if(command==='more'){
        const nextIndex=searchPage?searchShown:shown;
        if(searchPage)searchShown+=pageSize;
        else shown+=pageSize;
        renderTracks();tracksList.children[nextIndex]?.querySelector('button').focus({preventScroll:true});
      }
      if(command==='play')playResult(id);
      if(command==='play-imported')void api.playImportedMusic();
      if(command==='clear-keyword'){
        const input=searchPage?localSearch:search;
        input.value='';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.focus({preventScroll:true});
      }
      if(command==='search-online'){
        if(searchPage){
          chooseSearchSource('qishui');
          $('[data-sl-search-source="qishui"]').focus();
        }else api.openOnline(search.value,{opener:button});
      }
      if(command==='play-all') {
        const first=filtered.find(track=>track.kind!=='soda');
        if(first)playResult(first.id,true);
      }
      if(command==='select'){
        selectionMode=!selectionMode;
        if(!selectionMode)selected.clear();
        renderSelection();
      }
      if(command==='select-page'||command==='select-filtered'){
        for(const track of command==='select-page'?filtered.slice(0,shown):filtered)selected.add(track.id);
        renderSelection();
        $('[data-sl-command="select-clear"]').focus();
      }
      if(command==='select-clear'){
        selected.clear();
        renderSelection();
        $('[data-sl-command="select-page"]').focus();
      }
      if(command==='batch-add')openBatchAdd();
      if(command==='dismiss-import'){
        dismissedImportReport=lastImportReport;
        importReport.hidden=true;
        $('[data-action="import"]').focus();
      }
      if(command==='batch-remove'){
        const items=[...selected];
        void saveSelection(()=>api.editPlaylistMembership(view,items,false),count=>count?'已从当前歌单移出 '+count+' 首。':'当前歌单没有这些歌曲。',button);
      }
      if(command==='move-up'||command==='move-down'){
        const items=[...selected];
        void saveSelection(()=>api.movePlaylistTracks(view,items,command==='move-up'?-1:1),()=> '已保存歌单顺序。',button);
      }
      if(command==='retry-save'){
        void saveSelection(async()=>({saved:await api.retryPlaylistSave(),changed:1}),()=> '已保存歌单。',button);
      }
      if(command==='retry-library-save'){
        void saveSelection(async()=>({saved:await api.retryPlaylistSave(),changed:0}),()=> '已保存曲库。',button);
      }
      if(command==='retry-read')api.retryLibraryRead();
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
    tracksList.addEventListener('change',event=>{
      const input=event.target;
      if(!input.matches('.sl-track-check')||!selectionMode||playlistSaving)return;
      const id=input.closest('[data-sl-id]').dataset.slId;
      if(input.checked)selected.add(id);else selected.delete(id);
      renderSelection();
    });
    function keepResultAbovePlayer(event){
      if(!player||!event.target.matches(':focus-visible'))return;
      const bounds=event.target.getBoundingClientRect();
      const overlap=bounds.bottom-player.getBoundingClientRect().top+8;
      const above=bounds.top-header.getBoundingClientRect().bottom-8;
      if(overlap>0||above<0)window.scrollBy({top:overlap>0?overlap:above,behavior:'instant'});
    }
    tracksList.addEventListener('focusin',keepResultAbovePlayer);
    qishuiList.addEventListener('focusin',keepResultAbovePlayer);
    search.addEventListener('beforeinput',()=>{
      rememberBrowse();
      filterEditKey=browseKey;
    });
    search.addEventListener('input',event=>{
      const savedBeforeInput=event.isTrusted&&filterEditKey!==null&&filterEditKey===browseKey;
      filterEditKey=null;
      shown=pageSize;
      renderTracks({afterInput:true,savedBeforeInput});
    });
    localSearch.addEventListener('input',sharedQueryChanged);
    localSearch.addEventListener('compositionstart',()=>{composing=true;});
    localSearch.addEventListener('compositionend',()=>{composing=false;sharedQueryChanged();});
    localSearch.addEventListener('keydown',event=>{
      if(composing||suggestions.hidden)return;
      const buttons=[...suggestions.children];
      if(event.key==='Enter'&&suggestIndex>=0){
        event.preventDefault();buttons[suggestIndex]?.click();return;
      }
      if(!['ArrowUp','ArrowDown'].includes(event.key)||!buttons.length)return;
      event.preventDefault();
      suggestIndex=(suggestIndex+(event.key==='ArrowDown'?1:suggestIndex<0?0:-1)+buttons.length)%buttons.length;
      buttons.forEach((button,index)=>button.classList.toggle('sl-online-primary',index===suggestIndex));
      localSearch.setAttribute('aria-activedescendant',buttons[suggestIndex].id);
    });
    searchPageElement.querySelector('form').addEventListener('submit',event=>{
      event.preventDefault();
      clearTimeout(suggestTimer);
      if(composing||!sharedQuery())return;
      rememberSearch(sharedQuery());
      if(searchSource==='local'){
        if(!filtered.length)chooseSearchSource('qishui');
        return;
      }
      void runQishuiSearch();
    });
    sort.addEventListener('change',()=>{shown=pageSize;renderTracks();});
    edit.querySelector('input').addEventListener('input',event=>event.target.setCustomValidity(''));
    edit.addEventListener('submit',event=>{
      event.preventDefault();
      const input=edit.querySelector('input'),id=api.savePlaylist(input.value,editId);
      if(!id){input.setCustomValidity('请输入歌单名称。');input.reportValidity();return;}
      edit.close();
      if(qishuiNewPlaylistTrack){
        const track=qishuiNewPlaylistTrack;qishuiNewPlaylistTrack=null;
        void saveQishuiSelection(track,{playlistId:id});
        return;
      }
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
    batchAdd.addEventListener('submit',event=>{
      event.preventDefault();
      const target=batchAdd.querySelector('select').value;
      if(qishuiBatchTrack){
        const track=qishuiBatchTrack;qishuiBatchTrack=null;
        batchAdd.close();
        if(target)void saveQishuiSelection(track,{playlistId:target});
        return;
      }
      const items=sortTracks(viewTracks()).filter(track=>selected.has(track.id)).map(track=>track.id);
      batchAdd.close();
      if(target&&items.length){
        void saveSelection(()=>api.editPlaylistMembership(target,items,true),count=>{
          if(!count)return '所选歌曲均已在歌单中。';
          const already=items.length-count;
          return '已加入 '+count+' 首歌曲。'+(already?'另有 '+already+' 首已在歌单中。':'');
        },$('[data-sl-command="batch-add"]'));
      }
    });
    batchAdd.querySelector('select').addEventListener('change',renderBatchPreview);
    qishuiMore.addEventListener('close',()=>{if(!qishuiMore.open)qishuiMoreTrack=null;});
    batchAdd.addEventListener('close',()=>{if(!batchAdd.open)qishuiBatchTrack=null;});
    edit.addEventListener('close',()=>{if(!edit.open)qishuiNewPlaylistTrack=null;});
    window.addEventListener('sonic:library-change',render);
    window.addEventListener('sonic:import-progress',renderImport);
    return {
      setVisible(visible,searching=false) {
        if(searchPage&&!searching){
          localPick++;
          if(qishuiSearchJob)clearQishuiSearch();
          else {cancelQishuiPlay();cancelQishuiCheck();}
          if(qishuiMore.open)qishuiMore.close();
          if(qishuiBatchTrack&&batchAdd.open)batchAdd.close();
          if(qishuiNewPlaylistTrack&&edit.open)edit.close();
        }
        searchPage=searching;
        root.dataset.searchPage=String(searchPage);
        searchPageElement.hidden=!searchPage;
        root.hidden=!visible;
        if(visible)render();
        else for(const dialog of root.querySelectorAll('dialog[open]'))dialog.close();
      },
      updatePlayback,
      leaveBrowse(){rememberBrowse();browseKey=null;},
      focusSearch(){
        const dockTop=player?.getBoundingClientRect().top??window.innerHeight;
        const headerBottom=header.getBoundingClientRect().bottom;
        const results=searchPage&&searchSource==='qishui'?qishuiList:tracksList;
        const result=window.scrollY>0&&[...results.querySelectorAll(':is(.sl-song,.sl-qishui-play):not(:disabled)')].find(button=>{
          const bounds=button.getBoundingClientRect();
          return bounds.top>=headerBottom&&bounds.bottom+8<=dockTop;
        });
        (result||activeSearch()).focus({preventScroll:true});
      },
      searchQuery:()=>activeSearch().value.trim(),
      searchLocal(query){
        if(searchPage){searchSource='local';localSearch.value=query;sharedQueryChanged();}
        else setView('local',query);
        activeSearch().focus({preventScroll:true});
      },
    };
  }

  window.SonicMusicLibrary=Object.freeze({mount});
})();
