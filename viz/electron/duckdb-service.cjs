'use strict';

/**
 * DuckDB service for the Electron main process.
 *
 * Owns the lifecycle of a single active project database (one `project.duckdb`
 * file per project, matching the one-DB-per-project model in viz/AGENTS.md).
 * The renderer never touches DuckDB directly; it calls these functions over IPC
 * (see main.cjs `desktop:db:*` handlers). The native addon is lazy-required so
 * non-desktop environments (and the browser build) never load it.
 */

const path = require('path');

let duckdb = null;
function getDuckDb() {
  if (duckdb) return duckdb;
  try {
    // @duckdb/node-api ("Neo" client). Requires a native addon matching the
    // Electron ABI — see the `rebuild:desktop` npm script.
    duckdb = require('@duckdb/node-api');
  } catch (err) {
    throw new Error(
      `Failed to load @duckdb/node-api. Run "npm run rebuild:desktop" so the ` +
      `native addon matches Electron's ABI. Original error: ${err.message}`
    );
  }
  return duckdb;
}

// Active project DB state. Single active DB at a time (single-user desktop).
let activeInstance = null;
let activeConnection = null;
let activeDbPath = null;

/** Load the spatial + h3 extensions. Tries LOAD first (bundled/offline), then
 *  falls back to INSTALL+LOAD (requires network on first run). */
async function loadExtensions(connection) {
  const extensions = ['spatial', 'h3'];
  for (const ext of extensions) {
    try {
      await connection.run(`LOAD ${ext};`);
    } catch (_loadErr) {
      // Not present locally — try to install then load. h3 is a community
      // extension, so it may require `INSTALL ... FROM community`.
      try {
        await connection.run(`INSTALL ${ext};`);
      } catch (_e) {
        await connection.run(`INSTALL ${ext} FROM community;`).catch(() => {});
      }
      // spatial is required; h3 is best-effort (used only for hex LOD later).
      if (ext === 'spatial') {
        await connection.run(`LOAD ${ext};`);
      } else {
        await connection.run(`LOAD ${ext};`).catch(() => {});
      }
    }
  }
}

async function openDatabase(dbPath) {
  const resolved = path.resolve(dbPath);
  if (activeDbPath === resolved && activeConnection) {
    return { ok: true, dbPath: resolved, reused: true };
  }
  await closeDatabase();

  const { DuckDBInstance } = getDuckDb();
  activeInstance = await DuckDBInstance.create(resolved, {
    // Allow loading locally-bundled (unsigned) extensions for offline desktop.
    allow_unsigned_extensions: 'true'
  });
  activeConnection = await activeInstance.connect();
  activeDbPath = resolved;
  await loadExtensions(activeConnection);
  return { ok: true, dbPath: resolved, reused: false };
}

async function closeDatabase() {
  try {
    if (activeConnection && typeof activeConnection.closeSync === 'function') {
      activeConnection.closeSync();
    } else if (activeConnection && typeof activeConnection.disconnectSync === 'function') {
      activeConnection.disconnectSync();
    }
  } catch (_e) { /* ignore */ }
  try {
    if (activeInstance && typeof activeInstance.closeSync === 'function') {
      activeInstance.closeSync();
    }
  } catch (_e) { /* ignore */ }
  activeConnection = null;
  activeInstance = null;
  activeDbPath = null;
}

function requireConnection() {
  if (!activeConnection) {
    throw new Error('No active project database. Open or create a project first.');
  }
  return activeConnection;
}

/** Convert DuckDB row objects into plain JSON-safe objects (BigInt -> number/string). */
function sanitizeRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) {
      const v = row[key];
      if (typeof v === 'bigint') {
        // Preserve precision for very large ints by falling back to string.
        out[key] = (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER))
          ? Number(v) : v.toString();
      } else {
        out[key] = v;
      }
    }
    return out;
  });
}

/** Run a read query, returning row objects. `params` are positional ($1,$2,...). */
async function query(sql, params) {
  const conn = requireConnection();
  let reader;
  if (params && params.length) {
    const prepared = await conn.prepare(sql);
    params.forEach((p, i) => bindParam(prepared, i + 1, p));
    reader = await prepared.runAndReadAll();
  } else {
    reader = await conn.runAndReadAll(sql);
  }
  return { rows: sanitizeRows(reader.getRowObjects()) };
}

/** Run a write/DDL statement. Returns affected info where available. */
async function exec(sql, params) {
  const conn = requireConnection();
  if (params && params.length) {
    const prepared = await conn.prepare(sql);
    params.forEach((p, i) => bindParam(prepared, i + 1, p));
    await prepared.run();
  } else {
    await conn.run(sql);
  }
  return { ok: true };
}

function bindParam(prepared, index, value) {
  if (value === null || value === undefined) {
    prepared.bindNull(index);
  } else if (typeof value === 'number') {
    if (Number.isInteger(value)) prepared.bindInteger(index, value);
    else prepared.bindDouble(index, value);
  } else if (typeof value === 'boolean') {
    prepared.bindBoolean(index, value);
  } else {
    prepared.bindVarchar(index, String(value));
  }
}

module.exports = {
  openDatabase,
  closeDatabase,
  query,
  exec,
  // exposed for the import pipeline (project-service builds tables via these)
  _internal: { requireConnection, getDuckDb }
};
