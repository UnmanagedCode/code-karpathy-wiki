// Pins wording invariants of conventions/orchestrator-wiki.md that its inline /
// skill split test does not. The inline part loads into every conductor's
// system prompt; the part below the `<!-- cc:skill … -->` line loads only when
// the conductor writes or maintains a page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8'));
const entry = manifest.conventions.find((c) => c.slug === 'orchestrator-wiki');
const text = readFileSync(path.join(ROOT, entry.file), 'utf8');
const lines = text.split('\n');
const at = lines.findIndex((l) => l.startsWith('<!-- cc:skill'));
const inline = lines.slice(0, at).join('\n');
const skill = lines.slice(at + 1).join('\n');

// Same wording as the project-wiki convention's citation rule.
const CITE = "cite code by symbol, constant, test title or bare file path, never a line number; don't paste source";

test('skill marker splits the file', () => {
  assert.ok(at > 0, 'marker present below inline text');
});

test('cites names, not positions: no path:line anywhere', () => {
  assert.ok(!text.includes('path:line'));
});

test('the cite-by-name rule lives in the skill part only', () => {
  assert.ok(skill.toLowerCase().includes(CITE), 'skill states the rule');
  assert.ok(!inline.toLowerCase().includes('line number'), 'inline does not');
});

test('inline routing does not assume an in-tree project wiki', () => {
  assert.doesNotMatch(inline, /in-tree/i);
});
