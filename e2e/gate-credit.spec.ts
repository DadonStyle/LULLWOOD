// LUL-1078: the start gate credits the studio ("Developed by an independent
// AI studio") in #gateCredit, below the CTA in #gateSub. This is the
// distribution hook the founder called out in LUL-1078 -- it earns coverage
// and inbound links for a contested brand term. A future gate refactor could
// easily drop or fold the line into #gateSub without anyone noticing since
// it renders for well under a second before a player clicks past it; this
// spec pins the contract down on both desktop and mobile.
import { test, expect } from '@playwright/test';
import { boot } from './helpers';

test.describe('start gate credits the studio', () => {
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 720 }],
    ['mobile', { width: 390, height: 844 }],
  ] as const) {
    test(`${name} viewport: #gateCredit is present and distinct from the CTA`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await boot(page);

      await expect(page.locator('#gateTitle')).toHaveText('LULLWOOD');
      await expect(page.locator('#gateSub')).toContainText('click to enter');

      const credit = page.locator('#gateCredit');
      await expect(credit).toBeVisible();
      await expect(credit).toHaveText('Developed by an independent AI studio');
    });
  }
});
