# SPEC: LUL-5897 scentLock avoid-commit floor in tickTimers()

**Ticket:** LUL-5897 (spec), implementing the fix for LUL-5863 (parent) / LUL-5859 cluster 3
· **Tier: C** — edits `lib/game/predator.ts` (engine simulation lib) and one call-site line
in `engine/forest-engine.js`; Tier C by path regardless of diff size. `REVIEW: APPROVED`
from Code Reviewer is required before merge.

**Written against:** `release/next` @ `007083e087c310b6db1079bf3def3d813b848307` (2026-10-06).
Re-derive every `file:line` below from the branch you actually implement on if it has moved
— line numbers were re-confirmed on a fresh clone for this spec, not copied from the PLAN
comment on LUL-5863.

**Implements:** the CTO's PLAN comment on LUL-5863 (2026-10-06, "PLAN (CTO engineering-how,
implementing wiki decisions/lul-5859-cluster3-lion-scentlock-avoidcommit-2026-10-06)"), itself
implementing CEO decision `decisions/lul-5859-cluster3-lion-scentlock-avoidcommit-2026-10-06`
on the wiki. This spec confirms that plan against current HEAD and firms up the exact diff
shape; it does not change the design.

## Root cause (confirmed against current HEAD)

- `lib/game/predator.ts:172-177` — `tickTimers()` decays `scentLock` unconditionally every
  tick, with no awareness of avoid-commit state:
  ```ts
  export function tickTimers(t: PredatorTickTimers, dt: number): PredatorTickTimers {
    return {
      scentLock: t.scentLock > 0 ? t.scentLock - dt : t.scentLock,
      chargeCooldown: t.chargeCooldown > 0 ? t.chargeCooldown - dt : t.chargeCooldown,
    };
  }
  ```
- `engine/forest-engine.js:2975-2976` — the one call site, inside the per-predator movement
  tick, called before `avoidDir()` runs later in the same tick:
  ```js
  const timers = tickTimers({ scentLock: p.scentLock, chargeCooldown: p.chargeCooldown }, dt);
  p.scentLock = timers.scentLock; p.chargeCooldown = timers.chargeCooldown;
  ```
- `lib/game/steer.ts:8,24-57` — `AVOID_COMMIT_TIME = 1.0` (seconds); `pickCommittedAvoidDirection()`
  holds `commitT > 0` for up to `AVOID_COMMIT_TIME / speedScaleMul` per commit cycle — up to
  ~5.0s simulated in the `qaWorld=micro` rig (`CONFIG.speedScaleMul`, LUL-5670/LUL-2422).
- `engine/forest-engine.js:2406-2409` (`avoidDir()` wrapper) called from `:3425` in the same
  movement loop, **after** `tickTimers()` runs each tick:
  ```js
  function avoidDir(p, dx, dz, dt, speedScaleMul){
    const r = pickCommittedAvoidDirection(p.commitDir, p.commitT, dt, p.x, p.z, p.moveRad, dx, dz, grid, coverGrid, CELL, undefined, undefined, WRAP_SPAN, speedScaleMul);
    p.commitDir = r.commitDir; p.commitT = r.commitT;
    return r.dir;
  }
  ```
  `p.commitT` is initialized at `:2199`, zeroed on state change at `:2971`
  (`if (p.state !== p.lastSteerState) { p.commitDir = null; p.commitT = 0; ... }`, which
  runs *before* `tickTimers()` at `:2975` in the same tick). So the `p.commitT` value
  `tickTimers()` would read at `:2975` reflects the live mid-commit state carried over from
  the end of the *previous* tick — exactly the signal to gate on; it is not stale by a whole
  tick in the way that would miss the first tick of a new commit.
- `engine/forest-engine.js:2664` (and the other chase-entry sites: `:2686`, `:5767`,
  `:6198`, `:6343`) — `p.scentLock = SCENT_TRACK_TIME * SCENT_LOCK_ENDURANCE_MULTIPLIER[p.kind]`.
  `SCENT_LOCK_ENDURANCE_MULTIPLIER.lion = 0.8` drops lion's budget to 6.4s, below one
  worst-case avoid-commit cycle (~5.0s) plus normal play margin — any species can hit this
  same timing collision with unlucky luck; lion at 0.8x just surfaces it first.
- Consumers of `scentLock` that currently do `scentLock <= 0` / `scentLock > 0` reads and
  must keep reading "locked" while the floor holds: `shouldGiveUpChase()`
  (`lib/game/predator.ts:93-94`), `shouldDowngradeChase()` (`:113-114`), the LUL-387
  blind-chase catch exemption (`engine/forest-engine.js:3235-3247`), the LUL-5402 close-in
  push (`:3337-3344`), and the Scent Veil trigger (`:8589`,
  `scentVeilTriggerActive(p.scentLock, ...)`). None of these need to change — they already
  read `scentLock`'s sign correctly; this spec just stops that sign from flipping mid-commit.

