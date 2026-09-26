import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from './markdown.js';
import { confinedRealpath, ESCAPES } from './paths.js';
import { truncateUtf8 } from './wiki.js';
import { linkContext, resolveWiki, resolveHref } from './links.js';

// A page over this is cut on a codepoint boundary and flagged `truncated`.
export const MAX_PAGE_BYTES = 1024 * 1024;

export function isArchived(source, rel) {
  return source.kind === 'orchestrator' && (rel === 'global/archive' || rel.startsWith('global/archive/'));
}

function parseEntry(text, rel, truncated = false) {
  const { frontmatter, blocks, links, title } = parse(text, path.posix.basename(rel, '.md'));
  return { text, lower: text.toLowerCase(), truncated, frontmatter, blocks, links, title };
}

// Snapshot from already-read pages: rel -> text (tests) or rel -> parsed entry
// (loadSnapshot). Cached entries are shared across snapshots and never mutated;
// each snapshot keeps its own resolutions in page.res, indexed by link node `i`.
export function buildSnapshot(source, files, dirs) {
  const pages = new Map();
  const input = files instanceof Map ? files : new Map(Object.entries(files));
  for (const [rel, v] of [...input].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const entry = typeof v === 'string' ? parseEntry(v, rel) : v;
    pages.set(rel, { ...entry, archived: isArchived(source, rel), res: [] });
  }
  const ctx = linkContext(source.kind, new Set(pages.keys()), dirs);
  const backlinks = new Map();
  for (const [rel, page] of pages) {
    page.res = page.links.map((l) => (l.form === 'wiki' ? resolveWiki(l.ref, rel, ctx) : resolveHref(l.href, rel, ctx)));
    for (const r of page.res) {
      if (r.kind !== 'page' || r.target === rel) continue;
      if (!backlinks.has(r.target)) backlinks.set(r.target, new Set());
      backlinks.get(r.target).add(rel);
    }
  }
  const sortedBacklinks = new Map([...backlinks].map(([t, s]) => [t, [...s].sort()]));
  return { source, pages, dirs: ctx.dirs, backlinks: sortedBacklinks };
}

// A deep copy of a page's blocks with this snapshot's resolution merged into
// every link node — the shape /api/page returns and render.js consumes.
export function annotatedBlocks(page) {
  return JSON.parse(JSON.stringify(page.blocks), (k, v) => {
    if (v && typeof v === 'object' && v.t === 'link') {
      const { i, ...rest } = v;
      return { ...rest, ...page.res[i] };
    }
    return v;
  });
}

// realpath -> {key, entry}: unchanged files (same mtime and size) are neither
// re-read nor re-parsed. One slot per file, so it is bounded by the tree.
const cache = new Map();

async function readEntry(real, rel) {
  const st = await fs.stat(real);
  const key = `${st.mtimeMs}|${st.size}`;
  const hit = cache.get(real);
  if (hit && hit.key === key) return hit.entry;
  const buf = await fs.readFile(real);
  const entry = buf.length > MAX_PAGE_BYTES
    ? parseEntry(truncateUtf8(buf, MAX_PAGE_BYTES), rel, true)
    : parseEntry(buf.toString('utf8'), rel);
  cache.set(real, { key, entry });
  return entry;
}

// Walk the source on every call: dot-prefixed entries are skipped, symlinks
// are followed only when their realpath stays under the root, and a directory
// already on the current path (a cycle) is not re-entered. Page keys are the
// logical rel paths, not realpaths.
export async function loadSnapshot(source) {
  let rootReal;
  try {
    rootReal = await fs.realpath(source.root);
    if (!(await fs.stat(rootReal)).isDirectory()) throw new Error('not a dir');
  } catch {
    return buildSnapshot(source, new Map(), new Set(['']));
  }
  const files = new Map();
  const dirs = new Set(['']);

  const walk = async (relDir, stack) => {
    let ents;
    try {
      ents = await fs.readdir(path.join(rootReal, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(ents.map(async (ent) => {
      if (ent.name.startsWith('.')) return;
      const rel = relDir === '' ? ent.name : `${relDir}/${ent.name}`;
      const real = await confinedRealpath(rootReal, rel);
      if (real === null || real === ESCAPES) return;
      let st;
      try {
        st = await fs.stat(real);
      } catch {
        return;
      }
      if (st.isDirectory()) {
        if (stack.includes(real)) return;
        dirs.add(rel);
        await walk(rel, [...stack, real]);
      } else if (st.isFile() && ent.name.endsWith('.md')) {
        try {
          files.set(rel, await readEntry(real, rel));
        } catch {
          // Vanished or unreadable between readdir and read: not a page.
        }
      }
    }));
  };
  await walk('', [rootReal]);
  const snap = buildSnapshot(source, files, dirs);
  snap.rootReal = rootReal;
  return snap;
}
