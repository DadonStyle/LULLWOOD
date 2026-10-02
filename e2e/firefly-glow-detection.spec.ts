// LUL-5744 (cheap slice, decision decisions/lul-5742-firefly-glow-detection-accepted-2026-10-02,
// full spec wiki game/mechanics/firefly-glow-detection-risk -- Section-0 checklist already
// answered there, not re-derived here): standing inside a firefly cluster's glow raises the
// player's exposure in the predator detect-mul chain (lib/game/fireflyDetect.ts's
// fireflyGlowDetectMul(), wired into effectiveDetect()/canSee() at engine/forest-engine.js).
// A one-shot HINT_PRIORITY caption + audio sting (fireflyGlowSwellCue()) fires the first time
// the player goes deep into a cluster (w>0.5), reusing the existing LUL-2307 hint registry
// and the qa*CueCount idiom other one-shot cues already use.
//
// Driven via qaSetFixedStep/qaAdvance (docs/specs/lul-2071-deterministic-qa-clock.md), same as
// e2e/hints.spec.ts, so every wait below is a game-time budget, not a wall-clock one. qaHour:2
// (night) keeps fireflies in their always-present state (same precedent as
// e2e/firefly-swarms.spec.ts). qaProbeEffectiveDetect() reads the real per-tick detect-mul
// product (not the unscaled tuning constant), the same technique e2e/rock-vantage-climb.spec.ts
// uses to prove a detect-multiplier change without racing a live chase's timing -- effectiveDetect()
// doesn't depend on predator/player distance at all, only on state, so this is a more
// deterministic probe of the same ramp the wiki's chase-latency framing describes.
//
// Cluster used throughout: fireflyMeadow (lib/game/fireflyClusters.ts), x=0 z=100 radius=45 raw,
// scaled by CONFIG.fireflyScaleMul=0.2 (micro QA world preset, engine/tuning.js) to (0,20),
// radius left unscaled at 45 (same precedent as ROOST_TRIGGER_RADIUS/DECOY_SCENT_RADIUS).
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// engine/tuning.js CONFIG.FIREFLY_GLOW_DETECT_BONUS -- a placeholder (LUL-5744, named
// by the Game Economist, not derived here). Update this constant if that value changes.
const FIREFLY_GLOW_DETECT_BONUS = 0.3;

const CLUSTER_CENTER = { x: 0, z: 20 };
const FAR_OUTSIDE = { x: 1000, z: 1000 };   // > any cluster's radius from every cluster center

/** Same shape as e2e/hints.spec.ts's own helper: drains whichever hint is currently
 * active (landmark/mission, both eligible from frame one) so a test staging
 * 'fireflyGlow' specifically isn't just watching an unrelated hint play out first. */
async function clearPreemptiveHints(page: Page, maxRounds = 4) {
  for (let i = 0; i < maxRounds; i++) {
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    if (!(await qaHook(page, 'qaProbeHints')).activeKey) return;
    await qaHook(page, 'qaAdvance', stepsFor(8.2));
  }
  throw new Error(`clearPreemptiveHints: a hint was still active after ${maxRounds} rounds`);
}

