import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { Expression } from 'maplibre-gl';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';
// === NEW === read metadata/schema fast
import { parquetMetadataAsync, parquetSchema } from 'hyparquet';

/* ---------------- BigInt → JSON-safe ---------------- */
function coerceScalar(v: any): any {
  if (typeof v === 'bigint') {
    const big = v as bigint;
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    return (big <= max && big >= min) ? Number(big) : big.toString();
  }
  return v;
}
function sanitizeFeatureInPlace(f: GeoJSON.Feature) {
  if (typeof (f as any).id === 'bigint') (f as any).id = (f as any).id.toString();
  const p = (f.properties || {}) as Record<string, any>;
  for (const k in p) p[k] = coerceScalar(p[k]);
}
function sanitizeFeaturesInPlace(features: GeoJSON.Feature[]) {
  for (const f of features) sanitizeFeatureInPlace(f);
}

/* ---------------- AsyncBuffer from File ---------------- */
type AsyncBuffer = { byteLength: number; slice(start: number, end?: number): Promise<ArrayBuffer> };
function fileToAsyncBuffer(file: File): AsyncBuffer {
  return {
    byteLength: file.size,
    async slice(start, end) { return await file.slice(start, end ?? file.size).arrayBuffer(); }
  };
}

/* ---------------- Basemap: OSM raster ---------------- */
const OSM_STYLE: any = {
  version: 8,
  sources: { 'osm-tiles': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }]
};

/* ---------------- Map bootstrap ---------------- */
const map = new maplibregl.Map({
  container: 'map', style: OSM_STYLE, center: [-95.3698, 29.7604], zoom: 10, pitch: 45, bearing: -20, hash: true
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

const SOURCE_ID = 'gp-source';
const LAYER_ID = 'gp-extrusions';

/* ---------------- UI elements ---------------- */
const fileInput = document.getElementById('file') as HTMLInputElement;
const fieldSelect = document.getElementById('field') as HTMLSelectElement;
const rampSelect = document.getElementById('ramp') as HTMLSelectElement;
const multInput = document.getElementById('mult') as HTMLInputElement;
const unitsSelect = document.getElementById('units') as HTMLSelectElement;
const opacityInput = document.getElementById('opacity') as HTMLInputElement;
const opacityOut = document.getElementById('opacityVal') as HTMLOutputElement;

const legendEl = document.getElementById('legend') as HTMLFieldSetElement;

const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
(document.getElementById('btn-persp') as HTMLButtonElement).onclick = () => setPerspective();
(document.getElementById('btn-ortho') as HTMLButtonElement).onclick = () => setOrtho();
viewButtons.forEach(btn => btn.onclick = () => setView(btn.dataset.view!));

/* sample & zoom buttons */
const btnSample = document.getElementById('btn-sample') as HTMLButtonElement;
const btnZoomTo = document.getElementById('btn-zoomto') as HTMLButtonElement;
btnSample.onclick = () => loadSampleHouston();
btnZoomTo.onclick = () => { if (currentGeoJSON) fitToData(currentGeoJSON); };

/* === NEW === modal + loading elements */
const modalOverlay = document.getElementById('modalOverlay')!;
const loadingOverlay = document.getElementById('loadingOverlay')!;
const rowCountEl = document.getElementById('rowCount')!;
const geomColEl = document.getElementById('geomCol')!;
const fieldListEl = document.getElementById('fieldList')!;
const btnAll = document.getElementById('btnAll') as HTMLButtonElement;
const btnNone = document.getElementById('btnNone') as HTMLButtonElement;
const btnCancelModal = document.getElementById('btnCancelModal') as HTMLButtonElement;
const btnConfirmModal = document.getElementById('btnConfirmModal') as HTMLButtonElement;
const btnCancelLoading = document.getElementById('btnCancelLoading') as HTMLButtonElement;
const progressEl = document.getElementById('progress')!;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressMsg = document.getElementById('progressMsg') as HTMLDivElement;

/* ---------------- Color ramps ---------------- */
const COLOR_RAMPS: Record<string, string[]> = {
  Viridis: ['#440154','#46327E','#365C8D','#277F8E','#1FA187','#4AC16D','#A0DA39','#FDE725'],
  Magma: ['#000004','#1B0C41','#4F0A6D','#7A1E6C','#A52C60','#CF4446','#ED6925','#FB9F06','#F7D13D','#FCFDBF'],
  Plasma: ['#0D0887','#5B02A3','#9A179B','#CB4679','#ED7953','#FB9F3A','#F0F921'],
  Turbo: ['#30123B','#4145AB','#2CC0F0','#6AE4B4','#C6F86D','#F9DD32','#F28C21','#CB3E1F','#8A0D2C'],
  YlOrRd: ['#FFFFB2','#FECC5C','#FD8D3C','#F03B20','#BD0026'],
  Blues: ['#DEEBF7','#9ECAE1','#6BAED6','#3182BD','#08519C']
};
for (const key of Object.keys(COLOR_RAMPS)) {
  const opt = document.createElement('option'); opt.value = key; opt.textContent = key; rampSelect.appendChild(opt);
}
rampSelect.value = 'Viridis';

/* ---------------- State ---------------- */
let currentGeoJSON: GeoJSON.FeatureCollection | null = null;
let currentField: string | null = null;
let currentStats: { min: number; max: number } | null = null;

// === NEW === state for staged loading
let lastFile: File | null = null;
let lastAsyncBuffer: AsyncBuffer | null = null;
let lastGeometryColumn: string | null = null;
let lastNumericFieldsFromSchema: string[] = [];
let chosenNumericFields: string[] = [];
let cancelRequested = false;

/* ---------------- Preview-thinning knobs ---------------- */
const PREVIEW_MAX_FEATURES = 10000;
const MAX_KEEP_NUMERIC_FIELDS = 6;
const COORD_DECIMALS = 6;
function roundGeometryInPlace(f: GeoJSON.Feature, decimals = COORD_DECIMALS) {
  const factor = Math.pow(10, decimals);
  const round = (n: number) => Math.round(n * factor) / factor;
  const walk = (coords: any) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      coords[0] = round(coords[0]); coords[1] = round(coords[1]);
      if (coords.length > 2 && typeof coords[2] === 'number') coords[2] = Math.round(coords[2]);
    } else for (const c of coords) walk(c);
  };
  if (f.geometry) walk((f.geometry as any).coordinates);
}
function trimPropertiesInPlace(features: GeoJSON.Feature[], keep: Set<string>) {
  for (const feat of features) {
    const p = (feat.properties ||= {});
    for (const k of Object.keys(p as any)) { if (!keep.has(k)) delete (p as any)[k]; }
  }
}
function sampleFeatures(features: GeoJSON.Feature[], max: number) {
  if (features.length <= max) return features;
  const step = Math.ceil(features.length / max);
  const out: GeoJSON.Feature[] = [];
  for (let i = 0; i < features.length; i += step) out.push(features[i]);
  return out;
}

