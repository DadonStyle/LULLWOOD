// LUL-382: pure mist-veil resource + detection math, lifted out so it can be
// unit tested without a Three.js scene or a running render loop (see wiki
// systems/unit-testing-standard). The engine (engine/forest-engine.js, tick())
// owns everything about how the veil *looks* -- fog density, the follow-light
// swap, the vignette -- this module only owns the charge/lock state machine
// and the two multipliers derived from it.
//
// Supersedes LUL-291's flat DIM_DETECT_MUL: the founder judged a 25% sight cut
// on a free hold too small a lever (decisions/0012-feature-impact-bar). This
// is a bigger cut (VEIL_DETECT_MUL), ramped by how visibly "up" the mist is
// rather than snapping instantly, and it is not free -- VEIL_MAX_HOLD seconds
// of continuous use drains the charge to empty and locks the veil out until it
// has regenerated back past VEIL_UNLOCK_CHARGE. One genre search (LUL-215):
// stealth/horror smoke/flare tools break line-of-sight tracking specifically,
// as a limited spendable resource, not an unlimited toggle -- confirms both
// the sight-only scope of veilDetectMul() and the resource framing here.

export interface VeilChargeState {
  /** 1 = full, 0 = fully drained. */
  charge: number;
  /** true from the frame a full drain happens until charge regenerates past
   * VEIL_UNLOCK_CHARGE -- while locked, holding the trigger key does nothing. */
  locked: boolean;
}

export const VEIL_MAX_HOLD = 5;          // seconds of continuous hold before a full drain
export const VEIL_REGEN_MUL = 0.5;       // regen rate vs. drain rate -- refill is slower than spend
export const VEIL_UNLOCK_CHARGE = 0.3;   // fraction of charge required to recover from a full-drain lock
// sight-detect range multiplier at full ramp (veilAmount = 1) -- a 65% cut,
// vs. LUL-291's 25% (DIM_DETECT_MUL 0.75).
export const VEIL_DETECT_MUL = 0.35;

/** Advances the charge/lock state machine by one frame and decides whether
 * the veil is actually allowed to be active -- `held` alone isn't enough,
 * a locked-out or empty veil ignores the held key entirely.
 *
 * `maxHold` defaults to VEIL_MAX_HOLD and is the LUL-1043 (Embers) Deeper
 * Lungs lever -- callers pass a larger value once tiers are purchased so a
 * full hold drains slower (and, symmetrically, a full regen also takes
 * longer). Every existing call site that omits it keeps today's behaviour
 * exactly, so this is additive, not a retune. */
export function stepVeilCharge(
  state: VeilChargeState,
  held: boolean,
  dt: number,
  maxHold: number = VEIL_MAX_HOLD,
): VeilChargeState & { active: boolean } {
  let { charge, locked } = state;
  if (locked && charge >= VEIL_UNLOCK_CHARGE) locked = false;
  const active = held && !locked && charge > 0;
  if (active) {
    charge = Math.max(0, charge - dt / maxHold);
    if (charge <= 0) locked = true;
  } else {
    charge = Math.min(1, charge + (dt / maxHold) * VEIL_REGEN_MUL);
  }
  return { charge, locked, active };
}

/** `veilAmount` is the eased 0..1 ramp the engine drives off the veil's
 * active/inactive transitions (tick()). At 0 this is 1 (no cut); at 1 it's
 * VEIL_DETECT_MUL (the full cut). Sight only -- callers should leave scent
 * detection untouched, same scope LUL-291 already had. */
export function veilDetectMul(veilAmount: number): number {
  return 1 - veilAmount * (1 - VEIL_DETECT_MUL);
}

/** Fog density for the current frame -- ramps from the player's own baseline
 * ("Mist" slider, `fogBase`) up to `mistVeilFog` as `veilAmount` climbs to 1,
 * and back down to `fogBase` as it falls, rather than a hardcoded floor. */
export function veilFogDensity(fogBase: number, mistVeilFog: number, veilAmount: number): number {
  return fogBase + (mistVeilFog - fogBase) * veilAmount;
}
