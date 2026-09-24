// `H` hide toggle, split out of smoke.spec.ts per LUL-29 (the gap LUL-20/21 shipped
// with a stale comment for but never an actual file -- see wiki: systems/headless-qa-rig).
//
// The first test below is deterministic and baby-walk-free on purpose:
// `hidden` is pure client-side state (engine/forest-engine.js: keydown KeyH
// handler + the tick()-loop moveKey check), so proving the flag/HUD wiring
// needs no predator or wall-clock race against dt-clamped game time (wiki:
// systems/dt-clamp-vs-walltime). That is exactly why this stays its own fast
// file instead of living inside smoke.spec.ts.
//
// LUL-2613: that toggle test is exactly the shape the founder flagged -- it
// proves the input is wired, not that hiding hides you, and cannot fail if
// hiding stops hiding. The second test below stages the missing antagonist
// (a lion that can genuinely see the player) via qaOpenHideNearLionAtHideSpot
// and asserts hiding inside the footprint is what makes it lose sight.
//
// LUL-212: `hidden` can no longer be entered anywhere -- it requires standing at
// a dedicated hiding-spot prop (bramble bush; see findHideSpot() in the
// engine -- LUL-2311 later removed the hollow-log alternative). The seeded map
// is now load-bearing for this spec, so `qaTeleportToHideSpot`
// (added for this ticket) places the player at the nearest one before the first
// KeyH press, the same "place deterministically instead of hunting the procedural
// map" pattern e2e/positional-hiding.spec.ts already uses.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, expectRowVisible, expectRowHidden } from './helpers';

test.describe('H hide toggle', () => {
  test('H toggles the Hidden status HUD, and moving breaks cover automatically', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2329: this test uses no predator, so building the exact bramble it
    // needs is safe (see docs/specs/lul-2329-e2e-migrate-qaworld-micro.md's
    // inert-predator note). The antagonist test below relies on the natural
    // map instead, so it does not call qaBuildScene.
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

  test("hiding inside a hide spot's footprint blocks a lion that could otherwise see the player", async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // No qaBuildScene here (unlike the toggle test above) -- this needs the
    // naturally-generated cover + lion qaOpenHideNearLionAtHideSpot relies on.
    const staged = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.() ?? null);
    if (staged === null) {
      throw new Error('qaOpenHideNearLionAtHideSpot returned null -- no clear-LOS hide spot + lion found for this seed');
    }
    const { idx } = staged;

    // Antagonist proof: before hiding, the lion genuinely can see the player
    // (clear LOS, in range) -- this is what a toggle-only test can't show.
    const before = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx);
    expect(before?.canSee, 'staged lion must have a clear line of sight to the player before hiding').toBe(true);

    // Move from the 0.5u-outside staging point into the hide spot's own
    // footprint -- a teleport, not a held movement key, so it can't trip the
    // "moving breaks cover" check above. qaOpenHideNearLionAtHideSpot places
    // the spot's center, player, and lion colinear in that order (center,
    // then player 0.5u past its edge, then the lion further out still), so
    // moving one unit away from the lion moves the player toward the center,
    // clearing the 0.5u-outside offset and landing inside the box.
    await page.evaluate((i) => {
      const player = window.ForestEngine?.qaPlayerState?.();
      const lion = window.ForestEngine?.qaPredatorState?.(i);
      if (!player || !lion) throw new Error('qaPlayerState/qaPredatorState unavailable');
      const dx = player.x - lion.x, dz = player.z - lion.z;
      const len = Math.hypot(dx, dz) || 1;
      window.ForestEngine?.qaTeleportTo?.(player.x + (dx / len), player.z + (dz / len));
    }, idx);

    await page.keyboard.press('KeyH');
    await expect
      .poll(async () => (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.hidden)
      .toBe(true);

    // The missing antagonist proof: the lion that could see the player a
    // moment ago now cannot, because hiding inside the footprint is what
    // shields them -- not merely toggling the `hidden` flag on.
    const after = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx);
    expect(after?.canSee, "lion must lose sight of the player once hidden inside the hide spot's footprint").toBe(false);
  });

  // LUL-4526: Thorn Snag -- sprint-diving into bramble costs a brief stumble (brambleSnagT
  // speed penalty); walking in costs nothing. Both halves staged back to back on the same
  // micro scene so "walking in is free" is a real negative control, not just asserted from
  // the code.
  //
  // LUL-4872 review: this test originally also staged a wolf and asserted it got alerted by
  // a dedicated Thorn Snag noise burst (BRAMBLE_SNAG_NOISE_RADIUS=5). That assertion passed
  // for the wrong reason -- enterHide()/exitHide() already run an unconditional predator-alert
  // loop at HIDE_ALERT_RADIUS=20 on every hide entry/exit regardless of sprint (LUL-2547), and
  // 5 < 20 always, so any predator close enough to trip the narrower radius was already caught
  // by the wider one; the assertion would have passed identically with Thorn Snag's alert code
  // deleted (coverage that can't fail). The redundant loop has been removed from the engine
  // (see docs/ELEMENTS.md's LUL-4526 paragraph) -- brambleSnagT is the one observable this
  // mechanic alone controls, so it's the only thing asserted below; no predator needed.
  test('sprint-diving into bramble triggers Thorn Snag stumble (brambleSnagT); walking in costs nothing', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    await qaHook(page, 'qaBuildScene', { props: [{ kind: 'bramble', x: 10, z: 0 }] });
    const spot = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
    if (spot === null) {
      throw new Error('qaTeleportToHideSpot returned null -- no bramble hiding spot was found for this seed');
    }

    // walk-in first (control): no sprint key held.
    await page.keyboard.press('KeyH');
    let ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(ps?.brambleSnagT ?? 0).toBe(0);
    await page.keyboard.press('KeyH');   // exit, still no sprint

    // sprint-dive: hold Shift through entry.
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.press('KeyH');
    ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(ps?.brambleSnagT ?? 0).toBeGreaterThan(0);
    await page.keyboard.up('ShiftLeft');
  });
});

