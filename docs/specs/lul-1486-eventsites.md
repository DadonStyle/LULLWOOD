# LUL-1486 — E5: `eventSites.ts` and distributed events

**Tier C.** Blocking review (`REVIEW: APPROVED`) + Game Tester play verdict required
before merge. **Depends on LUL-1848 (E4, `lib/game/wrap.ts`) having merged first** —
this spec uses `wrapDist`/`WRAP_SPAN` from that ticket. Do not start implementation
until LUL-1848 is on `release/next`.

Source of decisions: wiki `specs/bigger-wrapping-world-e2-e6` §E5 (CTO, decision-level
plan) + LUL-1489 (D2 ruling: predator samples the tide at its own position). This doc
is the executor-ready follow-up — confirmed against `origin/release/next@03645be`
(2026-09-07), which already includes E2/E3 and the `lib/game/fogTide.ts` +
`lib/game/eventScheduler.ts` split from the earlier tuning-extraction work (neither
existed when the CTO wrote the wiki page, so the `:308`-era line citations there are
stale — this doc supersedes them for E5. Do not re-derive from the wiki page.).

**Every `forest-engine.js` line number below is pre-E4 (read at `03645be`, before
LUL-1848 merges).** E4 inserts a handful of lines earlier in the file (a `WRAP_SPAN`
const near `:188`, one new import), which will shift everything below it down by a
small, unpredictable amount. **Locate every site below by the quoted code, not the
line number** — the line numbers are a starting point for search, not a guarantee.

---

## Design

The Fog Tide's *timing* stays exactly as it is today: one global clock
(`fogTideClock`), one phase (`fogTidePhase`), one ramped amount (`fogTideAmount`), one
build/telegraph signal (`fogTideBuild`). **This ticket does not give sites independent
clocks or phases** — that would be a bigger change than either the wiki spec or D2
call for. What changes is *where the effect is felt*: a new proximity blend against a
small fixed set of `{x, z, radius, kind}` sites decides how much of the already-global
`fogTideAmount`/`fogTideBuild` actually applies at a given point in the world.

**One sampling principle, applied uniformly — this generalizes D2 rather than
special-casing it:** every consumer samples the tide at the position of the thing the
effect is actually happening to, not always at the player.

- **Predators** (D2, decided): sample at the predator's own `(p.x, p.z)`. A predator
  standing in clear air is not blinded by fog it isn't standing in.
- **The player-observer effects** (scene fog density, the ambient audio bed): sample
  at `(player.x, player.z)` — the camera and the listener *are* the player, there is
  no other position for these to mean anything relative to.
- **The child's glow**: while carried, the child rides at the player's feet
  (`babyGroup.position.set(player.x, ..., player.z)` two lines above the carry-glow
  block), so sampling at `(player.x, player.z)` there is just the carried case of the
  same rule. While idle (not yet found), the child has its own fixed world position
  (`babyGroup.position.x/z`, set at spawn) — sample there. A child sitting in clear
  air should not glow brighter for a tide happening somewhere else on the map.

Only D2 itself (predator detect) was a board-ruled fork. The child/player extensions
above are not new open questions — they're the same physical-coherence argument D2's
ruling already made, applied to the two other consumers the wiki spec named. Flagging
this explicitly so it isn't re-litigated mid-implementation.

---

## Files

### 1. `lib/game/eventSites.ts` (new)

Generic, event-agnostic. Future event kinds reuse this file unchanged — they just
register their own site list and call `sitesNear` with their own `kind` string.

```ts
// LUL-1486: generic spatial-dispatch primitive for distributed events (first
// consumer: Fog Tide, see fogTide.ts). A `kind` string keeps this file
// event-agnostic -- a second event type needs no change here.
import { wrapDist } from './wrap';

export interface EventSite {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly kind: string;
}

/**
 * Proximity-weighted blend, in [0,1], of every site of `kind` near (x,z).
 * 1 at a site's own center, linearly down to 0 exactly at its radius edge,
 * 0 beyond it. Multiple overlapping sites of the same kind take the
 * strongest (nearest-site) weight, not a sum -- overlap should never read
 * as a stronger event than being inside one site alone.
 * `spanX`/`spanZ` default to Infinity, matching wrap.ts's own no-op
 * convention: plain Euclidean distance until CONFIG.wrapEnabled is true.
 */
export function sitesNear(
  x: number, z: number,
  sites: readonly EventSite[],
  kind: string,
  spanX: number = Infinity, spanZ: number = Infinity,
): number {
  let weight = 0;
  for (const s of sites) {
    if (s.kind !== kind || s.radius <= 0) continue;
    const dist = wrapDist(x, z, s.x, s.z, spanX, spanZ);
    const w = Math.max(0, 1 - dist / s.radius);
    if (w > weight) weight = w;
  }
  return weight;
}
```

