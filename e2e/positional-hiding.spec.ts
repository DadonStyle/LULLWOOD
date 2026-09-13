// LUL-22 / LUL-43: `hidden` stopped being a detection gate and became purely
// the hold-still stance (lower eye height, silence footsteps, show the HUD
// timer). Detection is now `canSee(p, dist)` in engine/forest-engine.js: a
// line-of-sight raycast against cover AABBs (the 8-unit `coverGrid` spatial
// hash, via `hasLOS`/`segRayVsAABB`) combined with an effective detect range
// that shrinks the longer you've held still (`STILL_DETECT_CUT`, capped at
// 0.82 -- it never reaches 1). Two acceptance criteria fall straight out of
// that: standing still in the open next to a predator does NOT save you
// (LOS is clear, so `canSee` stays true regardless of stillness), and
// standing still *behind* real cover does (LOS is blocked, so a chasing
// predator loses its lock and drops into the investigate/sniff cycle instead
// of catching you outright).
//
// Both cases use the dedicated `?qaHooks=1` scaffolding added for this ticket
// (qaOpenHideNearLion / qaHideBehindCover / qaHideBehindCoverKind /
// qaPredatorState -- see the LUL-43 block in engine/forest-engine.js) instead
// of hunting the procedural map for a matching predator/cover pair or waiting
// out the real 30s "force a hunt" trigger. That trigger and the predator's
// approach are both measured in game time, not wall time (the render loop
// clamps dt to 0.05, and this rig's software rendering runs well under 60fps,
// so game time and wall time diverge -- wiki: systems/dt-clamp-vs-walltime);
// the hooks place the predator a few units out and let the real
// approach/catch/investigate code run from there, same trick
// e2e/smoke.spec.ts's predator-death case uses.
//
// LUL-121: species coverage added — wolf, bear, and lion each exercise the
// LOS path independently via qaHideBehindCoverKind(kind). The wolf case
// supercedes the old predators[0] coverage in qaHideBehindCover (which
// happened to be a wolf anyway).
//
// LUL-212: entering `hidden` itself now requires standing at a dedicated
// hiding-spot prop (bramble bush; LUL-2311 dropped the hollow-log
// alternative), not just any LOS-blocking cover -- qaHideBehindCover(Kind)
// only ever place the player at a HIDE_KINDS prop, so the KeyH presses below
// still succeed. The LOS math these tests actually assert on (canSee/hasLOS
// against the coverGrid) is unchanged; rock and tagged trees still block
// sight exactly as before.
//
// LUL-224: the open-lion case below is the exception -- qaOpenHideNearLion
// places the player at (0,0), deep inside `inSpawn` (r<~6.32), which
// generateCover() keeps entirely free of cover props on purpose (that's what
// makes the clearing useful for *this* test: guaranteed no LOS-blocking prop
// between player and lion). But HIDE_RADIUS (2.2) means no HIDE_KINDS prop
// can ever be close enough to (0,0) to enter `hidden` from there either --
// the same emptiness that makes the clearing a good LOS test makes the KeyH
// press below a guaranteed no-op. That's asserted directly via
// qaPlayerState().hidden rather than left implicit, so a future change to
// either radius that quietly lets this test start entering `hidden` gets
// caught here instead of silently changing what "still gets you caught" is
// proving. See wiki: game/qa-precondition-drift-lesson.
//
// LUL-2107: the wolf/bear cover cases below drive time via
// qaSetFixedStep/qaAdvance (docs/specs/lul-2071-deterministic-qa-clock.md)
// instead of expect.poll against the real RAF loop -- that poll only worked
// because swiftshader's dt clamp saturated to a de facto fixed step (wiki
// systems/e2e-post-gpu-nondeterminism), which real GPU rendering (LUL-1910)
// no longer guarantees. Advancing in small fixed chunks and checking the
// predicate after each chunk keeps the same "wait for the state machine to
// get there" intent with no wall-clock component. The lion cover case and
// the two death-race cases (open-lion, hold-still-wolf) are out of this
// ticket's listed scope and are left on the real RAF loop.
import { test, expect } from '@playwright/test';
import { assertInViewport, boot, enter, qaHook } from './helpers';

