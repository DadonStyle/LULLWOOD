# SPEC: LUL-1724 — Wind Direction Awareness

Tier: **C** — touches `engine/forest-engine.js` scent-deposit math (detection-adjacent).
Requires `REVIEW: APPROVED` before merge, no `[ship]`. No Game Tester play verdict
required (QA paused per founder directive 2026-09-05) — flag for a play pass if QA
resumes, since this changes a detection-radius outcome players can now read and react to.

Traces to: CTO plan (issue `plan` document, revision 2) on LUL-1724, itself resolving a
Founding Engineer spec-clarity bounce (comment `1129b194`) over render location. CEO
ruling: ACCEPTED, cheap version as written (comment `b6adf060`).

**Citations below are verified directly against `origin/release/next` at `41e707a`
(2026-09-06, post LUL-1709 day-night merge). The plan's own line numbers for
`components/Hud.tsx` (it cited `EngineHudState` at `:27`, `lightDimmed` "alongside" it,
`INITIAL_HUD_STATE` at `:114`, `#gate` gating at `:405`, `#objective`/`#status` at
`:454-458`) do not match current `release/next` — use the numbers in this spec instead.
The `engine/forest-engine.js` and `lib/game/scent.ts` line numbers in the plan (already
corrected there from rev 1) are confirmed exact: no further drift.**

## Files

1. `lib/game/scent.ts` — edit
2. `lib/game/scent.test.ts` — edit (new test cases)
3. `engine/forest-engine.js` — edit (3 sites: import, `depositScent`, call site, wind push)
4. `components/Hud.tsx` — edit (state shape + render)
5. `components/GameCanvas.tsx` — edit (new CSS rule)
6. `docs/ELEMENTS.md` — edit (this changes a Player interaction and adds a HUD element)

## The change

### 1. `lib/game/scent.ts`

Add after `isScentDetected` (ends at current line 109; insert the new export
starting at line 111, i.e. one blank line after the closing `}`):

```ts
export const WIND_AGAINST_RADIUS_MULTIPLIER = 0.8; // CEO-accepted: 20% reduction

/** True when a movement direction (mvx,mvz, need not be unit) is more against
 * the wind than with it -- dot product with the wind unit vector is negative.
 * Zero movement or exactly-perpendicular (dot === 0) is not "against". */
export function isMovingAgainstWind(
  mvx: number,
  mvz: number,
  windX: number,
  windZ: number,
): boolean {
  return mvx * windX + mvz * windZ < 0;
}
```

### 2. `lib/game/scent.test.ts`

Add `isMovingAgainstWind` to the import list at the top (currently lines 3-16, importing
from `./scent.ts`), and add a new test block anywhere after the existing scent tests,
following the file's existing `test('description', () => { assert.equal(...) })` /
`node:test` + `assert/strict` pattern (see lines 1-2, 19-32 for the exact style):

```ts
// ---- wind-against detection --------------------------------------------

test('isMovingAgainstWind is true when moving directly into the wind (dot < 0)', () => {
  assert.equal(isMovingAgainstWind(-1, 0, 1, 0), true);
});

test('isMovingAgainstWind is false when moving with the wind (dot > 0)', () => {
  assert.equal(isMovingAgainstWind(1, 0, 1, 0), false);
});

test('isMovingAgainstWind is false when moving perpendicular to the wind (dot === 0)', () => {
  assert.equal(isMovingAgainstWind(0, 1, 1, 0), false);
});

test('isMovingAgainstWind is false for zero movement (dot === 0)', () => {
  assert.equal(isMovingAgainstWind(0, 0, 1, 0), false);
});
```

### 3. `engine/forest-engine.js`

**Import** — add `isMovingAgainstWind` and `WIND_AGAINST_RADIUS_MULTIPLIER` to the
existing `from '@/lib/game/scent'` import block (current lines 35-46):

```js
import {
  clampDt,
  isScentDetected,
  isScentExpired,
  isScentPastPruneCutoff,
  scentDriftDistance,
  SCENT_DEPOSIT_INTERVAL,
  SCENT_LIFETIME,
  SCENT_RADIUS_WALK,
  SCENT_RADIUS_RUN,
  SCENT_TRACK_TIME,
  isMovingAgainstWind,
  WIND_AGAINST_RADIUS_MULTIPLIER,
} from '@/lib/game/scent';
```

**`depositScent` definition** — current, line 1167:

```js
function depositScent(hot){
  scentPoints.push({ x: player.x, z: player.z, t0: clock.elapsedTime, radius: hot ? SCENT_RADIUS_RUN : SCENT_RADIUS_WALK });
```

Change to:

```js
function depositScent(hot, againstWind){
  const base = hot ? SCENT_RADIUS_RUN : SCENT_RADIUS_WALK;
  const radius = againstWind ? base * WIND_AGAINST_RADIUS_MULTIPLIER : base;
  scentPoints.push({ x: player.x, z: player.z, t0: clock.elapsedTime, radius });
```

The line below it (`while(scentPoints.length && isScentPastPruneCutoff(...` — currently
line 1168) is unchanged.

**Call site** — current, line 3426, inside the `if(mag > 0){ ... }` movement block (so
`mvx`/`mvz` are guaranteed non-zero and unit-normalized here — see lines 3413-3414 just
above it):

```js
if(scentEmitT <= 0){ depositScent(running); scentEmitT = SCENT_DEPOSIT_INTERVAL; }
```

Change to:

```js
if(scentEmitT <= 0){ depositScent(running, isMovingAgainstWind(mvx, mvz, windX, windZ)); scentEmitT = SCENT_DEPOSIT_INTERVAL; }
```

**Do not touch** the other `scentPoints.push` call site (the QA scent-seed hook,
elsewhere in the file) — it sets `radius: SCENT_RADIUS_WALK` directly, not via
`depositScent(hot)`, so this signature change does not affect it.

**Wind state to the HUD** — `windX`/`windZ` (module-scope, declared line 1160, set by
`generateWind()` at lines 1161-1164) are drawn once per `generateMap()` and never change
during a run. `generateWind()` is called once, at line 751, inside `generateMap()`. Add
one `pushState` call immediately after that call site:

Current, line 751:

```js
  generateWind();   // LUL-23: appended after cover -- doesn't reorder either stream
```

Change to:

```js
  generateWind();   // LUL-23: appended after cover -- doesn't reorder either stream
  pushState({ windX, windZ });   // LUL-1724: map-constant, pushed once, not per-frame
```

`pushState` (defined line 2286) is already in scope at this point in the file (it's a
top-level function, called earlier elsewhere in `generateMap()`-adjacent code paths) —
no import or forward-reference issue.

### 4. `components/Hud.tsx`

**Add to `EngineHudState`** (interface spans lines 28-95; insert before the closing `}`
at line 95, after the `missionStatus` field at line 94):

```ts
  // LUL-1724: wind direction, engine-driven, map-constant (set once per
  // generateMap(), pushed once -- not a per-frame value like veilCharge).
  windX: number;
  windZ: number;
```

**Add to `INITIAL_HUD_STATE`** (object spans lines 136-176; insert before the closing
`};`, after `lastPayout: null,` at line 175). Match the engine's own pre-`generateWind()`
default (`let windX = 1, windZ = 0;`, engine line 1160):

```ts
  windX: 1,
  windZ: 0,
```

