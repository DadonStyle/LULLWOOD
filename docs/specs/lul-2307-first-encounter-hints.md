# SPEC: LUL-2307 First-encounter explanations for interactive world elements (hint registry)

**Ticket:** LUL-2307 · **Tier:** C — the per-frame trigger/anchor evaluation grows inside
`engine/forest-engine.js`'s `stepFrame()` simulation loop (new module-scope registry, new
world-projection helper reused across predators/cover/throwables, two new engine
counters bumped from `enterHide()`/`grabThrowable()`). This is bigger than "HUD/caption
plumbing" — LUL-2230's bespoke scent-only variables are replaced outright, not just read
from. Needs `REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `c352ab9` (2026-09-11). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

## Files

- `engine/forest-engine.js` — edited: generic hint registry (state, seen/localStorage,
  settings toggle, priority list, copy table) replacing LUL-2230's `scentCaptionSeen`/
  `scentCaptionActive`/`scentCaptionStartT`/`scentLockCountAtCaptionStart`; per-frame
  candidate evaluation + activate/tick/dismiss state machine in `stepFrame()`; two new
  edge counters (`hideEventCount` in `enterHide()`, `throwableGrabCount` in
  `grabThrowable()`); `setHintsEnabled()`/`resetHints()`; `qaProbeHints`/`qaResetHints` QA
  hooks; `qaResetScentCaption` kept as a thin compat alias.
- `engine/forest-engine.d.ts` — edited: `qaProbeHints`/`qaResetHints` declarations.
- `lib/engine-contract.ts` — edited: `setHintsEnabled`, `resetHints` added to
  `ENGINE_ACTION_KEYS`.
- `components/Hud.tsx` — edited: `EngineHudState`/`EngineActions`/`INITIAL_HUD_STATE` gain
  `hintsEnabled`, `hintVisible`, `hintKey`, `hintText`, `hintX`, `hintY`,
  `setHintsEnabled`, `resetHints`; `#scentTrailCaption` JSX block replaced by a generic
  `#hintCaption` block keyed on `hintKey`.
- `components/GameCanvas.tsx` — edited: `#scentTrailCaption` CSS renamed/generalized to
  `#hintCaption` plus per-key position overrides for the seven non-world-anchored keys.
- `components/SettingsPanel.tsx` — edited: `Show hints` checkbox (default on, next to `Show
  my scent trail`) + `Reset hints` button; `PersistedSettings` gains `hintsEnabled`.
- `docs/ELEMENTS.md` — edited: new "Hints" element card; lake (`:713`) and bog (`:1755`)
  cards updated to cite their caption.
- `e2e/hints.spec.ts`, `e2e/mobile/hints.spec.ts` — created.

## The change

### Registry shape (`engine/forest-engine.js`, replaces `:1809-1819`)

One priority-ordered list of keys, one copy table, one seen-map persisted per key under
`lullwood:hints:<key>` (mirrors `lullwood:scentTrailCaptionSeen`'s existing convention, one
key per hint instead of one flag total):

```js
const HINT_PRIORITY = ['scent','landmark','lake','bog','deepwater',
                        'wolf','bear','lion','stamina','cover','caveImmune','throwable','veil'];
const HINT_TEXT = {
  scent:      'this is your scent trail — predators follow it',           // unchanged copy
  landmark:   'landmarks in the fog are safe to navigate by',              // unchanged copy
  lake:       'chest-deep water — half pace. predators wade too',
  bog:        'bog — half pace, but it masks your scent from wolves',
  deepwater:  'deepwater — reach the drowned car for a bonus payout on a run you survive',
  wolf:       "a wolf — faster than you. hide (H) or veil (F), don't outrun",
  bear:       "a bear — not fast, but it tracks your scent better than the others. hide (H) or veil (F)",
  lion:       "a lion — the fastest hunter here. hide (H) or veil (F), don't outrun",
  stamina:    'out of breath — walk to recover, running lays a wider scent trail',
  cover:      'hollow log — H to hide inside. predators lose sight of you',
  caveImmune: <reuse #caveImmunePanel's own text, Hud.tsx :781-783>,
  throwable:  'a stone — E to pick up, throw to break a chase',
  veil:       "veil — F holds off what hunts you. limited; it refills when you don't use it",
};
const HINT_KEY_PREFIX = 'lullwood:hints:';
const LEGACY_SCENT_HINT_KEY = 'lullwood:scentTrailCaptionSeen';   // migration read only, never written again
```

