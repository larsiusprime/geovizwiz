/**
 * Desktop-mode repository. Answers queries from the project's DuckDB database
 * over the `window.vizDesktop.db.*` IPC bridge (DB access runs in the Electron
 * main process; the renderer only sends SQL).
 *
 * Geometry queries use `ST_Intersects` against an `ST_MakeEnvelope` of the
 * viewport (accelerated by the R-tree index built at import time) and return
 * GeoJSON via `ST_AsGeoJSON`, optionally simplified per zoom.
 */

import type {
  BBox,
  DataRepository,
  FieldStats,
  GeometryQueryOptions,
  SourceInfo
} from './repository.js';

const NUMERIC_DB_TYPES = [
  'TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'HUGEINT',
  'UTINYINT', 'USMALLINT', 'UINTEGER', 'UBIGINT',
  'FLOAT', 'DOUBLE', 'REAL', 'DECIMAL', 'NUMERIC'
];

function isNumericType(dbType: string): boolean {
  const t = String(dbType).toUpperCase();
  return NUMERIC_DB_TYPES.some((n) => t.startsWith(n));
}

/** Quote a SQL identifier (double quotes, escape embedded quotes). */
function qid(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Escape a string literal for inlining (parcel_id IN (...) etc.). */
function lit(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function db() {
  const api = window.vizDesktop?.db;
  if (!api) throw new Error('Desktop DB bridge unavailable (not running in desktop mode).');
  return api;
}

export class DesktopRepository implements DataRepository {
  readonly kind = 'desktop' as const;

  private tableById = new Map<string, string>();

  async listSources(): Promise<SourceInfo[]> {
    const current = await window.vizDesktop?.project.current();
    const meta = current?.meta;
    const sources: SourceInfo[] = (meta?.sources ?? []).map((s) => {
      const numericFields: string[] = [];
      const categoricalFields: string[] = [];
      for (const col of s.columns ?? []) {
        const name = col.name;
        if (name === 'geom' || name === 'parcel_id') continue;
        if (String(col.type).toUpperCase().includes('GEOMETRY')) continue;
        if (isNumericType(col.type)) numericFields.push(name);
        else categoricalFields.push(name);
      }
      return {
        id: s.id,
        name: s.name,
        table: s.table,
        numericFields,
        categoricalFields,
        featureCount: s.featureCount,
        parcelIdField: s.parcelIdField,
        hasGeometry: s.hasGeometry
      };
    });
    this.tableById = new Map(sources.map((s) => [s.id, s.table!]));
    return sources;
  }

  private async resolveTable(sourceId: string): Promise<string> {
    if (this.tableById.has(sourceId)) return this.tableById.get(sourceId)!;
    await this.listSources();
    const table = this.tableById.get(sourceId);
    if (!table) throw new Error(`Unknown source: ${sourceId}`);
    return table;
  }

  async queryGeometryByBBox(
    sourceId: string,
    bbox: BBox,
    opts?: GeometryQueryOptions
  ): Promise<GeoJSON.FeatureCollection> {
    const table = await this.resolveTable(sourceId);
    const fields = (opts?.fields ?? []).filter(Boolean);
    const tol = opts?.simplifyTolerance ?? 0;

    const geomExpr = tol > 0
      ? `ST_AsGeoJSON(ST_Simplify(geom, ${tol}))`
      : `ST_AsGeoJSON(geom)`;
    const fieldSelect = fields.map((f) => qid(f)).join(', ');
    const selectCols = ['parcel_id', `${geomExpr} AS _geojson`]
      .concat(fields.length ? [fieldSelect] : [])
      .join(', ');

    const env = `ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat})`;
    let sql =
      `SELECT ${selectCols} FROM ${qid(table)} ` +
      `WHERE geom IS NOT NULL AND ST_Intersects(geom, ${env})`;
    if (opts?.limit && Number.isFinite(opts.limit)) sql += ` LIMIT ${Math.floor(opts.limit)}`;

    const { rows } = await db().query(sql);
    const features: GeoJSON.Feature[] = [];
    for (const row of rows) {
      const gj = row._geojson;
      if (!gj) continue;
      let geometry: GeoJSON.Geometry;
      try {
        geometry = typeof gj === 'string' ? JSON.parse(gj) : (gj as GeoJSON.Geometry);
      } catch {
        continue;
      }
      const properties: Record<string, unknown> = {};
      for (const f of fields) properties[f] = (row as any)[f];
      features.push({
        type: 'Feature',
        id: String(row.parcel_id),
        geometry,
        properties
      });
    }
    return { type: 'FeatureCollection', features };
  }

  async queryFieldValues(
    sourceId: string,
    field: string,
    ids: string[]
  ): Promise<Map<string, number | string | null>> {
    const out = new Map<string, number | string | null>();
    if (!ids.length) return out;
    const table = await this.resolveTable(sourceId);
    // Chunk the IN list to keep statements bounded.
    const CHUNK = 5000;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK).map(lit).join(', ');
      const sql =
        `SELECT parcel_id, ${qid(field)} AS v FROM ${qid(table)} ` +
        `WHERE parcel_id IN (${slice})`;
      const { rows } = await db().query(sql);
      for (const row of rows) {
        const v = (row as any).v;
        out.set(String(row.parcel_id), v == null ? null : (v as number | string));
      }
    }
    return out;
  }

  async queryStats(sourceId: string, field: string): Promise<FieldStats | null> {
    const table = await this.resolveTable(sourceId);
    const col = qid(field);
    const sql =
      `SELECT min(TRY_CAST(${col} AS DOUBLE)) AS mn, ` +
      `max(TRY_CAST(${col} AS DOUBLE)) AS mx, ` +
      `count(TRY_CAST(${col} AS DOUBLE)) AS n FROM ${qid(table)}`;
    const { rows } = await db().query(sql);
    const r = rows[0] as any;
    if (!r || !r.n) return null;
    return { min: Number(r.mn), max: Number(r.mx), count: Number(r.n) };
  }
}
