// LUL-2121: mobile half of ../death-sequence.spec.ts -- qaForceDeath/
// qaProbeDeath don't touch player movement or input mode at all (they call
// triggerDeath() directly), so the only real mobile-specific concerns are
// the entry flow (no pointer lock to wait on, see ../mobile/win-persist.spec.ts)
// and running under devices['Pixel 5'] real touch/coarse-pointer emulation.
// Runs under the `mobile` Playwright project (playwright.config.ts).
import { test, expect } from '@playwright/test';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

async function enterMobile(page: import('@playwright/test').Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)
}

const CAUSE_TEXT: Record<'charge' | 'hunt' | 'chase', string> = {
  charge: "you didn't clear its charge in time",
  hunt: 'you went quiet too long, and it came looking',
  chase: 'it ran you down before you could break away',
};

test.describe('death sequence (qaForceDeath / qaProbeDeath, mobile)', () => {
  test('rejected before enter(), accepted after, rejected again once already dead (mobile)', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });

    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(false);
    await expect(page.locator('#deathScreen')).toHaveCount(0);

    await enterMobile(page);

    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });

    expect(await qaHook(page, 'qaForceDeath', 'bear', 'charge')).toBe(false);
    await expect(page.locator('#deathKind')).toHaveText('wolf');
  });

  for (const cause of ['charge', 'hunt', 'chase'] as const) {
    test(`death screen shows the '${cause}' cause text (mobile)`, async ({ page }) => {
      test.setTimeout(30_000);
      await boot(page, { qaHooks: true });
      await enterMobile(page);

      expect(await qaHook(page, 'qaForceDeath', 'wolf', cause)).toBe(true);
      await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('#deathKind')).toHaveText('wolf');
      await expect(page.locator('#deathText p:not(#runRecap)')).toContainText(CAUSE_TEXT[cause]);
    });
  }

  test('the loss reveals between 3.4s and 4.2s of game time (CUT_END), on the deterministic clock (mobile)', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enterMobile(page);

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

  test('first death is unskippable, second death in the same page is skippable, Try again restarts (mobile)', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true });
    await enterMobile(page);

    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
    expect((await qaHook(page, 'qaProbeDeath')).cutsceneSkippable).toBe(false);

    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    expect((await qaHook(page, 'qaProbeDeath')).deathShown).toBe(false);

    await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
    // el.click(), not a real Playwright click -- see ../win-persist.spec.ts /
    // wiki:systems/lul44-diagnosis-and-fix (actionability polling can time out
    // under this rig's load even when the hit-test would pass).
    await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('#deathScreen')).toBeHidden();

    expect(await qaHook(page, 'qaForceDeath', 'bear', 'charge')).toBe(true);
    await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 5_000 });
    expect((await qaHook(page, 'qaProbeDeath')).cutsceneSkippable).toBe(true);

    await page.keyboard.press('Space');
    await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 3_000 });
    await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('#deathScreen')).toBeHidden();
  });
});
