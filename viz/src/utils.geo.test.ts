import { describe, it, expect } from 'vitest';
import { bbox, roundGeometryInPlace, trimPropertiesInPlace } from './utils.geo';

function polygonFeature(coords: number[][]): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

describe('bbox', () => {
  it('returns null for an empty collection', () => {
    expect(bbox({ type: 'FeatureCollection', features: [] })).toBeNull();
  });
  it('computes the extent of a polygon', () => {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [polygonFeature([[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]])],
    };
    expect(bbox(fc)).toEqual([0, 0, 10, 5]);
  });
  it('spans multiple features and a point', () => {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        polygonFeature([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]),
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-3, 7] } },
      ],
    };
    expect(bbox(fc)).toEqual([-3, 0, 2, 7]);
  });
  it('skips features with no geometry', () => {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: null as unknown as GeoJSON.Geometry },
        polygonFeature([[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]),
      ],
    };
    expect(bbox(fc)).toEqual([1, 1, 2, 2]);
  });
});

describe('roundGeometryInPlace', () => {
  it('rounds coordinates to the given precision, in place', () => {
    const f = polygonFeature([[1.123456789, 2.987654321], [3.0000004, 4.0000006]]);
    roundGeometryInPlace(f, 6);
    const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring[0]).toEqual([1.123457, 2.987654]);
    expect(ring[1]).toEqual([3, 4.000001]);
  });
});

describe('trimPropertiesInPlace', () => {
  it('keeps only the whitelisted keys', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', geometry: null as unknown as GeoJSON.Geometry, properties: { a: 1, b: 2, c: 3 } },
      { type: 'Feature', geometry: null as unknown as GeoJSON.Geometry, properties: { a: 9, z: 0 } },
    ];
    trimPropertiesInPlace(features, new Set(['a', 'b']));
    expect(features[0].properties).toEqual({ a: 1, b: 2 });
    expect(features[1].properties).toEqual({ a: 9 });
  });
});
