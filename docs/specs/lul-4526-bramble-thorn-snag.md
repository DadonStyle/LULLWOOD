# SPEC: LUL-4526 Bramble — Thorn Snag

**Ticket:** LUL-4526 · **Tier:** C — touches `engine/forest-engine.js` core simulation
(`enterHide`/`exitHide`, the per-frame movement-speed calc in `stepFrame()`, and the
roam-predator noise-alert loop). Needs `REVIEW: APPROVED` from the Code Reviewer before
merge, per founder rule (do not self-merge).

**Written against:** `release/next` @ `bd0f1446` (2026-09-23). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

Proposal: wiki `game/mechanics/bramble-thorn-snag`. Decision record: wiki
`decisions/lul-3254-prop-powers-accepted-2026-09-22`.

## Deviations from the proposal (verified live, corrected here)

1. **Sprint flag citation is wrong.** The proposal says "reuse the sprint flag already read
   at `engine/forest-engine.js:2976` for throwables" — that line is inside the predator
   pursuit-approach branch (`stepApproach`), unrelated to player sprint. The real sprint
   state is computed once per frame at `engine/forest-engine.js:6582`:
   `running = runMode === 'toggle' ? (toggleRunOn || touchSprint) : (keys['ShiftLeft'] ||
   keys['ShiftRight'] || touchSprint)`. That computation is local to `stepFrame()` and gated
   inside `if(playing && !hidden){...}` (`:6580`) — it does not run at all while the player
   is hidden, and at the exact frame `exitHide()` fires from the movement-break check
   (`:6486`, before `:6582` runs), `running` has not been assigned yet this frame either. §
   "The change" below adds a standalone `isSprintHeld()` helper that reads the same
   module-level inputs (`runMode`, `toggleRunOn`, `touchSprint`, `keys` — all declared
   outside any function, `:3280`/`:3398`/`:3199`) directly, so it works from `enterHide()`,
   `exitHide()`, and `toggleHidden()`'s keydown-triggered call path, none of which run inside
   `stepFrame()`'s per-frame scope. **Do not** refactor `:6582`'s own `running` assignment to
   call this helper — that line is a per-frame hot path already inlining the identical
   expression; touching it is out of scope here.
2. **No `stealthBus` exists.** Grepped `engine/forest-engine.js` and every `lib/game/*.ts` —
   there is no named audio bus of any kind. Every procedural sound function (`leafRustle`
   `:3525`, `rustleSting` `:3770`) gates on `if(!audio || !soundOn) return;` and connects
   directly to the shared `master`/`conv` `GainNode`s from the `audio` object. The new sound
   below follows that exact pattern, not a bus.
3. **`hearThrowableNoise` doesn't exist** — the real function is `checkThrowableNoise`
   (imported `:84` from `@/lib/game/noise`), already used by `enterHide()`'s own
   roam-predator alert loop (`:3568`) with `hearNoise(p)` (`:2456`) as the actual alert call.
   Reused verbatim below, not reinvented.
4. **Exit-tax reality check.** `exitHide()` is reached two ways: `toggleHidden()`
   (`:3596`, manual H-press) and the movement-break check inside `stepFrame()`
   (`:6486`: `if(hidden && (moveKey || hasTouchMove)) exitHide();`). Both are "the player is
   leaving bramble," so both get the same tax via the shared `exitHide()` funnel — the
   proposal's "exiting bramble at sprint" is not a separate trigger to wire, it's already
   covered by every `exitHide()` call reading `isSprintHeld()` once.
5. `coverKind==='bramble'` in the proposal should read `spot.kind==='bramble'` in
   `enterHide(spot)` / `hideKind==='bramble'` in `exitHide()` — `coverKind` is not a variable
   in this file; `hideKind` (`:3213` comment, set `:3555`) is the one that tracks which prop
   kind is currently hidden-in. Today `HIDE_KINDS = { bramble: true }` only
   (`lib/game/cover.ts:629`), so this check is always true in practice — kept explicit as
   future-proofing per the proposal's own reasoning, not because it can fail today.

## Files

