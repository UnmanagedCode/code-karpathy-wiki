import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/browse.js';
import { MAX_PAGE_BYTES } from '../src/snapshot.js';
import { MAX_RESULTS } from '../src/search.js';
import { freshWiki, cleanup, resetEnv, useProjects, freshProjectWiki } from './_helpers.mjs';

const get = (route, params = {}) => handle(route, new URLSearchParams(params));

async function withWiki(fn) {
  resetEnv();
  const w = await freshWiki();
  try {
    return await fn(w);
  } finally {
    await cleanup(w.root);
    resetEnv();
  }
}

// Invariant: /api/sources lists ids/kinds/labels (never roots) and the conductor flag.
test('sources shape', async () => {
  await withWiki(async ({ root }) => {
    assert.deepEqual((await get('/api/sources')).body, {
      sources: [{ id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator' }], conductor: false,
    });
    useProjects([await freshProjectWiki(root, 'demo', { 'index.md': '# D' })]);
    const r = await get('/api/sources');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.sources.map((s) => s.id), ['orchestrator', 'p:demo']);
    assert.equal(r.body.conductor, true);
    assert.equal(JSON.stringify(r.body).includes(root), false, 'filesystem paths are not exposed');
  });
});

// Invariant: the tree is directory-driven; index.md is the dir landing, index-less dirs appear, archive flagged.
test('tree shape: dir landing index, index-less dir, archive flag, sorting', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', '# Root');
    await write('global/index.md', '# Global');
    await write('global/b.md', '# Bee');
    await write('global/a.md', 'no h1');
    await write('global/noidx/x.md', '# X');
    await write('global/archive/index.md', '# Arch');
    await write('global/archive/old.md', '# Old');
    const { status, body } = await get('/api/tree', { source: 'orchestrator' });
    assert.equal(status, 200);
    assert.equal(body.source, 'orchestrator');
    const t = body.tree;
    assert.equal(t.index, 'index.md');
    assert.deepEqual(t.pages, []);
    const g = t.dirs[0];
    assert.equal(g.path, 'global');
    assert.equal(g.index, 'global/index.md');
    assert.deepEqual(g.pages, [{ path: 'global/a.md', name: 'a', title: 'a' }, { path: 'global/b.md', name: 'b', title: 'Bee' }]);
    assert.deepEqual(g.dirs.map((d) => [d.name, d.index, d.archived]), [['archive', 'global/archive/index.md', true], ['noidx', null, false]]);
    assert.equal(g.archived, false);
  });
});

// Invariant: page payload — resolved link kinds, backlinks from both forms, deduped, excluding self.
test('page: resolved links and backlinks', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', '# Root\n\n[g](global/index.md)\n');
    await write('global/index.md', '# G\n\n[[target]] [t](target.md) [[target]]\n');
    await write('global/other.md', '# Other\n\n[[target]]\n');
    await write('global/target.md', '---\nconfidence: low\nupdated: 2000-01-01\n---\n# Target\n\n[[target]] [[missing]] [x](https://e.example) [y](javascript:x) [[other]]\n');
    const { status, body } = await get('/api/page', { source: 'orchestrator', path: 'global/target.md' });
    assert.equal(status, 200);
    assert.equal(body.title, 'Target');
    assert.deepEqual(body.frontmatter, { confidence: 'low', updated: '2000-01-01' });
    assert.equal(body.lowConfidence, true);
    assert.equal(body.stale, true);
    assert.equal(body.archived, false);
    assert.equal(body.truncated, false);
    assert.deepEqual(body.backlinks, [{ path: 'global/index.md', title: 'G' }, { path: 'global/other.md', title: 'Other' }]);
    const links = body.blocks.flatMap((b) => b.c ?? []).filter((n) => n.t === 'link');
    assert.deepEqual(links.map((l) => l.kind), ['page', 'dead', 'external', 'blocked', 'page']);
    assert.equal(links[0].target, 'global/target.md');
    assert.equal(links[4].target, 'global/other.md');
  });
});

// Invariant: an over-cap page is cut at a codepoint boundary and flagged.
test('page truncation over MAX_PAGE_BYTES', async () => {
  await withWiki(async ({ write }) => {
    const buf = Buffer.concat([Buffer.from('a'.repeat(MAX_PAGE_BYTES - 1)), Buffer.from('é')]);
    await write('big.md', buf);
    const { body } = await get('/api/page', { source: 'orchestrator', path: 'big.md' });
    assert.equal(body.truncated, true);
    const text = body.blocks[0].c[0].v;
    assert.equal(text.length, MAX_PAGE_BYTES - 1);
    assert.equal(text.includes('�'), false);
  });
});

