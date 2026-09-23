export const VEIL_OVERLOAD_DURATION = 7;   // seconds -- middle of the CEO-accepted 6-8s
                                            // range; Economist has not priced the exact
                                            // number as of this spec (follow-up tuning pass)

/** true from the frame activation happens until the countdown reaches 0. */
export function isVeilOverloadActive(veilOverloadChargeT: number): boolean {
  return veilOverloadChargeT > 0;
}
