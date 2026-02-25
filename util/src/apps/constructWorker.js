/* global importScripts */
importScripts('../../vendor/gdal/gdal3.js','../../vendor/wkx/dist/wkx.js','../../vendor/apache-arrow.js','../../vendor/fflate/index.min.js');

const GDAL_BASE = new URL('../../vendor/gdal/', self.location).toString();
const gdalPromise = self.initGdalJs({ path: GDAL_BASE, useWorker: false });
const textDecoder = new TextDecoder('utf-8');
const send = (type, payload) => self.postMessage({ type, payload });
const debug = (message) => send('log', { message: `[Construct inspect] ${message}` });
const slugify = (value) => String(value).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
let parquetModulePromise = null;
let parquetInitialized = false;

const readZipEntries = (buffer) => { const sig = new Uint8Array(buffer.slice(0,4)); const isZip = sig[0]===0x50 && sig[1]===0x4b; if (!isZip || !self.fflate?.unzipSync) return null; try { return self.fflate.unzipSync(new Uint8Array(buffer)); } catch (_) { return null; } };
const toFilesFromZipEntries = (entries) => Object.entries(entries || {}).map(([name, bytes]) => new File([bytes], name));
const ensureShapefileParts = (entries) => { const names = Object.keys(entries||{}).map((name)=>name.toLowerCase()); if (!names.some((n)=>n.endsWith('.shp')) || !names.some((n)=>n.endsWith('.dbf'))) throw new Error('Not a supported format. This zip archive does not contain the required .shp and .dbf files for a valid ESRI Shapefile.'); if (!names.some((n)=>n.endsWith('.shx'))) throw new Error('Not a supported format. The zip archive is missing the .shx index file required for a complete ESRI Shapefile.'); };

const parseDelimitedRows = (text, delimiter) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') {
        i += 1;
      }
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.some((v) => v !== '')) {
    rows.push(row);
  }

  return rows;
};

const guessDelimiter = (text) => {
  const firstLine = (text || '').split(/\r?\n/)[0] || '';
  const cands = [',', ';', '\t', '|'];
  return cands
    .map((d) => ({ d, s: parseDelimitedRows(firstLine, d)[0]?.length || 0 }))
    .sort((a, b) => b.s - a.s)[0]?.d || ',';
};

const parseCsvContent = (text, csv = {}) => {
  const normalized = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const delimiter = csv.delimiter || guessDelimiter(normalized);
  const hasHeader = csv.hasHeader !== false;
  const rawRows = parseDelimitedRows(normalized, delimiter);
  const width = rawRows.reduce((m, r) => Math.max(m, r.length), 0);
  const header = hasHeader
    ? Array.from({ length: width }, (_, i) => (rawRows[0]?.[i] ?? '').trim() || `field_${i + 1}`)
    : Array.from({ length: width }, (_, i) => `field_${i + 1}`);
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
  const rows = dataRows.map((arr) => Object.fromEntries(header.map((h, i) => [h, arr[i] ?? ''])));
  return { delimiter, hasHeader, header, rows, previewRows: rows.slice(0, 8) };
};

const ensureParquetModule = async () => {
  if (!parquetModulePromise) {
    parquetModulePromise = import('../../vendor/parquet-wasm/esm/parquet_wasm.js').then(async (mod) => {
      if (!parquetInitialized) {
        const wasmUrl = new URL('../../vendor/parquet-wasm/esm/parquet_wasm_bg.wasm', self.location.href);
        const response = await fetch(wasmUrl);
        const bytes = await response.arrayBuffer();
        await mod.default(bytes);
        parquetInitialized = true;
      }
      return mod;
    });
  }
  return parquetModulePromise;
};

const parseGeoMetadata = (metadata) => {
  if (!metadata || typeof metadata.get !== 'function') return null;
  const geoValue = metadata.get('geo');
  if (!geoValue || typeof geoValue !== 'string') return null;
  try { return JSON.parse(geoValue); } catch (_) { return null; }
};