`bear`/`lion` copy is not in the ticket body (only wolf's exact line is given) — written here
in the same voice, grounded in `engine/tuning.js:241-242` (bear `speed:6.8` is the slowest of
the three but `nose:1.4` is the highest; lion `speed:9.2` is the fastest). Final wording is
this spec's call per the ticket's own "final wording in the spec" instruction; a tester/human
can bikeshed the exact phrasing post-merge without touching the mechanism.

`cover`'s copy always says "hollow log" even when the first cover the player meets is a
bramble/bush (`coverPromptKind === 'bramble'`, see `Hud.tsx:284` `hideVeilPromptContent`'s own
`noun` logic) — the ticket gives one literal line, not a per-kind pair. Declared
simplification, not a bug; a follow-up ticket can branch the noun the same way
`hideVeilPromptContent` already does if that reads wrong in testing.

### Seen/settings plumbing

```js
const hintSeenCache = {};   // key -> true, lazily filled from localStorage
function hintSeen(key){
  if(hintSeenCache[key]) return true;
  try {
    if(localStorage.getItem(HINT_KEY_PREFIX + key) === '1'
      || (key === 'scent' && localStorage.getItem(LEGACY_SCENT_HINT_KEY) === '1')){
      hintSeenCache[key] = true; return true;
    }
  } catch(e){}
  return false;
}
function markHintSeen(key){
  hintSeenCache[key] = true;
  try { localStorage.setItem(HINT_KEY_PREFIX + key, '1'); } catch(e){}
}
let hintsEnabled = true;
try { const v = localStorage.getItem('lullwood:hintsEnabled'); if(v !== null) hintsEnabled = v === '1'; } catch(e){}
function setHintsEnabled(v){ hintsEnabled = !!v; pushState({ hintsEnabled }); }
function resetHints(){
  for(const k in hintSeenCache) delete hintSeenCache[k];
  hintActiveKey = null; hintActiveStartT = 0;
  try {
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(k && k.indexOf(HINT_KEY_PREFIX) === 0) localStorage.removeItem(k);
    }
    localStorage.removeItem(LEGACY_SCENT_HINT_KEY);
  } catch(e){}
  pushState({ hintVisible: false });
}
```

### Two new edge counters

`hideEventCount` (bumped inside `enterHide()`, `:2934`) is the dismiss-on-interaction signal
for `wolf`/`bear`/`lion`/`cover` (the ticket's "hide (H)... don't outrun" / "H to hide inside"
copy names the exact action that should end the hint). `throwableGrabCount` (bumped inside
`grabThrowable()`, `:4519-4532`, right after `heldThrowable = true`) is `throwable`'s dismiss
event. Both declared next to `hidden`/`heldThrowable` (`:2576`, `:2583`), same pattern
`scentLockEventCount` (`:1816`) already established for `scent`.

### Per-frame evaluation (`stepFrame()`, replaces the scent-only block at `:5574-5605`)

Anchor kind is implicit in the key, not a stored field: `scent`, `wolf`/`bear`/`lion`,
`cover`, `throwable` are **world-anchored** (a real 3D point, projected to a viewport
fraction via `camera.project()` — the exact `_scentProjVec` math the scent-mote loop already
runs at `:5559-5561`, pulled into a shared `projectToScreen(x,y,z)` helper so it isn't
duplicated five times). `lake`, `bog`, `deepwater`, `stamina`, `caveImmune`, `veil`, and
`landmark` are **self/panel-anchored** — no world point, no frustum requirement; positioned
by a fixed CSS rule per key in `components/GameCanvas.tsx` (see below) instead of a per-frame
`x`/`y`. `landmark` belongs here, not with the world-anchored group, precisely because its
trigger fires unconditionally with no single object to point at (same as the old toast it
replaces) — an earlier draft of this registry put it in `WORLD_HINT_KEYS` by mistake, which
made it permanently unstartable (`hintWorldAnchor()` always returned `null` for a key whose
candidate anchor is always `null`); caught by `e2e/hints.spec.ts` before merge, not left as a
silent bug. The engine still pushes `hintX`/`hintY` every frame for API uniformity; Hud.tsx
ignores them for the seven fixed keys.

Trigger conditions, reusing locals `stepFrame()` already computes this frame (no new per-frame
scans besides the predator/throwable/cover lookups the existing HUD `pushState` block already
does at `:5338-5363`):

| key | eligible while | dismiss-on-interaction (else 8s) |
|---|---|---|
| `scent` | `scentTrailVisible && firstFrustum` (unchanged, `:5580`) | `scentLockEventCount` advances |
| `landmark` | `entered` (fires same frame as the old unconditional `enter()` toast, `:3285`) | none (8s only) |
| `lake` | `playerInLake` (`:5124`) | none (8s only) |
| `bog` | `playerBogginess > 0.05` (`:5114`) | none (8s only) |
| `deepwater` | `mission?.target.kind === 'deepwater' && mission.status === 'active' && !carrying` | `missionCanComplete` (`:5359`) goes true |
| `wolf`/`bear`/`lion` | first `predators` entry of that `kind`, not `inert`, `dist < effectiveDetect(p)`, in camera frustum | `hideEventCount` advances |
| `stamina` | `staminaCharge <= 0` | `staminaCharge > 0.6` |
| `cover` | `coverPromptVisible` (`:5379`), anchor `lastHideSpot.x/z` | `hideEventCount` advances |
| `caveImmune` | `caveImmuneT > 0` (freshly activated) | `caveImmuneT` reaches 0 |
| `throwable` | nearest untaken `throwableData` entry has `canGrabThrowable(heldThrowable, d, THROWABLE_PICKUP_RADIUS)` true, anchor that stone's `x/z` | `throwableGrabCount` advances |
| `veil` | `veilCharge < 0.3 && !veilLocked` | `veilCharge > 0.3` |

Same activate/tick/dismiss shape LUL-2230 used (`scentCaptionActive`/`scentCaptionStartT`
become `hintActiveKey`/`hintActiveStartT`, generalized to loop `HINT_PRIORITY` for the
"become active" edge instead of a single `if`):

```js
if(!hintActiveKey){
  for(const key of HINT_PRIORITY){
    if(hintSeen(key) || !hintsEnabled) continue;
    const cand = evaluateHintCandidate(key);   // returns {text, x, y} or null; null if a
                                                // world-anchored key's object isn't in frustum yet
    if(cand){ hintActiveKey = key; hintActiveStartT = t; hintDismissBaseline = dismissCounter(key); break; }
  }
}
if(hintActiveKey && (!hintsEnabled || !hintEligible(hintActiveKey))){
  hintActiveKey = null;                          // lost eligibility mid-caption -- NOT marked seen, can retrigger later
  pushState({ hintVisible: false });
} else if(hintActiveKey){
  const elapsed = t - hintActiveStartT;
  if(elapsed >= 8 || hintDismissedByEvent(hintActiveKey, hintDismissBaseline)){
    markHintSeen(hintActiveKey); const doneKey = hintActiveKey; hintActiveKey = null;
    pushState({ hintVisible: false });
  } else {
    const cand = evaluateHintCandidate(hintActiveKey);   // re-anchor world keys; fixed keys always return non-null
    pushState(cand ? { hintVisible: true, hintKey: hintActiveKey, hintText: HINT_TEXT[hintActiveKey], hintX: cand.x, hintY: cand.y }
                   : { hintVisible: true });             // world anchor briefly out of frustum -- keep last position, LUL-2230 precedent
  }
}
```

Same rules as LUL-2230's original comment (`:5574-5579`): eligible only while `entered &&
!hidden && !hudState.winVisible && !hudState.deathVisible` — folded into each key's
`hintEligible()`/trigger check, not repeated per-row above. Toggling `hintsEnabled` off,
losing eligibility, hiding, or a win/death mid-caption stops it without marking seen.

`qaProbeScentTrail()`'s existing `captionVisible`/`captionSeen` fields (read by
`e2e/mobile/scent-trail.spec.ts:92,104`) are derived, not stored: `captionVisible:
hintActiveKey === 'scent' && hudState.hintVisible`, `captionSeen: hintSeen('scent')`.

### QA hooks

- `qaProbeHints(): { activeKey: string | null; seen: Record<string, boolean> }` — new,
  installed in the `?qaHooks` block, declared in `engine/forest-engine.d.ts`.
- `qaResetHints(): void` — new, calls `resetHints()`.
- `qaResetScentCaption()` (`:4351`, existing) — kept, now `hintSeenCache.scent = false;
  hintActiveKey = hintActiveKey === 'scent' ? null : hintActiveKey; try {
  localStorage.removeItem(HINT_KEY_PREFIX+'scent'); localStorage.removeItem(LEGACY_SCENT_HINT_KEY);
  } catch(e){}; pushState({ hintVisible: false });` — no spec currently calls it, kept for any
  external caller and because removing a QA hook silently is worse than an unused one.

### Settings (`components/SettingsPanel.tsx`)

`Show hints` checkbox directly under `Show my scent trail` (`:203-210`), same `radioRow`
markup, wired to `actions?.setHintsEnabled`. `PersistedSettings.hintsEnabled: boolean`, applied
via `actions.setHintsEnabled(s.hintsEnabled !== false)` (the `scentTrailVisible` `!== false`
idiom, `:94`) so a never-persisted key defaults on. `Reset hints` button (own `radioRow`-styled
row, not a checkbox) calls `actions?.resetHints()` directly — no local state, the engine is
the only owner of the seen-map.

### `components/Hud.tsx` render (replaces `:805-817`)

```tsx
{state.hintVisible && !state.winVisible && !state.deathVisible && (
  <div id={state.hintKey === 'scent' ? 'scentTrailCaption' : 'hintCaption'}
       data-hint-key={state.hintKey ?? undefined}
       style={state.hintKey && WORLD_HINT_KEYS.has(state.hintKey) ? { left: `${state.hintX * 100}%`, top: `${state.hintY * 100}%` } : undefined}>
    {state.hintKey && WORLD_HINT_KEYS.has(state.hintKey) &&
      <span className={state.hintKey === 'scent' ? 'scentTrailCaptionGlyph' : 'hintCaptionGlyph'} aria-hidden="true">↓</span>}
    {state.hintText}
  </div>
)}
```

`WORLD_HINT_KEYS = new Set(['scent','wolf','bear','lion','cover','throwable'])`,
local const in Hud.tsx. Fixed-key rows get no inline `left`/`top` (CSS positions them per
`data-hint-key`) and no down-arrow glyph — there is nothing below them to point at. The
`'scent'` key keeps rendering as `#scentTrailCaption`/`.scentTrailCaptionGlyph` (LUL-2230's
original id/class) instead of the new generic `#hintCaption`/`.hintCaptionGlyph` —
`e2e/scent-trail.spec.ts` and `e2e/mobile/scent-trail.spec.ts` assert on `#scentTrailCaption`
directly and must pass unchanged (see e2e section below for the file-naming correction).

