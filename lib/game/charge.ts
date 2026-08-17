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
  /** distance (units) the predator was from the player when the charge started -- also
   * the overshoot distance once dodged, so a successful dodge always sprints past by
   * exactly the distance it closed to get there. */
  distance: number;
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
  return { phase: 'telegraph', t: 0, distance };
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
    if (jumped) return { phase: 'overshoot', t: 0, distance: state.distance };
    if (t >= CHARGE_WINDOW) return { phase: 'caught', t: 0, distance: state.distance };
    return { phase: t >= CHARGE_TELL_TIME ? 'charging' : 'telegraph', t, distance: state.distance };
  }

  // overshoot: sprint on for the same distance just closed, at the same
  // speed (see chargeSpeed) -- always takes CHARGE_RUN_TIME by construction.
  if (t >= CHARGE_RUN_TIME) return { phase: 'cleared', t: 0, distance: state.distance };
  return { phase: 'overshoot', t, distance: state.distance };
}

/** Speed (units/sec) needed to close `distance` during the charge-run portion
 * of the window. Also the overshoot speed, so overshoot covers `distance`
 * again in exactly CHARGE_RUN_TIME. */
export function chargeSpeed(distance: number): number {
  return distance / CHARGE_RUN_TIME;
}
