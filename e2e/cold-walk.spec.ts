// LUL-4960: M5 Cold Walk -- an opt-in, per-run constraint: sprint even once before
// pickup() is accepted and the win-only COLD_WALK_REWARD bonus is forfeited for the rest
// of the run. Opt-in lives in SettingsPanel (persisted `lullwood:settings`), not the
// one-time #gate screen (see docs/specs/lul-4960-cold-walk.md's Design call for why).
//
// No new qaXxx hook -- opt-in goes through the real SettingsPanel -> localStorage ->
// apply-on-ready path (seedSettings(), mirrors e2e/minimap-setting.spec.ts), and the
// constraint itself is driven by the real sprint key (Shift), not a forced flag
// (Feature Checklist Q1.5/Q11). Existing hook reused: qaTeleportNearBaby.
//
// #coldWalkPanel follows the same `if(playing){...} else {coldWalkActive:false,...}`
// per-frame push every other status panel (#missionPanel, #caveImmunePanel,
// #rockClimbPanel) uses in engine/forest-engine.js -- `playing` excludes `pickingUp`, so
// the panel hides the instant pickup() is accepted, same as #missionPanel does
// (e2e/mission-slack-water.spec.ts's identical documented precedent). That means the
// "sprinting after pickup does not break Cold Walk" scenario can't be proven by reading
// the panel's text mid-cinematic (it's not in the DOM then) -- it's proven the same way
// e2e/mission-slack-water.spec.ts proves a forfeited/earned mission bonus: from the
// win-screen payout gap.
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';
import { COLD_WALK_REWARD } from '../lib/game/economy';

async function seedSettings(context: import('@playwright/test').BrowserContext, settings: Record<string, unknown>) {
  await context.addInitScript((s: Record<string, unknown>) => {
    window.localStorage.setItem('lullwood:settings', JSON.stringify(s));
  }, settings);
}

// Same technique as e2e/mission-slack-water.spec.ts's payoutGap(): the invariant
// depth+survival+carried+rescue+spent===total holds only when no bonus was paid, so the
// gap from that identity is exactly the bonus that landed.
async function payoutGap(page: import('@playwright/test').Page): Promise<number> {
  const recap = await page.locator('#runRecap').textContent();
  expect(recap).not.toBeNull();
  const depth = Number(recap!.match(/\+(\d+) depth/)?.[1]);
  const survival = Number(recap!.match(/\+(\d+) survival/)?.[1]);
  const carried = Number(recap!.match(/\+(\d+) child/)?.[1] ?? 0);
  const rescue = Number(recap!.match(/\+(\d+) rescue/)?.[1] ?? 0);
  const spentMatch = recap!.match(/−(\d+) charm/);
  const spent = spentMatch ? Number(spentMatch[1]) : 0;
  const total = Number(recap!.match(/= (\d+) embers/)?.[1]);
  expect([depth, survival, total].every(Number.isFinite)).toBe(true);
  return total + spent - (depth + survival + carried + rescue);
}

test.describe('Cold Walk', () => {
  test('#coldWalkPanel is absent when not opted in', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    // Default localStorage -- no coldWalkOptIn key at all.
    await boot(page, { qaHooks: true });
    await enter(page);
    await expect(page.locator('#coldWalkPanel')).toBeHidden();

    await qaHook(page, 'qaSetFixedStep', 0.05);
    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 10);
    await page.keyboard.up('ShiftLeft');

    await expect(page.locator('#coldWalkPanel')).toBeHidden();
    expectNoConsoleErrors(errs);
  });

  test('#coldWalkPanel shows silent, then broken, the instant the player sprints', async ({ page, context }) => {
    const errs = trackConsoleErrors(page);
    await seedSettings(context, { coldWalkOptIn: true });
    await boot(page, { qaHooks: true });
    await enter(page);

    await expect(page.locator('#coldWalkPanel')).toHaveText('Cold Walk — silent');

    await qaHook(page, 'qaSetFixedStep', 0.05);
    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 1);   // one fixed-step tick is enough to trip `running`

    await expect(page.locator('#coldWalkPanel')).toHaveText('Cold Walk — broken');

    // Sticky for the rest of the run -- releasing and sprinting again must not un-break it.
    await page.keyboard.up('ShiftLeft');
    await qaHook(page, 'qaAdvance', 10);
    await expect(page.locator('#coldWalkPanel')).toHaveText('Cold Walk — broken');
    await page.keyboard.down('ShiftLeft');
    await qaHook(page, 'qaAdvance', 10);
    await page.keyboard.up('ShiftLeft');
    await expect(page.locator('#coldWalkPanel')).toHaveText('Cold Walk — broken');

    expectNoConsoleErrors(errs);
  });

  test('sprinting after pickup does not break Cold Walk', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errs = trackConsoleErrors(page);
    await seedSettings(context, { coldWalkOptIn: true });
    await boot(page, { qaHooks: true });
    await enter(page);
    await expect(page.locator('#coldWalkPanel')).toHaveText('Cold Walk — silent');

    await qaHook(page, 'qaTeleportNearBaby');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');   // real pickup-accept path, not a QA hook (Q1.5/Q11)

    // #coldWalkPanel is gone the instant pickup() is accepted -- `playing` (the same gate
    // every other status panel uses) excludes `pickingUp`, same as #missionPanel
    // (e2e/mission-slack-water.spec.ts). Sprinting through the cinematic on a hidden panel
    // is exactly the scenario this test drives.
    await expect(page.locator('#coldWalkPanel')).toBeHidden();
    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ShiftLeft');

    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
    // boot()'s default tier is 'night' (1.75x win multiplier, see mission-slack-water.spec.ts).
    expect(await payoutGap(page)).toBe(Math.round(COLD_WALK_REWARD * 1.75));

    expectNoConsoleErrors(errs);
  });

  test('a silent outbound leg pays COLD_WALK_REWARD on win', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errs = trackConsoleErrors(page);
    await seedSettings(context, { coldWalkOptIn: true });
    await boot(page, { qaHooks: true });
    await enter(page);

    await qaHook(page, 'qaTeleportNearBaby');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');   // never sprinted

    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
    expect(await payoutGap(page)).toBe(Math.round(COLD_WALK_REWARD * 1.75));

    expectNoConsoleErrors(errs);
  });

  test('a broken outbound leg pays no Cold Walk bonus on win', async ({ page, context }) => {
    test.setTimeout(60_000);
    const errs = trackConsoleErrors(page);
    await seedSettings(context, { coldWalkOptIn: true });
    await boot(page, { qaHooks: true });
    await enter(page);

    // Real-time hold, not qaSetFixedStep/qaAdvance -- this test still needs the real RAF
    // loop running afterward to reach #winScreen (qaSetFixedStep parks it permanently,
    // see e2e/stamina.spec.ts's comment; test 2 above doesn't hit this because it never
    // waits on real time again after breaking Cold Walk).
    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(300);   // sprints once, before pickup
    await page.keyboard.up('ShiftLeft');
    await expect(page.locator('#coldWalkPanel')).toHaveText('Cold Walk — broken');

    await qaHook(page, 'qaTeleportNearBaby');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');

    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
    expect(await payoutGap(page)).toBe(0);

    expectNoConsoleErrors(errs);
  });
});
