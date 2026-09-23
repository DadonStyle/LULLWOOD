# SPEC: LUL-3253 Dedicated fullscreen button next to the menu button

**Ticket:** LUL-3253 · **Tier:** B — component (`components/GameMenu.tsx`) + docs
(`docs/ELEMENTS.md`, `NOAM_MDS/ARCHITECTURE.md`) + e2e (3 spec files) + a `shared/local-qa`
request file. No `engine/`, no persistence, no secrets, no release-train file — self-selected
review under Development-first, green CI is the floor. Per CTO's PLAN comment on this ticket
(2026-09-23).

**Written against:** `release/next` @ `6381e82` (2026-09-23). Re-derive every `file:line`
below if it has moved.

## What already exists (do not re-derive, do not re-decide)

Fullscreen infra shipped under LUL-124/LUL-2310 and is not touched by this SPEC:
- `lib/game/fullscreen.ts` — `fullscreenSupported()`, `isFullscreenActive()`,
  `toggleFullscreen()`, `FULLSCREEN_CHANGE_EVENTS`.
- `components/GameMenu.tsx:16-28` — `useFullscreen()` hook, already wired to
  `FULLSCREEN_CHANGE_EVENTS`, already returns `{ supported, isFullscreen, toggle }`. This is
  what satisfies requirement 2 (reflects Esc/F11 exits) — no new listener needed.
- `engine/forest-engine.js`'s F11/Alt+Enter keydown handler — untouched, stays the second
  entry point.

Today toggling fullscreen with a mouse is 2 clicks: open `.menuPanel` (click `#gameMenu`'s
hamburger), then click the `menuFullscreen` row inside it (`GameMenu.tsx:95-106`). This SPEC
adds a dedicated one-click button and removes that row (duplicate, see "Constraints").

## Files

- `components/GameMenu.tsx` — edited: new `fullscreenToggle` button, `.menuButtons` flex
  wrapper, remove the `menuFullscreen` row and its CSS is inherited (no dedicated CSS existed
  for it — it used the shared `.menuRow` class, untouched).
- `docs/ELEMENTS.md` — edited: fix two now-stale references to `menuFullscreen` in the
  LUL-2310 paragraph, add a new paragraph for LUL-3253.
- `NOAM_MDS/ARCHITECTURE.md` — edited: one-line testid table update.
- `e2e/fullscreen-key.spec.ts` — edited: rename/rewrite the one test that used
  `menuFullscreen`, add one new test.
- `e2e/mobile/fullscreen-key.spec.ts` — edited: rename the "stays absent" test's testid.
- `e2e/mobile/menu-hides-controls.spec.ts` — edited: one comment reference, no test-code
  change.
- `e2e/mobile/ui-hygiene.spec.ts` — edited: one selector string in the two-tap-budget test.
- `shared/local-qa/requests/lul-3253-fullscreen-button.md` — created (outside the repo, see
  "e2e" section).

## The change

### 1. `components/GameMenu.tsx`

