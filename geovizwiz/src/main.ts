import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { Expression } from 'maplibre-gl';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';
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

const normAsIs = document.getElementById('norm-asis') as HTMLInputElement;
const normLand = document.getElementById('norm-land') as HTMLInputElement;
const normBldg = document.getElementById('norm-bldg') as HTMLInputElement;
const normLandUnitEl = document.getElementById('normLandUnit') as HTMLElement;
const normBldgUnitEl = document.getElementById('normBldgUnit') as HTMLElement;

const legendEl = document.getElementById('legend') as HTMLFieldSetElement;

const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
(document.getElementById('btn-persp') as HTMLButtonElement)?.addEventListener('click', () => setPerspective());
(document.getElementById('btn-ortho') as HTMLButtonElement)?.addEventListener('click', () => setOrtho());
viewButtons.forEach(btn => btn.onclick = () => setView(btn.dataset.view!));

/* sample & zoom buttons */
const btnSample = document.getElementById('btn-sample') as HTMLButtonElement;
const btnZoomTo = document.getElementById('btn-zoomto') as HTMLButtonElement;
btnSample.onclick = () => loadSampleHouston();
btnZoomTo.onclick = () => { if (currentGeoJSON) fitToData(currentGeoJSON); };

/* --- Modal 1 (chooser) + Modal 2 (size) + Loading --- */
const modalOverlay = document.getElementById('modalOverlay')!;
const sizeOverlay = document.getElementById('sizeOverlay')!;
const loadingOverlay = document.getElementById('loadingOverlay')!;

const rowCountEl = document.getElementById('rowCount')!;
const geomColEl = document.getElementById('geomCol')!;
const fieldListEl = document.getElementById('fieldList')!;

const btnAll = document.getElementById('btnAll') as HTMLButtonElement;
const btnNone = document.getElementById('btnNone') as HTMLButtonElement;
const btnCancelModal = document.getElementById('btnCancelModal') as HTMLButtonElement;
const btnConfirmModal = document.getElementById('btnConfirmModal') as HTMLButtonElement;

const bldgFieldSel = document.getElementById('bldgField') as HTMLSelectElement;
const bldgUnitSel = document.getElementById('bldgUnit') as HTMLSelectElement;
const landFieldSel = document.getElementById('landField') as HTMLSelectElement;
const landUnitSel = document.getElementById('landUnit') as HTMLSelectElement;
const btnSizeBack = document.getElementById('btnSizeBack') as HTMLButtonElement;
const btnSizeSkip = document.getElementById('btnSizeSkip') as HTMLButtonElement;
const btnSizeOk = document.getElementById('btnSizeOk') as HTMLButtonElement;

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

let normalizationMode: 'asis' | 'perLand' | 'perBuilding' = 'asis';

// staged loading
let lastFile: File | null = null;
let lastAsyncBuffer: AsyncBuffer | null = null;
let lastGeometryColumn: string | null = null;
let lastNumericFieldsFromSchema: string[] = [];
let chosenNumericFields: string[] = [];
let cancelRequested = false;

// size identification
let landSizeField: string | null = null;
let landSizeUnitLabel: string | null = null;
let bldgSizeField: string | null = null;
let bldgSizeUnitLabel: string | null = null;

/* ---------------- Preview helpers (rounding only; no sampling) ---------------- */
const COORD_DECIMALS = 6;
function roundGeometryInPlace(f: GeoJSON.Feature, decimals = COORD_DECIMALS) {
  const factor = Math.pow(10, decimals);
  const round = (n: number) => Math.round(n * factor) / factor;
  const walk = (coords: any) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') { coords[0] = round(coords[0]); coords[1] = round(coords[1]); }
    else for (const c of coords) walk(c);
  };
  if (f.geometry) walk((f.geometry as any).coordinates);
}
function trimPropertiesInPlace(features: GeoJSON.Feature[], keep: Set<string>) {
  for (const feat of features) {
    const p = (feat.properties ||= {});
    for (const k of Object.keys(p as any)) { if (!keep.has(k)) delete (p as any)[k]; }
  }
}

