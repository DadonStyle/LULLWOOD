import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTapSubtestFiles, checkCollection } from './check-test-collection.mjs';

// ---- parseTapSubtestFiles --------------------------------------------------

test('parseTapSubtestFiles pulls file paths out of "# Subtest:" lines', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: lib/game/cover.test.ts',
    'ok 1 - lib/game/cover.test.ts',
    '# Subtest: scripts/check-merge-gap.test.mjs',
    'ok 2 - scripts/check-merge-gap.test.mjs',
  ].join('\n');
  assert.deepEqual(parseTapSubtestFiles(tap), ['lib/game/cover.test.ts', 'scripts/check-merge-gap.test.mjs']);
});

test('parseTapSubtestFiles returns empty for TAP output with no subtests', () => {
  assert.deepEqual(parseTapSubtestFiles('TAP version 13\n# tests 0\n# pass 0\n'), []);
});

// ---- checkCollection --------------------------------------------------------

test('the LUL-2599 shape: .test.ts files on disk, none collected -- must fail loud', () => {
  const onDisk = ['lib/game/cover.test.ts', 'lib/game/scent.test.ts'];
  const ran = ['scripts/check-merge-gap.test.mjs'];
  const result = checkCollection(onDisk, ran, '22.17.0');
  assert.equal(result.ok, false);
  assert.match(result.message, /found 2 \*\.test\.ts file\(s\) on disk/);
  assert.match(result.message, /v22\.17\.0/);
});

test('.test.ts files on disk and at least one collected -- ok even if not all ran (test-name filters etc.)', () => {
  const onDisk = ['lib/game/cover.test.ts', 'lib/game/scent.test.ts'];
  const ran = ['lib/game/cover.test.ts', 'scripts/check-merge-gap.test.mjs'];
  assert.deepEqual(checkCollection(onDisk, ran, '22.23.2'), { ok: true });
});

test('no .test.ts files on disk at all -- nothing to collect, not a failure', () => {
  assert.deepEqual(checkCollection([], ['scripts/check-merge-gap.test.mjs'], '20.11.0'), { ok: true });
});
