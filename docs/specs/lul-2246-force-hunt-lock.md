# SPEC: LUL-2246 force-hunt escalation closes the distance

**Ticket:** LUL-2246 · Rollout step 2/6 of parent epic LUL-2223. **Tier: C** —
`engine/forest-engine.js` predator simulation (the hunt/chase state machine). Requires
`REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `35cfd6d7` (2026-09-09). Re-derive every
`file:line` below if it has moved on the branch you implement on.

## Files

- `engine/tuning.js` — edited: one new export, `FORCE_HUNT_LOCK`.
- `engine/forest-engine.js` — edited: import the new constant; set it at the force-hunt
  escalation call site; change the hunt branch's LOS-loss collapse to route into a
  blind chase instead of `investigate`; one new QA hook.
- `engine/forest-engine.d.ts` — edited: declare the new hook.
- `docs/ELEMENTS.md` — edited: the existing "Force-hunt" bullet describes the intended
  behaviour ("switches straight to `hunt` … ignores LOS break") that this fix actually
  delivers today; update it to name the mechanism.
- `e2e/force-hunt-closes.spec.ts` — created.

## The problem

The escalation itself already fires correctly: `engine/forest-engine.js:4801-4802`

```js
if(nearDist < 20) sinceClose = 0; else sinceClose += dt;
if(sinceClose > 30 && nearP && !hidden){ nearP.hunt = true; nearP.sightLock = null; spotOnto(nearP); sinceClose = 12; }
```

sets `nearP.hunt = true`. But the `hunt` branch of `updatePredators()`'s per-predator
if/else-if chain, `engine/forest-engine.js:1980-1987`:

```js
} else if(p.hunt){                                // forced: comes straight for you while it can see you (no giving up otherwise)
  if(!canSee(p, dist)){ p.state='investigate'; p.inv='approach'; p.sniffsLeft=rollSniffs(rng, 4); p.hunt=false; }
  else {
    if(isCaught(dist, p.rad)) triggerDeath(p.kind, 'hunt');   // LUL-1194: the 30s force-hunt escalation caught up
    else { desx=ux; desz=uz; speed=p.spec.speed*pLakeMul; }
    if(dist < 8) p.hunt = false;                   // reached you → back to normal
    p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind, false, p); p.callTimer = rnd(2.6,4.6); }
  }
}
```

collapses to `investigate`/`approach` the very next tick if `canSee(p, dist)` is false —
which it always is: the escalation exists precisely because the predator has been
**beyond** detect range (30-48u) for 30s. `stepApproach()`
(`lib/game/predator.ts:280-284`) then caps speed at `speciesSpeed * 0.45`
(7.0/6.3/8.0 u/s for wolf/bear/lion) against a 6 u/s walking, 10.8 u/s sprinting
player — the chase can never close.

`updatePredators()`'s `if/else-if` chain checks `p.hunt` (line 1980) strictly before
`p.state === 'chase'` (line 2037), so as long as `p.hunt` stays `true` the predator can
never reach the `chase` branch's existing blind-pursuit path — the fix must clear
`p.hunt` at the same moment it redirects into `chase`.

## The fix

### 1. `engine/tuning.js` — new constant

Insert immediately after `export const CHASE_GAP = 28;` (currently line 183):

```js
// LUL-2246: how long a force-hunt escalation (30s-no-contact -> straight for you) keeps
// chasing blind once it loses sight, via the existing scentLock leash (LUL-23) below --
// 25s at the bear's full species speed (13.9 u/s, the slowest of the three) covers 348u,
// enough to cross the 480x480 map once. Deliberately not tied to SCENT_TRACK_TIME (8s,
// lib/game/scent.ts) -- a force-hunt is a much stronger signal than a stale scent point.
export const FORCE_HUNT_LOCK = 25;
```

### 2. `engine/forest-engine.js` — import

The `@/engine/tuning` import (currently `:173-180`) already destructures `CHASE_GAP`.
Add `FORCE_HUNT_LOCK` to the same list:

```js
import {
  CONFIG, LANDMARKS, LEGACY_LIGHT_SCALE, LIGHT_NORMAL, LIGHT_DIMMED, VEIL_RAMP,
  MIST_VEIL_FOG, VIGNETTE_NORMAL, VIGNETTE_DIMMED, CANOPY_R, CONE1_HEIGHT, CONE1_Y,
  STAR, LW, DUST, BW, BSP, BOG_TREES, COVER_PROPS, DUST_WIND_SPEED, WARM,
  BABY_LIGHT_DISTANCE, PSPEC as PSPEC_BASE, CHASE_GAP, DIFFICULTY_PRESETS,
  CAVE, CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END, RADIO_MAST_BEACON_GLOW,
  VEIL_CHARM_INTERACT_RADIUS, WOLF_BOG_MASK_STRENGTH, ROOSTS, ROOST_COOLDOWN,
  FORCE_HUNT_LOCK,
} from '@/engine/tuning';
```

### 3. Escalation call site — `:4802`

```js
    if(sinceClose > 30 && nearP && !hidden){ nearP.hunt = true; nearP.scentLock = FORCE_HUNT_LOCK; nearP.sightLock = null; spotOnto(nearP); sinceClose = 12; }
