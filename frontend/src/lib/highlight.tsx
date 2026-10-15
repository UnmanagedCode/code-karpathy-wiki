import type { ReactNode } from 'react';

/** `text` with every occurrence of any of `terms` (lowercase) wrapped in <mark>. Text children only, never markup. */
export function highlight(text: string, terms: string[]): ReactNode[] {
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let at = -1;
    let len = 0;
    for (const t of terms) {
      if (!t) continue;
      const j = lower.indexOf(t, i);
      if (j >= 0 && (at < 0 || j < at)) {
        at = j;
        len = t.length;
      }
    }
    if (at < 0) {
      out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(<mark key={at}>{text.slice(at, at + len)}</mark>);
    i = at + len;
  }
  return out;
}

/** The distinct lowercase terms of a query, as the backend matches them. */
export const queryTerms = (q: string): string[] => [...new Set(q.trim().toLowerCase().split(/\s+/).filter(Boolean))];
