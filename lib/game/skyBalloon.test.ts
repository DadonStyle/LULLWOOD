import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  skyBalloonDirection,
  skyBalloonContent,
  drawSkyBalloonTexture,
  SKY_BALLOON_ANGLE_DEG,
  SKY_BALLOON_CANVAS_WIDTH,
  SKY_BALLOON_CANVAS_HEIGHT,
} from './skyBalloon.ts';

function makeCtxStub() {
  const calls: unknown[][] = [];
  return {
    calls,
    clearRect(x: number, y: number, w: number, h: number) { calls.push(['clearRect', x, y, w, h]); },
    fillRect(x: number, y: number, w: number, h: number) { calls.push(['fillRect', x, y, w, h, this.fillStyle]); },
    fillText(text: string, x: number, y: number) { calls.push(['fillText', text, x, y]); },
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
  };
}

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

test('drawSkyBalloonTexture: hidden only clears, draws nothing else', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'hidden', null);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0][0], 'clearRect');
});

test('drawSkyBalloonTexture: loading draws the body + text, no flag bars', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'loading', null);
  assert.ok(ctx.calls.some(c => c[0] === 'fillText' && c[1] === 'loading top rescuer'));
  // body fillRect + no flag-bar fillRects => exactly one fillRect call
  assert.equal(ctx.calls.filter(c => c[0] === 'fillRect').length, 1);
});

test('drawSkyBalloonTexture: populated draws flag bars matching the country palette length', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'populated', { nickname: 'ranger42', country: 'JP', timeMs: 60_000 });
  // JP has 2 colours (lib/game/country-palettes.ts) + 1 body fillRect = 3
  assert.equal(ctx.calls.filter(c => c[0] === 'fillRect').length, 3);
  assert.ok(ctx.calls.some(c => c[0] === 'fillText' && (c[1] as string).startsWith('ranger42')));
});

test('drawSkyBalloonTexture: clears the canvas before drawing anything else', () => {
  const ctx = makeCtxStub();
  drawSkyBalloonTexture(ctx, 'empty', null, SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT);
  assert.equal(ctx.calls[0][0], 'clearRect');
  assert.deepEqual(ctx.calls[0].slice(1), [0, 0, SKY_BALLOON_CANVAS_WIDTH, SKY_BALLOON_CANVAS_HEIGHT]);
});
