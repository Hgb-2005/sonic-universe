'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

function createWallpaperController({ onState, onCoverage, onFailure }) {
  let session = null;
  function attach(window) {
    if (session) return session.ready;
    if (process.platform !== 'win32') return Promise.resolve({ ok:false, message:'动态桌面目前支持 Windows。' });

    const handle = window.getNativeWindowHandle().readBigUInt64LE().toString();
    const executable = path.join(__dirname, 'native', 'WallpaperHost.exe')
      .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    const child = spawn(executable, [handle], { windowsHide:true });
    const current = { child, attached:false, stopping:false, error:'', ready:null, stopped:null };
    session = current;
    let settle, stopped;
    current.ready = new Promise(resolve => { settle = resolve; });
    current.stopped = new Promise(resolve => { stopped = resolve; });
    const timeout = setTimeout(() => {
      current.error = '连接桌面超时，已保留普通窗口。';
      detach();
    }, 7000);

    child.stdin.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { current.error = (current.error + chunk).slice(0, 500); });
    child.on('error', error => { current.error = error.code === 'ENOENT' ? '缺少动态桌面组件，请重新打包或安装。' : error.message; });
    const lines = readline.createInterface({ input:child.stdout });
    lines.on('line', line => {
      if (current.stopping) return;
      if (line === 'attached') {
        clearTimeout(timeout);
        current.attached = true;
        onState(true);
        settle({ ok:true, message:'动态桌面已开启，可从系统托盘返回。' });
      } else if (current.attached && (line === 'covered' || line === 'visible')) {
        onCoverage(line === 'covered');
      }
    });
    child.once('close', () => {
      clearTimeout(timeout);
      lines.close();
      session = null;
      const message = current.error.trim() || '动态桌面已退出。';
      onState(false);
      settle({ ok:false, message });
      stopped();
      if (current.attached && !current.stopping) onFailure(message);
    });
    return current.ready;
  }

  async function detach() {
    const current = session;
    if (current) {
      if (!current.stopping) {
        current.stopping = true;
        current.child.stdin.end();
      }
      await current.stopped;
    }
    return { ok:true, message:'已回到普通窗口。' };
  }

  return { attach, detach, get pending() { return Boolean(session); }, get active() { return session?.attached === true; } };
}
module.exports = { createWallpaperController };
