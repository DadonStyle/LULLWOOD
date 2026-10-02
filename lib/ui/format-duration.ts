// `m:ss` for a run duration. Moved out of components/Hud.tsx (LUL-3264) so the
// leaderboard surfaces render times exactly the way RunRecap does.
export const formatDuration = (totalSeconds: number) => {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};
