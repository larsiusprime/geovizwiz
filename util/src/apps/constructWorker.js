/* global importScripts */
importScripts('../../vendor/gdal/gdal3.js','../../vendor/wkx/dist/wkx.js','../../vendor/apache-arrow.js','../../vendor/fflate/index.min.js');

const GDAL_BASE = new URL('../../vendor/gdal/', self.location).toString();
const gdalPromise = self.initGdalJs({ path: GDAL_BASE, useWorker: false });
const textDecoder = new TextDecoder('utf-8');
const send = (type, payload) => self.postMessage({ type, payload });
const slugify = (value) => String(value).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

const readZipEntries = (buffer) => { const sig = new Uint8Array(buffer.slice(0,4)); const isZip = sig[0]===0x50 && sig[1]===0x4b; if (!isZip || !self.fflate?.unzipSync) return null; try { return self.fflate.unzipSync(new Uint8Array(buffer)); } catch (_) { return null; } };
const toFilesFromZipEntries = (entries) => Object.entries(entries || {}).map(([name, bytes]) => new File([bytes], name));
const ensureShapefileParts = (entries) => { const names = Object.keys(entries||{}).map((name)=>name.toLowerCase()); if (!names.some((n)=>n.endsWith('.shp')) || !names.some((n)=>n.endsWith('.dbf'))) throw new Error('Not a supported format. This zip archive does not contain the required .shp and .dbf files for a valid ESRI Shapefile.'); if (!names.some((n)=>n.endsWith('.shx'))) throw new Error('Not a supported format. The zip archive is missing the .shx index file required for a complete ESRI Shapefile.'); };

const parseCsvContent = (text, csv = {}) => {
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(Boolean);
  const cands = [',',';','\t','|'];
  const delimiter = csv.delimiter || cands.map((d)=>({d,s:(lines[0]||'').split(d).length})).sort((a,b)=>b.s-a.s)[0]?.d || ',';
  const hasHeader = csv.hasHeader !== false;
  const rawRows = lines.map((line)=>line.split(delimiter));
  const header = hasHeader ? (rawRows[0] || []).map((v,i)=>v?.trim() || `field_${i+1}`) : (rawRows[0] || []).map((_,i)=>`field_${i+1}`);
  const rows = (hasHeader ? rawRows.slice(1) : rawRows).map((arr) => Object.fromEntries(header.map((h,i)=>[h, arr[i] ?? ''])));
  return { delimiter, hasHeader, header, rows, previewRows: rows.slice(0,8) };
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
    const mapped = vals.map((v)=> inferredType === 'integer' || inferredType === 'float' ? Number(v) : Date.parse(v)).filter((v)=>Number.isFinite(v));
    if (mapped.length) { min = Math.min(...mapped); max = Math.max(...mapped); }
  }
  const uniqueCount = new Set(vals.map((v)=>String(v))).size;
  return { name, inferredType, mixed, nonNullCount, totalCount, uniqueCount, min, max, sampleValues: vals.slice(0,5) };
});

