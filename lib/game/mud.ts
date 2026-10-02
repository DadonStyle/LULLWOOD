// LUL-5564: Mud Zone terrain hazard -- pure functions, no THREE import, same shape as
// brambleSnagSpeedMultiplier (cover.ts) so the engine and node:test can both call these
// without a Three.js scene.

export const MUD_SPEED_MUL = 0.6;
export const MUD_NOISE_MUL = 1.5;

export interface MudZone {
  x: number;
  z: number;
  r: number;
}

export function mudSpeedMultiplier(inMud: boolean): number {
  return inMud ? MUD_SPEED_MUL : 1;
}

export function mudNoiseMultiplier(inMud: boolean): number {
  return inMud ? MUD_NOISE_MUL : 1;
}

export function isInMudZone(x: number, z: number, mudZones: MudZone[]): boolean {
  for (const m of mudZones) {
    const dx = x - m.x, dz = z - m.z;
    if (dx * dx + dz * dz < m.r * m.r) return true;
  }
  return false;
}
