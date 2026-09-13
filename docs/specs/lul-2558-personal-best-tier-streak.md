# SPEC: personal-best time + tier streak counter on outcome screen

**Ticket:** LUL-2558 (cheap slice of Scout proposal LUL-2541, `game/mechanics/replay-progression.md`).
**Spec owner:** Founding Engineer, per CTO's PLAN comment on LUL-2558 (2026-09-12T12:08Z).
**Implementer:** Game Engineer — this spec is written so no further exploration is needed.
**Tier:** C — `engine/forest-engine.js` simulation state + localStorage persistence. Requires
`REVIEW: APPROVED` from Code Reviewer before merge, no `[ship]`.
**Read at:** `origin/release/next @ ac6e69b` (2026-09-12).
**Branch:** `lul-2558-personal-best-tier-streak`, off `release/next`.
**Scope:** text-only per the ticket (no icon/glow/chime/tooltip "Cue Triple" polish from the
scout doc — that's a separate follow-up if wanted).

## Two corrections to the CTO's PLAN before you start

1. **Don't add a new `Difficulty` type.** `lib/game/economy.ts:18` already exports
   `DifficultyTier = 'lantern' | 'night' | 'blackout'`, already imported into
   `engine/forest-engine.js` and used for the exact same three-tier split (`TIER_MULTIPLIERS`).
   `lib/game/progression.ts` imports and reuses `DifficultyTier` — do not declare a second,
   colliding three-tier union type.
2. **"Personal best" is a lower-is-better comparison, not higher.** The scout doc's wording
   is "fastest completion" — `survivedSeconds` at a win is *time-to-win*, so a new record is
   `survivedSeconds < bestTime`, not `>`. Get the comparison direction right in
   `recordRun()` (below) — the plan comment didn't spell out the operator and this is the one
   line that's easy to flip silently.

## Real vs. dead win call site (read before wiring all three)

The plan's "two win handlers" are `finishPickup()` (`engine/forest-engine.js:5233`) and
`arriveHome()` (`engine/forest-engine.js:5354`). Per
`decisions/lul-2281-pickup-is-the-win-2026-09-09`, **`arriveHome()` is dead code** — LUL-2281
made the pickup cinematic itself the win, and `arriveHome()`'s own comment says it is "now
unreachable in real play but left in place per Decision 2." Wire `recordRun()` into both
(cheap, keeps them in parity in case `arriveHome()` is ever reactivated), but:
- **`finishPickup()` is the only one an e2e spec can actually exercise.** Don't write a test
  that tries to reach `arriveHome()`'s win path — it cannot be driven from real play.
- The death call site is `triggerDeath()` (`engine/forest-engine.js:5401`).

## New pure module: `lib/game/progression.ts`

Same shape as `lib/game/economy.ts` / `lib/game/outcome.ts` — pure functions, no I/O, no
wall-clock reads. Engine owns the mutable `progression` var; `components/Hud.tsx` does the
localStorage I/O (see below).

```ts
import type { DifficultyTier } from './economy.ts';

export interface TierRecord {
  bestTime: number | null;   // seconds; fastest WIN completion for this tier, null = no win yet
  runs: number;               // every run (win or death) increments this
  wins: number;                // every win increments this
  currentStreak: number;      // consecutive wins; any death resets to 0
}

export type Progression = Record<DifficultyTier, TierRecord>;

function freshTierRecord(): TierRecord {
  return { bestTime: null, runs: 0, wins: 0, currentStreak: 0 };
}

export function freshProgression(): Progression {
  return { lantern: freshTierRecord(), night: freshTierRecord(), blackout: freshTierRecord() };
}

/** Pure transition. `survivedSeconds` is the run's elapsed time at the outcome (same value
 * already passed to computeWinPayout/computeDeathPayout). `newRecord` is true only on a win
 * that beats (strictly, lower than) the tier's current bestTime -- a death never sets one,
 * and a win that ties or is slower than an existing bestTime does not either. */
export function recordRun(
  p: Progression,
  difficulty: DifficultyTier,
  survivedSeconds: number,
  won: boolean,
): { progression: Progression; newRecord: boolean } {
  const prev = p[difficulty];
  const newRecord = won && (prev.bestTime === null || survivedSeconds < prev.bestTime);
  const next: TierRecord = {
    bestTime: newRecord ? survivedSeconds : prev.bestTime,
    runs: prev.runs + 1,
    wins: prev.wins + (won ? 1 : 0),
    currentStreak: won ? prev.currentStreak + 1 : 0,
  };
  return { progression: { ...p, [difficulty]: next }, newRecord };
}
```

Add unit tests in `lib/game/progression.test.ts`, colocated same as `lib/game/economy.test.ts`,
covering: fresh state, a win that sets the first record,
a slower win that does NOT overwrite bestTime, a win exactly equal to bestTime does NOT set
`newRecord`, a death increments `runs` but not `wins`/streak and resets `currentStreak`, and a
win-then-win increments `currentStreak` to 2.

## Engine wiring (`engine/forest-engine.js`)

- New module-level var next to `embers` (`engine/forest-engine.js:2993`):
  `let progression = freshProgression();`
- Import `freshProgression, recordRun` alongside the existing `lib/game/economy` import block
  (`engine/forest-engine.js:125-141`) — new import from `@/lib/game/progression`.
- At all **three** call sites, right alongside the existing payout computation, before the
  existing `pushState` call:
  - `finishPickup()` (`:5265`, before the win `pushState` at `:5274`) — `recordRun(progression, difficulty, survivedSeconds, true)`
  - `arriveHome()` (`:5386`, before its `pushState` at `:5395`) — same call, dead-code parity only (see above)
  - `triggerDeath()` (`:5413`, before its `pushState` at `:5433`) — `recordRun(progression, difficulty, survivedSeconds, false)`
- Reassign `progression = result.progression` at each site, then extend that site's existing
  `pushState({...})` call with three new keys (do not add a second `pushState` call):
  - `progression: { ...progression }` (the whole record — this is what
    `useProgression`'s persist effect below writes to localStorage)
  - `personalBest: progression[difficulty].bestTime`
  - `tierStats: { runs: progression[difficulty].runs, wins: progression[difficulty].wins, streak: progression[difficulty].currentStreak }`
  - `newRecord: result.newRecord` (death sites: this is always `false` by construction, but
    include it explicitly — every other outcome field here is spelled out at the call site,
    not left to fall through to a default)
- New action, same pattern as `setMissionUnlocks` (`engine/forest-engine.js:5538`) — wholesale
  replace, tolerant of a stale/partial stored shape (do not trust an arbitrary localStorage
  blob):
  ```js
  function setProgression(p){
    const tiers = ['lantern', 'night', 'blackout'];
    const next = {};
    for(const t of tiers){
      const rec = p && p[t];
      next[t] = {
        bestTime: (rec && typeof rec.bestTime === 'number' && rec.bestTime >= 0) ? rec.bestTime : null,
        runs: Math.max(0, Math.floor(rec && rec.runs) || 0),
        wins: Math.max(0, Math.floor(rec && rec.wins) || 0),
        currentStreak: Math.max(0, Math.floor(rec && rec.currentStreak) || 0),
      };
    }
    progression = next;
    pushState({ progression: { ...progression }, personalBest: progression[difficulty].bestTime,
      tierStats: { runs: progression[difficulty].runs, wins: progression[difficulty].wins, streak: progression[difficulty].currentStreak } });
  }
  ```
  (`difficulty` here is the existing module-level var already read by every other
  `pushState` call in this file — no new state needed to know "current tier.")

## Engine/React contract (founder rule 2026-09-09 — do not skip any of these five)

`setProgression` must land in the same PR in:
1. The function exists in the engine (above).
2. `init()`'s `return {...}` (`engine/forest-engine.js:6572`) — add `setProgression` next to
   `setMissionUnlocks`.
3. `EngineActions` in `components/Hud.tsx` (`:188`, next to `setMissionUnlocks: (unlocks: { deepwater: boolean }) => void;`):
   `setProgression: (p: Progression) => void;` (import `type { Progression }` from
   `@/lib/game/progression`).
4. `ENGINE_ACTION_KEYS` in `lib/engine-contract.ts:14` — add `'setProgression'` to the array.
5. A Playwright spec exercising the call site on desktop AND mobile (see `## e2e` below), and
   this spec doc's `## e2e` section names it (done, below).

Call it from Hud.tsx as `actions.setProgression?.(stored)` (optional-chained on the *method
itself*, matching `setMissionUnlocks`'s `actions.setMissionUnlocks?.(stored)` at
`components/Hud.tsx:424` — `actions?.setProgression(stored)` only guards a null `actions`, not
a missing method, and is not an acceptable substitute per the LUL-1697 lesson).

## HUD state (`components/Hud.tsx`)

Add to `EngineHudState` (next to the `embersBalance`/`lastPayout` block, `:97`) and to
`INITIAL_HUD_STATE` (`:196`):
```ts
progression: Progression;                              // whole record, for persistence only
personalBest: number | null;                            // current-tier bestTime, for RunRecap
tierStats: { runs: number; wins: number; streak: number }; // current-tier summary, for RunRecap
newRecord: boolean;
```
`INITIAL_HUD_STATE` defaults: `progression: freshProgression(), personalBest: null,
tierStats: { runs: 0, wins: 0, streak: 0 }, newRecord: false`.

## Persistence (`components/Hud.tsx`)

New `useProgression(actions, progression)` hook, identical two-effect structure to
`useMissionUnlocks` (`:419`-`:434`): apply-on-ready effect calls `actions.setProgression?.(stored)`
once `actions` exists; persist effect writes `progression` (the full record) to localStorage
whenever it changes, gated on the same `appliedRef` guard so a fresh mount doesn't immediately
overwrite a stored record with `freshProgression()` before the apply effect runs.

```ts
const PROGRESSION_KEY = 'lullwood:progression';

function readProgression(): Progression | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROGRESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Progression; // setProgression() in the engine re-validates every field
  } catch {
    return null;
  }
}

function writeProgression(p: Progression) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROGRESSION_KEY, JSON.stringify(p));
  } catch {
    // private mode / quota exceeded -- same no-op as writeEmbers/writeMissionUnlocks
  }
}

function useProgression(actions: EngineActions | null, progression: Progression) {
  const appliedRef = useRef(false);
  useEffect(() => {
    if (!actions) return;
    appliedRef.current = true;
    const stored = readProgression();
    if (stored) actions.setProgression?.(stored);
  }, [actions]);
  useEffect(() => {
    if (!appliedRef.current) return;
    writeProgression(progression);
  }, [progression]);
}
```
Call it next to the other two hook calls (`:573`-`:574`):
`useProgression(actions, state.progression);`

`readProgression()` deliberately does not validate shape (unlike `readEmbers()`) — the engine's
`setProgression()` already re-validates every field defensively, so double-validating in two
places would just be the same guard written twice. This mirrors why `setMissionUnlocks`
(engine side) is the one that does `!!(unlocks && unlocks.deepwater)`, not
`readMissionUnlocks()`.

## UI (`components/Hud.tsx` `RunRecap`, `:477`)

New props: `personalBest: number | null`, `tierStats: { runs: number; wins: number; streak: number }`,
`newRecord: boolean`. Two new lines below the existing survived-time/payout block, after the
closing `</p>` of the existing recap paragraph (`:500`, immediately before the
`{lines.length > 0 && (` chronicle block):

```tsx
{personalBest != null && (
  <p className={newRecord ? 'newRecord' : undefined}>
    Personal Best: {formatDuration(personalBest)}{newRecord ? ' — New Record!' : ''}
  </p>
)}
<p>
  {tierLabel} stats: Runs {tierStats.runs} · Wins {tierStats.wins}
  {tierStats.runs > 0 ? ` (${Math.round((tierStats.wins / tierStats.runs) * 100)}%)` : ''} · Streak {tierStats.streak}
</p>
```
Reuses the existing `formatDuration` helper (`:289`) already used for `survivedSeconds` — no
new time formatter. `newRecord` only distinguishes via a CSS class toggle + the literal text
" — New Record!" (plain text per the scope trim — no icon/glow/animation). Guard the percentage
division by `tierStats.runs > 0` — `runs` is always ≥1 by the time RunRecap renders (this call
only happens after at least one outcome), but write the guard anyway since it costs nothing and
protects against a future call site that doesn't hold that invariant.

Both `RunRecap` call sites (`:984`, `:1011`) get the three new props from `state`:
`personalBest={state.personalBest} tierStats={state.tierStats} newRecord={state.newRecord}`.

## e2e (LUL-2377 QA-world rule)

**Hooks.** None new needed — `qaTeleportNearBaby()` and `qaTriggerDeath(kind, cause)`
(`engine/forest-engine.js:3726`/`:3736`) already drive the real win/death transitions
deterministically, and both are already used in the micro world by existing specs
(`e2e/win-persist.spec.ts`, `e2e/mobile/win-persist.spec.ts`). Progression state itself is
read from the DOM (`#runRecap` text), matching how `e2e/win-persist.spec.ts` already reads
recap text — no new probe hook required.

**World.** micro (`qaWorld: 'micro'`, the default) — this is pure outcome-flow + localStorage
state, no `@fullmap` reason applies.

**Spec 1 — new file `e2e/progression.spec.ts`** (desktop), one test driving two consecutive
outcomes in one session to observe streak increment/reset and the personal-best comparison:
```ts
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

test('win-then-win increments streak and sets a faster-time record; a death resets it', async ({ page }) => {
  test.setTimeout(90_000);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await enter(page);

  // Run 1: win.
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  let recap = await page.locator('#runRecap').textContent();
  expect(recap).toContain('Personal Best:');   // first-ever win on this tier is always a record
  expect(recap).toContain('Runs 1');
  expect(recap).toContain('Wins 1');
  expect(recap).toContain('Streak 1');

  // Restart (same convention as e2e/win-persist.spec.ts -- el.click() to
  // dodge CI actionability-polling flakiness on this button).
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#winScreen')).toBeHidden();

  // Run 2: win again -- streak must increment to 2, bestTime must NOT
  // regress if this run is slower (qaTeleportNearBaby -> KeyE is the same
  // deterministic distance both times, so completion time should be close;
  // assert the invariant, not an exact faster/slower outcome, since frame
  // timing is not guaranteed identical between runs).
  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  recap = await page.locator('#runRecap').textContent();
  expect(recap).toContain('Runs 2');
  expect(recap).toContain('Wins 2');
  expect(recap).toContain('Streak 2');

  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#winScreen')).toBeHidden();

  // Run 3: death -- streak must reset to 0, wins must NOT increment, runs must.
  await page.evaluate(() => window.ForestEngine?.qaTriggerDeath?.('wolf', 'chase'));
  await expect(page.locator('#deathScreen')).toBeVisible({ timeout: 15_000 });
  recap = await page.locator('#runRecap').textContent();
  expect(recap).toContain('Runs 3');
  expect(recap).toContain('Wins 2');
  expect(recap).toContain('Streak 0');
});
```

**Spec 2 — `e2e/mobile/progression.spec.ts`**: same flow under the `mobile` Playwright project
(landscape viewport per `e2e/mobile/win-persist.spec.ts`'s `test.use({ viewport: ... })`),
driving pickup via `page.keyboard.press('KeyE')` exactly as `e2e/mobile/win-persist.spec.ts`
already does (KeyE reaches `pickup()` in mobile mode too, per that spec's existing comment) —
this is the desktop-AND-mobile call-site coverage the engine/React contract rule requires for
`setProgression`.

**Spec 3 — extend the existing returning-player regression, both variants**
(`e2e/returning-player.spec.ts`, `e2e/mobile/returning-player.spec.ts`): add
`'lullwood:progression': JSON.stringify({ lantern: { bestTime: 145, runs: 4, wins: 2, currentStreak: 1 }, night: freshProgression().night, blackout: freshProgression().blackout })`
to the `RETURNING_PLAYER` fixture object in both files. This is the exact LUL-2221/LUL-1697
regression shape — a returning player's stored `lullwood:progression` blob must not blank the
page when `setProgression` is missing from `init()`'s return object (the existing test already
asserts `window.ForestEngine` exists and `expectNoConsoleErrors`; no new assertions needed,
just the new seeded key).

**Tester scenario.** None — no new visual/audio asset, this is pure text + logic; nothing here
needs the nightly local-qa tester's vision-model check.

**Not covered.** Whether "Personal Best" / streak text reads clearly at a glance on the actual
outcome screen (typography, line-wrapping at narrow mobile widths) is a visual call, unverified
by this spec — flag it in the PR per the standing "gameplay/visual is unverified until a human
confirms" rule.

## Constraints

- Tier C: `REVIEW: APPROVED` from Code Reviewer required before merge, no `[ship]` marker.
- Update `docs/ELEMENTS.md` in the same PR (new engine action `setProgression`, new module
  `lib/game/progression.ts`).
- No economy impact: `recordRun`/`setProgression` never touch `embers`, `RunPayout`, or any
  `applyPayout` call — this ships alongside the existing payout computation, never inside it.
- No server/leaderboard — that's the scout doc's declined full-scope option, out of bounds here.
