/**
 * Pure geometry / hit-test helpers for selection.
 *
 * Extracted from selection.ts (Track C). These are stateless functions over
 * GeoJSON geometry and plain coordinate arrays — no module state, no imports.
 */

/** Point-in-polygon test using ray casting algorithm */
export function pointInPolygon(point: number[], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/** Check if a polygon ring set intersects with a bounding box */
export function polygonIntersectsBbox(polygon: number[][][], bbox: [number, number, number, number]): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;

  // Check if any point of the polygon is inside the bbox
  for (const ring of polygon) {
    for (const coord of ring) {
      const [lng, lat] = coord;
      if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
        return true;
      }
    }
  }

  // Also check if the bbox is completely inside the polygon
  const bboxCorners = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat]
  ];

  for (const corner of bboxCorners) {
    if (pointInPolygon(corner, polygon[0])) {
      return true;
    }
  }

  return false;
}

/** Check if a feature intersects with a bounding box */
export function featureIntersectsBbox(feature: GeoJSON.Feature, bbox: [number, number, number, number]): boolean {
  const geom = feature.geometry as GeoJSON.Geometry;
  if (geom.type === 'Polygon') {
    return polygonIntersectsBbox((geom as GeoJSON.Polygon).coordinates, bbox);
  } else if (geom.type === 'MultiPolygon') {
    return (geom as GeoJSON.MultiPolygon).coordinates.some(polygon =>
      polygonIntersectsBbox(polygon, bbox)
    );
  }

  return false;
}

/** Check if a polygon ring set intersects with another polygon */
export function polygonIntersectsPolygon(polygon1: number[][][], polygon2: number[][]): boolean {
  // Check if any point of polygon1 is inside polygon2
  for (const ring of polygon1) {
    for (const coord of ring) {
      const [lng, lat] = coord;
      if (pointInPolygon([lng, lat], polygon2)) {
        return true;
      }
    }
  }

  // Also check if any point of polygon2 is inside polygon1
  for (const coord of polygon2) {
    const [lng, lat] = coord;
    if (pointInPolygon([lng, lat], polygon1[0])) {
      return true;
    }
  }

  return false;
}

/** Check if a feature intersects with a polygon */
export function featureIntersectsPolygon(feature: GeoJSON.Feature, polygon: number[][]): boolean {
  const geom = feature.geometry as GeoJSON.Geometry;
  if (geom.type === 'Polygon') {
    return polygonIntersectsPolygon((geom as GeoJSON.Polygon).coordinates, polygon);
  } else if (geom.type === 'MultiPolygon') {
    return (geom as GeoJSON.MultiPolygon).coordinates.some(poly =>
      polygonIntersectsPolygon(poly, polygon)
    );
  }

  return false;
}

/** Calculate bounding box for a polygon */
export function calculatePolygonBbox(polygon: number[][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const coord of polygon) {
    const [lng, lat] = coord;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat];
}
