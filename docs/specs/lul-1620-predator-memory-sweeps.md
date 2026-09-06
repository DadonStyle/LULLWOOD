# SPEC: predator memory return sweeps + audio tell + death-depth cap clarification

**Ticket:** LUL-1620 (child of LUL-1573, accepted ruling: `decisions/predator-memory-accepted-2026-09-05`)
**Spec owner:** Founding Engineer. **Implementer:** Game Engineer.
**Tier:** C for the code changes below (`engine/forest-engine.js` simulation: predator AI,
detection). Requires `REVIEW: APPROVED` before merge, no `[ship]`. This spec document itself
is a Tier A docs-only addition and is not gated on that review.
**Read at:** `origin/release/next @ ecb9495` (verified byte-identical to `4d065f8`, the commit
the source wiki pages cite, at every line this spec touches — re-derive if your tree has moved).
**Branch suggestion:** `lul-1620-predator-memory-sweeps`, new branch off `release/next`.

Source material (read in full before implementing; do not re-derive the design):
[[game/mechanics/predator-memory]], [[game/psychology/hidden-is-deaf]],
[[game/economy/predator-memory-depth-farming]], [[decisions/predator-memory-accepted-2026-09-05]].

## Relationship to `docs/specs/predator-memory-ring-sweep-carry-leash.md` (LUL-1447, PR #317)

That file already merged to `release/next` today and covers similar ground (memory ring-sweep +
the piano `!hidden` drop), bundled with an unrelated carry-leg chase-leash fix (LUL-1427, its
"Part B" — do not touch that part, it is a separate accepted bug and out of scope here). It has
not been implemented (grepped `origin/release/next` for `memSweeps`/`memX`/`memZ`: zero hits).

**This spec supersedes that file's Part A for implementation purposes.** Three material
differences, found by reading the current tree directly rather than trusting either wiki page:

1. That spec's Constraints section claims *"the new code uses `Math.random()`, matching the
   existing roam waypoint call it replaces."* **This is false against the current tree.** The
   roam waypoint pick at `engine/forest-engine.js:1377` reads `rng()*Math.PI*2, r=15+rng()*40` —
   the seeded module-level generator reassigned in `generateMap()` (`:698`), not `Math.random()`.
   The wiki proposal this traces to ([[game/mechanics/predator-memory]] §5) made the same claim
   and was written against an older commit (`5f0f1fa`); the call must have been converted from
   `Math.random()` to `rng()` sometime after that read, without the wiki being corrected. See
   "Determinism" under Constraints below for why this doesn't actually endanger the seeded-map
   guarantee everyone is protecting, and why the implementation below still uses `rng()`, not
   `Math.random()`, deliberately reversing that file's Change A5.
2. That spec's sweep-continuation logic is a flat `SWEEP_COUNT` decrement with no check on
   whether the player is still near the remembered point. The Game Economist's
   `predator-memory-depth-farming` brief (read after LUL-1447 was written) requires sweeps to
   *"repeat if the player stays within ~1.5–2.0x the ring radius of the last-known spot (a single
   sweep is not sufficient to stop stalling)"* — clause 4 below adds that check.