## Files

- `lib/game/predator.ts` — edited: new exported constant, `tickTimers()` gains a third
  optional parameter.
- `engine/forest-engine.js` — edited: one call-site line (`:2975`) passes the new argument.
- `lib/game/predator.test.ts` — edited: new unit tests for the floor behavior.

## The change

### `lib/game/predator.ts`

Add a named floor constant immediately above `tickTimers()`, and give the function a third
optional parameter. Replace lines 172-177:

```ts
// LUL-5897 (LUL-5859 cluster 3): scentLock must not cross to <=0 while a predator is
// mid avoid-commit (pickCommittedAvoidDirection, lib/game/steer.ts, p.commitT > 0) --
// doing so drops a chase to investigate mid-arc, and if a tree is still blocking
// canSee() at that moment the predator never resumes closing (the pre-LUL-1091 symptom).
// This only gates the *crossing*: once avoidCommitActive goes false again, unconditional
// decay resumes next tick exactly as before -- it defers expiry during the collision
// window, it does not disable expiry.
export const SCENT_LOCK_AVOID_COMMIT_FLOOR = 0.05; // seconds; just above zero so every
// scentLock>0 consumer (shouldDowngradeChase, shouldGiveUpChase, the LUL-5402 close-in
// push, the LUL-387 blind-chase catch exemption, the Scent Veil trigger) keeps reading
// "locked" instead of "expired" for one more tick.

export function tickTimers(
  t: PredatorTickTimers,
  dt: number,
  avoidCommitActive = false,
): PredatorTickTimers {
  const decayedScentLock = t.scentLock > 0 ? t.scentLock - dt : t.scentLock;
  const scentLock =
    avoidCommitActive && t.scentLock > 0 && decayedScentLock <= 0
      ? SCENT_LOCK_AVOID_COMMIT_FLOOR
      : decayedScentLock;
  return {
    scentLock,
    chargeCooldown: t.chargeCooldown > 0 ? t.chargeCooldown - dt : t.chargeCooldown,
  };
}
```

Notes for the implementer:
- `avoidCommitActive` defaults to `false` so every existing call path with only two
  arguments is byte-identical to today — this is the backward-compatibility contract the
  decision requires (it must not touch `chargeCooldown`, `pickAvoidDirection`/`slideVelocity`
  in `lib/game/cover.ts`, or `pickCommittedAvoidDirection` itself in `lib/game/steer.ts`).
- The floor only engages when `t.scentLock > 0` (it was genuinely locked entering this tick)
  **and** the unconditional decay would cross to `<= 0` this tick. If `scentLock` was already
  `<= 0` before this tick, the floor must not re-arm it — leave it exactly where
  `decayedScentLock` (== `t.scentLock`, unchanged) puts it.
- `chargeCooldown`'s line is untouched — the fix is scoped to `scentLock` only, per the
  decision and the PLAN.

### `engine/forest-engine.js`

Line `:2975`, add the third argument:

```js
    const timers = tickTimers({ scentLock: p.scentLock, chargeCooldown: p.chargeCooldown }, dt, p.commitT > 0);
```

No other line in this file changes. No new field is added to any predator object — `p.commitT`
already exists (`:2199`).

### `lib/game/predator.test.ts`

Add `SCENT_LOCK_AVOID_COMMIT_FLOOR` to the import block (alphabetical, alongside the other
`SNIFF_*`/`LKP_*` constants already imported from `./predator.ts`). Add these tests in the
`---- tickTimers ----` section, after the existing four tests (current lines 170-193) and
before the `---- stepSniffLoop ----` section:

```ts
test('tickTimers clamps scentLock to the avoid-commit floor instead of crossing to zero when avoidCommitActive', () => {
  const out = tickTimers({ scentLock: 0.5, chargeCooldown: 0.5 }, 1, true);
  assert.equal(out.scentLock, SCENT_LOCK_AVOID_COMMIT_FLOOR);
  assert.equal(out.chargeCooldown, -0.5); // chargeCooldown is unaffected by avoidCommitActive
});

test('tickTimers with avoidCommitActive does not re-arm a scentLock that was already at or below zero', () => {
  const out = tickTimers({ scentLock: 0, chargeCooldown: 3 }, 1, true);
  assert.equal(out.scentLock, 0); // not locked entering this tick -- nothing to protect
});

test('tickTimers with avoidCommitActive does not floor a decay that stays well above zero', () => {
  const out = tickTimers({ scentLock: 5, chargeCooldown: 3 }, 1, true);
  assert.equal(out.scentLock, 4); // floor only engages on the tick that would cross to <=0
});

test('tickTimers resumes unconditional decay once avoidCommitActive goes false again', () => {
  let timers = { scentLock: 0.5, chargeCooldown: 0 };
  timers = tickTimers(timers, 1, true);
  assert.equal(timers.scentLock, SCENT_LOCK_AVOID_COMMIT_FLOOR); // held at the floor mid-commit
  timers = tickTimers(timers, 1, false);
  assert.equal(timers.scentLock < 0, true); // commit ended -- decay resumes and crosses zero normally
});

test('tickTimers omitting avoidCommitActive is byte-identical to passing false (default param, regression guard)', () => {
  const withDefault = tickTimers({ scentLock: 0.5, chargeCooldown: 0.5 }, 1);
  const explicitFalse = tickTimers({ scentLock: 0.5, chargeCooldown: 0.5 }, 1, false);
  assert.deepEqual(withDefault, explicitFalse);
});
```

