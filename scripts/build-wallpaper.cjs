'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') throw new Error('Build the Windows wallpaper helper on Windows.');
const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const root = path.resolve(__dirname, '../desktop/native');
if (!fs.existsSync(compiler)) throw new Error('The Windows .NET Framework C# compiler is required.');
const result = spawnSync(compiler, [
  '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/codepage:65001',
  '/out:' + path.join(root, 'WallpaperHost.exe'), path.join(root, 'WallpaperHost.cs'),
], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
