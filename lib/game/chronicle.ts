// LUL-1103: The Run Chronicle. Pure formatter -- no DOM, no Three.js, unit
// testable on its own. The engine owns the *buffer* (a flat {t, code, args}
// array appended by logChronicle() in engine/forest-engine.js, handed to
// React once at win/death, never streamed through pushState -- see that
// file's comment on hudState's shallow-compare re-emit trap). This module
// only turns that buffer into player-facing lines.
//
// ~8 codes to start, not 300 (Cogmind's own ceiling took years to reach).
// Add codes here as later tickets earn them -- see the ticket's own
// "not a justification for scope" note.

export type ChronicleCode =
  | 'scent_lock'
  | 'predator_gave_up'
  | 'hide'
  | 'pickup'
  | 'fog_tide_start'
  | 'fog_tide_end'
  | 'win'
  | 'death';

export interface ChronicleEvent {
  t: number; // seconds since run start (clock.elapsedTime - enteredAt)
  code: ChronicleCode;
  args?: Record<string, unknown> | null;
}

// Display names for engine/tuning.ts's LANDMARKS `kind`s -- none of the four
// fixed landmarks are ever named in a player-facing string today (grepped
// components/, app/, engine/ -- only source comments use these words), so
// this is the first place they get one.
const LANDMARK_NAMES: Record<string, string> = {
  fireTower: 'the Fire Tower',
  stoneMarker: 'the Leaning Stone',
  oak: 'the Split Oak',
  drownedCar: 'the Drowned Car',
};

interface Point { x: number; z: number }

// Nearest named place to (x,z), or null if nothing is close enough to be
// worth naming -- most run events happen nowhere near a landmark, and a
// chronicle line that names one 200 units away would just be noise.
export function nearestLandmarkName(
  x: number,
  z: number,
  landmarks: (Point & { kind: string })[],
  home: Point,
  lake: Point,
  maxDist = 45,
): string | null {
  const points: (Point & { name: string })[] = [
    ...landmarks.map((l) => ({ x: l.x, z: l.z, name: LANDMARK_NAMES[l.kind] || l.kind })),
    { x: home.x, z: home.z, name: 'the Cabin' },
    { x: lake.x, z: lake.z, name: 'the Lake' },
  ];
  let best: (Point & { name: string }) | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best && bestDist <= maxDist ? best.name : null;
}

function fmtTime(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const HIDE_KIND_LABEL: Record<string, string> = { bramble: 'the brambles', log: 'a hollow log' };

function lineFor(ev: ChronicleEvent): string {
  const a = ev.args || {};
  const kind = typeof a.kind === 'string' ? a.kind : 'predator';
  const landmark = typeof a.landmark === 'string' ? a.landmark : null;
  const near = landmark ? ` near ${landmark}` : '';
  switch (ev.code) {
    case 'scent_lock': return `a ${kind} caught your scent${near}.`;
    case 'predator_gave_up': return `the ${kind} lost your trail.`;
    case 'hide': return `you went still in ${HIDE_KIND_LABEL[String(a.kind)] || 'cover'}.`;
    case 'pickup': return 'you lifted the child.';
    case 'fog_tide_start': return 'a fog tide rolled in.';
    case 'fog_tide_end': return 'the fog tide passed.';
    case 'win': return 'you lifted her into the light.';
    case 'death': return `a ${kind} caught you${near}.`;
    default: return '';
  }
}

// Renders oldest-first (chronological), capped so a long run can't overflow
// the death/win screen -- see components/GameCanvas.tsx's #deathText/#winText
// max-height fix landed in the same PR.
export function formatChronicle(events: ChronicleEvent[], maxLines = 10): string[] {
  return events.slice(-maxLines).map((ev) => `${fmtTime(ev.t)} — ${lineFor(ev)}`);
}
