import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  skyBalloonDirection,
  skyBalloonContent,
  drawSkyBalloonTexture,
  drawSkyBalloonLabel,
  SKY_BALLOON_LABEL_TEXT,
  SKY_BALLOON_LABEL_FONT_PX,
  SKY_BALLOON_TIME_FONT_PX,
  skyBalloonNameLetters,
  skyBalloonFlagUrl,
  layoutSkyBalloonName,
  skyBalloonLetterBob,
  SKY_BALLOON_ANGLE_DEG,
  SKY_BALLOON_RADIUS,
  SKY_BALLOON_MOON_RADIUS,
  SKY_BALLOON_SCALE,
  SKY_BALLOON_LETTER_HEIGHT,
  SKY_BALLOON_NAME_MAX_WIDTH,
  SKY_BALLOON_LETTER_GAP,
  SKY_BALLOON_CANVAS_WIDTH,
  SKY_BALLOON_CANVAS_HEIGHT,
} from './skyBalloon.ts';

function makeCtxStub() {
  const calls: unknown[][] = [];
  const ctx = {
    calls,
    clearRect(x: number, y: number, w: number, h: number) { calls.push(['clearRect', x, y, w, h]); },
    fillRect(x: number, y: number, w: number, h: number) { calls.push(['fillRect', x, y, w, h, ctx.fillStyle]); },
    fillText(text: string, x: number, y: number) { calls.push(['fillText', text, x, y, fontPx(ctx.font)]); },
    strokeText(text: string, x: number, y: number) { calls.push(['strokeText', text, x, y]); },
    // Deterministic stand-in for real glyph metrics: 0.55 em per character.
    measureText(text: string) { return { width: text.length * fontPx(ctx.font) * 0.55 }; },
    drawImage(img: unknown, x: number, y: number, w: number, h: number) { calls.push(['drawImage', img, x, y, w, h]); },
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    textAlign: '',
    textBaseline: '',
  };
  return ctx;
}
function fontPx(font: string): number {
  return Number(/(\d+)px/.exec(font)?.[1] ?? 0);
}
type TextCall = [string, string, number, number, number];
const texts = (calls: unknown[][]) => calls.filter(c => c[0] === 'fillText') as TextCall[];

const MOON_DIR = { x: -6, y: 16, z: -4 };
function normalize(v: { x: number; y: number; z: number }) {
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
const UNIT_MOON_DIR = normalize(MOON_DIR);

// ---- skyBalloonDirection ----------------------------------------------------

test('skyBalloonDirection: preserves vector length (rotation about Y is an isometry)', () => {
  const dir = skyBalloonDirection(UNIT_MOON_DIR);
  const len = Math.hypot(dir.x, dir.y, dir.z);
  assert.ok(Math.abs(len - 1) < 1e-9, `length drifted to ${len}`);
});

test('skyBalloonDirection: leaves the vertical (y) component untouched', () => {
  const dir = skyBalloonDirection(UNIT_MOON_DIR);
  assert.equal(dir.y, UNIT_MOON_DIR.y);
});

test('skyBalloonDirection: never equals moonDir -- the whole point is to not overlap the sun/moon', () => {
  const dir = skyBalloonDirection(UNIT_MOON_DIR);
  assert.ok(Math.abs(dir.x - UNIT_MOON_DIR.x) > 1e-6 || Math.abs(dir.z - UNIT_MOON_DIR.z) > 1e-6);
});

test('skyBalloonDirection: the xz-plane angle between moonDir and the result is the requested angle', () => {
  const dir = skyBalloonDirection(UNIT_MOON_DIR, SKY_BALLOON_ANGLE_DEG);
  const dot = UNIT_MOON_DIR.x * dir.x + UNIT_MOON_DIR.z * dir.z;
  const magA = Math.hypot(UNIT_MOON_DIR.x, UNIT_MOON_DIR.z);
  const magB = Math.hypot(dir.x, dir.z);
  const cosTheta = dot / (magA * magB);
  assert.ok(Math.abs(cosTheta - Math.cos((SKY_BALLOON_ANGLE_DEG * Math.PI) / 180)) < 1e-9);
});

test('skyBalloonDirection: angle 0 is a no-op (regression guard the e2e angle check builds on)', () => {
  const dir = skyBalloonDirection(UNIT_MOON_DIR, 0);
  assert.ok(Math.abs(dir.x - UNIT_MOON_DIR.x) < 1e-9);
  assert.ok(Math.abs(dir.z - UNIT_MOON_DIR.z) < 1e-9);
});

// ---- skyBalloonContent ------------------------------------------------------

test('skyBalloonContent: loading has no flag', () => {
  assert.deepEqual(skyBalloonContent('loading', null), { text: 'loading top rescuer', hasFlag: false });
});

test('skyBalloonContent: empty has no flag', () => {
  assert.deepEqual(skyBalloonContent('empty', null), { text: 'be the first — --:--', hasFlag: false });
});

test('skyBalloonContent: populated renders nickname + mm:ss and has a flag', () => {
  const r = skyBalloonContent('populated', { nickname: 'ranger42', country: 'IL', timeMs: 125_000 });
  assert.equal(r.text, 'ranger42 — 2:05');
  assert.equal(r.hasFlag, true);
});

test('skyBalloonContent: hidden renders nothing', () => {
  assert.deepEqual(skyBalloonContent('hidden', null), { text: '', hasFlag: false });
});

test('skyBalloonContent: populated with no record falls back to hidden-shaped content (defensive)', () => {
  assert.deepEqual(skyBalloonContent('populated', null), { text: '', hasFlag: false });
});

// ---- drawSkyBalloonTexture ---------------------------------------------------

const POPULATED = { nickname: 'ranger', country: 'JP', timeMs: 125_000 };

test('drawSkyBalloonTexture: hidden only clears, draws nothing else', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'hidden', null);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0][0], 'clearRect');
});

