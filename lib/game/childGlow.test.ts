import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_GLOW_BASE,
  IDLE_GLOW_AMP,
  CARRY_GLOW_BASE,
  CARRY_GLOW_AMP,
  CARRY_GLOW_FREQ,
  IDLE_GLOW_FREQ,
  PICKUP_GLOW_PEAK,
  idleGlowIntensity,
  carryGlowIntensity,
  idleHaloOpacity,
  carryHaloOpacity,
} from './childGlow.ts';

test('LUL-1438: carry glow is strictly brighter than idle glow at every t', () => {
  for (let t = 0; t <= 20; t += 0.05) {
    assert.ok(
      carryGlowIntensity(t) > idleGlowIntensity(t),
      `LUL-1438 fairness violation at t=${t}: carry (${carryGlowIntensity(t)}) must exceed idle (${idleGlowIntensity(t)})`,
    );
  }
});

test('LUL-1438: carry glow never dips to idle territory (min carry >= max idle)', () => {
  assert.ok(
    CARRY_GLOW_BASE - CARRY_GLOW_AMP >= IDLE_GLOW_BASE + IDLE_GLOW_AMP,
    'LUL-1438: carry\'s dimmest moment must stay brighter than idle\'s brightest moment',
  );
});

test('pickup cinematic hands off to carry pulse with no discontinuity', () => {
  assert.equal(PICKUP_GLOW_PEAK, CARRY_GLOW_BASE - CARRY_GLOW_AMP);
});

test('pickup cinematic never dips below idle either', () => {
  assert.ok(PICKUP_GLOW_PEAK >= IDLE_GLOW_BASE + IDLE_GLOW_AMP);
});

test('Fog Tide separability: carry pulses at a different rate than idle', () => {
  assert.notEqual(CARRY_GLOW_FREQ, IDLE_GLOW_FREQ);
});

test('halo: carry opacity is strictly brighter than idle opacity at every t', () => {
  for (let t = 0; t <= 20; t += 0.05) {
    assert.ok(carryHaloOpacity(t) > idleHaloOpacity(t));
  }
});

test('halo: carry opacity never exceeds 1 (it is a material opacity)', () => {
  for (let t = 0; t <= 20; t += 0.05) {
    assert.ok(carryHaloOpacity(t) <= 1);
  }
});
