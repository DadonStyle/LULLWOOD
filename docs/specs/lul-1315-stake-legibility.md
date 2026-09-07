# LUL-1315: bank-or-lose legibility — live pile + death forfeit

Tier: B (`components/Hud.tsx`, `engine/forest-engine.js`, `lib/game/economy.ts` —
existing engine data pushes only, no new storage/events, no pricing change).

Accepted design: Player Psychologist, LUL-1279, wiki `game/psychology/stake-legibility`.
No new mechanic and no number changes — this only surfaces state the simulation
already computes (`maxDistFromHome`, `computeDepth`, `computeSurvival`, the fixed
`CARRIED`/`HOME` constants).

## Gap 1 — in-run pile is invisible

`embersBalance` (the only Embers number ever shown during a run) only changes via
`pushState` at win/death/purchase (`engine/forest-engine.js:3080`, `:3107`, and the
purchase path). `maxDistFromHome` — the run's unbanked depth high-water mark — accrues
every tick (`engine/forest-engine.js:3483-3484`) but nothing reflects that on screen,
so the number on the HUD looks frozen for the entire run.

### Files

- `engine/forest-engine.js`
- `components/Hud.tsx`

### Change: `engine/forest-engine.js`

1. Import two more functions from the existing economy import block (`:99-107`):

   ```js
   import {
     freshEmbersState,
     computeWinPayout,
     computeDeathPayout,
     applyPayout,
     purchaseDeeperLungs as economyPurchaseDeeperLungs,
     veilMaxHoldForTier,
     DEEPER_LUNGS_MAX_TIER,
     MISSION_DEEPWATER_REWARD,
     computeDepth,
     computeSurvival,
   } from '@/lib/game/economy';
   ```

   Both are already `export`ed by `lib/game/economy.ts` (`:55`, `:59`) — no changes
   needed in that file for this gap.

2. In the `hudState` initial object, next to `embersBalance: 0,` (`:2317`), add:

   ```js
   embersBalance: 0, embersDeeperLungsTier: 0, lastPayout: null,
   livePileEmbers: 0,   // LUL-1315: live unbanked depth+survival total, run-only
   ```

3. In the tick loop, immediately after the existing `maxDistFromHome` update
   (`engine/forest-engine.js:3480-3484`):

   ```js
   if(entered){
     const distFromHome = Math.hypot(player.x - CONFIG.home.x, player.z - CONFIG.home.z);
     if(distFromHome > maxDistFromHome) maxDistFromHome = distFromHome;
     if(!won && !dead){
       pushState({ livePileEmbers: computeDepth(maxDistFromHome) + computeSurvival(clock.elapsedTime - enteredAt) });
     }
   }
   ```

   `won`/`dead` are the same flags already read elsewhere in this file (e.g. the
   `arriveHome`/`triggerDeath` functions above). `pushState` already no-ops on an
   unchanged value (`:2319-2325`), so this is safe to call every tick — it only
   actually emits when the floored depth/survival total changes, which is a handful
   of times per run, not once per frame.

4. In `enter()` (`engine/forest-engine.js:2369-2374`), reset the new field alongside
   the existing `maxDistFromHome = 0` reset:

   ```js
   function enter(){
     entered = true;
     enteredAt = clock.elapsedTime;
     runElapsed = 0;
     maxDistFromHome = 0;   // LUL-1043: fresh run, fresh depth high-water mark
     pushState({ entered: true, livePileEmbers: 0 });
   ```

### Change: `components/Hud.tsx`

1. Add the field to the `HudState` interface, next to `embersBalance` (`:87-89`):

   ```ts
   embersBalance: number;
   livePileEmbers: number;   // LUL-1315: live unbanked total, run-only, 0 outside a run
   ...
   lastPayout: RunPayout | null;
   ```

2. Add the matching default, next to the existing `embersBalance: 0,` default
   (`:177-179`):

   ```ts
   embersBalance: 0,
   livePileEmbers: 0,
   ```

3. Render it next to the existing `#embersBalance` span (`:439`), gated on
   `state.entered` so it never shows over the gate/win/death screens (all of which
   already set `entered`/`winVisible`/`deathVisible` independently — the pile is a
   run-only readout, not a resource that carries into those overlays where
   `RunRecap`/`lastPayout` already covers the same total):

   ```tsx
   <span id="embersBalance">Embers: {state.embersBalance}</span>
   {state.entered && !state.winVisible && !state.deathVisible && (
     <span id="embersPile">Unbanked: {state.livePileEmbers}</span>
   )}
   ```

   Same exemption note as `embersBalance` already carries above it in the comment at
   `:436-438` applies here too — this is core game state, not a dev-tuning control,
   so it is not hidden by admin-mode's `#panel` hide either.

## Gap 2 — RunRecap hides the forfeit on death

`RunRecap` (`components/Hud.tsx:306-321`) only renders the `carried`/`home` line
fragments when `> 0`. `computeDeathPayout()` (`lib/game/economy.ts:82-92`) always
returns `carried: 0, home: 0` — so on death those two conditions are simply false and
the lines vanish instead of communicating a loss.