/* ---------------- File load: METADATA ONLY ---------------- */
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    lastFile = file;
    lastAsyncBuffer = fileToAsyncBuffer(file);

    // read parquet metadata fast
    const md = await parquetMetadataAsync(lastAsyncBuffer);
    const numRows = Number(md.num_rows ?? 0);

    // parse GeoParquet 'geo' metadata to find primary geometry col (best effort)
    const kv = (md as any).key_value_metadata || (md as any).keyValueMetadata || [];
    const geoKV = kv.find((e: any) => String(e.key).toLowerCase() === 'geo');
    let primaryGeom = 'geometry';
    try {
      if (geoKV?.value) {
        const parsed = JSON.parse(geoKV.value);
        if (parsed?.primary_column) primaryGeom = parsed.primary_column;
      }
    } catch {}

    lastGeometryColumn = primaryGeom;

    // schema → list numeric columns (top-level, not geometry)
    const schemaTree: any = parquetSchema(md);
    const top = Array.isArray(schemaTree?.children) ? schemaTree.children : [];
    const numeric: string[] = [];
    for (const node of top) {
      const name = node?.element?.name ?? node?.name;
      if (!name || name === primaryGeom) continue;
      const el = node.element ?? {};
      const typeStr = String(el.type?.type ?? el.type ?? el.physicalType ?? el.primitiveType ?? '');
      const logical = String(el.logicalType?.type ?? el.logicalType ?? el.convertedType ?? '');
      const isNumeric =
        ['DOUBLE','FLOAT','INT32','INT64','INT16','INT8'].includes(typeStr.toUpperCase()) ||
        logical.toUpperCase() === 'DECIMAL';
      if (isNumeric) numeric.push(name);
    }
    lastNumericFieldsFromSchema = numeric.sort();

    // show modal
    openFieldChooserModal({ rowCount: numRows, geometryCol: primaryGeom, numericFields: lastNumericFieldsFromSchema });
  } catch (err: any) {
    console.error('Metadata read failed:', err);
    alert(`Could not read Parquet metadata: ${err?.message ?? err}`);
  }
});

