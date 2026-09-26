import { promises as fs } from 'node:fs';
import path from 'node:path';

// Workspace resolution. The conductor injects CONDUCTOR_URL when it spawns this
// plugin; its /api/projects rows carry the authoritative `workspace` field.
// There is deliberately NO filesystem fallback — workspace membership is host
// state with no on-disk representation we may read, so with no conductor
// context the answer is simply "unknown".

// Loopback: if the conductor can't answer in 2s it is wedged. Blocking the whole
// tool for the host's 30s MCP budget to fetch one optional extra index is a bad
// trade — every other scope resolves without it.
const FETCH_TIMEOUT_MS = 2000;

// Seam for tests: swap the project fetcher so resolution never touches the
// network. Pass null to restore the default.
let fetchProjectsImpl = defaultFetchProjects;
export function _setProjectFetcher(fn) {
  fetchProjectsImpl = fn ?? defaultFetchProjects;
}

// Returns the raw /api/projects list. Throws on any transport failure; the
// caller maps that to "unknown workspace" rather than letting it reach the model.
async function defaultFetchProjects() {
  const res = await fetch(`${process.env.CONDUCTOR_URL}/api/projects`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`conductor /api/projects returned ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data?.projects ?? []);
  return Array.isArray(list) ? list : [];
}

// Never throws, never refuses: every failure mode (no CONDUCTOR_URL, network
// error, timeout, non-200, non-JSON, project absent from the list, project with
// no workspace) collapses to null, reported as meta.resolvedWorkspace:null.
// The CONDUCTOR_URL guard sits HERE, ahead of the fetcher, so "no conductor
// context" does no work at all — no network, and no filesystem either.
export async function workspaceForProject(name) {
  if (!process.env.CONDUCTOR_URL) return null;
  let list;
  try {
    list = await fetchProjectsImpl();
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const row = list.find((p) => p && typeof p === 'object' && p.name === name);
  const ws = row?.workspace;
  return typeof ws === 'string' && ws !== '' ? ws : null;
}

// Project wikis the browser can list: host rows on the local system whose base
// checkout has a .wiki/ directory. Same "no conductor context -> no work" guard
// as workspaceForProject, and every failure collapses to []. A row with no
// `system` field (older host) counts as local. The name is only a label and an
// id — the directory comes from the row's `path`, never from the name.
export async function localProjectWikis() {
  if (!process.env.CONDUCTOR_URL) return [];
  let list;
  try {
    list = await fetchProjectsImpl();
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string' || row.name === '') continue;
    if ((row.system ?? 'local') !== 'local') continue;
    if (typeof row.path !== 'string' || row.path === '' || !path.isAbsolute(row.path)) continue;
    const id = `p:${row.name}`;
    if (out.some((s) => s.id === id)) continue;
    const root = path.join(row.path, '.wiki');
    try {
      if (!(await fs.stat(root)).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({ id, kind: 'project', label: row.name, root });
  }
  return out;
}
