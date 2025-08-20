import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import type { Expression } from 'maplibre-gl';
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
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return v;

    // Handle (123) as -123, strip $ and thousands separators
    const negMatch = s.match(/^\(([^)]+)\)$/);
    const core = (negMatch ? negMatch[1] : s)
      .replace(/[$,\s]/g, ''); // "$12,345.67" -> "12345.67"

    const n = Number(core);
    if (Number.isFinite(n)) return negMatch ? -n : n;

    return v; // leave other strings as-is
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
const HQ_PR = Math.min(3, window.devicePixelRatio * 2); // 2–3 is a good “HQ” target

const map = new maplibregl.Map({
  container: 'map',
  style: OSM_STYLE,
  center: [-95.3698, 29.7604],
  zoom: 10,
  pitch: 45,
  bearing: -20,
  hash: true,

  // supersample: render at higher internal resolution
  pixelRatio: HQ_PR
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

const SOURCE_ID = 'gp-source';
const LAYER_ID = 'gp-extrusions';
const ERROR_LAYER_ID = 'gp-error';

// Robust autoscale defaults
const HEIGHT_CAP_METERS = 1000;  // target height for pctl feature
const HEIGHT_PCTL = 99;          // use p99 (not 100=max)

/* ---------------- UI elements ---------------- */
const fileInput = document.getElementById('file') as HTMLInputElement;
const fieldSelect = document.getElementById('field') as HTMLSelectElement;
const rampSelect = document.getElementById('ramp') as HTMLSelectElement;
const multInput = document.getElementById('mult') as HTMLInputElement;
const unitsSelect = document.getElementById('units') as HTMLSelectElement;
const opacityInput = document.getElementById('opacity') as HTMLInputElement;
const opacityOut = document.getElementById('opacityVal') as HTMLOutputElement;

const normLand = document.getElementById('norm-land') as HTMLInputElement;
const normBldg = document.getElementById('norm-bldg') as HTMLInputElement;
const normLandUnitEl = document.getElementById('normLandUnit') as HTMLElement;
const normBldgUnitEl = document.getElementById('normBldgUnit') as HTMLElement;

const legendEl = document.getElementById('legend') as HTMLFieldSetElement;
const controlsEl = document.getElementById('controls') as HTMLDivElement;

// ---- Quality toggle button ----
const btnQuality = document.createElement('button');
btnQuality.id = 'btn-quality';
btnQuality.textContent = 'Quality: Fast';
btnQuality.style.cssText = 'border:1px solid #ddd;background:#f8f8f8;padding:6px 8px;border-radius:8px;cursor:pointer;';

// put it at the top of the controls (or anywhere you like)
controlsEl.prepend(btnQuality);

// click to toggle
btnQuality.onclick = () => setQuality(qualityMode === 'high' ? 'fast' : 'high');

// (Optional) expose for devtools: window.quality('high'|'fast')
(window as any).quality = setQuality;


const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
(document.getElementById('btn-persp') as HTMLButtonElement)?.addEventListener('click', () => setPerspective());
(document.getElementById('btn-ortho') as HTMLButtonElement)?.addEventListener('click', () => setOrtho());
viewButtons.forEach(btn => btn.onclick = () => setView(btn.dataset.view!));

/* zoom button */
const btnZoomTo = document.getElementById('btn-zoomto') as HTMLButtonElement;
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

// ---- Color scaling radios (section 6) ----
const colorCont = document.getElementById('color-cont') as HTMLInputElement | null;
const colorQuant = document.getElementById('color-quant') as HTMLInputElement | null;

// Only recompute after data is loaded
[colorCont, colorQuant].forEach(el =>
  el?.addEventListener('change', () => {
    if (!currentGeoJSON) return;
    const val = (document.querySelector('input[name="colorMode"]:checked') as HTMLInputElement)?.value;
    if (val === 'continuous' || val === 'quantiles') {
      colorMode = val;
      scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
    }
  })
);

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
type ColorMode = 'continuous' | 'quantiles';
let colorMode: ColorMode = 'quantiles';   // ← default to quantiles

// For continuous mode we may still show a domain label; optional
let colorDomain: { lo: number; hi: number; label: string } | null = null;

// For quantiles: thresholds between classes
let colorBreaks: number[] | null = null;

// staged loading
let lastFile: File | null = null;
let lastAsyncBuffer: AsyncBuffer | null = null;
let lastNumericFieldsFromSchema: string[] = [];
let chosenNumericFields: string[] = [];
let cancelRequested = false;

// size identification
let landSizeField: string | null = null;
let landSizeUnitLabel: string | null = null;
let bldgSizeField: string | null = null;
let bldgSizeUnitLabel: string | null = null;

// ---------- Welcome overlay (hide UI until a file is chosen) ----------
let welcomeEl: HTMLDivElement | null = null;
function installWelcome() {
  // hide controls initially
  if (controlsEl) controlsEl.style.display = 'none';

  welcomeEl = document.createElement('div');
  welcomeEl.id = 'welcomeOverlay';
  welcomeEl.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(180deg,#f9fafb,transparent 55%);z-index:20;';
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.12);padding:18px 20px;max-width:560px;width:min(92vw,560px);display:grid;gap:12px;text-align:center;';
  card.innerHTML = `
    <div style="font-size:16px;font-weight:600;">Load a GeoParquet file</div>
    <div style="color:#666;font-size:13px;">Choose a <code>.parquet</code> to visualize.</div>
  `;
  const row = document.createElement('div');
  row.style.cssText='display:flex;gap:10px;justify-content:center;flex-wrap:wrap';

  const btnBrowse = document.createElement('button');
  btnBrowse.textContent='Browse GeoParquet…';
  btnBrowse.style.cssText='border:1px solid #ddd;background:#f8f8f8;padding:8px 12px;border-radius:10px;cursor:pointer;';
  btnBrowse.onclick = () => fileInput.click();

  row.append(btnBrowse);
  card.append(row);
  welcomeEl.append(card);
  document.body.append(welcomeEl);
}
function revealUI() {
  if (welcomeEl) { welcomeEl.remove(); welcomeEl = null; }
  if (controlsEl) controlsEl.style.display = 'grid';
}


// ---------- Non-blocking "Geometry is rendering…" toast ----------
let renderToastEl: HTMLDivElement | null = null;
let dotsTimer: number | null = null;

function ensureRenderToast() {
  if (renderToastEl) return;
  renderToastEl = document.createElement('div');
  renderToastEl.style.cssText = `
    position:absolute; top:12px; left:50%; transform:translateX(-50%);
    background:#111; color:#fff; padding:6px 10px; border-radius:999px;
    font-size:12px; opacity:0; transition:opacity .2s; z-index:25; pointer-events:none;
  `;
  renderToastEl.textContent = 'Geometry is rendering…';
  document.body.append(renderToastEl);
}
function showRenderingToast(msg = 'Geometry is rendering') {
  ensureRenderToast();
  let i = 0;
  if (dotsTimer) { clearInterval(dotsTimer); dotsTimer = null; }
  renderToastEl!.style.opacity = '0.92';
  renderToastEl!.textContent = `${msg}`;
  dotsTimer = window.setInterval(() => {
    i = (i + 1) % 4;
    renderToastEl!.textContent = `${msg}${'.'.repeat(i)}`;
  }, 400);
}
function hideRenderingToast() {
  if (dotsTimer) { clearInterval(dotsTimer); dotsTimer = null; }
  if (renderToastEl) renderToastEl.style.opacity = '0';
}
function awaitFirstRenderedFeature() {
  // poll one frame at a time; hide toast when the first extrusion is visible
  let tries = 0;
  const maxTries = 600; // ~10s at 60fps
  const tick = () => {
    tries++;
    if (!map.getLayer(LAYER_ID)) { if (tries < maxTries) return requestAnimationFrame(tick); else return hideRenderingToast(); }
    const feats = map.queryRenderedFeatures({ layers: [LAYER_ID] });
    if (feats && feats.length > 0) {
      hideRenderingToast();
    } else if (tries < maxTries) {
      requestAnimationFrame(tick);
    } else {
      hideRenderingToast();
    }
  };
  requestAnimationFrame(tick);
}


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

  revealUI();
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
  const valueHits = /(value)\b/.test(s);
  const sizeTokens = /(sq_?ft|sqft|ft2|ft\^2|sq_?m|sqm|m2|m\^2|acres?|acre|hectares?|ha|km2|sqkm|mi2|sqmi|area)/;
  const sizeHits = sizeTokens.test(s);
  return valueHits || sizeHits;
}

function tokenizeName(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Token sets we match against
const UNIT_TOKENS = new Set([
  'sqft','ft2','sf','sqm','m2','km2','sqkm','mi2','sqmi','ac','acre','acres','ha','hectare','hectares','acreage'
]);

function containsUnit(name: string): boolean {
  const tokens = tokenizeName(name);
  return tokens.some(t => UNIT_TOKENS.has(t));
}

function containsKeyword(name: string, kind: 'building'|'land'): boolean {
  const tokens = tokenizeName(name);
  if (kind === 'building') return tokens.some(t => /^(bldg|build|building|impr|improv)/.test(t));
  return tokens.some(t => /^land/.test(t));
}

// score lower = better
function scoreSizeField(name: string, kind: 'building'|'land'): number {
  const tokens = tokenizeName(name);
  const kwIdx = tokens.findIndex(t =>
    kind === 'building' ? /^(bldg|build|building|impr|improv)/.test(t) : /^land/.test(t)
  );
  const unitIdx = tokens.findIndex(t => UNIT_TOKENS.has(t));
  if (kwIdx === -1 || unitIdx === -1) return Number.POSITIVE_INFINITY;

  const extras = tokens.filter((t, i) => i !== kwIdx && i !== unitIdx && t !== 'area' && t !== 'total');

  let score = 0;
  score += extras.length * 10;              // simpler name preferred
  score += tokens.length * 0.5;             // shorter preferred
  if (unitIdx !== tokens.length - 1) score += 2;  // prefer unit suffix at end
  if (kwIdx > 0) score += 0.5;              // slight bonus if keyword is at start
  return score;
}

function guessAreaUnitKey(name: string | null): string | undefined {
  const g = guessAreaUnitFromFieldName(name || '');
  return g || undefined; // reuse your existing unit-guess function
}

function autoPickOne(kind: 'building'|'land', fields: string[]): { field?: string, unitKey?: string } {
  let best: { field?: string, unitKey?: string } = {};
  let bestScore = Number.POSITIVE_INFINITY;
  for (const f of fields) {
    const s = scoreSizeField(f, kind);
    if (s < bestScore) {
      bestScore = s;
      best = { field: f, unitKey: guessAreaUnitKey(f) };
    }
  }
  return best;
}

/* ---------------- Modal 1: chooser ---------------- */
function openFieldChooserModal(opts: { rowCount: number; geometryCol: string; numericFields: string[] }) {
  rowCountEl.textContent = opts.rowCount.toLocaleString();
  geomColEl.textContent = opts.geometryCol || '(unknown)';
  fieldListEl.replaceChildren();

  const all = opts.numericFields;

  // Split into your two display buckets
  const key = all.filter(isKeyField);
  const other = all.filter(n => !isKeyField(n));

  // Within KEY fields, find the single best building/land size candidates
  const bCandidatesKey = key.filter(n => containsKeyword(n, 'building') && containsUnit(n));
  const lCandidatesKey = key.filter(n => containsKeyword(n, 'land') && containsUnit(n));
  const bBest = autoPickOne('building', bCandidatesKey).field;
  const lBest = autoPickOne('land', lCandidatesKey).field;

  // Helper: should a KEY field be prechecked?
  const shouldPrecheckKey = (name: string) => {
    const isB = bCandidatesKey.includes(name);
    const isL = lCandidatesKey.includes(name);
    if (isB) return name === bBest;      // only the best building-size field
    if (isL) return name === lBest;      // only the best land-size field
    return true;                         // all other key fields stay selected
  };

  if (all.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No obvious numeric fields were found in the schema.';
    p.className = 'muted';
    fieldListEl.appendChild(p);
  } else {
    if (key.length) {
      const t = document.createElement('div'); t.className = 'section-title'; t.textContent = 'Suggested key fields';
      fieldListEl.appendChild(t);
      const g = document.createElement('div'); g.className = 'fieldlist';
      for (const name of key) g.appendChild(makeFieldCheckbox(name, shouldPrecheckKey(name)));
      fieldListEl.appendChild(g);
      fieldListEl.appendChild(divider());
    }

    const t2 = document.createElement('div'); t2.className = 'section-title'; t2.textContent = 'Other numeric fields';
    fieldListEl.appendChild(t2);
    const g2 = document.createElement('div'); g2.className = 'fieldlist';
    // ALL "other" fields start unchecked
    for (const name of other) g2.appendChild(makeFieldCheckbox(name, false));
    fieldListEl.appendChild(g2);
  }

  // Buttons
  btnAll.onclick = () => fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    .forEach(c => (c.checked = true));
  btnNone.onclick = () => fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    .forEach(c => (c.checked = false));
  btnCancelModal.onclick = () => { modalOverlay.classList.remove('show'); clearData(); };
  btnConfirmModal.onclick = () => {
    chosenNumericFields = Array.from(fieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
      .filter(c => c.checked).map(c => c.name);
    if (chosenNumericFields.length === 0) { alert('Select at least one numeric field.'); return; }
    modalOverlay.classList.remove('show');
    openSizeModal();
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
  
  // --- AUTO-PICK using heuristic ---
  const bGuess = autoPickOne('building', chosenNumericFields);
  const lGuess = autoPickOne('land', chosenNumericFields);

  if (bGuess.field) {
    bldgFieldSel.value = bGuess.field;
    const u = bGuess.unitKey || guessAreaUnitFromFieldName(bGuess.field);
    if (u) bldgUnitSel.value = u;
  }
  if (lGuess.field) {
    landFieldSel.value = lGuess.field;
    const u = lGuess.unitKey || guessAreaUnitFromFieldName(lGuess.field);
    if (u) landUnitSel.value = u;
  }

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
    scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);

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
function ensureErrorLayer() {
  if (map.getLayer(ERROR_LAYER_ID)) return;
  map.addLayer({
    id: ERROR_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    paint: {
      'line-color': '#ff3b30',          // red outline
      'line-width': 1.5,
      'line-dasharray': [1, 1.3],
      'line-opacity': 0.9
    }
  });
  // keep it above extrusions for visibility
  try { map.moveLayer(ERROR_LAYER_ID); } catch {}
}

function updateErrorLayer() {
  if (!map.getSource(SOURCE_ID)) return;
  ensureErrorLayer();

  let filter: any = ['==', ['literal', 1], 2]; // matches nothing by default

  if (normalizationMode === 'perLand' && landSizeField) {
    // land invalid when ≤ 0  (zero not allowed)
    filter = ['<=', ['to-number', ['get', landSizeField]], 0];
  } else if (normalizationMode === 'perBuilding' && bldgSizeField) {
    // building invalid when negative (zero is allowed and not flagged)
    filter = ['<', ['to-number', ['get', bldgSizeField]], 0];
  }

  map.setFilter(ERROR_LAYER_ID, filter);
}
function clearData() {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  currentGeoJSON = null; currentField = null; currentStats = null;
  fieldSelect.replaceChildren(new Option('— load a file first —', ''));
  updateLegend();
  hideRenderingToast();
}
function addOrUpdateSource(fc: GeoJSON.FeatureCollection) {
  showRenderingToast('Geometry is rendering');
  const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
  } else {
    map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
    addExtrusionLayer();
  }
  awaitFirstRenderedFeature();
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
  ensureErrorLayer();
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
    const den: Expression = ['to-number', ['get', landSizeField]] as any;
    // Land invalid when ≤ 0 ⇒ height 0 (flat); outline layer will flag it.
    return ['case',
      ['<=', den, 0], 0,
      ['/', base, den]
    ] as any;
  }

  if (normalizationMode === 'perBuilding' && bldgSizeField) {
    const den: Expression = ['to-number', ['get', bldgSizeField]] as any;
    // Building invalid when < 0 ⇒ height 0 (flat) and flagged.
    // Building == 0 is allowed conceptually (no building) but we can't divide by 0 ⇒ also 0 height (not flagged).
    return ['case',
      ['<', den, 0], 0,
      ['==', den, 0], 0,
      ['/', base, den]
    ] as any;
  }

  return base;
}


function applyExtrusion() {
  if (!currentGeoJSON || !currentField || !currentStats) return;

  const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
  const valueExpr = buildValueExpression();
  
  let colorExpr: Expression;
  if (colorMode === 'quantiles' && colorBreaks && colorBreaks.length) {
    colorExpr = makeStepColorExpression(valueExpr, ramp, colorBreaks);
  } else {
    // continuous (keep your existing function or clamped version)
    const nmin = currentStats.min;
    const nmax = currentStats.max;
    const cmin = colorDomain?.lo ?? nmin;
    const cmax = colorDomain?.hi ?? nmax;
    colorExpr = makeColorExpressionFromExpr(valueExpr, ramp, cmin, cmax);
  }

  const rawMult = Number(multInput.value);
  const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
  const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
  const heightExpr: Expression = ['*', valueExpr, multiplier * unitFactor] as any;

  map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', heightExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));

  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (activePopup && lastPicked) {
    activePopup.setHTML(buildPopupHTML(lastPicked.props)).setLngLat(lastPicked.lngLat);
  }
}


function fitToData(fc: GeoJSON.FeatureCollection) {
  const b = bbox(fc); if (!b) return;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 800 });
}

