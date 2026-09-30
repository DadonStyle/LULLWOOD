# LUL-5462: Beacon Hunter Deepwater Mission

**Ticket:** LUL-5462 (implementation) / LUL-5460 (Feature Scout proposal, accepted) ·
**Tier:** A — no new HUD elements, no new keys, no new audio, pure additive data + one
guard-condition line. See wiki `game/mechanics/beacon-hunter-deepwater-mission` and
`decisions/lul-5460-beacon-hunter-deepwater-accepted-2026-09-30`.

**Written against:** `release/next` (2026-09-30).

## Files

- `lib/game/mission.ts` — edited: new `'beaconDeepwater'` `MissionKind`, new `MISSION_POOL`
  entry (`beaconEvasion`'s fixed-`fireTower`-landmark/timed shape verbatim). No
  `eligibleMissionPool()` change: `timeLimitSeconds: 60` (non-null) already excludes it from
  the pre-3-wins filter.
- `lib/game/economy.ts` — edited: `MISSION_BEACON_DEEPWATER_REWARD` (9, Economist-confirmed
  via LUL-5463), added to `MISSION_REWARDS`.
- `lib/game/economy.test.ts` — edited: exhaustive `MISSION_REWARDS` key list + value assertion.
- `components/Hud.tsx` — edited: `MISSION_NAMES.beaconDeepwater = 'Beacon Deepwater'`.
- `e2e/helpers.ts` — edited: `qaMissionKind` union extended.
- `engine/forest-engine.js` — edited: `repositionBeaconHunterForMission()`'s guard condition
  extended to this kind. No other change: it falls through to the existing `beaconEvasion`
  branches (spatial `target.x/z` anchor, `beaconHunter`-variant wolf lookup) unmodified.
- `e2e/beacon-hunter-deepwater-mission.spec.ts` — new.
- `docs/ELEMENTS.md` — edited: new mission-kind entry alongside `bearRoostAmbush`.

## The change

Reuses `beaconEvasion`'s (LUL-5134) exact composition: a spatial `MISSION_POOL` entry
(`{ kind: 'beaconDeepwater', x: -95, z: -95, zoneRadius: 20, interactRadius: 4, landmarkKind:
'fireTower', timeLimitSeconds: 60 }`) with a Beacon Hunter wolf repositioned ~50u from the fire
tower by `repositionBeaconHunterForMission()`. The only difference from `beaconEvasion` is pool
membership: `beaconDeepwater` is drawn from the far-mission pool (alongside `deepwater`/
`stoneMarker`/`radioMast`/`beaconEvasion`/`upwindRefuge`, one of ~6 choices once
`MISSION_FAR_UNLOCK_WINS` is reached) instead of being a separately-named, always-eligible
mission. This fills the gap the wiki proposal identifies: the open-world spatial-landmark
mission class (`deepwater`/`stoneMarker`/`radioMast`) had no Beacon Hunter variant, despite
being the canonical "multi-path problem-solving" class.

No new UI, no new predator behaviour, no new audio asset, no new keys — this mission composes
existing pieces (the Beacon Hunter's lock visual/audio, `missionWaypointHum()`,
`HINT_PRIORITY['beaconHunter']`) without duplicating any of them (Q7/Q8/Q9 of the Feature
Checklist), per the wiki proposal's explicit "no new HUD, no new audio, no new keys" scope.

## Verification

- `node --check engine/forest-engine.js` — clean.
- `npx tsc --noEmit` — only the pre-existing `app/layout.tsx` `LayoutProps` baseline error.
- `npx eslint .` — clean.
- `npm test` (`node --test --experimental-test-module-mocks`) — all mission/economy tests
  green.
- `node scripts/check-elements-citations.mjs` — clean (0 bad citations).
- `node --test lib/e2e-policy/world-policy.test.ts` — clean.
- `npx playwright test e2e/beacon-hunter-deepwater-mission.spec.ts` — see e2e section.

## e2e

**Specs.** `e2e/beacon-hunter-deepwater-mission.spec.ts` (new) — 'completes after a real Scent
Veil break clears a real Beacon Hunter lock', mirroring
`e2e/beacon-hunter-evasion-mission.spec.ts` exactly (same staging, same real lock/break
sequence per Q1.5 discipline — no QA-hook force-set of the lock), swapping only the mission
kind.

**World.** micro (default) — `qaBuildScene({ predators: [{ kind: 'wolf', ..., variant:
'beaconHunter' }], props: [{ kind: 'bramble', ... }] })`, identical staging to
`e2e/beacon-hunter-evasion-mission.spec.ts`. Not `@fullmap`: a Beacon Hunter is a predator
variant, not map geometry, and the fire tower landmark exists in the micro world.

**Hooks.** All existing, no new hooks added: `qaBuildScene`, `qaSetFixedStep`,
`qaSetWindDirection`, `qaProbeMission`, `qaPredatorState`, `qaProbePredatorState`,
`qaTeleportAtMissionTarget`, `qaAdvance`.

**Tester scenario.** `shared/local-qa/requests/lul-5460-beacon-hunter-deepwater.md` (already
filed at proposal time) — checks the Beacon Hunter's eye-glow lock tell, the veil-break tell,
and the mission-complete glyph read right together at a glance; a headless assertion can't see
that.

**Not covered.** Audible lock/break cue legibility feel — same manual-check precedent as every
prior Beacon Hunter mission ticket's own request file.

## Cues

**Visual.** Beacon Hunter eye-color swap to `BEACON_HUNTER_EYE_COLOR` (existing,
`engine/forest-engine.js`) — already fires on lock, reused verbatim, no new visual cue.

**Audio.** `beaconLockCue()` (existing) fires on lock; `missionWaypointHum()` (existing) renders
bearing-pan/proximity-pitch while the mission is active — both reused verbatim, no new audio.

**Explanation.** The existing `HINT_PRIORITY['beaconHunter']` hint ("Beacon Hunter — locks onto
your scent when you move into the wind") fires on first encounter — reused verbatim, no new
copy.

**Reduced motion.** N/A — no new animated visual cue introduced.

## Constraints

No new engine state, no new HUD surface, no new input/keybind (per the wiki proposal's own
"cheap slice" scope). Reward priced by the Game Economist at 9 Embers (LUL-5463) — one above
`deepwater`'s 8, since `beaconEvasion` staying at 8 already showed a passive Beacon Hunter
threat alone isn't worth a premium over the base mission.

## Out of scope

New predator stats or behaviour tuning for the Beacon Hunter itself. Any UI treatment beyond
the existing mission panel and Beacon Hunter lock cues. Colorblind/deaf accessibility gaps in
the existing Beacon Hunter lock cue (pre-existing, flagged in the wiki proposal for a future
Economist-tier follow-up, not this ticket's scope).
