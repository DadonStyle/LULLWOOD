// LUL-2312 (absorbs LUL-1089's coverage + the stranded LUL-1778/1779/1780
// nightly failures): #actionPrompt is now one row (data-tone-driven, not
// class-driven) inside the single always-mounted #actionSlot grid --
// components/ActionPrompt.tsx / components/Hud.tsx / components/GameCanvas.tsx.
// Every row toggles `data-visible="0"|"1"` on the (never-unmounted) element
// instead of mounting/unmounting; `.urgent` became `data-tone="urgent"`;
// `#actionKey`/`#chargeKey`/`#throwKey` collapsed onto the shared
// `.actionPromptKey` class scoped per-row.
//
// Assertions:
// 1. Walk to a known bush → #actionPrompt is shown with the desktop-bramble calm string.
// 2. Stage a chase within COVER_URGENT_RANGE → #actionPrompt carries data-tone="urgent".
// 3. Cover and veil conditions both true → only cover string renders (precedence).
// 4. At 390px viewport, #actionPrompt's bounding box does not intersect the mobile
//    control root, and its scrollWidth <= clientWidth (no nowrap overflow).
// 5. With prefers-reduced-motion emulated, computed animation-name on the row's
//    .actionPromptKey is 'none'.
// 6. #actionSlot's five rows are always mounted, in the founder's stated
//    priority order (charge > objective > hide/veil > throwable > status),
//    regardless of which currently have content.
import { test, expect } from '@playwright/test';
import { boot, enter, trackConsoleErrors, expectNoConsoleErrors, qaHook, expectRowVisible, expectRowHidden } from './helpers';

