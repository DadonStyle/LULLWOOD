# SPEC: LUL-2667 (4/6) time-of-day QA override + e2e coverage

**Ticket:** LUL-2667 (4/6, split from LUL-2667, parent of parent LUL-2613) · **Tier:** C --
adds a new boot-time branch to `engine/forest-engine.js`'s `init()`, ahead of
`generateMap()`, on the code path every real page load executes (the branch is opt-in but
sits inline with the LUL-2328 `qaWorld`/`qaNoRender` reads, same boot-path risk class as
that spec). `REVIEW: APPROVED` from the Code Reviewer required before merge.

**Written against:** `release/next` @ `eb65076c` (2026-09-18). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

## Files

- `engine/forest-engine.js` -- edited. `?qaHour=` read at the `timeOfDay` call site
  (`:327`); new `qaProbeTimeOfDay` hook inside the `?qaHooks=1` block (`:3965-`).
- `engine/forest-engine.d.ts` -- edited. `qaProbeTimeOfDay` declared on
  `Window.ForestEngine`, same JSDoc-per-hook pattern as every existing entry (e.g.
  `qaProbeMinimapPoint` `:72`, `qaProbeLandmarkBeacons` `:76`).
- `e2e/helpers.ts` -- edited. `boot()`'s options gain `qaHour?: number | null` (default
  `null`), appended to `params` the same way `qaNoRender` is (`:99-100`).
- `e2e/time-of-day.spec.ts` -- created. The specs in the `## e2e` section below.

## The change

### 1. `?qaHour=` override (`engine/forest-engine.js:327`)

```js
// LUL-2667: ?qaHour=<0-23> pins the hour timeOfDayFromHour() sees, for
// deterministic e2e coverage of a system that otherwise reads the real
// wall-clock hour once at module load (LUL-1644, see docs/specs/time-of-day.md).
// Falls back to the real clock when absent/invalid, so real players are
// unaffected. Read here rather than added to the qaParams block above
// (:244) because that block runs after CONFIG mutation for qaWorld/
// qaNoRender, and this line already has its own qaParams-shaped read --
// same window.location.search source, no second URLSearchParams parse.
const qaHourParam = qaParams ? qaParams.get('qaHour') : null;
const qaHourNum = qaHourParam === null ? NaN : Number(qaHourParam);
const timeOfDay = timeOfDayFromHour(Number.isFinite(qaHourNum) ? qaHourNum : new Date().getHours());
```

`qaParams` already exists at `:244` (`const qaParams = typeof window !== 'undefined' ? new
URLSearchParams(window.location.search) : null;`), read before this line -- reuse it rather
than re-parsing `window.location.search`. No `?qaHooks=1` gate on the read itself, matching
`qaWorld`/`qaNoRender`'s own comment (`:248-249`: "neither requires `?qaHooks=1`") --
absent by default, so it does nothing for a real player regardless of hooks flag.
`timeOfDayFromHour()` (`lib/game/timeOfDay.ts:34`) already normalizes any real number
(`((Math.floor(hour) % 24) + 24) % 24`), so passing e.g. `26` or `-1` is safe without
extra clamping here.

### 2. `qaProbeTimeOfDay` hook (inside the `?qaHooks=1` block, `engine/forest-engine.js:3965-`)

```js
// LUL-2667: exposes the resolved timeOfDay state plus the exact TOD_VISUAL/
// TOD_AUDIO values init() applied, so a test can assert against the six
// documented states (lib/game/timeOfDay.ts) without scraping renderer
// internals (scene.fog.color, hemiLight.color, etc. are Three.js instances,
// not plain values a test can diff cleanly).
window.ForestEngine.qaProbeTimeOfDay = function(){
  return { state: timeOfDay, visual: TOD_VISUAL, audio: TOD_AUDIO };
};
```

`timeOfDay`/`TOD_VISUAL`/`TOD_AUDIO` are `init()`-local consts (`:327-329`), same
closure-capture pattern LUL-17 already established for `player`/`baby` -- this hook is
exposed per-init, same lifetime as every other entry in the block.

### 3. `engine/forest-engine.d.ts` declaration

```ts
qaProbeTimeOfDay?: () => {
  state: 'night' | 'early-morning' | 'morning' | 'noon' | 'afternoon' | 'evening';
  visual: import('../lib/game/timeOfDay').TimeOfDaySkyConfig;
  audio: import('../lib/game/timeOfDay').TimeOfDayAudioConfig;
};
```

Placed next to `qaProbeLandmarkBeacons` (`:76`), same file. Reuses the exported
`TimeOfDaySkyConfig`/`TimeOfDayAudioConfig` interfaces (`lib/game/timeOfDay.ts`) rather than
inlining the field list a second time.

### 4. `e2e/helpers.ts` `boot()` gains `qaHour`

```ts
qaHour = null,
```
added to the destructured options (next to `qaNoRender`, `:84`), typed `qaHour?: number |
null` in the options type (`:90`), and:
```ts
if (qaHour !== null) params.set('qaHour', String(qaHour));
```
added next to the `qaNoRender` line (`:100`).

## Verification

- `npx tsc --noEmit` -- clean, including the new `.d.ts` types resolve.
- `npx playwright test e2e/time-of-day.spec.ts` -- all new specs pass.
- `npx eslint engine/forest-engine.js e2e/helpers.ts e2e/time-of-day.spec.ts` -- clean.

