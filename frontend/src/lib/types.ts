// Response shapes of the browser API (docs/protocol.md → Browser API). The
// page AST types are advisory: render.tsx re-checks every node at runtime.

export type Source = { id: string; kind: 'orchestrator' | 'project'; label: string };
export type SourcesResponse = { sources: Source[]; conductor: boolean; projectsError?: string };

export type TreePage = { path: string; name: string; title: string };
export type TreeNode = {
  name: string;
  path: string;
  index: string | null;
  archived: boolean;
  error: string | null;
  dirs: TreeNode[];
  pages: TreePage[];
};
export type TreeResponse = { source: string; tree: TreeNode; truncated: boolean };

export type Inline = { t: string; v?: unknown; c?: unknown; kind?: unknown; href?: unknown; target?: unknown; candidates?: unknown };
export type Block = { t: string; [k: string]: unknown };

export type PageResponse = {
  source: string;
  path: string;
  title: string;
  frontmatter: Record<string, string>;
  blocks: Block[];
  backlinks: { path: string; title: string }[];
  archived: boolean;
  truncated: boolean;
  error: 'READ_FAILED' | 'PARSE_FAILED' | null;
  stale: boolean;
  lowConfidence: boolean;
};

type Flag = { archived: boolean };
export type LintResponse = {
  source: string;
  now: string;
  staleAfterDays: number;
  rootIndex: string | null;
  truncated: boolean;
  counts: Record<HealthKey, number>;
  deadLinks: ({ from: string; raw: string; line: number } & Flag)[];
  ambiguousLinks: ({ from: string; raw: string; line: number; candidates: string[] } & Flag)[];
  orphans: ({ path: string; index: string | null } & Flag)[];
  unreachableIndexes: ({ path: string } & Flag)[];
  lowConfidence: ({ path: string; confidence: string } & Flag)[];
  stale: ({ path: string; updated: string; ageDays: number | null } & Flag)[];
};
export type HealthKey = 'deadLinks' | 'ambiguousLinks' | 'orphans' | 'unreachableIndexes' | 'lowConfidence' | 'stale';

export type SearchResult = {
  source: string;
  sourceLabel: string;
  path: string;
  title: string;
  archived: boolean;
  hits: number;
  snippets: { line: number; text: string }[];
};
export type SearchResponse = { q: string; results: SearchResult[]; truncated: boolean };
