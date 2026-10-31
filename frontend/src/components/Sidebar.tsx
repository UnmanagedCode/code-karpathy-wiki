import type { Ref } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Wikis } from '@/lib/data';
import type { Route } from '@/lib/route';
import { sourceStatus, type DirState } from '@/lib/tree';
import type { Source } from '@/lib/types';
import { cn } from '@/lib/utils';
import { RouteLink } from './RouteLink';
import { SearchBox } from './SearchBox';
import { SourceTree, treeLinkClass } from './SourceTree';

type Props = {
  route: Route;
  wikis: Wikis | null;
  loadError: unknown;
  reloading: boolean;
  onReload: () => void;
  dirs: DirState;
  onToggleDir: (key: string) => void;
  searchRef?: Ref<HTMLInputElement>;
};

export function Sidebar({ route, wikis, loadError, reloading, onReload, dirs, onToggleDir, searchRef }: Props) {
  return (
    <nav aria-label="Wikis" className="flex min-h-full flex-col gap-3 px-2 py-3">
      <div className="flex items-start gap-1.5">
        <SearchBox q={route.view === 'search' ? route.q : null} inputRef={searchRef} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload the trees"
          title="Reload the trees"
          disabled={reloading}
          onClick={onReload}
        >
          <RefreshCwIcon className={cn(reloading && 'animate-spin')} />
        </Button>
      </div>
      {wikis?.projectsError && (
        <Alert variant="warning" className="py-2">
          <AlertDescription>Project wikis are unavailable: {wikis.projectsError}. Showing the orchestrator wiki only.</AlertDescription>
        </Alert>
      )}
      {wikis ? (
        wikis.sources.map((s) => (
          <SourceSection key={s.id} source={s} result={wikis.trees[s.id] ?? {}} route={route} dirs={dirs} onToggleDir={onToggleDir} />
        ))
      ) : loadError ? (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{loadError instanceof Error ? loadError.message : String(loadError)}</p>
            <Button variant="outline" size="sm" onClick={onReload} disabled={reloading}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div aria-busy="true">
          <span className="sr-only" aria-live="polite">Loading…</span>
          <div className="space-y-2 px-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      )}
      <p className="mt-auto px-1 pt-2 text-xs text-muted-foreground">Read-only. Pages are re-read on each view; ↻ reloads the trees.</p>
    </nav>
  );
}

type SectionProps = { source: Source; result: Wikis['trees'][string]; route: Route; dirs: DirState; onToggleDir: (key: string) => void };

function SourceSection({ source, result, route, dirs, onToggleDir }: SectionProps) {
  const { tree, error, truncated } = result;
  const status = sourceStatus(tree, error);
  const healthActive = route.view === 'health' && route.source === source.id;
  const indexActive = route.view === 'page' && route.source === source.id && route.path === tree?.index;
  return (
    <section data-kind={source.kind} aria-label={source.label}>
      <div className="mb-1 flex items-baseline justify-between gap-2 border-b border-sidebar-border px-1 pb-1">
        {tree?.index ? (
          <RouteLink
            to={{ view: 'page', source: source.id, path: tree.index }}
            aria-current={indexActive ? 'page' : undefined}
            className={cn(treeLinkClass, '-mx-1.5 font-semibold')}
          >
            {source.label}
          </RouteLink>
        ) : (
          <span className="min-w-0 truncate font-semibold">{source.label}</span>
        )}
        <RouteLink
          to={{ view: 'health', source: source.id }}
          aria-current={healthActive ? 'page' : undefined}
          className="shrink-0 rounded px-1 text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:text-foreground"
        >
          Health
        </RouteLink>
      </div>
      {truncated && <p className="px-1 text-xs text-warning">Tree truncated: too many entries (symlink loops?).</p>}
      {status === 'fetch-error' && (
        <p className="px-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Could not load the tree.'}</p>
      )}
      {status === 'unreadable' && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription>This wiki&apos;s directory exists but could not be read.</AlertDescription>
        </Alert>
      )}
      {status === 'empty' && <p className="px-1 text-sm text-muted-foreground">No pages yet.</p>}
      {status === 'tree' && tree && <SourceTree source={source.id} tree={tree} active={route} open={dirs.open} onToggle={onToggleDir} />}
    </section>
  );
}
