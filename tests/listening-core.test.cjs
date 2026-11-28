'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../outputs/listening-core.js');
const karaoke = require('../outputs/lyric-karaoke.js');
const backgrounds = require('../outputs/playback-backgrounds.js');

test('playback defaults to cover color without changing an established work color', () => {
  const saved = core.normalize({ color: 'amber' });
  assert.equal(saved.color, 'amber');
  assert.equal(saved.playbackColor, 'cover');
  assert.equal(core.normalize({ ...saved, playbackColor: 'ocean' }).playbackColor, 'ocean');
});

test('restores a web backdrop only for explicit HTTP(S) addresses without credentials', () => {
  assert.equal(core.normalize({stageEmbedUrl:'https://example.org/sky'}).stageEmbedUrl,'https://example.org/sky');
  for(const invalid of ['file:///C:/track.mp3','javascript:void(0)','https://name:password@example.org','/sky',null]){
    assert.equal(core.normalize({stageEmbedUrl:invalid}).stageEmbedUrl,'');
  }
});

test('only the automatic background lets the effect supply its full backdrop', () => {
  const treatment = (background, id) => backgrounds.lyricBackdrop(backgrounds.get(background), {id});
  assert.equal(treatment('default','tide'), 'theme');
  assert.equal(treatment('warm-white','tide'), 'soft');
  assert.equal(treatment('warm-white','still'), 'overlay');
  assert.equal(treatment('white-coast','paper'), 'soft');
  assert.equal(treatment('blue-rain','impact'), 'soft');
  assert.equal(treatment('clean','impact'), 'overlay');
  for (const id of ['geometry','mist','clean']) assert.equal(backgrounds.normalize(id), id);
});

test('individual glyphs take flight around their own onset, including a late syllable', () => {
  const [line] = karaoke.parseKrc('[1000,5200]<0,800,0>风<4200,600,0>来');
  const [first, last] = karaoke.timedSpans(line,7);
  assert.equal(karaoke.glyphFlightProgress(first,1.4),1);
  assert.equal(karaoke.glyphFlightProgress(last,5.1),0);
  assert.ok(karaoke.glyphFlightProgress(last,5.2)>0 && karaoke.glyphFlightProgress(last,5.2)<1);
  assert.equal(karaoke.glyphFlightProgress(last,5.55),1);
  assert.equal(karaoke.glyphFlightProgress(first,line.time,line.time),0);
  assert.ok(karaoke.glyphFlightProgress(first,line.time+.04,line.time)>0);
});

test('malformed persisted preferences recover without accepting unknown modes', () => {
  assert.deepEqual(core.normalize(null), core.defaults);
  const settings = core.normalize({ mode: 'script', background: 'geometry', response: Infinity, brightness: -30, desktopLyrics: 'false', energySaver: false });
  assert.equal(settings.mode, 'work');
  assert.equal(settings.brightness, 10);
  assert.equal(settings.response, 0);
  assert.equal(settings.desktopLyrics, true);
  assert.equal(settings.energySaver, false);
  assert.equal(settings.beatClock, true);
  assert.equal(core.normalize({ beatClock:false }).beatClock, false);
});

test('lyric lookup handles lead-in, exact boundaries, seeks and the final line', () => {
  const lines = [{ time: 4, text: 'one' }, { time: 9.5, text: 'two' }, { time: 16, text: 'three' }];
  assert.equal(core.lyricAt(lines, 0, 20).index, -1);
  assert.equal(core.lyricAt(lines, 9.5, 20).line.text, 'two');
  assert.equal(core.lyricAt(lines, 4, 20).end, 9.5);
  assert.equal(core.lyricAt(lines, 19, 20).end, 20);
  assert.equal(core.lyricAt(lines, 6, 20).index, 0);
  assert.equal(core.lyricAt([], 1, 20).line, null);
});

test('stage shots keep ordinary lines together and start a new composition at a refrain or rest', () => {
  const verse=[0,3,6,9,12,15].map(time=>({time,end:time+3}));
  const score=core.stageShots([...verse,{time:18,end:20,isChorus:true},{time:20,end:22,isChorus:true},{time:26,isChorus:true}]);
  assert.deepEqual(score.map(s=>s.section),[0,0,0,0,1,1,2,2,3]);
  assert.deepEqual(score.map(s=>s.row),[0,1,0,1,0,1,0,1,0]);
  assert.equal(score[7].start,18);
  const repeats=verse.map((line,i)=>({...line,isChorus:i%2===0}));
  assert.deepEqual(core.stageShots(repeats).map(s=>s.section),[0,0,0,0,1,1]);
  assert.equal(core.normalize({stageParticles:false}).stageStyle,'scene');
  assert.equal(core.normalize({stageParticles:true}).stageStyle,'particles');
  assert.equal(core.normalize({stageParticles:true,stageStyle:'flow'}).stageStyle,'flow');
  assert.equal(core.normalize({stageStyle:'groove'}).stageStyle,'groove');
  assert.equal(core.normalize({stageStyle:'trail'}).stageStyle,'trail');
  assert.equal(core.normalize({stageStyle:'dialogue'}).stageStyle,'dialogue');
  assert.equal(core.normalize({stageStyle:'fold'}).stageStyle,'dialogue');
});