### `components/GameCanvas.tsx` CSS (replaces `:357-367`)

`#scentTrailCaption, #hintCaption { ... }` (one shared rule, two selectors) keeps the exact
old pill chrome for both ids. World-anchored keys keep the `translate(-50%,-120%)` lift
(arrow points down at the anchor, unchanged from LUL-2230). The seven fixed keys get a
`#hintCaption[data-hint-key="..."]` override with `left`/`top`/`transform` set directly in
CSS, no glyph, roughly under their associated panel: `deepwater` below
`#missionPanel` (`top: 76px; left: 16px`, `:320`), `caveImmune` below `#caveImmunePanel`
(`top: 56px; left: 50%`, `:332`); `lake`/`bog`/`stamina`/`veil`/`landmark` (no visible
player-facing panel exists for water/bog/stamina/veil today — `#panel`'s
`#staminaState`/`#veilState` spans are dev-only, `Hud.tsx:640-644`, `SettingsPanel` comment
`:287-295`; `landmark` has no single object to sit under, same as its old toast) share one
bottom-center position, the same `bottom: calc(var(--action-slot-bottom) + var(--action-slot-height) +
10px)` anchor `#captionToast` already uses (`:263-265`), so they read as "about your own
state" the same place predator-call captions already appear. Declared simplification: the
engine has no access to React-rendered DOM positions (Hud.tsx and forest-engine.js are
separate layers by design, LUL-34), so fixed-key placement is a constant CSS rule per key, not
a measured one.

