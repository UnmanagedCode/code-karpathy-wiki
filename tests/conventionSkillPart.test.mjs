// Pins the inline / skill split of conventions/orchestrator-wiki.md. code-conductor
// delivers everything below the one `<!-- cc:skill … -->` line as a skill, so a
// moved or duplicated marker silently changes the conductor's system prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8'));
const entry = manifest.conventions.find((c) => c.slug === 'orchestrator-wiki');
const lines = readFileSync(path.join(ROOT, entry.file), 'utf8').split('\n');

const MARKER_START = /^<!-- cc:skill(?=[ :]|-->)/;
const MARKER = /^<!-- cc:skill(?::(\S*))?(?: (.*?))? ?-->$/;
const at = lines.findIndex((l) => MARKER_START.test(l));
const inline = lines.slice(0, at).join('\n');
const skill = lines.slice(at + 1).join('\n');

test('exactly one well-formed, unnamed skill marker', () => {
  assert.ok(at > 0, 'marker present below inline text');
  assert.equal(lines.filter((l) => MARKER_START.test(l)).length, 1);
  const m = MARKER.exec(lines[at].trimEnd());
  assert.ok(m, 'marker parses');
  assert.equal(m[1], undefined, 'a plugin fragment must not name its skill');
  assert.match(m[2], /^Use when writing, editing or maintaining an orchestrator wiki page/);
});

test('inline part keeps what must hold before a write', () => {
  assert.ok(inline.includes('code-wiki__read_index'));
  assert.ok(inline.includes('save a memory'));
  assert.ok(inline.includes(`cc-conductor-${manifest.id}:${entry.slug}`), 'names the skill it hands off to');
});

test('skill part holds the procedure and does not repeat inline rules', () => {
  assert.ok(skill.trim().length > 0);
  assert.ok(skill.includes('Superseded:'));
  assert.ok(!skill.includes('read_index'));
  assert.ok(!inline.includes('Superseded:'));
});
