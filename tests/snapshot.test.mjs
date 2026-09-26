import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { handle } from '../src/browse.js';
import { parse } from '../src/markdown.js';
import { loadSnapshot, MAX_PAGE_BYTES, MAX_WALK_ENTRIES, _setParse, _setMaxWalkEntries, _parseCached } from '../src/snapshot.js';
import { freshWiki, cleanup, resetEnv } from './_helpers.mjs';

const get = (route, params = {}) => handle(route, new URLSearchParams(params));
const ORCH = () => ({ id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator', root: path.join(process.env.PROJECTS_ROOT, '.conduct', 'wiki') });

async function withWiki(fn) {
  resetEnv();
  const w = await freshWiki();
  try {
    return await fn(w);
  } finally {
    await fs.chmod(w.wiki, 0o755).catch(() => {});
    await cleanup(w.root);
    resetEnv();
  }
}

const allPaths = (node) => [...(node.index ? [node.index] : []), ...node.pages.map((p) => p.path), ...node.dirs.flatMap(allPaths)];

// Invariant: reads are bounded before they happen — a file far over the cap
// (a 3 GiB sparse file, past what fs.readFile can even return) is served
// truncated, and the parser never sees more than MAX_PAGE_BYTES.
test('reads are bounded: a 3 GiB sparse page is served truncated and the parser sees at most MAX_PAGE_BYTES', async () => {
  await withWiki(async ({ wiki, write }) => {
    await write('index.md', '# R');
    const big = path.join(wiki, 'huge.md');
    await fs.writeFile(big, 'head ');
    await fs.truncate(big, 3 * 1024 ** 3);
    const seen = [];
    _setParse((text, fb) => { seen.push(Buffer.byteLength(text)); return parse(text, fb); });
    const r = await get('/api/page', { source: 'orchestrator', path: 'huge.md' });
    assert.equal(r.status, 200);
    assert.equal(r.body.truncated, true);
    assert.ok(seen.length > 0);
    for (const n of seen) assert.ok(n <= MAX_PAGE_BYTES, `parser saw ${n} bytes`);
  });
});

// Invariant: a page that exists but cannot be read is listed and served with
// error READ_FAILED — never presented as absent.
test('an unreadable page is still listed and served with error READ_FAILED', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', '# R\n\n[[locked]]\n');
    const abs = await write('locked.md', '# Locked\n');
    await fs.chmod(abs, 0o000);
    try {
      const tree = (await get('/api/tree', { source: 'orchestrator' })).body.tree;
      assert.ok(tree.pages.some((p) => p.path === 'locked.md'), 'listed in the tree');
      const r = await get('/api/page', { source: 'orchestrator', path: 'locked.md' });
      assert.equal(r.status, 200);
      assert.equal(r.body.error, 'READ_FAILED');
      const lint = (await get('/api/lint', { source: 'orchestrator' })).body;
      assert.equal(lint.deadLinks.length, 0, 'links to it still resolve');
      const ok = (await get('/api/page', { source: 'orchestrator', path: 'index.md' })).body;
      assert.equal(ok.error, null);
    } finally {
      await fs.chmod(abs, 0o644);
    }
  });
});

// Invariant: an unreadable directory is listed with error READ_FAILED, not silently empty.
test('an unreadable directory is listed with error READ_FAILED', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, async () => {
  await withWiki(async ({ wiki, write }) => {
    await write('locked/x.md', '# X');
    await fs.chmod(path.join(wiki, 'locked'), 0o000);
    try {
      const tree = (await get('/api/tree', { source: 'orchestrator' })).body.tree;
      const d = tree.dirs.find((n) => n.name === 'locked');
      assert.ok(d);
      assert.equal(d.error, 'READ_FAILED');
      assert.equal(tree.error, null);
    } finally {
      await fs.chmod(path.join(wiki, 'locked'), 0o755);
    }
  });
});

// Invariant: a page whose parse throws is listed and served with error PARSE_FAILED.
test('a page that fails to parse is still listed and served with error PARSE_FAILED', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', '# R');
    await write('bad.md', 'POISON');
    _setParse((text, fb) => { if (text.includes('POISON')) throw new RangeError('boom'); return parse(text, fb); });
    const r = await get('/api/page', { source: 'orchestrator', path: 'bad.md' });
    assert.equal(r.status, 200);
    assert.equal(r.body.error, 'PARSE_FAILED');
    assert.equal(r.body.title, 'bad');
    assert.deepEqual(r.body.blocks, []);
    assert.ok(allPaths((await get('/api/tree', { source: 'orchestrator' })).body.tree).includes('bad.md'));
  });
});

// Invariant: the stack-overflow vectors are ordinary pages — served, listed and searchable.
test('deeply nested pages are served, listed and searchable, not dropped', async () => {
  await withWiki(async ({ write }) => {
    await write('lists.md', `${'- '.repeat(4000)}NEEDLE-L`);
    await write('quotes.md', `${'>'.repeat(12000)} NEEDLE-Q`);
    for (const p of ['lists.md', 'quotes.md']) {
      const r = await get('/api/page', { source: 'orchestrator', path: p });
      assert.equal(r.status, 200, p);
      assert.equal(r.body.error, null, p);
    }
    const tree = allPaths((await get('/api/tree', { source: 'orchestrator' })).body.tree);
    assert.ok(tree.includes('lists.md') && tree.includes('quotes.md'));
    assert.deepEqual((await get('/api/search', { q: 'needle-l' })).body.results.map((r) => r.path), ['lists.md']);
    assert.deepEqual((await get('/api/search', { q: 'needle-q' })).body.results.map((r) => r.path), ['quotes.md']);
  });
});

