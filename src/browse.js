import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSources, getSource } from './sources.js';
import { validateRelPath, confinedRealpath, ESCAPES } from './paths.js';
import { loadSnapshot, annotatedBlocks, isArchived } from './snapshot.js';
import { lintSnapshot, staleEntry, isLowConfidence } from './lint.js';
import { queryTerms, search } from './search.js';
import { isIndex } from './links.js';

// The read-only browser API. handle() returns {status, body} for a browser
// route, or null so the server falls through to static assets. These routes
// are not MCP: errors are real HTTP statuses with {error, code}.

const fail = (status, code, error) => ({ status, body: { error, code } });
const ok = (body) => ({ status: 200, body });

async function sourceParam(params) {
  const id = params.get('source');
  if (!id) return { err: fail(400, 'SOURCE_REQUIRED', 'source is required') };
  const source = await getSource(id);
  if (!source) return { err: fail(404, 'SOURCE_UNKNOWN', `unknown source: ${id}`) };
  return { source };
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Directory-driven tree: each dir's index.md is its landing page, not a child.
function buildTree(snap) {
  const nodes = new Map();
  const node = (rel) => {
    if (!nodes.has(rel)) {
      nodes.set(rel, {
        name: rel === '' ? '' : path.posix.basename(rel),
        path: rel,
        index: null,
        archived: isArchived(snap.source, rel),
        error: snap.dirErrors.has(rel) ? 'READ_FAILED' : null,
        dirs: [],
        pages: [],
      });
    }
    return nodes.get(rel);
  };
  for (const d of [...snap.dirs].sort()) {
    const n = node(d);
    if (d !== '') node(path.posix.dirname(d) === '.' ? '' : path.posix.dirname(d)).dirs.push(n);
  }
  for (const [rel, page] of snap.pages) {
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    const parent = node(dir);
    if (isIndex(rel)) parent.index = rel;
    else parent.pages.push({ path: rel, name: path.posix.basename(rel, '.md'), title: page.title });
  }
  for (const n of nodes.values()) { n.dirs.sort(byName); n.pages.sort(byName); }
  return node('');
}

async function page(params) {
  const { source, err } = await sourceParam(params);
  if (err) return err;
  const rel = validateRelPath(params.get('path'));
  if (rel === null) return fail(400, 'PATH_INVALID', 'path must be a relative .md path with no dot segments');
  let rootReal;
  try {
    rootReal = await fs.realpath(source.root);
  } catch {
    return fail(404, 'NOT_FOUND', `no such page: ${rel}`);
  }
  const real = await confinedRealpath(rootReal, rel);
  if (real === ESCAPES) return fail(403, 'PATH_ESCAPES', `path resolves outside the wiki: ${rel}`);
  if (real === null) return fail(404, 'NOT_FOUND', `no such page: ${rel}`);
  try {
    if (!(await fs.stat(real)).isFile()) return fail(404, 'NOT_FOUND', `no such page: ${rel}`);
  } catch {
    return fail(404, 'NOT_FOUND', `no such page: ${rel}`);
  }
  const snap = await loadSnapshot(source);
  const p = snap.pages.get(rel);
  if (!p) return fail(404, 'NOT_FOUND', `no such page: ${rel}`);
  return ok({
    source: source.id,
    path: rel,
    title: p.title,
    frontmatter: p.frontmatter,
    blocks: annotatedBlocks(p),
    backlinks: (snap.backlinks.get(rel) ?? []).map((b) => ({ path: b, title: snap.pages.get(b).title })),
    archived: p.archived,
    truncated: p.truncated,
    error: p.error,
    stale: staleEntry(p.frontmatter, new Date()) !== null,
    lowConfidence: isLowConfidence(p.frontmatter),
  });
}

const routes = {
  '/api/sources': async () => {
    const { sources, projectsError } = await listSources();
    return ok({
      sources: sources.map(({ id, kind, label }) => ({ id, kind, label })),
      conductor: Boolean(process.env.CONDUCTOR_URL),
      // Present only when the host project lookup failed.
      ...(projectsError && { projectsError }),
    });
  },
  '/api/tree': async (params) => {
    const { source, err } = await sourceParam(params);
    if (err) return err;
    const snap = await loadSnapshot(source);
    return ok({ source: source.id, tree: buildTree(snap), truncated: snap.truncated });
  },
  '/api/page': page,
  '/api/lint': async (params) => {
    const { source, err } = await sourceParam(params);
    if (err) return err;
    return ok(lintSnapshot(await loadSnapshot(source)));
  },
  '/api/search': async (params) => {
    const q = params.get('q');
    const terms = queryTerms(q);
    if (!terms) return fail(400, 'QUERY_INVALID', 'q must be 2-200 characters after trimming');
    let sources;
    if (params.has('source')) {
      const { source, err } = await sourceParam(params);
      if (err) return err;
      sources = [source];
    } else {
      ({ sources } = await listSources());
    }
    const snaps = await Promise.all(sources.map(loadSnapshot));
    return ok({ q: q.trim(), ...search(snaps, terms) });
  },
};

export async function handle(pathname, params) {
  const fn = Object.hasOwn(routes, pathname) ? routes[pathname] : null;
  return fn ? fn(params) : null;
}
