// LUL-2611: `p.approachEnteredHidden` is stamped `hidden` at every chase->
// investigate/approach transition (engine/forest-engine.js, 8 call sites) and
// consumed by shouldRevertInvestigateToChase() (lib/game/predator.ts) --
// !hidden && (inv === 'approach' && approachEnteredHidden === true) reverts
// straight back to 'chase'. Before this fix the predator could enter
// 'investigate' while the player was hidden, and un-hiding on the same spot
// (still standing on the bramble, no LOS change) would NOT revert it to
// 'chase' -- the exact "hiding does not hold near a predator" shape the
// founder reported (LUL-2611). lib/game/predator.ts's own unit tests cover
// shouldRevertInvestigateToChase() as a pure function; this spec is the
// live-engine counterpart LUL-2703's review asked for -- it drives the real
// stamping-then-reverting cycle in the running engine, using the same
// qaHideBehindCoverKind/qaPredatorState hooks and fixed-step clock as
// positional-hiding.spec.ts, so a regression in the 8 call sites (not just
// the pure predicate) fails here.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function advanceUntil(
  page: import('@playwright/test').Page,
  predicate: () => Promise<boolean>,
  { chunkSeconds = 1, maxSeconds = 20 }: { chunkSeconds?: number; maxSeconds?: number } = {},
): Promise<boolean> {
  const chunkSteps = stepsFor(chunkSeconds);
  const chunks = Math.ceil(maxSeconds / chunkSeconds);
  for (let i = 0; i < chunks; i++) {
    await qaHook(page, 'qaAdvance', chunkSteps);
    if (await predicate()) return true;
  }
  return false;
}

test.describe('investigate -> chase revert on un-hide (LUL-2611)', () => {
  test('un-hiding while a predator investigates reverts it straight back to chase', async ({ page }) => {
    test.setTimeout(60_000);
    // LUL-2329: full map, same as positional-hiding.spec.ts -- this hook
    // needs a real, naturally-generated HIDE_KINDS cover prop.
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const result = await page.evaluate(
      (k: 'wolf' | 'bear' | 'lion') => window.ForestEngine?.qaHideBehindCoverKind?.(k) ?? null,
      'wolf' as const,
    );
    if (result === null) {
      throw new Error("qaHideBehindCoverKind('wolf') returned null -- no non-tree cover prop with a clear path was found");
    }
    const idx: number = result.idx;

    // Enter `hidden` on the cover -- the predator's chase->investigate
    // transition below stamps approachEnteredHidden=true from this.
    await page.keyboard.press('KeyH');

    const readPredator = () => page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i) ?? null, idx);

    const reachedInvestigate = await advanceUntil(page, async () => (await readPredator())?.state === 'investigate');
    expect(reachedInvestigate, 'wolf never left "chase" for "investigate" after LOS was blocked by cover').toBe(true);

    const reachedApproach = await advanceUntil(page, async () => (await readPredator())?.inv === 'approach');
    expect(reachedApproach, 'wolf reached "investigate" but never in the "approach" sub-phase').toBe(true);

    // Un-hide on the same spot -- no LOS change, nothing else moved. Before
    // the fix this left the predator stuck in investigate/approach (the
    // "does not hold" bug); the fix reverts it to chase on the first tick
    // that sees !hidden.
    await page.keyboard.press('KeyH');
    const stillHidden = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()?.hidden ?? null);
    expect(stillHidden, 'KeyH should have exited hidden').toBe(false);

    const revertedToChase = await advanceUntil(page, async () => (await readPredator())?.state === 'chase', {
      maxSeconds: 5,
    });
    expect(revertedToChase, 'wolf stayed in investigate/approach after the player un-hid on the same spot -- LUL-2611 regression').toBe(true);
  });
});
