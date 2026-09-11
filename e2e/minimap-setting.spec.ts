// LUL-2309: the minimap got its own `showMinimap` setting, decoupled from
// admin mode -- LUL-2248 turned it into a player-facing navigation aid (home
// ring + beacon colours), not a dev tool, so it needs a player-visible toggle
// rather than riding along with admin mode's dev HUD. See
// components/SettingsPanel.tsx / components/GameCanvas.tsx's stylesheet and
// ../e2e/admin-mode.spec.ts (which used to own this coverage).
//
// Default is OFF, same falsy idiom as adminMode/highContrast -- a
// never-persisted key must read as OFF, including before SettingsPanel's
// effect has run on first paint (components/GameCanvas.tsx's
// `body:not([data-show-minimap="1"])` selector covers that gap).
import { test, expect } from '@playwright/test';
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

  test('hidden with adminMode:true alone (admin mode no longer shows it)', async ({ page, context }) => {
    await seedSettings(context, { adminMode: true });
    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeHidden();
    // confirms admin mode itself is genuinely on, not just a no-op seed
    await expect(page.locator('#pace')).toBeVisible();
  });

  test('shown with showMinimap:true', async ({ page, context }) => {
    await seedSettings(context, { showMinimap: true });
    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeVisible();
  });

  test('hidden on blackout regardless of the setting', async ({ page, context }) => {
    await seedSettings(context, { showMinimap: true });
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
    await seedSettings(context, { showMinimap: true });
    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeVisible();

    await boot(page);
    await enter(page);
    await expect(page.locator('#minimap')).toBeVisible();
  });
});