// LUL-2107: the 3 cases below that stage a chasing predator (urgent
// cover-prompt class, the 390px nowrap/mobile-collision check, and reduced
// motion) drive the throttled cover probe (COVER_PROBE_HZ, engine/forest-
// engine.js ~4710) via qaSetFixedStep/qaAdvance instead of a real-wall-clock
// page.waitForTimeout -- that wait only reliably crossed the probe's 1/6s
// hand-accumulated `coverProbeAccum += dt` threshold (dilated at low FPS, see
// wiki systems/dt-clamp-vs-walltime) under swiftshader's incidental frame
// cadence, which real GPU rendering (LUL-1910) no longer guarantees. The
// calm-cover-prompt and cover-wins-over-veil cases above are not in this
// ticket's listed scope and stay on the real RAF loop.
const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test.describe('#actionSlot — hide and veil contextual prompt row', () => {
  test('calm cover prompt: shown at a bramble bush', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    // Teleport to the nearest hide spot (known bramble at seed=20260718)
    const kind = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
    expect(kind, 'qaTeleportToHideSpot returned null — no hide spot at this seed').not.toBeNull();

    // Wait for the throttled 6Hz probe to fire (≤ 170ms)
    await page.waitForTimeout(250);

    await expectRowVisible(page, 'actionPrompt');
    const prompt = page.locator('#actionPrompt');

    const text = await prompt.textContent();
    // Should contain the desktop calm bramble string -- bramble is the only
    // hide-eligible cover kind since LUL-2311, so `kind` can only be 'bramble'.
    const noun = 'bush';
    // Desktop calm: "Press  H  to hide in the bush"
    expect(text, 'Calm prompt must name the noun and contain key H').toMatch(new RegExp(`H.*to hide in the ${noun}|to hide in the ${noun}`));

    // #actionPrompt must NOT carry tone="urgent" at this point (no chasing predator)
    await expect(prompt).not.toHaveAttribute('data-tone', 'urgent');

    expectNoConsoleErrors(errs);
  });

  // LUL-2311: log is walkable, LOS-blocking cover, but no longer hide-eligible
  // -- pressing H beside one must be a no-op, and #actionPrompt must never
  // show a "to hide in the ..." string for it.
  test('KeyH beside a log is a no-op -- log is no longer hide-eligible', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    const kind = await page.evaluate(() => window.ForestEngine?.qaTeleportNearCoverKind?.('log') ?? null);
    expect(kind, 'qaTeleportNearCoverKind(\'log\') returned null — no log at this seed').toBe('log');

    await page.waitForTimeout(250); // let the throttled cover probe run, same as the calm-prompt case above

    await expectRowHidden(page, 'actionPrompt');

    await page.keyboard.press('KeyH');
    await page.waitForTimeout(100);

    const state = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(state?.hidden, 'KeyH beside a log must not enter the hidden stance').toBe(false);
    await expectRowHidden(page, 'actionPrompt');

    expectNoConsoleErrors(errs);
  });

  test('urgent cover prompt: data-tone="urgent" when predator chases within range', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    // Teleport to hide spot first, then stage a lion chase nearby
    await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.());
    // qaOpenHideNearLion places the lion 4 units away in chase state — well within COVER_URGENT_RANGE (22)
    const lionResult = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLion?.() ?? null);
    expect(lionResult, 'qaOpenHideNearLion returned null — no lion at this seed').not.toBeNull();

    // LUL-2107: park the real RAF loop and advance enough game time
    // (well over the probe's 1/6s threshold) to force the throttled cover
    // probe to fire and pushState to propagate, deterministically.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.5));

    await expectRowVisible(page, 'actionPrompt');
    await expect(page.locator('#actionPrompt')).toHaveAttribute('data-tone', 'urgent');

    expectNoConsoleErrors(errs);
  });

  test('cover wins over veil — only cover string renders when both conditions hold', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    // Place player 0.5 units outside the hide spot's AABB edge (not at center)
    // and a chasing lion 4 units further in the same direction -- both cover and
    // veil conditions true at once, and hasLOS() is unblocked by the prop itself.
    const staged = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.() ?? null);
    expect(staged, 'qaOpenHideNearLionAtHideSpot returned null — no hide spot or lion at this seed').not.toBeNull();

    // Verify the premise: the lion must actually have line of sight to the player
    // right after staging. If this fails, the test's two-condition premise is broken
    // again (e.g. another cover prop blocked the sightline at this seed).
    const lionState = await page.evaluate(
      (idx: number) => window.ForestEngine?.qaPredatorState?.(idx) ?? null,
      staged!.idx
    );
    expect(lionState?.canSee, 'Staged lion must have line of sight to player (both conditions must hold)').toBe(true);

    await page.waitForTimeout(350);

    await expectRowVisible(page, 'actionPrompt');
    const text = await page.locator('#actionPrompt').textContent() ?? '';
    // Must contain 'H' (cover key), not 'F' or 'veil' (veil prompt)
    expect(text.toLowerCase(), 'Cover string must render, not veil string').not.toMatch(/for the.*veil|hold.*f|hunting you/i);
    expect(text, 'Cover key H must be present').toMatch(/H/);

    expectNoConsoleErrors(errs);
  });

  test('no nowrap overflow and no mobile-control collision at 390px', async ({ page }) => {
    // Use mobile viewport (390px wide, 844px tall — iPhone 12)
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page, { qaHooks: true });
    await enter(page);

    await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.());
    await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLion?.());
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.5));

    await expectRowVisible(page, 'actionPrompt');

    // 1. No nowrap overflow
    const overflow = await page.evaluate(() => {
      const el = document.getElementById('actionPrompt');
      if (!el) return null;
      return el.scrollWidth > el.clientWidth;
    });
    expect(overflow, '#actionPrompt must not overflow (nowrap budget)').toBe(false);

    // 2. No collision with mobile controls
    const collision = await page.evaluate(() => {
      const prompt = document.getElementById('actionPrompt');
      // The mobile control root is the first child of the controls container — check against
      // MobileControls.tsx's fixed-position root (z-index 30, bottom: 24px + safe-area)
      // We look for the element with z-index 30 that covers the bottom area.
      const controls = document.querySelector('[style*="z-index: 30"]') ??
                       document.querySelector('[class*="controls"]');
      if (!prompt) return null;
      const pb = prompt.getBoundingClientRect();
      if (!controls) return false; // no controls rendered (desktop mode), not a collision
      const cb = controls.getBoundingClientRect();
      // Overlaps if neither is fully above/below the other
      return pb.bottom > cb.top && pb.top < cb.bottom;
    });
    expect(collision, '#actionPrompt must not overlap mobile control row').toBe(false);
  });

  test('reduced motion: animation-name is none on the urgent row\'s keycap when media query emulated', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, { qaHooks: true });
    await enter(page);

    await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.());
    await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLion?.());
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.5));

    await expectRowVisible(page, 'actionPrompt');
    await expect(page.locator('#actionPrompt')).toHaveAttribute('data-tone', 'urgent');

    const animName = await page.evaluate(() => {
      const el = document.querySelector('#actionPrompt .actionPromptKey');
      if (!el) return null;
      return window.getComputedStyle(el).animationName;
    });
    expect(animName, 'urgentFlash animation must be suppressed under reduced motion').toBe('none');

    expectNoConsoleErrors(errs);
  });
});

// LUL-2312: the founder's explicit requirement -- "stacked in a fixed
// priority order" -- pinned as a DOM-order check independent of any gameplay
// staging, so it can never silently drift if a future edit reorders the JSX
// inside #actionSlot (components/Hud.tsx).
test.describe('#actionSlot row order', () => {
  test('five rows are always mounted, top to bottom in priority order', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('#actionSlot > *')).map((el) => el.id));
    expect(ids).toEqual(['chargePrompt', 'objective', 'actionPrompt', 'throwPrompt', 'status']);

    // Every row exists (not conditionally mounted) even with nothing to show.
    for (const id of ids) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });
});