### 2. `lib/game/eventSites.test.ts` (new)

- `sitesNear` returns `0` for an empty site array.
- Returns `1` exactly at a site's center (`dist = 0`).
- Returns `0` exactly at the radius boundary (`dist === radius`) — this is the
  boundary case the parent ticket calls out explicitly.
- Returns `0.5` at exactly half the radius (proves the linear falloff shape).
- Ignores sites whose `kind` doesn't match the query.
- Two overlapping same-kind sites: assert the result equals the max of their
  individual weights, not the sum (place a point where both sites give a nonzero,
  unequal weight and check it isn't `w1 + w2`).
- Wrapped case: one site at `x = 236` (near the `+span/2` edge of a `spanX = 480`
  world) is detected with a small `dist` from a query point at `x = -236` (the other
  side of the seam) — proves the `wrapDist` integration, not just plain Euclidean.

### 3. `lib/game/fogTide.ts` (edit — add three exports)

Add near the existing `FOG_TIDE_CONFIG` export, after the existing imports:

```ts
import { sitesNear, type EventSite } from './eventSites';
```

```ts
// LUL-1486: first-pass site layout for the 480x480 world (D1). Three patches
// spread around the map so a tide-active moment covers roughly a third of it
// at once, not all of it -- "can you walk out of the fog" (the ticket's own
// verification bar) needs somewhere clear to walk to. Positions/radii are a
// first cut; expect the Game Tester's seam/tide-walk verdict to ask for a
// tuning pass, not a structural change.
export const FOG_TIDE_SITES: readonly EventSite[] = [
  { x: 150, z: 60, radius: 130, kind: 'fogTide' },
  { x: -120, z: -140, radius: 130, kind: 'fogTide' },
  { x: 30, z: -190, radius: 110, kind: 'fogTide' },
];

/**
 * LUL-1486 / D2: the existing global ramp `tideAmount` (still one clock, one
 * phase across the whole world -- only the spatial EXTENT becomes local
 * here, not the timing), scaled by proximity to a fogTide site. 0 outside
 * every site. The caller picks which position to sample -- see fogTide.ts's
 * call sites in forest-engine.js for the sampling rule per consumer.
 * `sites` defaults to FOG_TIDE_SITES; overridable so tests (and only tests)
 * can prove the degenerate one-world-covering-site case reproduces the old
 * global behavior without depending on the real default layout.
 */
export function fogTideAmountAt(
  x: number, z: number, tideAmount: number,
  spanX: number = Infinity, spanZ: number = Infinity,
  sites: readonly EventSite[] = FOG_TIDE_SITES,
): number {
  return tideAmount * sitesNear(x, z, sites, 'fogTide', spanX, spanZ);
}

/** Same blend applied to the raw build/telegraph signal (fogTideBuild in
 * forest-engine.js) -- the audio telegraph fades with distance from a site
 * exactly like the effect it's telegraphing. */
export function fogTideBuildAt(
  x: number, z: number, buildAmount: number,
  spanX: number = Infinity, spanZ: number = Infinity,
  sites: readonly EventSite[] = FOG_TIDE_SITES,
): number {
  return buildAmount * sitesNear(x, z, sites, 'fogTide', spanX, spanZ);
}
```

Do not touch `fogTideDetectMul`, `fogTideGlowMul`, `fogTideGlowRangeMul`,
`fogTideFogBoost`, `fogTideDroneGainMul`, `fogTideWindGainMul` — unchanged, they still
take a single scalar. Only what gets *passed into* them (in the engine) becomes
positional.

### 4. `lib/game/fogTide.test.ts` (edit — add cases)

- `fogTideAmountAt` returns `0` at a point far from every default site.
- Returns exactly `tideAmount` at a default site's center.
- **The degenerate-case proof the parent ticket requires**: construct a single
  world-covering site, `[{ x: 0, z: 0, radius: 100000, kind: 'fogTide' }]`, pass it as
  the `sites` override, and assert `fogTideAmountAt(x, z, tideAmount, Infinity,
  Infinity, thatSite)` equals `tideAmount` exactly for several arbitrary `(x, z)`
  pairs inside the real map bounds (e.g. `(0,0)`, `(240,240)`, `(-240,-240)`). This is
  the "one site covering the world gives today's behavior" proof named in
  Verification.
- Same two cases mirrored for `fogTideBuildAt`.

### 5. `engine/forest-engine.js` (edit — consumer wiring only)

**Import** — add to the existing `@/lib/game/fogTide` import block:

```js
import {
  FOG_TIDE_CONFIG,
  FOG_TIDE_RAMP,
  FOG_TIDE_AUDIO_RAMP,
  fogTidePhase,
  fogTideBuildAmount,
  fogTideActiveTarget,
  fogTideDetectMul,
  fogTideGlowMul,
  fogTideGlowRangeMul,
  fogTideFogBoost,
  fogTideDroneGainMul,
  fogTideWindGainMul,
  fogTideAmountAt,
  fogTideBuildAt,
} from '@/lib/game/fogTide';
```

**`WRAP_SPAN`**: E4 (LUL-1848) already added a module-level `const WRAP_SPAN =
CONFIG.wrapEnabled ? CONFIG.mapSize : Infinity;` near `const half = CONFIG.mapSize /
2;`. Reuse it — do not declare a second one.

Six call-site edits. In every case, replace only the `fogTideAmount`/`fogTideBuild`
argument passed into a `fogTide*Mul`/`fogTide*Boost` call — leave everything else on
the line (including any trailing `,WRAP_SPAN` E4 already appended to `geoCanSee`'s own
argument list) untouched.

**(a) Predator detect — D2.** Currently (pre-E4, `:1416-1421`):

```js
function effectiveDetect(p){
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount) * timeOfRunDetectMul(timeOfRun), { hidden, hideTime, carrying });
}
function canSee(p, dist){
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount) * timeOfRunDetectMul(timeOfRun), { hidden, hideTime, carrying }, p.x, p.z, player.x, player.z, coverGrid);
}
```

In **both** functions, replace `fogTideDetectMul(fogTideAmount)` with:

```js
fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN))
```

(`p` is the first parameter of both functions, already in scope.)

**(b) Scene fog density — player-observer.** Currently (`:3605`):

```js
scene.fog.density = veilFogDensity(fogBase, MIST_VEIL_FOG, veilAmount) + fogTideFogBoost(fogTideAmount) + timeOfRun * TIME_OF_RUN_FOG_DELTA;
```

Replace `fogTideFogBoost(fogTideAmount)` with:

```js
fogTideFogBoost(fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN))
```

**(c) Carry glow — child colocated with player.** Currently (`:3722-3724`, inside the
`else if(carrying){` branch, two lines below `babyGroup.position.set(player.x, ...,
player.z)`):

```js
halo.material.opacity = carryHaloOpacity(t) * DIFFICULTY_PRESETS[difficulty].glowMul * fogTideGlowMul(fogTideAmount);
babyLight.intensity = carryGlowIntensity(t) * DIFFICULTY_PRESETS[difficulty].glowMul * fogTideGlowMul(fogTideAmount);
babyLight.distance = BABY_LIGHT_DISTANCE * fogTideGlowRangeMul(fogTideAmount);
```

Replace all three `fogTideAmount` args with:

```js
fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)
```

**(d) Idle glow — child's own position.** Currently (`:3875-3877`, inside `if(!baby
.taken){`):

```js
halo.material.opacity = idleHaloOpacity(t) * DIFFICULTY_PRESETS[difficulty].glowMul * fogTideGlowMul(fogTideAmount);
babyLight.intensity = idleGlowIntensity(t) * DIFFICULTY_PRESETS[difficulty].glowMul * fogTideGlowMul(fogTideAmount);
babyLight.distance = BABY_LIGHT_DISTANCE * fogTideGlowRangeMul(fogTideAmount);
```

Replace all three `fogTideAmount` args with:

```js
fogTideAmountAt(babyGroup.position.x, babyGroup.position.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)
```

**Not** `player.x/z` here — this is the *idle* branch, the child hasn't been picked up,
`babyGroup.position` is its own spawn location.

**(e) Audio — player-observer (listener).** Currently (`:3905, 3907`):

```js
audio.wg.gain.setTargetAtTime((0.05 + move01*0.10) * fogTideWindGainMul(fogTideAmount) * TOD_AUDIO.windGainMul, now, 0.3);
audio.wf.frequency.setTargetAtTime(320 + move01*900, now, 0.3);
audio.dg.gain.setTargetAtTime(0.05 * fogTideDroneGainMul(fogTideBuild) * TOD_AUDIO.droneGainMul, now, 0.3);
```

Replace `fogTideAmount` (line with `fogTideWindGainMul`) with:

```js
fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)
```

Replace `fogTideBuild` (line with `fogTideDroneGainMul`) with:

```js
fogTideBuildAt(player.x, player.z, fogTideBuild, WRAP_SPAN, WRAP_SPAN)
```

### 6. `docs/ELEMENTS.md` (edit — same PR, per studio DoD)

Update every citation that currently reads `fogTideDetectMul(fogTideAmount)`,
`fogTideGlowMul(fogTideAmount)`, `fogTideFogBoost(fogTideAmount)`,
`fogTideDroneGainMul(fogTideBuild)`, `fogTideWindGainMul(fogTideAmount)` (as of this
read: around `:184-208`, `:638-643`, `:761-782` — re-locate by grepping for
`fogTideAmount`/`fogTideBuild` in the file, these will also have drifted) to note the
call now goes through `fogTideAmountAt`/`fogTideBuildAt` and is no longer a whole-world
constant — add one sentence per section along the lines of "as of LUL-1486, this
applies only within a fixed set of Fog Tide sites (`FOG_TIDE_SITES` in
`lib/game/fogTide.ts`), not globally; a predator/player/child outside every site's
radius sees no tide effect regardless of the global clock's phase." Run
`node scripts/check-elements-citations.mjs --fix` after editing and hand-fix anything
it can't.

---

## What must NOT change

- The tide's **timing** — `fogTideClock`, `fogTidePhase`, `fogTideActiveTarget`,
  `fogTideBuild`'s ramp, `fogTideAmount`'s ramp — all stay exactly as they are, one
  clock for the whole world. This ticket makes the *extent* spatial, not the *timing*.
  Do not give sites independent phases.
- `fogTideActive`/the `track({ feature: 'fog_tide', action: 'start'|'end' })`
  telemetry pair — stays global/unconditional, untouched. It represents "the global
  cycle entered/left its active phase," which is still meaningful independent of
  where any site happens to be.
- The multiplier functions themselves (`fogTideDetectMul` etc.) and their constants
  (`FOG_TIDE_DETECT_MUL` etc.) — unchanged.
- `CONFIG.wrapEnabled` stays `false` (E4's flag, not this ticket's to flip).

## Out of scope

- Multiple independently-timed events, or sites with their own phase offset.
- Any event `kind` beyond `'fogTide'` — the primitive supports it, nothing else wires
  one up in this ticket.
- Band-wide fog *rendering* keyed to site geometry (e.g. a visible fog-wall mesh at a
  site's edge). `scene.fog.density` (Three.js `FogExp2`) is one scalar per frame with
  no positional falloff of its own; this ticket only changes which scalar gets
  computed, not the rendering technique. Same scope boundary E2 drew around the bog's
  band-wide visual treatment — worth its own ticket if wanted.
- Tuning `FOG_TIDE_SITES`' exact positions/radii/count beyond the first-pass values
  above.

## Verification

- `npm test`, including the new `lib/game/eventSites.test.ts` and the additions to
  `lib/game/fogTide.test.ts` above.
- `node scripts/check-elements-citations.mjs` clean after the ELEMENTS.md edit.
- `next build && tsc --noEmit` clean.
- **Game Tester play verdict** (Tier C): walk toward and away from an active fog-tide
  site — confirm the transition reads as weather (a gradient you walk through) and not
  a hard pop. Confirm you can be standing outside every site while the global cycle is
  in its active phase and feel nothing (this is the concrete answer to "can you walk
  out of the fog" the parent ticket asks for). Specifically try to provoke D2's
  observable effect: get a predator to stand outside a site's radius while you (the
  player) are inside one, or vice versa, and confirm the predator's detect range
  reacts to *its own* position, not yours.
