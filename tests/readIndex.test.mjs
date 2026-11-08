import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readIndex, indexText, ToolRefusal, MAX_FILE_BYTES } from '../src/wiki.js';
import { handle } from '../src/mcp.js';
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
    assert.equal(r.wikiRoot, wiki);
    assert.equal(r.resolvedWorkspace, null);
    assert.deepEqual(r.missing, []);
    assert.equal('truncated' in r, false, 'the data layer has no cap');
    assert.deepEqual(r.indexes.map((i) => i.scope), ['root', 'global']);
    assert.deepEqual(r.indexes.map((i) => i.path), ['index.md', 'global/index.md']);
  });
});

test('bodies are byte-identical to the files after the header', async () => {
  await withWiki(async ({ write }) => {
    const body = '# Orchestrator wiki\n\nUnicode: café — 日本語 🎩\n\ttrailing tab\n';
    await write('index.md', body);
    await write('global/index.md', 'g');

    const r = await readIndex({});
    assert.equal(r.indexes[0].content, body);
    assert.equal(indexText(r).text[0], header('index.md') + body);
    assert.equal(indexText(r).text[1], header('global/index.md') + 'g');
  });
});

test('workspace arg adds its scope', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('workspaces/CC-Dev/index.md', 'w');

    const r = await readIndex({ workspace: 'CC-Dev' });
    assert.equal(r.indexes.length, 3);
    assert.equal(indexText(r).text[2], header('workspaces/CC-Dev/index.md') + 'w');
    assert.equal(r.resolvedWorkspace, null, 'no project given, nothing to resolve');
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
    assert.equal(r.resolvedWorkspace, 'CC-Dev');
    assert.deepEqual(r.missing, []);
    // Broad -> narrow: root, global, workspace, project.
    assert.deepEqual(r.indexes.map((i) => i.path), ['index.md', 'global/index.md', 'workspaces/CC-Dev/index.md', 'projects/demo/index.md']);
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
    assert.equal(r.indexes.length, 4, 'workspace counted once, not twice');
    assert.equal(new Set(r.indexes.map((i) => i.path)).size, 4);
  });
});

test('a missing scope is listed missing with no body, never an error', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    // no global/index.md, no workspaces/CC-Dev/index.md
    const r = await readIndex({ workspace: 'CC-Dev' });
    assert.equal(r.indexes.length, 1);
    assert.deepEqual(r.missing, ['global/index.md', 'workspaces/CC-Dev/index.md']);
  });
});

test('an entirely absent wiki root yields no bodies and no throw', async () => {
  await withWiki(async ({ root }) => {
    process.env.PROJECTS_ROOT = path.join(root, 'nope');
    const r = await readIndex({});
    assert.deepEqual(r.indexes, []);
    assert.deepEqual(r.missing, ['index.md', 'global/index.md']);
    // The empty-text reply is a meta-only {text, meta}.
    const env = await handle({ tool: 'read_index', arguments: {} });
    assert.deepEqual(env.body, {
      text: [],
      meta: { wikiRoot: r.wikiRoot, resolvedWorkspace: null, missing: ['index.md', 'global/index.md'], truncated: [] },
    });
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
    assert.equal(r.resolvedWorkspace, null);
    assert.equal(r.indexes.length, 3, 'project scope still read');
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
    assert.equal(r.resolvedWorkspace, null);
    assert.equal(r.indexes.length, 3);
  });
});

test('project absent from the host list is not a refusal', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');
    await write('projects/ghost/index.md', 'p');
    useProjects([{ name: 'demo', workspace: 'CC-Dev' }]);

    const r = await readIndex({ project: 'ghost' });
    assert.equal(r.resolvedWorkspace, null, 'conducting notes can outlive the project');
    assert.equal(r.indexes.length, 3);
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
    assert.equal(r.resolvedWorkspace, 'CC Dev', 'raw host value still reported');
    assert.deepEqual(r.missing, ['workspaces/CC Dev/index.md']);
    assert.equal(r.indexes.length, 3, 'every other scope still returned');
  });
});

