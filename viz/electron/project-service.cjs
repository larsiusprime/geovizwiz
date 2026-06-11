'use strict';

/**
 * Project lifecycle + import pipeline for the Electron main process.
 *
 * A project is a folder containing:
 *   viz-project.json   project metadata (no secrets)
 *   project.duckdb     the project's embedded DuckDB database
 *   data/raw/          original imported source files (retained)
 *   data/derived/      derived outputs / caches / materializations
 *   assets/            user assets
 *   logs/              project logs
 *
 * Implements Milestones 2 & 4 from viz/AGENTS.md.
 */

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const duckdbService = require('./duckdb-service.cjs');

const PROJECT_FILE = 'viz-project.json';
const DB_FILE = 'project.duckdb';
const SCHEMA_VERSION = 1;

const SUBDIRS = ['data/raw', 'data/derived', 'assets', 'logs'];

function nowIso() {
  return new Date().toISOString();
}

function projectFilePath(projectRoot) {
  return path.join(projectRoot, PROJECT_FILE);
}

function dbFilePath(projectRoot) {
  return path.join(projectRoot, DB_FILE);
}

/** Sanitize an arbitrary source name into a safe SQL identifier. */
function sanitizeTableName(name) {
  let id = String(name || 'source')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')        // drop extension
    .replace(/[^a-z0-9_]+/g, '_')   // non-identifier chars -> _
    .replace(/^_+|_+$/g, '')        // trim underscores
    .replace(/_{2,}/g, '_');        // collapse repeats
  if (!id) id = 'source';
  if (/^[0-9]/.test(id)) id = `t_${id}`; // identifiers cannot start with a digit
  return id.slice(0, 60);
}

async function readProjectFile(projectRoot) {
  const raw = await fs.readFile(projectFilePath(projectRoot), 'utf-8');
  return JSON.parse(raw);
}

