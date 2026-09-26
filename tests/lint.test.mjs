import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../src/snapshot.js';
import { lintSnapshot, STALE_AFTER_DAYS } from '../src/lint.js';

const ORCH = { id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator' };
const snap = (files, source = ORCH) => buildSnapshot(source, files);
const NOW = new Date('2026-06-01T12:00:00Z');
const lint = (files, source) => lintSnapshot(snap(files, source), { now: NOW });

// Invariant: syntax examples in code never count as dead links; real ones do, with their line.
test('deadLinks: code spans/fences excluded, real dead link reported with line', () => {
  const r = lint({
    'index.md': '# Root\n\nUse `[[name]]`, `[[x]]` and `[[link]]`.\n\n```\n[[link]]\n[a](nope.md)\n```\n\nsee [[ghost]]\n',
  });
  assert.deepEqual(r.deadLinks, [{ from: 'index.md', raw: '[[ghost]]', line: 10, archived: false }]);
  assert.equal(r.counts.deadLinks, 1);
});

// Invariant: an ambiguous link is reported with its candidates, not as dead.
test('ambiguousLinks listed with candidates', () => {
  const r = lint({
    'index.md': '[[foo]]\n',
    'global/foo.md': 'a',
    'projects/p/foo.md': 'b',
  });
  assert.equal(r.deadLinks.length, 0);
  assert.deepEqual(r.ambiguousLinks, [{ from: 'index.md', raw: '[[foo]]', line: 1, candidates: ['global/foo.md', 'projects/p/foo.md'], archived: false }]);
});

// Invariant: a page absent from its directory's index is an orphan.
test('orphan when absent from the dir index', () => {
  const r = lint({
    'index.md': '[g](global/index.md)',
    'global/index.md': '[[listed]]',
    'global/listed.md': 'x',
    'global/unlisted.md': 'x',
  });
  assert.deepEqual(r.orphans, [{ path: 'global/unlisted.md', index: 'global/index.md', archived: false }]);
});

// Invariant: with no index in the page's dir the nearest ancestor index is used;
// a family index must be listed in its parent's index; the root is never an orphan.
test('orphans: nearest ancestor index, family index in parent, root exempt', () => {
  const r = lint({
    'index.md': '# root\n',
    'global/index.md': 'nothing listed',
    'global/noindex/a.md': 'x',
    'global/fam/index.md': 'x',
  });
  const byPath = Object.fromEntries(r.orphans.map((o) => [o.path, o.index]));
  assert.equal(byPath['global/noindex/a.md'], 'global/index.md');
  assert.equal(byPath['global/fam/index.md'], 'global/index.md');
  assert.equal(byPath['global/index.md'], 'index.md');
  assert.equal('index.md' in byPath, false);
});

// Invariant: with no ancestor index at all, the orphan names index:null.
test('orphans: no ancestor index -> index null', () => {
  const r = lint({ 'a/b.md': 'x' }, { id: 'p:x', kind: 'project', label: 'x' });
  assert.deepEqual(r.orphans, [{ path: 'a/b.md', index: null, archived: false }]);
});

// Invariant: reachability follows links out of index pages only.
test('unreachable indexes: leaf-only link does not reach; index chain does', () => {
  const r = lint({
    'index.md': '[g](global/index.md)',
    'global/index.md': '[[fam]] [[leaf]]',
    'global/fam/index.md': 'x',
    'global/leaf.md': '[[hidden]]',
    'global/hidden/index.md': 'x',
  });
  assert.deepEqual(r.unreachableIndexes.map((u) => u.path), ['global/hidden/index.md']);
  assert.equal(r.rootIndex, 'index.md');
});

// Invariant: a missing root index makes every index unreachable.
test('missing root index -> rootIndex null, all unreachable', () => {
  const r = lint({ 'global/index.md': '[[fam]]', 'global/fam/index.md': 'x' });
  assert.equal(r.rootIndex, null);
  assert.deepEqual(r.unreachableIndexes.map((u) => u.path), ['global/fam/index.md', 'global/index.md']);
});

// Invariant: confidence "low" (any suffix after a word boundary) is flagged; others not.
test('lowConfidence: low and "low (...)" flagged; high/stated not', () => {
  const fm = (c) => `---\nconfidence: ${c}\n---\n`;
  const r = lint({ 'a.md': fm('low'), 'b.md': fm('Low (single run)'), 'c.md': fm('high'), 'd.md': fm('stated'), 'e.md': fm('lower') });
  assert.deepEqual(r.lowConfidence.map((x) => x.path), ['a.md', 'b.md']);
});

// Invariant: stale boundary is strictly greater than STALE_AFTER_DAYS; unparseable is flagged with null age.
test('stale: 90 days not stale, 91 stale, unparseable flagged', () => {
  assert.equal(STALE_AFTER_DAYS, 90);
  const fm = (u) => `---\nupdated: ${u}\n---\n`;
  const r = lint({ 'a.md': fm('2026-03-03'), 'b.md': fm('2026-03-02'), 'c.md': fm('last week'), 'd.md': fm('2026-02-30'), 'e.md': 'none' });
  assert.deepEqual(r.stale, [
    { path: 'b.md', updated: '2026-03-02', ageDays: 91, archived: false },
    { path: 'c.md', updated: 'last week', ageDays: null, archived: false },
    { path: 'd.md', updated: '2026-02-30', ageDays: null, archived: false },
  ]);
  assert.equal(r.staleAfterDays, 90);
  assert.equal(r.now, NOW.toISOString());
});

// Invariant: archive pages are linted, and their items say archived:true.
test('archive items carry archived:true', () => {
  const r = lint({
    'index.md': '[g](global/index.md)',
    'global/index.md': '[[archive]]',
    'global/archive/index.md': 'x',
    'global/archive/old.md': '[[gone]]',
  });
  assert.deepEqual(r.deadLinks, [{ from: 'global/archive/old.md', raw: '[[gone]]', line: 1, archived: true }]);
  assert.deepEqual(r.orphans, [{ path: 'global/archive/old.md', index: 'global/archive/index.md', archived: true }]);
});

// Invariant (false-positive tripwire): a fixture shaped like the live wiki lints clean.
test('live-shaped fixture lints clean', () => {
  const fm = '---\ndescription: d\nconfidence: high\nupdated: 2026-05-20\n---\n\n';
  const r = lint({
    'index.md': '# Orchestrator wiki\n\n- [global](global/index.md) — g\n- [workspaces/W](workspaces/W/index.md) — w\n- [projects/P](projects/P/index.md) — p\n',
    'global/index.md': '# Global\n\n- [fam-a](fam-a/index.md) — a\n- [fam-b](fam-b/index.md) — b\n- [archive](archive/index.md) — old\n- [top-page](top-page.md) — t\n\nPage links are `[[name]]` — resolve with `ls global/*/name.md`.\n',
    'global/top-page.md': `${fm}# Top\n\nSee [[fam-a]] and [[fam-b/y]].\n`,
    'global/fam-a/index.md': '# fam a\n\n- [x](x.md) — x\n- [[x2]] — x2\n',
    'global/fam-a/x.md': `${fm}# X\n\nRelated: [[../fam-b/y]], [[fam-b]], [[fam-b/y]], [[y]].\n\nSyntax: \`[[link]]\`, \`[[x]]\`.\n\n\`\`\`md\n[[example-page]]\n\`\`\`\n`,
    'global/fam-a/x2.md': `${fm}# X2\n\n[[x]] and [[claim|with label]]\n`,
    'global/fam-b/index.md': '# fam b\n\n- [y](y.md) — y\n- [claim](claim.md) — c\n',
    'global/fam-b/y.md': `${fm}# Y\n\n[[../fam-a/x]] <branch> [README](../../../README.md)\n`,
    'global/fam-b/claim.md': `${fm}# Claim\n\n[[top-page]]\n`,
    'global/archive/index.md': '# Archive\n\n- [old](old.md)\n',
    'global/archive/old.md': `${fm}# Old\n\n[[x]]\n`,
    'workspaces/W/index.md': '# W\n\n- [[w-fact]]\n',
    'workspaces/W/w-fact.md': `${fm}# W fact\n\nSee [[p-note]] and [[projects/P/p-note]].\n`,
    'projects/P/index.md': '# P\n\n- [p-note](p-note.md)\n- workspace: [[W]]\n',
    'projects/P/p-note.md': `${fm}# P note\n\nFamily [[fam-a]] via [[../../workspaces/W/w-fact]].\n`,
  });
  const summary = { ...r.counts };
  assert.deepEqual(summary, { deadLinks: 0, ambiguousLinks: 0, orphans: 0, unreachableIndexes: 0, lowConfidence: 0, stale: 0 },
    JSON.stringify({ dead: r.deadLinks, amb: r.ambiguousLinks, orph: r.orphans, unr: r.unreachableIndexes }, null, 1));
});
