import path from 'node:path';

// Link resolution shared by the page renderer, backlinks and the lint. Pure:
// operates on the set of page rel paths (posix, relative to the source root).
// The rules and their precedence are specified in docs/features.md.

const posix = path.posix;
const isIndex = (rel) => rel === 'index.md' || rel.endsWith('/index.md');
const dirOf = (rel) => {
  const d = posix.dirname(rel);
  return d === '.' ? '' : d;
};

// name -> [rel]. A non-index page is keyed by its basename; a non-root
// directory holding an index.md is keyed by the directory name, targeting that
// index. index.md files are never keyed by the basename "index".
export function buildNameIndex(pages) {
  const byName = new Map();
  const add = (name, rel) => {
    const list = byName.get(name);
    if (list) { if (!list.includes(rel)) list.push(rel); } else byName.set(name, [rel]);
  };
  for (const rel of pages) {
    if (isIndex(rel)) {
      const d = dirOf(rel);
      if (d !== '') add(posix.basename(d), rel);
    } else {
      add(posix.basename(rel, '.md'), rel);
    }
  }
  for (const list of byName.values()) list.sort();
  return byName;
}

// Every ancestor directory of every page, plus the root ''.
function derivedDirs(pages) {
  const dirs = new Set(['']);
  for (const rel of pages) {
    for (let d = dirOf(rel); d !== ''; d = dirOf(d)) dirs.add(d);
  }
  return dirs;
}

export function linkContext(kind, pages, dirs) {
  const set = pages instanceof Set ? pages : new Set(pages);
  return { kind, pages: set, dirs: dirs ?? derivedDirs(set), byName: buildNameIndex(set) };
}

export function scopeOf(kind, rel) {
  if (kind !== 'orchestrator') return '';
  const seg = rel.split('/');
  if (seg[0] === 'global' && seg.length > 1) return 'global';
  if ((seg[0] === 'workspaces' || seg[0] === 'projects') && seg.length > 2) return `${seg[0]}/${seg[1]}`;
  return '';
}

// Normalise base + target; null when it climbs out of the source root.
function within(base, target) {
  let p = posix.normalize(base === '' ? target : `${base}/${target}`);
  p = p.replace(/\/+$/, '');
  if (p === '.') p = '';
  if (p === '..' || p.startsWith('../') || p.startsWith('/')) return null;
  return p;
}

const DEAD = { kind: 'dead' };
const pageOf = (target) => ({ kind: 'page', target });
const ambiguous = (candidates) => ({ kind: 'ambiguous', candidates: [...candidates].sort() });

// [[ref]] -> {kind:'page',target} | {kind:'ambiguous',candidates} | {kind:'dead'}.
export function resolveWiki(ref, fromRel, ctx) {
  let t = String(ref ?? '');
  const bar = t.indexOf('|');
  if (bar >= 0) t = t.slice(0, bar);
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  t = t.trim().replace(/\.md$/, '');
  if (t === '') return DEAD;
  const scope = scopeOf(ctx.kind, fromRel);

  if (t.includes('/')) {
    const bases = (t.startsWith('./') || t.startsWith('../')) ? [dirOf(fromRel)] : [...new Set([scope, ''])];
    for (const base of bases) {
      const p = within(base, t);
      if (p === null) return DEAD;
      const hits = [p === '' ? null : `${p}.md`, p === '' ? 'index.md' : `${p}/index.md`].filter((c) => c && ctx.pages.has(c));
      if (hits.length === 1) return pageOf(hits[0]);
      if (hits.length > 1) return ambiguous(hits);
    }
    return DEAD;
  }

  const cands = ctx.byName.get(t) ?? [];
  const inScope = scope === '' ? cands : cands.filter((c) => c.startsWith(`${scope}/`));
  if (inScope.length === 1) return pageOf(inScope[0]);
  if (inScope.length > 1) return ambiguous(inScope);
  if (cands.length === 1) return pageOf(cands[0]);
  if (cands.length > 1) return ambiguous(cands);
  return DEAD;
}

// Markdown and autolink destinations -> external | page | dead | outside | blocked | anchor.
// Only http(s) is ever external; every other scheme is blocked. Entities are
// never decoded, so an encoded scheme stays a (non-existent) relative path.
export function resolveHref(href, fromRel, ctx) {
  const raw = String(href ?? '');
  const clean = raw.replace(/[\x00-\x20\x7f]/g, '');
  // An empty destination names nothing: inert, and not a health item.
  if (clean === '') return { kind: 'outside' };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(clean);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    return (s === 'http' || s === 'https') ? { kind: 'external', href: raw.trim() } : { kind: 'blocked' };
  }
  if (clean.startsWith('//')) return { kind: 'blocked' };
  if (clean.startsWith('#')) return { kind: 'anchor', href: clean };
  if (clean.startsWith('/') || clean.startsWith('\\')) return { kind: 'outside' };

  let dest = raw.trim();
  const cut = dest.search(/[?#]/);
  if (cut >= 0) dest = dest.slice(0, cut);
  if (dest === '') return DEAD;
  try {
    dest = decodeURIComponent(dest);
  } catch {
    return DEAD;
  }
  const trailing = dest.endsWith('/');
  const p = within(dirOf(fromRel), dest);
  if (p === null) return { kind: 'outside' };
  if (trailing || ctx.dirs.has(p)) {
    const idx = p === '' ? 'index.md' : `${p}/index.md`;
    return ctx.pages.has(idx) ? pageOf(idx) : DEAD;
  }
  if (p.endsWith('.md')) return ctx.pages.has(p) ? pageOf(p) : DEAD;
  return { kind: 'outside' };
}

export { isIndex, dirOf };
