import { describe, expect, it } from 'vitest';
import { dir } from '@/test/fixtures';
import { ancestorDirs, initiallyOpen, showsArchiveBadge, sourceStatus } from './tree';

describe('sourceStatus', () => {
  // Invariant: an unreadable source root is shown as an error, never as an empty wiki.
  it('an unreadable source root is "unreadable", never "empty"', () => {
    expect(sourceStatus(dir({ error: 'READ_FAILED' }))).toBe('unreadable');
    expect(sourceStatus(dir({ error: 'READ_FAILED', index: 'index.md' }))).toBe('unreadable');
    expect(sourceStatus(dir())).toBe('empty');
    expect(sourceStatus(dir({ index: 'index.md' }))).toBe('index-only');
    expect(sourceStatus(dir({ pages: [{ path: 'a.md', name: 'a', title: 'a' }] }))).toBe('tree');
    expect(sourceStatus(undefined, new Error('x'))).toBe('fetch-error');
  });
});

describe('tree rules', () => {
  // Invariant: top-level directories start open, archived ones and deeper ones start collapsed.
  it('initiallyOpen', () => {
    expect(initiallyOpen(dir({ path: 'global' }), 1)).toBe(true);
    expect(initiallyOpen(dir({ path: 'global/archive', archived: true }), 1)).toBe(false);
    expect(initiallyOpen(dir({ path: 'global/fam' }), 2)).toBe(false);
  });

  // Invariant: the directories revealed for a page are every directory it sits in, its own index's included.
  it('ancestorDirs', () => {
    expect(ancestorDirs('index.md')).toEqual([]);
    expect(ancestorDirs('global/a.md')).toEqual(['global']);
    expect(ancestorDirs('global/fam/index.md')).toEqual(['global', 'global/fam']);
    expect(ancestorDirs('a/b/c/d.md')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  // Invariant: only the archive root carries the archive badge.
  it('showsArchiveBadge', () => {
    expect(showsArchiveBadge(dir({ path: 'global/archive', archived: true }))).toBe(true);
    expect(showsArchiveBadge(dir({ path: 'global/archive/deep', archived: true }))).toBe(false);
    expect(showsArchiveBadge(dir({ path: 'global', archived: false }))).toBe(false);
  });
});
