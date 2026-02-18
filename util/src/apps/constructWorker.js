/* global importScripts */
importScripts('../../vendor/gdal/gdal3.js','../../vendor/wkx/dist/wkx.js','../../vendor/apache-arrow.js','../../vendor/fflate/index.min.js');

const GDAL_BASE = new URL('../../vendor/gdal/', self.location).toString();
const gdalPromise = self.initGdalJs({ path: GDAL_BASE, useWorker: false });
const textDecoder = new TextDecoder('utf-8');

const send = (type, payload) => self.postMessage({ type, payload });
const slugify = (value) => String(value).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

const readZipEntries = (buffer) => {
  const sig = new Uint8Array(buffer.slice(0, 4));
  const isZip = sig[0] === 0x50 && sig[1] === 0x4b;
  if (!isZip || !self.fflate?.unzipSync) return null;
  try { return self.fflate.unzipSync(new Uint8Array(buffer)); } catch (_) { return null; }
};

const parseCsvPreview = (text, csv = {}) => {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  const cands = [',',';','\t','|'];
  const delimiter = csv.delimiter || cands.map((d) => ({ d, s: (lines[0] || '').split(d).length })).sort((a,b)=>b.s-a.s)[0]?.d || ',';
  const hasHeader = csv.hasHeader !== false;
  const rawRows = lines.slice(0, 300).map((line) => line.split(delimiter));
  const header = hasHeader ? (rawRows[0] || []).map((v, i) => v?.trim() || `field_${i + 1}`) : (rawRows[0] || []).map((_, i) => `field_${i + 1}`);
  const rows = (hasHeader ? rawRows.slice(1) : rawRows).map((arr) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = arr[i] ?? ''; });
    return obj;
  });
  return { delimiter, hasHeader, header, rows };
};

const loadAsFeatures = async (file, side, csvOptions = {}) => {
  const name = file.name?.toLowerCase() || '';
  if (name.endsWith('.csv')) {
    const text = await file.text();
    const csv = parseCsvPreview(text, csvOptions);
    return { label: 'CSV (.csv)', hasGeometry: false, rowCount: csv.rows.length, fields: csv.header, records: csv.rows, csv };
  }

  const buffer = await file.arrayBuffer();
  const isZip = name.endsWith('.zip');
  const isGeoJson = name.endsWith('.geojson') || name.endsWith('.json') || name.endsWith('.geo.json');
  const isGpkg = name.endsWith('.gpkg');
  const isParquet = name.endsWith('.parquet') || name.endsWith('.geoparquet');

  let geojson;
  if (isParquet) {
    throw new Error('GeoParquet input for Construct is not yet available in this build.');
  }

  if (isGeoJson) {
    geojson = JSON.parse(textDecoder.decode(new Uint8Array(buffer)));
  } else {
    const gdal = await gdalPromise;
    const input = isZip ? Object.entries(readZipEntries(buffer) || {}).map(([path, bytes]) => ({ path, bytes })) : file;
    const { datasets, errors } = await gdal.open(input);
    if (!datasets?.length) throw new Error(errors?.[0] || 'Unable to open dataset');
    const out = await gdal.ogr2ogr(datasets[0], ['-f', 'GeoJSON']);
    const bytes = await gdal.getFileBytes(out);
    geojson = JSON.parse(textDecoder.decode(bytes));
  }

  const features = geojson.features || [];
  const records = features.map((f, i) => ({ ...f.properties, __row: i, __geometry: f.geometry || null }));
  const fields = Array.from(new Set(records.flatMap((r) => Object.keys(r).filter((k) => !k.startsWith('__')))));
  const hasGeometry = features.some((f) => Boolean(f.geometry));
  const geometryTypes = new Set(features.map((f) => f.geometry?.type).filter(Boolean));
  return {
    label: isZip ? 'ESRI Shapefile (.shp.zip)' : isGeoJson ? 'GeoJSON (.geojson)' : isGpkg ? 'GeoPackage (.gpkg)' : 'Dataset',
    hasGeometry,
    rowCount: records.length,
    fields,
    records,
    geometryTypes: Array.from(geometryTypes)
  };
};

const normalizeKey = (value, n) => {
  if (value == null) return '';
  let v = String(value);
  if (n.trim) v = v.trim();
  if (n.caseInsensitive) v = v.toLowerCase();
  if (n.slugify) v = slugify(v);
  if (n.stripLeadingZeroes) v = v.replace(/^0+/, '');
  if (n.stripTrailingZeroes) v = v.replace(/0+$/, '');
  if (n.removeChars) v = v.split('').filter((c) => !n.removeChars.includes(c)).join('');
  if (n.replaceFrom) v = v.split(n.replaceFrom).join(n.replaceTo || '');
  return v;
};

const dedup = (rows, keyField, sortField, dir) => {
  const sorted = [...rows].sort((a, b) => {
    const av = a[sortField] ?? ''; const bv = b[sortField] ?? '';
    if (av === bv) return 0;
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return dir === 'desc' ? -cmp : cmp;
  });
  const seen = new Set();
  const kept = [];
  let dropped = 0;
  sorted.forEach((row) => {
    const key = String(row[keyField] ?? '');
    if (!key || seen.has(key)) { dropped += 1; return; }
    seen.add(key); kept.push(row);
  });
  return { kept, dropped };
};

