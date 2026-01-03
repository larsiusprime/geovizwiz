importScripts(
  '../../vendor/fflate/index.min.js',
  '../../vendor/wkx/dist/wkx.js',
  '../../vendor/apache-arrow.js',
  '../../vendor/gdal3/gdal3.js'
);

let gdalModulePromise = null;
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

const ensureGdal = async () => {
  if (!gdalModulePromise) {
    gdalModulePromise = initGdalJs({
      paths: {
        wasm: '/util/vendor/gdal3/gdal3WebAssembly.wasm',
        data: '/util/vendor/gdal3/gdal3WebAssembly.data'
      },
      useWorker: false
    });
  }
  return gdalModulePromise;
};

const getShapefileEntries = (entries) => {
  if (!entries) return null;
  const names = Object.keys(entries);
  const grouped = new Map();
  names.forEach((name) => {
    const lower = name.toLowerCase();
    const extMatch = lower.match(/\.([a-z0-9]+)$/);
    if (!extMatch) return;
    const ext = extMatch[1];
    if (!['shp', 'dbf', 'shx', 'prj'].includes(ext)) return;
    const base = lower.replace(/\.([a-z0-9]+)$/, '');
    const baseName = base.split('/').pop();
    if (!grouped.has(baseName)) {
      grouped.set(baseName, {});
    }
    grouped.get(baseName)[ext] = name;
  });

  for (const [baseName, fileSet] of grouped.entries()) {
    if (fileSet.shp && fileSet.dbf && fileSet.shx) {
      return {
        baseName,
        shpName: fileSet.shp,
        dbfName: fileSet.dbf,
        shxName: fileSet.shx,
        prjName: fileSet.prj || null
      };
    }
  }

  return null;
};

const getGdalApi = (Module) => ({
  GDALOpenEx: Module.cwrap('GDALOpenEx', 'number', ['string', 'number', 'number', 'number', 'number']),
  GDALClose: Module.cwrap('GDALClose', null, ['number']),
  GDALGetSpatialRef: Module.cwrap('GDALGetSpatialRef', 'number', ['number']),
  GDALDatasetGetLayerCount: Module.cwrap('GDALDatasetGetLayerCount', 'number', ['number']),
  GDALDatasetGetLayer: Module.cwrap('GDALDatasetGetLayer', 'number', ['number', 'number']),
  OGR_L_ResetReading: Module.cwrap('OGR_L_ResetReading', null, ['number']),
  OGR_L_GetNextFeature: Module.cwrap('OGR_L_GetNextFeature', 'number', ['number']),
  OGR_L_GetSpatialRef: Module.cwrap('OGR_L_GetSpatialRef', 'number', ['number']),
  OGR_F_GetFieldCount: Module.cwrap('OGR_F_GetFieldCount', 'number', ['number']),
  OGR_F_GetFieldDefnRef: Module.cwrap('OGR_F_GetFieldDefnRef', 'number', ['number', 'number']),
  OGR_Fld_GetNameRef: Module.cwrap('OGR_Fld_GetNameRef', 'string', ['number']),
  OGR_Fld_GetType: Module.cwrap('OGR_Fld_GetType', 'number', ['number']),
  OGR_F_IsFieldSetAndNotNull: Module.cwrap('OGR_F_IsFieldSetAndNotNull', 'number', ['number', 'number']),
  OGR_F_GetFieldAsInteger64: Module.cwrap('OGR_F_GetFieldAsInteger64', 'number', ['number', 'number']),
  OGR_F_GetFieldAsDouble: Module.cwrap('OGR_F_GetFieldAsDouble', 'number', ['number', 'number']),
  OGR_F_GetFieldAsString: Module.cwrap('OGR_F_GetFieldAsString', 'string', ['number', 'number']),
  OGR_F_Destroy: Module.cwrap('OGR_F_Destroy', null, ['number']),
  OGR_F_GetGeometryRef: Module.cwrap('OGR_F_GetGeometryRef', 'number', ['number']),
  OGR_G_WkbSize: Module.cwrap('OGR_G_WkbSize', 'number', ['number']),
  OGR_G_ExportToWkb: Module.cwrap('OGR_G_ExportToWkb', 'number', ['number', 'number', 'number']),
  OSRNewSpatialReference: Module.cwrap('OSRNewSpatialReference', 'number', ['string']),
  OSRSetFromUserInput: Module.cwrap('OSRSetFromUserInput', 'number', ['number', 'string']),
  OSRExportToWkt: Module.cwrap('OSRExportToWkt', 'number', ['number', 'number']),
  OSRGetAuthorityName: Module.cwrap('OSRGetAuthorityName', 'string', ['number', 'string']),
  OSRGetAuthorityCode: Module.cwrap('OSRGetAuthorityCode', 'string', ['number', 'string']),
  OSRDestroySpatialReference: Module.cwrap('OSRDestroySpatialReference', null, ['number']),
  CPLFree: Module.cwrap('CPLFree', null, ['number'])
});

