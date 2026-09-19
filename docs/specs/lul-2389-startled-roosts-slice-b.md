# SPEC: LUL-2389 startled roosts slice (b) — two-way flush (folds in slice c)

**Ticket:** LUL-2389 (parent LUL-1862) · **Tier:** C — writes predator investigation state
(`p.noiseTarget`/`p.noiseTargetT`/`p.state`) via `hearThrowableNoise()`. Needs
`REVIEW: APPROVED` from the Code Reviewer before merge — do not merge on green alone.

**Written against:** `release/next` @ `a2cfc29` (2026-09-18). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

**Plan:** `decisions/startled-roosts-slice-b-accepted-2026-09-11` (CEO ACCEPT), CTO plan
document on this ticket (posted 2026-09-11, wiki `game/lul2389-startled-roosts-slice-b-plan`).
Numbers below are LUL-1869's already-accepted combo ("Roost C": D6/R14/T2) — not re-derived
here. This SPEC re-derives every `file:line` the plan cited against the current branch; several
have moved since 2026-09-11 (noted inline).

## Files

- `lib/game/roostSites.ts` — new. `ROOSTS` moves here from `engine/tuning.js`, typed
  `readonly EventSite[]`.
- `engine/tuning.js` — edit. Remove `ROOSTS` (keep `ROOST_COOLDOWN`), add the three new
  slice-(b) constants.
- `lib/game/bog.test.ts` — edit. `ROOSTS` import moves from `engine/tuning.js` to
  `./roostSites.ts`; `r.kind` in the existing assertion (`:113-115`) becomes `r.id`.
- `engine/forest-engine.js` — edit. Import site, `updateRoosts()` signature + new player
  branch, `hearThrowableNoise()` 4th param, `tick()`'s `updateRoosts()` call site, new
  `qaProbePredatorState` field, `?qaHooks` block additions covered by the existing
  `qaProbePredatorState` hook (no new hook function needed — see `## e2e`).
- `engine/forest-engine.d.ts` — edit. `qaProbePredatorState`'s return type gains
  `noiseTarget`.
- `e2e/roost-flush.spec.ts` — new. The four scenarios named below.
- `docs/ELEMENTS.md` — edit. Rewrite the "Startled roosts, slice (a)" section (`:2348-2365`)
  to cover the merged (a)+(b)+(c) behavior.

## The change

### `lib/game/roostSites.ts` (new)

```ts
// LUL-2389 slice (c): ROOSTS registered as EventSite[] (lib/game/eventSites.ts) instead of
// a bespoke tuning.js array. `id` replaces the old cosmetic `kind: 'canopyNE'` label (grep
// confirms no code path reads it); `kind: 'roost'` is the real EventSite discriminator.
// Static list, no rng() draw -- same contract as LANDMARKS (engine/tuning.js), seeds stay
// byte-identical per seed.
import type { EventSite } from './eventSites.ts';

export interface RoostSite extends EventSite {
  readonly id: string;
}

export const ROOSTS: readonly RoostSite[] = [
  { id: 'canopyNE', kind: 'roost', x: 110,  z: 90,   radius: 20 },
  { id: 'canopyN',  kind: 'roost', x: 55,   z: 135,  radius: 20 },
  { id: 'canopyW',  kind: 'roost', x: -140, z: 15,   radius: 20 },
  { id: 'canopyS',  kind: 'roost', x: -30,  z: -140, radius: 20 },
  { id: 'canopyE',  kind: 'roost', x: 150,  z: -25,  radius: 20 },
];
```

`radius: 20` is unchanged — the existing slice-(a) predator-entry trigger, untouched by this
change. `updateRoosts()` keeps its own direct indexed iteration (below); this file does not
route the trigger logic through `sitesNear()` — that function blends every site of a kind to
one scalar and loses which site is nearest, and this feature needs the per-site index for
`roostCooldown[i]`/`flushRoost(i)`/which `(x,z)` to hand `hearThrowableNoise`. The `EventSite`
typing itself is what satisfies "registered through eventSites.ts" here.

### `lib/game/bog.test.ts` (edit, `:20,113-115`)

The only other consumer of `ROOSTS` (confirmed by `grep -rln "ROOSTS"` across the repo —
`engine/forest-engine.js`, `engine/tuning.js`, and this file are the only three hits). Update
the import and the field it reads:

