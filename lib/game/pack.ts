// LUL-593 (wave 4 of LUL-277): pure wolf-pack coordination geometry lifted
// out of updateWolfPack() (engine/forest-engine.js), unit tested without a
// Three.js scene or a running render loop (see wiki
// systems/unit-testing-standard). LUL-24: the instant one wolf enters
// `chase` (the "point"), the other two path to points +-60deg off the
// player's live escape heading, at ~1.4x each flanker's own current
// distance from the player, so the pack reads as a closing shape, not three
// animals converging on one spot. Wolves only -- bears stay solitary and
// lions' stalk/circle is a separate system.
//
// Deliberately a separate module from predator.ts, not an addition to it:
// that module's own header scopes it to the "per-predator step block" --
// this is multi-predator coordination (which wolf leads, where the other
// two go), a different concern even though it feeds the same state machine.
//
// The engine still owns every side effect and all mutable predator/pack
// state (packTimer decay, iterating `predators`, assigning p.state/p.flankX/
// p.flankZ/p.packTimer) -- this module only owns "given the pack's current
// geometry, who leads and where do the flankers go."

export const FLANK_ANGLE = Math.PI / 3; // 60 degrees either side of the escape heading
export const FLANK_DIST_MUL = 1.4;
export const FLANK_RECOMPUTE = 0.5; // budget cap: one path recompute per wolf per 0.5s
export const FLANK_ARRIVE_R = 4;
export const FLANK_SPEED_MUL = 0.7; // purposeful trot: faster than roam, short of a chase sprint

export interface Point {
  x: number;
  z: number;
}

/**
 * Which of the current chasers the pack orients its pincer on: whichever is
 * actually closest to the player right now, not just the first one that
 * entered `chase`. Returns -1 for an empty list (mirrors the engine's own
 * `if(!chasers.length) return` short-circuit -- callers are expected to
 * check that first, same as the engine does, but this stays total rather
 * than throwing).
 */
export function selectPackLeaderIndex(chasers: readonly Point[], playerX: number, playerZ: number): number {
  if (chasers.length === 0) return -1;
  let leaderIdx = 0;
  let leaderDist = Math.hypot(playerX - chasers[0].x, playerZ - chasers[0].z);
  for (let i = 1; i < chasers.length; i++) {
    const d = Math.hypot(playerX - chasers[i].x, playerZ - chasers[i].z);
    if (d < leaderDist) {
      leaderIdx = i;
      leaderDist = d;
    }
  }
  return leaderIdx;
}

export interface FlankBounds {
  half: number;
  zMax: number;
}

/**
 * Where a flanker paths to: rotate the player's live escape heading
 * (`escX`/`escZ`, LUL-24 -- recorded off the player's actual movement
 * direction, not the wolf's) by `FLANK_ANGLE * side` (side is +-1, callers
 * alternate it per flanker so the two go to opposite sides), scale by the
 * flanker's own current distance from the player times FLANK_DIST_MUL, then
 * clamp into the map bounds. Same `-half+4 .. half-4` / `-half+4 .. zMax-4`
 * clamp shape as predator.ts's backOffPoint -- every other waypoint clamp in
 * this codebase uses that same 4-unit margin.
 */
export function flankTarget(
  playerX: number,
  playerZ: number,
  escX: number,
  escZ: number,
  side: 1 | -1,
  wolfX: number,
  wolfZ: number,
  bounds: FlankBounds,
): [number, number] {
  const { half, zMax } = bounds;
  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
  const ang = FLANK_ANGLE * side;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const ex = escX * ca - escZ * sa;
  const ez = escX * sa + escZ * ca;
  const dist = Math.hypot(playerX - wolfX, playerZ - wolfZ) * FLANK_DIST_MUL;
  return [clamp(playerX + ex * dist, -half + 4, half - 4), clamp(playerZ + ez * dist, -half + 4, zMax - 4)];
}