```

(one token added: `nearP.scentLock = FORCE_HUNT_LOCK;`, alongside the existing
`nearP.hunt = true;`. `spotOnto()` itself is untouched — it still sets `p.state='chase'`
and the brief `p.alert` freeze exactly as today; that freeze runs first via the
higher-priority `p.alert > 0` branch, `:1972`, before `p.hunt` is ever checked again.)

### 4. Hunt branch collapse — `:1981`

Before:

```js
    } else if(p.hunt){                                // forced: comes straight for you while it can see you (no giving up otherwise)
      if(!canSee(p, dist)){ p.state='investigate'; p.inv='approach'; p.sniffsLeft=rollSniffs(rng, 4); p.hunt=false; }
```

After:

```js
    } else if(p.hunt){                                // forced: comes straight for you while it can see you (no giving up otherwise)
      if(!canSee(p, dist)){
        // LUL-2246: a live force-hunt lock means this collapse is the 30s escalation
        // losing sight, not an ordinary hunt -- route into the existing scentLock blind-
        // chase path (`p.state === 'chase'`, :2037) at full species speed instead of the
        // 0.45x `approach` sub-phase (lib/game/predator.ts stepApproach()). Ordinary
        // (non-escalated) hunts, e.g. LUL-26 preset `startHunting`, still fall through to
        // the pre-existing investigate/approach collapse below, unchanged.
        if(p.scentLock > 0){ p.state='chase'; p.hunt=false; }
        else { p.state='investigate'; p.inv='approach'; p.sniffsLeft=rollSniffs(rng, 4); p.hunt=false; }
      }
```

Everything else in the `hunt` branch (the `else` clause: `isCaught`/`triggerDeath`,
movement at full `p.spec.speed`, `dist < 8` reset, `callTimer`) is untouched — this only
changes what happens the instant `canSee` goes false. Once `p.state='chase'` is set here,
the very next tick runs the `chase` branch (`:2037-2078`) exactly as it does for a real
scent pickup: blind pursuit at `p.spec.speed*pLakeMul` while `p.scentLock > 0`
(`:2075`), `shouldGiveUpChase(p.scentLock, dist, effectiveDetect(p))` gating the eventual
give-up (`:2076`, false while `scentLock > 0` — `lib/game/predator.ts:80-82`), and the
wolf/lion charge telegraph (`:2055-2063`) live again if the predator re-enters detect
range and can see + be seen. `scentLock` itself decays every tick regardless of state via
the existing unconditional `tickTimers()` call (`:1905-1906`) — no new decay logic needed.

### 5. New QA hook — inside the `?qaHooks=1` block (after `qaStagePredatorGiveUp`, `:3542`)

```js
  // LUL-2246: places predator[kind] dx/dz from the player and parks every other spawned
  // predator far out of range, so it is guaranteed to be `nearP` (`:4781`). Sets
  // `sinceClose = 29.9` -- one real tick past this crosses the 30s force-hunt threshold
  // through updatePredators()'s own logic (:4802), not by setting hunt/scentLock directly,
  // so the assertion exercises the real escalation, not a synthetic stand-in for it. dx/dz
  // must put the predator beyond its detect radius (30-48u) for the escalation's collapse
  // branch (:1981) to actually run; the caller is responsible for that distance.
  window.ForestEngine.qaStageForceHuntApproach = function(kind, dx, dz){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    for(const other of predators){ if(other !== predators[idx]){ other.x = player.x + 800; other.z = player.z + 800; } }
    const p = predators[idx];
    p.x = player.x + dx; p.z = player.z + dz;
    p.vx = p.vz = 0; p.charge = null; p.sightLock = null; p.alert = 0; p.reroute = 0; p.stuckT = 0;
    p.hunt = false; p.scentLock = 0; p.state = 'roam'; p.spotted = false;
    sinceClose = 29.9;
    return { idx, x: p.x, z: p.z };
  };
```

`sinceClose` is an existing closure-scope variable (`:1514`), in scope at the `qaHooks`
block's location (both live inside `init()`'s single closure, LUL-17) — no new module
plumbing needed.

### 6. `engine/forest-engine.d.ts` — hook declaration

Add next to `qaStagePredatorGiveUp` (`:107`):

```ts
/** LUL-2246: places predator `kind` dx/dz from the player, parks every other spawned predator out of range, and fast-forwards `sinceClose` to 29.9s so the next real tick(s) cross the 30s force-hunt threshold through the engine's own logic. Returns `{idx,x,z}`, or null if the species isn't spawned. */
qaStageForceHuntApproach?: (kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number) => { idx: number; x: number; z: number } | null;
```

### 7. `docs/ELEMENTS.md` — update the existing bullet

Current (`:346-348`):

```markdown
- Force-hunt: if nothing has been within 20 units of the player for 30s, the
  nearest predator switches straight to `hunt` (relentless, ignores LOS
  break) — `tick()`.
```

Replace with:

```markdown
- Force-hunt: if nothing has been within 20 units of the player for 30s, the
  nearest predator switches straight to `hunt` and comes for you at full
  speed. LUL-2246: losing sight while `hunt` is active now sets a 25s
  `FORCE_HUNT_LOCK` (`engine/tuning.js`) and routes into the same blind-chase
  leash a scent pickup uses (`scentLock`, LUL-23), instead of collapsing to
  the slower `investigate`/`approach` sub-phase — the escalation is now
  actually relentless, not just labeled that way. `tick()`.
```

Run `node scripts/check-elements-citations.mjs` (no `--fix` needed here — no cited
symbol's declaration line moves) before committing.

## Verification

1. `npx tsc --noEmit` — clean (new hook's `.d.ts` entry must type-check against its
   `forest-engine.js` implementation shape).
2. `npm run build` — clean.
3. `npx eslint engine/forest-engine.js engine/tuning.js` — clean.
4. `node scripts/check-elements-citations.mjs` — clean.
5. `node scripts/check-duplicate-logic.mjs` — clean (no duplicated constant/logic
   introduced).
6. Determinism: no `rng()` or `Math.random()` call added anywhere in this diff — grep the
   diff to confirm. `FORCE_HUNT_LOCK` is a static constant, not a draw.
7. `npx playwright test e2e/force-hunt-closes.spec.ts e2e/predator-determinism.spec.ts e2e/predator-memory.spec.ts e2e/scent.spec.ts e2e/blind-chase-cover.spec.ts` — all green.

## e2e (mandatory, ships in this PR)

**Specs.**
- `e2e/force-hunt-closes.spec.ts` — new, desktop. 'force-hunt escalation blind-chases at
  full species speed instead of collapsing to slow approach (LUL-2246)': boots with
  `qaHooks`, stages a wolf 60 units out (beyond its 42u detect radius, guaranteeing
  `canSee` is false) via `qaStageForceHuntApproach('wolf', 60, 0)`, advances a few fixed
  ticks to cross the pre-staged 29.9s `sinceClose` threshold, asserts via
  `qaProbePredatorState('wolf')` that state lands in `'chase'` (not `'investigate'`),
  then advances 3 more game-seconds and asserts `dist` strictly decreased by at least
  half of the wolf's full species speed (15.5 u/s) times elapsed time — proving the
  0.45x `approach` collapse did not happen. A second case stages the predator with an
  intervening line-of-sight-blocking prop absent (open ground) and confirms the give-up
  guard (`shouldGiveUpChase`) does **not** fire before `scentLock` (25s) expires, by
  sampling state stays `'chase'` at the 20s mark.
- `e2e/predator-determinism.spec.ts`, `e2e/predator-memory.spec.ts`, `e2e/scent.spec.ts`,
  `e2e/blind-chase-cover.spec.ts` — must pass unchanged (same `hunt`/`chase`/`scentLock`
  machinery these already exercise).

**Hooks.** `window.ForestEngine.qaStageForceHuntApproach(kind, dx, dz): {idx,x,z}|null` —
see §5 above. New, declared in `engine/forest-engine.d.ts`, installed inside the
`?qaHooks=1` block in `init()`.

**Tester scenario.** Covered by the Playwright spec above; the nightly QA tester's
scenario audit (`shared/local-qa/QA_TESTER.md`) does not separately probe predator-AI
timing (it's a vision-model audit of HUD/overlap/win-lose sequences), so no
`shared/local-qa/requests/` file is needed for this ticket.

**Not covered.** No `e2e/mobile/force-hunt-closes.spec.ts`. This change is pure predator
simulation with no rendering, HUD, or input-handling component — behaviorally identical
regardless of touch vs. mouse/keyboard input, the same reasoning the three existing
predator-AI specs already rely on (`e2e/predator-memory.spec.ts`,
`e2e/scent.spec.ts`, `e2e/blind-chase-cover.spec.ts` — none of which has a mobile
counterpart). Contrast with LUL-2224 item 2 (`e2e/scent-trail.spec.ts` +
`e2e/mobile/scent-trail.spec.ts`), which duplicated because it drew a new HUD-adjacent
visual that could overlap touch controls; nothing here is visible or touch-adjacent.
Feel (does a 25s blind chase read as "relentless" rather than "unfair") is unverified
until a human or the local-qa tester's vision-model pass says so.

## Constraints (parent epic LUL-2223's "must not change", applies verbatim)

- Win rule: carrying the child to `CONFIG.home` wins (`arriveHome()`,
  `lib/game/outcome.ts`) — untouched by this diff.
- LUL-1081 end-screen persistence; `e2e/win-persist.spec.ts`, `e2e/death-persist.spec.ts`,
  `e2e/replay/*.spec.ts`, `e2e/mobile/win-persist.spec.ts` pass unchanged.
- Seed determinism: no `Math.random()`/new `rng()` draw added.
- `generateMap()` stream order, `CONFIG.wrapEnabled`/`WRAP_SPAN` seam maths, LUL-437
  `SNIFF_IMMUNITY_TIME`, the LUL-22 sniff-loop timing, `shouldGiveUpChase()`'s own
  formula, `DIFFICULTY_PRESETS` semantics — none of these are edited; `shouldGiveUpChase`
  is called with the same arguments as before, just now also reachable from a
  force-hunt-originated `chase` (it already runs unconditionally on every `chase`).
- Fixed geography (`LANDMARKS`, `ROOSTS`, `CAVE`, lake, home, bog, ground plane) — untouched.
- Shared geometries/materials — untouched, no new ones added.
- CI stays green: `scripts/check-duplicate-logic.mjs`, `scripts/check-elements-citations.mjs`.

## Out of scope

- Tuning `FORCE_HUNT_LOCK`'s value beyond the 25s the epic's own analysis derives — a
  follow-up balance pass (if the local-qa tester or a human reports the escalation as
  too punishing or still too weak) is a separate ticket, not this one.
- The other five children of epic LUL-2223 (prop density, landmark beacons, streamed
  chunks, whole-map spawn) — each is its own ticket/PR per the epic.
- Retuning `sinceClose`'s 30s threshold or the `sinceClose = 12` reset-after-firing value
  — the epic's analysis and this ticket both call these out as unchanged.
