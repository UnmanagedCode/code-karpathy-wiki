import { isIndex, dirOf } from './links.js';

// A page whose front-matter `updated` is more than this many days old is stale.
export const STALE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isLowConfidence(fm) {
  return typeof fm?.confidence === 'string' && /^low\b/i.test(fm.confidence);
}

// null when not stale; {updated, ageDays} when older than STALE_AFTER_DAYS,
// or {updated, ageDays:null} when `updated` is present but not a real YYYY-MM-DD.
export function staleEntry(fm, now) {
  const u = fm?.updated;
  if (typeof u !== 'string' || u === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(u);
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  const d = new Date(t);
  if (!m || Number.isNaN(t) || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return { updated: u, ageDays: null };
  const ageDays = Math.floor((now.getTime() - t) / DAY_MS);
  return ageDays > STALE_AFTER_DAYS ? { updated: u, ageDays } : null;
}

const linksTo = (page, target) => page.res.some((r) => r.kind === 'page' && r.target === target);

// The index a page must be listed in: the first index.md above it (for an
// index page, above its own directory) other than the page itself.
function nearestIndex(pages, rel) {
  let d = isIndex(rel) ? dirOf(dirOf(rel)) : dirOf(rel);
  if (isIndex(rel) && dirOf(rel) === '') return null;
  for (;;) {
    const cand = d === '' ? 'index.md' : `${d}/index.md`;
    if (cand !== rel && pages.has(cand)) return cand;
    if (d === '') return null;
    d = dirOf(d);
  }
}

export function lintSnapshot(snap, { now = new Date() } = {}) {
  const { pages } = snap;
  const deadLinks = [];
  const ambiguousLinks = [];
  const orphans = [];
  const lowConfidence = [];
  const stale = [];

  for (const [rel, page] of pages) {
    const archived = page.archived;
    page.links.forEach((l, idx) => {
      const r = page.res[idx];
      if (r.kind === 'dead') deadLinks.push({ from: rel, raw: l.raw, line: l.line, archived });
      else if (r.kind === 'ambiguous') ambiguousLinks.push({ from: rel, raw: l.raw, line: l.line, candidates: r.candidates, archived });
    });
    if (rel !== 'index.md') {
      const index = nearestIndex(pages, rel);
      if (index === null || !linksTo(pages.get(index), rel)) orphans.push({ path: rel, index, archived });
    }
    if (isLowConfidence(page.frontmatter)) lowConfidence.push({ path: rel, confidence: page.frontmatter.confidence, archived });
    const s = staleEntry(page.frontmatter, now);
    if (s) stale.push({ path: rel, ...s, archived });
  }

  // Reachability walks index -> index links only, from the root index.
  const rootIndex = pages.has('index.md') ? 'index.md' : null;
  const seen = new Set();
  const queue = rootIndex ? [rootIndex] : [];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const r of pages.get(rel).res) {
      if (r.kind === 'page' && isIndex(r.target) && !seen.has(r.target)) queue.push(r.target);
    }
  }
  const unreachableIndexes = [...pages.keys()].filter((rel) => isIndex(rel) && !seen.has(rel))
    .map((rel) => ({ path: rel, archived: pages.get(rel).archived }));

  return {
    source: snap.source.id,
    now: now.toISOString(),
    staleAfterDays: STALE_AFTER_DAYS,
    rootIndex,
    truncated: snap.truncated === true,
    counts: {
      deadLinks: deadLinks.length,
      ambiguousLinks: ambiguousLinks.length,
      orphans: orphans.length,
      unreachableIndexes: unreachableIndexes.length,
      lowConfidence: lowConfidence.length,
      stale: stale.length,
    },
    deadLinks, ambiguousLinks, orphans, unreachableIndexes, lowConfidence, stale,
  };
}
