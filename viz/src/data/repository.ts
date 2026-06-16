/**
 * DataRepository — the data-access seam that lets the renderer be agnostic
 * about where geometry/attributes live.
 *
 *  - InMemoryRepository (browser): answers from the in-memory GeoJSON the user
 *    uploaded — preserves today's browser behavior exactly.
 *  - DesktopRepository (desktop): answers from the project's DuckDB database
 *    over the `window.vizDesktop.db.*` IPC bridge.
 *
 * Phase 1 (DuckDB-bbox-first, per the approved plan) returns geometry *with*
 * the requested attribute fields as feature properties, so the existing
 * expression-based rendering (`['get', field]`) works unchanged. When geometry
 * moves to static PMTiles, only `queryGeometryByBBox`'s producer changes and
 * attribute values get pushed via `feature-state` instead.
 */

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface SourceInfo {
  id: string;
  name: string;
  /** DB table name (desktop only). */
  table?: string;
  numericFields: string[];
  categoricalFields: string[];
  featureCount: number;
  parcelIdField: string | null;
  hasGeometry: boolean;
}

export interface GeometryQueryOptions {
  /** Attribute fields to include as feature properties. */
  fields?: string[];
  /** Current map zoom (drives simplification). */
  zoom?: number;
  /** Geometry simplification tolerance in degrees (0 / undefined = none). */
  simplifyTolerance?: number;
  /** Hard cap on returned features (safety valve). */
  limit?: number;
  /** Abort signal: producers should stop work and yield cooperatively so a
   *  long parse doesn't freeze the UI and can be cancelled mid-flight. */
  signal?: AbortSignal;
}

export interface FieldStats {
  min: number;
  max: number;
  count: number;
}

export interface DataRepository {
  readonly kind: 'memory' | 'desktop';

  /** List logical data sources available to the app. */
  listSources(): Promise<SourceInfo[]>;

  /**
   * Return geometry (+ requested attribute fields) intersecting `bbox`.
   * Each feature's `id` is the stable parcel id.
   */
  queryGeometryByBBox(
    sourceId: string,
    bbox: BBox,
    opts?: GeometryQueryOptions
  ): Promise<GeoJSON.FeatureCollection>;

  /** Count features intersecting `bbox` (cheap pre-check before a heavy fetch). */
  countGeometryByBBox(sourceId: string, bbox: BBox): Promise<number>;

  /**
   * All attribute values (no geometry) for a single parcel — used to populate
   * the inspect popup on demand when the viewport fetch only carried a lean set
   * of columns. Returns null if the parcel isn't found.
   */
  queryRowById(sourceId: string, parcelId: string): Promise<Record<string, unknown> | null>;

  /** Full geographic extent of a source's geometry, or null if it has none. */
  getSourceExtent(sourceId: string): Promise<BBox | null>;

  /** Return values of `field` for the given parcel ids (drives feature-state later). */
  queryFieldValues(
    sourceId: string,
    field: string,
    ids: string[]
  ): Promise<Map<string, number | string | null>>;

  /** Numeric min/max/count for a field (legend domains, breaks). */
  queryStats(sourceId: string, field: string): Promise<FieldStats | null>;
}
