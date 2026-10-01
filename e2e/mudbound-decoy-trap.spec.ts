// LUL-5627 (Mudbound Decoy Amplification, cheap slice of the accepted LUL-5622 proposal):
// generateMudZones() (engine/forest-engine.js) now reserves its first draw to land within
// (r-1) of the Decoy Scent Site (DECOY_SCENT_SITES[0], lib/game/decoyScentSites.ts) every
// game instead of the ~1.7-2.8% a uniform-random draw would -- see that function's own
// comment and LUL-5630's CEO-approved Option A. This file proves the two primitives the
// reservation composes actually compose: a predator redirected onto the decoy by
// hearThrowableNoise() (LUL-5566's exit-transition block, already covered end-to-end by
// e2e/scent-decoy-site.spec.ts) lands on a point that is now always inside a Mud Zone
// (LUL-5564), where mudSpeedMultiplier(predInMud) (forest-engine.js, folded in once after
// every AI branch sets `speed`) clamps its approach speed -- and that the player sees the
// 'mudTrapDecoy' hint caption while standing in the overlap.
//
// Staged via qaBuildScene's `mudZones` override (same forced-geometry pattern
// e2e/wind-deafness-mud.spec.ts uses) -- this proves the *composition mechanic*, not
// reachability. The reachability property (does a real, non-forced generateMudZones() draw
// actually land near the decoy site every seed) is a separate concern, covered by
// e2e/mudbound-decoy-reachability.spec.ts via the real generateMap() path.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;

// Every HINT_PRIORITY key ahead of 'mudTrapDecoy' (engine/forest-engine.js) -- pre-seeding
// these as already-seen guarantees 'scent'/'landmark' (both unconditionally eligible from
// frame 1, see HINT_PRIORITY's own scan comment) can never win the slot ahead of the hint
// this test actually wants to observe. Same technique as
// e2e/wind-assisted-evasion.spec.ts's HINTS_AHEAD_OF_WIND_ASSIST.
const HINTS_AHEAD_OF_MUD_TRAP_DECOY = [
  'scent', 'landmark', 'deepwater', 'oakHollow', 'beaconEvasion', 'skyCompassNavigation',
  'wolf', 'bear', 'lion', 'beaconHunter', 'stamina', 'windAssist',
];
async function preSeenHintsAheadOfMudTrapDecoy(page: Page) {
  await page.addInitScript((keys) => {
    for (const k of keys) window.localStorage.setItem('lullwood:hints:' + k, '1');
  }, HINTS_AHEAD_OF_MUD_TRAP_DECOY);
}

test.describe('Mudbound Decoy Amplification (LUL-5627)', () => {
  test('exiting the decoy site redirects a mid-chase predator onto a point inside the overlapping mud zone', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const site = (await qaHook(page, 'qaProbeDecoyScentSite')).sites[0];
    // Mirrors the real generateMudZones() guarantee -- a mud zone whose center sits within
    // (r-1) of the site, so the site's own point is comfortably inside it.
    const zone = { x: site.x + 3, z: site.z - 2, r: 8 };
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: site.x + 15, z: site.z, state: 'chase' }],
      mudZones: [zone],
    });

    // Enter then exit the site -- the transition that fires the redirect (same technique as
    // e2e/scent-decoy-site.spec.ts).
    await qaHook(page, 'qaTeleportTo', site.x, site.z);
    await qaHook(page, 'qaAdvance', 1);
    await qaHook(page, 'qaTeleportTo', site.x + site.radius + 2, site.z);
    await qaHook(page, 'qaAdvance', 1);

    const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(after.state, 'the live chase is redirected into an investigate/approach off the decoy').toBe('investigate');
    expect(after.noiseTarget, 'redirected onto the decoy site itself').toEqual({ x: site.x, z: site.z });

    const zones = await qaHook(page, 'qaProbeMudZones');
    expect(zones).toEqual([zone]);
    const dx = after.noiseTarget.x - zone.x, dz = after.noiseTarget.z - zone.z;
    expect(Math.hypot(dx, dz), 'the point the predator was just redirected onto sits inside the mud zone -- the composition this ticket guarantees').toBeLessThan(zone.r);
  });

  test('a predator approaching in investigate/approach clamps to MUD_SPEED_MUL(0.6) while inside the overlapping mud zone', async ({ page }) => {
    // Isolated from the redirect trigger above so the comparison is exact: both runs start
    // the predator from rest (qaBuildScene always resets p.vx/p.vz to 0) at the same offset,
    // approaching the same fixed player position over the same tick count -- the only
    // difference is whether a mud zone covers that approach. mudSpeedMultiplier's fold-in
    // (forest-engine.js, after every AI branch sets `speed`, before velocity smoothing)
    // scales the per-tick target speed uniformly, so position-after-N-ticks-from-rest is
    // linear in the target speed and the two runs' displacement ratio should land tightly on
    // MUD_SPEED_MUL regardless of N, as long as N is small enough that neither run leaves its
    // zone/no-zone region (10 ticks moves well under 1u here).
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    const site = (await qaHook(page, 'qaProbeDecoyScentSite')).sites[0];

    async function approachDisplacement(mudZones: { x: number; z: number; r: number }[]) {
      await qaHook(page, 'qaBuildScene', {
        predators: [{ kind: 'wolf', x: site.x + 10, z: site.z, state: 'investigate', inv: 'approach' }],
        mudZones,
      });
      // Player colocated with the site: with no p.noiseTarget set, stepApproach() falls back
      // to the live player direction, so the wolf closes straight toward (site.x, site.z)
      // either way -- same approach path a real noiseTarget-driven redirect would produce.
      await qaHook(page, 'qaTeleportTo', site.x, site.z);
      const before = await qaHook(page, 'qaProbePredatorState', 'wolf');
      for (let i = 0; i < 10; i++) await qaHook(page, 'qaAdvance', 1);
      const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
      return before.x - after.x;
    }

    // Mud radius(12) deliberately larger than the 10u starting offset so predInMud is true
    // for the wolf's whole approach window in the mud run.
    const mudDisplacement = await approachDisplacement([{ x: site.x, z: site.z, r: 12 }]);
    const noMudDisplacement = await approachDisplacement([]);

    expect(noMudDisplacement, 'sanity: the wolf must actually move toward the player outside mud').toBeGreaterThan(0);
    expect(mudDisplacement / noMudDisplacement, 'crossing into the overlapping mud zone clamps the approach to MUD_SPEED_MUL(0.6)').toBeCloseTo(0.6, 1);
  });

  test('the mudTrapDecoy hint fires with the composed-trap text while the player stands in both the decoy site and the overlapping mud zone', async ({ page }) => {
    await preSeenHintsAheadOfMudTrapDecoy(page);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const site = (await qaHook(page, 'qaProbeDecoyScentSite')).sites[0];
    await qaHook(page, 'qaBuildScene', { mudZones: [{ x: site.x, z: site.z, r: 8 }] });

    await qaHook(page, 'qaTeleportTo', site.x, site.z);
    await qaHook(page, 'qaAdvance', 1);

    const caption = page.locator('#hintCaption');
    await expect(caption).toBeVisible();
    await expect(caption).toHaveAttribute('data-hint-key', 'mudTrapDecoy');
    await expect(caption).toContainText('mudbound decoy');
  });
});
