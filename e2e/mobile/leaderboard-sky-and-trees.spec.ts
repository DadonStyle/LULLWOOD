// LUL-5820 mobile half of ../leaderboard-sky-and-trees.spec.ts. Required by the
// engine/React contract (founder rule 2026-09-09, step 4): `setLeaderboardRecord`
// is a new EngineActions key, so its React call site (components/Hud.tsx's
// useLeaderboardSky hook) needs a Playwright spec on desktop AND mobile, same
// as setProgression's ../progression.spec.ts / ../mobile/progression.spec.ts
// twins. The balloon itself is a passive background object with no touch
// interaction -- this only needs to prove the hook -> engine action -> sky
// balloon wiring also runs when MobileControls mounts instead of
// DesktopControls, so it mirrors the desktop file's shape rather than
// duplicating all four states.
import { test, expect } from '../fixtures';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

const RECORD = { id: 7, nickname: 'ranger42', country: 'IL', timeMs: 125_000, achievedAt: '2026-10-02T10:00:00.000Z' };

test('a populated record shows the flag swatch (mobile)', async ({ page }) => {
  await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { record: RECORD } }));
  await boot(page, { qaHooks: true });

  const playerState = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(playerState?.mode).toBe('mobile');

  await expect.poll(async () => qaHook(page, 'qaProbeLeaderboardSky')).toMatchObject({
    visible: true, text: 'ranger42 — 2:05', hasFlag: true,
  });
});

test('a failed fetch with no cache hides the balloon entirely (mobile)', async ({ page }) => {
  await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { unavailable: true } }));
  await boot(page, { qaHooks: true });
  await expect.poll(async () => qaHook(page, 'qaProbeLeaderboardSky')).toMatchObject({
    visible: false, text: '', hasFlag: false,
  });
});
