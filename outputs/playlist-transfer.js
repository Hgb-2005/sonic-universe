(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SonicPlaylistTransfer=api;
})(globalThis,function(){
  'use strict';
  const clean=value=>String(value||'').replace(/[\r\n\0]/g,' ').trim();
  const cue=value=>clean(value).normalize('NFKC').replaceAll('\\','/').replace(/^\.\//,'').toLocaleLowerCase();
  const leaf=value=>cue(value).split('/').at(-1);
  const label=track=>[track.artist,track.name].filter(Boolean).join(' - ');
  function reference(track){
    if(track.provider==='navidrome')return 'sonic-navidrome:'+track.mediaId;
    if(track.kind==='online'&&track.mediaId)return 'https://music.douyin.com/qishui/share/track?track_id='+track.mediaId;
    if(track.kind==='soda')return clean(track.externalUrl);
    if(track.kind==='demo')return 'sonic-demo:'+track.id;
    const path=clean(track.sourcePath);
    return /^[a-z]:|^[/\\]/i.test(path)?path.split(/[/\\]/).at(-1):path;
  }
  function encode(tracks){
    const lines=['#EXTM3U'];
    for(const track of tracks){
      const path=reference(track);
      if(!path)continue;
      lines.push('#EXTINF:'+Math.round(track.duration||0)+','+clean(label(track)),path.startsWith('#')?'./'+path:path);
    }
    return lines.join('\r\n')+'\r\n';
  }
  function decode(text){
    let title='';
    const rows=[];
    for(const raw of text.replace(/^\ufeff/,'').split(/\r?\n/)){
      const line=raw.trim();
      if(line.startsWith('#EXTINF:')){
        title=line.includes(',')?line.slice(line.indexOf(',')+1).trim():'';
      }else if(line&&!line.startsWith('#')){
        let path=line;
        if(/^file:/i.test(path)){
          try{path=decodeURIComponent(new URL(path).pathname);}catch{}
        }
        rows.push({path,title:title||leaf(path)});
        title='';
        if(rows.length>10000)throw new Error('歌单最多 10,000 首。');
      }
    }
    return rows;
  }
  function match(rows,tracks,existing=[]){
    const known=new Map(),names=new Map();
    const add=(map,key,track)=>{if(key){const list=map.get(key)||[];list.push(track);map.set(key,list);}};
    for(const track of tracks){
      const key=cue(reference(track));
      add(known,key,track);
      if(track.kind==='file')add(names,leaf(key),track);
    }
    const selected=new Set(existing),added=[],duplicates=[],missing=[];
    for(const row of rows){
      const key=cue(row.path);
      const file=!/^[a-z][a-z\d+.-]*:/i.test(key)||/^[a-z]:\//i.test(key);
      let choices=known.get(key)||[];
      if(!choices.length&&file)choices=names.get(leaf(key))||[];
      if(choices.length>1&&row.title){
        const byTitle=choices.filter(track=>cue(label(track))===cue(row.title));
        if(byTitle.length)choices=byTitle;
      }
      if(choices.length!==1){missing.push(row);continue;}
      const track=choices[0];
      if(selected.has(track.id)){duplicates.push(track);continue;}
      selected.add(track.id);
      added.push({row,track});
    }
    return {added,duplicates,missing};
  }
  const html=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  function share(name,tracks){
    const rows=tracks.map(track=>'<li><strong>'+html(track.name)+'</strong><div>'+
      html([track.artist,track.album].filter(Boolean).join(' · '))+'</div></li>');
    return '<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+html(name)+
      '</title><style>body{font:1rem/1.6 system-ui;color:#242633;max-width:44rem;margin:2rem auto;padding:1rem}li{padding:.65rem;border-bottom:1px solid #ddd}li div{color:#4f5364}</style><h1>'+
      html(name)+'</h1><p>声波宇宙 · '+tracks.length+' 首歌曲</p><ol>'+rows.join('')+'</ol></html>';
  }

  function mount(root,{api,currentPlaylist}){
    const dialog=document.createElement('dialog');
    dialog.className='lr-dialog';
    dialog.setAttribute('aria-labelledby','sonic-transfer-title');
    dialog.innerHTML='<h2 id="sonic-transfer-title">导入、备份与分享</h2>'+
      '<label>歌单合并到 <select data-transfer-target></select></label>'+
      '<input type="file" data-transfer-file accept=".m3u8,.m3u,.json" hidden>'+
      '<div class="lr-choice-row"><button data-transfer="import">选择备份或歌单</button><button data-transfer="m3u">导出 M3U8</button>'+
      '<button data-transfer="share">保存可分享目录</button><button data-transfer="lyrics">备份手改歌词</button><button data-transfer="details">备份曲目资料</button></div>'+
      '<p role="status" data-transfer-status></p><ul data-transfer-preview></ul>'+
      '<label data-transfer-merge hidden>已有资料 <select data-transfer-strategy><option value="keep">保留，补空白</option><option value="replace">用备份覆盖</option></select></label>'+
      '<div class="lr-choice-row"><button data-transfer="apply" hidden>确认导入</button><button data-transfer="close">关闭</button></div>';
    for(const button of dialog.querySelectorAll('button'))button.className='sl-button';
    root.append(dialog);
    const $=selector=>dialog.querySelector(selector);
    const file=$('[data-transfer-file]'),target=$('[data-transfer-target]'),status=$('[data-transfer-status]'),
      list=$('[data-transfer-preview]'),apply=$('[data-transfer="apply"]');
    let pending=null,preview=null,busy=false;
    function save(filename,body,type){
      const url=URL.createObjectURL(new Blob([body],{type})),link=document.createElement('a');
      link.href=url;link.download=filename.replace(/[<>:"/\\|?*]/g,'_');
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    function render(){
      const database=api.library(),playlist=database.playlists.find(item=>item.id===target.value);
      for(const action of ['share','m3u'])$('[data-transfer="'+action+'"]').disabled=!playlist;
      if(!pending)return;
      const isPlaylist=pending.kind==='m3u';
      preview=match(pending.rows,database.tracks,isPlaylist?playlist?.trackIds:[]);
      status.textContent='可'+(isPlaylist?'新增 ':'匹配 ')+preview.added.length+' 首 · 重复 '+preview.duplicates.length+' 首 · 找不到或匹配不唯一 '+preview.missing.length+' 首';
      list.replaceChildren(...[
        ...preview.added.map(item=>(isPlaylist?'新增 · ':'匹配 · ')+item.track.name),
        ...preview.duplicates.map(track=>'重复 · '+track.name),
        ...preview.missing.map(row=>'找不到 · '+row.title),
      ].slice(0,40).map(text=>Object.assign(document.createElement('li'),{textContent:text})));
      apply.hidden=!preview.added.length;
      $('[data-transfer-merge]').hidden=isPlaylist;
    }
    target.addEventListener('change',render);
    file.addEventListener('change',async()=>{
      const picked=file.files[0];file.value='';if(!picked)return;
      pending=null;preview=null;apply.hidden=true;list.replaceChildren();$('[data-transfer-merge]').hidden=true;
      try{
        if(picked.size>32*1024*1024)throw new Error('此文件大于 32 MB。');
        const text=await picked.text(),name=picked.name.replace(/\.[^.]+$/,'');
        if(/\.json$/i.test(picked.name)){
          const value=JSON.parse(text);
          if(value?.format!=='sonic-track-backup-v1'||!['details','lyrics'].includes(value.kind)||!Array.isArray(value.rows)||value.rows.length>10000||
            !value.rows.every(row=>typeof row?.path==='string'&&typeof row?.title==='string'&&row.data&&typeof row.data==='object'))throw new Error('无法识别这份声波宇宙备份。');
          pending={...value,name};
        }else{
          pending={kind:'m3u',name,rows:decode(text)};
        }
        render();
      }catch(error){status.textContent=error.message;}
    });
    dialog.addEventListener('click',async event=>{
      const command=event.target.closest('[data-transfer]')?.dataset.transfer;
      if(!command||busy)return;
      if(command==='close'){dialog.close();return;}
      if(command==='import'){file.click();return;}
      const database=api.library(),playlist=database.playlists.find(item=>item.id===target.value);
      const index=new Map(database.tracks.map(track=>[track.id,track]));
      const tracks=playlist?.trackIds.map(id=>index.get(id)).filter(Boolean)||[];
      if(command==='m3u'){save(playlist.name+'.m3u8',encode(tracks),'audio/x-mpegurl;charset=utf-8');return;}
      if(command==='share'){save(playlist.name+'.html',share(playlist.name,tracks),'text/html;charset=utf-8');return;}
      busy=true;
      try{
        if(command==='apply'&&pending&&preview){
          if(pending.kind==='m3u'){
            const id=playlist?.id||api.savePlaylist(pending.name||'导入歌单');
            const result=await api.editPlaylistMembership(id,preview.added.map(item=>item.track.id),true);
            if(!result.saved)throw new Error('导入已应用，保存未完成。请使用曲库的重试保存。');
            status.textContent='已按顺序加入 '+result.changed+' 首。';
          }else{
            const replace=$('[data-transfer-strategy]').value==='replace';
            let count=0,skipped=0,failed=0;
            for(const {row,track} of preview.added){
              if(track.kind!=='file'){skipped++;continue;}
              try{
                const details=await api.localTrackDetails(track.id);
                const draft={...details};let changed=false;
                if(pending.kind==='lyrics'){
                  if(!replace&&(details.lyricsRaw||details.lyricsOrigin==='manual')){skipped++;continue;}
                  if(typeof row.data.lyricsRaw!=='string'||typeof row.data.translationRaw!=='string'){skipped++;continue;}
                  Object.assign(draft,{lyricsIntent:'manual',lyricsRaw:row.data.lyricsRaw,translationRaw:row.data.translationRaw});changed=true;
                }else{
                  for(const field of ['name','artist','album','cover']){
                    const value=row.data[field];
                    if((typeof value==='string'||field==='cover'&&value===null)&&value!==details[field]&&
                      (replace||!details[field]||field==='name'&&leaf(track.sourcePath).replace(/\.[^.]+$/,'')===cue(details.name))){
                      draft[field]=value;changed=true;
                    }
                  }
                }
                if(!changed){skipped++;continue;}
                if(await api.saveLocalTrackDetails(track.id,draft))count++;else failed++;
              }catch{failed++;}
            }
            status.textContent='保存 '+count+' 首 · 跳过 '+skipped+' 首 · 失败 '+failed+' 首';
          }
          pending=null;preview=null;apply.hidden=true;list.replaceChildren();$('[data-transfer-merge]').hidden=true;
        }else if(command==='lyrics'||command==='details'){
          const rows=[];
          for(const track of database.tracks){
            if(track.kind!=='file'||!reference(track))continue;
            const details=await api.localTrackDetails(track.id);
            if(command==='lyrics'&&details.lyricsOrigin!=='manual')continue;
            const fields=command==='lyrics'?['lyricsRaw','translationRaw']:['name','artist','album','cover'];
            rows.push({path:reference(track),title:label(track),data:Object.fromEntries(fields.map(field=>[field,details[field]]))});
          }
          save((command==='lyrics'?'声波宇宙手改歌词':'声波宇宙曲目资料')+'.json',JSON.stringify({format:'sonic-track-backup-v1',kind:command,rows}),'application/json');
          status.textContent='已生成 '+rows.length+' 首歌曲的备份。';
        }
      }catch(error){status.textContent=error.message;}
      finally{busy=false;}
    });
    return ()=>{
      if(dialog.open)return;
      pending=null;preview=null;apply.hidden=true;list.replaceChildren();$('[data-transfer-merge]').hidden=true;
      status.textContent='';
      target.replaceChildren(new Option('新建歌单',''),...api.library().playlists.map(item=>new Option(item.name,item.id)));
      target.value=api.library().playlists.some(item=>item.id===currentPlaylist())?currentPlaylist():'';
      render();dialog.showModal();
    };
  }
  return {encode,decode,match,share,reference,mount};
});

