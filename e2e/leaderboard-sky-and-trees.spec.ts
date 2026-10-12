// LUL-5820 (LUL-3264 wave 2, S4): sky balloon record-holder display. Shared
// file name with S5 (flag-tinted trees, a separate ticket) per
// docs/specs/lul-3264-leaderboard-wave2.md's "## e2e" section -- S5's cases
// land here once that ticket ships. Micro world (boot()'s default): this is
// a passive background object with no opposing system to stage, same
// reasoning as e2e/sky-compass.spec.ts.
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';
import { SKY_BALLOON_ANGLE_DEG } from '../lib/game/skyBalloon';

const RECORD = { id: 7, nickname: 'ranger42', country: 'IL', timeMs: 125_000, achievedAt: '2026-10-02T10:00:00.000Z' };

test.describe('sky balloon record-holder display', () => {
  test('shows the loading/empty/populated text and hides on failed-no-cache', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/api/leaderboard/current', async (route) => {
      await gate;
      await route.fulfill({ json: { record: null } });
    });
    const booting = boot(page, { qaHooks: true });
    // boot() waits for network idle, which the held response blocks -- loading
    // is asserted while boot is still in flight, same technique as
    // e2e/leaderboard-menu.spec.ts's #leaderboardLine loading-state case. Unlike
    // that spec's locator-based assertion (auto-retrying, navigation-safe),
    // qaHook() is a raw page.evaluate() -- issuing one before window.ForestEngine
    // actually exists throws "Execution context was destroyed, most likely
    // because of a navigation" (if too early, racing the real navigation) or a
    // plain "qaProbeLeaderboardSky missing" error (if the navigation landed but
    // init() hasn't run yet), and expect.poll() does not retry past either --
    // it only retries a *returned* value that doesn't match, not a throw
    // (LUL-5980). boot() can't be awaited first (that's the whole point here --
    // it has to stay in flight so the held fetch can be released below), and
    // boot()'s own internal "ForestEngine exists" check runs only *after* its
    // page.goto() resolves, which itself won't resolve until that same held
    // fetch goes quiet -- so this spec has to wait for the hook directly rather
    // than piggyback on any part of boot()'s sequencing. waitForFunction (like
    // waitForSelector/waitForURL, unlike a raw evaluate) survives the
    // in-between navigation and re-polls in the new document.
    await page.waitForFunction(() => Boolean((window as any).ForestEngine?.qaProbeLeaderboardSky), { timeout: 60_000 });
    await expect.poll(async () => (await qaHook(page, 'qaProbeLeaderboardSky')).text, { timeout: 60_000 })
      .toBe('loading top rescuer');
    release();
    await booting;
    await expect.poll(async () => (await qaHook(page, 'qaProbeLeaderboardSky'))).toMatchObject({
      visible: true, text: 'be the first — --:--', hasFlag: false,
    });
  });

  test('a populated record shows the flag swatch', async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { record: RECORD } }));
    await boot(page, { qaHooks: true });
    await expect.poll(async () => qaHook(page, 'qaProbeLeaderboardSky')).toMatchObject({
      visible: true, text: 'ranger42 — 2:05', hasFlag: true,
    });
  });

  test('a failed fetch with no cache hides the balloon entirely', async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { unavailable: true } }));
    await boot(page, { qaHooks: true });
    await expect.poll(async () => qaHook(page, 'qaProbeLeaderboardSky')).toMatchObject({
      visible: false, text: '', hasFlag: false,
    });
  });

  test('a failed fetch with a cached record renders exactly as populated', async ({ page, context }) => {
    await context.addInitScript(([k, rec]) => {
      window.localStorage.setItem(k as string, JSON.stringify({ record: rec, storedAt: Date.now() }));
    }, ['lullwood:leaderboard:current', RECORD] as const);
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { unavailable: true } }));
    await boot(page, { qaHooks: true });
    await expect.poll(async () => qaHook(page, 'qaProbeLeaderboardSky')).toMatchObject({
      visible: true, text: 'ranger42 — 2:05', hasFlag: true,
    });
  });

  // Regression guard on the angle constant, not a pixel check (the spec's own
  // wording) -- a future edit that zeroed it out would put the balloon
  // directly on top of the sun/moon disc every time.
  test('the billboard offset angle is non-zero', () => {
    expect(SKY_BALLOON_ANGLE_DEG).not.toBe(0);
  });
});
