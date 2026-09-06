# SPEC: Predator memory ring-sweep + carry-leg chase leash fix

**Ticket:** LUL-14b25b17 (unassigned → Founding Engineer writes spec, Game Engineer implements)
**Tier:** C — core predator AI/detection simulation. Requires `REVIEW: APPROVED` + Game Tester play verdict before merge.
**Branch:** `lul-1420-1427-predator-memory-carry-leash` (new branch off `release/next`)

Two accepted bugs in one PR because both touch the same predator give-up/chase-state code. Shipping separately risks conflicting diffs.

---

## Part A — Predator memory ring-sweep (LUL-1420 + LUL-1422)

### What changes

**File 1: `engine/forest-engine.js`**

**Change A1 — add memory fields to `makePredator()` return object (line 1047)**

Locate the closing line of `makePredator()`'s return object (currently ends at line 1047):
```js
    charge:null, chargeDirX:0, chargeDirZ:0, chargeCooldown:0, inert:false };
```
Replace with:
```js
    charge:null, chargeDirX:0, chargeDirZ:0, chargeCooldown:0, inert:false,
    memX:0, memZ:0, memSweeps:0 };
```

**Change A2 — reset memory fields in `placePredators()` (line 1087)**

Locate the init block inside `placePredators()` (the two lines starting with `p.stuckT=0` and `p.packTimer=0`):
```js
    p.stuckT=0; p.trail=[]; p.trailT=0; p.reroute=0; p.hunt=preset.startHunting; p.alert=0; p.scentLock=0; p.scentCalls=0;
    p.packTimer=0; p.flankX=0; p.flankZ=0; p.sniffImmuneT=0;
```
Replace with:
```js
    p.stuckT=0; p.trail=[]; p.trailT=0; p.reroute=0; p.hunt=preset.startHunting; p.alert=0; p.scentLock=0; p.scentCalls=0;
    p.packTimer=0; p.flankX=0; p.flankZ=0; p.sniffImmuneT=0;
    p.memX=0; p.memZ=0; p.memSweeps=0;
```

**Change A3 — stash last-known position at sniff-loop give-up (line 1440)**

Locate the sniff-loop exhausted else branch (currently at line 1440):
```js
          else { p.state='roam'; p.spotted=false; }
```
Replace with:
```js
          else { p.memX=player.x; p.memZ=player.z; p.memSweeps=SWEEP_COUNT; p.state='roam'; p.spotted=false; }
```

**Change A4 — stash last-known position at flank-hold give-up (line 1464)**

Locate the flank-hold exhausted else branch (currently at line 1464):
```js
          else { p.state='roam'; p.spotted=false; p.inv=''; }
```
Replace with:
```js
          else { p.memX=player.x; p.memZ=player.z; p.memSweeps=SWEEP_COUNT; p.state='roam'; p.spotted=false; p.inv=''; }
```

**Change A5 — bias roam waypoint toward memory ring (line 1360)**

Locate the roam waypoint pick inside `if(wd < 2.5)` (currently at line 1360):
```js
        if(wd < 2.5){ const a=Math.random()*Math.PI*2, r=15+Math.random()*40;
          let nwx=clamp(p.x+Math.cos(a)*r,-half+4,half-4), nwz=clamp(p.z+Math.sin(a)*r,-half+4,zMax-4);
          const kept = keepWaypointOffLake(nwx, nwz, CONFIG.lake);
          p.wpx=clamp(kept.x,-half+4,half-4); p.wpz=clamp(kept.z,-half+4,zMax-4); }
```
Replace with:
```js
        if(wd < 2.5){
          let nwx, nwz;
          if(p.memSweeps > 0){
            p.memSweeps--;
            const a=Math.random()*Math.PI*2, r=SWEEP_RING_MIN+Math.random()*SWEEP_RING_RANGE;
            nwx=clamp(p.memX+Math.cos(a)*r,-half+4,half-4); nwz=clamp(p.memZ+Math.sin(a)*r,-half+4,zMax-4);
          } else {
            const a=Math.random()*Math.PI*2, r=15+Math.random()*40;
            nwx=clamp(p.x+Math.cos(a)*r,-half+4,half-4); nwz=clamp(p.z+Math.sin(a)*r,-half+4,zMax-4);
          }
          const kept = keepWaypointOffLake(nwx, nwz, CONFIG.lake);
          p.wpx=clamp(kept.x,-half+4,half-4); p.wpz=clamp(kept.z,-half+4,zMax-4); }
```

