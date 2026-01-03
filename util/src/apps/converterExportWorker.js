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

const loadShapefileGeoJsonWithEntries = async (zipBuffer) => {
  const entries = readZipEntries(zipBuffer);
  const gdal = await gdalPromise;
  const files = toFilesFromZipEntries(entries);

  const { datasets, errors } = await gdal.open(files);
  if (!datasets?.length) {
    const err = errors?.[0] || 'GDAL could not open this shapefile.';
    throw new Error(Array.isArray(err) ? err.join('\n') : String(err));
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
    const err = errors?.[0] || 'GDAL could not open this GeoPackage.';
    throw new Error(Array.isArray(err) ? err.join('\n') : String(err));
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

let parquetModulePromise = null;
let arrowHelpersPromise = null;
let parquetInitialized = false;

const sendProgress = (percent, detail) => {
  self.postMessage({ type: 'progress', payload: { percent, detail } });
};

const formatError = (context, err) => {
  if (!err) {
    return `${context}: Unknown error.`;
  }
  const message = err?.message ? String(err.message) : String(err);
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
  const { file } = event.data || {};
  if (!file) {
    return;
  }

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
  let entries = null;
  let info = null;

  if (isGeoPackage) {
    sendProgress(25, 'Opening GeoPackage...');
  } else {
    sendProgress(25, 'Opening archive...');
    entries = readZipEntries(buffer);
    if (!entries) {
      self.postMessage({
        type: 'error',
        payload: { message: 'This file is not a supported shapefile zip or GeoPackage. Please try another file.' }
      });
      return;
    }
  }

  sendProgress(40, isGeoPackage ? 'Parsing GeoPackage features...' : 'Parsing shapefile features...');
  let layerData;
  try {
    if (isGeoPackage) {
      const result = await loadGpkgGeoJsonWithInfo(file);
      layerData = result.geojson;
      info = result.info;
    } else {
      const { geojson } = await loadShapefileGeoJsonWithEntries(buffer);
      layerData = geojson;
    }
  } catch (err) {
    const context = isGeoPackage ? 'We could not read this GeoPackage' : 'We could not read this shapefile';
    self.postMessage({
      type: 'error',
      payload: { message: formatError(context, err) }
    });
    return;
  }

  const collections = Array.isArray(layerData) ? layerData : [layerData];
  const primaryCollection = collections[0] || { features: [] };
  const features = primaryCollection.features || [];

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

  let geoMetadata;
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

  const schemaFields = [
    new Arrow.Field('geometry', new Arrow.Binary(), true),
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
    const wkb = geometry ? self.wkx.Geometry.parseGeoJSON(geometry).toWkb() : null;
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
    if (field.name === 'geometry') {
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
