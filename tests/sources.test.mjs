import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSources, getSource } from '../src/sources.js';
import { freshWiki, cleanup, resetEnv, useProjects, useFailingConductor, freshProjectWiki } from './_helpers.mjs';

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
const ids = (list) => list.map((s) => s.id);

// Invariant: no conductor context -> orchestrator only, and no fetch at all.
test('no CONDUCTOR_URL: only orchestrator, fetcher never called', async () => {
  await withWiki(async ({ root, wiki }) => {
    const row = await freshProjectWiki(root, 'demo', { 'index.md': 'x' });
    const calls = useProjects([row]);
    delete process.env.CONDUCTOR_URL;
    const list = await listSources();
    assert.deepEqual(list, [{ id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator', root: wiki }]);
    assert.equal(calls.n, 0);
  });
});

// Invariant: a local project with a .wiki dir is listed as p:<name>.
test('local project with .wiki is listed', async () => {
  await withWiki(async ({ root }) => {
    const row = await freshProjectWiki(root, 'demo', { 'index.md': 'x' });
    useProjects([row]);
    const list = await listSources();
    assert.deepEqual(list[1], { id: 'p:demo', kind: 'project', label: 'demo', root: path.join(row.path, '.wiki') });
    assert.equal((await getSource('p:demo')).root, path.join(row.path, '.wiki'));
  });
});

// Invariant: every row filter (no .wiki, remote system, missing system, bad path, .wiki file, symlinked .wiki).
test('row filters: remote, missing .wiki, empty/relative path, .wiki file; symlink and no-system accepted', async () => {
  await withWiki(async ({ root }) => {
    const local = await freshProjectWiki(root, 'local', { 'a.md': 'x' });
    const remote = { ...(await freshProjectWiki(root, 'remote', { 'a.md': 'x' })), system: 'box-1' };
    const legacy = await freshProjectWiki(root, 'legacy', { 'a.md': 'x' });
    delete legacy.system;
    await fs.mkdir(path.join(root, 'nowiki'));
    await fs.mkdir(path.join(root, 'filewiki'));
    await fs.writeFile(path.join(root, 'filewiki', '.wiki'), 'not a dir');
    await fs.mkdir(path.join(root, 'linked'));
    await fs.mkdir(path.join(root, 'elsewhere'));
    await fs.symlink(path.join(root, 'elsewhere'), path.join(root, 'linked', '.wiki'));
    useProjects([
      local, remote, legacy,
      { name: 'nowiki', path: path.join(root, 'nowiki'), system: 'local' },
      { name: 'degraded', path: '', system: 'local' },
      { name: 'relative', path: 'local', system: 'local' },
      { name: 'filewiki', path: path.join(root, 'filewiki'), system: 'local' },
      { name: 'linked', path: path.join(root, 'linked'), system: 'local' },
      null, 'junk', { path: local.path, system: 'local' },
    ]);
    assert.deepEqual(ids(await listSources()), ['orchestrator', 'p:local', 'p:legacy', 'p:linked']);
    assert.equal(await getSource('p:remote'), null);
  });
});

// Invariant: a failing conductor degrades to orchestrator only.
test('fetcher throws -> only orchestrator', async () => {
  await withWiki(async () => {
    useFailingConductor();
    assert.deepEqual(ids(await listSources()), ['orchestrator']);
    assert.equal(await getSource('p:any'), null);
  });
});

// Invariant: the orchestrator source resolves without a fetch; unknown ids are null.
test('getSource: orchestrator needs no fetch; unknown id -> null', async () => {
  await withWiki(async ({ wiki }) => {
    const calls = useProjects([]);
    assert.equal((await getSource('orchestrator')).root, wiki);
    assert.equal(calls.n, 0);
    assert.equal(await getSource('nope'), null);
    assert.equal(await getSource(undefined), null);
  });
});
