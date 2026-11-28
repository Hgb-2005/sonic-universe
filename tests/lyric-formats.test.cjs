const assert = require('node:assert/strict');
const test = require('node:test');
const lyrics = require('../outputs/lyric-karaoke.js');

test('plain QRC reads suffix word markers and XML wrappers without changing speech intervals',()=>{
  const raw='[7000,1500]明(7000,240)月 (acoustic)(7600,690)';
  const [line]=lyrics.parse(raw);
  assert.deepEqual(lyrics.timedSpans(line,9),[
    {text:'明',index:0,start:7,end:7.24},
    {text:'月 (acoustic)',index:1,start:7.6,end:8.29},
  ]);
  const xml=`<?xml version="1.0"?><QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="${raw}&#10;[12000,500]远(12000,460)"/></LyricInfo></QrcInfos>`;
  assert.deepEqual(lyrics.parse(xml).map(({time,text})=>[time,text]),[[7,'明月 (acoustic)'],[12,'远']]);
  assert.deepEqual(lyrics.parseQrc('VGhpcyBpcyBub3QgYSBseXJpYw=='),[]);
});

test('WebVTT supports labeled cues, cue settings, formatting and real inline timestamps',()=>{
  const raw='\ufeffWEBVTT\r\n\r\nNOTE explanation\r\n00:00.000 --> 00:03.000\r\nignored\r\n\r\nword-1\r\n00:07.000 --> 00:08.600 line:87%\r\n<v Singer><b>月</b><00:07.500>&amp; 海</v>\r\n\r\n00:09.000 --> 00:10.000\r\n<ruby>光<rt>ひかり</rt></ruby>\r\n';
  const [timed,plain]=lyrics.parse(raw);
  assert.equal(timed.text,'月& 海');
  assert.deepEqual(lyrics.timedSpans(timed,9),[
    {text:'月',index:0,start:7,end:7.5},{text:'& 海',index:1,start:7.5,end:8.6},
  ]);
  assert.equal(plain.text,'光');
  assert.deepEqual(lyrics.timedSpans(plain,10),[]);
});

test('TTML reads relative word timing, nested formatting and translated text',()=>{
  const raw='<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="1s"><p begin="3s" end="5s"><span begin="200ms" dur="400ms"><span>月</span></span><span begin="0.8s">海</span><span begin="1.5s">光</span><span role="x-translation">Sea &amp; moon</span></p></div></body></tt>';
  const [line]=lyrics.parse(raw);
  assert.equal(line.time,4);
  assert.equal(line.end,6);
  assert.equal(line.text,'月海光');
  assert.equal(line.translation,'Sea & moon');
  assert.deepEqual(lyrics.timedSpans(line,6),[
    {text:'月',index:0,start:4.2,end:4.6000000000000005}, {text:'海',index:1,start:4.8,end:5.5}, {text:'光',index:2,start:5.5,end:6},
  ]);
});

test('Apple TTML absolute clocks, SMPTE-style frame clocks and rejection of XML declarations',()=>{
  const apple='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><body><div><p begin="00:01.250" end="00:02.000"><span begin="00:01.300" end="00:01.650">心</span><span begin="00:01.700" end="00:02.000">潮</span></p></div></body></tt>';
  const [appleLine]=lyrics.parseTtml(apple);
  assert.equal(appleLine.time,1.25);
  assert.equal(appleLine.points[0].time,1.3);
  const [frameLine]=lyrics.parseTtml('<tt xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25"><body><p begin="00:00:10:05" dur="20f">海</p></body></tt>');
  assert.equal(frameLine.time,10.2);
  assert.equal(frameLine.end,11);
  assert.deepEqual(lyrics.parse('<!DOCTYPE tt [<!ENTITY bad SYSTEM "file:///sensitive">]><tt><body><p begin="0s">&bad;</p></body></tt>'),[]);
  assert.deepEqual(lyrics.parse('<tt><body><p begin="0s">Bad nesting</tt>'),[]);
});

test('two explicit voices survive one timestamp and can each carry a translation',()=>{
  const lines=lyrics.parse('[00:03.00]甲：我走过旧桥\n[00:03.00]乙：我在桥边等你\n[00:08.00]合唱：一起回家');
  const translated=lyrics.parse('[00:03.00]甲：I crossed the bridge\n[00:03.00]乙：I am waiting by the bridge');
  assert.deepEqual(lines.map(row=>row.singer),['left','right','center']);
  assert.deepEqual(lyrics.mergeTranslations(lines,translated).map(row=>row.translation),[
    'I crossed the bridge','I am waiting by the bridge',undefined
  ]);
  assert.deepEqual(lyrics.parse('[00:03.00]旧句\n[00:03.00]新句').map(row=>row.text),['新句']);
});

test('translation sidecar candidates retain their directory and only nearby timestamps attach',()=>{
  assert.deepEqual(lyrics.classifySidecar('Album\\歌.ZH-cn.LRC'),{stem:'album/歌',rawStem:'album/歌.zh-cn',format:'lrc',translation:true});
  assert.deepEqual(lyrics.classifySidecar('Album/歌.ttml'),{stem:'album/歌',rawStem:'album/歌',format:'ttml',translation:false});
  assert.deepEqual(lyrics.classifySidecar('Auld Lang Syne.t.lrc'),{stem:'auld lang syne',rawStem:'auld lang syne.t',format:'lrc',translation:true});
  assert.equal(lyrics.classifySidecar('Album/歌.mp3'),null);
  const source=lyrics.parse('[00:01.00]远方\n[00:04.00]星海\n[00:05.00]故事');
  const translation=lyrics.parse('[00:01.06]Far away\n[00:01.20]Too far\n[00:04.30]Starlight\n[00:06.90]unrelated');
  const merged=lyrics.mergeTranslations(source,translation);
  assert.deepEqual(merged.map(line=>line.translation),['Far away','Starlight',undefined]);
  assert.equal(merged[2],source[2]);
  assert.equal(source[0].translation,undefined);
});
