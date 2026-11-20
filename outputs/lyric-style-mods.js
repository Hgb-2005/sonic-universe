(function (root, factory) {
  const moduleApi=factory();
  if(typeof module==='object'&&module.exports)module.exports=moduleApi;
  else root.SonicLyricStyleMods=moduleApi;
})(globalThis, function () {
  'use strict';
  const key='sonic-lyric-style-mods-v1';
  const format='sonic-lyric-style';
  const sampleUrl='./assets/lyric-style-celadon.json';
  const styleKeys=new Set(['format','version','id','name','layout','alignment','accent','fontScale','motion','layers']);
  const layerKeys=new Set(['shape','x','y','width','height','color','opacity','angle','drift']);

  function between(value,min,max){return Number.isFinite(value)&&value>=min&&value<=max;}
  function colorHex(value){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);}
  function parseLayer(value) {
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!layerKeys.has(key)))return null;
    const {shape,x,y,width,height,color,opacity,angle=0,drift=false}=value;
    if(!['glow','ring','disc','stripe'].includes(shape)||!between(x,0,100)||!between(y,0,100)||
       !between(width,.3,140)||!between(height,.3,140)||!colorHex(color)||!between(opacity,.02,.6)||
       !between(angle,-180,180)||typeof drift!=='boolean')return null;
    return {shape,x,y,width,height,color,opacity,angle,drift};
  }

  function parseMod(value) {
    if(!value||value.format!==format||![1,2].includes(value.version)||
       typeof value.id!=='string'||!/^[a-z][a-z0-9-]{1,31}$/.test(value.id)||
       typeof value.name!=='string'||!value.name.trim()||value.name.length>40||/[\x00-\x1f\x7f]/.test(value.name))return null;
    const {version,id,name,layout,alignment,accent,fontScale,motion}=value;
    if(!['list','stage','fly'].includes(layout)||!['center','left'].includes(alignment)||!['normal','soft','still'].includes(motion)||
       !colorHex(accent)||!between(fontScale,.82,1.2))return null;
    const mod={format,version,id,name:name.trim(),layout,alignment,accent,fontScale,motion};
    if(version===1)return mod;
    if(Object.keys(value).some(key=>!styleKeys.has(key))||!Array.isArray(value.layers)||value.layers.length>8)return null;
    const layers=Array.from(value.layers,parseLayer);
    if(layers.some(layer=>!layer)||layers.filter(layer=>layer.drift).length>2)return null;
    return {...mod,layers};
  }

  function createDecoration(container) {
    let applied;
    return function renderDecoration(mod,animate) {
      container.dataset.animate=String(Boolean(animate&&mod?.motion!=='still'));
      if(applied===mod)return;
      applied=mod;
      const layers=mod?.layers||[];
      const nodes=layers.map(({shape,x,y,width,height,color,opacity,angle,drift})=>{
        const element=document.createElement('span');element.className='lr-mod-shape';element.dataset.shape=shape;
        if(drift)element.dataset.drift='true';
        element.style.setProperty('--lr-shape-color',color);
        element.style.setProperty('--lr-shape-angle',angle+'deg');
        Object.assign(element.style,{left:x+'%',top:y+'%',width:width+'%',height:height+'%',opacity});
        return element;
      });
      container.hidden=!nodes.length;
      container.replaceChildren(...nodes);
    };
  }

  function mount(root,onSelect) {
    const mods=new Map();let selected='';
    try {
      const saved=JSON.parse(localStorage.getItem(key));
      if(Array.isArray(saved?.mods))for(const raw of saved.mods.slice(0,20)){const mod=parseMod(raw);if(mod)mods.set(mod.id,mod);}
      if(mods.has(saved?.selected))selected=saved.selected;
    }catch{}
    const dialog=document.createElement('dialog');dialog.className='lr-dialog lr-mod-dialog';dialog.setAttribute('aria-labelledby','lrModTitle');
    dialog.innerHTML=`<div class="lr-dialog-heading"><div><h2 id="lrModTitle">歌词样式模组</h2><p>用 JSON 设置歌词和背景图层</p></div><button class="lr-icon" type="button" data-mod-close aria-label="关闭样式模组">×</button></div>
      <div class="lr-choice-row"><label class="lr-choice lr-detail-file">导入模组<input type="file" accept=".json,application/json" data-mod-file aria-label="选择 JSON 样式模组"></label><button type="button" class="lr-choice" data-mod-sample>试用青瓷</button><a class="lr-choice" href="${sampleUrl}" download="lyric-style-celadon.json">下载示例</a></div>
      <div class="lr-mod-options" data-mod-items></div><p class="lr-status" data-mod-status role="status"></p>`;
    root.append(dialog);
    const list=dialog.querySelector('[data-mod-items]');
    const status=dialog.querySelector('[data-mod-status]');
    function save(){try{localStorage.setItem(key,JSON.stringify({selected,mods:[...mods.values()]}));status.textContent='';}catch{status.textContent='本机暂时无法保存模组。';}}
    function select(id) {selected=mods.has(id)?id:'';save();render();onSelect(mods.get(selected)||null);}
    function importMod(mod){
      if(!mod)throw new Error('样式格式有误。请检查版本、图层类型和参数范围。');
      if(mods.size>=20&&!mods.has(mod.id))throw new Error('最多保存 20 个样式。');
      mods.set(mod.id,mod);select(mod.id);
    }
    function choice(text,action,id) {
      const button=document.createElement('button');button.className='lr-choice';button.type='button';button.textContent=text;button.addEventListener('click',action);
      if(id!==undefined)button.setAttribute('aria-pressed',String(id===selected));
      return button;
    }
    function render(){
      list.replaceChildren(choice('使用内置样式',()=>select(''),''));
      for (const mod of mods.values())list.append(choice(mod.name,()=>select(mod.id),mod.id));
      if(selected)list.append(choice('移除当前模组',()=>{mods.delete(selected);select('');}));
    }
    dialog.querySelector('[data-mod-close]').addEventListener('click',()=>dialog.close());
    const sampleButton=dialog.querySelector('[data-mod-sample]');
    sampleButton.addEventListener('click',async()=>{
      sampleButton.disabled=true;
      try {
        const response=await fetch(sampleUrl);
        if(!response.ok)throw new Error('无法读取青瓷示例。');
        const mod=parseMod(await response.json());
        if(dialog.open)importMod(mod);
      }catch(error){status.textContent=error.message;}
      finally{sampleButton.disabled=false;}
    });
    dialog.querySelector('[data-mod-file]').addEventListener('change',async event=>{
      const [file]=event.target.files;event.target.value='';if(!file)return;
      try {
        if(file.size>16384)throw new Error('模组文件不能超过 16 KB。');
        const mod=parseMod(JSON.parse(await file.text()));
        if(dialog.open)importMod(mod);
      }catch(error){status.textContent=error instanceof SyntaxError?'无法读取 JSON 样式。':error.message;}
    });
    return {
      current:()=>mods.get(selected)||null,
      open(){render();if(!dialog.open)dialog.showModal();},
      clear(){if(selected){selected='';save();render();}},
    };
  }

  return {mount,parseMod,createDecoration};
});
