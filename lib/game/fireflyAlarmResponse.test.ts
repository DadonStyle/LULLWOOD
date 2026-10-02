import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireflyAlarmBoost } from './fireflyAlarmResponse.ts';
import { CONFIG } from '../../engine/tuning.js';

const CLUSTER = { x: 0, z: 0, radius: 45, kind: 'firefly' };
const OTHER_CLUSTER = { x: 1000, z: 1000, radius: 45, kind: 'firefly' };
const PLAYER = { x: 0, z: 0 };

test('baseline (1.0) with no predators', () => {
  assert.equal(fireflyAlarmBoost([], [CLUSTER], PLAYER), 1);
});

test('baseline (1.0) when every predator is beyond FIREFLY_ALARM_RANGE', () => {
  const far = { x: CONFIG.FIREFLY_ALARM_RANGE + 50, z: 0 };
  assert.equal(fireflyAlarmBoost([far], [CLUSTER], PLAYER), 1);
});

test('peak (1 + FIREFLY_ALARM_BOOST) when a predator sits on the cluster center', () => {
  const onCenter = { x: 0, z: 0 };
  const boosted = fireflyAlarmBoost([onCenter], [CLUSTER], PLAYER);
  assert.ok(Math.abs(boosted - (1 + CONFIG.FIREFLY_ALARM_BOOST)) < 1e-9);
});

test('ramps linearly between baseline and peak at the range midpoint', () => {
  const mid = { x: CONFIG.FIREFLY_ALARM_RANGE / 2, z: 0 };
  const boosted = fireflyAlarmBoost([mid], [CLUSTER], PLAYER);
  assert.ok(Math.abs(boosted - (1 + CONFIG.FIREFLY_ALARM_BOOST * 0.5)) < 1e-9);
});

test('an inert predator contributes nothing', () => {
  const onCenter = { x: 0, z: 0, inert: true };
  assert.equal(fireflyAlarmBoost([onCenter], [CLUSTER], PLAYER), 1);
});

test('takes the nearest predator per cluster, not an average', () => {
  const near = { x: 5, z: 0 };
  const far = { x: CONFIG.FIREFLY_ALARM_RANGE + 50, z: 0 };
  const bothPredators = fireflyAlarmBoost([near, far], [CLUSTER], PLAYER);
  const nearOnly = fireflyAlarmBoost([near], [CLUSTER], PLAYER);
  assert.ok(Math.abs(bothPredators - nearOnly) < 1e-9);
});

test('a predator near an unrendered (mobile-budget-excluded) cluster still contributes the frame-global max', () => {
  const onOtherCenter = { x: OTHER_CLUSTER.x, z: OTHER_CLUSTER.z };
  const boosted = fireflyAlarmBoost([onOtherCenter], [CLUSTER, OTHER_CLUSTER], PLAYER);
  assert.ok(Math.abs(boosted - (1 + CONFIG.FIREFLY_ALARM_BOOST)) < 1e-9);
});

test('never drops below baseline or exceeds the configured peak', () => {
  const way = { x: 1e6, z: 1e6 };
  const onCenter = { x: 0, z: 0 };
  assert.equal(fireflyAlarmBoost([way], [CLUSTER], PLAYER), 1);
  const boosted = fireflyAlarmBoost([onCenter, onCenter], [CLUSTER], PLAYER);
  assert.ok(boosted <= 1 + CONFIG.FIREFLY_ALARM_BOOST + 1e-9);
});

// LUL-5761 cheap slice: per-species range lookup (bear/lion).
test('a bear alarms from beyond FIREFLY_ALARM_RANGE_LION, a lion at the same distance does not', () => {
  const d = (CONFIG.FIREFLY_ALARM_RANGE_LION + CONFIG.FIREFLY_ALARM_RANGE_BEAR) / 2;
  assert.ok(d > CONFIG.FIREFLY_ALARM_RANGE_LION && d < CONFIG.FIREFLY_ALARM_RANGE_BEAR);
  const bear = { x: d, z: 0, kind: 'bear' };
  const lion = { x: d, z: 0, kind: 'lion' };
  assert.ok(fireflyAlarmBoost([bear], [CLUSTER], PLAYER) > 1);
  assert.equal(fireflyAlarmBoost([lion], [CLUSTER], PLAYER), 1);
});

test('a lion outside its own range but inside the bear range still contributes nothing', () => {
  const d = CONFIG.FIREFLY_ALARM_RANGE_LION + 10;
  assert.ok(d < CONFIG.FIREFLY_ALARM_RANGE_BEAR);
  const lion = { x: d, z: 0, kind: 'lion' };
  assert.equal(fireflyAlarmBoost([lion], [CLUSTER], PLAYER), 1);
});

test('a bear and a lion each alarm their own in-range cluster -- the max ramp wins per pair, not a shared range', () => {
  const bearClose = { x: 10, z: 0, kind: 'bear' };
  const lionFar = { x: CONFIG.FIREFLY_ALARM_RANGE_LION - 5, z: 0, kind: 'lion' };
  const boosted = fireflyAlarmBoost([bearClose, lionFar], [CLUSTER], PLAYER);
  const bearOnly = fireflyAlarmBoost([bearClose], [CLUSTER], PLAYER);
  assert.ok(Math.abs(boosted - bearOnly) < 1e-9, 'bear (closer, larger ramp) should dominate the max');
});
