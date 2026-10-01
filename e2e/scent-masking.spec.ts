// LUL-5493 (cheap slice, proposal LUL-5491): three fixed scent-masking sites --
// standing inside one gates depositScent() so the player's own footstep scent
// isn't laid down there. See lib/game/scentMaskSites.ts and the wiki page
// game/mechanics/scent-masking-sites.md's Q11/Q12 answers, which this file
// implements directly.
//
// Driven via qaSetFixedStep/qaAdvance (docs/specs/lul-2071-deterministic-qa-
// clock.md), same as e2e/scent-trail.spec.ts, so "walk N units" is a
// game-time budget, not a wall-clock wait.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const WALK_SPEED = 6; // CONFIG.walk, engine/tuning.js -- not scaled by qaWorld=micro
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);
const secondsToWalk = (units: number) => units / WALK_SPEED;

/** Holds KeyW (forward, given the yaw set below) for `units` of straight-line
 * game-distance, then samples both probes. `qaProbeScentMaskSite().sites` is
 * already scaled by CONFIG.scentMaskScaleMul (0.2 under the default qaWorld=micro
 * boot), so this walks in the same coordinate space the engine itself reads. */
async function walkUnits(page: Page, units: number) {
  await qaHook(page, 'qaAdvance', stepsFor(secondsToWalk(units)));
}

test.describe('scent-masking sites (LUL-5493)', () => {
  test('no new scent motes deposited while inside a site; deposits resume within one interval of exit', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetWindHighSpeed', false);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const site = (await qaHook(page, 'qaProbeScentMaskSite')).sites[0];

    // Face +x (forward = (-sin(yaw), -cos(yaw)) => yaw=-PI/2 gives (1,0)), start
    // 8 units outside the site's entry edge, walk straight through and out the
    // far side, all along the site's own z line.
    await qaHook(page, 'qaTeleportTo', site.x - site.radius - 8, site.z);
    await qaHook(page, 'qaSetLookYaw', -Math.PI / 2);
    await page.keyboard.down('KeyW');

    // Phase 1: still outside (1 unit short of the entry edge) -- baseline
    // deposits must be happening.
    await walkUnits(page, 7);
    let probe = await qaHook(page, 'qaProbeScentMaskSite');
    expect(probe.index, 'must still be outside every site').toBe(-1);
    expect(probe.enterCueCount, 'no enter cue before ever entering a site').toBe(0);
    expect(probe.exitCueCount, 'no exit cue before ever entering a site').toBe(0);
    const outsideTrail = await qaHook(page, 'qaProbeScentTrail');
    expect(outsideTrail.livePoints, 'walking outside a site must deposit scent as normal').toBeGreaterThan(0);

    // Phase 2: cross into the site (2 units past the entry edge).
    await walkUnits(page, 3);
    probe = await qaHook(page, 'qaProbeScentMaskSite');
    expect(probe.index, 'must be inside site 0 now').toBe(0);
    expect(probe.enterCueCount, 'crossing the entry edge fires the enter cue exactly once').toBe(1);
    expect(probe.exitCueCount, 'no exit cue yet -- still inside').toBe(0);
    const insideEntryTrail = await qaHook(page, 'qaProbeScentTrail');

    // Phase 3: keep walking while still inside (11 units total traversed
    // inside a 16-unit-diameter site, so this stays inside throughout) --
    // several SCENT_DEPOSIT_INTERVAL (0.3s) ticks pass with zero new motes.
    await walkUnits(page, 9);
    probe = await qaHook(page, 'qaProbeScentMaskSite');
    expect(probe.index, 'must still be inside the same site').toBe(0);
    expect(probe.enterCueCount, 'still just the one entry -- no re-fire while continuously inside').toBe(1);
    expect(probe.exitCueCount, 'still inside -- no exit cue yet').toBe(0);
    const stillInsideTrail = await qaHook(page, 'qaProbeScentTrail');
    expect(stillInsideTrail.livePoints, 'no new motes must appear while masked, even after several deposit intervals')
      .toBe(insideEntryTrail.livePoints);

    // Phase 4: exit the far side (2 units past the exit edge). Cumulative distance
    // from the entry edge is 9 (phase 2's 2-past-entry) + 9 (phase 3) + 7 = 18, landing
    // at center+10 -- 2 units past the exit edge at center+8 (walking only 5 here lands
    // exactly on the edge, still "inside" per findScentMaskSiteIndex()'s `<= s.radius`).
    await walkUnits(page, 7);
    probe = await qaHook(page, 'qaProbeScentMaskSite');
    expect(probe.index, 'must be outside again after exiting the far side').toBe(-1);
    expect(probe.enterCueCount, 'still just the one entry').toBe(1);
    expect(probe.exitCueCount, 'crossing the exit edge fires the exit cue exactly once').toBe(1);
    const atExitTrail = await qaHook(page, 'qaProbeScentTrail');

    // Deposits resume: one full SCENT_DEPOSIT_INTERVAL (0.3s) of walking, with
    // margin, is well inside the ticket's "resumes within 2s" bound.
    await walkUnits(page, 3);
    await page.keyboard.up('KeyW');
    const afterExitTrail = await qaHook(page, 'qaProbeScentTrail');
    expect(afterExitTrail.livePoints, 'scent deposits must resume shortly after leaving the site')
      .toBeGreaterThan(atExitTrail.livePoints);
  });

  test('a predator standing beside the player inside a site never scent-locks onto them', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetWindHighSpeed', false);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const site = (await qaHook(page, 'qaProbeScentMaskSite')).sites[0];

    // Wolf staged 3 units from the site's own center -- comfortably inside its
    // radius, an "opposing system" genuinely present the whole time, not just a
    // flag check. Sight (canSee()) may or may not lock onto the player at this
    // range -- irrelevant to this test, which only asserts the scent-specific
    // channel (p.scentLock, set only by scentOnto()/checkScent()) never fires.
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: site.x + 3, z: site.z, state: 'roam' }] });
    await qaHook(page, 'qaTeleportTo', site.x, site.z);
    // qaTeleportTo doesn't itself run a tick -- one qaAdvance step picks the new
    // position up, same as any other QA teleport (see forest-engine.js's own
    // comment at the playerInScentMaskSiteIndex update site).
    await qaHook(page, 'qaAdvance', 1);
    expect((await qaHook(page, 'qaProbeScentMaskSite')).index, 'player must register as inside after one tick').toBe(0);

    await qaHook(page, 'qaSetLookYaw', Math.PI / 2); // face -x, away from the wolf
    await page.keyboard.down('KeyW');
    await walkUnits(page, 3); // real movement, still inside the 8-radius site
    await page.keyboard.up('KeyW');

    expect((await qaHook(page, 'qaProbeScentMaskSite')).index, 'must still be inside after the short walk').toBe(0);
    expect((await qaHook(page, 'qaProbeScentTrail')).livePoints, 'no scent was ever deposited to detect').toBe(0);
    const wolf = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(wolf, 'wolf must have been staged by qaBuildScene').not.toBeNull();
    expect(wolf!.scentLock, 'the wolf must never scent-lock -- no trail ever existed to follow').toBe(0);
  });
});
