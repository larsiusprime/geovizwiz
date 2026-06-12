/**
 * Pure H3 aggregation of parcel polygons into a hexagon FeatureCollection.
 *
 * No DOM / app-state / MapLibre dependencies, so this runs unchanged in a web
 * worker. The output is shaped like a normal parcel layer: a FeatureCollection
 * of hex polygons, each carrying a single numeric `hexMetric` property, so the
 * existing extrusion/color render path can consume it directly.
 *
 * Value/acre is computed correctly by accumulating the numerator and denominator
 * separately per hex and dividing once at the end — never by averaging per-parcel
 * ratios. A large parcel is distributed (even split) across every hex it covers,
 * so "parcel deserts" tile continuously instead of spiking a single hex.
 */
import { latLngToCell, polygonToCells, cellToBoundary } from 'h3-js';

export type HexReducer = 'sum' | 'ratio';

export interface HexAggregateOptions {
  field: string;             // numeric field to aggregate (numerator)
  denomField: string | null; // denominator field for 'ratio' (e.g. land area)
  reducer: HexReducer;       // 'sum' (as-is) or 'ratio' (value per denom)
  resolution: number;        // H3 resolution
}

// Signed-area centroid of a ring of [lng,lat] points; falls back to vertex
// average for degenerate rings. Returns [lng,lat] or null.
function ringCentroid(ring: number[][]): [number, number] | null {
  if (!ring || ring.length < 3) return null;
  let area2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area2) < 1e-12) {
    let sx = 0, sy = 0, n = 0;
    for (const [x, y] of ring) { sx += x; sy += y; n++; }
    return n ? [sx / n, sy / n] : null;
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}

// Normalize geometry into a list of polygons, each `[outerRing, ...holes]`.
function polysOf(geom: GeoJSON.Geometry | null | undefined): number[][][][] | null {
  if (!geom) return null;
  if (geom.type === 'Polygon') return [geom.coordinates as number[][][]];
  if (geom.type === 'MultiPolygon') return geom.coordinates as number[][][][];
  return null;
}

/**
 * The set of hex cells a parcel deposits into, at a given resolution:
 *  - every hex the polygon covers (large parcels tile continuously), or
 *  - the single hex containing its centroid (parcel smaller than a hex, or
 *    h3 rejected a degenerate ring), or
 *  - `[]` when the parcel is too degenerate to place anywhere (caller skips it).
 *
 * h3 throws `E_FAILED` on some real-world rings (zero-area slivers, duplicate
 * points); those are caught and fall through to the centroid.
 */
export function coverCellsForGeometry(geom: GeoJSON.Geometry | null | undefined, resolution: number): string[] {
  const polys = polysOf(geom);
  if (!polys) return [];

  const covered = new Set<string>();
  try {
    for (const rings of polys) {
      const cells = polygonToCells(rings as any, resolution, true) as string[];
      for (const c of cells) covered.add(c);
    }
  } catch {
    covered.clear();
  }
  if (covered.size > 0) return Array.from(covered);

  // Centroid fallback.
  const c = ringCentroid(polys[0][0]);
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) ||
      Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) return [];
  try {
    return [latLngToCell(c[1], c[0], resolution)];
  } catch {
    return [];
  }
}

/**
 * Reduce per-cell numerator/denominator accumulators into a hex FeatureCollection.
 * `ratio` true → metric = Σnum / Σden (value per denom); false → metric = Σnum.
 */
export function reduceToHexFC(
  numByCell: Map<string, number>,
  denByCell: Map<string, number>,
  ratio: boolean,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  let id = 0;
  for (const [cell, num] of numByCell) {
    let metric: number;
    if (ratio) {
      const den = denByCell.get(cell) ?? 0;
      if (den <= 0) continue;
      metric = num / den;
    } else {
      metric = num;
    }
    if (!Number.isFinite(metric)) continue;

    const ring = cellToBoundary(cell, true) as number[][]; // [lng,lat], closed
    features.push({
      type: 'Feature',
      id: id++,
      properties: { h3: cell, hexMetric: metric },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Synchronous aggregation (used for tests and as a non-worker fallback). The
 * worker re-implements the same flow with chunked progress + cancellation.
 */
export function aggregateToHexFC(
  parcels: GeoJSON.FeatureCollection,
  opts: HexAggregateOptions,
): GeoJSON.FeatureCollection {
  const { field, denomField, resolution } = opts;
  const ratio = opts.reducer === 'ratio' && !!denomField;

  const numByCell = new Map<string, number>();
  const denByCell = new Map<string, number>();
  let skipped = 0;

  for (const f of parcels.features) {
    const p = (f.properties || {}) as Record<string, any>;
    const num = Number(p[field]);
    if (!Number.isFinite(num)) continue;

    let den = 1;
    if (ratio) {
      den = Number(p[denomField!]);
      if (!Number.isFinite(den) || den <= 0) continue; // mirrors per-parcel guard
    }

    const cells = coverCellsForGeometry(f.geometry, resolution);
    if (cells.length === 0) { skipped++; continue; }

    const w = 1 / cells.length;
    for (const cell of cells) {
      numByCell.set(cell, (numByCell.get(cell) ?? 0) + num * w);
      denByCell.set(cell, (denByCell.get(cell) ?? 0) + den * w);
    }
  }

  if (skipped > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[hex] ${skipped} parcels could not be assigned to a hexagon and were skipped`);
  }

  return reduceToHexFC(numByCell, denByCell, ratio);
}
