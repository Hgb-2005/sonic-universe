'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

async function main() {
  const exe = process.env.SONIC_DESKTOP_EXECUTABLE;
  const port = process.env.SONIC_QA_PORT || '19047';
  assert.ok(exe, 'Set SONIC_DESKTOP_EXECUTABLE to the packaged Windows EXE.');
  const recording = path.join(__dirname, '../outputs/assets/auld-lang-syne.m4a');
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-i', recording, '-af',
    'silencedetect=noise=-43dB:d=0.08', '-f', 'null', 'NUL'], { windowsHide: true });
  assert.equal(probe.status, 0, probe.stderr?.toString());
  const firstWord = Number(probe.stderr.toString().match(/silence_end: ([\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(firstWord));

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sonic-software-lyrics-'));
  const app = await _electron.launch({ executablePath: exe,
    args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    env: { ...process.env, SONIC_DESKTOP_PROFILE: profile, SONIC_DESKTOP_PORT: port, SONIC_DISABLE_QISHUI: '1' },
  });
  const samples = [];
  try {
    const page = await app.firstWindow();
    await page.waitForURL(url => url.origin === 'http://127.0.0.1:' + port);
    await page.locator('[data-demo-lyrics]').click();
    await page.locator('[data-action="collapse-lyrics"]').click();
    await page.locator('[data-preview-line="0"]').waitFor();
    const dock = page.locator('#listeningRoom > .lr-player-wrap');
    for (let attempt = 0; attempt < 10; attempt++) {
      if (attempt) {
        await page.waitForFunction(() => SonicPlayback.position() > 2);
        await dock.locator('[data-seek]').press('Home');
        await page.waitForFunction(() => SonicPlayback.position() < .45, undefined, { timeout: 4000 });
      }
      await page.evaluate(() => {
        const audio = document.getElementById('audio');
        const line = document.querySelector('[data-preview-line="0"]');
        window.qaFirstWord = null;
        const observer = new MutationObserver(() => {
          const word = line.querySelector('.lr-timed-group');
          if (word?.textContent.trim() !== 'Should' ||
              !(parseFloat(word.style.getPropertyValue('--lr-word-fill')) > 0) ||
              audio.paused || audio.currentTime < .7 || audio.currentTime > 1.6) return;
          observer.disconnect();
          const styleAt = audio.currentTime;
          requestAnimationFrame(() => {
            window.qaFirstWord = { styleAt, nextFrameAt: audio.currentTime };
          });
        });
        observer.observe(line, { childList: true, attributes: true, subtree: true, attributeFilter: ['style'] });
      });
      if (!attempt) await dock.getByRole('button', { name: '播放音乐', exact: true }).click();
      const measured = await page.waitForFunction(() => window.qaFirstWord, undefined, { timeout: 8000 })
        .then(handle => handle.jsonValue());
      const delay = { styleMs: Math.round((measured.styleAt - firstWord) * 1000),
        nextFrameMs: Math.round((measured.nextFrameAt - firstWord) * 1000) };
      samples.push(delay);
      console.log('Software lyric ' + (attempt + 1) + '/10', delay);
    }
  } finally {
    await app.close();
  }
  assert.ok(samples.every(sample => Math.abs(sample.nextFrameMs) <= 150), JSON.stringify(samples));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
