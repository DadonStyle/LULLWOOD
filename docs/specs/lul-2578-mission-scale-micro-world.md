# SPEC: LUL-2578 scale mission target position for the micro QA world

**Ticket:** LUL-2578 · **Tier:** C — edits `engine/tuning.js` + `engine/forest-engine.js`
(engine simulation), unconditional Tier C per `scripts/pr-tier.mjs`. Needs `REVIEW: APPROVED`
from the Code Reviewer before merge.

**Written against:** `release/next` @ `4252c5603d9b5544689de7ce0f0ac9db482ea0e4` (2026-09-16).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

## Background

`MISSION_POOL`'s only entry is `{ kind: 'deepwater', x: -95, z: 46, zoneRadius: 20,
interactRadius: 4 }` (`lib/game/mission.ts:27`) — absolute full-map coordinates. The micro QA
world (`applyQaWorldMicroPreset()`, `engine/tuning.js:210-219`, LUL-2377) shrinks
`CONFIG.mapSize` to 96, so the movement clamp's `half = CONFIG.mapSize / 2` (`engine/forest-
engine.js:255`) is 48, minus `margin = 4` (`:256`) — the player can never reach x=-95. This
isn't only a QA-hook problem: `canCompleteMission()` / `distToMissionTarget()`
(`lib/game/mission.ts:49,53-55`) check distance against the *live* `mission.target.x/z`, so the
deepwater mission is uncompletable in the micro world even in a normal (non-teleport)
playthrough. `window.ForestEngine.qaTeleportNearMission()` (`engine/forest-engine.js:5091-
5095`) reads `mission.target.x/z` too, which is why `e2e/throwable-mission-hud.spec.ts`'s
"teleporting near the mission target shows #missionPanel and enables completion" test
(`:56`) fails today — confirmed present in the 2026-09-09 e2e baseline, predates LUL-2312, and
still listed failing in the 2026-09-15 nightly (LUL-2632).

CTO plan (issue comment, 2026-09-12T19:14): scale the mission's live target position at
generation time, mirroring the existing `detectScaleMul` / `speedScaleMul` pattern
(`engine/tuning.js:19-26`) exactly — those two exist for the same reason ("keeps ...
scripted qaTeleportNear*/staged scenarios' safety window").

## Files

- `engine/tuning.js` — add `missionScaleMul` to `CONFIG`; set it in `applyQaWorldMicroPreset()`.
- `engine/forest-engine.js` — scale `mission.target` right after `pickMission()` is called in
  `generateMap()`.

## The change

**`engine/tuning.js`**, in the `CONFIG` object next to `speedScaleMul` (after `:26`, matching
the existing two-knob comment style):

```js
missionScaleMul: 1,     // LUL-2578: mission target position multiplier; applyQaWorldMicroPreset()
                        // scales this down so the deepwater mission's fixed MISSION_POOL
                        // coordinates land inside the shrunk map's movement-clamp bounds.
                        // 1 = full-map, no-op default.
```

Inside `applyQaWorldMicroPreset()` (`engine/tuning.js:210-219`), add a third scale line next
to the existing two:

```js
  CONFIG.missionScaleMul = 0.2;  // LUL-2578: same 96/480 ratio -- keeps the deepwater mission's
                                  // target inside the shrunk map's movement-clamp bounds so it
                                  // stays completable (and qaTeleportNearMission() lands legally).
```

**`engine/forest-engine.js`**, immediately after the `mission = pickMission(rng,
secondaryChoice);` line (`:1321`) and before `missionHumTimer = 2;` (`:1322`):

```js
  if(CONFIG.missionScaleMul !== 1){
    mission = { ...mission, target: { ...mission.target, x: mission.target.x * CONFIG.missionScaleMul, z: mission.target.z * CONFIG.missionScaleMul } };
  }
