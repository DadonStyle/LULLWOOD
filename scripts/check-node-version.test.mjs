import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMinVersion, isAtLeast, checkNodeVersion } from './check-node-version.mjs';

test('parseMinVersion reads a ">=X.Y.Z" range', () => {
  assert.deepEqual(parseMinVersion('>=22.18.0'), [22, 18, 0]);
});

test('parseMinVersion rejects an unsupported range shape', () => {
  assert.throws(() => parseMinVersion('^22.18.0'));
  assert.throws(() => parseMinVersion(undefined));
});

test('isAtLeast compares major.minor.patch in order', () => {
  assert.equal(isAtLeast([22, 18, 0], [22, 18, 0]), true);
  assert.equal(isAtLeast([22, 23, 2], [22, 18, 0]), true);
  assert.equal(isAtLeast([24, 0, 0], [22, 18, 0]), true);
  assert.equal(isAtLeast([22, 17, 9], [22, 18, 0]), false);
  assert.equal(isAtLeast([20, 99, 0], [22, 18, 0]), false);
});

// ---- checkNodeVersion -------------------------------------------------------

test('the LUL-2599 shape: Node 22.17 is below the type-stripping threshold -- must fail loud', () => {
  const result = checkNodeVersion('>=22.18.0', '22.17.0');
  assert.equal(result.ok, false);
  assert.match(result.message, /requires Node >=22.18.0/);
  assert.match(result.message, /v22\.17\.0/);
});

test('the CI shape: Node 22.23.2 satisfies >=22.18.0', () => {
  assert.deepEqual(checkNodeVersion('>=22.18.0', '22.23.2'), { ok: true });
});

test('a newer major (Node 24) still satisfies >=22.18.0', () => {
  assert.deepEqual(checkNodeVersion('>=22.18.0', '24.19.0'), { ok: true });
});
