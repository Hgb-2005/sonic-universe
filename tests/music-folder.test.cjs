'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {scheme, createMusicFolderPicker} = require('../desktop/music-folder.cjs');

test('desktop music selection grants only indexed files to the app until release', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sonic-folder-policy-'));
  t.after(() => fs.rm(temporary, {recursive: true, force: true}));
  const directory = path.join(temporary, 'music');
  await fs.mkdir(path.join(directory, 'sub'), {recursive: true});
  await fs.writeFile(path.join(directory, 'sub', 'song.lrc'), 'local lyrics');
  await fs.writeFile(path.join(temporary, 'outside.lrc'), 'outside');

  const origin = 'http://127.0.0.1:19040';
  let canceled = true;
  const picker = createMusicFolderPicker({async showOpenDialog(_window, options) {
    assert.equal(options.title, '选择音乐文件夹');
    assert.equal(options.buttonLabel, '导入');
    return {canceled, filePaths: canceled ? [] : [directory]};
  }}, origin);
  assert.equal(await picker.select({}), null);
  canceled = false;
  const selection = await picker.select({});
  assert.match(selection.key, /^[a-f0-9]{64}$/);
  assert.deepEqual(selection.files.map(entry => entry.path), ['music/sub/song.lrc']);
  const request = {method: 'GET', initiatorOrigin: origin, url: scheme+'://'+selection.token+'/0'};
  assert.equal(await (await picker.handle(request)).text(), 'local lyrics');
  assert.equal((await picker.handle({...request, initiatorOrigin: 'http://127.0.0.1:19041'})).status, 403);
  assert.equal((await picker.handle({...request, url: request.url.slice(0, -1) + '99'})).status, 404);
  picker.clear(selection.token);
  assert.equal((await picker.handle(request)).status, 403);
});
