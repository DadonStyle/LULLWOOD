// Founder 2026-10-16: every button in GameMenu's top-left row has a tooltip
// (components/MenuTooltip.tsx, copy in lib/ui/menu-tips.ts) saying what it is
// plus a call to action -- the icon-only buttons (☰ ⛶ 💬 ©) have no visible
// text otherwise. Shown on hover (desktop) and keyboard focus, never on a tap.
import { test, expect } from './fixtures';
import { boot } from './helpers';

const BUTTONS = [
  { id: 'menuToggle', title: 'Menu', cta: 'Click to open the menu.' },
  { id: 'fullscreenToggle', title: 'Fullscreen', cta: 'Click to go fullscreen.' },
  { id: 'menuSuggest', title: 'Suggestions', cta: 'Click to suggest new things.' },
  { id: 'menuCredits', title: 'Credits', cta: 'Click to see the credits.' },
  { id: 'menuBeTheRescuer', title: 'Be the rescuer', cta: 'Click to read the rules for first place.' },
];

test.describe('menu button tooltips', () => {
  for (const b of BUTTONS) {
    test(`${b.id}: hovering shows what it is and a call to action`, async ({ page }) => {
      await boot(page);
      const button = page.getByTestId(b.id);
      const tip = page.getByTestId(`${b.id}-tooltip`);
      await expect(button).toHaveAttribute('aria-describedby', `${b.id}-tooltip`);
      await expect(tip).toBeHidden();

      const box = (await button.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await expect(tip).toBeVisible();
      await expect(tip).toContainText(b.title);
      await expect(tip).toContainText(b.cta);

      await page.mouse.move(box.x + box.width / 2, box.y + 400);
      await expect(tip).toBeHidden();
    });
  }

  test('the menu tooltip is gone while the menu itself is open', async ({ page }) => {
    await boot(page);
    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('.menuPanel')).toBeVisible();
    await expect(page.getByTestId('menuToggle-tooltip')).toHaveCount(0);
  });
});
