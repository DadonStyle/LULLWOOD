import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapCellIndex, wrapCoord, wrapDelta, wrapDist } from './wrap.ts';

// ---- wrapCoord --------------------------------------------------------------

test('wrapCoord is a no-op for a value already inside the canonical range', () => {
  assert.equal(wrapCoord(10, 240), 10);
  assert.equal(wrapCoord(-119.9, 240), -119.9);
});

test('wrapCoord pulls a value past the high edge back around', () => {
  assert.equal(wrapCoord(130, 240), -110);
});

test('wrapCoord pulls a value past the low edge back around', () => {
  assert.equal(wrapCoord(-130, 240), 110);
});

test('wrapCoord is idempotent: wrapping an already-canonical value changes nothing', () => {
  for (const v of [-119.9, -60, 0, 60, 119.9, 500, -500]) {
    const once = wrapCoord(v, 240);
    assert.equal(wrapCoord(once, 240), once);
  }
});

test('wrapCoord(Infinity span) is the identity for any finite value', () => {
  for (const v of [-1000, -0.001, 0, 0.001, 1000]) {
    assert.equal(wrapCoord(v, Infinity), v);
  }
});

// ---- wrapDelta --------------------------------------------------------------

test('wrapDelta matches a-b directly when both points are far from the seam', () => {
  assert.equal(wrapDelta(10, 4, 240), 6);
});

test('wrapDelta takes the short way across the seam instead of the raw 238', () => {
  // a=-119, b=119, span=240: raw a-b = -238, but the short signed delta
  // going the wrap way is +2 (from 119, +2 lands at 121 which wraps to -119).
  assert.equal(wrapDelta(-119, 119, 240), 2);
});

test('wrapDelta is antisymmetric: wrapDelta(a,b,s) === -wrapDelta(b,a,s)', () => {
  const cases: [number, number, number][] = [
    [10, 4, 240],
    [-119, 119, 240],
    [119, -119, 240],
  ];
  for (const [a, b, s] of cases) {
    assert.equal(wrapDelta(a, b, s), -wrapDelta(b, a, s));
  }
});

test('wrapDelta at exactly +-span/2 resolves to the canonical boundary, not the raw value', () => {
  // span=240: +-120 is the boundary. wrapCoord folds +120 down to -120, so
  // wrapDelta(120, 0, 240) === wrapCoord(120, 240) === -120, not 120.
  assert.equal(wrapDelta(120, 0, 240), -120);
  assert.equal(wrapDelta(-120, 0, 240), -120);
});

test('wrapDelta(a,b,Infinity) === a-b -- the no-op property the flag mechanism depends on', () => {
  const cases: [number, number][] = [[10, 4], [-119, 119], [0, 0], [1e6, -1e6]];
  for (const [a, b] of cases) {
    assert.equal(wrapDelta(a, b, Infinity), a - b);
  }
});

// ---- wrapDist ---------------------------------------------------------------

test('wrapDist takes the short diagonal across both axes independently', () => {
  // Two points diagonally across the seam on both x and z.
  const d = wrapDist(-119, -119, 119, 119, 240, 240);
  assert.ok(Math.abs(d - Math.hypot(2, 2)) < 1e-9);
});

test('wrapDist(Infinity, Infinity) matches plain Euclidean distance', () => {
  const d = wrapDist(10, 4, -119, 119, Infinity, Infinity);
  assert.ok(Math.abs(d - Math.hypot(10 - -119, 4 - 119)) < 1e-9);
});

// ---- wrapCellIndex ------------------------------------------------------------

test('wrapCellIndex is a no-op inside the canonical cell range', () => {
  assert.equal(wrapCellIndex(3, 30), 3);
  assert.equal(wrapCellIndex(-14, 30), -14);
});

test('wrapCellIndex wraps a cell index past either edge', () => {
  assert.equal(wrapCellIndex(16, 30), -14);
  assert.equal(wrapCellIndex(-16, 30), 14);
});

test('wrapCellIndex(Infinity cellCount) is the identity', () => {
  for (const i of [-100, -1, 0, 1, 100]) {
    assert.equal(wrapCellIndex(i, Infinity), i);
  }
});
