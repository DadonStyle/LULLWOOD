// LUL-5756 (cheap slice, accepted per decisions/lul-5756-firefly-alarm-response-accepted-
// 2026-10-02): fireflies brighten when a hunting predator closes on their cluster -- a
// single frame-global `alarmScalar` (lib/game/fireflyAlarmResponse.ts's fireflyAlarmBoost,
// unit-tested there for the pure math) multiplies every mote's intensity before
// rainfall-dim, same CONFIG multiplier composition as CONFIG.FIREFLY_RAIN_DIM
// (e2e/firefly-rain-interaction.spec.ts).
//
// qaHour=2 (night) keeps fireflies in their always-present state (same precedent as
// e2e/firefly-swarms.spec.ts). qaIsolatePredatorKindAt (new this ticket, same
// isolate-and-park-the-rest shape as the existing qaIsolatePredatorKind) places a real
// predator object at an exact (x,z) -- read from qaProbeFireflyClusters().clusters (new
// this ticket: the full, unsliced, scaled id/x/z list) -- rather than only approximating
// "near a cluster" via the player's own position.
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';

test('firefly motes brighten when a lion approaches a cluster', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaClearAllPredators');

  const before = await qaHook(page, 'qaProbeFireflyClusters');
  expect(before.anyVisible, 'fireflies must be visible at night before any predator is near').toBe(true);
  expect(before.alarmScalar).toBe(1);

  const meadow = before.clusters[0];
  await qaHook(page, 'qaIsolatePredatorKindAt', 'lion', meadow.x, meadow.z);
  await qaHook(page, 'qaAdvance', 1);

  const after = await qaHook(page, 'qaProbeFireflyClusters');
  expect(after.alarmActive, 'alarm must activate once the lion sits on the cluster center').toBe(true);
  expect(after.alarmScalar).toBeGreaterThan(before.alarmScalar);
  expect(after.maxIntensity, 'the brighter alarm scalar must actually raise rendered mote intensity')
    .toBeGreaterThan(before.maxIntensity);
});

test('alarm scalar stays at baseline when no predators are near', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaClearAllPredators');
  await qaHook(page, 'qaAdvance', 1);

  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  expect(probe.alarmScalar).toBe(1);
  expect(probe.alarmActive).toBe(false);
});

test('alarm drops back to baseline once the predator leaves range', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaClearAllPredators');

  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  const meadow = probe.clusters[0];
  await qaHook(page, 'qaIsolatePredatorKindAt', 'lion', meadow.x, meadow.z);
  await qaHook(page, 'qaAdvance', 1);
  const alarmed = await qaHook(page, 'qaProbeFireflyClusters');
  expect(alarmed.alarmActive).toBe(true);

  // Beyond CONFIG.FIREFLY_ALARM_RANGE (120u, engine/tuning.js) from every cluster.
  await qaHook(page, 'qaIsolatePredatorKindAt', 'lion', meadow.x + 5000, meadow.z + 5000);
  await qaHook(page, 'qaAdvance', 1);

  const clear = await qaHook(page, 'qaProbeFireflyClusters');
  expect(clear.alarmActive, 'alarm must drop once the predator retreats past FIREFLY_ALARM_RANGE').toBe(false);
  expect(clear.alarmScalar).toBe(1);
  expect(clear.maxIntensity).toBeLessThan(alarmed.maxIntensity);
});

test('a predator at any one cluster brightens every rendered mote -- frame-global, not per-cluster', async ({ page }) => {
  // Proves the same property mobile relies on: a predator near a cluster excluded from
  // FIREFLY_MOBILE_CLUSTER_COUNT's render budget still has to brighten the clusters that
  // DO render, because fireflyAlarmBoost() scans scaledFireflyClusters() (all 6) every
  // frame, not activeFireflyClusters (the rendered slice) -- see forest-engine.js's mote
  // loop and fireflyAlarmResponse.ts. Desktop renders all 6 clusters, so this stages the
  // predator on a cluster far from the others and checks the OTHERS' motes still brighten,
  // which is the mode-independent half of that claim; the pure "scan every cluster
  // regardless of render slice" half is unit-tested in fireflyAlarmResponse.test.ts.
  await boot(page, { qaHooks: true, qaHour: 2 });
  await qaHook(page, 'qaSetFixedStep', 0.02);
  await qaHook(page, 'qaClearAllPredators');

  const before = await qaHook(page, 'qaProbeFireflyClusters');
  const farCluster = before.clusters[2]; // fireflyHollow -- far from the player's default spawn near cluster 0
  await qaHook(page, 'qaIsolatePredatorKindAt', 'lion', farCluster.x, farCluster.z);
  await qaHook(page, 'qaAdvance', 1);

  const after = await qaHook(page, 'qaProbeFireflyClusters');
  expect(after.alarmActive).toBe(true);
  expect(after.maxIntensity, 'a predator anywhere in the cluster list raises the single global scalar, lighting every mote')
    .toBeGreaterThan(before.maxIntensity);
});
