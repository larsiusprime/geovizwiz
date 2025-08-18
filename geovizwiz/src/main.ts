import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { Expression } from 'maplibre-gl';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';

// Coerce BigInt → number when safe, else → string
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
  // id
  if (typeof (f as any).id === 'bigint') (f as any).id = (f as any).id.toString();
  // properties
  const p = (f.properties || {}) as Record<string, any>;
  for (const k in p) p[k] = coerceScalar(p[k]);
}

function sanitizeFeaturesInPlace(features: GeoJSON.Feature[]) {
  for (const f of features) sanitizeFeatureInPlace(f);
}

// Browser AsyncBuffer wrapper for a File/Blob
type AsyncBuffer = {
  byteLength: number;
  slice(start: number, end?: number): Promise<ArrayBuffer>;
};

function fileToAsyncBuffer(file: File): AsyncBuffer {
  return {
    byteLength: file.size,
    async slice(start: number, end?: number) {
      const blob = file.slice(start, end ?? file.size);
      return await blob.arrayBuffer(); // MUST return ArrayBuffer
    }
  };
}

/** ---------- Basemap: OpenStreetMap raster style (good for local dev) ----------
 * Note: OSM tiles are community-run; for production, use a commercial/free tile host
 * (Stadia Maps, MapTiler, CARTO, Thunderforest, etc.) with an API key and your own usage plan.
 */
const OSM_STYLE: any = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [
    { id: 'osm-tiles', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

/** ---------- Map bootstrap ---------- */
const map = new maplibregl.Map({
  container: 'map',
  style: OSM_STYLE,
  center: [-95.3698, 29.7604], // Houston, TX
  zoom: 10,
  pitch: 45,
  bearing: -20,
  hash: true
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

const SOURCE_ID = 'gp-source';
const LAYER_ID = 'gp-extrusions';

/** ---------- UI wiring ---------- */
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

/** New buttons */
const btnSample = document.getElementById('btn-sample') as HTMLButtonElement;
const btnZoomTo = document.getElementById('btn-zoomto') as HTMLButtonElement;
btnSample.onclick = () => loadSampleHouston();
btnZoomTo.onclick = () => { if (currentGeoJSON) fitToData(currentGeoJSON); };

/** ---------- Color ramps (hard-coded choices) ---------- */
const COLOR_RAMPS: Record<string, string[]> = {
  Viridis: ['#440154','#46327E','#365C8D','#277F8E','#1FA187','#4AC16D','#A0DA39','#FDE725'],
  Magma: ['#000004','#1B0C41','#4F0A6D','#7A1E6C','#A52C60','#CF4446','#ED6925','#FB9F06','#F7D13D','#FCFDBF'],
  Plasma: ['#0D0887','#5B02A3','#9A179B','#CB4679','#ED7953','#FB9F3A','#F0F921'],
  Turbo: ['#30123B','#4145AB','#2CC0F0','#6AE4B4','#C6F86D','#F9DD32','#F28C21','#CB3E1F','#8A0D2C'],
  YlOrRd: ['#FFFFB2','#FECC5C','#FD8D3C','#F03B20','#BD0026'],
  Blues: ['#DEEBF7','#9ECAE1','#6BAED6','#3182BD','#08519C']
};
for (const key of Object.keys(COLOR_RAMPS)) {
  const opt = document.createElement('option');
  opt.value = key; opt.textContent = key;
  rampSelect.appendChild(opt);
}
rampSelect.value = 'Viridis';

/** ---------- State ---------- */
let currentGeoJSON: GeoJSON.FeatureCollection | null = null;
let currentField: string | null = null;
let currentStats: { min: number; max: number } | null = null;

/** ---------- File load (GeoParquet -> GeoJSON) ---------- */
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
	const gpBuffer = fileToAsyncBuffer(file);
    // ⬇️ await: toGeoJson is async in your build
	const result: any = await toGeoJson({ file: gpBuffer, compressors });

    // Handle both return shapes:
    //  - FeatureCollection directly
    //  - { geojson: FeatureCollection, ... }
    const fc: GeoJSON.FeatureCollection | undefined =
      result?.type === 'FeatureCollection' ? result : result?.geojson;

    if (!fc?.features) {
      throw new Error('Parser returned no FeatureCollection. Is this a valid GeoParquet with geometry metadata?');
    }

    // (Optional) If your file isn’t polygons, extrusion won’t show anything
    const features = fc.features.filter(
      f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );
	
	if (features.length === 0) {
      throw new Error('No Polygon/MultiPolygon features found. Load polygons for extrusion, or remove the polygon-only filter.');
    }
	
	sanitizeFeaturesInPlace(features);
	
    currentGeoJSON = { type: 'FeatureCollection', features };
    populateFieldDropdown(features);
    addOrUpdateSource(currentGeoJSON);
    fitToData(currentGeoJSON);
    legendEl.style.display = 'none';
  } catch (err: any) {
    console.error('GeoParquet load failed:', err);
    alert(`GeoParquet load failed: ${err?.message ?? err}`);
  }
});



fieldSelect.addEventListener('change', () => {
  currentField = fieldSelect.value || null;
  if (currentGeoJSON && currentField) {
    currentStats = computeStats(currentGeoJSON, currentField);
    applyExtrusion();
    updateLegend();
  }
});
rampSelect.addEventListener('change', () => { applyExtrusion(); updateLegend(); });
multInput.addEventListener('change', applyExtrusion);
unitsSelect.addEventListener('change', applyExtrusion);
opacityInput.addEventListener('input', () => { 
  if (opacityOut) opacityOut.value = Number(opacityInput.value).toFixed(2);
  applyExtrusion();
});

/** ---------- Map helpers ---------- */
function addOrUpdateSource(fc: GeoJSON.FeatureCollection) {
  const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) existing.setData(fc);
  else {
    map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
    addExtrusionLayer();
  }
}

