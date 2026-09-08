// LUL-596 (wave 4 of LUL-277, the last wave): the run-outcome state machine --
// pickup, carry, win, death, restart -- lifted out of five duplicated
// `playing`-predicate copies and five closure-scoped transition functions
// inside engine/forest-engine.js's init() (wiki systems/unit-testing-standard).
// The engine keeps every mutable local (won, dead, pickingUp, carrying,
// baby.taken) and every rendering/audio/pushState/track() side effect --
// this module only owns the pure decisions: is a transition allowed right
// now, and what does state look like after it.

export interface RunState {
  entered: boolean;
  won: boolean;
  dead: boolean;
  pickingUp: boolean;
  carrying: boolean;
  setDown: boolean;
  babyTaken: boolean;
}

export function freshRunState(): RunState {
  return { entered: false, won: false, dead: false, pickingUp: false, carrying: false, setDown: false, babyTaken: false };
}

/** The `entered && !won && !dead && !pickingUp` predicate, duplicated at five
 * call sites in forest-engine.js before this extraction (the keydown
 * handler, pointerlockchange, tick(), and the two touch-trigger functions).
 * `paused` is deliberately not a field here -- tick() is the only one of the
 * five that ANDs it in, and it does so separately at the call site; folding
 * it into this predicate would move a session/UI concern into the outcome
 * state machine. */
export function isPlaying(s: RunState): boolean {
  return s.entered && !s.won && !s.dead && !s.pickingUp;
}

function pickupAllowed(s: RunState): boolean {
  // `!s.carrying` was implied only by `!s.babyTaken` before this extraction
  // (carrying=true always implies babyTaken=true already, they're set
  // together in beginPickup/completePickup) -- made explicit per the ticket,
  // not a behaviour change.
  // `!s.babyTaken` alone would permanently block re-pickup once she's ever been taken --
  // `s.setDown` (LUL-1815) is the one case where a true babyTaken must still allow it.
  return (!s.babyTaken || s.setDown) && !s.won && !s.dead && !s.pickingUp && !s.carrying;
}

/** Gate for the HUD prompt / KeyE-enabled state: proximity plus every flag
 * beginPickup() itself will re-check. `radius` is a parameter, not a
 * module-level constant, so this file never carries its own copy of a
 * CONFIG-driven distance that could silently drift from the engine's. */
export function canPickUp(s: RunState, distToBaby: number, radius: number): boolean {
  return pickupAllowed(s) && distToBaby < radius;
}

/** Starts the pickup cinematic. No-ops (returns `s` unchanged) when not
 * currently allowed, so a second `beginPickup()` call in the same frame (or
 * without a separate canPickUp() check first) is safely rejected. */
export function beginPickup(s: RunState): RunState {
  if (!pickupAllowed(s)) return s;
  return { ...s, babyTaken: true, pickingUp: true, setDown: false };
}

/** Cinematic finished -- hands off from pickingUp to carrying. The ~11.3s
 * timer that decides *when* this fires is the engine's concern (it reads
 * `clock.elapsedTime - pickStart`, a wall-clock read this module must not
 * touch); this is only the state transition once that decision is made. */
export function completePickup(s: RunState): RunState {
  if (!s.pickingUp) return s;
  return { ...s, pickingUp: false, carrying: true };
}

/** Gate for the set-down input: only while actually carrying, and not mid-win/-death
 * (both already imply !carrying via their own transitions, but this stays explicit --
 * same reasoning as pickupAllowed's explicit !s.carrying, see its comment above). No
 * proximity term: unlike pickup, set-down has no target to be near, so there is no
 * canSetDown(state, dist, radius) wrapper the way canPickUp wraps pickupAllowed. */
function setDownAllowed(s: RunState): boolean {
  return s.carrying && !s.won && !s.dead;
}

/** Gate for the HUD prompt / KeyE-enabled state while carrying. Thin export of
 * setDownAllowed(), kept as its own function (not just exporting setDownAllowed
 * directly) for the same reason canPickUp exists alongside pickupAllowed: callers
 * outside this module should never reach for the private `*Allowed` name. */
export function canSetDown(s: RunState): boolean {
  return setDownAllowed(s);
}

/** Puts the child down at the player's current position. No-ops (returns `s` unchanged)
 * when not currently allowed, mirroring beginPickup(). The engine caller is responsible
 * for writing baby.x/z to the player's position -- this module has no coordinates. */
export function beginSetDown(s: RunState): RunState {
  if (!setDownAllowed(s)) return s;
  return { ...s, carrying: false, setDown: true };
}

// LUL-596: this guard did not exist before the extraction. `arriveHome()`
// was safe only because its single call site sat in the `else if(carrying)`
// arm of an if-chain in tick() -- positional safety, not a precondition. A
// second call site, or a reordered chain, would have let a dead player win.
// Requiring `!dead` (and `!won`) here is the fix this wave exists to make
// permanent -- do not simplify it away.
function arriveHomeAllowed(s: RunState): boolean {
  return s.carrying && !s.dead && !s.won;
}

export function canArriveHome(s: RunState, distToHome: number, radius: number): boolean {
  return arriveHomeAllowed(s) && distToHome < radius;
}

export function arriveHome(s: RunState): RunState {
  if (!arriveHomeAllowed(s)) return s;
  return { ...s, won: true, carrying: false };
}

/** Deliberately excludes `carrying` from the guard -- you can be caught
 * carrying the child, death still lands. Deliberately includes `pickingUp`
 * in the guard -- death during the ~11.3s pickup cinematic is ignored on
 * purpose, a pre-existing invulnerability window this extraction must pin,
 * not "fix". If it looks wrong, file a P3 and leave the behaviour alone
 * (wiki systems/unit-testing-standard). */
export function canTriggerDeath(s: RunState): boolean {
  return !s.dead && !s.won && !s.pickingUp;
}

export function triggerDeath(s: RunState): RunState {
  if (!canTriggerDeath(s)) return s;
  return { ...s, dead: true };
}

/** Gate for regenMap() (the admin-panel "New map" dev tool, LUL-1585): a fresh
 * map mid-outcome would pull the ground out from under an in-progress win/death
 * cutscene. Mirrors canTriggerDeath's dead/won shape; deliberately does not gate
 * on pickingUp/carrying -- regenerating while carrying is a dev-tool footgun,
 * not a state-machine violation, so it's left alone (wiki systems/unit-testing-standard). */
export function canRegenMap(s: RunState): boolean {
  return !s.dead && !s.won;
}

/** Gate for both the HUD "pick up stone" prompt and the grab input itself. Mirrors
 * canPickUp()'s shape (proximity + one flag) but the flag is "already holding one",
 * not run-phase -- you can grab a throwable in any playable state, including while
 * carrying the child (CTO plan decision 6: carry-leg is the intended beneficiary). */
export function canGrabThrowable(heldThrowable: boolean, distToThrowable: number, radius: number): boolean {
  return !heldThrowable && distToThrowable < radius;
}

/** Gate for the throw input: must actually be holding one. No other precondition --
 * throwing while carrying, while investigate/chase is active, etc. are all allowed. */
export function canThrowThrowable(heldThrowable: boolean): boolean {
  return heldThrowable;
}
