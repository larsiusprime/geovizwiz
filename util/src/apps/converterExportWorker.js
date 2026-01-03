importScripts(
  '../../vendor/fflate/index.min.js',
  '../../vendor/gdal/gdal3.js',
  '../../vendor/wkx/dist/wkx.js',
  '../../vendor/apache-arrow.js'
);


const textDecoder = new TextDecoder();
const GDAL_BASE = new URL('../../vendor/gdal/', self.location).toString();

const gdalPromise = self.initGdalJs({
  useWorker: false,
  path: GDAL_BASE
});

const toFilesFromZipEntries = (entries) => Object.entries(entries).map(([name, bytes]) => new File([bytes], name));

const formatGdalErrors = (errors, fallback) => {
  if (!errors?.length) return fallback;
  return errors.map(e => {
    if (typeof e === 'string') return e;
    if (e?.message) return e.message;
    try { return JSON.stringify(e); } catch { return String(e); }
  }).join('\n');
};

const loadShapefileGeoJsonWithEntries = async (zipBuffer) => {
  const entries = readZipEntries(zipBuffer);
  const gdal = await gdalPromise;
  const files = toFilesFromZipEntries(entries);
  
  const { datasets, errors } = await gdal.open(files);
  if (!datasets?.length) {
    throw new Error(formatGdalErrors(errors, 'GDAL could not open this Shapefile.'));
  }

  const dataset = datasets[0];

  // Keep native CRS coordinates: do NOT pass -t_srs / -s_srs.
  const out = await gdal.ogr2ogr(dataset, ['-f', 'GeoJSON']);
  const bytes = await gdal.getFileBytes(out);
  const geojsonText = new TextDecoder().decode(bytes);
  const geojson = JSON.parse(geojsonText);

  try { await gdal.close(dataset); } catch (_) {}

  return { geojson, entries };
};

const loadGpkgGeoJsonWithInfo = async (file) => {
  const gdal = await gdalPromise;
  const { datasets, errors } = await gdal.open(file);
  if (!datasets?.length) {
    throw new Error(formatGdalErrors(errors, 'GDAL could not open this Geopackage.'));
  }

  const dataset = datasets[0];
  const out = await gdal.ogr2ogr(dataset, ['-f', 'GeoJSON']);
  const bytes = await gdal.getFileBytes(out);
  const geojsonText = new TextDecoder().decode(bytes);
  const geojson = JSON.parse(geojsonText);
  const info = dataset.info || null;

  try { await gdal.close(dataset); } catch (_) {}

  return { geojson, info };
};

const loadGeoJsonWithInfo = async (file) => {
  const gdal = await gdalPromise;
  const { datasets, errors } = await gdal.open(file);
  if (!datasets?.length) {
    throw new Error(formatGdalErrors(errors, 'GDAL could not open this GeoJSON.'));
  }

  const dataset = datasets[0];
  const out = await gdal.ogr2ogr(dataset, ['-f', 'GeoJSON']);
  const bytes = await gdal.getFileBytes(out);
  const geojsonText = new TextDecoder().decode(bytes);
  const geojson = JSON.parse(geojsonText);
  const info = dataset.info || null;

  try { await gdal.close(dataset); } catch (_) {}

  return { geojson, info };
};

const convertGeoJsonToGpkg = async (geojson, assignSrsText = null) => {
  const gdal = await gdalPromise;
  const geojsonText = JSON.stringify(geojson);
  const geojsonFile = new File([geojsonText], 'source.geojson', { type: 'application/geo+json' });
  const { datasets, errors } = await gdal.open(geojsonFile);
  if (!datasets?.length) {
    const err = errors?.[0] || 'GDAL could not open this GeoJSON for GeoPackage export.';
    throw new Error(Array.isArray(err) ? err.join('\n') : String(err));
  }

  const dataset = datasets[0];
  const args = ['-f', 'GPKG'];
  if (assignSrsText) {
    args.push('-a_srs', assignSrsText);
  }
  const out = await gdal.ogr2ogr(dataset, args);
  const bytes = await gdal.getFileBytes(out);

  try { await gdal.close(dataset); } catch (_) {}

  return bytes;
};

let parquetModulePromise = null;
let arrowHelpersPromise = null;
let parquetInitialized = false;

const sendProgress = (percent, detail) => {
  self.postMessage({ type: 'progress', payload: { percent, detail } });
};

