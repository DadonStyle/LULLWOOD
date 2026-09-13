# SPEC: LUL-2311 remove hiding in logs -- bramble is the only hide spot

**Ticket:** LUL-2311 · **Tier:** C -- `lib/game/cover.ts` (hide eligibility, a new exported
constant), `engine/forest-engine.js` (sound/copy/QA-hook call sites), `components/Hud.tsx`
(prompt copy), `docs/ELEMENTS.md`, and eight `e2e/` specs. `REVIEW: APPROVED` required
before merge.

**Written against:** `origin/release/next` @ `c352ab9` (2026-09-11). This is two commits
ahead of the CTO PLAN's `3572e53` -- LUL-2312 (`#569`) rewrote the HUD action-prompt system
(`components/Hud.tsx`), which moved every prompt-copy line number the PLAN cited. Every
`file:line` below was re-read directly against `c352ab9`; do not trust the PLAN's own line
numbers for `Hud.tsx`. Re-derive again if this branch has moved further by the time you
implement.

Founder brief (verbatim): "remove the ability to hide in low logs, it doesn't make sense."
Log stays a walkable, LOS-blocking cover prop -- only the `KeyH` hide *stance* is being
removed from it. This spec also corrects one PLAN assumption after direct verification (see
`hollowLogSound()` below) and confirms the movement/LOS/predator-catch invariants the PLAN
already committed to.

## Files

- `lib/game/cover.ts` -- edited. `HIDE_KINDS` narrows to `{ bramble: true }`; new exported
  `WALKABLE_KINDS = { bramble: true, log: true }`; `coverKindBlocksMovement()` reads
  `WALKABLE_KINDS` instead of `HIDE_KINDS`; two comment blocks updated (the coupling they
  describe no longer holds).
- `lib/game/cover.test.ts` -- edited. `findHideSpot` suite: log stops qualifying, a new
  negative case added, the tie-break test's log candidate becomes a second bramble.
  `coverKindBlocksMovement` suite's assertions (booleans) are unchanged; two test
  descriptions reworded since their prose cites the old rationale.
- `engine/forest-engine.js` -- edited. Import `WALKABLE_KINDS` alongside `HIDE_KINDS`;
  `stageBlindChaseThroughCover()` switches to it; `playHideSfx()` and `hollowLogSound()`
  deleted (dead code once log leaves `HIDE_KINDS` -- see below); `enterHide()`/`exitHide()`
  call `leafRustle()` directly; three doc comments reworded (module-level hiding-spots
  comment, `hideKind`'s inline comment, `qaTeleportToHideSpot`'s comment).
- `engine/forest-engine.d.ts` -- edited. Three JSDoc comments on QA hooks that say
  "bramble/log" reworded to "bramble"; one new hook declared,
  `qaTeleportNearCoverKind`.
- `components/Hud.tsx` -- edited. `hideVeilPromptContent()`'s `noun` ternary drops the log
  branch; desktop gate-help copy drops "& hollow logs".
- `docs/ELEMENTS.md` -- edited. Log card, Bramble card, Player/Tree "what it can/cannot do"
  bullets, the interaction matrix's Log/`LO` cell (`LOS+HIDE` -> `LOS`) and footnotes ²⁰/²²,
  a stale `hollowLogSound()` reference in the home-fire-crackle passage, and a stale
  `!HIDE_KINDS` reference in the Reed/bog appendix (should say `!WALKABLE_KINDS`) -- all
  listed below. `coverPromptKind`'s documented type union (`'bramble'|'log'|null`) is left
  unchanged, matching the `Hud.tsx` decision below.
- `e2e/hide.spec.ts`, `e2e/mobile/hide.spec.ts`, `e2e/predator-memory.spec.ts`,
  `e2e/positional-hiding.spec.ts`, `e2e/lul211-founder-report.spec.ts` -- edited, comment/
  error-string wording only (no assertion changes -- see `## e2e`).
