// `H` hide toggle, split out of smoke.spec.ts per LUL-29 (the gap LUL-20/21 shipped
// with a stale comment for but never an actual file -- see wiki: systems/headless-qa-rig).
//
// Deterministic and baby-walk-free on purpose: `hidden` is pure client-side state
// (engine/forest-engine.js: keydown KeyH handler + the tick()-loop moveKey check),
// so there is nothing here that needs a predator, the seeded map, or a wall-clock
// race against dt-clamped game time (wiki: systems/dt-clamp-vs-walltime). That is
// exactly why this stays its own fast file instead of living inside smoke.spec.ts.
import { test, expect, type Page } from '@playwright/test';

const VIEW_X = 640;
const VIEW_Y = 360;

async function enter(page: Page) {
  await page.mouse.click(VIEW_X, VIEW_Y);
  await page.waitForTimeout(1200); // gate fade + requestPointerLock settle
}

test.describe('H hide toggle', () => {
  test('H toggles the Hidden status HUD, and moving breaks cover automatically', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(4000);
    await enter(page);

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