test('explicit lyric gaps fade, clear and cue at the same positions after a seek', () => {
  const line = {time: 1.03, end: 5.85}, next = {time: 13.85};
  assert.equal(core.lyricGap(line, next, 5.8), null);
  const fade = core.lyricGap(line, next, 6.1);
  assert.equal(fade.phase, 'fade');
  assert.ok(fade.opacity > 0 && fade.opacity < 1);
  assert.deepEqual(core.lyricGap(line, next, 9), {phase: 'quiet', opacity: 0});
  const cue = core.lyricGap(line, next, 13.7);
  assert.equal(cue.phase, 'cue');
  assert.ok(cue.opacity > 0 && cue.opacity < 1);
  assert.equal(core.lyricGap(line, next, next.time), null);
  assert.deepEqual(core.lyricGap(line, next, 9), {phase: 'quiet', opacity: 0});
  assert.equal(core.lyricGap(line, {time: 6.25}, 6), null);
  assert.equal(core.lyricGap({time: 1.03}, next, 9), null);
  assert.equal(core.lyricGap(line, undefined, 9), null);
});

test('frame deadlines keep their cadence and skip missed frames', () => {
  assert.equal(core.nextFrameDeadline(0, 100, 50), 120);
  assert.equal(core.nextFrameDeadline(120, 124, 50), 140);
  assert.equal(core.nextFrameDeadline(140, 197, 50), 200);
  assert.equal(core.nextFrameDeadline(200, 199.6, 50), 220);
});

test('duet voices finish independently and share the next boundary for line-only lyrics', () => {
  const left={time:3,end:7.2,singer:'left'},right={time:4,end:9.2,singer:'right'};
  const timelines=core.duetTimelines([left,right,{time:10.5,singer:'center'}]);
  assert.equal(core.duetLineAt(timelines.left,3.8,18).line,left);
  assert.equal(core.duetLineAt(timelines.right,3.8,18),null);
  assert.equal(core.duetLineAt(timelines.left,4.7,18).end,7.2);
  assert.equal(core.duetLineAt(timelines.right,4.7,18).end,9.2);
  assert.equal(core.duetLineAt(timelines.left,7.8,18),null);
  assert.equal(core.duetLineAt(timelines.right,7.8,18).line,right);
  const lrc=core.duetTimelines([{time:3,singer:'left'},{time:3,singer:'right'},{time:10.5,singer:'center'}]);
  assert.equal(core.duetLineAt(lrc.left,4,18).end,10.5);
  assert.equal(core.duetLineAt(lrc.right,4,18).end,10.5);
});

test('hidden and occluded windows stop rendering, and power state sets the ceiling', () => {
  assert.equal(core.frameRate({ hidden: true }), 0);
  assert.equal(core.frameRate({ occluded: true }), 0);
  assert.equal(core.frameRate({ active: false }), 0);
  assert.equal(core.frameRate({ reduced: true }), 10);
  assert.ok(core.frameRate({ mode: 'work' }) < core.frameRate({ mode: 'listen' }));
  assert.equal(core.frameRate({ mode: 'work', energySaver: false, onBattery: true }), 24);
  assert.equal(core.frameRate({ mode: 'work', energySaver: false, onBattery: false }), 40);
  assert.equal(core.frameRate({ mode: 'listen', energySaver: false, onBattery: false }), 60);
  assert.equal(core.frameRate({ mode: 'listen', energySaver: false, onBattery: true }), 30);
  assert.equal(core.frameRate({ mode: 'listen', energySaver: true, onBattery: false }), 30, 'the saver still wins while it is on');
});

test('smoothing is independent of drawing frequency', () => {
  let slow = 0, fast = 0;
  for (let i = 0; i < 20; i++) slow = core.approach(slow, 1, 1 / 20);
  for (let i = 0; i < 60; i++) fast = core.approach(fast, 1, 1 / 60);
  assert.ok(Math.abs(slow - fast) < 1e-10);
});

test('KRC fill uses each word duration and leaves rests in the original timing', () => {
  const raw='[10000,3600]<0,800,0>夜<2400,420,0>色';
  const [line] = karaoke.parseKrc(raw);
  assert.deepEqual(karaoke.parse(raw),[line]);
  assert.deepEqual(karaoke.parse('[10000,3600]无时间标记'),[]);
  const [first, second] = karaoke.wordSpans(line, 16);
  assert.equal(line.text, '夜色');
  assert.equal(first.end, 10.8);
  assert.equal(second.start, 12.4);
  assert.ok(Math.abs(karaoke.progress(first, 10.4) - .5) < 1e-10);
  assert.equal(karaoke.progress(first, 11.6), 1);
  assert.equal(karaoke.progress(second, 11.6), 0);
});

