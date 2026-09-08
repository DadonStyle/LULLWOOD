export const CAVE_IMMUNITY_TIME = 25;   // seconds -- founder's 20-30s window, middle value

/** true from the frame activation happens until the countdown reaches 0. */
export function isCaveImmune(caveImmuneT: number): boolean {
  return caveImmuneT > 0;
}
