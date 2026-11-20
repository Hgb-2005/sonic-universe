'use strict';

const {createHash,randomUUID}=require('node:crypto');
const {createWriteStream}=require('node:fs');
const {rename,unlink}=require('node:fs/promises');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

const repository = 'https://github.com/Hgb-2005/sonic-universe';
const endpoint = 'https://api.github.com/repos/Hgb-2005/sonic-universe/releases/latest';
const versionParts = value => /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(value || '')?.slice(1).map(Number);

function updateFor(release,current){
  if(release?.draft||release?.prerelease)return null;
  const next=versionParts(release?.tag_name), here=versionParts(current);
  if(!next||!here)return null;
  const first=next.findIndex((part,index)=>part!==here[index]);
  if(first<0||next[first]<here[first])return null;
  const version=next.join('.'),tag='v'+version;
  const filename=`Sonic-Universe-${version}-x64.exe`;
  if(release.tag_name!==tag||!Array.isArray(release.assets))return null;
  const asset=release.assets.find(item=>item?.name===filename&&item.state==='uploaded'&&Number.isSafeInteger(item.size)&&item.size>0&&item.size<2*1024*1024*1024);
  if(!asset)return null;
  const installer=/^sha256:[a-f0-9]{64}$/.test(asset.digest||'')?{filename,size:asset.size,digest:asset.digest.slice(7),url:`${repository}/releases/download/${tag}/${filename}`}:null;
  return {version,url:`${repository}/releases/tag/${tag}`,installer};
}

async function downloadUpdate(fetch,installer,target){
  const signal=AbortSignal.timeout(300000);
  const response=await fetch(installer.url,{signal,credentials:'omit'});
  const source=new URL(response.url||installer.url);
  if(!response.ok||!response.body||source.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(source.hostname))throw Error('下载未完成，请重试。');
  const temporary=`${target}.${randomUUID()}.partial`;
  const hash=createHash('sha256');let size=0;
  const checksum=new Transform({transform(chunk,_encoding,callback){
    size+=chunk.length;
    if(size>installer.size){callback(Error('更新包大小与发布记录不一致。'));return;}
    hash.update(chunk);callback(null,chunk);
  }});
  try{
    await pipeline(Readable.fromWeb(response.body),checksum,createWriteStream(temporary,{flags:'wx'}),{signal});
    if(size!==installer.size||hash.digest('hex')!==installer.digest)throw Error('更新包校验失败，请重新下载。');
    await rename(temporary,target);
  }finally{await unlink(temporary).catch(()=>{});}
}

function createReleaseCheck(fetch,current){
  let last,checkedAt=0,pending;
  return function check(){
    if(last&&Date.now()-checkedAt<300000)return Promise.resolve(last);
    if(pending)return pending;
    pending=(async()=>{
      try{
        const response=await fetch(endpoint,{redirect:'error',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(6500)});
        if(!response.ok)throw Error('GitHub Releases unavailable');
        last={available:updateFor(await response.json(),current),current};checkedAt=Date.now();return last;
      }catch{return {available:null,current,error:'暂时无法检查更新，请稍后再试。'};}
    })().finally(()=>pending=null);
    return pending;
  };
}

module.exports={updateFor,createReleaseCheck,downloadUpdate};
