# SPEC: LUL-2614 Throwables: render the reserve count, add the pickup prompt, fix shop copy

**Ticket:** LUL-2614 · **Tier:** B — `engine/forest-engine.js` + `components/Hud.tsx`, pure
state-plumbing/rendering/copy (no predator/simulation logic touched), player-visible.
**Correction to the CTO plan comment (2026-09-15T18:18Z):** that comment says "no blocking
Code Reviewer pass required, green CI is the floor" for Tier B. That is not current —
`AGENTS.md:134-138`'s documented known gap is that `release/next`'s branch ruleset requires
1 approving review on every PR regardless of tier (no Tier-B auto-approve bot exists yet).
Route to Code Reviewer before merge, same as every other Tier B PR this cycle (LUL-2649,
LUL-2599, LUL-2581 journal entries, all today).

**Written against:** `release/next` @ `a5251f37dbdaa6be90efd666593644bb14bb3b84` (2026-09-15).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

## Files

- `engine/forest-engine.js` — edited: add `throwablesReserve` to both `pushState` call sites.
- `engine/forest-engine.d.ts` — edited: add `throwablesReserve` to `EngineHudState`.
- `components/Hud.tsx` — edited: `EngineHudState` field, `INITIAL_STATE` default, `#throwPrompt`
  text, new `#pickupPrompt` row, `shopEffectCopy()` pocketStones branch.
- `e2e/embers-shop.spec.ts` — extended: reserve-count text assertion.
- `e2e/throwable-mission-hud.spec.ts` — extended: `#pickupPrompt` assertions.
- `e2e/action-prompt.spec.ts` — edited: row-order assertion grows from five ids to six.
- `docs/ELEMENTS.md` — edited in the same PR (founder rule 2026-09-09): see "ELEMENTS.md" below.

## The change

### 1. Expose `throwablesReserve` to the HUD

`throwablesReserve` (`engine/forest-engine.js:3031`) already exists and is already correctly
maintained (reset from tier every `enter()` at `:3767`, decremented on re-arm at `:3768` and
`:5339`) — it is read today only by the `qaProbeEmbersPurchase` QA hook (`:5073`). It has never
been in `pushState`/`EngineHudState`. Add it to both call sites that already push `heldThrowable`:

- `engine/forest-engine.js:6372` (inside the `if(playing)` branch, `pushState({...})` starting
  at `:6359`) — change
  `heldThrowable, canGrabThrowable: canGrabThrowable(heldThrowable, nearestThrowableD, THROWABLE_PICKUP_RADIUS),`
  to add `throwablesReserve,` on the same line (shorthand property, matches the file's existing
  style for same-name fields).