**Render** — add after the `#status` block (current lines 517-521, the `state.statusVisible
&& (...)` block). Not inside `#panel` (SettingsPanel.tsx:26, hidden by default for every
real player since LUL-1085 — see the plan's rejected rev-1 placement for why):

```tsx
{state.entered && (
  <div
    id="windIndicator"
    title="Wind direction -- move into the arrow to reduce your scent trail"
    style={{ transform: `rotate(${Math.atan2(state.windZ, state.windX)}rad)` }}
  >
    {'→'}
  </div>
)}
```

Gate on `state.entered` (same flag `#gate` itself is gated on the inverse of, current
line 453: `{!state.entered && (`) — so the indicator is invisible on the title/gate
screen and visible for the entire run afterward, regardless of admin mode.

### 5. `components/GameCanvas.tsx`

Add a new CSS rule in the same block as the existing `#objective` rule (current lines
220-225) and `#status` rule (current lines 277-278). Insertion point: anywhere in that
same `<style>` block, e.g. directly after the `#missionGlyph` rule (current line 234):

```css
#windIndicator { position: fixed; top: 20px; right: 20px; z-index: 12;
  font-size: 28px; color: #ddd; text-shadow: 0 0 4px rgba(0,0,0,0.6);
  transform-origin: 50% 50%; pointer-events: none; }
```

Requirement: fixed top-right, `z-index: 12` (same stacking layer as `#objective`/
`#status`), and **not** gated by `body[data-admin-mode="0"]` — this must render for
every player, unlike `#panel`'s contents (current lines 209-212). Exact color/size/glyph
beyond this are the implementer's call.

### 6. `docs/ELEMENTS.md`

Two edits — this diff adds a new interaction (movement direction relative to wind now
affects deposited scent radius) and a new HUD element, both of which the registry tracks.

**Player section**, current lines 82-83:

```
- Leave a scent trail while moving (not while hidden or standing still) —
  `depositScent()`, deposited every `SCENT_DEPOSIT_INTERVAL` (0.3s).
```

Change to:

```
- Leave a scent trail while moving (not while hidden or standing still) —
  `depositScent()`, deposited every `SCENT_DEPOSIT_INTERVAL` (0.3s). LUL-1724:
  moving against the wind (`isMovingAgainstWind()` in `lib/game/scent.ts`, dot
  product of movement heading and wind unit vector < 0) shrinks the deposited
  point's radius by `WIND_AGAINST_RADIUS_MULTIPLIER` (0.8, i.e. -20%) at
  deposit time only — detection math (`isScentDetected`, drift) is unchanged.
  Wind direction is shown to the player via `#windIndicator` (see HUD section).
```

**HUD / UI surfaces section**, in the "React-owned" bullet (current lines 815-822, the
paragraph starting "**React-owned** (`components/Hud.tsx`)..."): append one sentence
after the existing LUL-1089 note in that same bullet:

```
LUL-1724 adds `#windIndicator`, a fixed top-right arrow rendered from two new
read-only `EngineHudState` fields (`windX`/`windZ`), pushed once per map
generation (not per-frame) — the only HUD element driven by map-constant
rather than per-frame or per-event engine state.
```

Do not renumber or otherwise touch any other line in either section.

## Declared deviation — LUL-195

[[game/lul195-wind-tell]] (LUL-195, PR #30, 2026-08-16) already gave wind a
player-visible tell — ambient dust drift following `windX`/`windZ` — and its own
writeup explicitly chose no HUD/compass element, citing the game's no-readouts
aesthetic. This spec proceeds with the HUD arrow anyway per the CEO's explicit
ACCEPTED ruling on this ticket (comment `b6adf060`, naming "wind arrow HUD indicator"
directly) and the recorded override at `decisions/0010-wind-hud-overrides-no-readouts`
on the wiki. State this in the PR body — do not let review rediscover it. LUL-195's
ambient dust drift is untouched; the two tells are additive, not a replacement.

## Verification

- `npm test` green, including the four new `isMovingAgainstWind` cases in
  `lib/game/scent.test.ts`.
- `npx tsc --noEmit` clean — the new `EngineHudState` fields must be threaded through
  both the interface and `INITIAL_HUD_STATE`, or this fails.
- `npx eslint .` clean.
- `npx playwright test` — run it and note the result, but per the current founder
  directive suspending Playwright as a verdict, treat it as informational only, not
  the disposition.
- Manual/visual (no browser required to trust the rest, but do this if one is
  available): confirm the arrow renders top-right after clicking through the gate (not
  on the gate screen itself), rotates differently across a few different map seeds, and
  is visible with `data-admin-mode="0"` (the default) — this last check is exactly what
  the rejected `#panel` placement in plan rev 1 would have failed.

## Constraints — what must not change

- `SCENT_RADIUS_WALK`/`SCENT_RADIUS_RUN` constants themselves are unchanged; the
  reduction is applied at the deposit call site only, via the new `radius` local.
- Detection math (`isScentDetected`, `driftedScentPosition`, `scentPickupRadius` in
  `lib/game/scent.ts`) is untouched — this is a deposit-time radius adjustment only.
- The QA scent-seed hook keeps its current behavior (no wind reduction applied).
- No change to `generateWind()`'s RNG draw and no new `rng()` call anywhere in this
  diff — must not perturb `QA_PINNED_SEED`-pinned tests.
- No change to noise/footstep radius (`NOISE_RADIUS_RUN`/`NOISE_RADIUS_WALK`,
  `bogNoiseMultiplier`) — wind affects scent only, per the CEO ruling.
- `#panel`'s existing contents and admin-mode gating are untouched.
- Do not add windX/windZ to the per-frame tick `pushState` call (current lines
  3352/3363 area) — they are map-constant; the one-time push after `generateWind()` is
  sufficient and cheaper.

## Out of scope

- The Player Psychologist's feel/clutter follow-up (filed separately per the CEO's
  ruling comment) — ship the mechanic first, tune after.
- Any change to wind affecting predator AI, charge, or sight detection — CEO ruling
  scopes this to scent only.
- Ambient dust drift (LUL-195) — untouched.
- A separate mobile-only layout variant for the indicator — fixed top-right is the
  full spec for both platforms; just confirm by inspection it doesn't collide with
  `MobileControls.tsx`'s on-screen stick/button regions (both anchor bottom, this
  anchors top-right, so no overlap is expected — if one is found, report it, don't
  silently redesign the placement).

## PR body must state

1. `Tier: C — engine/forest-engine.js` (state it, don't imply it).
2. The LUL-195 declared-deviation paragraph above, verbatim or close to it.
3. Mobile: identical mechanic and indicator placement on both platforms, no
   mobile-only code path — confirm no collision with `MobileControls.tsx`'s touch
   regions and say so.
4. That Playwright was run and its result, framed as informational only, not a
   merge gate, per the current founder directive.
