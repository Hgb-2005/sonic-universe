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
  async function join(first,second){
    const [a,b]=await Promise.all([layout(first),layout(second)]);
    if(!a||!b||a.channels!==b.channels||a.rate!==b.rate||a.bits!==b.bits)return null;
    const size=a.data.size+b.data.size, pad=size%2;
    const header=new DataView(new ArrayBuffer(44));
    header.setUint32(0,0x52494646);header.setUint32(4,36+size+pad,true);
    header.setUint32(8,0x57415645);header.setUint32(12,0x666d7420);header.setUint32(16,16,true);
    header.setUint32(36,0x64617461);header.setUint32(40,size,true);
    const parts=[header.buffer.slice(0,20),a.raw,header.buffer.slice(36),a.data,b.data];
    if(pad)parts.push(new Uint8Array(1));
    return {blob:new Blob(parts,{type:'audio/wav'}),first:a.duration,second:b.duration};
  }
  return {join};
});
