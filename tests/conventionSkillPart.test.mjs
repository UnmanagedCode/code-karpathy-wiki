// Pins the inline / skill split of each convention that carries one.
// code-conductor delivers everything below the one `<!-- cc:skill … -->` line
// as the skill `cc-<scope>-<plugin id>:<slug>`, so a moved or duplicated marker
// silently changes a system prompt. MARKER_START and MARKER copy
// code-conductor's shared/skillPart.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8'));

const MARKER_START = /^<!-- cc:skill(?=[ :]|-->)/;
const MARKER = /^<!-- cc:skill(?::(\S*))?(?: (.*?))? ?-->$/;

function split(slug) {
  const entry = manifest.conventions.find((c) => c.slug === slug);
  const lines = readFileSync(path.join(ROOT, entry.file), 'utf8').split('\n');
  const at = lines.findIndex((l) => MARKER_START.test(l));
  return {
    skillName: `cc-${entry.scope}-${manifest.id}:${entry.slug}`,
    lines,
    at,
    inline: lines.slice(0, at).join('\n'),
    skill: lines.slice(at + 1).join('\n'),
  };
}

const SPLIT = [
  ['orchestrator-wiki', /^Use when writing, editing or maintaining an orchestrator wiki page/],
  ['project-wiki', /^Use when writing or editing a project wiki page/],
];

for (const [slug, opening] of SPLIT) {
  test(`${slug}: exactly one well-formed, unnamed skill marker`, () => {
    const { lines, at, skill } = split(slug);
    assert.ok(at > 0, 'marker present below inline text');
    assert.equal(lines.filter((l) => MARKER_START.test(l)).length, 1);
    const m = MARKER.exec(lines[at].trimEnd());
    assert.ok(m, 'marker parses');
    assert.equal(m[1], undefined, 'a plugin fragment must not name its skill');
    assert.match(m[2], opening);
    assert.match(m[2], /^Use when [^.;]+\.$/, 'one-clause description');
    assert.ok(skill.trim().length > 0, 'non-empty skill body');
  });

  test(`${slug}: inline part names the skill it hands off to`, () => {
    const { inline, skillName } = split(slug);
    assert.ok(inline.includes(skillName));
  });

  test(`${slug}: no line sits in both parts`, () => {
    const { inline, skill } = split(slug);
    const inlineLines = new Set(inline.split('\n').map((l) => l.trim()).filter(Boolean));
    for (const l of skill.split('\n').map((s) => s.trim()).filter(Boolean)) {
      assert.ok(!inlineLines.has(l), `in both parts: ${l}`);
    }
  });
}

test('orchestrator-wiki: inline part keeps what must hold before a write', () => {
  const { inline } = split('orchestrator-wiki');
  assert.ok(inline.includes('code-wiki__read_index'));
  assert.ok(inline.includes('save a memory'));
});

test('orchestrator-wiki: skill part holds the procedure and does not repeat inline rules', () => {
  const { inline, skill } = split('orchestrator-wiki');
  assert.ok(skill.includes('Superseded:'));
  assert.ok(!skill.includes('read_index'));
  assert.ok(!inline.includes('Superseded:'));
});

test('project-wiki: inline part keeps what must act before the skill loads', () => {
  const { inline, skill } = split('project-wiki');
  for (const s of ['.wiki/index.md', 'category index', 'symlink', 'Deferred .wiki edits', 'same diff', 'git check-ignore']) {
    assert.ok(inline.includes(s), `inline has ${s}`);
  }
  assert.ok(!skill.includes('Deferred .wiki edits'), 'the hand-off heading is named once, inline');
});

test('project-wiki: skill part holds the page-writing rules', () => {
  const { inline, skill } = split('project-wiki');
  for (const s of [
    'reviewed: true',
    '[name](path) — hook',
    'category/index.md',
    'never append a correction',
    'Cite code by symbol, constant, test title or bare file path, never a line number',
    "don't paste source",
  ]) {
    assert.ok(skill.includes(s), `skill has ${s}`);
    assert.ok(!inline.includes(s), `inline lacks ${s}`);
  }
  assert.ok(!`${inline}\n${skill}`.includes('path:line'), 'cites names, not positions');
});