/* ---------------- File load: METADATA ONLY ---------------- */
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    lastFile = file;
    lastAsyncBuffer = fileToAsyncBuffer(file);

    const md = await parquetMetadataAsync(lastAsyncBuffer);
    const numRows = Number(md.num_rows ?? 0);

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

    // numeric top-level columns (not geometry)
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

    openFieldChooserModal({ rowCount: numRows, geometryCol: primaryGeom, numericFields: lastNumericFieldsFromSchema });
  } catch (err: any) {
    console.error('Metadata read failed:', err);
    alert(`Could not read Parquet metadata: ${err?.message ?? err}`);
  }
});

/* ---------------- Heuristics for "key fields" ---------------- */
function isKeyField(name: string) {
  const s = name.toLowerCase();
  const valueHits = /(_market_value|_impr_value|_land_value)\b/.test(s);
  const sizeTokens = /(sq_?ft|sqft|ft2|ft\^2|sq_?m|sqm|m2|m\^2|acres?|acre|hectares?|ha|km2|sqkm|mi2|sqmi)/;
  const sizeHits = s.includes('_area') && sizeTokens.test(s);
  return valueHits || sizeHits;
}

/* ---------------- Modal 1: chooser ---------------- */
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
    const key = opts.numericFields.filter(isKeyField);
    const other = opts.numericFields.filter(n => !isKeyField(n));

    if (key.length) {
      const t = document.createElement('div'); t.className = 'section-title'; t.textContent = 'Suggested key fields';
      fieldListEl.appendChild(t);
      const g = document.createElement('div'); g.className = 'fieldlist';
      for (const name of key) g.appendChild(makeFieldCheckbox(name, true));
      fieldListEl.appendChild(g);
      fieldListEl.appendChild(divider());
    }

    const t2 = document.createElement('div'); t2.className = 'section-title'; t2.textContent = 'Other numeric fields';
    fieldListEl.appendChild(t2);
    const g2 = document.createElement('div'); g2.className = 'fieldlist';
    for (const name of other) g2.appendChild(makeFieldCheckbox(name, false));
    fieldListEl.appendChild(g2);
  }

  btnAll.onclick = () => fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(c => (c.checked = true));
  btnNone.onclick = () => fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(c => (c.checked = false));
  btnCancelModal.onclick = () => { modalOverlay.classList.remove('show'); clearData(); };
  btnConfirmModal.onclick = () => {
    chosenNumericFields = Array.from(fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
      .filter(c => c.checked).map(c => c.name);
    if (chosenNumericFields.length === 0) { alert('Select at least one numeric field.'); return; }
    modalOverlay.classList.remove('show');
    openSizeModal(); // NEW: step 2
  };

  modalOverlay.classList.add('show');
}
function makeFieldCheckbox(name: string, checked: boolean) {
  const label = document.createElement('label');
  label.style.display = 'flex'; label.style.gap = '8px'; label.style.alignItems = 'center';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.name = name; cb.checked = checked;
  const span = document.createElement('span'); span.textContent = name;
  label.appendChild(cb); label.appendChild(span);
  return label;
}
function divider() { const d = document.createElement('div'); d.className = 'divider'; return d; }