`body:has(#winScreen) #hintCaption, body:has(#deathScreen) #hintCaption { opacity: 0
!important; }` carries over unchanged (LUL-2158 precedent).

## Verification

- `npx tsc --noEmit` — `EngineActions`/`ENGINE_ACTION_KEYS` stay in sync (founder engine/React
  contract rule); no type errors from the new Hud.tsx/SettingsPanel.tsx fields.
- `npx eslint components/Hud.tsx components/SettingsPanel.tsx components/GameCanvas.tsx engine/forest-engine.d.ts lib/engine-contract.ts` — clean.
- `node --test lib/**/*.test.ts` (existing suite) — unaffected, this ticket adds no new `lib/game/*` pure module.
- `npx next build` — production bundle still compiles (`assertEngineContract` has nothing new
  to catch if `ENGINE_ACTION_KEYS`/the `return {}` in `init()` stay in sync).

## e2e

**Specs.**
- `e2e/hints.spec.ts` (new) — 'lake caption appears on first entry, not on a second visit',
  'Deepwater caption appears once the mission is active', 'a first-sighted wolf shows its
  caption', 'Show hints off suppresses every hint', 'Reset hints re-arms a seen key'. Staged
  via `qaTeleportTo`/`qaBuildScene`/`qaSetFixedStep`+`qaAdvance` (existing hooks) — no real-time
  waits.
