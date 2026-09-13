// LUL-2329 (LUL-2324 child 2/2): dedicated regression guard for the two
// memory budgets the epic exists to enforce -- micro world < 400 MB JS heap,
// full QA-pinned-seed map < 1.5 GB JS heap. qa-world-micro.spec.ts (LUL-2328)
// already asserts the 400 MB budget as a side effect of its own boot-preset
// test; this file exists so that budget (and its full-map counterpart, which
// nothing else in the suite checks) survives even if that other test is ever
// weakened, split, or renamed -- see docs/specs/lul-2329-e2e-migrate-qaworld-micro.md.
// Both budgets are LUL-1768/LUL-2249's boot-cost investigation and streamed-
// chunks fix respectively; this spec only guards the numbers, not the fix.
import { test, expect } from '@playwright/test';
import { boot, qaHook, QA_PINNED_SEED } from './helpers';
// fullmap-reason: the full-map memory budget (LUL-1768/LUL-2249 regression guard) has to load the full map to measure it (LUL-2377: the QA rig never runs @fullmap; run locally with E2E_FULLMAP=1)

const MICRO_BUDGET_BYTES = 400 * 1024 * 1024;
const FULL_MAP_BUDGET_BYTES = 1.5 * 1024 * 1024 * 1024;

test.describe('qaProbeMemory budgets (LUL-2324)', () => {
  test('micro world stays under the 400 MB budget', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await page.waitForTimeout(300); // let a couple of real frames render, same settle as qa-world-micro.spec.ts

    const mem = await qaHook(page, 'qaProbeMemory');
    expect(mem.renderer.geometries).toBeGreaterThan(0);
    expect(mem.renderer.textures).toBeGreaterThan(0);
    // Chromium-only (performance.memory) -- see the hook's own doc comment in
    // engine/forest-engine.d.ts. Never fail the budget on a browser that
    // doesn't report it.
    if (mem.heap) {
      expect(mem.heap.usedJSHeapSize).toBeLessThan(MICRO_BUDGET_BYTES);
    }
  });

  test('full QA-pinned-seed map stays under the 1.5 GB budget @fullmap', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true, seed: QA_PINNED_SEED });
    await page.waitForTimeout(300);

    const mem = await qaHook(page, 'qaProbeMemory');
    expect(mem.renderer.geometries).toBeGreaterThan(0);
    expect(mem.renderer.textures).toBeGreaterThan(0);
    if (mem.heap) {
      expect(mem.heap.usedJSHeapSize).toBeLessThan(FULL_MAP_BUDGET_BYTES);
    }
  });
});
