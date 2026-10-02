// LUL-5820 (LUL-3264 wave 2, S4): sky balloon record-holder display. Same
// pure-module split as lib/game/skyCompass.ts (LUL-5486) -- the billboard
// offset math, the state->text mapping and the canvas draw are all engine-
// independent and unit testable; engine/forest-engine.js is the only caller
// that wraps the draw result in a real THREE.CanvasTexture/Sprite and drives
// the per-frame billboard + fade (see docs/specs/lul-3264-leaderboard-wave2.md
// S4).

import { formatDuration } from '../ui/format-duration.ts';
import { COUNTRY_PALETTES } from './country-palettes.ts';

export type SkyBalloonStatus = 'loading' | 'populated' | 'empty' | 'hidden';

export interface SkyBalloonRecord {
  nickname: string;
  country: string;
  timeMs: number;
}

// Same radius moonGroup already billboards at (forest-engine.js:8846
// `moonGroup.position.copy(camera.position).addScaledVector(moonDir, 300)`),
// so the balloon reads at the same "distance" in the sky as the sun/moon disc.
export const SKY_BALLOON_RADIUS = 300;
// Within the spec's "35-45 degrees away from moonDir around the vertical
// axis" -- any non-zero value in that band satisfies "never shares screen
// space with the sun/moon disc regardless of time of day."
export const SKY_BALLOON_ANGLE_DEG = 40;
// Within the spec's "~1-2s" fade-in-on-first-appearance window.
export const SKY_BALLOON_FADE_DURATION_S = 1.5;
// Within the spec's "~0.75-0.9" semi-transparency band.
export const SKY_BALLOON_OPACITY = 0.85;

export const SKY_BALLOON_CANVAS_WIDTH = 256;
export const SKY_BALLOON_CANVAS_HEIGHT = 96;

/**
 * World-space direction for the balloon group, rotated `angleDeg` around the
 * vertical (Y) axis away from `moonDir` -- same camera-billboard idiom
 * moonGroup uses, offset so the balloon never shares screen space with the
 * sun/moon disc. Rotation about Y preserves vector length, so a unit `moonDir`
 * in always comes out a unit vector.
 */
export function skyBalloonDirection(
  moonDir: { x: number; y: number; z: number },
  angleDeg: number = SKY_BALLOON_ANGLE_DEG,
): { x: number; y: number; z: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    x: moonDir.x * cos + moonDir.z * sin,
    y: moonDir.y,
    z: -moonDir.x * sin + moonDir.z * cos,
  };
}

/**
 * Text + flag-eligibility per PART 2.4's sky column (already decided, not
 * re-derived here). `record` is ignored for 'loading'/'empty'/'hidden'.
 */
export function skyBalloonContent(
  status: SkyBalloonStatus,
  record: SkyBalloonRecord | null,
): { text: string; hasFlag: boolean } {
  if (status === 'loading') return { text: 'loading top rescuer', hasFlag: false };
  if (status === 'empty') return { text: 'be the first — --:--', hasFlag: false };
  if (status === 'populated' && record) {
    return { text: `${record.nickname} — ${formatDuration(record.timeMs / 1000)}`, hasFlag: true };
  }
  return { text: '', hasFlag: false }; // 'hidden', or 'populated' with no record (treated as hidden)
}

/** Minimal 2D-context surface this module needs, same testability idiom as
 * skyCompass.ts's Glyph2DContext -- a plain recording stub stands in for a
 * real CanvasRenderingContext2D in unit tests. */
export interface Balloon2DContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  font: string;
  fillStyle: string;
  textAlign: string;
  textBaseline: string;
}

/**
 * Draws the balloon body, its text, and -- only for a flag-eligible state --
 * 2-3 vertical colour bars from `COUNTRY_PALETTES` next to the text (PART
 * 2.4's "simplest correct rendering," fidelity left to the implementer per
 * PART 2.5). Draws nothing (after the clear) for 'hidden' -- the caller is
 * expected to also hide the sprite group itself, this just keeps the texture
 * blank so nothing stale is left behind if it's ever shown again.
 */
export function drawSkyBalloonTexture(
  ctx: Balloon2DContext,
  status: SkyBalloonStatus,
  record: SkyBalloonRecord | null,
  width: number = SKY_BALLOON_CANVAS_WIDTH,
  height: number = SKY_BALLOON_CANVAS_HEIGHT,
): void {
  ctx.clearRect(0, 0, width, height);
  if (status === 'hidden') return;
  const { text, hasFlag } = skyBalloonContent(status, record);
  // Balloon body -- warm lantern-paper tone, reads through fog like the moon disc.
  ctx.fillStyle = 'rgba(255, 248, 230, 0.92)';
  ctx.fillRect(width * 0.04, height * 0.1, width * 0.92, height * 0.6);
  if (hasFlag && record) {
    const colors = COUNTRY_PALETTES[record.country] ?? [];
    const barWidth = (width * 0.18) / Math.max(1, colors.length);
    colors.forEach((hex, i) => {
      ctx.fillStyle = hex;
      ctx.fillRect(width * 0.06 + i * barWidth, height * 0.16, barWidth, height * 0.48);
    });
  }
  ctx.font = `${Math.round(height * 0.22)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2a1a10';
  ctx.fillText(text, width * (hasFlag ? 0.58 : 0.5), height * 0.4);
}
