// Case-insensitive substring search, AND across whitespace-separated terms,
// over each page's raw text (front matter included). Not ranked beyond the
// sort below.
export const MAX_RESULTS = 100;
export const MAX_SNIPPETS = 3;
const SNIPPET_CHARS = 200;
const Q_MIN = 2;
const Q_MAX = 200;

// Trimmed query -> lowercase terms, or null when out of bounds.
export function queryTerms(q) {
  if (typeof q !== 'string') return null;
  const t = q.trim();
  if (t.length < Q_MIN || t.length > Q_MAX) return null;
  return [...new Set(t.toLowerCase().split(/\s+/))];
}

function count(hay, needle) {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

function snippet(line, lowerLine, terms) {
  const text = line.trim();
  if (text.length <= SNIPPET_CHARS) return text;
  const at = Math.min(...terms.map((t) => lowerLine.trim().indexOf(t)).filter((i) => i >= 0));
  const start = Math.max(0, Math.min(at - 40, text.length - SNIPPET_CHARS));
  return text.slice(start, start + SNIPPET_CHARS);
}

// snapshots: loaded snapshots, each carrying its source.
export function search(snapshots, terms) {
  const results = [];
  for (const snap of snapshots) {
    for (const [rel, page] of snap.pages) {
      if (!terms.every((t) => page.lower.includes(t))) continue;
      const hits = terms.reduce((n, t) => n + count(page.lower, t), 0);
      const lines = page.text.split('\n');
      const lowerLines = page.lower.split('\n');
      const snippets = [];
      for (let i = 0; i < lines.length && snippets.length < MAX_SNIPPETS; i++) {
        if (terms.some((t) => lowerLines[i].includes(t))) snippets.push({ line: i + 1, text: snippet(lines[i], lowerLines[i], terms) });
      }
      const title = page.title.toLowerCase();
      results.push({
        source: snap.source.id,
        sourceLabel: snap.source.label,
        path: rel,
        title: page.title,
        archived: page.archived,
        hits,
        snippets,
        titleMatch: terms.every((t) => title.includes(t)),
      });
    }
  }
  results.sort((a, b) => (b.titleMatch - a.titleMatch) || (b.hits - a.hits)
    || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const truncated = results.length > MAX_RESULTS;
  return { results: results.slice(0, MAX_RESULTS).map(({ titleMatch, ...r }) => r), truncated };
}