test('UTF-8 YRC uses absolute word onsets and durations across long rests', () => {
  const raw = '\ufeff[12000,3700](12000,500,0)海(14825,600,0)面\r\n[20001,499](20001,499,0)光';
  const lines = karaoke.parseYrc(raw);
  assert.deepEqual(karaoke.parse(raw),lines);
  assert.deepEqual(lines.map(({time,end,text})=>[time,end,text]),[[12,15.7,'海面'],[20.001,20.5,'光']]);
  assert.deepEqual(karaoke.wordSpans(lines[0],lines[1].time),[
    {text:'海',start:12,end:12.5}, {text:'面',start:14.825,end:15.425},
  ]);
  const units = karaoke.timedSpans(lines[0],lines[1].time);
  assert.equal(karaoke.glyphFlightProgress(units[0],13.5),1);
  assert.equal(karaoke.glyphFlightProgress(units[1],13.5),0);
  assert.equal(karaoke.parse('[00:03.00]LRC\n[12000,3700]无逐字标记')[0].text,'LRC');
});

test('enhanced LRC ending marks and ordinary LRC use only their available timing', () => {
  const [timed] = karaoke.parse('[00:01.00]<00:01.00>音乐<00:02.50>');
  assert.deepEqual(karaoke.timedSpans(timed, 8), [{ text: '音乐', index: 0, start: 1, end: 2.5 }]);
  const [plain] = karaoke.parse('[00:03.00]Back in the night');
  assert.deepEqual(karaoke.timedSpans(plain, 7), []);
  assert.equal(karaoke.count(plain, 2.99, 7), 0);
  assert.equal(karaoke.count(plain, 3, 7), plain.text.length);
});

test('timed words retain original text and durations with no extra glyph onsets', () => {
  const [timed] = karaoke.parseKrc('[1000,5000]<0,1200,0>风与海 <1800,700,0>Stay! <4200,500,0>𠮷');
  const units = karaoke.timedSpans(timed,6);
  assert.equal(units.map(unit=>unit.text).join(''),timed.text);
  assert.deepEqual(units.map(({text,start,end,index})=>[text,start,end,index]), [
    ['风与海 ',1,2.2,0],['Stay! ',2.8,3.5,4],['𠮷',5.2,5.7,10],
  ]);
  assert.equal(karaoke.count(timed,1.05,6),4);
  const [prefix] = karaoke.parse('[00:02.00]风<00:02.80>与海<00:03.70>');
  assert.deepEqual(karaoke.timedSpans(prefix,8),[{text:'与海',index:1,start:2.8,end:3.7}]);
  const [closingOnly] = karaoke.parse('[00:02.00]风与海<00:03.70>');
  assert.deepEqual(karaoke.timedSpans(closingOnly,8),[]);
  assert.equal(core.normalize({lyricStyle:'fly'}).lyricStyle, 'fly');
});

test('playback detail follows CSS size at 1x and caps high DPI by pixel budget', () => {
  assert.equal(core.playbackRenderScale(1265,800,1,{energySaver:false}),1);
  assert.equal(core.playbackRenderScale(375,844,1,{energySaver:false,photo:true}),1);
  assert.equal(core.playbackRenderScale(1265,800,1,{energySaver:true}),.8);
  assert.equal(core.playbackRenderScale(1265,800,1,{energySaver:true,photo:true}),1);
  assert.equal(core.playbackRenderScale(375,844,3,{energySaver:false,photo:true}),1.6);
  const large=core.playbackRenderScale(3840,2160,2,{energySaver:false});
  assert.ok(Math.abs(large*large*3840*2160-4000000)<1);
});

test('photo crops keep one scale and preserve both existing background IDs', () => {
  const backgrounds=require('../outputs/playback-backgrounds.js');
  const image={naturalWidth:1536,naturalHeight:1024};
  for(const id of ['white-coast','blue-rain','jiangnan-rain']){
    const entry=backgrounds.get(id);
    assert.equal(backgrounds.normalize(id),id);
    assert.ok(entry.photo);
    for(const [width,height] of [[1265,800],[375,844]]){
      const rect=backgrounds.photoRect(entry,image,width,height);
      assert.equal(rect.width/rect.height,1.5);
      assert.ok(rect.x<=0&&rect.y<=0&&rect.width+rect.x>=width&&rect.height+rect.y>=height);
    }
  }
  assert.equal(backgrounds.catalogue.length,66);
  assert.equal(backgrounds.catalogue.filter(entry=>entry.group==='space').length,5);
});
