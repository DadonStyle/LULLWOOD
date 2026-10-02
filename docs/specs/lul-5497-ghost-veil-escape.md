# LUL-5497: M4 Ghost (veil-escape) mission

**Ticket:** LUL-5497 (implementation) · **Tier:** C — touches `engine/forest-engine.js`
(the `shouldGiveUpChase()` chase-state completion hook). Needs `REVIEW: APPROVED` before
merge. See wiki `game/mechanics/ghost-veil-escape-mission` and
`decisions/lul-5495-ghost-chapel-sanctuary-accepted-2026-09-30`.

**Written against:** `release/next` @ `61349fd` (2026-09-30).

## Files

- `lib/game/mission.ts` — edited: new `'ghost'` `MissionKind`, new `MISSION_POOL` entry
  (`slackWater`'s non-spatial shape verbatim), the `eligibleMissionPool()` exclusion list, and
  a new `canCompleteGhost()` predicate mirroring `canCompleteSlackWater()`.
- `lib/game/mission.test.ts` — edited: `canCompleteGhost` unit tests + `eligibleMissionPool`
  include/exclude tests, mirroring `slackWater`'s own.
- `lib/game/economy.ts` — edited: `MISSION_GHOST_REWARD` (9, placeholder, same tier as
  `flush`/`upwindRefuge`/`roostRecoveryEvasion`), added to `MISSION_REWARDS`.
- `lib/game/economy.test.ts` — edited: exhaustive `MISSION_REWARDS` key list + value assertion.
- `components/Hud.tsx` — edited: `MISSION_NAMES.ghost = 'Ghost'`.
- `e2e/helpers.ts` — edited: `qaMissionKind` union extended.
- `engine/forest-engine.js` — edited: `canCompleteGhost` added to the `@/lib/game/mission`
  import block; the chase-state `shouldGiveUpChase()` branch calls `canCompleteGhost(mission,
  isVeilOverloadActive(veilOverloadChargeT))` and completes the mission when it returns true.
  No new engine state, no new HUD element.
- `e2e/ghost-veil-escape-mission.spec.ts` — new.
- `docs/ELEMENTS.md` — edited: new mission-kind entry alongside `beaconRoostRecoveryEvasion`.

## The change

`ghost`'s `MISSION_POOL` entry has no real target position (`spatial: false`, `interactRadius:
0`, no `landmarkKind`/`timeLimitSeconds`) — identical in shape to `slackWater`. Completion is
not proximity-based: `canCompleteGhost(mission, overloadActive)` returns `mission.status ===
'active' && mission.target.kind === 'ghost' && overloadActive`, checked at the one real-play
call site that can make it true:

```js
if(shouldGiveUpChase(p.scentLock, dist, effectiveDetect(p))){
  p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind });
  p.gaveUpAt = clock.elapsedTime;
  if(mission && canCompleteGhost(mission, isVeilOverloadActive(veilOverloadChargeT))) mission = completeMission(mission);
}
```

(`engine/forest-engine.js`'s `chase`-state predator loop.) This is the *only*
`shouldGiveUpChase()` call site in the engine — the two other `predator_gave_up` sites
(`investigate`/`sniff` sniff-timeout and `flank`/`hold` sniff-timeout) are a different give-up
mechanic entirely and were deliberately left untouched.

`eligibleMissionPool()`'s pre-`MISSION_FAR_UNLOCK_WINS` exclusion list is extended to exclude
`ghost`: it shares the exact untimed/no-`landmarkKind` shape as every other excluded kind
(`slackWater`/`flush`/`beaconRoostFlush`/`lionRoostFlush`/`roostRecoveryEvasion`/
`bearRoostAmbush`/`beaconRoostRecoveryEvasion`), and a fresh player drawing it pre-3-wins would
reproduce the exact LUL-5069 regression that exclusion list exists to prevent (no `deepwater`/
`oakHollow` `HINT_PRIORITY` entry for `ghost`, so the `landmark`→mission hint-slot handoff
`e2e/hints.spec.ts` tests would silently break). **This corrects the dispatched plan**, which
said no exclusion was needed — that reasoning didn't account for the exact regression shape
this ticket's own target reproduces.

## Verification

- `node --check engine/forest-engine.js` — clean.
- `npx tsc --noEmit` — only the pre-existing `app/layout.tsx` `LayoutProps` baseline error.
- `npx eslint .` — clean.
- `npm test` (`node --test --experimental-test-module-mocks`) — 1262/1262 passing.
- `node scripts/check-elements-citations.mjs` — clean (0 new bad citations; fixed 4 pre-existing
  citations shifted by this diff's one added import line, via hand-edit).
- `node --test lib/e2e-policy/world-policy.test.ts` — clean.
- `npx playwright test e2e/ghost-veil-escape-mission.spec.ts` — **not verified locally this
  run**: both the new spec and a control run of an unmodified, already-merged spec
  (`e2e/mission-slack-water.spec.ts`) timed out identically at `boot()` (`window.ForestEngine`
  never became ready within 60s) while the founder's own `qa-regression` cron was running
  concurrently on this box (`ps aux` showed its Chromium/Node processes live under
  `~/.paperclip/shared/qa-regression/vendor/lullwood/`) — the same box-contention pattern prior
  tickets' journal entries record (e.g. LUL-5456, LUL-5462). Flagging for the Code Reviewer to
  confirm via the PR's own GitHub Actions CI run, which runs in an isolated environment.

## e2e

**Specs.** `e2e/ghost-veil-escape-mission.spec.ts` (new) — 'a chase give-up while Veil
Overload is active completes Ghost' and 'a chase give-up with Veil Overload never activated
does not complete Ghost'.

**World.** micro (default) — `qaBuildScene({ predators: [{ kind: 'wolf', x: 40, z: 0, state:
'chase', scentLock: 8 }] })`: a real chase staged beyond its give-up leash (`dist >
detect*1.5`, asserted live via `qaPredatorState`'s `dist`/`detectRange` fields, not assumed).
Not `@fullmap`: the target is non-spatial (`spatial: false`), same reasoning every other
non-spatial mission spec already relies on.

**Hooks.** All existing, no new hooks added: `qaBuildScene`, `qaProbeMission`,
`qaPredatorState`, `qaProbeVeilOverload`, `qaSetFixedStep`, `qaAdvance`. Veil Overload
activation itself goes through a real `KeyQ` press (Q1.5: no qa-hook force-activates it —
`qaOpenVeilOverloadTarget` exists but stages the predator at 6u, which can never satisfy
`shouldGiveUpChase()`'s leash and is purpose-built for `e2e/veil-overload.spec.ts`'s own
"does overload suppress `canSee()`" coverage, a different mechanic).

**Tester scenario.** `shared/local-qa/requests/lul-5497-ghost-veil-escape-mission.md` (this
ticket) — corrects an earlier draft of the same request that staged via
`qaOpenVeilOverloadTarget` (see the request file's own correction note).

**Not covered.** Audible tone/caption legibility feel — no new audio or caption at all (this
mission wraps the existing Veil Overload panic-button cue verbatim).

## Cues

**Visual.** None new — `#missionPanel`/`#missionGlyph` (existing, `components/Hud.tsx`) render
`ghost` exactly like every other mission kind. The existing Veil Overload activation visual
(unchanged) is the only feedback the player sees at the completion instant.

**Audio.** None new — the existing Veil Overload activation sound (unchanged call site).

**Explanation.** None new — no caption is pushed on Ghost's completion; the mission panel's
existing complete-glyph flip (`●`) is the only textual/visual confirmation, same as
`slackWater`.

**Reduced motion.** N/A — no animated visual cue introduced.

## Constraints

No new engine state, no new HUD surface, no new input/keybind, no new audio/caption (per the
ticket's own "cheap slice" scope — wraps the existing Veil Overload detection-immunity edge
unchanged). `canCompleteSlackWater()`/`canCompleteFlush()` are untouched — `ghost` never
interacts with either.

## Out of scope

Balancing/tuning the reward number (`MISSION_GHOST_REWARD` is a placeholder pending Game
Economist confirmation, same convention as every other provisional mission reward in
`lib/game/economy.ts` — a follow-up ticket requests the real number). Any UI treatment beyond
the existing generic mission panel.