// LUL-3066 (Hide Reposition / Wind-Gated Shuffle, docs/specs/lul-3066-hide-reposition.md):
// KeyR while hidden shifts the player within the same cover footprint -- silent upwind,
// noisy + alert-inducing to nearby roam-state predators downwind, on a cooldown.
//
// Deviation from the merged SPEC's literal "hold KeyW, press KeyR" e2e steps: player.yaw is
// 0 right after qaTeleportToHideSpot (spawn default, never rotated by a teleport), so
// shuffleHide()'s facing-direction fallback (fired whenever no movement key is held) already
// produces the same known (0,-1) heading wind-assisted-evasion.spec.ts pins its own wind
// vectors against -- with no need to hold a movement key at all. Holding one instead would
// trip stepFrame()'s pre-existing "moving breaks cover" check (engine/forest-engine.js, the
// tick()-loop moveKey check the 'H hide toggle' describe block above already covers) on the
// very next tick, which would exit hide before the shuffle's effect on `hidden` could be
// observed. The facing-direction path exercises the identical noise/wind logic inside
// shuffleHide() and additionally lets these tests assert the player is still hidden
// afterward -- the feature's whole premise ("shifts the player within the same cover
// footprint", not "exits and re-enters it").
test.describe('KeyR hide-reposition shuffle', () => {
  test('shuffling upwind is silent and keeps the player hidden', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    await qaHook(page, 'qaBuildScene', {
      props: [{ kind: 'bramble', x: 10, z: 0 }],
      predators: [{ kind: 'wolf', x: 15, z: 0, state: 'roam' }],
    });
    const spot = await qaHook(page, 'qaTeleportToHideSpot', 'bramble');
    expect(spot, 'qaTeleportToHideSpot("bramble") must find the seeded bramble').not.toBeNull();

    await page.keyboard.press('KeyH');
    await expect.poll(async () => (await qaHook(page, 'qaPlayerState'))?.hidden).toBe(true);

    // Wind blowing -Z is the same direction as the (0,-1) facing-direction fallback --
    // moving *with* the wind, i.e. not against it (isMovingAgainstWind, lib/game/scent.ts).
    await qaHook(page, 'qaSetWindDirection', 0, -1);
    await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', 5, 0);
    const before = await qaHook(page, 'qaPlayerState');

    await page.keyboard.press('KeyR');

    const after = await qaHook(page, 'qaPlayerState');
    expect(after?.hidden, 'an upwind shuffle must not exit hide').toBe(true);
    expect(after?.z, 'the facing-direction fallback (0,-1) should move the player toward -Z').toBeLessThan(before.z);

    const predState = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(predState?.state, 'an upwind shuffle must not alert a roaming predator').toBe('roam');
  });

  test('shuffling downwind alerts a staged roaming predator', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    await qaHook(page, 'qaBuildScene', {
      props: [{ kind: 'bramble', x: 10, z: 0 }],
      predators: [{ kind: 'wolf', x: 15, z: 0, state: 'roam' }],
    });
    const spot = await qaHook(page, 'qaTeleportToHideSpot', 'bramble');
    expect(spot, 'qaTeleportToHideSpot("bramble") must find the seeded bramble').not.toBeNull();

    await page.keyboard.press('KeyH');
    await expect.poll(async () => (await qaHook(page, 'qaPlayerState'))?.hidden).toBe(true);

    // Wind blowing +Z is directly against the (0,-1) facing-direction fallback -- the
    // movingAgainstWind case (same vector wind-assisted-evasion.spec.ts pins for the
    // opposite reason: :17-23 there wants a proven speed/noise assist against this wind,
    // here we want the proven noise/alert cost of shuffling into it).
    await qaHook(page, 'qaSetWindDirection', 0, 1);
    await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', 5, 0);
    const before = await qaHook(page, 'qaPlayerState');

    await page.keyboard.press('KeyR');

    const after = await qaHook(page, 'qaPlayerState');
    expect(after?.z, 'the facing-direction fallback (0,-1) should still move the player toward -Z').toBeLessThan(before.z);

    const predState = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(predState?.state, 'a downwind shuffle must alert a roaming predator').toBe('investigate');
  });

  test('a second KeyR press inside the cooldown window is a no-op', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    await qaHook(page, 'qaBuildScene', { props: [{ kind: 'bramble', x: 10, z: 0 }] });
    const spot = await qaHook(page, 'qaTeleportToHideSpot', 'bramble');
    expect(spot, 'qaTeleportToHideSpot("bramble") must find the seeded bramble').not.toBeNull();

    await page.keyboard.press('KeyH');
    await expect.poll(async () => (await qaHook(page, 'qaPlayerState'))?.hidden).toBe(true);
    await qaHook(page, 'qaSetWindDirection', 0, -1);   // upwind -- keeps this test's own shuffles silent

    await page.keyboard.press('KeyR');
    const afterFirst = await qaHook(page, 'qaPlayerState');

    // SHUFFLE_COOLDOWN_S is 2s (lib/game/noise.ts) -- two presses back to back, no wait,
    // are well inside the window.
    await page.keyboard.press('KeyR');
    const afterSecond = await qaHook(page, 'qaPlayerState');

    expect(afterSecond?.x, 'a second press inside the cooldown must not move the player again').toBe(afterFirst.x);
    expect(afterSecond?.z, 'a second press inside the cooldown must not move the player again').toBe(afterFirst.z);
    expect(afterSecond?.hidden).toBe(true);
  });
});
