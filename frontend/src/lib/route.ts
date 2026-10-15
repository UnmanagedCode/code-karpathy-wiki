// Route state lives in the query string (?view=…), never the hash: cc's bridge
// turns pushState into replaceState and mirrors the route into cc's URL, and
// its `navigate` arrives here as a popstate.
import { useSyncExternalStore } from 'react';

export type Route =
  | { view: 'page'; source: string; path: string }
  | { view: 'health'; source: string }
  | { view: 'search'; q: string };

export const DEFAULT_ROUTE: Route = { view: 'page', source: 'orchestrator', path: 'index.md' };

/** The route a query string names, or null when it names none (no or unknown `view`, a missing param). */
export function parseRoute(search: string): Route | null {
  const p = new URLSearchParams(search);
  const source = p.get('source');
  switch (p.get('view')) {
    case 'page': {
      const path = p.get('path');
      return source && path ? { view: 'page', source, path } : null;
    }
    case 'health':
      return source ? { view: 'health', source } : null;
    case 'search': {
      const q = p.get('q');
      return q ? { view: 'search', q } : null;
    }
    default:
      return null;
  }
}

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A `#/page/…`, `#/health/…` or `#/search?q=…` link from the hash router, as a route; null for any other hash. */
export function parseLegacyHash(hash: string): Route | null {
  if (hash.startsWith('#/page/')) {
    const segs = hash.slice('#/page/'.length).split('/').map(decodeSeg);
    return { view: 'page', source: segs[0], path: segs.slice(1).join('/') || 'index.md' };
  }
  if (hash.startsWith('#/health/')) return { view: 'health', source: decodeSeg(hash.slice('#/health/'.length)) };
  if (hash.startsWith('#/search')) {
    const q = new URLSearchParams(hash.split('?')[1] ?? '').get('q') ?? '';
    return { view: 'search', q };
  }
  return null;
}

/** A relative href for `r`: the query string alone, so it resolves against the plugin root embedded or standalone. */
export function routeHref(r: Route): string {
  const p: Record<string, string> =
    r.view === 'page'
      ? { view: r.view, source: r.source, path: r.path }
      : r.view === 'health'
        ? { view: r.view, source: r.source }
        : { view: r.view, q: r.q };
  return `?${new URLSearchParams(p)}`;
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function navigate(r: Route): void {
  history.pushState(null, '', routeHref(r));
  emit();
}

/** Rewrite the URL to `r` in place (no history entry), dropping any hash. */
export function replaceRoute(r: Route): void {
  history.replaceState(null, '', routeHref(r));
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
}

/** The current `location.search`; re-renders on navigate, replaceRoute and popstate. */
export function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, () => location.search);
}

/** A primary click with no modifier: the only click a link handles itself. Any other opens a tab or window natively. */
export const isPlainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
