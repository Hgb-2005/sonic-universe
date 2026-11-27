'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const port = 18941;
const origin = 'http://127.0.0.1:' + port;
const tracks = ['54101', '54102'].map((mediaId,i)=>({
  provider:'qishui',mediaId,name:'验收歌曲 '+(i+1),artist:'验收艺人',album:'验收专辑',duration:60,
}));
const chart = { provider:'apple',mediaId:'8801',name:'验收热门歌曲',artist:'验收艺人',externalUrl:'https://music.apple.com/cn/song/8801' };
let chartMode='upstream', failedAudio=false, auth=false;

async function main(){
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'sonic-failure-profile-'));
  const app=await _electron.launch({executablePath:process.env.SONIC_DESKTOP_EXECUTABLE,
    args:['--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{...process.env,SONIC_DESKTOP_PROFILE:profile,SONIC_DESKTOP_PORT:String(port)}});
  try{
    const page=await app.firstWindow();
    await page.waitForURL(url=>url.origin===origin,{waitUntil:'domcontentloaded',timeout:20000});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
    const wav=await fs.readFile(path.join(path.resolve(__dirname,'..'),'outputs','interstellar-drift.mp3'));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url()), p=url.pathname;
      if(url.origin!==origin)return /^https?:$/.test(url.protocol)?route.abort():route.continue();
      if(chartMode==='offline'&&(p==='/health'||p.startsWith('/api/')))return route.abort('connectionrefused');
      if(p==='/health')return route.fulfill({json:{ok:true,companion:true}});
      if(p==='/api/qishui/login-status')return route.fulfill({json:{authenticated:true,user:{nickname:'QA'}}});
      if(p==='/api/qishui/discovery')return route.fulfill(auth?{status:401,json:{code:'auth-required'}}:{json:{items:tracks}});
      if(p==='/api/discovery/charts'){
        if(chartMode==='upstream'){
          await new Promise(resolve=>setTimeout(resolve,8150));
          return route.fulfill({status:504,json:{code:'upstream-timeout',error:'Apple Music 请求超时，请稍后重试。'}}).catch(()=>{});
        }
        return route.fulfill({json:{title:'验收热门榜单',items:[chart]}});
      }
      if(p.startsWith('/media/failure/')){
        const range=/^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range||'');
        if(!range)return route.fulfill({contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes'},body:wav});
        const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
        return route.fulfill({status:206,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes',
          'Content-Range':'bytes '+start+'-'+end+'/'+wav.length},body:wav.subarray(start,end+1)});
      }
      if(p.endsWith('/audio'))return failedAudio?route.fulfill({status:422,json:{code:'not-playable'}}):
        route.fulfill({json:{streamPath:'/media/failure/'+p.split('/')[4],preview:false}});
      if(p.endsWith('/lyrics'))return route.fulfill({json:{lrc:'[00:00.00]验收歌词'}});
      if(p.startsWith('/api/'))return route.fulfill({status:404,json:{}});
      return route.continue();
    });
    await page.waitForURL(url=>url.origin===origin);
    await page.reload();
    await page.waitForFunction(()=>SonicPlayback.snapshot().ready);
    const advanceClock=()=>page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+11*60000;});
    const open=()=>page.locator('[data-action="discovery"]').filter({visible:true}).first().click();
    await open();
    const dialog=page.locator('dialog.sd-dialog'), status=dialog.locator('[data-discovery-status]');
    const tab=kind=>dialog.locator('[data-discovery-tab="'+kind+'"]').click();
    const retry=dialog.locator('[data-discovery-retry]');
    const close=()=>page.keyboard.press('Escape');
    const state=()=>page.evaluate(()=>SonicPlayback.snapshot({queue:true}));
    await dialog.getByRole('button',{name:'播放推荐'}).click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot({queue:true}).queueCount===2);
    const before=await state();
    if(await dialog.isVisible())await close();
    await open();
    await tab('charts');
    await status.locator('xpath=self::*[@data-error="true"]').waitFor({timeout:12000});
    const upstream=await status.textContent();
    console.log('Apple timeout UI:',upstream);
    assert.match(upstream,/Apple Music 热门榜单.*超时/);
    assert.equal(await retry.textContent(),'重试榜单');
    chartMode='ok';
    await retry.click();
    await dialog.getByText(chart.name,{exact:true}).waitFor();
    assert.match(await status.textContent(),/验收热门榜单/);
    await advanceClock();
    chartMode='offline';
    await tab('daily');await tab('charts');
    await status.locator('xpath=self::*[@data-error="true"]').waitFor();
    console.log('Local outage UI:',await status.textContent());
    assert.match(await status.textContent(),/本机音乐入口.*断开/);
    assert.equal(await retry.textContent(),'重新连接并重试');
    chartMode='ok';
    await retry.click();
    await status.filter({hasText:'验收热门榜单'}).waitFor();
    const after=await state();
    assert.equal(after.track.id,before.track.id);
    assert.deepEqual(after.queue.map(x=>x.id),before.queue.map(x=>x.id));
    assert.ok(after.playing&&after.position>before.position);
    console.log('Recovery retained',after.track.id,after.queue.length,'entries, position',after.position.toFixed(2),'s');
    auth=true;
    await tab('daily');
    await dialog.getByRole('button',{name:'去登录汽水音乐'}).waitFor();
    assert.match(await status.textContent(),/登录.*失效/);
    console.log('Expired sign-in UI:',await status.textContent());
    await close();
    failedAudio=true;
    await page.evaluate(id=>SonicPlayback.playOnlineList([{provider:'qishui',mediaId:id,name:'无音源测试'}],'故障测试',id),'54103');
    const broken=await state();
    assert.equal(broken.playbackRecovery?.reason,'unplayable');
    const panel=page.locator('[data-recovery-retry]').filter({visible:true}).first().locator('../..');
    assert.match(await panel.textContent(),/没有可播放的音源/);
    console.log('Missing audio UI:',(await panel.textContent()).trim());
    failedAudio=false;
    await panel.locator('[data-recovery-retry]').click();
    await page.waitForFunction(()=>SonicPlayback.snapshot().playing&&SonicPlayback.snapshot().track?.id==='online:qishui:54103');
  } finally {await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
