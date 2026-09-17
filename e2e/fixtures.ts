// Auto-dispose teardown fixture -- LUL-2616.
//
// `workers: 1` (playwright.config.ts) means every spec file in a full-suite run shares
// one Chromium/GPU process end to end -- only the BrowserContext gets recycled per test,
// not the Browser/GL process. The engine's own release path (`activeDispose` /
// `forceContextLoss`, engine/forest-engine.js:6783-6818, exposed as
// `window.ForestEngine.dispose` at :6920) is comprehensive, but it was only ever wired to
// React unmount (components/GameCanvas.tsx:759-785) and no spec in this suite unmounts the
// component or had a teardown hook that called it directly -- so ~200 specs' worth of
// geometries, materials, render targets and WebGL contexts never got released across a
// full run. Measured: 4506MB largest browser process for the full suite vs 1015MB for the
// same specs run alone (LUL-2616).
//
// Every spec imports `test`/`expect` from here instead of '@playwright/test' directly, so
// the dispose call runs before Playwright closes the page/context.
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ autoDisposeEngine: void }>({
  autoDisposeEngine: [
    async ({ page }, use) => {
      await use();
      // The page may already be closed, crashed, or navigated away by the time teardown
      // runs (a failed test, a deliberate reload) -- a missed dispose() is a missed
      // optimization, not a real error, so this must never throw and mask the test's own
      // result.
      await page.evaluate(() => window.ForestEngine?.dispose?.()).catch(() => {});
    },
    { auto: true },
  ],
});

export { expect };
