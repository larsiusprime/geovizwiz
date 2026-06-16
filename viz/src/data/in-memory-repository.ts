/**
 * Browser-mode repository. Answers all queries from the in-memory GeoJSON the
 * user uploaded (`S.currentGeoJSON` and the active DataStore). This keeps the
 * browser build's behavior identical to today — the repository is just a thin,
 * uniform read surface over the same data structures.
 */

import { S } from '../state.js';
import type {
  BBox,
  DataRepository,
  FieldStats,
  GeometryQueryOptions,
  SourceInfo
} from './repository.js';

function getParcelId(feature: GeoJSON.Feature, index: number): string {
  if (feature.id !== undefined && feature.id !== null) return String(feature.id);
  const props = feature.properties || {};
  const cand = props.id ?? props.ID ?? props.fid ?? props.FID;
  return cand !== undefined && cand !== null ? String(cand) : String(index);
}

function featureIntersectsBBox(feature: GeoJSON.Feature, b: BBox): boolean {
  // Cheap bbox test over coordinate extents; good enough for in-memory culling.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords: any) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    } else {
      for (const c of coords) visit(c);
    }
  };
  const geom = feature.geometry as any;
  if (!geom || !geom.coordinates) return false;
  visit(geom.coordinates);
  return !(maxX < b.minLng || minX > b.maxLng || maxY < b.minLat || minY > b.maxLat);
}

export class InMemoryRepository implements DataRepository {
  readonly kind = 'memory' as const;

  async listSources(): Promise<SourceInfo[]> {
    const sources: SourceInfo[] = [];
    S.dataStores.forEach((store) => {
      sources.push({
        id: store.id,
        name: store.name,
        numericFields: [...store.chosenNumericFields],
        categoricalFields: [...store.chosenCategoricalFields],
        featureCount: store.geojson?.features?.length ?? 0,
        parcelIdField: store.parcelIdField,
        hasGeometry: Boolean(store.geojson?.features?.length)
      });
    });
    return sources;
  }

  private resolveCollection(sourceId: string): GeoJSON.FeatureCollection | null {
    const store = S.dataStores.get(sourceId);
    if (store?.geojson) return store.geojson;
    return S.currentGeoJSON;
  }

  async queryGeometryByBBox(
    sourceId: string,
    bbox: BBox,
    opts?: GeometryQueryOptions
  ): Promise<GeoJSON.FeatureCollection> {
    const fc = this.resolveCollection(sourceId);
    if (!fc) return { type: 'FeatureCollection', features: [] };
    const limit = opts?.limit ?? Infinity;
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < fc.features.length && features.length < limit; i += 1) {
      const f = fc.features[i];
      if (featureIntersectsBBox(f, bbox)) features.push(f);
    }
    return { type: 'FeatureCollection', features };
  }

  async countGeometryByBBox(sourceId: string, bbox: BBox): Promise<number> {
    const fc = this.resolveCollection(sourceId);
    if (!fc) return 0;
    let n = 0;
    for (const f of fc.features) if (featureIntersectsBBox(f, bbox)) n += 1;
    return n;
  }

  async getSourceExtent(sourceId: string): Promise<BBox | null> {
    const fc = this.resolveCollection(sourceId);
    if (!fc?.features?.length) return null;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const visit = (coords: any) => {
      if (typeof coords[0] === 'number') {
        const [x, y] = coords;
        if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
        if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
      } else {
        for (const c of coords) visit(c);
      }
    };
    for (const f of fc.features) {
      const g = f.geometry as any;
      if (g?.coordinates) visit(g.coordinates);
    }
    if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
    return { minLng, minLat, maxLng, maxLat };
  }

  async queryFieldValues(
    sourceId: string,
    field: string,
    ids: string[]
  ): Promise<Map<string, number | string | null>> {
    const fc = this.resolveCollection(sourceId);
    const out = new Map<string, number | string | null>();
    if (!fc) return out;
    const wanted = new Set(ids);
    fc.features.forEach((f, i) => {
      const id = getParcelId(f, i);
      if (!wanted.has(id)) return;
      const v = (f.properties || {})[field];
      out.set(id, v == null ? null : (v as number | string));
    });
    return out;
  }

  async queryStats(sourceId: string, field: string): Promise<FieldStats | null> {
    const fc = this.resolveCollection(sourceId);
    if (!fc) return null;
    let min = Infinity, max = -Infinity, count = 0;
    for (const f of fc.features) {
      const raw = (f.properties || {})[field];
      const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
      if (Number.isFinite(n)) {
        if (n < min) min = n;
        if (n > max) max = n;
        count += 1;
      }
    }
    if (count === 0) return null;
    return { min, max, count };
  }
}
