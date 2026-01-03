importScripts(
  '../../vendor/fflate/index.min.js',
  '../../vendor/gdal/gdal3.js',
  '../../vendor/apache-arrow.js'
);

const textDecoder = new TextDecoder();
const GDAL_BASE = new URL('../../vendor/gdal/', self.location).toString();

const gdalPromise = self.initGdalJs({
  useWorker: false,
  path: GDAL_BASE
});

let parquetModulePromise = null;
let parquetInitialized = false;

const formatGdalErrors = (errors, fallback) => {
  if (!errors?.length) return fallback;
  return errors.map(e => {
    if (typeof e === 'string') return e;
    if (e?.message) return e.message;
    try { return JSON.stringify(e); } catch { return String(e); }
  }).join('\n');
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

const normalizeArrowType = (type) => {
  if (!type) {
    return 'unknown';
  }
  if (typeof type.toString === 'function') {
    return type.toString();
  }
  return type.typeId ? String(type.typeId) : 'unknown';
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

const formatGeoCrsLabel = (crs) => {
  if (!crs) {
    return 'Unknown';
  }
  if (typeof crs === 'string') {
    return crs;
  }
  if (typeof crs === 'object') {
    if (typeof crs.name === 'string') {
      return crs.name;
    }
    if (typeof crs.name?.name === 'string') {
      return crs.name.name;
    }
    if (crs.id?.authority && crs.id?.code) {
      return `${crs.id.authority}:${crs.id.code}`;
    }
    if (crs.id?.code) {
      return `EPSG:${crs.id.code}`;
    }
  }
  try {
    return JSON.stringify(crs);
  } catch (_) {
    return 'Unknown';
  }
};

const getGeometryTypeFromGeoMetadata = (geoMetadata, geometryColumn) => {
  const types = geoMetadata?.columns?.[geometryColumn]?.geometry_types;
  if (!Array.isArray(types) || types.length === 0) {
    return 'Unknown';
  }
  if (types.length === 1) {
    return types[0];
  }
  return `Mixed (${types.join(', ')})`;
};

const toFilesFromZipEntries = (entries) => Object.entries(entries).map(([name, bytes]) => {
  // WORKERFS expects File objects in the browser worker environment.
  return new File([bytes], name);
});

const loadShapefileAsGeoJson = async (zipBuffer) => {
  const entries = readZipEntries(zipBuffer);
  const files = toFilesFromZipEntries(entries);

  const gdal = await gdalPromise;

  // Open dataset(s) from the provided files (WORKERFS mount).
  const { datasets, errors } = await gdal.open(files);
  if (!datasets?.length) {
    throw new Error(formatGdalErrors(errors, 'GDAL could not open this Shapefile.'));
  }

  const dataset = datasets[0];

  // Convert to GeoJSON WITHOUT reprojecting (keeps native CRS coordinates).
  const out = await gdal.ogr2ogr(dataset, ['-f', 'GeoJSON']);
  const bytes = await gdal.getFileBytes(out);
  const text = new TextDecoder().decode(bytes);
  const geojson = JSON.parse(text);

  // Cleanup GDAL datasets (best-effort).
  try { await gdal.close(dataset); } catch (_) {}

  return { geojson, entries };
};

const loadGpkgAsGeoJson = async (file) => {
  const gdal = await gdalPromise;
  const { datasets, errors } = await gdal.open(file);
  if (!datasets?.length) {
    throw new Error(formatGdalErrors(errors, 'GDAL could not open this GeoPackage.'));
  }

  const dataset = datasets[0];
  const out = await gdal.ogr2ogr(dataset, ['-f', 'GeoJSON']);
  const bytes = await gdal.getFileBytes(out);
  const text = new TextDecoder().decode(bytes);
  const geojson = JSON.parse(text);
  const info = dataset.info || null;

  try { await gdal.close(dataset); } catch (_) {}

  return { geojson, info };
};

const loadGeoJsonAsGeoJson = async (file) => {
  const gdal = await gdalPromise;
  const { datasets, errors } = await gdal.open(file);
  if (!datasets?.length) {
    throw new Error(formatGdalErrors(errors, 'GDAL could not open this GeoJSON.'));
  }

  const dataset = datasets[0];
  const out = await gdal.ogr2ogr(dataset, ['-f', 'GeoJSON']);
  const bytes = await gdal.getFileBytes(out);
  const text = new TextDecoder().decode(bytes);
  const geojson = JSON.parse(text);
  const info = dataset.info || null;

  try { await gdal.close(dataset); } catch (_) {}

  return { geojson, info };
};

const loadGeoParquetMetadata = async (buffer, file) => {
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
  const geometryType = getGeometryTypeFromGeoMetadata(geoMetadata, geometryColumn);
  const crsLabel = formatGeoCrsLabel(geoMetadata?.columns?.[geometryColumn]?.crs);

  const wasmTable = parquetModule.readParquet(new Uint8Array(buffer));
  const ipc = wasmTable.intoIPCStream();
  const table = Arrow.tableFromIPC(ipc);
  const fields = table.schema.fields
    .filter((field) => field.name !== geometryColumn)
    .map((field) => ({ name: field.name, type: normalizeArrowType(field.type) }));

  return {
    rowCount: table.numRows ?? fileMetadata.numRows(),
    geometryType,
    fields,
    crsLabel,
    geometryColumn
  };
};


const sendProgress = (percent, detail) => {
  self.postMessage({ type: 'progress', payload: { percent, detail } });
};

const inferType = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value instanceof Date) {
    return 'date';
  }
  return typeof value;
};

