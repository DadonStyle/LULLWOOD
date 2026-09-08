# SPEC: RunRecap names the difficulty tier (cheap version)

**Ticket:** LUL-1306, accepting the ruling in `decisions/economy-horizon-2026-09-02`
(Branch A's "why come back" answer is difficulty-as-mastery — Player Psychologist,
LUL-1303, wiki `game/psychology/difficulty-as-mastery`). **Tier: B**
(`components/Hud.tsx` + one-line engine data plumbing, no simulation logic) — merge on
green, review lands after, per the 2026-08-29 development-first directive.

**Written against:** `release/next` @ `c9fa218` (2026-09-08). Re-derive every `file:line`
below from the branch you actually implement on if it has moved — the ticket's own cited
lines (`Hud.tsx:290-293`, `forest-engine.js:2729-2730`) have already drifted this far.

**Scope note (read before touching anything else):** `difficulty` is already a live,
correctly-threaded engine variable — `setDifficulty()` (`engine/forest-engine.js:3921-3935`)
sets it immediately and the difficulty picker in `GameMenu.tsx` is gated `!state.entered`
(`components/GameMenu.tsx:117`), so it cannot change while the win/death recap is on
screen. This spec still snapshots it explicitly into the win `pushState` call, matching
the existing pattern where `survivedSeconds`/`lastPayout` are also snapshotted there
rather than left as "whatever the live field happens to hold" — cheap, and it stops this
screen from silently depending on an incidental invariant elsewhere. Do not go looking for
a "real" bug in how `difficulty` is threaded; there isn't one.

## Files

Two files, both edits, no new files:
- `engine/forest-engine.js`
- `components/Hud.tsx`

## The change

### 1. `engine/forest-engine.js` — `arriveHome()`, the win `pushState` call

Currently (search for `logChronicle('win')`, a few lines above the call):

```js
  pushState({ objectiveVisible: false, statusVisible: false, winVisible: true, chargeVisible: false, survivedSeconds,
    lastPayout: payout, embersBalance: embers.balance, chronicle: chronicle.slice() });
```

