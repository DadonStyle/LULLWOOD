// LUL-2249: the streaming ring is distance-based (player world position),
// not FOV-based -- CAMERA_FOV=85 on mobile widens the frustum but the same
// STREAM_RADIUS_CHUNKS=2 ring applies unchanged. This proves that claim
// rather than assume it, mirroring the first two @fullmap desktop assertions
// in ../chunk-streaming.spec.ts. Landscape viewport, same shape as
// ../mobile/prop-density.spec.ts -- map generation has no touch dependency,
// so this is a parity proof (founder rule: every logic change ships desktop
// AND mobile), not a distinct behaviour.
import { test, expect } from '@playwright/test';
import { boot, QA_PINNED_SEED, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('25 chunks are live at spawn on mobile (FOV 85)', async ({ page }) => {
  await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });

  const chunks = await qaHook(page, 'qaProbeTreeChunks');
  expect(chunks.instantiated).toBe(25);
});

test("instance totals match the live chunks' own tree counts on mobile (FOV 85)", async ({ page }) => {
  await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });

  const chunks = await qaHook(page, 'qaProbeTreeChunks');
  expect(chunks.totalInstances).toBe(chunks.expected);
  expect(chunks.totalInstances).toBeGreaterThan(0);
});
