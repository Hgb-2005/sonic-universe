const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseMod}=require('../outputs/lyric-style-mods.js');
const sample=require('../outputs/assets/lyric-style-celadon.json');

test('version 2 accepts the bundled declarative composition and preserves layer order',()=>{
  const parsed=parseMod(sample);
  assert.equal(parsed.version,2);
  assert.deepEqual(parsed.layers.map(layer=>layer.shape),['glow','glow','ring','ring','disc','stripe']);
  assert.deepEqual(parsed.layers[0],{shape:'glow',x:70,y:65,width:115,height:105,color:'#3d847e',opacity:.58,angle:0,drift:true});
});

test('version 1 retains the existing layout-only settings',()=>{
  const parsed=parseMod({...sample,version:1});
  assert.equal(parsed.name,'青瓷');
  assert.equal(parsed.layout,'fly');
  assert.equal(parsed.layers,undefined);
});

test('version 2 rejects out-of-bounds compositions and executable or custom style fields',()=>{
  const [first]=sample.layers;
  assert.equal(parseMod({...sample,extra:'bad'}),null);
  assert.equal(parseMod({...sample,layers:[{...first,script:'alert(1)'}]}),null);
  assert.equal(parseMod({...sample,layers:[{...first,color:'url(//example.com)'}]}),null);
  assert.equal(parseMod({...sample,layers:[{...first,angle:'0; position: fixed'}]}),null);
  assert.equal(parseMod({...sample,layers:[{...first,opacity:.61}]}),null);
  assert.equal(parseMod({...sample,layers:[{...first,width:141}]}),null);
  assert.equal(parseMod({...sample,layers:Array(9).fill({...first,drift:false})}),null);
  assert.equal(parseMod({...sample,layers:[first,first,first]}),null);
  assert.equal(parseMod({...sample,layers:[null]}),null);
});
