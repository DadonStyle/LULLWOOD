// `H` hide toggle, split out of smoke.spec.ts per LUL-29 (the gap LUL-20/21 shipped
// with a stale comment for but never an actual file -- see wiki: systems/headless-qa-rig).
//
// Deterministic and baby-walk-free on purpose: `hidden` is pure client-side state
// (engine/forest-engine.js: keydown KeyH handler + the tick()-loop moveKey check),
// so there is nothing here that needs a predator or a wall-clock race against
// dt-clamped game time (wiki: systems/dt-clamp-vs-walltime). That is exactly why
// this stays its own fast file instead of living inside smoke.spec.ts.
//
// LUL-212: `hidden` can no longer be entered anywhere -- it requires standing at
// a dedicated hiding-spot prop (bush/hollow log; see findHideSpot() in the
// engine). The seeded map is now load-bearing for this spec, so `qaTeleportToHideSpot`
// (added for this ticket) places the player at the nearest one before the first
// KeyH press, the same "place deterministically instead of hunting the procedural
// map" pattern e2e/positional-hiding.spec.ts already uses.
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

test.describe('H hide toggle', () => {
  test('H toggles the Hidden status HUD, and moving breaks cover automatically', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    const spot = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
    if (spot === null) {
      throw new Error('qaTeleportToHideSpot returned null -- no bush/hollow-log hiding spot was found for this seed');
    }

    // Not hiding yet: #status is unmounted (Hud.tsx only mounts it when
    // statusVisible, which is driven 1:1 by `hidden` outside a sniff event).
    await expect(page.locator('#status')).toHaveCount(0);

    // H toggles `hidden` on. hideTime resets to 0 on the same keydown
    // (engine/forest-engine.js:553), then climbs every tick while held.
    await page.keyboard.press('KeyH');
    await expect(page.locator('#status')).toBeVisible();
    await expect(page.locator('#status')).toHaveClass(/hiding/);
    await expect(page.locator('#status')).toContainText('Hidden');
    await expect(page.locator('#status')).toHaveText(/Hidden · \d+\.\ds\s+\(move to break cover\)/);

    // hideTime is strictly increasing while held and not interrupted.
    const first = await page.locator('#status').textContent();
    await page.waitForTimeout(800);
    const second = await page.locator('#status').textContent();
    expect(second, 'hideTime should keep climbing while held still').not.toBe(first);

    // H again toggles it back off: #status unmounts.
    await page.keyboard.press('KeyH');
    await expect(page.locator('#status')).toHaveCount(0);

    // Re-hide, then break cover by moving -- the tick loop drops `hidden`
    // itself (no second H press needed) the instant a movement key is held.
    await page.keyboard.press('KeyH');
    await expect(page.locator('#status')).toBeVisible();

    await page.keyboard.down('KeyW');
    await expect(page.locator('#status')).toHaveCount(0, { timeout: 2_000 });
    await page.keyboard.up('KeyW');
  });
});
