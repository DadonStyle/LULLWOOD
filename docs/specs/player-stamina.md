# SPEC: Player stamina

**Ticket:** LUL-1144 (blocker for LUL-1113) · **Tier: C** — `engine/forest-engine.js`
movement simulation. Blocking review (`REVIEW: APPROVED`) + a Game Tester play verdict
are both required before merge, per the severity rubric. The spec author (me) confirms
Tier C explicitly here, per the spec-architecture directive.

**Written against:** `release/next` @ `332ed8704cabefed986658941dab07882d14ef83`.
Re-derive every `file:line` below from the branch you actually implement on if it has
moved — do not copy citations forward. PR #250 (`lul-1104-predator-determinism`, open
against `release/next`, base `mergeable`) is a 5-line diff seeding predator RNG; it does
not touch the movement block cited here, so these lines should survive it, but check.

## Open sequencing question — read before scheduling implementation

[[decisions/missions-accepted-2026-09-01]] (§4, "M2 first") argues for sending players
through the bog (M2 Deepwater) to learn whether a slower Lullwood plays better **before**
anyone builds a stamina bar, since the bog already makes LUL-1113's out-sprint problem
false without one. That page predates this spec being reassigned to me today
(VP R&D comment on LUL-1144, 2026-09-01T17:08Z), which called this "the highest-value spec
on the board" and gave no indication the sequencing note should hold it. I am not
resolving that tension — it is a scheduling call, not a spec question. This document makes
the design ready to implement; whether it lands before or after M2 Deepwater's data is the
board's decision, not mine to make silently. Declaring it here per the "deviations from a
recorded decision" rule.

## Problem (verified in LUL-1113, restated for the executor)

`engine/forest-engine.js:153` — `CONFIG.walk = 6`. `engine/forest-engine.js:2996` —
`maxSpd = (running ? walk*1.8 : walk) * ...`, i.e. player sprint is a flat 10.8 units/s,
**held indefinitely** (no fatigue anywhere in the code). Wolf 8.5, bear 6.8, lion 9.2
(`:941-943`). A sprinting player already outruns all three on a flat chase; nothing in the
sim currently punishes sustained sprinting. Founder's explicit direction: fix this by
slowing the player, not speeding up predators.

## Design

One search on genre precedent (LUL-215): survival-horror stamina/sprint meters
(TVTropes "Sprint Meter"; https://tvtropes.org/pmwiki/pmwiki.php/Main/SprintMeter) converge
on two points worth taking directly — (1) the meter should drain fast enough that
full-sprint flight is a short-lived option, not a permanent one, and (2) the classic
tension beat is a player who panics, empties the bar, and is caught still exposed. The one
idea taken: don't gate sprint with a hard on/off lock (the way this codebase's own
`veil.ts` gates the mist veil) — instead let sprint speed **decay continuously toward walk
speed** as stamina drains, so a low-stamina player is never fully stopped, just
progressively slower and more exposed, which is exactly the "more exposed to a charge, not
less" framing LUL-1113 already specified.

This also means stamina needs no lock/unlock state machine like `veil.ts`'s
`locked`/`VEIL_UNLOCK_CHARGE` — it's a single continuous multiplier, simpler than the veil
resource it sits next to.

## Files

### 1. `lib/game/stamina.ts` — new file

Pure module, no Three.js/DOM dependency, following the existing pattern in
`lib/game/veil.ts:1-47` (`stepVeilCharge`) exactly — same shape, same reason (unit-testable
without a render loop; see wiki `systems/unit-testing-standard`).