test('drawSkyBalloonTexture: clears the canvas before drawing anything else', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'empty', null, SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT);
  assert.deepEqual(ctx.calls[0], ['clearRect', 0, 0, SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT]);
});

test('drawSkyBalloonTexture: plain text only -- no bubbles/ovals for any state', () => {
  for (const [status, record] of [['loading', null], ['empty', null], ['populated', POPULATED]] as const) {
    const ctx = makeCtxStub();
    drawSkyBalloonTexture(ctx, status, record, SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT, true);
    assert.ok(ctx.calls.every(c => c[0] !== 'ellipse'), status);
  }
});

test('drawSkyBalloonTexture: loading/empty draw their whole text once, in the big font, no flag', () => {
  for (const [status, text] of [['loading', 'loading top rescuer'], ['empty', 'be the first — --:--']] as const) {
    const ctx = makeCtxStub();
    drawSkyBalloonTexture(ctx, status, null);
    assert.deepEqual(texts(ctx.calls).map(c => c[1]), [text]);
    assert.equal(ctx.calls.filter(c => c[0] === 'fillRect' || c[0] === 'drawImage').length, 0);
  }
});

test('drawSkyBalloonTexture: populated with the name in 3D draws flag, then "time:" small, then the time big', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'populated', POPULATED, SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT, true);
  const t = texts(ctx.calls);
  assert.deepEqual(t.map(c => c[1]), ['time:', '2:05']);
  assert.equal(t[0][4], SKY_BALLOON_LABEL_FONT_PX);
  assert.equal(t[1][4], SKY_BALLOON_TIME_FONT_PX);
  assert.ok(t[0][4] < t[1][4], 'the label is smaller than the time');
  // flag (JP palette bars until the picture loads) sits left of "time:", which sits left of the time
  const bars = ctx.calls.filter(c => c[0] === 'fillRect') as Array<[string, number]>;
  assert.equal(bars.length, 2);
  assert.ok(Math.max(...bars.map(b => b[1])) < t[0][2]);
  assert.ok(t[0][2] < t[1][2]);
});

test('drawSkyBalloonTexture: without the 3D name the nickname leads the row', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'populated', POPULATED, SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT, false);
  assert.deepEqual(texts(ctx.calls).map(c => c[1]), ['ranger ', 'time:', '2:05']);
});

test('drawSkyBalloonTexture: a long row shrinks to fit the canvas width', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'populated', { nickname: 'forestrunnerabcdefgh', country: 'US', timeMs: 3_599_000 },
    SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT, false);
  const t = texts(ctx.calls);
  const last = t[t.length - 1];
  assert.ok(t[0][2] >= 0);
  assert.ok(last[2] + last[1].length * last[4] * 0.55 <= SKY_BALLOON_CANVAS_WIDTH + 1e-6);
  assert.ok(last[4] < SKY_BALLOON_TIME_FONT_PX);
});

test('drawSkyBalloonLabel: draws "The top rescuer:" centred in the small label font', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonLabel(ctx, SKY_BALLOON_LABEL_TEXT);
  const [call] = texts(ctx.calls);
  assert.equal(call[1], 'The top rescuer:');
  assert.equal(call[4], SKY_BALLOON_LABEL_FONT_PX);
  const w = call[1].length * call[4] * 0.55;
  assert.ok(Math.abs(call[2] + w / 2 - SKY_BALLOON_CANVAS_WIDTH / 2) < 1e-9);
});

test('drawSkyBalloonLabel: empty text only clears', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonLabel(ctx, '');
  assert.deepEqual(ctx.calls.map(c => c[0]), ['clearRect']);
});

// ---- 3D balloon-letter nickname ---------------------------------------------

