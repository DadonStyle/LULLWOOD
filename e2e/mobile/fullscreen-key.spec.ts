// LUL-2310: mobile half of ../fullscreen-key.spec.ts. There is no
// mobile-specific keyboard handling to add or remove here -- F11/Alt+Enter
// are physical-keyboard shortcuts with no touch equivalent, and the engine's
// keydown listener (engine/forest-engine.js) does not branch on input mode --
// so this only guards two regressions the LUL-2310 refactor could plausibly
// have introduced: `menuFullscreen` staying gone when the Fullscreen API is
// unsupported (unchanged from LUL-124, now routed through
// lib/game/fullscreen.ts's fullscreenSupported()), and the key path still
// working unchanged if a touch device happens to have a keyboard attached.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

test('menuFullscreen stays absent on mobile when the Fullscreen API is unsupported', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false });
    // No webkit* fallback either -- this is the "neither API exists" case
    // (old iOS Safari), not just "unprefixed is missing".
  });
  await boot(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByTestId('menuFullscreen')).toHaveCount(0);
});

test('F11 still drives the fullscreen path unchanged on a touch-emulated device', async ({ page }) => {
  // Patched on Element.prototype, not the documentElement instance -- an init
  // script runs before the HTML is parsed, so `document.documentElement` is
  // still null then (see ../fullscreen-key.spec.ts's stubFullscreenAPI).
  await page.addInitScript(() => {
    (window as any).__fsCalls = { request: 0 };
    Element.prototype.requestFullscreen = function () {
      (window as any).__fsCalls.request++;
      return Promise.resolve();
    };
  });
  await boot(page);

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F11', cancelable: true, bubbles: true }));
  });
  expect(await page.evaluate(() => (window as any).__fsCalls)).toEqual({ request: 1 });
});
