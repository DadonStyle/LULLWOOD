// LUL-4528/LUL-4750: Rock -- Vantage Climb, sightline-only cut (no directional ping --
// explicitly cut vs. Threat Beacon LUL-3009, CEO decision 2026-09-22,
// decisions/lul-3254-prop-powers-accepted-2026-09-22 on the wiki). Tap KeyC near a rock
// (real input path, not a hook that force-sets `mountedOnRock` -- Q1.5) mounts for a fixed
// ROCK_MOUNT_DURATION window: raises the detect-multiplier exposure chain
// (rockClimbDetectMul) and raises eyeH by ROCK_MOUNT_HEIGHT, which also (confirmed, not
// assumed, per the SPEC's own "The change" section) narrows canopyBlockedR()'s live
// per-tree radius. Mutually exclusive with hiding by construction. See
// docs/specs/lul-4528-rock-vantage-climb.md.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, advanceChunked, expectRowVisible } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// Rock at (0,-3): distance to its AABB edge from the player spawn (0,0) is
// 3 - 1.28 (rock hz) = 1.72, inside ROCK_MOUNT_RADIUS=3 (lib/game/rockClimb.ts).
const ROCK_SCENE = { props: [{ kind: 'rock' as const, x: 0, z: -3 }] };

test.describe('Rock -- Vantage Climb (LUL-4750)', () => {
  test('mounting a rock raises effectiveDetect exposure over the pre-mount baseline', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaBuildScene', { ...ROCK_SCENE, predators: [{ kind: 'wolf', x: 20, z: 20 }] });
    const staged = await qaHook(page, 'qaStageRockClimb', 6, 0);
    expect(staged, 'qaStageRockClimb(6, 0) must find the rock and stage a live predator off it').not.toBeNull();

    const before = await qaHook(page, 'qaProbeEffectiveDetect', 'wolf');
    expect(before, 'a staged chase must return a real, non-null detect value').not.toBeNull();

    await page.keyboard.press('KeyC');
    const climb = await qaHook(page, 'qaProbeRockClimb');
    expect(climb.mountedOnRock, 'KeyC near the staged rock must mount').toBe(true);

    const during = await qaHook(page, 'qaProbeEffectiveDetect', 'wolf');
    expect(during, 'mounted, ROCK_CLIMB_DETECT_MUL=1.6 must raise the same detect roll').toBeGreaterThan(before);

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await advanceChunked(page, stepsFor(2.5)); // ROCK_MOUNT_DURATION=2s, clears with margin

    // Not an exact-equality check against `before`: effectiveDetect() also folds in
    // timeOfRunDetectMul (engine/forest-engine.js:2328), which drifts with the 2.5s of
    // elapsed game time the advance above burns, independent of mounting. Instead assert
    // the multiplier mounting itself adds/removes: during/after must both read
    // ROCK_CLIMB_DETECT_MUL (1.6, lib/game/rockClimb.ts) relative to their own
    // still-mounted/already-dismounted baselines.
    const after = await qaHook(page, 'qaProbeEffectiveDetect', 'wolf');
    expect(after, 'auto-dismount must drop exposure back down from the mounted spike').toBeLessThan(during);
    expect(during / after, 'the mounted/unmounted ratio must equal ROCK_CLIMB_DETECT_MUL').toBeCloseTo(1.6, 1);
  });

  // Tree at (10,0), s=3 (well clear of the rock/predator above -- own scene). At
  // CONFIG.eye=2.2 (engine/tuning.js:42), canopyRadiusAtEye(3, 2.2, CANOPY_GEO) ~= 3.61,
  // comfortably clearing the trunk's own 0.35*3+0.6=1.65 block radius -- a point 3.2 units
  // out sits inside the canopy circle (blocked) but outside the trunk circle. Mounted eye
  // (2.2+ROCK_MOUNT_HEIGHT=3.6) drops the canopy radius to ~2.97, clear of that same point --
  // this is the "confirmed, not assumed" claim the SPEC's `## The change` section makes
  // about blocked()'s live eyeH forwarding (engine/forest-engine.js:651-653).
  test('raising eyeH while mounted clears a canopy-blocked position that blocked movement at normal eye height', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {
      ...ROCK_SCENE,
      trees: [{ x: 10, z: 0, s: 3 }],
    });
    const testPoint = { x: 13.2, z: 0 };

    const before = await qaHook(page, 'qaProbeBlocked', testPoint.x, testPoint.z);
    expect(before, 'at normal eye height the canopy circle must block this point').toBe(true);

    await page.keyboard.press('KeyC');
    expect((await qaHook(page, 'qaProbeRockClimb')).mountedOnRock).toBe(true);

    // eyeH lerps toward CONFIG.eye+ROCK_MOUNT_HEIGHT at rate min(1, dt*8) per frame
    // (engine/forest-engine.js:6545) -- 60 steps at FIXED_DT=0.02 (1.2s) converges well
    // past floating-point noise.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await advanceChunked(page, 60);

    const after = await qaHook(page, 'qaProbeBlocked', testPoint.x, testPoint.z);
    expect(after, 'the raised eyeH must narrow the canopy circle clear of the same point').toBe(false);
  });

  test('mounting is refused while hidden, with a denied-cue tell', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    // Bramble at (0,-2): edge distance 2-1.15=0.85, inside HIDE_RADIUS=2.2. Rock at
    // (0,-3) stays in ROCK_MOUNT_RADIUS range the whole time (hiding never moves the
    // player -- enterHide() only flips `hidden`, engine/forest-engine.js:3347-3348).
    await qaHook(page, 'qaBuildScene', { props: [{ kind: 'bramble' as const, x: 0, z: -2 }, ...ROCK_SCENE.props] });

    await page.keyboard.press('KeyH');
    const before = await qaHook(page, 'qaProbeRockClimb');
    expect(before.deniedCueCount).toBe(0);

    await page.keyboard.press('KeyC');
    const after = await qaHook(page, 'qaProbeRockClimb');
    expect(after.mountedOnRock, 'mounting while hidden must be refused').toBe(false);
    expect(after.deniedCueCount, 'a refused mount while hidden must fire the denied cue, not silence').toBe(1);
  });

  test('mounting is refused with no rock in range, with a denied-cue tell', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaBuildScene', {}); // empty world -- no rock anywhere near spawn

    const before = await qaHook(page, 'qaProbeRockClimb');
    expect(before.deniedCueCount).toBe(0);

    await page.keyboard.press('KeyC');
    const after = await qaHook(page, 'qaProbeRockClimb');
    expect(after.mountedOnRock).toBe(false);
    expect(after.deniedCueCount, 'a refused mount with no rock in range must fire the denied cue, not silence').toBe(1);
  });

  test('countdown expires and dismounts automatically, firing the end cue exactly once', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaBuildScene', ROCK_SCENE);

    await page.keyboard.press('KeyC');
    const mid = await qaHook(page, 'qaProbeRockClimb');
    expect(mid.mountedOnRock).toBe(true);
    expect(mid.startCueCount).toBe(1);
    expect(mid.endCueCount, 'the end cue must not fire on mount').toBe(0);

    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await advanceChunked(page, stepsFor(2.5)); // past ROCK_MOUNT_DURATION=2s

    const after = await qaHook(page, 'qaProbeRockClimb');
    expect(after.mountedOnRock, 'the countdown must auto-dismount').toBe(false);
    expect(after.endCueCount, 'the end cue must fire exactly once on expiry').toBe(1);

    // Advance well past expiry again -- the one-shot must never re-fire on later frames.
    await advanceChunked(page, stepsFor(2));
    expect((await qaHook(page, 'qaProbeRockClimb')).endCueCount).toBe(1);
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 727, height: 393 } });

    test('tapping the climbPrompt row mounts on a touch device', async ({ page }) => {
      await boot(page, { qaHooks: true });

      const viewport = page.viewportSize();
      if (!viewport) throw new Error('mobile project must have a viewport size');
      await page.mouse.click(viewport.width / 2, viewport.height / 2);
      await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

      await qaHook(page, 'qaBuildScene', ROCK_SCENE);

      await expectRowVisible(page, 'climbPrompt', 5_000);
      const prompt = page.locator('#climbPrompt');
      // Same synthetic-PointerEvent dispatch as veil-overload.spec.ts / jump.spec.ts
      // (page.mouse-synthesized events report clientX/clientY as 0 under mobile emulation).
      const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
      await prompt.dispatchEvent('pointerdown', pointerOpts);

      const after = await qaHook(page, 'qaProbeRockClimb');
      expect(after.mountedOnRock).toBe(true);
    });
  });
});
