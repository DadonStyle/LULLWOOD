// "Be the rescuer" popup content (components/Hud.tsx). Pure, unit-tested.
import { formatDuration } from '../ui/format-duration.ts';
import { COOLDOWN_MS, IP_LIMIT, PLAUSIBILITY_FLOOR_MS } from './leaderboard.ts';

/**
 * The rules a run has to meet to take first place, in the order a player meets
 * them -- the "Be the rescuer" popup renders this list verbatim. Built from the
 * same constants the client gate (LeaderboardSubmitForm) and the server enforce
 * (lib/game/leaderboard.ts -- kept out of that file so the leaderboard service
 * on the founder's server doesn't gain a UI import),
 * so the popup can't drift from what is actually checked. `recordTimeMs` is the
 * current top rescuer's time, or null while the board is empty / unknown.
 */
export function rescuerRules(recordTimeMs: number | null): string[] {
  const floorSeconds = (PLAUSIBILITY_FLOOR_MS / 1000).toFixed(1);
  return [
    'Play on Blackout difficulty (the default).',
    'Keep admin mode off for the whole run. Turning it on even once means that run can\'t count.',
    'Win the run: find the lost child and carry them home.',
    recordTimeMs === null
      ? 'Be the fastest: while no one holds the record yet, any valid win takes first place.'
      : `Be the fastest: beat the current top rescuer's time of ${formatDuration(recordTimeMs / 1000)}.`,
    `The run has to take at least ${floorSeconds} seconds and under an hour. Faster runs are rejected as impossible.`,
    'Your time is the timer in the top-right corner. It is exactly the time the sky balloon will show.',
    'On the win screen, enter a nickname (3-20 letters, a-z only) and pick your country, then submit.',
    `Wait ${COOLDOWN_MS / 1000} seconds between submissions, and at most ${IP_LIMIT} per hour.`,
  ];
}
