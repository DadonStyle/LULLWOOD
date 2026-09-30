# LUL-5447: Roost Recovery Evasion

**Ticket:** LUL-5447 (implementation) / LUL-5446 (Feature Scout follow-on proposal) ·
**Tier:** C — touches `engine/forest-engine.js` (flush/reposition/cooldown-completion
wiring). Needs `REVIEW: APPROVED` before merge. See wiki
`game/mechanics/roost-recovery-evasion` and
`decisions/lul-5446-roost-recovery-evasion-accepted-2026-09-30`.

**Written against:** `release/next` @ `b7e3f2d` (2026-09-30).

## Files

- `lib/game/mission.ts` — edited: new `'roostRecoveryEvasion'` `MissionKind`, new
  `MISSION_POOL` entry (`lionRoostFlush`'s non-spatial roost-target shape verbatim), and the
  `eligibleMissionPool()` exclusion list.
- `lib/game/economy.ts` — edited: `MISSION_ROOST_RECOVERY_EVASION_REWARD` (9, placeholder,
  same tier as `flush`/`upwindRefuge`), added to `MISSION_REWARDS`.
- `lib/game/economy.test.ts` — edited: exhaustive `MISSION_REWARDS` key list + value assertion.
- `lib/game/mission.test.ts` — edited: `MISSION_POOL` shape test + `eligibleMissionPool`
  include/exclude tests, mirroring `lionRoostFlush`'s own.
- `components/Hud.tsx` — edited: `MISSION_NAMES.roostRecoveryEvasion = 'Roost Recovery
  Evasion'`.
- `e2e/helpers.ts` — edited: `qaMissionKind` union extended.
- `engine/forest-engine.js` — edited:
  - `generateMap()`'s post-`placeCave()` roost-index draw guard extended to this kind.
  - `repositionBeaconHunterForMission()`'s guard, lion-lookup branch, and roost-anchor branch
    all extended to this kind (identical to `lionRoostFlush`'s own three checks).
  - `flushRoost(i)` pushes the mission's caption when the flushed roost is this mission's own
    `roostIndex` and the mission is active.
  - `updateRoosts()`'s cooldown-decrement branch calls `completeMission()` the instant
    `roostCooldown[i]` reaches 0 while this mission is active and marked to that roost.
- `e2e/roost-recovery-evasion-mission.spec.ts` — new.
- `docs/ELEMENTS.md` — edited: new mission-kind entry alongside `lionRoostFlush`/`upwindRefuge`.

## The change

Reuses `lionRoostFlush`'s (LUL-5426) exact composition: a non-spatial `MISSION_POOL` entry
(`{ kind: 'roostRecoveryEvasion', x: 0, z: 0, zoneRadius: 0, interactRadius: 0, spatial: false,
roostIndex: 0 }`) resolved to a real `ROOSTS` index at `generateMap()` time, with a lion
repositioned ~50u from that roost by `repositionBeaconHunterForMission()`. The only new
behaviour is completion: instead of reusing `canCompleteFlush()` (a fresh roost-throw), this
kind completes automatically once the cooldown the mission's own flush started counts down to
zero.

`engine/forest-engine.js`'s `updateRoosts()` cooldown branch:

```js
if(nearWhileRunning && !roostSprintDeniedPlayed[i]) roostFlushDeniedCue();
roostSprintDeniedPlayed[i] = nearWhileRunning ? 1 : 0;
roostCooldown[i] -= dt;
if(roostCooldown[i] <= 0 && mission && mission.status === 'active'
   && mission.target.kind === 'roostRecoveryEvasion' && mission.target.roostIndex === i){
  mission = completeMission(mission);
}
continue;
```

`flushRoost(i)` (unchanged signature) gains a trailing conditional caption push, gated so it
only fires for this mission's own roost and only while the mission is active — every other
flush path (ambient predator-triggered, `beaconRoostFlush`, `lionRoostFlush`, a plain player
throw at an unmarked roost) stays silent, unchanged from before this ticket.

## Verification

- `npx tsc --noEmit` — only the pre-existing `app/layout.tsx` `LayoutProps` baseline error.
- `npx eslint .` — clean.
- `npm test` (`node --test --experimental-test-module-mocks`) — all mission/economy tests
  green; the 5-6 pre-existing failures in `app/api/**`/`lib/dashboard`/`lib/suggestions` blob
  tests are baseline, reproduced identically on `release/next` with none of this diff applied.
- `node scripts/check-elements-citations.mjs` — clean (0 new bad citations).
- `node --test lib/e2e-policy/world-policy.test.ts` — clean.
- `npx playwright test e2e/roost-recovery-evasion-mission.spec.ts` — see e2e section.

## e2e

**Specs.** `e2e/roost-recovery-evasion-mission.spec.ts` (new) —
'spawns with a repositioned lion after a lion-present flush and completes when the roost
cooldown expires' and 'does not spawn a repositioned lion or mission progress for an unmarked
roost'.

**World.** micro (default) — `qaBuildScene({ predators: [{ kind: 'lion', x: 0, z: -8, state:
'roam' }] })`, mirroring `e2e/lion-roost-flush-mission.spec.ts`'s own staging. Not `@fullmap`:
the roost-target shape is non-spatial (`spatial: false`), same reasoning every other roost
mission spec already relies on.

**Hooks.** All existing, no new hooks added: `qaBuildScene`, `qaProbeMission`,
`qaPredatorState`, `qaTeleportNearThrowable`, `qaTeleportNearRoost`, `qaProbeRoostState`,
`qaSetFixedStep`, `qaAdvance`.

**Tester scenario.** `shared/local-qa/requests/lul-5447-roost-recovery-evasion.md` (this
ticket) — nightly check does not otherwise cover a lion-present flush → cooldown-expiry
mission completion loop.

**Not covered.** Audible tone/caption legibility feel — same manual-check precedent as
LUL-5412/LUL-5442's own roost-cue requests.

## Cues

**Visual.** `#roostCooldownPanel` (existing, LUL-5412) and `#missionTimerSeconds` (existing,
`components/Hud.tsx`) — both already-live surfaces, no new render code.

**Audio.** None new — the existing roost-flush burst sound (`roostFlushSound()`,
`engine/forest-engine.js`) already plays on the flush that starts this mission's timer.

**Explanation.** `'the roost is cooling — hold upwind until it resets'`, pushed once from
`flushRoost(i)` (`engine/forest-engine.js`, `function flushRoost`) the moment this mission's
own roost is flushed, gated on `captionsOn`.

**Reduced motion.** N/A — no animated visual cue introduced; `#roostCooldownPanel`'s countdown
text is static regardless of `reducedMotion`.

## Constraints

No new engine state, no new HUD surface, no new input/keybind (per the wiki proposal's own
"cheap slice" scope). `canCompleteFlush()` is intentionally left untouched — this kind never
completes through it.

## Out of scope

Balancing/tuning the reward number (`MISSION_ROOST_RECOVERY_EVASION_REWARD` is a placeholder
pending Game Economist confirmation, same convention as every other provisional mission
reward in `lib/game/economy.ts`). Any UI treatment beyond the existing roost-cooldown/mission
panels.
