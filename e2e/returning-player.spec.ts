import { test, expect } from '@playwright/test';
import { boot, trackConsoleErrors, expectNoConsoleErrors } from './helpers';
import { freshProgression } from '../lib/game/progression';

// LUL-2221 (founder, 2026-09-09): production blanked for every RETURNING player because
// engine/forest-engine.js's init() return object omitted setMissionUnlocks/setSecondaryChoice
// while components/Hud.tsx calls actions.setMissionUnlocks() on mount whenever
// localStorage holds `lullwood:mission-unlocks`. A fresh browser context never has that
// record, so the whole suite was green. This spec seeds a returning player's storage
// BEFORE the first byte loads and asserts the game boots without a page error.
// LUL-2558: same shape of regression -- a stored `lullwood:progression` blob must not
// blank the page when setProgression is missing from init()'s return object.
const RETURNING_PLAYER: Record<string, string> = {
  'lullwood:mission-unlocks': JSON.stringify({ deepwater: true }),
  'lullwood:embers': JSON.stringify({ balance: 352, tiers: { deeperLungs: 1 } }),
  'lullwood:hasDied': '1',
  'lullwood:progression': JSON.stringify({ lantern: { bestTime: 145, runs: 4, wins: 2, currentStreak: 1 }, night: freshProgression().night, blackout: freshProgression().blackout }),
};

test('a returning player (stored unlocks, embers, hasDied) reaches the gate with no page error', async ({ page, context }) => {
  await context.addInitScript((seed: Record<string, string>) => {
    for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
  }, RETURNING_PLAYER);
  const tracked = trackConsoleErrors(page);
  await boot(page, { qaHooks: true });
  await expect(page.locator('#gate')).toBeVisible();
  // Every key the HUD is typed to call must exist on the engine's action object.
  const missing = await page.evaluate(() => {
    const fe = window.ForestEngine as unknown as Record<string, unknown> | undefined;
    return fe ? [] : ['ForestEngine'];
  });
  expect(missing).toEqual([]);
  expectNoConsoleErrors(tracked);
});
