// LUL-741: real multi-touch and drag-off-release-outside coverage needs
// genuine native touch pointers, not synthetic PointerEvents.
// `locator.dispatchEvent('pointerdown', {...})` (used throughout the rest of
// e2e/mobile/) targets the DOM node directly and never goes through the
// browser's own hit-testing / pointer-capture retargeting, so it can't
// reproduce a release that lands outside the element it started on, and
// Playwright's own `page.touchscreen` API is single-touch only, so it can't
// drive two fingers down at once either.
//
// This drives touch through the Chrome DevTools Protocol directly
// (`Input.dispatchTouchEvent`), the same wire path a real finger uses. Per
// CDP's contract, `touchPoints` is the *complete current set* of active
// touches on every call -- dropping a previously-pressed point from the
// array is itself how you tell Chrome that finger lifted. `CdpTouch` tracks
// the active set so callers can address touches by their own logical id
// instead of re-building that array by hand on every call.
//
// See wiki: game/lul730-verification-results, game/lul702-stick-pointer-capture-fix.
import type { Page, CDPSession } from '@playwright/test';

interface ActivePoint {
  x: number;
  y: number;
  id: number;
}

export class CdpTouch {
  private constructor(
    private readonly client: CDPSession,
    private readonly active: Map<number, ActivePoint>,
  ) {}

  static async create(page: Page): Promise<CdpTouch> {
    const client = await page.context().newCDPSession(page);
    return new CdpTouch(client, new Map());
  }

  private snapshot(): ActivePoint[] {
    return [...this.active.values()];
  }

  /** Press a new finger (caller-chosen logical `id`) at (x, y). Any other active fingers stay down. */
  async press(id: number, x: number, y: number) {
    if (this.active.has(id)) throw new Error(`touch id ${id} is already active`);
    this.active.set(id, { id, x, y });
    await this.client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.snapshot() });
  }

  /** Move an already-pressed finger to (x, y). Other active fingers stay put. */
  async move(id: number, x: number, y: number) {
    const p = this.active.get(id);
    if (!p) throw new Error(`touch id ${id} is not active`);
    p.x = x;
    p.y = y;
    await this.client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.snapshot() });
  }

  /** Lift a finger, wherever it currently is. Other active fingers stay down. */
  async release(id: number) {
    if (!this.active.has(id)) throw new Error(`touch id ${id} is not active`);
    this.active.delete(id);
    await this.client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: this.snapshot() });
  }
}
