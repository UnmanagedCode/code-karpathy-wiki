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
  assert.equal(manifest.id, 'code-wiki');
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

// Mirrors validateFrontend in code-conductor: only path/navLabel, and a
// frontend requires a backend. mcp.scope stays unset — scope:"workspace" is
// recognised-but-rejected at manifest load.
test('frontend block shape, and no mcp scope key', () => {
  const fe = manifest.frontend;
  assert.ok(fe && typeof fe === 'object');
  for (const k of Object.keys(fe)) assert.ok(['path', 'navLabel'].includes(k), `frontend key ${k}`);
  assert.equal(fe.path, '/');
  assert.equal(typeof fe.navLabel, 'string');
  assert.ok(fe.navLabel.trim().length > 0);
  assert.ok(manifest.backend, 'frontend requires backend');
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
  for (const ok of ['code-kanban', 'CC-Dev', 'a', 'x_1.2', 'code-karpathy-wiki', 'code-wiki']) {
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

// The backend runs on node: built-ins only, so no runtime dependency; the UI is
// devDependencies, built into frontend/dist by `npm install` (`prepare`), which
// cc's Library entry runs on Install and Update.
const UI_DEV_DEPS = ['vite', '@vitejs/plugin-react', '@tailwindcss/vite', 'tailwindcss', 'tw-animate-css', 'typescript',
  'react', 'react-dom', '@types/react', '@types/react-dom', 'radix-ui', 'class-variance-authority', 'clsx', 'tailwind-merge',
  'lucide-react', 'sonner', 'vitest', 'happy-dom', '@testing-library/react', '@testing-library/user-event'];

test('package.json: no runtime dependencies; the UI is devDependencies built on install', () => {
  assert.equal(pkg.dependencies, undefined);
  for (const d of UI_DEV_DEPS) assert.ok(pkg.devDependencies?.[d], `devDependency ${d}`);
  assert.equal(pkg.scripts.prepare, 'vite build --config frontend/vite.config.ts');
  assert.match(pkg.scripts.test, /^node tests\/run\.mjs && /);
  assert.match(pkg.scripts.test, /npm run typecheck/);
  assert.match(pkg.scripts.test, /npm run test:web/);
  assert.equal(pkg.scripts.start, 'node server.js');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22.12.0');
  assert.equal(pkg.license, 'AGPL-3.0-or-later');
});

// Install must leave the checkout clean, or cc's Update (git pull --ff-only) refuses.
test('.gitignore covers what npm install writes', () => {
  const lines = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  for (const l of ['node_modules/', 'frontend/dist/', 'package-lock.json']) assert.ok(lines.includes(l), l);
});
