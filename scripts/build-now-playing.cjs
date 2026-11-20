'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') throw new Error('Build the Windows media-session helper on Windows.');
const windows = process.env.SystemRoot || 'C:\\Windows';
const framework = path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const runtime = path.join(windows, 'Microsoft.NET', 'assembly', 'GAC_MSIL', 'System.Runtime.WindowsRuntime',
  'v4.0_4.0.0.0__b77a5c561934e089', 'System.Runtime.WindowsRuntime.dll');
const sdk = process.env.WindowsSdkDir || path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10');
const union = path.join(sdk, 'UnionMetadata');
const versions = fs.existsSync(union) ? fs.readdirSync(union).filter(name => /^10\.0\.\d+\.\d+$/.test(name)) : [];
versions.sort((a,b) => b.localeCompare(a, 'en', { numeric:true }));
const winmd = versions.map(version => path.join(union, version, 'Windows.winmd')).find(file => fs.existsSync(file));
if (!winmd) throw new Error('Windows 10/11 SDK UnionMetadata is required to compile the media-session helper.');
if (!fs.existsSync(runtime)) throw new Error('The Windows .NET Framework WinRT bridge is required.');
const native = path.resolve(__dirname, '../desktop/native');
const result = spawnSync(path.join(framework, 'csc.exe'), [
  '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/codepage:65001',
  '/r:' + runtime, '/r:' + path.join(framework, 'System.Runtime.dll'), '/r:' + winmd, '/r:System.Web.Extensions.dll',
  '/out:' + path.join(native, 'NowPlayingHost.exe'), path.join(native, 'NowPlayingHost.cs'),
], { stdio:'inherit', windowsHide:true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
