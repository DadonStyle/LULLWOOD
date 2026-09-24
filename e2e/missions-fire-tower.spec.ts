// LUL-4588: the Fire Tower Ascent mission (MissionKind 'deepwater', retargeted
// from the drownedCar landmark to the real fireTower landmark, x:-95/z:-95 --
// engine/tuning.js:77) is exposed with no cover, by design. This proves the
// tower's position is a live detection zone rather than a silent one: a lion
// staged via qaBuildScene/qaLurePredatorKind (the same real-detection idiom
// e2e/positional-hiding.spec.ts's catch-path case uses) catches the player
// who deliberately never presses KeyH, so this is real coverage against a
// real opposing system -- not a HUD-only assertion with nothing hunting the
// player (spec Q11).
//
// World: micro (LUL-2377 default). qaMissionKind='deepwater' forces the
// mission draw to this variant; qaTeleportNearMission() places the player at
// the (micro-world, decoupled) synthetic target regardless of world size, so
// this spec never needs @fullmap.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors, assertInViewport } from './helpers';

test.describe('Fire Tower Ascent mission', () => {
  test('player is detected by a lion while at the exposed fire tower', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = trackConsoleErrors(page);

    await boot(page, { qaHooks: true, qaWorld: 'micro', qaMissionKind: 'deepwater' });
    await enter(page);

    const target = await qaHook(page, 'qaTeleportNearMission');
    expect(target, 'qaTeleportNearMission returned null -- no active mission').not.toBeNull();
    expect(target.kind).toBe('deepwater');

    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 0, z: 0 }] });
    const kind = await qaHook(page, 'qaLurePredatorKind', 'lion');
    expect(kind, 'qaLurePredatorKind("lion") returned null -- no lion in predators').not.toBeNull();

    // Deliberately never press KeyH -- the tower is exposed, no cover, per
    // the feature's own narrative ("no cover, visible from long range").
    await expect(page.locator('#deathScreen'), 'lion should catch the player at the exposed fire tower').toBeVisible({
      timeout: 20_000,
    });
    await assertInViewport(page.locator('#deathScreen'), page, '#deathScreen');
    await expect(page.locator('#deathKind')).toHaveText('lion');

    expectNoConsoleErrors(errs);
  });
});
