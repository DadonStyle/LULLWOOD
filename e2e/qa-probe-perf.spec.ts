// LUL-2257: qaProbePerf() (engine/forest-engine.js:3184) used to read
// renderer.info.render live, which WebGLRenderer resets on every render()
// call -- with post-processing active (the normal path) that meant it always
// reported the last full-screen composite blit (calls: 1, triangles: 2),
// never the real scene, regardless of map size or player position. Confirmed
// live in docs/specs/lul-2245-baseline-perf.md's "Known limitation" section:
// qaProbeTreeChunks() reported 5200 tree instances in the scene at the same
// instant qaProbePerf() reported triangles: 2. This proves the fix (renderPost()
// now snapshots renderer.info.render right after the real scene render, before
// the bloom/blur/composite blits overwrite it) by checking the two hooks agree
// there actually is a large scene behind the number qaProbePerf() reports.
// qaProbePerf/qaProbeTreeChunks are untyped in forest-engine.d.ts (same as
// qaProbeElapsedTime, see e2e/qa-fixed-clock.spec.ts), hence the `as any` reads.
import { test, expect } from '@playwright/test';
import { boot } from './helpers';

async function readPerf(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).ForestEngine.qaProbePerf());
}

async function readTreeChunks(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).ForestEngine.qaProbeTreeChunks());
}

test.describe('qaProbePerf scene stats', () => {
  test('triangles/calls reflect the real scene, not the constant post-process blit', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await page.waitForTimeout(300); // let a couple of real frames render, same settle as the baseline-perf method

    const perf = await readPerf(page);
    const chunks = await readTreeChunks(page);

    // The known-bad reading was exactly calls: 1, triangles: 2 (the final
    // composite quad) no matter how big the scene was -- assert both moved
    // well past that, proportional to there being thousands of tree
    // instances actually in the scene.
    expect(chunks.totalInstances).toBeGreaterThan(1000);
    expect(perf.triangles).toBeGreaterThan(1000);
    expect(perf.calls).toBeGreaterThan(2);
  });

  test('a second probe after moving still reflects the scene, not a stale blit', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as any).ForestEngine.qaTeleportNearBaby());
    await page.waitForTimeout(300);

    const perf = await readPerf(page);
    expect(perf.triangles).toBeGreaterThan(1000);
    expect(perf.calls).toBeGreaterThan(2);
  });
});