/* ---------------- Modal 2: size identification ---------------- */
const AREA_UNIT_CHOICES: { key: string, label: string }[] = [
  { key: 'sqm', label: 'square meters (m²)' },
  { key: 'sqft', label: 'square feet (ft²)' },
  { key: 'acres', label: 'acres' },
  { key: 'hectares', label: 'hectares' },
  { key: 'sqkm', label: 'square kilometers (km²)' },
  { key: 'sqmi', label: 'square miles (mi²)' },
  { key: 'other', label: 'other / unknown' }
];
function fillUnitSelect(sel: HTMLSelectElement, preselectKey?: string) {
  sel.replaceChildren(new Option('— select unit —', ''));
  for (const u of AREA_UNIT_CHOICES) sel.appendChild(new Option(u.label, u.key));
  if (preselectKey) sel.value = preselectKey;
}
function fillFieldSelect(sel: HTMLSelectElement, fields: string[]) {
  sel.replaceChildren(new Option('— no selection —', ''));
  for (const f of fields) sel.appendChild(new Option(f, f));
}
function guessAreaUnitFromFieldName(name: string | null): string | null {
  if (!name) return null;
  const s = name.toLowerCase();
  if (/(sq_?ft|sqft|ft2|ft\^2|_sf\b)/.test(s)) return 'sqft';
  if (/(sq_?m|sqm|m2|m\^2|_m2\b)/.test(s)) return 'sqm';
  if (/(acres?|_acres?\b|_ac\b)/.test(s)) return 'acres';
  if (/(hectares?|_ha\b)/.test(s)) return 'hectares';
  if (/(km2|sqkm|_km2\b)/.test(s)) return 'sqkm';
  if (/(mi2|sqmi|_mi2\b)/.test(s)) return 'sqmi';
  return null;
}
function openSizeModal() {
  // options: only among the fields the user kept
  fillFieldSelect(bldgFieldSel, chosenNumericFields);
  fillFieldSelect(landFieldSel, chosenNumericFields);
  fillUnitSelect(bldgUnitSel);
  fillUnitSelect(landUnitSel);

  bldgFieldSel.onchange = () => {
    const g = guessAreaUnitFromFieldName(bldgFieldSel.value);
    if (g) bldgUnitSel.value = g;
  };
  landFieldSel.onchange = () => {
    const g = guessAreaUnitFromFieldName(landFieldSel.value);
    if (g) landUnitSel.value = g;
  };

  btnSizeBack.onclick = () => { sizeOverlay.classList.remove('show'); modalOverlay.classList.add('show'); };
  btnSizeSkip.onclick = () => { setSizeState(null, null, null, null); sizeOverlay.classList.remove('show'); loadSelectedColumns(); };
  btnSizeOk.onclick = () => {
    setSizeState(
      bldgFieldSel.value || null,
      valueToUnitLabel(bldgUnitSel.value || ''),
      landFieldSel.value || null,
      valueToUnitLabel(landUnitSel.value || '')
    );
    sizeOverlay.classList.remove('show');
    loadSelectedColumns();
  };

  sizeOverlay.classList.add('show');
}
function valueToUnitLabel(key: string): string | null {
  const item = AREA_UNIT_CHOICES.find(u => u.key === key);
  return item ? item.label : null;
}
function setSizeState(bField: string | null, bUnit: string | null, lField: string | null, lUnit: string | null) {
  bldgSizeField = bField || null;
  bldgSizeUnitLabel = bUnit || null;
  landSizeField = lField || null;
  landSizeUnitLabel = lUnit || null;
  // enable/disable normalization radios
  normLand.disabled = !landSizeField;
  normBldg.disabled = !bldgSizeField;
  normLandUnitEl.textContent = landSizeField ? (landSizeUnitLabel ?? '(unit)') : '(unit)';
  normBldgUnitEl.textContent = bldgSizeField ? (bldgSizeUnitLabel ?? '(unit)') : '(unit)';
}

/* ---------------- Loading overlay helpers ---------------- */
function showLoading(msg = 'Parsing GeoParquet…', determinate = false) {
  cancelRequested = false;
  progressMsg.textContent = msg;
  progressEl.classList.toggle('indeterminate', !determinate);
  progressBar.style.width = determinate ? '0%' : '30%';
  loadingOverlay.classList.add('show');
}
function hideLoading() { loadingOverlay.classList.remove('show'); }
(document.getElementById('btnCancelLoading') as HTMLButtonElement).onclick = () => {
  cancelRequested = true;
  hideLoading();
  clearData();
};

