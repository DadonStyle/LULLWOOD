// LUL-3010: coverage for the two mission variants -- oakHollow (near, untimed,
// MISSION_OAKHOLLOW_REWARD) and deepwater (far, 60s timer, MISSION_FIREPOWER_REWARD) --
// and the expiry path that forfeits the bonus without failing the run. See
// docs/specs/lul-3010-mission-progression.md.
//
// `?qaMissionKind=` (under `?qaHooks=1`) forces generateMap()'s draw to a single kind,
// bypassing MISSION_FAR_UNLOCK_WINS -- a fresh boot's progression has no wins yet, so an
// unforced draw would only ever land on oakHollow. Existing specs that assert deepwater
// by name (e2e/throwable-mission-hud.spec.ts, e2e/mission-landmark-sync.spec.ts,
// e2e/hints.spec.ts and their mobile counterparts) were updated to pass this same param.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

// Same el.click() workaround as e2e/hide-alert.spec.ts's identical helper (the wrapping
// `<label className="radioRow">` intercepts real actionability polling here even though
// the checkbox is genuinely clickable). Also mutes sound (LUL-2734 precedent): the
// mission's own periodic nav-cue hum (missionWaypointHum()) shares the #captionToast/
// captionId system and would otherwise race the expiry caption during this test's waits.
async function enableCaptionsMuted(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel('Captions for predator calls').evaluate((el) => (el as HTMLInputElement).click());
  await page.locator('#sound').evaluate((el) => (el as HTMLElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
}

test.describe('oakHollow (near/untimed)', () => {
  test('panel shows the name and glyph, no timer element, completes for the lower reward', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'oakHollow' });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('oakHollow');
    expect(mission?.status).toBe('active');

    await page.waitForTimeout(250);
    const panel = page.locator('#missionPanel');
    await expect(panel).toBeVisible({ timeout: 3_000 });
    await expect(panel).toContainText('Oak Hollow');
    await expect(panel.locator('#missionGlyph')).toHaveText('○');
    // No timer element at all for the untimed variant -- not just empty text.
    await expect(panel.locator('#missionTimer')).toHaveCount(0);

    const target = await qaHook(page, 'qaTeleportAtMissionTarget');
    expect(target?.kind).toBe('oakHollow');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
    await expect(panel.locator('#missionGlyph')).toHaveText('●');
    await expect(panel.locator('#missionTimer')).toHaveCount(0);

    expectNoConsoleErrors(errs);
  });
});

test.describe('deepwater (far/timed)', () => {
  test('panel shows a ticking countdown via #missionTimer', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'deepwater' });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('deepwater');
    expect(mission?.status).toBe('active');

    await page.waitForTimeout(250);
    const timer = page.locator('#missionPanel #missionTimer');
    await expect(timer).toBeVisible({ timeout: 3_000 });
    // formatDuration-shaped text: m:ss (Hud.tsx's formatDuration, same idiom the
    // secondary speedrun countdown and #status's time-survived readout use).
    await expect(timer).toHaveText(/^\d+:\d{2}$/);

    const first = await timer.textContent();
    await page.waitForTimeout(2_000);
    const second = await timer.textContent();
    expect(second).not.toBe(first);

    expectNoConsoleErrors(errs);
  });

  test('timer expiry flips the glyph to ✕, fires the caption once, and forfeits the mission bonus at win', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'deepwater' });
    await enter(page);
    await enableCaptionsMuted(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('deepwater');

    const shrunk = await qaHook(page, 'qaShrinkMissionTimer', 0.5);
    expect(shrunk).toEqual({ kind: 'deepwater', timeLimitSeconds: 0.5 });

    // Real per-tick expiry, not a shortcut -- wait past the shrunk limit for the next
    // frame's checkMissionExpiry() call to trip it.
    await expect(page.locator('#missionPanel #missionGlyph'), 'expiry must flip the glyph to the expired state').toHaveText('✕', { timeout: 3_000 });
    await expect(page.locator('#captionToast')).toContainText('the mission window has closed', { timeout: 3_000 });

    const expired = await qaHook(page, 'qaProbeMission');
    expect(expired?.status).toBe('expired');

    // Complete the real win path (qaTeleportNearBaby + KeyE, same convention as
    // e2e/progression.spec.ts) and confirm the win payout folded in no mission bonus:
    // RunPayout's depth/survival/carried/rescue fields are each independently rounded and
    // never include missionBonus (lib/game/economy.ts's computeWinPayout), so
    // total + spent === depth + survival + carried + rescue holds only when no bonus (or
    // an unrendered zero-value one) was added -- a positive missionBonus would break the
    // identity, which is exactly what a forfeited-on-expiry bonus must not do.
    await qaHook(page, 'qaTeleportNearBaby');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });

    const recap = await page.locator('#runRecap').textContent();
    expect(recap).not.toBeNull();
    const depth = Number(recap!.match(/\+(\d+) depth/)?.[1]);
    const survival = Number(recap!.match(/\+(\d+) survival/)?.[1]);
    const carried = Number(recap!.match(/\+(\d+) child/)?.[1]);
    const rescue = Number(recap!.match(/\+(\d+) rescue/)?.[1]);
    const spentMatch = recap!.match(/−(\d+) charm/);
    const spent = spentMatch ? Number(spentMatch[1]) : 0;
    const total = Number(recap!.match(/= (\d+) embers/)?.[1]);
    expect([depth, survival, carried, rescue, total].every(Number.isFinite)).toBe(true);
    expect(total + spent).toBe(depth + survival + carried + rescue);

    expectNoConsoleErrors(errs);
  });
});