**Change A6 — add memory-returning roam predators to `approaching` (line 3187)**

Locate the approaching assignment (currently at line 3187):
```js
      if(p.state==='chase' || p.hunt || (p.state==='investigate' && p.inv!=='back')) approaching = true;
```
Replace with:
```js
      if(p.state==='chase' || p.hunt || (p.state==='investigate' && p.inv!=='back') || (p.state==='roam' && p.memSweeps > 0)) approaching = true;
```

**Change A7 — drop `!hidden` from piano gate (line 3196)**

Locate the piano condition (currently at line 3196):
```js
    if(approaching && nearDist < 46 && !hidden){
```
Replace with:
```js
    if(approaching && nearDist < 46){
```

**Change A8 — add tuning constants** (add near the top of the engine, adjacent to other predator constants like `STILL_DETECT_CUT` — search for `SNIFF_IMMUNITY_TIME` and add just below it):

```js
const SWEEP_COUNT       = 3;    // ring sweeps a predator gets after giving up; Game Economist tunes
const SWEEP_RING_MIN    = 8;    // inner ring radius (units); close enough to threaten the hide spot
const SWEEP_RING_RANGE  = 14;   // ring width (so endpoints land 8..22 units from last-known position)
```

Find `SNIFF_IMMUNITY_TIME`:
```
grep -n "SNIFF_IMMUNITY_TIME" engine/forest-engine.js
```
Add the three constants on the line immediately after that definition.

---

## Part B — Carry-leg chase leash fix (LUL-1427)

**File 2: `engine/forest-engine.js`**

**Change B1 — use `effectiveDetect(p)` in `shouldGiveUpChase` call (line 1401)**

Locate the chase-exit give-up check (currently at line 1401):
```js
        if(shouldGiveUpChase(p.scentLock, dist, p.spec.detect)){ p.state='roam'; p.spotted=false; }
```
Replace with:
```js
        if(shouldGiveUpChase(p.scentLock, dist, effectiveDetect(p))){ p.state='roam'; p.spotted=false; }
```

`effectiveDetect(p)` is defined at line 1225 and already imported/available in scope. It reads `DIFFICULTY_PRESETS[difficulty].detectMul`, `veilDetectMul(veilAmount)`, `fogTideDetectMul(fogTideAmount)`, and `CARRY_DETECT_MUL` (from `lib/game/cover.ts:418`, currently `1.35`). This makes the give-up leash shrink by the same `CARRY_DETECT_MUL` factor that already widens acquisition — a consistency fix, not a new mechanic.

---

## Files touched

| File | Lines changed |
|---|---|
| `engine/forest-engine.js` | A1 (1047), A2 (1087-1088), A3 (1440), A4 (1464), A5 (1360-1363), A6 (3187), A7 (3196), B1 (1401), + A8 constant block |

No other files. `lib/game/predator.ts` is NOT changed — `shouldGiveUpChase`'s signature stays `(scentLock, dist, detect)` and this change is at the call site only. `lib/game/cover.ts` is NOT changed. No new assets. No new state machine.

---

## Constraints

