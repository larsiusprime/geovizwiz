import { describe, it, expect } from 'vitest';
import {
  pointInPolygon,
  polygonIntersectsBbox,
  featureIntersectsBbox,
  polygonIntersectsPolygon,
  featureIntersectsPolygon,
  calculatePolygonBbox,
} from './selection-geometry';

// Unit square [0,0]..[10,10]
const SQUARE: number[][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

function polygonFeature(rings: number[][][]): GeoJSON.Feature {
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } };
}

describe('pointInPolygon', () => {
  it('detects points inside vs outside', () => {
    expect(pointInPolygon([5, 5], SQUARE)).toBe(true);
    expect(pointInPolygon([15, 5], SQUARE)).toBe(false);
    expect(pointInPolygon([-1, -1], SQUARE)).toBe(false);
  });
});

describe('calculatePolygonBbox', () => {
  it('computes the min/max extent', () => {
    expect(calculatePolygonBbox(SQUARE)).toEqual([0, 0, 10, 10]);
    expect(calculatePolygonBbox([[2, 3], [8, 1], [5, 9]])).toEqual([2, 1, 8, 9]);
  });
});

describe('polygonIntersectsBbox', () => {
  it('is true when a vertex falls inside the bbox', () => {
    expect(polygonIntersectsBbox([SQUARE], [5, 5, 20, 20])).toBe(true);
  });
  it('is true when the bbox is fully contained by the polygon', () => {
    expect(polygonIntersectsBbox([SQUARE], [2, 2, 4, 4])).toBe(true);
  });
  it('is false when fully disjoint', () => {
    expect(polygonIntersectsBbox([SQUARE], [100, 100, 110, 110])).toBe(false);
  });
});

describe('featureIntersectsBbox', () => {
  it('handles Polygon and MultiPolygon geometries', () => {
    expect(featureIntersectsBbox(polygonFeature([SQUARE]), [2, 2, 4, 4])).toBe(true);
    expect(featureIntersectsBbox(polygonFeature([SQUARE]), [50, 50, 60, 60])).toBe(false);
    const multi: GeoJSON.Feature = {
      type: 'Feature', properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[SQUARE]] },
    };
    expect(featureIntersectsBbox(multi, [1, 1, 2, 2])).toBe(true);
  });
  it('returns false for unsupported geometry (e.g. Point)', () => {
    const pt: GeoJSON.Feature = {
      type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [5, 5] },
    };
    expect(featureIntersectsBbox(pt, [0, 0, 10, 10])).toBe(false);
  });
});

describe('polygon/feature vs polygon', () => {
  const OVERLAP: number[][] = [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]];
  const DISJOINT: number[][] = [[50, 50], [60, 50], [60, 60], [50, 60], [50, 50]];

  it('polygonIntersectsPolygon detects overlap vs disjoint', () => {
    expect(polygonIntersectsPolygon([SQUARE], OVERLAP)).toBe(true);
    expect(polygonIntersectsPolygon([SQUARE], DISJOINT)).toBe(false);
  });
  it('featureIntersectsPolygon detects overlap vs disjoint', () => {
    expect(featureIntersectsPolygon(polygonFeature([SQUARE]), OVERLAP)).toBe(true);
    expect(featureIntersectsPolygon(polygonFeature([SQUARE]), DISJOINT)).toBe(false);
  });
});
