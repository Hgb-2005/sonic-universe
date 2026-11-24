'use strict';
// 可选的单文件打包：把 index.html 里按顺序引用的脚本合并成 outputs/bundle.js。
// 默认不改变发布页；需要更少的请求时用 npm run bundle:assets 生成，再按需替换页面引用。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'outputs', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const sources = [...html.matchAll(/<script[^>]*src="\.\/([^"?]+)(?:\?[^"]*)?"/g)].map(match => match[1]);
if (!sources.length) {
  console.error('没有找到可打包的脚本');
  process.exit(1);
}

const missing = sources.filter(file => !fs.existsSync(path.join(root, 'outputs', file)));
if (missing.length) {
  console.error('缺少脚本: ' + missing.join(', '));
  process.exit(1);
}

const parts = sources.map(file => {
  const code = fs.readFileSync(path.join(root, 'outputs', file), 'utf8');
  return `/* ==== ${file} ==== */\n${code}`;
});
const bundle = `/* Sonic Universe bundle — 由 scripts/bundle-assets.cjs 生成，勿手改 */\n;(function(){\n${parts.join('\n;\n')}\n})();\n`;

const outPath = path.join(root, 'outputs', 'bundle.js');
fs.writeFileSync(outPath, bundle, 'utf8');
const hash = crypto.createHash('sha256').update(bundle).digest('hex').slice(0, 12);

console.log(`合并 ${sources.length} 个脚本 -> outputs/bundle.js`);
console.log(`体积 ${(bundle.length / 1024).toFixed(1)} KB，版本 ${hash}`);
console.log('用法：把 index.html 里的这些 <script src> 换成 <script defer src="./bundle.js?v=' + hash + '"></script>');