const getGeometryType = (features) => {
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
  return `Mixed (${Array.from(types).join(', ')})`;
};

const getFieldInfo = (features) => {
  const fieldTypes = new Map();
  features.forEach((feature) => {
    const properties = feature?.properties || {};
    Object.entries(properties).forEach(([key, value]) => {
      if (!fieldTypes.has(key)) {
        fieldTypes.set(key, 'unknown');
      }
      const currentType = fieldTypes.get(key);
      if (currentType === 'unknown') {
        const inferred = inferType(value);
        if (inferred) {
          fieldTypes.set(key, inferred);
        }
      }
    });
  });
  return Array.from(fieldTypes.entries()).map(([name, type]) => ({ name, type }));
};

const getCrsLabelFromWkt = (wkt) => {
  if (!wkt) {
    return 'Unknown';
  }
  const match = wkt.match(/^(?:PROJCS|GEOGCS|LOCAL_CS|COMPD_CS)\s*\["([^"]+)"/i);
  return match?.[1] || wkt.split(/\r?\n/)[0]?.trim() || 'Unknown';
};

const getCrsLabelFromEntries = (entries) => {
  const prjName = Object.keys(entries).find((name) => name.toLowerCase().endsWith('.prj'));
  if (!prjName) {
    return 'Unknown';
  }
  const prjText = textDecoder.decode(entries[prjName]);
  return getCrsLabelFromWkt(prjText);
};

