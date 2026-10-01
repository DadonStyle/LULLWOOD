// LUL-5412 (LUL-5408 accepted proposal, roost cooldown cue): before this ticket,
// roostCooldown[i] (engine/forest-engine.js) was set by both the ambient
// predator-proximity path (updateRoosts()) and the player-throw path
// (throwThrowable()) with no HUD field at all -- a player whose target roost had
// already been flushed ambiently got a silent no-op throw, indistinguishable from a
// normal one. This spec stages the ambient (chase-proximity) trigger on the
// mission's own target roost, then proves the denied throw at it: (a)
// #roostCooldownPanel renders with a countdown near the roost, (b) the throw does
// NOT complete the mission (canCompleteFlush() is never reached), (c) the denial
// cue (roostFlushDeniedCue()) fires a caption distinct from the roostThrowCue hint.
// Micro world only, no @fullmap needed (qaMissionKind/qaRoostIndex pin the flush
// mission's target deterministically, same as e2e/mission-flush.spec.ts).
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, advanceChunked, VIEW_X, VIEW_Y } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);
const ROOST_INDEX = 0;

async function enableCaptions(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel('Captions for predator calls').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
  await page.locator('#sound').evaluate((el) => (el as HTMLElement).click());
}

async function enableReducedMotion(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel('Reduced motion (head bob, pickup camera swing, dust)').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
}

async function grabAThrowable(page: Page) {
  const stone = await qaHook(page, 'qaTeleportNearThrowable');
  expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();
  await page.keyboard.press('KeyE');
}

async function throwAtLockedTarget(page: Page) {
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);
  await page.mouse.click(VIEW_X, VIEW_Y);
}

/** Ambiently flushes the mission's target roost via a real chase-state predator
 * (updateRoosts()'s ambient trigger), leaving the player positioned at that roost. */
async function ambientlyFlushMissionRoost(page: Page) {
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  const roost = await qaHook(page, 'qaTeleportNearRoost', ROOST_INDEX);
  expect(roost?.i).toBe(ROOST_INDEX);
  // qaTeleportNearRoost (LUL-5691) now lands the player a full THROWABLE_THROW_DISTANCE
  // (18u) from the roost so a thrown stone lands exactly on it -- outside both
  // ROOST_TRIGGER_RADIUS(6) (the #roostCooldownPanel proximity check) and the roost's
  // own ambient-trigger radius, which this test needs the player and the staged
  // predator standing inside instead. Re-teleport onto the roost's own (scaled)
  // centre it already returned, then stage the predator a couple of units off that --
  // well inside both radii -- rather than off the player's now-distant position.
  await qaHook(page, 'qaTeleportTo', roost.x, roost.z);
  await qaHook(page, 'qaStagePredatorNearPlayer', 'wolf', 2, 0);
  await qaHook(page, 'qaSetPredatorChasing', 'wolf');
  await advanceChunked(page, stepsFor(2));
}

test.describe('roost cooldown cue (LUL-5412)', () => {
  test('an ambient flush puts the mission roost on cooldown and shows #roostCooldownPanel with a countdown', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: ROOST_INDEX });
    await enter(page);
    await ambientlyFlushMissionRoost(page);

    const roost = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(roost.cooldown, 'the ambient chase-proximity path must have actually fired').toBeGreaterThan(0);

    const panel = page.locator('#roostCooldownPanel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Roost quiet');

    // Ceil'd seconds must have visibly ticked down over a further window.
    const firstText = await panel.textContent();
    await advanceChunked(page, stepsFor(3));
    const laterText = await panel.textContent();
    expect(laterText).not.toBe(firstText);
  });

  test('walking well away from the cooled-down roost hides the panel again', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: ROOST_INDEX });
    await enter(page);
    await ambientlyFlushMissionRoost(page);
    await expect(page.locator('#roostCooldownPanel')).toBeVisible();

    // Teleport to a different, distant roost -- outside ROOST_TRIGGER_RADIUS(6) of
    // roost 0, so nearestRoostCooldownT drops back to 0 even though roost 0's own
    // cooldown array entry is still nonzero.
    const other = await qaHook(page, 'qaTeleportNearRoost', 2);
    expect(other?.i).toBe(2);
    await advanceChunked(page, stepsFor(0.5));

    await expect(page.locator('#roostCooldownPanel')).toBeHidden();
  });

  test('a throw at the cooled-down mission roost is denied and does not complete the mission', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: ROOST_INDEX });
    await enter(page);
    await ambientlyFlushMissionRoost(page);

    const before = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(before.deniedCueCount).toBe(0);

    await grabAThrowable(page);
    const roost = await qaHook(page, 'qaTeleportNearRoost', ROOST_INDEX);
    expect(roost?.i).toBe(ROOST_INDEX);
    await throwAtLockedTarget(page);

    const after = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(after.deniedCueCount, 'the denied throw must fire roostFlushDeniedCue(), not a silent no-op').toBe(1);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.status, 'a throw at a roost already on cooldown must never reach canCompleteFlush()').toBe('active');
  });

  test('captionsOn=true: the denied throw fires a caption distinct from the roostThrowCue hint', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: ROOST_INDEX });
    await enter(page);
    await enableCaptions(page);
    await ambientlyFlushMissionRoost(page);

    await grabAThrowable(page);
    const roost = await qaHook(page, 'qaTeleportNearRoost', ROOST_INDEX);
    expect(roost?.i).toBe(ROOST_INDEX);

    const caption = page.locator('#captionToast');
    await throwAtLockedTarget(page);
    await expect(caption).toContainText('resettling from the last flush');
    await expect(caption).not.toContainText('throw a stone at a roost to startle it');
  });

  test('reducedMotion=true: the panel still renders and the denied throw still fires its audio tell (no motion to withhold)', async ({ page }) => {
    await boot(page, { qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: ROOST_INDEX });
    await enter(page);
    await enableReducedMotion(page);
    await ambientlyFlushMissionRoost(page);

    await expect(page.locator('#roostCooldownPanel')).toBeVisible();

    await grabAThrowable(page);
    const roost = await qaHook(page, 'qaTeleportNearRoost', ROOST_INDEX);
    expect(roost?.i).toBe(ROOST_INDEX);
    await throwAtLockedTarget(page);

    const after = await qaHook(page, 'qaProbeRoostState', ROOST_INDEX);
    expect(after.deniedCueCount, 'neither the panel nor the denial cue involve motion -- reducedMotion must not withhold either').toBe(1);
  });
});
