// LUL-2351: mobile half of ../embers-shop.spec.ts -- the shop buttons are plain HTML
// buttons (no touch-specific EngineActions call, unlike touchInteract/touchThrow), so a
// regular `.click()` exercises the same purchase(id) path under touch emulation. Landscape
// viewport override (LUL-69) clears OrientationGate, same convention as the other mobile
// specs that don't test orientation itself.
import { test, expect } from '@playwright/test';
import { boot, qaHook, trackConsoleErrors, expectNoConsoleErrors } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

async function enterMobile(page: import('@playwright/test').Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)
}

// Guarded on absence, not an unconditional set: addInitScript re-runs on every navigation --
// see ../embers-shop.spec.ts's identical helper for why this matters if a reload test is
// ever added here too.
async function seedEmbers(context: import('@playwright/test').BrowserContext, seed: Record<string, string>) {
  await context.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) if (window.localStorage.getItem(k) === null) window.localStorage.setItem(k, v);
  }, seed);
}

// wiki:systems/lul44-diagnosis-and-fix -- real Playwright tap()/click()'s actionability
// polling can time out on HUD buttons under load; el.click() dispatches a real bubbling
// DOM click React's delegated handler treats identically, just skips that polling loop.
async function clickBuyButton(page: import('@playwright/test').Page, id: string) {
  await page.locator(`#${id}`).evaluate((el) => (el as HTMLElement).click());
}

const HIGH_BALANCE_EMBERS = { 'lullwood:embers': JSON.stringify({ balance: 2000, tiers: {} }) };

test('buying each catalog item updates balance/tier text and fires the purchase cue (mobile)', async ({ page, context }) => {
  await seedEmbers(context, HIGH_BALANCE_EMBERS);
  const errs = trackConsoleErrors(page);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  // LUL-2539: this test asserts an exact base scentLifetime below -- force wind off so the
  // new 50/50 windHighSpeed roll can't make it flaky.
  await qaHook(page, 'qaSetWindHighSpeed', false);
  await expect(page.locator('#gate')).toBeVisible();

  await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 2000');

  await clickBuyButton(page, 'buy-deeperLungs');
  await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 1880');
  let probe = await qaHook(page, 'qaProbeEmbersPurchase');
  expect(probe.purchaseCueCount).toBe(1);

  await clickBuyButton(page, 'buy-quietStep');
  await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 1730');
  expect(await qaHook(page, 'qaProbeScentLifetime')).toBeCloseTo(14 * 0.8, 5);

  await clickBuyButton(page, 'buy-pocketStones');
  await expect(page.locator('#embersShopBalance')).toHaveText('Embers: 1650');
  probe = await qaHook(page, 'qaProbeEmbersPurchase');
  expect(probe.purchaseCueCount).toBe(3);
  await expect(page.locator('#embersShopMaxed-pocketStones')).toContainText('maxed');

  expectNoConsoleErrors(errs);
});

test('a catalog button is disabled below its cost (mobile)', async ({ page, context }) => {
  await seedEmbers(context, { 'lullwood:embers': JSON.stringify({ balance: 50, tiers: {} }) });
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await expect(page.locator('#buy-deeperLungs')).toBeDisabled();
});

test('Pocket Stones grants a throwablesReserve and auto-arms heldThrowable on enter() (mobile)', async ({ page, context }) => {
  await seedEmbers(context, HIGH_BALANCE_EMBERS);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await clickBuyButton(page, 'buy-pocketStones');

  await enterMobile(page);
  const probe = await qaHook(page, 'qaProbeEmbersPurchase');
  expect(probe.heldThrowable).toBe(true);
  expect(probe.throwablesReserve).toBe(1);
});