const parseWkbGeometry = (view, offset = 0) => {
  const littleEndian = view.getUint8(offset) === 1;
  offset += 1;
  const rawType = view.getUint32(offset, littleEndian);
  offset += 4;
  const baseType = rawType % 1000;
  const readPoint = () => {
    const x = view.getFloat64(offset, littleEndian);
    const y = view.getFloat64(offset + 8, littleEndian);
    offset += 16;
    return [x, y];
  };

  if (baseType === 1) return { geometry: { type: 'Point', coordinates: readPoint() }, offset };
  if (baseType === 2) {
    const count = view.getUint32(offset, littleEndian);
    offset += 4;
    const coords = [];
    for (let i = 0; i < count; i += 1) coords.push(readPoint());
    return { geometry: { type: 'LineString', coordinates: coords }, offset };
  }
  if (baseType === 3) {
    const ringCount = view.getUint32(offset, littleEndian);
    offset += 4;
    const rings = [];
    for (let i = 0; i < ringCount; i += 1) {
      const pointCount = view.getUint32(offset, littleEndian);
      offset += 4;
      const ring = [];
      for (let j = 0; j < pointCount; j += 1) ring.push(readPoint());
      rings.push(ring);
    }
    return { geometry: { type: 'Polygon', coordinates: rings }, offset };
  }
  if (baseType === 4) {
    const count = view.getUint32(offset, littleEndian);
    offset += 4;
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const result = parseWkbGeometry(view, offset);
      offset = result.offset;
      if (result.geometry?.type === 'Point') points.push(result.geometry.coordinates);
    }
    return { geometry: { type: 'MultiPoint', coordinates: points }, offset };
  }
  if (baseType === 5) {
    const count = view.getUint32(offset, littleEndian);
    offset += 4;
    const lines = [];
    for (let i = 0; i < count; i += 1) {
      const result = parseWkbGeometry(view, offset);
      offset = result.offset;
      if (result.geometry?.type === 'LineString') lines.push(result.geometry.coordinates);
    }
    return { geometry: { type: 'MultiLineString', coordinates: lines }, offset };
  }
  if (baseType === 6) {
    const count = view.getUint32(offset, littleEndian);
    offset += 4;
    const polygons = [];
    for (let i = 0; i < count; i += 1) {
      const result = parseWkbGeometry(view, offset);
      offset = result.offset;
      if (result.geometry?.type === 'Polygon') polygons.push(result.geometry.coordinates);
    }
    return { geometry: { type: 'MultiPolygon', coordinates: polygons }, offset };
  }
  throw new Error(`Unsupported WKB geometry type: ${baseType}`);
};

const decodeWkbGeometry = (wkb) => {
  if (!wkb) return null;
  const bytes = wkb instanceof Uint8Array ? wkb : new Uint8Array(wkb);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return parseWkbGeometry(view, 0).geometry;
};

const loadGeoParquetRows = async (buffer, file) => {
  debug(`GeoParquet: initializing parser for ${file.name || 'unknown'}`);
  const parquetModule = await ensureParquetModule();
  const Arrow = self.Arrow;
  if (!Arrow) throw new Error('Arrow library failed to load.');

  const parquetFile = await parquetModule.ParquetFile.fromFile(file);
  const metadata = parquetFile.metadata();
  const fileMetadata = metadata.fileMetadata();
  const geoMetadata = parseGeoMetadata(fileMetadata.keyValueMetadata());
  if (!geoMetadata) throw new Error('This parquet file does not include GeoParquet metadata.');
  const geometryColumn = geoMetadata?.primary_column || 'geometry';
  const geometryEncoding = geoMetadata?.columns?.[geometryColumn]?.encoding;
  debug(`GeoParquet metadata: primaryGeometry=${geometryColumn}, encoding=${geometryEncoding || 'unknown'}`);
  if (typeof geometryEncoding === 'string' && geometryEncoding.toUpperCase() !== 'WKB') {
    throw new Error(`GeoParquet geometry encoding "${geometryEncoding}" is not supported.`);
  }

  const wasmTable = parquetModule.readParquet(new Uint8Array(buffer));
  const ipc = wasmTable.intoIPCStream();
  const table = Arrow.tableFromIPC(ipc);
  const geometryVector = table.getChild(geometryColumn);
  if (!geometryVector) throw new Error(`GeoParquet geometry column "${geometryColumn}" was not found.`);

  const fields = table.schema.fields.map((field) => field.name).filter((name) => name !== geometryColumn);
  const fieldVectors = fields.map((name) => table.getChild(name));
  debug(`GeoParquet table ready: rows=${table.numRows}, nonGeometryFields=${fields.length}`);
  const records = [];
  const geometryTypes = new Set();

  for (let i = 0; i < table.numRows; i += 1) {
    const geometry = decodeWkbGeometry(geometryVector.get(i));
    if (geometry?.type) geometryTypes.add(geometry.type);
    const row = { __row: i, __geometry: geometry || null };
    fields.forEach((name, idx) => {
      const vector = fieldVectors[idx];
      row[name] = vector ? vector.get(i) : null;
    });
    records.push(row);
  }
  debug(`GeoParquet row extraction complete: rows=${records.length}, geometryTypes=${Array.from(geometryTypes).join(', ') || 'none'}`);

  return {
    label: 'GeoParquet (.parquet/.geoparquet)',
    hasGeometry: records.some((r) => Boolean(r.__geometry)),
    rowCount: records.length,
    fields,
    records,
    geometryTypes: Array.from(geometryTypes),
    columnProfiles: buildColumnProfilesSafe(records, fields, 'geoparquet')
  };
};

