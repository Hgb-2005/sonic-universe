(function (root, factory) {
  const scenes = factory();
  if (typeof module === 'object' && module.exports) module.exports = scenes;
  else root.SonicReactiveScenes = scenes;
})(globalThis, function () {
  'use strict';

  const catalogue = Object.freeze([
    { id:'prism-bloom', name:'绮光棱镜', group:'赛博', description:'立体粒子在棱镜、花瓣与螺旋之间流动' },
    { id:'jiangnan-rain', name:'烟雨江南', group:'山水', description:'山岚、雨丝与水面涟漪' },
    { id:'jade-current', name:'青玉潮汐', group:'山水', description:'青绿水纹随低音舒展' },
    { id:'amber-dunes', name:'金色沙海', group:'山水', description:'夕照下层叠起伏的沙丘' },
    { id:'violet-aurora', name:'暮紫极光', group:'氛围', description:'紫色光带随音色流动' },
    { id:'orbit-particles', name:'星尘轨道', group:'氛围', description:'星尘绕行，重拍推开轨道' },
    { id:'signal-wave', name:'声纹绸带', group:'氛围', description:'实时频谱编织成多层光带' },
    { id:'neon-grid', name:'赛博夜航', group:'赛博', description:'霓虹网格与频谱天际线' },
    { id:'prism-tunnel', name:'棱镜隧道', group:'赛博', description:'层叠棱镜随节拍推进' },
    { id:'silkscreen', name:'丝网印刷', group:'图形', description:'暖色纸面上的网点与错版色块' },
    { id:'lantern-windows', name:'纸灯走廊', group:'图形', description:'一列纸灯随高低音依次透亮' },
    { id:'tide-dial', name:'潮汐仪盘', group:'图形', description:'圆盘刻度与游标跟随频谱展开' },
  ].map(Object.freeze));
  const byId = new Map(catalogue.map(scene => [scene.id, scene]));
  const families = {
    calm:['jiangnan-rain','jade-current','amber-dunes'],
    flow:['prism-bloom','violet-aurora','orbit-particles'],
    energetic:['prism-bloom','neon-grid','prism-tunnel'],
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
          scene = 'prism-bloom';
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
          const targetScene=next===family?(scene==='silkscreen'?'lantern-windows':scene==='lantern-windows'?'tide-dial':'silkscreen'):choose(next);
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

  function draw(context, id, frame) {
    const painter = globalThis.SonicReactiveBloom?.[id] || globalThis.SonicReactiveLandscapes?.[id] || globalThis.SonicReactiveNeon?.[id];
    if (typeof painter !== 'function') return false;
    context.save();
    try { painter(context, frame); }
    finally { context.restore(); }
    return true;
  }

  return Object.freeze({ catalogue, get: id => byId.get(id), normalizeSelection, createDirector, seedFor, draw });
});
