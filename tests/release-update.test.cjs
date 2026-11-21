'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { createHash }=require('node:crypto');
const { mkdtemp,readFile,readdir,unlink,rmdir,writeFile }=require('node:fs/promises');
const { tmpdir }=require('node:os');
const { join }=require('node:path');
const { updateFor,downloadUpdate }=require('../desktop/release-update.cjs');

const bytes=Buffer.from('new installer test data');
const digest=createHash('sha256').update(bytes).digest('hex');
const asset={name:'Sonic-Universe-0.40.1-x64.exe',size:bytes.length,state:'uploaded',digest:'sha256:'+digest,browser_download_url:'https://invalid.example/elsewhere.exe'};
const release={tag_name:'v0.40.1',assets:[asset]};

test('the desktop selects a newer stable release and constructs a fixed repository download URL',()=>{
  const update=updateFor(release,'0.40.0');
  assert.equal(update.version,'0.40.1');
  assert.equal(update.installer.digest,digest);
  assert.match(update.installer.url,/^https:\/\/github\.com\/Hgb-2005\/sonic-universe\/releases\/download\/v0\.40\.1\//);
  assert.equal(updateFor({...release,prerelease:true},'0.40.0'),null);
  assert.equal(updateFor(release,'0.40.1'),null);
  assert.equal(updateFor({...release,assets:[{...asset,digest:null}]},'0.40.0').installer,null);
});

test('a desktop preview can update to the matching stable version but cannot downgrade',()=>{
  assert.equal(updateFor(release,'0.40.1-preview.1')?.version,'0.40.1');
  assert.equal(updateFor(release,'0.40.0-preview.2')?.version,'0.40.1');
  assert.equal(updateFor(release,'0.40.2-preview.1'),null);
  assert.equal(updateFor({...release, tag_name:'v0.40.1-preview.2', prerelease:true},'0.40.1-preview.1'),null);
});

test('an update download checks size and checksum before replacing the selected file',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sonic-update-test-'));
  const file=join(directory,asset.name), installer=updateFor(release,'0.40.0').installer;
  try{
    await writeFile(file,'existing file');
    await assert.rejects(downloadUpdate(async()=>new Response(Buffer.alloc(bytes.length)),installer,file),/校验失败/);
    assert.equal(await readFile(file,'utf8'),'existing file');
    assert.deepEqual(await readdir(directory),[asset.name]);
    await downloadUpdate(async()=>new Response(bytes),installer,file);
    assert.deepEqual(await readFile(file),bytes);
  }finally{await unlink(file);await rmdir(directory);}
});