function addExtrusionLayer() {
  if (map.getLayer(LAYER_ID)) return;
  map.addLayer({
    id: LAYER_ID,
    type: 'fill-extrusion',
    source: SOURCE_ID,
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
  const heightExpr: Expression = [
    '*',
    ['coalesce', ['to-number', ['get', currentField]], 0],
    multiplier * unitFactor
  ];

  map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', heightExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
}

function fitToData(fc: GeoJSON.FeatureCollection) {
  const b = bbox(fc);
  if (!b) return;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 800 });
}

/** ---------- Camera presets ---------- */
function setPerspective() { map.easeTo({ pitch: 60, duration: 600 }); }
function setOrtho() { map.easeTo({ pitch: 0, duration: 600 }); }
function setView(which: string) {
  const views: Record<string, Partial<maplibregl.CameraOptions>> = {
    top: { pitch: 0, bearing: 0 },
    iso: { pitch: 60, bearing: -30 },
    north: { pitch: 60, bearing: 0 },
    east: { pitch: 60, bearing: 90 },
    south: { pitch: 60, bearing: 180 },
    west: { pitch: 60, bearing: 270 }
  };
  const opts = views[which] || views.iso;
  map.easeTo({ duration: 700, ...opts });
}

/** ---------- Units ---------- */
const UNIT_TO_METERS = {
  meters: 1,
  feet: 0.3048,
  kilometers: 1000,
  miles: 1609.344,
  stories: 3.3
};

/** ---------- Sample data (Houston) ---------- */
function loadSampleHouston() {
  // Three small rectangles around Houston with multiple numeric fields
  const rect = (lon: number, lat: number, dx: number, dy: number) => ([
    [lon - dx, lat - dy],
    [lon + dx, lat - dy],
    [lon + dx, lat + dy],
    [lon - dx, lat + dy],
    [lon - dx, lat - dy]
  ]);

  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Downtown', value: 80, assessed: 320, density: 60 },
        geometry: { type: 'Polygon', coordinates: [rect(-95.3698, 29.7604, 0.020, 0.015)] }
      },
      {
        type: 'Feature',
        properties: { name: 'Midtown', value: 30, assessed: 120, density: 35 },
        geometry: { type: 'Polygon', coordinates: [rect(-95.3750, 29.7350, 0.018, 0.014)] }
      },
      {
        type: 'Feature',
        properties: { name: 'Uptown/Galleria', value: 120, assessed: 480, density: 50 },
        geometry: { type: 'Polygon', coordinates: [rect(-95.4620, 29.7400, 0.025, 0.018)] }
      }
    ]
  };

  currentGeoJSON = fc;
  populateFieldDropdown(fc.features);

  // Default to the "value" field if present
  if ([...fieldSelect.options].some(o => o.value === 'value')) {
    fieldSelect.value = 'value';
    currentField = 'value';
  } else {
    currentField = fieldSelect.value || null;
  }

  if (currentField) currentStats = computeStats(fc, currentField);

  addOrUpdateSource(fc);
  applyExtrusion();
  updateLegend();
  fitToData(fc);
}

/** ---------- Helpers ---------- */
function populateFieldDropdown(features: GeoJSON.Feature[]) {
  const numeric = detectNumericFields(features);
  fieldSelect.replaceChildren();
  if (numeric.length === 0) {
    fieldSelect.append(new Option('No numeric fields found', ''));
  } else {
    fieldSelect.append(new Option('— choose —', ''));
    numeric.forEach(n => fieldSelect.append(new Option(n, n)));
  }
}

function detectNumericFields(features: GeoJSON.Feature[]): string[] {
  const counts: Record<string, number> = {};
  const nums: Record<string, number> = {};

  const isNumLike = (v: any) =>
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

  for (const f of features) {
    const p = (f.properties || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      counts[k] = (counts[k] ?? 0) + 1;
      if (isNumLike(v)) nums[k] = (nums[k] ?? 0) + 1;
    }
  }
  const fieldIsNumeric = (k: string) => {
    const c = counts[k] || 0, n = nums[k] || 0;
    const need = Math.max(1, Math.ceil(0.6 * c)); // ≥60% numeric
    return n >= need;
  };
  return Object.keys(counts).filter(fieldIsNumeric).sort();
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
  const n = colors.length - 1;
  const stops: (number | string)[] = [];
  for (let i = 0; i < colors.length; i++) {
    const t = i / n;
    stops.push(min + t * (max - min), colors[i]);
  }
  return [
    'interpolate', ['linear'],
    ['coalesce', ['to-number', ['get', field]], min],
    ...stops
  ] as unknown as Expression;
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
  return (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY))
    ? [minX, minY, maxX, maxY] : null;
}

function updateLegend() {
  const ramp = COLOR_RAMPS[rampSelect.value] || [];
  legendEl.replaceChildren();
  if (ramp.length && currentStats) {
    const row = document.createElement('div');
    row.id = 'legend-row';
    row.style.display = 'flex'; row.style.gap = '6px'; row.style.alignItems = 'center'; row.style.flexWrap = 'wrap';
    const label = document.createElement('div'); label.textContent = 'Legend:'; label.style.fontSize = '12px';
    row.appendChild(label);
    ramp.forEach(c => { const s = document.createElement('div'); s.className = 'swatch'; s.style.background = c; row.appendChild(s); });
    const range = document.createElement('div');
    range.className = 'muted';
    range.textContent = `min ${currentStats.min.toLocaleString()} → max ${currentStats.max.toLocaleString()}`;
    row.appendChild(range);
    legendEl.appendChild(row);
    legendEl.style.display = 'grid';
  } else {
    legendEl.style.display = 'none';
  }
}