3. LUL-1447 has no clause for the death-depth cap question (this ticket's clause 4). It also
   never mentions `lib/game/economy.ts`.

Field names differ too (`p.memX/memZ/memSweeps` there vs. `p.lkpX/lkpZ/lkpSweeps` here, matching
the wiki's own naming). Do not implement both files — implement this one. Flagged to the
Founding Engineer's handoff comment on LUL-1620 as a declared deviation from what was already
merged; LUL-1447's Part B (carry-leg leash fix) should still land, just not from that file's
Part A.

---

## Clause 1 — last-known-position memory + bounded ring-biased roam

### File: `lib/game/predator.ts` — new pure helper + constants

Add after `isSniffImmune` (after line 158, before the `shouldRevertInvestigateToChase` block at
line 188 — i.e. in the existing gap, matching how every other predator decision in this file is
factored: `rollSniffs`, `stepSniffLoop`, `backOffPoint`, `flankTarget`):

```ts
// ---- last-known-position return sweep (LUL-1573/LUL-1620) -----------------------
// A predator that gives up (investigate/sniff or flank/hold, never chase's
// distance-based give-up -- see spec) stashes where it lost the player and
// gets a bounded number of ring-biased roam waypoints before it truly
// forgets. Alien: Isolation's director shape: area, not point; bounded, not
// permanent. `LKP_REPEAT_RADIUS` is the Game Economist's requirement
// (predator-memory-depth-farming.md): a camper who stays near the spot they
// were lost keeps getting re-swept; one who has genuinely moved on does not
// burn the remaining bounded count for nothing.
export const LKP_MAX_SWEEPS = 3;       // bounded return sweeps before permanent amnesia
export const LKP_RING_RADIUS = 18;     // base distance (units) of a sweep waypoint from the remembered point
export const LKP_RING_JITTER = 10;     // + 0..this: sweep waypoints land 18..28u from the remembered point
export const LKP_REPEAT_RADIUS = 32;   // ~1.78x LKP_RING_RADIUS, inside the Economist's 1.5-2.0x band

export interface RoamWaypointPick {
  x: number;
  z: number;
  /** Write back onto p.lkpSweeps. 0 means memory is cleared for real this tick. */
  sweepsLeft: number;
}

// Replaces the roam waypoint pick inline at engine/forest-engine.js:1377-1380.
// `sweepsLeft > 0` selects the ring-biased branch (search around the
// remembered point); `sweepsLeft === 0` reproduces the original uniform-
// random pick byte-for-byte (same two rng() draws, same formula), so a
// predator that has never had a memory, or whose memory already cleared,
// behaves exactly as it does on `release/next` today.
export function pickRoamWaypoint(
  rng: () => number,
  px: number, pz: number,
  lkpX: number, lkpZ: number, sweepsLeft: number,
  playerDistFromLkp: number,
): RoamWaypointPick {
  if (sweepsLeft > 0) {
    const a = rng() * Math.PI * 2;
    const r = LKP_RING_RADIUS + rng() * LKP_RING_JITTER;
    const continues = sweepsLeft - 1 > 0 && playerDistFromLkp <= LKP_REPEAT_RADIUS;
    return { x: lkpX + Math.cos(a) * r, z: lkpZ + Math.sin(a) * r, sweepsLeft: continues ? sweepsLeft - 1 : 0 };
  }
  const a = rng() * Math.PI * 2, r = 15 + rng() * 40;
  return { x: px + Math.cos(a) * r, z: pz + Math.sin(a) * r, sweepsLeft: 0 };
}
```

Add the four new names (`LKP_MAX_SWEEPS`, `LKP_RING_RADIUS`, `LKP_RING_JITTER`,
`LKP_REPEAT_RADIUS`, `pickRoamWaypoint`, `RoamWaypointPick`) to nothing else in this file — no
existing export list to edit, they're new top-level exports.

### File: `engine/forest-engine.js`

**A. Import** — add `LKP_MAX_SWEEPS` and `pickRoamWaypoint` to the existing `@/lib/game/predator`
import block at lines 76-91 (alphabetical, matching the existing order):

```diff
 import {
   backOffPoint,
   canCatchInChase,
   CATCH_MARGIN,
   isCaught,
   isSniffImmune,
+  LKP_MAX_SWEEPS,
+  pickRoamWaypoint,
   predatorSeparationPush,
   rollSniffs,
```

**B. `makePredator()` return object, line 1052** — add the three new fields (default cleared):

```diff
     packTimer:0, flankX:0, flankZ:0, sniffImmuneT:0,
+    lkpX:0, lkpZ:0, lkpSweeps:0,
     charge:null, chargeDirX:0, chargeDirZ:0, chargeCooldown:0, inert:false };
```

**C. `placePredators()` reset block, line 1094** — clear memory on every restart/regen, same as
every other per-predator timer here (predators must not carry a stale memory into a fresh map):

```diff
     p.packTimer=0; p.flankX=0; p.flankZ=0; p.sniffImmuneT=0;
+    p.lkpX=0; p.lkpZ=0; p.lkpSweeps=0;
     p.charge=null; p.chargeDirX=0; p.chargeDirZ=0; p.chargeCooldown=0;
```

**D. Give-up transition #1 — investigate/sniff loop, line 1457:**

```diff
           if(sniffOutcome.next === 'back'){ p.inv='back'; const bd = 8 + rng()*8;
             [p.backX, p.backZ] = backOffPoint(p.x, p.z, ux, uz, bd, half, zMax); }
-          else { p.state='roam'; p.spotted=false; }
+          else { p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; }
```

**E. Give-up transition #2 — flank/hold loop, line 1481:**

```diff
           if(holdOutcome.next === 'hold') p.sniffTimer = rnd(1,4);
-          else { p.state='roam'; p.spotted=false; p.inv=''; }
+          else { p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; p.inv=''; }
```

**F. Roam waypoint pick, lines 1377-1380** — replace the inline uniform pick with the pure
helper, preserving the exact existing double-clamp / `keepWaypointOffLake` order:

```diff
-        if(wd < 2.5){ const a=rng()*Math.PI*2, r=15+rng()*40;
-          let nwx=clamp(p.x+Math.cos(a)*r,-half+4,half-4), nwz=clamp(p.z+Math.sin(a)*r,-half+4,zMax-4);
-          const kept = keepWaypointOffLake(nwx, nwz, CONFIG.lake);
-          p.wpx=clamp(kept.x,-half+4,half-4); p.wpz=clamp(kept.z,-half+4,zMax-4); }
+        if(wd < 2.5){
+          const distFromLkp = Math.hypot(player.x - p.lkpX, player.z - p.lkpZ);
+          const pick = pickRoamWaypoint(rng, p.x, p.z, p.lkpX, p.lkpZ, p.lkpSweeps, distFromLkp);
+          p.lkpSweeps = pick.sweepsLeft;
+          let nwx=clamp(pick.x,-half+4,half-4), nwz=clamp(pick.z,-half+4,zMax-4);
+          const kept = keepWaypointOffLake(nwx, nwz, CONFIG.lake);
+          p.wpx=clamp(kept.x,-half+4,half-4); p.wpz=clamp(kept.z,-half+4,zMax-4); }
```

### Deliberately NOT touched — the third give-up-to-roam path

`shouldGiveUpChase()`'s call site at `engine/forest-engine.js:1418`
(`if(shouldGiveUpChase(p.scentLock, dist, p.spec.detect)){ p.state='roam'; p.spotted=false; }`)
is a **third** transition into `roam` that neither the wiki proposal nor the accepted decision
names — both say "the two give-up transitions." This is a chase giving up because the scent
lock expired and the player is already beyond `1.5x` detect range — i.e., the player has already
escaped to distance, not the "hid nearby and it gave up" scenario the camping exploit and this
fix are about. Leaving it unmodified is consistent with the accepted decision's explicit scope
(exactly two transitions) and does not reopen the camping exploit (a player reachable by this
path is, by definition, already far away). Not filing a follow-up ticket for it — noting it here
so nobody rediscovers it as a bug later.

### Determinism — the `rng()` vs `Math.random()` question, resolved

The roam waypoint pick draws from the seeded `rng` (module-level, reassigned in `generateMap()`
at `:698`), not `Math.random()`. This still does not touch "`generateMap()`'s seeded rng
stream" in the sense the constraint is protecting: `generateMap()` finishes generating the map
(trees, cover, baby position, initial predator placement) and returns *before* any predator ever
reaches `roam`'s waypoint-repick branch — nothing downstream of that point re-reads `rng()` for
map layout, and a fresh `generateMap(seed)` call (restart/regen) discards the old generator
entirely (`rng = mulberry32(seed >>> 0)`), so draws consumed during a prior game's roam behavior
never leak into the next map. `pickRoamWaypoint`'s ring branch draws exactly two `rng()` calls
per repick (angle, radius-with-jitter), same shape as the uniform branch it's next to — it does
not change the draw *pattern* of the existing call, only adds a second call site for the exact
same generator, exercised only by gameplay that happens after map generation is already done.
QA's pinned map seed depends on `generateMap()`'s own output being reproducible, which this
does not touch.

---

## Clause 2 — audio tell, inbound-only

### File: `engine/forest-engine.js`

**A. Extend `approaching`, line 3274:**

```diff
-      if(p.state==='chase' || p.hunt || (p.state==='investigate' && p.inv!=='back')) approaching = true;
+      if(p.state==='chase' || p.hunt || (p.state==='investigate' && p.inv!=='back') || (p.state==='roam' && p.lkpSweeps > 0)) approaching = true;
```

**B. Drop `!hidden` from the piano gate, line 3283:**

```diff
-    if(approaching && nearDist < 46 && !hidden){
+    if(approaching && nearDist < 46){
```

That's the entire audio change. No new constant for "piano radius while hidden" — there was never
a separate hidden-case radius; `nearDist < 46` is the one literal threshold used both here and in
`near01`'s calc two lines below (`:3286`), and removing `!hidden` makes the existing 46u check
apply while hidden too, exactly matching the Economist's "match the standing radius, 46u"
answer. (There is no `THREAT_DETECTION_RADIUS` named constant in the current tree — the ticket
description's citation of one is stale; `46` is a bare literal at both `:3283` and `:3286`. Do
not introduce a new named constant for this — that would be an unrequested refactor of a value
this spec does not change.)

**Why "inbound-only" needs no extra logic:** `p.lkpSweeps` is decremented (or zeroed) at the
moment each new ring waypoint is picked (clause 1, step F above), and hits `0` on the very
repick that ends the search — whether because the bounded count ran out or because the player
left `LKP_REPEAT_RADIUS`. Since `approaching`'s new clause reads `p.lkpSweeps > 0`, it goes false
on the same tick the search ends, before the predator's final (now-unbiased or already-in-flight)
leg begins. There is no separate "walking away" sub-state to gate off; the counter already
carries that information. This matches the Economist's answer exactly: *"the piano should sound
during approach, not after the predator has given up... audio should stop"* the moment the sweep
fails.

---

## Clause 3 — `sinceClose` / lines 3280-3281: UNCHANGED

**Do not touch:**

```js
    if(nearDist < 20) sinceClose = 0; else sinceClose += dt;                           // :3280
    if(sinceClose > 30 && nearP && !hidden){ nearP.hunt = true; spotOnto(nearP); sinceClose = 12; }  // :3281
```

This was proposed (move the `!hidden` gate off this block) and traced-and-rejected on
[[game/mechanics/predator-memory]] (Scout's reply, "Rejected: 'move the `!hidden` gate off
`:3212`'"). The traced sequence: `spotOnto()` fires unconditionally (roar + full-screen flash,
zero warning) → the `hunt` branch's own `canSee` check fails on the very first tick because a
hidden player is outside the hidden-cover detect radius (~7.6-8.6u) while the trigger condition
guarantees `nearDist >= 20` → `hunt` self-cancels into `investigate/'approach'` → that branch
calls `stepApproach(ux, uz, ...)` with `ux/uz` computed from the **live** player position every
tick → the predator walks straight at wherever the player actually is. That is a worse jump
scare than the exploit it would fix, and moving this gate does not touch the piano either (it is
a different clause, `:3283` above). The accepted decision ([[decisions/predator-memory-accepted-2026-09-05]])
rules this explicitly: *"Rejected, explicitly, on traced behavior, not preference."*

If your own read of the current code disagrees with that trace — re-read the Scout's reply on
the wiki page first (it is verbatim with line numbers); if you still disagree after that, stop
and report rather than reconciling silently, per the spec-vs-code disagreement protocol. Do not
implement a change to this block as part of this ticket either way.

---

## Clause 4 — death-depth cap: NO CHANGE, resolved and documented

**Finding: `lib/game/economy.ts`'s `computeDeathPayout` already implements the objective-relative
cap and needs no change for this ticket.**

```ts
export function computeDeathPayout(
  maxDistFromHome: number,
  survivedSeconds: number,
  objectiveDistFromHome: number,
  tier: DifficultyTier = 'lantern',
): RunPayout {
  const depth = Math.min(computeDepth(maxDistFromHome), computeDepth(objectiveDistFromHome));
  ...
}
```

This is exactly [[game/economy/depth-cap-correction]]'s §3 fix (LUL-1192), already CTO-ruled
(`decisions/depth-cap-objective-2026-09-02`, referenced there) and already shipped — called at
one site, `engine/forest-engine.js:2852`, with `baby.x/baby.z` (the objective) passed as
`objectiveDistFromHome`'s source, per that decision's own verification note that `baby.x/z` are
never reassigned during carry.

**Resolving the ambiguity the decision doc flagged:** [[game/economy/predator-memory-depth-farming]]'s
"What I need the CEO to rule alongside this" section is internally inconsistent — one sentence
says cap at `maxDistFromHome` ("eliminating the exploit"), the next says deaths "pay at the
spawn-distance cap regardless," and its numbers table (11-15 vs. today's 13-23) reads as a
*tightening* of the existing cap, not a switch to the uncapped `maxDistFromHome` term (capping a
value at itself is a no-op, so "cap at maxDistFromHome" as a literal instruction cannot be what
produces a lower number in their own table).

Reading the actual economic argument rather than the inconsistent prose: predator-memory (clauses
1-3) closes the *indefinite-stillness* farming route (bounded sweeps mean camping forever is no
longer safe). The residual concern raised is a player who, unable to camp indefinitely, instead
runs far out and lets a predator kill them to bank a death payout. But that payout is **already**
bounded by `min(maxDistFromHome, objectiveDistFromHome)` — a player who runs *past* the child to
maximize `maxDistFromHome` gains nothing over running exactly to the child, because the cap picks
the smaller of the two regardless of how far past the objective they go. Predator-memory does not
create a new gap in this cap; it removes the *other* farming route (stillness) that the cap was
never designed to address. No incremental tightening is justified by predator-memory specifically.

**Decision: ship clauses 1-3 with `lib/game/economy.ts` unchanged.** Not blocking clauses 1-3 on
this per the accepted decision's own instruction. Post a comment to the Game Economist
referencing this spec's reasoning so they can confirm or push back with a concrete new formula —
if they identify an actual gap this analysis misses, that becomes a follow-up ticket against
`economy.ts` alone, independent of clauses 1-3.

---

## Files touched

| File | Change |
|---|---|
| `lib/game/predator.ts` | new: `LKP_MAX_SWEEPS`, `LKP_RING_RADIUS`, `LKP_RING_JITTER`, `LKP_REPEAT_RADIUS`, `RoamWaypointPick`, `pickRoamWaypoint()` |
| `engine/forest-engine.js` | import addition; `makePredator()` (:1052); `placePredators()` reset (:1094); two give-up transitions (:1457, :1481); roam waypoint pick (:1377-1380); `approaching` (:3274); piano gate (:3283) |
| `lib/game/predator.test.ts` | new unit tests for `pickRoamWaypoint` (see Verification) |
| `docs/ELEMENTS.md` | update the Wolf/Bear/Lion roam bullet (currently "Roam via random waypoints when nothing has noticed the player," `game/ELEMENTS.md` line ~246-247) to describe the bounded ring-biased return sweep. Required in the same PR per the studio's definition of done — this is the element-registry update, not optional polish. |
| `lib/game/economy.ts` | **no change** (clause 4, resolved above) |

No other files. No new assets. No new UI. No `components/MobileControls.tsx` changes — this is
audio and AI-only; mobile and desktop see identical behavior with zero new input.

## Constraints

- Do not touch the `investigate` state's sniff-loop timing (`sniffsLeft`/`rollSniffs`/
  `stepSniffLoop`/`stepFlankHold`) — LUL-22 pinned this explicitly; this ticket changes only
  *where the animal wanders after giving up*, not how long it sniffs before giving up.
- Do not make the ring-biased search home on the player's *live* position. `pickRoamWaypoint`'s
  ring is centered on `lkpX/lkpZ` (fixed at the moment of give-up), never re-centered on
  `player.x/z`. The only place live player position is read is the `playerDistFromLkp`
  continue/stop check, which decides *whether* to keep sweeping, not *where* to sweep.
- Do not change `shouldGiveUpChase()`'s signature or behavior in `lib/game/predator.ts` — out of
  scope (that's LUL-1427's carry-leg leash fix, a separate accepted ticket).
- `keepWaypointOffLake()` must still run on every waypoint, memory-biased or not — unchanged
  from current behavior, preserved in step F above.
- `generateMap()`'s seeded rng stream and QA's pinned map seed are unaffected — see the
  Determinism note under Clause 1.
- Desktop and mobile are identical: no new input, no HUD, nothing added to
  `components/MobileControls.tsx` or `engine/forest-engine.d.ts`'s `EngineActions`.

## Out of scope (deferred, not forgotten — do not implement any of this here)

- Rewriting the investigate loop to home on the remembered position instead of the live position
  (Scout's "fuller version" item 2). Psychologist's read: not yet, unmeasurable until the tell
  exists — ship this ticket, measure it, decide later.
- Wolf-pack shared memory (a pack leader seeding both flankers' sweeps on one remembered point).
- Any run timer, stamina drain while hidden, or "the bramble gets uncomfortable" — explicitly
  rejected mechanisms; the fix is the forest noticing, not a clock.
- `docs/specs/predator-memory-ring-sweep-carry-leash.md`'s Part B (carry-leg chase leash fix,
  LUL-1427) — separate accepted bug, untouched by this spec, should still ship on its own.
- Any change to `lib/game/economy.ts` — clause 4 concludes none is needed; see above.

## Verification

### Unit tests — `lib/game/predator.test.ts`

Add a new section following the file's existing convention (deterministic fake `rng` functions,
`node:test` + `node:assert/strict`, same style as the `rollSniffs`/`isCaught` tests already in
the file):

```ts
import { LKP_MAX_SWEEPS, LKP_RING_RADIUS, LKP_RING_JITTER, LKP_REPEAT_RADIUS, pickRoamWaypoint } from './predator.ts';

// ---- pickRoamWaypoint (LUL-1620) ------------------------------------------------

test('pickRoamWaypoint with no live memory (sweepsLeft=0) reproduces the original uniform pick around the predator', () => {
  const calls = [0.25, 0.5];
  const rng = () => calls.shift()!;
  const pick = pickRoamWaypoint(rng, /*px*/10, /*pz*/20, /*lkpX*/0, /*lkpZ*/0, /*sweepsLeft*/0, /*dist*/999);
  const a = 0.25 * Math.PI * 2, r = 15 + 0.5 * 40;
  assert.equal(pick.x, 10 + Math.cos(a) * r);
  assert.equal(pick.z, 20 + Math.sin(a) * r);
  assert.equal(pick.sweepsLeft, 0);
});

test('pickRoamWaypoint with live memory centers the waypoint on the remembered point, not the predator', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, /*px*/500, /*pz*/500, /*lkpX*/10, /*lkpZ*/20, /*sweepsLeft*/2, /*dist*/0);
  // a=0 -> cos=1, sin=0; r = LKP_RING_RADIUS + 0*LKP_RING_JITTER
  assert.equal(pick.x, 10 + LKP_RING_RADIUS);
  assert.equal(pick.z, 20);
});

test('pickRoamWaypoint decrements sweepsLeft while the player is still within the repeat radius', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, 0, 0, 0, 0, 2, LKP_REPEAT_RADIUS - 1);
  assert.equal(pick.sweepsLeft, 1);
});

test('pickRoamWaypoint clears memory once the bounded sweep count is exhausted, even if the player is still close', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, 0, 0, 0, 0, 1, 0);
  assert.equal(pick.sweepsLeft, 0);
});

test('pickRoamWaypoint clears memory early when the player has left the repeat radius, even with sweeps remaining', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, 0, 0, 0, 0, LKP_MAX_SWEEPS, LKP_REPEAT_RADIUS + 0.01);
  assert.equal(pick.sweepsLeft, 0);
});

test('pickRoamWaypoint is inclusive at exactly the repeat radius boundary', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, 0, 0, 0, 0, 2, LKP_REPEAT_RADIUS);
  assert.equal(pick.sweepsLeft, 1);
});
```

Run: `npm test` (or the project's configured `node --test` invocation for `lib/game/*.test.ts` —
match whatever the existing `predator.test.ts` suite is invoked with). **Pass condition:** all
new tests green, all pre-existing tests in `predator.test.ts` and `economy.test.ts` still green
(the latter proves clause 4's "no change" claim — if any economy test fails, that is a signal
this spec's clause 4 read is wrong and it should bounce back, not be reconciled silently).

### Build / type / lint

```bash
cd /home/noam/lullwood
next build
tsc --noEmit
npm run lint   # eslint via the lint script -- next lint is gone in Next.js 16
```
Expected: zero errors on all three.

### e2e regression — must still pass unchanged

```bash
npx playwright test e2e/scent.spec.ts e2e/predator-determinism.spec.ts
```
**Pass condition, explicitly named because this is the ticket's own regression risk:**
`e2e/scent.spec.ts`'s assertions on `scentCalls` staying low must still pass. Clauses 1-2 do not
touch `checkScent()`/`scentOnto()` at all — the ring-bias only changes waypoint *destination*
picking inside `roam`; the `canSee`/`checkScent`/`checkNoise` re-detection chain above it
(`:1372-1374`) is untouched — so a predator on a return sweep re-triggering `scentOnto()`'s roar
would indicate a real regression, not an expected side effect of this change.
`predator-determinism.spec.ts` passing unchanged is the regression proof for the seeded-rng
concern under "Determinism" above.

### New e2e coverage — audio tell (Tier C, needs a human-verifiable assertion, not just a hook)

Add `e2e/predator-memory.spec.ts`. This spec pins the QA hooks and assertions; match
`e2e/scent.spec.ts`'s established polling-via-`page.evaluate` pattern for the actual Playwright
plumbing (timeouts, retry loop) rather than inventing new boilerplate.

Required new QA hook, `window.ForestEngine.qaGetPredatorLkp(idx)`, next to the existing
`qaSetPredatorRoam` (`:2515`) in the same `window.ForestEngine` block:
```js
window.ForestEngine.qaGetPredatorLkp = function(idx){
  const p = predators[idx];
  if(!p) return null;
  return { lkpX: p.lkpX, lkpZ: p.lkpZ, lkpSweeps: p.lkpSweeps };
};
```

Assertions the new spec must make:
1. Force a predator through the investigate/sniff give-up transition (existing scent/chase QA
   hooks already stage a chase; let the sniff loop run out, or add a
   `qaForceInvestigateGiveUp(idx)` hook if driving the real timers is too slow/flaky — follow
   `qaSetPredatorRoam`'s comment about avoiding teleport-based hooks that destroy cover staging).
   Assert `qaGetPredatorLkp(idx).lkpSweeps === LKP_MAX_SWEEPS` immediately after.
2. With the player hidden (`qaTeleportToHideSpot()` or equivalent) and a predator mid-sweep
   (`lkpSweeps > 0`), assert the piano is audible — the harness will need a QA-exposed read of
   whatever the audio layer's "is playing" state is (check for an existing hook before adding a
   new one; if none exists, add the smallest one that exposes `pianoTimer`'s active state without
   exposing raw Web Audio internals).
3. Once `lkpSweeps` reaches `0` (sweep count exhausted or player moved beyond
   `LKP_REPEAT_RADIUS`), assert the piano stops within one tick — i.e., `approaching` is false
   for that predator's contribution to the module-level `approaching` flag.
4. Assert `scentCalls` does not increment during a sweep unless `canSee`/`checkScent` genuinely
   re-acquire the player (i.e., this new spec should not weaken `scent.spec.ts`'s existing
   guarantee, just add memory-specific coverage).

### Console on load

No new JS errors on page load or game start (unchanged requirement).

### Game Tester play verdict — Tier C

QA is currently paused per the founder's 2026-09-04 note in the studio directives; if reactivated
before this merges, ask specifically:

1. Does a wolf that gave up sniffing and left visibly circle back, audible before it's close?
2. Is the piano's arrival distinguishable from the old spot/roar cues (i.e., does it read as
   "something is searching," not "you've been caught")?
3. Can a well-hidden player still outlast the bounded sweeps (hiding remains a real escape, not
   omniscient tracking)?
4. Does leaving the area (moving well away from where you were lost) actually shorten the
   harassment, per `LKP_REPEAT_RADIUS`'s early-clear behavior?
