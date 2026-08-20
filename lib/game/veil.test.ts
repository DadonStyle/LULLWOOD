import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stepVeilCharge,
  veilDetectMul,
  veilFogDensity,
  VEIL_MAX_HOLD,
  VEIL_REGEN_MUL,
  VEIL_UNLOCK_CHARGE,
  VEIL_DETECT_MUL,
  type VeilChargeState,
} from './veil.ts';

// ---- stepVeilCharge: basic hold/release -----------------------------------

test('holding from full charge activates immediately and drains at 1/VEIL_MAX_HOLD per second', () => {
  const s0: VeilChargeState = { charge: 1, locked: false };
  const s1 = stepVeilCharge(s0, true, 1);
  assert.equal(s1.active, true);
  assert.ok(Math.abs(s1.charge - (1 - 1 / VEIL_MAX_HOLD)) < 1e-9);
  assert.equal(s1.locked, false);
});

test('not holding is never active, and charge regenerates toward 1', () => {
  const s0: VeilChargeState = { charge: 0.5, locked: false };
  const s1 = stepVeilCharge(s0, false, 1);
  assert.equal(s1.active, false);
  assert.ok(s1.charge > 0.5);
  assert.ok(s1.charge <= 1);
});

test('regen rate is VEIL_REGEN_MUL times the drain rate', () => {
  const drained = stepVeilCharge({ charge: 1, locked: false }, true, 1);
  const regened = stepVeilCharge({ charge: 0, locked: false }, false, 1);
  const drainAmount = 1 - drained.charge;
  assert.ok(Math.abs(regened.charge - drainAmount * VEIL_REGEN_MUL) < 1e-9);
});

test('charge never goes below 0 or above 1', () => {
  const over = stepVeilCharge({ charge: 0.01, locked: false }, true, 10);
  assert.equal(over.charge, 0);
  const under = stepVeilCharge({ charge: 0.99, locked: false }, false, 10);
  assert.equal(under.charge, 1);
});

// ---- full drain -> forced release + lockout --------------------------------

test('a full continuous hold drains exactly to 0 over VEIL_MAX_HOLD seconds and locks', () => {
  const s: VeilChargeState = { charge: 1, locked: false };
  const result = stepVeilCharge(s, true, VEIL_MAX_HOLD);
  assert.equal(result.charge, 0);
  assert.equal(result.locked, true);
  assert.equal(result.active, true); // this frame still drew the veil down to empty
});

test('once locked, holding the key does nothing -- veil is inactive even though held', () => {
  const locked: VeilChargeState = { charge: 0.1, locked: true };
  const s = stepVeilCharge(locked, true, 0.016);
  assert.equal(s.active, false);
});

test('a locked veil regenerates (does not get stuck at 0 forever)', () => {
  const s = stepVeilCharge({ charge: 0, locked: true }, true, 1); // still held, but locked -- should still regen
  assert.ok(s.charge > 0);
});

test('locked stays locked until charge crosses VEIL_UNLOCK_CHARGE, not the instant it leaves 0', () => {
  let s = stepVeilCharge({ charge: 0, locked: true }, true, 0);
  // step forward in small increments while "held" the whole time
  for (let i = 0; i < 100 && s.charge < VEIL_UNLOCK_CHARGE; i++) {
    s = stepVeilCharge(s, true, 0.05);
    assert.equal(s.active, false, `should stay inactive while locked, charge=${s.charge}`);
  }
  assert.ok(s.charge >= VEIL_UNLOCK_CHARGE);
});

test('unlocks and reactivates on the frame charge reaches VEIL_UNLOCK_CHARGE, if still held', () => {
  const justBelow: VeilChargeState = { charge: VEIL_UNLOCK_CHARGE - 0.001, locked: true };
  const stillLocked = stepVeilCharge(justBelow, true, 0); // dt=0, no change in charge this frame
  assert.equal(stillLocked.locked, true);
  assert.equal(stillLocked.active, false);

  const atThreshold: VeilChargeState = { charge: VEIL_UNLOCK_CHARGE, locked: true };
  const unlocked = stepVeilCharge(atThreshold, true, 0);
  assert.equal(unlocked.locked, false);
  assert.equal(unlocked.active, true);
});

test('releasing before a full drain never locks -- partial use is free to resume', () => {
  const partial: VeilChargeState = { charge: 0.4, locked: false };
  const released = stepVeilCharge(partial, false, 0.5);
  assert.equal(released.locked, false);
  const reactivated = stepVeilCharge(released, true, 0);
  assert.equal(reactivated.active, true);
});

// ---- veilDetectMul -----------------------------------------------------------

test('veilDetectMul is 1 (no cut) at veilAmount=0', () => {
  assert.equal(veilDetectMul(0), 1);
});

test('veilDetectMul is VEIL_DETECT_MUL at veilAmount=1 (full ramp)', () => {
  assert.ok(Math.abs(veilDetectMul(1) - VEIL_DETECT_MUL) < 1e-9);
});

test('veilDetectMul interpolates linearly between the two', () => {
  const half = veilDetectMul(0.5);
  assert.ok(Math.abs(half - (1 - 0.5 * (1 - VEIL_DETECT_MUL))) < 1e-9);
});

// ---- veilFogDensity -----------------------------------------------------------

test('veilFogDensity is fogBase at veilAmount=0', () => {
  assert.equal(veilFogDensity(0.04, 0.34, 0), 0.04);
});

test('veilFogDensity is mistVeilFog at veilAmount=1', () => {
  assert.equal(veilFogDensity(0.04, 0.34, 1), 0.34);
});

test('veilFogDensity ramps from whatever fogBase the player last set, not a hardcoded floor', () => {
  // a player who cranked the manual Mist slider to its own max (0.11) still
  // ramps up to the full veil density, not back down past their own setting
  assert.equal(veilFogDensity(0.11, 0.34, 1), 0.34);
  assert.equal(veilFogDensity(0.11, 0.34, 0), 0.11);
});
