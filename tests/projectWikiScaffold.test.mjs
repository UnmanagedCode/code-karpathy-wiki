// Pins what the project-wiki scaffold makes its setup worker do, and runs the
// out-of-tree hook block it hands over in scratch repos + worktrees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'conductor.plugin.json'), 'utf8'));
const entry = manifest.conventions.find((c) => c.slug === 'project-wiki');
const scaffold = readFileSync(path.join(ROOT, entry.scaffold.file), 'utf8');

function hookBlock() {
  const blocks = [...scaffold.matchAll(/```bash\n([\s\S]*?)```/g)];
  assert.equal(blocks.length, 1, 'scaffold carries one bash block');
  return blocks[0][1];
}

// A main checkout and a worktree in a scratch dir. HOME and XDG_CONFIG_HOME
// point inside that dir, so git reads neither the host's global config nor its
// global ignore file ($XDG_CONFIG_HOME/git/ignore). CC_* is stripped so an
// inherited hook variable cannot stand in for one the test sets.
function scratchRepo() {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pw-hook-')));
  const home = path.join(tmp, 'home');
  mkdirSync(home);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('CC_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
  };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const main = path.join(tmp, 'main');
  mkdirSync(main);
  git(main, 'init', '-q');
  return { tmp, main, wt: path.join(tmp, 'wt'), env, git };
}

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

// Runs the hook block the way cc does: cwd in the new worktree, CC_WORKTREE_PATH
// and CC_PARENT_PATH set. `prefix` runs first in the same bash, e.g. an
// existing hook's `cd`.
function runBlock(s, block, prefix = '') {
  return execFileSync('bash', ['-c', prefix + block], {
    cwd: s.wt,
    env: { ...s.env, CC_WORKTREE_PATH: s.wt, CC_PARENT_PATH: s.main },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function lexists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

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
  const block = hookBlock();
  const s = scratchRepo();
  try {
    s.git(s.main, ...IDENT, 'commit', '-q', '--allow-empty', '-m', 'init');
    mkdirSync(path.join(s.main, '.wiki'));
    writeFileSync(path.join(s.main, '.wiki', 'index.md'), '# seeded\n');
    s.git(s.main, 'worktree', 'add', '-q', s.wt);
    runBlock(s, block);
    runBlock(s, block);
    assert.equal(readlinkSync(path.join(s.wt, '.wiki')), path.join(s.main, '.wiki'));
    // Rerun invariant: the link is made only when `.wiki` is absent, so the main
    // checkout's `.wiki` holds exactly what was seeded. A guard-less `ln -s`
    // would plant `<main>/.wiki/.wiki` on the second run, since `.wiki` is then
    // a symlink to a directory.
    assert.deepEqual(readdirSync(path.join(s.main, '.wiki')).sort(), ['index.md']);
    const exclude = path.resolve(s.wt, s.git(s.wt, 'rev-parse', '--git-path', 'info/exclude').trim());
    assert.equal(readFileSync(exclude, 'utf8').split('\n').filter((l) => l === '/.wiki').length, 1);
    assert.equal(s.git(s.wt, 'status', '--porcelain'), '', 'the symlink is excluded');
    assert.equal(s.git(s.main, 'status', '--porcelain'), '', 'the main checkout directory is excluded');
  } finally {
    rmSync(s.tmp, { recursive: true, force: true });
  }
});

test('the hook block links the worktree root when an earlier hook left the cwd in a subdirectory', () => {
  const block = hookBlock();
  const s = scratchRepo();
  try {
    mkdirSync(path.join(s.main, 'sub'));
    writeFileSync(path.join(s.main, 'sub', 'keep'), 'keep\n');
    s.git(s.main, 'add', 'sub/keep');
    s.git(s.main, ...IDENT, 'commit', '-q', '-m', 'init');
    mkdirSync(path.join(s.main, '.wiki'));
    s.git(s.main, 'worktree', 'add', '-q', s.wt);
    runBlock(s, block, 'cd sub\n');
    assert.equal(readlinkSync(path.join(s.wt, '.wiki')), path.join(s.main, '.wiki'));
    assert.equal(lexists(path.join(s.wt, 'sub', '.wiki')), false, 'no link in the subdirectory');
    assert.equal(s.git(s.wt, 'status', '--porcelain'), '', 'the worktree is clean');
  } finally {
    rmSync(s.tmp, { recursive: true, force: true });
  }
});
