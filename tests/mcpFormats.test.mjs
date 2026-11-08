import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../src/mcp.js';
import { MAX_FILE_BYTES } from '../src/wiki.js';
import { validate } from './_jsonSchemaSubset.mjs';
import { freshWiki, cleanup, resetEnv, useProjects } from './_helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { outputSchema } = JSON.parse(readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8')).mcp.tools[0];

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

// Every json reply in this file goes through here: envelope shape plus the
// manifest outputSchema.
async function jsonCall(args) {
  const { status, body } = await handle({ tool: 'read_index', arguments: args, format: 'json' });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body), ['structured']);
  assert.deepEqual(validate(outputSchema, body.structured), []);
  return body.structured;
}

async function textCall(args, extra = {}) {
  const { status, body } = await handle({ tool: 'read_index', arguments: args, format: 'text', ...extra });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['meta', 'text']);
  assert.deepEqual(Object.keys(body.meta).sort(), ['missing', 'resolvedWorkspace', 'truncated', 'wikiRoot']);
  for (const entry of body.text) {
    assert.match(entry, /^<!-- \.conduct\/wiki\/[^\n]+ -->\n\n/);
    assert.throws(() => JSON.parse(entry), 'a text entry is prose, not JSON');
  }
  return body;
}

// Pins: json and text agree on every degenerate layout, and every json reply
// satisfies the manifest outputSchema.
test('degenerate layouts: json validates and agrees with text', async () => {
  const fixtures = [
    ['absent wiki root', async ({ root }) => { process.env.PROJECTS_ROOT = path.join(root, 'nope'); }, {}],
    ['empty wiki dir', async () => {}, {}],
    ['empty index files', async ({ write }) => { await write('index.md', ''); await write('global/index.md', ''); }, {}],
    ['root only', async ({ write }) => { await write('index.md', 'r'); }, {}],
    ['all four scopes', async ({ write }) => {
      await write('index.md', 'r'); await write('global/index.md', 'g');
      await write('workspaces/CC-Dev/index.md', 'w'); await write('projects/demo/index.md', 'p');
      useProjects([{ name: 'demo', workspace: 'CC-Dev' }]);
    }, { project: 'demo' }],
    ['unaddressable resolved workspace', async ({ write }) => {
      await write('index.md', 'r'); useProjects([{ name: 'demo', workspace: 'CC Dev' }]);
    }, { project: 'demo' }],
    ['hostile resolved workspace', async ({ write }) => {
      await write('index.md', 'r'); useProjects([{ name: 'demo', workspace: '../../..' }]);
    }, { project: 'demo' }],
    ['global index is a directory', async ({ write }) => { await write('index.md', 'r'); await write('global/index.md/x', 'x'); }, {}],
  ];
  for (const [label, setup, args] of fixtures) {
    await withWiki(async (w) => {
      await setup(w);
      const s = await jsonCall(args);
      const t = await textCall(args);
      assert.deepEqual(t.meta.missing, s.missing, label);
      assert.equal(t.meta.wikiRoot, s.wikiRoot, label);
      assert.equal(t.meta.resolvedWorkspace, s.resolvedWorkspace, label);
      assert.equal(t.text.length, s.indexes.length, label);
      s.indexes.forEach((ix, i) => {
        assert.equal(t.text[i], `<!-- .conduct/wiki/${ix.path} -->\n\n${ix.content}`, label);
      });
    });
  }
});

// Pins: each index is tagged with its scope and name, broad to narrow.
test('scope tagging', async () => {
  await withWiki(async ({ write }) => {
    for (const f of ['index.md', 'global/index.md', 'workspaces/CC-Dev/index.md', 'projects/demo/index.md']) await write(f, 'x');
    useProjects([{ name: 'demo', workspace: 'CC-Dev' }]);
    const s = await jsonCall({ project: 'demo', workspace: 'CC-Dev' });
    assert.deepEqual(s.indexes.map((i) => [i.scope, i.name, i.path]), [
      ['root', null, 'index.md'],
      ['global', null, 'global/index.md'],
      ['workspace', 'CC-Dev', 'workspaces/CC-Dev/index.md'],
      ['project', 'demo', 'projects/demo/index.md'],
    ]);
  });
});