const enforceSideGeometryRules = (side, info) => {
  if (side !== 'left') return;
  if (!info.hasGeometry) throw new Error('LEFT side must contain valid geometry.');
  const invalid = (info.geometryTypes || []).filter((type) => !['Polygon', 'MultiPolygon'].includes(type));
  if (invalid.length) throw new Error(`LEFT side geometry must be Polygon or MultiPolygon. Found: ${invalid.join(', ')}.`);
};

const inferScalarType = (value) => {
  if (value === null || value === undefined || value === '') return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float';
  const s = String(value).trim();
  if (/^[+-]?\d+$/.test(s)) return 'integer';
  if (/^[+-]?(\d+\.\d+|\d+\.\d*|\d*\.\d+)$/.test(s)) return 'float';
  if (/^(true|false|t|f|y|n|1|0)$/i.test(s)) return 'boolean';
  if (!Number.isNaN(Date.parse(s))) return s.includes(':') ? 'datetime' : 'date';
  return 'string';
};

const buildColumnProfiles = (rows, fields) => fields.map((name) => {
  const vals = rows.map((r)=>r[name]).filter((v)=>v!==null && v!==undefined && v!=='');
  const types = new Set(vals.map(inferScalarType).filter((t)=>t!=='null'));
  const nonNullCount = vals.length;
  const totalCount = rows.length;
  const mixed = types.size > 1;
  const inferredType = types.size === 0 ? 'string' : (types.has('string') ? 'string' : (types.has('datetime') ? 'datetime' : (types.has('date') ? 'date' : (types.has('float') ? 'float' : (types.has('integer') ? 'integer' : 'boolean')))));
  let min = null; let max = null;
  if (['integer','float','date','datetime'].includes(inferredType) && vals.length) {
    let foundFinite = false;
    for (let i = 0; i < vals.length; i += 1) {
      const mapped = inferredType === 'integer' || inferredType === 'float' ? Number(vals[i]) : Date.parse(vals[i]);
      if (!Number.isFinite(mapped)) continue;
      if (!foundFinite) {
        min = mapped;
        max = mapped;
        foundFinite = true;
      } else {
        if (mapped < min) min = mapped;
        if (mapped > max) max = mapped;
      }
    }
  }
  const uniqueCount = new Set(vals.map((v)=>String(v))).size;
  return { name, inferredType, mixed, nonNullCount, totalCount, uniqueCount, min, max, sampleValues: vals.slice(0,5) };
});

const buildColumnProfilesSafe = (rows, fields, label) => {
  const startedAt = Date.now();
  debug(`Building column profiles for ${label}: rows=${rows.length}, fields=${fields.length}`);
  try {
    const profiles = buildColumnProfiles(rows, fields);
    debug(`Finished column profiles for ${label} in ${Date.now() - startedAt}ms`);
    return profiles;
  } catch (err) {
    debug(`Column profile failure for ${label}: ${err?.message || String(err)}`);
    throw err;
  }
};