```ts
import { LANDMARKS, CAVE, CONFIG } from '../../engine/tuning.js';
import { ROOSTS } from './roostSites.ts';
```
```ts
for (const r of ROOSTS) {
  assert.ok(!bogKeepClear(r.x, r.z, r.radius), `${r.id} at (${r.x},${r.z}) is inside the bog keep-clear radius`);
}
```

### `engine/tuning.js` (edit, `:85-96`)

Remove the `ROOSTS` export (moved above). Keep `ROOST_COOLDOWN = 32` in place — shared across
both trigger directions, already clears the "≥25s" floor with margin, no change. Add below it:

```js
export const ROOST_TRIGGER_RADIUS = 6;   // LUL-2389: player-side flush trigger, distinct from ROOSTS[i].radius (20, predator-only)
export const ROOST_NOISE_RADIUS = 14;    // LUL-2389: predators within this of the roost (x,z) hear the flush
export const ROOST_INVESTIGATE_TIME = [1.5, 2.5]; // LUL-2389: rnd() range, seconds -- not a THROWABLE_INVESTIGATE_TIME reuse
```

### `engine/forest-engine.js`

**Import** (`:205`) — replace `ROOSTS` in the `tuning.js` import with the three new constants,
and add the `roostSites.ts` import:

```js
import { ROOSTS } from '@/lib/game/roostSites';
```
and in the existing `tuning.js` named-import list, remove `ROOSTS` and add
`ROOST_TRIGGER_RADIUS, ROOST_NOISE_RADIUS, ROOST_INVESTIGATE_TIME` alongside the existing
`ROOST_COOLDOWN`.

**`hearThrowableNoise()`** (`:2384-2389`) — add an optional 4th parameter, default to the
existing throwable behavior so every other call site (`:5800` and the wayfinding S3 call
modeled on it) is unchanged:

```js
function hearThrowableNoise(p, tx, tz, investigateTime = THROWABLE_INVESTIGATE_TIME){
  p.state = 'investigate'; p.inv = 'approach'; p.approachEnteredHidden = hidden; p.sniffsLeft = rollSniffs(rng, 4);
  p.callTimer = rnd(2.6, 4.2);
  p.noiseTarget = { x: tx, z: tz };
  p.noiseTargetT = rnd(investigateTime[0], investigateTime[1]);
  if(captionsOn) pushState({ caption: `${p.kind} investigates a noise`, captionId: ++captionSeq });
}
```

**`updateRoosts()`** (`:3111-3123`) — signature gains `running`, new player branch added after
the unchanged predator-flush branch, guarded by the same `roostCooldown[i]`:

```js
function updateRoosts(dt, running){
  updateRoostBursts(dt);
  for(let i=0;i<ROOSTS.length;i++){
    if(roostCooldown[i] > 0){ roostCooldown[i] -= dt; continue; }
    const r = ROOSTS[i];
    for(const p of predators){
      if(p.inert || p.state !== 'chase') continue;
      if(Math.hypot(p.x-r.x, p.z-r.z) < r.radius){
        flushRoost(i);
        roostCooldown[i] = ROOST_COOLDOWN;
        break;
      }
    }
    if(roostCooldown[i] > 0) continue;   // the predator branch above may have just set it this tick
    if(running && Math.hypot(player.x-r.x, player.z-r.z) < ROOST_TRIGGER_RADIUS){
      flushRoost(i);
      roostCooldown[i] = ROOST_COOLDOWN;
      for(const p of predators){
        if(p.inert) continue;
        if(Math.hypot(p.x-r.x, p.z-r.z) < ROOST_NOISE_RADIUS) hearThrowableNoise(p, r.x, r.z, ROOST_INVESTIGATE_TIME);
      }
    }
  }
}
```

The noise point is the roost's fixed position, never `player.x/z` — that's the whole point of
§8 of the accepted proposal: avoiding a flush stays spatial-mastery, not free clairvoyance
about the player's own location. Gate is `running` (sprint) specifically, not "any movement" —
this ties the mechanic to the already-shipped, already-invisible `NOISE_RADIUS_WALK`(14)/
`NOISE_RADIUS_RUN`(24) cost the whole proposal exists to make visible. A walking player inside
`ROOST_TRIGGER_RADIUS` does not flush.

