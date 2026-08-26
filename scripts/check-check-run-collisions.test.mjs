import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCollisions } from './check-check-run-collisions.mjs';

function run(name, conclusion, startedAt, status = 'completed') {
  return { name, status, conclusion, started_at: startedAt };
}

// ---- findCollisions --------------------------------------------------------

test('flags a later skip landing on top of an earlier success -- the LUL-719/#137 shape', () => {
  const checkRuns = [
    run('build, typecheck, lint', 'success', '2026-08-26T07:37:03Z'),
    run('build, typecheck, lint', 'skipped', '2026-08-26T08:30:11Z'),
    run('unit tests', 'success', '2026-08-26T07:37:03Z'),
    run('unit tests', 'skipped', '2026-08-26T08:30:11Z'),
    run('playwright smoke suite', 'success', '2026-08-26T07:37:44Z'),
    run('playwright smoke suite', 'skipped', '2026-08-26T08:30:11Z'),
  ];
  const collisions = findCollisions(checkRuns);
  assert.equal(collisions.length, 3);
  assert.deepEqual(
    collisions.map((c) => c.name),
    ['build, typecheck, lint', 'playwright smoke suite', 'unit tests'],
  );
  assert.equal(collisions[0].maskedConclusion, 'success');
});

test('does NOT flag a context with only a skipped instance and no earlier real one -- vacuous, not masked', () => {
  // "workflow guard check" on PR #137: no successful instance at all, just
  // the one skip. Nothing real got overwritten, so this isn't a collision by
  // this script's definition -- it's a gate that never ran, a different
  // (already-fixed-by-removing-the-trigger) problem.
  const checkRuns = [run('workflow guard check', 'skipped', '2026-08-26T08:30:11Z')];
  assert.deepEqual(findCollisions(checkRuns), []);
});

test('does not flag a single successful instance', () => {
  const checkRuns = [run('unit tests', 'success', '2026-08-26T07:37:03Z')];
  assert.deepEqual(findCollisions(checkRuns), []);
});

test('does not flag when the LATER instance is the real one (skip came first)', () => {
  const checkRuns = [
    run('unit tests', 'skipped', '2026-08-26T07:00:00Z'),
    run('unit tests', 'success', '2026-08-26T07:10:00Z'),
  ];
  assert.deepEqual(findCollisions(checkRuns), []);
});

test('does not flag two skipped instances with no real instance at all', () => {
  const checkRuns = [
    run('unit tests', 'skipped', '2026-08-26T07:00:00Z'),
    run('unit tests', 'skipped', '2026-08-26T07:10:00Z'),
  ];
  assert.deepEqual(findCollisions(checkRuns), []);
});

test('flags a later skip masking an earlier real FAILURE, not just success -- the dangerous case', () => {
  const checkRuns = [
    run('build, typecheck, lint', 'failure', '2026-08-26T07:37:03Z'),
    run('build, typecheck, lint', 'skipped', '2026-08-26T08:30:11Z'),
  ];
  const collisions = findCollisions(checkRuns);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].maskedConclusion, 'failure');
});

test('ignores an in-progress (not yet completed) later instance', () => {
  const checkRuns = [
    run('unit tests', 'success', '2026-08-26T07:00:00Z'),
    run('unit tests', null, '2026-08-26T07:10:00Z', 'in_progress'),
  ];
  assert.deepEqual(findCollisions(checkRuns), []);
});

test('a mixed batch only returns the actual collisions, not the clean contexts', () => {
  const checkRuns = [
    run('vercel preview comments', 'success', '2026-08-26T07:38:05Z'),
    run('build, typecheck, lint', 'success', '2026-08-26T07:37:03Z'),
    run('build, typecheck, lint', 'skipped', '2026-08-26T08:30:11Z'),
  ];
  const collisions = findCollisions(checkRuns);
  assert.deepEqual(
    collisions.map((c) => c.name),
    ['build, typecheck, lint'],
  );
});

test('picks the most recent real instance as the masked one when there are several', () => {
  const checkRuns = [
    run('unit tests', 'failure', '2026-08-26T06:00:00Z'),
    run('unit tests', 'success', '2026-08-26T07:00:00Z'),
    run('unit tests', 'skipped', '2026-08-26T08:00:00Z'),
  ];
  const collisions = findCollisions(checkRuns);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].maskedConclusion, 'success');
  assert.equal(collisions[0].maskedAt, '2026-08-26T07:00:00Z');
});

// ---- requiredNames scoping (the "merge if green and shipped" false-alarm case) --------------

test('with no requiredNames given, every collision is treated as required (safe default)', () => {
  const checkRuns = [
    run('merge if green and shipped', 'success', '2026-08-26T07:00:00Z'),
    run('merge if green and shipped', 'skipped', '2026-08-26T08:00:00Z'),
  ];
  const collisions = findCollisions(checkRuns);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].required, true);
});

test('with requiredNames given, a colliding context absent from the set is marked non-required -- automerge.yml is not a required check', () => {
  const checkRuns = [
    run('unit tests', 'success', '2026-08-26T06:03:14Z'),
    run('unit tests', 'skipped', '2026-08-26T06:03:17Z'),
    run('merge if green and shipped', 'success', '2026-08-26T07:23:10Z'),
    run('merge if green and shipped', 'skipped', '2026-08-26T11:18:00Z'),
  ];
  const requiredNames = new Set(['build, typecheck, lint', 'unit tests', 'playwright smoke suite']);
  const collisions = findCollisions(checkRuns, requiredNames);
  assert.equal(collisions.length, 2);
  const byName = Object.fromEntries(collisions.map((c) => [c.name, c.required]));
  assert.equal(byName['unit tests'], true);
  assert.equal(byName['merge if green and shipped'], false);
});