const getCrsLabelFromInfo = (info) => {
  const layer = info?.layers?.[0];
  const geometryField = layer?.geometryFields?.[0];
  const coordinateSystem = geometryField?.coordinateSystem || layer?.coordinateSystem;
  const wkt = coordinateSystem?.wkt || coordinateSystem?.wkt2_2019 || coordinateSystem?.wkt2_2018;
  return getCrsLabelFromWkt(wkt);
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
      payload: { message: 'Unable to read the file contents. Please try again.' }
    });
    return;
  }

  const lowerName = file.name?.toLowerCase() || '';
  const isGeoPackage = lowerName.endsWith('.gpkg');
  const isGeoJson = lowerName.endsWith('.geojson') || lowerName.endsWith('.json');
  const isGeoParquet = lowerName.endsWith('.geoparquet') || lowerName.endsWith('.parquet');
  let entries = null;
  let info = null;

  if (!isGeoPackage && !isGeoJson && !isGeoParquet) {
    sendProgress(30, 'Inspecting archive contents...');
    entries = readZipEntries(buffer);
    if (!entries) {
      self.postMessage({
        type: 'invalid',
        payload: {
          label: 'Unknown',
          message: 'Not a supported format. Upload a zipped ESRI Shapefile (.shp.zip), GeoPackage (.gpkg), GeoJSON (.geojson or .json), or GeoParquet (.geoparquet or .parquet).'
        }
      });
      return;
    }

    const entryNames = Object.keys(entries).map((name) => name.toLowerCase());
    const hasShp = entryNames.some((name) => name.endsWith('.shp'));
    const hasDbf = entryNames.some((name) => name.endsWith('.dbf'));
    const hasShx = entryNames.some((name) => name.endsWith('.shx'));

    if (!hasShp || !hasDbf) {
      self.postMessage({
        type: 'invalid',
        payload: {
          label: 'ZIP archive',
          message: 'Not a supported format. This zip archive does not contain the required .shp and .dbf files for a valid ESRI Shapefile.'
        }
      });
      return;
    }

    if (!hasShx) {
      self.postMessage({
        type: 'invalid',
        payload: {
          label: 'Partial ESRI Shapefile (missing .shx)',
          message: 'Not a supported format. The zip archive is missing the .shx index file required for a complete ESRI Shapefile.'
        }
      });
      return;
    }
  }

  let metadataLabel = 'Reading shapefile metadata...';
  if (isGeoPackage) {
    metadataLabel = 'Reading GeoPackage metadata...';
  } else if (isGeoJson) {
    metadataLabel = 'Reading GeoJSON metadata...';
  } else if (isGeoParquet) {
    metadataLabel = 'Reading GeoParquet metadata...';
  }
  sendProgress(55, metadataLabel);
  let layerData;
  let parquetMetadata = null;
  try {
    if (isGeoPackage) {
      const result = await loadGpkgAsGeoJson(file);
      layerData = result.geojson;
      info = result.info;
    } else if (isGeoJson) {
      const result = await loadGeoJsonAsGeoJson(file);
      layerData = result.geojson;
      info = result.info;
    } else if (isGeoParquet) {
      parquetMetadata = await loadGeoParquetMetadata(buffer, file);
      layerData = {
        type: 'FeatureCollection',
        features: []
      };
    } else {
      const { geojson, entries: zipEntries } = await loadShapefileAsGeoJson(buffer);
      layerData = geojson;
      entries = zipEntries;
    }
  } catch (err) {
    let formatLabel = 'zipped shapefile';
    if (isGeoPackage) {
      formatLabel = 'GeoPackage';
    } else if (isGeoJson) {
      formatLabel = 'GeoJSON file';
    } else if (isGeoParquet) {
      formatLabel = 'GeoParquet file';
    }
    const message = err?.message
      ? `We found a valid ${formatLabel}, but could not read its metadata. ${err.message}`
      : `We found a valid ${formatLabel}, but could not read its metadata.`;
    self.postMessage({ type: 'error', payload: { message } });
    return;
  }

  sendProgress(80, 'Summarizing layers...');
  let layerTypeLabel = 'Shapefile layer';
  if (isGeoPackage) {
    layerTypeLabel = 'GeoPackage layer';
  } else if (isGeoJson) {
    layerTypeLabel = 'GeoJSON layer';
  } else if (isGeoParquet) {
    layerTypeLabel = 'GeoParquet layer';
  }
  const layers = (Array.isArray(layerData) ? layerData : [layerData]).map((layer) => {
    if (isGeoParquet && parquetMetadata) {
      return {
        fileName: layer?.fileName || 'Layer',
        rowCount: parquetMetadata.rowCount ?? 0,
        geometryType: parquetMetadata.geometryType,
        fields: parquetMetadata.fields || [],
        layerTypeLabel
      };
    }
    const features = layer?.features || [];
    return {
      fileName: layer?.fileName || 'Layer',
      rowCount: features.length,
      geometryType: getGeometryType(features),
      fields: getFieldInfo(features),
      layerTypeLabel
    };
  });

  const crs = isGeoParquet
    ? parquetMetadata?.crsLabel || 'Unknown'
    : isGeoPackage || isGeoJson
      ? getCrsLabelFromInfo(info)
      : getCrsLabelFromEntries(entries);
  sendProgress(95, 'Finalizing metadata...');

  self.postMessage({
    type: 'success',
    payload: {
      label: isGeoPackage
        ? 'GeoPackage (.gpkg)'
        : isGeoJson
          ? 'GeoJSON (.geojson)'
          : isGeoParquet
            ? 'GeoParquet (.geoparquet)'
            : 'ESRI Shapefile (zipped)',
      message: 'Metadata loaded. You may proceed to the conversion step.',
      layers,
      crs
    }
  });
};
