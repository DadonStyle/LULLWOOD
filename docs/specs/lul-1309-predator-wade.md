# SPEC: Predators wade -- bog/lake speed multipliers apply to predators too

**Ticket:** LUL-1309. **Tier: C**, not the B the ticket states -- correcting that here (see
"Tier correction" below). Touches `engine/forest-engine.js` predator movement/AI directly, which
the risk-tier policy lists explicitly under Tier C ("movement, collision, predator AI ... ").
Requires `REVIEW: APPROVED` before merge; do not merge on green CI alone.

**Citations verified directly against the checked-out tree** (`_default`, branch
`lul-1644-time-of-day-impl`, 2026-09-06) -- the ticket's own line numbers (`:1334/:1340/:1399/
:1428/:1443/:1468`) have drifted from intervening commits (LUL-437 sniff-immunity comments,
LUL-562 investigate/chase livelock fix, LUL-213 charge, etc.). Re-derived below; use these, not
the ticket's.

## Background

`engine/forest-engine.js:3210-3225` computes the player's terrain state once per frame
(`playerInBog`, `playerInLake`) and folds `bogSpeedMultiplier()` / `lakeSpeedMultiplier()`
(both from `lib/game/bog.ts` / `lib/game/lake.ts`, both return `0.5` when `true`, `1` otherwise)
into `maxSpd`. Predators never do this -- their `speed` variable is always some multiple of
`p.spec.speed` with no terrain term, so water only punishes the player. This contradicts
`lib/game/lake.ts`'s stated design intent (comment: "risk the slow crossing, or go around" --
that only holds if predators pay the same cost).

Ruled 2026-09-02, `decisions/scout-queue-2026-09-02`: accept item 1 only of LUL-1293 (Feature
Scout, `game/mechanics/forest-grain`). Items 2-3 (thickets/glades) are explicitly out of scope
for this ticket.

## Files

- `engine/forest-engine.js` -- only file touched.

## The change

All six sites live inside `updatePredators(dt, noiseRadius)` (starts `engine/forest-engine.js:
1307`). `inBog(x, z)` (defined `:189`, wraps `isInBog` from `lib/game/bog.ts`, already imported
`:70`) and `inLakeWater(x, z, lakeConfig)` (imported directly `:104` from `lib/game/lake.ts`) are
both pure position-based helpers already used for the player at `:3210`/`:3219` -- reuse them
unchanged for a predator's own `(p.x, p.z)`, the same "sample at the entity's own position"
pattern already ruled for fog-tide sampling in `specs/bigger-wrapping-world-e2-e6` (D2). Do not
invent new helpers or touch `lib/game/bog.ts` / `lib/game/lake.ts` -- both are already
unit-tested (`bog.test.ts`, `lake.test.ts`) and unchanged by this spec.

**1. Add one const inside the per-predator loop**, immediately after the existing
`const ux = dx/dist, uz = dz/dist;` line (`engine/forest-engine.js:1313`):

```js
    const ux = dx/dist, uz = dz/dist;
    // LUL-1309: predators wade too -- same per-position terrain sample the
    // player already gets at :3210/:3219, applied to this predator's own (x,z).
    const pTerrainMul = bogSpeedMultiplier(inBog(p.x, p.z)) * lakeSpeedMultiplier(inLakeWater(p.x, p.z, CONFIG.lake));
    let desx = 0, desz = 0, speed = 0, facePlayer = false;