/* ---------------- Modal controls ---------------- */
function openFieldChooserModal(opts: { rowCount: number; geometryCol: string; numericFields: string[] }) {
  rowCountEl.textContent = opts.rowCount.toLocaleString();
  geomColEl.textContent = opts.geometryCol || '(unknown)';
  fieldListEl.replaceChildren();

  if (opts.numericFields.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No obvious numeric fields were found in the schema.';
    p.className = 'muted';
    fieldListEl.appendChild(p);
  } else {
    for (const name of opts.numericFields) {
      const id = `fld_${name}`;
      const label = document.createElement('label');
      label.style.display = 'flex'; label.style.gap = '8px'; label.style.alignItems = 'center';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = id; cb.name = name; cb.checked = true;
      const span = document.createElement('span'); span.textContent = name;
      label.appendChild(cb); label.appendChild(span);
      fieldListEl.appendChild(label);
    }
  }

  btnAll.onclick = () => fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(c => c.checked = true);
  btnNone.onclick = () => fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(c => c.checked = false);
  btnCancelModal.onclick = () => { modalOverlay.classList.remove('show'); clearData(); };
  btnConfirmModal.onclick = async () => {
    chosenNumericFields = Array.from(fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
      .filter(c => c.checked).map(c => c.name);
    modalOverlay.classList.remove('show');
    await loadSelectedColumns();
  };

  modalOverlay.classList.add('show');
}

/* ---------------- Loading overlay helpers ---------------- */
function showLoading(msg = 'Parsing GeoParquet…', determinate = false) {
  cancelRequested = false;
  progressMsg.textContent = msg;
  progressEl.classList.toggle('indeterminate', !determinate);
  progressBar.style.width = determinate ? '0%' : '30%';
  loadingOverlay.classList.add('show');
}
function setProgress(pct: number, msg?: string) {
  progressEl.classList.remove('indeterminate');
  progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (msg) progressMsg.textContent = msg;
}
function hideLoading() { loadingOverlay.classList.remove('show'); }
btnCancelLoading.onclick = () => {
  cancelRequested = true;
  hideLoading();
  clearData();
};

/* ---------------- Load selected columns (+ geometry) ---------------- */
async function loadSelectedColumns() {
  if (!lastAsyncBuffer || !lastFile) return;
  // NOTE: We still use geoparquet.toGeoJson to decode geometry robustly.
  // We then trim to the chosen fields BEFORE sending to the MapLibre worker.
  showLoading('Reading geometry + selected fields…');

  try {
    const result: any = await toGeoJson({ file: lastAsyncBuffer, compressors });
    if (cancelRequested) return;

    const fc: GeoJSON.FeatureCollection | undefined =
      result?.type === 'FeatureCollection' ? result : result?.geojson;
    if (!fc?.features) throw new Error('Parser returned no FeatureCollection.');

    // polygons only for extrusion
    let features = fc.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
    if (features.length === 0) throw new Error('No Polygon/MultiPolygon features found.');

    // sanitize BigInts to avoid JSON stringify errors
    sanitizeFeaturesInPlace(features);

    // keep only selected numeric props (+ a few common ids)
    const keep = new Set<string>(['id','ID','fid','FID','name','NAME', ...chosenNumericFields]);
    trimPropertiesInPlace(features, keep);

    // round coords to shrink payload; optionally sample very large sets
    for (const f of features) roundGeometryInPlace(f);
    const originalCount = features.length;
    //if (features.length > PREVIEW_MAX_FEATURES) {
    //  features = sampleFeatures(features, PREVIEW_MAX_FEATURES);
    //  console.warn(`Preview mode: showing ${features.length} of ${originalCount} features`);
    //}

    // update map (unless cancelled)
    if (cancelRequested) return;
    currentGeoJSON = { type: 'FeatureCollection', features };

	// dropdown = chosen numeric fields (ensure they still exist)
	const available = chosenNumericFields.filter(k => features[0]?.properties?.hasOwnProperty(k));
	populateFieldDropdownFromList(available);

	// auto-select the first available numeric field
	currentField = available[0] ?? null;
	if (currentField) {
	  fieldSelect.value = currentField;
	  currentStats = computeStats(currentGeoJSON, currentField);
	}

	// update source before computing multiplier/extrusion
	addOrUpdateSource(currentGeoJSON);

	// auto-set multiplier so p99 = 2 km, in centimeters
	computeAndApplyAutoMultiplier('centimeters', 2000, 99);

	updateLegend();
	fitToData(currentGeoJSON);
  } catch (err: any) {
    console.error('GeoParquet load failed:', err);
    if (!cancelRequested) alert(`GeoParquet load failed: ${err?.message ?? err}`);
  } finally {
    hideLoading();
  }
}

/* ---------------- Map helpers ---------------- */
function clearData() {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  currentGeoJSON = null; currentField = null; currentStats = null;
  fieldSelect.replaceChildren(new Option('— load a file first —', ''));
  updateLegend();
}
function addOrUpdateSource(fc: GeoJSON.FeatureCollection) {
  const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) existing.setData(fc);
  else { map.addSource(SOURCE_ID, { type: 'geojson', data: fc }); addExtrusionLayer(); }
}
function addExtrusionLayer() {
  if (map.getLayer(LAYER_ID)) return;
  map.addLayer({
    id: LAYER_ID, type: 'fill-extrusion', source: SOURCE_ID,
    paint: {
      'fill-extrusion-color': '#888',
      'fill-extrusion-height': 0,
      'fill-extrusion-opacity': parseFloat(opacityInput.value),
      'fill-extrusion-vertical-gradient': true
    }
  });
}
function applyExtrusion() {
  if (!currentGeoJSON || !currentField || !currentStats) return;
  const { min, max } = currentStats;
  const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
  const colorExpr = makeColorExpression(currentField, ramp, min, max);
  const multiplier = parseFloat(multInput.value || '1');
  const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
  const heightExpr: Expression = ['*', ['coalesce', ['to-number', ['get', currentField]], 0], multiplier * unitFactor];
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', heightExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
}
function fitToData(fc: GeoJSON.FeatureCollection) {
  const b = bbox(fc); if (!b) return;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 800 });
}

