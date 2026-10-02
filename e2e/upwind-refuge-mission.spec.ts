// LUL-5432 (Upwind Refuge, Fire Tower variant of LUL-5424, wiki
// decisions/lul-5424-lul-5426-3proposals-accepted-2026-09-30): same fixed-fireTower-landmark/
// timed MISSION_POOL shape as 'beaconEvasion' (lib/game/mission.ts), but
// repositionBeaconHunterForMission() (engine/forest-engine.js) repositions a real lion
// (predators.find(p => p.kind === 'lion'), same lookup 'lionRoostFlush' uses) ~50u from the
// target instead of the permanent beaconHunter wolf. Teaches upwind positioning as a counter
// to the downwind investigation bias (LUL-5402/PR#923): biasTowardWind() (lib/game/predator.ts)
// already blends a scent-locked investigating predator's heading toward the wind vector for
// ANY predator kind, proven generically for a wolf in e2e/investigation-downwind.spec.ts --
// not retested here (Q7/Q8 duplicate). This spec covers the mission-specific wiring: the
// reposition finds a real lion anchored on the fireTower target (not a roost), the mission
// completes via the plain fixed-landmark reach-zone shape, and a lion staged
// investigate/approach/scentLocked near the tower actually drifts away from a direct line to
// an upwind player, same assertion shape investigation-downwind.spec.ts uses for a wolf.
// No new caption -- 'downwindInvestigation' (engine/forest-engine.js:2094) already fires
// under this exact trigger. Micro world (qaBuildScene default), no @fullmap.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test.describe('Upwind Refuge mission (LUL-5432)', () => {
  test('draws with a repositioned lion near the fireTower target and completes via the real reach-zone/interact path', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'upwindRefuge' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('upwindRefuge');
    expect(mission?.status).toBe('active');

    // The reposition pass runs at generateMap() time, inside boot()/enter() above --
    // probe it here, before qaBuildScene below. qaBuildScene's predators staging claims a
    // lion by `predators.find(q => q.kind === spec.kind && q.speciesIdx === 0)`, the same
    // first-of-kind lion repositionBeaconHunterForMission() already moved
    // (`predators.find(p => p.kind === 'lion')`) -- staging first and probing after reads
    // back the staged (0,-8) position, not the real repositioned one.
    const lionState = await page.evaluate(() => window.ForestEngine?.qaProbePredatorState?.('lion') ?? null);
    expect(lionState).not.toBeNull();
    const distFromTarget = Math.hypot(lionState!.x - mission!.x, lionState!.z - mission!.z);
    expect(distFromTarget, 'repositionBeaconHunterForMission anchors ~50u from the fireTower target, not a roost').toBeCloseTo(50, 0);

    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'lion', x: 0, z: -8, state: 'roam' }],
    });

    // Complete via the real E-key interact at the reach-zone target, same channel
    // beaconEvasion's own completion test uses -- no hold-timer, plain reach-zone.
    const target = await qaHook(page, 'qaTeleportAtMissionTarget');
    expect(target?.kind).toBe('upwindRefuge');
    await qaHook(page, 'qaAdvance', 1);
    await page.keyboard.press('KeyE');
    await qaHook(page, 'qaAdvance', 1);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
  });

  test('a scent-locked investigating lion drifts downwind instead of straight-line at a player holding the fireTower target', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'upwindRefuge' });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    // Player holds the fireTower target itself -- the "upwind refuge" position this mission
    // teaches. Mirrors e2e/investigation-downwind.spec.ts's own staging exactly, just
    // anchored on the mission target instead of the origin: lion due east of the player,
    // wind blowing +z (perpendicular to the straight approach line), so a real downwind bias
    // shows up as extra +z drift, not just "the lion got closer".
    const target = await qaHook(page, 'qaTeleportAtMissionTarget');
    await qaHook(page, 'qaBuildScene', {
      predators: [{ kind: 'lion', x: target.x + 50, z: target.z, state: 'investigate', inv: 'approach', scentLock: 5 }],
    });
    await qaHook(page, 'qaSetWindDirection', 0, 1);

    const before = await qaHook(page, 'qaProbePredatorState', 'lion');
    expect(before.inv).toBe('approach');
    expect(before.scentLock).toBeGreaterThan(0);

    await qaHook(page, 'qaAdvance', stepsFor(1));

    const after = await qaHook(page, 'qaProbePredatorState', 'lion');
    expect(after.x).toBeLessThan(before.x);   // still closing on the target overall
    expect(after.z).toBeGreaterThan(target.z + 0.1);   // pulled north off the straight line to the player
  });
});
