import { promises as fs } from 'node:fs';
import path from 'node:path';

// Workspace resolution. The conductor injects CONDUCTOR_URL when it spawns this
// plugin; its /api/projects rows carry the authoritative `workspace` field.
// There is deliberately NO filesystem fallback — workspace membership is host
// state with no on-disk representation we may read, so with no conductor
// context the answer is simply "unknown".

// Loopback: if the conductor can't answer in time it is wedged. The timeout stays
// well inside the host's 30s MCP budget; a timed-out lookup is logged and reported.
const FETCH_TIMEOUT_MS = 10_000;

// Seam for tests: swap the project fetcher so resolution never touches the
// network. Pass null to restore the default.
let fetchProjectsImpl = defaultFetchProjects;
export function _setProjectFetcher(fn) {
  fetchProjectsImpl = fn ?? defaultFetchProjects;
}

// The reason a lookup failed, for the log and the browser. fetch's own message is
// often just "fetch failed", so the socket error code (ECONNREFUSED…) is appended.
function reasonOf(e) {
  return e.cause?.code ? `${e.message} (${e.cause.code})` : e.message;
}

// Returns the raw /api/projects list. Throws on any transport failure or a body
// without a project list; callers log the reason and map it to "unknown".
async function defaultFetchProjects() {
  const res = await fetch(`${process.env.CONDUCTOR_URL}/api/projects`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`conductor /api/projects returned ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data?.projects;
}

// Never throws, never refuses: every failure mode (no CONDUCTOR_URL, network
// error, timeout, non-200, non-JSON, project absent from the list, project with
// no workspace) collapses to null, reported as meta.resolvedWorkspace:null.
// A failed lookup is also logged to stderr, so the reason is not lost.
// The CONDUCTOR_URL guard sits HERE, ahead of the fetcher, so "no conductor
// context" does no work at all — no network, and no filesystem either.
export async function workspaceForProject(name) {
  if (!process.env.CONDUCTOR_URL) return null;
  let list;
  try {
    list = await fetchProjectsImpl();
    if (!Array.isArray(list)) throw new Error('no project list in the response');
  } catch (e) {
    console.warn(`code-wiki: workspace lookup for "${name}" failed: ${reasonOf(e)}`);
    return null;
  }
  const row = list.find((p) => p && typeof p === 'object' && p.name === name);
  const ws = row?.workspace;
  return typeof ws === 'string' && ws !== '' ? ws : null;
}

// Project wikis the browser can list: host rows on the local system whose base
// checkout has a .wiki/ directory. Same "no conductor context -> no work" guard
// as workspaceForProject. A failed lookup yields no sources plus the reason in
// `error` (and a stderr log), so the browser can say why projects are missing.
// A row with no `system` field (older host) counts as local. The name is only a
// label and an id — the directory comes from the row's `path`, never from the name.
export async function localProjectWikis() {
  if (!process.env.CONDUCTOR_URL) return { sources: [], error: null };
  let list;
  try {
    list = await fetchProjectsImpl();
    if (!Array.isArray(list)) throw new Error('no project list in the response');
  } catch (e) {
    const error = reasonOf(e);
    console.warn(`code-wiki: project wiki lookup failed: ${error}`);
    return { sources: [], error };
  }
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
  return { sources: out, error: null };
}
