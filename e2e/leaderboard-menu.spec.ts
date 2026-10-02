// LUL-3264 wave 1, S3: the #leaderboardLine state machine on #gate. The real
// GET /api/leaderboard/current is stubbed with page.route so each state is
// reached deterministically; the component, cache and copy are the real ones.
import { test, expect } from './fixtures';
import { boot } from './helpers';

const RECORD = { id: 7, nickname: 'ranger42', country: 'IL', timeMs: 125_000, achievedAt: '2026-10-02T10:00:00.000Z' };
const CACHE_KEY = 'lullwood:leaderboard:current';

test.describe('leaderboard menu line', () => {
  test('shows loading, then the empty state, without a reload', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/api/leaderboard/current', async (route) => {
      await gate;
      await route.fulfill({ json: { record: null } });
    });
    // boot() waits for network idle, which the held response blocks -- so the
    // loading state is asserted while boot is still in flight, then released.
    const booting = boot(page);
    await expect(page.locator('#leaderboardLine')).toHaveText('Loading top rescuer…', { timeout: 60_000 });
    release();
    await booting;
    await expect(page.locator('#leaderboardLine')).toHaveText('No rescuer yet — be the first.');
  });

  test('shows the record holder and caches it', async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { record: RECORD } }));
    await boot(page);
    await expect(page.locator('#leaderboardLine')).toHaveText('ranger42 is the top rescuer at 2:05 — can you beat it?');
    const cached = await page.evaluate((k) => window.localStorage.getItem(k), CACHE_KEY);
    expect(JSON.parse(cached!).record.nickname).toBe('ranger42');
  });

  test('on a failed fetch, shows a fresh cached record', async ({ page, context }) => {
    await context.addInitScript(([k, rec]) => {
      window.localStorage.setItem(k as string, JSON.stringify({ record: rec, storedAt: Date.now() }));
    }, [CACHE_KEY, RECORD] as const);
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { unavailable: true } }));
    await boot(page);
    await expect(page.locator('#leaderboardLine')).toHaveText(/ranger42 is the top rescuer/);
    await expect(page.locator('#leaderboardLine')).toHaveAttribute('data-state', 'failed');
  });

  test('on a failed fetch with no cache, the line is hidden entirely', async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { unavailable: true } }));
    let answered = false;
    page.on('response', (r) => { if (r.url().includes('/api/leaderboard/current')) answered = true; });
    await boot(page); // waits for network idle, so the fetch has settled
    expect(answered).toBe(true);
    await expect(page.locator('#leaderboardLine')).toHaveCount(0);
  });

  test('a tampered cache entry is discarded, not rendered (B8)', async ({ page, context }) => {
    await context.addInitScript((k) => {
      window.localStorage.setItem(k, JSON.stringify({ record: { id: 1, nickname: '<img src=x onerror=alert(1)>', country: 'IL', timeMs: 99_000, achievedAt: '2026-10-02T10:00:00.000Z' }, storedAt: Date.now() }));
    }, CACHE_KEY);
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { unavailable: true } }));
    await boot(page); // waits for network idle, so the fetch has settled
    await expect(page.locator('#leaderboardLine')).toHaveCount(0);
  });
});