const loadAsFeatures = async (file, side, csvOptions = {}) => {
  const name = file.name?.toLowerCase() || '';
  debug(`loadAsFeatures(side=${side}) file=${file.name || 'unknown'} sizeBytes=${file.size || 0}`);
  if (name.endsWith('.csv')) {
    const csv = parseCsvContent(await file.text(), csvOptions);
    const records = csv.rows;
    const fields = csv.header;
    debug(`CSV parsed for ${side}: rows=${records.length}, fields=${fields.length}, delimiter=${csv.delimiter}`);
    return { label:'CSV (.csv)', hasGeometry:false, rowCount:records.length, fields, records, csv, columnProfiles: buildColumnProfilesSafe(records, fields, `${side}/csv`) };
  }
  const buffer = await file.arrayBuffer();
  debug(`Loaded ArrayBuffer for ${side}: bytes=${buffer.byteLength}`);
  const isZip = name.endsWith('.zip'); const isGeoJson = name.endsWith('.geojson') || name.endsWith('.json') || name.endsWith('.geo.json'); const isGpkg = name.endsWith('.gpkg'); const isParquet = name.endsWith('.parquet') || name.endsWith('.geoparquet');
  if (isParquet) {
    debug(`Detected GeoParquet extension for ${side}.`);
    const info = await loadGeoParquetRows(buffer, file);
    debug(`GeoParquet load summary for ${side}: rows=${info.rowCount}, fields=${info.fields.length}, geomTypes=${(info.geometryTypes || []).join(', ') || 'none'}`);
    enforceSideGeometryRules(side, info);
    return info;
  }
  let geojson;
  if (isGeoJson) geojson = JSON.parse(textDecoder.decode(new Uint8Array(buffer))); else {
    const gdal = await gdalPromise; let input = file;
    if (isZip) { const entries = readZipEntries(buffer); if (!entries) throw new Error('Not a supported format. This zip archive could not be read as a shapefile bundle.'); ensureShapefileParts(entries); input = toFilesFromZipEntries(entries); }
    const { datasets, errors } = await gdal.open(input); if (!datasets?.length) throw new Error(errors?.[0] || 'Unable to open dataset'); const out = await gdal.ogr2ogr(datasets[0], ['-f','GeoJSON']); geojson = JSON.parse(textDecoder.decode(await gdal.getFileBytes(out)));
  }
  const features = geojson.features || [];
  const records = features.map((f,i)=>({ ...f.properties, __row:i, __geometry:f.geometry || null }));
  const fields = Array.from(new Set(records.flatMap((r)=>Object.keys(r).filter((k)=>!k.startsWith('__')))));
  debug(`Vector load summary for ${side}: features=${features.length}, records=${records.length}, fields=${fields.length}`);
  const info = { label:isZip?'ESRI Shapefile (.shp.zip)':isGeoJson?'GeoJSON (.geojson)':isGpkg?'GeoPackage (.gpkg)':'Dataset', hasGeometry:features.some((f)=>Boolean(f.geometry)), rowCount:records.length, fields, records, geometryTypes:Array.from(new Set(features.map((f)=>f.geometry?.type).filter(Boolean))), columnProfiles: buildColumnProfilesSafe(records, fields, `${side}/${isGpkg ? 'gpkg' : isZip ? 'shpzip' : isGeoJson ? 'geojson' : 'dataset'}`) };
  enforceSideGeometryRules(side, info);
  return info;
};

const parseBoolean = (v) => {
  if (v === null || v === undefined || v === '') return { ok:true, value:null };
  if (typeof v === 'boolean') return { ok:true, value:v };
  const s = String(v).trim();
  if (/^(true|t|y|1)$/i.test(s)) return { ok:true, value:true };
  if (/^(false|f|n|0)$/i.test(s)) return { ok:true, value:false };
  if (/^(yes|no)$/i.test(s)) return { ok:false, reason:'yes/no values are not recognized for boolean to avoid ambiguity.' };
  return { ok:false, reason:'invalid boolean token' };
};

