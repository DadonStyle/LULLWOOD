# SPEC: stop the bounded return-sweep count from refilling mid-sweep

**Ticket:** LUL-2505 (local-qa nightly LUL-2488, `e2e/predator-memory.spec.ts` :: "the piano
stops once the bounded sweep count is exhausted"). **Spec owner + implementer:** Founding
Engineer — root cause fully nailed down by reading (see below); small enough (3 call sites,
1 new pure helper) to self-implement in the same pass rather than delegate.
**Tier:** C — `engine/forest-engine.js` predator-AI simulation. Requires `REVIEW: APPROVED`
before merge, no `[ship]`.
**Read at:** `origin/release/next @ 057babc` (2026-09-12T02:58:27Z).
**Branch:** `lul-2505-piano-sweep-fix`, off `release/next`.
**Original design:** `docs/specs/lul-1620-predator-memory-sweeps.md` (LUL-1620/1737),
[[decisions/predator-memory-accepted-2026-09-05]].

## Root cause

`p.lkpSweeps` counts down 3→2→1→0 only inside `pickRoamWaypoint()` at waypoint arrival
(`engine/forest-engine.js:2379-2380`), gated on `sweepsLeft - 1 > 0 && playerDistFromLkp <=
LKP_REPEAT_RADIUS` (`lib/game/predator.ts:213`). That part is correct and already unit-tested.

The bug is in the three give-up-to-roam transitions that *arm* the memory
(`engine/forest-engine.js:2527`, `:2534`, `:2558` — investigate/sniff, carry-leg leave, and
flank/hold respectively). Each one unconditionally does:

```js
p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; ...
```

with no check on whether the predator already had a live, unexhausted sweep in progress. A
predator that is mid-sweep (`lkpSweeps` at, say, 1) and gets re-alerted by any of `roam`'s
non-sight detection channels — `checkScent()` (`:1829`, no `hidden` gate at all),
`checkNoise()`/`hearNoise()` (`:1898`/`1904`, footstep-noise roll, no `hidden` gate),
`hearCry()` (`:1935`, baby-cry roll, no `hidden` gate) — is diverted into `investigate`
(`hearNoise`/`hearCry` both do `p.state='investigate'`) or `chase` (`scentOnto`). When *that*
detour's own give-up fires, the transition rearms `lkpSweeps = LKP_MAX_SWEEPS` from scratch,
even though the predator never finished its original bounded sweep. This is a full refill, not
a decrement — the "bounded, not permanent" contract LUL-1620/1573 was built to guarantee (and
the Economist's `predator-memory-depth-farming.md` requirement that camping doesn't earn free
re-sweeps) is defeated exactly when a re-alert happens to land mid-sweep.

Why this reproduces reliably in `e2e/predator-memory.spec.ts` and not (yet) as a live complaint:
`isSniffImmune(sniffImmuneT, hidden)` (`lib/game/predator.ts:172`) is the *only* guard on that
re-detection chain while hidden, and it is armed to `SNIFF_IMMUNITY_TIME = 1.5` (`:171`) exactly
once, at the moment of give-up (`:2513`/`:2556`) — never re-armed while a sweep is in progress.
"the piano stops once the bounded sweep count is exhausted" fast-forwards through all 3 sweep
legs via `qaFastForwardPredatorToWaypoint` + real-tick polling
(`e2e/predator-memory.spec.ts:140-150`), and per that file's own comment (`:38-42`,
`docs/specs/lul-2329-e2e-migrate-qaworld-micro.md`) it runs on the **full map with no isolation
from the other 8 predators**, over a **multi-second real-wall-clock window**. 1.5s of immunity
does not reliably cover a multi-second polling loop, so `sniffImmuneT` decays to 0 mid-sequence,
the re-detection chain goes live again, and the stationary hidden player (plus whatever ambient
scent/noise/cry sources exist on the full map) supplies a plausible re-trigger — refilling
`lkpSweeps` back to 3 before it ever reads 0. This matches the two reported failures exactly:
"lkpSweeps did not reach 0" (it keeps getting refilled) and the piano staying audible (the gate
at `:5611` reads `p.lkpSweeps > 0`, which stays true under the refill loop).

