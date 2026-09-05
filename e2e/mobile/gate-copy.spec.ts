// LUL-71: the How-to-Play/gate screen used to print desktop keyboard shortcuts
// (WASD, Shift, Space, F, Esc) unconditionally -- none of those exist on a
// touch device, so a mobile player read instructions for controls they don't
// have. components/Hud.tsx now branches the gate copy on lib/input-mode.ts's
// isMobile(): touch devices get the on-screen stick/button copy instead.
//
// Runs only under the `mobile` Playwright project (playwright.config.ts),
// same real mobile-emulated context (devices['Pixel 5']) e2e/mobile/input-mode.spec.ts
// uses, so isMobile()'s (pointer: coarse) and (hover: none) match is the real
// thing that decides which gate copy renders, not a desktop context with
// hasTouch layered on.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test('mobile gate copy describes the touch controls, not keyboard shortcuts', async ({ page }) => {
  await boot(page);

  const gateText = await page.locator('#gateKeys').innerText();

  expect(gateText).toContain('left stick');
  expect(gateText).toContain('Hide');
  expect(gateText).toContain('Veil');
  // "E" maps to the lift-child button and still appears in the shortened copy ("Hide / E / Jump")
  expect(gateText).toContain('E');

  // None of these desktop-only bindings exist on a touch device -- asserting
  // their absence is the actual regression this spec guards (a stale desktop
  // string surviving in the mobile branch).
  expect(gateText).not.toContain('WASD');
  expect(gateText).not.toContain('Shift');
  expect(gateText).not.toContain('Space');
  expect(gateText).not.toContain('Esc');
});
