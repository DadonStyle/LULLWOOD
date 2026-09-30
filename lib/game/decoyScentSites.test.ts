import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECOY_SCENT_SITES,
  DECOY_SCENT_SITE_RADIUS,
  findDecoyScentSiteIndex,
  decoyScentGlowWeight,
} from './decoyScentSites.ts';

test('one fixed site, radius matches DECOY_SCENT_SITE_RADIUS', () => {
  assert.equal(DECOY_SCENT_SITES.length, 1);
  const s = DECOY_SCENT_SITES[0];
  assert.equal(s.radius, DECOY_SCENT_SITE_RADIUS);
  assert.equal(s.kind, 'decoyScent');
});

test('findDecoyScentSiteIndex: at the site center returns that index', () => {
  const s = DECOY_SCENT_SITES[0];
  assert.equal(findDecoyScentSiteIndex(s.x, s.z), 0);
});

test('findDecoyScentSiteIndex: exactly at the radius edge counts as inside', () => {
  const s = DECOY_SCENT_SITES[0];
  assert.equal(findDecoyScentSiteIndex(s.x + s.radius, s.z), 0);
});

test('findDecoyScentSiteIndex: just past the radius edge is outside', () => {
  const s = DECOY_SCENT_SITES[0];
  assert.equal(findDecoyScentSiteIndex(s.x + s.radius + 0.01, s.z), -1);
});

test('findDecoyScentSiteIndex: far from the site returns -1', () => {
  assert.equal(findDecoyScentSiteIndex(0, 0), -1);
});

test('decoyScentGlowWeight: 1 at center, 0 at/beyond the edge, linear between', () => {
  const s = DECOY_SCENT_SITES[0];
  assert.equal(decoyScentGlowWeight(s.x, s.z, s), 1);
  assert.equal(decoyScentGlowWeight(s.x + s.radius, s.z, s), 0);
  assert.equal(decoyScentGlowWeight(s.x + s.radius * 2, s.z, s), 0);
  assert.equal(decoyScentGlowWeight(s.x + s.radius / 2, s.z, s), 0.5);
});

test('findDecoyScentSiteIndex: wrap-aware when spanX/spanZ given', () => {
  const sites = [{ id: 'wrapTest', kind: 'decoyScent' as const, x: -195, z: 0, radius: 8 }];
  assert.equal(findDecoyScentSiteIndex(197, 0, sites, 400, 400), 0); // wrapped dist = |197-205| = 8, at edge
  assert.equal(findDecoyScentSiteIndex(197, 0, sites), -1); // without wrap, plain distance is huge
});
