import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, parseLegacyHash, parseRoute, routeHref, type Route } from './route';

describe('routes', () => {
  // Invariant: every route survives href -> parse unchanged, including awkward characters.
  it('round-trips through routeHref and parseRoute', () => {
    const routes: Route[] = [
      DEFAULT_ROUTE,
      { view: 'page', source: 'p:demo', path: 'dir/a b&c=d#e?.md' },
      { view: 'health', source: 'p:x y' },
      { view: 'search', q: 'a+b & c' },
    ];
    for (const r of routes) expect(parseRoute(routeHref(r))).toEqual(r);
    expect(routeHref({ view: 'page', source: 'orchestrator', path: 'global/a b.md' })).toBe('?view=page&source=orchestrator&path=global%2Fa+b.md');
  });

  // Invariant: a query naming no complete route is null (the app then falls back to the default).
  it('rejects unknown views and missing params', () => {
    for (const s of ['', '?', '?view=nope&source=x', '?view=page&source=x', '?view=page&path=a.md', '?view=health', '?view=search', '?view=search&q=']) {
      expect(parseRoute(s), s).toBeNull();
    }
  });

  // Invariant: legacy hash links decode as the hash router did (empty path -> index.md, bad % kept raw).
  it('parses legacy hash links', () => {
    expect(parseLegacyHash('#/page/orchestrator/global/a%20b.md')).toEqual({ view: 'page', source: 'orchestrator', path: 'global/a b.md' });
    expect(parseLegacyHash('#/page/p%3Ademo/')).toEqual({ view: 'page', source: 'p:demo', path: 'index.md' });
    expect(parseLegacyHash('#/page/p%3Ademo')).toEqual({ view: 'page', source: 'p:demo', path: 'index.md' });
    expect(parseLegacyHash('#/page/orchestrator/100%.md')).toEqual({ view: 'page', source: 'orchestrator', path: '100%.md' });
    expect(parseLegacyHash('#/health/p%3Ademo')).toEqual({ view: 'health', source: 'p:demo' });
    expect(parseLegacyHash('#/search?q=a%20b')).toEqual({ view: 'search', q: 'a b' });
    for (const h of ['', '#', '#h-sec', '#/nope', '#page/x']) expect(parseLegacyHash(h), h).toBeNull();
  });
});