test('PROJECT_INVALID / WORKSPACE_INVALID refusal matrix', async () => {
  await withWiki(async () => {
    const bad = ['..', '.', '...', '.hidden', '../etc', 'a/b', 'x/../y', '', 'a b', 123, {}];
    for (const v of bad) {
      await assert.rejects(readIndex({ project: v }),
        (e) => e instanceof ToolRefusal && e.code === 'PROJECT_INVALID' && e.message.length > 0,
        `project ${JSON.stringify(v)} refused`);
      await assert.rejects(readIndex({ workspace: v }),
        (e) => e instanceof ToolRefusal && e.code === 'WORKSPACE_INVALID' && e.message.length > 0,
        `workspace ${JSON.stringify(v)} refused`);
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
    await assert.rejects(readIndex({ workspace: '../../..' }),
      (e) => e instanceof ToolRefusal && e.code === 'WORKSPACE_INVALID');

    // A hostile *resolved* name is skipped, not refused — and must not be read.
    for (const ws of ['../../..', 'a/../../../..', '..']) {
      useProjects([{ name: 'demo', workspace: ws }]);
      const r = await readIndex({ project: 'demo' });
      assert.equal(r.resolvedWorkspace, ws);
      assert.deepEqual(r.missing, [`workspaces/${ws}/index.md`]);
      for (const { content } of r.indexes) {
        assert.equal(content.includes('CANARY-OUTSIDE'), false, `no escape via ${ws}`);
      }
    }
  });
});

test('truncation: the text view cuts an over-cap file, marks it, and lists it in meta.truncated', async () => {
  await withWiki(async ({ wiki, write }) => {
    await write('index.md', 'a'.repeat(MAX_FILE_BYTES + 100));
    await write('global/index.md', 'g');

    const { meta, text } = indexText(await readIndex({}));
    assert.deepEqual(meta.truncated, ['index.md']);
    assert.deepEqual(meta.missing, [], 'truncated and missing are disjoint');
    assert.ok(text[0].endsWith(`<!-- truncated at ${MAX_FILE_BYTES} bytes; the full page is ${path.join(wiki, 'index.md')} -->`));
    assert.ok(text[0].includes('a'.repeat(100)));
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

    const { meta, text } = indexText(await readIndex({}));
    assert.deepEqual(meta.truncated, ['index.md']);
    assert.equal(text[0].includes('�'), false, 'no replacement char injected');
    assert.equal(text[0].includes('🎩'), false, 'partial codepoint dropped whole');
    const body = text[0].slice(header('index.md').length);
    assert.ok(body.startsWith('a'.repeat(MAX_FILE_BYTES - 2)));
  });
});

test('PROJECTS_ROOT is read per call, not cached at import', async () => {
  await withWiki(async ({ wiki, root }) => {
    const first = await readIndex({});
    assert.equal(first.wikiRoot, wiki);

    const second = await freshWiki();
    try {
      const r = await readIndex({});
      assert.notEqual(r.wikiRoot, wiki);
      assert.equal(r.wikiRoot, second.wiki);
    } finally {
      await cleanup(second.root);
      process.env.PROJECTS_ROOT = root;
    }
  });
});

test('envelope: missing tool -> 400, unknown tool -> 200 TOOL_UNKNOWN, success -> {text, meta}', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    await write('global/index.md', 'g');

    assert.equal((await handle({})).status, 400);
    assert.equal((await handle({ tool: '' })).status, 400);

    const unknown = await handle({ tool: 'write_index', arguments: {} });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.code, 'TOOL_UNKNOWN');
    assert.match(unknown.body.error, /unknown tool: "write_index"/);

    const ok = await handle({ tool: 'read_index', arguments: {}, caller: { sessionId: 'x', project: 'y' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(ok.body).sort(), ['meta', 'text']);
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

      const js = await post(JSON.stringify({ tool: 'read_index', arguments: {}, format: 'json' }));
      assert.equal(js.status, 200);
      const jbody = await js.json();
      assert.deepEqual(Object.keys(jbody), ['structured']);
      assert.equal(jbody.structured.indexes.length, 2);

      assert.equal((await post('{')).status, 400);
      assert.equal((await post('x'.repeat(300 * 1024))).status, 413);
      assert.equal((await fetch(`${base}/api/mcp`)).status, 405);
      assert.equal((await fetch(`${base}/nope`)).status, 404);
    } finally {
      await new Promise((res) => server.close(res));
    }
  });
});

// Pins today's behaviour: read_index follows a symlinked index out of the wiki.
// Adopting the browser's confinedRealpath here is a deliberate follow-up, so
// this test must change with that decision rather than silently.
test('read_index does not apply the browser realpath check (deliberate, see architecture)', async () => {
  await withWiki(async ({ root, wiki, write }) => {
    await write('index.md', 'r');
    await fs.writeFile(path.join(root, 'outside.md'), 'CANARY-SYMLINKED');
    await fs.mkdir(path.join(wiki, 'global'), { recursive: true });
    await fs.symlink(path.join(root, 'outside.md'), path.join(wiki, 'global', 'index.md'));

    const r = await readIndex({});
    assert.deepEqual(r.missing, []);
    assert.equal(r.indexes[1].content, 'CANARY-SYMLINKED');
  });
});
