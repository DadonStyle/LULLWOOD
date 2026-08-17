// LUL-213: pure jump-arc math, lifted out so it can be unit tested without a
// Three.js scene (see wiki systems/unit-testing-standard) -- the engine only
// tracks `jumping`/`jumpElapsed` and calls jumpOffset(elapsed) once per frame
// to get the camera's extra height. Same parabola serves both the ambient
// "press Space any time" hop and the predator-charge dodge -- there is only
// ever one jump.

export const JUMP_DURATION = 0.6; // seconds, ground -> peak -> ground
export const JUMP_HEIGHT = 1.1; // units, height at the midpoint

/** Height above ground at `t` seconds into the jump. 0 before start, 0 from
 * JUMP_DURATION on -- callers clamp/stop advancing `t` there, this just
 * never lies about being airborne outside the arc. */
export function jumpOffset(t: number): number {
  if (t <= 0 || t >= JUMP_DURATION) return 0;
  const u = t / JUMP_DURATION;
  return JUMP_HEIGHT * 4 * u * (1 - u); // parabola, peaks at u=0.5
}
