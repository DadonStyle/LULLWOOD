// LUL-5298/LUL-5332: restart() previously only reset inLogCrawl/logCrawlDirX/Z/
// logCrawlExitX/Z/logCrawlDeniedLatch (LUL-4527) at module load, never on an
// actual restart -- so a death (or win) that landed mid-crawl carried that
// stale state into the next round. triggerDeath() itself never touches these
// fields (see triggerDeath() in engine/forest-engine.js), so the state
// survives straight through the death screen into restart(). LUL-5187's
// "frozen player after restart" traced to exactly this: stepFrame()'s
// `if(inLogCrawl)` branch stayed true and forced every WASD input toward the
// OLD map's now-invalid logCrawlExitX/Z instead of the player's real input,
// once the map had already regenerated underneath it.
//
// Code Reviewer's PR#912 CHANGES-REQUESTED (LUL-5332) named the exact tools
// already on this branch to cover this with no new hook: qaBuildScene/
// qaTeleportTo, qaTriggerDeath, the `.restartBtn` click idiom (death-sequence.
// spec.ts), and qaPlayerState() (already returns inLogCrawl/logCrawlExitX/Z,
// per its own LUL-275 comment).
//
// restart() also resets brambleSnagT (LUL-4526) in the same diff -- not
// covered here. Live-verified that fix works, but brambleSnagT decays over a
// real-time BRAMBLE_SNAG_DURATION_S=0.3s window (engine/tuning.js) with no
// fixed-step hook for the sprint-dive-into-bramble trigger path, so a
// keyboard-event-driven assertion on it races real wall-clock time and was
// observed flaky (0/4 on a loaded box) independent of the fix being correct.
// Not worth adding flake to the suite for a P2 the reviewer didn't block on.
//
// Log geometry re-derived the same way e2e/log-crawl.spec.ts documents its
// own numbers: log at x=10,z=0,ry=0 -> hx=1.85, mouths at x=8.15 (entry) and
// x=11.85 (exit). Player starts at x=6.15 (2.0u short of the entry mouth,
// outside LOG_CRAWL_ENTER_RADIUS=1.2) facing +x (default yaw=0 -> KeyD moves +x).
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function restartViaDeathScreen(page: import('@playwright/test').Page) {
  await qaHook(page, 'qaTriggerDeath', 'wolf', 'chase');
  await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
  // First death in a fresh boot is unskippable (LUL-1194) -- Space is harmless
  // no-op either way, same idiom as e2e/death-sequence.spec.ts.
  await page.keyboard.press('Space');
  await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
  await expect(page.locator('.restartBtn')).toBeEnabled();
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#deathScreen')).toBeHidden();
}

test('restart resets log-crawl state after a death lands mid-crawl (LUL-5187)', async ({ page }) => {
  test.setTimeout(30_000);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await enter(page);

  await qaHook(page, 'qaBuildScene', {
    props: [{ kind: 'log', x: 10, z: 0, ry: 0 }],   // hx=1.85 -> mouths at x=8.15 and x=11.85
    predators: [{ kind: 'wolf', x: 9999, z: 9999, state: 'roam' }],
  });
  await qaHook(page, 'qaTeleportTo', 6.15, 0);   // 2.0u short of the entry mouth, facing +x by default
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  await page.keyboard.down('KeyD');
  await qaHook(page, 'qaAdvance', stepsFor(0.3));   // closes the gap and crosses LOG_CRAWL_ENTER_RADIUS
  await page.keyboard.up('KeyD');

  let ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'sanity: should be mid-crawl before dying').toBe(true);
  expect(ps?.logCrawlExitX ?? 0, 'sanity: exit mouth should already be latched').not.toBe(0);

  await restartViaDeathScreen(page);

  ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'restart() must clear inLogCrawl, or the next round forces all input through the stale crawl branch').toBe(false);
  expect(ps?.logCrawlExitX, 'restart() must clear logCrawlExitX -- a stale OLD-map coordinate here is what froze movement in LUL-5187').toBe(0);
  expect(ps?.logCrawlExitZ, 'restart() must clear logCrawlExitZ, same stale-coordinate class as logCrawlExitX').toBe(0);
});