Add `difficulty` (shorthand — the local variable of that name is already in scope in this
function; it's the same variable passed into `computeWinPayout(...)` two lines above):

```js
  pushState({ objectiveVisible: false, statusVisible: false, winVisible: true, chargeVisible: false, survivedSeconds,
    lastPayout: payout, embersBalance: embers.balance, chronicle: chronicle.slice(), difficulty });
```

No new `EngineHudState` field — `difficulty: 'lantern' | 'night' | 'blackout'` already
exists on the interface (`components/Hud.tsx`, in the `EngineHudState` interface, LUL-26)
and `pushState` is a shallow merge (`Object.assign`, see `engine/forest-engine.js:2916-2922`),
so this just makes the win snapshot self-contained instead of relying on the prior value.

Do not touch `triggerDeath()`'s `pushState` call — out of scope, see below.

### 2. `components/Hud.tsx` — `RunRecap` gets a `difficulty` prop

Current signature and body (search for `function RunRecap`):

```tsx
function RunRecap({ survivedSeconds, payout, balance, isDeath, chronicle }: { survivedSeconds: number; payout: RunPayout | null; balance: number; isDeath: boolean; chronicle: ChronicleEvent[] }) {
  const lines = formatChronicle(chronicle);
  return (
    <>
      <p id="runRecap">
        time survived: {formatDuration(survivedSeconds)}
```

Change to:

```tsx
function RunRecap({ survivedSeconds, payout, balance, isDeath, chronicle, difficulty }: { survivedSeconds: number; payout: RunPayout | null; balance: number; isDeath: boolean; chronicle: ChronicleEvent[]; difficulty: 'lantern' | 'night' | 'blackout' }) {
  const lines = formatChronicle(chronicle);
  const tierLabel = difficulty === 'lantern' ? 'Lantern' : difficulty === 'night' ? 'Night' : 'Blackout';
  return (
    <>
      <p id="runRecap">
        {tierLabel} · time survived: {formatDuration(survivedSeconds)}
```

Everything else in `RunRecap`'s body (the payout breakdown, the chronicle list) is
unchanged. `tierLabel`'s three-way ternary matches the existing display-label mapping
already duplicated once in `GameMenu.tsx` (`components/GameMenu.tsx`, inside the
`!state.entered` difficulty picker: `d === 'lantern' ? 'Lantern' : d === 'night' ? 'Night'
: 'Blackout'`) — do not introduce a shared constant/util for a two-call-site inline
ternary that already has a same-shape precedent in the codebase.

Punctuation: use `·` (matches this component's existing separator, e.g. `+{payout.depth}
depth · +{payout.survival} survival` a few lines below), not the `-` in the ticket's
illustrative example string — the ticket's "Blackout - time survived 1:16" was
illustrative, not a literal string to match.

### 3. `components/Hud.tsx` — both `RunRecap` call sites pass `difficulty`

Two call sites (search for `<RunRecap`), one in the win screen block, one in the death
screen block. Both currently end `chronicle={state.chronicle} />` — add `difficulty={state.difficulty}` before the closing `/>` on each:

```tsx
<RunRecap survivedSeconds={state.survivedSeconds} payout={state.lastPayout} balance={state.embersBalance} isDeath={false} chronicle={state.chronicle} difficulty={state.difficulty} />
```

```tsx
<RunRecap survivedSeconds={state.survivedSeconds} payout={state.lastPayout} balance={state.embersBalance} isDeath={true} chronicle={state.chronicle} difficulty={state.difficulty} />
```

Both sites read `state.difficulty`, not a new dedicated field — the death call site reads
the same always-live field (edit 1 above only changes what the *win* snapshot carries).
Passing it to both is a deliberate, minimal, declared addition beyond the ticket's literal
"win pushState" wording: `RunRecap` is one shared component and threading the prop through
only one of its two call sites would leave the type unsatisfiable at the other without an
ugly optional-prop branch. Showing the tier on a death recap too costs nothing and is not
a scope concern — flag it as a one-line declared deviation in the PR body, do not treat it
as something to ask about.

## Verification

From the repo root:

```bash
npx tsc --noEmit
```

Must be clean (no new errors). There is no dedicated `typecheck` npm script in this repo
— `tsc --noEmit` is run directly, per `AGENTS.md`'s Definition of Done.

No `next build` or `eslint` run is required by this spec beyond what CI already runs on
push (Tier B: merge on green, not a pre-merge gate you run locally beyond the type check
above) — but if you run them anyway and they're clean, that's fine too, just not required
before pushing.

No e2e spec references `runRecap` (`grep -rn runRecap e2e/` returns nothing as of
`c9fa218`), so this change has nothing existing to break there.

## Constraints

- Do not change `RunRecap`'s payout-breakdown or chronicle-list rendering — only the one
  line adding the tier label prefix.
- Do not add a new `EngineHudState` field, a persisted best-per-tier, or any localStorage
  write — explicitly out of scope (see ticket's "next increment" note).
- Do not touch `triggerDeath()`'s pushState shape.
- No `docs/ELEMENTS.md` update — this is a HUD text/display change, not a change to any
  element's verbs, collision, or interactions.
- No mobile-specific work needed and none of `EngineActions`/`Hud.tsx`'s touch-input glue
  changes — this is a passive text render with no input binding, and renders identically
  on both platforms. State that explicitly in the PR body (satisfies the "every change
  ships desktop and mobile" directive by explaining why there is no mobile half here,
  rather than leaving it unsaid).

## Out of scope

- Any change to the death-screen copy beyond passing the already-live `difficulty` prop
  through (see edit 3's note — the prop threading is in scope, further death-screen
  copywork is not).
- A per-tier best time/run in `PersistedEmbers` and a first-clear callout — ticket
  explicitly defers this to a follow-up ticket once this one lands.
- LUL-1304 (telemetry difficulty field) — a separate ticket touching the same call site;
  land independently, do not bundle into this branch.
