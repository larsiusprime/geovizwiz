importScripts('../../vendor/fflate/index.min.js', '../../vendor/gdal/gdal3.js');

const textDecoder = new TextDecoder();
const GDAL_BASE = new URL('../../vendor/gdal/', self.location).toString();

const gdalPromise = self.initGdalJs({
  useWorker: false,
  path: GDAL_BASE
});

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
    const err = errors?.[0] || 'GDAL could not open this shapefile.';
    throw new Error(Array.isArray(err) ? err.join('\n') : String(err));
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

const getCrsLabel = (entries) => {
  const prjName = Object.keys(entries).find((name) => name.toLowerCase().endsWith('.prj'));
  if (!prjName) {
    return 'Unknown';
  }
  const prjText = textDecoder.decode(entries[prjName]);
  const match = prjText.match(/^(?:PROJCS|GEOGCS|LOCAL_CS|COMPD_CS)\s*\["([^"]+)"/i);
  return match?.[1] || prjText.split(/\r?\n/)[0]?.trim() || 'Unknown';
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

  sendProgress(30, 'Inspecting archive contents...');
  let entries = readZipEntries(buffer);
  if (!entries) {
    self.postMessage({
      type: 'invalid',
      payload: {
        label: 'Unknown',
        message: 'Not a supported format. Upload a zipped ESRI Shapefile (.zip containing .shp + .dbf + .shx).'
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

  sendProgress(55, 'Reading shapefile metadata...');
  let layerData;
  try {
    const { geojson, entries: zipEntries } = await loadShapefileAsGeoJson(buffer);
    layerData = geojson;
    entries = zipEntries;
  } catch (err) {
    const message = err?.message
      ? `We found a valid zipped shapefile, but could not read its metadata. ${err.message}`
      : 'We found a valid zipped shapefile, but could not read its metadata.';
    self.postMessage({ type: 'error', payload: { message } });
    return;
  }

  sendProgress(80, 'Summarizing layers...');
  const layers = (Array.isArray(layerData) ? layerData : [layerData]).map((layer) => {
    const features = layer?.features || [];
    return {
      fileName: layer?.fileName || 'Layer',
      rowCount: features.length,
      geometryType: getGeometryType(features),
      fields: getFieldInfo(features)
    };
  });

  const crs = getCrsLabel(entries);
  sendProgress(95, 'Finalizing metadata...');

  self.postMessage({
    type: 'success',
    payload: {
      label: 'ESRI Shapefile (zipped)',
      message: 'Metadata loaded. You may proceed to the conversion step.',
      layers,
      crs
    }
  });
};
