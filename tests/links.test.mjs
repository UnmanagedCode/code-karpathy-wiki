import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkContext, scopeOf, resolveWiki, resolveHref, buildNameIndex } from '../src/links.js';

const orch = (pages) => linkContext('orchestrator', pages);
const proj = (pages) => linkContext('project', pages);

// Invariant: the scope table.
test('scopeOf: orchestrator scopes and single-scope project sources', () => {
  assert.equal(scopeOf('orchestrator', 'global/fam/x.md'), 'global');
  assert.equal(scopeOf('orchestrator', 'workspaces/W/x.md'), 'workspaces/W');
  assert.equal(scopeOf('orchestrator', 'projects/p/a/b.md'), 'projects/p');
  assert.equal(scopeOf('orchestrator', 'index.md'), '');
  assert.equal(scopeOf('project', 'global/x.md'), '');
});

// Invariant: index.md is never keyed by basename; a dir with an index is keyed by its name.
test('name index: pages by basename, dirs by name, never "index"', () => {
  const idx = buildNameIndex(['index.md', 'global/index.md', 'global/fam/index.md', 'global/fam/x.md']);
  assert.equal(idx.has('index'), false);
  assert.deepEqual(idx.get('fam'), ['global/fam/index.md']);
  assert.deepEqual(idx.get('global'), ['global/index.md']);
  assert.deepEqual(idx.get('x'), ['global/fam/x.md']);
});

// Invariant (rule: bare name): a unique name resolves.
test('bare name in scope resolves', () => {
  const ctx = orch(['global/fam/foo.md', 'global/fam/bar.md']);
  assert.deepEqual(resolveWiki('foo', 'global/fam/bar.md', ctx), { kind: 'page', target: 'global/fam/foo.md' });
  assert.deepEqual(resolveWiki('foo|label', 'global/fam/bar.md', ctx), { kind: 'page', target: 'global/fam/foo.md' });
  assert.deepEqual(resolveWiki('foo#sec', 'global/fam/bar.md', ctx), { kind: 'page', target: 'global/fam/foo.md' });
  assert.deepEqual(resolveWiki('foo.md', 'global/fam/bar.md', ctx), { kind: 'page', target: 'global/fam/foo.md' });
});

// Invariant (rule: scope preference): the in-scope candidate wins; from the root scope it is ambiguous.
test('scope preference: own scope wins, root index sees ambiguity', () => {
  const ctx = orch(['index.md', 'global/foo.md', 'projects/p/foo.md', 'projects/p/a.md']);
  assert.deepEqual(resolveWiki('foo', 'projects/p/a.md', ctx), { kind: 'page', target: 'projects/p/foo.md' });
  assert.deepEqual(resolveWiki('foo', 'index.md', ctx), { kind: 'ambiguous', candidates: ['global/foo.md', 'projects/p/foo.md'] });
});

// Invariant: two candidates in scope -> ambiguous, sorted, no tiebreak.
test('two in scope -> ambiguous with sorted candidates', () => {
  const ctx = orch(['global/z/foo.md', 'global/a/foo.md', 'global/x.md']);
  assert.deepEqual(resolveWiki('foo', 'global/x.md', ctx), { kind: 'ambiguous', candidates: ['global/a/foo.md', 'global/z/foo.md'] });
});

// Invariant: a single out-of-scope match still resolves.
test('out-of-scope single match resolves', () => {
  const ctx = orch(['global/foo.md', 'projects/p/a.md']);
  assert.deepEqual(resolveWiki('foo', 'projects/p/a.md', ctx), { kind: 'page', target: 'global/foo.md' });
});

