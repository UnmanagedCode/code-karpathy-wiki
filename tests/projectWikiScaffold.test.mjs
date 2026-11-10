// Pins what the project-wiki scaffold makes its setup worker do, and runs the
// out-of-tree hook block it hands over in a scratch repo + worktree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8'));
const entry = manifest.conventions.find((c) => c.slug === 'project-wiki');
const scaffold = readFileSync(path.join(ROOT, entry.scaffold.file), 'utf8');

test('asks the user to choose in-tree or out-of-tree', () => {
  assert.ok(scaffold.includes('AskUserQuestion'));
  assert.match(scaffold, /In-tree/);
  assert.match(scaffold, /Out-of-tree/);
  assert.doesNotMatch(scaffold, /relayed/);
});

test('out-of-tree: shared exclude file, append-only hook, no architecture seed', () => {
  assert.ok(scaffold.includes('git rev-parse --git-path info/exclude'));
  assert.ok(scaffold.includes('never overwrite'));
  assert.doesNotMatch(scaffold, /architecture\//);
});

test('the hook block excludes /.wiki once and links the parent wiki', () => {
  const blocks = [...scaffold.matchAll(/```bash\n([\s\S]*?)```/g)];
  assert.equal(blocks.length, 1, 'scaffold carries one bash block');
  const block = blocks[0][1];
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pw-hook-')));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const main = path.join(tmp, 'main');
    const wt = path.join(tmp, 'wt');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');
    mkdirSync(path.join(main, '.wiki'));
    git(main, 'worktree', 'add', '-q', wt);
    const run = () => execFileSync('bash', ['-c', block], { cwd: wt, env: { ...env, CC_PARENT_PATH: main }, stdio: ['ignore', 'pipe', 'pipe'] });
    run();
    run();
    assert.equal(readlinkSync(path.join(wt, '.wiki')), path.join(main, '.wiki'));
    const exclude = path.resolve(wt, git(wt, 'rev-parse', '--git-path', 'info/exclude').trim());
    assert.equal(readFileSync(exclude, 'utf8').split('\n').filter((l) => l === '/.wiki').length, 1);
    assert.equal(git(wt, 'status', '--porcelain'), '', 'the symlink is excluded');
    assert.equal(git(main, 'status', '--porcelain'), '', 'the main checkout directory is excluded');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
