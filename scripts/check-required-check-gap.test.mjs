import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRequiredCheckGaps, parseGraceMinutes, countRequiredContexts } from './check-required-check-gap.mjs';

const NOW = Date.parse('2026-08-26T21:30:00Z');

function rollup(number, { requiredContextCount = 3, minutesOld = 90, title = `PR ${number}` } = {}) {
  return {
    number,
    title,
    url: `https://github.com/DadonStyle/LULLWOOD/pull/${number}`,
    committedDate: new Date(NOW - minutesOld * 60_000).toISOString(),
    requiredContextCount,
  };
}

// ---- findRequiredCheckGaps --------------------------------------------------

test('the #148 shape: workflow_dispatch-only head, zero required contexts, old enough -- must flag', () => {
  const p = rollup(148, { requiredContextCount: 0, minutesOld: 90, title: 'lul-685-watchdog-wake-router' });
  const gaps = findRequiredCheckGaps([p], NOW, 5);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].number, 148);
  assert.ok(gaps[0].ageMinutes >= 90);
});

test('a normal push-covered PR with required contexts present is never a gap, regardless of age', () => {
  const p = rollup(146, { requiredContextCount: 3, minutesOld: 100000 });
  assert.deepEqual(findRequiredCheckGaps([p], NOW, 5), []);
});

test('a freshly pushed head with zero contexts yet is within grace -- not a gap', () => {
  const p = rollup(200, { requiredContextCount: 0, minutesOld: 2 });
  assert.deepEqual(findRequiredCheckGaps([p], NOW, 5), []);
});

test('exactly at the grace boundary is not yet a gap (boundary is exclusive)', () => {
  const p = rollup(201, { requiredContextCount: 0, minutesOld: 5 });
  assert.deepEqual(findRequiredCheckGaps([p], NOW, 5), []);
});

test('one tick past the grace boundary with zero contexts is a gap', () => {
  const p = rollup(202, { requiredContextCount: 0, minutesOld: 5.01 });
  const gaps = findRequiredCheckGaps([p], NOW, 5);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].number, 202);
});

test('a mixed batch only returns the actual gaps', () => {
  const rollups = [
    rollup(10, { requiredContextCount: 3, minutesOld: 500, title: 'covered' }),
    rollup(11, { requiredContextCount: 0, minutesOld: 500, title: 'structurally uncovered' }),
    rollup(12, { requiredContextCount: 0, minutesOld: 1, title: 'fresh, within grace' }),
  ];
  const gaps = findRequiredCheckGaps(rollups, NOW, 5);
  assert.deepEqual(gaps.map((g) => g.number), [11]);
});

test('sorts multiple gaps oldest-head-first', () => {
  const rollups = [
    rollup(1, { requiredContextCount: 0, minutesOld: 20 }),
    rollup(2, { requiredContextCount: 0, minutesOld: 500 }),
    rollup(3, { requiredContextCount: 0, minutesOld: 90 }),
  ];
  const gaps = findRequiredCheckGaps(rollups, NOW, 5);
  assert.deepEqual(gaps.map((g) => g.number), [2, 3, 1]);
});

// ---- parseGraceMinutes -------------------------------------------------------

test('parseGraceMinutes accepts an explicit 0 instead of coercing it to the default', () => {
  assert.equal(parseGraceMinutes('0'), 0);
});

test('parseGraceMinutes falls back to the default when unset or garbage', () => {
  assert.equal(parseGraceMinutes(undefined), 5);
  assert.equal(parseGraceMinutes(''), 5);
  assert.equal(parseGraceMinutes('not-a-number'), 5);
});

test('parseGraceMinutes honours a positive override', () => {
  assert.equal(parseGraceMinutes('15'), 15);
});

// ---- countRequiredContexts ----------------------------------------------------

test('countRequiredContexts counts only isRequired:true nodes, mixing CheckRun and StatusContext shapes', () => {
  const nodes = [
    { __typename: 'CheckRun', name: 'build, typecheck, lint', isRequired: true },
    { __typename: 'CheckRun', name: 'playwright smoke suite', isRequired: true },
    { __typename: 'StatusContext', context: 'Vercel', isRequired: false },
  ];
  assert.equal(countRequiredContexts(nodes), 2);
});

test('countRequiredContexts returns 0 for an empty rollup (the #148 shape)', () => {
  assert.equal(countRequiredContexts([]), 0);
});