- `engine/tuning.js` — add three new tunables (append at EOF, no existing line shifts).
- `engine/forest-engine.js` — new `brambleSnagT` state, `isSprintHeld()` helper,
  `thornSnagSound()`, entry/exit tax in `enterHide()`/`exitHide()`, decay in the tick loop,
  speed multiplier applied in the movement calc, `qaPlayerState()` extended.
- `lib/game/cover.ts` — new pure `brambleSnagSpeedMultiplier()` (append at EOF).
- `lib/game/cover.test.ts` — unit test for the new function.
- `engine/forest-engine.d.ts` — extend `qaPlayerState`'s return type with `brambleSnagT`.
- `e2e/hide.spec.ts` — new test.
- `docs/ELEMENTS.md` — new row/citations for the two new engine symbols.
- `shared/local-qa/requests/lul-3254-bramble-thorn-snag.md` — new local-qa request file.

## The change

### 1. `engine/tuning.js` — append at end of file (after the existing `CUT_END` export, EOF is
line 327 today; append-only so no existing citation anywhere in the codebase shifts)

```js

// ---- Bramble Thorn Snag (LUL-4526) ---------------------------------------------
// Sprint-diving into the sole hide spot (bramble) costs a stumble + noise burst; walking in
// stays free/silent. Pricing owned by the Game Economist in parallel (LUL-4526) -- these are
// the proposal's example values, not final tuning; retune here, no call site changes needed.
export const BRAMBLE_SNAG_DURATION_S = 0.3;   // seconds of reduced-speed "stumble" after a sprint entry/exit
export const BRAMBLE_SNAG_SPEED_MUL = 0.4;    // movement-speed multiplier applied for that window
export const BRAMBLE_SNAG_NOISE_RADIUS = 5;   // noise-burst radius, smaller than THROWABLE_NOISE_RADIUS
```

### 2. `engine/forest-engine.js`

**Import** the three new consts — append onto the existing tuning import list
(`:201-209`), extending the last content line (`:208`) rather than inserting a new one:

```
  FORCE_HUNT_LOCK, PROP_MIN_SPACING, PROP_CHUNK_CAP, applyQaWorldMicroPreset,
  BRAMBLE_SNAG_DURATION_S, BRAMBLE_SNAG_SPEED_MUL, BRAMBLE_SNAG_NOISE_RADIUS,
} from '@/engine/tuning';
```
(splitting across two lines like this is fine — `:208`'s existing content is unchanged, only
a new line is added directly after it, which is equivalent for import-list purposes; if you
prefer true zero-new-lines, append `, BRAMBLE_SNAG_DURATION_S, BRAMBLE_SNAG_SPEED_MUL,
BRAMBLE_SNAG_NOISE_RADIUS` onto `:208` itself before the comma.)

**New state** — extend the existing `stoneMarkerPulseT` declaration at `:448` (same line,
no shift):
```js
let stoneMarkerPulseT = 0, brambleSnagT = 0;   // LUL-4526: Thorn Snag stumble countdown
```

**New helper** — add directly above `enterHide()` (`:3554`):
```js
// LUL-4526: mirrors the per-frame `running` expression at :6582 exactly, but callable from
// enterHide()/exitHide()/toggleHidden(), none of which run inside stepFrame()'s per-frame
// scope where `running` itself lives. Do not merge this into :6582 -- see spec deviation #1.
function isSprintHeld(){
  return runMode === 'toggle' ? (toggleRunOn || touchSprint) : (!!keys['ShiftLeft'] || !!keys['ShiftRight'] || touchSprint);
}
// LUL-4526: same procedural-noise-burst shape as leafRustle()/rustleSting() (:3525/:3770) --
// no audio files, no bus, gated identically on `audio && soundOn`.
function thornSnagSound(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise(ctx, 0.15, false);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.16);
  src.connect(bp); bp.connect(g); g.connect(master); g.connect(conv);
  src.start(t); src.stop(t+0.18);
}
```

