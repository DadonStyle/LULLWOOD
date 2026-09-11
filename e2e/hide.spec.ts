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
// a dedicated hiding-spot prop (bramble bush; see findHideSpot() in the
// engine -- LUL-2311 later removed the hollow-log alternative). The seeded map
// is now load-bearing for this spec, so `qaTeleportToHideSpot`
// (added for this ticket) places the player at the nearest one before the first
// KeyH press, the same "place deterministically instead of hunting the procedural
// map" pattern e2e/positional-hiding.spec.ts already uses.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, expectRowVisible, expectRowHidden } from './helpers';

test.describe('H hide toggle', () => {
  test('H toggles the Hidden status HUD, and moving breaks cover automatically', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2329: no predator is used anywhere in this file, so building the
    // exact bramble this test needs is safe (see
    // docs/specs/lul-2329-e2e-migrate-qaworld-micro.md's inert-predator note).
    await qaHook(page, 'qaBuildScene', { props: [{ kind: 'bramble', x: 10, z: 0 }] });
    const spot = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
    if (spot === null) {
      throw new Error('qaTeleportToHideSpot returned null -- no bramble hiding spot was found for this seed');
    }

    // Not hiding yet: the #status row is mounted (LUL-2312: #actionSlot's
    // five rows are always in the DOM) but data-visible="0" -- statusVisible
    // is driven 1:1 by `hidden` outside a sniff event.
    await expectRowHidden(page, 'status');

    // H toggles `hidden` on. hideTime resets to 0 on the same keydown
    // (engine/forest-engine.js:553), then climbs every tick while held.
    await page.keyboard.press('KeyH');
    await expectRowVisible(page, 'status');
    await expect(page.locator('#status')).toContainText('Hidden');
    await expect(page.locator('#status')).toHaveText(/Hidden · \d+\.\ds\s+\(moving breaks cover\)/);

    // hideTime is strictly increasing while held and not interrupted.
    const first = await page.locator('#status').textContent();
    await page.waitForTimeout(800);
    const second = await page.locator('#status').textContent();
    expect(second, 'hideTime should keep climbing while held still').not.toBe(first);

    // H again toggles it back off: #status goes back to data-visible="0".
    await page.keyboard.press('KeyH');
    await expectRowHidden(page, 'status');

    // Re-hide, then break cover by moving -- the tick loop drops `hidden`
    // itself (no second H press needed) the instant a movement key is held.
    await page.keyboard.press('KeyH');
    await expectRowVisible(page, 'status');

    await page.keyboard.down('KeyW');
    await expectRowHidden(page, 'status', 2_000);
    await page.keyboard.up('KeyW');
  });
});
