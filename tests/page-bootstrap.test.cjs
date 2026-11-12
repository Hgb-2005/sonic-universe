const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../outputs');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('every shipped inline script compiles before deployment', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2);
  for (const [index, script] of scripts.entries()) {
    if (script[1].trim()) new vm.Script(script[1], { filename: `index.html:inline-${index}` });
  }
});

test('all local startup scripts are shipped beside the page', () => {
  for (const match of html.matchAll(/<script\b[^>]*src="(\.\/[^"?]+)(?:\?[^\"]*)?"/g)) {
    assert.ok(fs.existsSync(path.resolve(root, match[1])), match[1]);
  }
});
