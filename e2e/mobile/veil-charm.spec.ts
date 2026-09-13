// LUL-2331: mobile half of ../veil-charm.spec.ts -- see that file for the full "why"
// (docs/specs/lul-2331-stone-marker-cue-triple.md). Same touchInteract/touchVeil
// testIds e2e/mobile/interact.spec.ts and e2e/mobile/veil.spec.ts already exercise,
// asserting the same engine-visible effects (qaProbeVeil/qaProbeEmbersPurchase), one
// viewport, both scenarios from the SPEC's e2e section in a single describe block.
import { test, expect } from '@playwright/test';
import { boot, qaHook, readObjective } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

async function enterMobile(page: import('@playwright/test').Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)
}

const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test.describe('Stone Marker mist-charm cue triple, mobile (LUL-2331)', () => {
  test('tapping touchInteract buys the charm; holding touchVeil fires the activation tell', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true });
    await enterMobile(page);

    await qaHook(page, 'qaTeleportNearStoneMarker');
    await expect
      .poll(() => readObjective(page))
      .toContain('saves your veil from locking, once');

    const beforePurchase = await qaHook(page, 'qaProbeEmbersPurchase');
    const interactBtn = page.getByTestId('touchInteract');
    await expect(interactBtn).toBeVisible();
    await interactBtn.dispatchEvent('pointerdown', pointerOpts);

    await expect
      .poll(async () => (await qaHook(page, 'qaProbeVeil')).reserve)
      .toBe(true);
    const afterPurchase = await qaHook(page, 'qaProbeEmbersPurchase');
    expect(afterPurchase.purchaseCueCount).toBeGreaterThan(beforePurchase.purchaseCueCount);

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    const veilBtn = page.getByTestId('touchVeil');
    await expect(veilBtn).toBeVisible();
    await veilBtn.dispatchEvent('pointerdown', pointerOpts);

    let probe = await qaHook(page, 'qaProbeVeil');
    for (let i = 0; i < 20 && probe.reserve; i++) {
      await qaHook(page, 'qaAdvance', stepsFor(0.5));
      probe = await qaHook(page, 'qaProbeVeil');
    }
    await veilBtn.dispatchEvent('pointerup', pointerOpts);

    expect(probe.reserve, 'the charm must be consumed instead of locking the veil out').toBe(false);
    expect(probe.charge).toBeGreaterThanOrEqual(0.3);
    expect(probe.releaseCueCount, 'reserveFired must call veilCharmReleaseCue()').toBeGreaterThan(0);
  });
});
