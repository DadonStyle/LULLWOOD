import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_GLOW_BASE,
  IDLE_GLOW_AMP,
  IDLE_HALO_BASE,
  IDLE_HALO_AMP,
  idleGlowIntensity,
  idleHaloOpacity,
} from './childGlow.ts';

test('idleGlowIntensity stays within its base +/- amp band', () => {
  for (let t = 0; t <= 20; t += 0.05) {
    const v = idleGlowIntensity(t);
    assert.ok(v >= IDLE_GLOW_BASE - IDLE_GLOW_AMP && v <= IDLE_GLOW_BASE + IDLE_GLOW_AMP);
  }
});

test('idleHaloOpacity stays within its base +/- amp band, never exceeding 1', () => {
  for (let t = 0; t <= 20; t += 0.05) {
    const v = idleHaloOpacity(t);
    assert.ok(v >= IDLE_HALO_BASE - IDLE_HALO_AMP && v <= IDLE_HALO_BASE + IDLE_HALO_AMP);
    assert.ok(v <= 1);
  }
});
