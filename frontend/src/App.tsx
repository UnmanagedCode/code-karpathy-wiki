import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Sidebar } from '@/components/Sidebar';
import { loadWikis, type Wikis } from '@/lib/data';
import { DEFAULT_ROUTE, parseLegacyHash, parseRoute, replaceRoute, routeHref, useLocationSearch, type Route } from '@/lib/route';
import { isTextEntry } from '@/lib/textEntry';
import { HealthView } from '@/views/HealthView';
import { PageView } from '@/views/PageView';
import { SearchView } from '@/views/SearchView';

const APP_NAME = 'Code Wiki';

/** A hash-router link (`#/page/…`) is accepted once, rewritten in place to its query form. */
function migrateLegacyHash(): void {
  const legacy = parseLegacyHash(location.hash);
  if (legacy) history.replaceState(null, '', routeHref(legacy));
}

export function App() {
  // Before the route is first read, so a legacy link never loads the default page first.
  useState(migrateLegacyHash);
  const search = useLocationSearch();
  const parsed = parseRoute(search);
  const route: Route = parsed ?? DEFAULT_ROUTE;
  const hasView = new URLSearchParams(search).has('view');
  // A query naming no route is rewritten to the default; one with no `view` at all is the default as it stands.
  useEffect(() => {
    if (!parsed && hasView) replaceRoute(DEFAULT_ROUTE);
  }, [parsed, hasView]);

  const [wikis, setWikis] = useState<Wikis | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    loadWikis().then(
      (w) => live && setWikis(w),
      (e) => live && setLoadError(e),
    );
    return () => {
      live = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      const w = await loadWikis();
      setWikis(w);
      setLoadError(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      if (wikis) toast.error('Could not reload the trees', { description: e instanceof Error ? e.message : String(e) });
      else setLoadError(e);
    } finally {
      setReloading(false);
    }
  }, [wikis]);

  const [title, setTitle] = useState(APP_NAME);
  useEffect(() => {
    document.title = title === APP_NAME ? APP_NAME : `${title} — ${APP_NAME}`;
  }, [title]);

  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [search]);

  // `/` focuses the search box, unless the user is typing somewhere.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTextEntry(document.activeElement)) return;
      if (!searchRef.current) return;
      e.preventDefault();
      searchRef.current.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const labelOf = (id: string) => wikis?.sources.find((s) => s.id === id)?.label ?? id;
  const rootIndexOf = (id: string) => wikis?.trees[id]?.tree?.index ?? null;

  return (
    <AppShell
      title={title}
      mainRef={mainRef}
      sidebar={(where) => (
        <Sidebar
          route={route}
          wikis={wikis}
          loadError={loadError}
          reloading={reloading}
          onReload={reload}
          searchRef={where === 'pane' ? searchRef : undefined}
        />
      )}
    >
      {route.view === 'page' ? (
        <PageView
          key={`${route.source}|${route.path}`}
          source={route.source}
          path={route.path}
          sourceLabel={labelOf(route.source)}
          rootIndex={rootIndexOf(route.source)}
          reloadKey={reloadKey}
          onTitle={setTitle}
        />
      ) : route.view === 'health' ? (
        <HealthView key={route.source} source={route.source} sourceLabel={labelOf(route.source)} reloadKey={reloadKey} onTitle={setTitle} />
      ) : (
        <SearchView key={route.q} q={route.q} reloadKey={reloadKey} onTitle={setTitle} />
      )}
    </AppShell>
  );
}
