/**
 * Fetch full PROJJSON for an EPSG code from epsg.io and cache it.
 * Returns an object suitable for GeoParquet "crs".
 */

export function mapGeometryType(type) {
  switch ((type || '').toLowerCase()) {
    case 'esrigeometrypoint':
    case 'point':
      return 'Point';
    case 'esrigeometrymultipoint':
    case 'multipoint':
      return 'MultiPoint';
    case 'esrigeometrypolyline':
    case 'linestring':
    case 'multilinestring':
      return 'MultiLineString';
    case 'esrigeometrypolygon':
    case 'polygon':
    case 'multipolygon':
      return 'Polygon';
    default:
      return 'Unknown';
  }
}

export async function getProjJSONForEPSG(epsgCode) {
  // Prefer SpatialReference.org PROJJSON endpoint (recommended in PROJ docs)
  // Example format: https://spatialreference.org/ref/epsg/4326/projjson.json  :contentReference[oaicite:2]{index=2}
  const url = `https://spatialreference.org/ref/epsg/${epsgCode}/projjson.json`;

  const r = await fetch(url, { mode: "cors" });
  if (!r.ok) throw new Error(`Failed to fetch PROJJSON for EPSG:${epsgCode} (${r.status})`);
  const projjson = await r.json();

  // Basic sanity check: must look like PROJJSON CRS object
  if (!projjson || typeof projjson !== "object" || !projjson.type) {
    throw new Error(`Invalid PROJJSON returned for EPSG:${epsgCode}`);
  }
  return projjson;
}

export async function createGeoMetadata(spatialRef, geometryType) {
  const wkt = spatialRef?.wkt;
  const latestWkid = spatialRef?.latestWkid;
  const wkid = spatialRef?.wkid;

  // Decide EPSG code (ArcGIS sometimes reports wkid=102740 and latestWkid=2278)
  let epsg = null;
  if (Number.isFinite(latestWkid) && latestWkid < 100000) epsg = latestWkid;
  else if (Number.isFinite(wkid) && wkid < 100000) epsg = wkid;

  // Build geometry meta
  const geometryTypeLabel = mapGeometryType(geometryType);
  const geometryMeta = { encoding: "WKB" };

  if (geometryTypeLabel !== "Unknown") {
    geometryMeta.geometry_types = [geometryTypeLabel];
    if (geometryTypeLabel === "Polygon") geometryMeta.geometry_types.push("MultiPolygon");
    if (geometryTypeLabel === "MultiLineString") geometryMeta.geometry_types.push("LineString");
    if (geometryTypeLabel === "MultiPoint") geometryMeta.geometry_types.push("Point");
  } else {
    geometryMeta.geometry_types = [];
  }

  // ✅ CRS MUST be PROJJSON object (GeoParquet requirement) :contentReference[oaicite:3]{index=3}
  // Priority:
  //  1) If ArcGIS gave WKT, you *could* convert to PROJJSON, but in-browser that’s hard without PROJ.
  //  2) If we have EPSG, fetch PROJJSON and store it directly.
  if (epsg) {
    geometryMeta.crs = await getProjJSONForEPSG(epsg);
  } else if (wkt) {
    // Fallback: write as string (some readers accept strings as fallback),
    // but PROJJSON is preferred. (GeoArrow spec mentions string fallback for crs metadata.) :contentReference[oaicite:4]{index=4}
    geometryMeta.crs = wkt;
  }

  return {
    version: "1.1.0",
    primary_column: "geometry",
    columns: { geometry: geometryMeta },
  };
}
