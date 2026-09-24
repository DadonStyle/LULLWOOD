// LUL-4897 (Beacon Hunter, cheap slice): a `beaconHunter` wolf variant that
// locks onto the player the instant sprintWindBonusActive is true (real
// sprint-against-wind, LUL-3149), bypassing sight and scent entirely -- a
// fourth detection channel in updatePredators()'s roam branch
// (engine/forest-engine.js:2802). See wiki game/mechanics/beacon-hunter
// (corrected 2026-09-24).
//
// Geometry: player spawns at (0,0), forward is (0,-1). The wolf sits at
// (0,-8), straight ahead and within detect range (~9.7u at this build's
// difficulty default -- see qaPredatorState().detectRange), with a bramble
// prop at (0,-4) directly on the line between them, blocking canSee() via
// the coverGrid LOS check -- same precedent as e2e/cover-rustle.spec.ts and
// e2e/hide-alert.spec.ts's `props: [{ kind: 'bramble', x: 10, z: 0 }]`. A
// fresh boot has no scent-trail history, so checkScent() has nothing to
// match either -- both ordinary channels are dark, so any lock-on can only
// be the beacon channel. Wind blows +Z; sprinting forward (0,-1) is directly
// against it, and closes distance on the wolf at the same time.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// qaBuildScene() matches a spec's `kind` to the Nth predator of that species
// in the fixed `predators` array -- same PREDATOR_IDX mapping
// e2e/predator-steering.spec.ts documents and relies on.
const WOLF_IDX = 0;

async function sprintAgainstWind(page: import('@playwright/test').Page, steps: number) {
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', steps, true);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
}

test.describe('Beacon Hunter (LUL-4897): wind-signal wolf lock-on, cheap slice', () => {
  test('locks onto a sprinting-against-wind player through cover, with no scent trail -- bypassing sight and scent', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -8, state: 'roam', variant: 'beaconHunter' }],
      props: [{ kind: 'bramble', x: 0, z: -4 }],
    });
    await qaHook(page, 'qaSetWindDirection', 0, 1);   // wind blows +Z; forward (0,-1) is directly against it

    const before = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(before.state).toBe('roam');
    expect(before.canSee, 'bramble at (0,-4) must block the direct sightline').toBe(false);

    // A single tick is enough for the beacon check (no travel-distance
    // precondition, evaluated every frame the roam branch runs) to fire --
    // kept to one tick deliberately, since a roaming predator's own
    // wander drifts it off the exact bramble-blocking alignment within a
    // few frames and would let ordinary canSee take over instead.
    await sprintAgainstWind(page, 1);

    const after = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(after.canSee, 'sight must still be dark the instant the lock fires').toBe(false);
    expect(after.state, 'the beacon channel must fire even with sight and scent both dark').toBe('chase');
    expect(after.variant).toBe('beaconHunter');
  });

  test('give-up: once the scentLock decays with sight still blocked, the chase downgrades and the lock clears', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -8, state: 'roam', variant: 'beaconHunter' }],
      props: [{ kind: 'bramble', x: 0, z: -4 }],
    });
    await qaHook(page, 'qaSetWindDirection', 0, 1);

    await sprintAgainstWind(page, 1);
    const locked = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(locked.state).toBe('chase');
    expect(locked.beaconHunterLocked).toBe(true);

    // Stop sprinting against the wind -- sprintWindBonusActive drops false,
    // so the beacon channel can't refire. Teleport far away so canSee stays
    // false for the whole window (real chase movement would otherwise close
    // distance and could re-spot on sight). Once scentLock (seeded at
    // SCENT_TRACK_TIME=8s, lib/game/scent.ts:28) decays to 0,
    // shouldDowngradeChase() (lib/game/predator.ts:113, wired at
    // engine/forest-engine.js:2847) drops 'chase' to the ordinary
    // investigate/approach/sniff loop -- the same blind-chase-expiry path
    // any scentLock consumer takes, with no beacon-specific carve-out.
    await qaHook(page, 'qaTeleportTo', 200, 200);
    await qaHook(page, 'qaAdvance', stepsFor(8.5), true);

    const gaveUp = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(gaveUp.state, 'the chase must downgrade once scentLock empties and sight stays blocked').toBe('investigate');
    expect(gaveUp.beaconHunterLocked, 'the lock must clear at every chase-exit site, mirroring the other scentLock consumers').toBe(false);
  });

  test('negative control: an ordinary wolf (no variant) does not lock on to the identical wind signal', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'wolf', x: 0, z: -8, state: 'roam' }],
      props: [{ kind: 'bramble', x: 0, z: -4 }],
    });
    await qaHook(page, 'qaSetWindDirection', 0, 1);

    const before = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(before.variant).toBeUndefined();

    // Same single-tick window as the beaconHunter test above -- long enough
    // for the beacon check to fire if it were going to, short enough that
    // this roaming wolf's own wander hasn't yet drifted it off the
    // bramble-blocking alignment (which would open a legitimate sight-based
    // chase and confound the control -- see the beaconHunter test's comment).
    await sprintAgainstWind(page, 1);

    const after = await qaHook(page, 'qaPredatorState', WOLF_IDX);
    expect(after.state, 'an ordinary wolf has no beacon channel to fire').toBe('roam');
    expect(after.beaconHunterLocked).toBe(false);
  });
});