// Invariant: [[dir]] -> dir/index.md; foo.md + foo/index.md is ambiguous; [[index]] never resolves.
test('dir names, file-vs-dir ambiguity, and [[index]]', () => {
  const ctx = orch(['global/worker-trust/index.md', 'global/foo.md', 'global/foo/index.md', 'global/x.md', 'global/index.md']);
  assert.deepEqual(resolveWiki('worker-trust', 'global/x.md', ctx), { kind: 'page', target: 'global/worker-trust/index.md' });
  assert.deepEqual(resolveWiki('foo', 'global/x.md', ctx), { kind: 'ambiguous', candidates: ['global/foo.md', 'global/foo/index.md'] });
  assert.deepEqual(resolveWiki('index', 'global/x.md', ctx), { kind: 'dead' });
  assert.deepEqual(resolveWiki('', 'global/x.md', ctx), { kind: 'dead' });
  assert.deepEqual(resolveWiki('nope', 'global/x.md', ctx), { kind: 'dead' });
});

// Invariant (rule: path form): relative to the scope root, then the source root.
test('path form: scope root first, source root fallback', () => {
  const ctx = orch(['global/mutation-runs/x.md', 'global/claim-hygiene/index.md', 'workspaces/W/y.md', 'global/p.md']);
  assert.deepEqual(resolveWiki('mutation-runs/x', 'global/p.md', ctx), { kind: 'page', target: 'global/mutation-runs/x.md' });
  assert.deepEqual(resolveWiki('claim-hygiene/index', 'global/p.md', ctx), { kind: 'page', target: 'global/claim-hygiene/index.md' });
  assert.deepEqual(resolveWiki('claim-hygiene', 'global/p.md', ctx), { kind: 'page', target: 'global/claim-hygiene/index.md' });
  assert.deepEqual(resolveWiki('workspaces/W/y', 'global/p.md', ctx), { kind: 'page', target: 'workspaces/W/y.md' });
  assert.deepEqual(resolveWiki('mutation-runs/missing', 'global/p.md', ctx), { kind: 'dead' });
});

// Invariant: path form hitting both x.md and x/index.md is ambiguous.
test('path form: file and dir index both exist -> ambiguous', () => {
  const ctx = orch(['global/a/b.md', 'global/a/b/index.md', 'global/p.md']);
  assert.deepEqual(resolveWiki('a/b', 'global/p.md', ctx), { kind: 'ambiguous', candidates: ['global/a/b.md', 'global/a/b/index.md'] });
});

// Invariant (decision 3): ./ and ../ resolve against the current page's directory.
test('page-relative ../ and ./ forms', () => {
  const ctx = orch(['global/fam/a.md', 'global/other/b.md', 'global/fam/c.md']);
  assert.deepEqual(resolveWiki('../other/b', 'global/fam/a.md', ctx), { kind: 'page', target: 'global/other/b.md' });
  assert.deepEqual(resolveWiki('./c', 'global/fam/a.md', ctx), { kind: 'page', target: 'global/fam/c.md' });
});

// Invariant: a path form escaping the source root is dead, never read.
test('path form escaping the root -> dead', () => {
  const ctx = orch(['global/a.md']);
  assert.deepEqual(resolveWiki('../../../etc/passwd', 'global/a.md', ctx), { kind: 'dead' });
  assert.deepEqual(resolveWiki('../x', 'index.md', ctx), { kind: 'dead' });
});

// Invariant: a project source is one scope — any unique name resolves.
test('project source: single scope', () => {
  const ctx = proj(['index.md', 'gotchas/foo.md', 'decisions/bar.md', 'gotchas/index.md']);
  assert.deepEqual(resolveWiki('foo', 'decisions/bar.md', ctx), { kind: 'page', target: 'gotchas/foo.md' });
  assert.deepEqual(resolveWiki('gotchas', 'index.md', ctx), { kind: 'page', target: 'gotchas/index.md' });
  assert.deepEqual(resolveWiki('../gotchas/foo', 'decisions/bar.md', ctx), { kind: 'page', target: 'gotchas/foo.md' });
});