```

**Do not write `mission.target.x = ...` / `mission.target.z = ...` in place.**
`pickMission()` (`lib/game/mission.ts:41-47`) returns `target: MISSION_POOL[...]` — a direct
reference into the shared, module-level `MISSION_POOL` array (`lib/game/mission.ts:18-28`),
not a copy. Mutating it in place would permanently corrupt that pool entry for the rest of the
process lifetime — every subsequent map generation, any world size, any seed, would inherit
the scaled-down coordinates even on the full map. The rebuild above (`{ ...mission, target: {
...mission.target, x: ..., z: ... } }`) creates fresh objects and never touches the pool.

Ordering: this insertion point is after every `rng()`-consuming call in `generateMap()` up to
and including `pickMission()`, and before `placeCave()` (`:1323`, comment: "must stay last,
after mission"). The scaling step itself calls no `rng()`, so it cannot shift the seed's rng
stream regardless of exactly where between `pickMission()` and `placeCave()` it sits — placing
it directly after `pickMission()` (before `missionHumTimer = 2`) is the clearest reading, not
a hard requirement.

**Scope: position only.** Leave `interactRadius` (4) and `zoneRadius` (20) unscaled — no
existing precedent scales an interact/zone radius for the micro world, and the reported bug is
about the position violating the movement clamp, not nav-cue timing feel.

**`qaTeleportNearMission()` needs no code change.** It already reads `mission.target.x/z`
after `generateMap()` runs (`engine/forest-engine.js:5093`), so once the live target is
pre-scaled, its existing math (`target.x + target.interactRadius + 1`) lands inside the micro
world's clamp bounds automatically: `-95 * 0.2 = -19`, `+4 interactRadius +1 = -14` — well
inside `±44`.

## Verification

- `npx playwright test e2e/throwable-mission-hud.spec.ts -g "teleporting near the mission
  target"` — passes on default micro boot (previously failing).
- `npx tsc --noEmit` — `engine/tuning.js`/`forest-engine.js` types unaffected (both plain
  JS/typed via `.d.ts`; no signature change).
- Full-map behavior unchanged: `CONFIG.missionScaleMul` defaults to `1`, multiplying by `1` is
  a no-op, and the `if(CONFIG.missionScaleMul !== 1)` guard skips the rebuild entirely on the
  full map — zero object churn there.

## e2e

**Specs.** `e2e/throwable-mission-hud.spec.ts` — "teleporting near the mission target shows
#missionPanel and enables completion" (existing, must pass unchanged after this fix — this
is the regression proof for the whole ticket, per LUL-2377 no new spec is needed since the
existing one already exercises the fixed hook end-to-end).
**World.** micro (default). No `qaBuildScene` staging needed — the test boots normally and
calls `qaTeleportNearMission()`, which now lands inside the shrunk map's own generated mission
target.
**Hooks.** No new hook. `qaTeleportNearMission()` (`engine/forest-engine.js:5091`, existing)
and `qaProbeMission()` (`:4055`, existing) are what the spec already drives — this fix corrects
what `mission.target` holds by the time those hooks read it.
**Tester scenario.** None new — this closes an existing e2e-baseline failure (2026-09-09
baseline, reconfirmed in the LUL-2632 2026-09-15 nightly run) rather than adding new
player-visible surface. Not a candidate for a `shared/local-qa/requests/` file: nothing here
changes what a human player sees or does, only whether the micro *test* world's mission
target is reachable.
**Not covered.** Full-map deepwater mission behavior is unchanged by design
(`missionScaleMul` defaults to `1` there) and already covered by whatever full-map mission
tests exist; not re-verified here since this spec touches only the micro-world scale path.

## Cues

No player-visible cue changes. This is a QA/test-world-only coordinate fix — `missionScaleMul`
is `1` (no-op) on the full map, which is the only map a real player ever sees. No new HUD
state, no new sound, no new caption.

## Constraints

- `MISSION_POOL` (`lib/game/mission.ts:18-28`) must never be mutated in place — always rebuild
  `mission`/`mission.target` as new objects (see "The change" above).
- Full-map behavior must be byte-identical to today: `CONFIG.missionScaleMul` defaults to `1`
  and the scaling block is skipped entirely when it is `1`.
- No `rng()` call may be introduced between `pickMission()` and `placeCave()` — this would
  shift every downstream seeded draw (placeCave, and anything after it that consumes `rng`).

## Out of scope

- `interactRadius` / `zoneRadius` scaling — deliberately left unscaled (see "The change").
  If a future ticket finds the deepwater zone-cue timing feels off in the micro world, that is
  a separate, explicitly-scoped follow-up.
- Any change to `MISSION_POOL`'s full-map coordinates, or to which mission is drawn — this
  spec only scales the position of whatever mission `pickMission()` already drew.
- Secondary-objective (`SECONDARY_SUPPORTED_MISSIONS`, `lib/game/mission.ts:79`) behavior —
  untouched, no coordinate dependency.
