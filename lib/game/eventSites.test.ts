import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sitesNear, type EventSite } from './eventSites.ts';

test('sitesNear returns 0 for an empty site array', () => {
  assert.equal(sitesNear(0, 0, [], 'fogTide'), 0);
});

test('sitesNear returns 1 exactly at a site center', () => {
  const sites: EventSite[] = [{ x: 10, z: -5, radius: 100, kind: 'fogTide' }];
  assert.equal(sitesNear(10, -5, sites, 'fogTide'), 1);
});

test('sitesNear returns 0 exactly at the radius boundary', () => {
  const sites: EventSite[] = [{ x: 0, z: 0, radius: 100, kind: 'fogTide' }];
  assert.equal(sitesNear(100, 0, sites, 'fogTide'), 0);
});

test('sitesNear returns 0.5 at exactly half the radius (linear falloff)', () => {
  const sites: EventSite[] = [{ x: 0, z: 0, radius: 100, kind: 'fogTide' }];
  assert.equal(sitesNear(50, 0, sites, 'fogTide'), 0.5);
});

test('sitesNear ignores sites whose kind does not match the query', () => {
  const sites: EventSite[] = [{ x: 0, z: 0, radius: 100, kind: 'otherEvent' }];
  assert.equal(sitesNear(0, 0, sites, 'fogTide'), 0);
});

test('sitesNear takes the max of two overlapping same-kind sites, not the sum', () => {
  const sites: EventSite[] = [
    { x: 0, z: 0, radius: 100, kind: 'fogTide' },
    { x: 80, z: 0, radius: 100, kind: 'fogTide' },
  ];
  // dist to site A = 30 -> wA = 0.7; dist to site B = 50 -> wB = 0.5.
  const result = sitesNear(30, 0, sites, 'fogTide');
  assert.ok(Math.abs(result - 0.7) < 1e-9);
  assert.notEqual(result, 0.7 + 0.5);
});

test('sitesNear uses wrapDist when a finite span is passed (seam case)', () => {
  const sites: EventSite[] = [{ x: 236, z: 0, radius: 50, kind: 'fogTide' }];
  // Query point on the opposite side of a spanX=480 seam: wrapped dist is 8,
  // not the ~472 plain-Euclidean distance -- proves the wrapDist integration.
  const result = sitesNear(-236, 0, sites, 'fogTide', 480, 480);
  assert.ok(Math.abs(result - (1 - 8 / 50)) < 1e-9);
});
