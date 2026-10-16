// `m:ss` for a run duration. Moved out of components/Hud.tsx (LUL-3264) so the
// leaderboard surfaces render times exactly the way RunRecap does.
export const formatDuration = (totalSeconds: number) => {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};

// A run's time exactly as the leaderboard will store and show it: the submit
// form sends Math.round(survivedSeconds * 1000) ms and the sky balloon formats
// that back with formatDuration(ms / 1000). The top-right run timer and the win
// recap use this so all three always read the same.
export const formatRunTime = (seconds: number) => formatDuration(Math.round(seconds * 1000) / 1000);
