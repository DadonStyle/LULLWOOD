// LUL-213: pure predator-charge decision + timing math, lifted out so it can
// be unit tested without a Three.js scene or a running render loop (see wiki
// systems/unit-testing-standard). The engine (engine/forest-engine.js,
// updatePredators()) owns everything about *how* this looks -- animation,
// which predator, movement/collision -- this module only owns *when* a charge
// starts, how long the telegraph/dodge window is, and how it resolves.
//
// Design, from genre research (GDKeys "Anatomy of an Attack" -- telegraph,
// commit, recovery): the window itself is a fixed, learnable duration so
// players can build real reflexes against it. Only the *distance* at which a
// charge triggers is randomized -- that is the "will it happen here" tension
// the ticket asks for; the "how long do I have once it does" answer should
// never move, or the dodge stops being learnable and starts being luck.

export type ChargePhase = 'telegraph' | 'charging' | 'overshoot' | 'caught' | 'cleared';

export interface ChargeState {
  phase: ChargePhase;
  /** seconds elapsed in the current phase */
  t: number;
  /** distance (units) the predator was from the player when the charge started.
   * Fixed for the life of the charge -- feeds chargeSpeed() so telegraph->charging
   * and the overshoot run share one speed, same as always. */
  distance: number;
  /** Only meaningful during 'overshoot': how long (seconds, at that same speed) the
   * predator actually spent closing distance before the jump landed -- not
   * CHARGE_RUN_TIME. A dodge thrown right as the tell starts means the predator
   * has barely moved, so the overshoot should barely continue either; a dodge
   * thrown right at the window's edge means it had nearly closed the full gap, so
   * the overshoot nearly repeats it. Using a fixed CHARGE_RUN_TIME here regardless
   * of when the jump landed was the LUL-213 bug: an early, correctly-timed dodge
   * still overshot the *full original* distance and landed back on the player. 0
   * outside 'overshoot'. */
  overshootDuration: number;
}

// A charge only makes sense at close-to-mid range: too near and there is no
// runway to react (that is just a normal catch), too far and covering it
// would take several real seconds, which stops reading as a "charge."
export const CHARGE_TRIGGER_MIN = 7;
export const CHARGE_TRIGGER_MAX = 16;

// dt-scaled roll (same shape as the engine's existing checkNoise()), so
// crossing the trigger band is a chance per second, not a guarantee the
// instant the predator enters it -- this is where "random distance" actually
// comes from: which frame the roll succeeds, inside the band above.
const CHARGE_TRIGGER_CHANCE_PER_SEC = 1.2;

// Founder spec: "the right timing (1 second window)". Split between a
// stationary tell (wiggle tail, lean forward -- long enough to read, short
// enough to stay tense) and the actual charge closing the trigger distance.
export const CHARGE_WINDOW = 1;
export const CHARGE_TELL_TIME = 0.35;
export const CHARGE_RUN_TIME = CHARGE_WINDOW - CHARGE_TELL_TIME;

/** Per-frame trigger roll. `dist` is the live predator-to-player distance;
 * `dt` the frame's clamped delta (game time, not wall time -- see wiki
 * systems/dt-clamp-vs-walltime). Pass `rand` to make a test deterministic. */
export function shouldTriggerCharge(dist: number, dt: number, rand: () => number = Math.random): boolean {
  if (dist < CHARGE_TRIGGER_MIN || dist > CHARGE_TRIGGER_MAX) return false;
  if (dt <= 0) return false;
  return rand() < CHARGE_TRIGGER_CHANCE_PER_SEC * dt;
}

export function startCharge(distance: number): ChargeState {
  return { phase: 'telegraph', t: 0, distance, overshootDuration: 0 };
}

/** Advances a charge by one frame. `jumped` is whether the player's jump
 * input landed since the last call (the engine debounces the raw keydown
 * into a one-frame edge before passing it in). Terminal states ('caught' /
 * 'cleared') are no-ops, so a caller that reads the resolution one frame
 * late and calls again doesn't double-resolve. */
export function stepCharge(state: ChargeState, dt: number, jumped: boolean): ChargeState {
  if (state.phase === 'caught' || state.phase === 'cleared') return state;

  const t = state.t + dt;

  if (state.phase === 'telegraph' || state.phase === 'charging') {
    if (jumped) {
      // How long the predator was actually in the moving ('charging') sub-phase
      // before this jump landed -- 0 if dodged during the stationary telegraph,
      // up to CHARGE_RUN_TIME if dodged right at the window's edge. The overshoot
      // repeats *that* run, not the full original gap (see the field comment on
      // ChargeState.overshootDuration).
      const chargingElapsed = Math.min(Math.max(0, t - CHARGE_TELL_TIME), CHARGE_RUN_TIME);
      return { phase: 'overshoot', t: 0, distance: state.distance, overshootDuration: chargingElapsed };
    }
    if (t >= CHARGE_WINDOW) return { phase: 'caught', t: 0, distance: state.distance, overshootDuration: 0 };
    return { phase: t >= CHARGE_TELL_TIME ? 'charging' : 'telegraph', t, distance: state.distance, overshootDuration: 0 };
  }

  // overshoot: sprint on at the same speed (see chargeSpeed) for exactly as
  // long as the charge run actually lasted before the dodge -- not a flat
  // CHARGE_RUN_TIME, or an early dodge overshoots the full original distance
  // and lands back on the player (LUL-323).
  if (t >= state.overshootDuration) return { phase: 'cleared', t: 0, distance: state.distance, overshootDuration: 0 };
  return { phase: 'overshoot', t, distance: state.distance, overshootDuration: state.overshootDuration };
}

/** Speed (units/sec) needed to close `distance` during the charge-run portion
 * of the window. Also the overshoot speed, so overshoot covers `distance`
 * again in exactly CHARGE_RUN_TIME. */
export function chargeSpeed(distance: number): number {
  return distance / CHARGE_RUN_TIME;
}
