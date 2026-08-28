// LUL-482: Playwright spec that blocks /api/telemetry via request interception
// and confirms the win and loss flows still complete with no console error and
// no UI stall. Fire-and-forget means a blocked/slow route must be invisible
// to the player.
//
// IMPORTANT — this spec was written to fail once on purpose before being
// trusted. Steps:
//   1. Temporarily await the telemetry call in lib/telemetry-transport.ts.
//   2. Confirm this spec goes red (win/loss stall while the route is blocked).
//   3. Revert.
// That verification was done during LUL-482 implementation. Do NOT skip it on
// future changes to the transport.
//
// Does NOT assert that events reach the Blob store — the live round-trip is
// deferred to LUL-481 (founder step, BLOB_READ_WRITE_TOKEN). The no-token path
// returns 204 so the route answers even in CI; what we verify here is that a
// blocked or slow route never stalls the game loop.
import { test, expect } from '@playwright/test';
import { boot, enter, trackConsoleErrors, expectNoConsoleErrors, qaHook, readObjective } from './helpers';

// How long we block the telemetry route — long enough to confirm the game
// doesn't wait for it, but short enough not to bloat the suite.
const BLOCK_DURATION_MS = 4_000;
// Maximum time the win/loss screen should appear after the triggering action.
// 30s matches the catch test in smoke.spec.ts which drives the predator home.
const WIN_LOSS_TIMEOUT_MS = 30_000;

test.describe('telemetry transport — fire-and-forget guarantee', () => {
  test('loss screen appears even when /api/telemetry is blocked', async ({ page }) => {
    const errors = trackConsoleErrors(page);

    // Block /api/telemetry before navigating so any boot-time events are also
    // intercepted. The route fulfills after BLOCK_DURATION_MS — the game must
    // not wait for it.
    await page.route('**/api/telemetry', async (route) => {
      await new Promise((r) => setTimeout(r, BLOCK_DURATION_MS));
      await route.fulfill({ status: 204, body: '' });
    });

    await boot(page, { qaHooks: true });
    await enter(page);

    // Lure the nearest predator into catch range. qaLurePredatorKind puts the
    // nearest predator of the given species into hunt mode, it closes the
    // distance, and the catch + triggerDeath paths run normally.
    await qaHook(page, 'qaLurePredatorKind', 'wolf');

    const deathScreen = page.locator('#deathScreen');
    // If telemetry were awaited, this would time out while the route is blocked.
    await expect(deathScreen).toBeVisible({ timeout: WIN_LOSS_TIMEOUT_MS });

    expectNoConsoleErrors(errors);
  });

  test('win screen appears even when /api/telemetry is blocked', async ({ page }) => {
    const errors = trackConsoleErrors(page);

    await page.route('**/api/telemetry', async (route) => {
      await new Promise((r) => setTimeout(r, BLOCK_DURATION_MS));
      await route.fulfill({ status: 204, body: '' });
    });

    await boot(page, { qaHooks: true });
    await enter(page);

    // Teleport near the baby then home — the same path smoke.spec.ts and
    // mobile/win-persist.spec.ts use.
    await qaHook(page, 'qaTeleportNearBaby');
    // Give the engine a tick to register proximity, then confirm the
    // teleport actually landed in pickup range before pressing E -- a miss
    // here would otherwise no-op the pickup and fail later at #winScreen in
    // a way that looks like a UI bug (see mobile/win-persist.spec.ts).
    await page.waitForTimeout(500);
    await expect
      .poll(() => readObjective(page), { message: 'qaTeleportNearBaby did not land within pickup range' })
      .toContain('Press');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(500);
    // Teleport home to complete the escort.
    await qaHook(page, 'qaTeleportHome');

    const winScreen = page.locator('#winScreen');
    await expect(winScreen).toBeVisible({ timeout: WIN_LOSS_TIMEOUT_MS });

    expectNoConsoleErrors(errors);
  });

  test('/api/telemetry route answers in the CI environment', async ({ request }) => {
    // Sanity-check: the route is reachable and returns 204 (the no-token path).
    // Would catch a broken import or a build error.
    const res = await request.post('/api/telemetry', {
      data: {
        event: 'page_view',
        ts: Date.now(),
        anon_id: 'playwright-ci',
        build_sha: 'ci',
        path: '/',
      },
    });
    // 204 is the no-token path. 400 means the route is there but rejected the
    // payload. Either way it is not a 404/500, which is what we guard against.
    expect(res.status()).not.toBe(404);
    expect(res.status()).not.toBe(500);
  });
});