```

**2. Multiply `pTerrainMul` into exactly these six existing assignments** (line numbers as of
this spec's base commit; re-verify before editing if the branch has moved):

| Line | State | Before | After |
|---|---|---|---|
| `:1365` | `reroute` | `speed=p.spec.speed*0.7;` | `speed=p.spec.speed*0.7*pTerrainMul;` |
| `:1371` | `hunt` | `speed=p.spec.speed;` | `speed=p.spec.speed*pTerrainMul;` |
| `:1430` | `chase` | `speed=p.spec.speed;` | `speed=p.spec.speed*pTerrainMul;` |
| `:1459` | `investigate/approach` | `stepApproach(ux, uz, p.spec.speed, dist, p.rad)` | `stepApproach(ux, uz, p.spec.speed*pTerrainMul, dist, p.rad)` |
| `:1474` | `investigate/back` | `speed=p.spec.speed*0.5;` | `speed=p.spec.speed*0.5*pTerrainMul;` |
| `:1499` | `flank` | `speed=p.spec.speed*FLANK_SPEED_MUL;` | `speed=p.spec.speed*FLANK_SPEED_MUL*pTerrainMul;` |

`stepApproach` (`lib/game/predator.ts:225`) does `speciesSpeed * 0.45` internally and returns it
as `step.speed`, which the caller assigns straight to `speed` -- scaling its `speciesSpeed`
input by `pTerrainMul` is algebraically identical to scaling the output, no behavior change
beyond the intended terrain slow.

## Explicitly out of scope

- The `charge` state (`p.charge`, lines ~1330-1357, uses `chargeSpeed(cs.distance)`) and the
  `alert` freeze (speed already `0`). The ticket's six cited call sites are roam/chase/
  investigate/flank movement only, not the charge dash -- do not add a seventh site. If someone
  later wants charges slowed by water too, that is a separate ticket with its own balance
  question (a telegraphed charge is supposed to be a committed, dodgeable line; slowing it
  wasn't analyzed here).
- `updateWolfPack()` (`:1275`) only sets flank targets/state, never speed -- nothing to change
  there.
- No new constant, no change to `generateMap()`, no rng/determinism impact. QA's pinned seed
  (`CONFIG.seed = 20260718`) is untouched.
- `lib/game/bog.ts`, `lib/game/lake.ts` -- unchanged, already covered by their own unit tests.
- Items 2-3 of LUL-1293 (thickets/glades) -- not this ticket.

## Mobile

No input, UI, or control-scheme surface -- this is a pure simulation-speed change that applies
identically regardless of platform. No touch affordance needed; nothing to add to `EngineActions`
or `Hud.tsx`. State this one-line in the PR body per the desktop+mobile directive: "No mobile
surface -- predator movement math only, same on both platforms."

## Verification

- `tsc --noEmit` clean (repo has no type errors introduced -- `forest-engine.js` is plain JS, so
  this mainly checks nothing else broke).
- `npx eslint engine/forest-engine.js` clean.
- `npx vitest run lib/game/bog.test.ts lib/game/lake.test.ts` (or the repo's actual test runner
  command -- check `package.json`'s `test` script) still passes unchanged -- these test the pure
  multiplier functions, which this spec does not modify, so they should be unaffected; run them
  anyway to confirm no accidental edit to `bog.ts`/`lake.ts`.
- `next build` passes.
- Manual/gameplay read (unverified by the coding agent, per studio convention -- Game Tester or
  founder confirms): a predator that walks into the bog or lake should visibly slow down the same
  way the player does when crossing the same terrain. Coding agent should state explicitly in the
  handoff that this is unverified in-browser.
- Update `docs/ELEMENTS.md` if this diff changes any element's described verbs/interactions --
  likely a one-line addition to the bog/lake rows noting predators are now slowed too, since the
  registry currently only documents the player-facing effect. Check `game/elements-registry`
  wiki page's citations before editing so line-number citations there don't drift (per the CI
  guard `scripts/check-elements-citations.mjs`).

## Constraints

- Pure numeric multiply on an existing `speed`/`speciesSpeed` value -- no new state, no new
  fields on `p`, no change to any function signature except the one `stepApproach` call-site
  argument (the function itself is untouched).
- Do not refactor the six branches into a shared helper or restructure the `if/else if` chain --
  out of scope, and this file's existing comments (LUL-562, LUL-213, LUL-437) document fragile
  ordering/timing invariants between these branches that a restructure risks disturbing.
