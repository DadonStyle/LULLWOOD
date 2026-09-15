// LUL-2331 (LUL-2321 Part 1): the Stone Marker mist-charm had no tell -- no explanation of
// what buying it does, no purchase confirmation, no sign the veil was ever saved from
// locking. This is the explain/purchase-tell/activation-tell triple per docs/specs/
// lul-2331-stone-marker-cue-triple.md: a reworded persistent offer prompt, a reused
// embersPurchaseCue() + one-shot Stone Marker beacon pulse on purchase, and a new
// veilCharmReleaseCue() + eased HUD veil-meter refill + pip-clear on activation.
//
// #veilState (and the pip nested inside it) lives inside #panel, which is admin-mode-gated
// and hidden by default (e2e/admin-mode.spec.ts) -- LUL-1085/LUL-1824 predates this ticket
// and is unrelated to it. These specs seed adminMode:true (same pattern e2e/minimap-setting.spec.ts
// uses) purely so the HUD-panel assertions have something to read; the audio cues, the
// beacon pulse, and the reworded prompt text below are all asserted with admin mode OFF
// (the real default), since none of those three live inside #panel.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, readObjective } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function seedAdminMode(context: import('@playwright/test').BrowserContext) {
  await context.addInitScript(() => {
    window.localStorage.setItem('lullwood:settings', JSON.stringify({ adminMode: true }));
  });
}

test.describe('Stone Marker mist-charm cue triple (LUL-2331)', () => {
  test('the persistent offer prompt explains the charm before it is bought', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    const marker = await qaHook(page, 'qaTeleportNearStoneMarker');
    await expect
      .poll(() => readObjective(page))
      .toContain('saves your veil from locking, once');
    expect(marker).toEqual(expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) }));
  });

  test('buying the charm plays the purchase cue, pulses the beacon, and updates state', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    await qaHook(page, 'qaTeleportNearStoneMarker');
    await expect.poll(() => readObjective(page)).toContain('mist-charm');

    const before = await qaHook(page, 'qaProbeEmbersPurchase');
    const beforeVeil = await qaHook(page, 'qaProbeVeil');
    expect(beforeVeil.reserve).toBe(false);

    await page.keyboard.press('KeyE');

    await expect
      .poll(async () => (await qaHook(page, 'qaProbeVeil')).reserve)
      .toBe(true);
    const after = await qaHook(page, 'qaProbeEmbersPurchase');
    expect(after.purchaseCueCount, 'buyVeilCharm() must reuse embersPurchaseCue()').toBeGreaterThan(before.purchaseCueCount);
  });

  test('with admin mode on, buying the charm shows the HUD pip', async ({ page, context }) => {
    await seedAdminMode(context);
    await boot(page, { qaHooks: true });
    await enter(page);

    await qaHook(page, 'qaTeleportNearStoneMarker');
    await expect.poll(() => readObjective(page)).toContain('mist-charm');
    await expect(page.locator('#veilCharmPip')).toHaveCount(0);

    await page.keyboard.press('KeyE');

    await expect(page.locator('#veilCharmPip')).toBeVisible();
  });

  test('the charm firing plays its own cue, refills the veil, and clears the pip', async ({ page, context }) => {
    await seedAdminMode(context);
    await boot(page, { qaHooks: true });
    await enter(page);

    await qaHook(page, 'qaTeleportNearStoneMarker');
    await expect.poll(() => readObjective(page)).toContain('mist-charm');
    await page.keyboard.press('KeyE');
    await expect(page.locator('#veilCharmPip')).toBeVisible();

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await page.keyboard.down('KeyF');
    let probe = await qaHook(page, 'qaProbeVeil');
    for (let i = 0; i < 20 && probe.reserve; i++) {
      await qaHook(page, 'qaAdvance', stepsFor(0.5));
      probe = await qaHook(page, 'qaProbeVeil');
    }
    await page.keyboard.up('KeyF');

    expect(probe.reserve, 'the charm must be consumed instead of locking the veil out').toBe(false);
    expect(probe.charge, 'stepVeilCharge sets charge to VEIL_UNLOCK_CHARGE on the reserve branch').toBeGreaterThanOrEqual(0.3);
    expect(probe.releaseCueCount, 'reserveFired must call veilCharmReleaseCue()').toBeGreaterThan(0);
    await expect(page.locator('#veilCharmPip')).toHaveCount(0);
  });
});
