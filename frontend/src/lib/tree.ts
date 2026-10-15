// Sidebar tree rules, pure so they are testable without rendering.
import type { TreeNode } from './types';

export type SourceStatus = 'fetch-error' | 'unreadable' | 'index-only' | 'empty' | 'tree';

/** What the sidebar shows for a source. An unreadable root is never an empty wiki. */
export function sourceStatus(tree: TreeNode | null | undefined, fetchError?: unknown): SourceStatus {
  if (fetchError || !tree) return 'fetch-error';
  if (tree.error) return 'unreadable';
  if (!tree.dirs.length && !tree.pages.length) return tree.index ? 'index-only' : 'empty';
  return 'tree';
}

/** Top-level directories start open; archived ones start collapsed. */
export const initiallyOpen = (node: TreeNode, depth: number): boolean => depth === 1 && !node.archived;

/** Every directory the page `rel` sits in (or is the index of), outermost first: these open to reveal it. */
export function ancestorDirs(rel: string): string[] {
  const segs = rel.split('/');
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join('/'));
  return out;
}

/** Only the archive root is badged, not every directory below it. */
export const showsArchiveBadge = (node: TreeNode): boolean => node.archived && node.path === 'global/archive';

/**
 * Which directories are expanded, shared by every sidebar instance (the pane and the phone drawer) and kept across
 * reloads. Keys are `dirKey(source, path)`. `seen` holds every directory ever seeded, so a reload seeds only the
 * directories new to it and never undoes the user's toggles.
 */
export type DirState = { open: ReadonlySet<string>; seen: ReadonlySet<string> };
export const EMPTY_DIRS: DirState = { open: new Set(), seen: new Set() };
export const dirKey = (source: string, path: string): string => `${source}|${path}`;

/** `state` with every directory not seen before marked seen, and opened when `initiallyOpen` says so. */
export function seedDirs(state: DirState, trees: Record<string, { tree?: TreeNode } | undefined>): DirState {
  let open: Set<string> | null = null;
  let seen: Set<string> | null = null;
  const visit = (source: string, node: TreeNode, depth: number) => {
    const key = dirKey(source, node.path);
    if (!state.seen.has(key)) {
      seen ??= new Set(state.seen);
      seen.add(key);
      if (initiallyOpen(node, depth)) (open ??= new Set(state.open)).add(key);
    }
    for (const d of node.dirs) visit(source, d, depth + 1);
  };
  for (const [source, result] of Object.entries(trees)) for (const d of result?.tree?.dirs ?? []) visit(source, d, 1);
  return seen ? { open: open ?? state.open, seen } : state;
}

/** `state` with every directory above the page `rel` open, so the page shows in its tree. */
export function openAncestors(state: DirState, source: string, rel: string): DirState {
  const missing = ancestorDirs(rel).map((p) => dirKey(source, p)).filter((k) => !state.open.has(k));
  return missing.length ? { ...state, open: new Set([...state.open, ...missing]) } : state;
}

/** `state` with directory `key` flipped. */
export function toggleDir(state: DirState, key: string): DirState {
  const open = new Set(state.open);
  if (!open.delete(key)) open.add(key);
  return { ...state, open };
}
