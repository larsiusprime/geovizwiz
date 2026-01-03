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

const loadGpkgAsGeoJson = async (file) => {
  const gdal = await gdalPromise;
  const { datasets, errors } = await gdal.open(file);
  if (!datasets?.length) {
    const err = errors?.[0] || 'GDAL could not open this GeoPackage.';
    throw new Error(Array.isArray(err) ? err.join('\n') : String(err));
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
    const err = errors?.[0] || 'GDAL could not open this GeoJSON.';
    throw new Error(Array.isArray(err) ? err.join('\n') : String(err));
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

const loadGeoParquetAsGeoJson = async (file) => {
  const gdal = await gdalPromise;
  const { datasets, errors } = await gdal.open(file);
  if (!datasets?.length) {
    const err = errors?.[0] || 'GDAL could not open this GeoParquet file.';
    throw new Error(Array.isArray(err) ? err.join('\n') : String(err));
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
      const result = await loadGeoParquetAsGeoJson(file);
      layerData = result.geojson;
      info = result.info;
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
    const features = layer?.features || [];
    return {
      fileName: layer?.fileName || 'Layer',
      rowCount: features.length,
      geometryType: getGeometryType(features),
      fields: getFieldInfo(features),
      layerTypeLabel
    };
  });

  const crs = isGeoPackage || isGeoJson || isGeoParquet
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
