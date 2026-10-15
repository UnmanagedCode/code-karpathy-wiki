import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AppShell, WIDE_QUERY } from '@/components/AppShell';
import { Sidebar } from '@/components/Sidebar';
import { loadWikis, type Wikis } from '@/lib/data';
import { DEFAULT_ROUTE, parseLegacyHash, parseRoute, replaceRoute, routeHref, useLocationSearch, type Route } from '@/lib/route';
import { isTextEntry } from '@/lib/textEntry';
import { EMPTY_DIRS, openAncestors, seedDirs, toggleDir } from '@/lib/tree';
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
  const [reloadsInFlight, setReloadsInFlight] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Expanded sidebar directories, shared by the pane and the drawer and kept across reloads.
  const [dirs, setDirs] = useState(EMPTY_DIRS);

  // Every load takes the next id; only the latest one's outcome is applied, so a slow
  // earlier load (the first one, or a superseded ↻) never overwrites a newer result.
  const latestLoad = useRef(0);
  const shown = useRef<Wikis | null>(null);
  const load = useCallback(async (userReload: boolean) => {
    const id = ++latestLoad.current;
    if (userReload) setReloadsInFlight((n) => n + 1);
    try {
      const w = await loadWikis();
      if (id !== latestLoad.current) return;
      shown.current = w;
      setWikis(w);
      setLoadError(null);
      setDirs((d) => seedDirs(d, w.trees));
      if (userReload) setReloadKey((k) => k + 1);
    } catch (e) {
      if (id !== latestLoad.current) return;
      if (shown.current) toast.error('Could not reload the trees', { description: e instanceof Error ? e.message : String(e) });
      else setLoadError(e);
    } finally {
      if (userReload) setReloadsInFlight((n) => n - 1);
    }
  }, []);
  useEffect(() => {
    void load(false);
  }, [load]);
  const reload = useCallback(() => void load(true), [load]);

  // Navigating to a page opens every directory above it; nothing closes on its own.
  const pageSource = route.view === 'page' ? route.source : null;
  const pagePath = route.view === 'page' ? route.path : null;
  useEffect(() => {
    if (pageSource !== null && pagePath !== null) setDirs((d) => openAncestors(d, pageSource, pagePath));
  }, [pageSource, pagePath]);
  const onToggleDir = useCallback((key: string) => setDirs((d) => toggleDir(d, key)), []);

  const [title, setTitle] = useState(APP_NAME);
  useEffect(() => {
    document.title = title === APP_NAME ? APP_NAME : `${title} — ${APP_NAME}`;
  }, [title]);

  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [search]);

  // `/` focuses the search box that is on screen: the pane's from Tailwind's `md` up; below it, the drawer's,
  // opening the drawer first when it is closed. Never while the user is typing somewhere.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const paneSearch = useRef<HTMLInputElement>(null);
  const drawerSearch = useRef<HTMLInputElement>(null);
  const searchOnDrawerOpen = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTextEntry(document.activeElement)) return;
      e.preventDefault();
      if (window.matchMedia(WIDE_QUERY).matches) paneSearch.current?.focus();
      else if (drawerOpen) drawerSearch.current?.focus();
      else {
        searchOnDrawerOpen.current = true;
        setDrawerOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);
  const onDrawerOpenAutoFocus = useCallback((e: Event) => {
    if (!searchOnDrawerOpen.current) return;
    searchOnDrawerOpen.current = false;
    if (!drawerSearch.current) return;
    e.preventDefault();
    drawerSearch.current.focus();
  }, []);

  const labelOf = (id: string) => wikis?.sources.find((s) => s.id === id)?.label ?? id;
  const rootIndexOf = (id: string) => wikis?.trees[id]?.tree?.index ?? null;

  return (
    <AppShell
      title={title}
      drawerOpen={drawerOpen}
      onDrawerOpenChange={setDrawerOpen}
      onDrawerOpenAutoFocus={onDrawerOpenAutoFocus}
      mainRef={mainRef}
      sidebar={(where) => (
        <Sidebar
          route={route}
          wikis={wikis}
          loadError={loadError}
          reloading={reloadsInFlight > 0}
          onReload={reload}
          dirs={dirs}
          onToggleDir={onToggleDir}
          searchRef={where === 'pane' ? paneSearch : drawerSearch}
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
