'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../outputs'),file=path.join(root,'index.html');
const source=fs.readFileSync(file,'utf8');
const revision=asset=>crypto.createHash('sha256').update(asset.endsWith('.webp')?fs.readFileSync(path.join(root,asset)):fs.readFileSync(path.join(root,asset),'utf8').replace(/\r\n/g,'\n')).digest('hex').slice(0,12);
const updated=source.replace(/(\b(?:src|href|data-[\w-]+)="\.\/((?:assets\/)?[\w.-]+\.(?:js|css|webp))\?v=)[^"\s]+/g,(_match,prefix,asset)=>prefix+revision(asset))
  .replace(/(<meta name="sonic-project-pack-revision" content=")[^"]+/,(_match,prefix)=>prefix+revision('project-pack.js'))
  .replace(/(<meta name="sonic-file-tags-revision" content=")[^"]+/,(_match,prefix)=>prefix+revision('local-file-tags.js'));
if(process.argv.includes('--check')){if(source!==updated){console.error('Asset revisions are stale. Run node scripts/stamp-assets.cjs');process.exitCode=1;}}
else if(source!==updated){fs.writeFileSync(file,updated);console.log('Listening room asset revisions updated.');}
