// LUL-345 (wave 2 of LUL-277): pure decision helpers lifted out of the
// per-predator step block in engine/forest-engine.js (updatePredators(),
// roughly lines 890-1045 on main), unit tested without a Three.js scene or a
// running render loop (see wiki systems/unit-testing-standard). This is a
// helper extraction, not a reducer rewrite: the engine's roam/chase/
// investigate/flank if-chain keeps its shape and calls these in place. The
// engine still owns all state and every side effect (triggerDeath,
// predatorCall, sniff, chargeHud, Three.js) -- this module only owns the
// decision math.
//
// Determinism: every roll here takes an injected `rng` rather than reading
// Math.random()/the module's seeded generator itself. At every call site in
// the engine today the value passed in is Math.random -- these functions
// were never fed the seeded `rng()` (see rnd()) that other systems use, and
// that split is preserved exactly, not unified.

export type RNG = () => number;

// ---- sniff-count rolls ------------------------------------------------------
// `1 + Math.floor(Math.random() * N)` on main, at five call sites. **N is not
// consistent**: 4 at the hearNoise/hunt-giveup/chase-giveup sites, 3 at the
// charge-cleared/flank-entry sites. Preserved exactly per call site, not
// normalised (see wiki systems/unit-testing-standard, LUL-345 section).
//
// LUL-360: read as deliberate, not copy-paste, and kept as-is. The N=4 sites
// are all "the predator just had a real signal on you" (heard a noise, or
// gave up a hunt/chase where it had direct sight/scent lock) -- a longer
// search makes sense off strong evidence. The N=3 sites have weaker or no
// signal: charge-cleared is momentum carrying the predator past you with
// nothing re-acquired yet, and flank-arrival is a pack predator reaching a
// blind ambush point it was routed to, not a point it detected anything at.
// The split is consistent across all five sites with no exceptions, which
// argues against copy-paste (drift from copy-paste is rarely that clean).
// Treat as tuning: if it needs to change, that's a design call, not a nit.
export function rollSniffs(rng: RNG, max: number): number {
  return 1 + Math.floor(rng() * max);
}

// ---- catch check --------------------------------------------------------------
// `dist < p.rad + 1.3`, the two `triggerDeath()` gates in `hunt` and `chase`.
export const CATCH_MARGIN = 1.3;
export function isCaught(dist: number, rad: number): boolean {
  return dist < rad + CATCH_MARGIN;
}

// ---- chase catch gate (LUL-387) -------------------------------------------------
// `chase`'s blind-scent branch keeps closing on the player's live position
// while `scentLock` holds even with no line of sight (LUL-22/LUL-23's "chase
// blind while the trail holds" contract, see updatePredators()) -- but on
// `main` that branch's kill check was bare `isCaught(dist, rad)`, a pure
// distance threshold with no LOS/collision awareness at all (every player<->
// predator "contact" in this game is a distance check, never a solid-body
// collision -- docs/ELEMENTS.md, Player collision profile). Predators never
// collide with cover props either (deliberate, LUL-119/LUL-211), so a
// blind-chasing predator can walk straight through the very bramble/log/rock
// breaking its own sightline and still catch the player hiding behind it.
// `hunt`'s branch already requires `canSee()` before it ever reaches
// `isCaught()`; this gives `chase` the identical guarantee explicitly,
// instead of leaving the kill check gateless whenever the LOS-losing branch
// above doesn't fire (which `scentLock > 0` guarantees it won't).
export function canCatchInChase(canSee: boolean, dist: number, rad: number): boolean {
  return canSee && isCaught(dist, rad);
}

// ---- investigate sniff-approach range ------------------------------------------
// `dist < p.rad + 1.7`, the investigate/approach -> sniff transition. A
// separate, wider margin than the catch check above -- not the same
// threshold reused, so kept as its own named constant/function rather than
// parameterising isCaught's margin.
export const SNIFF_APPROACH_MARGIN = 1.7;
export function hasReachedSniffRange(dist: number, rad: number): boolean {
  return dist < rad + SNIFF_APPROACH_MARGIN;
}

// ---- chase de-escalation ------------------------------------------------------
// `p.scentLock <= 0 && dist > p.spec.detect * 1.5`, the chase -> roam give-up.
export function shouldGiveUpChase(scentLock: number, dist: number, detect: number): boolean {
  return scentLock <= 0 && dist > detect * 1.5;
}

// ---- per-tick timer decay ------------------------------------------------------
// `scentLock` and `chargeCooldown` both tick down unconditionally, in every
// predator state, every frame (lines 903-905 on main). That is load-bearing:
// a `scentLock` set while a predator is in `chase` keeps decaying through
// whatever state it's in next, so by the time `roam` re-checks
// `shouldGiveUpChase`'s `scentLock <= 0` it may already be long expired --
// not reset to a full window on a state change. `callTimer` is deliberately
// NOT included here: on main it only decays inside the `hunt` and `chase`
// branches (not every state), so folding it into an unconditional decay
// would be a behaviour change, not a refactor. It stays inline in the engine.
export interface PredatorTickTimers {
  scentLock: number;
  chargeCooldown: number;
}
export function tickTimers(t: PredatorTickTimers, dt: number): PredatorTickTimers {
  return {
    scentLock: t.scentLock > 0 ? t.scentLock - dt : t.scentLock,
    chargeCooldown: t.chargeCooldown > 0 ? t.chargeCooldown - dt : t.chargeCooldown,
  };
}

// ---- investigate sniff loop (approach -> sniff -> back -> roam) -----------------
// `p.inv === 'sniff'`'s branch: sniffTimer counts down; at expiry,
// sniffsLeft decrements and the loop either continues (back off, then
// re-approach) or gives up back to roam. The random sniffTimer reroll and
// the `sniff()` sfx side effect stay in the engine -- this only decides the
// sniffsLeft/next-phase outcome.
export type SniffLoopOutcome =
  | { done: false }
  | { done: true; sniffsLeft: number; next: 'back' }
  | { done: true; sniffsLeft: number; next: 'roam' };

