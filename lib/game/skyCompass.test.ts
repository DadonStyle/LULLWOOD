import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY_COMPASS_GLYPHS,
  SKY_COMPASS_DIRECTIONS,
  SKY_COMPASS_RADIUS,
  skyCompassPosition,
  drawSkyCompassGlyph,
  SKY_COMPASS_CANVAS_SIZE,
} from './skyCompass.ts';

function makeCtxStub() {
  const calls: unknown[][] = [];
  return {
    calls,
    clearRect(x: number, y: number, w: number, h: number) { calls.push(['clearRect', x, y, w, h]); },
    fillText(text: string, x: number, y: number) { calls.push(['fillText', text, x, y]); },
    strokeText(text: string, x: number, y: number) { calls.push(['strokeText', text, x, y]); },
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: '',
    textBaseline: '',
  };
}

// ---- SKY_COMPASS_GLYPHS / SKY_COMPASS_DIRECTIONS --------------------------

test('SKY_COMPASS_GLYPHS has all four cardinal directions, N/E/S/W order', () => {
  assert.deepEqual(SKY_COMPASS_GLYPHS, ['N', 'E', 'S', 'W']);
});

test('SKY_COMPASS_DIRECTIONS: each glyph is a unit vector on the ground plane', () => {
  for (const glyph of SKY_COMPASS_GLYPHS) {
    const { x, z } = SKY_COMPASS_DIRECTIONS[glyph];
    assert.ok(Math.abs(Math.hypot(x, z) - 1) < 1e-9, `${glyph} direction is not unit length`);
  }
});

test('SKY_COMPASS_DIRECTIONS: N/S and E/W are opposite pairs', () => {
  assert.ok(Math.abs(SKY_COMPASS_DIRECTIONS.N.x + SKY_COMPASS_DIRECTIONS.S.x) < 1e-9);
  assert.ok(Math.abs(SKY_COMPASS_DIRECTIONS.N.z + SKY_COMPASS_DIRECTIONS.S.z) < 1e-9);
  assert.ok(Math.abs(SKY_COMPASS_DIRECTIONS.E.x + SKY_COMPASS_DIRECTIONS.W.x) < 1e-9);
  assert.ok(Math.abs(SKY_COMPASS_DIRECTIONS.E.z + SKY_COMPASS_DIRECTIONS.W.z) < 1e-9);
});

// ---- skyCompassPosition ----------------------------------------------------

test('skyCompassPosition: defaults to SKY_COMPASS_RADIUS, y=0', () => {
  const p = skyCompassPosition('N');
  assert.equal(p.y, 0);
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - SKY_COMPASS_RADIUS) < 1e-9);
});

test('skyCompassPosition: scales with an explicit radius', () => {
  const p = skyCompassPosition('E', 100);
  assert.ok(Math.abs(p.x - 100) < 1e-9);
  assert.ok(Math.abs(p.z) < 1e-9);
});

test('skyCompassPosition: matches the unit-vector direction for every glyph', () => {
  for (const glyph of SKY_COMPASS_GLYPHS) {
    const dir = SKY_COMPASS_DIRECTIONS[glyph];
    const p = skyCompassPosition(glyph, 50);
    assert.ok(Math.abs(p.x - dir.x * 50) < 1e-9);
    assert.ok(Math.abs(p.z - dir.z * 50) < 1e-9);
  }
});

// ---- drawSkyCompassGlyph ----------------------------------------------------

test('drawSkyCompassGlyph: day path fills, does not stroke', () => {
  const ctx = makeCtxStub();
  drawSkyCompassGlyph(ctx, 'N', false, '#ffffff');
  assert.ok(ctx.calls.some(c => c[0] === 'fillText' && c[1] === 'N'));
  assert.ok(!ctx.calls.some(c => c[0] === 'strokeText'));
  assert.equal(ctx.fillStyle, '#ffffff');
});

test('drawSkyCompassGlyph: night path strokes (hollow), does not fill', () => {
  const ctx = makeCtxStub();
  drawSkyCompassGlyph(ctx, 'S', true, '#bcd0ff');
  assert.ok(ctx.calls.some(c => c[0] === 'strokeText' && c[1] === 'S'));
  assert.ok(!ctx.calls.some(c => c[0] === 'fillText'));
  assert.equal(ctx.strokeStyle, '#bcd0ff');
  assert.ok(ctx.lineWidth > 0);
});

test('drawSkyCompassGlyph: clears the canvas before drawing', () => {
  const ctx = makeCtxStub();
  drawSkyCompassGlyph(ctx, 'W', false, '#ffffff', SKY_COMPASS_CANVAS_SIZE);
  assert.equal(ctx.calls[0][0], 'clearRect');
  assert.deepEqual(ctx.calls[0].slice(1), [0, 0, SKY_COMPASS_CANVAS_SIZE, SKY_COMPASS_CANVAS_SIZE]);
});
