// LUL-2202: backfill for LUL-1638-era throwables per docs/specs/
// lul-1623-throwables.md's '## e2e' section (LUL-2186) -- this mechanic shipped
// with zero automated coverage. Two new hooks make it testable: qaTeleportNearThrowable()
// stands the player next to a live stone WITHOUT grabbing it (unlike the existing
// qaGrabThrowable, which is for other specs that just need one in hand), so the real
// KeyE/pickup() path is what's under test here; qaStagePredatorNearThrowLanding(kind)
// places a roaming predator inside THROWABLE_NOISE_RADIUS of where the next throw will
// land, so the noise-redirect path (checkThrowableNoise()/hearThrowableNoise()) runs for
// real off a throw a test actually triggered, not a synthetic hearThrowableNoise() call.
// See e2e/mobile/throwables.spec.ts for the touch half.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, VIEW_X, VIEW_Y, trackConsoleErrors, expectNoConsoleErrors, expectRowVisible, expectRowHidden } from './helpers';

// Fixed step for the noise-redirect case, matching scent.spec.ts / positional-hiding.spec.ts
// (LUL-2107: qaSetFixedStep/qaAdvance instead of a real-RAF wall-clock poll).
const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function advanceUntil(
  page: import('@playwright/test').Page,
  predicate: () => Promise<boolean>,
  { chunkSeconds = 0.5, maxSeconds = 10 }: { chunkSeconds?: number; maxSeconds?: number } = {},
): Promise<boolean> {
  const chunkSteps = stepsFor(chunkSeconds);
  const chunks = Math.ceil(maxSeconds / chunkSeconds);
  for (let i = 0; i < chunks; i++) {
    await qaHook(page, 'qaAdvance', chunkSteps);
    if (await predicate()) return true;
  }
  return false;
}

test.describe('throwables (LUL-1623)', () => {
  test('grabbing a throwable sets heldThrowable and shows the throw prompt', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    // Made to fail once on purpose: standing next to the stone without pressing
    // E yet must not already hold it. LUL-2312: #throwPrompt is one of
    // #actionSlot's always-mounted rows now -- "not held" is data-visible="0".
    await expectRowHidden(page, 'throwPrompt');

    await page.keyboard.press('KeyE');

    await expectRowVisible(page, 'throwPrompt');
    await expect(page.locator('#throwPrompt')).toContainText('click to throw');

    expectNoConsoleErrors(errs);
  });

  test('throwing clears heldThrowable and the prompt disappears', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    await page.keyboard.press('KeyE');
    await expectRowVisible(page, 'throwPrompt');

    // throwThrowable() only fires from the real mousedown handler while Pointer
    // Lock is engaged (engine/forest-engine.js) -- enter() above already
    // requested it, so confirm it actually landed before relying on the click.
    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);

    await page.mouse.click(VIEW_X, VIEW_Y);

    await expectRowHidden(page, 'throwPrompt', 3_000);
  });

  test('throwing shows the landing visual and it decays', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    await page.keyboard.press('KeyE');
    await expectRowVisible(page, 'throwPrompt');

    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);

    // qaSetFixedStep cancels the real rAF loop (engine/forest-engine.js) -- set it
    // before the click, not after, so no real frame can tick throwImpactStart
    // forward between throwThrowable()'s synchronous trigger and the probe below.
    // Placing it after (as this test originally did) left a real-time gap across the
    // click's mousedown->mouseup roundtrip and the probe's own page.evaluate() --
    // CI load stretched that gap past the 0.1s assertion (observed 0.137-0.139s).
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await page.mouse.click(VIEW_X, VIEW_Y);

    const justAfter = await qaHook(page, 'qaProbeThrowImpact');
    expect(justAfter?.active).toBe(true);
    expect(justAfter?.elapsedS).toBeLessThan(0.1);

    await qaHook(page, 'qaAdvance', stepsFor(1.5));

    const after = await qaHook(page, 'qaProbeThrowImpact');
    expect(after?.active).toBe(false);
  });

  test('a thrown rock lures a nearby roaming predator into investigate', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    const staged = await qaHook(page, 'qaStagePredatorNearThrowLanding', 'wolf');
    expect(staged, 'qaStagePredatorNearThrowLanding returned null -- no wolf spawned this seed').not.toBeNull();

    // Made to fail once on purpose: the staged predator must start out roaming,
    // not already investigating/hunting, or the transition below proves nothing.
    const before = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(before?.state).toBe('roam');
    expect(before?.investigateCueCount).toBe(0);

    await page.keyboard.press('KeyE');
    // LUL-2352: heldThrowable only reaches the HUD through stepFrame()'s
    // per-tick pushState (engine/forest-engine.js) -- qaSetFixedStep() above
    // already parked the real RAF loop that would normally flush it, so
    // #throwPrompt's data-visible attribute won't update until a frame is
    // actually advanced. One step is enough; the noise-redirect polling
    // below advances plenty more.
    await qaHook(page, 'qaAdvance', 1);
    await expectRowVisible(page, 'throwPrompt');

    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);
    await page.mouse.click(VIEW_X, VIEW_Y);

    // LUL-5993: the landing visual (triggerThrowImpact()) must fire in the same frame as
    // the noise-redirect logic above it, not staggered behind it -- this should hold
    // trivially today since checkThrowableNoise()/hearThrowableNoise() both already run
    // synchronously in throwThrowable() before triggerThrowImpact() is even reached; its
    // value is catching a *future* edit that reorders the calls. Landing itself stays
    // instant (no projectile arc/travel-time) per decisions/lul-1869's throw-timing economy
    // and this ticket's explicit scope boundary.
    const impactJustAfterThrow = await qaHook(page, 'qaProbeThrowImpact');
    expect(impactJustAfterThrow?.active).toBe(true);

    const reachedInvestigate = await advanceUntil(page, async () => {
      const s = await qaHook(page, 'qaProbePredatorState', 'wolf');
      return s?.state === 'investigate';
    });
    expect(reachedInvestigate, 'wolf did not enter investigate off the thrown stone\'s landing noise').toBe(true);

    // LUL-5626: investigateCue() fires on this real hearThrowableNoise() entry --
    // counted before its own audio/soundOn gate, so this holds regardless of the
    // default boot sound setting.
    const after = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(after?.investigateCueCount).toBeGreaterThanOrEqual(1);
  });
});