### Files

- `lib/game/economy.ts`
- `components/Hud.tsx`

### Change: `lib/game/economy.ts`

Export the two constants that are currently module-private (`:47-48`), so the display
layer can compute "what dying just cost you" without inventing a second copy of the
numbers:

```ts
export const CARRIED = 60; // win only -- the child's warmth
export const HOME = 25; // win only -- the doorstep
```

No other line in this file changes. `computeWinPayout`/`computeDeathPayout` keep using
the bare identifiers exactly as today.

### Change: `components/Hud.tsx`

1. Add `CARRIED, HOME` to the existing economy import (`:11`):

   ```ts
   import { nextDeeperLungsCost, veilMaxHoldForTier, CARRIED, HOME, type RunPayout } from '@/lib/game/economy';
   ```

2. Give `RunRecap` an explicit `isDeath` prop instead of inferring death from
   `payout.carried === 0` (that would also be true, but the two call sites already
   know their own context — pass it down rather than re-deriving it):

   ```tsx
   function RunRecap({ survivedSeconds, payout, balance, isDeath }: { survivedSeconds: number; payout: RunPayout | null; balance: number; isDeath: boolean }) {
     return (
       <p id="runRecap">
         time survived: {formatDuration(survivedSeconds)}
         {payout && (
           <>
             <br />
             +{payout.depth} depth · +{payout.survival} survival
             {isDeath ? (
               <> · <span className="emberLoss">-{CARRIED + HOME} lost</span> (child &amp; home, forfeited)</>
             ) : (
               <>
                 {payout.carried > 0 && <> · +{payout.carried} child</>}
                 {payout.home > 0 && <> · +{payout.home} home</>}
               </>
             )}
             {' '}= <span className="emberGain">{payout.total} embers</span> · balance: {balance}
           </>
         )}
       </p>
     );
   }
   ```

3. Update both call sites to pass the flag — win screen (`:622`) passes `false`,
   death screen (`:639`) passes `true`:

   ```tsx
   {/* win screen, :622 */}
   <RunRecap survivedSeconds={state.survivedSeconds} payout={state.lastPayout} balance={state.embersBalance} isDeath={false} />
   ```

   ```tsx
   {/* death screen, :639 */}
   <RunRecap survivedSeconds={state.survivedSeconds} payout={state.lastPayout} balance={state.embersBalance} isDeath={true} />
   ```

4. Add the `.emberLoss` style next to the existing `.emberGain` rule in
   `components/GameCanvas.tsx:299`:

   ```css
   .emberGain { color: #ffdca8; font-weight: 500; }
   .emberLoss { color: #ff8a8a; font-weight: 500; }
   ```

## Mobile

Both changes are read-only HUD text (a `<span>` and a recap line) — no new input, no
new touch target, nothing that binds a key. Desktop/mobile parity is automatic; no
`EngineActions` or `lib/input-mode.ts` change needed. State it as a one-line note in
the PR body per the mobile-parity directive; do not spend a task on it.

## Out of scope

- Gap 3 (return-leg audio going quiet on pickup) — ticket explicitly marks this
  lower-priority / note-only. Do not touch audio in this PR. If it needs engine audio
  work, file a separate follow-up ticket instead of bundling it here.
- No change to `computeWinPayout`/`computeDeathPayout` math, `TIER_MULTIPLIERS`, or
  any other pricing constant.
- No new persisted/localStorage field — `livePileEmbers` is derived, run-scoped,
  reset on every `enter()`, never written to `EmbersState`.
- No change to the mission-bonus forfeiture path (`MISSION_DEEPWATER_REWARD`) — it is
  already silently forfeited on death today (per the `LUL-1258` comment at
  `engine/forest-engine.js:3078`) and this ticket does not ask for it to be surfaced.

## Verification

1. `cd` to the repo root, then:
   ```bash
   npx tsc --noEmit
   npx eslint components/Hud.tsx engine/forest-engine.js lib/game/economy.ts
   npx next build
   ```
   All three must pass clean — no new TS errors, no new lint errors, build succeeds.

2. `npx vitest run lib/game/economy.test.ts` (or the repo's configured test runner —
   check `package.json`'s `test` script) — confirm the existing
   `computeWinPayout`/`computeDeathPayout` tests still pass unchanged; exporting
   `CARRIED`/`HOME` must not change any exported function's behavior.

3. Manual/tester note (gameplay unverified by the implementer, per role rules):
   - During a run, `#embersPile` should appear next to `#embersBalance` and its
     number should increase in integer steps as the player moves away from home and
     as time passes, then disappear the instant `winVisible`/`deathVisible` flips.
   - On death, `#runRecap` should show a `-85 lost` (red) fragment instead of no
     `carried`/`home` fragment at all. On win, the recap is pixel-identical to
     today's win recap (no `isDeath` branch reached).

## Definition of done addendum

This PR does not add, remove, or change any element's verbs/collision/interactions —
`docs/ELEMENTS.md` does not need an update for this ticket (it is a HUD-only,
data-legibility change). Confirm this holds if the diff grows beyond what's specified
above.
