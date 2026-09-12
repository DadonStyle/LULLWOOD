# SPEC: Cover Alert Feedback — hide entry emits detectable noise

**Ticket:** LUL-2547 (CEO-accepted Scout proposal LUL-2546, `game/mechanics/cover-alert-feedback.md`).
**Tier:** C — `engine/forest-engine.js` predator-AI simulation change. Requires `REVIEW: APPROVED`
before merge, no `[ship]`.
**Read at:** `origin/release/next @ 06ea606` (2026-09-12T08:03:30Z).
**Branch:** `lul-2547-cover-alert-feedback`, off `release/next`.
**Spec owner:** Founding Engineer (per CTO PLAN comment on this ticket). **Implementer:** Game
Engineer — small (4 files, ~40 lines, one new pure hook, one new e2e file) but touches the
simulation file, so it stays a normal Tier C handoff rather than FE self-implementing.

**Two corrections to the CTO's PLAN comment below**, found while grounding this against the live
code — flagging per "declare deviations from any recorded decision" rather than silently
following the plan's literal wording:

1. **Caption persistence.** The PLAN's decision 4 proposes a bespoke `HIDE_ALERT_CAPTION_KEY`
   localStorage flag modeled on the *pre-LUL-2230* `SCENT_TRAIL_CAPTION_KEY` pattern. That pattern
   no longer exists as a per-feature one-off: LUL-2230 generalized it into a shared registry —
   `hintSeen(key)`/`markHintSeen(key)` under `HINT_KEY_PREFIX = 'lullwood:hints:'`
   (`engine/forest-engine.js:1866-1897`), with `SCENT_TRAIL_CAPTION_KEY` itself demoted to
   `LEGACY_SCENT_HINT_KEY`, a read-only migration fallback (`:1870`). `resetHints()`/`qaResetHints()`
   (`:1900-1910`, `:4754`) only clear the `HINT_KEY_PREFIX` namespace — a new bespoke key would be
   invisible to `qaResetHints()`, and the comment at `:4733` ("prefer `qaResetHints()` for new
   tests") is explicit that new one-time-caption keys should go through the registry, not invent
   their own. **This spec uses `hintSeen('hideAlert')`/`markHintSeen('hideAlert')` for the
   seen-tracking only** — display still goes through the plain `captionsOn`-gated
   `pushState({caption, captionId})` toast (PLAN decision 4 is right that the full
   `HINT_PRIORITY`/`hintActiveKey` slot-competition machinery is the wrong size for a one-shot
   post-action line; that reasoning is unchanged, only the *seen-flag* vehicle moves to the
   current registry).
2. **Chronicle type contract.** The PLAN's file list (final paragraph) only names
   `engine/forest-engine.js`, `engine/forest-engine.d.ts`, `lib/game/noise.ts`, and a new e2e spec.
   It misses `lib/game/chronicle.ts`: `ChronicleCode` is a closed TS union
   (`lib/game/chronicle.ts:12-20`) and `lineFor()`'s `switch` (`:77-88`) falls through to
   `default: return ''` for any code not in that switch. `logChronicle()` itself is untyped JS, so
   nothing stops the engine from pushing an unrecognized `'hide_alert'` code — but every such event
   would render as a blank `"0:12 — "` line on the win/death chronicle screen, a real player-visible
   bug, not just a lint gap. **`chronicle.ts` needs the new code added to both the union and the
   switch in the same PR.**

## Files

- `lib/game/noise.ts` — add `HIDE_ALERT_RADIUS` constant.
- `engine/forest-engine.js` — `enterHide()` broadcast + caption, new QA hook, `.d.ts`-declared hook
  wiring, import line.
- `engine/forest-engine.d.ts` — declare the new QA hook.
- `lib/game/chronicle.ts` — add `'hide_alert'` to `ChronicleCode` and a `lineFor()` case.
- `lib/game/chronicle.test.ts` — one new case for the added code.
- `e2e/hide-alert.spec.ts` — new file (neither `e2e/hide.spec.ts`, which is explicitly
  predator-free per its own header comment, nor `e2e/cover-feedback.spec.ts`, which asserts the
  unrelated LOS-covered signal, is the right home).

## The change

### 1. `lib/game/noise.ts` — new constant

Add after `CARRIED_NOISE_FLOOR` (`:41`), same doc-comment style as its neighbors:

```ts
/** LUL-2547: hide-entry is a one-shot noise event, same "distance check, not a roll" shape as
 * checkThrowableNoise() -- ducking into cover isn't silent, it's a rustle a nearby predator can
 * notice. Default value; Game Economist owns retuning it once live `hide_alert` chronicle data
 * (the `alerted` count below) gives a signal to tune against. */
export const HIDE_ALERT_RADIUS = 20;
```

No new predicate function — reuse the existing exported `checkThrowableNoise(dist, radius)`
(`:49-51`) at the call site, passing `HIDE_ALERT_RADIUS` as the second argument. It is already the
correct one-shot deterministic-distance predicate (PLAN decision 2 is correct on this point).

### 2. `engine/forest-engine.js` — import

Add `HIDE_ALERT_RADIUS` to the existing noise import block (`:84`):

```diff
-import { isNoiseHeard, NOISE_RADIUS_WALK, NOISE_RADIUS_RUN, checkThrowableNoise, THROWABLE_NOISE_RADIUS, CRY_NOISE_RADIUS, CARRIED_NOISE_FLOOR } from '@/lib/game/noise';
+import { isNoiseHeard, NOISE_RADIUS_WALK, NOISE_RADIUS_RUN, checkThrowableNoise, THROWABLE_NOISE_RADIUS, CRY_NOISE_RADIUS, CARRIED_NOISE_FLOOR, HIDE_ALERT_RADIUS } from '@/lib/game/noise';
```

### 3. `engine/forest-engine.js` — caption-seen flag

Near the other localStorage-backed one-time flags (`HAS_DIED_KEY` block, `:2789-2791`), no new
module-level boolean is needed — `hintSeen()`/`markHintSeen()` already cache in `hintSeenCache`
(`:1875`), so nothing to declare here beyond calling them at the site below.

### 4. `engine/forest-engine.js` — `enterHide()` (`:3115`)

Current:

```js
function enterHide(spot){ hidden = true; hideTime = 0; hideKind = spot.kind; hideEventCount++; leafRustle(true); track({ event: 'feature_engagement', feature: 'hide', action: 'used', carrying }); logChronicle('hide', { kind: spot.kind }); }
```

New (broadcast + chronicle appended after the existing `logChronicle('hide', ...)` call; caption
guarded so it only ever shows once):

```js
function enterHide(spot){
  hidden = true; hideTime = 0; hideKind = spot.kind; hideEventCount++; leafRustle(true);
  track({ event: 'feature_engagement', feature: 'hide', action: 'used', carrying });
  logChronicle('hide', { kind: spot.kind });
  // LUL-2547: hiding isn't silent -- a one-shot noise broadcast on entry, same shape as
  // throwThrowable()'s per-predator loop (:4933-4947), but gated to `state === 'roam'` (the
  // same gate the per-frame roam-branch noise check already uses, :2386) unlike throwThrowable's
  // ungated loop. A thrown stone is a deliberate distraction meant to interrupt an active
  // chase/hunt/charge; hiding is not -- broadcasting unconditionally would let hearNoise()
  // downgrade an already-chasing predator straight to 'investigate', turning "duck into a bush"
  // into a free chase-reset button. Only previously-unaware, roaming predators get newly alerted.
  let alerted = 0;
  for(const p of predators){
    if(p.inert || p.state !== 'roam') continue;
    if(checkThrowableNoise(Math.hypot(p.x - player.x, p.z - player.z), HIDE_ALERT_RADIUS)){ hearNoise(p); alerted++; }
  }
  logChronicle('hide_alert', { kind: spot.kind, alerted });
  if(!hintSeen('hideAlert')){
    markHintSeen('hideAlert');
    if(captionsOn) pushState({ caption: 'Hiding makes noise — predators within earshot will investigate.', captionId: ++captionSeq });
  }
}
```

Notes for the implementer:
- `logChronicle('hide_alert', ...)` fires on every hide entry, including `alerted: 0` — the PLAN's
  requirement that the Economist get real signal for the deferred radius/decay tuning depends on
  the zero case being logged too, not just non-zero hits.
- If a predator *is* alerted on the very first hide, `hearNoise(p)`'s own caption
  (`` `${p.kind} heard you · ${near} · ${b.side}` ``, `:2031-2034`) fires inside the loop above,
  with a higher `captionId` than the explanatory toast pushed after the loop — the later
  `pushState` wins in the UI and the explanatory caption is visibly superseded before the player
  reads it. This is the PLAN's own called-out tradeoff (decision 4); still acceptable for this
  slice, not a bug to fix here.
- Do not add a `hidden`/`sniffImmune` gate to this loop — `enterHide()` only runs on transition
  into hiding (`toggleHidden()`, `:3117-3120`, calls it once per KeyH press when not already
  hidden), so there is no per-frame duplicate-firing risk to guard against.

### 5. `engine/forest-engine.js` — new QA hook

Place next to `qaStagePredatorNearThrowLanding` (`:4683-4694`), which it mirrors — same
zero-velocity/zero-alert/roam reset, but relative to `player.x/z` instead of a throw-landing
point, and without `qaStageForceHuntApproach`'s `sinceClose` side effect (irrelevant here):

```js
// [QA-HOOK] LUL-2547: places predator[kind] dx/dz from the *player's current position* (not a
// throw-landing point like qaStagePredatorNearThrowLanding) so a test can stage "predator within
// hide-alert radius" after qaTeleportToHideSpot() without qaBuildScene() wiping the natural cover
// spot that teleport depends on (same reason qaStagePredatorNearThrowLanding exists as its own
// hook rather than reusing qaBuildScene's predator placement).
window.ForestEngine.qaStagePredatorNearPlayer = function(kind, dx, dz){
  const idx = predators.findIndex(p => p.kind === kind);
  if(idx < 0) return null;
  const p = predators[idx];
  p.x = player.x + dx; p.z = player.z + dz;
  p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0;
  p.state = 'roam'; p.hunt = false;
  return { idx, x: p.x, z: p.z };
};
```

Also add, anywhere in the same `?qaHooks` block (e.g. next to `qaGetPredatorLkp`, `:4042-4046`) —
needed because nothing today exposes the live `chronicle` buffer (it is only ever handed to React
at win/death via `chronicle.slice()` on the `pushState` calls at `:5001`/`:5122`/`:5157`; the e2e
case below needs to read it mid-run):

```js
// [QA-HOOK] LUL-2547: exposes the live chronicle buffer (engine/forest-engine.js's own
// `chronicle` array, normally only handed to React at win/death) so a test can assert an event
// was logged without ending the run. Read-only; returns a copy so a test can't mutate engine state.
window.ForestEngine.qaGetChronicle = function(){ return chronicle.slice(); };
```

### 6. `engine/forest-engine.d.ts` — hook declarations

Next to `qaStagePredatorNearThrowLanding?:` (`:366`):

```ts
qaStagePredatorNearPlayer?: (kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number) => { idx: number; x: number; z: number } | null;
```

Next to `qaResetHints?:` (`:422`):

```ts
qaGetChronicle?: () => { t: number; code: string; args: Record<string, unknown> | null }[];
```

### 7. `lib/game/chronicle.ts` — new event code

`ChronicleCode` union (`:12-20`): add `| 'hide_alert'` after `'hide'`.

`lineFor()`'s `switch` (`:77-88`): add a case after `'hide'`. Player-facing text should read
naturally whether or not anything was actually alerted — use the `alerted` count already logged:

```ts
case 'hide_alert': return (a.alerted as number) > 0
  ? `something stirred nearby as you went still.`
  : '';
```

The `alerted === 0` case renders an empty string deliberately (same `default: return ''` shape the
switch already uses for codes with nothing to say) — `hide_alert` exists primarily as tuning
telemetry for the Economist, not as a player-facing chronicle line every time; only the
alerted-something-happened case is worth a sentence on the win/death recap. `fmtTime` still runs
for it via `formatChronicle`'s `.map()`, so confirm empty lines don't leave a bare timestamp —
check `formatChronicle()` (`:93-95`) and, if a bare `"0:12 — "` would show, filter empty-`lineFor`
results out in `formatChronicle()` rather than upstream (keeps `logChronicle()` a dumb append, per
its own comment at `:2778-2780`).

### 8. `lib/game/chronicle.test.ts` — new case

Add one `'hide_alert'` case with `args: { kind: 'bramble', alerted: 1 }` and one with
`alerted: 0`, next to the existing `'hide'` cases (`:41`, `:66`), asserting the alerted case
produces the new line and the zero case produces no visible line (however task 7 above resolves
the empty-line handling).

## Deliberately not changed

- `checkNoise()`/`isNoiseHeard()` (`:2020`, `lib/game/noise.ts`) — the per-frame probabilistic
  footstep roll is unrelated; hide-entry is a one-shot event like a thrown stone, not continuous
  movement noise (PLAN decision 2, confirmed correct against the live code).
- No new `EngineActions` key — `enterHide()` already fires through the existing `toggleHidden()`
  action; the founder's engine/React contract rule (2026-09-09) doesn't apply to a change with no
  new `EngineActions` surface.
- `Hud.tsx` — untouched; the caption toast and chronicle are both existing display pipelines.
- No new SFX/animation — `leafRustle(true)` (already called by `enterHide()`) is the existing
  audio/visual cue for hide entry; the ticket is explicit that this covers it.
- Wolf-pack `flank` state and `hunt`/`chase`/`investigate` predators are not newly alerted by this
  broadcast — only `state === 'roam'` — per the exploit concern in the code comment above.
- `CONFIG.detectScaleMul`/`CONFIG.speedScaleMul` (QA micro-world scaling, `:2172-2237`) — these
  scale sight-detect radius and predator speed only; the existing noise system
  (`NOISE_RADIUS_WALK/RUN`, `THROWABLE_NOISE_RADIUS`) is never scaled by them, so
  `HIDE_ALERT_RADIUS` needs no scaling treatment either, for consistency.

## Verification

```bash
cd /home/noam/lullwood
npx next typegen && npx tsc --noEmit
npm run lint
node --test lib/game/chronicle.test.ts
npx playwright test e2e/hide-alert.spec.ts e2e/hide.spec.ts e2e/cover-feedback.spec.ts
```

## e2e

**Specs.** `e2e/hide-alert.spec.ts` — new file, three cases:
1. `'a roaming predator within the alert radius is alerted on hide entry'`
2. `'a roaming predator outside the alert radius stays unaware'`
3. `'the first-hide caption shows once and does not repeat'`

**World.** micro (`qaWorld: 'micro'`), no `@fullmap` reason applies. `qaBuildScene({ props: [{
kind: 'bramble', x: 10, z: 0 }], predators: [{ kind: 'wolf', x: 9999, z: 9999, state: 'roam' }] })`
— predator parked far away by `qaBuildScene` itself, then repositioned near the player after
`qaTeleportToHideSpot()` by the new `qaStagePredatorNearPlayer` hook (case 1: `dx/dz` inside
`HIDE_ALERT_RADIUS`, e.g. `(15, 0)`; case 2: outside, e.g. `(25, 0)`).

**Hooks.**
- `qaStagePredatorNearPlayer(kind, dx, dz): {idx,x,z}|null` — new, declared `engine/forest-engine.d.ts` next to `:366`, installed `engine/forest-engine.js` next to `:4683`.
- `qaGetChronicle(): ChronicleEvent[]` — new, declared next to `:422`, installed next to `:4042`.
- `qaTeleportToHideSpot`, `qaPredatorState`, `qaResetHints`, `qaSetFixedStep`, `qaAdvance` — existing, all already declared/installed (`:143`, `:4260`, `:422`/`:4754`, `:347`, `:351`).

**Sketch (case 1):**
```ts
await boot(page, { qaHooks: true, qaWorld: 'micro' });
await enter(page);
await qaHook(page, 'qaBuildScene', { props: [{ kind: 'bramble', x: 10, z: 0 }], predators: [{ kind: 'wolf', x: 9999, z: 9999, state: 'roam' }] });
await page.evaluate(() => window.ForestEngine.qaTeleportToHideSpot());
await qaHook(page, 'qaStagePredatorNearPlayer', ['wolf', 15, 0]);
await page.keyboard.press('KeyH');
const state = await page.evaluate(() => window.ForestEngine.qaPredatorState(0));
expect(state.state).toBe('investigate');
const chronicle = await page.evaluate(() => window.ForestEngine.qaGetChronicle());
expect(chronicle.some(e => e.code === 'hide_alert' && e.args.alerted === 1)).toBe(true);
```
Case 2 is the same setup with `dx=25` (outside `HIDE_ALERT_RADIUS=20`), asserting
`state.state === 'roam'` and `chronicle`'s last `hide_alert` entry has `alerted: 0`.
Case 3: `qaResetHints()` first, hide once with a predator far away (`dx=9999`, avoids the
superseding-caption interaction noted in §4), assert the caption text via whatever
`document.body.dataset`/`hudState` surfaces `caption` today (match `e2e/hide.spec.ts`'s existing
caption-reading pattern); hide a second time (exit + re-enter), assert it does not reappear.

**Tester scenario.** None beyond the Playwright suite above — this is a one-shot logic change with
no new visual/audio asset; nothing here needs the nightly local-qa tester's vision-model check.

**Not covered.** Whether the rustle sound/leaf animation "feels" audible/noticeable enough at 20u
is a Game Economist tuning call once live `hide_alert` chronicle data exists (ticket's Defer
section) — unverified by this spec, by design.

## Cues

**Visual.** None new — `leafRustle(true)` (already called, unconditionally, by the existing
`enterHide()` line) is the only visual/audio cue; this ticket adds no new render call.
**Audio.** `leafRustle(true)` — existing, `enterHide()` (`:3115`), gated the same way it already is
today (not newly gated by this change).
**Explanation.** `'Hiding makes noise — predators within earshot will investigate.'` — first hide
only, `enterHide()` new caption block (§4 above), gated by `captionsOn` and `hintSeen('hideAlert')`.
**Reduced motion.** Not applicable — no new animation; `leafRustle`'s existing behavior under
`reducedMotion` is unchanged.

## Constraints

- Tier C: `REVIEW: APPROVED` from Code Reviewer required before merge.
- No new `EngineActions` key (confirmed above) — skip the engine/React contract checklist.
- `tsc --noEmit` must pass with `'hide_alert'` added to `ChronicleCode` — this is the check that
  would have caught the PLAN's chronicle-file gap if skipped.

## Out of scope

- Crouch/wait-to-silence stance mechanic — deferred per the ticket and the accepted proposal's
  Defer section.
- Proximity-gated noise (only audible if a predator is already near) — deferred, same section.
- `HIDE_ALERT_RADIUS` value tuning, decay, or state-scaling — Game Economist follow-up once live
  `alerted`-count chronicle data exists; this slice ships the default (20) and the telemetry, not
  the tuning.
- `qaTeleportToHideSpot`'s `.d.ts` type still listing `'log'` (`:143`) despite LUL-2311 removing
  log-hiding from `HIDE_KINDS` — pre-existing drift, unrelated to this ticket, not fixed here.
