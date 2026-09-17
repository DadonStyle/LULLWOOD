// LUL-2306: predator moveRad split + committed go-around/unstick.
// Micro world, no @fullmap needed (lib/e2e-policy/world-policy.test.ts) --
// every scenario here is placed exactly via qaBuildScene, not hunted for in
// a procedural seed.
//
// PREDATOR_IDX: qaBuildScene() matches a spec's `kind` to the Nth predator of
// that species in the fixed 9-slot pool (wolf x3, bear x3, lion x3, in that
// order -- engine/forest-engine.js's species-pool build loop). A scene with
// exactly one predator of a given kind always claims speciesIdx 0, which
// sits at pool index 0 (wolf), 3 (bear) or 6 (lion) -- qaPredatorState(idx)
// takes that raw pool index, not the species-relative one.
//
// STANDOFF=2.5 (5u total gap) instead of the SPEC's literal 8u-either-side:
// the micro world's applyQaWorldMicroPreset() shrinks CONFIG.detectScaleMul
// to 0.2 (engine/tuning.js), so effective detect radius is ~6-9.6u depending
// on species and shouldGiveUpChase() (lib/game/predator.ts) drops a `chase`
// back to `roam` past 1.5x that -- an 8u-either-side stage (16u apart) is
// already past every species' give-up threshold before it can close at all.
// 2.5u matches e2e/sight-flicker.spec.ts's own micro-world staging distance
// for the same reason.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 1 / 30;
const STANDOFF = 2.5;
const PREDATOR_IDX = { wolf: 0, bear: 3, lion: 6 } as const;

// Same chunked-advance-with-diagnostic shape as e2e/cover-feedback.spec.ts
// (LUL-2734): qaAdvance() drives stepFrame() synchronously inside one
// page.evaluate() call, so a slow rig produces a bare "Test timeout
// exceeded" with no clue where the predator actually got stuck. Racing each
// 1s-of-game-time chunk (30 steps at FIXED_DT=1/30, matching the SPEC's own
// `qaAdvance(30)` polling cadence) against its own budget turns that into a
// specific chunk index and a real qaPredatorState() snapshot to fail with.
const ADVANCE_CHUNK_STEPS = 30; // 1.0s of game time per chunk
const ADVANCE_CHUNK_TIMEOUT_MS = 6000;

interface Snapshot {
  ms: number;
  dist: number;
  x: number;
  z: number;
  state: string;
  moveRad: number;
}

// Advances in 1s-of-game-time chunks up to maxMs, recording a snapshot after
// every chunk, until `reached(snapshot)` is true or the budget runs out.
async function traceUntil(
  page: Page,
  idx: number,
  maxMs: number,
  reached: (s: Snapshot) => boolean,
): Promise<{ trace: Snapshot[]; reachedAt: Snapshot | null }> {
  const trace: Snapshot[] = [];
  let elapsedMs = 0;
  let lastState: unknown = null;
  while (elapsedMs < maxMs) {
    await Promise.race([
      qaHook(page, 'qaAdvance', ADVANCE_CHUNK_STEPS),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `qaAdvance(${ADVANCE_CHUNK_STEPS}) did not return within ${ADVANCE_CHUNK_TIMEOUT_MS}ms ` +
                  `(${elapsedMs}ms of ${maxMs}ms game-time already advanced) -- last known predator state: ` +
                  `${JSON.stringify(lastState)}`,
              ),
            ),
          ADVANCE_CHUNK_TIMEOUT_MS,
        ),
      ),
    ]);
    elapsedMs += ADVANCE_CHUNK_STEPS * FIXED_DT * 1000;
    const p = await qaHook(page, 'qaPredatorState', idx);
    lastState = p;
    const snap: Snapshot = { ms: elapsedMs, dist: p.dist, x: p.x, z: p.z, state: p.state, moveRad: p.moveRad };
    trace.push(snap);
    if (reached(snap)) return { trace, reachedAt: snap };
  }
  return { trace, reachedAt: null };
}

// Contact range the same way tree-pathing.spec.ts's qaStageAndTraceBehindTree
// reads it (dist < rad + 1.3) -- `rad` here is the species catch radius
// reported by qaPredatorState (unaffected by this ticket), not `moveRad`.
function contactReached(rad: number) {
  return (s: Snapshot) => s.dist < rad + 1.3;
}

const SPECIES_RAD = { wolf: 0.8, bear: 1.5, lion: 1.0 } as const;