/* ---------------- Load selected columns (+ geometry) ---------------- */
async function loadSelectedColumns() {
  if (!lastAsyncBuffer || !lastFile) return;
  showLoading('Reading geometry + selected fields…');

  try {
    const result: any = await toGeoJson({ file: lastAsyncBuffer, compressors });
    if (cancelRequested) return;

    const fc: GeoJSON.FeatureCollection | undefined =
      result?.type === 'FeatureCollection' ? result : result?.geojson;
    if (!fc?.features) throw new Error('Parser returned no FeatureCollection.');

    let features = fc.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
    if (features.length === 0) throw new Error('No Polygon/MultiPolygon features found.');

    sanitizeFeaturesInPlace(features);

    const keep = new Set<string>(['id','ID','fid','FID','name','NAME', ...chosenNumericFields, bldgSizeField || '', landSizeField || '']);
    trimPropertiesInPlace(features, keep);

    for (const f of features) roundGeometryInPlace(f);

    if (cancelRequested) return;
    currentGeoJSON = { type: 'FeatureCollection', features };

    // dropdown = chosen numeric fields (ensure they exist)
    const available = chosenNumericFields.filter(k => features[0]?.properties?.hasOwnProperty(k));
    populateFieldDropdownFromList(available);

    // auto-select the first
    currentField = available[0] ?? null;
    if (currentField) {
      fieldSelect.value = currentField;
      currentStats = computeStatsNormalized(currentGeoJSON, currentField, normalizationMode);
    }

    addOrUpdateSource(currentGeoJSON);

    // auto-multiplier for current normalization mode → p99 = 2km (centimeters)
    computeAndApplyAutoMultiplier('auto', 1000, 100);

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

  // NEW: click to inspect
  map.on('click', LAYER_ID, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const props = (f.properties || {}) as Record<string, any>;
    showPopup(props, e.lngLat);
  });
  map.on('mouseenter', LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
}

function showPopup(props: Record<string, any>, lngLat: maplibregl.LngLatLike) {
  if (activePopup) activePopup.remove();
  activePopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: '460px'          // ← wider than default 240px
  })
    .setLngLat(lngLat)
    .setHTML(buildPopupHTML(props))
    .addTo(map);
  lastPicked = { props, lngLat };
}

/* --- value expression builder (handles normalization) --- */
function buildValueExpression(): Expression {
  if (!currentField) return ['literal', 0] as any;
  const base: Expression = ['to-number', ['get', currentField]] as any;

  if (normalizationMode === 'perLand' && landSizeField) {
    const d = ['max', 1e-12, ['to-number', ['get', landSizeField]]] as any;
    return ['/', base, d] as any;
  }
  if (normalizationMode === 'perBuilding' && bldgSizeField) {
    const d = ['max', 1e-12, ['to-number', ['get', bldgSizeField]]] as any;
    return ['/', base, d] as any;
  }
  return base;
}

