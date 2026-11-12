(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SonicLyricKaraoke=api})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const stamp=/<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
  function split(text){return Array.from(text)}
  function parse(raw){
    const rows=[];let order=0,offset=0;const tag=raw.match(/\[offset:\s*([+-]?\d+)\s*\]/i);if(tag)offset=Math.max(-120,Math.min(120,Number(tag[1])/1000));
    for(const line of raw.split(/\r?\n/)){
      const stamps=[...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
      if(!stamps.length)continue;
      const body=line.replace(/\[[^\]]*\]/g,'').trim(),marks=[...body.matchAll(stamp)],text=split(body.replace(stamp,'')).slice(0,180).join('');
      for(const s of stamps){const sec=Number(s[2].replace(':','.'));if(sec>=60)continue;const time=Number(s[1])*60+sec-offset,points=[];let chars=0,last=0;
        for(const m of marks){chars+=split(body.slice(last,m.index)).length;const part=Number(m[2].replace(':','.'));if(part<60&&chars<180)points.push({index:chars,time:Number(m[1])*60+part-offset});last=m.index+m[0].length;}
        rows.push({time,text,order:order++,points:points.filter(p=>Number.isFinite(p.time))});if(rows.length>=2500)break;
      }if(rows.length>=2500)break;
    }
    rows.sort((a,b)=>a.time-b.time||a.order-b.order);const unique=[];for(const row of rows){if(unique.at(-1)?.time===row.time)unique[unique.length-1]=row;else unique.push(row)}return unique;
  }
  function count(line,pos,end){
    const chars=split(line.text),length=chars.length;if(!length||pos<line.time)return 0;
    const finish=Math.max(line.time+.001,end),points=[{index:0,time:line.time}];
    for(const p of line.points||[]){if(p.index<0||p.index>=length||p.time<line.time||p.time>finish)continue;if(p.index===points.at(-1).index)points[points.length-1]=p;else if(p.index>points.at(-1).index&&p.time>=points.at(-1).time)points.push(p)}
    points.push({index:length,time:finish});
    for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];if(pos<b.time){const interval=Math.max(.001,b.time-a.time);return Math.max(0,Math.min(length,a.index+Math.floor((pos-a.time)/interval*(b.index-a.index))+1))}}
    return length;
  }
  return {parse,count,split};
});
