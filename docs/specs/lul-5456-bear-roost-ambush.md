# LUL-5456: Bear Roost Ambush

**Ticket:** LUL-5456 (implementation) / LUL-5454 (Feature Scout proposal, accepted) ·
**Tier:** C — touches `engine/forest-engine.js` (reposition/roost-draw/completion wiring).
Needs `REVIEW: APPROVED` before merge. See wiki `game/mechanics/bear-roost-ambush` and
`decisions/lul-5454-bear-roost-ambush-accepted-2026-09-30`.

**Written against:** `release/next` @ `18413cc` (2026-09-30).

## Files

- `lib/game/mission.ts` — edited: new `'bearRoostAmbush'` `MissionKind`, new `MISSION_POOL`
  entry (`lionRoostFlush`'s non-spatial roost-target shape verbatim), the
  `eligibleMissionPool()` exclusion list, and the `canCompleteFlush()` OR-clause.
- `lib/game/economy.ts` — edited: `MISSION_BEAR_ROOST_AMBUSH_REWARD` (9, Economist-confirmed
  via LUL-5457), added to `MISSION_REWARDS`.
- `lib/game/economy.test.ts` — edited: exhaustive `MISSION_REWARDS` key list + value assertion.
- `lib/game/mission.test.ts` — edited: `canCompleteFlush` true/false tests +
  `eligibleMissionPool` include/exclude tests, mirroring `lionRoostFlush`'s own.
- `components/Hud.tsx` — edited: `MISSION_NAMES.bearRoostAmbush = 'Bear Roost Ambush'`.
- `e2e/helpers.ts` — edited: `qaMissionKind` union extended.
- `engine/forest-engine.js` — edited:
  - `generateMap()`'s post-`placeCave()` roost-index draw guard extended to this kind.
  - `repositionBeaconHunterForMission()`'s guard, predator-lookup branch (bear instead of
    lion), and roost-anchor branch all extended to this kind.
- `e2e/bear-roost-ambush-mission.spec.ts` — new.
- `docs/ELEMENTS.md` — edited: new mission-kind entry alongside `lionRoostFlush`/
  `roostRecoveryEvasion`.

## The change

Reuses `lionRoostFlush`'s (LUL-5426) exact composition: a non-spatial `MISSION_POOL` entry
(`{ kind: 'bearRoostAmbush', x: 0, z: 0, zoneRadius: 0, interactRadius: 0, spatial: false,
roostIndex: 0 }`) resolved to a real `ROOSTS` index at `generateMap()` time, with a predator
repositioned ~50u from that roost by `repositionBeaconHunterForMission()`. The only difference
from `lionRoostFlush` is which predator gets repositioned: `predators.find(p => p.kind ===
'bear')` instead of `predators.find(p => p.kind === 'lion')` — the scent-weighted predator
(`engine/forest-engine.js:2114`, `isScentDetected()` call site `:2217`) anchoring a roost
mission for the first time. Completion is unchanged: `canCompleteFlush()`
(`lib/game/mission.ts`) now also accepts `bearRoostAmbush`, so a thrown stone landing on
`mission.target.roostIndex` completes the mission through the identical predicate already used
by `flush`/`beaconRoostFlush`/`lionRoostFlush`.

No new UI, no new predator behaviour, no new audio asset — this mission composes existing
pieces (LUL-5402's downwind indicator, the bear's existing guttural-roar cue and hint caption)
without duplicating any of them (Q7/Q8/Q9 of the Feature Checklist), per the wiki proposal's
explicit "no new visual, the shared indicator already covers it" call.

## Verification

- `node --check engine/forest-engine.js` — clean.
- `npx tsc --noEmit` — only the pre-existing `app/layout.tsx` `LayoutProps` baseline error.
- `npx eslint .` — clean.
- `npm test` (`node --test --experimental-test-module-mocks`) — all mission/economy tests
  green.
- `node scripts/check-elements-citations.mjs` — clean (0 bad citations).
- `node --test lib/e2e-policy/world-policy.test.ts` — clean.
- `npx playwright test e2e/bear-roost-ambush-mission.spec.ts` — see e2e section.

## e2e

**Specs.** `e2e/bear-roost-ambush-mission.spec.ts` (new) — 'draws with a repositioned bear
near the marked roost and completes via the real roost-throw path' and 'does not complete when
a different (unmarked) roost is flushed by a player throw'.

**World.** micro (default) — `qaBuildScene({ predators: [{ kind: 'bear', x: 0, z: -8, state:
'roam' }] })`, mirroring `e2e/lion-roost-flush-mission.spec.ts`'s own staging. Not `@fullmap`:
the roost-target shape is non-spatial (`spatial: false`), same reasoning every other roost
mission spec already relies on.

**Hooks.** All existing, no new hooks added: `qaBuildScene`, `qaProbeMission`,
`qaPredatorState`, `qaTeleportNearThrowable`, `qaTeleportNearRoost`, `qaProbeRoostState`,
`qaAdvance`.

**Tester scenario.** `shared/local-qa/requests/lul-5456-bear-roost-ambush.md` (already filed
at proposal time) — checks the bear model, its placement near the marked roost, the
roost-burst/chirp cue triple, and the mission-complete glyph read right together at a glance;
a headless assertion can't see that.

**Not covered.** Audible tone/caption legibility feel — same manual-check precedent as
LUL-5412/LUL-5442/LUL-5447's own roost-cue requests.

## Cues

**Visual.** `#investigationDownwindIndicator` (existing, LUL-5402) — already pulses when a
scent-locked predator closes from downwind; deliberately not duplicated with a second,
bear-specific indicator (Q9).

**Audio.** Bear's existing "low guttural roar + noise" cue (`engine/forest-engine.js:2114`
area, `kind === 'bear'` branch) — plays on the mission-predator's normal detection path,
unmodified by this ticket.

**Explanation.** The existing bear hint caption (`WORLD_HINT_KEYS`/`HINT_PRIORITY`,
`engine/forest-engine.js:2114`: `"a bear — not fast, but it tracks your scent better than the
others. hide (H) or veil (F)"`) — reused verbatim, no new copy.

**Reduced motion.** N/A — no new animated visual cue introduced.

## Constraints

No new engine state, no new HUD surface, no new input/keybind (per the wiki proposal's own
"cheap slice" scope). `repositionBeaconHunterForMission()`'s bear lookup takes the first of
the 3 bears `placePredators()` always spawns — never expected to be missing.

## Out of scope

New predator stats or behaviour tuning for the bear itself. Any UI treatment beyond the
existing mission banner and downwind indicator.