**Entry tax** — in `enterHide(spot)` (`:3554-3556`), insert immediately after the existing
first line (`hidden = true; hideTime = 0; hideKind = spot.kind; hideEventCount++;
leafRustle(true);`) and before the existing `track(...)` call:
```js
  // LUL-4526: Thorn Snag -- sprint-diving into bramble costs a stumble + alerts nearby
  // roaming predators; walking in (isSprintHeld()===false) stays free and silent.
  if(spot.kind === 'bramble' && isSprintHeld()){
    brambleSnagT = BRAMBLE_SNAG_DURATION_S;
    thornSnagSound();
    let snagAlerted = 0;
    for(const p of predators){
      if(p.inert || p.state !== 'roam') continue;
      if(checkThrowableNoise(Math.hypot(p.x - player.x, p.z - player.z), BRAMBLE_SNAG_NOISE_RADIUS)){ hearNoise(p); snagAlerted++; }
    }
    logChronicle('bramble_snag', { alerted: snagAlerted });
    if(!hintSeen('brambleSnag')){
      markHintSeen('brambleSnag');
      if(captionsOn) pushState({ caption: 'Diving into bramble at a sprint snags you for a moment — walk in instead to stay silent.', captionId: ++captionSeq });
    }
  }
```
(This is additive alongside the existing entry-noise-alert loop later in the function
(`:3565-3570`, `HIDE_ALERT_RADIUS`) — that loop fires on every hide entry regardless of
sprint; this one is the extra sprint-only tax, separately logged/chronicled so the two are
distinguishable in telemetry.)

**Exit tax** — replace `exitHide()` (`:3576`) with:
```js
function exitHide(){
  if(!hidden) return;
  leafRustle(false);
  // LUL-4526: symmetric to the entry tax -- reads hideKind/isSprintHeld() before either is
  // cleared below. Covers both call paths (manual toggleHidden() and the movement-break
  // check at :6486) since both route through this one funnel.
  if(hideKind === 'bramble' && isSprintHeld()){
    brambleSnagT = BRAMBLE_SNAG_DURATION_S;
    thornSnagSound();
    let snagAlerted = 0;
    for(const p of predators){
      if(p.inert || p.state !== 'roam') continue;
      if(checkThrowableNoise(Math.hypot(p.x - player.x, p.z - player.z), BRAMBLE_SNAG_NOISE_RADIUS)){ hearNoise(p); snagAlerted++; }
    }
    logChronicle('bramble_snag', { alerted: snagAlerted });
  }
  hidden = false; hideKind = null;
}
```

**Decay** — extend the existing `stoneMarkerPulseT` decay line (`:6535`, same line, no
shift):
```js
  if(stoneMarkerPulseT > 0) stoneMarkerPulseT = Math.max(0, stoneMarkerPulseT - dt);   // LUL-2331
  if(brambleSnagT > 0) brambleSnagT = Math.max(0, brambleSnagT - dt);   // LUL-4526
```

**Speed multiplier** — in the movement calc inside `if(playing && !hidden){...}` (`:6586`),
extend the existing `maxSpd` line:
```js
    const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * bogSpeedMultiplier(playerBogginess) * lakeSpeedMultiplier(playerInLake) * brambleSnagSpeedMultiplier(brambleSnagT);
```
(`brambleSnagSpeedMultiplier` imported from `@/lib/game/cover` — append it onto the existing
`lib/game/cover` import list, which ends `PLAYER_COLLISION_RADIUS,\n} from '@/lib/game/cover';`
at `:79-80`; add `brambleSnagSpeedMultiplier,` after `PLAYER_COLLISION_RADIUS,` on `:79`.)

**`qaPlayerState()`** (`:5126-5142`) — extend the existing `hidden: hidden,` return line
(`:5142`, same line, no shift):
```js
      hidden: hidden, brambleSnagT: brambleSnagT,
```

### 3. `lib/game/cover.ts` — append at EOF (after `rollCoverPropShape`)