const stringifyUnknownError = (err) => {
  if (err == null) return 'Unknown error.';
  if (typeof err === 'string') return err;
  if (err instanceof Error && typeof err.message === 'string' && err.message) return err.message;

  // Try common shapes
  if (typeof err?.message === 'string' && err.message) return err.message;
  if (typeof err?.error === 'string' && err.error) return err.error;

  // Last resort: JSON
  try { return JSON.stringify(err); } catch (_) { return String(err); }
};

const formatError = (context, err) => {
  const message = stringifyUnknownError(err);
  const stack = err?.stack ? `\n${err.stack}` : '';
  return `${context}: ${message}${stack}`;
};

const readZipEntries = (buffer) => {
  const signature = new Uint8Array(buffer.slice(0, 4));
  const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
  if (!isZip || !self.fflate?.unzipSync) {
    return null;
  }
  try {
    return self.fflate.unzipSync(new Uint8Array(buffer));
  } catch (err) {
    return null;
  }
};

const getPrjText = (entries) => {
  if (!entries) return null;
  const prjName = Object.keys(entries).find((name) => name.toLowerCase().endsWith('.prj'));
  if (!prjName) return null;
  return textDecoder.decode(entries[prjName]);
};

const getCrsWktFromInfo = (info) => {
  const layer = info?.layers?.[0];
  const geometryField = layer?.geometryFields?.[0];
  const coordinateSystem = geometryField?.coordinateSystem || layer?.coordinateSystem;
  return coordinateSystem?.wkt || coordinateSystem?.wkt2_2019 || coordinateSystem?.wkt2_2018 || null;
};

const parseEpsgFromWkt = (wkt) => {
  if (!wkt) return null;
  const match = wkt.match(/AUTHORITY\["EPSG","(\d+)"\]/i);
  if (!match) return null;
  const code = Number.parseInt(match[1], 10);
  return Number.isFinite(code) ? code : null;
};

const inferFieldType = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return 'date';
  }
  if (Array.isArray(value) || typeof value === 'object') {
    return 'json';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'boolean') {
    return 'bool';
  }
  return 'string';
};

const collectFieldTypes = (features) => {
  const fieldTypes = new Map();
  features.forEach((feature) => {
    const properties = feature?.properties || {};
    Object.entries(properties).forEach(([key, value]) => {
      if (!fieldTypes.has(key)) {
        fieldTypes.set(key, null);
      }
      const current = fieldTypes.get(key);
      if (current) {
        return;
      }
      const inferred = inferFieldType(value);
      if (inferred) {
        fieldTypes.set(key, inferred);
      }
    });
  });
  return fieldTypes;
};

const normalizeValue = (value, type) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (type === 'date') {
    if (value instanceof Date) {
      return value.getTime();
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return value;
};

const normalizeWkbType = (type) => {
  let hasZ = false;
  let baseType = type;

  if (type & 0x80000000) {
    hasZ = true;
    baseType = type & 0xffff;
  }
  if (type & 0x40000000) {
    baseType = type & 0xffff;
  }

  if (baseType >= 1000 && baseType < 2000) {
    hasZ = true;
    baseType -= 1000;
  } else if (baseType >= 2000 && baseType < 3000) {
    baseType -= 2000;
  } else if (baseType >= 3000 && baseType < 4000) {
    hasZ = true;
    baseType -= 3000;
  }

  return { baseType, hasZ };
};

const readPoint = (view, offset, littleEndian, hasZ) => {
  const x = view.getFloat64(offset, littleEndian);
  const y = view.getFloat64(offset + 8, littleEndian);
  offset += 16;
  if (hasZ) {
    offset += 8;
  }
  return { point: [x, y], offset };
};

const parseWkbGeometry = (view, offset = 0) => {
  const byteOrder = view.getUint8(offset);
  const littleEndian = byteOrder === 1;
  offset += 1;
  const type = view.getUint32(offset, littleEndian);
  offset += 4;

  if (type & 0x20000000) {
    offset += 4;
  }

  const { baseType, hasZ } = normalizeWkbType(type);

  if (baseType === 1) {
    const { point, offset: next } = readPoint(view, offset, littleEndian, hasZ);
    return { geometry: { type: 'Point', coordinates: point }, offset: next };
  }

  if (baseType === 2) {
    const count = view.getUint32(offset, littleEndian);
    offset += 4;
    const coords = [];
    for (let i = 0; i < count; i += 1) {
      const result = readPoint(view, offset, littleEndian, hasZ);
      coords.push(result.point);
      offset = result.offset;
    }
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
      for (let j = 0; j < pointCount; j += 1) {
        const result = readPoint(view, offset, littleEndian, hasZ);
        ring.push(result.point);
        offset = result.offset;
      }
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
      if (result.geometry?.type === 'Point') {
        points.push(result.geometry.coordinates);
      }
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
      if (result.geometry?.type === 'LineString') {
        lines.push(result.geometry.coordinates);
      }
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
      if (result.geometry?.type === 'Polygon') {
        polygons.push(result.geometry.coordinates);
      }
    }
    return { geometry: { type: 'MultiPolygon', coordinates: polygons }, offset };
  }

  throw new Error(`Unsupported WKB geometry type: ${baseType}`);
};