test.describe('firefly glow detection risk (LUL-5744)', () => {
  test('effectiveDetect is higher at a cluster center than far outside any cluster, by exactly 1+FIREFLY_GLOW_DETECT_BONUS', async ({ page }) => {
    await boot(page, { qaHooks: true, qaHour: 2 });
    await enter(page);
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 5, z: 5 }] });

    await qaHook(page, 'qaTeleportTo', CLUSTER_CENTER.x, CLUSTER_CENTER.z);
    const inside = await qaHook(page, 'qaProbeEffectiveDetect', 'lion');
    expect(inside, 'a staged live predator must return a real, non-null detect value').not.toBeNull();

    await qaHook(page, 'qaTeleportTo', FAR_OUTSIDE.x, FAR_OUTSIDE.z);
    const outside = await qaHook(page, 'qaProbeEffectiveDetect', 'lion');

    expect(inside, 'standing at a cluster center must raise exposure over standing far outside every cluster').toBeGreaterThan(outside);
    expect(inside / outside, 'the center/outside ratio must equal 1+FIREFLY_GLOW_DETECT_BONUS (w=1 at the center)')
      .toBeCloseTo(1 + FIREFLY_GLOW_DETECT_BONUS, 2);
  });

  test('the detection bonus ramps monotonically as distance to a cluster center shrinks', async ({ page }) => {
    await boot(page, { qaHooks: true, qaHour: 2 });
    await enter(page);
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'lion', x: 5, z: 5 }] });

    const radii = [44, 30, 15, 0];   // descending distance-from-center -> ascending exposure
    const readings: number[] = [];
    for (const r of radii) {
      await qaHook(page, 'qaTeleportTo', CLUSTER_CENTER.x, CLUSTER_CENTER.z + r);
      readings.push(await qaHook(page, 'qaProbeEffectiveDetect', 'lion'));
    }
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i], `reading at radius ${radii[i]} must exceed radius ${radii[i - 1]}`).toBeGreaterThan(readings[i - 1]);
    }

    // Just past the cluster's edge, exposure must drop back to the same baseline as
    // standing far outside every cluster (w=0 either way).
    await qaHook(page, 'qaTeleportTo', CLUSTER_CENTER.x, CLUSTER_CENTER.z + 45.01);
    const justOutside = await qaHook(page, 'qaProbeEffectiveDetect', 'lion');
    await qaHook(page, 'qaTeleportTo', FAR_OUTSIDE.x, FAR_OUTSIDE.z);
    const farOutside = await qaHook(page, 'qaProbeEffectiveDetect', 'lion');
    expect(justOutside).toBeCloseTo(farOutside, 5);
  });

  test('the fireflyGlow caption and sting fire once the first time the player goes deep into a cluster (w>0.5), never again', async ({ page }) => {
    await boot(page, { qaHooks: true, qaHour: 2 });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    // No predators -- this test is about the ambient hint/cue, not a chase (same
    // park-everything precedent e2e/hints.spec.ts's landmark test documents).
    await qaHook(page, 'qaBuildScene', { predators: [] });
    await clearPreemptiveHints(page);

    const before = await qaHook(page, 'qaProbeFireflyClusters');
    expect(before.glowSwellCueCount, 'the sting must not have fired yet').toBe(0);

    await qaHook(page, 'qaTeleportTo', CLUSTER_CENTER.x, CLUSTER_CENTER.z);   // w=1, deep inside
    await qaHook(page, 'qaAdvance', stepsFor(0.1));

    let probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey, "'fireflyGlow' must win the slot the first frame w>0.5").toBe('fireflyGlow');
    await expect(page.locator('#hintCaption')).toContainText('the brighter you glow, the easier predators spot you');
    expect((await qaHook(page, 'qaProbeFireflyClusters')).glowSwellCueCount, 'the one-shot sting must have fired exactly once').toBe(1);

    // Leave the cluster (w drops to 0, well under the 0.5 dismiss threshold) -- dismisses
    // without waiting out the full 8s window, and marks the key seen.
    await qaHook(page, 'qaTeleportTo', FAR_OUTSIDE.x, FAR_OUTSIDE.z);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey).not.toBe('fireflyGlow');
    expect(probe.seen.fireflyGlow).toBe(true);

    // Re-entering the same cluster must not show the caption or fire the sting again.
    await qaHook(page, 'qaTeleportTo', CLUSTER_CENTER.x, CLUSTER_CENTER.z);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    probe = await qaHook(page, 'qaProbeHints');
    expect(probe.activeKey, 'an already-seen hint must never reclaim the slot').not.toBe('fireflyGlow');
    expect((await qaHook(page, 'qaProbeFireflyClusters')).glowSwellCueCount, 'the sting must stay one-shot across re-entry').toBe(1);
  });
});
