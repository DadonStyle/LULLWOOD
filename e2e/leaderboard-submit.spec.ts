// LUL-3264 wave 1, S3: the submit form on the win screen is offered only for
// an eligible run (Blackout, admin mode off, time above the plausibility
// floor), and it posts the engine's real survived time.
//
// A teleport win finishes in well under PLAUSIBILITY_FLOOR_MS (~15.7s), and no
// QA hook advances the run clock, so the eligible-path tests wait the floor
// out in real time before winning (THREE.Clock is wall-clock based).
//
// Server-timed run sessions: the form needs a run id that /api/run/start gave
// when the run began and /api/run/finish confirmed at the lift. The e2e server
// has no leaderboard service, so the eligible path mocks both routes (the
// clock check itself is unit-tested in services/leaderboard-db/ and
// app/api/run/route.test.ts); unmocked, the start fails and the win screen says
// the run couldn't be timed.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';
import { formatDuration } from '../lib/ui/format-duration';

const FLOOR_WAIT_MS = 16_500;
const RUN_ID = '0123456789abcdef0123456789abcdef';

const click = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => (el as HTMLElement).click());

/** Mocks the two run-session routes; returns what the page sent to them, in order. */
async function mockRunSession(page: import('@playwright/test').Page) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/run/start', async (route) => {
    calls.push({ path: '/api/run/start', body: route.request().postDataJSON() });
    await route.fulfill({ status: 201, json: { run_id: RUN_ID } });
  });
  await page.route('**/api/run/finish', async (route) => {
    calls.push({ path: '/api/run/finish', body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  return calls;
}

// The real applied-settings path (SettingsPanel.tsx's mount effect calls
// actions.setDifficulty() from this key, same seeding as e2e/embers-shop.spec.ts).
// setDifficulty() only takes effect on the next generateMap(), so the map is
// regenerated before entering -- same reason as e2e/minimap-setting.spec.ts.
async function seedSettings(context: import('@playwright/test').BrowserContext, settings: Record<string, unknown>) {
  await context.addInitScript((s: Record<string, unknown>) => {
    window.localStorage.setItem('lullwood:settings', JSON.stringify(s));
  }, settings);
}

async function bootBlackout(page: import('@playwright/test').Page) {
  await boot(page, { qaHooks: true });
  await qaHook(page, 'qaRegenerateMap', 1);
  await enter(page);
}

async function win(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
}

test.describe('leaderboard submit form', () => {
  test('appears on an eligible blackout win and posts the real survived time', async ({ page, context }) => {
    test.setTimeout(120_000);
    let posted: Record<string, unknown> | null = null;
    await page.route('**/api/leaderboard', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posted = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { isRecord: true } });
    });
    let currentFetches = 0;
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/leaderboard/current') currentFetches++;
    });
    const runCalls = await mockRunSession(page);
    await seedSettings(context, { difficulty: 'blackout' });
    await bootBlackout(page);
    await page.waitForTimeout(FLOOR_WAIT_MS);
    await win(page);
    // The run started a session and reported the lift, both with the same run id.
    expect(runCalls.map((c) => c.path)).toEqual(['/api/run/start', '/api/run/finish']);
    expect(runCalls[0].body.difficulty).toBe('blackout');
    expect(runCalls[1].body.run_id).toBe(RUN_ID);

    const form = page.locator('#leaderboardForm');
    await expect(form).toBeVisible();
    // Letters only: spaces, digits and punctuation are dropped as you type.
    await page.locator('#leaderboardNickname').fill('Ranger 42!');
    await expect(page.locator('#leaderboardNickname')).toHaveValue('ranger');
    // The restart button's delayed auto-focus must not steal focus mid-typing.
    await page.waitForTimeout(2_500);
    await expect(page.locator('#leaderboardNickname')).toBeFocused();
    await expect(page.locator('#leaderboardCountry option[value="IL"]')).toHaveText('Israel');
    await page.locator('#leaderboardCountry').selectOption('IL');
    const fetchesBeforeSubmit = currentFetches;
    await page.locator('#leaderboardForm button[type="submit"]').click();
    await expect(page.locator('#leaderboardSubmitted')).toHaveText(/New record! ranger\b/);
    // A new record refetches the top rescuer, so the line and sky balloon show it.
    await expect.poll(() => currentFetches).toBe(fetchesBeforeSubmit + 1);

    expect(posted).not.toBeNull();
    const body = posted as unknown as { nickname: string; country: string; time_ms: number; website: string; run_id: string };
    expect(body.run_id).toBe(RUN_ID);
    expect(body.nickname).toBe('ranger');
    expect(body.country).toBe('IL');
    expect(body.website).toBe('');
    expect(Number.isInteger(body.time_ms)).toBe(true);
    expect(body.time_ms).toBeGreaterThanOrEqual(15_713);
    // Same number RunRecap shows (m:ss of state.survivedSeconds), not a second timer.
    const recap = (await page.locator('#runRecap').textContent()) ?? '';
    const [, m, s] = /time survived: (\d+):(\d{2})/.exec(recap)!;
    expect(Math.abs(body.time_ms / 1000 - (Number(m) * 60 + Number(s)))).toBeLessThanOrEqual(1);
    // The top-right timer, the recap and the stored time (what the sky balloon
    // will show) all read the same m:ss.
    const timerText = await page.locator('#runTimer').textContent();
    expect(timerText).toBe(`${m}:${s}`);
    expect(formatDuration(body.time_ms / 1000)).toBe(timerText);
  });

  test('a blackout run paused at any point gets the paused note, not the form', async ({ page, context }) => {
    test.setTimeout(120_000);
    await mockRunSession(page);
    await seedSettings(context, { difficulty: 'blackout' });
    await bootBlackout(page);
    // Pause and resume through the game menu (same path as e2e/pause-run-timer.spec.ts).
    await click(page.getByTestId('menuToggle'));
    await click(page.getByTestId('menuPause'));
    await expect(page.locator('#pausePrompt')).toBeVisible();
    await click(page.getByTestId('menuToggle'));
    await click(page.getByTestId('menuPause'));
    await expect(page.locator('#pausePrompt')).toBeHidden();
    expect((await qaHook(page, 'qaProbeRunClock')).pausedThisRun).toBe(true);
    await page.waitForTimeout(FLOOR_WAIT_MS);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
    await expect(page.locator('#leaderboardPausedNote')).toHaveText("Paused runs can't be counted as the top rescuer.");
  });

  test('a blackout run the server could not time (start failed) gets the untimed note, not the form', async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.route('**/api/run/start', (route) => route.fulfill({ status: 503, json: { error: 'run timing unavailable' } }));
    await seedSettings(context, { difficulty: 'blackout' });
    await bootBlackout(page);
    const probe = await qaHook(page, 'qaProbeRunClock');
    expect(probe.pausedThisRun).toBe(false);
    expect(probe.runSerial).toBeGreaterThan(0);
    await page.waitForTimeout(FLOOR_WAIT_MS);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
    await expect(page.locator('#leaderboardUntimedNote')).toHaveText("The server couldn't time this run, so it can't be counted as the top rescuer.");
  });

  test('is absent on a lantern win', async ({ page, context }) => {
    // LUL-5953 flipped the default difficulty night->blackout; this test needs
    // a non-blackout run to exercise the ineligible-note path (same pinning
    // LUL-5965 already applied to the other specs this flip broke).
    await seedSettings(context, { difficulty: 'night' });
    await boot(page, { qaHooks: true });
    await enter(page);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
    await expect(page.locator('#leaderboardIneligibleNote')).toHaveText('Switch to Blackout to compete for the leaderboard.');
  });

  test('admin mode suppresses it even on an eligible blackout win', async ({ page, context }) => {
    test.setTimeout(120_000);
    await seedSettings(context, { difficulty: 'blackout', adminMode: true });
    await bootBlackout(page);
    await page.waitForTimeout(FLOOR_WAIT_MS);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
    await expect(page.locator('#leaderboardIneligibleNote')).toHaveCount(0);
  });

  test('a blackout win under the plausibility floor gets no form', async ({ page, context }) => {
    await seedSettings(context, { difficulty: 'blackout' });
    await bootBlackout(page);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
    await expect(page.locator('#leaderboardIneligibleNote')).toHaveCount(0);
  });
});