const loadAsFeatures = async (file, side, csvOptions = {}) => {
  const name = file.name?.toLowerCase() || '';
  if (name.endsWith('.csv')) {
    const csv = parseCsvContent(await file.text(), csvOptions);
    const records = csv.rows;
    const fields = csv.header;
    return { label:'CSV (.csv)', hasGeometry:false, rowCount:records.length, fields, records, csv, columnProfiles: buildColumnProfiles(records, fields) };
  }
  const buffer = await file.arrayBuffer();
  const isZip = name.endsWith('.zip'); const isGeoJson = name.endsWith('.geojson') || name.endsWith('.json') || name.endsWith('.geo.json'); const isGpkg = name.endsWith('.gpkg'); const isParquet = name.endsWith('.parquet') || name.endsWith('.geoparquet');
  if (isParquet) throw new Error('GeoParquet input for Construct is not yet available in this build.');
  let geojson;
  if (isGeoJson) geojson = JSON.parse(textDecoder.decode(new Uint8Array(buffer))); else {
    const gdal = await gdalPromise; let input = file;
    if (isZip) { const entries = readZipEntries(buffer); if (!entries) throw new Error('Not a supported format. This zip archive could not be read as a shapefile bundle.'); ensureShapefileParts(entries); input = toFilesFromZipEntries(entries); }
    const { datasets, errors } = await gdal.open(input); if (!datasets?.length) throw new Error(errors?.[0] || 'Unable to open dataset'); const out = await gdal.ogr2ogr(datasets[0], ['-f','GeoJSON']); geojson = JSON.parse(textDecoder.decode(await gdal.getFileBytes(out)));
  }
  const features = geojson.features || [];
  const records = features.map((f,i)=>({ ...f.properties, __row:i, __geometry:f.geometry || null }));
  const fields = Array.from(new Set(records.flatMap((r)=>Object.keys(r).filter((k)=>!k.startsWith('__')))));
  return { label:isZip?'ESRI Shapefile (.shp.zip)':isGeoJson?'GeoJSON (.geojson)':isGpkg?'GeoPackage (.gpkg)':'Dataset', hasGeometry:features.some((f)=>Boolean(f.geometry)), rowCount:records.length, fields, records, geometryTypes:Array.from(new Set(features.map((f)=>f.geometry?.type).filter(Boolean))), columnProfiles: buildColumnProfiles(records, fields) };
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

const parseFallback = (fallbackRaw, globalRaw) => {
  const v = (fallbackRaw ?? '') === '' ? globalRaw : fallbackRaw;
  if (v === null || v === undefined || String(v).trim().toLowerCase() === 'null') return null;
  return v;
};

const applyReview = (rows, reviewSide, globalFallback) => {
  const cfg = (reviewSide || []).filter((c)=>c.selected);
  const byName = new Map(cfg.map((c)=>[c.sourceName, c]));
  const errors = [];
  const transformed = rows.map((row, idx) => {
    const next = { __geometry: row.__geometry, __row: row.__row };
    cfg.forEach((c) => {
      const raw = row[c.sourceName];
      const res = parseByType(raw, c.targetType, c.format);
      if (res.ok) { next[c.outputName] = res.value; return; }
      if (c.policy === 'string') { next[c.outputName] = raw == null ? null : String(raw); return; }
      const fb = parseFallback(c.fallback, globalFallback);
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
  keys.forEach((k)=>{ const l=leftMap.get(k); const r=rightMap.get(k); if(l&&r) matched += 1; else if(l&&!r) unmatchedLeft += 1; else if(!l&&r) unmatchedRight += 1; const out={ ...(l||{}), ...(r||{}) }; if (options.outputKeys==='normalized' || options.outputKeys==='all') out.__normalized_key = k; if (options.outputKeys==='all') { out.__left_key=l?.[options.leftKey]??null; out.__right_key=r?.[options.rightKey]??null; } rows.push(out); });
  return { rows, matched, unmatchedLeft, unmatchedRight, emptyLeft, emptyRight };
};

const buildFeatureCollection = (rows) => ({ type:'FeatureCollection', features: rows.filter((r)=>r.__geometry && ['Polygon','MultiPolygon'].includes(r.__geometry.type)).map((r)=>({ type:'Feature', geometry:r.__geometry, properties:Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('__'))) })) });

const exportGeoPackage = async (geojson) => { const gdal = await gdalPromise; const file = new File([JSON.stringify(geojson)], 'source.geojson', { type:'application/geo+json' }); const { datasets } = await gdal.open(file); const out = await gdal.ogr2ogr(datasets[0], ['-f','GPKG']); return new Uint8Array(await gdal.getFileBytes(out)); };
const exportShpZip = async (geojson) => { const gdal = await gdalPromise; const file = new File([JSON.stringify(geojson)], 'source.geojson', { type:'application/geo+json' }); const { datasets } = await gdal.open(file); const out = await gdal.ogr2ogr(datasets[0], ['-f','ESRI Shapefile']); return new Uint8Array(await gdal.getFileBytes(out)); };
const exportGeoParquet = async (geojson) => new Promise((resolve, reject) => { const worker = new Worker(new URL('./converterExportWorker.js', self.location.href)); worker.onmessage = (e) => { const { type, payload } = e.data || {}; if (type === 'error') { worker.terminate(); reject(new Error(payload.message)); } if (type === 'success') { worker.terminate(); if (payload?.blob instanceof Blob) { payload.blob.arrayBuffer().then((buf)=>resolve(new Uint8Array(buf))).catch((err)=>reject(new Error(err?.message || 'Unable to read GeoParquet output blob.'))); return; } if (payload?.bytes) { resolve(new Uint8Array(payload.bytes)); return; } reject(new Error('GeoParquet export returned no output bytes.')); } }; worker.postMessage({ file: new File([JSON.stringify(geojson)], 'joined.geojson', { type:'application/geo+json' }), outputFormat:'geoparquet' }); });

self.onmessage = async (event) => {
  try {
    const { mode, file, side, leftFile, rightFile, options, csvOptions } = event.data || {};
    if (mode === 'inspect') { const info = await loadAsFeatures(file, side, csvOptions || {}); send('success', info); return; }
    const left = await loadAsFeatures(leftFile, 'left', csvOptions?.left || {}); const right = await loadAsFeatures(rightFile, 'right', csvOptions?.right || {});
    if (!left.hasGeometry) throw new Error('LEFT side must contain valid geometry.');

    const leftReview = applyReview(left.records, options.review?.left, options.review?.globalFallback ?? 'null');
    const rightReview = applyReview(right.records, options.review?.right, options.review?.globalFallback ?? 'null');

    if (leftReview.errors.length || rightReview.errors.length) send('log', { message: `Type coercion issues: left=${leftReview.errors.length}, right=${rightReview.errors.length}` });

    const leftDedup = dedup(leftReview.rows, options.leftDedup || options.leftKey, options.leftSort || options.leftKey, options.leftSortDir || 'asc');
    const rightDedup = dedup(rightReview.rows, options.rightDedup || options.rightKey, options.rightSort || options.rightKey, options.rightSortDir || 'asc');
    const joined = joinRows(leftDedup.kept, rightDedup.kept, options);

    if (mode === 'preview') {
      send('success', { matched:joined.matched, unmatchedLeft:joined.unmatchedLeft, unmatchedRight:joined.unmatchedRight, emptyLeft:joined.emptyLeft, emptyRight:joined.emptyRight, leftDropped:leftDedup.dropped, rightDropped:rightDedup.dropped, sampleColumns:Object.keys(joined.rows[0] || {}).filter((k)=>!k.startsWith('__')).slice(0,20), leftTypeErrors:leftReview.errors.length, rightTypeErrors:rightReview.errors.length });
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
