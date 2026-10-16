// Checks the real build (`npm install` runs `prepare`, which writes
// frontend/dist): it is what the CSP actually meets, and what the backend serves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createServer, CSP } from '../server.js';
import { ASSET_RE, DEFAULT_DIST } from '../src/static.js';
import { resetEnv } from './_helpers.mjs';
import { headTags } from './_frontendFiles.mjs';

const indexPath = path.join(DEFAULT_DIST, 'index.html');
const built = existsSync(indexPath);
const files = [];
const walk = (rel) => {
  for (const e of readdirSync(path.join(DEFAULT_DIST, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(r); else files.push(r);
  }
};
if (built) walk('');
const html = built ? readFileSync(indexPath, 'utf8') : '';
const read = (rel) => readFileSync(path.join(DEFAULT_DIST, rel), 'utf8');
const HOST = ['/pluginBridge.js', '/pluginTheme.css'];
const refs = () => [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);

// Invariant: the UI is built (by `npm install`).
test('frontend/dist/index.html exists', () => {
  assert.ok(built, `${indexPath} is missing — run npm install`);
});

// Invariant: every built file is servable by the static allowlist, and the build is only html/js/css.
test('every built file matches the served-path rule', () => {
  assert.ok(files.length >= 4, files.join(', '));
  for (const f of files) assert.match(`/${f}`, ASSET_RE, f);
  assert.ok(files.some((f) => /^assets\/.+\.js$/.test(f)), 'a JS bundle');
  assert.ok(files.some((f) => /^assets\/.+\.css$/.test(f)), 'a CSS bundle');
  assert.ok(files.includes('theme-init.js'));
});

// Invariant: the built page has no inline script or style, and only relative URLs besides the two host URLs.
test('built index.html: no inline script/style, relative URLs, head order kept', () => {
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(html), false, 'inline <script>');
  assert.equal(/<style[\s>]/.test(html), false, '<style>');
  assert.equal(/\sstyle\s*=/.test(html), false, 'style=');
  for (const u of refs()) {
    if (HOST.includes(u)) continue;
    assert.ok(!/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(u), `not relative: ${u}`);
  }
  const order = headTags(html)
    .filter((t) => t.tag === 'script' || (t.tag === 'link' && /rel="stylesheet"/.test(t.attrs)))
    .map((t) => t.attrs.match(/(?:src|href)="([^"]+)"/)[1]);
  assert.deepEqual(order.slice(0, 3), ['/pluginBridge.js', '/pluginTheme.css', 'theme-init.js']);
  assert.match(order[3], /^\.\/assets\/index-[A-Za-z0-9_-]+\.js$/);
});

// Invariant: the CSS loads nothing the CSP forbids (no data: URL, nothing off-origin); the JS calls no root-relative API.
test('built CSS and JS reference nothing off-limits', () => {
  for (const f of files.filter((x) => x.endsWith('.css'))) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/url\(\s*['"]?data:/i.test(css), false, `${f}: url(data:`);
    assert.equal(/https?:\/\//i.test(css), false, `${f}: absolute URL`);
  }
  for (const f of files.filter((x) => x.endsWith('.js'))) {
    assert.equal(/["'`]\/api\//.test(read(f)), false, `${f}: root-relative /api/`);
  }
});

// Invariant: the backend serves the real build: / and every asset it references, with type and CSP.
test('the server serves the built page and its assets', async () => {
  resetEnv();
  const server = createServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-security-policy'), CSP);
    assert.equal(await r.text(), html);
    const local = refs().filter((u) => !HOST.includes(u));
    assert.ok(local.length >= 3, local.join(', '));
    for (const u of local) {
      const a = await fetch(new URL(u, `${base}/`));
      assert.equal(a.status, 200, u);
      assert.equal(a.headers.get('content-type'), `${u.endsWith('.css') ? 'text/css' : 'text/javascript'}; charset=utf-8`, u);
      assert.equal(a.headers.get('content-security-policy'), CSP, u);
    }
  } finally {
    await new Promise((res) => server.close(res));
    resetEnv();
  }
});

// Invariant: App's `/` decides pane vs drawer with WIDE_QUERY, and the layout shows the pane with Tailwind's
// `md` variant. Unit tests stub matchMedia, so only this ties the two: it fails when WIDE_QUERY, the pane's or
// top bar's `md:` classes, or the `md` media query in the built CSS moves without the others.
test('WIDE_QUERY matches the breakpoint the built CSS shows the sidebar pane at', () => {
  const shell = readFileSync(path.join(DEFAULT_DIST, '..', 'src', 'components', 'AppShell.tsx'), 'utf8');
  const query = shell.match(/export const WIDE_QUERY = '([^']+)';/)?.[1];
  assert.equal(query, '(width >= 48rem)');
  const classes = (tag) => shell.match(new RegExp(`<${tag} className="([^"]+)"`))?.[1].split(/\s+/) ?? [];
  const aside = classes('aside');
  assert.ok(aside.includes('hidden') && aside.includes('md:block'), `pane: ${aside.join(' ')}`);
  assert.equal(aside.filter((c) => /^(?:sm|lg|xl|2xl|max-[\w-]+|min-[\w-]+):/.test(c)).length, 0, 'pane switches at md only');
  assert.ok(classes('header').includes('md:hidden'), 'the top bar (menu button) hides at md');

  const css = files.filter((f) => f.endsWith('.css')).map(read).join('\n');
  const rule = '.md\\:block{display:block}';
  const at = css.indexOf(rule);
  assert.ok(at >= 0, `built CSS has ${rule}`);
  const media = css.lastIndexOf('@media', at);
  const open = css.indexOf('{', media);
  let depth = 0;
  for (let i = open; i < at; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
  assert.ok(media >= 0 && depth >= 1, `${rule} sits inside an @media block`);
  const norm = (q) => q.replace(/\s+/g, '');
  assert.equal(norm(css.slice(media + '@media'.length, open)), norm(query));
});
