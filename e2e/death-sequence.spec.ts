// LUL-2121: e2e coverage for the qaForceDeath/qaProbeDeath hooks the local QA
// tester needs to drive the LOSE sequence deterministically every night
// (shared/local-qa/QA_TESTER.md, CHECKS.md's death-cutscene check). Unlike
// qaTriggerDeath (LUL-2169, e2e/death-persist.spec.ts), qaForceDeath validates
// kind/cause and reports whether the call itself landed a fresh death, so
// this spec also covers the rejection paths and the reveal-timing/skip
// contract that qaProbeDeath exposes.
//
// qaForceDeath's return contract deliberately deviates from the ticket's
// illustrative `triggerDeath(kind,cause); return dead;` snippet -- see the
// comment on qaForceDeath in engine/forest-engine.js for why a plain `dead`
// read can't distinguish "already dead, rejected" from "this call worked".
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const CAUSE_TEXT: Record<'charge' | 'hunt' | 'chase', string> = {
  charge: "you didn't clear its charge in time",
  hunt: 'you went quiet too long, and it came looking',
  chase: 'it ran you down before you could break away',
};

test.describe('death sequence (qaForceDeath / qaProbeDeath)', () => {
  test('rejected before enter(), accepted after, rejected again once already dead', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });

    // Before enter(): no live run to kill yet.
    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(false);
    await expect(page.locator('#deathScreen')).toHaveCount(0);

    await enter(page);

    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });

    // Already dead -- rejected, and the original kind/cause must survive untouched.
    expect(await qaHook(page, 'qaForceDeath', 'bear', 'charge')).toBe(false);
    await expect(page.locator('#deathKind')).toHaveText('wolf');
  });

  test('invalid kind/cause return null and trigger nothing', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    expect(await qaHook(page, 'qaForceDeath', 'deer', 'hunt')).toBeNull();
    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'nope')).toBeNull();
    await expect(page.locator('#deathScreen')).toHaveCount(0);
  });

  for (const cause of ['charge', 'hunt', 'chase'] as const) {
    test(`death screen shows the '${cause}' cause text`, async ({ page }) => {
      test.setTimeout(30_000);
      await boot(page, { qaHooks: true });
      await enter(page);

      expect(await qaHook(page, 'qaForceDeath', 'wolf', cause)).toBe(true);
      await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('#deathKind')).toHaveText('wolf');
      // LUL-2558: #deathCauseText is the cause-text <p>'s own id -- a
      // `p:not(#runRecap)` count no longer isolates it now that RunRecap
      // renders more than one <p> inside #runRecap (personal-best/tier-stats).
      await expect(page.locator('#deathCauseText')).toContainText(CAUSE_TEXT[cause]);
    });
  }

  test('the loss reveals between 3.4s and 4.2s of game time (CUT_END), on the deterministic clock', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    await page.evaluate(() => window.ForestEngine!.qaSetFixedStep!(0.05));
    expect(await qaHook(page, 'qaForceDeath', 'lion', 'chase')).toBe(true);
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });

    let revealedAt: number | null = null;
    for (let i = 0; i < 120 && revealedAt === null; i++) {
      await page.evaluate(() => window.ForestEngine!.qaAdvance!(1));
      const probe = await qaHook(page, 'qaProbeDeath');
      if (probe.deathShown) revealedAt = probe.sinceDeath;
    }

    expect(revealedAt, 'qaProbeDeath().deathShown never flipped').not.toBeNull();
    expect(revealedAt as number).toBeGreaterThanOrEqual(3.4);
    expect(revealedAt as number).toBeLessThanOrEqual(4.2);
  });

  test('first death is unskippable, second death in the same page is skippable, Try again restarts', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
    expect((await qaHook(page, 'qaProbeDeath')).cutsceneSkippable).toBe(false);

    // An input in flight during the unskippable cutscene must not reveal early.
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    expect((await qaHook(page, 'qaProbeDeath')).deathShown).toBe(false);

    await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
    await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('#deathScreen')).toBeHidden();

    // Second death, same page: skippable immediately (LUL-1194).
    expect(await qaHook(page, 'qaForceDeath', 'bear', 'charge')).toBe(true);
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
    expect((await qaHook(page, 'qaProbeDeath')).cutsceneSkippable).toBe(true);

    await page.keyboard.press('Space');
    await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 3_000 });
    await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('#deathScreen')).toBeHidden();
  });

  // LUL-2461: distanceFromHomeAtDeathM feeds the same-name loss telemetry field
  // the Economist's LUL-1413 blackout-pricing model reads -- assert the engine
  // actually computes distance-from-home at the moment of death, not some other
  // point (e.g. maxDistFromHome, the run's furthest point).
  test('qaProbeDeath().distanceFromHomeAtDeathM is null before death, then the home distance at the death spot', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    expect((await qaHook(page, 'qaProbeDeath')).distanceFromHomeAtDeathM).toBeNull();

    await page.evaluate(() => window.ForestEngine!.qaTeleportTo!(30, 40));
    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });

    // CONFIG.home is the origin (engine/tuning.js) -- hypot(30, 40) = 50.
    expect((await qaHook(page, 'qaProbeDeath')).distanceFromHomeAtDeathM).toBe(50);
  });
});
