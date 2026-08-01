import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readIndex, MAX_FILE_BYTES } from '../src/wiki.js';
import { handle, isRawTextResult } from '../src/mcp.js';
import { createServer } from '../server.js';
import { freshWiki, cleanup, resetEnv, useProjects, useFailingConductor } from './_helpers.mjs';

const header = (rel) => `<!-- .conduct/wiki/${rel} -->\n\n`;

// Every test owns a fresh temp wiki and restores the process globals it touched.
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

test('no args: root + global indexes only, in order', async () => {
  await withWiki(async ({ wiki, write }) => {
    await write('index.md', '# Orchestrator wiki\n');
    await write('global/index.md', '# Global\n');
    await write('projects/demo/index.md', '# Demo\n');

    const r = await readIndex({});
    assert.equal(r.ok, undefined, 'success is not a refusal');
    assert.equal(r.meta.wikiRoot, wiki);
    assert.equal(r.meta.resolvedWorkspace, null);
    assert.deepEqual(r.meta.missing, []);
    assert.deepEqual(r.meta.truncated, []);
    assert.equal(r.text.length, 2);
    assert.ok(r.text[0].startsWith(header('index.md')));
    assert.ok(r.text[1].startsWith(header('global/index.md')));
  });
});

test('bodies are byte-identical to the files after the header', async () => {
  await withWiki(async ({ write }) => {
    const body = '# Orchestrator wiki\n\nUnicode: café — 日本語 🎩\n\ttrailing tab\n';
    await write('index.md', body);
    await write('global/index.md', 'g');

    const r = await readIndex({});
    assert.equal(r.text[0], header('index.md') + body);
    assert.equal(r.text[1], header('global/index.md') + 'g');
  });
});

test('workspace arg adds its scope', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('workspaces/CC-Dev/index.md', 'w');

    const r = await readIndex({ workspace: 'CC-Dev' });
    assert.equal(r.text.length, 3);
    assert.equal(r.text[2], header('workspaces/CC-Dev/index.md') + 'w');
    assert.equal(r.meta.resolvedWorkspace, null, 'no project given, nothing to resolve');
  });
});

test('project arg adds its scope and the workspace it resolves to', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('workspaces/CC-Dev/index.md', 'w');
    await write('projects/demo/index.md', 'p');
    useProjects([{ name: 'other', workspace: 'TTD' }, { name: 'demo', workspace: 'CC-Dev' }]);

    const r = await readIndex({ project: 'demo' });
    assert.equal(r.meta.resolvedWorkspace, 'CC-Dev');
    assert.deepEqual(r.meta.missing, []);
    assert.equal(r.text.length, 4);
    // Broad -> narrow: root, global, workspace, project.
    assert.ok(r.text[2].startsWith(header('workspaces/CC-Dev/index.md')));
    assert.ok(r.text[3].startsWith(header('projects/demo/index.md')));
  });
});

test('overlapping scopes are a union deduped by path', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('workspaces/CC-Dev/index.md', 'w');
    await write('projects/demo/index.md', 'p');
    useProjects([{ name: 'demo', workspace: 'CC-Dev' }]);

    const r = await readIndex({ project: 'demo', workspace: 'CC-Dev' });
    assert.equal(r.text.length, 4, 'workspace counted once, not twice');
    const labels = r.text.map((t) => t.split('\n')[0]);
    assert.equal(new Set(labels).size, 4);
  });
});

test('a missing scope is meta.missing with no body, never an error', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    // no global/index.md, no workspaces/CC-Dev/index.md
    const r = await readIndex({ workspace: 'CC-Dev' });
    assert.equal(r.ok, undefined);
    assert.equal(r.text.length, 1);
    assert.deepEqual(r.meta.missing, ['global/index.md', 'workspaces/CC-Dev/index.md']);
  });
});

test('an entirely absent wiki root yields no bodies and no throw', async () => {
  await withWiki(async ({ root }) => {
    process.env.PROJECTS_ROOT = path.join(root, 'nope');
    const r = await readIndex({});
    assert.deepEqual(r.text, []);
    assert.deepEqual(r.meta.missing, ['index.md', 'global/index.md']);
    // The empty-text envelope still opts into the raw-text channel: a meta-only
    // result, not {result}.
    const env = await handle({ tool: 'read_index', arguments: {} });
    assert.equal(env.body.result, undefined);
    assert.deepEqual(env.body.text, []);
    assert.ok(env.body.meta);
  });
});

