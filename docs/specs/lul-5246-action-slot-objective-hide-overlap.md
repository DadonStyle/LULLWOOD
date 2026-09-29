# SPEC: LUL-5246 Fix `#objective`/`#actionPrompt` (hide-or-veil) overlap at short-landscape mobile

**Ticket:** LUL-5246 · **Tier:** A — CSS-only, additive `:has()` suppression rule inside an
existing media-query block; no custom property, grid track, or `--action-slot-height`
formula changes, so none of LUL-2410/LUL-2414/LUL-2418/LUL-2743's downstream math (which all
key off `--action-slot-height`) is touched. Self-approve + merge on green, no Code Reviewer
gate needed for the tier itself — flagged Tier A per `AGENTS.md`'s CSS-only bar; state this
line in the PR body per house convention.

**Written against:** `release/next` @ `8512701db458b7e1a0577cf84dfc7dfdb63d6901` (2026-09-29).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

**CTO root-cause (LUL-5246 comment, 2026-09-29T12:35:46Z):** `.actionPromptLine`
(`components/GameCanvas.tsx:797`) renders far taller than the short-landscape
`--action-slot-row: 11.91px` track (`GameCanvas.tsx:588`) reserves, so a populated row's
pill overflows upward into the row above it. This SPEC replaces the CTO's estimated numbers
with live-rendered measurements (Chromium 1243 + swiftshader, `LD_LIBRARY_PATH` pointed at
`~/.paperclip/shared/browser-deps/usr/lib/x86_64-linux-gnu` for `libasound.so.2`, same
device descriptors `shared/local-qa/bin/scenario-audit.mjs:54-55` uses:
`mobile-pixel5-landscape` = `devices['Pixel 5']` + `viewport 727x393`,
`mobile-iphone-se-landscape` = `devices['iPhone SE']` + `viewport 667x375`, both `hasTouch`)
and finds the naive "grow the row track to real content height" fix the comment floats is
**not implementable** under the current `--action-slot-bottom` budget — see "Why growing the
row track cannot work" below. The fix here is structural, not a number change.

## Live measurements (both target viewports, identical — row/gap math doesn't depend on
viewport width/height, only on `max-height: 420px` matching)

Staged via `qaHideBehindCoverKind('wolf')` (`engine/forest-engine.js:4717`, real player
teleport next to real cover + a real chasing predator — not a fake DOM patch) so
`coverPromptVisible` is a genuine engine-computed flag, not simulated:

