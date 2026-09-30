# LUL-5465: Beacon Roost Recovery Evasion

**Ticket:** LUL-5465 (implementation) / LUL-5455 (Feature Scout proposal) ·
**Tier:** C — touches `engine/forest-engine.js` (flush/reposition/cooldown-completion
wiring). Needs `REVIEW: APPROVED` before merge. See wiki
`game/mechanics/beacon-roost-recovery-evasion` and
`decisions/lul-5455-beacon-roost-recovery-evasion-accepted-2026-09-30`.

**Written against:** `release/next` @ `08b8f18` (2026-09-30).

## Files

- `lib/game/mission.ts` — edited: new `'beaconRoostRecoveryEvasion'` `MissionKind`, new
  `MISSION_POOL` entry (`roostRecoveryEvasion`'s non-spatial roost-target shape verbatim), and
  the `eligibleMissionPool()` exclusion list.
- `lib/game/economy.ts` — edited: `MISSION_BEACON_ROOST_RECOVERY_EVASION_REWARD` (9,
  placeholder pending Economist pricing, same tier as `flush`/`roostRecoveryEvasion`), added to
  `MISSION_REWARDS`.
- `lib/game/economy.test.ts` — edited: exhaustive `MISSION_REWARDS` key list + value assertion.
- `lib/game/mission.test.ts` — edited: `MISSION_POOL` shape test, `canCompleteFlush` exclusion
  test, `eligibleMissionPool` include/exclude tests, mirroring `roostRecoveryEvasion`'s own.
- `components/Hud.tsx` — edited: `MISSION_NAMES.beaconRoostRecoveryEvasion = 'Beacon Roost
  Recovery'`.
- `e2e/helpers.ts` — edited: `qaMissionKind` union extended.
- `engine/forest-engine.js` — edited:
  - `generateMap()`'s post-`placeCave()` roost-index draw guard extended to this kind.
  - `repositionBeaconHunterForMission()`'s top guard and roost-anchor branch extended to this
    kind. The predator-lookup branch is **not** extended — this kind deliberately falls through
    to the existing default (`predators.find(p => p.variant === 'beaconHunter')`,
    `beaconRoostFlush`'s own lookup), so it repositions the Beacon Hunter wolf, not a lion.
  - `flushRoost(i)` pushes a second, Beacon-Hunter-worded caption when the flushed roost is
    this mission's own `roostIndex` and the mission is active (mutually exclusive with
    `roostRecoveryEvasion`'s own caption check — only one `mission.target.kind` can be true at
    once).
  - `updateRoosts()`'s cooldown-decrement branch calls `completeMission()` the instant
    `roostCooldown[i]` reaches 0 while this mission is active and marked to that roost —
    a second `if` block, mirroring `roostRecoveryEvasion`'s own verbatim.
- `e2e/beacon-roost-recovery-evasion-mission.spec.ts` — new.
- `docs/ELEMENTS.md` — edited: new mission-kind entry alongside `roostRecoveryEvasion`/
  `bearRoostAmbush`.

## The change

Reuses `roostRecoveryEvasion`'s (LUL-5447/LUL-5446) exact composition: a non-spatial
`MISSION_POOL` entry (`{ kind: 'beaconRoostRecoveryEvasion', x: 0, z: 0, zoneRadius: 0,
interactRadius: 0, spatial: false, roostIndex: 0 }`) resolved to a real `ROOSTS` index at
`generateMap()` time, with a predator repositioned ~50u from that roost by
`repositionBeaconHunterForMission()` and completion on cooldown expiry (not a fresh throw).
The only behavioural difference from `roostRecoveryEvasion`: the repositioned predator is the
sight-biased Beacon Hunter wolf, not a lion — `repositionBeaconHunterForMission()`'s
predator-lookup ternary is left untouched for this kind, so it falls through to the existing
default branch (`beaconRoostFlush`'s own `predators.find(p => p.variant === 'beaconHunter')`).

`engine/forest-engine.js`'s `updateRoosts()` cooldown branch:

```js
roostCooldown[i] -= dt;
if(roostCooldown[i] <= 0 && mission && mission.status === 'active'
   && mission.target.kind === 'roostRecoveryEvasion' && mission.target.roostIndex === i){
  mission = completeMission(mission);
}
if(roostCooldown[i] <= 0 && mission && mission.status === 'active'
   && mission.target.kind === 'beaconRoostRecoveryEvasion' && mission.target.roostIndex === i){
  mission = completeMission(mission);
}
continue;
```

`flushRoost(i)` (unchanged signature) gains a second trailing conditional caption push, gated
so it only fires for this mission's own roost and only while the mission is active — every
other flush path (ambient predator-triggered, `beaconRoostFlush`, `lionRoostFlush`,
`bearRoostAmbush`, a plain player throw at an unmarked roost, or `roostRecoveryEvasion`'s own
caption) stays silent, unchanged from before this ticket.

## Verification

- `npx tsc --noEmit` — only the pre-existing `app/layout.tsx` `LayoutProps` baseline error.
- `npx eslint .` — clean.
- `npm test` (`node --test --experimental-test-module-mocks`) — all mission/economy tests
  green; pre-existing baseline failures elsewhere unaffected by this diff.
- `node scripts/check-elements-citations.mjs` — clean (0 new bad citations).
- `node --test lib/e2e-policy/world-policy.test.ts` — clean.
- `npx playwright test e2e/beacon-roost-recovery-evasion-mission.spec.ts` — see e2e section.

## e2e

**Specs.** `e2e/beacon-roost-recovery-evasion-mission.spec.ts` (new) —
'spawns with a repositioned Beacon Hunter after a flush and completes when the roost cooldown
expires' and 'does not spawn a repositioned Beacon Hunter or mission progress for an unmarked
roost'.

**World.** micro (default) — `qaBuildScene({ predators: [{ kind: 'wolf', x: 0, z: -8, state:
'roam', variant: 'beaconHunter' }] })`, mirroring `e2e/beacon-roost-flush-mission.spec.ts`'s
own staging. Not `@fullmap`: the roost-target shape is non-spatial (`spatial: false`), same
reasoning every other roost mission spec already relies on.

**Hooks.** All existing, no new hooks added: `qaBuildScene`, `qaProbeMission`,
`qaPredatorState`, `qaTeleportNearThrowable`, `qaTeleportNearRoost`, `qaProbeRoostState`,
`qaSetFixedStep`, `qaAdvance`.

**Tester scenario.** `shared/local-qa/requests/lul-5465-beacon-roost-recovery-evasion.md`
(this ticket) — nightly check does not otherwise cover a Beacon-Hunter-present flush →
cooldown-expiry mission completion loop.

**Not covered.** Audible tone/caption legibility feel — same manual-check precedent as
LUL-5412/LUL-5442/LUL-5447's own roost-cue requests.

## Cues

**Visual.** `#roostCooldownPanel` (existing, LUL-5412) and `#missionTimerSeconds` (existing,
`components/Hud.tsx`) — both already-live surfaces, no new render code. Beacon Hunter map
presence (glow) reuses the existing `predator.isBeaconHunter`-gated render, shipped LUL-5376.

**Audio.** None new — the existing roost-flush burst sound (`roostFlushSound()`,
`engine/forest-engine.js`) already plays on the flush that starts this mission's timer.

**Explanation.** `"the roost is cooling — stay out of the Beacon Hunter's sight until it
resets"`, pushed once from `flushRoost(i)` (`engine/forest-engine.js`, `function flushRoost`)
the moment this mission's own roost is flushed, gated on `captionsOn`.

**Reduced motion.** N/A — no animated visual cue introduced; `#roostCooldownPanel`'s countdown
text is static regardless of `reducedMotion`.

## Constraints

No new engine state, no new HUD surface, no new input/keybind, no new audio (per the wiki
proposal's own "cheap slice" scope). `canCompleteFlush()` is intentionally left untouched —
this kind never completes through it, same as `roostRecoveryEvasion`.

## Out of scope

Balancing/tuning the reward number (`MISSION_BEACON_ROOST_RECOVERY_EVASION_REWARD` is a
placeholder pending Game Economist confirmation, same convention as every other provisional
mission reward in `lib/game/economy.ts`). Any UI treatment beyond the existing
roost-cooldown/mission panels. The wiki proposal's Q5 flags the re-throw-during-cooldown guard
as needing a positive tell — that tell already shipped (LUL-5412's `roostFlushDeniedCue()`, the
throw-path `else if` branch right after `flushRoost()`'s call site in `throwThrowable()`),
applies to every roost regardless of mission kind, and needs no change for this ticket.
