import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAdjacentPosts, getAllPosts } from './devlog.ts';

test('a middle post links one step older and one step newer by date', () => {
  const posts = getAllPosts(); // newest first
  const { older, newer } = getAdjacentPosts(posts[1].slug);
  assert.equal(newer?.slug, posts[0].slug);
  assert.equal(older?.slug, posts[2].slug);
});

test('the newest post has no newer neighbour and the oldest has no older one', () => {
  const posts = getAllPosts();
  assert.equal(getAdjacentPosts(posts[0].slug).newer, undefined);
  assert.equal(getAdjacentPosts(posts[posts.length - 1].slug).older, undefined);
});

test('an unknown slug has no neighbours', () => {
  assert.deepEqual(getAdjacentPosts('no-such-post'), {});
});