| | value |
|---|---|
| `--action-slot-row` (`GameCanvas.tsx:588`) | `11.91px` |
| `--action-slot-gap` (`:588`) | `3.2px` |
| `--action-slot-bottom` (`:592`) | `190px` |
| `--action-slot-height` (`:69` formula) | `175.84px` (computed) |
| `#objective .actionPromptLine` real height (plain text, no keycap chip) | **31.0px** |
| `#actionPrompt .actionPromptLine` real height (hide/veil row — has a `.actionPromptKey` chip, `ActionPrompt.tsx:95-101`) | **44.0px** |
| Measured overlap between the two when both populated | **28.9px** (both viewports — pixel5-landscape and iphone-se-landscape produce byte-identical row/gap math, only `#actionSlot`'s absolute Y position differs) |

The 44px figure (not the CTO comment's ~32px estimate) is the one that matters here:
**any row that renders a `.actionPromptKey` chip** (`hideVeil`/`actionPrompt`,
`veilOverloadPrompt`, `veilPrompt`, mobile `throwPrompt`, mobile `climbPrompt`) needs ~44px,
not ~31px, because the chip's own `padding: 5px 14px` (`GameCanvas.tsx:811`) plus the
`.actionPromptLine`'s `padding: 7px 16px` (`:798`) both contribute to the line's cross-axis
size under `align-items: center`. Plain-text rows (`objective`, `pickupPrompt`,
`chapelSanctuaryPrompt`, `status`) need ~31px.

## Why growing the row track cannot work (verified, not hand-waved)

`#actionSlot`'s grid always reserves all 9 regular tracks (`grid-template-rows`,
`GameCanvas.tsx:793`) regardless of which currently have content (LUL-2312's explicit
no-layout-shift design, `:792` comment) — so `--action-slot-height` is `rowCharge + 9*row +
9*gap` unconditionally, not "however many rows are populated right now."

To guarantee **no** two adjacent tracks can ever overlap (worst case: a 44px keycap-chip
row), you need `row + gap >= 44` for every one of the 9 tracks, since any of them could be
the taller kind. Minimum total at that floor (gap → 0): `40 + 9*44 = 436px`. Available
budget on the tighter viewport (iPhone SE landscape, `innerHeight - action-slot-bottom` =
`375 - 190 = 185px`) is **185px** — less than half of what uniform growth would need, even
before adding the world-anchored-pill ceiling (`GameCanvas.tsx:643-651`, LUL-2743) needing
its own clearance above that. **Uniform row-height growth is mathematically infeasible on
both target viewports at any legible pill size** — confirmed by the same 12px-font-floor
math (`lib/ui/hygiene.ts`) still landing at ~20-22px/row minimum, `40 + 9*20 = 220px`, still
over budget. Do not attempt the CTO comment's literal suggestion ("size the short-landscape
row to real rendered content height") as a blanket change to `--action-slot-row` — it was a
reasonable first read before live numbers existed, but the arithmetic above rules it out.

## The fix

Suppress `#objective`'s pill specifically when `#actionPrompt` (hide-or-veil) is showing
content, at the same short-landscape breakpoint LUL-2410/LUL-2418 already use for exactly
this class of "nowhere left to reposition to, stop trying" collision
(`GameCanvas.tsx:591-618` comment block) — using the same `:has()` pattern already in this
file (`body:has(#winScreen) #hint`, `GameCanvas.tsx:105-106`). This is the smallest possible
blast radius: it changes zero custom properties, zero grid tracks, zero totals — nothing
downstream of `--action-slot-height` moves.

**Why suppress objective, not hide/veil:** hide-or-veil is the moment-to-moment
survival-critical affordance (it is how the player learns they can press H/F right now);
objective is a slowly-changing distance readout the player can recover a few seconds later
by stepping away from cover. This matches the existing precedent in the same file: LUL-2418
already hides the deepwater hint pill to protect `#actionSlot`'s hide/veil row when the two
collide at this exact breakpoint (`GameCanvas.tsx:611-619` comment) — hide/veil has already
established itself as the row that wins a collision here, objective/hint-family are the ones
that yield.

**`#objective` still occupies its grid track** (empty, `display:none` only on the inner
`.actionPromptLine`, not the row) — so nothing below it in the grid shifts. Same collapse
technique LUL-2410 uses on `#hint` (`:602`, "boxes must never intersect" — `display:none`,
not `opacity:0`, so the deterministic bounding-box audit doesn't keep tripping on an
invisible-but-present box).

## Files

- `components/GameCanvas.tsx` — edited: add one CSS rule inside the existing
  `@media (max-height: 420px) and (pointer: coarse) and (hover: none), (max-height: 420px)
  and (max-width: 768px)` block (`:591`), immediately after the `#hint { display: none
  !important; }` rule (`:602`) and its comment, before the `#hintCaption[data-hint-key=
  "deepwater"]` rule (`:611`).
- `e2e/action-prompt.spec.ts` — edited: new regression coverage (below); the existing
  `describe('#actionSlot — all forceable rows live at once (LUL-2336, LUL-5166)')` block
  (`:367-401`) does not catch this bug today even though its own `qaForceAllActionRows()`
  hook (`engine/forest-engine.js:6001`) forces both `objectiveVisible` and
  `coverPromptVisible` true together — its two viewports (`1280x720` desktop, `844x390` via
  plain `page.setViewportSize` with no touch/device emulation) never actually engage
  `--action-slot-bottom: 190px` (needs `pointer: coarse` + `hover: none` from a real touch
  context, or `max-width: 768px` — `844 > 768` fails both), so it exercises the shrunk
  `--action-slot-row: 11.91px` in isolation but never at the real `mobile-pixel5-landscape`
  / `mobile-iphone-se-landscape` shapes local-qa actually flagged. This is a real, separate
  coverage gap — call it out in the PR body, do not fold a "fix the 844x390 project setup"
  change into this Tier A diff (out of scope, file a low-priority follow-up ticket instead
  if the CTO wants that generalized).

## The change

In `components/GameCanvas.tsx`, inside the block starting at `:591` (same block as the
`#hint` and `#hintCaption[data-hint-key="deepwater"]` rules), add:

```css
/* LUL-5246: .actionPromptLine renders ~31px (plain text) to ~44px (rows with a
   .actionPromptKey chip) regardless of breakpoint (no font-size/padding override exists
   for this class — grepped, GameCanvas.tsx has exactly one .actionPromptLine rule) but
   --action-slot-row above shrinks the track to 11.91px, so any two adjacent populated
   rows overlap by ~16-29px. Uniform row-height growth to fix this generally is
   mathematically infeasible in the remaining --action-slot-bottom budget on both target
   viewports (docs/specs/lul-5246-action-slot-objective-hide-overlap.md has the numbers) --
   same "stop repositioning, nothing left to reposition to" call as #hint/#hintCaption[
   deepwater] above, narrowed to the one pair local-qa actually caught colliding
   (layout-4a62437dbe): objective vs. hide-or-veil. hide/veil is the survival-critical
   affordance and already wins a collision at this breakpoint per the deepwater precedent
   just above -- objective's distance readout yields, same as :has() is used for the
   win/death overlay swap above (GameCanvas.tsx:105-106). #objective's own grid track is
   untouched (still reserved, just empty) so nothing below it shifts. */
body:has(#actionPrompt[data-visible="1"]) #objective .actionPromptLine { display: none !important; }
```

No other file changes. `--action-slot-height`, `--action-slot-bottom`, and every formula
that reads them (LUL-2410/LUL-2414/LUL-2418/LUL-2743, `:437/:459/:477/:643-651/:669`) are
untouched — confirm this with a diff review, not just CI, since that is the entire point of
choosing this fix shape.

## Verification

- `npx eslint components/GameCanvas.tsx` — clean.
- `npx tsc --noEmit` — clean (CSS-in-template-literal change, no type surface).
- `npm run build` — clean.
- Live-render check (same technique this SPEC's numbers came from — see "Live measurements"
  above): boot `qaWorld: 'micro'`, stage `qaHideBehindCoverKind('wolf'|'bear'|'lion')`
  (whichever is present in the micro world), at both `mobile-pixel5-landscape` (`Pixel 5`
  device + `727x393` viewport) and `mobile-iphone-se-landscape` (`iPhone SE` device +
  `667x375` viewport) with real touch/device emulation (`hasTouch`, `pointer: coarse`) —
  `getComputedStyle(#objective .actionPromptLine).display === 'none'`,
  `#actionPrompt .actionPromptLine` still visible with real text, and no two visible
  `.actionPromptLine` boxes intersect.

## e2e

**Specs.**
- `e2e/action-prompt.spec.ts` — new `test.describe('LUL-5246: #objective yields to
  #actionPrompt at short-landscape mobile')` with two tests, one per target viewport
  (`mobile-pixel5-landscape` via `{ ...devices['Pixel 5'], viewport: { width: 727, height:
  393 } }`, `mobile-iphone-se-landscape` via `{ ...devices['iPhone SE'], viewport: { width:
  667, height: 375 } }` — use `test.use({ ...devices[...] })` or a dedicated
  `test.describe.configure`/fixture so `hasTouch`/`pointer: coarse` are real, matching
  `shared/local-qa/bin/scenario-audit.mjs:54-55` exactly, not the existing 844x390 test's
  plain `setViewportSize` gap called out above): `boot(qaHooks:true, qaWorld:'micro')` →
  enter (viewport-relative click, `e2e/mobile/hide.spec.ts` convention, not `enter()`'s
  hardcoded desktop coordinate) → `qaSetFixedStep` → stage `qaOpenHideNearLionAtHideSpot()`
  (existing hook already used by the "urgent cover prompt" test in this file, stages cover +
  a chasing, sighted lion so `coverPromptVisible` goes true via the real engine path, not a
  QA-only patch) → `qaAdvance` → `expectRowVisible('actionPrompt')` →
  `getComputedStyle(document.querySelector('#objective .actionPromptLine'))?.display` must
  be `'none'` (element may not exist if `objectiveVisible` was already false — treat as pass
  only if a real objective was active; assert `state.objectiveVisible` was true first via
  `qaProbeHud` or equivalent before trusting the null case) → confirm no two visible
  `.actionPromptLine` boxes intersect (reuse `rectsOverlap`/`readActionRows`-style helper
  already in this file, `:342-355`, scoped to just these two ids).
- Extend the existing `describe('#actionSlot — all forceable rows live at once')` block's own
  doc comment (`:367-380` area) with a one-line note that its two viewports are desktop-only
  (no touch emulation) and do not cover the real mobile `--action-slot-bottom` budget — so a
  future reader doesn't assume that describe block already covers this case.
**World.** micro (default) — `qaOpenHideNearLionAtHideSpot()` already builds its own
deterministic cover+predator placement in the micro world; no `qaBuildScene` override
needed.
**Hooks.** No new hooks. Reuses `qaHideBehindCoverKind`/`qaOpenHideNearLionAtHideSpot`
(`engine/forest-engine.js:4717`/pre-existing, both already declared in
`engine/forest-engine.d.ts`).
**Tester scenario.** This is exactly local-qa's own `layout-4a62437dbe` finding
(`mobile-pixel5-landscape` / `try-again` state) — no new request file needed; the next
nightly run re-verifies this exact repro automatically once merged. Confirm in the PR body
that the fingerprint line stays intact for dedup per the ticket's own instruction.
**Not covered.** Visual polish of the resulting layout (objective pill blinking out while
hide/veil is up) is a UX call already accepted by the LUL-2410/2418 precedent this SPEC
cites — not re-litigated here. Real-device font metrics (this box's installed
`ui-sans-serif`/`system-ui` fallback vs. real iOS/Android system fonts) stay unverified per
every other spec in this file — the 31px/44px figures are internally consistent (same
environment local-qa's own rig uses) but not a guarantee of the exact pixel count on a real
phone.

## Constraints

- Do not touch `--action-slot-row`, `--action-slot-gap`, `--action-slot-bottom`,
  `--action-slot-height`, or the `grid-template-rows` track count — the "Why growing the row
  track cannot work" section above is the reason, not a style preference.
- The suppression must be `display: none` on the inner `.actionPromptLine`, not `opacity: 0`
  on the row — matches the founder's own "boxes must never intersect, not merely fade"
  requirement already documented on the `#hint` precedent this fix copies (`:598-606`).
- `#objective`'s row wrapper (`<div id="objective" class="actionPromptRow">`) stays mounted
  and occupies its grid track unconditionally — do not conditionally unmount it or change
  `Hud.tsx`'s `visible` prop; the suppression is CSS-only, scoped to this one breakpoint.

## Out of scope

- The other 7-8 near-adjacent row pairs among `#actionSlot`'s 9 regular tracks (e.g.
  `actionPrompt`/`veilOverloadPrompt`, `veilPrompt`/`throwPrompt`) share the identical
  structural defect (any two tracks within 2 grid positions overlap if both populate — the
  same row/gap math this SPEC measured) but this ticket's proven, local-qa-caught repro is
  specifically `objective` vs. `actionPrompt`. Auditing which of the other pairs are actually
  real-play-reachable simultaneously (Q1.5-style, per pair) is real scope, not busywork —
  file it as its own follow-up ticket rather than blocking this low-priority, already-scoped
  bug fix on a full audit.
- Generalizing the `describe('#actionSlot — all forceable rows live at once')` tests
  (`:367-401`) to use real touch/device emulation instead of plain `setViewportSize` (the gap
  named in "Files" above) — real, but a test-infra change independent of this fix; note it in
  the PR body, don't bundle it in.
- `#hint`'s and `#hintCaption[data-hint-key="deepwater"]`'s own suppression rules
  (`:602`/`:611`) are unrelated pre-existing code, unchanged by this diff.
