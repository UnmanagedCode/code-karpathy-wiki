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
