import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceStatus } from '../frontend/tree.js';

const node = (over = {}) => ({ name: '', path: '', index: null, archived: false, error: null, dirs: [], pages: [], ...over });

// Invariant: an unreadable source root is shown as an error, never as an empty wiki.
test('sidebar: an unreadable source root is "unreadable", never "empty"', () => {
  assert.equal(sourceStatus(node({ error: 'READ_FAILED' })), 'unreadable');
  assert.equal(sourceStatus(node({ error: 'READ_FAILED', index: 'index.md' })), 'unreadable');
  assert.equal(sourceStatus(node()), 'empty');
  assert.equal(sourceStatus(node({ index: 'index.md' })), 'index-only');
  assert.equal(sourceStatus(node({ pages: [{ path: 'a.md', name: 'a', title: 'a' }] })), 'tree');
  assert.equal(sourceStatus(undefined, new Error('x')), 'fetch-error');
});
