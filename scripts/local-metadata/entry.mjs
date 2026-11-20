import {parseBlob, selectCover} from 'music-metadata';

const imageFormats = new Set(['image/jpeg','image/png','image/webp']);
const clean = value => typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,200) : '';

function coverData(picture) {
  if (!picture?.data?.length || picture.data.length>2*1024*1024 || !imageFormats.has(picture.format)) return Promise.resolve(null);
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(typeof reader.result==='string'?reader.result:null);
    reader.onerror=()=>resolve(null);
    reader.readAsDataURL(new Blob([picture.data],{type:picture.format}));
  });
}

async function read(file) {
  const {common}=await parseBlob(file,{duration:false});
  const lyrics=(common.lyrics||[]).map(item=>typeof item==='string'?item:item?.text).filter(text=>typeof text==='string');
  return {
    title:clean(common.title),artist:clean(common.artist),album:clean(common.album),
    cover:await coverData(selectCover(common.picture)),
    lyrics:lyrics.find(text=>/\[\d{1,3}:\d{1,2}/.test(text))?.slice(0,250000)||'',
  };
}

globalThis.SonicFileTags=Object.freeze({read});
