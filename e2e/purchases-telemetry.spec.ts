// LUL-3003: wires the LUL-2998 schema (lib/analytics.ts's PurchaseRecord + the
// `started_tiers` event) to real engine state. Two things to prove:
//   1. engine/forest-engine.js's purchasesMade accumulator (purchase() pushes to it,
//      enter() resets it) via the qaProbePurchasesMade hook.
//   2. the real network payload -- started_tiers actually posts embers.tiers at
//      game_start, and win/loss actually carries a purchases_made array -- via
//      /api/telemetry request interception, same technique as
//      e2e/telemetry-transport.spec.ts.
//
// EmbersShop (components/Hud.tsx) only renders pre-entry (`#gate`) or on the
// win/death screens -- never while `entered && !winVisible && !deathVisible`. So a
// purchase always lands either before enter() or after this run's win/loss track()
// call, and purchasesMade is reset in enter() before the next started_tiers/game_start
// fires. That means purchases_made is legitimately `[]` on every event today -- not a
// bug, it's exactly the gap docs/TELEMETRY_SCHEMA.md's started_tiers section says it
// covers via a before/after tiers diff instead. Test 1 below exercises that gap
// directly: a gate purchase shows up in `tiers` but not in the next run's
// purchasesMade.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, readObjective } from './helpers';

const HIGH_BALANCE_EMBERS = { 'lullwood:embers': JSON.stringify({ balance: 2000, tiers: {} }) };

async function seedEmbers(context: import('@playwright/test').BrowserContext, seed: Record<string, string>) {
  await context.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) if (window.localStorage.getItem(k) === null) window.localStorage.setItem(k, v);
  }, seed);
}

// wiki:systems/lul44-diagnosis-and-fix -- see embers-shop.spec.ts for why this is
// el.click() and not Playwright's own .click().
async function clickBuyButton(page: import('@playwright/test').Page, id: string) {
  await page.locator(`#${id}`).evaluate((el) => (el as HTMLElement).click());
}

test.describe('purchases_made + started_tiers telemetry (LUL-3003)', () => {
  test('purchasesMade accumulates a gate purchase, then enter() resets it while tiers persists', async ({ page, context }) => {
    await seedEmbers(context, HIGH_BALANCE_EMBERS);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await expect(page.locator('#gate')).toBeVisible();

    expect(await qaHook(page, 'qaProbePurchasesMade')).toEqual({ purchasesMade: [], tiers: {} });

    // Deeper Lungs tier 1: 120 embers (same catalog price embers-shop.spec.ts asserts).
    await clickBuyButton(page, 'buy-deeperLungs');
    expect(await qaHook(page, 'qaProbePurchasesMade')).toEqual({
      purchasesMade: [{ id: 'deeperLungs', tier: 1, cost: 120 }],
      tiers: { deeperLungs: 1 },
    });

    // enter() resets the per-run accumulator -- the gate purchase is not "during"
    // the run it precedes -- but embers.tiers (cross-run) keeps the purchase.
    await enter(page);
    expect(await qaHook(page, 'qaProbePurchasesMade')).toEqual({ purchasesMade: [], tiers: { deeperLungs: 1 } });
  });

  test('started_tiers posts the pre-run tiers snapshot and win carries a purchases_made array', async ({ page, context }) => {
    // Tiers already owned from a prior session (no balance to spend this run --
    // keeps this test to one purchase-free run, decoupled from the gate-purchase
    // case above).
    await seedEmbers(context, { 'lullwood:embers': JSON.stringify({ balance: 0, tiers: { quietStep: 1 } }) });

    const telemetryEvents: Array<Record<string, unknown>> = [];
    await page.route('**/api/telemetry', async (route) => {
      try {
        telemetryEvents.push(JSON.parse(route.request().postData() ?? '{}'));
      } catch {
        // malformed body would fail the assertions below anyway
      }
      await route.fulfill({ status: 204, body: '' });
    });

    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    await expect
      .poll(() => telemetryEvents.some((e) => e.event === 'started_tiers'), {
        message: 'no started_tiers event posted to /api/telemetry',
      })
      .toBe(true);
    const startedTiers = telemetryEvents.find((e) => e.event === 'started_tiers');
    expect(startedTiers?.tiers).toEqual({ quietStep: 1 });

    // Fastest deterministic win in the suite: teleport next to the child, pick up,
    // let the ascend/explode cinematic finish (LUL-2281 -- no carry-home leg).
    await qaHook(page, 'qaTeleportNearBaby');
    await page.waitForTimeout(300);
    await expect
      .poll(() => readObjective(page), { message: 'qaTeleportNearBaby did not land within pickup range' })
      .toContain('Press');
    await page.keyboard.press('KeyE');
    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(() => telemetryEvents.some((e) => e.event === 'win'), {
        message: 'no win event posted to /api/telemetry',
      })
      .toBe(true);
    const win = telemetryEvents.find((e) => e.event === 'win');
    // No shop purchase happened this run (EmbersShop isn't reachable mid-run) --
    // present-and-empty, per lib/analytics.ts's "never throw on absence" contract,
    // is the correct shape, not a placeholder.
    expect(win?.purchases_made).toEqual([]);
  });
});