// Pins: a host that sends no format gets the text reply.
test('no format means text', async () => {
  await withWiki(async ({ write }) => {
    await write('index.md', 'r');
    const none = await handle({ tool: 'read_index', arguments: {} });
    const text = await handle({ tool: 'read_index', arguments: {}, format: 'text' });
    assert.deepEqual(none, text);
  });
});

// Pins: any present format other than "text"/"json" (null included) is FORMAT_UNKNOWN.
test('unknown format is refused', async () => {
  for (const format of ['xml', 'JSON', '', null, 1, {}]) {
    const { status, body } = await handle({ tool: 'read_index', arguments: {}, format });
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['code', 'error']);
    assert.equal(body.code, 'FORMAT_UNKNOWN');
    assert.equal(typeof body.error, 'string');
  }
});

// Pins: prototype-property names are unknown tools and never executed.
test('prototype names are TOOL_UNKNOWN in both formats', async () => {
  for (const tool of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
    for (const format of ['text', 'json']) {
      const { status, body } = await handle({ tool, arguments: {}, format });
      assert.equal(status, 200, tool);
      assert.equal(body.code, 'TOOL_UNKNOWN', tool);
      assert.deepEqual(Object.keys(body).sort(), ['code', 'error']);
    }
  }
});

// Pins: every refusal is exactly {error, code}, identical in both formats.
test('refusal shapes are {error, code} and identical across formats', async () => {
  const cases = [
    [{ tool: 'read_index', arguments: { project: '..' } }, 'PROJECT_INVALID'],
    [{ tool: 'read_index', arguments: { workspace: 'a/b' } }, 'WORKSPACE_INVALID'],
    [{ tool: 'read_index', arguments: [] }, 'BAD_REQUEST'],
    [{ tool: 'read_index', arguments: 'x' }, 'BAD_REQUEST'],
    [{ tool: 'write_index', arguments: {} }, 'TOOL_UNKNOWN'],
  ];
  await withWiki(async () => {
    for (const [req, code] of cases) {
      const tr = await handle({ ...req, format: 'text' });
      const jr = await handle({ ...req, format: 'json' });
      assert.equal(tr.status, 200, code);
      assert.equal(jr.status, 200, code);
      const t = tr.body;
      const j = jr.body;
      for (const body of [t, j]) {
        assert.deepEqual(Object.keys(body).sort(), ['code', 'error']);
        assert.equal(body.code, code);
        assert.match(body.code, /^[A-Z][A-Z0-9_]*$/);
        assert.ok(body.error.length > 0);
        for (const k of ['ok', 'result', 'structured', 'text', 'details']) assert.equal(k in body, false, k);
      }
      assert.deepEqual(t, j);
    }
  });
});

// Pins: an unexpected throw is INTERNAL with the message, not a bare error.
test('unexpected throw is INTERNAL', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const { status, body } = await handle({ tool: 'read_index', arguments: { get project() { throw new Error('boom'); } } });
    assert.equal(status, 200);
    assert.match(body.error, /read_index failed unexpectedly: boom/);
    assert.equal(body.code, 'INTERNAL');
  } finally {
    console.error = origError;
  }
});

// Pins: a malformed envelope is the one 400, and it carries BAD_REQUEST.
test('envelope: missing or empty tool is 400 BAD_REQUEST', async () => {
  for (const req of [{}, { tool: '' }]) {
    const { status, body } = await handle(req);
    assert.equal(status, 400);
    assert.equal(body.code, 'BAD_REQUEST');
  }
});

// Pins: the per-file cap is removed from json and kept (with the full path in
// the marker) in text.
test('removed-cap tripwire: json whole, text still cut', async () => {
  await withWiki(async ({ wiki, write }) => {
    const big = 'é'.repeat(MAX_FILE_BYTES) + 'END';
    await write('index.md', big);
    const s = await jsonCall({});
    assert.equal(s.indexes[0].content, big);
    assert.equal('truncated' in s, false);
    const t = await textCall({});
    assert.deepEqual(t.meta.truncated, ['index.md']);
    assert.ok(t.text[0].endsWith(`<!-- truncated at ${MAX_FILE_BYTES} bytes; the full page is ${path.join(wiki, 'index.md')} -->`));
  });
});