```ts
export interface StaminaState {
  /** 1 = full, 0 = fully drained. */
  charge: number;
}

// Seconds of continuous sprinting to fully drain from full charge.
export const STAMINA_DRAIN_TIME = 6;
// Regen rate vs. drain rate -- refill is slower than spend, same asymmetry as
// VEIL_REGEN_MUL (lib/game/veil.ts:27) and for the same reason: a resource that
// refills as fast as it drains isn't a real cost.
export const STAMINA_REGEN_MUL = 0.4;
// Sprint multiplier at full charge -- matches the existing hardcoded literal at
// engine/forest-engine.js:2996 (walk*1.8). This module becomes the single source
// of truth for it; the engine call site below stops hardcoding 1.8.
export const STAMINA_SPRINT_MUL = 1.8;

/** Advances the charge by one frame. `sprinting` is the engine's existing
 * `running` flag (true whenever the sprint control is held/toggled-on),
 * regardless of whether the player is actually moving this frame -- same
 * "held is held" framing as stepVeilCharge, not gated on movement. */
export function stepStamina(state: StaminaState, sprinting: boolean, dt: number): StaminaState {
  let { charge } = state;
  if (sprinting) {
    charge = Math.max(0, charge - dt / STAMINA_DRAIN_TIME);
  } else {
    charge = Math.min(1, charge + (dt / STAMINA_DRAIN_TIME) * STAMINA_REGEN_MUL);
  }
  return { charge };
}

/** Sprint speed multiplier for the current charge: STAMINA_SPRINT_MUL at charge=1,
 * decaying linearly to 1 (walk speed, no bonus) at charge=0. Never below 1 --
 * a drained player still moves at walk speed, never slower than walking. */
export function sprintSpeedMul(charge: number): number {
  return 1 + (STAMINA_SPRINT_MUL - 1) * charge;
}
```

### 2. `lib/game/stamina.test.ts` — new file

Same `node:test` + `assert/strict` shape as `lib/game/veil.test.ts:1-11`. Required cases:

- full-charge sprint for 1s drains by exactly `1/STAMINA_DRAIN_TIME` (mirror
  `veil.test.ts`'s first test, substituting `stepStamina`/`STAMINA_DRAIN_TIME`).
- charge clamps at 0 for a sprint duration far exceeding `STAMINA_DRAIN_TIME` (mirror
  `veil.test.ts`'s over-drain clamp test).
- releasing sprint regenerates charge at `STAMINA_REGEN_MUL` of the drain rate.
- charge clamps at 1 for a regen duration far exceeding what's needed to refill.
- `sprintSpeedMul(1) === STAMINA_SPRINT_MUL`.
- `sprintSpeedMul(0) === 1`.
- `sprintSpeedMul(0.5)` is the linear midpoint between 1 and `STAMINA_SPRINT_MUL`.

### 3. `engine/forest-engine.js` — edit

**Import** (alongside the existing veil import at `:89`):

```js
import { stepStamina, sprintSpeedMul } from '@/lib/game/stamina';
```

**State declaration** — add next to the existing veil resource declaration at `:316`
(same category: a per-run mutable resource, not reset on `restart()` — see below):

```js
let veilCharge = 1, veilLocked = false, veilAmount = 0, staminaCharge = 1;
```

**Tick update** — in the movement block starting `:2994` (`if(playing && !hidden){`), the
`running` flag is computed at `:2995` before `maxSpd` is computed at `:2996`. Insert the
stamina update between those two lines, and change `:2996`'s sprint term from the
hardcoded `walk*1.8` to `walk*sprintSpeedMul(staminaCharge)`:

```js
    running = runMode === 'toggle' ? (toggleRunOn || touchSprint) : (keys['ShiftLeft'] || keys['ShiftRight'] || touchSprint);
    staminaCharge = stepStamina({ charge: staminaCharge }, running, dt).charge;
    const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerInBog) * lakeSpeedMultiplier(playerInLake);
```

Note this update must run every frame `playing && !hidden` is true (so stamina still
regenerates while the player is stationary or hiding is false but not moving), exactly the
same gating the `running` flag itself already has — do not additionally gate it on
movement magnitude (`mag > 0`, computed later in the same block).

**HUD state emit** — `:2959` already does `pushState({ veilCharge: ..., veilLocked })`
every tick. Add `staminaCharge` to that same call:

```js
  pushState({ veilCharge: Math.round(veilCharge * 100) / 100, veilLocked, staminaCharge: Math.round(staminaCharge * 100) / 100 });
```

**No reset on `restart()` (`:2726-2740`).** `veilCharge` is never reset there either — it
carries across runs as a module-level `let`. Match that precedent exactly; do not add
reset code for `staminaCharge`. This is a deliberate parity call, not an oversight to fix
in the same diff — if it turns out to feel wrong (e.g. a player restarting mid-sprint with
near-zero stamina), that's a separate ticket against both resources, not this one.

### 4. `components/Hud.tsx` — edit

**`EngineHudState` interface** (`:55-94`) — add one field next to `veilCharge`/`veilLocked`
(`:77-78`):

```ts
  staminaCharge: number;
```

**`INITIAL_HUD_STATE`** (`:132-160`) — add next to `veilCharge: 1` (`:148`):

```ts
  staminaCharge: 1,
```

**Readout** — add next to the existing `#veilState` span (`:349-351`), same minimal
text-only style, no new bar widget:

```tsx
        <span id="staminaState">
          Stamina: {Math.round(state.staminaCharge * 100)}%
        </span>
```

No `(recharging)`/locked suffix — unlike veil, stamina has no lock state, so the percentage
alone is the whole readout.

No `engine/forest-engine.d.ts` change is needed. It imports `EngineHudState` from
`@/components/Hud` (`engine/forest-engine.d.ts:8`) rather than redeclaring the state shape,
so editing file 4 above is the only type-level change required. Confirmed by reading the
file: it has no `veilCharge`/`veilLocked` fields of its own to mirror.

## Mobile

No new mobile action needed. Sprint is already wired for touch: `touchSprint`
(`engine/forest-engine.js:1690`) and `setTouchSprint` (`:3308`) feed the same `running`
flag this spec reads at `:2995`, so mobile and desktop drain/regen identically with zero
additional plumbing. The new `#staminaState` span sits in the same HUD block as the
existing `#veilState`/`#lightState` spans, which are already safe-area-aware — no new
mobile layout work. State this in the PR body per the mobile-parity directive: "mobile
parity is automatic — stamina reads the same `running` flag both control schemes already
drive."

## Verification

```
cd <repo> && npm run test 2>&1 | grep -A2 stamina
```

Passing looks like: all `lib/game/stamina.test.ts` cases green, no failures. Then:

```
npx tsc --noEmit && npm run lint
```

Both clean. `next build` must also pass. No console errors on load is tester-confirmed,
not asserted here — this diff has no new DOM elements beyond the one `<span>`, which
cannot itself throw.

Gameplay/feel (does the chase actually resolve, does stamina regen rate feel fair) is
**unverified by this spec and by whoever implements it** — Tier C requires a Game Tester
play verdict before merge per the rubric. Builds clean and unit tests passing is not the
same claim as "the chase feels right."

## Constraints

- `STAMINA_SPRINT_MUL` must equal the current hardcoded `1.8` at
  `engine/forest-engine.js:2996` — this spec is a refactor-plus-decay, not a value change.
  If a future ticket wants a different max sprint multiplier, that's a separate tuning
  ticket.
- Do not touch `CONFIG.walk`, `CONFIG.carryPaceMul`, `bogSpeedMultiplier`,
  `lakeSpeedMultiplier`, or anything in `lib/game/charge.ts` — none of them are in scope.
- Do not add a lock/unlock state machine. Continuous decay only, per the Design section.
- Do not gate the stamina update on movement (`mag > 0`). It reads `running` only.
- `sprintSpeedMul` must never return less than 1 (walk speed is the floor, not a further
  slowdown) — covered by the required unit test.

## Out of scope

- Any change to predator speed, charge trigger bands, or AI awareness of player stamina.
  Predators have no visibility into `staminaCharge` in this spec and none should be added.
- A stamina reset on death/restart (see the `veilCharge`-parity note above).
- Any UI beyond the one text readout — no bar, no color states, no low-stamina warning
  sound/vignette. If playtesting wants one, that's a follow-up ticket informed by the play
  verdict, not a pre-emptive addition here.
- Tying stamina to Embers, missions, or any other system named in
  [[decisions/missions-accepted-2026-09-01]] — this spec is the standalone mechanic LUL-1113
  asked for, not a missions integration.
- The M2 Deepwater bog mission itself (separate ticket, separate spec, already scheduled
  per the missions decision).
