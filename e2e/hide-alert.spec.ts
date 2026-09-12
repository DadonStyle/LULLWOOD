// LUL-2547: hide entry broadcasts a one-shot noise event to nearby roaming
// predators (engine/forest-engine.js's enterHide(), reusing checkThrowableNoise()/
// hearNoise() the same way throwThrowable() does). See
// docs/specs/lul-2547-cover-alert-feedback.md.
//
// Deliberately its own file: e2e/hide.spec.ts is explicitly predator-free per its
// own header comment, and e2e/cover-feedback.spec.ts asserts the unrelated
// LOS-covered signal, not this noise broadcast.
import { test, expect, type Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const HIDE_SCENE = {
  props: [{ kind: 'bramble' as const, x: 10, z: 0 }],
  predators: [{ kind: 'wolf' as const, x: 9999, z: 9999, state: 'roam' }],
};

async function stageHideSceneAtSpot(page: Page) {
  await qaHook(page, 'qaBuildScene', HIDE_SCENE);
  const spot = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
  if (spot === null) {
    throw new Error('qaTeleportToHideSpot returned null -- no bramble hiding spot was found for this seed');
  }
}

async function enableCaptions(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  // el.click(), not a real Playwright .check() -- the wrapping
  // `<label className="radioRow">` intercepts real actionability polling in
  // this rig even though the checkbox is genuinely clickable (see
  // wiki:systems/lul44-diagnosis-and-fix, and e2e/mobile/stamina.spec.ts's
  // identical workaround).
  await page.getByLabel('Captions for predator calls').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
}

test.describe('cover alert feedback (LUL-2547)', () => {
  test('a roaming predator within the alert radius is alerted on hide entry', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await stageHideSceneAtSpot(page);

    const staged = await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', 15, 0);
    expect(staged, 'wolf must have spawned this seed').not.toBeNull();

    await page.keyboard.press('KeyH');

    const state = await qaHook(page, 'qaPredatorState', staged.idx);
    expect(state?.state).toBe('investigate');

    const chronicle = await qaHook(page, 'qaGetChronicle');
    expect(chronicle.some((e: any) => e.code === 'hide_alert' && e.args?.alerted === 1)).toBe(true);
  });

  test('a roaming predator outside the alert radius stays unaware', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await stageHideSceneAtSpot(page);

    const staged = await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', 25, 0);
    expect(staged, 'wolf must have spawned this seed').not.toBeNull();

    await page.keyboard.press('KeyH');

    const state = await qaHook(page, 'qaPredatorState', staged.idx);
    expect(state?.state).toBe('roam');

    const chronicle = await qaHook(page, 'qaGetChronicle');
    const hideAlerts = chronicle.filter((e: any) => e.code === 'hide_alert');
    expect(hideAlerts.length).toBeGreaterThan(0);
    expect(hideAlerts[hideAlerts.length - 1].args?.alerted).toBe(0);
  });

  test('the first-hide caption shows once and does not repeat', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await enableCaptions(page);
    await stageHideSceneAtSpot(page);
    await qaHook(page, 'qaResetHints');

    // Predator stays at qaBuildScene's parked (9999, 9999) -- far outside
    // HIDE_ALERT_RADIUS, so hearNoise()'s own higher-captionId caption can't
    // supersede the explanatory toast before the assertion below reads it
    // (see the spec's §4 note on that ordering).
    const caption = page.locator('#captionToast');

    await page.keyboard.press('KeyH');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText('Hiding makes noise');

    // Let the toast's own auto-hide timer (CAPTION_DISPLAY_MS=3200ms, components/Hud.tsx) clear
    // before re-triggering, so the second hide's (lack of) caption isn't masked by the first's.
    // Auto-retrying assertion (not a fixed sleep+snap-check) so this doesn't race a timer that
    // fires a bit late under host load -- it only needs to clear sometime in this window.
    await expect(caption).toHaveCount(0, { timeout: 10000 });

    await page.keyboard.press('KeyH'); // exit hide
    await page.keyboard.press('KeyH'); // re-enter hide
    await page.waitForTimeout(300);
    await expect(caption).toHaveCount(0);
  });
});
