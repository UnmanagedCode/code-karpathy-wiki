import { useEffect, useId, useState } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Route } from '@/lib/route';
import { ancestorDirs, initiallyOpen, showsArchiveBadge } from '@/lib/tree';
import type { TreeNode, TreePage } from '@/lib/types';
import { RouteLink } from './RouteLink';

export const treeLinkClass =
  'block min-w-0 truncate rounded px-1.5 py-0.5 hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium';

type Props = { source: string; tree: TreeNode; active: Route };

function initialOpen(tree: TreeNode, activePath: string | null): Set<string> {
  const open = new Set(tree.dirs.filter((d) => initiallyOpen(d, 1)).map((d) => d.path));
  if (activePath) for (const p of ancestorDirs(activePath)) open.add(p);
  return open;
}

/** One source's directory tree. Each directory is a disclosure; its index page is the link beside it. */
export function SourceTree({ source, tree, active }: Props) {
  const activePath = active.view === 'page' && active.source === source ? active.path : null;
  const [open, setOpen] = useState(() => initialOpen(tree, activePath));
  // Navigating to a page opens every directory it sits in; nothing closes on its own.
  useEffect(() => {
    if (!activePath) return;
    setOpen((prev) => {
      const missing = ancestorDirs(activePath).filter((p) => !prev.has(p));
      return missing.length ? new Set([...prev, ...missing]) : prev;
    });
  }, [activePath]);
  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const ctx = { source, activePath, open, toggle };
  return (
    <ul className="space-y-px text-sm">
      {tree.dirs.map((d) => (
        <DirNode key={d.path} node={d} {...ctx} />
      ))}
      {tree.pages.map((p) => (
        <PageLeaf key={p.path} page={p} source={source} activePath={activePath} />
      ))}
    </ul>
  );
}

type Ctx = { source: string; activePath: string | null; open: Set<string>; toggle: (path: string) => void };

function PageLeaf({ page, source, activePath }: { page: TreePage; source: string; activePath: string | null }) {
  return (
    <li className="pl-5">
      <RouteLink
        to={{ view: 'page', source, path: page.path }}
        title={page.title}
        aria-current={activePath === page.path ? 'page' : undefined}
        className={treeLinkClass}
      >
        {page.name}
      </RouteLink>
    </li>
  );
}

// An archived directory dims its whole subtree once (nested archived dirs do not compound).
function DirNode({ node, inArchive = false, ...ctx }: { node: TreeNode; inArchive?: boolean } & Ctx) {
  const { source, activePath, open, toggle } = ctx;
  const isOpen = open.has(node.path);
  const childrenId = useId();
  return (
    <li className={cn(node.archived && !inArchive && 'archived-item')}>
      <div className="flex min-w-0 flex-wrap items-center gap-0.5">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={childrenId}
          aria-label={node.name}
          onClick={() => toggle(node.path)}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ChevronRightIcon className={cn('size-4 transition-transform', isOpen && 'rotate-90')} />
        </button>
        {node.index ? (
          <RouteLink
            to={{ view: 'page', source, path: node.index }}
            aria-current={activePath === node.index ? 'page' : undefined}
            className={treeLinkClass}
          >
            {node.name}
          </RouteLink>
        ) : (
          <span className="min-w-0 truncate px-1.5 py-0.5 text-muted-foreground">{node.name}</span>
        )}
        {showsArchiveBadge(node) && (
          <Badge variant="outline" className="shrink-0 text-[0.7rem] font-normal not-italic text-muted-foreground">
            archive — not in recall path
          </Badge>
        )}
        {node.error && (
          <Badge variant="destructive" className="shrink-0 text-[0.7rem] not-italic">
            unreadable
          </Badge>
        )}
      </div>
      <ul id={childrenId} hidden={!isOpen} className="ml-2.5 space-y-px border-l border-sidebar-border pl-1">
        {node.dirs.map((d) => (
          <DirNode key={d.path} node={d} inArchive={inArchive || node.archived} {...ctx} />
        ))}
        {node.pages.map((p) => (
          <PageLeaf key={p.path} page={p} source={source} activePath={activePath} />
        ))}
      </ul>
    </li>
  );
}