- Do NOT touch line 3194: `if(sinceClose > 30 && nearP && !hidden){ nearP.hunt = true; spotOnto(nearP); sinceClose = 12; }`. The `!hidden` gate stays on line 3194. Only line 3196 (the piano) loses its `!hidden`.
- Do NOT touch the sniff loop's investigate/approach logic (the `stepApproach` block). The predator in `roam` with `memSweeps > 0` is still in `roam` — it just has a biased waypoint. It does not home on the live player position.
- `rng()` (the seeded generator used for map generation) must NOT be called in the new sweep logic. The new code uses `Math.random()`, matching the existing roam waypoint call it replaces.
- `keepWaypointOffLake(nwx, nwz, CONFIG.lake)` must still be called on the new memory-ring waypoint, same as the regular waypoint — otherwise the predator can get a ring point inside the lake.
- Do NOT change `shouldGiveUpChase`'s signature or behavior in `lib/game/predator.ts`. Change the call site only.
- Do NOT touch the `investigate` state's approach-to-live-position logic. Memory only affects the `roam` waypoint; the predator still uses live player position while in `investigate`.

---

## Out of scope

- LUL-1427's charge-dodge cone issue (facing-direction requirement for dodge) — pre-existing behavior, separate ticket.
- Any change to `CARRY_DETECT_MUL`'s numeric value (`1.35`) — that is the Game Economist's tuning, not this ticket.
- LUL-1438 (light-curve + carrying telemetry) — separate ticket, no dependency either direction.
- Moving the `!hidden` gate on line 3194 (`sinceClose > 30 → nearP.hunt + spotOnto()`). The wiki analysis in `game/mechanics/predator-memory` §Scout-reply explains why that is a different problem and must be its own ticket.
- `SWEEP_COUNT`, `SWEEP_RING_MIN`, `SWEEP_RING_RANGE` tuning — placeholder values. Game Economist provides final values; open a follow-up tuning ticket, do NOT block this PR on it.

---

## Verification

### Build/type/lint (required before PR)
```bash
cd /home/noam/lullwood
next build
tsc --noEmit
npm run lint
```
Expected: zero errors. `forest-engine.js` is `.js`, not `.ts`, so `tsc` won't type-check it directly — the build step is the primary gate.

### Unit tests
```bash
npm test
```
Expected: all existing tests pass. No new tests are added here; the carry-leash fix (`effectiveDetect(p)` instead of `p.spec.detect`) is deterministic and can be unit-tested against `shouldGiveUpChase` from `lib/game/predator.ts`, but writing that test is out of scope for this ticket — file a follow-up.

### Console on load
No JS errors in the browser console on page load or first game start.

### Game Tester play verdict (required, Tier C)

Ask the Game Tester to verify specifically:

1. **Ring sweep reads as "it's coming back" not a jump scare.** After a wolf gives up sniffing and leaves, it should visibly circle back toward the area where it lost you — piano note should be audible even while crouched in cover. The audio build (piano starting far/slow and tightening) must be perceptible before the predator re-enters sniff range.

2. **Carry-leg chase can now be broken.** Start a carry leg, get spotted by a wolf or lion, then run without hiding. Confirm that after sufficient distance + time, the chase does eventually end (state transitions to `roam`). Pre-fix: wolf/lion chases during carry never ended. Post-fix: they should end once `dist > effectiveDetect(p) * 1.5` which, at `CARRY_DETECT_MUL=1.35`, is `detect * 1.5 * 1.35 = detect * 2.025` — larger than normal give-up, but reachable.

3. **No new jump scares while hidden.** A predator doing ring sweeps must NOT trigger the roar+flash `spotOnto()` sequence. If the tester sees "you've been spotted" cues fire while they are definitely hidden, that is a P1 regression — the ring sweep must feel like "nearby and searching", not "caught".

4. **Hiding still works.** A player who hides and holds still should still be able to outlast the ring sweeps — after `SWEEP_COUNT` waypoints the predator reverts to random roam. The hiding mechanic remains the intended escape; this ticket only adds a "remember and return" phase, not omniscient tracking.