`if(roostCooldown[i] > 0) continue;` (new line between the two branches) prevents the same
frame's predator-triggered flush from being immediately followed by a player-triggered
`hearThrowableNoise` re-fire on the same roost — the two directions share one physical flush
event per roost, matching the plan's "one physical flush event per roost regardless of cause."

**Call site** (`:6693`) — thread the already-computed `running` local (`:6485`, same `tick()`
function, no new state):

```js
if(playing) updateRoosts(dt, running);   // LUL-1914/LUL-2389: roost feedback, same gate as predator AI
```

**`qaProbePredatorState`** (`:4412-4416`) — add `noiseTarget` so a test can tell "predator
investigates the player" apart from "predator investigates the roost":

```js
window.ForestEngine.qaProbePredatorState = function(kind){
  const p = predators.find(pp => pp.kind === kind);
  if(!p) return null;
  return { state: p.state, dist: Math.hypot(player.x - p.x, player.z - p.z), scentCalls: p.scentCalls, t: clock.elapsedTime, noiseTarget: p.noiseTarget ?? null };
};
```

### `engine/forest-engine.d.ts` (edit, `:144-146`)

```ts
qaProbePredatorState?: (
  kind: 'wolf' | 'bear' | 'lion',
) => { state: string; dist: number; scentCalls: number; t: number; noiseTarget: { x: number; z: number } | null } | null;
```

### `docs/ELEMENTS.md` (edit, `:2348-2365`)

Rewrite the "Startled roosts, slice (a)" heading and body to describe the merged behavior:
predator-side flush unchanged; player-side flush requires sprinting (`running`) within
`ROOST_TRIGGER_RADIUS=6` of a roost's `(x,z)`, fires the same burst+sound cue via the shared
`flushRoost(i)`, and calls `hearThrowableNoise(p, r.x, r.z, ROOST_INVESTIGATE_TIME)` for every
non-inert predator within `ROOST_NOISE_RADIUS=14` of the roost — never the player's own
position. Both directions share the single `ROOST_COOLDOWN=32` per-site cooldown. Note the
`ROOSTS` move to `lib/game/roostSites.ts` (`EventSite`-typed) and drop the "slice (b)/(c)
deferred" line — both are now live.

## Verification

- `npm test` (full suite) — `lib/game/bog.test.ts` is the one existing test that imports
  `ROOSTS` (`grep -rln "ROOSTS"` across the repo returns only `forest-engine.js`,
  `tuning.js`, and this file); its updated import + `r.id` field read (above) must still pass
  the existing "every ROOST stays clear of the bog patch" assertion unchanged — the site
  coordinates themselves don't move, only the module and field name.
- `npx playwright test roost-flush` — new spec, all 4 scenarios pass, desktop + Pixel 5
  landscape.
- `tsc --noEmit` clean (the `RoostSite`/`EventSite` typing and the `qaProbePredatorState`
  return-type widening are the only type-surface changes).

## e2e

**Specs.** `e2e/roost-flush.spec.ts` — new, four scenarios, desktop + Pixel 5 landscape (no
new input surface — sprint already exists on both; parity is "already true," not new surface
to add):
1. `'sprinting within ROOST_TRIGGER_RADIUS flushes and sends a nearby predator to the roost, not the player'` — stage a predator via `qaBuildScene` at `canopyNE` (110,90) + a few units, teleport the player to within 6 units of (110,90), hold `ShiftLeft`, `qaAdvance` one tick, assert `qaProbePredatorState('<kind>').noiseTarget` equals `{x:110,z:90}` (not the player's `qaPlayerState()` position).
2. `'walking the same radius does not flush'` — same staging, no `ShiftLeft` held, assert `noiseTarget` stays `null` and `state` is unchanged.
3. `'per-roost cooldown blocks a second flush inside ROOST_COOLDOWN'` — trigger scenario 1, then immediately retry within the 32s cooldown window (advance a small amount of game time, well under 32s) with the predator's `noiseTarget`/`noiseTargetT` reset via a second `hearThrowableNoise`-clearing step or a fresh predator at the same roost — assert no second flush (state/`noiseTarget` unchanged from the first trigger's values, not re-rolled).
4. `'a predator outside ROOST_NOISE_RADIUS of the roost is unaffected'` — stage the predator beyond 14 units of the roost's `(x,z)` but still on-map, repeat scenario 1's player trigger, assert `noiseTarget` stays `null`.