/* ---------------- Camera presets ---------------- */
function setPerspective() { map.easeTo({ pitch: 60, duration: 600 }); }
function setOrtho() { map.easeTo({ pitch: 0, duration: 600 }); }
function setView(which: string) {
  const views: Record<string, Partial<maplibregl.CameraOptions>> = {
    top: { pitch: 0, bearing: 0 }, iso: { pitch: 60, bearing: -30 },
    north: { pitch: 60, bearing: 0 }, east: { pitch: 60, bearing: 90 },
    south: { pitch: 60, bearing: 180 }, west: { pitch: 60, bearing: 270 }
  };
  map.easeTo({ duration: 700, ...(views[which] || views.iso) });
}

/* ---------------- Units ---------------- */
const UNIT_TO_METERS = {
  centimeters: 0.01,
  meters: 1,
  inches: 0.0254,
  feet: 0.3048,
  kilometers: 1000,
  miles: 1609.344,
  stories: 3.3
};

/* ---------------- Sample (Houston) ---------------- */
function loadSampleHouston() {
  const rect = (lon: number, lat: number, dx: number, dy: number) => ([
    [lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]
  ]);
  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Downtown', value: 80, assessed: 320, density: 60 }, geometry: { type: 'Polygon', coordinates: [rect(-95.3698, 29.7604, 0.020, 0.015)] } },
      { type: 'Feature', properties: { name: 'Midtown', value: 30, assessed: 120, density: 35 }, geometry: { type: 'Polygon', coordinates: [rect(-95.3750, 29.7350, 0.018, 0.014)] } },
      { type: 'Feature', properties: { name: 'Uptown/Galleria', value: 120, assessed: 480, density: 50 }, geometry: { type: 'Polygon', coordinates: [rect(-95.4620, 29.7400, 0.025, 0.018)] } }
    ]
  };
  currentGeoJSON = fc;
  populateFieldDropdownFromList(['value','assessed','density']);
  currentField = 'value'; currentStats = computeStats(fc, 'value');
  computeAndApplyAutoMultiplier('centimeters', 2000, 99);
  addOrUpdateSource(fc); applyExtrusion(); updateLegend(); fitToData(fc);
}

/* ---------------- Helpers ---------------- */

// --- numeric extraction + percentile ---
function getNumericValues(fc: GeoJSON.FeatureCollection, field: string): number[] {
  const vals: number[] = [];
  for (const f of fc.features) {
    const raw = (f.properties as any)?.[field];
    const v = typeof raw === 'bigint' ? Number(raw) : Number(raw);
    if (Number.isFinite(v)) vals.push(v);
  }
  return vals;
}