This is a real simulation bug, not purely a QA-harness artifact: the same refill can happen in
live gameplay any time a predator's return sweep is interrupted by a fresh noise/scent/cry
before it naturally exhausts — it just needs a multi-second window and a nearby detection source
to surface, which the full-map QA harness makes far more likely than a fast real play session.

## Fix — `lib/game/predator.ts`

Add a pure helper next to `pickRoamWaypoint`, reusing the exact `LKP_REPEAT_RADIUS` distance
test `pickRoamWaypoint`'s own `continues` check already uses (same "camper near the same spot"
definition), so the two functions agree on what "still mid-sweep, same spot" means:

```ts
// LUL-2505: a give-up-to-roam transition should only arm a *fresh* LKP_MAX_SWEEPS memory if
// there isn't already a live, unexhausted one for this same last-known-position -- otherwise a
// predator that gets briefly re-alerted (scent/noise/cry, none of which check `hidden`) mid-sweep
// and then gives up again gets a free refill, silently defeating the bound (LUL-1620/1573) and
// reopening the camping exploit it closed. "Still live, same spot" reuses pickRoamWaypoint's own
// LKP_REPEAT_RADIUS test against the *existing* lkpX/lkpZ, not the fresh give-up position -- the
// two must agree on what counts as "the same spot" or a predator could get a partial-refill edge
// case where the distance test passes here but fails on the very next arrival.
export function armReturnSweep(
  lkpSweeps: number, lkpX: number, lkpZ: number,
  playerX: number, playerZ: number,
): { lkpX: number; lkpZ: number; lkpSweeps: number } {
  if (lkpSweeps > 0 && Math.hypot(playerX - lkpX, playerZ - lkpZ) <= LKP_REPEAT_RADIUS) {
    return { lkpX, lkpZ, lkpSweeps };   // mid-sweep, same spot -- preserve, do not refill
  }
  return { lkpX: playerX, lkpZ: playerZ, lkpSweeps: LKP_MAX_SWEEPS };   // fresh loss of trail
}
```

Export it alongside the other named exports (no new file, no new import elsewhere needed
beyond the one `engine/forest-engine.js` import block below).

## Fix — `engine/forest-engine.js`

**A. Import** — add `armReturnSweep` to the existing `@/lib/game/predator` import block
(alphabetical, next to `LKP_MAX_SWEEPS`/`pickRoamWaypoint`).

**B. Three call sites**, replacing the inline `p.lkpX=...; p.lkpZ=...; p.lkpSweeps=...;` triplet
with the helper. All other fields on that line (`p.state='roam'`, `p.spotted=false`,
`logChronicle(...)`, `p.gaveUpAt = clock.elapsedTime`, and — for the flank/hold and carry-leave
sites — `p.inv=''`) are unchanged; only the three memory fields route through the helper.

`:2527` (investigate/sniff give-up):
```diff
-          else { p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind }); p.gaveUpAt = clock.elapsedTime; }
+          else { const arm = armReturnSweep(p.lkpSweeps, p.lkpX, p.lkpZ, player.x, player.z); p.lkpX=arm.lkpX; p.lkpZ=arm.lkpZ; p.lkpSweeps=arm.lkpSweeps; p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind }); p.gaveUpAt = clock.elapsedTime; }
```

`:2534` (carry-leg `leave` give-up, LUL-1857 §A5) and `:2558` (flank/hold give-up) get the
identical substitution of the three-field triplet for the `arm = armReturnSweep(...)` +
3-field-assignment pattern above; both keep `p.inv=''` immediately after.

Do not touch `makePredator()` (`:1721`), `placePredators()` reset (`:1767`), or the
`qaBuildScene`-path reset (`:4709`) — those are unconditional-clear paths (new predator / map
regen), correctly bypassing the helper entirely; `armReturnSweep` only applies at the give-up
moment, not at spawn.

## Deliberately not changed

- `pickRoamWaypoint()` itself — the decrement-at-arrival logic is already correct and already
  unit-tested; this bug is entirely in the *arming* side.
- `SNIFF_IMMUNITY_TIME` — not touched. Extending it would shrink the reproduction window but
  wouldn't fix the underlying refill logic (a long enough hidden-and-stationary session would
  still eventually hit it), and changing shared immunity tuning is out of this bug's scope.