- `e2e/action-prompt.spec.ts` -- edited. Drops the now-dead `kind === 'log'` branch; adds
  one new spec asserting `KeyH` beside a log is a no-op, using the one new QA hook below.
- `e2e/tree-pathing.spec.ts`, `e2e/blind-chase-cover.spec.ts` -- read-only, confirmed no
  reference to `HIDE_KINDS`/log-hiding; run in CI for this PR, no edits needed.

## The change

### 1. `lib/game/cover.ts` -- split hide-eligibility from walkability

`HIDE_KINDS` (`:598`) currently backs both "can I press H here" (`findHideSpot()`, `:608`)
and "does this block movement" (`coverKindBlocksMovement()`, `:210-211`, reused by
predators via `blockedForPredator()`/`coverBlockedR()`). Narrowing `HIDE_KINDS` to
`{ bramble: true }` alone would make `log` solid for both actors (LUL-384/LUL-1643
regression) -- that is not wanted. Split the two:

```ts
// lib/game/cover.ts:598
export const HIDE_KINDS: Readonly<Record<string, boolean>> = { bramble: true };

// new, immediately below HIDE_KINDS/HIDE_RADIUS (:599)
// ---- which cover kinds a player/predator walks through (LUL-384, LUL-1642,
// LUL-2311) -----------------------------------------------------------------
// Was identical to HIDE_KINDS by construction until LUL-2311 removed `log`
// from hide-eligibility while keeping it walkable -- the two sets now
// diverge in content, not just name. Anything added to one in the future is
// NOT automatically in the other; update both call sites deliberately.
export const WALKABLE_KINDS: Readonly<Record<string, boolean>> = { bramble: true, log: true };
```

`coverKindBlocksMovement()` (`:210-211`) changes its one read:

```ts
export function coverKindBlocksMovement(kind: string): boolean {
  return kind !== 'tree' && !WALKABLE_KINDS[kind];
}
```

No other line in `coverKindBlocksMovement()`'s callers changes -- `coverBlockedR()`
(`:418-429`), `blockedForPredator()` (`:505-514`), and `generateCover()`'s canopy-clearance
gate (`engine/forest-engine.js:696`, still keyed off `coverKindBlocksMovement()` itself, not
`HIDE_KINDS` or `WALKABLE_KINDS` directly) all keep working unchanged because they read the
function, not the constant.

**Comment updates (content, not just line moves):**

