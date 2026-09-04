// Unit tests for lib/ui/hygiene.ts. Pure module, no browser -- same shape as
// lib/game/*.test.ts. Every fixture below is a real measurement taken from the
// 2026-08-30 mobile audit at 851x393 (Pixel 5 landscape), so a rule that stops
// firing here is a rule that stopped catching a defect that actually shipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audit, checkTapTargets, checkOverlaps, checkViewBlocking, checkFonts,
  checkReachability, checkOverflow, checkEdgeGestures, type Elem,
} from './hygiene.ts';

const VP = { w: 851, h: 393 };

function el(over: Partial<Elem> & { key: string }): Elem {
  return {
    x: 0, y: 0, w: 60, h: 60, fontPx: 14, tappable: false,
    pointerEvents: 'auto', position: 'fixed', opaqueBg: false,
    isText: false, isBackdrop: false,
    ...over,
  };
}

test('tap-target: flags the measured 78x43 settings button, passes a 44px one', () => {
  const bad = checkTapTargets([el({ key: '#settingsBtn', w: 78, h: 43, tappable: true })]);
  assert.equal(bad.length, 1);
  assert.match(bad[0].message, /78x43px/);
  assert.equal(checkTapTargets([el({ key: '[touchPause]', w: 44, h: 44, tappable: true })]).length, 0);
});

test('tap-target: ignores non-tappable text and full-screen backdrops', () => {
  assert.equal(checkTapTargets([el({ key: '#gateSub', w: 313, h: 14, isText: true })]).length, 0);
  assert.equal(
    checkTapTargets([el({ key: '#gate', w: 851, h: 393, tappable: true, isBackdrop: true })]).length,
    0,
  );
});

test('overlap: flags #gateKeys printed across the movement stick', () => {
  // Measured: #gateKeys 803x136 @ (24,172); leftStick 128x128 @ (20,241).
  const d = checkOverlaps([
    el({ key: '#gateKeys', x: 24, y: 172, w: 803, h: 136, isText: true }),
    el({ key: '[leftStick]', x: 20, y: 241, w: 128, h: 128, tappable: true }),
  ]);
  assert.equal(d.length, 1);
  assert.match(d[0].message, /#gateKeys/);
  assert.match(d[0].message, /51%/);
});

test('overlap: full containment is composition, not a collision', () => {
  const d = checkOverlaps([
    el({ key: '#gate', x: 0, y: 0, w: 851, h: 393, isBackdrop: true }),
    el({ key: '#gateTitle', x: 313, y: 85, w: 225, h: 35, isText: true }),
  ]);
  assert.deepEqual(d, []);
});

test('overlap: a wrapper sharing its child rect is reported once, under the named key', () => {
  const d = checkOverlaps([
    el({ key: 'div', x: 20, y: 241, w: 128, h: 128, tappable: true }),
    el({ key: '[leftStick]', x: 20, y: 241, w: 128, h: 128, tappable: true }),
    el({ key: '#gateKeys', x: 24, y: 172, w: 803, h: 136, isText: true }),
  ]);
  assert.equal(d.length, 1);
  assert.ok(d[0].keys.includes('[leftStick]'), 'names the stick, not the anonymous wrapper');
});

test('view-blocking: flags the dev panel parked at eye level, allows corner chrome', () => {
  // Measured: #panel 271x69 @ (16,84) -- y 84..153 of 393 is inside the sight band.
  const blocked = checkViewBlocking(
    [el({ key: '#panel', x: 16, y: 84, w: 271, h: 69, opaqueBg: true })], VP);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].message, /sight band/);
  // Same panel pushed to the bottom corner (desktop: y 651) is fine.
  assert.equal(
    checkViewBlocking([el({ key: '#panel', x: 16, y: 340, w: 271, h: 45, opaqueBg: true })], VP).length,
    0,
  );
});

test('view-blocking: a transparent overlay and a full-screen dialog are both exempt', () => {
  assert.equal(
    checkViewBlocking([el({ key: '#objective', x: 337, y: 150, w: 176, h: 32, opaqueBg: false })], VP).length,
    0,
  );
  assert.equal(
    checkViewBlocking([el({ key: '#winScreen', x: 0, y: 0, w: 851, h: 393, opaqueBg: true, isBackdrop: true })], VP).length,
    0,
  );
});

test('font-size: flags the 10px Pause label, passes 12px', () => {
  assert.equal(checkFonts([el({ key: '[touchPause]', fontPx: 10, isText: true })]).length, 1);
  assert.equal(checkFonts([el({ key: '#hint', fontPx: 12, isText: true })]).length, 0);
  // an element with no text of its own is not a font defect whatever its size
  assert.equal(checkFonts([el({ key: 'div', fontPx: 9, isText: false })]).length, 0);
});

test('reachability: 0 and 2 taps pass, 3 fails, unreachable fails with its own message', () => {
  const d = checkReachability({ Settings: 0, Sound: 2, Restart: 3, Fullscreen: -1 });
  assert.equal(d.length, 2);
  assert.match(d.find(x => x.keys[0] === 'Restart')!.message, /3 taps/);
  assert.match(d.find(x => x.keys[0] === 'Fullscreen')!.message, /not reachable at all/);
});

test('overflow: flags fixed chrome running off the viewport', () => {
  assert.equal(checkOverflow([el({ key: '#panel', x: 16, y: 25, w: 835, h: 128 })], VP).length, 0);
  assert.equal(checkOverflow([el({ key: '#panel', x: 16, y: 25, w: 900, h: 128 })], VP).length, 1);
});

test('edge-gesture: flags a tap target hugging the screen edge', () => {
  assert.equal(checkEdgeGestures([el({ key: '[touchPause]', x: 4, w: 44, tappable: true })], VP).length, 1);
  assert.equal(checkEdgeGestures([el({ key: '[touchPause]', x: 16, w: 44, tappable: true })], VP).length, 0);
});

test('audit: a clean screen produces no defects at all', () => {
  const clean: Elem[] = [
    el({ key: '[menuToggle]', x: 16, y: 16, w: 48, h: 48, tappable: true }),
    el({ key: '#objective', x: 337, y: 20, w: 176, h: 32, isText: true, fontPx: 13 }),
    el({ key: '[leftStick]', x: 20, y: 241, w: 122, h: 122, tappable: true }),
    el({ key: '[rightStick]', x: 709, y: 241, w: 122, h: 122, tappable: true }),
  ];
  assert.deepEqual(audit(clean, VP, { Fullscreen: 1, Settings: 1 }), []);
});
