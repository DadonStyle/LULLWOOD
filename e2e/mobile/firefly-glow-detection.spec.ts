// LUL-5744 mobile half -- see ../firefly-glow-detection.spec.ts for the desktop specs and
// the full writeup. Wiki game/mechanics/firefly-glow-detection-risk Q11 test 3: mobile
// renders only FIREFLY_MOBILE_CLUSTER_COUNT=4 clusters (lib/game/fireflyClusters.ts), but
// the detection penalty must apply to all 6 regardless of render budget -- a mobile player
// standing in an unrendered cluster is still exposed. engine/forest-engine.js's
// activeFireflyDetectClusters (detection-side) is deliberately NOT mobile-sliced, unlike
// activeFireflyClusters (render-side); this spec proves both halves of that claim.
//
// fireflyThicket (lib/game/fireflyClusters.ts index 4, i.e. cluster "5" of 6): raw
// x=-170 z=200 radius=45, scaled by CONFIG.fireflyScaleMul=0.2 (micro QA world preset) to
// (-34, 40). It is outside the first FIREFLY_MOBILE_CLUSTER_COUNT=4 clusters mobile renders
// (fireflyMeadow/Brook/Hollow/Ridge), so clusterCount stays 4 even while the player stands
// inside it.
import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { boot, qaHook } from '../helpers';

async function enterMobile(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (no pointer-lock on mobile)
}

const FIREFLY_THICKET_CENTER = { x: -34, z: 40 };
const FAR_OUTSIDE = { x: 1000, z: 1000 };

test('an unrendered mobile cluster (5 of 6) still applies the detection penalty', async ({ page }) => {
  await boot(page, { qaHooks: true, qaHour: 2 });
  await enterMobile(page);
  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 5, z: 5 }] });

  const probe = await qaHook(page, 'qaProbeFireflyClusters');
  expect(probe.clusterCount, 'mobile must render only FIREFLY_MOBILE_CLUSTER_COUNT=4 clusters').toBe(4);
  expect(probe.detectClusterCount, 'the detection-side list must never be mobile-sliced -- all 6 clusters').toBe(6);

  await qaHook(page, 'qaTeleportTo', FIREFLY_THICKET_CENTER.x, FIREFLY_THICKET_CENTER.z);
  const inThicket = await qaHook(page, 'qaProbeEffectiveDetect', 'lion');
  await qaHook(page, 'qaTeleportTo', FAR_OUTSIDE.x, FAR_OUTSIDE.z);
  const outside = await qaHook(page, 'qaProbeEffectiveDetect', 'lion');

  expect(inThicket, 'standing in an unrendered-on-mobile cluster must still raise exposure').toBeGreaterThan(outside);
});