const parseByType = (value, type, format) => {
  if (value === null || value === undefined || value === '') return { ok:true, value:null };
  if (type === 'string' || type === 'source') return { ok:true, value:String(value) };
  if (type === 'integer') { const n = Number(value); return Number.isInteger(n) ? { ok:true, value:n } : { ok:false, reason:'not an integer' }; }
  if (type === 'float') { const n = Number(value); return Number.isFinite(n) ? { ok:true, value:n } : { ok:false, reason:'not a number' }; }
  if (type === 'boolean') return parseBoolean(value);
  if (type === 'date' || type === 'datetime') {
    const s = String(value).trim();
    if (!format || format === 'auto') { const t = Date.parse(s); return Number.isFinite(t) ? { ok:true, value:new Date(t).toISOString() } : { ok:false, reason:'unparseable date/datetime' }; }
    // very simple token support fallback to Date.parse after token transform not implemented fully
    const t = Date.parse(s);
    return Number.isFinite(t) ? { ok:true, value:new Date(t).toISOString() } : { ok:false, reason:`failed format ${format}` };
  }
  return { ok:true, value };
};

const parseFallback = (fallbackRaw) => {
  const v = fallbackRaw;
  if (v === null || v === undefined || String(v).trim().toLowerCase() === 'null') return null;
  return v;
};

const applyReview = (rows, reviewSide) => {
  const cfg = (reviewSide || []).filter((c)=>c.selected);
  const byName = new Map(cfg.map((c)=>[c.sourceName, c]));
  const errors = [];
  const transformed = rows.map((row, idx) => {
    const next = { __geometry: row.__geometry, __row: row.__row };
    cfg.forEach((c) => {
      const raw = row[c.sourceName];
      const res = parseByType(raw, c.targetType, c.format);
      if (res.ok) { next[c.outputName] = res.value; return; }
      if (c.targetType === 'source' || c.targetType === 'string') { next[c.outputName] = raw == null ? null : String(raw); return; }
      const fb = parseFallback(c.fallback);
      next[c.outputName] = fb;
      errors.push({ column:c.sourceName, outputName:c.outputName, row: idx, reason: res.reason, raw });
    });
    return next;
  });
  const fields = cfg.map((c)=>c.outputName);
  return { rows: transformed, fields, errors, byName };
};

const normalizeKey = (value, n) => {
  if (value == null) return ''; let v = String(value); if (n.trim) v = v.trim(); if (n.caseInsensitive) v = v.toLowerCase(); if (n.slugify) v = slugify(v); if (n.stripLeadingZeroes) v = v.replace(/^0+/, ''); if (n.stripTrailingZeroes) v = v.replace(/0+$/, ''); if (n.removeChars) v = v.split('').filter((c)=>!n.removeChars.includes(c)).join(''); if (n.replaceFrom) v = v.split(n.replaceFrom).join(n.replaceTo || ''); return v;
};

const dedup = (rows, keyField, sortField, dir) => { const sorted = [...rows].sort((a,b)=>{ const av=a[sortField]??''; const bv=b[sortField]??''; if (av===bv) return 0; const cmp = String(av).localeCompare(String(bv), undefined, {numeric:true}); return dir==='desc' ? -cmp : cmp; }); const seen=new Set(); const kept=[]; let dropped=0; sorted.forEach((row)=>{ const key=String(row[keyField]??''); if(!key || seen.has(key)){ dropped+=1; return; } seen.add(key); kept.push(row); }); return { kept, dropped }; };

