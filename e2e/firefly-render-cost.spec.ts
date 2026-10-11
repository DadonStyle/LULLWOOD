// LUL-5945 (child of LUL-5943 "slow game", founder-reported critical): LUL-5707's firefly
// motes were one real THREE.PointLight each (up to 36 across 6 clusters) in a plain forward
// renderer with no clustered/deferred lighting, so every active light forced a per-fragment
// relight of every MeshStandardMaterial surface in the scene -- the profiled cause of "too
// much being rendered at the same time" (PLAN comment on LUL-5945, 2026-10-10). The fix
// (docs/specs/lul-5945-firefly-render-cost.md) swaps the per-mote PointLight for one additive
// THREE.Points batch; brightness now lives in a vertex-color buffer attribute, not a
// scene-graph light. This spec proves both halves: the light count didn't grow when fireflies
// activate, and the player-visible proximity falloff (qaProbeFireflyClusters().maxIntensity)
// still behaves the same as before the swap.
//
// Runs on the default micro QA world -- firefly clusters are a fixed module-scope list
// (lib/game/fireflyClusters.ts), always present and scaled by CONFIG.fireflyScaleMul
// regardless of world size (same precedent as e2e/firefly-swarms.spec.ts).
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

test('firefly motes at night add no real scene lights', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 11 });
  const noonLights = await qaHook(page, 'qaSceneRealLightCount');
  const noonProbe = await qaHook(page, 'qaProbeFireflyClusters');
  expect(noonProbe.clusterCount, 'fireflies must be absent at noon for this to be a fair baseline').toBe(0);

  await boot(page, { qaHooks: true, qaHour: 2 });
  const nightLights = await qaHook(page, 'qaSceneRealLightCount');
  const nightProbe = await qaHook(page, 'qaProbeFireflyClusters');
  expect(nightProbe.clusterCount, 'fireflies must be active at night').toBeGreaterThan(0);
  expect(nightProbe.anyVisible).toBe(true);

  expect(nightLights, 'activating up to 36 firefly motes must add zero real THREE.Light instances to the scene').toBe(noonLights);
});

test('firefly mote brightness still falls off with distance after the render-primitive swap', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await enter(page);

  const { clusters } = await qaHook(page, 'qaProbeFireflyClusters');
  const meadow = clusters.find((c: { id: string }) => c.id === 'fireflyMeadow');
  expect(meadow, 'fireflyMeadow must be present in the scaled cluster list').toBeTruthy();

  await qaHook(page, 'qaTeleportTo', meadow.x, meadow.z);
  const near = (await qaHook(page, 'qaProbeFireflyClusters')).maxIntensity;

  await qaHook(page, 'qaTeleportTo', 16, 45);
  const far = (await qaHook(page, 'qaProbeFireflyClusters')).maxIntensity;

  expect(near, 'standing at a cluster center must read brighter than standing away from every cluster').toBeGreaterThan(far);
  expect(far).toBeGreaterThanOrEqual(0);
});