const writeShapefileToFs = (Module, entries, fileNames) => {
  const rootDir = '/work';
  const inputDir = `${rootDir}/in`;
  try {
    Module.FS.mkdir(rootDir);
  } catch (err) {
    // ignore if exists
  }
  try {
    Module.FS.mkdir(inputDir);
  } catch (err) {
    // ignore if exists
  }

  const writeEntry = (name, ext) => {
    if (!name || !entries[name]) return null;
    const data = entries[name];
    const targetPath = `${inputDir}/${fileNames.baseName}.${ext}`;
    Module.FS.writeFile(targetPath, data);
    return targetPath;
  };

  return {
    shpPath: writeEntry(fileNames.shpName, 'shp'),
    dbfPath: writeEntry(fileNames.dbfName, 'dbf'),
    shxPath: writeEntry(fileNames.shxName, 'shx'),
    prjPath: fileNames.prjName ? writeEntry(fileNames.prjName, 'prj') : null
  };
};

const readSpatialRef = (Module, gdal, dataSetHandle, layerHandle, prjText) => {
  let spatialRefHandle = null;
  if (typeof gdal.OGR_L_GetSpatialRef === 'function') {
    spatialRefHandle = gdal.OGR_L_GetSpatialRef(layerHandle);
  }
  if (!spatialRefHandle && typeof gdal.GDALGetSpatialRef === 'function') {
    spatialRefHandle = gdal.GDALGetSpatialRef(dataSetHandle);
  }
  let createdSpatialRef = false;
  if (!spatialRefHandle && prjText) {
    const tempSrs = gdal.OSRNewSpatialReference(null);
    if (tempSrs) {
      const setResult = gdal.OSRSetFromUserInput(tempSrs, prjText);
      if (setResult === 0) {
        spatialRefHandle = tempSrs;
        createdSpatialRef = true;
      } else {
        gdal.OSRDestroySpatialReference(tempSrs);
      }
    }
  }
  if (!spatialRefHandle) {
    return { spatialRef: null, epsgCode: null, wkt: null };
  }
  const canReadAuthority =
    typeof gdal.OSRGetAuthorityName === 'function' && typeof gdal.OSRGetAuthorityCode === 'function';
  const authorityName = canReadAuthority
    ? gdal.OSRGetAuthorityName(spatialRefHandle, 'PROJCS') ||
      gdal.OSRGetAuthorityName(spatialRefHandle, 'GEOGCS') ||
      gdal.OSRGetAuthorityName(spatialRefHandle, null)
    : null;
  const authorityCode = canReadAuthority
    ? gdal.OSRGetAuthorityCode(spatialRefHandle, 'PROJCS') ||
      gdal.OSRGetAuthorityCode(spatialRefHandle, 'GEOGCS') ||
      gdal.OSRGetAuthorityCode(spatialRefHandle, null)
    : null;

  let wkt = null;
  const wktPtrPtr = Module._malloc(4);
  try {
    const exportResult = gdal.OSRExportToWkt(spatialRefHandle, wktPtrPtr);
    if (exportResult === 0) {
      const wktPtr = Module.getValue(wktPtrPtr, 'i32');
      if (wktPtr) {
        wkt = Module.UTF8ToString(wktPtr);
        gdal.CPLFree(wktPtr);
      }
    }
  } finally {
    Module._free(wktPtrPtr);
  }

  let epsgCode = null;
  if (authorityName && authorityCode && authorityName.toUpperCase() === 'EPSG') {
    const parsed = Number.parseInt(authorityCode, 10);
    if (Number.isFinite(parsed)) {
      epsgCode = parsed;
    }
  }

  const result = {
    spatialRef: wkt || epsgCode ? { wkt, wkid: epsgCode, latestWkid: epsgCode } : null,
    epsgCode,
    wkt
  };
  if (createdSpatialRef && spatialRefHandle) {
    gdal.OSRDestroySpatialReference(spatialRefHandle);
  }
  return result;
};