- `e2e/mobile/hints.spec.ts` (new) — same coverage, mobile viewport/input mode, plus "no
  overlap with the mobile sticks or safe-area" per the out-of-scope note below.
- `e2e/scent.spec.ts` (chase mechanics, doesn't touch the caption), `e2e/scent-trail.spec.ts`
  and `e2e/mobile/scent-trail.spec.ts` (the actual caption coverage — the ticket named
  `e2e/scent.spec.ts` for these two, but the caption assertions on `#scentTrailCaption`/
  `qaResetScentCaption`/`qaProbeScentTrail().captionVisible/captionSeen` actually live in
  `e2e/scent-trail.spec.ts`, a separate file; re-derived per the ticket's own "re-derive
  every file:line" instruction) — must pass unchanged. None of the three is edited;
  `#scentTrailCaption`'s id/glyph class and `qaProbeScentTrail()`'s shape are preserved
  (see `components/Hud.tsx`/`GameCanvas.tsx` above).

**Hooks.**
- `window.ForestEngine.qaProbeHints(): { activeKey: string | null; seen: Record<string, boolean> }` — new.
- `window.ForestEngine.qaResetHints(): void` — new.
- `window.ForestEngine.qaProbeScentTrail()` (`engine/forest-engine.js:364`, existing) —
  `captionVisible`/`captionSeen` now derived from the generic registry, shape unchanged.
- `window.ForestEngine.qaTeleportTo(x,z)` (`:443`, existing) — stages the lake/bog entry specs.
- `window.ForestEngine.qaBuildScene(...)` (`:401`, existing) — stages a deterministic predator
  for the wolf-sighting spec.

**Tester scenario.** Request file `shared/local-qa/requests/lul-2307-first-encounter-hints.md`
written alongside this spec — nightly desktop + landscape-phone pass covering the lake/wolf/
Show-hints-off/Reset scenarios above.

**Not covered.** Exact pixel placement of the seven fixed-anchor captions relative to their
panel (declared simplification above — a human/tester call, not code-correctness); audio has
no role here (hints are visual-only, same as LUL-2230).

## Constraints

- Tier C: needs `REVIEW: APPROVED` before merge.
- No new mechanics: the lake stays a 0.5x zone with no drowning (`docs/ELEMENTS.md:742-747`,
  unchanged) — this ticket only adds copy explaining what already exists.
- `HINT_TEXT` strings only — no localisation, matches every other HUD string in this codebase.

## Out of scope

New water mechanics (drowning, blocking) — explicitly out per the ticket. Localisation.
Per-cover-kind ("bramble" vs "hollow log") copy branching — declared simplification above,
follow-up ticket if it reads wrong. Precise DOM-measured placement for the seven fixed-anchor
captions — constant CSS position per key instead, declared above. `#windIndicatorHint`,
`#objective`, `#missionPanel`, mobile sticks, and safe-area insets are unmodified by this
ticket; the new `#hintCaption` positions (world pill top-center-ish via viewport fraction,
clamped `[0.08, 0.92]` same as the old `#scentTrailCaption`; the seven fixed keys pinned to
`#missionPanel`'s corner, `#caveImmunePanel`'s corner, or the shared bottom-center
`#captionToast` position) were chosen specifically to avoid all of those per LUL-2147/LUL-2158
history — final on-device overlap check is the nightly QA tester's job, not this spec's.
