// Founder rule 2026-09-09 (engine/React contract, LUL-1697 lesson): forest-engine.js is
// plain JS behind a hand-written engine/forest-engine.d.ts, so `tsc` can't see init()'s
// `return { ... }` drift from `EngineActions` on its own -- that drift blanked production
// for every returning player once (LUL-1697, `setMissionUnlocks`). This is the type-level
// half of the guard the rule requires: every key of `EngineActions` must appear in
// `ENGINE_ACTION_KEYS`, in both directions, or the assertions below fail `tsc`.
import type { EngineActions } from '@/components/Hud';
// Relative, not the `@/` alias: `npm test` runs plain `node --test` (no bundler,
// no path-alias resolution -- see tsconfig.json's `paths` vs. what Node itself
// understands), and this is a value import so Node's type-stripping can't erase
// it away the way it does the type-only import above.
import { track } from './analytics.ts';

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
  // LUL-2307
  'setHintsEnabled', 'resetHints',
] as const satisfies readonly (keyof EngineActions)[];

// The other direction: if EngineActions ever gains a key missing from the list above,
// `_MissingFromEngineActionKeys` stops being `never` and this assignment fails to typecheck.
type MissingFromEngineActionKeys = Exclude<keyof EngineActions, (typeof ENGINE_ACTION_KEYS)[number]>;
const _engineActionKeysAreExhaustive: MissingFromEngineActionKeys extends never
  ? true
  : ['ENGINE_ACTION_KEYS is missing', MissingFromEngineActionKeys] = true;
void _engineActionKeysAreExhaustive;

// LUL-2239: the runtime half the founder rule also requires. The exhaustiveness check
// above only catches `EngineActions` gaining a key `ENGINE_ACTION_KEYS` doesn't know
// about -- it cannot see whether `init()`'s `return { ... }` (bottom of
// `engine/forest-engine.js`) actually included every key, because that object is
// untyped plain JS. That's the exact LUL-1697 failure mode (`setMissionUnlocks` present
// in `EngineActions` and in the engine's own source, silently missing from the returned
// object). Call this with whatever `init()` actually returned, right after it returns
// (components/GameCanvas.tsx).
//
// `init()` legitimately returns `null` when it's a no-op re-entrant call (engine already
// running -- see the `activeDispose` guard at the top of `init()` in forest-engine.js);
// that's not a contract violation, so it's skipped rather than reported.
//
// Dev / `?qaHooks=1`: throws, naming the missing keys, so the gap surfaces immediately
// instead of shipping -- matches how `e2e/helpers.ts`'s `qaHook()` throws on a missing
// hook rather than silently no-opping. Production: never throws into the render path --
// `console.error` (the Playwright suite's `expectNoConsoleErrors` helper, e2e/helpers.ts,
// already fails any spec that observes one) plus a best-effort telemetry event.
export function assertEngineContract(actions: EngineActions | Record<string, unknown> | null): void {
  if (actions == null) return;

  const missing = ENGINE_ACTION_KEYS.filter(
    (key) => typeof (actions as Record<string, unknown>)[key] !== 'function',
  );
  if (missing.length === 0) return;

  const message = `assertEngineContract: init() did not return ${missing.join(', ')} -- present in EngineActions/ENGINE_ACTION_KEYS but missing (or not a function) on the object init() returned. See lib/engine-contract.ts (LUL-1697, LUL-2239).`;

  // Same `?qaHooks=1` opt-in GameLoader.tsx uses for its own QA-only hook.
  const strict =
    process.env.NODE_ENV !== 'production' ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('qaHooks'));

  if (strict) throw new Error(message);

  console.error(message);
  track({ event: 'engine_contract_violation', missing_keys: missing });
}