async function writeProjectFile(projectRoot, meta) {
  meta.updatedAt = nowIso();
  await fs.writeFile(projectFilePath(projectRoot), JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

/** Create a new project folder, scaffold structure, and open its DB. */
async function createProject(parentDir, name) {
  if (!parentDir || !name) throw new Error('parentDir and name are required.');
  const folderName = String(name).trim();
  if (!folderName) throw new Error('Project name cannot be empty.');

  const projectRoot = path.resolve(parentDir, folderName);
  await fs.mkdir(projectRoot, { recursive: true });
  for (const sub of SUBDIRS) {
    await fs.mkdir(path.join(projectRoot, sub), { recursive: true });
  }

  const meta = {
    projectId: crypto.randomUUID(),
    name: folderName,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    schemaVersion: SCHEMA_VERSION,
    dbBinding: DB_FILE,
    sources: [],
    // Layer/filter/land-schedule blocks (browser-export lineage) attach here.
    app: null
  };
  await writeProjectFile(projectRoot, meta);

  await duckdbService.openDatabase(dbFilePath(projectRoot));
  return { projectRoot, meta };
}

/** Open an existing project: validate, migrate forward, open DB. */
async function openProject(projectRoot) {
  if (!projectRoot) throw new Error('projectRoot is required.');
  let meta;
  try {
    meta = await readProjectFile(projectRoot);
  } catch (_e) {
    throw new Error(`Not a VIZ project (missing ${PROJECT_FILE}): ${projectRoot}`);
  }

  meta = await migrateForward(projectRoot, meta);
  await duckdbService.openDatabase(dbFilePath(projectRoot));
  return { projectRoot, meta };
}

/** Forward-only migrations keyed by schemaVersion. Adds steps as schema evolves. */
async function migrateForward(projectRoot, meta) {
  const current = Number(meta.schemaVersion || 0);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Project was created by a newer app version (schema ${current} > ${SCHEMA_VERSION}). ` +
      `Update the app to open it.`
    );
  }
  // No migrations needed yet (v1). When SCHEMA_VERSION bumps, apply ordered,
  // backup-safe steps here and persist the updated meta.
  if (current < SCHEMA_VERSION) {
    meta.schemaVersion = SCHEMA_VERSION;
    await writeProjectFile(projectRoot, meta);
  }
  return meta;
}

/** Delete a project: close its DB, then remove the whole folder. */
async function deleteProject(projectRoot) {
  if (!projectRoot) throw new Error('projectRoot is required.');
  await duckdbService.closeDatabase();
  await fs.rm(projectRoot, { recursive: true, force: true });
  return { ok: true };
}

/** Persist the app-state block (layers/filters/etc.) into viz-project.json. */
async function saveAppState(projectRoot, appBlock) {
  const meta = await readProjectFile(projectRoot);
  meta.app = appBlock ?? null;
  await writeProjectFile(projectRoot, meta);
  return { ok: true };
}

/**
 * Import a source file into the project DB.
 * - Copies the original into data/raw/ (retained).
 * - Creates one physical table (sanitized name) with a GEOMETRY `geom` column
 *   and a stable `parcel_id`.
 * - Builds an R-tree index on geom and a unique index on parcel_id.
 *
 * opts: { projectRoot, sourcePath, sourceName?, parcelIdField? }
 */
async function importSource(opts) {
  const { projectRoot, sourcePath } = opts;
  if (!projectRoot || !sourcePath) throw new Error('projectRoot and sourcePath are required.');

  const sourceName = opts.sourceName || path.basename(sourcePath);
  const tableName = sanitizeTableName(sourceName);

  // 1. Copy raw file into data/raw (retain original).
  const rawTarget = path.join(projectRoot, 'data', 'raw', path.basename(sourcePath));
  await fs.copyFile(sourcePath, rawTarget);

  // 2. Load into a staging table. Parquet/GeoParquet must use the native
  //    read_parquet reader (GDAL's parquet driver is not in the bundled spatial
  //    extension); everything else (shapefile, GPKG, GeoJSON, FlatGeobuf) goes
  //    through ST_Read (GDAL). Both yield a GEOMETRY-typed geometry column.
  const rawPosix = rawTarget.split(path.sep).join('/').replace(/'/g, "''");
  const ext = path.extname(rawTarget).toLowerCase();
  const reader = (ext === '.parquet' || ext === '.geoparquet')
    ? `read_parquet('${rawPosix}')`
    : `ST_Read('${rawPosix}')`;
  const staging = `${tableName}_staging`;
  await duckdbService.exec(`DROP TABLE IF EXISTS "${staging}";`);
  await duckdbService.exec(`CREATE TABLE "${staging}" AS SELECT * FROM ${reader};`);

  // 2b. Detect the geometry column (any column whose type contains GEOMETRY)
  //     and capture its SRID/CRS from the type modifier, e.g. GEOMETRY('EPSG:4326').
  const stagingCols = await duckdbService.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${staging}';`
  );
  const geomRow = stagingCols.rows.find(
    (r) => String(r.data_type).toUpperCase().includes('GEOMETRY')
  );
  const geomCol = geomRow ? geomRow.column_name : null;
  let srid = null;
  if (geomRow) {
    const m = String(geomRow.data_type).match(/\(['"]?([^'")]+)['"]?\)/);
    if (m) srid = m[1];
  }

  // 3. Build the final table with a stable parcel_id. Normalize the geometry to
  //    a plain GEOMETRY column named `geom` (the SRID-annotated type that
  //    read_parquet/ST_Read produce cannot be R-tree indexed directly).
  const pkField = opts.parcelIdField && String(opts.parcelIdField).trim();
  const pidExpr = pkField
    ? `CAST("${pkField}" AS VARCHAR)`
    : `CAST(row_number() OVER () AS VARCHAR)`;
  await duckdbService.exec(`DROP TABLE IF EXISTS "${tableName}";`);
  if (geomCol) {
    await duckdbService.exec(
      `CREATE TABLE "${tableName}" AS ` +
      `SELECT ${pidExpr} AS parcel_id, * EXCLUDE ("${geomCol}"), ` +
      `CAST("${geomCol}" AS GEOMETRY) AS geom FROM "${staging}";`
    );
  } else {
    await duckdbService.exec(
      `CREATE TABLE "${tableName}" AS SELECT ${pidExpr} AS parcel_id, * FROM "${staging}";`
    );
  }
  await duckdbService.exec(`DROP TABLE IF EXISTS "${staging}";`);

  // 4. Indexes: R-tree on geometry (if present) + unique on parcel_id.
  const cols = await duckdbService.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName}';`
  );
  const hasGeom = Boolean(geomCol);
  if (hasGeom) {
    await duckdbService.exec(`CREATE INDEX "${tableName}_geom_idx" ON "${tableName}" USING RTREE (geom);`);
  }
  await duckdbService.exec(
    `CREATE UNIQUE INDEX "${tableName}_pid_idx" ON "${tableName}" (parcel_id);`
  ).catch(async () => {
    // parcel_id collisions (non-unique pk field) — fall back to a non-unique index.
    await duckdbService.exec(`CREATE INDEX "${tableName}_pid_idx" ON "${tableName}" (parcel_id);`);
  });

  const countRes = await duckdbService.query(`SELECT count(*) AS n FROM "${tableName}";`);
  const featureCount = Number(countRes.rows?.[0]?.n ?? 0);

  // 5. Record the logical source in viz-project.json.
  const meta = await readProjectFile(projectRoot);
  const sourceId = crypto.randomUUID();
  const record = {
    id: sourceId,
    name: sourceName,
    table: tableName,
    rawFile: path.relative(projectRoot, rawTarget).split(path.sep).join('/'),
    parcelIdField: pkField || null,
    hasGeometry: hasGeom,
    srid: srid || null,
    featureCount,
    columns: cols.rows.map((r) => ({ name: r.column_name, type: r.data_type })),
    importedAt: nowIso()
  };
  meta.sources = (meta.sources || []).filter((s) => s.table !== tableName);
  meta.sources.push(record);
  await writeProjectFile(projectRoot, meta);

  return record;
}

module.exports = {
  createProject,
  openProject,
  deleteProject,
  saveAppState,
  importSource,
  readProjectFile,
  sanitizeTableName,
  PROJECT_FILE,
  DB_FILE,
  SCHEMA_VERSION
};
