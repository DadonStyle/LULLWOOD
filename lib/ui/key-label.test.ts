import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKeyLabel } from './key-label.ts';

test('formatKeyLabel: KeyX codes strip the Key prefix', () => {
  assert.equal(formatKeyLabel('KeyE'), 'E');
  assert.equal(formatKeyLabel('KeyW'), 'W');
});

test('formatKeyLabel: Digit codes strip the Digit prefix', () => {
  assert.equal(formatKeyLabel('Digit1'), '1');
});

test('formatKeyLabel: Space reads as SPACE, matching the pre-existing hardcoded chargePrompt label', () => {
  assert.equal(formatKeyLabel('Space'), 'SPACE');
});

test('formatKeyLabel: multi-word codes get a space inserted before each new word', () => {
  assert.equal(formatKeyLabel('ShiftLeft'), 'SHIFT LEFT');
  assert.equal(formatKeyLabel('ArrowUp'), 'ARROW UP');
});

test('formatKeyLabel: single-word non-Key/Digit codes just uppercase', () => {
  assert.equal(formatKeyLabel('Escape'), 'ESCAPE');
  assert.equal(formatKeyLabel('Enter'), 'ENTER');
});