const decodeWkbGeometry = (wkb) => {
  if (!wkb) {
    return null;
  }
  const bytes = wkb instanceof Uint8Array ? wkb : new Uint8Array(wkb);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return parseWkbGeometry(view, 0).geometry;
};

const arrowTypeFor = (Arrow, type) => {
  switch (type) {
    case 'int':
      return new Arrow.Int32();
    case 'float':
      return new Arrow.Float64();
    case 'bool':
      return new Arrow.Bool();
    case 'date':
      return new Arrow.Timestamp('ms');
    case 'json':
    case 'string':
    default:
      return new Arrow.Utf8();
  }
};

const collectGeometryTypes = (features) => {
  const types = new Set();
  features.forEach((feature) => {
    const type = feature?.geometry?.type;
    if (type) {
      types.add(type);
    }
  });
  if (!types.size) {
    return 'Unknown';
  }
  if (types.size === 1) {
    return Array.from(types)[0];
  }
  return 'Unknown';
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
  if (!metadata || typeof metadata.get !== 'function') {
    return null;
  }
  const geoValue = metadata.get('geo');
  if (!geoValue || typeof geoValue !== 'string') {
    return null;
  }
  try {
    return JSON.parse(geoValue);
  } catch (_) {
    return null;
  }
};

const loadGeoParquetWithInfo = async (buffer, file) => {
  const parquetModule = await ensureParquetModule();
  const Arrow = self.Arrow;
  if (!Arrow) {
    throw new Error('Arrow library failed to load.');
  }

  const parquetFile = await parquetModule.ParquetFile.fromFile(file);
  const metadata = parquetFile.metadata();
  const fileMetadata = metadata.fileMetadata();
  const geoMetadata = parseGeoMetadata(fileMetadata.keyValueMetadata());
  const geometryColumn = geoMetadata?.primary_column || 'geometry';
  const geometryEncoding = geoMetadata?.columns?.[geometryColumn]?.encoding;
  if (typeof geometryEncoding === 'string' && geometryEncoding.toUpperCase() !== 'WKB') {
    throw new Error(`GeoParquet geometry encoding "${geometryEncoding}" is not supported.`);
  }

  const wasmTable = parquetModule.readParquet(new Uint8Array(buffer));
  const ipc = wasmTable.intoIPCStream();
  const table = Arrow.tableFromIPC(ipc);
  const geometryVector = table.getChild(geometryColumn);
  if (!geometryVector) {
    throw new Error(`GeoParquet geometry column "${geometryColumn}" was not found.`);
  }

  const fieldNames = table.schema.fields
    .map((field) => field.name)
    .filter((name) => name !== geometryColumn);
  const fieldVectors = fieldNames.map((name) => table.getChild(name));

  const features = [];
  for (let i = 0; i < table.numRows; i += 1) {
    const wkb = geometryVector.get(i);
    const geometry = decodeWkbGeometry(wkb);
    const properties = {};
    fieldNames.forEach((name, index) => {
      const vector = fieldVectors[index];
      properties[name] = vector ? vector.get(i) : null;
    });
    features.push({
      type: 'Feature',
      geometry,           // keep decoded GeoJSON for UI/type inference
      properties,
      __wkb: wkb          // ✅ preserve original bytes for exact re-write
    });
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    geoMetadata,
    geometryColumn
  };
};

const ensureArrowHelpers = async () => {
  if (!arrowHelpersPromise) {
    arrowHelpersPromise = Promise.all([
      import('../parquet/arrowSchema.js'),
      import('../geo/geoparquetMeta.js')
    ]).then(([arrowSchema, geoMeta]) => ({
      arrowSchema,
      geoMeta
    }));
  }
  return arrowHelpersPromise;
};

