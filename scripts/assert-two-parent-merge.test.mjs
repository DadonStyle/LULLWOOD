import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasTwoParents } from './assert-two-parent-merge.mjs';

test('a real merge commit (release/next merged into main) has two parents', () => {
  const commit = { sha: 'cut123', parents: [{ sha: 'main-tip' }, { sha: 'release-next-tip' }] };
  assert.equal(hasTwoParents(commit), true);
});

test('a squash-merged commit has exactly one parent -- must be rejected', () => {
  const commit = { sha: 'squashed456', parents: [{ sha: 'main-tip' }] };
  assert.equal(hasTwoParents(commit), false);
});

test('an octopus merge (3+ parents) still counts as a real merge', () => {
  const commit = { sha: 'octopus789', parents: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }] };
  assert.equal(hasTwoParents(commit), true);
});

test('a root commit with no parents is rejected, not treated as vacuously fine', () => {
  const commit = { sha: 'root000', parents: [] };
  assert.equal(hasTwoParents(commit), false);
});

test('a missing parents field is rejected rather than throwing', () => {
  assert.equal(hasTwoParents({ sha: 'malformed' }), false);
});
