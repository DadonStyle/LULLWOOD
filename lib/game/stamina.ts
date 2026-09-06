export interface StaminaState {
  /** 1 = full, 0 = fully drained. */
  charge: number;
}

// Seconds of continuous sprinting to fully drain from full charge.
export const STAMINA_DRAIN_TIME = 6;
// Regen rate vs. drain rate -- refill is slower than spend, same asymmetry as
// VEIL_REGEN_MUL (lib/game/veil.ts:27) and for the same reason: a resource that
// refills as fast as it drains isn't a real cost.
export const STAMINA_REGEN_MUL = 0.4;
// Sprint multiplier at full charge -- matches the existing hardcoded literal at
// engine/forest-engine.js:2996 (walk*1.8). This module becomes the single source
// of truth for it; the engine call site below stops hardcoding 1.8.
export const STAMINA_SPRINT_MUL = 1.8;

/** Advances the charge by one frame. `sprinting` is the engine's existing
 * `running` flag (true whenever the sprint control is held/toggled-on),
 * regardless of whether the player is actually moving this frame -- same
 * "held is held" framing as stepVeilCharge, not gated on movement. */
export function stepStamina(state: StaminaState, sprinting: boolean, dt: number): StaminaState {
  let { charge } = state;
  if (sprinting) {
    charge = Math.max(0, charge - dt / STAMINA_DRAIN_TIME);
  } else {
    charge = Math.min(1, charge + (dt / STAMINA_DRAIN_TIME) * STAMINA_REGEN_MUL);
  }
  return { charge };
}

/** Sprint speed multiplier for the current charge: STAMINA_SPRINT_MUL at charge=1,
 * decaying linearly to 1 (walk speed, no bonus) at charge=0. Never below 1 --
 * a drained player still moves at walk speed, never slower than walking. */
export function sprintSpeedMul(charge: number): number {
  return 1 + (STAMINA_SPRINT_MUL - 1) * charge;
}