test('no CONDUCTOR_URL: resolvedWorkspace null, fetcher never called', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('projects/demo/index.md', 'p');
    const calls = useProjects([{ name: 'demo', workspace: 'CC-Dev' }]);
    delete process.env.CONDUCTOR_URL; // the only signal that a host exists

    const r = await readIndex({ project: 'demo' });
    assert.equal(calls.n, 0, 'no network, and no filesystem fallback either');
    assert.equal(r.meta.resolvedWorkspace, null);
    assert.equal(r.text.length, 3, 'project scope still read');
  });
});

test('conductor unreachable: still a success, workspace unresolved', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('projects/demo/index.md', 'p');
    const calls = useFailingConductor();

    const r = await readIndex({ project: 'demo' });
    assert.equal(calls.n, 1);
    assert.equal(r.ok, undefined);
    assert.equal(r.meta.resolvedWorkspace, null);
    assert.equal(r.text.length, 3);
  });
});

test('project absent from the host list is not a refusal', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('projects/ghost/index.md', 'p');
    useProjects([{ name: 'demo', workspace: 'CC-Dev' }]);

    const r = await readIndex({ project: 'ghost' });
    assert.equal(r.ok, undefined, 'conducting notes can outlive the project');
    assert.equal(r.meta.resolvedWorkspace, null);
    assert.equal(r.text.length, 3);
  });
});

test('a resolved workspace we cannot address is reported missing, not refused', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('projects/demo/index.md', 'p');
    // Legal upstream (/^[\w][\w \-./]{0,39}$/ permits spaces), not a path segment here.
    useProjects([{ name: 'demo', workspace: 'CC Dev' }]);

    const r = await readIndex({ project: 'demo' });
    assert.equal(r.ok, undefined);
    assert.equal(r.meta.resolvedWorkspace, 'CC Dev', 'raw host value still reported');
    assert.deepEqual(r.meta.missing, ['workspaces/CC Dev/index.md']);
    assert.equal(r.text.length, 3, 'every other scope still returned');
  });
});

test('PROJECT_INVALID / WORKSPACE_INVALID refusal matrix', async () => {
  await withWiki(async () => {
    const bad = ['..', '.', '...', '.hidden', '../etc', 'a/b', 'x/../y', '', 'a b', 123, {}];
    for (const v of bad) {
      const p = await readIndex({ project: v });
      assert.equal(p.ok, false, `project ${JSON.stringify(v)} refused`);
      assert.equal(p.code, 'PROJECT_INVALID');
      assert.ok(p.reason.length > 0);

      const w = await readIndex({ workspace: v });
      assert.equal(w.ok, false, `workspace ${JSON.stringify(v)} refused`);
      assert.equal(w.code, 'WORKSPACE_INVALID');
    }
  });
});

test('traversal cannot escape wikiRoot — via argument or via resolved workspace', async () => {
  await withWiki(async ({ root, write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('projects/demo/index.md', 'p');
    // wiki/workspaces/../../../index.md would resolve to <PROJECTS_ROOT>/index.md.
    await fs.writeFile(path.join(root, 'index.md'), 'CANARY-OUTSIDE');

    // Layer one: the argument is refused outright.
    const viaArg = await readIndex({ workspace: '../../..' });
    assert.equal(viaArg.code, 'WORKSPACE_INVALID');

    // A hostile *resolved* name is skipped, not refused — and must not be read.
    for (const ws of ['../../..', 'a/../../../..', '..']) {
      useProjects([{ name: 'demo', workspace: ws }]);
      const r = await readIndex({ project: 'demo' });
      assert.equal(r.ok, undefined);
      assert.equal(r.meta.resolvedWorkspace, ws);
      assert.deepEqual(r.meta.missing, [`workspaces/${ws}/index.md`]);
      for (const body of r.text) {
        assert.equal(body.includes('CANARY-OUTSIDE'), false, `no escape via ${ws}`);
      }
    }
  });
});

test('truncation: over-cap file is cut, marked, and listed in meta.truncated', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'a'.repeat(MAX_FILE_BYTES + 100));
    await write('global/index.md', 'g');

    const r = await readIndex({});
    assert.deepEqual(r.meta.truncated, ['index.md']);
    assert.deepEqual(r.meta.missing, [], 'truncated and missing are disjoint');
    assert.ok(r.text[0].endsWith(`<!-- truncated at ${MAX_FILE_BYTES} bytes -->`));
    assert.ok(r.text[0].includes('a'.repeat(100)));
  });
});

