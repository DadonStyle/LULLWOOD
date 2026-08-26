import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMergeGaps, parseThresholdMinutes } from './check-merge-gap.mjs';

const NOW = Date.parse('2026-08-26T02:00:00Z');

function pr(number, { mergeableState = 'clean', sha = 'headsha', title = `PR ${number}` } = {}) {
  return {
    number,
    title,
    html_url: `https://github.com/DadonStyle/LULLWOOD/pull/${number}`,
    mergeable_state: mergeableState,
    head: { sha },
  };
}

function review(login, state, { sha = 'headsha', minutesAgo = 90 } = {}) {
  return {
    user: { login },
    state,
    commit_id: sha,
    submitted_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  };
}

// ---- findMergeGaps ---------------------------------------------------------

test('the #132 shape: approved at head but blocked -- must NOT flag (false-positive class that burned us)', () => {
  const p = pr(132, { mergeableState: 'blocked', sha: 'c4de0a3' });
  const reviews = { 132: [review('code-reviewer', 'APPROVED', { sha: 'c4de0a3', minutesAgo: 500 })] };
  assert.deepEqual(findMergeGaps([p], reviews, NOW, 60), []);
});

test('the #119 shape: verdict on a stale SHA -- not an approval of what would merge', () => {
  const p = pr(119, { mergeableState: 'blocked', sha: 'c91743e' });
  const reviews = { 119: [review('code-reviewer', 'CHANGES_REQUESTED', { sha: 'f7a3fed', minutesAgo: 500 })] };
  assert.deepEqual(findMergeGaps([p], reviews, NOW, 60), []);
});

test('the #115 shape: same login, CHANGES_REQUESTED then APPROVED -- latest-per-reviewer picks the approval, but dirty means still no gap', () => {
  const p = pr(115, { mergeableState: 'dirty', sha: '5185034' });
  const reviews = {
    115: [
      review('code-reviewer', 'CHANGES_REQUESTED', { sha: '75afbea', minutesAgo: 600 }),
      review('code-reviewer', 'APPROVED', { sha: '5185034', minutesAgo: 500 }),
    ],
  };
  assert.deepEqual(findMergeGaps([p], reviews, NOW, 60), []);
});

test('approved then changes-requested from the same login -- the later verdict overrides, not a gap even when clean', () => {
  const p = pr(200, { mergeableState: 'clean', sha: 'abc123' });
  const reviews = {
    200: [
      review('code-reviewer', 'APPROVED', { sha: 'abc123', minutesAgo: 500 }),
      review('code-reviewer', 'CHANGES_REQUESTED', { sha: 'abc123', minutesAgo: 400 }),
    ],
  };
  assert.deepEqual(findMergeGaps([p], reviews, NOW, 60), []);
});

test('a fresh approval under the threshold is not yet a gap', () => {
  const p = pr(201, { mergeableState: 'clean', sha: 'abc123' });
  const reviews = { 201: [review('code-reviewer', 'APPROVED', { sha: 'abc123', minutesAgo: 10 })] };
  assert.deepEqual(findMergeGaps([p], reviews, NOW, 60), []);
});

test('an approval exactly at the threshold is not yet a gap (boundary is exclusive)', () => {
  const p = pr(202, { mergeableState: 'clean', sha: 'abc123' });
  const reviews = { 202: [review('code-reviewer', 'APPROVED', { sha: 'abc123', minutesAgo: 60 })] };
  assert.deepEqual(findMergeGaps([p], reviews, NOW, 60), []);
});

test('a genuine gap: clean + approved at head + over threshold -- must flag', () => {
  const p = pr(203, { mergeableState: 'clean', sha: 'abc123', title: 'a real merge gap' });
  const reviews = { 203: [review('code-reviewer', 'APPROVED', { sha: 'abc123', minutesAgo: 90 })] };
  const gaps = findMergeGaps([p], reviews, NOW, 60);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].number, 203);
  assert.equal(gaps[0].title, 'a real merge gap');
  assert.ok(gaps[0].ageMinutes >= 90);
});

test('clean with zero reviews is not a gap', () => {
  const p = pr(204, { mergeableState: 'clean', sha: 'abc123' });
  assert.deepEqual(findMergeGaps([p], {}, NOW, 60), []);
});

test('dirty with an old approval at head is not a gap -- mergeable_state gates everything else', () => {
  const p = pr(205, { mergeableState: 'dirty', sha: 'abc123' });
  const reviews = { 205: [review('code-reviewer', 'APPROVED', { sha: 'abc123', minutesAgo: 500 })] };
  assert.deepEqual(findMergeGaps([p], reviews, NOW, 60), []);
});

test('accepts reviewsByPrNumber as a Map, not just a plain object', () => {
  const p = pr(206, { mergeableState: 'clean', sha: 'abc123' });
  const reviews = new Map([[206, [review('code-reviewer', 'APPROVED', { sha: 'abc123', minutesAgo: 90 })]]]);
  const gaps = findMergeGaps([p], reviews, NOW, 60);
  assert.equal(gaps.length, 1);
});

test('a mixed batch only returns the actual gaps, not the clean-but-not-yet-due or non-clean PRs', () => {
  const prs = [
    pr(10, { mergeableState: 'clean', sha: 'sha10', title: 'genuine gap' }),
    pr(11, { mergeableState: 'blocked', sha: 'sha11', title: 'blocked, approved at head' }),
    pr(12, { mergeableState: 'clean', sha: 'sha12', title: 'clean but fresh approval' }),
  ];
  const reviews = {
    10: [review('code-reviewer', 'APPROVED', { sha: 'sha10', minutesAgo: 500 })],
    11: [review('code-reviewer', 'APPROVED', { sha: 'sha11', minutesAgo: 500 })],
    12: [review('code-reviewer', 'APPROVED', { sha: 'sha12', minutesAgo: 5 })],
  };
  const gaps = findMergeGaps(prs, reviews, NOW, 60);
  assert.deepEqual(gaps.map((g) => g.number), [10]);
});

test('sorts multiple gaps oldest-approval-first', () => {
  const prs = [
    pr(1, { mergeableState: 'clean', sha: 's1' }),
    pr(2, { mergeableState: 'clean', sha: 's2' }),
    pr(3, { mergeableState: 'clean', sha: 's3' }),
  ];
  const reviews = {
    1: [review('code-reviewer', 'APPROVED', { sha: 's1', minutesAgo: 70 })],
    2: [review('code-reviewer', 'APPROVED', { sha: 's2', minutesAgo: 500 })],
    3: [review('code-reviewer', 'APPROVED', { sha: 's3', minutesAgo: 61 })],
  };
  const gaps = findMergeGaps(prs, reviews, NOW, 60);
  assert.deepEqual(gaps.map((g) => g.number), [2, 1, 3]);
});

// ---- parseThresholdMinutes --------------------------------------------------

test('parseThresholdMinutes accepts an explicit 0 instead of coercing it to the default', () => {
  assert.equal(parseThresholdMinutes('0'), 0);
});

test('parseThresholdMinutes falls back to the default when unset or garbage', () => {
  assert.equal(parseThresholdMinutes(undefined), 60);
  assert.equal(parseThresholdMinutes(''), 60);
  assert.equal(parseThresholdMinutes('not-a-number'), 60);
});

test('parseThresholdMinutes honours a positive override', () => {
  assert.equal(parseThresholdMinutes('15'), 15);
});
