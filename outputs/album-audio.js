(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SonicAlbumAudio=api;
})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  async function layout(blob){
    if(!(blob instanceof Blob)||blob.size<44||blob.size>128*1024*1024)return null;
    const view=new DataView(await blob.slice(0,65536).arrayBuffer());
    if(view.getUint32(0)!==0x52494646||view.getUint32(8)!==0x57415645)return null;
    let format;
    for(let offset=12;offset+8<=view.byteLength;){
      const tag=view.getUint32(offset), size=view.getUint32(offset+4,true), start=offset+8;
      if(start+size>blob.size)return null;
      if(tag===0x666d7420&&size===16&&start+size<=view.byteLength){
        const code=view.getUint16(start,true),channels=view.getUint16(start+2,true),rate=view.getUint32(start+4,true);
        const bytesPerSecond=view.getUint32(start+8,true),block=view.getUint16(start+12,true),bits=view.getUint16(start+14,true);
        if(code!==1||channels<1||rate<1||![8,16,24,32].includes(bits)||block!==channels*bits/8||bytesPerSecond!==rate*block)return null;
        format={channels,rate,bits,block,bytesPerSecond,raw:blob.slice(start,start+16)};
      }
      if(tag===0x64617461){
        return format&&size&&size%format.block===0
          ?{...format,data:blob.slice(start,start+size),duration:size/format.bytesPerSecond}:null;
      }
      offset=start+size+(size%2);
    }
    return null;
  }
  function waveHeader(size){
    const header=new DataView(new ArrayBuffer(44));
    header.setUint32(0,0x52494646);header.setUint32(4,36+size+(size%2),true);
    header.setUint32(8,0x57415645);header.setUint32(12,0x666d7420);header.setUint32(16,16,true);
    header.setUint32(36,0x64617461);header.setUint32(40,size,true);
    return header;
  }
  function joinWave(a,b){
    if(a.channels!==b.channels||a.rate!==b.rate||a.bits!==b.bits)return null;
    const size=a.data.size+b.data.size, pad=size%2;
    const header=waveHeader(size);
    const parts=[header.buffer.slice(0,20),a.raw,header.buffer.slice(36),a.data,b.data];
    if(pad)parts.push(new Uint8Array(1));
    return {blob:new Blob(parts,{type:'audio/wav'}),first:a.duration,second:b.duration};
  }
  // Only join compressed recordings whose decoded samples can be checked against
  // their native stream metadata, including the MP3 encoder delay and padding.
  function mp3Layout(view){
    const head=view.getUint32(0);
    const version=(head>>>19)&3,layer=(head>>>17)&3,rateIndex=(head>>>10)&3,bitrate=(head>>>12)&15;
    if((head>>>21)!==2047||version===1||layer!==1||rateIndex===3||bitrate===0||bitrate===15)return null;
    const channels=(head>>>6&3)===3?1:2;
    const rate=[44100,48000,32000][rateIndex]/(version===3?1:version===2?2:4);
    const sideBytes=version===3?(channels===1?17:32):(channels===1?9:17);
    const xing=4+sideBytes+(head&0x10000?0:2);
    if(view.byteLength<xing+12||![0x58696e67,0x496e666f].includes(view.getUint32(xing)))return null;
    const flags=view.getUint32(xing+4);
    if(!(flags&1))return null;
    const frames=view.getUint32(xing+8);
    const encoder=xing+12+(flags&2?4:0)+(flags&4?100:0)+(flags&8?4:0);
    if(view.byteLength<encoder+24||![0x4c414d45,0x4c617663,0x4c617666].includes(view.getUint32(encoder)))return null;
    const middle=view.getUint8(encoder+22);
    const delay=(view.getUint8(encoder+21)<<4)|(middle>>>4);
    const padding=((middle&15)<<8)|view.getUint8(encoder+23);
    const samples=frames*(version===3?1152:576)-delay-padding;
    return delay>0&&padding>0&&samples>0?{codec:'mp3',rate,channels,samples}:null;
  }
  async function compressedLayout(blob){
    if(!(blob instanceof Blob)||blob.size<42||blob.size>128*1024*1024)return null;
    let view=new DataView(await blob.slice(0,256).arrayBuffer());
    if(view.getUint32(0)>>>8===0x494433){
      const size=view.getUint32(6);
      if(size&0x80808080)return null;
      const offset=10+((size>>>24)<<21)+((size>>>16&127)<<14)+((size>>>8&127)<<7)+(size&127)+(view.getUint8(5)&16?10:0);
      if(offset>1024*1024||offset+42>blob.size)return null;
      view=new DataView(await blob.slice(offset,offset+256).arrayBuffer());
    }
    if(view.getUint32(0)!==0x664c6143)return mp3Layout(view);
    if((view.getUint32(4)&0x7fffffff)!==34)return null;
    const packed=view.getUint32(18);
    const samples=(packed&15)*2**32+view.getUint32(22),rate=packed>>>12,channels=((packed>>>9)&7)+1;
    return samples&&rate?{codec:'flac',rate,channels,samples}:null;
  }
  async function joinCompressed(first,second,signal){
    const [a,b]=await Promise.all([compressedLayout(first),compressedLayout(second)]);
    if(!a||!b||a.codec!==b.codec||a.rate!==b.rate||a.channels!==b.channels||a.channels>2||signal.aborted)return null;
    const bytes=(a.samples+b.samples)*a.channels*4;
    if(bytes>160*1024*1024)return null;
    const context=new OfflineAudioContext(a.channels,1,a.rate);
    const decode=async blob=>context.decodeAudioData(await blob.arrayBuffer());
    const buffers=await Promise.all([decode(first),decode(second)]);
    if(signal.aborted||!buffers.every((decoded,index)=>decoded.length===[a,b][index].samples&&
        decoded.sampleRate===a.rate&&decoded.numberOfChannels===a.channels))return null;
    const header=waveHeader(bytes);
    header.setUint16(20,3,true);header.setUint16(22,a.channels,true);header.setUint32(24,a.rate,true);
    header.setUint32(28,a.rate*a.channels*4,true);header.setUint16(32,a.channels*4,true);header.setUint16(34,32,true);
    const parts=[header.buffer];
    for(const decoded of buffers){
      const channels=Array.from({length:a.channels},(_,index)=>decoded.getChannelData(index));
      if(a.channels===1){parts.push(channels[0]);continue;}
      for(let offset=0;offset<decoded.length;offset+=32768){
        const count=Math.min(32768,decoded.length-offset);
        const floats=new Float32Array(count*2);
        for(let i=0;i<count;i++){
          floats[2*i]=channels[0][offset+i];
          floats[2*i+1]=channels[1][offset+i];
        }
        parts.push(floats);
      }
    }
    return {blob:new Blob(parts,{type:'audio/wav'}),first:a.samples/a.rate,second:b.samples/b.rate};
  }
  async function join(first,second,abort){
    const [a,b]=await Promise.all([layout(first),layout(second)]);
    if(a||b)return a&&b?joinWave(a,b):null;
    if(typeof OfflineAudioContext!=='function')return null;
    const signal=AbortSignal.any([abort,AbortSignal.timeout(1800)].filter(Boolean));
    if(signal.aborted)return null;
    let finish;
    const stopped=new Promise(resolve=>{
      finish=()=>resolve(null);
      signal.addEventListener('abort',finish,{once:true});
    });
    try{return await Promise.race([joinCompressed(first,second,signal),stopped]);}
    finally{signal.removeEventListener('abort',finish);}
  }
  return {join};
});