Replace the standalone hamburger button (current lines 82-91, the `<button data-testid=
"menuToggle" ...>` that is `#gameMenu`'s only direct child before `.menuPanel`) with a
`.menuButtons` flex row containing it plus the new button:

```tsx
    <div id="gameMenu" ref={menuRef}>
      <div className="menuButtons">
        <button
          data-testid="menuToggle"
          className="menuToggle"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          ☰
        </button>

        {fullscreenSupported && (
          <button
            data-testid="fullscreenToggle"
            className={`fullscreenToggle${isFullscreen ? ' active' : ''}`}
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            <span className={`fsIcon${isFullscreen ? ' fsIconActive' : ''}`}>⛶</span>
          </button>
        )}
      </div>

      {open && (
        <div className="menuPanel">
```

(`fullscreenSupported`/`isFullscreen`/`toggleFullscreen` are the existing destructured names
from `useFullscreen()` at `GameMenu.tsx:43` — reuse them, do not re-derive.)

`#gameMenu` has no explicit `width` (`GameMenu.tsx:203-209`, `position: fixed` only), so it
shrink-wraps to its content — it becomes ~104px wide (48+8+48) instead of 48px, and
`.menuPanel`'s `position: absolute; top: 56px; left: 0;` (`:238-240`) stays anchored to
`#gameMenu`'s own left edge, i.e. still directly under the hamburger specifically, since it's
first in the row. No change needed to `.menuPanel`'s CSS.

Remove the `menuFullscreen` row entirely (current lines 95-106, the
`{fullscreenSupported && (<button data-testid="menuFullscreen" ...>Fullscreen: {isFullscreen
? 'on' : 'off'} (F11)</button>)}` block) from inside `.menuPanel`. Nothing else in that panel
shifts — `menuPause` becomes the panel's first row.

CSS: add after the existing `.menuToggle:active { transform: scale(0.95); }` block
(`GameMenu.tsx:233-235`):

```css
.menuButtons {
  display: flex;
  gap: 8px;
}

.fullscreenToggle {
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  border: 1px solid #cdd9ea;
  background: rgba(6, 9, 15, 0.8);
  color: #cdd9ea;
  font-size: 20px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background-color 0.2s;
}

.fullscreenToggle:hover {
  background: rgba(6, 9, 15, 0.95);
}

.fullscreenToggle:active {
  transform: scale(0.95);
}

.fullscreenToggle.active {
  background: rgba(205, 217, 234, 0.3);
  border-color: #fff;
}

.fsIcon {
  display: inline-block;
  transition: transform 0.2s;
}

.fsIconActive {
  transform: rotate(45deg);
}
```

Same box model, border, background, hover and active-scale treatment as `.menuToggle`
(requirement 3 — same visual language). State (requirement 2) is carried two ways at once so
it reads at a glance: the `.active` class swaps the button to the same highlighted treatment
`.segment.active` already uses elsewhere in this file (`:319-322`), and the `⛶` glyph rotates
45° via `.fsIconActive` — one Unicode character in both states (no second glyph to source or
risk a font-support gap on), a real visual state change per requirement 2's "update the icon,"
and `aria-label` flips text for screen readers. No mobile media-query override needed —
`.menuToggle` itself has none either (`:324-340` only resizes `.menuPanel`/`.menuRow`/
`.segment`).

No change to the `if (state.winVisible || state.deathVisible) return null;` line
(`GameMenu.tsx:79`) — the new button is nested inside the same `#gameMenu` div that guard
already unmounts (requirement 6, LUL-2131 pattern preserved, nothing to reintroduce).

No change to the `fullscreenSupported` gate itself (requirement 5) — reusing the exact
boolean `menuFullscreen` used means iOS/iPadOS Safari (`lib/game/fullscreen.ts:22-26` returns
false when neither the unprefixed nor `webkit`-prefixed API exists) gets no button, same
precedent as today, documented at `docs/ELEMENTS.md:1277-1278`. Decision restated from the
PLAN: hidden, not degraded/disabled.

### 2. `docs/ELEMENTS.md`

The LUL-2310 paragraph (`:1260-1283`) names `menuFullscreen` twice; both go stale the moment
the row is removed. Edit in place:
- `:1260-1261` — `"fullscreen has a second entry point besides `GameMenu.tsx`'s
  `menuFullscreen` button"` → `"fullscreen has a second entry point besides `GameMenu.tsx`'s
  dedicated `fullscreenToggle` button (LUL-3253)"`.
- `:1270` — `"so `menuFullscreen` now renders there too"` → `"so `fullscreenToggle` now
  renders there too"`.

Add a new paragraph immediately after that edited LUL-2310 paragraph (before the LUL-2131
paragraph at `:1284`):

```
  LUL-3253: fullscreen moved from a row inside `.menuPanel` (2 clicks: open the menu, then
  the row) to a dedicated `fullscreenToggle` button rendered as a sibling of `.menuToggle`
  inside a `.menuButtons` flex row, both still inside `#gameMenu` (`GameMenu.tsx`) — 1 click,
  and the whole cluster stays one `#gameMenu` id/z-index-20 box so nothing that already treats
  `#gameMenu` as one region needed a change. `.menuPanel`'s `top: 56px; left: 0` stays anchored
  to `#gameMenu` itself, not to either button, so it's unmoved. The old `menuFullscreen` row is
  gone — a dedicated one-click button and a still-present 2-click menu row would have been the
  exact same action and readout (`toggleFullscreen`/`isFullscreen`) a few pixels apart, so the
  row was removed rather than kept as a second path to the same state. Gated on the same
  `fullscreenSupported` boolean and the same `winVisible`/`deathVisible` unmount as
  `menuToggle` — no new logic for requirements 5/6, see above.
```

### 3. `NOAM_MDS/ARCHITECTURE.md`

`:915`, the `GameMenu` testid row: replace `menuFullscreen` with `fullscreenToggle` in the
list (`` `menuToggle`, `menuFullscreen`, `menuPause`, ... `` → `` `menuToggle`,
`fullscreenToggle`, `menuPause`, ... ``).

## Verification

- `npx tsc --noEmit` — clean (baseline `layout.tsx` error only, per every recent PR in this
  repo; do not treat it as caused by this change).
- `npm run lint` — clean.
- `node scripts/check-elements-citations.mjs` — clean (this diff edits citations at
  `docs/ELEMENTS.md:1260-1261,1270` in place and adds one new paragraph with no citation drift
  to the surrounding lines' claims).
- `npx playwright test e2e/fullscreen-key.spec.ts e2e/mobile/fullscreen-key.spec.ts e2e/mobile/menu-hides-controls.spec.ts e2e/mobile/ui-hygiene.spec.ts e2e/mission-deepwater.spec.ts e2e/mobile/win-persist.spec.ts` — all green.

## e2e

**Specs.**
- `e2e/fullscreen-key.spec.ts` — rewrite the last test (currently `'menuFullscreen label
  flips on a synthetic fullscreenchange event from the key path'`, `:133-142`) to: boot,
  enter, read `page.getByTestId('fullscreenToggle')` directly (no `menuToggle` click — it's
  no longer inside the panel), assert `aria-label="Enter fullscreen"` and no `active` class,
  press F11 via the existing `pressFullscreenKey` helper, assert `aria-label="Exit
  fullscreen"` and the `active` class present. Extended.
- `e2e/fullscreen-key.spec.ts` — new test `'fullscreenToggle click enters and exits
  fullscreen with one click, no menu involved'`: boot, enter, assert `.menuPanel` has count 0
  (menu never opened), click `fullscreenToggle`, assert `fsCalls()` shows one `request` and
  the `aria-label` flipped, click again, assert one `exit` and the label flipped back. New.
- `e2e/mobile/fullscreen-key.spec.ts` — rename `'menuFullscreen stays absent on mobile when
  the Fullscreen API is unsupported'` (`:15-36`) to `fullscreenToggle`, same assertion shape
  (`toHaveCount(0)`). Extended.
- `e2e/mobile/ui-hygiene.spec.ts` — `'everything important is at most two taps away'`
  (`:59-70`): change the `Fullscreen` entry's selector to `'[data-testid="fullscreenToggle"]'`.
  `tapDepth` (`e2e/ui-hygiene-collect.ts:83-96`) checks visibility before walking the `path`
  array, so this now resolves to depth 0 (visible without opening the menu) instead of 1 —
  strictly inside the 2-tap budget either way. Extended, must still pass.
- `e2e/mobile/menu-hides-controls.spec.ts` — no test-code change; only the LUL-2442 comment
  above `'#missionPanel is absent while the game menu is open, on mobile'` (`:54-56`)
  referenced `[data-testid=menuFullscreen]` as the historical overlap culprit — append
  `"(that row was removed in LUL-3253; the open .menuPanel itself still overlaps
  #missionPanel the same way, which is what this test still covers)"`. Must pass unchanged.
- `e2e/mission-deepwater.spec.ts` and `e2e/mobile/win-persist.spec.ts` — no change. Both
  already assert facts that cover `fullscreenToggle` for free because it's nested inside
  elements they already check: `win-persist.spec.ts:66` asserts `#gameMenu` has count 0 on
  win (covers requirement 6's win-screen half), `mission-deepwater.spec.ts` exercises the
  `.menuPanel`-vs-`#missionPanel` corner this button's wider `#gameMenu` box does not change
  (button is inside `#gameMenu`, `.menuPanel` position is unchanged, see "The change" §1).
  Must pass unchanged.

**World.** micro (default `qaWorld=micro` via `boot()`/`e2e/helpers.ts` — none of these specs
stage predators, props, or map state; they only need `#gameMenu` mounted).

**Hooks.** None new. `stubFullscreenAPI`/`pressFullscreenKey`/`fsCalls` (test-file-local
helpers in `e2e/fullscreen-key.spec.ts`, not `window.ForestEngine` hooks) are existing and
unchanged.

**Tester scenario.** `shared/local-qa/requests/lul-3253-fullscreen-button.md` (written with
this spec, see below) — the repo's layout/overlap audit this ticket's requirement 4 asks for
is a `no-overlap` assertion in the nightly local-qa run, not a repo e2e test (per
`REQUESTING-A-TEST.md`'s own "Mechanism 1 vs 2" split: cross-viewport pixel overlap is the
nightly audit's job).

**Not covered.** Feel/spacing judgment ("looks like it belongs, not bolted on" — requirement
3's aesthetic half) stays a founder/QA call, not a repo assertion. Real iOS Safari (no
Fullscreen API at all) is not exercised anywhere in this repo — `playwright.config.ts` is
Chromium-only (`e2e/fullscreen-key.spec.ts:12`) — so requirement 5's "hidden on iOS" is
verified indirectly (the `fullscreenSupported` gate, unit-testable in principle but not unit
tested today for `menuFullscreen` either — no new gap introduced) rather than on a real
device.

## Cues

No new cue triple — this is a silent icon-state toggle on an existing persistent HUD control,
same category as `menuToggle` itself (no audio, no caption, no fade). `decisions/0015-cue-
triple` doesn't apply: the cue triple is for feedback on a *player action changing something
in the world*; fullscreen is a browser chrome toggle with its own OS-level visual feedback
(the whole viewport changes), not a mechanic that needs Lullwood's own audio/caption layer.

**Visual.** `⛶` icon rotates 45° and the button gets the `.segment.active`-style highlight
when fullscreen is active (`GameMenu.tsx`, "The change" §1 above).
**Audio.** None — matches `menuToggle`'s own open/close, which has none either.
**Explanation.** None — `aria-label` covers the accessibility case; no on-screen caption
precedent exists for HUD chrome controls (`menuToggle`, `menuSound` etc. have none).
**Reduced motion.** The only animation is the 45° icon rotation and the `:active` click-scale,
both `transition` (not `@keyframes`) and both under 250ms — same treatment as `.menuToggle:
active`'s existing `transform: scale(0.95)`, which is not gated on `reducedMotion` either. No
new gap introduced.

## Constraints

- Do not touch `lib/game/fullscreen.ts` or the F11/Alt+Enter keydown handler in
  `engine/forest-engine.js` — this is a HUD-only change, zero engine diff, that's what keeps
  it Tier B.
- Do not add a second `position: fixed` element — the button must live inside the existing
  `#gameMenu` box (see "What already exists" and "The change" §1) so every place that already
  treats `#gameMenu` as one region (the two e2e specs cited above) needs no change.
- `menuFullscreen` is a removed testid, not a renamed one that should still exist somewhere —
  once this lands, `grep -rn "menuFullscreen" --include="*.ts" --include="*.tsx"` outside
  `docs/` and comments must return nothing.

## Out of scope

- **`pixel5-portrait` as a fourth no-overlap viewport** (named in the ticket's Acceptance
  section) — deliberately not requested. Two independent reasons: (1)
  `shared/local-qa/bin/request-runner.mjs:17-21`'s `VIEWPORTS` map (the mechanism that runs
  `requests/*.md` files) has exactly four entries — `desktop-1280x720`, `desktop-1920x1080`,
  `pixel5-landscape-727x393`, `iphone-se-landscape-667x375` — no portrait entry exists;
  requesting one reports `NEEDS-GRAMMAR unknown viewport` (`:208`), not a real audit. (2) Even
  if it did: `components/OrientationGate.tsx` + `components/GameCanvas.tsx:214-226` cover the
  entire viewport (`#orientationGate`, `position: fixed; inset: 0; z-index: 50`) whenever
  `matchMedia('(orientation: portrait)').matches` on mobile, sitting above `#gameMenu`
  (z-index 20) — `fullscreenToggle` is present in the DOM but fully covered and untappable in
  portrait, same as every other HUD element, so there is nothing new to find there. The
  request file below uses the three viewports that actually exercise the HUD.
- Removing the `Fullscreen: on/off (F11)` wording from anywhere other than `GameMenu.tsx`
  itself — `engine/forest-engine.js`'s F11/Alt+Enter handler has no visible label to update.
- Any change to how `.menuPanel`'s other rows (`menuPause`, `menuSound`, difficulty/secondary
  segments, `menuRestart`) look or behave — only their position shifts up by one row's height
  now that `menuFullscreen` is gone, which is layout reflow, not a code change.
