import { ErrorState } from '@/components/ErrorState';
import { RouteLink } from '@/components/RouteLink';
import { searchUrl, useApiData } from '@/lib/data';
import { highlight, queryTerms } from '@/lib/highlight';
import type { SearchResponse, SearchResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LoadingState, useViewTitle } from './common';

type Props = { q: string; reloadKey: number; onTitle: (t: string) => void };

export function SearchView({ q, reloadKey, onTitle }: Props) {
  const { data: d, error, loading } = useApiData<SearchResponse>(searchUrl(q), reloadKey);
  useViewTitle(d ? `Search: ${d.q}` : null, onTitle);
  if (loading) return <LoadingState label="Searching…" lines={4} />;
  if (error || !d) return <ErrorState error={error} />;
  const terms = queryTerms(q);
  const groups = new Map<string, { label: string; items: SearchResult[] }>();
  for (const r of d.results) {
    if (!groups.has(r.source)) groups.set(r.source, { label: r.sourceLabel, items: [] });
    groups.get(r.source)!.items.push(r);
  }
  const n = d.results.length;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold break-words">Search: {d.q}</h1>
        <p className="text-sm text-muted-foreground">
          {n}
          {d.truncated ? '+' : ''} result{n === 1 ? '' : 's'}
        </p>
      </div>
      {n === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No pages match all of: {terms.join(', ')}
        </p>
      )}
      {[...groups.entries()].map(([source, g]) => (
        <section key={source} aria-label={g.label} className="space-y-2">
          <h2 className="border-b pb-1 text-lg font-semibold">{g.label}</h2>
          <ul className="space-y-3">
            {g.items.map((r) => (
              <li key={r.path} className={cn('break-words', r.archived && 'archived-item')}>
                <RouteLink to={{ view: 'page', source, path: r.path }} className="font-medium text-primary underline-offset-4 hover:underline">
                  {highlight(r.title, terms)}
                </RouteLink>{' '}
                <span className="text-sm text-muted-foreground">{r.path}</span>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {r.snippets.map((s) => (
                    <li key={s.line} className="flex gap-2">
                      <span className="w-8 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground">{s.line}</span>
                      <span className="min-w-0">{highlight(s.text, terms)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
