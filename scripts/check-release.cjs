'use strict';
// 发布前探针：检查「页面引用」「.gitignore 白名单」「版本一致性」三件最容易在发布时出错的事。
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const failures = [];
const notes = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

// 1. index.html 引用的脚本必须真实存在
const html = read('outputs/index.html');
const scripts = [...html.matchAll(/<script[^>]*src="\.\/([^"?]+)/g)].map(match => 'outputs/' + match[1]);
for (const script of scripts) {
  if (!exists(script)) failures.push(`页面引用了不存在的脚本: ${script}`);
}
notes.push(`页面脚本 ${scripts.length} 个`);

// 2. 新脚本必须被 .gitignore 放行，否则 GitHub Pages 会缺文件；
//    已经在版本库里的旧文件不受 ignore 规则影响，不算问题。
const { execFileSync } = require('node:child_process');
let tracked = '';
try {
  tracked = execFileSync('git', ['ls-files', 'outputs'], { cwd: root, encoding: 'utf8' });
} catch {
  notes.push('（未检测到 git，跳过已跟踪判断）');
}
const trackedSet = new Set(tracked.split(/\r?\n/).filter(Boolean));
const ignore = read('.gitignore').split(/\r?\n/).map(line => line.trim());
const whitelist = new Set(ignore.filter(line => line.startsWith('!/')).map(line => line.slice(1)));
for (const script of scripts) {
  if (trackedSet.has(script)) continue;
  if (!whitelist.has('/' + script)) failures.push(`新增脚本未加入 .gitignore 白名单: ${script}`);
}

// 3. 页面里出现的 assets 文件必须存在（防止改名后残留引用）
const assetRefs = new Set();
for (const file of fs.readdirSync(path.join(root, 'outputs')).filter(name => name.endsWith('.js'))) {
  const text = read(path.join('outputs', file));
  for (const match of text.matchAll(/(?:'|")(\.\/)?(assets\/[A-Za-z0-9._-]+)(?:'|")/g)) assetRefs.add(match[2]);
}
for (const asset of assetRefs) {
  if (!exists('outputs/' + asset)) failures.push(`脚本引用了不存在的素材: outputs/${asset}`);
}
notes.push(`脚本引用素材 ${assetRefs.size} 个`);

// 4. 版本号一致：package.json 与 README 顶部
const pkg = JSON.parse(read('package.json'));
const readme = read('README.md');
if (!readme.includes(`## ${pkg.version}`)) failures.push(`README 缺少 ${pkg.version} 的版本段落`);
notes.push(`版本 ${pkg.version}`);

// 5. 测试文件必须能被 node --test 找到（数量下限）
const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs'));
if (tests.length < 20) failures.push(`测试文件数量异常: ${tests.length}`);
notes.push(`测试文件 ${tests.length} 个`);

// 6. 内置示例与封面存在
for (const asset of ['outputs/assets/auld-lang-syne.m4a', 'outputs/interstellar-drift.mp3', 'outputs/assets/sonic-icon.png']) {
  if (!exists(asset)) failures.push(`缺少打包素材: ${asset}`);
}

console.log('发布探针');
for (const note of notes) console.log('  · ' + note);
if (failures.length) {
  console.error('\n发现问题:');
  for (const failure of failures) console.error('  ✖ ' + failure);
  process.exit(1);
}
console.log('\n全部通过');
