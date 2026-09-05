// LUL-1089: contextual #actionPrompt — hide and veil prompts.
//
// Four assertions:
// 1. Walk to a known bush → #actionPrompt is visible with the desktop-bramble calm string.
// 2. Stage a chase within COVER_URGENT_RANGE → #actionPrompt carries .urgent.
// 3. Cover and veil conditions both true → only cover string renders (precedence).
// 4. At 390px viewport, #actionPrompt's bounding box does not intersect the mobile
//    control root, and its scrollWidth <= clientWidth (no nowrap overflow).
// 5. With prefers-reduced-motion emulated, computed animation-name on #actionKey is 'none'.
import { test, expect } from '@playwright/test';
import { boot, enter, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

test.describe('#actionPrompt — hide and veil contextual prompts', () => {
  test('calm cover prompt: visible at a bramble bush', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    // Teleport to the nearest hide spot (known bramble at seed=20260718)
    const kind = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
    expect(kind, 'qaTeleportToHideSpot returned null — no hide spot at this seed').not.toBeNull();

    // Wait for the throttled 6Hz probe to fire (≤ 170ms)
    await page.waitForTimeout(250);

    const prompt = page.locator('#actionPrompt');
    await expect(prompt).toBeVisible({ timeout: 3_000 });

    const text = await prompt.textContent();
    // Should contain the desktop calm bramble string (or log, depending on the spot)
    const noun = kind === 'log' ? 'hollow log' : 'bush';
    // Desktop calm: "Press  H  to hide in the bush" (or hollow log)
    expect(text, 'Calm prompt must name the noun and contain key H').toMatch(new RegExp(`H.*to hide in the ${noun}|to hide in the ${noun}`));

    // #actionPrompt must NOT carry .urgent at this point (no chasing predator)
    await expect(prompt).not.toHaveClass(/urgent/);

    expectNoConsoleErrors(errs);
  });

  test('urgent cover prompt: .urgent class when predator chases within range', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    // Teleport to hide spot first, then stage a lion chase nearby
    await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.());
    // qaOpenHideNearLion places the lion 4 units away in chase state — well within COVER_URGENT_RANGE (22)
    const lionResult = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLion?.() ?? null);
    expect(lionResult, 'qaOpenHideNearLion returned null — no lion at this seed').not.toBeNull();

    // Wait for probe to fire and state to propagate to React
    await page.waitForTimeout(350);

    const prompt = page.locator('#actionPrompt');
    await expect(prompt).toBeVisible({ timeout: 3_000 });
    await expect(prompt).toHaveClass(/urgent/);

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

    const prompt = page.locator('#actionPrompt');
    await expect(prompt).toBeVisible({ timeout: 3_000 });

    const text = await prompt.textContent() ?? '';
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
    await page.waitForTimeout(350);

    const prompt = page.locator('#actionPrompt');
    await expect(prompt).toBeVisible({ timeout: 3_000 });

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

  test('reduced motion: animation-name is none on #actionKey when media query emulated', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, { qaHooks: true });
    await enter(page);

    await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.());
    await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLion?.());
    await page.waitForTimeout(350);

    const prompt = page.locator('#actionPrompt');
    await expect(prompt).toBeVisible({ timeout: 3_000 });
    await expect(prompt).toHaveClass(/urgent/);

    const animName = await page.evaluate(() => {
      const el = document.getElementById('actionKey');
      if (!el) return null;
      return window.getComputedStyle(el).animationName;
    });
    expect(animName, 'urgentFlash animation must be suppressed under reduced motion').toBe('none');

    expectNoConsoleErrors(errs);
  });
});