test('skyBalloonNameLetters: upper-cased letters only, digits dropped', () => {
  assert.deepEqual(skyBalloonNameLetters('ranger42'), [...'RANGER']);
  assert.deepEqual(skyBalloonNameLetters('a1b2c3'), [...'ABC']);
});

test('skyBalloonNameLetters: an all-digit legacy nickname spells nothing', () => {
  assert.deepEqual(skyBalloonNameLetters('123'), []);
  assert.deepEqual(skyBalloonNameLetters(''), []);
});

test('skyBalloonFlagUrl: one lower-case PNG per country code', () => {
  assert.equal(skyBalloonFlagUrl('IL'), '/flags/il.png');
});

test('layoutSkyBalloonName: a short name keeps the full letter height and is centred on 0', () => {
  const { scale, xs, width } = layoutSkyBalloonName([1, 1, 1]);
  assert.equal(scale, SKY_BALLOON_LETTER_HEIGHT);
  assert.equal(xs.length, 3);
  assert.ok(Math.abs(xs[1]) < 1e-9, 'middle letter sits on the centre line');
  assert.ok(Math.abs(xs[0] + xs[2]) < 1e-9, 'symmetric around 0');
  assert.ok(Math.abs(width - (3 + 2 * SKY_BALLOON_LETTER_GAP) * scale) < 1e-9);
});

test('layoutSkyBalloonName: a 20-character name scales down to the max width', () => {
  const widths = Array.from({ length: 20 }, () => 0.9);
  const { scale, xs, width } = layoutSkyBalloonName(widths);
  assert.ok(scale < SKY_BALLOON_LETTER_HEIGHT);
  assert.ok(Math.abs(width - SKY_BALLOON_NAME_MAX_WIDTH) < 1e-9);
  // first and last glyph edges land exactly on the row's edges
  assert.ok(Math.abs(xs[0] - 0.45 * scale + width / 2) < 1e-9);
  assert.ok(Math.abs(xs[19] + 0.45 * scale - width / 2) < 1e-9);
});

test('layoutSkyBalloonName: glyph centres never overlap (each advances by its own width + gap)', () => {
  const widths = [0.6, 1.2, 0.3, 1.0];
  const { scale, xs } = layoutSkyBalloonName(widths);
  for (let i = 1; i < xs.length; i++) {
    const expected = ((widths[i - 1] + widths[i]) / 2 + SKY_BALLOON_LETTER_GAP) * scale;
    assert.ok(Math.abs(xs[i] - xs[i - 1] - expected) < 1e-9);
  }
});

test('layoutSkyBalloonName: no glyphs, no layout', () => {
  assert.deepEqual(layoutSkyBalloonName([]).xs, []);
});

test('skyBalloonLetterBob: stays within the amplitude and neighbours are out of phase', () => {
  for (let t = 0; t < 10; t += 0.37) {
    const a = skyBalloonLetterBob(0, t, 0.6), b = skyBalloonLetterBob(1, t, 0.6);
    assert.ok(Math.abs(a.y) <= 0.6 + 1e-9);
    assert.ok(Math.abs(a.tilt) <= 0.06 + 1e-9);
    assert.notEqual(a.y, b.y);
  }
});

test('drawSkyBalloonTexture: a loaded flag picture replaces the palette bars', () => {
  const ctx = makeCtxStub();
  const img = { tag: 'flag' };
  drawSkyBalloonTexture(ctx, 'populated', { nickname: 'ranger', country: 'JP', timeMs: 60_000 },
    SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT, true, img);
  const images = ctx.calls.filter(c => c[0] === 'drawImage');
  assert.equal(images.length, 1);
  assert.equal(images[0][1], img);
  // 4:3, vertically centred, inside the canvas
  const [, , x, y, w, h] = images[0] as [string, unknown, number, number, number, number];
  assert.ok(Math.abs(w / h - 4 / 3) < 1e-9);
  assert.ok(Math.abs(y + h / 2 - SKY_BALLOON_CANVAS_HEIGHT / 2) < 1e-9);
  assert.ok(x >= 0 && x + w <= SKY_BALLOON_CANVAS_WIDTH);
  assert.equal(ctx.calls.filter(c => c[0] === 'fillRect').length, 0);
});

test('drawSkyBalloonTexture: no flag picture for a non-flag state even if one is passed', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'empty', null, SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT, true, { tag: 'flag' });
  assert.equal(ctx.calls.filter(c => c[0] === 'drawImage').length, 0);
});

test('the balloon sits nearer than the sun/moon disc (draws in front of it) at the same on-screen size', () => {
  assert.ok(SKY_BALLOON_RADIUS < SKY_BALLOON_MOON_RADIUS);
  assert.equal(SKY_BALLOON_SCALE * SKY_BALLOON_MOON_RADIUS, SKY_BALLOON_RADIUS);
});
