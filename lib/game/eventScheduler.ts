// LUL-27: generic recurring-event-cycle math, lifted out so any future timed/
// seasonal/limited-time event can reuse it without re-deriving phase/ramp
// arithmetic per event (see wiki game/lul27-fog-tide). Fog Tide (fogTide.ts)
// is the first event built on this; it owns none of the "is it time yet"
// logic itself.
//
// A cycle is three phases across one `period`-second loop:
//   calm -> signpost (the telegraph window, `leadIn` seconds) -> active
//   (`activeDuration` seconds) -> wraps back to calm.
// `cycleT` is expected to be `elapsed mod period`, already wrapped by the
// caller (the engine owns the accumulator; this module stays a pure function
// of a single already-wrapped instant so it's trivially unit-testable and
// trivially pausable -- the caller simply doesn't advance the accumulator
// while paused, no separate pause flag needed here).

export interface EventCycleConfig {
  /** total loop length, seconds */
  period: number;
  /** how long the event itself is active within the loop, seconds */
  activeDuration: number;
  /** how long before the active phase the telegraph starts, seconds */
  leadIn: number;
}

export type EventCyclePhase = 'calm' | 'signpost' | 'active';

function activeStart(cfg: EventCycleConfig): number {
  return cfg.period - cfg.activeDuration;
}

/** Which phase `cycleT` (elapsed mod period) falls in. */
export function eventCyclePhase(cycleT: number, cfg: EventCycleConfig): EventCyclePhase {
  const start = activeStart(cfg);
  if (cycleT >= start) return 'active';
  if (cycleT >= start - cfg.leadIn) return 'signpost';
  return 'calm';
}

/**
 * 0..1 telegraph signal: 0 through `calm`, ramps linearly to 1 across the
 * `signpost` window, holds at 1 through `active`. Deliberately a raw
 * function of cycle position with no inertia of its own -- callers that
 * want inertia (a slower "thickening" feel, say) layer their own ease on
 * top at whatever rate suits that sense, which a pre-eased signal here
 * couldn't be re-eased for (see fogTide.ts, which eases this one way for
 * the visual effect and another for the audio cue).
 */
export function eventCycleBuildAmount(cycleT: number, cfg: EventCycleConfig): number {
  const start = activeStart(cfg);
  if (cycleT < start - cfg.leadIn) return 0;
  if (cycleT < start) return (cycleT - (start - cfg.leadIn)) / cfg.leadIn;
  return 1;
}

/** 1 while the event should be considered "on" for effect purposes, else 0
 * -- feed this as the target of the caller's own eased ramp (same shape as
 * LUL-382's veilAmount ramping toward lightDimmed's 0/1). */
export function eventCycleActiveTarget(phase: EventCyclePhase): 0 | 1 {
  return phase === 'active' ? 1 : 0;
}
