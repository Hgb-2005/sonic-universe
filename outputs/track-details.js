(() => {
  'use strict';

  function mount(root,api) {
    const dialog=document.createElement('dialog');dialog.className='lr-dialog lr-track-details';dialog.setAttribute('aria-labelledby','lrTrackDetailsTitle');
    dialog.innerHTML=`<form>
      <div class="lr-dialog-heading"><div><h2 id="lrTrackDetailsTitle">歌曲资料</h2><p data-detail-path></p></div><button class="lr-icon" type="button" data-detail-close aria-label="关闭歌曲资料">×</button></div>
      <fieldset>
        <div class="lr-detail-grid"><div class="lr-detail-cover"><img data-detail-cover alt="当前封面" hidden><span data-detail-cover-empty>暂无封面</span></div>
        <div class="lr-detail-fields"><label>歌名<input class="lr-search-input" name="title" maxlength="200" required></label><label>歌手<input class="lr-search-input" name="artist" maxlength="200"></label><label>专辑<input class="lr-search-input" name="album" maxlength="200"></label></div></div>
        <div class="lr-choice-row"><label class="lr-choice lr-detail-file">选封面<input type="file" data-detail-artwork accept="image/jpeg,image/png,image/webp" aria-label="选择封面图片"></label><button type="button" class="lr-choice" data-detail-clear>移除封面</button></div>
        <label class="lr-detail-lyrics">同步歌词<textarea name="lyrics" maxlength="160000" placeholder="粘贴带时间的歌词"></textarea></label>
        <label class="lr-detail-lyrics">翻译<textarea name="translation" maxlength="160000" placeholder="粘贴带时间的翻译"></textarea></label>
        <div class="lr-choice-row"><label class="lr-choice lr-detail-file">导入歌词<input type="file" data-detail-lyrics-file="lyrics" accept=".lrc,.yrc,.krc,.qrc,.ttml,.vtt,text/plain" aria-label="选择歌词文件"></label><label class="lr-choice lr-detail-file">导入翻译<input type="file" data-detail-lyrics-file="translation" accept=".lrc,.yrc,.krc,.qrc,.ttml,.vtt,text/plain" aria-label="选择翻译文件"></label><button class="lr-choice" type="button" data-detail-enrich>在线补全</button></div>
      </fieldset>
      <p class="lr-status" data-detail-status role="status"></p>
      <div class="sl-dialog-actions"><button type="button" class="lr-choice" data-detail-close>取消</button><button type="submit" class="lr-primary">保存资料</button></div>
    </form>`;
    root.append(dialog);
    const $=selector=>dialog.querySelector(selector), form=$('form'), fields=$('fieldset'), status=$('[data-detail-status]');
    const submit=$('[type=submit]'), image=$('[data-detail-cover]'), empty=$('[data-detail-cover-empty]');
    const inputs=form.elements;
    let original,cover,request,generation=0;

    function setStatus(message,error=false){status.textContent=message;status.dataset.error=String(error);}
    function locked(value){fields.disabled=value;submit.disabled=value;}
    function setCover(value){
      cover=value;image.hidden=!cover;empty.hidden=!!cover;$('[data-detail-clear]').disabled=!cover;
      if(cover)image.src=cover;else image.removeAttribute('src');
    }
    function draft(){return {...original,name:inputs.title.value,artist:inputs.artist.value,album:inputs.album.value,lyricsRaw:inputs.lyrics.value,translationRaw:inputs.translation.value,cover};}
    function change() {return {stamp:++generation,applies(){return dialog.open&&this.stamp===generation;}};}

    async function open(id) {
      const stamp=++generation;
      const track=await api.localTrackDetails(id);
      if(stamp!==generation)return;
      original=track;
      inputs.title.value=track.name;inputs.artist.value=track.artist;inputs.album.value=track.album;inputs.lyrics.value=track.lyricsRaw;inputs.translation.value=track.translationRaw;
      $('[data-detail-path]').textContent=track.sourcePath+(track.sourceMissing?' · 原文件已移走，本机副本仍可播放':'');setCover(track.cover);locked(false);setStatus('');
      if(!dialog.open)dialog.showModal();
    }

    dialog.querySelectorAll('[data-detail-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    dialog.addEventListener('close',()=>{generation++;request?.abort();request=null;original=null;});
    $('[data-detail-clear]').addEventListener('click',()=>setCover(null));
    $('[data-detail-artwork]').addEventListener('change',async event=>{
      const [file]=event.target.files;event.target.value='';if(!file)return;
      const job=change();locked(true);
      try{const value=await api.prepareTrackCover(file);if(job.applies()){setCover(value);setStatus('已选封面，保存后应用。');}}
      catch(error){if(job.applies())setStatus(error.message,true);}
      finally{if(job.applies())locked(false);}
    });
    for(const picker of dialog.querySelectorAll('[data-detail-lyrics-file]'))picker.addEventListener('change',async event=>{
      const [file]=event.target.files;event.target.value='';if(!file)return;
      if(file.size>250000){setStatus('歌词文件太大。',true);return;}
      const job=change();locked(true);
      try{const raw=await file.text();if(job.applies()){if(raw.length>160000)throw Error('歌词内容太长。');inputs[picker.dataset.detailLyricsFile].value=raw;setStatus('已读取文件，保存后应用。');}}
      catch(error){if(job.applies())setStatus(error.message,true);}
      finally{if(job.applies())locked(false);}
    });
    $('[data-detail-enrich]').addEventListener('click',async()=>{
      const job=change(),controller=new AbortController();request=controller;locked(true);setStatus('正在核对歌名、歌手、时长与版本…');
      try {
        const match=await api.enrichLocalTrackDetails(draft(),controller.signal);
        if(!job.applies())return;
        if(match.status!=='matched') {
          const messages={insufficient:'请输入歌名和歌手，再试一次。',unauthenticated:'请先在在线搜索里登录汽水音乐。', 'no-match':'未找到能确认是同一版本的歌曲，可以手动修改资料。'};
          setStatus(messages[match.status]||'暂时无法补全。',true);return;
        }
        const additions=[];
        if(match.inferred){inputs.title.value=match.name;inputs.artist.value=match.artist;additions.push('歌名和歌手');}
        if(match.album){inputs.album.value=match.album;additions.push('专辑');}
        if(match.cover){setCover(match.cover);additions.push('封面');}
        if(match.lyricsRaw&&match.lyricsRaw.length<=160000){inputs.lyrics.value=match.lyricsRaw;additions.push(match.lyricsSource?`歌词（${match.lyricsSource}）`:'歌词');}
        setStatus(additions.length?'已填入'+additions.join('、')+'，核对后保存。':match.coverUnavailable?'已匹配曲目，封面暂时无法读取。':'已匹配曲目，暂无可补全字段。');
      }catch(error){if(job.applies()&&!controller.signal.aborted)setStatus(error.message||'暂时无法读取汽水音乐。',true);}
      finally{if(request===controller)request=null;if(job.applies())locked(false);}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!original)return;
      const job=change(),value=draft();locked(true);
      try {
        const saved=await api.saveLocalTrackDetails(original.id,value);
        if(!job.applies())return;
        if(saved){dialog.close();api.toast('歌曲资料已保存。');}
        else setStatus('资料已应用，本机保存未完成。可以重试。',true);
      }catch(error){if(job.applies())setStatus(error.message,true);}
      finally{if(job.applies())locked(false);}
    });
    return {open};
  }

  window.SonicTrackDetails=Object.freeze({mount});
})();
