// LUL-2200 (backfill for LUL-1144/LUL-1113, per docs/specs/player-stamina.md's
// '## e2e' section): the first automated proof of that spec's own "Mobile"
// claim -- "mobile parity is automatic -- stamina reads the same `running`
// flag both control schemes already drive". Stick-drag auto-sprint has no
// deterministic tap/drag equivalent in this rig, so this drives `running` via
// the toggle-run accessibility path instead, same as
// ../mobile/toggle-run.spec.ts proves flips qaPlayerState().toggleRunOn.
import { test, expect } from '@playwright/test';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

const STAMINA_DRAIN_TIME = 6;

test('toggle-run sprint drains the stamina meter on mobile the same as desktop', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  // Mobile route (e2e/mobile/admin-mode.spec.ts:14-46): menu -> Settings -> admin mode.
  const menuToggle = page.getByTestId('menuToggle');
  await expect(menuToggle).toBeVisible();
  await menuToggle.evaluate((el) => (el as HTMLElement).click());
  const settingsBtn = page.locator('#settingsBtn');
  await expect(settingsBtn).toBeVisible();
  await settingsBtn.evaluate((el) => (el as HTMLElement).click());

  const adminToggle = page.getByLabel(/admin mode/i);
  await expect(adminToggle).not.toBeChecked();
  await adminToggle.evaluate((el) => (el as HTMLInputElement).click());

  // Same settings panel (e2e/mobile/toggle-run.spec.ts) -- switch runMode to
  // 'toggle' so the touch Run button renders.
  //
  // el.click(), not a real Playwright .check() -- see
  // wiki:systems/lul44-diagnosis-and-fix (this checkbox's wrapping
  // `<label className="radioRow">` intercepts real actionability polling in
  // this rig even though the checkbox is genuinely clickable; confirmed live
  // here -- a real .check() timed out after 150s retrying against "label
  // intercepts pointer events").
  const runModeCheckbox = page.getByRole('checkbox', { name: /toggle to run/i });
  await expect(runModeCheckbox).toBeVisible();
  await runModeCheckbox.evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).click();

  await expect(page.locator('#staminaState')).toBeVisible();

  const runBtn = page.getByTestId('touchToggleRun');
  await expect(runBtn).toBeVisible();

  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.toggleRunOn).toBe(false);

  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await runBtn.dispatchEvent('pointerdown', pointerOpts);
  const on = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(on?.toggleRunOn).toBe(true);

  await qaHook(page, 'qaSetFixedStep', 0.05);
  await qaHook(page, 'qaAdvance', (STAMINA_DRAIN_TIME / 2) / 0.05); // 3s game time

  const drainedText = await page.locator('#staminaState').textContent();
  const drainedMatch = drainedText?.match(/Stamina: (\d+)%/);
  expect(drainedMatch, drainedText ?? '').not.toBeNull();
  const drainedPct = Number(drainedMatch![1]);
  expect(drainedPct).toBeGreaterThanOrEqual(45);
  expect(drainedPct).toBeLessThanOrEqual(55);
});
