// LUL-5566 (cheap slice, plan LUL-5560): one fixed scent-decoy site -- leaving it
// fires hearThrowableNoise(p, site.x, site.z, DECOY_INVESTIGATE_TIME) for every
// non-inert predator within DECOY_SCENT_RADIUS(18), the same noiseTarget-override
// mechanism e2e/roost-flush.spec.ts already proves redirects a predator off the
// real player and onto a fixed point -- this file stages a predator already in
// `state: 'chase'` (not 'roam') to prove the redirect works mid-chase, per the
// ticket's own correction (do NOT hook checkScent()/scentOnto()/scentPoints,
// which cannot redirect a live chase; see docs/ELEMENTS.md's Scent-Decoy Site
// section). See lib/game/decoyScentSites.ts.
//
// Staged via qaTeleportTo + single-tick qaAdvance(1) calls, same pattern as
// e2e/roost-flush.spec.ts, rather than a multi-second walk: with the predator
// genuinely in `state: 'chase'`, a several-second walk risks it closing the gap
// and catching the player before the exit transition ever fires. A teleport is
// picked up by the per-tick enter/exit diff on the very next frame, same as real
// walking into/out of a site (see forest-engine.js's own comment on that diff).
//
// scentLock: SCENT_TRACK_TIME (8, lib/game/scent.ts) mirrors a real scentOnto()/
// spotOnto() chase entry -- same precedent as e2e/chapel-veil-escape-combo-mission.spec.ts
// and e2e/ghost-veil-escape-mission.spec.ts. Without it, qaBuildScene's staged
// 'chase' has no scentLock and the player is far outside the staged wolf's
// (scaled-down, qaWorld=micro) sight detect radius, so shouldDowngradeChase()
// (lib/game/predator.ts, forest-engine.js:6127's own comment) reverts 'chase' to
// 'investigate' on the very first qaAdvance(1) tick -- before the decoy site's
// exit-transition redirect is ever exercised.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;

test.describe('scent-decoy site (LUL-5566)', () => {
  test('exiting the site redirects a predator already mid-chase onto the site, not the player', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const site = (await qaHook(page, 'qaProbeDecoyScentSite')).sites[0];

    // Wolf staged mid-chase, within DECOY_SCENT_RADIUS(18) of the site.
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: site.x + 15, z: site.z, state: 'chase', scentLock: 8 }] });

    const before = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(before.state, 'staged as a real mid-chase, not investigate/roam').toBe('chase');
    expect(before.noiseTarget).toBeNull();

    // Enter the site.
    await qaHook(page, 'qaTeleportTo', site.x, site.z);
    await qaHook(page, 'qaAdvance', 1);
    let probe = await qaHook(page, 'qaProbeDecoyScentSite');
    expect(probe.index, 'must be inside the site now').toBe(0);
    expect(probe.exitCueCount, 'no exit cue yet -- still inside').toBe(0);

    const stillChasing = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(stillChasing.state, 'entering the site alone does not redirect -- only exiting does').toBe('chase');
    expect(stillChasing.noiseTarget).toBeNull();

    // Exit the site (2 units past the edge) -- this is the transition that fires the redirect.
    await qaHook(page, 'qaTeleportTo', site.x + site.radius + 2, site.z);
    await qaHook(page, 'qaAdvance', 1);
    probe = await qaHook(page, 'qaProbeDecoyScentSite');
    expect(probe.index, 'must be outside again').toBe(-1);
    expect(probe.exitCueCount, 'crossing the exit edge fires the exit cue exactly once').toBe(1);

    const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
    // hearThrowableNoise() commits state:'investigate'/inv:'approach' and overwrites
    // noiseTarget to the site's own (x,z) -- off the real player entirely, even
    // though the wolf was genuinely mid-chase a moment ago.
    expect(after.state, 'the live chase is redirected into an investigate/approach off the decoy').toBe('investigate');
    expect(after.noiseTarget).toEqual({ x: site.x, z: site.z });
  });

  test('a predator outside DECOY_SCENT_RADIUS of the site is unaffected by the exit', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const site = (await qaHook(page, 'qaProbeDecoyScentSite')).sites[0];
    // 25u from the site -- outside DECOY_SCENT_RADIUS(18).
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: site.x + 25, z: site.z, state: 'chase', scentLock: 8 }] });

    await qaHook(page, 'qaTeleportTo', site.x, site.z);
    await qaHook(page, 'qaAdvance', 1);
    await qaHook(page, 'qaTeleportTo', site.x + site.radius + 2, site.z);
    await qaHook(page, 'qaAdvance', 1);

    const probe = await qaHook(page, 'qaProbeDecoyScentSite');
    expect(probe.index).toBe(-1);
    expect(probe.exitCueCount, 'the exit cue still fires -- only the predator loop is distance-gated').toBe(1);

    const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(after.state, 'too far away to hear the redirect').toBe('chase');
    expect(after.noiseTarget).toBeNull();
  });

  test('per-site cooldown blocks a second redirect inside DECOY_COOLDOWN', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const site = (await qaHook(page, 'qaProbeDecoyScentSite')).sites[0];
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: site.x + 15, z: site.z, state: 'chase', scentLock: 8 }] });

    // First enter/exit -- fires the redirect.
    await qaHook(page, 'qaTeleportTo', site.x, site.z);
    await qaHook(page, 'qaAdvance', 1);
    await qaHook(page, 'qaTeleportTo', site.x + site.radius + 2, site.z);
    await qaHook(page, 'qaAdvance', 1);

    const firstProbe = await qaHook(page, 'qaProbeDecoyScentSite');
    expect(firstProbe.exitCueCount).toBe(1);
    expect(firstProbe.cooldown[0]).toBeGreaterThan(0);

    // Re-enter and exit again immediately, well under DECOY_COOLDOWN(30s).
    await qaHook(page, 'qaTeleportTo', site.x, site.z);
    await qaHook(page, 'qaAdvance', 1);
    await qaHook(page, 'qaTeleportTo', site.x + site.radius + 2, site.z);
    await qaHook(page, 'qaAdvance', 1);

    const secondProbe = await qaHook(page, 'qaProbeDecoyScentSite');
    expect(secondProbe.exitCueCount, 'still on cooldown -- no second redirect, no second cue').toBe(1);
  });
});
