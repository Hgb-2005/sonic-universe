(function (root, factory) {
  const scenes = factory();
  if (typeof module === 'object' && module.exports) module.exports = scenes;
  else root.SonicReactiveScenes = scenes;
})(globalThis, function () {
  'use strict';

  const catalogue = Object.freeze([
    { id:'listening-hall', name:'折光厅', group:'光影', description:'暖光穿过石廊，细尘在斜光中缓慢浮动' },
    { id:'sleeve-wash', name:'封套余色', group:'光影', description:'唱片封面的色彩映在纸套与黑胶唱盘上' },
    { id:'coast-radio', name:'海岬电台', group:'风景', description:'傍晚的海岸插画，亮着灯的电台看向远海' },
    { id:'moon-silk', name:'月纱', group:'光影', description:'月夜芒草随风轻摆，远处山脊沉在薄雾里' },
    { id:'view-port', name:'取景窗', group:'空间', description:'从夜行列车看窗外雪山，也可嵌入自己的网页' },
    { id:'quiet-sky', name:'深空留白', group:'空间', description:'银河铺在火山剪影背后，几颗星缓缓明灭' },
    { id:'pure-black', name:'纯黑', group:'空间', description:'整块舞台使用纯黑底色' },
    { id:'jiangnan-rain', name:'烟雨江南', group:'风景', description:'山岚、雨丝与水面涟漪' },
  ].map(Object.freeze));
  const byId = new Map(catalogue.map(scene => [scene.id, scene]));
  const families = {
    calm:['jiangnan-rain','quiet-sky','coast-radio'],
    flow:['listening-hall','sleeve-wash','coast-radio'],
    energetic:['sleeve-wash','listening-hall','moon-silk'],
  };
  const unit = value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

  function seedFor(value) {
    let seed = 2166136261;
    for (const glyph of String(value ?? '')) seed = Math.imul(seed ^ glyph.codePointAt(0), 16777619);
    return seed >>> 0;
  }

  function normalizeSelection(id) { return byId.has(id) ? id : 'auto'; }

  function createDirector() {
    let trackId, seed, family, candidate, candidateTime, sceneTime, energy, scene;
    let theme, recent, sectionChange=0, pending, lastBar=null, lastPosition;
    function choose(nextFamily) {
      const pool = families[nextFamily];
      return pool[((seedFor(nextFamily) ^ seed) >>> 0) % pool.length];
    }

    return {
      update({ track, selected, active, elapsed, sound, position }) {
        if (track !== trackId || !scene) {
          trackId = track;
          seed = seedFor(track);
          family = 'flow';
          candidate = null;
          candidateTime = sceneTime = energy = 0;
          scene = 'listening-hall';
          theme=recent=null;sectionChange=0;pending=null;lastBar=null;lastPosition=undefined;
        }
        if (byId.has(selected)) return selected;
        if (!active) return scene;

        const dt = Math.min(.2, Math.max(0, elapsed));
        if(Number.isFinite(position)){if(Number.isFinite(lastPosition)&&Math.abs(position-lastPosition)>1.5){theme=recent=null;pending=null;sectionChange=0;lastBar=null;}lastPosition=position;}
        const target = unit(sound?.presence) * .58 + unit(sound?.bass) * .32 + unit(sound?.high) * .10;
        const bands=[unit(sound?.bass),unit(sound?.mid),unit(sound?.high)];
        const total=bands.reduce((sum,band)=>sum+band,0);
        for(let index=0;index<bands.length;index++)bands[index]/=Math.max(.12,total);
        if(!theme||!recent){theme=bands.slice();recent=bands.slice();}
        let contrast=0;
        for(let index=0;index<bands.length;index++){
          recent[index]+=(bands[index]-recent[index])*(1-Math.exp(-dt/.65));
          theme[index]+=(bands[index]-theme[index])*(1-Math.exp(-dt/10));
          contrast+=Math.abs(recent[index]-theme[index]);
        }
        energy += (target - energy) * (1 - Math.exp(-dt / 2.6));
        sceneTime += dt;
        const next = energy < (family === 'calm' ? .29 : .21) ? 'calm' :
          energy > (family === 'energetic' ? .43 : .51) ? 'energetic' : 'flow';
        if (next !== candidate) { candidate = next; candidateTime = 0; }
        candidateTime += dt;
        sectionChange=total>.24&&contrast>.48?sectionChange+dt:0;
        if(!pending&&((next!==family&&sceneTime>=18&&candidateTime>=3.5)||(sceneTime>=12&&sectionChange>=1.5))){
          const pool=families[next];
          let targetScene=choose(next);
          if(next===family || targetScene===scene)targetScene=pool[(pool.indexOf(scene)+1)%pool.length];
          pending={family:next,scene:targetScene,age:0};
        }
        const bar=sound?.beat?.locked?sound.beat.bar:null;
        const barBoundary=bar!==null&&(lastBar!==null&&bar>lastBar||sound.beat.barPhase<.03);
        lastBar=bar;
        if(pending){
          pending.age+=dt;
          if(barBoundary||bar===null&&pending.age>=.25||pending.age>=3.5){
            family=pending.family;scene=pending.scene;pending=null;sceneTime=0;sectionChange=0;theme=recent.slice();
          }
        }
        return scene;
      },
    };
  }

  function createJiangnanDirector() {
    let trackId, lastPosition, level, baseline, phase, candidate, held, wait, bar, rain, swell;
    return function update({track,position,duration,elapsed,sound}){
      const dt=Math.min(.1,Math.max(0,elapsed||0)), time=Number.isFinite(position)?position:0;
      const strength=unit(sound?.presence)*.58+unit(sound?.mid)*.24+unit((sound?.rms||0)*9)*.18;
      const introEnd=Math.min(9,Math.max(2.5,(duration||90)*.085));
      if(track!==trackId||!Number.isFinite(lastPosition)||Math.abs(time-lastPosition)>1.5){
        trackId=track;level=baseline=strength;phase=time<introEnd?0:1;
        candidate=phase;held=wait=0;bar=null;rain=phase*.7;swell=0;
      }
      lastPosition=time;
      level+=(strength-level)*(1-Math.exp(-dt/1.15));
      baseline+=(strength-baseline)*(1-Math.exp(-dt/11));
      const quiet=level<.13,tail=duration>0&&time>duration*.82&&quiet;
      const rising=level>Math.max(.35,baseline+.105)||(phase===2&&level>Math.max(.27,baseline-.055));
      const target=time<introEnd||tail||(phase===0&&quiet)?0:rising&&time>introEnd+3?2:1;
      if(candidate!==target){candidate=target;held=wait=0;}
      held+=dt;
      const beat=sound?.beat?.locked?sound.beat:null;
      const boundary=beat&&(bar!==null&&beat.bar!==bar||beat.barPhase<.035);
      bar=beat?.bar??null;
      if(phase!==candidate&&held>=(candidate===2?2.35:1.4)){
        wait+=dt;
        if(!beat||boundary||wait>=2.6){phase=candidate;wait=0;}
      }
      rain+=([.12,.7,.82][phase]-rain)*(1-Math.exp(-dt/1.45));
      swell+=((phase===2?1:0)-swell)*(1-Math.exp(-dt/1.65));
      return {phase,rain,swell};
    };
  }

  function draw(context, id, frame) {
    if (id === 'pure-black') {
      context.save();
      context.fillStyle = '#000';
      context.fillRect(0, 0, frame.width, frame.height);
      context.restore();
      return true;
    }
    const painter = globalThis.SonicStageBackdrops?.[id] || globalThis.SonicReactiveBloom?.[id] || globalThis.SonicReactiveLandscapes?.[id] || globalThis.SonicReactiveNeon?.[id];
    if (typeof painter !== 'function') return false;
    context.save();
    try { painter(context, frame); }
    finally { context.restore(); }
    return true;
  }

  return Object.freeze({ catalogue, get: id => byId.get(id), normalizeSelection, createDirector, createJiangnanDirector, seedFor, draw });
});
