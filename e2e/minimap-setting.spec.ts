// LUL-4341: reverts LUL-2309's standalone `showMinimap` setting -- the
// leaderboard record (LUL-3264) is Blackout-only, no minimap, no admin mode,
// so the minimap is admin-gated again (its pre-LUL-2309 rule). See
// components/SettingsPanel.tsx / components/GameCanvas.tsx's stylesheet and
// ./admin-mode.spec.ts (which now owns the on/off toggle coverage; this file
// keeps the blackout-preset and stale-key regression coverage).
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

async function seedSettings(context: import('@playwright/test').BrowserContext, settings: Record<string, unknown>) {
  await context.addInitScript((s: Record<string, unknown>) => {
    window.localStorage.setItem('lullwood:settings', JSON.stringify(s));
  }, settings);
}

test.describe('minimap setting', () => {
  test('hidden by default with empty localStorage', async ({ page }) => {
    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeHidden();
  });

  test('shown with adminMode:true', async ({ page, context }) => {
    await seedSettings(context, { adminMode: true });
    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeVisible();
    // confirms admin mode itself is genuinely on, not just a no-op seed
    await expect(page.locator('#pace')).toBeVisible();
  });

  test('a stale showMinimap:true from before LUL-4341 does not resurrect it', async ({ page, context }) => {
    await seedSettings(context, { showMinimap: true });
    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeHidden();
  });

  test('hidden on blackout regardless of admin mode', async ({ page, context }) => {
    await seedSettings(context, { adminMode: true });
    await boot(page, { qaHooks: true });
    await enter(page);
    await expect(page.locator('#minimap')).toBeVisible();

    // Real UI path, not fake state: pick "Blackout" in the actual Settings
    // radio (the same actions.setDifficulty('blackout') call production
    // code makes). setDifficulty() only takes effect on the *next*
    // generateMap() (its own comment), so qaRegenerateMap -- already used
    // for this exact reason by e2e/bog-zone.spec.ts -- forces the real
    // placePredators() (which sets #minimap's inline display for the
    // blackout preset) to run against the new difficulty instead of
    // waiting out a full restart.
    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    await page.getByLabel(/blackout/i).evaluate((el) => (el as HTMLInputElement).click());
    await qaHook(page, 'qaRegenerateMap', 1);
    await expect(page.locator('#minimap')).toBeHidden();
  });

  test('persists across reload', async ({ page, context }) => {
    await seedSettings(context, { adminMode: true });
    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeVisible();

    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeVisible();
  });
});