const joinRows = (leftRows, rightRows, options) => {
  const leftMap = new Map();
  const rightMap = new Map();
  let emptyLeft = 0; let emptyRight = 0;
  leftRows.forEach((r) => {
    const nk = normalizeKey(r[options.leftKey], options.normalize);
    if (!nk) { emptyLeft += 1; return; }
    leftMap.set(nk, r);
  });
  rightRows.forEach((r) => {
    const nk = normalizeKey(r[options.rightKey], options.normalize);
    if (!nk) { emptyRight += 1; return; }
    rightMap.set(nk, r);
  });

  const keys = new Set();
  if (options.joinType === 'left') leftMap.forEach((_, k) => keys.add(k));
  else if (options.joinType === 'right') rightMap.forEach((_, k) => keys.add(k));
  else {
    leftMap.forEach((_, k) => { if (rightMap.has(k)) keys.add(k); });
  }

  const rows = [];
  let matched = 0; let unmatchedLeft = 0; let unmatchedRight = 0;
  keys.forEach((k) => {
    const l = leftMap.get(k);
    const r = rightMap.get(k);
    if (l && r) matched += 1;
    else if (l && !r) unmatchedLeft += 1;
    else if (!l && r) unmatchedRight += 1;
    const out = { ...(l || {}), ...(r || {}) };
    if (options.outputKeys === 'normalized' || options.outputKeys === 'all') out.__normalized_key = k;
    if (options.outputKeys === 'all') {
      out.__left_key = l?.[options.leftKey] ?? null;
      out.__right_key = r?.[options.rightKey] ?? null;
    }
    rows.push(out);
  });
  return { rows, matched, unmatchedLeft, unmatchedRight, emptyLeft, emptyRight };
};

const buildFeatureCollection = (rows) => ({
  type: 'FeatureCollection',
  features: rows.filter((r) => r.__geometry && ['Polygon', 'MultiPolygon'].includes(r.__geometry.type)).map((r) => ({
    type: 'Feature',
    geometry: r.__geometry,
    properties: Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('__')))
  }))
});

const exportGeoPackage = async (geojson) => {
  const gdal = await gdalPromise;
  const file = new File([JSON.stringify(geojson)], 'source.geojson', { type: 'application/geo+json' });
  const { datasets } = await gdal.open(file);
  const out = await gdal.ogr2ogr(datasets[0], ['-f', 'GPKG']);
  return new Uint8Array(await gdal.getFileBytes(out));
};

const exportShpZip = async (geojson) => {
  const gdal = await gdalPromise;
  const file = new File([JSON.stringify(geojson)], 'source.geojson', { type: 'application/geo+json' });
  const { datasets } = await gdal.open(file);
  const out = await gdal.ogr2ogr(datasets[0], ['-f', 'ESRI Shapefile']);
  return new Uint8Array(await gdal.getFileBytes(out));
};

const exportGeoParquet = async (geojson) => {
  const worker = new Worker(new URL('./converterExportWorker.js', self.location.href), { type: 'module' });
  return await new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const { type, payload } = e.data || {};
      if (type === 'error') { worker.terminate(); reject(new Error(payload.message)); }
      if (type === 'success') { worker.terminate(); resolve(new Uint8Array(payload.bytes)); }
    };
    const file = new File([JSON.stringify(geojson)], 'joined.geojson', { type: 'application/geo+json' });
    worker.postMessage({ file, outputFormat: 'geoparquet' });
  });
};

self.onmessage = async (event) => {
  try {
    const { mode, file, side, leftFile, rightFile, options } = event.data || {};
    if (mode === 'inspect') {
      const info = await loadAsFeatures(file, side);
      send('success', info);
      return;
    }

    const left = await loadAsFeatures(leftFile, 'left');
    const right = await loadAsFeatures(rightFile, 'right');
    if (!left.hasGeometry) throw new Error('LEFT side must contain valid geometry.');

    const leftDedup = dedup(left.records, options.leftDedup || options.leftKey, options.leftSort || options.leftKey, options.leftSortDir || 'asc');
    const rightDedup = dedup(right.records, options.rightDedup || options.rightKey, options.rightSort || options.rightKey, options.rightSortDir || 'asc');
    const joined = joinRows(leftDedup.kept, rightDedup.kept, options);

    if (mode === 'preview') {
      send('success', {
        matched: joined.matched,
        unmatchedLeft: joined.unmatchedLeft,
        unmatchedRight: joined.unmatchedRight,
        emptyLeft: joined.emptyLeft,
        emptyRight: joined.emptyRight,
        leftDropped: leftDedup.dropped,
        rightDropped: rightDedup.dropped,
        sampleColumns: Object.keys(joined.rows[0] || {}).filter((k) => !k.startsWith('__')).slice(0, 20)
      });
      return;
    }

    if (mode === 'construct') {
      const geojson = buildFeatureCollection(joined.rows);
      send('log', { message: `Constructed ${geojson.features.length} features.` });
      const format = event.data.outputFormat || 'geoparquet';
      if (format === 'geopackage') {
        const bytes = await exportGeoPackage(geojson);
        send('success', { bytes, extension: 'gpkg', mimeType: 'application/geopackage+sqlite3' });
        return;
      }
      if (format === 'shpzip') {
        const bytes = await exportShpZip(geojson);
        send('success', { bytes, extension: 'shp.zip', mimeType: 'application/zip' });
        return;
      }
      const bytes = await exportGeoParquet(geojson);
      send('success', { bytes, extension: 'geoparquet', mimeType: 'application/octet-stream' });
    }
  } catch (err) {
    send('error', { message: err?.message || String(err) });
  }
};
