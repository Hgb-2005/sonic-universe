(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SonicLyricKaraoke=api})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const stamp=/<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
  const krcStamp=/<(\d{1,10}),(\d{1,10})(?:,\d+)?>/g;
  const yrcStamp=/\((\d{1,10}),(\d{1,10}),\d+\)/g;
  const qrcStamp=/\((\d{1,10}),(\d{1,10})\)/g;
  function split(text){return Array.from(text)}
  function parse(raw){
    if(typeof raw!=='string')return [];
    if(/^\s*WEBVTT(?:[ \t]|\r?\n|$)/.test(raw))return parseVtt(raw);
    if(/^\s*</.test(raw)) {
      const xml=readXml(raw);
      if(!xml)return [];
      if(xml.local==='tt')return readTtml(xml);
      const content=findQrcContent(xml);
      return content?parseQrc(content):[];
    }
    if (/\[\d{1,10},\d{1,10}\]/.test(raw)) {
      const yrc = parseYrc(raw);
      if (yrc.length) return yrc;
      const krc = parseKrc(raw);
      if (krc.some(line=>line.points.length)) return krc;
      const qrc=parseQrc(raw);
      if(qrc.length)return qrc;
    }
    const rows=[];let order=0,offset=0;const tag=raw.match(/\[offset:\s*([+-]?\d+)\s*\]/i);if(tag)offset=Math.max(-120,Math.min(120,Number(tag[1])/1000));
    for(const line of raw.split(/\r?\n/)){
      const stamps=[...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
      if(!stamps.length)continue;
      const body=line.replace(/\[[^\]]*\]/g,'').trim(),marks=[...body.matchAll(stamp)],text=split(body.replace(stamp,'')).slice(0,180).join('');
      for(const s of stamps){const sec=Number(s[2].replace(':','.'));if(sec>=60)continue;const time=Number(s[1])*60+sec-offset,points=[];let chars=0,last=0;
        for(const m of marks){chars+=split(body.slice(last,m.index)).length;const part=Number(m[2].replace(':','.'));if(part<60&&chars<=180)points.push({index:chars,time:Number(m[1])*60+part-offset});last=m.index+m[0].length;}
        rows.push({time,text,order:order++,points:points.filter(p=>Number.isFinite(p.time))});if(rows.length>=2500)break;
      }if(rows.length>=2500)break;
    }
    return orderedLines(rows);
  }
  function orderedLines(rows) {
    rows.sort((a,b)=>a.time-b.time||a.order-b.order);
    const unique=[];
    for(const row of rows) {
      if(unique.at(-1)?.time===row.time)unique[unique.length-1]=row;
      else unique.push(row);
    }
    return unique;
  }
  function parseKrc(raw) {
    return parseMillisecondLyrics(raw,krcStamp,true);
  }
  function parseYrc(raw) {
    return parseMillisecondLyrics(raw,yrcStamp,false);
  }
  function parseQrc(raw) {
    if(/^\s*</.test(raw)) {
      raw=findQrcContent(readXml(raw));
      if(!raw)return [];
    }
    const rows=[];
    for(const source of raw.split(/\r\n?|\n/)) {
      const line=/^\s*\[(\d{1,10}),(\d{1,10})\](.*)$/.exec(source);
      if(!line)continue;
      const start=Number(line[1]),end=start+Number(line[2]);
      const characters=[],points=[];
      let from=0,lastStart=start;
      for(const match of line[3].matchAll(qrcStamp)) {
        const time=Number(match[1]);
        if(time<lastStart||time>end)continue;
        const text=split(line[3].slice(from,match.index));
        from=match.index+match[0].length;
        if(!text.length)continue;
        lastStart=time;
        points.push({index:characters.length,time:time/1000,end:(time+Number(match[2]))/1000});
        characters.push(...text.slice(0,180-characters.length));
        if(characters.length>=180)break;
      }
      if(!points.length)continue;
      characters.push(...split(line[3].slice(from)).slice(0,180-characters.length));
      const text=characters.join('');
      if(text.trim())rows.push({time:start/1000,end:end/1000,text,points,order:rows.length});
      if(rows.length>=2500)break;
    }
    return orderedLines(rows);
  }
  function parseMillisecondLyrics(raw,stampPattern,relative) {
    const rows=[];
    for(const line of raw.split(/\r?\n/)) {
      const row=/^\s*\[(\d{1,10}),(\d{1,10})\](.*)$/.exec(line);
      if(!row)continue;
      const lineStart=Number(row[1]),time=lineStart/1000,end=(lineStart+Number(row[2]))/1000;
      const body=row[3],matches=[...body.matchAll(stampPattern)];
      if(!relative&&!matches.length)continue;
      const characters=split(body.slice(0,matches[0]?.index??body.length)).slice(0,180);
      const points=[];
      for(let i=0;i<matches.length&&characters.length<180;i++) {
        const mark=matches[i],word=split(body.slice(mark.index+mark[0].length,matches[i+1]?.index??body.length));
        if(!word.length)continue;
        const wordStart=Number(mark[1])+(relative?lineStart:0);
        points.push({index:characters.length,time:wordStart/1000,end:(wordStart+Number(mark[2]))/1000});
        characters.push(...word.slice(0,180-characters.length));
      }
      const text=characters.join('');
      if(text.trim())rows.push({time,end,text,points,order:rows.length});
      if(rows.length>=2500)break;
    }
    return orderedLines(rows);
  }
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',lrm:'\u200e',rlm:'\u200f'};
  function decodeEntities(text) {
    return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(original,entity)=>{
      if(entity[0]!=='#')return Object.hasOwn(entities,entity)?entities[entity]:original;
      const hex=entity[1].toLowerCase()==='x';
      const code=Number.parseInt(entity.slice(hex?2:1),hex?16:10);
      return code>0&&code<=0x10ffff&&(code<0xd800||code>0xdfff)?String.fromCodePoint(code):'\uFFFD';
    });
  }
  function readXml(raw) {
    if(!raw||/<!\s*(?:doctype|entity)\b/i.test(raw))return null;
    const document={children:[]},stack=[document];
    const tokens=raw.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[\w:.-]+(?:"[^"]*"|'[^']*'|[^<>"'])*>|[^<]+|</g);
    for(const [token] of tokens) {
      const parent=stack.at(-1);
      if(token.startsWith('<!--')||token.startsWith('<?'))continue;
      if(token.startsWith('<![CDATA[')) {parent.children.push(token.slice(9,-3));continue;}
      if(token[0]!=='<') {parent.children.push(decodeEntities(token));continue;}
      const tag=/^<(\/?)([\w:.-]+)([\s\S]*?)\s*(\/?)>$/.exec(token);
      if(!tag)return null;
      if(tag[1]){
        if(parent.name!==tag[2]||tag[3].trim()||tag[4])return null;
        stack.pop();
        continue;
      }
      const attributes=Object.create(null);
      for(const pair of tag[3].matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g))attributes[pair[1].toLowerCase()]=decodeEntities(pair[3]??pair[4]);
      const node={name:tag[2],local:tag[2].split(':').at(-1).toLowerCase(),attributes,children:[]};
      parent.children.push(node);
      if(!tag[4])stack.push(node);
      if(stack.length>64)return null;
    }
    const roots=document.children.filter(node=>typeof node!=='string');
    return stack.length===1&&roots.length===1?roots[0]:null;
  }
  function findQrcContent(node) {
    if(!node||typeof node==='string')return '';
    if(node.attributes.lyriccontent)return node.attributes.lyriccontent;
    for(const child of node.children) {
      const content=findQrcContent(child);
      if(content)return content;
    }
    return '';
  }
  function parseClock(value,{frameRate=30,subFrameRate=1,tickRate=1}={}) {
    const offset=/^(\d+(?:\.\d+)?)(ms|h|m|s|f|t)$/.exec(value||'');
    if(offset)return Number(offset[1])*{h:3600,m:60,s:1,ms:.001,f:1/frameRate,t:1/tickRate}[offset[2]];
    const clock=/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d+)|:(\d+)(?:\.(\d+))?)?$/.exec(value||'');
    if(!clock||Number(clock[2])>59||Number(clock[3])>59)return NaN;
    const time=Number(clock[1]||0)*3600+Number(clock[2])*60+Number(clock[3]);
    return time+(clock[4]?Number('0.'+clock[4]):0)+(Number(clock[5]||0)+Number(clock[6]||0)/subFrameRate)/frameRate;
  }
  function timedText(parts) {
    const characters=[],points=[];
    for(const part of parts) {
      let text=part.text.replace(/[\t\r\n ]+/g,' ');
      if(!characters.length||characters.at(-1)===' ')text=text.replace(/^ +/,'');
      if(!text)continue;
      const mark=part.mark,last=points.at(-1);
      if(mark&&(!last||mark.time!==last.time||mark.end!==last.end))points.push({index:characters.length,...mark});
      characters.push(...split(text).slice(0,180-characters.length));
      if(characters.length>=180)break;
    }
    const text=characters.join('').trimEnd(),length=split(text).length;
    return {text,points:points.filter(point=>point.index<length)};
  }
  function parseVtt(raw) {
    const blocks=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[ \t]*\n+/);
    if(!/^WEBVTT(?:[ \t]|\n|$)/.test(blocks[0]))return [];
    const rows=[];
    for(const block of blocks.slice(1)) {
      if(/^(?:NOTE(?:[ \t]|\n|$)|(?:STYLE|REGION)(?:\n|$))/.test(block))continue;
      const lines=block.split('\n');
      const pattern=/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/;
      const at=pattern.test(lines[0])?0:1;
      const cue=pattern.exec(lines[at]||'');
      if(!cue)continue;
      const timestamp=/^(?:\d{2,}:)?[0-5]\d:[0-5]\d\.\d{3}$/;
      if(!timestamp.test(cue[1])||!timestamp.test(cue[2]))continue;
      const time=parseClock(cue[1]),end=parseClock(cue[2]);
      if(!Number.isFinite(time)||!Number.isFinite(end)||end<=time)continue;
      const source=lines.slice(at+1).join(' ').replace(/<rt(?:\s[^>]*)?>[\s\S]*?<\/rt>/gi,'');
      const parts=[];
      let start=time,hasMarkers=false;
      for(const [token] of source.matchAll(/<[^<>]*>|[^<]+|</g)) {
        if(token[0]==='<'&&token.length>1) {
          const value=token.slice(1,-1),mark=timestamp.test(value)?parseClock(value):NaN;
          if(mark>start&&mark<end){start=mark;hasMarkers=true;}
        }else parts.push({text:decodeEntities(token),mark:{time:start}});
      }
      const row=timedText(parts);
      if(row.text)rows.push({time,end,...row,points:hasMarkers?row.points:[],order:rows.length});
      if(rows.length>=2500)break;
    }
    return orderedLines(rows);
  }
  function readTtml(root) {
    const rate=name=>Number(Object.entries(root.attributes).find(([key])=>key.split(':').at(-1)===name)?.[1]);
    const multiplier=Object.entries(root.attributes).find(([key])=>key.split(':').at(-1)==='frameratemultiplier')?.[1].split(/\s+/).map(Number);
    const scale=multiplier?.every(value=>Number.isFinite(value)&&value>0)&&multiplier.length===2?multiplier[0]/multiplier[1]:1;
    const frameRate=(rate('framerate')>0?rate('framerate'):30)*scale;
    const subFrameRate=rate('subframerate')||1;
    const clock={frameRate,subFrameRate,tickRate:rate('tickrate')||(rate('framerate')>0?frameRate*subFrameRate:1)};
    const apple=Object.keys(root.attributes).some(key=>key==='xmlns:itunes'||key.startsWith('itunes:'));
    const rows=[];

    function interval(node,parent,base) {
      const attributes=node.attributes;
      const toTime=value=>{
        const parsed=parseClock(value,clock);
        return Number.isFinite(parsed)?(apple&&value.includes(':')?parsed:base+parsed):NaN;
      };
      const begin=toTime(attributes.begin),stop=toTime(attributes.end),duration=parseClock(attributes.dur,clock);
      const time=Number.isFinite(begin)?Math.max(parent.time,begin):base;
      const hasEnd=Number.isFinite(stop)||Number.isFinite(duration);
      const end=Math.min(parent.end,Number.isFinite(stop)?stop:Number.isFinite(duration)?time+duration:parent.end);
      return {time,end,hasEnd,timed:Number.isFinite(begin)||hasEnd};
    }
    function children(node,range,visit) {
      let base=range.time;
      for(const child of node.children) {
        if(typeof child==='string'){visit(child,range);continue;}
        const next=interval(child,range,base);
        if(next.end<next.time)continue;
        visit(child,next);
        if(node.attributes.timecontainer==='seq'&&Number.isFinite(next.end))base=next.end;
      }
    }
    function walk(node,range) {
      if(typeof node==='string'||node.local==='head'||rows.length>=2500)return;
      if(node.local!=='p') {children(node,range,walk);return;}
      const parts=[],translations=[];
      function collect(child,childRange,mark,translation) {
        if(typeof child==='string') {
          (translation?translations:parts).push({text:child,mark});
          return;
        }
        const role=child.attributes['ttm:role']??child.attributes.role??'';
        const isTranslation=translation||/(?:^|[\s-])translat(?:ion|ed)(?:$|\s)/i.test(role);
        if(child.local==='br') {(isTranslation?translations:parts).push({text:' ',mark});return;}
        const ownMark=childRange.timed?{time:childRange.time,...(childRange.hasEnd?{end:childRange.end}:{})}:mark;
        children(child,childRange,(item,itemRange)=>collect(item,itemRange,ownMark,isTranslation));
      }
      children(node,range,(child,childRange)=>collect(child,childRange,undefined,false));
      const row=timedText(parts),translation=timedText(translations).text;
      if(row.text)rows.push({time:range.time,...(Number.isFinite(range.end)?{end:range.end}:{}),...row,...(translation?{translation}:{}),order:rows.length});
    }
    walk(root,interval(root,{time:0,end:Infinity},0));
    return orderedLines(rows);
  }
  function parseTtml(raw) {
    const xml=readXml(raw);
    return xml?.local==='tt'?readTtml(xml):[];
  }
  function classifySidecar(path) {
    const match=/^(.*)\.(lrc|yrc|krc|qrc|ttml|vtt)$/i.exec(String(path||'').replaceAll('\\','/').toLowerCase());
    if(!match||!match[1])return null;
    const rawStem=match[1];
    const suffix=/(?:[._ -])(?:translation|translate|translated|trans|tr|tl|zh(?:[-_](?:cn|tw|hans|hant))?|en(?:[-_](?:us|gb))?|ja|jp|ko|kr|chs|cht|翻[译譯]|譯詞|译词|译|譯)$/.exec(rawStem);
    const stem=suffix&&suffix.index>rawStem.lastIndexOf('/')+1?rawStem.slice(0,suffix.index):rawStem;
    return {stem,rawStem,format:match[2],translation:stem!==rawStem};
  }
  function mergeTranslations(lines, translatedLines) {
    if(!lines.length||!translatedLines.length)return lines;
    const matches=new Map();
    for(const translated of translatedLines) {
      if(!translated.text?.trim()||!Number.isFinite(translated.time))continue;
      let lower=0,upper=lines.length;
      while(lower<upper){const mid=(lower+upper)>>1;if(lines[mid].time<translated.time)lower=mid+1;else upper=mid;}
      const before=lines[lower-1],after=lines[lower];
      const useBefore=before&&(!after||translated.time-before.time<=after.time-translated.time);
      const index=useBefore?lower-1:lower;
      const distance=Math.abs(lines[index].time-translated.time);
      if(distance>.42||distance>=(matches.get(index)?.distance??Infinity))continue;
      const text=translated.text.trim();
      if(text!==lines[index].text)matches.set(index,{text,distance});
    }
    return matches.size?lines.map((line,index)=>matches.has(index)?{...line,translation:matches.get(index).text}:line):lines;
  }
  function collectSpans(line, end, explicit) {
    if(explicit&&!line.points?.length)return [];
    const characters=split(line.text);
    const cutoff=Number.isFinite(end)?end:line.end??line.time;
    const finish=Math.max(line.time+.01,Math.min(line.end??cutoff,cutoff));
    const marks=explicit?[]:[{index:0,time:line.time}];
    for(const point of line.points||[]) {
      const previous=marks.at(-1);
      if(!Number.isInteger(point.index)||point.index<(previous?.index??0)||point.index>characters.length||
         !Number.isFinite(point.time)||point.time<(previous?.time??line.time)||point.time>finish)continue;
      if(point.index===previous?.index)marks[marks.length-1]=point;
      else marks.push(point);
    }
    if (!marks.length) return [];
    if(marks.at(-1).index<characters.length)marks.push({index:characters.length,time:finish});
    return marks.slice(0,-1).map((mark,index)=>{
      const next=marks[index+1];
      const text=characters.slice(mark.index,next.index).join('');
      if (explicit) {
        const hasEnd=Number.isFinite(mark.end)&&mark.end>=mark.time;
        return {text,start:mark.time,end:hasEnd?mark.end:next.time,index:mark.index};
      }
      const stop=Math.max(mark.time+.01,Math.min(mark.end??next.time,finish));
      return {text,start:mark.time,end:stop};
    });
  }
  const wordSpans=(line,end)=>collectSpans(line,end,false);
  // Retain the exact source groups, including words spanning several Unicode code points.
  const timedSpans=(line,end)=>collectSpans(line,end,true);
  function progress(word,position) {
    if (word.end<=word.start) return position>=word.start?1:0;
    return Math.max(0,Math.min(1,(position-word.start)/(word.end-word.start)));
  }
  function glyphFlightProgress(unit, position, lineStart = -Infinity) {
    const duration = Math.min(.44, .24 + (unit.end - unit.start) * .34);
    const lead = Math.min(.10, duration * .23);
    const appear = Math.max(lineStart, unit.start - lead);
    const settle = unit.start + duration - lead;
    return Math.max(0,Math.min(1,(position - appear) / (settle - appear)));
  }
  function count(line,pos,end){
    const chars=split(line.text),length=chars.length;if(!length||pos<line.time)return 0;
    const spans=timedSpans(line,end);
    if(!spans.length)return length;
    let lit=0;
    for(const span of spans){
      if(pos<span.start)break;
      lit=span.index+split(span.text).length;
    }
    return lit;
  }
  return {parse,parseKrc,parseYrc,parseQrc,parseVtt,parseTtml,classifySidecar,mergeTranslations,wordSpans,timedSpans,progress,glyphFlightProgress,count,split};
});
