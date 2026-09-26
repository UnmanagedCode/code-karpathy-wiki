// What the sidebar shows for a source, from its /api/tree root node. Pure, so
// the "unreadable root is never an empty wiki" rule is testable without a DOM.
export function sourceStatus(tree, fetchError) {
  if (fetchError || !tree) return 'fetch-error';
  if (tree.error) return 'unreadable';
  if (!tree.dirs.length && !tree.pages.length) return tree.index ? 'index-only' : 'empty';
  return 'tree';
}
