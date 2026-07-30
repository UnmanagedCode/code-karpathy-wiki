import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _setProjectFetcher } from '../src/projects.js';

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
