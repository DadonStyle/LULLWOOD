# SPEC: LUL-5374 Generalize `#actionSlot` short-landscape row-suppression to all 9 rows

**Ticket:** LUL-5374 · **This SPEC's own PR: Tier A** — docs-only (`docs/specs/**`), no code
touched, self-approve on green. **The implementation PR it dispatches: Tier B** — touches
`components/GameCanvas.tsx` (CSS-only, additive `:has()` rules in the existing media-query
block, same technique as the merged LUL-5246 rule), `e2e/action-prompt.spec.ts` (test-only),
and `components/Hud.tsx` (one comment). No engine/persistence/secrets file changes — matches
the Tier classification PR#917 (LUL-5246's implementation) already used for the identical
pattern in the identical file.

**Written against:** `release/next` @ `de19a2f15707f9de2f7b0b7b3cab674395c9db03` (2026-09-29,
includes merged LUL-5246/PR#917). Re-derive every `file:line` below from the branch you
actually implement on if it has moved.

**CTO decision (LUL-5373):** option (b) — generalize the priority-suppression pattern
LUL-5246/LUL-2410/LUL-2418 already use to every row pair that can actually collide, instead
of reintroducing layout shift, relying on CSS shrink alone (LUL-5246's own SPEC proved that
infeasible — `40 + 9*44 = 436px` needed vs `185px` available), or inventing a second UI
surface (breaks FEATURE_CHECKLIST Q9's one-prompt-convention rule).

## Live measurement — the real collision matrix (not estimated)

Measured live (Chromium, `LD_LIBRARY_PATH` pointed at
`~/.paperclip/shared/browser-deps/usr/lib/x86_64-linux-gnu`, `devices['Pixel 5 landscape']`
727x393 and `devices['iPhone SE landscape']` 667x375, real `isMobile`/`hasTouch` context —
same device shapes local-qa's real projects use) by forcing all 9 forceable rows live via
`window.ForestEngine.qaForceAllActionRows()` (`engine/forest-engine.js:6027`) against the
**current, already-merged** `release/next` (LUL-5246's single `#objective` suppression rule
already active) and reading each row's real `.actionPromptLine` `getBoundingClientRect()`
pairwise. Identical result on both viewports (the row/gap math depends only on
`max-height: 420px` matching, not on viewport width — same LUL-5246 finding):

```
chargePrompt           rowH=40.00 lineH=44.00
objective              rowH=11.91 lineH=0.00  (display:none -- LUL-5246's existing rule, actionPrompt is force-visible)
actionPrompt           rowH=11.91 lineH=44.00
veilOverloadPrompt     rowH=11.91 lineH=44.00
veilPrompt             rowH=11.91 lineH=44.00
throwPrompt            rowH=11.91 lineH=44.00
climbPrompt            rowH=11.91 lineH=44.00
chapelSanctuaryPrompt  rowH=11.91 lineH=31.00
status                 rowH=11.91 lineH=31.00

Overlapping .actionPromptLine pairs (display != none):
chargePrompt <-> actionPrompt
actionPrompt <-> veilOverloadPrompt
actionPrompt <-> veilPrompt
veilOverloadPrompt <-> veilPrompt
veilOverloadPrompt <-> throwPrompt
veilPrompt <-> throwPrompt
throwPrompt <-> climbPrompt
climbPrompt <-> chapelSanctuaryPrompt
climbPrompt <-> status
chapelSanctuaryPrompt <-> status
```

**Non-obvious finding: overflow is not adjacency-limited.** `chargePrompt` (row 1) and
`actionPrompt` (row 3) collide despite `objective` (row 2) sitting between them, *because*
`objective`'s row is already collapsed to an empty (but reserved) 11.91px+3.2px-gap track by
the existing LUL-5246 rule — `actionPrompt`'s 44px pill (bottom-anchored,
`justify-content: flex-end`, `.actionPromptRow` — `GameCanvas.tsx:809`) overflows its own
11.91px track by 32.09px, more than the 15.11px an emptied row-above contributes, so the
overflow reaches through it into `chargePrompt`'s own space. **This means suppression rules
must be verified live after being written, not derived by pairwise adjacency alone** — a
rule that fixes one pair can newly expose (or, as confirmed below, safely resolve) a
non-adjacent one once applied.

## Real-play co-occurrence check per pair (Q1.5 discipline — not blanket-applied)

`qaForceAllActionRows()` forces every flag unconditionally; it proves *pixel geometry*, not
*real reachability*. Cross-checked against the actual trigger assignments in
`engine/forest-engine.js`'s per-frame `pushState()` (`:7479-7521`):

| Pair (higher > lower) | Real co-occurrence? | Evidence |
|---|---|---|
| `chargePrompt` > `actionPrompt` | Yes | `chargeVisible` (predator charge-attack window) has no `!hidden`/cover gate; player can be near a hide spot (`coverPromptVisible`) when a charge triggers. |
| `actionPrompt` > `veilOverloadPrompt` | Yes | Explicit in-code: `veilOverloadTriggerActive` comment (`:7402-7405`) — "Not mutually exclusive with coverPromptVisible/veilPromptVisible ... a chased player near a hide spot can see both rows at once." |
| `actionPrompt` > `veilPrompt` | Yes | Explicit in-code: scentVeil comment (`:7407-7411`) — "can be visible at the same time as either" (veilOverload or actionPrompt). |
| `veilOverloadPrompt` > `veilPrompt` | Yes | Same comment as above, other half of the "either". |
| `veilOverloadPrompt` > `throwPrompt` | Yes | `heldThrowable` (`:3082`, set on pickup) has no gate excluding `veilOverloadTriggerActive`; holding a stone while being actively chased is ordinary play. |
| `veilPrompt` > `throwPrompt` | Yes | Same reasoning — `heldThrowable` and `scentVeilPromptActive` are independent flags. |
| `throwPrompt` > `climbPrompt` | Yes | `climbPromptVisible: !hidden && !mountedOnRock && lastRockMountSpot !== null` (`:7518`) has no throwable gate; holding a stone near a climbable rock is ordinary play. |
| `climbPrompt` > `chapelSanctuaryPrompt` | Yes (not disproven) | `chapelSanctuaryPromptVisible` (`:7348`) is pure distance (`chapelSanctuaryInRadius`), no gate excluding rock proximity. Map geometry may make this rare but nothing in the trigger code rules it out. |
| `climbPrompt` <-> `status` | **No — structurally impossible** | `climbPromptVisible` requires `!hidden` (`:7518`); `statusVisible` is only ever set `true` inside `if(hidden)` (`:7378-7380`). `hidden` is one boolean per frame — these two can never both be `true`. The measured collision above is a `qaForceAllActionRows`-only artifact, not a real bug. |
| `chapelSanctuaryPrompt` > `status` | Yes (not disproven) | `chapelSanctuaryPromptVisible` has no `!hidden` gate either — a hide spot inside the chapel's interact radius would let both be true. Not disproven by map geometry; treat as reachable per Q1.5 rather than assume it away. |

**Net: 9 of the 10 measured collisions get a suppression rule below; `climbPrompt`/`status`
does not** (see "Test changes" — the existing all-forced-rows assertion must be told about
this one exclusion explicitly, the same way `pickupPrompt` is already excluded from
`FORCED_ROW_IDS` for being mutually exclusive with `throwPrompt`).

## Positive-tell check per pair (FEATURE_CHECKLIST Q5 — not blanket-applied)

Applying LUL-2418's precedent test literally ("does the survivor describe the *same
situation* the suppressed row would have"):

- **`chargePrompt` > `actionPrompt`, `actionPrompt`/`veilOverloadPrompt`/`veilPrompt`
  mutual suppression** — all four rows are "something is happening to you right now, do
  something about it" (dodge / hide / veil / scent-break / panic-veil). The survivor is
  always itself an urgent call to action describing the live danger. **Same-situation test
  passes — no new cue**, matching the accepted LUL-5246 precedent for `objective` yielding
  to `actionPrompt`.
- **`veilOverloadPrompt`/`veilPrompt` > `throwPrompt`, `throwPrompt` > `climbPrompt`,
  `climbPrompt` > `chapelSanctuaryPrompt`, `chapelSanctuaryPrompt` > `status`** — these do
  **not** pass the same-situation test as cleanly (e.g. "holding a stone" and "being
  actively hunted" are different facts about the world, not one explaining the other) — the
  same shape as the ticket's own worked non-example, `pickupPrompt` suppressed under
  `chargePrompt`. However, unlike a *refused input* (Q5's literal trigger — "silently
  refuses the player's input"), nothing here is refused: `onPointerDown` lives on the outer
  `.actionPromptRow` (`ActionPrompt.tsx:82-91`), not the `.actionPromptLine` this SPEC hides,
  so a suppressed row's tap target (mobile throw/climb) **stays fully functional** — only
  the passive text disappears, and it reappears the instant the higher-priority trigger
  clears. Inventing a new visual affordance to announce "there's more below" would add a
  second prompt surface, which Q9 forbids, and would push this diff to Tier C for a problem
  this ticket's own scope keeps CSS-only. **Recommendation: ship without a new cue, same as
  LUL-5246's accepted precedent, but flag this explicitly for the CTO/reviewer as a weaker
  same-situation match than the charge/hide/veil cluster** — call it out by name in the PR
  body so it is a recorded decision, not a silent omission.

## The fix

Extend `GameCanvas.tsx`'s existing `@media (max-height: 420px) and (pointer: coarse) and
(hover: none), (max-height: 420px) and (max-width: 768px)` block (`:590-591`) with one
`:has()` rule per real-and-colliding pair from the table above, immediately after the
existing LUL-5246 rule (`:633`). Same `display: none !important` on `.actionPromptLine`
only technique — the row's own grid track stays reserved (nothing shifts), and because every
rule keys off the `data-visible="1"` attribute (set by React from real engine state,
`ActionPrompt.tsx:85`) rather than another row's rendered `display`, the rules compose safely
regardless of which other rules already fired that frame — confirmed by re-running the same
live measurement with all 9 new rules applied: **zero remaining `.actionPromptLine` overlaps
on both viewports**, including the worst case (all 9 forced simultaneously, where the chain
correctly collapses everything down to `chargePrompt` alone, the top of the priority order).

```css
body:has(#actionPrompt[data-visible="1"]) #objective .actionPromptLine { display: none !important; }
/* LUL-5374: generalizes the rule above to every other pair that (a) can really co-occur
   per Hud.tsx/forest-engine.js's own trigger conditions and (b) was live-measured to
   actually overlap at this breakpoint -- see docs/specs/lul-5374-action-slot-full-row-
   suppression.md for both the collision matrix and the per-pair real-co-occurrence check.
   Priority order (highest wins, CTO decision on LUL-5373): chargePrompt > objective >
   actionPrompt > veilOverloadPrompt > veilPrompt > throwPrompt > pickupPrompt > climbPrompt
   > chapelSanctuaryPrompt > status -- see Hud.tsx's own priority comment above #actionSlot.
   climbPrompt/status is deliberately NOT suppressed here: climbPromptVisible requires
   !hidden and statusVisible only turns true inside if(hidden), so they can never both be
   true in real play -- the two only "collide" under qaForceAllActionRows's unconditional
   force, a synthetic-only state (see the e2e test change note below). Every rule keys off
   [data-visible="1"] (React-set from real engine state), never another row's rendered
   display, so these compose safely with each other and with the rule above regardless of
   evaluation order -- verified live: re-measuring with all 9 rules applied plus
   qaForceAllActionRows() (worst case, all rows forced at once) shows zero remaining
   .actionPromptLine overlaps on both mobile-pixel5-landscape and mobile-iphone-se-landscape. */
body:has(#chargePrompt[data-visible="1"]) #actionPrompt .actionPromptLine { display: none !important; }
body:has(#actionPrompt[data-visible="1"]) #veilOverloadPrompt .actionPromptLine { display: none !important; }
body:has(#actionPrompt[data-visible="1"]) #veilPrompt .actionPromptLine { display: none !important; }
body:has(#veilOverloadPrompt[data-visible="1"]) #veilPrompt .actionPromptLine { display: none !important; }
body:has(#veilOverloadPrompt[data-visible="1"]) #throwPrompt .actionPromptLine { display: none !important; }
body:has(#veilPrompt[data-visible="1"]) #throwPrompt .actionPromptLine { display: none !important; }
body:has(#throwPrompt[data-visible="1"]) #climbPrompt .actionPromptLine { display: none !important; }
body:has(#climbPrompt[data-visible="1"]) #chapelSanctuaryPrompt .actionPromptLine { display: none !important; }
body:has(#chapelSanctuaryPrompt[data-visible="1"]) #status .actionPromptLine { display: none !important; }
```

`pickupPrompt` is not in this chain — it is already structurally mutually exclusive with
`throwPrompt` (`lib/game/outcome.ts`'s `canGrabThrowable` excludes `heldThrowable`, per the
existing `Hud.tsx` comment on that row), so it can never geometrically co-occur with its
neighbors in a way this fix needs to touch; leave it untouched.

## Files

- `components/GameCanvas.tsx` — edited: the 9 CSS rules above, inserted after `:633`
  (the existing `body:has(#actionPrompt...) #objective` rule), inside the same media block.
- `e2e/action-prompt.spec.ts` — edited: three changes (below).
- `components/Hud.tsx` — edited: one comment update (below).

## Test changes (`e2e/action-prompt.spec.ts`)

1. **`readActionRows()` (`:402-414`) measures the wrong element.** It calls
   `document.getElementById(id).getBoundingClientRect()` — the outer `.actionPromptRow`
   grid-track wrapper, which is laid out by the grid and can never overlap by construction
   (this is LUL-5373's coverage-gap finding #1). Change the rect read to the inner
   `.actionPromptLine` child (`row?.querySelector('.actionPromptLine')`), matching the
   `LUL-5246: #objective yields to #actionPrompt` describe block's own approach (`:349-350`,
   `document.querySelector('#objective .actionPromptLine')`). Keep reading `data-visible` and
   `textContent` from the outer element (unchanged) — only the rect source changes.

2. **`assertAllForcedRowsNonOverlapping()` (`:425-441`) asserts a premise this fix
   deliberately breaks.** It currently requires *every* forced row to render non-empty
   *visible* content — correct at `1280x720` desktop (`:443-459`, outside the
   `max-height:420px` query, nothing is suppressed there, no change needed) but **wrong** at
   the `narrow mobile landscape (844x390)` viewport (`:460-478`, inside the query) once this
   fix ships: by design, at that breakpoint only the single highest-priority currently-live
   row keeps a visible `.actionPromptLine` when several are forced at once — that is the
   entire point of the fix, not a regression. Split the assertion:
   - Keep the current strict form (`every row visible + non-overlapping`) for the `1280x720`
     call site only.
   - For the `844x390` call site, assert instead: (a) every row still has `data-visible="1"`
     (the underlying engine-state flags are unaffected by CSS), (b) no two *rendered*
     (`display !== 'none'`) `.actionPromptLine`s overlap (same rect check, just don't require
     every row to be one of the rendered ones), and (c) explicitly assert the
     `climbPrompt`/`status` pair is the one expected exception if both remain "visible" per
     `data-visible` (documented above as synthetic-only, non-real) rather than silently
     passing or silently failing — assert the two facts above and don't re-assert a strict
     "no overlap" between exactly that pair, with a comment citing this SPEC and the
     `!hidden`/`hidden` mutual exclusion, the same way `pickupPrompt` is already excluded
     from `FORCED_ROW_IDS` above (`:397`) for an analogous real mutual-exclusion reason.

3. **The `narrow mobile landscape (844x390)` test (`:460-478`) never actually renders mobile
   copy/styling** (LUL-5373 coverage-gap finding #2) — it only calls `page.setViewportSize()`
   with no `isMobile`/`hasTouch` context. `hasTouch`/`isMobile` cannot be toggled on an
   existing context (Playwright constraint) — they must be set at context-creation time.
   Add `test.use({ isMobile: true, hasTouch: true })` inside the
   `test.describe('#actionSlot — all forceable rows live at once ...')` block (`:442`),
   above both its `test(...)` calls — this creates the browser context for every test in the
   block with real touch/mobile emulation (matching `devices['Pixel 5 landscape']` /
   `devices['iPhone SE landscape']`'s own flags, which is what local-qa's real
   `mobile-pixel5-landscape`/`mobile-iphone-se-landscape` projects use), while each test's own
   `page.setViewportSize()` call keeps controlling the actual pixel dimensions per case. The
   `1280x720 desktop` test is unaffected in practice (outside the media query either way) but
   inherits the same context flags — harmless, `mobile` (`lib/input-mode.ts`'s `isMobile()`)
   is computed from `pointer`/`hover`/`max-width` media queries that a 1280px-wide viewport
   fails regardless of `isMobile`/`hasTouch` context flags.

## Hud.tsx comment update

`Hud.tsx:1141-1144`'s `#actionSlot` block comment currently names 5 of the 10 rows:
"charge dodge > objective (E) > hide-or-veil > throwable > status". Replace with the full
10-row order (this SPEC's priority list, CTO decision on LUL-5373), matching the wording
this SPEC and the new CSS comment both cite:

```
charge dodge > objective (E) > hide-or-veil > veil-overload panic > scent-veil break >
throwable > pickup (E) > vantage climb > chapel sanctuary > status
```

This is the priority-order source of truth other engineers read — leaving it half-listed is
exactly how LUL-5373 happened (an ambiguous 5-of-10 list left the other 4 rows' relative
priority undocumented until a bug forced someone to re-derive it).

## Verification

- `npx eslint components/GameCanvas.tsx components/Hud.tsx e2e/action-prompt.spec.ts` — clean.
- `npx tsc --noEmit` — clean (CSS-in-template-literal + comment + test-file changes, no
  production type surface).
- `npm run build` — clean.
- `npx playwright test action-prompt.spec.ts` — full file green, including the restructured
  `narrow mobile landscape` case and the two `LUL-5374` cases added below.
- Live-render re-check (same technique this SPEC's numbers came from): force all 9 rows via
  `qaForceAllActionRows()` at both `mobile-pixel5-landscape` (727x393) and
  `mobile-iphone-se-landscape` (667x375) with real touch/mobile context, read every
  `.actionPromptLine` rect, assert zero pairwise overlaps except the documented
  `climbPrompt`/`status` synthetic exception. This SPEC's own live measurement (recorded
  above) already confirms this passes with the exact 9 rules listed; the implementer should
  re-run it after applying the diff rather than trust the numbers blind, since the
  non-adjacency finding above means rule order/composition mistakes wouldn't be obvious from
  reading the CSS alone.

## e2e

**Specs.** `e2e/action-prompt.spec.ts`:
- `#actionSlot — all forceable rows live at once (LUL-2336, LUL-5166)` → `1280x720 desktop`
  test unchanged (still strict, outside the media query). `narrow mobile landscape (844x390)`
  test extended: real `isMobile`/`hasTouch` context (new), relaxed/corrected assertion per
  "Test changes" #2 above (extended, not new).
- Two new tests, same shape as the existing `LUL-5246: #objective yields to #actionPrompt at
  short-landscape mobile` describe block (`:333-383`): stage each newly-suppressed pair with
  a real engine trigger (not a QA-hook force) and assert (a) the lower-priority row's
  `.actionPromptLine` collapses to `display:none` while the higher-priority row has content,
  (b) the higher-priority row's content still renders, (c) the two boxes never intersect.
  Minimum two real-trigger pairs to cover live (staging every one of the 9 is expensive and
  redundant given the geometry is identical across pairs at this breakpoint — the
  `qaForceAllActionRows` matrix already covers the full set structurally):
  - `veilOverloadPrompt` survives over `throwPrompt`: `qaBuildScene` a stone near the player,
    grab it (`heldThrowable`), then stage a real chase (same `qaHideBehindCoverKind`-style
    predator staging the existing `actionPrompt` tests already use) to set
    `veilOverloadTriggerActive` true.
  - `chapelSanctuaryPrompt` survives over `status`: needs a real hide spot inside
    `CHAPEL_SANCTUARY_INTERACT_RADIUS` of the chapel in the micro world — if `qaBuildScene`
    cannot place both within radius, fall back to `qaForceAllActionRows` for this one pair
    specifically and say so in the test's comment (this is the one pair this SPEC could not
    disprove but also could not cheaply stage for real — flag it, don't fake confidence).
**World.** micro, via `qaBuildScene` — same convention as the existing file's tests. No
`@fullmap` need.
**Hooks.** No new hooks — `data-visible` attributes and `qaForceAllActionRows`
(`engine/forest-engine.js:6027`, already declared `engine/forest-engine.d.ts:678`) already
reach everything this SPEC needs.
**Tester scenario.** File `shared/local-qa/requests/lul-5374-action-slot-row-suppression.md`
once the fix lands: viewports `mobile-pixel5-landscape`/`mobile-iphone-se-landscape`,
preconditions staging at least the charge-vs-hide and hunted-cluster pairs via real gameplay
(chase a predator into a charge while near cover), steps checking no two `.actionPromptLine`
boxes ever intersect via the DOM audit the tester already runs. Cite this SPEC.
**Not covered.** Whether the weaker-justified suppressions (throwPrompt/climbPrompt/
chapelSanctuaryPrompt/status yielding silently) actually read as intuitive to a real player —
that is a feel judgment for a human tester, not something a DOM assertion can verify; flagged
explicitly above for CTO/reviewer sign-off rather than asserted away.

## Cues

**Visual.** No new visual element. Lower-priority rows collapse to their existing (already
CSS-only, no-layout-shift) reserved empty track, identical technique to the merged LUL-5246
rule — nothing new for the player to learn.
**Audio.** None — no new sound, consistent with LUL-5246 (a pure suppression, not a new
event).
**Explanation.** None — per the Q5 analysis above, the "hunted cluster" (charge/hide-veil/
veil-overload/scent-veil) survivor rows already explain the tradeoff by describing the same
live danger; the remaining pairs (throw/climb/chapel/status) ship without a new caption per
the reasoning above, called out explicitly rather than silently decided.
**Reduced motion.** N/A — `display:none` is not an animation; nothing to degrade.

## Constraints

- Zero changes to `--action-slot-row`, `--action-slot-gap`, `--action-slot-bottom`,
  `--action-slot-height`, or the `grid-template-rows` track count — every downstream formula
  that reads them (LUL-2410/LUL-2414/LUL-2418/LUL-2743, `GameCanvas.tsx:437/459/477/643-
  651/669`) stays untouched, same constraint LUL-5246's SPEC stated and verified.
- Every new `:has()` selector targets `[data-visible="1"]` (React-set logical state), never
  another row's own CSS-controlled `display` — this is what makes the 9 rules compose safely
  regardless of evaluation order; do not "simplify" this to chain off rendered `display`
  during implementation, it would silently break the non-adjacent case documented above.
- `onPointerDown` lives on `.actionPromptRow` (the row, not the line) for every row that has
  one (`chargePrompt`, `veilOverloadPrompt`, `veilPrompt`, `throwPrompt`, `climbPrompt`) —
  confirm during implementation that none of these suppression rules accidentally target the
  row itself instead of `.actionPromptLine`; doing so would silently kill a mobile tap
  target, not just hide text.

## Out of scope

- Re-deriving whether `climbPrompt`/`chapelSanctuaryPrompt`/`chapelSanctuaryPrompt`/`status`
  are *geometrically possible in the shipped map* (vs. just "not excluded by trigger code") —
  left as "not disproven, so suppress" per Q1.5's discipline; a future ticket could tighten
  this with real map-geometry analysis if it turns out to matter.
- Inventing a new positive-tell UI element for the weaker-justified pairs — explicitly
  recommended against above (Q9 one-prompt-convention, Tier creep) but flagged for CTO/
  reviewer sign-off rather than silently declared final.
- Any change to `qaForceAllActionRows()` itself (`engine/forest-engine.js:6027`) — it stays
  an unconditional force (useful precisely because it's a worst-case synthetic stress state);
  the `climbPrompt`/`status` synthetic exception is handled in the e2e assertion, not by
  making the hook itself respect the real `hidden` mutual exclusion.