const joinRows = (leftRows, rightRows, options) => {
  const leftMap = new Map(); const rightMap = new Map(); let emptyLeft=0, emptyRight=0;
  leftRows.forEach((r)=>{ const nk = normalizeKey(r[options.leftKey], options.normalize); if (!nk) { emptyLeft += 1; return; } leftMap.set(nk,r); });
  rightRows.forEach((r)=>{ const nk = normalizeKey(r[options.rightKey], options.normalize); if (!nk) { emptyRight += 1; return; } rightMap.set(nk,r); });
  const keys = new Set(); if (options.joinType === 'left') leftMap.forEach((_,k)=>keys.add(k)); else if (options.joinType === 'right') rightMap.forEach((_,k)=>keys.add(k)); else leftMap.forEach((_,k)=>{ if (rightMap.has(k)) keys.add(k); });
  const rows = []; let matched=0, unmatchedLeft=0, unmatchedRight=0;
  const diagnostics = { joinedKeys: 0, leftGeomRows: 0, rightGeomRows: 0, outGeomRows: 0, missingGeomRows: 0, likelyGeomOverwriteRows: 0, sampleOutGeomTypes: [] };
  const sampleTypes = new Set();
  keys.forEach((k)=>{
    const l=leftMap.get(k); const r=rightMap.get(k);
    if(l&&r) matched += 1; else if(l&&!r) unmatchedLeft += 1; else if(!l&&r) unmatchedRight += 1;
    const lGeom = l?.__geometry || null;
    const rGeom = r?.__geometry || null;
    if (lGeom) diagnostics.leftGeomRows += 1;
    if (rGeom) diagnostics.rightGeomRows += 1;
    const out={ ...(l||{}), ...(r||{}) };
    // RIGHT-side geometry is ignored for construct output; retain LEFT geometry when available.
    out.__geometry = lGeom || null;
    if (options.outputKeys==='normalized' || options.outputKeys==='all') out.__normalized_key = k;
    if (options.outputKeys==='all') { out.__left_key=l?.[options.leftKey]??null; out.__right_key=r?.[options.rightKey]??null; }
    const outGeom = out.__geometry || null;
    if (outGeom) {
      diagnostics.outGeomRows += 1;
      if (sampleTypes.size < 6 && outGeom.type) sampleTypes.add(outGeom.type);
    } else {
      diagnostics.missingGeomRows += 1;
      if (lGeom && !rGeom) diagnostics.likelyGeomOverwriteRows += 1;
    }
    diagnostics.joinedKeys += 1;
    rows.push(out);
  });
  diagnostics.sampleOutGeomTypes = Array.from(sampleTypes);
  return { rows, matched, unmatchedLeft, unmatchedRight, emptyLeft, emptyRight, diagnostics };
};

const buildFeatureCollection = (rows) => ({ type:'FeatureCollection', features: rows.filter((r)=>r.__geometry && ['Polygon','MultiPolygon'].includes(r.__geometry.type)).map((r)=>({ type:'Feature', geometry:r.__geometry, properties:Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('__'))) })) });

const buildConstructPreview = (rows) => {
  const featureRows = rows.filter((r) => r.__geometry && ['Polygon', 'MultiPolygon'].includes(r.__geometry.type));
  const allPropertyRows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('__'))));
  const exportPropertyRows = featureRows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('__'))));
  const allFields = Array.from(new Set(allPropertyRows.flatMap((r) => Object.keys(r))));
  const exportFields = Array.from(new Set(exportPropertyRows.flatMap((r) => Object.keys(r))));
  const columns = buildColumnProfiles(exportPropertyRows, exportFields);
  const joinedColumns = buildColumnProfiles(allPropertyRows, allFields);
  return {
    joinedRows: rows.length,
    featureRows: featureRows.length,
    droppedGeometryRows: rows.length - featureRows.length,
    columns,
    joinedColumns
  };
};

const exportGeoPackage = async (geojson) => { const gdal = await gdalPromise; const file = new File([JSON.stringify(geojson)], 'source.geojson', { type:'application/geo+json' }); const { datasets } = await gdal.open(file); const out = await gdal.ogr2ogr(datasets[0], ['-f','GPKG']); return new Uint8Array(await gdal.getFileBytes(out)); };
const exportShpZip = async (geojson) => { const gdal = await gdalPromise; const file = new File([JSON.stringify(geojson)], 'source.geojson', { type:'application/geo+json' }); const { datasets } = await gdal.open(file); const out = await gdal.ogr2ogr(datasets[0], ['-f','ESRI Shapefile']); return new Uint8Array(await gdal.getFileBytes(out)); };
const exportGeoParquet = async (geojson) => new Promise((resolve, reject) => { const worker = new Worker(new URL('./converterExportWorker.js', self.location.href)); worker.onmessage = (e) => { const { type, payload } = e.data || {}; if (type === 'error') { worker.terminate(); reject(new Error(payload.message)); } if (type === 'success') { worker.terminate(); if (payload?.blob instanceof Blob) { payload.blob.arrayBuffer().then((buf)=>resolve(new Uint8Array(buf))).catch((err)=>reject(new Error(err?.message || 'Unable to read GeoParquet output blob.'))); return; } if (payload?.bytes) { resolve(new Uint8Array(payload.bytes)); return; } reject(new Error('GeoParquet export returned no output bytes.')); } }; worker.postMessage({ file: new File([JSON.stringify(geojson)], 'joined.geojson', { type:'application/geo+json' }), outputFormat:'geoparquet' }); });