export function stepSniffLoop(sniffTimer: number, sniffsLeft: number): SniffLoopOutcome {
  if (sniffTimer > 0) return { done: false };
  const remaining = sniffsLeft - 1;
  return remaining > 0
    ? { done: true, sniffsLeft: remaining, next: 'back' }
    : { done: true, sniffsLeft: remaining, next: 'roam' };
}

// ---- flank hold loop (LUL-24) ---------------------------------------------------
// `p.inv === 'hold'`'s branch: same countdown/decrement shape as the
// investigate sniff loop above, but on giving up mid-hold it just re-holds
// (no backoff point) rather than transitioning to 'back'. Kept as its own
// function rather than reusing stepSniffLoop because the two call sites are
// genuinely different transitions in the engine's chain (investigate's
// sniff->back vs. flank's hold->hold-again), matching how the ticket
// separates them.
export type FlankHoldOutcome =
  | { done: false }
  | { done: true; sniffsLeft: number; next: 'hold' }
  | { done: true; sniffsLeft: number; next: 'roam' };

export function stepFlankHold(sniffTimer: number, sniffsLeft: number): FlankHoldOutcome {
  if (sniffTimer > 0) return { done: false };
  const remaining = sniffsLeft - 1;
  return remaining > 0
    ? { done: true, sniffsLeft: remaining, next: 'hold' }
    : { done: true, sniffsLeft: remaining, next: 'roam' };
}

// ---- post-sniff detection immunity (LUL-437) -------------------------------------
// A predator that just gave up an investigate-sniff or flank-hold loop is,
// almost by construction, standing right on top of the exact scent point
// that pulled it in -- `roam`'s checkScent()/checkNoise()/canSee() chain ran
// unconditionally the very next tick, so giving up read as "sniffing always
// ends in getting caught" (LUL-437's report) rather than the predator
// actually losing the trail. `sniffImmuneT` is armed to SNIFF_IMMUNITY_TIME
// wherever stepSniffLoop/stepFlankHold report `done: true` (both the
// continue-looping and give-up-to-roam outcomes) and ticks down like every
// other predator timer. While it holds AND the player is still holding
// still (`hidden`), `roam`'s re-detection chain is skipped for that
// predator -- moving cancels the immunity's protection immediately, same as
// hiding itself already requires holding still.
export const SNIFF_IMMUNITY_TIME = 1.5;
export function isSniffImmune(sniffImmuneT: number, hidden: boolean): boolean {
  return hidden && sniffImmuneT > 0;
}

// ---- investigate re-escalation gate (LUL-562) -------------------------------------
// `investigate`'s `if(!hidden){ p.state='chase'; }` (main, line 1364) fired
// for *any* `p.inv` sub-phase, including a freshly-entered 'approach' --  but
// every `p.state='chase' -> 'investigate'` transition sets `p.inv='approach'`
// fresh, and 'approach' hadn't run its own movement branch yet before this
// check could flip it straight back. If the predator hasn't moved, `chase`'s
// own re-entry condition (`scentLock<=0 && !canSee`) is still true a frame
// later, and the two states volley forever at zero velocity -- the confirmed,
// reproduced livelock in wiki game/lul223-chase-investigate-livelock (bear
// r45, 159 alternating transitions over 51s, zero net movement). The
// original comment at this gate is explicit that it's about the close-range
// phases ("once a predator has closed to sniff range"), which is 'sniff' and
// 'back', not 'approach' -- so restricting the instant revert to those two
// sub-phases is the state-machine fix, not a threshold tweak: a freshly
// entered 'approach' now always runs its own movement code (closing distance
// toward the player) for at least one tick before it can be re-escalated,
// which is enough for `chase`'s condition to stop holding once the predator
// has actually moved.
//
// Known narrow gap, not closed by this function: if a chase loses LOS while
// *already* within `hasReachedSniffRange` of the player (LOS blocked at
// near-point-blank range), 'approach' can still transition straight to
// 'sniff' on its first tick with no movement, and the oscillation reappears
// one level down. Not fixed here -- no reproduction of that specific
// geometry exists (every confirmed repro is a mid-range scentLock chase, see
// the wiki page above), and closing it would mean touching the sniff/back
// sub-loop's own timing, which the ticket is explicit about not retuning.
// Flagged for the tester/VP R&D rather than built speculatively.
export function shouldRevertInvestigateToChase(inv: string, hidden: boolean): boolean {
  return !hidden && (inv === 'sniff' || inv === 'back');
}

// ---- backoff retreat point -------------------------------------------------------
// `p.inv === 'sniff'`'s giving-up-a-sniff retreat point: `dist` units back
// along the predator-to-player line, clamped to the map bounds the same way
// every other waypoint in this file is (`-half+4, half-4`). `dist` is
// pre-rolled by the caller (`8 + Math.random()*8` on main) -- this function
// is pure placement math only, no randomness. `zMax` defaults to `half` for
// a square map; LUL-25's bog band is a rectangle (x stays +-half, z's lower
// bound stays -half but the upper bound extends past it), so callers on that
// map shape pass the extended `zMax` separately -- same asymmetric pattern
// every other waypoint clamp in engine/forest-engine.js already uses.
export function backOffPoint(
  x: number,
  z: number,
  ux: number,
  uz: number,
  dist: number,
  half: number,
  zMax: number = half,
): [number, number] {
  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
  return [clamp(x - ux * dist, -half + 4, half - 4), clamp(z - uz * dist, -half + 4, zMax - 4)];
}