```ts

// LUL-4526: Thorn Snag speed penalty during the post-sprint-transition stumble window.
// Pure so it's unit-testable without a Three.js scene, same rationale as this file's other
// exports (module comment above). Mirrors bogSpeedMultiplier()/lakeSpeedMultiplier()'s
// explicit-arg shape (lib/game/bog.ts:153, lib/game/lake.ts:42) rather than reading engine
// state internally.
import { BRAMBLE_SNAG_SPEED_MUL } from '@/engine/tuning';

export function brambleSnagSpeedMultiplier(brambleSnagT: number): number {
  return brambleSnagT > 0 ? BRAMBLE_SNAG_SPEED_MUL : 1;
}
```
(Move the `import` line to the top of the file with the existing `wrapCoord` import if your
linter's `import/first` rule objects — check `eslint` output before opening the PR.)

### 4. `lib/game/cover.test.ts` — add near the existing `rollCoverPropShape` tests

```ts
import { brambleSnagSpeedMultiplier } from './cover';

test('brambleSnagSpeedMultiplier: full speed once the snag timer clears', () => {
  expect(brambleSnagSpeedMultiplier(0)).toBe(1);
});
test('brambleSnagSpeedMultiplier: reduced while the snag timer is live', () => {
  expect(brambleSnagSpeedMultiplier(0.3)).toBeLessThan(1);
  expect(brambleSnagSpeedMultiplier(0.01)).toBeLessThan(1);
});
```
(Match the file's actual test runner syntax — grep an existing `describe`/`test` block in
`cover.test.ts` before writing these; do not assume Jest vs. Vitest globals.)

### 5. `engine/forest-engine.d.ts` — extend `qaPlayerState`'s return type (`:294-298`)

```ts
      qaPlayerState?: () => {
        x: number; z: number; yaw: number; pitch: number; mode: 'desktop' | 'mobile';
        jumping: boolean; paused: boolean; toggleRunOn: boolean; veilHeld: boolean;
        hidden: boolean; brambleSnagT: number;
      };
```

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean (the `cover.ts` import placement above especially).
- `node --run build` (or repo's build script) — clean.
- `npx vitest run lib/game/cover.test.ts` (or repo's actual unit-test command) — new tests
  pass, no regressions.
- `node scripts/check-elements-citations.mjs` — OK, 0 new bad citations, after the
  `docs/ELEMENTS.md` update below.
- Full e2e list per `## e2e` below.

## e2e

**Specs.** `e2e/hide.spec.ts` — new test `'sprint-diving into bramble triggers Thorn Snag: stumble speed + noise burst wakes a nearby roaming predator; walking in stays silent'`.
Two assertions in one test (sprint-dive triggers, walk-in doesn't), staged back to back on
the same micro scene so the "walking in is free" half is a real negative control, not just
asserted from the code:
```ts
await boot(page, { qaHooks: true, qaWorld: 'micro' });
await enter(page);
await qaHook(page, 'qaBuildScene', {
  props: [{ kind: 'bramble', x: 10, z: 0 }],
  predators: [{ kind: 'wolf', x: 10, z: -5, state: 'roam' }],   // 5u from the bramble, inside BRAMBLE_SNAG_NOISE_RADIUS
});
const spot = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
if (spot === null) throw new Error('qaTeleportToHideSpot returned null');

// walk-in first (control): no sprint key held.
await page.keyboard.press('KeyH');
let ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
expect(ps?.brambleSnagT ?? 0).toBe(0);
let pred = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i), 0);
expect(pred?.state).toBe('roam');   // unalerted
await page.keyboard.press('KeyH');   // exit, still no sprint

// sprint-dive: hold Shift through entry.
await page.keyboard.down('ShiftLeft');
await page.keyboard.press('KeyH');
ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
expect(ps?.brambleSnagT ?? 0).toBeGreaterThan(0);
pred = await page.evaluate((i) => window.ForestEngine?.qaPredatorState?.(i), 0);
expect(pred?.state).not.toBe('roam');   // alerted by the noise burst
await page.keyboard.up('ShiftLeft');
```
**World.** micro, via `qaBuildScene({ props: [...], predators: [...] })` exactly as shown —
the mechanic only needs one bramble and one roaming predator at a fixed, known offset; no
`@fullmap` reason applies (founder rule LUL-2377).
**Hooks.** `qaTeleportToHideSpot` (existing, `engine/forest-engine.d.ts:196`),
`qaPlayerState` (existing, extended by this spec, `:294`), `qaPredatorState` (existing,
`:244`), `qaBuildScene` (existing, `:567`). No new hook needed — sprint state is driven by
real `page.keyboard.down('ShiftLeft')`, which lands in the same module-level `keys` object
`isSprintHeld()` reads (`keys[e.code] = true` on the real `keydown` listener,
`engine/forest-engine.js:3290`), so the test exercises the real input path end to end, not a
QA-only shortcut.
**Tester scenario.** New request file `shared/local-qa/requests/lul-3254-bramble-thorn-snag.md`
(steps below) for the nightly desktop + mobile-landscape sweep to confirm the caption/sound
cue actually renders and the HUD doesn't regress around it; the e2e test above is the
regression gate, the local-qa request is the human-facing cue check.
**Not covered.** Actual audio timbre/feel (procedural WebAudio, `thornSnagSound()`) — manual.
The mobile-touch-sprint path (`setTouchSprint`, `:7333`) is not separately e2e'd here since
`touchSprint` feeds the exact same `isSprintHeld()` boolean the desktop test already proves;
flag to whoever runs the local-qa mobile-landscape pass to confirm the touch control's feel,
not its wiring.

## Cues

**Visual.** Movement-speed drop is the stumble tell itself — no separate animation asset;
the existing camera/movement response to `maxSpd` dropping ~60% for 0.3s
(`brambleSnagSpeedMultiplier`, `engine/forest-engine.js:6586`) reads as the "snag."
**Audio.** `thornSnagSound()` (new, `engine/forest-engine.js`, placed above `enterHide()`) —
gated by `soundOn`.
**Explanation.** First encounter only: "Diving into bramble at a sprint snags you for a
moment — walk in instead to stay silent." (`enterHide()`, gated `captionsOn`, one-shot via
`hintSeen('brambleSnag')`/`markHintSeen('brambleSnag')` — same pattern as the existing
`hideAlert`/`coverRustle` one-shot toasts at `:3571`/`:3591`, not a `HIDE_PRIORITY` pill).
**Reduced motion.** No animation to reduce — the tell is a numeric speed multiplier plus
sound/caption, not a visual effect gated by `motionReduced()`.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Entry/exit tax must key off `isSprintHeld()`, never the per-frame `running` local (out of
  scope inside `stepFrame()`, see deviation #1) — do not thread `running` as a parameter into
  `enterHide`/`exitHide` as a shortcut; call the new helper.
- `brambleSnagT` only ever gates a movement-speed multiplier and the one-shot noise/sound —
  it must not block re-entering or re-exiting hide, must not extend `hideTime`, and must not
  interact with Cover Degradation's `coverRustleAccum` (LUL-2856, orthogonal timer per the
  proposal).
- **LUL-4786 (Hide Reposition / Wind-Gated Shuffle, in flight)**: when that ships, its
  `shuffleHide()` repositions the player within an already-active hide without calling
  `exitHide()`/`enterHide()` (it resets `hideTime=0` directly per `docs/specs/lul-3066-hide-reposition.md`).
  Confirm that stays true when implementing this spec — if `shuffleHide()` ever starts routing
  through `enterHide()`/`exitHide()`, it would double-tax every wind-shuffle with a fresh
  Thorn Snag, which is explicitly out of scope per the proposal ("repositioning within an
  already-active bramble hide should NOT re-trigger Thorn Snag").

## Out of scope

- Pricing/tuning of `BRAMBLE_SNAG_DURATION_S`/`BRAMBLE_SNAG_SPEED_MUL`/`BRAMBLE_SNAG_NOISE_RADIUS`
  — Game Economist territory per the proposal, shipped here with the proposal's example
  values as a starting point, not final numbers.
- Mobile touch-sprint UI/feel — wiring is identical (`touchSprint` feeds `isSprintHeld()`
  directly), only the local-qa manual pass covers feel.
- Any change to `HIDE_KINDS`/`WALKABLE_KINDS` (`lib/game/cover.ts:629`) — bramble stays the
  only hide-eligible kind; this spec does not touch log/rock/reed.
