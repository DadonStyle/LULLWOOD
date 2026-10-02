import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireflyGlowWeightAt, fireflyGlowDetectMul } from './fireflyDetect.ts';

const CLUSTERS = [
  { kind: 'firefly', x: 0, z: 100, radius: 45 },
  { kind: 'firefly', x: 40, z: -110, radius: 45 },
];

test('fireflyGlowWeightAt: 1 at a cluster center, 0 at/beyond its radius edge', () => {
  assert.equal(fireflyGlowWeightAt(0, 100, CLUSTERS), 1);
  assert.equal(fireflyGlowWeightAt(45, 100, CLUSTERS), 0);
  assert.equal(fireflyGlowWeightAt(100, 100, CLUSTERS), 0);
});

test('fireflyGlowWeightAt: 0.5 at exactly half the radius (linear falloff)', () => {
  assert.equal(fireflyGlowWeightAt(22.5, 100, CLUSTERS), 0.5);
});

test('fireflyGlowWeightAt: 0 for an empty cluster list', () => {
  assert.equal(fireflyGlowWeightAt(0, 100, []), 0);
});

test('fireflyGlowWeightAt: takes the max of two overlapping clusters, not the sum', () => {
  const overlapping = [
    { kind: 'firefly', x: 0, z: 0, radius: 20 },
    { kind: 'firefly', x: 10, z: 0, radius: 20 },
  ];
  // (5,0) is 5 from the first center (w=0.75) and 5 from the second (w=0.75) -- summed
  // would read 1.5, clamped or not that's wrong either way; max is the correct 0.75.
  assert.equal(fireflyGlowWeightAt(5, 0, overlapping), 0.75);
});

test('fireflyGlowDetectMul: 1 (no-op) outside every cluster regardless of bonus', () => {
  assert.equal(fireflyGlowDetectMul(1000, 1000, CLUSTERS, 0.3), 1);
});

test('fireflyGlowDetectMul: 1 + bonus at a cluster center', () => {
  assert.equal(fireflyGlowDetectMul(0, 100, CLUSTERS, 0.3), 1.3);
});

test('fireflyGlowDetectMul: ramps monotonically as distance to center shrinks', () => {
  const far = fireflyGlowDetectMul(44, 100, CLUSTERS, 0.3);
  const mid = fireflyGlowDetectMul(22, 100, CLUSTERS, 0.3);
  const near = fireflyGlowDetectMul(2, 100, CLUSTERS, 0.3);
  assert.ok(far < mid);
  assert.ok(mid < near);
});