// ---- Quality toggle (runtime supersampling) ----
const FAST_PR = window.devicePixelRatio;                  // normal speed
const HIGH_PR = Math.min(3, window.devicePixelRatio * 2); // 2–3x is a good HQ target

type QualityMode = 'fast' | 'high';
let qualityMode: QualityMode = 'fast';

function setQuality(mode: QualityMode) {
  qualityMode = mode;
  const pr = (mode === 'high') ? HIGH_PR : FAST_PR;

  // setPixelRatio is available on MapLibre >= 2; fall back with a warn otherwise
  const anyMap = map as any;
  if (typeof anyMap.setPixelRatio === 'function') {
    anyMap.setPixelRatio(pr);
    map.resize(); // apply immediately
    // optional debug of effective value (after clamping)
    if (typeof anyMap.getPixelRatio === 'function') {
      console.debug('pixelRatio applied:', anyMap.getPixelRatio());
    }
  } else {
    console.warn('setPixelRatio() not available in this MapLibre build; toggle requires recreating the map.');
  }

  // reflect in UI button, if present
  const btn = document.getElementById('btn-quality') as HTMLButtonElement | null;
  if (btn) btn.textContent = (mode === 'high') ? 'Quality: High' : 'Quality: Fast';
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

// ---- Coalesced updates: only the last request runs ----
type UpdateMode = 'applyOnly' | 'recomputeAndAutoScale';

let _updTimer: number | null = null;
let _pendingMode: UpdateMode = 'applyOnly';
let _pendingRefreshLegend = false;

/** Queue an update; newer calls replace older ones. */
function scheduleUpdate(mode: UpdateMode, refreshLegend = false, debounceMs = 80) {
  if (!currentGeoJSON) return;   // <- hard stop until data exists

  _pendingMode = mode;
  _pendingRefreshLegend = refreshLegend;
  if (_updTimer) clearTimeout(_updTimer);
  _updTimer = window.setTimeout(() => {
    _updTimer = null;
    if (_pendingMode === 'recomputeAndAutoScale') {
      computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL);
      if (_pendingRefreshLegend) updateLegend();
    } else {
      applyExtrusion();
      if (_pendingRefreshLegend) updateLegend();
    }
  }, debounceMs);
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

/** Compute (k-1) break values at equal quantiles between lowPct..highPct. */
function quantileBreaks(values: number[], k: number, lowPct = 1, highPct = 99): number[] {
  const ks = Math.max(2, Math.min(k, 12)); // sane class count cap
  const out: number[] = [];
  for (let i = 1; i < ks; i++) {
    const p = lowPct + (highPct - lowPct) * (i / ks);
    const q = percentile(values, p);
    if (Number.isFinite(q)) out.push(q);
  }
  // ensure strictly ascending unique thresholds
  out.sort((a,b)=>a-b);
  return out.filter((v, i) => i === 0 || v > out[i-1]);
}

/** Build a step expression: first color is < break1, then each break raises the color. */
function makeStepColorExpression(valueExpr: Expression, colors: string[], breaks: number[]): Expression {
  const c = colors.slice();                 // copy
  const b = breaks.slice();                 // copy
  if (b.length === 0) return ['step', valueExpr, c[0]] as any;

  const out: (string | number | Expression)[] = ['step', valueExpr, c[0]];
  // pair up thresholds with subsequent colors
  for (let i = 0; i < b.length && i + 1 < c.length; i++) {
    out.push(b[i], c[i + 1]);
  }
  return out as any;
}

/** Auto-multiplier so p-th percentile reaches capMeters, in given units */
function computeAndApplyAutoMultiplier(
  unitsKeyOrAuto: 'auto' | keyof typeof UNIT_TO_METERS = 'auto',
  capMeters = 1000,
  p = 99
) {
  if (!currentGeoJSON || !currentField) return;

  // values for the CURRENT normalization mode
  const vals = getNumericValuesNormalized(currentGeoJSON, currentField, normalizationMode);
  const pVal = percentile(vals, p);
  if (!Number.isFinite(pVal) || pVal <= 0) return;

  // ---- Color domain / breaks ----
  if (colorMode === 'quantiles') {
    const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    colorBreaks = quantileBreaks(vals, ramp.length, 1, 99); // p1..p99 equal-frequency bins
    colorDomain = null;
  } else {
    // continuous = EQUAL INTERVAL classes across p1..p99
    const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    const pLow = percentile(vals, 1);
    const pHigh = percentile(vals, 99);
    let lo = Number.isFinite(pLow) ? pLow : 0;
    let hi = Number.isFinite(pHigh) ? pHigh : 1;
    if (!(hi > lo)) { lo = 0; hi = 1; }
    colorDomain = { lo, hi, label: 'p1–p99' };
   
    // build equal-interval thresholds: colors => k classes => k-1 breaks
    const classes = Math.max(2, ramp.length);
    const step = (hi - lo) / classes;
    const breaks: number[] = [];
    for (let i = 1; i < classes; i++) breaks.push(lo + step * i);
    colorBreaks = breaks;
  }

  // ---- Height autoscale: anchor p-th percentile to capMeters ----
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

  unitsSelect.value = unitKey;
  multInput.value = String(multiplier);

  // stats for legend fallback
  currentStats = computeStatsNormalized(currentGeoJSON, currentField, normalizationMode);

  console.debug('autoScale', {
    mode: normalizationMode,
    field: currentField,
    pctl: p,
    pVal,
    unit: unitKey,
    multiplier,
    colorMode,
    colorBreaks,
    colorDomain,
    stats: currentStats
  });

  applyExtrusion();
}


function makeColorExpressionFromExpr(valueExpr: Expression, colors: string[], min: number, max: number): Expression {
  const n = colors.length - 1;
  const stops: (number | string)[] = [];
  for (let i = 0; i < colors.length; i++) {
    const t = i / n;
    stops.push(min + t * (max - min), colors[i]);
  }
  // Clamp value into [min,max] to avoid outliers crushing the ramp
  const clamped: Expression = ['max', min, ['min', max, valueExpr]] as any;
  return ['interpolate', ['linear'], clamped, ...stops] as any;
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
  const ramp = COLOR_RAMPS[rampSelect.value] || [];
  legendEl.replaceChildren();
  if (!ramp.length) { legendEl.style.display = 'none'; return; }

  const row = document.createElement('div');
  row.style.display = 'flex'; row.style.gap = '6px'; row.style.alignItems = 'center'; row.style.flexWrap = 'wrap';

  const label = document.createElement('div'); label.textContent = 'Legend:'; label.style.fontSize = '12px';
  row.appendChild(label);
  ramp.forEach(c => { const s = document.createElement('div'); s.className = 'swatch'; (s as any).style = `background:${c}`; row.appendChild(s); });

  const meta = document.createElement('div'); meta.className = 'muted';

  if (colorMode === 'quantiles' && colorBreaks && colorBreaks.length) {
    // Show something like: Q bins across p1–p99
    const lo = (colorDomain?.lo ?? currentStats?.min) ?? '…';
    const hi = (colorDomain?.hi ?? currentStats?.max) ?? '…';
    // edges for display (we don’t guarantee exact p1/p99 computed here unless you also set colorDomain in quantiles)
    const edges = [lo, ...colorBreaks, hi]
      .map(v => typeof v === 'number' ? v.toLocaleString() : String(v));
    meta.textContent = `Quantiles (p1–p99): ${edges.join(' | ')}`;
  } else if (colorDomain) {
    meta.textContent = `${colorDomain.label} ${colorDomain.lo.toLocaleString()} → ${colorDomain.hi.toLocaleString()}`;
  } else if (currentStats) {
    meta.textContent = `${currentStats.min.toLocaleString()} → ${currentStats.max.toLocaleString()}`;
  }

  row.appendChild(meta);
  legendEl.appendChild(row);
  legendEl.style.display = 'grid';
}


function currentModeErrorMessage(props: Record<string, any>): string | null {
  if (normalizationMode === 'perLand' && landSizeField) {
    const v = Number((props as any)[landSizeField]);
    if (!Number.isFinite(v) || v <= 0) return '⚠ Invalid land size (≤ 0 or missing)';
  } else if (normalizationMode === 'perBuilding' && bldgSizeField) {
    const v = Number((props as any)[bldgSizeField]);
    if (Number.isFinite(v) && v < 0) return '⚠ Negative building size';
    if (v === 0) return 'ℹ Building size is 0 — shown flat (not an error)';
  }
  return null;
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

  const errMsg = currentModeErrorMessage(props);
  const errRow = errMsg ? `<div style="margin-top:4px;color:#b00020;">${errMsg}</div>` : '';

  return `
    <div class="gvw-pop" style="max-width:min(92vw, 460px); font-size:12.5px; line-height:1.35;">
      ${title ? `<div style="font-weight:600;margin-bottom:4px; overflow-wrap:anywhere;">${title}</div>` : ''}
      ${metricRow}
      ${heightRow}
	  ${errRow}
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
rampSelect.addEventListener('change', () => {
  // if quantiles, new color count ⇒ recompute breaks
  const needsRecompute = (colorMode === 'quantiles');
  scheduleUpdate(needsRecompute ? 'recomputeAndAutoScale' : 'applyOnly', /*refreshLegend*/ true);
});


function onMultInput() {
  const v = Number(multInput.value);
  if (!Number.isFinite(v)) return; // ignore interim typing states
  scheduleUpdate('applyOnly');
}
multInput.addEventListener('input', onMultInput);
multInput.addEventListener('change', onMultInput);

unitsSelect.addEventListener('change', () => scheduleUpdate('applyOnly'));
opacityInput.addEventListener('input', () => {
  if (opacityOut) opacityOut.value = Number(opacityInput.value).toFixed(2);
  scheduleUpdate('applyOnly');
});

fieldSelect.addEventListener('change', () => {
  currentField = fieldSelect.value || null;
  if (!currentGeoJSON || !currentField) return;
  scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true)
});

document.querySelectorAll<HTMLInputElement>('input[name="normMode"]').forEach(r => {
  r.addEventListener('change', () => {
    normalizationMode = (document.querySelector('input[name="normMode"]:checked') as HTMLInputElement)?.value as any;
    if (!currentGeoJSON || !currentField) return;
    scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
  });
});

// default height units
unitsSelect.value = 'centimeters';
installWelcome();
setQuality('high');


