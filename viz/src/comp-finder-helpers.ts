/**
 * Pure geometry / math / formatting helpers for the comp finder (Track C).
 *
 * Stateless functions over coordinates, features, and field values — no module
 * state, no DOM. Distance math, distance-circle geometry, pagination tokens, and
 * comp-vs-subject delta formatting.
 */
import { bbox } from './utils.geo';
import { numOrNull, fmt } from './utils.number';
export function destinationPoint(center: [number, number], bearingDeg: number, distanceMeters: number): [number, number] {
  const R = 6371008.8;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (center[1] * Math.PI) / 180;
  const lon1 = (center[0] * Math.PI) / 180;
  const dByR = distanceMeters / R;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinD = Math.sin(dByR);
  const cosD = Math.cos(dByR);
  const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
  return [((lon2 * 180) / Math.PI + 540) % 360 - 180, (lat2 * 180) / Math.PI];
}

export function makeDistanceCircleFeature(center: [number, number], radiusMeters: number): GeoJSON.Feature {
  const coordinates: [number, number][] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i += 1) {
    coordinates.push(destinationPoint(center, (i / steps) * 360, radiusMeters));
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

export function getFeatureCenter(feature: GeoJSON.Feature): [number, number] | null {
  if (!feature.geometry) return null;
  const bounds = bbox({ type: 'FeatureCollection', features: [feature] });
  if (!bounds) return null;
  const [minLng, minLat, maxLng, maxLat] = bounds;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

export function isValidLngLat(coord: [number, number] | null | undefined): coord is [number, number] {
  return coord != null
    && Number.isFinite(coord[0])
    && Number.isFinite(coord[1])
    && Math.abs(coord[0]) <= 180
    && Math.abs(coord[1]) <= 90;
}

export function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function getPageTokens(total: number, page: number): Array<number | '...'> {
  if (total <= 5) return Array.from({ length: total }, (_, idx) => idx + 1);
  if (page <= 2) return [1, 2, 3, 4, '...', total];
  if (page >= total - 1) return [1, '...', total - 3, total - 2, total - 1, total];
  return [1, '...', page - 1, page, page + 1, '...', total];
}

export function getDeltaClass(delta: { sign?: 'positive' | 'negative' | 'neutral' | 'error' }) {
  if (delta.sign === 'positive') return 'comp-finder-delta-positive';
  if (delta.sign === 'negative') return 'comp-finder-delta-negative';
  return '';
}

export function buildDelta(value: any, subjectValue: any, type: 'numeric' | 'categorical') {
  if (type === 'numeric') {
    const compVal = numOrNull(value);
    const subjVal = numOrNull(subjectValue);
    if (compVal === null || subjVal === null) {
      (window as any).desktopApi?.log('error', `[CompFinder Debug] buildDelta ERROR (numeric): compVal=${compVal} (raw: ${value}), subjVal=${subjVal} (raw: ${subjectValue})`);
      return { text: 'ERROR', error: 'Missing numeric value', sign: 'error' as const };
    }
    const delta = compVal - subjVal;
    if (delta === 0) return { text: '=', sign: 'neutral' as const };
    const sign = delta > 0 ? '+' : '';
    return { text: `${sign}${fmt(delta)}`, sign: delta > 0 ? 'positive' as const : 'negative' as const };
  }
  if (value === null || value === undefined || subjectValue === null || subjectValue === undefined) {
    (window as any).desktopApi?.log('error', `[CompFinder Debug] buildDelta ERROR (categorical): compVal=${value}, subjVal=${subjectValue}`);
    return { text: 'ERROR', error: 'Missing categorical value', sign: 'error' as const };
  }
  if (String(value) === String(subjectValue)) return { text: '=', sign: 'neutral' as const };
  return { text: String(value), sign: 'negative' as const };
}
