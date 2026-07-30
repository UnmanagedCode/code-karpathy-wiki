import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEGMENT_RE } from '../src/paths.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Mirrors code-conductor/src/plugins/manifest.js: a tool inputSchema property
// may only use these keys, and may not nest another object schema.
const ALLOWED_PROP_KEYS = new Set([
  'type', 'description', 'enum', 'minLength', 'maxLength',
  'pattern', 'minimum', 'maximum', 'items', 'default',
]);
const FORBIDDEN = ['$ref', 'oneOf', 'anyOf', 'allOf', 'not'];

test('manifest identity + version matches package.json', () => {
  assert.equal(manifest.id, 'code-karpathy-wiki');
  assert.equal(manifest.pluginApi, 1);
  assert.equal(manifest.version, pkg.version);
});

test('backend + mcp blocks: mcp requires backend', () => {
  assert.equal(manifest.backend.start, 'node server.js');
  assert.equal(manifest.backend.healthPath, '/api/health');
  assert.equal(manifest.mcp.endpoint, '/api/mcp');
  assert.ok(Array.isArray(manifest.mcp.tools) && manifest.mcp.tools.length === 1);
  assert.equal(manifest.mcp.tools[0].name, 'read_index');
});

// scope:"workspace" is recognised-but-rejected at manifest load, and a frontend
// is an explicit non-goal — both would change how the host treats this plugin.
test('no frontend block, and no mcp scope key', () => {
  assert.equal(manifest.frontend, undefined);
  assert.equal(manifest.mcp.scope, undefined);
});

test('every tool inputSchema obeys the flat-schema subset', () => {
  for (const tool of manifest.mcp.tools) {
    assert.ok(tool.name && tool.description && tool.inputSchema, `tool ${tool.name} well-formed`);
    const schema = tool.inputSchema;
    assert.equal(schema.type, 'object', `${tool.name} root is object`);
    for (const bad of FORBIDDEN) {
      assert.equal(JSON.stringify(schema).includes(`"${bad}"`), false, `${tool.name} avoids ${bad}`);
    }
    for (const [prop, def] of Object.entries(schema.properties ?? {})) {
      for (const key of Object.keys(def)) {
        assert.ok(ALLOWED_PROP_KEYS.has(key), `${tool.name}.${prop} key "${key}" is allowed`);
      }
      // The flat-schema constraint: `properties` must never appear inside a
      // property definition.
      assert.equal('properties' in def, false, `${tool.name}.${prop} has no nested properties`);
    }
  }
});

test('read_index: both args optional, and declared pattern matches SEGMENT_RE', () => {
  const schema = manifest.mcp.tools[0].inputSchema;
  assert.ok(schema.required === undefined || schema.required.length === 0);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['project', 'workspace']);
  // Pins the manifest layer to the runtime layer so the two cannot drift.
  for (const prop of ['project', 'workspace']) {
    assert.equal(schema.properties[prop].pattern, SEGMENT_RE.source, `${prop} pattern`);
    assert.equal(schema.properties[prop].type, 'string');
    assert.equal(schema.properties[prop].minLength, 1);
    assert.ok(schema.properties[prop].description.length > 0);
  }
});

// The name validator must reject a bare dot-run, not lean on the containment
// assert to catch it.
test('SEGMENT_RE rejects dot segments and accepts real names', () => {
  for (const bad of ['..', '.', '...', '.hidden', 'a/b', '', 'a b', 'a\\b']) {
    assert.equal(SEGMENT_RE.test(bad), false, `rejects ${JSON.stringify(bad)}`);
  }
  for (const ok of ['code-kanban', 'CC-Dev', 'a', 'x_1.2', 'code-karpathy-wiki']) {
    assert.equal(SEGMENT_RE.test(ok), true, `accepts ${ok}`);
  }
});

test('conventions survive the backend addition', () => {
  assert.equal(manifest.conventions.length, 2);
  const byslug = Object.fromEntries(manifest.conventions.map((c) => [c.slug, c]));
  assert.equal(byslug['project-wiki'].scope, 'project');
  assert.equal(byslug['orchestrator-wiki'].scope, 'conductor');
  for (const c of manifest.conventions) {
    assert.ok(existsSync(path.join(ROOT, c.file)), `${c.file} exists`);
    if (c.scaffold?.file) {
      assert.ok(existsSync(path.join(ROOT, c.scaffold.file)), `${c.scaffold.file} exists`);
    }
  }
});

// Hard constraint: this plugin's Plugin Library entry has no postClone hook, so
// any dependency would break a fresh clone.
test('package.json declares zero dependencies', () => {
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.start, 'node server.js');
  assert.ok(pkg.scripts.test);
  assert.equal(pkg.engines.node, '>=18');
  assert.equal(pkg.license, 'AGPL-3.0-or-later');
});
