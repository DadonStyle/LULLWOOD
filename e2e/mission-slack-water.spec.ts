// LUL-4958: M3 Slack Water -- completes when the player accepts the child pickup while
// Fog Tide (LUL-27) is in its 'active' phase, checked at pickup()'s acceptance instant
// (not finishPickup()'s, ~11.3s later -- see docs/specs/lul-4958-slack-water.md's Design
// call §1). No world target (`spatial: false`), so this spec never needs @fullmap --
// qaSetFogTideClock (new hook) stages the 90s cycle deterministically instead of waiting
// on it in real time.
//
// #runRecap has no dedicated "mission bonus" line item -- the bonus folds straight into
// `payout.total` (lib/game/economy.ts's computeWinPayout). Same technique
// e2e/mission-progression.spec.ts's expiry test already uses to prove a bonus was
// forfeited (total + spent === depth + survival + carried + rescue holds only with no
// bonus): here the identity's gap is asserted to equal MISSION_SLACKWATER_REWARD when
// fog-tide is active, and 0 when it isn't.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';
import { MISSION_SLACKWATER_REWARD } from '../lib/game/economy';

async function payoutGap(page: import('@playwright/test').Page): Promise<number> {
  const recap = await page.locator('#runRecap').textContent();
  expect(recap).not.toBeNull();
  const depth = Number(recap!.match(/\+(\d+) depth/)?.[1]);
  const survival = Number(recap!.match(/\+(\d+) survival/)?.[1]);
  const carried = Number(recap!.match(/\+(\d+) child/)?.[1] ?? 0);
  const rescue = Number(recap!.match(/\+(\d+) rescue/)?.[1] ?? 0);
  const spentMatch = recap!.match(/−(\d+) charm/);
  const spent = spentMatch ? Number(spentMatch[1]) : 0;
  const total = Number(recap!.match(/= (\d+) embers/)?.[1]);
  expect([depth, survival, total].every(Number.isFinite)).toBe(true);
  return total + spent - (depth + survival + carried + rescue);
}

test('picking up the child while fog-tide is active completes Slack Water and pays the bonus', async ({ page }) => {
  test.setTimeout(60_000);
  const errs = trackConsoleErrors(page);
  await boot(page, { qaHooks: true, qaMissionKind: 'slackWater' });
  await enter(page);

  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.kind).toBe('slackWater');
  expect(mission?.status).toBe('active');

  // 75s into the 90s cycle -- activeStart = period(90) - activeDuration(20) = 70, so 75 is
  // well inside the active window (lib/game/fogTide.ts FOG_TIDE_CONFIG).
  await qaHook(page, 'qaSetFogTideClock', 75);
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);

  // Real KeyE press -- matches e2e/mission-deepwater.spec.ts's convention (the real
  // pickup path, not a force-hook, per the Feature Checklist's Q1.5).
  await page.keyboard.press('KeyE');

  // Synchronous with the KeyE press, well before the ~11.3s pickup cinematic finishes --
  // proves the check fires at pickup()'s acceptance instant, not at finishPickup()'s.
  const completedEarly = await qaHook(page, 'qaProbeMission');
  expect(completedEarly?.status).toBe('complete');

  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  // boot()'s default tier is 'night' (engine/forest-engine.js `let difficulty = 'night'`,
  // :1694), not 'lantern' -- computeWinPayout's win multiplier there is 1.75
  // (lib/game/economy.ts TIER_MULTIPLIERS, not exported), so the bonus that actually lands
  // in `total` is Math.round(MISSION_SLACKWATER_REWARD * 1.75), not the raw reward.
  expect(await payoutGap(page)).toBe(Math.round(MISSION_SLACKWATER_REWARD * 1.75));

  expectNoConsoleErrors(errs);
});

test('picking up the child outside the active window does not complete Slack Water', async ({ page }) => {
  test.setTimeout(60_000);
  const errs = trackConsoleErrors(page);
  await boot(page, { qaHooks: true, qaMissionKind: 'slackWater' });
  await enter(page);

  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.kind).toBe('slackWater');

  // Calm phase (0s into the cycle) -- fog-tide is not active.
  await qaHook(page, 'qaSetFogTideClock', 0);
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');

  const stillActive = await qaHook(page, 'qaProbeMission');
  expect(stillActive?.status).toBe('active');

  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  const afterWin = await qaHook(page, 'qaProbeMission');
  expect(afterWin?.status).toBe('active'); // never completes -- no expiry/reset for this mission (SPEC Design call §2)
  expect(await payoutGap(page)).toBe(0);

  expectNoConsoleErrors(errs);
});

test('Slack Water produces no mission-nav hum', async ({ page }) => {
  // No hum-call counter hook exists for missionWaypointHum() (grepped
  // engine/forest-engine.js's qaHooks block -- only qaProbeMission/qaTeleportAtMissionTarget
  // read mission state, nothing counts hum invocations), so this asserts the weaker,
  // SPEC-sanctioned fallback: no console error/exception across enough real simulated
  // ticks to have crossed missionHumTimer's initial 2s delay and several of its
  // 2-5.5s-interval re-arms, while the only active mission is the non-spatial one.
  const errs = trackConsoleErrors(page);
  await boot(page, { qaHooks: true, qaMissionKind: 'slackWater' });
  await enter(page);

  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.kind).toBe('slackWater');

  await qaHook(page, 'qaSetFixedStep', 1);
  await qaHook(page, 'qaAdvance', 20, true);

  expectNoConsoleErrors(errs);
});