// Invariant: error statuses and codes on the browser routes.
test('errors: SOURCE_REQUIRED, SOURCE_UNKNOWN, NOT_FOUND, PATH_INVALID', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', '# R');
    const cases = [
      ['/api/tree', {}, 400, 'SOURCE_REQUIRED'],
      ['/api/lint', {}, 400, 'SOURCE_REQUIRED'],
      ['/api/page', { path: 'index.md' }, 400, 'SOURCE_REQUIRED'],
      ['/api/tree', { source: 'nope' }, 404, 'SOURCE_UNKNOWN'],
      ['/api/page', { source: 'p:nope', path: 'index.md' }, 404, 'SOURCE_UNKNOWN'],
      ['/api/search', { q: 'ab', source: 'nope' }, 404, 'SOURCE_UNKNOWN'],
      ['/api/page', { source: 'orchestrator' }, 400, 'PATH_INVALID'],
      ['/api/page', { source: 'orchestrator', path: 'missing.md' }, 404, 'NOT_FOUND'],
      ['/api/page', { source: 'orchestrator', path: 'global' }, 400, 'PATH_INVALID'],
    ];
    for (const [route, params, status, code] of cases) {
      const r = await get(route, params);
      assert.equal(r.status, status, `${route} ${JSON.stringify(params)}`);
      assert.equal(r.body.code, code);
      assert.ok(r.body.error);
    }
    assert.equal(await get('/api/other'), null, 'unknown routes fall through');
  });
});

// Invariant: an absent orchestrator wiki is an empty tree, not an error.
test('absent orchestrator root -> empty tree', async () => {
  await withWiki(async ({ root }) => {
    process.env.PROJECTS_ROOT = `${root}/nope`;
    const { status, body } = await get('/api/tree', { source: 'orchestrator' });
    assert.equal(status, 200);
    assert.deepEqual(body.tree, { name: '', path: '', index: null, archived: false, dirs: [], pages: [] });
  });
});

// Invariant: search spans sources, is case-insensitive AND, validates q, and caps results.
test('search: cross-source, case-insensitive AND, validation, cap', async () => {
  await withWiki(async ({ root, write }) => {
    await write('global/a.md', '# Alpha Beta\n\nalpha beta gamma\n');
    await write('global/b.md', '# B\n\nALPHA only\n');
    await write('global/c.md', '# C\n\nbeta alpha alpha\n');
    useProjects([await freshProjectWiki(root, 'demo', { 'gotchas/x.md': '# X\n\nAlpha and BETA here\n' })]);
    const { body } = await get('/api/search', { q: 'Alpha beta' });
    assert.deepEqual(body.results.map((r) => `${r.source}:${r.path}`), ['orchestrator:global/a.md', 'orchestrator:global/c.md', 'p:demo:gotchas/x.md']);
    const x = body.results[2];
    assert.equal(x.sourceLabel, 'demo');
    assert.equal(x.title, 'X');
    assert.deepEqual(x.snippets, [{ line: 3, text: 'Alpha and BETA here' }]);
    assert.equal(body.truncated, false);
    const only = (await get('/api/search', { q: 'alpha', source: 'p:demo' })).body;
    assert.deepEqual(only.results.map((r) => r.source), ['p:demo']);
    for (const q of ['', 'a', ' a ', 'x'.repeat(201)]) {
      const r = await get('/api/search', { q });
      assert.equal(r.status, 400, JSON.stringify(q));
      assert.equal(r.body.code, 'QUERY_INVALID');
    }
    assert.equal((await get('/api/search')).body.code, 'QUERY_INVALID');
  });
});

test('search: results capped at MAX_RESULTS with truncated:true', async () => {
  await withWiki(async ({ write }) => {
    for (let i = 0; i < MAX_RESULTS + 5; i++) await write(`p${String(i).padStart(3, '0')}.md`, 'needle\n');
    const { body } = await get('/api/search', { q: 'needle' });
    assert.equal(body.results.length, MAX_RESULTS);
    assert.equal(body.truncated, true);
  });
});
