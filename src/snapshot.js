import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from './markdown.js';
import { confinedRealpath, ESCAPES } from './paths.js';
import { truncateUtf8 } from './wiki.js';
import { linkContext, resolveWiki, resolveHref } from './links.js';

// A page over this is cut on a codepoint boundary and flagged `truncated`.
export const MAX_PAGE_BYTES = 1024 * 1024;

// Hard cap on directory entries visited per source per walk. Symlinked dirs
// inside the root are followed, so a diamond of links can multiply logical
// paths without a cycle; past the cap the snapshot is flagged `truncated`.
export const MAX_WALK_ENTRIES = 20000;

// Test seams, same style as projects.js: pass null to restore the default.
let parseImpl = parse;
export function _setParse(fn) {
  parseImpl = fn ?? parse;
}
let maxWalkEntries = MAX_WALK_ENTRIES;
export function _setMaxWalkEntries(n) {
  maxWalkEntries = n ?? MAX_WALK_ENTRIES;
}

export function isArchived(source, rel) {
  return source.kind === 'orchestrator' && (rel === 'global/archive' || rel.startsWith('global/archive/'));
}

// Parsed content only — nothing derived from the path it was reached by, since
// the cache is keyed by realpath and one file can have several logical paths.
// `title` is the h1 or ''; buildSnapshot applies the basename fallback.
// A parse that throws still yields an entry, flagged `error`.
function parseEntry(text, truncated = false) {
  try {
    const { frontmatter, blocks, links, title } = parseImpl(text, '');
    return { text, lower: text.toLowerCase(), truncated, frontmatter, blocks, links, title, error: null };
  } catch {
    return errorEntry('PARSE_FAILED');
  }
}

function errorEntry(error) {
  return { text: '', lower: '', truncated: false, frontmatter: {}, blocks: [], links: [], title: '', error };
}

// Snapshot from already-read pages: rel -> text (tests) or rel -> parsed entry
// (loadSnapshot). Cached entries are shared across snapshots and never mutated;
// each snapshot keeps its own resolutions in page.res, indexed by link node `i`.
export function buildSnapshot(source, files, dirs) {
  const pages = new Map();
  const input = files instanceof Map ? files : new Map(Object.entries(files));
  for (const [rel, v] of [...input].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const entry = typeof v === 'string' ? parseEntry(v) : v;
    pages.set(rel, { ...entry, title: entry.title || path.posix.basename(rel, '.md'), archived: isArchived(source, rel), res: [] });
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
  return { source, pages, dirs: ctx.dirs, dirErrors: new Set(), backlinks: sortedBacklinks, truncated: false };
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
// Error entries are not cached, so a transient failure clears on the next walk.
const cache = new Map();
export const _parseCached = (real) => cache.has(real);

// At most cap + 1 bytes (the extra byte lets truncateUtf8 see whether the cut
// splits a codepoint), however large the file is or grows to.
async function readBounded(real, cap) {
  const fh = await fs.open(real, 'r');
  try {
    const chunks = [];
    let total = 0;
    while (total <= cap) {
      const want = Math.min(64 * 1024, cap + 1 - total);
      const buf = Buffer.allocUnsafe(want);
      const { bytesRead } = await fh.read(buf, 0, want, total);
      if (bytesRead === 0) break;
      chunks.push(buf.subarray(0, bytesRead));
      total += bytesRead;
    }
    return Buffer.concat(chunks, total);
  } finally {
    await fh.close();
  }
}

async function readEntry(real, st) {
  const key = `${st.mtimeMs}|${st.size}`;
  const hit = cache.get(real);
  if (hit && hit.key === key) return hit.entry;
  let buf;
  try {
    buf = await readBounded(real, MAX_PAGE_BYTES);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return errorEntry('READ_FAILED');
  }
  const entry = buf.length > MAX_PAGE_BYTES
    ? parseEntry(truncateUtf8(buf, MAX_PAGE_BYTES), true)
    : parseEntry(buf.toString('utf8'));
  if (!entry.error) cache.set(real, { key, entry });
  return entry;
}

// Walk the source on every call: dot-prefixed entries are skipped, symlinks
// are followed only when their realpath stays under the root, and a directory
// already on the current path (a cycle) is not re-entered. Page keys are the
// logical rel paths, not realpaths. At most maxWalkEntries entries are visited;
// which ones survive a truncated walk is unspecified. Only a vanished entry
// (ENOENT) counts as absent: an unreadable page is kept with `error`, an
// unreadable directory is recorded in dirErrors.
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
  const dirErrors = new Set();
  let visited = 0;
  let truncated = false;
  const seen = new Set();

  const walk = async (relDir, stack) => {
    let ents;
    try {
      ents = await fs.readdir(path.join(rootReal, relDir), { withFileTypes: true });
    } catch (e) {
      if (e.code !== 'ENOENT') dirErrors.add(relDir);
      return;
    }
    ents = ents.filter((e) => !e.name.startsWith('.')).sort((a, b) => (a.name < b.name ? -1 : 1));
    await Promise.all(ents.map(async (ent) => {
      if (visited >= maxWalkEntries) { truncated = true; return; }
      visited++;
      const rel = relDir === '' ? ent.name : `${relDir}/${ent.name}`;
      const real = await confinedRealpath(rootReal, rel);
      if (real === null || real === ESCAPES) return;
      let st;
      try {
        st = await fs.stat(real);
      } catch (e) {
        if (e.code !== 'ENOENT' && ent.name.endsWith('.md')) files.set(rel, errorEntry('READ_FAILED'));
        return;
      }
      if (st.isDirectory()) {
        if (stack.includes(real)) return;
        dirs.add(rel);
        await walk(rel, [...stack, real]);
      } else if (st.isFile() && ent.name.endsWith('.md')) {
        seen.add(real);
        const entry = await readEntry(real, st);
        if (entry) files.set(rel, entry);
      }
    }));
  };
  await walk('', [rootReal]);
  // A complete walk saw every live file under this root: drop the rest, so a
  // deleted file stops pinning memory. Other sources' entries are untouched.
  if (!truncated) {
    for (const k of cache.keys()) if (k.startsWith(rootReal + path.sep) && !seen.has(k)) cache.delete(k);
  }
  const snap = buildSnapshot(source, files, dirs);
  snap.rootReal = rootReal;
  snap.dirErrors = dirErrors;
  snap.truncated = truncated;
  return snap;
}
