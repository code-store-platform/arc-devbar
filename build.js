#!/usr/bin/env node
// Builds dist/bookmarklet.txt and dist/install.html from src/devbar.js. No dependencies.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const src = fs.readFileSync(path.join(root, 'src/devbar.js'), 'utf8');

// Light, safe minification: drop whole-line comments, indentation and blank lines.
// Newlines are kept so automatic semicolon insertion behaves exactly as in the source.
let inBlock = false;
const lines = [];
for (const raw of src.split('\n')) {
  const line = raw.trim();
  if (inBlock) {
    if (line.includes('*/')) inBlock = false;
    continue;
  }
  if (line.startsWith('/*')) {
    if (!line.includes('*/')) inBlock = true;
    continue;
  }
  if (line === '' || line.startsWith('//')) continue;
  lines.push(line);
}
const code = lines.join('\n');

// Fail the build on a syntax error.
new vm.Script(code, { filename: 'devbar.min.js' });

// encodeURI keeps the URL short; '#' is encoded too so nothing is read as a fragment.
const bookmarklet = 'javascript:' + encodeURI(code).replace(/#/g, '%23');
if (decodeURIComponent(bookmarklet.slice('javascript:'.length)) !== code) throw new Error('encoding round-trip failed');

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'devbar.min.js'), code + '\n');
fs.writeFileSync(path.join(dist, 'bookmarklet.txt'), bookmarklet + '\n');

const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arc devbar</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; }
  .bm { display: inline-block; padding: 10px 18px; border-radius: 8px; background: #1d2433; color: #fff; text-decoration: none; font-weight: 600; cursor: grab; }
  code { font: 13px ui-monospace, Menlo, monospace; }
  textarea { width: 100%; height: 90px; font: 11px ui-monospace, Menlo, monospace; }
  .muted { color: #6b778c; }
</style>
</head>
<body>
<h1>Arc devbar</h1>
<p>Drag this button to your bookmarks bar:</p>
<p><a class="bm" href="${escAttr(bookmarklet)}" onclick="event.preventDefault(); alert('Drag me to the bookmarks bar.');">Arc devbar</a></p>
<p>Then open any Arc XP (Fusion) page and click the bookmark. Click again or press <code>Esc</code> to close.</p>
<p class="muted">Shows deployment, arcSite, outputType, environment, globalContent (tree + copy JSON), globalContentConfig,
features from <code>Fusion.tree</code> and quick links. Reads the page only, makes no requests.</p>
<details>
<summary>Manual install (copy the code into a new bookmark URL)</summary>
<textarea readonly onclick="this.select()">${bookmarklet.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>
</details>
<p class="muted">Bookmarklet size: ${bookmarklet.length} bytes. Built ${new Date().toISOString().slice(0, 10)}.</p>
</body>
</html>
`;
fs.writeFileSync(path.join(dist, 'install.html'), html);

console.log(`src ${src.length} B -> min ${code.length} B -> bookmarklet ${bookmarklet.length} B`);
console.log('dist/bookmarklet.txt, dist/install.html, dist/devbar.min.js');
