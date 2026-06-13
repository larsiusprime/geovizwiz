import { describe, it, expect } from 'vitest';
import {
  destinationPoint,
  getFeatureCenter,
  isValidLngLat,
  distanceMeters,
  getPageTokens,
  getDeltaClass,
  buildDelta,
} from './comp-finder-helpers';

describe('isValidLngLat', () => {
  it('accepts in-range coordinates', () => {
    expect(isValidLngLat([0, 0])).toBe(true);
    expect(isValidLngLat([180, 90])).toBe(true);
    expect(isValidLngLat([-180, -90])).toBe(true);
  });
  it('rejects nullish, out-of-range, and non-finite coordinates', () => {
    expect(isValidLngLat(null)).toBe(false);
    expect(isValidLngLat(undefined)).toBe(false);
    expect(isValidLngLat([181, 0])).toBe(false);
    expect(isValidLngLat([0, 91])).toBe(false);
    expect(isValidLngLat([NaN, 0])).toBe(false);
  });
});

describe('distanceMeters', () => {
  it('is zero for identical points', () => {
    expect(distanceMeters([0, 0], [0, 0])).toBe(0);
  });
  it('approximates one degree of latitude (~111 km)', () => {
    const d = distanceMeters([0, 0], [0, 1]);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
  it('is symmetric', () => {
    const a: [number, number] = [-122.4, 37.8];
    const b: [number, number] = [-122.3, 37.7];
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });
});

describe('destinationPoint', () => {
  it('moving north increases latitude, keeps longitude ~constant', () => {
    const [lng, lat] = destinationPoint([0, 0], 0, 111_195);
    expect(lat).toBeCloseTo(1, 1);
    expect(lng).toBeCloseTo(0, 5);
  });
});

describe('getFeatureCenter', () => {
  it('returns the bbox center of a polygon', () => {
    const f: GeoJSON.Feature = {
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 4], [0, 4], [0, 0]]] },
    };
    expect(getFeatureCenter(f)).toEqual([5, 2]);
  });
  it('returns null when there is no geometry', () => {
    const f = { type: 'Feature', properties: {}, geometry: null } as unknown as GeoJSON.Feature;
    expect(getFeatureCenter(f)).toBeNull();
  });
});

describe('getPageTokens', () => {
  it('lists every page when total <= 5', () => {
    expect(getPageTokens(3, 1)).toEqual([1, 2, 3]);
    expect(getPageTokens(5, 3)).toEqual([1, 2, 3, 4, 5]);
  });
  it('elides the tail near the start', () => {
    expect(getPageTokens(10, 1)).toEqual([1, 2, 3, 4, '...', 10]);
  });
  it('elides the head near the end', () => {
    expect(getPageTokens(10, 10)).toEqual([1, '...', 7, 8, 9, 10]);
  });
  it('elides both sides in the middle', () => {
    expect(getPageTokens(10, 5)).toEqual([1, '...', 4, 5, 6, '...', 10]);
  });
});

describe('getDeltaClass', () => {
  it('maps sign to the correct CSS class', () => {
    expect(getDeltaClass({ sign: 'positive' })).toBe('comp-finder-delta-positive');
    expect(getDeltaClass({ sign: 'negative' })).toBe('comp-finder-delta-negative');
    expect(getDeltaClass({ sign: 'neutral' })).toBe('');
    expect(getDeltaClass({ sign: 'error' })).toBe('');
  });
});

describe('buildDelta', () => {
  it('numeric: equal / positive / negative', () => {
    expect(buildDelta(10, 10, 'numeric')).toMatchObject({ text: '=', sign: 'neutral' });
    expect(buildDelta(12, 10, 'numeric')).toMatchObject({ text: '+2', sign: 'positive' });
    expect(buildDelta(8, 10, 'numeric')).toMatchObject({ text: '-2', sign: 'negative' });
  });
  it('numeric: missing/non-numeric value → error', () => {
    expect(buildDelta(undefined, 10, 'numeric')).toMatchObject({ sign: 'error' });
    expect(buildDelta('abc', 10, 'numeric')).toMatchObject({ sign: 'error' });
  });
  it('categorical: equal / different / missing', () => {
    expect(buildDelta('A', 'A', 'categorical')).toMatchObject({ text: '=', sign: 'neutral' });
    expect(buildDelta('A', 'B', 'categorical')).toMatchObject({ text: 'A', sign: 'negative' });
    expect(buildDelta(null, 'B', 'categorical')).toMatchObject({ sign: 'error' });
  });
});
