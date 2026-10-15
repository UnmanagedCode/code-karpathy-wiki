import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { WIDE_QUERY } from './components/AppShell';
import { TOUCH_QUERY } from './lib/textEntry';
import { BASE_ROUTES, LINT, ORCH_TREE, SEARCH, SOURCES, dir, json, page, stubFetch } from './test/fixtures';

const at = (url: string) => history.replaceState(null, '', url);

// The viewport as AppShell's breakpoint sees it (wide shows the sidebar pane, narrow the drawer), and whether
// it is touch-primary (cc's modal focus then opens a drawer on its content, not on a text field).
function viewport(wide: boolean, touch = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === WIDE_QUERY ? wide : query === TOUCH_QUERY ? touch : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const disclosure = (scope: HTMLElement, name: string) => within(scope).getByRole('button', { name, hidden: true });
const mainEl = () => document.getElementById('main')!;

beforeEach(() => at('/'));
afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  // Invariant: with no route in the URL, the orchestrator's index.md is shown, and the URL is left alone.
  it('shows the default page without rewriting the URL', async () => {
    const fetch = stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page() });
    render(<App />);
    expect(await within(mainEl()).findByText('Root heading')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('api/page?source=orchestrator&path=index.md', undefined);
    expect(location.search).toBe('');
    await waitFor(() => expect(document.title).toBe('Root — Code Wiki'));
  });

  // Invariant: a query naming no route is replaced by the default route.
  it('rewrites an unknown view to the default route', async () => {
    at('/?view=nope');
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page() });
    render(<App />);
    expect(await within(mainEl()).findByText('Root heading')).toBeTruthy();
    expect(location.search).toBe('?view=page&source=orchestrator&path=index.md');
  });

  // Invariant: the page view shows its breadcrumb, chips, every banner and the backlinks.
  it('renders a page with chips, banners and backlinks', async () => {
    at('/?view=page&source=orchestrator&path=global%2Fa.md');
    stubFetch({
      ...BASE_ROUTES,
      'api/page?source=orchestrator&path=global%2Fa.md': page({
        path: 'global/a.md', title: 'Page A',
        frontmatter: { confidence: 'low', updated: '2000-01-01' }, lowConfidence: true, stale: true,
        archived: true, truncated: true, error: 'READ_FAILED',
        backlinks: [{ path: 'global/index.md', title: 'Global' }],
      }),
    });
    render(<App />);
    const main = mainEl();
    expect(await within(main).findByText('confidence: low')).toBeTruthy();
    expect(within(main).getByText('confidence: low').className).toContain('text-warning');
    expect(within(main).getByText('updated: 2000-01-01').className).not.toContain('text-warning');
    expect(within(main).getByText('stale').className).toContain('text-warning');
    expect(within(main).getByText(/Archived page/)).toBeTruthy();
    expect(within(main).getByText(/cut short/)).toBeTruthy();
    expect(within(main).getByText('This page exists but could not be read.')).toBeTruthy();
    expect(within(main).getByText('Backlinks (1)')).toBeTruthy();
    expect(within(main).getByRole('link', { name: 'Global' }).getAttribute('href')).toBe('?view=page&source=orchestrator&path=global%2Findex.md');
    const crumbs = within(main).getByRole('navigation', { name: 'Breadcrumb' });
    await waitFor(() => expect(within(crumbs).getByRole('link', { name: 'Orchestrator' }).getAttribute('href')).toBe('?view=page&source=orchestrator&path=index.md'));
    expect(crumbs.textContent).toBe('Orchestrator / global / a.md');
  });

  // Invariant: absent chips and banners render nothing, never "null" text; no backlinks reads "No page links here.".
  it('renders absent banners as nothing', async () => {
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page({ error: 'PARSE_FAILED' }) });
    render(<App />);
    const main = mainEl();
    expect(await within(main).findByText('This page could not be parsed.')).toBeTruthy();
    expect(within(main).getByText('No page links here.')).toBeTruthy();
    expect(main.textContent).not.toMatch(/null|undefined|false/);
    expect(within(main).getAllByRole('alert')).toHaveLength(1);
  });

  // Invariant: a 404 shows "Not found" with the backend's message and code.
  it('shows Not found with the code on a 404', async () => {
    at('/?view=page&source=orchestrator&path=nope.md');
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=nope.md': () => json({ error: 'no such page: nope.md', code: 'NOT_FOUND' }, 404) });
    render(<App />);
    const alert = await within(mainEl()).findByRole('alert');
    expect(alert.textContent).toContain('Not found');
    expect(alert.textContent).toContain('no such page: nope.md');
    expect(alert.textContent).toContain('NOT_FOUND');
  });

  // Invariant: while fetches are pending, skeletons show with a screen-reader status.
  it('shows skeletons while loading', async () => {
    stubFetch({ 'api/sources': () => new Promise<Response>(() => {}), 'api/page': () => new Promise<Response>(() => {}) });
    render(<App />);
    expect(mainEl().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
    expect(within(mainEl()).getByText('Loading…').className).toContain('sr-only');
    expect(within(screen.getByRole('navigation', { name: 'Wikis' })).getByText('Loading…')).toBeTruthy();
  });

  // Invariant: Health lists every count and section, "None." for empty ones, archived items dimmed.
  it('renders the Health view', async () => {
    at('/?view=health&source=orchestrator');
    stubFetch({ ...BASE_ROUTES, 'api/lint?source=orchestrator': LINT });
    render(<App />);
    const main = mainEl();
    expect(await within(main).findByRole('heading', { name: 'Health — Orchestrator', level: 1 })).toBeTruthy();
    const counts = within(main).getByRole('list', { name: 'Counts' });
    expect(within(counts).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Dead links: 1', 'Ambiguous links: 0', 'Orphans: 1', 'Unreachable indexes: 0', 'Low confidence: 0', 'Stale: 1',
    ]);
    expect(within(counts).getByText('Dead links: 1').className).toContain('text-warning');
    expect(within(counts).getByText('Ambiguous links: 0').className).toContain('text-success');
    expect(within(main).getAllByText('None.')).toHaveLength(3);
    expect(main.querySelector('#sec-deadLinks')!.textContent).toContain('global/a.md line 3: [[missing]]');
    const orphan = within(main.querySelector<HTMLElement>('#sec-orphans')!).getByRole('listitem');
    expect(orphan.className).toContain('archived-item');
    expect(orphan.textContent).toBe('global/archive/old.md no index above it');
    expect(main.querySelector('#sec-stale')!.textContent).toContain('updated "soon" is not a date');
    const scroll = vi.fn();
    main.querySelector<HTMLElement>('#sec-stale')!.scrollIntoView = scroll;
    await userEvent.click(within(counts).getByText('Stale: 1'));
    expect(scroll).toHaveBeenCalled();
    expect(location.hash).toBe('');
    await waitFor(() => expect(document.title).toBe('Health — Orchestrator — Code Wiki'));
  });

  // Invariant: search groups results by source, highlights terms in <mark>, dims archived hits; 0 results says so.
  it('renders search results and the empty state', async () => {
    at('/?view=search&q=page+a');
    stubFetch({ ...BASE_ROUTES, 'api/search?q=page+a': SEARCH, 'api/search?q=zz': { q: 'zz', results: [], truncated: false } });
    render(<App />);
    const main = mainEl();
    expect(await within(main).findByText('2 results')).toBeTruthy();
    expect(within(main).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Orchestrator', 'demo']);
    const marks = Array.from(main.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toContain('Page');
    expect(marks).toContain('A');
    expect(within(main).getByRole('region', { name: 'demo' }).querySelector('li')!.className).toContain('archived-item');
    expect((screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement).value).toBe('page a');
    act(() => {
      history.pushState(null, '', '?view=search&q=zz');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await within(main).findByText('No pages match all of: zz')).toBeTruthy();
    expect(within(main).getByText('0 results')).toBeTruthy();
  });

  // Invariant: Enter in the search box navigates only for 2+ characters; shorter shows a hint.
  it('searches on Enter with at least 2 characters', async () => {
    const user = userEvent.setup();
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page(), 'api/search?q=ab': SEARCH });
    render(<App />);
    const box = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(box, ' a {Enter}');
    expect(screen.getByText('Type at least 2 characters')).toBeTruthy();
    expect(location.search).toBe('');
    await user.clear(box);
    await user.type(box, 'ab{Enter}');
    expect(location.search).toBe('?view=search&q=ab');
    expect(await within(mainEl()).findByText('2 results')).toBeTruthy();
  });

  // Invariant: a legacy #/ link is rewritten in place to the query form, the hash dropped, and that route shown.
  it('migrates a legacy hash link on load', async () => {
    at('/#/page/orchestrator/global/a%20b.md');
    const replace = vi.spyOn(history, 'replaceState');
    const fetch = stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=global%2Fa+b.md': page({ title: 'AB' }) });
    render(<App />);
    expect(replace).toHaveBeenCalledWith(null, '', '?view=page&source=orchestrator&path=global%2Fa+b.md');
    expect(location.hash).toBe('');
    expect(location.search).toBe('?view=page&source=orchestrator&path=global%2Fa+b.md');
    await waitFor(() => expect(document.title).toBe('AB — Code Wiki'));
    expect(fetch.mock.calls.some(([u]) => String(u).includes('path=index.md'))).toBe(false);
    replace.mockRestore();
  });

  // Invariant: a popstate (cc's bridge navigate) re-renders the route now in the URL.
  it('follows popstate', async () => {
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page(), 'api/lint?source=orchestrator': LINT });
    render(<App />);
    expect(await within(mainEl()).findByText('Root heading')).toBeTruthy();
    act(() => {
      history.replaceState(null, '', '?view=health&source=orchestrator');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await within(mainEl()).findByRole('heading', { name: 'Health — Orchestrator' })).toBeTruthy();
  });

  // Invariant: a plain click on a sidebar link navigates in-app with pushState.
  it('navigates in-app on a sidebar link click', async () => {
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page(), 'api/page?source=orchestrator&path=global%2Fa.md': page({ title: 'Page A', blocks: [{ t: 'p', c: [{ t: 'text', v: 'A body' }] }] }) });
    render(<App />);
    const push = vi.spyOn(history, 'pushState');
    await userEvent.click(await screen.findByRole('link', { name: 'a' }));
    expect(push).toHaveBeenCalledWith(null, '', '?view=page&source=orchestrator&path=global%2Fa.md');
    expect(await within(mainEl()).findByText('A body')).toBeTruthy();
    push.mockRestore();
  });

  // Invariant: a failed ↻ toasts and keeps the trees on screen; a successful one re-fetches the view.
  it('keeps the trees and toasts when a reload fails', async () => {
    let failing = false;
    const fetch = stubFetch({
      ...BASE_ROUTES,
      'api/sources': () => (failing ? json({ error: 'backend down' }, 500) : json(BASE_ROUTES['api/sources'])),
      'api/page?source=orchestrator&path=index.md': page(),
    });
    render(<><App /><Toaster /></>);
    const reload = await screen.findByRole('button', { name: 'Reload the trees' });
    await screen.findByRole('link', { name: 'a' });
    failing = true;
    await userEvent.click(reload);
    expect(await screen.findByText('Could not reload the trees')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'a' })).toBeTruthy();
    failing = false;
    const pageCalls = () => fetch.mock.calls.filter(([u]) => String(u).startsWith('api/page')).length;
    const before = pageCalls();
    await userEvent.click(reload);
    await waitFor(() => expect(pageCalls()).toBe(before + 1));
  });

  // Invariant: an initial sidebar failure shows the error with a Retry that loads the trees.
  it('offers Retry when the first load fails', async () => {
    let failing = true;
    stubFetch({
      ...BASE_ROUTES,
      'api/sources': () => (failing ? json({ error: 'backend down' }, 500) : json(BASE_ROUTES['api/sources'])),
      'api/page?source=orchestrator&path=index.md': page(),
    });
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Wikis' });
    expect(await within(nav).findByText('backend down')).toBeTruthy();
    failing = false;
    await userEvent.click(within(nav).getByRole('button', { name: 'Retry' }));
    expect(await within(nav).findByRole('link', { name: 'a' })).toBeTruthy();
  });

  // Invariant: on a wide viewport, "/" focuses the pane's search box, except while typing in a text field.
  it('focuses search on /', async () => {
    viewport(true);
    const user = userEvent.setup();
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page() });
    render(<App />);
    const box = screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement;
    await user.keyboard('/');
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('');
    await user.keyboard('a/b');
    expect(box.value).toBe('a/b');
  });

  // Invariant: the skip link is first in tab order and moves focus to the main region without touching the hash.
  it('has a skip link first in tab order', async () => {
    const user = userEvent.setup();
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page() });
    render(<App />);
    await user.tab();
    const skip = document.activeElement as HTMLElement;
    expect(skip.textContent).toBe('Skip to content');
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(mainEl());
    expect(location.hash).toBe('');
  });

  // Invariant: below the md breakpoint (pane hidden), "/" opens the drawer and focuses its search box, even where the
  // drawer otherwise opens on its content (touch); with the drawer open, it refocuses it.
  it('focuses the drawer search on / when the pane is hidden', async () => {
    viewport(false, true);
    const user = userEvent.setup();
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page() });
    render(<App />);
    await screen.findAllByRole('link', { name: 'a' });
    // Opened from the menu, the touch drawer focuses its content, not the search box.
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const menuDrawer = await screen.findByRole('dialog', { name: 'Code Wiki' });
    await waitFor(() => expect(document.activeElement).toBe(menuDrawer));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('/');
    const drawer = await screen.findByRole('dialog', { name: 'Code Wiki' });
    const box = within(drawer).getByRole('searchbox', { name: 'Search' }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.value).toBe('');
    within(drawer).getByRole('link', { name: 'a' }).focus();
    await user.keyboard('/');
    expect(document.activeElement).toBe(box);
  });

  // Invariant: directory open-state is shared by the pane and the drawer, and survives the drawer closing.
  it('keeps directory open-state across the drawer closing and in the pane', async () => {
    viewport(false);
    const user = userEvent.setup();
    stubFetch({ ...BASE_ROUTES, 'api/page?source=orchestrator&path=index.md': page() });
    render(<App />);
    await screen.findAllByRole('link', { name: 'a' });
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    let drawer = await screen.findByRole('dialog', { name: 'Code Wiki' });
    expect(disclosure(drawer, 'fam').getAttribute('aria-expanded')).toBe('false');
    await user.click(disclosure(drawer, 'fam'));
    expect(disclosure(drawer, 'fam').getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const pane = screen.getAllByRole('navigation', { name: 'Wikis' })[0];
    expect(disclosure(pane, 'fam').getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    drawer = await screen.findByRole('dialog', { name: 'Code Wiki' });
    expect(disclosure(drawer, 'fam').getAttribute('aria-expanded')).toBe('true');
  });

  // Invariant: after ↻, a top-level directory new to the tree starts open (archived ones closed), and the user's toggles stay.
  it('seeds only new directories on reload and keeps the user toggles', async () => {
    const user = userEvent.setup();
    let reloaded = false;
    const grown = {
      ...ORCH_TREE,
      tree: {
        ...ORCH_TREE.tree,
        dirs: [
          ...ORCH_TREE.tree.dirs,
          dir({ name: 'workspaces', path: 'workspaces', pages: [{ path: 'workspaces/w.md', name: 'w', title: 'W' }] }),
          dir({ name: 'attic', path: 'attic', archived: true, pages: [{ path: 'attic/z.md', name: 'z', title: 'Z' }] }),
        ],
      },
    };
    stubFetch({
      ...BASE_ROUTES,
      'api/tree?source=orchestrator': () => json(reloaded ? grown : ORCH_TREE),
      'api/page?source=orchestrator&path=index.md': page(),
    });
    render(<App />);
    await screen.findByRole('link', { name: 'a' });
    const nav = screen.getByRole('navigation', { name: 'Wikis' });
    await user.click(disclosure(nav, 'global'));
    await user.click(disclosure(nav, 'fam'));
    expect(disclosure(nav, 'global').getAttribute('aria-expanded')).toBe('false');
    reloaded = true;
    await user.click(screen.getByRole('button', { name: 'Reload the trees' }));
    await waitFor(() => expect(disclosure(nav, 'workspaces').getAttribute('aria-expanded')).toBe('true'));
    expect(disclosure(nav, 'attic').getAttribute('aria-expanded')).toBe('false');
    expect(disclosure(nav, 'global').getAttribute('aria-expanded')).toBe('false');
    expect(disclosure(nav, 'fam').getAttribute('aria-expanded')).toBe('true');
  });

  // Invariant: overlapping tree loads apply only the latest one, whichever resolves last, and ↻ stays busy until it lands.
  it('drops superseded tree loads in either completion order', async () => {
    for (const order of ['stale-last', 'stale-first'] as const) {
      const loads = [deferred<Response>(), deferred<Response>()];
      let n = 0;
      const STALE = { sources: [{ id: 'orchestrator', kind: 'orchestrator', label: 'Stale' }], conductor: false };
      stubFetch({
        ...BASE_ROUTES,
        'api/sources': () => loads[n++].promise,
        'api/page?source=orchestrator&path=index.md': page(),
      });
      const { unmount } = render(<App />);
      const reload = screen.getByRole('button', { name: 'Reload the trees' });
      await userEvent.click(reload);
      await waitFor(() => expect(n).toBe(2));
      expect((reload as HTMLButtonElement).disabled).toBe(true);
      if (order === 'stale-last') {
        loads[1].resolve(json(SOURCES));
        await screen.findByRole('region', { name: 'demo' });
        await waitFor(() => expect((reload as HTMLButtonElement).disabled).toBe(false));
        loads[0].resolve(json(STALE));
      } else {
        loads[0].resolve(json(STALE));
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByRole('region', { name: 'Stale' }), order).toBeNull();
        expect((reload as HTMLButtonElement).disabled, order).toBe(true);
        loads[1].resolve(json(SOURCES));
        await screen.findByRole('region', { name: 'demo' });
      }
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole('region', { name: 'Stale' }), order).toBeNull();
      expect(screen.getByRole('region', { name: 'Orchestrator' }), order).toBeTruthy();
      expect((reload as HTMLButtonElement).disabled, order).toBe(false);
      unmount();
      vi.unstubAllGlobals();
    }
  });
});