test.describe('predator steering (LUL-2306): player-sized movement collision + committed go-around', () => {
  // Live-measured on this rig (2026-09-16): every species reaches contact
  // within the first 1s-of-game-time chunk once it no longer grinds on the
  // trunks -- 4s gives >4x margin over that measurement for CI jitter, same
  // convention as tree-pathing.spec.ts's own MAX_MS.
  const GAP_MAX_MS = 4_000;

  for (const kind of ['wolf', 'bear', 'lion'] as const) {
    test(`${kind} passes the same 1.4u trunk gap the player passes`, async ({ page }) => {
      test.setTimeout(45_000);
      await boot(page, { qaHooks: true }); // qaWorld defaults to 'micro' (LUL-2377)
      await enter(page);
      await qaHook(page, 'qaSetFixedStep', FIXED_DT);

      // Two s:1 trees (trunk radius 0.35 each) centred 2.1u apart leave a
      // 1.4u edge-to-edge gap (2.1 - 0.35 - 0.35) -- passable for the
      // player's 0.6 radius (1.4 > 2*0.6) and, pre-fix, not for the bear's
      // 1.5 radius (1.4 < 2*1.5).
      await qaHook(page, 'qaBuildScene', {
        trees: [
          { x: -1.05, z: 0, s: 1 },
          { x: 1.05, z: 0, s: 1 },
        ],
        predators: [{ kind, x: 0, z: STANDOFF, state: 'chase' }],
      });
      await qaHook(page, 'qaTeleportTo', 0, -STANDOFF);

      const idx = PREDATOR_IDX[kind];
      const first = await qaHook(page, 'qaPredatorState', idx);
      expect(first.moveRad, 'moveRad must be the shared player-sized collision radius').toBe(0.6);

      const { trace, reachedAt } = await traceUntil(page, idx, GAP_MAX_MS, contactReached(SPECIES_RAD[kind]));
      expect(
        reachedAt,
        `${kind} never reached contact range through the gap within ${GAP_MAX_MS}ms -- trace: ${JSON.stringify(trace)}`,
      ).not.toBeNull();
      expect(reachedAt!.moveRad).toBe(0.6);
    });
  }

  // Live-measured on this rig (2026-09-16): wolf reaches contact between 8-10s
  // of game time going around the wall's end -- 36s gives >4x margin over that
  // measurement, matching tree-pathing.spec.ts's own measured-not-guessed
  // convention.
  const WALL_MAX_MS = 36_000;

  test('a predator commits around a 5-trunk wall instead of grinding into it', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    // s:1.3 trees (trunk radius 0.455) spaced 1.6u apart leave a 0.69u gap --
    // impassable for both the player and the shared moveRad (needs 1.2u),
    // forcing a real route around one end (wall half-width 3.2+0.455≈3.66u).
    await qaHook(page, 'qaBuildScene', {
      trees: [
        { x: -3.2, z: 0, s: 1.3 },
        { x: -1.6, z: 0, s: 1.3 },
        { x: 0, z: 0, s: 1.3 },
        { x: 1.6, z: 0, s: 1.3 },
        { x: 3.2, z: 0, s: 1.3 },
      ],
      predators: [{ kind: 'wolf', x: 0, z: STANDOFF, state: 'chase' }],
    });
    await qaHook(page, 'qaTeleportTo', 0, -STANDOFF);

    const idx = PREDATOR_IDX.wolf;
    const { trace, reachedAt } = await traceUntil(page, idx, WALL_MAX_MS, contactReached(SPECIES_RAD.wolf));
    expect(
      reachedAt,
      `wolf never reached contact range around the wall within ${WALL_MAX_MS}ms -- trace: ${JSON.stringify(trace)}`,
    ).not.toBeNull();

    // Forward progress, not just the terminal outcome -- a regression that
    // "eventually times out into the random-waypoint fallback and gets
    // lucky" must not read as a pass. Each trace entry is already exactly
    // 1s of game time apart (ADVANCE_CHUNK_STEPS*FIXED_DT); assert no two
    // consecutive entries report an unchanged dist (stuckT-style grinding
    // would show as a run of identical readings).
    let stalled = 0;
    for (let i = 1; i < trace.length; i++) {
      if (Math.abs(trace[i]!.dist - trace[i - 1]!.dist) < 0.05) stalled++;
    }
    expect(
      stalled,
      `wolf's distance-to-player was unchanged (±0.05u) across ${stalled} consecutive 1s samples -- ` +
        `grinding, not going around: ${JSON.stringify(trace)}`,
    ).toBeLessThan(trace.length - 1);
  });

  // Live-measured on this rig (2026-09-16): the wolf's LOS is blocked by the
  // rock almost immediately (chase -> investigate/approach downgrade after
  // SIGHT_FLICKER_TIME, same mechanism e2e/sight-flicker.spec.ts covers), so
  // it closes at the slower approach speed -- reaches contact between 4-5s
  // of game time. 20s gives 4x margin over that measurement.
  const ROCK_MAX_MS = 20_000;

  test('a rock still blocks a predator exactly where it blocks the player', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const ROCK_HX = 1.35, ROCK_HZ = 1.28; // QA_COVER_SHAPE.rock (engine/forest-engine.js)
    await qaHook(page, 'qaBuildScene', {
      props: [{ kind: 'rock', x: 0, z: 0, ry: 0 }],
      predators: [{ kind: 'wolf', x: 0, z: STANDOFF, state: 'chase' }],
    });
    await qaHook(page, 'qaTeleportTo', 0, -STANDOFF);

    const idx = PREDATOR_IDX.wolf;
    const { trace, reachedAt } = await traceUntil(page, idx, ROCK_MAX_MS, contactReached(SPECIES_RAD.wolf));
    expect(
      reachedAt,
      `wolf never reached contact range around the rock within ${ROCK_MAX_MS}ms -- trace: ${JSON.stringify(trace)}`,
    ).not.toBeNull();

    for (const s of trace) {
      const insideAabb = Math.abs(s.x) < ROCK_HX && Math.abs(s.z) < ROCK_HZ;
      expect(
        insideAabb,
        `wolf entered the rock's AABB at (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) at t=${s.ms}ms -- ` +
          `blockedForPredator()'s rock-solid branch is not live at moveRad`,
      ).toBe(false);
    }
  });
});