function applyExtrusion() {
  if (!currentGeoJSON || !currentField || !currentStats) return;

  const { min, max } = currentStats;
  const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
  const valueExpr = buildValueExpression();

  const colorExpr = makeColorExpressionFromExpr(valueExpr, ramp, min, max);

  const rawMult = Number(multInput.value);
  const multiplier = Number.isFinite(rawMult) ? rawMult : 0; // 0 = flat extrusions
  const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
  const heightExpr: Expression = ['*', ['coalesce', ['to-number', valueExpr], 0], multiplier * unitFactor] as any;

  map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', heightExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  
  if (activePopup && lastPicked) {
    activePopup.setHTML(buildPopupHTML(lastPicked.props)).setLngLat(lastPicked.lngLat);
  }
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
      { type: 'Feature', properties: { name: 'Downtown', value: 80, assessed: 320, density: 60, bldg_area_sqft: 500000, land_area_sqft: 200000 }, geometry: { type: 'Polygon', coordinates: [rect(-95.3698, 29.7604, 0.020, 0.015)] } },
      { type: 'Feature', properties: { name: 'Midtown', value: 30, assessed: 120, density: 35, bldg_area_sqft: 200000, land_area_sqft: 150000 }, geometry: { type: 'Polygon', coordinates: [rect(-95.3750, 29.7350, 0.018, 0.014)] } },
      { type: 'Feature', properties: { name: 'Uptown/Galleria', value: 120, assessed: 480, density: 50, bldg_area_sqft: 800000, land_area_sqft: 300000 }, geometry: { type: 'Polygon', coordinates: [rect(-95.4620, 29.7400, 0.025, 0.018)] } }
    ]
  };
  currentGeoJSON = fc;

  // pretend user selected these
  chosenNumericFields = ['value','assessed','density','bldg_area_sqft','land_area_sqft'];
  populateFieldDropdownFromList(['value','assessed','density']);
  // also set size mapping
  setSizeState('bldg_area_sqft', 'square feet (ft²)', 'land_area_sqft', 'square feet (ft²)');

  currentField = 'value';
  fieldSelect.value = 'value';
  currentStats = computeStatsNormalized(fc, 'value', normalizationMode);

  computeAndApplyAutoMultiplier('auto', 1000, 100);
  addOrUpdateSource(fc); applyExtrusion(); updateLegend(); fitToData(fc);
}

/* ---------------- Helpers ---------------- */

// --- popup state ---
let activePopup: maplibregl.Popup | null = null;
let lastPicked: { props: Record<string, any>, lngLat: maplibregl.LngLatLike } | null = null;

// --- small number helpers ---
function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function fmt(n: any, digits = 2): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n ?? '—');
  if (Math.abs(x) >= 1) return x.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (x === 0) return '0';
  return x.toLocaleString(undefined, { maximumSignificantDigits: 3 });
}

function computeDisplayedMetricFromProps(props: Record<string, any>): number | null {
  if (!currentField) return null;
  let base = numOrNull(props[currentField]);
  if (base == null) return null;

  if (normalizationMode === 'perLand' && landSizeField) {
    const d = numOrNull(props[landSizeField]);
    if (d == null || d <= 0) return null;
    base = base / d;
  } else if (normalizationMode === 'perBuilding' && bldgSizeField) {
    const d = numOrNull(props[bldgSizeField]);
    if (d == null || d <= 0) return null;
    base = base / d;
  }
  return base;
}

function computeExtrusionHeightMeters(metricValue: number): number {
  const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
  const mult = Number(multInput.value);
  const multiplier = Number.isFinite(mult) ? mult : 0;
  return metricValue * multiplier * unitFactor;
}

type MetricUnitKey = 'centimeters' | 'meters' | 'kilometers';

function chooseBestMetricUnitForMultiplier(p99: number, capMeters = 1000): { unit: MetricUnitKey; multiplier: number } {
  const candidates: MetricUnitKey[] = ['centimeters', 'meters', 'kilometers'];
  const RANGE_MIN = 1, RANGE_MAX = 100;

  let best = { unit: 'centimeters' as MetricUnitKey, multiplier: Infinity, score: Infinity };

  for (const u of candidates) {
    const unitFactor = UNIT_TO_METERS[u]; // meters per unit
    const mult = capMeters / (unitFactor * p99);

    const inRange = mult >= RANGE_MIN && mult <= RANGE_MAX;
    const distToRange = inRange ? 0 : Math.min(Math.abs(mult - RANGE_MIN), Math.abs(mult - RANGE_MAX));
    const tieBias = Math.abs(Math.log10(Math.max(1e-12, mult)) - 1); // prefer closer to ~10 if inside

    // Primary: be inside [1,100]; Secondary: closer to the band; Tertiary: closer to 10 within the band
    const score = (inRange ? 0 : 1) * 1e6 + distToRange * 1e3 + (inRange ? tieBias : 0);

    if (score < best.score) best = { unit: u, multiplier: mult, score };
  }
  return { unit: best.unit, multiplier: best.multiplier };
}

