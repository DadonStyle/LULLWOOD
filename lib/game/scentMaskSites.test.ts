import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENT_MASK_SITES,
  SCENT_MASK_RADIUS,
  findScentMaskSiteIndex,
  scentMaskGlowWeight,
} from './scentMaskSites.ts';

test('three fixed sites, unique ids, radius matches SCENT_MASK_RADIUS', () => {
  assert.equal(SCENT_MASK_SITES.length, 3);
  const ids = new Set(SCENT_MASK_SITES.map(s => s.id));
  assert.equal(ids.size, 3);
  for (const s of SCENT_MASK_SITES) {
    assert.equal(s.radius, SCENT_MASK_RADIUS);
    assert.equal(s.kind, 'scentMask');
    assert.ok(s.type === 'marsh' || s.type === 'pine');
  }
});

test('findScentMaskSiteIndex: at a site center returns that index', () => {
  const s = SCENT_MASK_SITES[0];
  assert.equal(findScentMaskSiteIndex(s.x, s.z), 0);
});

test('findScentMaskSiteIndex: exactly at the radius edge counts as inside', () => {
  const s = SCENT_MASK_SITES[0];
  assert.equal(findScentMaskSiteIndex(s.x + s.radius, s.z), 0);
});

test('findScentMaskSiteIndex: just past the radius edge is outside', () => {
  const s = SCENT_MASK_SITES[0];
  assert.equal(findScentMaskSiteIndex(s.x + s.radius + 0.01, s.z), -1);
});

test('findScentMaskSiteIndex: far from every site returns -1', () => {
  assert.equal(findScentMaskSiteIndex(0, 0), -1);
});

test('findScentMaskSiteIndex: picks the containing site, not always index 0', () => {
  const s = SCENT_MASK_SITES[1];
  assert.equal(findScentMaskSiteIndex(s.x, s.z), 1);
});

test('scentMaskGlowWeight: 1 at center, 0 at/beyond the edge, linear between', () => {
  const s = SCENT_MASK_SITES[0];
  assert.equal(scentMaskGlowWeight(s.x, s.z, s), 1);
  assert.equal(scentMaskGlowWeight(s.x + s.radius, s.z, s), 0);
  assert.equal(scentMaskGlowWeight(s.x + s.radius * 2, s.z, s), 0);
  assert.equal(scentMaskGlowWeight(s.x + s.radius / 2, s.z, s), 0.5);
});

test('findScentMaskSiteIndex: wrap-aware when spanX/spanZ given', () => {
  const sites = [{ id: 'wrapTest', kind: 'scentMask' as const, type: 'marsh' as const, x: -195, z: 0, radius: 8 }];
  // 195 -> -195 the short way around a span of 400 is a wrapped distance of 10, inside radius 8? no -- use exact wrap check
  assert.equal(findScentMaskSiteIndex(197, 0, sites, 400, 400), 0); // wrapped dist = |197 - (-195 + 400)| = |197-205| = 8, at edge
  assert.equal(findScentMaskSiteIndex(197, 0, sites), -1); // without wrap, plain distance is huge
});