const readShapefileWithGdal = async (entries) => {
  const gdalInstance = await ensureGdal();
  const { Module } = gdalInstance;
  const gdal = getGdalApi(Module);
  const fileNames = getShapefileEntries(entries);
  if (!fileNames) {
    throw new Error('We could not find the required .shp, .dbf, and .shx files in this zip archive.');
  }

  const { shpPath, prjPath } = writeShapefileToFs(Module, entries, fileNames);
  const dataSetHandle = gdal.GDALOpenEx(shpPath, 0, 0, 0, 0);
  if (!dataSetHandle) {
    throw new Error('GDAL was unable to open the shapefile data.');
  }

  let features = [];
  let geometryType = 'Unknown';
  let spatialRef = null;

  try {
    const layerCount = gdal.GDALDatasetGetLayerCount(dataSetHandle);
    if (!layerCount) {
      throw new Error('No layers were found in this shapefile.');
    }
    const layerHandle = gdal.GDALDatasetGetLayer(dataSetHandle, 0);
    if (!layerHandle) {
      throw new Error('Could not open the shapefile layer.');
    }

    let prjText = null;
    if (prjPath) {
      try {
        const prjBytes = Module.FS.readFile(prjPath);
        prjText = new TextDecoder().decode(prjBytes);
      } catch (err) {
        prjText = null;
      }
    }

    const spatialRefInfo = readSpatialRef(Module, gdal, dataSetHandle, layerHandle, prjText);
    spatialRef = spatialRefInfo.spatialRef;
    if (!spatialRef) {
      throw new Error('This shapefile does not include a readable CRS. Please provide a .prj file.');
    }

    gdal.OGR_L_ResetReading(layerHandle);
    let featureHandle = gdal.OGR_L_GetNextFeature(layerHandle);
    let geometryTypes = new Set();

    while (featureHandle) {
      const properties = {};
      const fieldCount = gdal.OGR_F_GetFieldCount(featureHandle);
      for (let i = 0; i < fieldCount; i += 1) {
        if (!gdal.OGR_F_IsFieldSetAndNotNull(featureHandle, i)) {
          const fieldDefn = gdal.OGR_F_GetFieldDefnRef(featureHandle, i);
          const name = gdal.OGR_Fld_GetNameRef(fieldDefn);
          properties[name] = null;
          continue;
        }
        const fieldDefn = gdal.OGR_F_GetFieldDefnRef(featureHandle, i);
        const name = gdal.OGR_Fld_GetNameRef(fieldDefn);
        const type = gdal.OGR_Fld_GetType(fieldDefn);
        let value = null;
        if (type === 0 || type === 12) {
          value = gdal.OGR_F_GetFieldAsInteger64(featureHandle, i);
        } else if (type === 2) {
          value = gdal.OGR_F_GetFieldAsDouble(featureHandle, i);
        } else {
          value = gdal.OGR_F_GetFieldAsString(featureHandle, i);
        }
        properties[name] = value;
      }

      const geometryHandle = gdal.OGR_F_GetGeometryRef(featureHandle);
      let wkb = null;
      if (geometryHandle) {
        const size = gdal.OGR_G_WkbSize(geometryHandle);
        const wkbPtr = Module._malloc(size);
        try {
          gdal.OGR_G_ExportToWkb(geometryHandle, 1, wkbPtr);
          wkb = Module.HEAPU8.slice(wkbPtr, wkbPtr + size);
          const geojsonType = self.wkx.Geometry.parse(wkb).toGeoJSON().type;
          if (geojsonType) {
            geometryTypes.add(geojsonType);
          }
        } finally {
          Module._free(wkbPtr);
        }
      }

      features.push({ geometry: wkb, properties });
      gdal.OGR_F_Destroy(featureHandle);
      featureHandle = gdal.OGR_L_GetNextFeature(layerHandle);
    }

    if (geometryTypes.size === 1) {
      geometryType = Array.from(geometryTypes)[0];
    }
  } finally {
    gdal.GDALClose(dataSetHandle);
  }

  return { features, geometryType, spatialRef };
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
    let type = feature?.geometry?.type;
    if (!type && feature?.geometry instanceof Uint8Array) {
      try {
        type = self.wkx.Geometry.parse(feature.geometry).toGeoJSON().type;
      } catch (err) {
        type = null;
      }
    }
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

  sendProgress(25, 'Opening archive...');
  const entries = readZipEntries(buffer);
  if (!entries) {
    self.postMessage({
      type: 'error',
      payload: { message: 'This file is not a supported shapefile zip. Please try another file.' }
    });
    return;
  }

  sendProgress(40, 'Parsing shapefile features...');
  let features;
  let geometryType;
  let spatialRef;
  try {
    const gdalResult = await readShapefileWithGdal(entries);
    features = gdalResult.features;
    geometryType = gdalResult.geometryType;
    spatialRef = gdalResult.spatialRef;
  } catch (err) {
    self.postMessage({
      type: 'error',
      payload: { message: formatError('We could not read this shapefile', err) }
    });
    return;
  }

  sendProgress(55, 'Preparing GeoParquet schema...');
  const fieldTypes = collectFieldTypes(features);
  const fieldEntries = Array.from(fieldTypes.entries());
  const resolvedGeometryType = geometryType || collectGeometryTypes(features);

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
    geoMetadata = await createGeoMetadata(spatialRef, resolvedGeometryType);
  } catch (err) {
    try {
      geoMetadata = await createGeoMetadata(null, resolvedGeometryType);
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
    let wkb = null;
    if (geometry instanceof Uint8Array) {
      wkb = geometry;
    } else if (geometry) {
      wkb = self.wkx.Geometry.parseGeoJSON(geometry).toWkb();
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