- `engine/forest-engine.js:6393` (the `else` branch's reset `pushState({...})`) — add
  `throwablesReserve` to that object literal too, so the field is never stale/undefined when
  `playing` is false (mirrors how `heldThrowable` is already carried into both branches).

`engine/forest-engine.d.ts` — add `throwablesReserve: number;` to `EngineHudState` next to
`heldThrowable`/`canGrabThrowable` (find the matching block near the other `EngineHudState`
fields; keep it adjacent to `heldThrowable` since Hud.tsx will read them together).

### 2. `components/Hud.tsx` — field + default

- `:115-116` (`EngineHudState` interface, inside the LUL-1623 comment block at `:112-114`) —
  add `throwablesReserve: number;` after `canGrabThrowable: boolean;`. Extend the existing
  comment: reserve is the count that re-arms `heldThrowable` after a throw, and now renders as
  the `#throwPrompt` suffix below.
- `:266-267` (`INITIAL_STATE`) — add `throwablesReserve: 0,` after `canGrabThrowable: false,`.

### 3. `#throwPrompt` text — render the count (`:1078-1084`)

Replace the `text` prop:

```tsx
<ActionPrompt
  id="throwPrompt"
  visible={state.heldThrowable && !state.winVisible && !state.deathVisible}
  tone="ready"
  text={
    mobile
      ? `Holding a stone${state.throwablesReserve > 0 ? ` (+${state.throwablesReserve})` : ''} — tap  `
      : `Holding a stone${state.throwablesReserve > 0 ? ` (+${state.throwablesReserve} in reserve)` : ''} — click to throw`
  }
  keycap={mobile ? 'Throw' : undefined}
/>
```

When `throwablesReserve` is 0 (no Pocket Stones owned, the default/base case) the rendered
string is byte-identical to today's — `e2e/throwable-mission-hud.spec.ts:28`'s existing
`.toContainText('click to throw')` assertion must keep passing unchanged; do not touch that
test.

### 4. New `#pickupPrompt` row for `canGrabThrowable`

`canGrabThrowable` has been computed and pushed every frame since LUL-1623 (`:6372` above) and
typed in `EngineHudState` (`Hud.tsx:116`), but zero components read it (`grep 'state\.canGrabThrowable' components/` returns nothing before this spec). `canGrabThrowable()`
itself (`lib/game/outcome.ts:151-153`) already returns `!heldThrowable && distToThrowable <
radius` — it is false whenever a stone is already held, so `state.canGrabThrowable` and
`state.heldThrowable` are already mutually exclusive by construction; the row's visibility
condition does not need to repeat `!heldThrowable`.

Grab uses the same context-dispatched `E`/Interact key as child pickup (`ELEMENTS.md:704-706`)
— no separate grab button on mobile either (`triggerTouchInteract`'s permanent on-screen `E`
button, `components/MobileControls.tsx:336`, is already visible any time it's usable). So this
row needs no `mobile` branching and no `keycap` chip, matching `#objective`'s own convention
for the same key (`Hud.tsx:1057-1062`, plain text, no chip).

Insert immediately after the `#throwPrompt` row (`Hud.tsx:1084`), before the `#status` row
(`:1088`):

```tsx
{/* LUL-2614: canGrabThrowable has been computed every frame since LUL-1623
    (forest-engine.js) with no render site until this row -- Q10 of the
    LUL-2612 checklist. Mutually exclusive with #throwPrompt by construction
    (lib/game/outcome.ts's canGrabThrowable already excludes heldThrowable). */}
<ActionPrompt
  id="pickupPrompt"
  visible={state.canGrabThrowable && !state.winVisible && !state.deathVisible}
  tone="calm"
  text="Press  E  to pick up the stone"
/>
```

### 5. Shop copy derives from tier (`:597-609`)

`shopEffectCopy()`'s trailing return (`:608`) is reached for every `id` not `deeperLungs`/
`quietStep`, including `pocketStones` at both `tier === 0` (pre-purchase, `cost != null`
branch, `:623-636`) and `tier === 1` (maxed, `cost == null` branch, `:619-622`) — it always
returns the same literal regardless of `tier`, so the maxed branch renders `Pocket Stones
maxed — no reserve stones` (`:621`) to a player who owns the reserve. Replace:

```tsx
// pocketStones: single tier, tier is always 0 here (cost==null branch handles tier 1)
return { current: 'no reserve stones', next: `+${POCKET_STONES_RESERVE} throwables/run` };
```

with:

```tsx
// pocketStones: single tier. Owned (tier > 0) must not say "no reserve stones" -- that
// branch is reached by the maxed UI (:619-622) exactly when the player owns it (LUL-2614).
return tier > 0
  ? { current: `+${POCKET_STONES_RESERVE} throwables/run`, next: `+${POCKET_STONES_RESERVE} throwables/run` }
  : { current: 'no reserve stones', next: `+${POCKET_STONES_RESERVE} throwables/run` };
```

Pre-purchase behaviour (`tier === 0`) is byte-identical to today — `e2e/embers-shop.spec.ts`'s
existing assertions on the pre-purchase button and on `#embersShopMaxed-pocketStones`
containing `'maxed'` (`:62`) are substring checks and keep passing unchanged.

## Verification

- `npx tsc --noEmit` — clean (new `EngineHudState` field must be assigned at every `pushState`
  call site and consumed in `INITIAL_STATE`, or this fails).
- `npm run lint` — clean.
- `npx playwright test embers-shop throwable-mission-hud action-prompt` — the three touched
  spec files plus their `e2e/mobile/` counterparts, green.
- `npm test` — unchanged unit count, still green (no `lib/` logic changed, only a rendering
  branch in a component and two `pushState` call sites carrying an existing value through).

## e2e

**Specs.**
- `e2e/embers-shop.spec.ts` — extend the existing `'Pocket Stones grants a throwablesReserve
  and auto-arms heldThrowable on enter()'` test (`:87-...`, already seeds `HIGH_BALANCE_EMBERS`,
  buys `pocketStones`, calls `enter()`, reads `qaProbeEmbersPurchase`) with a new assertion:
  after `enter()`, `#throwPrompt` is visible and contains `'(+1 in reserve)'` on desktop (2
  reserve − 1 auto-armed on `enter()` = 1 left, `POCKET_STONES_RESERVE = 2`,
  `lib/game/economy.ts:180`). Add a new test in the same `describe`: with `tiers: {}` (no
  purchase), `#throwPrompt`'s text after grabbing a stone (`qaGrabThrowable`) must NOT contain
  `'in reserve'` or `'(+'` — the base-case-unchanged guarantee from design note 3, made
  explicit rather than only implied by the untouched existing assertion.
  Also extend `'buying each catalog item...'` (`:32-66`) after the Pocket Stones purchase
  (`:58-63`): assert `#embersShopMaxed-pocketStones` now contains `'2 throwables/run'` (not
  just `'maxed'`) — the shop-copy fix itself (Q6/design note 5).
- `e2e/throwable-mission-hud.spec.ts` — new `test.describe('#pickupPrompt via
  qaTeleportNearThrowable()')`: `boot(qaHooks: true, qaWorld: 'micro')` → `enter()` →
  `expectRowHidden('pickupPrompt')` (nothing nearby yet) → `qaTeleportNearThrowable()`
  (existing hook, `forest-engine.d.ts:392`, leaves the stone un-grabbed unlike
  `qaGrabThrowable`) → `expectRowVisible('pickupPrompt')` and
  `.toContainText('pick up the stone')` → `qaGrabThrowable()` → `expectRowHidden('pickupPrompt')`
  and `expectRowVisible('throwPrompt')` (mutual exclusion, design note 4, asserted not just
  assumed).
- `e2e/action-prompt.spec.ts:280-291` (`'#actionSlot row order'`) — the DOM-order assertion at
  `:286` (`expect(ids).toEqual(['chargePrompt', 'objective', 'actionPrompt', 'throwPrompt',
  'status'])`) must become `['chargePrompt', 'objective', 'actionPrompt', 'throwPrompt',
  'pickupPrompt', 'status']` (six rows now, matching insertion order in design note 4) — this
  test WILL fail unmodified after the JSX change; updating it is part of this spec, not a
  follow-up.

**World.** micro throughout (`qaWorld: 'micro'`, all three files already use it or default to
it) — `qaTeleportNearThrowable`/`qaGrabThrowable` are seed-derived-position hooks that work in
the micro world already (existing usage in `throwable-mission-hud.spec.ts`), no `@fullmap`
case exists here.

**Hooks.** No new hooks. `qaGrabThrowable` (`forest-engine.js:5007`, `.d.ts:387`) and
`qaTeleportNearThrowable` (`:5023`, `.d.ts:392`) already reach every state this spec touches;
`qaProbeEmbersPurchase` (`:5073`, `.d.ts:411`) already exposes `throwablesReserve` for
assertions that need the raw number rather than the rendered string.

**Tester scenario.** File `shared/local-qa/requests/lul-2614-throwable-reserve-hud.md`: seed
high embers balance, buy Pocket Stones, start a run, throw once, confirm the on-screen pill
reads the reserve count both before and after the throw (screenshot each state) on desktop and
one landscape-mobile viewport. This is the first real-device check that the count is legible at
the HUD's actual rendered size/contrast — the e2e assertions above only prove the string is in
the DOM.

**Not covered.** Whether the parenthetical suffix is legible/uncluttered at a glance (subjective
readability) and whether "click to pick up" vs a different verb reads better — those are the QA
tester's/founder's call, not asserted here.

## Cues

**Visual.** `#throwPrompt`'s existing green `ready`-tone pill gains a parenthetical count
suffix (design note 3, `Hud.tsx:1078-1084`); `#pickupPrompt` is a new always-mounted
`calm`-tone row in `#actionSlot` (design note 4), invisible (not absent — `data-visible="0"`,
same convention as every other row) until `canGrabThrowable` is true. Neither is animated.
**Audio.** None new — grabbing/throwing already have their own audio (`leafRustle`, `:713`
ELEMENTS.md) unrelated to this change; the prompt text is a pre-existing UI convention with no
per-row sound.
**Explanation.** The prompt text itself is the explanation, same as every other `#actionSlot`
row (no separate caption system for these rows) — `Hud.tsx:1082`
(`#throwPrompt`)/this spec's new `#pickupPrompt` line.
**Reduced motion.** Static, no animation to reduce — `ActionPrompt`'s `reducedMotion` prop only
affects the `urgent` tone's key-flash (`components/ActionPrompt.tsx:56-60`); neither row uses
`tone="urgent"`.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Tier B still requires 1 approving Code Reviewer review before merge (see the correction at
  the top of this spec) — do not merge on green CI alone.
- No engine simulation logic changes. `throwablesReserve`'s value/lifecycle is unchanged —
  this spec only carries an already-correct value into `pushState` and renders it. Do not touch
  `:3767-3768` or `:5339`'s re-arm logic.
- `canGrabThrowable()` (`lib/game/outcome.ts:151-153`) is unchanged — do not add a `carrying`
  gate to it or to `#pickupPrompt`'s visibility (CTO plan decision 6: carry-leg is the intended
  beneficiary, already true today for grab/throw both).
- The `tier === 0` / `throwablesReserve === 0` paths in both `#throwPrompt` and
  `shopEffectCopy()` must render byte-identical strings to today — this is a strict
  no-regression requirement for every player who has never bought Pocket Stones, verified by
  the explicit e2e assertion in design note 3's spec bullet above (not just left to an
  untouched pre-existing test).