self.onmessage = async (event) => {
  try {
    const { mode, file, side, leftFile, rightFile, options, csvOptions } = event.data || {};
    if (mode === 'inspect') { const info = await loadAsFeatures(file, side, csvOptions || {}); send('success', info); return; }
    const left = await loadAsFeatures(leftFile, 'left', csvOptions?.left || {}); const right = await loadAsFeatures(rightFile, 'right', csvOptions?.right || {});
    if (!left.hasGeometry) throw new Error('LEFT side must contain valid geometry.');

    const leftReview = applyReview(left.records, options.review?.left);
    const rightReview = applyReview(right.records, options.review?.right);

    if (leftReview.errors.length || rightReview.errors.length) send('log', { message: `Type coercion issues: left=${leftReview.errors.length}, right=${rightReview.errors.length}` });

    const leftDedup = dedup(leftReview.rows, options.leftDedup || options.leftKey, options.leftSort || options.leftKey, options.leftSortDir || 'asc');
    const rightDedup = dedup(rightReview.rows, options.rightDedup || options.rightKey, options.rightSort || options.rightKey, options.rightSortDir || 'asc');
    const joined = joinRows(leftDedup.kept, rightDedup.kept, options);

    send('log', { message: `[Construct debug] rows: leftRaw=${left.records.length}, rightRaw=${right.records.length}, leftAfterType=${leftReview.rows.length}, rightAfterType=${rightReview.rows.length}, leftAfterDedup=${leftDedup.kept.length}, rightAfterDedup=${rightDedup.kept.length}, joined=${joined.rows.length}` });
    send('log', { message: `[Construct debug] geometry: leftGeomRows=${joined.diagnostics.leftGeomRows}, rightGeomRows=${joined.diagnostics.rightGeomRows}, outGeomRows=${joined.diagnostics.outGeomRows}, missingGeomRows=${joined.diagnostics.missingGeomRows}, likelyGeomOverwriteRows=${joined.diagnostics.likelyGeomOverwriteRows}, outGeomTypes=${joined.diagnostics.sampleOutGeomTypes.join(', ') || 'none'}` });
    send('log', { message: `[Construct debug] selected columns: left=${leftReview.fields.length} (${leftReview.fields.slice(0,8).join(', ') || 'none'}${leftReview.fields.length > 8 ? ', …' : ''}), right=${rightReview.fields.length} (${rightReview.fields.slice(0,8).join(', ') || 'none'}${rightReview.fields.length > 8 ? ', …' : ''})` });

    if (mode === 'preview') {
      send('success', { matched:joined.matched, unmatchedLeft:joined.unmatchedLeft, unmatchedRight:joined.unmatchedRight, emptyLeft:joined.emptyLeft, emptyRight:joined.emptyRight, leftDropped:leftDedup.dropped, rightDropped:rightDedup.dropped, sampleColumns:Object.keys(joined.rows[0] || {}).filter((k)=>!k.startsWith('__')).slice(0,20), leftTypeErrors:leftReview.errors.length, rightTypeErrors:rightReview.errors.length });
      return;
    }

    if (mode === 'build') {
      const build = buildConstructPreview(joined.rows);
      send('log', { message: `Constructed ${build.featureRows} features.` });
      if (build.featureRows === 0) {
        send('log', { message: `[Construct debug] zero-feature build: joinedColumns=${build.joinedColumns.length}, exportColumns=${build.columns.length}, likelyGeomOverwriteRows=${joined.diagnostics.likelyGeomOverwriteRows}` });
      }
      send('success', build);
      return;
    }

    if (mode === 'construct') {
      const geojson = buildFeatureCollection(joined.rows);
      send('log', { message: `Constructed ${geojson.features.length} features.` });
      const format = event.data.outputFormat || 'geoparquet';
      if (format === 'geopackage') { const bytes = await exportGeoPackage(geojson); send('success', { bytes, extension:'gpkg', mimeType:'application/geopackage+sqlite3' }); return; }
      if (format === 'shpzip') { const bytes = await exportShpZip(geojson); send('success', { bytes, extension:'shp.zip', mimeType:'application/zip' }); return; }
      const bytes = await exportGeoParquet(geojson); send('success', { bytes, extension:'geoparquet', mimeType:'application/octet-stream' });
    }
  } catch (err) { send('error', { message: err?.message || String(err) }); }
};
