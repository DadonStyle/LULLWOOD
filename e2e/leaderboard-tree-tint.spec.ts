// LUL-3264 wave 2, S5: flag-tinted trees. The real record flows through the
// stubbed GET /api/leaderboard/current -> components/Leaderboard.tsx's
// useLeaderboardRecord() -> components/Hud.tsx's useLeaderboardSky() (shared
// with the LUL-5820 sky balloon) -> the real actions.setLeaderboardRecord()
// engine action, exactly as in real play. qaSetLeaderboardRecord (a thin
// wrapper calling that same setLeaderboardRecord function) only exists to
// simulate a *second* record change mid-run, since the production hook
// fetches exactly once per mount -- there is no live re-fetch to re-stub.
import { test, expect } from './fixtures';
import { boot, qaHook } from './helpers';

// DE's palette (lib/game/country-palettes.ts) starts with '#000000' -- pure
// black is invariant under the sRGB->linear colour-management conversion
// THREE.Color.set() applies, so the blended result is exact arithmetic
// (lerp toward (0,0,0)) instead of needing to replicate THREE's gamma curve.
const DE_RECORD = { id: 1, nickname: 'flagbearer', country: 'DE', timeMs: 100_000, achievedAt: '2026-10-02T10:00:00.000Z' };
const TINT_WEIGHT = 0.25;
const BASELINE: [number, number, number] = [0.92, 1, 0.86]; // tintCol.setRGB(t.tint*0.92, t.tint, t.tint*0.86) at t.tint=1
const EXPECT_TINTED: [number, number, number] = BASELINE.map((c) => c * (1 - TINT_WEIGHT)) as [number, number, number];

function makeTrees(n: number) {
  return Array.from({ length: n }, (_, i) => ({ x: i * 2 - n, z: 0 }));
}

test.describe('flag-tinted trees', () => {
  test("a subset of trees tint toward the record holder's flag palette, the rest stay untinted", async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { record: DE_RECORD } }));
    await boot(page, { qaHooks: true });
    const built = await qaHook(page, 'qaBuildScene', { trees: makeTrees(40) });
    expect(built.trees).toBe(40);

    const probe = await qaHook(page, 'qaProbeTreeTint');
    expect(probe.totalTrees).toBe(40);
    expect(probe.tintedCount).toBe(5); // every 8th tree, ti=0,8,16,24,32
    expect(probe.sampleTintedColor).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      expect(probe.sampleTintedColor[i]).toBeCloseTo(EXPECT_TINTED[i], 5);
    }
  });

  test('no tree tints when there is no usable record (loading/empty/failed-no-cache)', async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { record: null } }));
    await boot(page, { qaHooks: true });
    await qaHook(page, 'qaBuildScene', { trees: makeTrees(40) });

    const probe = await qaHook(page, 'qaProbeTreeTint');
    expect(probe.totalTrees).toBe(40);
    expect(probe.tintedCount).toBe(0);
    expect(probe.sampleTintedColor).toBeNull();
  });

  test('tree tint clears when the record goes back to empty/failed-no-cache, without a reload', async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { record: DE_RECORD } }));
    await boot(page, { qaHooks: true });
    await qaHook(page, 'qaBuildScene', { trees: makeTrees(40) });
    expect((await qaHook(page, 'qaProbeTreeTint')).tintedCount).toBe(5);

    await qaHook(page, 'qaSetLeaderboardRecord', 'empty', null);
    const probe = await qaHook(page, 'qaProbeTreeTint');
    expect(probe.tintedCount).toBe(0);
    expect(probe.sampleTintedColor).toBeNull();
  });

  test('tree tint re-applies without a reload when a new country overtakes the old record', async ({ page }) => {
    await page.route('**/api/leaderboard/current', (route) => route.fulfill({ json: { record: DE_RECORD } }));
    await boot(page, { qaHooks: true });
    await qaHook(page, 'qaBuildScene', { trees: makeTrees(40) });
    expect((await qaHook(page, 'qaProbeTreeTint')).tintedCount).toBe(5);

    const US_RECORD = { ...DE_RECORD, id: 2, nickname: 'overtaker', country: 'US' };
    await qaHook(page, 'qaSetLeaderboardRecord', 'populated', US_RECORD);
    const probe = await qaHook(page, 'qaProbeTreeTint');
    expect(probe.tintedCount).toBe(5);
    // US's first palette colour ('#B22234') is not pure black, so this sample
    // differs from the DE-tinted value above -- proves a real re-tint ran,
    // not a no-op that left the DE colours in place.
    expect(probe.sampleTintedColor![0]).not.toBeCloseTo(EXPECT_TINTED[0], 5);
  });
});