// Invariant: the walk is bounded by MAX_WALK_ENTRIES per source; hitting it is
// reported as truncated by /api/tree and /api/lint.
test('walk is bounded: a symlink diamond stops at the entry cap and tree/lint report truncated', async () => {
  await withWiki(async ({ wiki, write }) => {
    assert.ok(Number.isInteger(MAX_WALK_ENTRIES) && MAX_WALK_ENTRIES > 0);
    // d0 -> {a,b} -> d1 -> {a,b} -> ... : 2^LEVELS logical paths to d<LEVELS>.
    const LEVELS = 10;
    for (let i = 0; i <= LEVELS; i++) await fs.mkdir(path.join(wiki, `d${i}`));
    for (let i = 0; i < LEVELS; i++) {
      await fs.symlink(path.join(wiki, `d${i + 1}`), path.join(wiki, `d${i}`, 'a'));
      await fs.symlink(path.join(wiki, `d${i + 1}`), path.join(wiki, `d${i}`, 'b'));
    }
    await write(`d${LEVELS}/leaf.md`, '# Leaf');
    await write('index.md', '# R');

    _setMaxWalkEntries(200);
    const snap = await loadSnapshot(ORCH());
    assert.equal(snap.truncated, true);
    assert.ok(snap.pages.size + snap.dirs.size <= 201, `${snap.pages.size} pages, ${snap.dirs.size} dirs`);
    const tree = (await get('/api/tree', { source: 'orchestrator' })).body;
    assert.equal(tree.truncated, true);
    assert.equal((await get('/api/lint', { source: 'orchestrator' })).body.truncated, true);

    _setMaxWalkEntries(null);
    await fs.rm(path.join(wiki, 'd0'), { recursive: true });
    const small = (await get('/api/tree', { source: 'orchestrator' })).body;
    assert.equal(small.truncated, false, 'an ordinary tree is not truncated at the default cap');
    assert.equal((await get('/api/lint', { source: 'orchestrator' })).body.truncated, false);
  });
});

// Invariant: cached parse entries are independent of the path they were
// reached by — two logical paths to one h1-less file keep their own titles.
test('cached parse entries are path-independent: alias and target keep their own fallback titles across passes', async () => {
  await withWiki(async ({ wiki, write }) => {
    await write('real.md', 'no heading here\n');
    await fs.symlink(path.join(wiki, 'real.md'), path.join(wiki, 'alias.md'));
    for (let pass = 0; pass < 2; pass++) {
      const snap = await loadSnapshot(ORCH());
      assert.equal(snap.pages.get('real.md').title, 'real', `pass ${pass}`);
      assert.equal(snap.pages.get('alias.md').title, 'alias', `pass ${pass}`);
      for (const p of ['real.md', 'alias.md']) {
        assert.equal((await get('/api/page', { source: 'orchestrator', path: p })).body.title, p.replace('.md', ''));
      }
    }
  });
});

// Invariant (optional round-2 item): a file deleted from the tree stops pinning the parse cache after the next walk.
test('parse cache evicts entries whose file the walk no longer visits', async () => {
  await withWiki(async ({ write }) => {
    const abs = await write('gone.md', '# Gone');
    await write('stay.md', '# Stay');
    await loadSnapshot(ORCH());
    const real = await fs.realpath(abs);
    const stay = await fs.realpath(path.join(path.dirname(abs), 'stay.md'));
    assert.equal(_parseCached(real), true);
    await fs.rm(abs);
    await loadSnapshot(ORCH());
    assert.equal(_parseCached(real), false);
    assert.equal(_parseCached(stay), true);
  });
});

// Invariant: eviction drops only entries owned by the source being walked — a
// source nested inside another's root (reached only through a dot-dir the outer
// walk skips) keeps its cache entries across walks of the outer source.
test('cache eviction only drops entries owned by the walked source: a nested project wiki survives an outer walk', async () => {
  await withWiki(async ({ wiki, write }) => {
    await write('index.md', '# Outer');
    const inner = await write('proj/.wiki/inner.md', '# Inner');
    const PROJ = { id: 'p:proj', kind: 'project', label: 'proj', root: path.join(wiki, 'proj', '.wiki') };
    await loadSnapshot(PROJ);
    const real = await fs.realpath(inner);
    assert.equal(_parseCached(real), true);
    await loadSnapshot(ORCH());
    assert.equal(_parseCached(real), true, 'outer walk leaves the inner source cached');
    await fs.rm(inner);
    await loadSnapshot(PROJ);
    assert.equal(_parseCached(real), false, 'the owning source still evicts its deleted file');
  });
});

// Invariant: entries whose owner root no longer exists are reclaimed — a nested
// source's entries survive outer walks while its root exists, and the next
// complete outer walk after the root is deleted drops them.
test('cache entries of a deleted source root are reclaimed by the next complete walk of another source', async () => {
  await withWiki(async ({ wiki, write }) => {
    await write('index.md', '# Outer');
    const inner = await write('proj/.wiki/inner.md', '# Inner');
    await loadSnapshot({ id: 'p:proj', kind: 'project', label: 'proj', root: path.join(wiki, 'proj', '.wiki') });
    const real = await fs.realpath(inner);
    for (let i = 0; i < 2; i++) {
      await loadSnapshot(ORCH());
      assert.equal(_parseCached(real), true, `outer walk ${i} keeps a live nested source's entry`);
    }
    await fs.rm(path.join(wiki, 'proj', '.wiki'), { recursive: true });
    await loadSnapshot(ORCH());
    assert.equal(_parseCached(real), false, 'owner root gone -> reclaimed');
  });
});