function populateFieldDropdownFromList(list: string[]) {
  fieldSelect.replaceChildren();
  if (!list.length) fieldSelect.append(new Option('No numeric fields selected', ''));
  else {
    fieldSelect.append(new Option('— choose —', ''));
    for (const n of list) fieldSelect.append(new Option(n, n));
  }
}

function getNumericValuesNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding'): number[] {
  const vals: number[] = [];
  for (const f of fc.features) {
    const p = (f.properties as any) || {};
    let base = Number(p?.[field]);
    if (!Number.isFinite(base)) continue;

    if (mode === 'perLand' && landSizeField) {
      const d = Number(p?.[landSizeField]);
      if (!Number.isFinite(d) || d <= 0) continue;
      base = base / d;
    } else if (mode === 'perBuilding' && bldgSizeField) {
      const d = Number(p?.[bldgSizeField]);
      if (!Number.isFinite(d) || d <= 0) continue;
      base = base / d;
    }
    vals.push(base);
  }
  return vals;
}

function computeStatsNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding') {
  const vals = getNumericValuesNormalized(fc, field, mode);
  let min = Infinity, max = -Infinity;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) { min = 0; max = min + 1; }
  return { min, max };
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

/** Auto-multiplier so p-th percentile reaches capMeters, in given units */
function computeAndApplyAutoMultiplier(
  unitsKeyOrAuto: 'auto' | keyof typeof UNIT_TO_METERS = 'auto',
  capMeters = 1000,
  p = 99
) {
  if (!currentGeoJSON || !currentField) return;

  // pXX over the CURRENT normalization mode
  const vals = getNumericValuesNormalized(currentGeoJSON, currentField, normalizationMode);
  const pVal = percentile(vals, p);
  if (!Number.isFinite(pVal) || pVal <= 0) return;

  let unitKey: keyof typeof UNIT_TO_METERS;
  let multiplier: number;

  if (unitsKeyOrAuto === 'auto') {
    const best = chooseBestMetricUnitForMultiplier(pVal, capMeters);
    unitKey = best.unit;
    multiplier = best.multiplier;
  } else {
    unitKey = unitsKeyOrAuto;
    const unitFactor = UNIT_TO_METERS[unitKey];
    multiplier = capMeters / (unitFactor * pVal);
  }

  // apply chosen unit + multiplier
  unitsSelect.value = unitKey;
  multInput.value = String(multiplier);

  // recompute stats on the normalized distribution so the COLOR RAMP adapts
  currentStats = computeStatsNormalized(currentGeoJSON, currentField, normalizationMode);

  applyExtrusion();
}


function makeColorExpressionFromExpr(valueExpr: Expression, colors: string[], min: number, max: number): Expression {
  const n = colors.length - 1; const stops: (number | string)[] = [];
  for (let i = 0; i < colors.length; i++) { const t = i / n; stops.push(min + t * (max - min), colors[i]); }
  return ['interpolate', ['linear'], ['coalesce', ['to-number', valueExpr], min], ...stops] as any;
}

