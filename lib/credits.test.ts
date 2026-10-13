import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREDITS, STUDIO_CREDIT } from './credits.ts';

test('the studio credit names its author and links the GitHub profile, not the repo', () => {
  assert.equal(STUDIO_CREDIT.author, 'Noam Dadon');
  assert.equal(STUDIO_CREDIT.authorUrl, 'https://github.com/DadonStyle');
});

test('the balloon letters are credited to danny_p3d under CC BY 4.0, with every link CC BY asks for', () => {
  const balloons = CREDITS.find((c) => c.title === 'Letter-balloons');
  assert.ok(balloons);
  assert.equal(balloons.author, 'danny_p3d');
  assert.equal(balloons.license, 'CC BY 4.0');
  assert.equal(balloons.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.match(balloons.sourceUrl, /^https:\/\/sketchfab\.com\/3d-models\/letter-balloons-/);
  assert.ok(balloons.changes, 'CC BY: indicate if changes were made');
});

test('every credit has a title, author, source, license and https links', () => {
  for (const c of CREDITS) {
    for (const key of ['title', 'author', 'license', 'usedFor'] as const) assert.ok(c[key], `${c.title}: ${key}`);
    for (const key of ['authorUrl', 'sourceUrl', 'licenseUrl'] as const) assert.match(c[key], /^https:\/\//, `${c.title}: ${key}`);
  }
});
