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

// moonGroup billboards at 300 (`moonGroup.position.copy(camera.position)
// .addScaledVector(moonDir, 300)`). The balloon sits nearer so it always draws
// in front of the sun/moon disc and its halo where the big 3D name overlaps
// them, and the whole group is scaled by SKY_BALLOON_SCALE so it keeps the size
// on screen it was designed at (every size below is in "at 300" units).
export const SKY_BALLOON_MOON_RADIUS = 300;
export const SKY_BALLOON_RADIUS = 250;
export const SKY_BALLOON_SCALE = SKY_BALLOON_RADIUS / SKY_BALLOON_MOON_RADIUS;
// Within the spec's "35-45 degrees away from moonDir around the vertical
// axis" -- any non-zero value in that band satisfies "never shares screen
// space with the sun/moon disc regardless of time of day."
export const SKY_BALLOON_ANGLE_DEG = 40;
// Within the spec's "~1-2s" fade-in-on-first-appearance window.
export const SKY_BALLOON_FADE_DURATION_S = 1.5;
// Within the spec's "~0.75-0.9" semi-transparency band.
export const SKY_BALLOON_OPACITY = 0.85;

// Bottom row canvas (flag + "time:" + time, or the loading/empty text) and the
// small label canvas above the name ("The top rescuer:"). Both are drawn at the
// same pixels-per-world-unit (same width, same sprite width), so a font size in
// one matches the other on screen.
export const SKY_BALLOON_CANVAS_WIDTH = 512;
export const SKY_BALLOON_CANVAS_HEIGHT = 96;
export const SKY_BALLOON_LABEL_CANVAS_HEIGHT = 64;
// Canvas font sizes: the small label font ("The top rescuer:", "time:") and the
// big plain font for the time itself.
export const SKY_BALLOON_LABEL_FONT_PX = 44;
export const SKY_BALLOON_TIME_FONT_PX = 72;
export const SKY_BALLOON_LABEL_TEXT = 'The top rescuer:';

// The record-holder's nickname is spelled in 3D balloon letters, one mesh per
// letter A-Z from public/models/letter-balloons.glb ("Letter-balloons" by
// danny_p3d, CC BY 4.0 -- see CREDITS.md; the start gate carries the
// attribution). Each letter mesh has a cap height of 1 and its own width in
// `userData.width`. New nicknames are letters only (NICKNAME_PATTERN); records
// saved before that may still hold digits, which the balloon simply drops.
// The canvas sprite under the name keeps the flag + time.
export const SKY_BALLOON_LETTERS_URL = '/models/letter-balloons.glb';
// World units at SKY_BALLOON_RADIUS: letter cap height, and the widest the
// whole name may get before it scales down (fits a landscape 70-degree view).
export const SKY_BALLOON_LETTER_HEIGHT = 90;
export const SKY_BALLOON_NAME_MAX_WIDTH = 520;
// World width of both canvas sprites; heights follow each canvas's ratio.
export const SKY_BALLOON_SPRITE_WIDTH = 300;
// Rows, top to bottom, in group-local units: label, 3D name, flag + time (y 0).
export const SKY_BALLOON_LABEL_Y = 150;
export const SKY_BALLOON_NAME_Y = 80;
// Gap between letters, in cap heights.
export const SKY_BALLOON_LETTER_GAP = 0.08;
// Flag images (flag-icons, MIT -- CREDITS.md), one 4:3 PNG per allowed country.
export function skyBalloonFlagUrl(country: string): string {
  return `/flags/${country.toLowerCase()}.png`;
}

/** The nickname as balloon letters: upper-cased, anything but A-Z dropped. */
export function skyBalloonNameLetters(nickname: string): string[] {
  return [...nickname.toUpperCase()].filter((ch) => /^[A-Z]$/.test(ch));
}

/**
 * Lays the glyphs out left to right, centred on x = 0. `widths` are in cap
 * heights (the model's units); the result is in world units. The name is
 * drawn at `letterHeight` unless that would make it wider than `maxWidth`, in
 * which case the whole row scales down to fit.
 */
export function layoutSkyBalloonName(
  widths: number[],
  letterHeight: number = SKY_BALLOON_LETTER_HEIGHT,
  maxWidth: number = SKY_BALLOON_NAME_MAX_WIDTH,
  gap: number = SKY_BALLOON_LETTER_GAP,
): { scale: number; xs: number[]; width: number } {
  if (widths.length === 0) return { scale: letterHeight, xs: [], width: 0 };
  const units = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  const scale = Math.min(letterHeight, maxWidth / units);
  const xs: number[] = [];
  let cursor = -(units * scale) / 2;
  for (const w of widths) {
    xs.push(cursor + (w * scale) / 2);
    cursor += (w + gap) * scale;
  }
  return { scale, xs, width: units * scale };
}

/** Gentle per-letter float so the name reads as balloons on strings, not a
 * rigid sign. Phase-shifted by index so neighbours don't move in lockstep.
 * `amplitude` is in world units. */