self.onmessage = async (event) => {
  const { file, outputFormat } = event.data || {};
  if (!file) {
    return;
  }
  const targetFormat = outputFormat === 'geopackage' ? 'geopackage' : 'geoparquet';

  sendProgress(10, 'Reading file contents...');
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    self.postMessage({
      type: 'error',
      payload: { message: formatError('Unable to read the file contents', err) }
    });
    return;
  }

  const lowerName = file.name?.toLowerCase() || '';
  const isGeoPackage = lowerName.endsWith('.gpkg');
  const isGeoJson = lowerName.endsWith('.geojson') || lowerName.endsWith('.json');
  const isGeoParquet = lowerName.endsWith('.geoparquet') || lowerName.endsWith('.parquet');
  let entries = null;
  let info = null;
  let existingGeoMetadata = null;
  let geometryColumn = 'geometry';

  if (isGeoPackage) {
    sendProgress(25, 'Opening GeoPackage...');
  } else if (isGeoJson) {
    sendProgress(25, 'Opening GeoJSON...');
  } else if (isGeoParquet) {
    sendProgress(25, 'Opening GeoParquet...');
  } else {
    sendProgress(25, 'Opening archive...');
    entries = readZipEntries(buffer);
    if (!entries) {
      self.postMessage({
        type: 'error',
        payload: { message: 'This file is not a supported shapefile zip, GeoPackage, GeoJSON, or GeoParquet file. Please try another file.' }
      });
      return;
    }
  }

  let parsingLabel = 'Parsing shapefile features...';
  if (isGeoPackage) {
    parsingLabel = 'Parsing GeoPackage features...';
  } else if (isGeoJson) {
    parsingLabel = 'Parsing GeoJSON features...';
  } else if (isGeoParquet) {
    parsingLabel = 'Parsing GeoParquet features...';
  }
  sendProgress(40, parsingLabel);
  let layerData;
  try {
    if (isGeoPackage) {
      const result = await loadGpkgGeoJsonWithInfo(file);
      layerData = result.geojson;
      info = result.info;
    } else if (isGeoJson) {
      const result = await loadGeoJsonWithInfo(file);
      layerData = result.geojson;
      info = result.info;
    } else if (isGeoParquet) {
      // GeoParquet ingestion uses parquet-wasm (GDAL build can't open GeoParquet here).
      // This path preserves original WKB bytes for exact re-write (no reprojection).
      const result = await loadGeoParquetWithInfo(buffer, file);
      layerData = result.geojson;
      existingGeoMetadata = result.geoMetadata;
      geometryColumn = result.geometryColumn || geometryColumn;
    } else {
      const { geojson } = await loadShapefileGeoJsonWithEntries(buffer);
      layerData = geojson;
    }
  } catch (err) {
    let context = 'We could not read this shapefile';
    if (isGeoPackage) {
      context = 'We could not read this GeoPackage';
    } else if (isGeoJson) {
      context = 'We could not read this GeoJSON file';
    } else if (isGeoParquet) {
      context = 'We could not read this GeoParquet file';
    }
    self.postMessage({
      type: 'error',
      payload: { message: formatError(context, err) }
    });
    return;
  }

  const collections = Array.isArray(layerData) ? layerData : [layerData];
  const primaryCollection = collections[0] || { features: [] };
  const features = primaryCollection.features || [];

  if (targetFormat === 'geopackage') {
    sendProgress(55, 'Preparing GeoPackage export...');
  
    // GeoJSON has no CRS. If the input was GeoParquet and its coordinates are projected,
    // GDAL will assume EPSG:4326 unless we assign the correct CRS here.
    let assignSrsText = null;
    if (existingGeoMetadata) {
      const crs = existingGeoMetadata?.columns?.[geometryColumn]?.crs;
      if (typeof crs === 'string') {
        assignSrsText = crs;
      } else if (crs && typeof crs === 'object') {
        try { assignSrsText = JSON.stringify(crs); } catch (_) { assignSrsText = null; }
      }
    }
  
    let gpkgBytes;
    try {
      gpkgBytes = await convertGeoJsonToGpkg(primaryCollection, assignSrsText);
    } catch (err) {
      self.postMessage({
        type: 'error',
        payload: { message: formatError('We could not build the GeoPackage file', err) }
      });
      return;
    }
  
    sendProgress(100, 'Conversion complete.');
    const blob = new Blob([gpkgBytes], { type: 'application/geopackage+sqlite3' });
    self.postMessage({
      type: 'success',
      payload: { blob }
    });
    return;
  }


  sendProgress(55, 'Preparing GeoParquet schema...');
  const fieldTypes = collectFieldTypes(features);
  const fieldEntries = Array.from(fieldTypes.entries());
  const geometryType = collectGeometryTypes(features);
  const prjText = getPrjText(entries);
  const wktText = prjText || getCrsWktFromInfo(info);
  const epsgFromWkt = parseEpsgFromWkt(wktText);

  const Arrow = self.Arrow;
  if (!Arrow) {
    self.postMessage({
      type: 'error',
      payload: { message: 'Arrow library failed to load. Please refresh and try again.' }
    });
    return;
  }

  const { arrowSchema, geoMeta } = await ensureArrowHelpers();
  const { makeArrowTable, tableToIPC } = arrowSchema;
  const { createGeoMetadata } = geoMeta;

  let geoMetadata = existingGeoMetadata;
  if (geoMetadata && !geoMetadata.primary_column) {
    geoMetadata.primary_column = geometryColumn;
  }
  if (!geoMetadata) {
    try {
      const spatialRef = wktText
        ? { wkt: wktText, wkid: epsgFromWkt, latestWkid: epsgFromWkt }
        : null;
      geoMetadata = await createGeoMetadata(spatialRef, geometryType);
    } catch (err) {
      try {
        geoMetadata = await createGeoMetadata(null, geometryType);
      } catch (fallbackErr) {
        self.postMessage({
          type: 'error',
          payload: { message: formatError('Failed to build GeoParquet metadata', fallbackErr) }
        });
        return;
      }
    }
  }

  const schemaFields = [
    new Arrow.Field(geometryColumn, new Arrow.Binary(), true),
    ...fieldEntries.map(([name, type]) => new Arrow.Field(name, arrowTypeFor(Arrow, type), true))
  ];
  const schema = new Arrow.Schema(schemaFields, new Map([['geo', JSON.stringify(geoMetadata)]]));

  const geomBuilder = Arrow.makeBuilder({ type: new Arrow.Binary() });
  const fieldBuilders = new Map();
  fieldEntries.forEach(([name, type]) => {
    fieldBuilders.set(name, Arrow.makeBuilder({ type: arrowTypeFor(Arrow, type) }));
  });

  sendProgress(70, 'Encoding rows...');
  features.forEach((feature) => {
    const geometry = feature?.geometry;
    let wkb = feature?.__wkb;

    // If we don’t have original WKB (non-GeoParquet inputs), fall back to encoding
    if (!wkb) {
      const geometry = feature?.geometry;
      wkb = geometry ? self.wkx.Geometry.parseGeoJSON(geometry).toWkb() : null;
    }

    geomBuilder.append(wkb && wkb.length ? wkb : null);

    const properties = feature?.properties || {};
    fieldEntries.forEach(([name, type]) => {
      const builder = fieldBuilders.get(name);
      const value = normalizeValue(properties[name], type);
      builder.append(value === undefined ? null : value);
    });
  });

  geomBuilder.finish();
  const geomVector = geomBuilder.toVector();
  const vectors = schema.fields.map((field) => {
    if (field.name === geometryColumn) {
      return geomVector;
    }
    const builder = fieldBuilders.get(field.name);
    builder.finish();
    return builder.toVector();
  });

  sendProgress(85, 'Building Parquet file...');
  let parquetBytes;
  try {
    const table = makeArrowTable(Arrow, schema, vectors);
    const ipc = tableToIPC(Arrow, table, 'stream');
    const parquetModule = await ensureParquetModule();
    const {
      Table: WasmTable,
      WriterPropertiesBuilder,
      Compression,
      writeParquet
    } = parquetModule;
    const wasmTable = WasmTable.fromIPCStream(ipc);
    const parquetMeta = new Map([['geo', JSON.stringify(geoMetadata)]]);
    const writerProps = new WriterPropertiesBuilder()
      .setCompression(Compression.ZSTD)
      .setKeyValueMetadata(parquetMeta)
      .build();
    parquetBytes = writeParquet(wasmTable, writerProps);
  } catch (err) {
    self.postMessage({
      type: 'error',
      payload: { message: formatError('We could not build the GeoParquet file', err) }
    });
    return;
  }

  sendProgress(100, 'Conversion complete.');
  const blob = new Blob([parquetBytes], { type: 'application/vnd.apache.parquet' });
  self.postMessage({
    type: 'success',
    payload: { blob }
  });
};