## e2e

**Specs.** `e2e/time-of-day.spec.ts` (new):
- `'?qaHour=2 resolves night'` -- boots with `qaHour: 2`, asserts
  `qaProbeTimeOfDay().state === 'night'` and `visual.starOpacity === 0.85` (night's
  documented value, `lib/game/timeOfDay.ts`'s `TIME_OF_DAY_VISUALS.night`).
- `'?qaHour=6 crosses the early-morning/morning boundary'` -- `timeOfDayFromHour`'s
  boundary table (`lib/game/timeOfDay.ts:25-32`) puts hour 6 at `startHour: 6` for
  `'morning'` (`:28`, the last boundary with `startHour <= hour` wins) -- assert `state ===
  'morning'`, then re-boot at `qaHour: 5` and assert `state === 'early-morning'`, proving
  the boundary is exact, not off-by-one.
- `'?qaHour=11 crosses the morning/noon boundary'` -- same pattern at the `startHour: 11`
  boundary (`:29`) (`qaHour: 10` -> `'morning'`, `qaHour: 11` -> `'noon'`).
- `'?qaHour=20 re-enters night for the second disjoint range'` -- boundary table's
  documented double-entry for `'night'` (`startHour: 0` `:26` and `startHour: 20` `:32`,
  comment at `timeOfDay.ts:21-24`) -- assert `qaHour: 19` -> `'evening'`, `qaHour: 20` ->
  `'night'`.
- `'fog/light color values differ across states'` -- boots four times (`qaHour: 2, 8, 12,
  22`), collects `visual.fogColor` and `visual.hemisphereSky` each time, asserts all four
  values are pairwise distinct (`new Set([...]).size === 4`) -- proves the applied values
  actually vary, not just the state label.
- `'absent ?qaHour falls back to the real clock'` -- boots with no `qaHour` param, asserts
  `qaProbeTimeOfDay().state` is one of the six valid `TimeOfDayState` values (can't assert
  a specific one -- the real hour at CI run time is exactly the non-reproducible case this
  spec exists to route around for every other test).

**World.** micro (default, no `qaWorld` override needed -- this system reads `CONFIG`
nowhere, so map size is irrelevant to it; `qaBuildScene` is not needed, no props/predators
are staged).
**Hooks.** `window.ForestEngine.qaProbeTimeOfDay(): { state, visual, audio }` -- new,
declared in `engine/forest-engine.d.ts`, installed inside the `?qaHooks=1` block in
`init()` per `## The change` #2 above.
**Tester scenario.** None: not a scenario a nightly Playwright-adjacent vision check adds
value to -- the assertions above are exact value diffs, strictly stronger than what a
vision model could confirm from a screenshot. No `shared/local-qa/requests/` file.
**Not covered.** Audio (`TOD_AUDIO.birdsGain`/`windGainMul`/etc. reaching the actual
`AudioContext` gain nodes) -- `startAudio()` requires a live `AudioContext`, which
Playwright's headless Chromium does not reliably produce sound output for; the probe
returns the `TOD_AUDIO` config object so the *values* are covered, but not that
`startAudio()` (`:3358-3410`) correctly threads them into gain nodes. That thread is
already implicitly exercised by every existing e2e spec that calls `enter()` (audio starts
on gate-click) without asserting on it -- flagging as a real, pre-existing gap, not
introduced by this spec, and out of scope to close here. Real-hour production behavior
(what a player actually sees at 3pm) stays manual/observational, same as before.

## Cues

**Visual / Audio / Explanation / Reduced motion.** None -- time-of-day is passive/ambient
world texture (fog, sky, ambient light, ambient audio bed), not an interactive map element
or player-triggered verb, and is explicitly out of scope for `decisions/0015-cue-triple`
per that decision's Scope note (`docs/CUES.md:5-6`: "Passive/ambient world texture (fog,
general ambience, decorative-only props) is out of scope"). No caption, prompt, or sound
cue is being added or is missing here.

## Constraints

- Zero behavior change for real players: `?qaHour=` absent (the only state any real
  session is ever in) must produce byte-identical `timeOfDayFromHour(new
  Date().getHours())` output to today -- the override is purely additive at the one call
  site, never changes the fallback path.
- `timeOfDay`/`TOD_VISUAL`/`TOD_AUDIO` remain `init()`-scoped snapshot consts, computed
  once per session as documented in `docs/specs/time-of-day.md`'s "Design decision" section
  -- this spec adds an alternate *input* to that one-time computation, not a live re-read
  mechanism. `qaProbeTimeOfDay()` must not become a vector for mid-session time-of-day
  changes (no setter, read-only probe).
- `lib/game/timeOfDay.ts` is untouched -- the hour->state function is already pure and
  already unit-tested; this spec is integration-only, per the parent ticket's framing.

## Out of scope

- Changing `timeOfDayFromHour()`'s boundary table or any `TIME_OF_DAY_VISUALS`/
  `TIME_OF_DAY_AUDIO` tuning values -- this spec adds test determinism, not new
  visual/audio design.
- A live/mid-session time-of-day transition mechanism -- explicitly rejected by the
  existing LUL-1644 spec's design decision (`docs/specs/time-of-day.md`), not reopened
  here.
- Sibling LUL-2667 slices (5/6 tree-collision/pathing `@fullmap` migration, 6/6 wayfinding
  scope decision) -- separate tickets, separate specs.