## Out of scope

- No projectile-count UI beyond the `(+N)` suffix (e.g. no icon row, no separate meter) —
  `#actionSlot`'s one-line-pill convention already covers it (Q2 of the LUL-2612 checklist).
- Does not touch `deeperLungs`/`quietStep` branches of `shopEffectCopy()` (`:598-606`) — both
  already correctly derive from `tier`.
- Does not add a dedicated mobile "Grab" button — the existing permanent on-screen `E`
  (`MobileControls.tsx:336`) already covers pickup on both platforms (design note 4).

## ELEMENTS.md

Update in the same PR (founder rule 2026-09-09):

- `docs/ELEMENTS.md:1120` — the slot-row table's `throwable` row gains
  `throwablesReserve`; add a new row `| pickup | canGrabThrowable | #pickupPrompt |`.
- `docs/ELEMENTS.md:1135` — the row-order list `(chargePrompt, objective, actionPrompt,
  throwPrompt, status)` becomes `(chargePrompt, objective, actionPrompt, throwPrompt,
  pickupPrompt, status)`; update "five rows" to "six rows" in the surrounding prose (`:1107`).
  Also update the file list at `:1142-1144` naming which specs use `expectRowVisible`/
  `expectRowHidden` if `throwable-mission-hud.spec.ts`'s new assertions are the first to
  exercise `pickupPrompt` there (they are).
- `docs/ELEMENTS.md:1474` — "reuses the existing single-held-stone state machine and HUD
  prompt verbatim, no new UI" is stale after this spec (there is new UI: the reserve suffix
  and `#pickupPrompt`). Replace with a line describing the count suffix and the new pickup row.
- `docs/ELEMENTS.md:728` ("Cannot be held two at once... one `heldThrowable` boolean, not a
  stack") stays accurate as written — the hand still holds exactly one at a time; the reserve
  is a separate re-arm count, not a second held stone. No edit needed there, noted so the
  implementer doesn't wonder.
