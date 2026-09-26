import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateRelPath } from '../src/paths.js';
import { handle } from '../src/browse.js';
import { freshWiki, cleanup, resetEnv, useProjects, writeTree } from './_helpers.mjs';

const get = (route, params) => handle(route, new URLSearchParams(params));

// Build the same hostile layout under an orchestrator wiki and a project .wiki,
// and run each test against both source kinds.
async function withBoth(fn) {
  resetEnv();
  const w = await freshWiki();
  try {
    const outside = path.join(w.root, 'outside');
    await writeTree(outside, { 'secret.md': '# Secret\n\nCANARY-OUTSIDE\n' });
    const projDir = path.join(w.root, 'proj');
    const projWiki = path.join(projDir, '.wiki');
    await fs.mkdir(projWiki, { recursive: true });
    useProjects([{ name: 'proj', path: projDir, system: 'local' }]);
    for (const [source, root] of [['orchestrator', w.wiki], ['p:proj', projWiki]]) {
      await writeTree(root, {
        'index.md': '# Root\n\n[[leak]] [[real]] [[alias]] [[secret]]\n',
        'real.md': '# Real\n\nreal body\n',
        '.prune-progress.md': 'HIDDEN-DOT CANARY-DOT\n',
        '.hidden/x.md': 'HIDDEN-DIR CANARY-DOT\n',
      });
      await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));
      await fs.symlink(outside, path.join(root, 'ext'));
      await fs.symlink(path.join(root, 'real.md'), path.join(root, 'alias.md'));
      await fs.mkdir(path.join(root, 'sub'));
      await fs.writeFile(path.join(root, 'sub', 'inner.md'), 'inner');
      await fs.symlink(root, path.join(root, 'sub', 'loop'));
      await fn({ source, root, ...w });
    }
  } finally {
    await cleanup(w.root);
    resetEnv();
  }
}

// Invariant: the rel-path validator rejects traversal, absolute, backslash, NUL, dot segments and non-.md.
test('validateRelPath matrix', () => {
  for (const bad of ['..', 'a/../b.md', '../x.md', '/abs.md', 'a\\b.md', 'a\0.md', '.hidden.md', '.d/x.md',
    'x.txt', 'x.md.bak', '', 'a//b.md', './a.md', 'a/./b.md', 'dir/', undefined, 3]) {
    assert.equal(validateRelPath(bad), null, JSON.stringify(bad));
  }
  assert.equal(validateRelPath('a/b.md'), 'a/b.md');
  assert.equal(validateRelPath('index.md'), 'index.md');
});

// Invariant: an invalid path is refused 400 PATH_INVALID before touching the filesystem.
test('page: invalid paths -> 400 PATH_INVALID (both kinds)', async () => {
  await withBoth(async ({ source }) => {
    for (const p of ['../outside/secret.md', '/etc/passwd.md', '.prune-progress.md', '.hidden/x.md', 'a\\b.md', 'x.txt']) {
      const r = await get('/api/page', { source, path: p });
      assert.equal(r.status, 400, `${source} ${p}`);
      assert.equal(r.body.code, 'PATH_INVALID');
    }
  });
});

// Invariant: a symlink (file or dir) escaping the root is 403 at read time and absent everywhere else.
test('escaping symlinks: 403 on read, absent from tree, search, lint, backlinks (both kinds)', async () => {
  await withBoth(async ({ source }) => {
    for (const p of ['leak.md', 'ext/secret.md']) {
      const r = await get('/api/page', { source, path: p });
      assert.equal(r.status, 403, `${source} ${p}`);
      assert.equal(r.body.code, 'PATH_ESCAPES');
    }
    const tree = JSON.stringify((await get('/api/tree', { source })).body);
    assert.equal(tree.includes('leak'), false);
    assert.equal(tree.includes('ext'), false);
    assert.equal(tree.includes('secret'), false);
    const search = (await get('/api/search', { q: 'CANARY', source })).body;
    assert.deepEqual(search.results, []);
    const lint = (await get('/api/lint', { source })).body;
    assert.equal(JSON.stringify(lint).includes('leak.md"'), false, 'escaping page never linted as a page');
    assert.ok(lint.deadLinks.some((d) => d.raw === '[[leak]]'), 'a link to it is dead');
    assert.ok(lint.deadLinks.some((d) => d.raw === '[[secret]]'));
    const idx = (await get('/api/page', { source, path: 'index.md' })).body;
    assert.equal(JSON.stringify(idx).includes('CANARY'), false);
  });
});

// Invariant: a symlink resolving inside the root is served; a dir cycle terminates the walk.
test('contained symlink served; symlink cycle terminates (both kinds)', async () => {
  await withBoth(async ({ source }) => {
    const r = await get('/api/page', { source, path: 'alias.md' });
    assert.equal(r.status, 200, source);
    assert.equal(r.body.title, 'Real');
    const tree = await get('/api/tree', { source });
    assert.equal(tree.status, 200);
    const sub = tree.body.tree.dirs.find((d) => d.name === 'sub');
    assert.ok(sub.pages.some((p) => p.path === 'sub/inner.md'));
    assert.equal(sub.dirs.length, 0, 'the loop back to the root is not followed');
  });
});

// Invariant: dot-prefixed files and dirs are never listed or searched.
test('dot entries hidden from tree and search (both kinds)', async () => {
  await withBoth(async ({ source }) => {
    const tree = JSON.stringify((await get('/api/tree', { source })).body);
    assert.equal(tree.includes('prune'), false);
    assert.equal(tree.includes('hidden'), false);
    assert.deepEqual((await get('/api/search', { q: 'CANARY-DOT', source })).body.results, []);
  });
});

// Invariant: a symlinked source root works; confinement applies below it.
test('symlinked root is served', async () => {
  resetEnv();
  const w = await freshWiki();
  try {
    const real = path.join(w.root, 'real-wiki');
    await writeTree(real, { 'index.md': '# R\n' });
    const proj = path.join(w.root, 'lp');
    await fs.mkdir(proj);
    await fs.symlink(real, path.join(proj, '.wiki'));
    useProjects([{ name: 'lp', path: proj, system: 'local' }]);
    const r = await get('/api/page', { source: 'p:lp', path: 'index.md' });
    assert.equal(r.status, 200);
    assert.equal(r.body.title, 'R');
  } finally {
    await cleanup(w.root);
    resetEnv();
  }
});
