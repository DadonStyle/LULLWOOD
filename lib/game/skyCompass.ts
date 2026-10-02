// LUL-5486: cardinal glyphs painted at world-space positions (real THREE
// objects, same trick as the star field/moon disc two lines below their
// setup in engine/forest-engine.js -- placed far out in the scene graph so
// they read as camera-orientation-dependent for free, unlike scene.background
// which is a flat, non-rotating backdrop; see LUL-5485/LUL-5486 for why the
// original "bake glyphs into the sky gradient canvas" proposal doesn't work).
//
// Pure module: no THREE import, no `document`/DOM access. `drawSkyCompassGlyph`
// takes a minimal 2D-context-shaped object so it's testable with a plain
// recording stub; the engine is the only caller that hands it a real
// CanvasRenderingContext2D and wraps the result in a THREE.CanvasTexture.

export type SkyCompassGlyph = 'N' | 'E' | 'S' | 'W';

export const SKY_COMPASS_GLYPHS: readonly SkyCompassGlyph[] = ['N', 'E', 'S', 'W'];

// Ground-plane (y=0) unit vectors. North = -Z, East = +X, South = +Z, West = -X --
// a fixed convention this module defines (nothing upstream picks one), right-handed
// to match THREE's default and the engine's existing x/z world axes.
export const SKY_COMPASS_DIRECTIONS: Readonly<Record<SkyCompassGlyph, Readonly<{ x: number; z: number }>>> = {
  N: { x: 0, z: -1 },
  E: { x: 1, z: 0 },
  S: { x: 0, z: 1 },
  W: { x: -1, z: 0 },
};

// Inside the 300u star sphere (engine/forest-engine.js STAR radius) so sprites
// never clip through it.
export const SKY_COMPASS_RADIUS = 280;

export interface SkyCompassPosition { x: number; y: number; z: number; }

/** World-space position of one cardinal glyph, `radius` units out from the origin. */
export function skyCompassPosition(glyph: SkyCompassGlyph, radius: number = SKY_COMPASS_RADIUS): SkyCompassPosition {
  const dir = SKY_COMPASS_DIRECTIONS[glyph];
  return { x: dir.x * radius, y: 0, z: dir.z * radius };
}

// Faint per TOD_VISUAL -- readable but not a HUD element (this is a background
// object, Section 0 Q1-Q10 n/a: no EngineHudState field, nothing to render-site).
export const SKY_COMPASS_MIN_OPACITY = 0.08;
export const SKY_COMPASS_MAX_OPACITY = 0.12;

export const SKY_COMPASS_CANVAS_SIZE = 64;

/** Minimal 2D-context surface this module needs, so a unit test can pass a
 * plain recording stub instead of a real CanvasRenderingContext2D/DOM. */
export interface Glyph2DContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  textAlign: string;
  textBaseline: string;
}

/**
 * Draws one glyph centered on a `size`x`size` context. Day is a filled serif
 * glyph; night is hollow (stroke-only) serif -- per the proposal's "serif day
 * / hollow serif night" spec. `color` is a CSS color string; the engine
 * derives it from TOD_VISUAL.sunMoonColor so the glyphs read as lit by the
 * same light source as the sun/moon disc.
 */
export function drawSkyCompassGlyph(
  ctx: Glyph2DContext,
  glyph: SkyCompassGlyph,
  isNight: boolean,
  color: string,
  size: number = SKY_COMPASS_CANVAS_SIZE,
): void {
  ctx.clearRect(0, 0, size, size);
  ctx.font = `${Math.round(size * 0.62)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (isNight) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.045);
    ctx.strokeText(glyph, size / 2, size / 2);
  } else {
    ctx.fillStyle = color;
    ctx.fillText(glyph, size / 2, size / 2);
  }
}