test('truncation cuts on a codepoint boundary, never emitting U+FFFD', async () => {
  await withWiki(async ({ write }) => {
    // A 4-byte emoji straddling the cap: 2 bytes inside, 2 bytes past it.
    const buf = Buffer.concat([
      Buffer.from('a'.repeat(MAX_FILE_BYTES - 2)),
      Buffer.from('🎩'),
    ]);
    assert.equal(buf.length, MAX_FILE_BYTES + 2);
    await write('index.md', buf);
    await write('global/index.md', 'g');

    const r = await readIndex({});
    assert.deepEqual(r.meta.truncated, ['index.md']);
    assert.equal(r.text[0].includes('�'), false, 'no replacement char injected');
    assert.equal(r.text[0].includes('🎩'), false, 'partial codepoint dropped whole');
    const body = r.text[0].slice(header('index.md').length);
    assert.ok(body.startsWith('a'.repeat(MAX_FILE_BYTES - 2)));
  });
});

test('PROJECTS_ROOT is read per call, not cached at import', async () => {
  await withWiki(async ({ wiki, root }) => {
    const first = await readIndex({});
    assert.equal(first.meta.wikiRoot, wiki);

    const second = await freshWiki();
    try {
      const r = await readIndex({});
      assert.notEqual(r.meta.wikiRoot, wiki);
      assert.equal(r.meta.wikiRoot, second.wiki);
    } finally {
      await cleanup(second.root);
      process.env.PROJECTS_ROOT = root;
    }
  });
});

test('envelope: refusal rides in {result}, never {error}', async () => {
  await withWiki(async () => {
    const bad = await handle({ tool: 'read_index', arguments: { project: '..' }, caller: { sessionId: 'x', project: 'y' } });
    assert.equal(bad.status, 200);
    assert.equal(bad.body.error, undefined, 'a refusal must not be thrown at the model');
    assert.equal(bad.body.text, undefined, 'a refusal rides in {result}, not the raw-text channel');
    assert.equal(bad.body.meta, undefined);
    assert.equal(bad.body.result.ok, false);
    assert.equal(bad.body.result.code, 'PROJECT_INVALID');
  });
});

test('isRawTextResult: meta is required, so {text} alone rides in {result}', () => {
  // The predicate gates the raw-text channel. meta must be present so a future
  // handler using `text` for structured data — or a bare {text:"..."} — is NOT
  // hoisted out of {result}. Empty text: [] still qualifies (meta-only result).
  assert.equal(isRawTextResult({ text: 'x' }), false, 'no meta -> not raw-text');
  assert.equal(isRawTextResult({ meta: {}, text: 'x' }), true);
  assert.equal(isRawTextResult({ meta: {}, text: [] }), true, 'empty text array is meta-only raw-text');
  assert.equal(isRawTextResult({ meta: {}, text: [1] }), false, 'non-string text entry rejected');
  assert.equal(isRawTextResult({ ok: false, code: 'X', reason: 'y' }), false, 'refusal not raw-text');
  assert.equal(isRawTextResult(null), false);
  assert.equal(isRawTextResult(undefined), false);
});

test('envelope: missing tool -> 400, unknown tool -> 200 {error}, success -> {text, meta}', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');

    assert.equal((await handle({})).status, 400);
    assert.equal((await handle({ tool: '' })).status, 400);

    const unknown = await handle({ tool: 'write_index', arguments: {} });
    assert.equal(unknown.status, 200);
    assert.match(unknown.body.error, /unknown tool: write_index/);

    const ok = await handle({ tool: 'read_index', arguments: {}, caller: { sessionId: 'x', project: 'y' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.error, undefined);
    assert.equal(ok.body.result, undefined, 'success opts into the raw-text channel, not {result}');
    assert.ok(Array.isArray(ok.body.text));
    assert.ok(ok.body.meta.wikiRoot);
  });
});

test('transport: health, routing, and the non-200 cases', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    const server = createServer();
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const health = await fetch(`${base}/api/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });

      // Query string must not defeat routing.
      assert.equal((await fetch(`${base}/api/health?x=1`)).status, 200);

      const post = async (body, init = {}) => fetch(`${base}/api/mcp`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, ...init,
      });

      const ok = await post(JSON.stringify({ tool: 'read_index', arguments: {}, caller: { sessionId: 'x', project: 'y' } }));
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.text.length, 2);
      assert.equal(body.result, undefined);

      assert.equal((await post('{')).status, 400);
      assert.equal((await post('x'.repeat(300 * 1024))).status, 413);
      assert.equal((await fetch(`${base}/api/mcp`)).status, 405);
      assert.equal((await fetch(`${base}/nope`)).status, 404);
    } finally {
      await new Promise((res) => server.close(res));
    }
  });
});
