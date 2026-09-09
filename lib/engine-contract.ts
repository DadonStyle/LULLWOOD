// Founder rule 2026-09-09 (engine/React contract, LUL-1697 lesson): forest-engine.js is
// plain JS behind a hand-written engine/forest-engine.d.ts, so `tsc` can't see init()'s
// `return { ... }` drift from `EngineActions` on its own -- that drift blanked production
// for every returning player once (LUL-1697, `setMissionUnlocks`). This is the type-level
// half of the guard the rule requires: every key of `EngineActions` must appear in
// `ENGINE_ACTION_KEYS`, in both directions, or the assertions below fail `tsc`.
//
// NOT YET WIRED TO A RUNTIME CHECK. The founder rule also describes an
// `assertEngineContract()` that components/GameCanvas.tsx is supposed to call right after
// init() returns (throws under dev/`?qaHooks=1`, console.error + telemetry in prod, treated
// as a Playwright failure). That function and its GameCanvas.tsx call site do not exist
// anywhere in this repo as of this file (no commit, no other file, no wiki page -- checked
// before writing this comment) -- flagged on LUL-2230 rather than invented here, since it's
// cross-cutting infra every future `EngineActions` addition would depend on, not something
// scoped to one ticket's diff.
import type { EngineActions } from '@/components/Hud';

export const ENGINE_ACTION_KEYS = [
  'enter', 'restart', 'setPace', 'setFog', 'toggleSound', 'regenMap',
  'setTouchMove', 'setTouchLook', 'setTouchSprint',
  'triggerTouchHide', 'triggerTouchInteract', 'triggerTouchThrow',
  'triggerTouchJump', 'triggerTouchPause', 'triggerTouchToggleRun', 'setTouchVeil',
  'setDifficulty', 'setRunMode', 'setSensitivity', 'setInvertY', 'setReducedMotion', 'setCaptions',
  'setEmbers', 'purchaseDeeperLungs',
  'setMissionUnlocks', 'setSecondaryChoice',
  // LUL-2230
  'setScentTrailVisible',
] as const satisfies readonly (keyof EngineActions)[];

// The other direction: if EngineActions ever gains a key missing from the list above,
// `_MissingFromEngineActionKeys` stops being `never` and this assignment fails to typecheck.
type MissingFromEngineActionKeys = Exclude<keyof EngineActions, (typeof ENGINE_ACTION_KEYS)[number]>;
const _engineActionKeysAreExhaustive: MissingFromEngineActionKeys extends never
  ? true
  : ['ENGINE_ACTION_KEYS is missing', MissingFromEngineActionKeys] = true;
void _engineActionKeysAreExhaustive;
