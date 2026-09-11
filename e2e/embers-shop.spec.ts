// LUL-2351: store expansion shelf -- SHOP_CATALOG (Deeper Lungs, Quiet Step, Pocket Stones)
// rendered generically by EmbersShop (components/Hud.tsx) and bought via the engine's
// generic purchase(id) action (engine/forest-engine.js). Zero prior coverage of the shop
// UI itself existed before this ticket (e2e/returning-player.spec.ts only exercises the
// boot-time localStorage read, never a live purchase). Seeds a high `lullwood:embers`
// balance via context.addInitScript (same pattern as e2e/returning-player.spec.ts) so every
// item is affordable without a real run's payout; the game never boots to gameplay before
// the assertions that don't need it, so qaWorld: 'micro' (LUL-2377) applies throughout.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

const HIGH_BALANCE_EMBERS = { 'lullwood:embers': JSON.stringify({ balance: 2000, tiers: {} }) };

// Guarded on absence, not an unconditional set: addInitScript re-runs on every navigation,
// including page.reload() -- an unconditional write would stomp a purchase's real persisted
// balance back to the seed value on the reload-persistence test below.
async function seedEmbers(context: import('@playwright/test').BrowserContext, seed: Record<string, string>) {
  await context.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) if (window.localStorage.getItem(k) === null) window.localStorage.setItem(k, v);
  }, seed);
}

// wiki:systems/lul44-diagnosis-and-fix -- real Playwright click()'s hover/stability/hit-test
// actionability polling can time out on HUD buttons under load on this rig; el.click() still
// dispatches a real bubbling DOM click React's delegated handler treats identically, just
// skips Playwright's own polling loop.
async function clickBuyButton(page: import('@playwright/test').Page, id: string) {
  await page.locator(`#${id}`).evaluate((el) => (el as HTMLElement).click());
}

test.describe('embers shop (LUL-2351)', () => {
  test('buying each catalog item updates balance/tier text and fires the purchase cue', async ({ page, context }) => {
    await seedEmbers(context, HIGH_BALANCE_EMBERS);
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await expect(page.locator('#gate')).toBeVisible();

    await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 2000');

    // Deeper Lungs tier 1: 120 embers, 2000 -> 1880.
    await clickBuyButton(page, 'buy-deeperLungs');
    await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 1880');
    await expect(page.locator('#buy-deeperLungs')).toContainText('veil hold 6s');
    let probe = await qaHook(page, 'qaProbeEmbersPurchase');
    expect(probe.purchaseCueCount).toBe(1);

    // Quiet Step tier 1: 150 embers, 1880 -> 1730.
    await clickBuyButton(page, 'buy-quietStep');
    await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 1730');
    probe = await qaHook(page, 'qaProbeEmbersPurchase');
    expect(probe.purchaseCueCount).toBe(2);
    expect(await qaHook(page, 'qaProbeScentLifetime')).toBeCloseTo(14 * 0.8, 5);

    // Pocket Stones single tier: 80 embers, 1730 -> 1650, then maxed.
    await clickBuyButton(page, 'buy-pocketStones');
    await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 1650');
    probe = await qaHook(page, 'qaProbeEmbersPurchase');
    expect(probe.purchaseCueCount).toBe(3);
    await expect(page.locator('#embersShopMaxed-pocketStones')).toContainText('maxed');
    await expect(page.locator('#buy-pocketStones')).toHaveCount(0);

    expectNoConsoleErrors(errs);
  });

  test('a catalog button is disabled below its cost', async ({ page, context }) => {
    await seedEmbers(context, { 'lullwood:embers': JSON.stringify({ balance: 50, tiers: {} }) });
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await expect(page.locator('#buy-deeperLungs')).toBeDisabled(); // costs 120, balance is 50
  });

  test('purchased tiers persist across a reload', async ({ page, context }) => {
    await seedEmbers(context, HIGH_BALANCE_EMBERS);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await clickBuyButton(page, 'buy-quietStep');
    await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 1850');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.ForestEngine));
    await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 1850');
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('lullwood:embers') ?? '{}'));
    expect(stored.tiers.quietStep).toBe(1);
  });

  test('Pocket Stones grants a throwablesReserve and auto-arms heldThrowable on enter()', async ({ page, context }) => {
    await seedEmbers(context, HIGH_BALANCE_EMBERS);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await clickBuyButton(page, 'buy-pocketStones');

    await enter(page);
    const probe = await qaHook(page, 'qaProbeEmbersPurchase');
    // enter() auto-arms one stone from the reserve of POCKET_STONES_RESERVE (2), leaving 1.
    expect(probe.heldThrowable).toBe(true);
    expect(probe.throwablesReserve).toBe(1);
  });
});