function percentile(vals: number[], p: number): number {
  if (!vals.length) return NaN;
  const a = vals.slice().sort((x, y) => x - y);
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const t = idx - lo;
  return a[lo] + (a[hi] - a[lo]) * t;
}

/**
 * Compute multiplier so that p-th percentile reaches capMeters tall,
 * using the chosen units (centimeters by default).
 */
function computeAndApplyAutoMultiplier(
  unitsKey: keyof typeof UNIT_TO_METERS = 'centimeters',
  capMeters = 2000,
  p = 99
) {
  if (!currentGeoJSON || !currentField) return;
  const vals = getNumericValues(currentGeoJSON, currentField);
  const pVal = percentile(vals, p);
  if (!Number.isFinite(pVal) || pVal <= 0) return;

  unitsSelect.value = unitsKey; // set units to centimeters
  const unitFactor = UNIT_TO_METERS[unitsKey]; // meters per "unit" (cm = 0.01)
  const multiplier = capMeters / (unitFactor * pVal); // value * multiplier * unitFactor = capMeters

  // set the input (keep full precision; user can tweak later)
  multInput.value = String(multiplier);
  applyExtrusion();
}

function populateFieldDropdownFromList(list: string[]) {
  fieldSelect.replaceChildren();
  if (!list.length) fieldSelect.append(new Option('No numeric fields selected', ''));
  else {
    fieldSelect.append(new Option('— choose —', ''));
    for (const n of list) fieldSelect.append(new Option(n, n));
  }
}
function computeStats(fc: GeoJSON.FeatureCollection, field: string) {
  let min = Infinity, max = -Infinity;
  for (const f of fc.features) {
    const raw = (f.properties as any)?.[field];
    const v = typeof raw === 'bigint' ? Number(raw) : Number(raw);
    if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) { min = 0; max = min + 1; }
  return { min, max };
}
function makeColorExpression(field: string, colors: string[], min: number, max: number): Expression {
  const n = colors.length - 1; const stops: (number | string)[] = [];
  for (let i = 0; i < colors.length; i++) { const t = i / n; stops.push(min + t * (max - min), colors[i]); }
  return ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', field]], min], ...stops] as unknown as Expression;
}
function bbox(fc: GeoJSON.FeatureCollection): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  const walk = (coords: any) => Array.isArray(coords[0]) ? coords.forEach(walk) : add(coords[0], coords[1]);
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const g = f.geometry;
    if (g.type === 'Polygon' || g.type === 'MultiPolygon' || g.type === 'LineString' || g.type === 'MultiLineString') walk(g.coordinates);
    if (g.type === 'Point') add(g.coordinates[0], g.coordinates[1]);
    if (g.type === 'MultiPoint') g.coordinates.forEach((c: number[]) => add(c[0], c[1]));
  }
  return (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) ? [minX, minY, maxX, maxY] : null;
}
function updateLegend() {
  const ramp = COLOR_RAMPS[rampSelect.value] || []; legendEl.replaceChildren();
  if (ramp.length && currentStats) {
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.gap = '6px'; row.style.alignItems = 'center'; row.style.flexWrap = 'wrap';
    const label = document.createElement('div'); label.textContent = 'Legend:'; label.style.fontSize = '12px';
    row.appendChild(label);
    ramp.forEach(c => { const s = document.createElement('div'); s.className = 'swatch'; (s as any).style = `background:${c}`; row.appendChild(s); });
    const range = document.createElement('div'); range.className = 'muted';
    range.textContent = `min ${currentStats.min.toLocaleString()} → max ${currentStats.max.toLocaleString()}`;
    row.appendChild(range);
    legendEl.appendChild(row);
    legendEl.style.display = 'grid';
  } else legendEl.style.display = 'none';
}

/* ---------------- Events ---------------- */
rampSelect.addEventListener('change', () => { applyExtrusion(); updateLegend(); });
multInput.addEventListener('change', applyExtrusion);
unitsSelect.addEventListener('change', applyExtrusion);
opacityInput.addEventListener('input', () => { if (opacityOut) opacityOut.value = Number(opacityInput.value).toFixed(2); applyExtrusion(); });
fieldSelect.addEventListener('change', () => {
  currentField = fieldSelect.value || null;
  if (currentGeoJSON && currentField) {
    currentStats = computeStats(currentGeoJSON, currentField);
    // auto-set multiplier again for the newly selected field
    computeAndApplyAutoMultiplier('centimeters', 2000, 99);
    updateLegend();
  }
});
unitsSelect.value = 'centimeters';