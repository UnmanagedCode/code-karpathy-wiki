import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { _setProjectFetcher } from '../src/projects.js';
import { _setParse, _setMaxWalkEntries } from '../src/snapshot.js';

// Fresh isolated wiki per test. Setting PROJECTS_ROOT is enough: every path
// helper reads it at call time. Never touches the real .conduct/ tree.
export async function freshWiki() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ckw-'));
  process.env.PROJECTS_ROOT = root;
  const wiki = path.join(root, '.conduct', 'wiki');
  await fs.mkdir(wiki, { recursive: true });
  const write = async (rel, data) => {
    const abs = path.join(wiki, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
    return abs;
  };
  return { root, wiki, write };
}

export async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

// Restore every process/module global a test may have touched, so any file
// order passes.
export function resetEnv() {
  delete process.env.PROJECTS_ROOT;
  delete process.env.CONDUCTOR_URL;
  _setProjectFetcher(null);
  _setParse(null);
  _setMaxWalkEntries(null);
}

// Stub the host project list. Returns a call counter so a test can assert the
// fetcher was never reached (the "no conductor context -> no work" contract).
export function useProjects(rows) {
  process.env.CONDUCTOR_URL = 'http://127.0.0.1:0';
  const calls = { n: 0 };
  _setProjectFetcher(async () => { calls.n++; return rows; });
  return calls;
}

// A fetcher that always fails, with CONDUCTOR_URL set.
export function useFailingConductor() {
  process.env.CONDUCTOR_URL = 'http://127.0.0.1:0';
  const calls = { n: 0 };
  _setProjectFetcher(async () => { calls.n++; throw new Error('unreachable'); });
  return calls;
}

// Write a {rel: content} map under dir, creating parents.
export async function writeTree(dir, files) {
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
  }
}

// A project checkout <root>/<name>/ with an in-tree .wiki/, plus the host row
// /api/projects would report for it.
export async function freshProjectWiki(root, name, files) {
  const dir = path.join(root, name);
  await fs.mkdir(path.join(dir, '.wiki'), { recursive: true });
  await writeTree(path.join(dir, '.wiki'), files);
  return { name, path: dir, system: 'local', workspace: null };
}

// Sorted fingerprint of everything under dir (lstat, so symlinks are covered
// by their link text rather than followed): the no-write invariant compares two.
export async function treeDigest(dir) {
  const out = [];
  const walk = async (abs, rel) => {
    const st = await fs.lstat(abs);
    let sum = '';
    if (st.isSymbolicLink()) sum = `-> ${await fs.readlink(abs)}`;
    else if (st.isFile()) sum = createHash('sha256').update(await fs.readFile(abs)).digest('hex');
    out.push(`${rel}|${st.mode}|${st.size}|${st.mtimeMs}|${sum}`);
    if (st.isDirectory()) {
      for (const n of (await fs.readdir(abs)).sort()) await walk(path.join(abs, n), `${rel}/${n}`);
    }
  };
  await walk(dir, '');
  return out;
}