**World.** micro (default). Roost sites are fixed (not part of `generateMap()`'s rng stream)
and untouched by `qaBuildScene()` — stage the player + predator near the existing `canopyNE`
coordinate `(110, 90)` via `qaTeleportTo`/`qaBuildScene`'s `predators` array; no new
site-staging hook needed.

**Hooks.** No new hook function. `qaProbePredatorState(kind)` (existing,
`engine/forest-engine.js:4412`) gains the `noiseTarget` field above — that's the entire new
surface this feature needs; `qaTeleportTo`, `qaBuildScene`, and real `page.keyboard.down/up`
(`ShiftLeft`) cover staging and the sprint trigger.

**Tester scenario.** None: not player-visible as a *new* surface — the burst+sound+caption cues
this reuses (`flushRoost()`'s existing `triggerRoostBurst`/`roostFlushSound`, and
`hearThrowableNoise()`'s existing caption) already ship and are already covered by the LUL-1914
slice-(a) cues. The e2e spec above is the regression guard for the new trigger logic itself.

**Not covered.** Feel/audio: none — no new sound or caption, both reused unchanged from slice
(a) and the existing `hearThrowableNoise()` caption. Real-device: none, deterministic
position/timer math, same class as slice (a).

## Cues

**Visual.** Unchanged — the existing `triggerRoostBurst(i)` (`flushRoost()`,
`engine/forest-engine.js:1898-1901`) upward `THREE.Points` burst fires identically regardless
of which branch (predator or player) called `flushRoost(i)`. No new visual.
**Audio.** Unchanged — the existing `roostFlushSound(ROOSTS[i].x, ROOSTS[i].z)`
(`engine/forest-engine.js:1900`) positional wing-clatter, gated by `soundOn` same as today.
**Explanation.** The player-triggered predator investigate reuses `hearThrowableNoise()`'s
existing caption `"${p.kind} investigates a noise"` (`engine/forest-engine.js:2389`), gated by
`captionsOn`, fired once per investigate-state entry — same text a thrown-stone noise already
produces, since the player experiences both as "a predator now investigates somewhere."
**Reduced motion.** Unchanged from slice (a) — `triggerRoostBurst`'s particle animation is not
touched by this change; no new animation introduced here to need a reduced-motion degrade.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- `updateRoosts()`'s new player branch must not call `rng()` — same shared LUL-791/LUL-794
  stream-identity contract every other per-tick predator/roost function in this file already
  honors (this branch only reads `player.x/z`/`running` and calls `Math.hypot`, no `rng()`
  call added).
- `hearThrowableNoise()`'s 4th parameter must default to `THROWABLE_INVESTIGATE_TIME` so the
  existing throwable call site (`:5800`) and the wayfinding S3 call modeled on it are
  byte-identical in behavior — do not add a required parameter.
- `ROOSTS[i].radius` (20, predator-only trigger) stays untouched — `ROOST_TRIGGER_RADIUS` (6)
  is a separate constant, not a rename or override of the existing field.
- The single `roostCooldown[i]` array stays shared across both trigger directions — do not add
  a second cooldown array per the plan's "one physical flush event per roost regardless of
  cause."
- `r.kind`/`r.id` rename in `roostSites.ts` is cosmetic only — confirmed (`grep -n "\.kind" engine/forest-engine.js` restricted to `ROOSTS[i]`/`r.` usages) that no code path reads the old `kind` field; do not add a new dependency on it in this change.

## Out of scope

- Any new roost site or radius change to the existing 5 sites — reuse only, per the plan's
  "no siting change."
- Backfilling e2e coverage for slice (a)'s predator-only trigger, which shipped without a
  dedicated spec file — this SPEC's new `e2e/roost-flush.spec.ts` scenario 1 exercises the
  predator branch incidentally (it's still live in the merged loop) but does not claim to be
  slice (a)'s regression suite; flagging, not fixing, since slice (a) is already-shipped
  behavior this ticket doesn't touch.
- Routing `updateRoosts()`'s trigger/cooldown logic through `sitesNear()` — deliberately not
  done, see "The change" above.