- `:184-209`, the comment above `coverKindBlocksMovement()` ("LUL-1642: bramble joins log
  here too... unifying the two HIDE_KINDS the way the ticket asked") describes bramble and
  log as identical *because* they're both `HIDE_KINDS`. That's no longer true post-LUL-2311
  -- they're identical in `WALKABLE_KINDS` membership only now. Reword the comment's closing
  two sentences (`:205-209`) to say the walkable-movement exemption is what's shared, not
  hide-spot membership, and drop "unifying the two HIDE_KINDS" language.
- `:413-416`, the comment above `coverBlockedR()` ("LUL-384 additionally skips 'log' via
  coverKindBlocksMovement()... hide-spot eligibility (findHideSpot()/HIDE_KINDS) both read
  coverGrid independently of this function and are unchanged by either skip") -- the
  "unchanged" claim about hide-spot eligibility becomes false for log specifically. Reword
  to note log's hide-spot eligibility was removed in LUL-2311; this function's own
  walkability behavior for log is unaffected by that removal.

### 2. `lib/game/cover.test.ts` -- update the `findHideSpot` suite

Exact current lines (`git show c352ab9:lib/game/cover.test.ts`):

- `:776-781`, `'findHideSpot: finds a qualifying prop (log) within HIDE_RADIUS'` -- change
  the fixture's `kind` from `'log'` to `'bramble'` and the title to
  `'finds a qualifying prop (bramble) within HIDE_RADIUS'`; the assertion
  `spot!.kind === 'log'` becomes `=== 'bramble'`.
- After the existing `:783-786` rock-negative test, add a new case:
  ```ts
  test('findHideSpot: ignores log -- LUL-2311 removed it from HIDE_KINDS', () => {
    const coverGrid = makeGrid<CoverAABB>([{ x: 0.5, z: 0, hx: 0.3, hz: 0.3, kind: 'log', ry: 0 }]);
    assert.equal(findHideSpot(0, 0, coverGrid), null);
  });
  ```
- `:789-792`, `'findHideSpot: HIDE_KINDS is exactly {bramble, log}'` -- title and body become
  `'findHideSpot: HIDE_KINDS is exactly {bramble}'` /
  `assert.deepEqual(HIDE_KINDS, { bramble: true });`.
- `:793-797` and `:798-801` (the `HIDE_RADIUS` boundary tests) -- both fixtures use
  `kind: 'log'`; change both to `kind: 'bramble'`. Behavior asserted (boundary math) is
  identical for either kind since it's edge-distance geometry, not kind-specific -- this is
  a fixture substitution only.
- `:804-812`, the tie-break test -- candidate `a` is `kind: 'log'`, `b` is `kind: 'bramble'`,
  asserting `a` (first-pushed) wins. Once `log` can't qualify at all, `a` would never be a
  candidate and the test would trivially pass on `b` by elimination, silently stopping being
  a tie-break test. Change `a`'s `kind` to `'bramble'` too, so both candidates are
  hide-eligible and the assertion still genuinely exercises "first-pushed wins on an exact
  distance tie."
- `:333`, `'coverKindBlocksMovement is false for bramble -- LUL-1642, walkable like log so
  hasLOS() unifies with the log hiding case'` -- reword the description only (assertion
  unchanged): the "unifies with the log hiding case" framing is stale since log is no longer
  a hiding case. Suggested: `'coverKindBlocksMovement is false for bramble -- LUL-1642,
  walkable like log (WALKABLE_KINDS), independent of hide-spot eligibility since LUL-2311'`.
- `:559`, `'blockedForPredator: log does not block a predator (HIDE_KINDS stays walkable for
  both actors)'` -- reword to `'... (WALKABLE_KINDS stays walkable for both actors)'`.
  Assertion unchanged.
- `:544-567` (`blockedForPredator` suite) otherwise unchanged -- these are movement-only and
  already correctly read as booleans, not the constant's identity.

### 3. `engine/forest-engine.js`

Import (`:58-67`, alongside the existing `HIDE_KINDS` import): add `WALKABLE_KINDS` to the
same `from '../lib/game/cover.ts'` import list.

**`stageBlindChaseThroughCover()`** (function starts `:4027`, the `HIDE_KINDS` read is at
`:4032`): this hook (backing `qaStageAndTraceBlindChase`, consumed by
`e2e/blind-chase-cover.spec.ts`) needs a walkable cover prop between predator and player that
doesn't collide either actor -- a walkability invariant, not a hide invariant (it never
presses `KeyH`). Change `:4032`'s `if(!HIDE_KINDS[c.kind]) continue;` to
`if(!WALKABLE_KINDS[c.kind]) continue;`. Its own comment block (`:4008`, "a log/bramble
cover prop's (HIDE_KINDS -- rock/reed now collide...)" and `:4035`, "a log/bramble
cover prop (HIDE_KINDS)") both name `HIDE_KINDS` as the set backing this hook -- reword both
to name `WALKABLE_KINDS` instead, since after this change `HIDE_KINDS` no longer describes
what this function selects for. Leaving this on `HIDE_KINDS` would silently cut the
candidate pool from ~65% of cover props (log+bramble) to ~25% (bramble only, per
`rollCoverPropShape`'s `roll<0.4` log / `<0.75` rock / else bramble split), making the
blind-chase e2e spec flakier on low-cover seeds without ever failing outright -- worth
avoiding even though it's not the ticket's literal ask.

**`playHideSfx()`/`hollowLogSound()` -- delete both, correcting a PLAN assumption.**
The PLAN said to keep `hollowLogSound()` because `homeFireCrackle()`'s comment (`:2877`,
"Reuses hollowLogSound()'s filtered-noise-burst chain below") implied a live call
dependency. Direct read of both functions (`homeFireCrackle` `:2881-2902`, `hollowLogSound`
`:2903-2924`) shows `homeFireCrackle()` has its own independent, duplicated noise/bandpass
chain -- it does not call `hollowLogSound()`. The same is true of `missionCompleteSting()`
(`:4601-4610`, comment says "reuses hollowLogSound's noise-burst + oscillator chain" but
again duplicates the code rather than calling it). `grep -n "hollowLogSound("
engine/forest-engine.js` on `c352ab9` shows exactly one call site: `playHideSfx()` at
`:2925`. Once `log` leaves `HIDE_KINDS`, `enterHide()`/`exitHide()` can never be invoked with
`kind === 'log'` (both read from `findHideSpot()`'s return, which now only yields bramble),
so `playHideSfx()`'s `kind === 'log'` branch — and therefore `hollowLogSound()` itself —
become genuinely unreachable, not just unlikely. Delete both:

- Delete `hollowLogSound()` (`:2903-2924`).
- Delete `playHideSfx()` (`:2925`).
- `enterHide()` (`:2934`): replace `playHideSfx(spot.kind, true);` with `leafRustle(true);`.
- `exitHide()` (`:2935`): replace `playHideSfx(hideKind, false);` with `leafRustle(false);`.

`homeFireCrackle()` and `missionCompleteSting()` are untouched -- their comments referencing
"reuses hollowLogSound's chain" describe a code-shape resemblance, not a call dependency, and
are accurate as historical/descriptive comments either way; leave them as-is (not part of
this ticket's scope).

**`hideKind`** (`:2578`, decl comment: `// LUL-212: which hiding-spot kind the player is
currently in ('bramble' | 'log'), for the exit sound`): the variable itself stays -- it is
still read nowhere except the two lines just edited above, and after this change it can only
ever hold `'bramble' | null`. Reword the inline comment's type list from `('bramble' |
'log')` to `('bramble')`; do not remove the variable itself (still meaningfully named
bookkeeping for a future third hide-kind, and removing it would touch `enterHide()`/
`exitHide()`/the reset at `:4752` for zero behavior change -- more diff, no benefit).

**Module-level hiding-spots comment** (`:538-554`, "Every cover prop still blocks line of
sight the same way... bramble ('bush', leaf rustle) and log ('hollow log', a wood knock/
creak)"): reword the two-kind description (`:543-547`, "one of two dedicated hiding-spot
kinds... bramble ('bush', leaf rustle) and log ('hollow log', a wood knock/creak)") to name
bramble only ("the one dedicated hiding-spot kind"), and drop the wood-knock/creak clause
since that sound no longer plays on hide-enter.

**QA hook comments (behavior unchanged, wording only):**

- `:3721`, `qaHideBehindCover()`'s comment: "narrowed from 'any dedicated cover prop
  (log/rock/bramble)' to only HIDE_KINDS (bramble/log)" -- reword the parenthetical to
  `(bramble)`.
- `:3880-3882`, `qaTeleportToHideSpot()`'s comment: "teleport the player to the first
  generated hiding spot (bramble/log)" -- reword to `(bramble)`.
- `:3748`, `:3783`, `:3884`, `:3899` (the four `if(!HIDE_KINDS[c.kind]) continue;` /
  `coverData.find(c => HIDE_KINDS[c.kind])` reads inside `qaHideBehindCover`,
  `qaHideBehindCoverKind`, `qaTeleportToHideSpot`, `qaOpenHideNearLionAtHideSpot`) -- **stay
  on `HIDE_KINDS`, no code change.** Every one of these hooks is followed by a real `KeyH`
  press in the e2e specs that call it (`e2e/positional-hiding.spec.ts:156`,
  `e2e/hide.spec.ts:24`, `e2e/action-prompt.spec.ts:33/86`,
  `e2e/predator-memory.spec.ts:41`) -- their invariant genuinely is "can hide here," which
  after this change correctly means bramble-only. This is what makes those specs'
  hide-related assertions keep passing (teleport lands on the one remaining hide-eligible
  kind) with zero code changes to the hooks themselves.

### 4. `engine/forest-engine.d.ts` -- three doc-comment wording fixes, no signature changes

- `qaOpenHideNearLionAtHideSpot`'s JSDoc (`:114`): "teleports the player to the first
  hide-spot prop (bramble/log)" -> "(bramble)".
- `qaHideBehindCover`'s JSDoc (`:116`): "a real hiding-spot prop (bramble/log; LUL-212
  narrowed this from any non-tree cover prop)" -> "(bramble; LUL-212 narrowed this from any
  non-tree cover prop, LUL-2311 narrowed it again to bramble only)".
- `qaTeleportToHideSpot`'s JSDoc (`:134`): "the first generated hiding spot (bramble/log)"
  -> "(bramble)". Its return type (`:135`, `() => string | null`) does not change -- it
  still returns a cover-kind string, which will now always be `'bramble'` when non-null.
  `qaHideBehindCoverKind`'s parameter/return `kind` (`:119-121`) is the **predator species**
  (`'wolf'|'bear'|'lion'`), unrelated to cover kind -- no change there at all.

### 5. `components/Hud.tsx` -- prompt copy

`hideVeilPromptContent()` (`:279-300`, added by LUL-2312's `#569` refactor -- this is where
the PLAN's cited `~803`/`~810-821` ternary/JSX actually live now, restructured into a single
function returning `<ActionPrompt>` props):

```ts
// :284, currently:
const noun = state.coverPromptKind === 'log' ? 'hollow log' : 'bush';
// becomes:
const noun = 'bush';
```

(`noun` stays a `const` used four times below it in the same function -- keeping it avoids
touching the four template-literal call sites at `:288-296` that reference `${noun}`.)

Desktop gate-help copy, `:721`:

```
- <b>H</b> — hide (bushes &amp; hollow logs only) &nbsp;·&nbsp; <b>E</b> — lift the child ...
+ <b>H</b> — hide (bushes only) &nbsp;·&nbsp; <b>E</b> — lift the child ...
```

Mobile gate copy (`:707-715`) already says nothing log-specific ("Hide" / "E" / "Jump...the
buttons tell you when") -- confirmed by direct read, no change.

`EngineHudState.coverPromptKind`'s type (`Hud.tsx:70`, `'bramble' | 'log' | null`) --
**leave as `'bramble' | 'log' | null`, do not narrow.** The engine's `pushState()` call sites
that set this field live in `engine/forest-engine.js` and are out of scope for this ticket
(they already only ever emit `'bramble'` post-change since that's the only `HIDE_KINDS`
member `findHideSpot()` can return) -- narrowing the TS type here without touching the
engine's untyped JS emitters would be a type claim the engine doesn't structurally guarantee
IK. `noun`'s ternary removal above already makes the `'log'` branch dead in the one place
that read it; that is sufficient.

## Spawn balance -- confirmed unchanged, no rng reshuffle

Per the PLAN's decision: `rollCoverPropShape` (`lib/game/cover.ts:704-714`,
`roll < 0.4` log / `< 0.75` rock / else bramble) is **unchanged**. This is a realism fix, not
a difficulty rebalance -- Game Economist watches post-ship hide-usage/death telemetry and
files a separate balance ticket if the harder forest (bramble is now ~25% of cover props
instead of the ~65% log+bramble combined that were hide-eligible before) proves to be a
problem. No rng draw order or count changes.

## Verification

- `npx tsc --noEmit` -- clean (no engine-contract implication: no `EngineActions` key is
  added, changed, or removed by this diff).
- `node --test lib/game/cover.test.ts` -- all `findHideSpot`/`coverKindBlocksMovement`/
  `blockedForPredator` cases pass, including the new log-negative case.
- `npx eslint .` (via the `lint` script) -- clean.
- `npx playwright test e2e/hide.spec.ts e2e/mobile/hide.spec.ts e2e/action-prompt.spec.ts e2e/positional-hiding.spec.ts e2e/predator-memory.spec.ts e2e/lul211-founder-report.spec.ts e2e/tree-pathing.spec.ts e2e/blind-chase-cover.spec.ts`
  -- all pass locally before opening the PR; the founder's local QA tester still owns the
  authoritative e2e verdict on the PR itself (`local-qa: PASS|FAIL @<sha>` comment) per the
  2026-09-09 GitHub-queue directive -- do not treat a local pass as the PR gate.

## e2e

**Specs.**
- `e2e/hide.spec.ts` -- unchanged assertions; comment/error-string wording only
  (`:11`, `:26`: "bush/hollow log" -> "bramble bush"). Must pass unchanged.
- `e2e/mobile/hide.spec.ts` -- same, error string at `:31`. Must pass unchanged.
- `e2e/predator-memory.spec.ts` -- same, assertion message at `:42`. Must pass unchanged.
- `e2e/positional-hiding.spec.ts` -- same, header comment `:31-36` (specifically the "one of
  those two kinds" claim at `:33`). Must pass unchanged.
- `e2e/lul211-founder-report.spec.ts` -- header comment `:26-34` reworded (line 29's
  "hide-spot eligibility ... untouched" claim becomes false and must be corrected; line 33's
  "bramble now matches log exactly" is true for walkability only after this change). The
  `for (const kind of ['log', 'bramble'])` walkability-parametrized loop at `:193` **stays
  exactly as-is** -- log's walkability is unaffected by this ticket. Must pass unchanged.
- `e2e/action-prompt.spec.ts` -- `:55`'s `const noun = kind === 'log' ? 'hollow log' :
  'bush';` becomes `const noun = 'bush';` (dead branch removal, matches Hud.tsx); comments at
  `:54`/`:56` reworded. New spec added: `qaTeleportNearCoverKind('log')` (new hook, below)
  places the player just outside a log's edge, press `KeyH`, assert `qaPlayerState().hidden`
  stays `false` and `#actionPrompt` stays `data-visible="0"`. (new)
- `e2e/tree-pathing.spec.ts` -- read-only confirmation, no references to `HIDE_KINDS`/
  log-hiding found. Must pass unchanged, included in this PR's CI run.
- `e2e/blind-chase-cover.spec.ts` -- read-only confirmation, no references to
  `HIDE_KINDS`/log-hiding found (uses `stageBlindChaseThroughCover()`, which this spec
  repoints at `WALKABLE_KINDS` -- behavior-preserving, candidate pool unchanged). Must pass
  unchanged, included in this PR's CI run per the PLAN's flag that it wasn't on the founder's
  original file list.

**Hooks.** One new hook: `window.ForestEngine.qaTeleportNearCoverKind(kind: string): string |
null` -- teleports the player just outside the edge of the first `coverData` entry matching
`kind`, with no `HIDE_KINDS` filter (unlike `qaTeleportToHideSpot`), so a test can stage the
player beside a specific non-hide-eligible cover kind (here, `'log'`) and assert `KeyH` does
nothing. Declared in `engine/forest-engine.d.ts`, installed inside the `?qaHooks=1` block in
`init()` next to `qaTeleportToHideSpot` (`engine/forest-engine.js`). Every other QA hook
referenced above already exists behind `?qaHooks=1`
(`window.ForestEngine.qaTeleportToHideSpot`, `qaHideBehindCover`, `qaHideBehindCoverKind`,
`qaOpenHideNearLionAtHideSpot`, `qaStageAndTraceBlindChase` -> `stageBlindChaseThroughCover`)
-- this ticket only changes which constant three of their internal `if` checks read
(`HIDE_KINDS` -> `WALKABLE_KINDS`, `stageBlindChaseThroughCover` only) or leaves them as-is
(the other four, still correctly reading the now-narrower `HIDE_KINDS`).

**Tester scenario.** None of this ticket's behavior needs the founder's nightly local-qa
tester beyond what's already covered by the Playwright suite above (`local-qa:
PASS|FAIL @<sha>` on the PR per the GitHub-queue directive) -- this is a deterministic,
seed-independent hide-eligibility check the existing suite already exercises via
`qaTeleportToHideSpot`. `shared/local-qa/QA_TESTER.md`'s own hide-rules prose mentions logs
and is founder-owned; per the LUL-2288 routing rule this spec does not edit it -- flag a
separate ticket to the CEO for the founder instead (tracked outside this spec, see below).

**Not covered.** Whether removing log as a hide spot *feels* right in play (the founder's
"it doesn't make sense" complaint is a realism judgment, confirmed structurally by this
diff but not felt-verified) -- unverified until a human or the founder plays a build. Audio
feel of `leafRustle()` now being the only hide sound (previously it alternated with the
hollow-log knock depending on spot) -- also a feel call, not a correctness one.

## Constraints

- `rollCoverPropShape`'s rng draw order and count (`lib/game/cover.ts:704-714`) do not
  change -- no seed reshuffle, per the LUL-2212/LUL-2215 precedent.
- `hollowLogSound()` and `playHideSfx()` are deleted, not kept -- verified via direct
  `grep`/read that `hollowLogSound()` has exactly one caller (`playHideSfx`'s log branch),
  which becomes unreachable once `log` leaves `HIDE_KINDS`. `homeFireCrackle()` and
  `missionCompleteSting()` do not call `hollowLogSound()` despite their comments' "reuses"
  language -- they duplicate its synthesis pattern independently and are untouched by this
  diff.
- `WALKABLE_KINDS` and `HIDE_KINDS` diverge in content, not just name, for the first time --
  a future kind added to one is not automatically in the other (see the new comment on
  `WALKABLE_KINDS` itself).
- `coverKindBlocksMovement()`'s external behavior (its boolean return per kind) is
  UNCHANGED for every kind -- `cover.test.ts`'s `coverKindBlocksMovement` suite assertions
  (`:326-343`) must pass with zero changes to their expected values, only two description
  strings reworded.
- Log's LOS-blocking behavior (`hasLOS()`) and predator-catch geometry are unaffected --
  this ticket only removes `KeyH`-triggered `hidden` eligibility, nothing about sight-
  blocking or collision.
- No `EngineActions`/`ENGINE_ACTION_KEYS` change -- this diff adds no new engine action, so
  the LUL-1697 engine/React contract check does not apply here.

## Out of scope

- Bramble hide-spot density / spawn-rate rebalance -- explicitly deferred to the Game
  Economist per the PLAN's decision (see "Spawn balance" above); this diff does not touch
  `rollCoverPropShape`.
- `shared/local-qa/QA_TESTER.md`'s hide-rules prose -- founder-owned per LUL-2288 routing;
  a separate ticket to the CEO (flagged for the founder) covers it, not this spec.
- LUL-2320 (predators can't catch a player standing on a log/bramble -- own-footprint blocks
  LOS) -- a related but independent bug in `hasLOS()`'s footprint handling, already has its
  own in-progress SPEC and branch. Not touched here; the two tickets' diffs are additive
  (this one narrows `HIDE_KINDS`, that one changes `hasLOS()`'s occlusion test) and should
  not conflict, but re-check on rebase if both land close together.
- Any rewording of `hideKind`'s runtime *behavior* -- the variable is kept, only its comment
  changes (see `engine/forest-engine.js` section above for why removing it isn't worth the
  extra diff).
