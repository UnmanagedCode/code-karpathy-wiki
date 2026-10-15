import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceFiles, headTags } from './_frontendFiles.mjs';

const files = sourceFiles();
const html = files.find(([n]) => n === 'index.html')[1];

// Invariant: no HTML-string sinks, dynamic code, hash writes, parent scripting or cc localStorage keys in the UI source.
test('frontend uses no HTML-string sinks, eval, hash writes, window.parent or cc keys', () => {
  const banned = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function|setAttribute\(\s*['"]style|dangerouslySetInnerHTML|location\.hash\s*=|window\.parent|code-conductor:/;
  assert.ok(files.length > 10, 'scanned the UI sources');
  for (const [n, src] of files) assert.equal(banned.test(src), false, `${n}: ${src.match(banned)?.[0]}`);
});

// Invariant: every URL is relative (cc mounts the page under /plugins/code-wiki/), except the two host URLs in index.html.
test('frontend uses no root-relative URLs', () => {
  const rootRel = /(?:src|href)\s*=\s*["']\/|['"`]\/api|fetch\(\s*['"`]\//g;
  const HOST = new Set(['src="/pluginBridge.js"', 'href="/pluginTheme.css"']);
  for (const [n, src] of files) {
    for (const m of src.matchAll(rootRel)) {
      const at = src.slice(m.index).match(/^(?:src|href)\s*=\s*"[^"]*"/)?.[0];
      assert.ok(n === 'index.html' && HOST.has(at), `${n}: ${at ?? m[0]}`);
    }
  }
  assert.match(html, /src="\/pluginBridge\.js"/);
  assert.match(html, /href="\/pluginTheme\.css"/);
});

// Invariant: the CSP forbids inline script, so the shell has none, and no inline style either.
test('index.html has no inline script or style', () => {
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(html), false, 'inline <script>');
  assert.equal(/<style[\s>]/.test(html), false, '<style>');
  assert.equal(/\sstyle\s*=/.test(html), false, 'style=');
});

// Invariant: <head> loads the bridge first, then the host theme, then theme-init.js, then the module entry.
test('index.html head order: bridge, theme, theme-init, entry', () => {
  const order = headTags(html)
    .filter((t) => t.tag === 'script' || (t.tag === 'link' && /rel="stylesheet"/.test(t.attrs)))
    .map((t) => t.attrs.match(/(?:src|href)="([^"]+)"/)[1]);
  assert.deepEqual(order, ['/pluginBridge.js', '/pluginTheme.css', 'theme-init.js', './src/main.tsx']);
  assert.match(headTags(html).find((t) => t.attrs.includes('main.tsx')).attrs, /type="module"/);
});
