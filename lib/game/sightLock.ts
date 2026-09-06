// LUL-1482: carry-only pre-lock sight-acquisition tell. Today canSee()->
// spotOnto() is one statement in both the roam and flank predator states
// (engine/forest-engine.js) -- there is no interval between a predator
// acquiring the player by sight and the chase actually starting. That's fine
// outbound: the player learns the real sight radius over the ~60s walk out
// and the rule never changes underneath them. On the carry leg
// CARRY_DETECT_MUL (lib/game/cover.ts) silently widens that same radius 35%
// the instant the child is picked up, so the same binary is an ambush there
// (wiki game/psychology/carry-detection-fairness). This module is the fix --
// carrying only, sight only (scent is untouched: scentOnto still fires on the
// same frame it always has, in every state) -- a predator that spots you gets
// SIGHT_TELL_TIME seconds to keep seeing you before the lock happens. Look
// away or break LOS during that window and it cancels silently: no roar, no
// flash, no state change -- the same "you got away with it" the outbound leg
// has always had, extended across the one frame that today has none.

export type SightLockPhase = 'spotting' | 'locked' | 'cancelled';

export interface SightLockState {
  phase: SightLockPhase;
  /** seconds elapsed since the tell started. 0 once resolved (locked/cancelled). */
  t: number;
}

// Duration class matches CHARGE_TELL_TIME (lib/game/charge.ts, = 0.35) by
// design -- LUL-1482 asks the pre-lock beat to "feel like the same
// vocabulary" players already read for a charge tell. This is its own
// constant, not an import of CHARGE_TELL_TIME: the two are allowed to
// diverge on a future retune without one silently moving the other.
export const SIGHT_TELL_TIME = 0.35;

export function startSightLock(): SightLockState {
  return { phase: 'spotting', t: 0 };
}

/** Advances an in-progress tell by one frame. `stillVisible` is this frame's
 * canSee(p, dist) result, re-evaluated by the caller every tick -- same
 * contract as stepCharge()'s `jumped` parameter. Terminal states are no-ops
 * so a caller that reads the resolution one frame late can't double-resolve. */
export function stepSightLock(state: SightLockState, dt: number, stillVisible: boolean): SightLockState {
  if (state.phase !== 'spotting') return state;
  if (!stillVisible) return { phase: 'cancelled', t: 0 };
  const t = state.t + dt;
  if (t >= SIGHT_TELL_TIME) return { phase: 'locked', t: 0 };
  return { phase: 'spotting', t };
}