export function skyBalloonLetterBob(index: number, t: number, amplitude: number): { y: number; tilt: number } {
  const phase = t * 1.3 + index * 0.9;
  return { y: Math.sin(phase) * amplitude, tilt: Math.sin(phase * 0.7 + 1.1) * 0.06 };
}

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
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void;
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineJoin: string;
  textAlign: string;
  textBaseline: string;
}

const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function setFont(ctx: Balloon2DContext, px: number): void {
  ctx.font = `bold ${Math.round(px)}px ${FONT_FAMILY}`;
}

// Plain big text, white with a dark outline so it reads against day sky and night alike.
function drawPlainText(ctx: Balloon2DContext, text: string, x: number, y: number, px: number): void {
  ctx.lineWidth = Math.max(2, px * 0.12);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20, 14, 8, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff8e8';
  ctx.fillText(text, x, y);
}

/**
 * Bottom row of the sky balloon, plain text (no bubbles). Populated: the
 * country flag (picture once loaded, palette bars until then), then "time:" in
 * the small label font, then the time in the big font, all centred together.
 * With `nameInModel` false (letter model still loading or failed) the nickname
 * leads the row instead, so the record holder is never missing. Loading/empty
 * draw their own text in the big font. Everything shrinks to fit the width.
 * Hidden only clears -- the caller also hides the group.
 */
export function drawSkyBalloonTexture(
  ctx: Balloon2DContext,
  status: SkyBalloonStatus,
  record: SkyBalloonRecord | null,
  width: number = SKY_BALLOON_CANVAS_WIDTH,
  height: number = SKY_BALLOON_CANVAS_HEIGHT,
  nameInModel: boolean = false,
  flagImage: unknown = null,
): void {
  ctx.clearRect(0, 0, width, height);
  if (status === 'hidden') return;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const maxWidth = width * 0.94;
  const centerY = height / 2;

  if (status !== 'populated' || !record) {
    const { text } = skyBalloonContent(status, record);
    if (!text) return;
    setFont(ctx, SKY_BALLOON_TIME_FONT_PX);
    const fit = Math.min(1, maxWidth / Math.max(1, ctx.measureText(text).width));
    const px = SKY_BALLOON_TIME_FONT_PX * fit;
    setFont(ctx, px);
    drawPlainText(ctx, text, (width - ctx.measureText(text).width) / 2, centerY, px);
    return;
  }

  // Measure at full size, then scale every piece by one factor to fit.
  const lead = nameInModel ? '' : `${record.nickname} `;
  const timeText = formatDuration(record.timeMs / 1000);
  const flagH = height * 0.5;
  const flagW = flagH * (4 / 3);
  const gap = width * 0.02;
  setFont(ctx, SKY_BALLOON_TIME_FONT_PX);
  const leadW = lead ? ctx.measureText(lead).width : 0;
  const timeW = ctx.measureText(timeText).width;
  setFont(ctx, SKY_BALLOON_LABEL_FONT_PX);
  const labelW = ctx.measureText('time:').width;
  const total = leadW + flagW + gap + labelW + gap + timeW;
  const k = Math.min(1, maxWidth / total);

  let x = (width - total * k) / 2;
  if (lead) {
    setFont(ctx, SKY_BALLOON_TIME_FONT_PX * k);
    drawPlainText(ctx, lead, x, centerY, SKY_BALLOON_TIME_FONT_PX * k);
    x += leadW * k;
  }
  const fw = flagW * k, fh = flagH * k;
  if (flagImage) {
    ctx.drawImage(flagImage, x, centerY - fh / 2, fw, fh);
  } else {
    const colors = COUNTRY_PALETTES[record.country] ?? [];
    const barW = fw / Math.max(1, colors.length);
    colors.forEach((hex, i) => {
      ctx.fillStyle = hex;
      ctx.fillRect(x + i * barW, centerY - fh / 2, barW, fh);
    });
  }
  x += fw + gap * k;
  setFont(ctx, SKY_BALLOON_LABEL_FONT_PX * k);
  drawPlainText(ctx, 'time:', x, centerY, SKY_BALLOON_LABEL_FONT_PX * k);
  x += labelW * k + gap * k;
  setFont(ctx, SKY_BALLOON_TIME_FONT_PX * k);
  drawPlainText(ctx, timeText, x, centerY, SKY_BALLOON_TIME_FONT_PX * k);
}

/** The small "The top rescuer:" label above the 3D name, centred, label font. */
export function drawSkyBalloonLabel(
  ctx: Balloon2DContext,
  text: string,
  width: number = SKY_BALLOON_CANVAS_WIDTH,
  height: number = SKY_BALLOON_LABEL_CANVAS_HEIGHT,
): void {
  ctx.clearRect(0, 0, width, height);
  if (!text) return;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  setFont(ctx, SKY_BALLOON_LABEL_FONT_PX);
  const px = SKY_BALLOON_LABEL_FONT_PX * Math.min(1, (width * 0.94) / Math.max(1, ctx.measureText(text).width));
  setFont(ctx, px);
  drawPlainText(ctx, text, (width - ctx.measureText(text).width) / 2, height / 2, px);
}
