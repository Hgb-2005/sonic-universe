'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');

const scheme = 'sonic-local-music';

function createMusicFolderPicker(dialog, origin) {
  let selecting = false;
  let lastFolder;
  let grant;
  let revision = 0;

  function clear(token) {
    if (token && grant?.token !== token) return;
    revision++;
    grant = null;
  }

  async function select(window) {
    if (selecting || grant) return null;
    selecting = true;
    const attempt = revision;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: '选择音乐文件夹',
        buttonLabel: '导入',
        defaultPath: lastFolder,
        properties: ['openDirectory', 'dontAddToRecent'],
      });
      if (result.canceled || revision !== attempt) return null;
      const directory = path.resolve(result.filePaths[0]);
      const realDirectory = await fs.realpath(directory);
      const folder = path.basename(directory) || '音乐';
      const key = createHash('sha256').update(directory.replaceAll('\\', '/').toLowerCase()).digest('hex');
      const files = [], errors = [], records = [];
      const pending = [{full: realDirectory, relative: folder}];
      while (pending.length && revision === attempt) {
        const parent = pending.pop();
        try {
          const stream = await fs.opendir(parent.full);
          for await (const entry of stream) {
            const full = path.join(parent.full, entry.name);
            const relative = parent.relative + '/' + entry.name;
            if (entry.isDirectory()) {
              pending.push({full, relative});
            } else if (entry.isFile()) {
              try {
                const info = await fs.lstat(full);
                if (!info.isFile()) continue;
                const index = records.push({full, info}) - 1;
                files.push({index, name: entry.name, path: relative, size: info.size, lastModified: Math.trunc(info.mtimeMs)});
              } catch {
                errors.push({path: relative, reason: '无法读取文件资料。'});
              }
            }
          }
        } catch {
          errors.push({path: parent.relative, reason: '无法读取此文件夹。'});
        }
      }
      if (revision !== attempt) return null;
      files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
      const token = randomUUID();
      lastFolder = directory;
      grant = {token, records, directory: realDirectory};
      return {key, token, files, errors};
    } finally {
      selecting = false;
    }
  }

  async function handle(request) {
    const url = new URL(request.url);
    const active = grant;
    if (request.method !== 'GET' || request.initiatorOrigin !== origin ||
        !active || url.host !== active.token || !/^\/\d+$/.test(url.pathname)) {
      return new Response(null, {status: 403});
    }
    const record = active.records[Number(url.pathname.slice(1))];
    if (!record) return new Response(null, {status: 404});
    let file;
    try {
      const resolved = await fs.realpath(record.full);
      const relative = path.relative(active.directory, resolved);
      if (resolved !== record.full || !relative || relative === '..' ||
          relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || grant !== active) {
        return new Response(null, {status: 403});
      }
      file = await fs.open(resolved, 'r');
      const actual = await file.stat();
      const expected = record.info;
      if (grant !== active || !actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino ||
          actual.size !== expected.size || actual.mtimeMs !== expected.mtimeMs) {
        await file.close();
        return new Response(null, {status: 409});
      }
      const body = Readable.toWeb(file.createReadStream());
      return new Response(body, {headers: {
        'Access-Control-Allow-Origin': origin,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(actual.size),
        'Cache-Control': 'no-store',
      }});
    } catch {
      await file?.close().catch(() => {});
      return new Response(null, {status: 404});
    }
  }

  return {select, clear, handle};
}

module.exports = {scheme, createMusicFolderPicker};
