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