// Invariant: markdown relative links resolve against the page dir.
test('md relative links: index, parent, dir, query/fragment, decoding', () => {
  const ctx = orch(['index.md', 'global/index.md', 'global/fam/index.md', 'global/fam/x.md', 'global/y.md', 'global/sp ace.md']);
  assert.deepEqual(resolveHref('global/index.md', 'index.md', ctx), { kind: 'page', target: 'global/index.md' });
  assert.deepEqual(resolveHref('fam/index.md', 'global/index.md', ctx), { kind: 'page', target: 'global/fam/index.md' });
  assert.deepEqual(resolveHref('../y.md', 'global/fam/x.md', ctx), { kind: 'page', target: 'global/y.md' });
  assert.deepEqual(resolveHref('fam/', 'global/index.md', ctx), { kind: 'page', target: 'global/fam/index.md' });
  assert.deepEqual(resolveHref('fam', 'global/index.md', ctx), { kind: 'page', target: 'global/fam/index.md' });
  assert.deepEqual(resolveHref('y.md?q=1#sec', 'global/index.md', ctx), { kind: 'page', target: 'global/y.md' });
  assert.deepEqual(resolveHref('sp%20ace.md', 'global/index.md', ctx), { kind: 'page', target: 'global/sp ace.md' });
  assert.deepEqual(resolveHref('bad%zz.md', 'global/index.md', ctx), { kind: 'dead' });
  assert.deepEqual(resolveHref('missing.md', 'global/index.md', ctx), { kind: 'dead' });
});

// Invariant: outside-the-wiki targets are inert, not dead (not a health item).
test('md links outside the wiki or to non-md files -> outside', () => {
  const ctx = proj(['index.md', 'a/b.md']);
  assert.equal(resolveHref('../../README.md', 'a/b.md', ctx).kind, 'outside');
  assert.equal(resolveHref('../README.md', 'index.md', ctx).kind, 'outside');
  assert.equal(resolveHref('pic.png', 'index.md', ctx).kind, 'outside');
  assert.equal(resolveHref('/etc/passwd', 'index.md', ctx).kind, 'outside');
});

// Invariant: every non-http(s) scheme and protocol-relative URL is blocked.
test('hostile hrefs are blocked', () => {
  const ctx = proj(['index.md']);
  for (const h of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
    'java\nscript:x', 'data:text/html,<script>x</script>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', ' //evil.example']) {
    assert.equal(resolveHref(h, 'index.md', ctx).kind, 'blocked', JSON.stringify(h));
  }
});

// Invariant: an entity-encoded scheme is never external (and never decoded into one).
test('entity-encoded javascript: is inert, not external', () => {
  const r = resolveHref('&#106;avascript:x', 'index.md', proj(['index.md']));
  assert.equal(r.kind, 'outside');
});

// Invariant: http/https are the only external kinds; bare #frag is an anchor.
test('http(s) -> external; #frag -> anchor', () => {
  const ctx = proj(['index.md']);
  assert.deepEqual(resolveHref('https://e.example/x', 'index.md', ctx), { kind: 'external', href: 'https://e.example/x' });
  assert.deepEqual(resolveHref('HTTP://e.example', 'index.md', ctx), { kind: 'external', href: 'HTTP://e.example' });
  assert.deepEqual(resolveHref('#sec', 'index.md', ctx), { kind: 'anchor', href: '#sec' });
});

// Invariant: an empty md destination names nothing — inert, and never a dead-link health item.
test('a destination with no path ([x](), [x](?q), [x](?#f)) is outside, not dead; #frag stays an anchor', async () => {
  assert.deepEqual(resolveHref('', 'index.md', proj(['index.md'])), { kind: 'outside' });
  assert.deepEqual(resolveHref('  ', 'index.md', proj(['index.md'])), { kind: 'outside' });
  // No path at all once ?query/#fragment are stripped: also inert. Only a bare #frag is an anchor.
  for (const h of ['?q', '?#f', '?', ' ?q=1 ']) assert.deepEqual(resolveHref(h, 'index.md', proj(['index.md'])), { kind: 'outside' }, h);
  assert.deepEqual(resolveHref('#f', 'index.md', proj(['index.md'])), { kind: 'anchor', href: '#f' });
  const { buildSnapshot } = await import('../src/snapshot.js');
  const { lintSnapshot } = await import('../src/lint.js');
  const r = lintSnapshot(buildSnapshot({ id: 'p:x', kind: 'project', label: 'x' }, { 'index.md': '[x]() and [y]( ) [z](?q) [w](?#f)\n' }));
  assert.equal(r.deadLinks.length, 0);
});
