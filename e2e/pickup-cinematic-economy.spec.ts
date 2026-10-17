// LUL-6012 (review P1 on PR#1104 "Stop the run clock when the child is picked up"):
// pickup() freezes runSeconds() the instant the lift is accepted, which is correct for
// the displayed clock/win-screen/leaderboard time -- but finishPickup(), ~11.3s later
// once the pickup cinematic ends, used to reuse that same frozen value for
// secondaryComplete()/computeWinPayout() too. A run that only crossed a speedrun
// secondary's time limit DURING the cinematic still banked FIREPOWER_SPEEDRUN_BONUS it
// wouldn't have earned pre-PR#1104. Fixed by giving those two checks their own unfrozen
// read (engine/forest-engine.js's liveRunSeconds()).
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

test('a speedrun secondary that only expires during the pickup cinematic is forfeited, not banked', async ({ page }) => {
  await boot(page, { qaHooks: true, qaMissionKind: 'deepwater', qaSecondaryChoice: 'speedrun' });
  await enter(page);
  // qaClearAllPredators precedent (e2e/mission-progression.spec.ts et al.): this test
  // holds the player still through the clock-poll wait below, long enough for an ambient
  // roam predator to close in -- park every predator to remove that race entirely.
  await qaHook(page, 'qaClearAllPredators');

  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission?.secondary?.data.kind).toBe('speedrun');

  // Shrink the secondary's limit to 3s: short enough that the pickup-accept instant
  // below (run clock just past 1.5s) is still inside the window, but the ~11.3s
  // cinematic alone guarantees real elapsed time crosses it well before finishPickup()
  // reads it.
  const shrunk = await qaHook(page, 'qaShrinkSecondaryTimer', 3);
  expect(shrunk).toEqual({ timeLimitSeconds: 3 });

  const runClock = async () => (await qaHook(page, 'qaProbeRunClock')) as { seconds: number };
  await expect.poll(async () => (await runClock()).seconds, { timeout: 10_000 }).toBeGreaterThan(1.5);
  expect((await runClock()).seconds).toBeLessThan(3);

  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  // pickup() just froze runSeconds() -- still inside the secondary's 3s window.
  expect((await runClock()).seconds).toBeLessThan(3);

  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });

  // RunPayout's depth/survival/carried/rescue (lib/game/economy.ts) are each
  // independently rounded and never fold in missionBonus/secondaryBonus -- the
  // mission-progression.spec.ts "forfeits the mission bonus" test leans on the same
  // identity: total+spent === their sum holds only when no bonus was added. A banked
  // FIREPOWER_SPEEDRUN_BONUS here would break it.
  const recap = await page.locator('#runRecap').textContent();
  expect(recap).not.toBeNull();
  const depth = Number(recap!.match(/\+(\d+) depth/)?.[1]);
  const survival = Number(recap!.match(/\+(\d+) survival/)?.[1]);
  const carried = Number(recap!.match(/\+(\d+) child/)?.[1]);
  const rescue = Number(recap!.match(/\+(\d+) rescue/)?.[1]);
  const spentMatch = recap!.match(/−(\d+) charm/);
  const spent = spentMatch ? Number(spentMatch[1]) : 0;
  const total = Number(recap!.match(/= (\d+) embers/)?.[1]);
  expect([depth, survival, carried, rescue, total].every(Number.isFinite)).toBe(true);
  expect(total + spent).toBe(depth + survival + carried + rescue);
});
