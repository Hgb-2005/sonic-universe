const assert=require('node:assert/strict');
require('../outputs/flight-core.js');
const C=SonicFlightCore;
assert.equal(C.DURATION,60);assert.ok(C.totalRings>55);
for(const event of C.chart){assert.ok(event.time>=0&&event.time<60);assert.ok(event.lane>=0&&event.lane<=2);if(event.type==='rock')assert.ok(C.chart.some(r=>r.type==='ring'&&r.time===event.time&&r.lane!==event.lane));}
const perfect=C.createRun();for(const event of C.chart){if(event.type==='ring')C.move(perfect,event.lane,event.time-.25);C.advance(perfect,event.time);}C.advance(perfect,60);
assert.equal(perfect.perfect,C.totalRings);assert.equal(perfect.collisions,0);assert.equal(C.result(perfect).grade,'S');assert.equal(C.result(perfect).accuracy,100);
const coarse=C.createRun();const fine=C.createRun();for(const event of C.chart.filter(e=>e.type==='ring')){const t=event.time-.22;C.move(coarse,event.lane,t);while(fine.time<t-.02&&!fine.ended)C.advance(fine,fine.time+.017);C.move(fine,event.lane,t);}C.advance(coarse,60);C.advance(fine,60);assert.deepEqual(C.result(coarse),C.result(fine));
const fail=C.createRun();for(const event of C.chart.filter(e=>e.type==='ring')){C.move(fail,(event.lane+1)%3,event.time-.25);C.advance(fail,event.time);if(fail.ended)break;}assert.equal(fail.energy,0);assert.equal(fail.reason,'energy');assert.equal(C.result(fail).grade,'D');const score=fail.score;C.move(fail,1,60);assert.equal(fail.score,score);
const late=C.createRun();C.move(late,0,3);assert.equal(late.perfect,1);assert.equal(late.movement.to,0);C.advance(late,1);assert.equal(late.time,3);
const timing=C.createRun();C.move(timing,0,2.5-C.MOVE_TIME*.5);C.advance(timing,2.5);assert.equal(timing.misses,1);assert.equal(timing.combo,0);
console.log('PASS fixed chart, no unavoidable ring/rock pairs, full S run, framerate-independent judgment, no retroactive hits, energy failure and immutable finished runs', {rings:C.totalRings,events:C.chart.length,perfectScore:perfect.score});
assert.equal(perfect.score,12780,'v12 challenge records keep their original scoring');
for(const name of ['casual','challenge','tutorial']){
 const rules=C.modes[name],run=C.createRun(name);
 assert.equal(rules.totalRings,rules.chart.filter(e=>e.type==='ring').length);
 assert.ok(Object.isFrozen(rules.chart));
 for(let i=0;i<rules.chart.length;i++){
  const e=rules.chart[i];assert.ok(Object.isFrozen(e));assert.ok(e.time>0&&e.time<rules.duration);assert.ok(i===0||e.time>=rules.chart[i-1].time);
  if(e.type==='rock')assert.ok(rules.chart.some(r=>r.type==='ring'&&r.time===e.time&&r.lane!==e.lane));
  if(e.type==='ring')C.move(run,e.lane,e.time-.25);C.advance(run,e.time);
 }
 C.advance(run,rules.duration);assert.equal(run.perfect,rules.totalRings);assert.equal(run.collisions,0);assert.equal(run.reason,'complete');assert.equal(C.result(run).grade,'S');assert.equal(run.collected.length,rules.totalRings);
 const snapshot=JSON.stringify(run);C.move(run,2,rules.duration+10);C.advance(run,NaN);assert.equal(JSON.stringify(run),snapshot);
}
const relaxed=C.createRun('casual');
for(const e of C.modes.casual.chart.filter(e=>e.type==='ring')){C.move(relaxed,(e.lane+1)%3,e.time-.25);C.advance(relaxed,e.time);}
C.advance(relaxed,60);assert.equal(relaxed.energy,0);assert.equal(relaxed.misses,45);assert.equal(relaxed.reason,'complete');assert.equal(relaxed.collected.length,0);
const practice=C.createRun('tutorial');C.advance(practice,15);assert.equal(practice.energy,100);assert.equal(practice.reason,'complete');assert.equal(practice.collected.length,2);
for(const invalid of ['bogus','toString','__proto__',null,undefined])assert.equal(C.createRun(invalid).mode,'challenge');
const wider=C.createRun('casual'),narrower=C.createRun('challenge');
for(const r of [wider,narrower]){r.movement={from:1.52,to:1.52,at:0};C.advance(r,2.5);}
assert.equal(wider.good,1);assert.equal(narrower.misses,1);
console.log('PASS both difficulty charts, preserved challenge score, safe tutorial, wider casual judgment, zero-energy casual completion, collected lessons and invalid-mode fallback');
