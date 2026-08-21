// LUL-529: MobileControls.tsx used to position its wrapper at a hard
// `bottom: 24` / `padding: '0 20px'`, with no `env(safe-area-inset-*)`
// anywhere in the repo -- on a notched phone or one with a home indicator,
// controls landed under system UI (the founder's "in mobile the ui should
// not be blocked"). `env()` only resolves to a nonzero value once
// app/layout.tsx's viewport export carries `viewportFit: 'cover'`; this
// sandbox's emulated device has no physical notch to render against, so this
// asserts the CSS declares the safe-area terms (falsifiable: reverting
// either the wrapper style or the viewport export fails this) rather than
// trying to measure pixels no headless run can actually produce.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('bottom controls and the pause button both carry safe-area-inset terms', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const controlsStyle = await page.getByTestId('mobileControls').getAttribute('style');
  expect(controlsStyle).toContain('env(safe-area-inset-bottom)');
  expect(controlsStyle).toContain('env(safe-area-inset-left)');
  expect(controlsStyle).toContain('env(safe-area-inset-right)');

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle -- pause wrapper only mounts once entered

  const pauseWrapperStyle = await page.getByTestId('mobilePauseWrapper').getAttribute('style');
  expect(pauseWrapperStyle).toContain('env(safe-area-inset-top)');
  expect(pauseWrapperStyle).toContain('env(safe-area-inset-left)');

  // The viewport meta is what makes the env() terms above resolve to
  // anything but 0 on a real notched device -- assert it's actually present,
  // not just that the CSS references a variable nothing ever populates.
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportMeta).toContain('viewport-fit=cover');
});
