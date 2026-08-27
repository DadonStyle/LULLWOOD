import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReviewGaps, DEFAULT_THRESHOLD_MINUTES } from './check-review-gap.mjs';

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
  const gaps = findReviewGaps([pr], {}, NOW, 360);
  assert.deepEqual(gaps, []);
});

test('a PR exactly at the threshold is not yet a gap (boundary is exclusive)', () => {
  const pr = prOpenedMinutesAgo(92, 360);
  const gaps = findReviewGaps([pr], {}, NOW, 360);
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

// ---- LUL-780: pinning the measured review-turnaround distribution --------
// 12 of the last 33 merged PRs (36%) took longer than 60m to get a first
// review and all 12 merged fine -- that population must not fire at the
// production default. PR #128 (87.8h to first review) was genuinely stalled
// and must still fire. These use the module's real default, not a literal,
// so a regression to the old 60m value turns this red.

test('does not flag a zero-review PR at 250 minutes -- normal turnaround, not a gap at the production default', () => {
  const pr = prOpenedMinutesAgo(200, 250, 'normal turnaround');
  const gaps = findReviewGaps([pr], {}, NOW, DEFAULT_THRESHOLD_MINUTES);
  assert.deepEqual(gaps, []);
});

test('flags a zero-review PR at 5273 minutes -- the PR #128 shape, genuinely stalled', () => {
  const pr = prOpenedMinutesAgo(128, 5273, 'PR #128 shape');
  const gaps = findReviewGaps([pr], {}, NOW, DEFAULT_THRESHOLD_MINUTES);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].number, 128);
});