function makeColorExpression(field: string, colors: string[], min: number, max: number): Expression {
  // (kept for reference; not used now)
  const n = colors.length - 1; const stops: (number | string)[] = [];
  for (let i = 0; i < colors.length; i++) { const t = i / n; stops.push(min + t * (max - min), colors[i]); }
  return ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', field]], min], ...stops] as any;
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
    if (g.type === 'MultiPoint') (g.coordinates as any[]).forEach((c: number[]) => add(c[0], c[1]));
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

function buildPopupHTML(props: Record<string, any>): string {
  const title = props.name ?? props.NAME ?? props.id ?? props.ID ?? '';
  const metric = computeDisplayedMetricFromProps(props);
  const heightM = metric != null ? computeExtrusionHeightMeters(metric) : null;

  const unitKey = unitsSelect.value as keyof typeof UNIT_TO_METERS;
  const unitText = (unitsSelect.options[unitsSelect.selectedIndex]?.text || unitKey);

  const fieldsToShow = Array.from(new Set([
    ...chosenNumericFields,
    ...(landSizeField ? [landSizeField] : []),
    ...(bldgSizeField ? [bldgSizeField] : []),
  ]));

  const rows = fieldsToShow.map(k => {
    const v = (props as any)[k];
    const printable = (typeof v === 'number') ? fmt(v) : (v ?? '—');
    return `
      <tr>
        <td style="padding:2px 6px; overflow-wrap:anywhere;">
          <code style="white-space:normal;">${k}</code>
        </td>
        <td style="padding:2px 6px; text-align:right; white-space:nowrap;">
          ${printable}
        </td>
      </tr>`;
  }).join('');

  const modeLabel =
    normalizationMode === 'perLand' ? `per ${landSizeField || 'land size'}` :
    normalizationMode === 'perBuilding' ? `per ${bldgSizeField || 'building size'}` :
    'as-is';

  const metricRow = (metric != null)
    ? `<div><strong>Display metric (${modeLabel})</strong>: ${fmt(metric)}</div>`
    : `<div><strong>Display metric</strong>: —</div>`;

  const heightRow = (heightM != null)
    ? `<div><strong>Extrusion height</strong>: ${fmt(heightM / (UNIT_TO_METERS[unitKey] || 1))} ${unitText} (${fmt(heightM)} m)</div>`
    : `<div><strong>Extrusion height</strong>: —</div>`;

  return `
    <div class="gvw-pop" style="max-width:min(92vw, 460px); font-size:12.5px; line-height:1.35;">
      ${title ? `<div style="font-weight:600;margin-bottom:4px; overflow-wrap:anywhere;">${title}</div>` : ''}
      ${metricRow}
      ${heightRow}
      <div style="margin-top:6px; font-size:12px; color:#666">
        Multiplier × unit: ${fmt(Number(multInput.value))} × ${unitKey}
      </div>
      <div style="height:1px;background:#eee;margin:6px 0"></div>
      <div style="font-weight:600;margin-bottom:2px">Loaded fields</div>
      <div style="overflow:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:12px; table-layout:fixed;">
          <colgroup>
            <col span="1" style="width:65%">
            <col span="1" style="width:35%">
          </colgroup>
          ${rows}
        </table>
      </div>
    </div>`;
}

/* ---------------- Events ---------------- */
rampSelect.addEventListener('change', () => { applyExtrusion(); updateLegend(); });
function onMultInput() {
  const v = Number(multInput.value);
  if (!Number.isFinite(v)) return; // ignore invalid interim states
  applyExtrusion();
}
let raf = 0;
function scheduleApply() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(onMultInput);
}
multInput.addEventListener('input', scheduleApply);
multInput.addEventListener('change', onMultInput);

multInput.addEventListener('change', onMultInput);  // fallback on blur/enter
unitsSelect.addEventListener('change', () => { applyExtrusion(); });
opacityInput.addEventListener('input', () => { if (opacityOut) opacityOut.value = Number(opacityInput.value).toFixed(2); applyExtrusion(); });

fieldSelect.addEventListener('change', () => {
  currentField = fieldSelect.value || null;
  if (currentGeoJSON && currentField) {
    currentStats = computeStatsNormalized(currentGeoJSON, currentField, normalizationMode);
    computeAndApplyAutoMultiplier('auto', 1000, 100);
    updateLegend();
  }
});

document.querySelectorAll<HTMLInputElement>('input[name="normMode"]').forEach(r => {
  r.addEventListener('change', () => {
    normalizationMode = (document.querySelector('input[name="normMode"]:checked') as HTMLInputElement)?.value as any;
    if (!currentGeoJSON || !currentField) return;
    currentStats = computeStatsNormalized(currentGeoJSON, currentField, normalizationMode);
    computeAndApplyAutoMultiplier('auto', 1000, 100);
    updateLegend();
  });
});

// default height units
unitsSelect.value = 'centimeters';


