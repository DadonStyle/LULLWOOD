import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventCyclePhase,
  eventCycleBuildAmount,
  eventCycleActiveTarget,
  type EventCycleConfig,
} from './eventScheduler.ts';

const cfg: EventCycleConfig = { period: 90, activeDuration: 20, leadIn: 10 };
// activeStart = 70, signpost starts at 60

test('phase is calm through most of the cycle', () => {
  assert.equal(eventCyclePhase(0, cfg), 'calm');
  assert.equal(eventCyclePhase(59.999, cfg), 'calm');
});

test('phase flips to signpost exactly leadIn seconds before active starts', () => {
  assert.equal(eventCyclePhase(60, cfg), 'signpost');
  assert.equal(eventCyclePhase(69.999, cfg), 'signpost');
});

test('phase flips to active exactly at period - activeDuration', () => {
  assert.equal(eventCyclePhase(70, cfg), 'active');
  assert.equal(eventCyclePhase(89.999, cfg), 'active');
});

test('build amount is 0 through calm', () => {
  assert.equal(eventCycleBuildAmount(0, cfg), 0);
  assert.equal(eventCycleBuildAmount(59, cfg), 0);
});

test('build amount ramps linearly 0..1 across the signpost window', () => {
  assert.equal(eventCycleBuildAmount(60, cfg), 0);
  assert.ok(Math.abs(eventCycleBuildAmount(65, cfg) - 0.5) < 1e-9);
  assert.ok(eventCycleBuildAmount(69, cfg) > 0.5 && eventCycleBuildAmount(69, cfg) < 1);
});

test('build amount holds at 1 through the active phase', () => {
  assert.equal(eventCycleBuildAmount(70, cfg), 1);
  assert.equal(eventCycleBuildAmount(89, cfg), 1);
});

test('active target is 1 only during the active phase', () => {
  assert.equal(eventCycleActiveTarget(eventCyclePhase(30, cfg)), 0);
  assert.equal(eventCycleActiveTarget(eventCyclePhase(65, cfg)), 0);
  assert.equal(eventCycleActiveTarget(eventCyclePhase(80, cfg)), 1);
});

test('a zero leadIn cycle jumps straight from calm to active with no signpost window', () => {
  const noLead: EventCycleConfig = { period: 30, activeDuration: 10, leadIn: 0 };
  assert.equal(eventCyclePhase(19.999, noLead), 'calm');
  assert.equal(eventCyclePhase(20, noLead), 'active');
});
