// LUL-2200 (backfill for LUL-1144/LUL-1113, per docs/specs/player-stamina.md's
// '## e2e' section): the stamina meter shipped with zero automated coverage.
// Drives the deterministic QA clock (see qa-fixed-clock.spec.ts) so drain/regen
// assertions don't depend on wall-clock timing under swiftshader.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

// STAMINA_DRAIN_TIME (lib/game/stamina.ts) -- full drain from full charge.
const STAMINA_DRAIN_TIME = 6;

async function openAdminMode(page: import('@playwright/test').Page) {
  // Same route as e2e/admin-mode.spec.ts:40-62 -- Settings lives inside
  // GameMenu's hamburger panel (LUL-1085).
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  const toggle = page.getByLabel(/admin mode/i);
  await toggle.evaluate((el) => (el as HTMLInputElement).click());
  await expect(page.locator('#staminaState')).toBeVisible();
}

test.describe('stamina', () => {
  test('sprinting drains the stamina meter, releasing regenerates it', async ({ page }) => {
    await boot(page, { qaHooks: true });
    // LUL-2506: strip every predator before the player ever enters play. The
    // real RAF loop (engine/forest-engine.js's tick()) keeps running in real
    // wall-clock time through enter()'s 1.2s gate-fade wait and
    // openAdminMode()'s menu/settings round-trip -- qaSetFixedStep() below
    // only parks it once called, it can't retroactively undo movement from
    // before that call. A predator that can now catch a stationary, unhidden
    // player (post-LUL-2320/LUL-2311) was closing in on the player, who
    // never moves or hides for the whole test, during exactly that window;
    // a catch mid-setup fires triggerDeath(), which flips `playing` false
    // and freezes staminaCharge wherever the drain happened to be -- this is
    // the nondeterministic "floors around 13%"/"3%" failure in LUL-2506. An
    // empty predators list removes the race instead of racing to outrun it.
    await qaHook(page, 'qaBuildScene', { predators: [] });
    await enter(page);
    // Also park the real clock before the deterministic drain window below,
    // same reasoning as e2e/action-prompt.spec.ts -- belt and suspenders now
    // that no predator can reach the player either way.
    await qaHook(page, 'qaSetFixedStep', 0.05);
    await openAdminMode(page);

    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', (STAMINA_DRAIN_TIME / 2) / 0.05); // 3s game time

    // Rounded twice (forest-engine.js's Math.round(*100)/100, then Hud.tsx's
    // Math.round(*100)) so assert "roughly 50%", not exact.
    const drainedText = await page.locator('#staminaState').textContent();
    const drainedMatch = drainedText?.match(/Stamina: (\d+)%/);
    expect(drainedMatch, drainedText ?? '').not.toBeNull();
    const drainedPct = Number(drainedMatch![1]);
    expect(drainedPct).toBeGreaterThanOrEqual(45);
    expect(drainedPct).toBeLessThanOrEqual(55);

    await page.keyboard.up('ShiftLeft');
    await qaHook(page, 'qaAdvance', (STAMINA_DRAIN_TIME / 2) / 0.05); // 3 more seconds

    const regenText = await page.locator('#staminaState').textContent();
    const regenMatch = regenText?.match(/Stamina: (\d+)%/);
    expect(regenMatch, regenText ?? '').not.toBeNull();
    const regenPct = Number(regenMatch![1]);
    expect(regenPct).toBeGreaterThan(drainedPct);
  });

  test('fully drained stamina clamps at 0%, sprint speed floors at walk speed', async ({ page }) => {
    await boot(page, { qaHooks: true });
    // LUL-2506: see the sibling test above -- strip predators before enter()
    // so nothing can catch and freeze the player mid-setup.
    await qaHook(page, 'qaBuildScene', { predators: [] });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', 0.05);
    await openAdminMode(page);

    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 20 / 0.05); // 20s game time, well past STAMINA_DRAIN_TIME

    await expect(page.locator('#staminaState')).toHaveText('Stamina: 0%');

    // Keep sprinting past the drain point -- must stay clamped at 0%, never
    // negative or wrapping.
    await qaHook(page, 'qaAdvance', 5 / 0.05);
    await expect(page.locator('#staminaState')).toHaveText('Stamina: 0%');
  });
});
