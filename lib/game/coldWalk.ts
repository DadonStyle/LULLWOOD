/**
 * True the frame the Cold Walk constraint (opted in, never sprinted since run start,
 * still before pickup) is first violated. Pure so it's testable without the engine --
 * mirrors lib/game/veilOverload.ts's isVeilOverloadActive() shape (one small predicate,
 * one file).
 */
export function coldWalkJustBroke(
  optedIn: boolean,
  alreadyBroken: boolean,
  pickingUp: boolean,
  running: boolean,
): boolean {
  return optedIn && !alreadyBroken && !pickingUp && running;
}
