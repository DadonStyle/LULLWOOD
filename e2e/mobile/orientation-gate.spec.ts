// LUL-69: a first-person horizontal-FOV game is unplayable in portrait on a
// phone. components/OrientationGate.tsx shows a full-screen "rotate your
// device" prompt, mobile + portrait only, that blocks input to the canvas
// and touch controls beneath it, clearing automatically once the device (or
// emulated viewport) reaches landscape.
//
// Runs under the `mobile` Playwright project (playwright.config.ts),
// devices['Pixel 5'] -- portrait by default (393x727), which is exactly the
// case this spec needs. See e2e/mobile/input-mode.spec.ts for why the
// *other* mobile specs override to landscape instead.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test('portrait blocks input behind a rotate prompt; landscape clears it and gameplay is reachable', async ({
  page,
}) => {
  await boot(page, { qaHooks: true });

  const gate = page.getByTestId('orientationGate');
  await expect(gate).toBeVisible();

  // Not just "some element is visible" -- the prompt must actually be the
  // thing a tap lands on, at the exact point a player would tap the entry
  // gate. Assert on the engine-visible effect, not the DOM node: a click
  // through to #gate must NOT reach it while portrait.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;

  const hitsOrientationGate = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('#orientationGate') != null,
    [cx, cy] as const,
  );
  expect(hitsOrientationGate).toBe(true);

  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);
  const stillOnGate = await page.evaluate(() => document.body.innerText).then((t) => t.includes('click to enter'));
  expect(stillOnGate).toBe(true);

  // Rotate: swap width/height, same as a real device orientation change.
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await expect(gate).toBeHidden();

  // Landscape viewport moved the gate's centre -- re-read it before clicking.
  const landscapeCentre = { x: viewport.height / 2, y: viewport.width / 2 };
  await page.mouse.click(landscapeCentre.x, landscapeCentre.y);
  await page.waitForTimeout(1200); // gate fade settle, same as helpers.ts's enter()

  const entered = await page.evaluate(() => document.body.innerText);
  expect(entered).not.toContain('click to enter');
  expect(entered).toMatch(/Find the lost child/);
});

test('mobile FOV is wider than desktop default', async ({ page }) => {
  await boot(page, { qaHooks: true });
  // Rotate to landscape first -- entering (which qaCameraFov doesn't
  // strictly need, but keeps this spec's setup identical to a real session)
  // is blocked in portrait, and camera.fov is set once at init() regardless
  // of orientation, so either viewport reads the same value -- landscape
  // just avoids relying on the rotate-prompt behavior this file already
  // covers above.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.setViewportSize({ width: viewport.height, height: viewport.width });

  const fov = await page.evaluate(() => window.ForestEngine?.qaCameraFov?.());
  // Desktop default is 70 (engine/forest-engine.js) -- mobile must be wider,
  // not just different, per the ticket's "widen FOV" ask.
  expect(fov).toBeGreaterThan(70);
});