// Fixed step for the deterministic cases, matching charge-dodge.spec.ts /
// cover-feedback.spec.ts and the hook's own qa-fixed-clock.spec.ts.
const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// Advances game time in fixed chunks, checking `predicate` after each one,
// until it's true or `maxSeconds` of game time is exhausted. Replaces
// expect.poll's wall-clock timeout with a game-time budget -- same "don't
// give up too early" intent, deterministic units.
async function advanceUntil(
  page: import('@playwright/test').Page,
  predicate: () => Promise<boolean>,
  { chunkSeconds = 1, maxSeconds = 20 }: { chunkSeconds?: number; maxSeconds?: number } = {},
): Promise<boolean> {
  const chunkSteps = stepsFor(chunkSeconds);
  const chunks = Math.ceil(maxSeconds / chunkSeconds);
  for (let i = 0; i < chunks; i++) {
    await qaHook(page, 'qaAdvance', chunkSteps);
    if (await predicate()) return true;
  }
  return false;
}

test.describe('positional hiding (LUL-22 / LUL-43)', () => {
  test('hiding in the open near a lion still gets you caught', async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2329: isolate every other predator first -- qaWorld=micro's smaller
    // map otherwise lets an unrelated species reach the player before the
    // lion does (confirmed empirically on smoke.spec.ts's equivalent case;
    // see docs/specs/lul-2329-e2e-migrate-qaworld-micro.md). qaBuildScene
    // parks every predator not listed here as `inert`.
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 4, z: 0 }] });

    // qaOpenHideNearLion drops the player at the spawn clearing (provably
    // tree- and cover-free -- see the hook's own comment in
    // forest-engine.js) and a hunting lion 4 units out, so there is nothing
    // between them for hasLOS() to trip on. If it returns null there was no
    // lion in this seed's spawn to grab; that is a real setup failure, not a
    // "nothing to test here" -- fail loudly instead of letting a `?.()` chain
    // swallow it into a silent pass.
    const idx = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLion?.() ?? null);
    if (idx === null) {
      throw new Error('qaOpenHideNearLion returned null -- no lion was found in `predators` for this seed');
    }

    // Press KeyH anyway -- LUL-224: this is expected to be a no-op (see the
    // file-header comment above), and that expectation is exactly what needs
    // proving, not assumed. If it ever *does* enter `hidden` here, the rest
    // of this test would silently stop being "open ground + clear LOS still
    // catches you" and start being an (untuned, accidental) test of
    // STILL_DETECT_CUT instead -- assert the precondition so that drift is
    // loud, not silent.
    await page.keyboard.press('KeyH');
    const stateAfterHoldStill = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(
      stateAfterHoldStill?.hidden,
      'KeyH should not be able to enter `hidden` this far from any hiding-spot prop -- if it did, this test is no longer exercising the open/no-cover case its name claims',
    ).toBe(false);

    // Real death surface (matches e2e/smoke.spec.ts's predator catch/death
    // case): #deathScreen only mounts once `triggerDeath()` -> pushState
    // flips `deathVisible` (components/Hud.tsx), so waiting for it to become
    // visible is waiting on the actual state machine, not a proxy for it.
    // Polling avoids racing the lion's approach against a guessed wall-clock
    // sleep -- the same dt-clamp-vs-walltime hazard as above applies to how
    // long the close-the-last-1.7-units chase takes to land.
    await expect(page.locator('#deathScreen'), 'the lion should have caught the player in the open').toBeVisible({
      timeout: 20_000,
    });
    await assertInViewport(page.locator('#deathScreen'), page, '#deathScreen');

    // qaOpenHideNearLion specifically grabs a lion, so the death surface
    // should name it -- pins the scenario, not just "a death happened".
    await expect(page.locator('#deathKind')).toHaveText('lion');
  });

  // LUL-121: parameterised helper — reused by all three species cover tests.
  // Each species has different detect range, speed, and body radius, so they
  // each exercise distinct branches of the canSee() geometry even though the
  // state-machine path is the same. Bear has rad=1.5 (largest), which is the
  // case most likely to reveal a placement bug (blocked endpoint check).
  async function assertCoverHidesFromSpecies(
    page: import('@playwright/test').Page,
    kind: 'wolf' | 'bear' | 'lion',
    { fixedClock = false }: { fixedClock?: boolean } = {},
  ) {
    // LUL-2329: left on the full map -- qaHideBehindCoverKind needs a real,
    // naturally-generated HIDE_KINDS cover prop, and this helper also has no
    // isolation against unrelated predators over its up-to-20s poll window
    // (qaBuildScene would guarantee isolation but also wipes the natural
    // cover this hook depends on). See
    // docs/specs/lul-2329-e2e-migrate-qaworld-micro.md.
    await boot(page, { qaHooks: true });
    await enter(page);

    if (fixedClock) {
      // LUL-2107: park the real RAF loop -- from here only advanceUntil()
      // moves simulation time.
      await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    }

    const result = await page.evaluate(
      (k) => window.ForestEngine?.qaHideBehindCoverKind?.(k) ?? null,
      kind,
    );
    if (result === null) {
      throw new Error(
        `qaHideBehindCoverKind('${kind}') returned null -- no non-tree cover prop with a clear path was found`,
      );
    }
    const idx: number = result.idx;

    // Hold still so the investigate→sniff cycle can run without re-escalating
    // (forest-engine.js: re-escalation back to chase is gated on !hidden).
    await page.keyboard.press('KeyH');

    // Transition 1: predator was placed in 'chase' with cover between it and
    // the player. On its next tick canSee() returns false; it flips to
    // 'investigate' and sets sniffsLeft = 1 + rand(0..3).
    const readState = () => page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i)?.state ?? null, idx);
    if (fixedClock) {
      const reached = await advanceUntil(page, async () => (await readState()) === 'investigate');
      expect(
        reached,
        `${kind}: predator never left "chase" for "investigate" after LOS was blocked by cover`,
      ).toBe(true);
    } else {
      await expect
        .poll(readState, {
          message: `${kind}: predator never left "chase" for "investigate" after LOS was blocked by cover`,
          timeout: 20_000,
        })
        .toBe('investigate');
    }

    const afterTransition = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx);
    expect(afterTransition, 'qaPredatorState went stale between poll and read').not.toBeNull();
    expect(
      afterTransition!.sniffsLeft,
      `${kind}: sniffsLeft (${afterTransition!.sniffsLeft}) should be the 1+rand(0..3) budget set on the chase→investigate transition`,
    ).toBeGreaterThanOrEqual(1);
    expect(afterTransition!.sniffsLeft).toBeLessThanOrEqual(4);

    // Transition 2: predator approaches into sniff range. Proves the cycle
    // actually runs, not just that the flag flipped.
    const readInv = () => page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i)?.inv ?? null, idx);
    if (fixedClock) {
      const reached = await advanceUntil(page, async () => (await readInv()) === 'sniff');
      expect(
        reached,
        `${kind}: predator reached "investigate" but never approached into sniff range/state`,
      ).toBe(true);
    } else {
      await expect
        .poll(readInv, {
          message: `${kind}: predator reached "investigate" but never approached into sniff range/state`,
          timeout: 20_000,
        })
        .toBe('sniff');
    }

    // The player must still be alive -- cover did its job.
    await expect(
      page.locator('#deathScreen'),
      `${kind}: a sniffing predator must not have caught the player`,
    ).toHaveCount(0);
  }

  test('wolf: hiding behind cover makes the predator lose the player and sniff instead of catching them', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await assertCoverHidesFromSpecies(page, 'wolf', { fixedClock: true });
  });

  test('bear: hiding behind cover makes the predator lose the player and sniff instead of catching them', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await assertCoverHidesFromSpecies(page, 'bear', { fixedClock: true });
  });

  test('lion: hiding behind cover makes the predator lose the player and sniff instead of catching them', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await assertCoverHidesFromSpecies(page, 'lion');
  });

  test('hold-still alone does not save you when a predator is on top of you (catch path still works)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // This is the L572-L574 catch path: once a predator has closed to within
    // its radius the `hidden` check gates the kill, not canSee(). Cover is
    // irrelevant at that range. Use qaLurePredatorKind so we can pin the
    // species and assert deathKind.
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2329: isolate every other predator first -- see the equivalent fix
    // and rationale in smoke.spec.ts's predator catch/death describe.
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 6, z: 0 }] });
    const kind = await page.evaluate(() => window.ForestEngine?.qaLurePredatorKind?.('wolf') ?? null);
    if (kind === null) {
      throw new Error('qaLurePredatorKind("wolf") returned null -- no wolf in predators');
    }

    // Hold still immediately -- cover is NOT between us and the wolf (it was
    // just placed 6 units away in the open). This confirms that the catch
    // path (hidden-gated kill at close range) is still wired up and that
    // cover + stillness together do not create an invincibility exploit.
    await page.keyboard.press('KeyH');

    await expect(page.locator('#deathScreen'), 'wolf should catch the player even while holding still in the open').toBeVisible({
      timeout: 20_000,
    });
    await assertInViewport(page.locator('#deathScreen'), page, '#deathScreen');
    await expect(page.locator('#deathKind')).toHaveText('wolf');
  });

  // ---- LUL-2320: predators cannot catch a player standing on a log/bramble --

  test('wolf: standing on a log without hiding is not a safe zone (LUL-2320)', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    const spotKind = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.('log') ?? null);
    if (spotKind === null) {
      throw new Error("qaTeleportToHideSpot('log') returned null -- no log was generated on this seed");
    }

    // Same rig as the open-ground "hold-still alone does not save you" case
    // above: qaLurePredatorKind places the wolf 6 units away with hunt=true.
    // Deliberately never press KeyH -- this is the un-hidden case rule (A)
    // fixes: hasLOS() no longer treats the log's own footprint as occluding
    // the point standing inside it, so canSee() reads true and the existing
    // canSee-gated kill check catches normally, with no LOS bypass needed.
    const kind = await page.evaluate(() => window.ForestEngine?.qaLurePredatorKind?.('wolf') ?? null);
    if (kind === null) {
      throw new Error('qaLurePredatorKind("wolf") returned null -- no wolf in predators');
    }

    await expect(page.locator('#deathScreen'), 'wolf should catch the player standing on a log, un-hidden').toBeVisible({
      timeout: 20_000,
    });
    await assertInViewport(page.locator('#deathScreen'), page, '#deathScreen');
    await expect(page.locator('#deathKind')).toHaveText('wolf');
  });

  test('wolf: a blind-chasing predator resolves promptly on reaching a hidden player on a bramble, instead of gluing (LUL-2320)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const spotKind = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.('bramble') ?? null);
    if (spotKind === null) {
      throw new Error("qaTeleportToHideSpot('bramble') returned null -- no bramble was generated on this seed");
    }

    await page.keyboard.press('KeyH');
    const afterHide = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(afterHide?.hidden, 'KeyH should have entered `hidden` while standing on the bramble').toBe(true);

    // qaStageChaseAtContact places the wolf 4 units out (outside contact range,
    // rad+CATCH_MARGIN=2.1) with a live scentLock (SCENT_TRACK_TIME) -- the
    // blind-pursuit state the glue bug's root cause describes -- and does not
    // touch the player. `chase`'s blind branch closes this distance in a
    // straight line at full species speed with no LOS requirement, so this
    // reproduces the reported shape ("tracks in, reaches the player") rather
    // than starting already in contact.
    const staged = await page.evaluate(() => window.ForestEngine?.qaStageChaseAtContact?.('wolf', 4.0, 0) ?? null);
    if (staged === null) {
      throw new Error("qaStageChaseAtContact('wolf', 4.0, 0) returned null -- no wolf in predators");
    }
    const idx: number = staged.idx;

    const sample = () =>
      page.evaluate((i) => {
        const ps = window.ForestEngine?.qaPredatorState?.(i) ?? null;
        const dead = !!document.querySelector('#deathScreen');
        return ps ? { ...ps, dead } : null;
      }, idx);

    const first = await sample();
    expect(first, 'initial qaPredatorState sample was null').not.toBeNull();
    expect(
      first!.dist,
      'staged 4 units out should start outside contact range -- this must be a real closing chase, not an instant-contact case',
    ).toBeGreaterThan(first!.rad + 1.3 /* CATCH_MARGIN, lib/game/predator.ts */);

    const chunkSteps = stepsFor(0.1); // 0.1 game-seconds per sample
    const maxChunks = Math.ceil(10 / 0.1);
    let contactStreakSeconds = 0;
    let resolved = false;
    for (let i = 0; i < maxChunks; i++) {
      await qaHook(page, 'qaAdvance', chunkSteps);
      const s = await sample();
      expect(s, 'qaPredatorState/deathScreen sample went stale mid-loop').not.toBeNull();

      if (s!.dead) { resolved = true; break; } // killed -- a legitimate contact-range resolution, not glue
      if (s!.state !== 'chase') { resolved = true; break; } // dropped out of chase (e.g. rule D's investigate hand-off) -- also not glue

      if (s!.dist < s!.rad + 1.3) {
        contactStreakSeconds += 0.1;
        expect(
          contactStreakSeconds,
          `wolf sat inside contact range for over 1s while still in 'chase' and alive at t~=${(i * 0.1).toFixed(1)}s -- the glue bug is back`,
        ).toBeLessThanOrEqual(1.05);
      } else {
        contactStreakSeconds = 0;
      }
    }

    expect(resolved, 'wolf neither killed the player nor left `chase` within 10 game-seconds of closing to a hidden player on a log').toBe(true);
  });

  test('lion: hiding inside a bramble footprint in the open survives at range, dies within 5s of moving (LUL-2320)', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    const spotKind = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.('bramble') ?? null);
    if (spotKind === null) {
      throw new Error("qaTeleportToHideSpot('bramble') returned null -- no bramble was generated on this seed");
    }

    await page.keyboard.press('KeyH');
    const afterHide = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(afterHide?.hidden, 'KeyH should have entered `hidden` while standing on the bramble').toBe(true);

    // qaLurePredatorKind places the lion 6 units away with hunt=true --
    // outside every species' contact range (rad+CATCH_MARGIN <= 2.8), so this
    // is the "protected at range" case, not the contact case the wolf test
    // above already covers.
    const kind = await page.evaluate(() => window.ForestEngine?.qaLurePredatorKind?.('lion') ?? null);
    if (kind === null) {
      throw new Error('qaLurePredatorKind("lion") returned null -- no lion in predators');
    }

    await page.waitForTimeout(5_000);
    await expect(
      page.locator('#deathScreen'),
      'a hidden player inside a bramble footprint must survive a lion at range',
    ).toHaveCount(0);

    await page.keyboard.down('KeyW');
    const afterMove = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(afterMove?.hidden, 'KeyW should have exited `hidden`').toBe(false);

    await expect(page.locator('#deathScreen'), 'un-hiding while still on the bramble must not stay a safe zone').toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('#deathKind')).toHaveText('lion');
  });
});