The four pre-existing `tickTimers` tests (lines 170-193, including the "can cross zero in a
single call (no clamping to zero)" test at 180-183) must stay green unchanged — they call
`tickTimers()` with only two arguments, so `avoidCommitActive` defaults to `false` and the
assertions still hold exactly.

## Verification

- `cd lul-lullwood && npx tsc --noEmit` — clean.
- `node --test lib/game/predator.test.ts` (or the repo's normal unit-test runner) — all
  existing tests plus the five new ones pass.
- `lib/game/cover.test.ts` (LUL-1091a/b/d) — must stay green unchanged; this spec does not
  touch `lib/game/cover.ts`.
- `npx eslint .` — clean.
- `next build` — clean.

## e2e

**Specs.** `e2e/tree-pathing.spec.ts` — inside
`test.describe('predator behind a tree reaches the player (LUL-1091 regression, qaWorld=micro)')`,
the parametrized test titled `` `${kind}: staged directly behind a tree trunk, closes to
contact range` `` for `kind='lion'` (must pass unchanged, no margin/MAX_STEPS changes — per
the CEO's decision this is the acceptance signal for the fix, not a re-measurement target).
The other `kind` values in the same parametrized test (wolf, bear) must also stay green —
regression guard, since the fix is general-purpose, not lion-specific.
**World.** micro (existing fixture in the spec file already stages the tree/lion; no new
`qaBuildScene` props needed).
**Hooks.** None new. Nothing new is exposed on `window.ForestEngine` — `p.commitT` is
read internally by the engine, not surfaced to QA hooks, and this fix changes no hook-visible
contract.
**Tester scenario.** Covered by the existing nightly e2e suite run (`e2e/tree-pathing.spec.ts`
already executes every night); no new `shared/local-qa/requests/` file needed — this is not
a new player-visible scenario, it is a regression fix for an existing covered one.
**Not covered.** Feel/difficulty — whether a 6.4s lion scentLock budget with this floor still
plays as intended is the Game Economist's tuning call when unpaused (LUL-5787's own
"placeholder ratios" note), not something this spec's test plan can assert.

## Cues

Not applicable — this is an internal timing-logic bug fix with no new player-visible state,
no new render/HUD/audio/caption, and no change to any existing cue's trigger condition.
Nothing in section A of `docs/FEATURE_CHECKLIST.md` applies.

## Constraints

- Must not change `tickTimers()`'s output for any existing two-argument call
  (`avoidCommitActive` defaults to `false`) — this is the regression guard for the
  "unconditional, every state" contract documented at `lib/game/predator.ts:159-167`.
- Must not touch `SCENT_LOCK_ENDURANCE_MULTIPLIER` (`engine/forest-engine.js`) — the
  Economist's placeholder ratio stays as-is per the decision.
- Must not touch `pickAvoidDirection()`/`slideVelocity()` (`lib/game/cover.ts`) or
  `pickCommittedAvoidDirection()` (`lib/game/steer.ts`) — both stay read-only per the
  decision; this fix only changes what `tickTimers()` does with the `commitT > 0` signal
  it is handed.
- Must not touch `chargeCooldown`'s decay.
- Tier C: `REVIEW: APPROVED` from Code Reviewer required before merge.

## Out of scope

- Re-measuring or loosening `e2e/tree-pathing.spec.ts`'s margins (`MAX_STEPS=200`, standoff
  math) — explicitly rejected by the decision (option (a)); the test passing unchanged is
  the acceptance signal.
- Retuning `SCENT_LOCK_ENDURANCE_MULTIPLIER` — explicitly rejected by the decision
  (option (b)); that ratio is the Game Economist's call once unpaused.
- Any change to `lib/game/cover.ts` or `lib/game/steer.ts` — both are read-only inputs to
  this fix, not touched by it.
- A `qa*` hook for `commitT` or the floor — nothing new needs to be exposed to
  `window.ForestEngine`; the existing e2e scenario drives this through the real chase/avoid
  path, not a hook.