- The third give-up-to-roam path (`shouldGiveUpChase()`'s call site) — per the original LUL-1620
  spec, this is the chase-distance give-up (player already fled beyond ~1.5x detect range), a
  different scenario from "lost trail while investigating/flanking nearby," and it does not
  touch `lkpSweeps` at all today. Leaving it alone is consistent with LUL-1620's original scope
  decision, restated here rather than re-litigated.

## Test plan

### Unit — `lib/game/predator.test.ts`

New `armReturnSweep` cases, next to the existing `pickRoamWaypoint` block:
1. `lkpSweeps=0` (no live memory) → always arms fresh (`LKP_MAX_SWEEPS`, new lkpX/lkpZ) — the
   ordinary "first ever give-up" case, unchanged from today's behavior.
2. `lkpSweeps=2`, player within `LKP_REPEAT_RADIUS` of the *existing* lkpX/lkpZ → preserves
   `lkpSweeps=2` and the *existing* lkpX/lkpZ (does not overwrite with the new player position).
3. `lkpSweeps=2`, player past `LKP_REPEAT_RADIUS` → treated as a fresh loss of trail (arms
   `LKP_MAX_SWEEPS` at the new position) — a camper who has actually moved on doesn't get
   penalized by an unrelated stale memory.
4. Boundary: exactly at `LKP_REPEAT_RADIUS` → preserves (inclusive, matching
   `pickRoamWaypoint`'s own inclusive boundary test).

Existing `pickRoamWaypoint` tests are unaffected (that function's signature/behavior doesn't
change).

### e2e — `e2e/predator-memory.spec.ts`

The existing failing test ("the piano stops once the bounded sweep count is exhausted") is the
regression proof for the reported symptom — it should now pass because `lkpSweeps` can no longer
be refilled while `> 0`, so the 3-arrival countdown is monotonic and reaches 0 within the test's
existing `LKP_MAX_SWEEPS_PLUS_MARGIN` loop regardless of any mid-sweep re-alert.

Add one new test that exercises the exact refill bug directly, deterministically, with existing
hooks only (no new QA hook needed — `qaStagePredatorGiveUp`, `qaGetPredatorLkp`, `qaPredatorState`
already cover it):

```
test('a predator re-alerted mid-sweep does not have its return-sweep count refilled')
```
- `qaStagePredatorGiveUp('bear', 20, 0)` → poll `lkpSweeps === 3`.
- `qaFastForwardPredatorToWaypoint(idx)` once → poll `lkpSweeps === 2` (deterministic: player
  hasn't moved, so `playerDistFromLkp` stays 0, always inside `LKP_REPEAT_RADIUS`).
- Call `qaStagePredatorGiveUp('bear', 20, 0)` again on the same predator — this hook only sets
  `state='investigate', inv='sniff', sniffsLeft=1, sniffTimer=0.001` (does not touch
  `lkpX`/`lkpZ`/`lkpSweeps`), i.e. exactly simulates "got re-alerted mid-sweep, now about to give
  up again" without waiting out a real re-detection roll.
- Poll for `qaPredatorState(idx).state === 'roam'` (the second give-up completing).
- Assert `qaGetPredatorLkp(idx).lkpSweeps === 2` — **pre-fix this reads 3** (refilled); post-fix
  it stays 2 (preserved). This is the one assertion that would have caught LUL-2505 directly.

### Regression — must still pass unchanged

```bash
npx playwright test e2e/predator-memory.spec.ts e2e/scent.spec.ts
node --test lib/game/predator.test.ts
npx tsc --noEmit
npm run lint
```

### Console on load

No new JS errors (unchanged requirement).

## `## e2e` section (for the local-qa / Code Reviewer gate)

Covered above: the pre-existing failing spec now passes, plus one new deterministic case in the
same file using only existing hooks (`qaStagePredatorGiveUp`, `qaGetPredatorLkp`,
`qaPredatorState`) — no new hook, no `.d.ts` change. Manual/local-qa: none needed beyond the
Playwright suite: the fix is a pure-logic change to an existing, already-QA'd audio/memory gate.
