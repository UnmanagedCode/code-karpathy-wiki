import type { ReactNode } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ErrorState } from '@/components/ErrorState';
import { RouteLink } from '@/components/RouteLink';
import { lintUrl, useApiData } from '@/lib/data';
import type { HealthKey, LintResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LoadingState, useViewTitle } from './common';

type Props = { source: string; sourceLabel: string; reloadKey: number; onTitle: (t: string) => void };

const linkClass = 'text-primary underline-offset-4 hover:underline';
const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>;

type Item<K extends HealthKey> = LintResponse[K][number];
type Section<K extends HealthKey> = [K, string, string, (source: string, x: Item<K>) => ReactNode];

function PageRef({ source, path }: { source: string; path: string }) {
  return (
    <RouteLink to={{ view: 'page', source, path }} className={linkClass}>
      {path}
    </RouteLink>
  );
}

const section = <K extends HealthKey>(...s: Section<K>) => s as unknown as Section<HealthKey>;

export const HEALTH_SECTIONS: Section<HealthKey>[] = [
  section<'deadLinks'>('deadLinks', 'Dead links', 'Links that resolve to no page.', (source, x) => (
    <>
      <PageRef source={source} path={x.from} /> line {x.line}: <code className="font-mono text-[0.92em]">{x.raw}</code>
    </>
  )),
  section<'ambiguousLinks'>('ambiguousLinks', 'Ambiguous links', 'Links with more than one candidate page.', (source, x) => (
    <>
      <PageRef source={source} path={x.from} /> line {x.line}: <code className="font-mono text-[0.92em]">{x.raw}</code> →{' '}
      {x.candidates.map((c, i) => (
        <span key={c}>
          {i ? ', ' : ''}
          <PageRef source={source} path={c} />
        </span>
      ))}
    </>
  )),
  section<'orphans'>('orphans', 'Orphans', 'Pages not linked from their nearest index.', (source, x) => (
    <>
      <PageRef source={source} path={x.path} /> <Muted>{x.index ? `not in ${x.index}` : 'no index above it'}</Muted>
    </>
  )),
  section<'unreachableIndexes'>('unreachableIndexes', 'Unreachable indexes', 'Indexes not reachable from the root index through index pages.', (source, x) => (
    <PageRef source={source} path={x.path} />
  )),
  section<'lowConfidence'>('lowConfidence', 'Low confidence', 'Front matter confidence starts with "low".', (source, x) => (
    <>
      <PageRef source={source} path={x.path} /> <Muted>{x.confidence}</Muted>
    </>
  )),
  section<'stale'>('stale', 'Stale', 'Front matter updated is old or unparseable.', (source, x) => (
    <>
      <PageRef source={source} path={x.path} />{' '}
      <Muted>{x.ageDays == null ? `updated "${x.updated}" is not a date` : `${x.updated} (${x.ageDays} days)`}</Muted>
    </>
  )),
];

export function HealthView({ source, sourceLabel, reloadKey, onTitle }: Props) {
  const { data: d, error, loading } = useApiData<LintResponse>(lintUrl(source), reloadKey);
  useViewTitle(d ? `Health — ${sourceLabel}` : null, onTitle);
  if (loading) return <LoadingState label="Checking…" />;
  if (error || !d) return <ErrorState error={error} />;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold break-words">Health — {sourceLabel}</h1>
        <p className="text-sm text-muted-foreground">
          {d.rootIndex ? `Root index: ${d.rootIndex}. ` : 'No root index.md. '}
          Stale after {d.staleAfterDays} days.
        </p>
      </div>
      {d.truncated && (
        <Alert>
          <CircleAlertIcon />
          <AlertDescription>The walk hit its entry cap: these results cover only part of the tree.</AlertDescription>
        </Alert>
      )}
      <ul aria-label="Counts" className="flex flex-wrap gap-1.5">
        {HEALTH_SECTIONS.map(([k, title]) => (
          <li key={k}>
            <button
              type="button"
              onClick={() => document.getElementById(`sec-${k}`)?.scrollIntoView()}
              className={cn(
                'rounded-md border px-2 py-1 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                d.counts[k] ? 'border-warning/50 text-warning' : 'text-success',
              )}
            >
              {title}: {d.counts[k]}
            </button>
          </li>
        ))}
      </ul>
      {HEALTH_SECTIONS.map(([k, title, blurb, item]) => {
        const items = d[k] as Item<HealthKey>[];
        return (
          <section key={k} id={`sec-${k}`} aria-labelledby={`sec-${k}-h`} className="scroll-mt-4 space-y-1">
            <h2 id={`sec-${k}-h`} className="border-b pb-1 text-lg font-semibold">
              {title} ({items.length})
            </h2>
            <p className="text-sm text-muted-foreground">{blurb}</p>
            {items.length ? (
              <ul className="space-y-1 text-sm">
                {items.map((x, i) => (
                  <li key={i} className={cn('break-words', x.archived && 'archived-item')}>
                    {item(source, x)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
