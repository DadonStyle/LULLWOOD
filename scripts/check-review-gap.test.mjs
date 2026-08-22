import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReviewGaps } from './check-review-gap.mjs';

const NOW = Date.parse('2026-08-20T12:00:00Z');

function prOpenedMinutesAgo(number, minutesAgo, title = `PR ${number}`) {
  return {
    number,
    title,
    html_url: `https://github.com/DadonStyle/LULLWOOD/pull/${number}`,
    created_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  };
}

// ---- findReviewGaps -------------------------------------------------------

test('flags an open PR with zero reviews older than the threshold -- the LUL-511/#86 shape', () => {
  const pr = prOpenedMinutesAgo(86, 90, 'LUL-511 fix');
  const gaps = findReviewGaps([pr], {}, NOW, 60);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].number, 86);
  assert.equal(gaps[0].title, 'LUL-511 fix');
  assert.ok(gaps[0].ageMinutes >= 90);
});

test('does not flag a PR with at least one GitHub review, however old', () => {
  const pr = prOpenedMinutesAgo(90, 500);
  const reviewsByPrNumber = { 90: [{ id: 1, state: 'APPROVED' }] };
  const gaps = findReviewGaps([pr], reviewsByPrNumber, NOW, 60);
  assert.deepEqual(gaps, []);
});

test('does not flag a zero-review PR still under the threshold', () => {
  const pr = prOpenedMinutesAgo(91, 10);
  const gaps = findReviewGaps([pr], {}, NOW, 60);
  assert.deepEqual(gaps, []);
});

test('a PR exactly at the threshold is not yet a gap (boundary is exclusive)', () => {
  const pr = prOpenedMinutesAgo(92, 60);
  const gaps = findReviewGaps([pr], {}, NOW, 60);
  assert.deepEqual(gaps, []);
});

test('sorts multiple gaps oldest-first', () => {
  const prs = [prOpenedMinutesAgo(1, 70), prOpenedMinutesAgo(2, 500), prOpenedMinutesAgo(3, 61)];
  const gaps = findReviewGaps(prs, {}, NOW, 60);
  assert.deepEqual(gaps.map((g) => g.number), [2, 1, 3]);
});

test('accepts reviewsByPrNumber as a Map, not just a plain object', () => {
  const pr = prOpenedMinutesAgo(5, 500);
  const reviewsByPrNumber = new Map([[5, [{ id: 1, state: 'CHANGES_REQUESTED' }]]]);
  const gaps = findReviewGaps([pr], reviewsByPrNumber, NOW, 60);
  assert.deepEqual(gaps, []);
});

test('a mixed batch only returns the actual gaps, not the clean PRs', () => {
  const prs = [
    prOpenedMinutesAgo(10, 500, 'stale, zero reviews'),
    prOpenedMinutesAgo(11, 500, 'stale, reviewed'),
    prOpenedMinutesAgo(12, 5, 'fresh, zero reviews'),
  ];
  const reviewsByPrNumber = { 11: [{ id: 1, state: 'APPROVED' }] };
  const gaps = findReviewGaps(prs, reviewsByPrNumber, NOW, 60);
  assert.deepEqual(gaps.map((g) => g.number), [10]);
});
