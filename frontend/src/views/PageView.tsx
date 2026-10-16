import { Fragment } from 'react';
import { ArchiveIcon, CircleAlertIcon, ScissorsIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ErrorState';
import { RouteLink } from '@/components/RouteLink';
import { pageUrl, useApiData } from '@/lib/data';
import { headingId, WikiContent } from '@/lib/render';
import { navigate } from '@/lib/route';
import type { PageResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LoadingState, useViewTitle } from './common';

type Props = {
  source: string;
  path: string;
  sourceLabel: string;
  rootIndex: string | null;
  reloadKey: number;
  onTitle: (t: string) => void;
};

const warnChip = 'border-warning text-warning';

function scrollToHeading(slug: string) {
  document.getElementById(headingId(slug))?.scrollIntoView();
}

export function PageView({ source, path, sourceLabel, rootIndex, reloadKey, onTitle }: Props) {
  const { data: d, error, loading } = useApiData<PageResponse>(pageUrl(source, path), reloadKey);
  useViewTitle(d ? d.title : null, onTitle);
  if (loading) return <LoadingState label="Loading…" />;
  if (error || !d) return <ErrorState error={error} />;
  const fm = d.frontmatter ?? {};
  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-sm break-words text-muted-foreground">
        {rootIndex ? (
          <RouteLink to={{ view: 'page', source, path: rootIndex }} className="text-primary underline-offset-4 hover:underline">
            {sourceLabel}
          </RouteLink>
        ) : (
          <span>{sourceLabel}</span>
        )}
        {path.split('/').map((seg, i) => (
          <Fragment key={i}>
            <span aria-hidden="true"> / </span>
            <span className={cn(i === path.split('/').length - 1 && 'text-foreground')}>{seg}</span>
          </Fragment>
        ))}
      </nav>
      {(fm.confidence || fm.updated || d.stale) && (
        <div className="flex flex-wrap gap-1.5">
          {fm.confidence && (
            <Badge variant="outline" className={cn('font-normal', d.lowConfidence && warnChip)}>
              confidence: {fm.confidence}
            </Badge>
          )}
          {fm.updated && (
            <Badge variant="outline" className="font-normal">
              updated: {fm.updated}
            </Badge>
          )}
          {d.stale && (
            <Badge variant="outline" className={cn('font-normal', warnChip)}>
              stale
            </Badge>
          )}
        </div>
      )}
      {d.archived && (
        <Alert variant="warning">
          <ArchiveIcon />
          <AlertDescription>Archived page — retired or superseded, not in the recall path.</AlertDescription>
        </Alert>
      )}
      {d.truncated && (
        <Alert>
          <ScissorsIcon />
          <AlertDescription>This page is larger than the display cap and has been cut short.</AlertDescription>
        </Alert>
      )}
      {d.error && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>
            {d.error === 'READ_FAILED' ? 'This page exists but could not be read.' : 'This page could not be parsed.'}
          </AlertDescription>
        </Alert>
      )}
      <article className="wiki-md">
        <WikiContent blocks={d.blocks} ctx={{ source, onNavigate: navigate, onAnchor: scrollToHeading }} />
      </article>
      <section aria-labelledby="backlinks-heading" className="border-t pt-4">
        <h2 id="backlinks-heading" className="mb-2 text-base font-semibold">
          Backlinks ({d.backlinks.length})
        </h2>
        {d.backlinks.length ? (
          <ul className="space-y-1 text-sm">
            {d.backlinks.map((b) => (
              <li key={b.path} className="break-words">
                <RouteLink to={{ view: 'page', source, path: b.path }} className="text-primary underline-offset-4 hover:underline">
                  {b.title}
                </RouteLink>{' '}
                <span className="text-muted-foreground">{b.path}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No page links here.</p>
        )}
      </section>
    </div>
  );
}
