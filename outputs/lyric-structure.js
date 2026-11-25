/* Lyric structure: staff credits at the top and chorus detection.
   Pure functions over parsed lines so the node suite covers the rules. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SonicLyricStructure=api})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  // 多字署名词直接命中；「词/曲/唱」这类单字只在冒号上下文里算，避免把歌词「曲终人散」误判。
  const STAFF_WORDS=['作词','作曲','编曲','制作人','监制','出品','混音','母带','录音','吉他','贝斯','键盘','和声','弦乐','演唱','原唱','翻唱','统筹','企划','封面','设计','录音室','工作室'];
  const STAFF_SHORT=['词','曲','唱','鼓'];
  const DEFAULT_MIN_DWELL=.9;   // 每行至少停留多久才算「读得完」
  const SILENT_LINE=/^\s*[\[(（【]?(?:间奏|纯音乐|instrumental|interlude|music)[\])）】]?\s*$/i;

  const normalize=text=>String(text||'')
    .toLowerCase()
    .replace(/[\s\u3000]+/g,'')
    .replace(/[，。！？、,.!?;；:：'"“”‘’()（）\[\]【】\-—…~～]/g,'');

  function isStaffLine(text){
    const value=String(text||'').trim();
    if(!value||value.length>40)return false;
    const colon=/^([^：:]{1,6})[：:]/.exec(value);
    if(colon){
      const head=colon[1].trim();
      return STAFF_WORDS.some(word=>head.includes(word))||STAFF_SHORT.includes(head);
    }
    // 没有冒号时只认多字词开头的短行，歌词句子通常更长。
    return STAFF_WORDS.some(word=>value.startsWith(word))&&value.length<=24;
  }

  function staffBlock(lines){
    const indexes=[];
    for(let i=0;i<lines.length;i++){
      if(isStaffLine(lines[i]?.text))indexes.push(i);
      else break;                    // 只处理开头连续的一段
    }
    return indexes;
  }

  // 前奏够不够把署名读完：不够就整组隐藏，够就保留。
  function staffDecision(lines,{minDwell=DEFAULT_MIN_DWELL}={}){
    const indexes=staffBlock(lines);
    if(!indexes.length)return {indexes:[],verdict:'none'};
    const firstLyric=lines[indexes.length];
    const windowSeconds=firstLyric?Math.max(0,firstLyric.time-lines[0].time):0;
    const required=indexes.length*minDwell;
    return {indexes,verdict:windowSeconds>=required?'keep':'hide',windowSeconds,required};
  }

  function chorusKeys(lines){
    const counts=new Map();
    for(const line of lines||[]){
      const key=normalize(line?.text);
      if(key.length<2)continue;      // 单字句、空句不参与，避免误判
      counts.set(key,(counts.get(key)||0)+1);
    }
    return new Set([...counts].filter(([,count])=>count>=2).map(([key])=>key));
  }

  function decorate(lines,{minDwell=DEFAULT_MIN_DWELL,hideStaff=true}={}){
    if(!Array.isArray(lines)||!lines.length)return lines||[];
    const decision=hideStaff?staffDecision(lines,{minDwell}):{indexes:[],verdict:'keep'};
    const hidden=new Set(decision.verdict==='hide'?decision.indexes:[]);
    const kept=lines.filter((line,index)=>!hidden.has(index));
    const chorus=chorusKeys(kept);
    return kept.map(line=>{
      const key=normalize(line?.text);
      const isChorus=key.length>=2&&chorus.has(key);
      const silent=SILENT_LINE.test(line?.text||'');
      if(isChorus===Boolean(line?.isChorus)&&silent===Boolean(line?.silent))return line;
      return {...line,isChorus,silent};
    });
  }

  return Object.freeze({STAFF_WORDS,STAFF_SHORT,DEFAULT_MIN_DWELL,normalize,isStaffLine,staffBlock,staffDecision,chorusKeys,decorate});
});
