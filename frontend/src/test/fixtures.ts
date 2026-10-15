// Canned API responses for component tests, and a fetch stub routing on the URL.
import { vi } from 'vitest';
import type { Block, LintResponse, PageResponse, SearchResponse, SourcesResponse, TreeNode, TreeResponse } from '@/lib/types';

const txt = (v: string) => ({ t: 'text', v });

export const dir = (over: Partial<TreeNode> = {}): TreeNode => ({
  name: '', path: '', index: null, archived: false, error: null, dirs: [], pages: [], ...over,
});

export const SOURCES: SourcesResponse = {
  sources: [
    { id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator' },
    { id: 'p:demo', kind: 'project', label: 'demo' },
  ],
  conductor: true,
};

export const ORCH_TREE: TreeResponse = {
  source: 'orchestrator',
  truncated: false,
  tree: dir({
    index: 'index.md',
    dirs: [
      dir({
        name: 'global', path: 'global', index: 'global/index.md',
        pages: [{ path: 'global/a.md', name: 'a', title: 'Page A' }],
        dirs: [
          dir({
            name: 'archive', path: 'global/archive', archived: true,
            pages: [{ path: 'global/archive/old.md', name: 'old', title: 'Old' }],
            dirs: [dir({ name: 'deep', path: 'global/archive/deep', archived: true, pages: [{ path: 'global/archive/deep/x.md', name: 'x', title: 'X' }] })],
          }),
          dir({ name: 'fam', path: 'global/fam', pages: [{ path: 'global/fam/f.md', name: 'f', title: 'F' }] }),
        ],
      }),
      dir({ name: 'projects', path: 'projects', error: 'READ_FAILED' }),
    ],
  }),
};

export const DEMO_TREE: TreeResponse = { source: 'p:demo', truncated: true, tree: dir({ pages: [{ path: 'x.md', name: 'x', title: 'X' }] }) };

export const page = (over: Partial<PageResponse> = {}): PageResponse => ({
  source: 'orchestrator',
  path: 'index.md',
  title: 'Root',
  frontmatter: {},
  blocks: [{ t: 'h', level: 1, id: 'root', c: [txt('Root heading')] }, { t: 'p', c: [txt('Body text')] }] as Block[],
  backlinks: [],
  archived: false,
  truncated: false,
  error: null,
  stale: false,
  lowConfidence: false,
  ...over,
});

export const LINT: LintResponse = {
  source: 'orchestrator',
  now: '2026-01-01T00:00:00.000Z',
  staleAfterDays: 90,
  rootIndex: 'index.md',
  truncated: false,
  counts: { deadLinks: 1, ambiguousLinks: 0, orphans: 1, unreachableIndexes: 0, lowConfidence: 0, stale: 1 },
  deadLinks: [{ from: 'global/a.md', raw: '[[missing]]', line: 3, archived: false }],
  ambiguousLinks: [],
  orphans: [{ path: 'global/archive/old.md', index: null, archived: true }],
  unreachableIndexes: [],
  lowConfidence: [],
  stale: [{ path: 'global/a.md', updated: 'soon', ageDays: null, archived: false }],
};

export const SEARCH: SearchResponse = {
  q: 'page a',
  truncated: false,
  results: [
    { source: 'orchestrator', sourceLabel: 'Orchestrator', path: 'global/a.md', title: 'Page A', archived: false, hits: 2, snippets: [{ line: 1, text: '# Page A here' }] },
    { source: 'p:demo', sourceLabel: 'demo', path: 'x.md', title: 'X', archived: true, hits: 1, snippets: [{ line: 4, text: 'a page' }] },
  ],
};

type Reply = unknown | ((url: string) => Response | Promise<Response>);
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Stub fetch: `routes` maps a URL (exact, or its path before `?`) to a body or a Response factory. Unmatched → 404. */
export function stubFetch(routes: Record<string, Reply>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const reply = routes[url] ?? routes[url.split('?')[0]];
    if (reply === undefined) return json({ error: `no stub for ${url}`, code: 'NO_STUB' }, 404);
    return typeof reply === 'function' ? (reply as (u: string) => Response)(url) : json(reply);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const BASE_ROUTES: Record<string, Reply> = {
  'api/sources': SOURCES,
  'api/tree?source=orchestrator': ORCH_TREE,
  'api/tree?source=p%3Ademo': DEMO_TREE,
};
