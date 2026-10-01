// LUL-5707 (cheap slice, proposal LUL-5704): firefly clusters are gated on the
// `timeOfDay` snapshot (`?qaHour=`, same determinism as time-of-day.spec.ts)
// -- present at dusk/night ('evening'/'night'), absent every other state.
// Runs on the default micro QA world (CONFIG.fireflyScaleMul keeps a cluster
// inside FIREFLY_CLUSTER_RADIUS of the origin spawn, engine/tuning.js).
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';

test('firefly clusters are present and visible at night', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  expect(probe.clusterCount).toBeGreaterThan(0);
  expect(probe.anyVisible).toBe(true);
});

test('firefly clusters are present and visible at dusk (evening)', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 18 });
  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  expect(probe.clusterCount).toBeGreaterThan(0);
  expect(probe.anyVisible).toBe(true);
});

test('firefly clusters are absent at noon', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 11 });
  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  expect(probe.clusterCount).toBe(0);
  expect(probe.anyVisible).toBe(false);
});

test('firefly clusters are absent in the morning', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 8 });
  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  expect(probe.clusterCount).toBe(0);
});
