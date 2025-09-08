// Imports
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import type { Expression } from 'maplibre-gl';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';

// Local imports
import { BASEMAP_STYLES, SOURCE_ID, LAYER_ID, ERROR_LAYER_ID, HEIGHT_CAP_METERS, HEIGHT_PCTL, COLOR_RAMPS, UNIT_TO_METERS, DEV_CATEGORY_FIELD, UNDERUTILIZED_DEFAULTS } from './config';
import { FIELD_LABELS, ALL_FIELDS, NUMERIC_FIELDS, loadDataDictionary } from './utils.dictionary';
import { sanitizeFeaturesInPlace, urlToAsyncBuffer, type AsyncBuffer } from './utils.sanitize';
import { roundGeometryInPlace, trimPropertiesInPlace, bbox } from './utils.geo';
import { numOrNull, fmt, percentile, quantileBreaks } from './utils.number';


/* ---------------- Map Bootstrap ----------------- */


const HQ_PR = Math.min(3, window.devicePixelRatio * 2); // 2–3 is a good “HQ” target

const map = new maplibregl.Map({
  container: 'map',
  // Default to OpenStreetMap; fallback style handled elsewhere
  style: BASEMAP_STYLES['OpenStreetMap'],
  center: [-95.3698, 29.7604],
  zoom: 10,
  pitch: 45,
  bearing: -20,
  hash: true,

  // supersample: render at higher internal resolution (smooth lines)
  pixelRatio: HQ_PR
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

// Secondary maps (Underutilized, Ratio)
const mapUnder = new maplibregl.Map({
  container: 'map-under',
  style: BASEMAP_STYLES['OpenStreetMap'],
  center: [-95.3698, 29.7604],
  zoom: 10,
  pitch: 45,
  bearing: -20,
  hash: false,
  pixelRatio: HQ_PR
});
mapUnder.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
mapUnder.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

const mapRatio = new maplibregl.Map({
  container: 'map-ratio',
  style: BASEMAP_STYLES['OpenStreetMap'],
  center: [-95.3698, 29.7604],
  zoom: 10,
  pitch: 45,
  bearing: -20,
  hash: false,
  pixelRatio: HQ_PR
});
mapRatio.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
mapRatio.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');


/* ---------------- UI elements ---------------- */


const fieldSelect = document.getElementById('field') as HTMLSelectElement;
const rampSelect = document.getElementById('ramp') as HTMLSelectElement;
const multInput = document.getElementById('mult') as HTMLInputElement;
const unitsSelect = document.getElementById('units') as HTMLSelectElement;
const opacityInput = document.getElementById('opacity') as HTMLInputElement;
const opacityOut = document.getElementById('opacityVal') as HTMLOutputElement
const legendEl = document.getElementById('legend') as HTMLFieldSetElement;
const controlsEl = document.getElementById('controls') as HTMLDivElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const closeControls = document.getElementById('closeControls') as HTMLButtonElement;
const basemapSelect = document.getElementById('basemap') as HTMLSelectElement;

const expandBtn = document.getElementById('expandBtn') as HTMLButtonElement;
const mapBox = document.getElementById('mapBox') as HTMLDivElement;
const mainHolder = document.getElementById('mapHolder-main') as HTMLDivElement;
const underHolder = document.getElementById('mapHolder-under') as HTMLDivElement;
const ratioHolder = document.getElementById('mapHolder-ratio') as HTMLDivElement;
const mainSection = document.getElementById('mainSection') as HTMLElement;
const underSection = document.getElementById('underSection') as HTMLElement;
const ratioSection = document.getElementById('ratioSection') as HTMLElement;
const categoryFieldset = document.getElementById('categoryFieldset') as HTMLFieldSetElement;
const categoryContainer = document.getElementById('categoryFilter') as HTMLDivElement;
const scaleFiltered = document.getElementById('scaleFiltered') as HTMLInputElement;
const invertHeights = document.getElementById('invertHeights') as HTMLInputElement;
const underTotals = document.getElementById('underTotals') as HTMLDivElement;

// Under map controls
const underSettingsBtn = document.getElementById('underSettingsBtn') as HTMLButtonElement;
const underControlsEl = document.getElementById('underControls') as HTMLDivElement;
const underCloseControls = document.getElementById('underCloseControls') as HTMLButtonElement;
const underExpandBtn = document.getElementById('underExpandBtn') as HTMLButtonElement;
const underRampSelect = document.getElementById('under-ramp') as HTMLSelectElement;
const underOpacityInput = document.getElementById('under-opacity') as HTMLInputElement;
const underOpacityOut = document.getElementById('underOpacityVal') as HTMLOutputElement;
const underInvertHeights = document.getElementById('underInvertHeights') as HTMLInputElement;

// Ratio map controls
const ratioSettingsBtn = document.getElementById('ratioSettingsBtn') as HTMLButtonElement;
const ratioControlsEl = document.getElementById('ratioControls') as HTMLDivElement;
const ratioCloseControls = document.getElementById('ratioCloseControls') as HTMLButtonElement;
const ratioExpandBtn = document.getElementById('ratioExpandBtn') as HTMLButtonElement;
const ratioRampSelect = document.getElementById('ratio-ramp') as HTMLSelectElement;
const ratioOpacityInput = document.getElementById('ratio-opacity') as HTMLInputElement;
const ratioOpacityOut = document.getElementById('ratioOpacityVal') as HTMLOutputElement;
const ratioInvertHeights = document.getElementById('ratioInvertHeights') as HTMLInputElement;
function categoryInputs() {
  return Array.from(categoryContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
}
categoryContainer.addEventListener('change', () => {
  applyFilterAndScaling();
  saveSettings(currentTab);
  renderUnderNow();
});
scaleFiltered.addEventListener('change', () => { applyFilterAndScaling(); saveSettings(currentTab); });
invertHeights.addEventListener('change', () => {
  if (currentTab === 'under') applyFilterAndScaling();
  else computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL);
  saveSettings(currentTab);
});

function initMapControls(opts: {
  settingsBtn: HTMLButtonElement,
  panelEl: HTMLDivElement,
  closeBtn: HTMLButtonElement,
  expandBtn?: HTMLButtonElement,
  mapBoxEl: HTMLDivElement,
  map: maplibregl.Map
}) {
  const { settingsBtn, panelEl, closeBtn, expandBtn, mapBoxEl, map } = opts;
  const parent = mapBoxEl.parentElement as HTMLElement;
  settingsBtn.onclick = () => {
    panelEl.style.display = 'grid';
    settingsBtn.style.display = 'none';
    if (expandBtn) expandBtn.style.display = 'none';
  };
  closeBtn.onclick = () => {
    panelEl.style.display = 'none';
    settingsBtn.style.display = 'block';
    if (expandBtn) expandBtn.style.display = 'block';
  };
  if (expandBtn) {
    expandBtn.onclick = () => {
      const expanded = mapBoxEl.classList.toggle('expanded');
      if (expanded) {
        document.body.appendChild(mapBoxEl);
        document.body.style.overflow = 'hidden';
      } else {
        parent.appendChild(mapBoxEl);
        document.body.style.overflow = '';
      }
      map.resize();
    };
  }
}

// Initialize map control components for each map
initMapControls({ settingsBtn, panelEl: controlsEl, closeBtn: closeControls, expandBtn, mapBoxEl: mapBox, map });
initMapControls({ settingsBtn: underSettingsBtn, panelEl: underControlsEl, closeBtn: underCloseControls, expandBtn: underExpandBtn, mapBoxEl: underHolder.querySelector('.map-box') as HTMLDivElement, map: mapUnder });
initMapControls({ settingsBtn: ratioSettingsBtn, panelEl: ratioControlsEl, closeBtn: ratioCloseControls, expandBtn: ratioExpandBtn, mapBoxEl: ratioHolder.querySelector('.map-box') as HTMLDivElement, map: mapRatio });

expandBtn.onclick = () => {
  const expanded = mapBox.classList.toggle('expanded');
  if (expanded) {
    document.body.appendChild(mapBox);
    document.body.style.overflow = 'hidden';
  } else {
    holderForTab(currentTab).appendChild(mapBox);
    document.body.style.overflow = '';
  }
  map.resize();
};

type TabKey = 'main' | 'under' | 'ratio';
let currentTab: TabKey = 'main';
let reverseColors = false; // ratio tab uses reversed colors so darkest = tallest

function holderForTab(tab: TabKey): HTMLDivElement {
  return tab === 'main' ? mainHolder : (tab === 'under' ? underHolder : ratioHolder);
}

function saveSettings(tab: TabKey) {
  const obj: any = {
    basemap: basemapSelect.value,
    field: fieldSelect.value,
    ramp: rampSelect.value,
    mult: multInput.value,
    units: unitsSelect.value,
    opacity: opacityInput.value,
    invert: invertHeights.checked,
    colorMode: (document.querySelector('input[name="colorMode"]:checked') as HTMLInputElement)?.value,
    scaleFiltered: scaleFiltered.checked,
    categories: categoryInputs().filter(i => i.checked).map(i => i.value)
  };
  localStorage.setItem(`gvw_settings_${tab}`, JSON.stringify(obj));
}

function loadSettings(tab: TabKey) {
  const raw = localStorage.getItem(`gvw_settings_${tab}`);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    if (obj.basemap) {
      // Fallback if a previously saved basemap no longer exists
      setBasemap(BASEMAP_STYLES[obj.basemap] ? obj.basemap : 'OpenStreetMap');
    }
    if (obj.field) { fieldSelect.value = obj.field; currentField = obj.field; }
    if (obj.ramp) rampSelect.value = obj.ramp;
    if (obj.mult) multInput.value = obj.mult;
    if (obj.units) unitsSelect.value = obj.units;
    if (obj.opacity) { opacityInput.value = obj.opacity; if (opacityOut) opacityOut.value = Number(obj.opacity).toFixed(2); }
    invertHeights.checked = !!obj.invert;
    if (obj.colorMode) {
      const radio = document.querySelector<HTMLInputElement>(`input[name="colorMode"][value="${obj.colorMode}"]`);
      if (radio) radio.checked = true;
    }
    scaleFiltered.checked = !!obj.scaleFiltered;
    if (obj.categories && categoryContainer.childElementCount) {
      categoryInputs().forEach(i => { i.checked = obj.categories.includes(i.value); });
    }
  } catch {}
}

// With three concurrent maps, we no longer switch sections.

// Loading overlay
const loadingOverlay = document.getElementById('loadingOverlay')!;
const progressEl = document.getElementById('progress')!;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressMsg = document.getElementById('progressMsg') as HTMLDivElement;

// Color scaling radios
const colorCont = document.getElementById('color-cont') as HTMLInputElement | null;
const colorQuant = document.getElementById('color-quant') as HTMLInputElement | null;

// Color ramp choices
for (const key of Object.keys(COLOR_RAMPS)) {
  const opt = document.createElement('option'); opt.value = key; opt.textContent = key; rampSelect.appendChild(opt);
}
rampSelect.value = 'Magma';

// Populate under/ratio ramp selects
if (underRampSelect) {
  for (const key of Object.keys(COLOR_RAMPS)) {
    const opt = document.createElement('option'); opt.value = key; opt.textContent = key; underRampSelect.appendChild(opt);
  }
  underRampSelect.value = 'Magma';
}
if (ratioRampSelect) {
  for (const key of Object.keys(COLOR_RAMPS)) {
    const opt = document.createElement('option'); opt.value = key; opt.textContent = key; ratioRampSelect.appendChild(opt);
  }
  ratioRampSelect.value = COLOR_RAMPS['Reds'] ? 'Reds' : 'Magma';
}

for (const key of Object.keys(BASEMAP_STYLES)) {
  const opt = document.createElement('option'); opt.value = key; opt.textContent = key; basemapSelect.appendChild(opt);
}
// Default to OpenStreetMap; other styles available in dropdown
basemapSelect.value = 'OpenStreetMap';
basemapSelect.onchange = () => { setBasemap(basemapSelect.value); saveSettings(currentTab); };


/* ---------------- Constants ---------------- */

const FAST_PR = window.devicePixelRatio;                  // normal speed
const HIGH_PR = Math.min(3, window.devicePixelRatio * 2); // 2–3x is a good HQ target


/* ---------------- State ---------------- */


let currentGeoJSON: GeoJSON.FeatureCollection | null = null;
let currentField: string | null = null;
let currentStats: { min: number; max: number } | null = null;

let normalizationMode: 'asis' | 'perLand' | 'perBuilding' = 'asis';
type ColorMode = 'continuous' | 'quantiles';
let colorMode: ColorMode = 'quantiles';   // <-- default to quantiles

// For continuous mode we may still show a domain label; optional
let colorDomain: { lo: number; hi: number; label: string } | null = null;

// For quantiles: thresholds between classes
let colorBreaks: number[] | null = null;

// staged loading
let lastAsyncBuffer: AsyncBuffer | null = null;
let cancelRequested = false;

// size identification
let landSizeField: string | null = null;
let bldgSizeField: string | null = null;

// Non-blocking "Geometry is rendering..." toast
let renderToastEl: HTMLDivElement | null = null;
let dotsTimer: number | null = null;

type QualityMode = 'fast' | 'high';
let qualityMode: QualityMode = 'high';


// --- popup state ---
let activePopup: maplibregl.Popup | null = null;
let lastPicked: { props: Record<string, any>, lngLat: maplibregl.LngLatLike } | null = null;

type UpdateMode = 'applyOnly' | 'recomputeAndAutoScale';

let _updTimer: number | null = null;
let _pendingMode: UpdateMode = 'applyOnly';
let _pendingRefreshLegend = false;

type MetricUnitKey = 'centimeters' | 'meters' | 'kilometers';

// moved above with TabKey declaration

/* ---------------- FUNCTIONS ----------------- */


function ensureRenderToast() {
  if (renderToastEl) return;
  renderToastEl = document.createElement('div');
  renderToastEl.style.cssText = `
    position:absolute; top:12px; left:50%; transform:translateX(-50%);
    background:#111; color:#fff; padding:6px 10px; border-radius:999px;
    font-size:12px; opacity:0; transition:opacity .2s; z-index:25; pointer-events:none;
  `;
  renderToastEl.textContent = 'Geometry is rendering...';
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



function tokenizeName(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// score lower = better
export function scoreValueField(name: string): number {
  const tokens = tokenizeName(name);

  // Category ranking (lower is better)
  const has = (re: RegExp) => tokens.some(t => re.test(t));

  const isLand     = has(/^land$/);
  const isPropLike = has(/^property$/) || has(/^market$/) || has(/^total$/);
  const isBldgLike = has(/^building$/) || has(/^bldg$/) || has(/^impr/) || has(/^improve/);

  let catRank = 3;                // default "other"
  if (isLand)        catRank = 0; // best
  else if (isPropLike) catRank = 1;
  else if (isBldgLike) catRank = 2;

  // Start with category weight
  let score = catRank * 100;

  // Bonus for containing "valu" (as in "value" or "valuation")
  const hasValue = tokens.includes('valu') || /valu/i.test(name);
  if (hasValue) score -= 20;

  // Gentle tie-breakers (keep small so they don't swamp category/bonus)
  // Fewer tokens and shorter total name are better.
  score += tokens.length * 0.5;
  score += Math.min(20, name.length / 50); // tiny nudge for very long names

  return score;
}

function autoPickMainField(fields: string[]): string | undefined {
  let best: string | undefined = undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const f of fields) {
    const s = scoreValueField(f);
    if (s < bestScore) {
      bestScore = s;
      best = f;
    }
  }
  return best;
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
  if (!lastAsyncBuffer) return;
  showLoading('Reading geometry + fields…');

  try {
    const result: any = await toGeoJson({ file: lastAsyncBuffer, compressors });
    if (cancelRequested) return;

    const fc: GeoJSON.FeatureCollection | undefined =
      result?.type === 'FeatureCollection' ? result : result?.geojson;
    if (!fc?.features) throw new Error('Parser returned no FeatureCollection.');

    let features = fc.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
    if (features.length === 0) throw new Error('No Polygon/MultiPolygon features found.');

    const required = [DEV_CATEGORY_FIELD, 'REALIMPROV', 'REALLANDVA'];
    for (const key of required) {
      if (!features[0]?.properties?.hasOwnProperty(key)) {
        throw new Error(`Required field missing: ${key}`);
      }
    }

    sanitizeFeaturesInPlace(features);
    for (const f of features) {
      const p = (f.properties || {}) as Record<string, any>;
      const land = Number(p.REALLANDVA);
      const impr = Number(p.REALIMPROV);
      if (Number.isFinite(land) && Number.isFinite(impr)) {
        p.TLLDIMPROV = land + impr;
        if (land > 0) p.IMPR_LAND_RATIO = impr / land;
      }
    }

    const keep = new Set<string>([
      'id','ID','fid','FID','name','NAME',
      DEV_CATEGORY_FIELD,
      ...ALL_FIELDS,
      bldgSizeField || '',
      landSizeField || ''
    ]);
    trimPropertiesInPlace(features, keep);

    for (const f of features) roundGeometryInPlace(f);

    if (cancelRequested) return;
    currentGeoJSON = { type: 'FeatureCollection', features };
    populateCategoryOptions(currentGeoJSON);
    updateUnderTotals(currentGeoJSON);
    loadSettings(currentTab);

    // dropdown = predetermined numeric fields (ensure they exist)
    const available = NUMERIC_FIELDS.filter(k => features[0]?.properties?.hasOwnProperty(k));
    if (features[0]?.properties?.hasOwnProperty('REALIMPROV') && features[0]?.properties?.hasOwnProperty('REALLANDVA')) {
      available.push('IMPR_LAND_RATIO');
    }
    populateFieldDropdownFromList(available);

    // auto-select the best (prefer REALLANDVA_per_sqft if present)
    currentField = available.includes('REALLANDVA_per_sqft')
      ? 'REALLANDVA_per_sqft'
      : (autoPickMainField(available) ?? null);
    if (currentField) {
      fieldSelect.value = currentField;
      currentStats = computeStatsNormalized(currentGeoJSON, currentField, normalizationMode);
    }

    addOrUpdateSourceFor(map, /*withClick*/ true);
    addOrUpdateSourceWhenReady(mapUnder, /*withClick*/ false);
    addOrUpdateSourceWhenReady(mapRatio, /*withClick*/ false);

    // auto-multiplier for current normalization mode → p99 = 2km (centimeters)
    scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
    renderUnderNow();
    renderRatioNow();

    updateLegend();
    fitToDataAll(currentGeoJSON);
  } catch (err: any) {
    console.error('GeoParquet load failed:', err);
    if (!cancelRequested) alert(`GeoParquet load failed: ${err?.message ?? err}`);
  } finally {
    hideLoading();
  }
}

/* ---------------- Map helpers ---------------- */
function ensureErrorLayerFor(m: maplibregl.Map) {
  if (m.getLayer(ERROR_LAYER_ID)) return;
  m.addLayer({
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
  try { m.moveLayer(ERROR_LAYER_ID); } catch {}
}

function updateErrorLayer() {
  if (!map.getSource(SOURCE_ID)) return;
  ensureErrorLayerFor(map);

  let filter: any = ['==', ['literal', 1], 2]; // matches nothing by default

  if (currentField === 'IMPR_LAND_RATIO') {
    filter = ['<=', ['to-number', ['get', 'REALLANDVA']], 0];
  } else if (normalizationMode === 'perLand' && landSizeField) {
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
  fieldSelect.replaceChildren(new Option('— no data —', ''));
  updateLegend();
  hideRenderingToast();
}
function addOrUpdateSourceFor(m: maplibregl.Map, withClick = false) {
  const existing = m.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) existing.setData(currentGeoJSON as any);
  else {
    m.addSource(SOURCE_ID, { type: 'geojson', data: currentGeoJSON as any });
    addExtrusionLayerFor(m, withClick);
  }
}

function addOrUpdateSourceWhenReady(m: maplibregl.Map, withClick = false) {
  if (!currentGeoJSON) return;
  if ((m as any).isStyleLoaded && (m as any).isStyleLoaded()) {
    addOrUpdateSourceFor(m, withClick);
  } else {
    m.once('load', () => addOrUpdateSourceFor(m, withClick));
  }
}

function addExtrusionLayerFor(m: maplibregl.Map, withClick = false) {
  if (m.getLayer(LAYER_ID)) return;
  m.addLayer({
    id: LAYER_ID, type: 'fill-extrusion', source: SOURCE_ID,
    paint: {
      'fill-extrusion-color': '#888',
      'fill-extrusion-height': 0,
      'fill-extrusion-opacity': parseFloat(opacityInput.value),
      'fill-extrusion-vertical-gradient': true
    }
  });
  if (withClick) {
    m.on('click', LAYER_ID, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const props = (f.properties || {}) as Record<string, any>;
      showPopup(props, e.lngLat);
    });
    m.on('mouseenter', LAYER_ID, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', LAYER_ID, () => { m.getCanvas().style.cursor = ''; });
  }
  ensureErrorLayerFor(m);
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
  let base: Expression;
  if (currentField === 'IMPR_LAND_RATIO') {
    const num: Expression = ['to-number', ['get', 'REALIMPROV']] as any;
    const den: Expression = ['to-number', ['get', 'REALLANDVA']] as any;
    base = ['case', ['<=', den, 0], 0, ['/', num, den]] as any;
  } else {
    base = ['to-number', ['get', currentField]] as any;
  }

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

function buildValueExpressionFor(field: string, mode: 'asis'|'perLand'|'perBuilding'): Expression {
  let base: Expression;
  if (field === 'IMPR_LAND_RATIO') {
    const num: Expression = ['to-number', ['get', 'REALIMPROV']] as any;
    const den: Expression = ['to-number', ['get', 'REALLANDVA']] as any;
    base = ['case', ['<=', den, 0], 0, ['/', num, den]] as any;
  } else {
    base = ['to-number', ['get', field]] as any;
  }
  if (mode === 'perLand' && landSizeField) {
    const den: Expression = ['to-number', ['get', landSizeField]] as any;
    return ['case', ['<=', den, 0], 0, ['/', base, den]] as any;
  }
  if (mode === 'perBuilding' && bldgSizeField) {
    const den: Expression = ['to-number', ['get', bldgSizeField]] as any;
    return ['case', ['<', den, 0], 0, ['==', den, 0], 0, ['/', base, den]] as any;
  }
  return base;
}


function applyExtrusion() {
  if (!currentGeoJSON || !currentField || !currentStats) return;
  if (!map.getLayer(LAYER_ID)) return;

  let ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
  if (reverseColors && ramp) ramp = ramp.slice().reverse();
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
  let heightBase: Expression = valueExpr;
  if (invertHeights.checked && currentStats) {
    heightBase = ['-', currentStats.max, valueExpr] as any;
  }
  const heightExpr: Expression = ['*', heightBase, multiplier * unitFactor] as any;

  map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', heightExpr);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));

  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (activePopup && lastPicked) {
    activePopup.setHTML(buildPopupHTML(lastPicked.props)).setLngLat(lastPicked.lngLat);
  }
}

function renderMapFor(
  m: maplibregl.Map,
  field: string,
  mode: 'asis'|'perLand'|'perBuilding',
  invert: boolean,
  rampKey: string,
  reverse: boolean,
  opacityOverride?: number,
  filteredFc?: GeoJSON.FeatureCollection
) {
  if (!currentGeoJSON) return;
  if (!m.getLayer(LAYER_ID)) return;
  const src = filteredFc || currentGeoJSON;
  const vals = getNumericValuesNormalized(src, field, mode);
  if (!vals.length) return;
  let min = Infinity, max = -Infinity;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  if (!(max > min)) { min = 0; max = 1; }

  const scaleVals = invert ? vals.map(v => (max - v)) : vals;
  const pVal = percentile(scaleVals, HEIGHT_PCTL);
  if (!Number.isFinite(pVal) || pVal <= 0) return;
  const heightScale = HEIGHT_CAP_METERS / pVal;

  let ramp = COLOR_RAMPS[rampKey] || COLOR_RAMPS['Viridis'];
  if (reverse && ramp) ramp = ramp.slice().reverse();

  const valueExpr = buildValueExpressionFor(field, mode);
  let colorExpr: Expression;
  if (colorMode === 'quantiles') {
    const breaks = quantileBreaks(vals, ramp.length, 1, 99);
    colorExpr = makeStepColorExpression(valueExpr, ramp, breaks);
  } else {
    const pLow = percentile(vals, 1);
    const pHigh = percentile(vals, 99);
    const lo = Number.isFinite(pLow) ? pLow : min;
    const hi = Number.isFinite(pHigh) ? pHigh : max;
    colorExpr = makeColorExpressionFromExpr(valueExpr, ramp, lo, hi);
  }

  let heightBase: Expression = valueExpr;
  if (invert) heightBase = ['-', max, valueExpr] as any;
  const heightExpr: Expression = ['*', heightBase, heightScale] as any;

  m.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
  m.setPaintProperty(LAYER_ID, 'fill-extrusion-height', heightExpr);
  const op = (typeof opacityOverride === 'number') ? opacityOverride : parseFloat(opacityInput.value);
  m.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', op);
}
function setTab(tab: TabKey) {
  currentTab = tab;
  if (tab === 'main') {
    categoryFieldset.style.display = 'none';
    reverseColors = false;
    if (map.getLayer(LAYER_ID)) map.setFilter(LAYER_ID, null);
    computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL);
    applyExtrusion();
  } else if (tab === 'under') {
    categoryFieldset.style.display = 'block';
    reverseColors = false;
    const inputs = categoryInputs();
    if (inputs.length && !inputs.some(i => i.checked)) {
      inputs.forEach(i => (i.checked = true));
    }
    applyFilterAndScaling();
  } else if (tab === 'ratio') {
    categoryFieldset.style.display = 'none';
    reverseColors = true;            // darkest = tallest when inverted
    invertHeights.checked = true;    // emphasize low ratios
    if (COLOR_RAMPS['Reds']) rampSelect.value = 'Reds';
    if (currentGeoJSON) {
      const hasRatio = !!currentGeoJSON.features[0]?.properties?.hasOwnProperty('IMPR_LAND_RATIO');
      if (hasRatio) {
        currentField = 'IMPR_LAND_RATIO';
        fieldSelect.value = 'IMPR_LAND_RATIO';
      }
    }
    if (map.getLayer(LAYER_ID)) map.setFilter(LAYER_ID, null);
    computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL);
    applyExtrusion();
  }
}

function populateCategoryOptions(fc: GeoJSON.FeatureCollection) {
  const vals = new Set<string>();
  for (const f of fc.features) {
    const v = String((f.properties as any)?.[DEV_CATEGORY_FIELD] ?? '').trim();
    if (v) vals.add(v);
  }
  categoryContainer.innerHTML = '';
  const list = Array.from(vals).sort();
  for (const v of list) {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.gap = '8px';
    label.style.alignItems = 'center';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = v;
    input.checked = true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(v));
    categoryContainer.appendChild(label);
  }
}

function fmtCurrencyRounded(n: number): string {
  if (n >= 1_000_000) return `~$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')} million`;
  const v = Math.round(n / 1000) * 1000;
  return `~$${v.toLocaleString()}`;
}

function updateUnderTotals(fc: GeoJSON.FeatureCollection) {
  const totals: Record<string, number> = { Vacant: 0, 'Parking Lot': 0, Underdeveloped: 0 };
  let totalNonExempt = 0;
  for (const f of fc.features) {
    const p = f.properties as any;
    const land = Number(p?.REALLANDVA);
    if (!Number.isFinite(land)) continue;
    const exempt = Number(p?.exemption_flag) !== 0;
    if (!exempt) totalNonExempt += land;
    const cat = String(p?.[DEV_CATEGORY_FIELD] ?? '');
    if (!exempt && totals.hasOwnProperty(cat)) totals[cat] += land;
  }
  const sumUnder = totals['Vacant'] + totals['Parking Lot'] + totals['Underdeveloped'];
  const pct = (v: number) => totalNonExempt ? ((v / totalNonExempt) * 100).toFixed(1) + '%' : '0%';
  underTotals.innerHTML = `
    <div class="totals-card">
      <div class="totals-title">Underutilized Land (nonexempt)</div>
      <div class="totals-grid">
        <div class="label">Vacant</div>
        <div class="value">${fmtCurrencyRounded(totals['Vacant'])} <span class="pct">${pct(totals['Vacant'])}</span></div>

        <div class="label">Parking Lot</div>
        <div class="value">${fmtCurrencyRounded(totals['Parking Lot'])} <span class="pct">${pct(totals['Parking Lot'])}</span></div>

        <div class="label">Underdeveloped</div>
        <div class="value">${fmtCurrencyRounded(totals['Underdeveloped'])} <span class="pct">${pct(totals['Underdeveloped'])}</span></div>

        <div class="label">Nonexempt Total</div>
        <div class="value">${fmtCurrencyRounded(totalNonExempt)}</div>

        <div class="label sum-row">Sum of These</div>
        <div class="value sum-row">${fmtCurrencyRounded(sumUnder)} <span class="pct">${pct(sumUnder)}</span></div>
      </div>
    </div>`;
}

function setBasemap(name: string) {
  const style = BASEMAP_STYLES[name] || BASEMAP_STYLES['OpenStreetMap'];
  basemapSelect.value = name;
  const all = [map, mapUnder, mapRatio];
  for (const m of all) {
    const onError = (e: any) => {
      if (e?.sourceId !== 'ofm-tiles') return;
      console.warn('Basemap load failed, reverting to OpenStreetMap', e);
      m.off('error', onError);
      basemapSelect.value = 'OpenStreetMap';
      m.setStyle(BASEMAP_STYLES['OpenStreetMap']);
    };
    if (name === 'OpenFreeMap') m.on('error', onError);
    m.setStyle(style);
    m.once('styledata', () => {
      m.off('error', onError);
      if (currentGeoJSON) {
        addOrUpdateSourceFor(m, m === map /*withClick on main*/);
        if (m === mapUnder) renderUnderNow();
        if (m === mapRatio) renderRatioNow();
      }
    });
  }
  // Re-render secondary maps with current choices
  renderUnderNow();
  renderRatioNow();
}


function applyFilterAndScaling() {
  if (!currentGeoJSON) return;
  const selected = categoryInputs().filter(i => i.checked).map(i => i.value);
  let filter: Expression | null = null;
  if (selected.length) {
    filter = ['in', ['get', DEV_CATEGORY_FIELD], ['literal', selected]] as any;
  }
  map.setFilter(LAYER_ID, filter as any);

  if (scaleFiltered.checked && selected.length) {
    const filtered: GeoJSON.Feature[] = currentGeoJSON.features.filter(f => selected.includes(String((f.properties as any)?.[DEV_CATEGORY_FIELD] ?? '')));
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: filtered };
    computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL, fc);
  } else {
    computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL);
  }
  applyExtrusion();
}

function renderUnderNow() {
  if (!currentGeoJSON || !mapUnder.getLayer(LAYER_ID)) return;
  const selected = categoryInputs().filter(i => i.checked).map(i => i.value);
  let filter: any = null;
  if (selected.length) filter = ['in', ['get', DEV_CATEGORY_FIELD], ['literal', selected]] as any;
  mapUnder.setFilter(LAYER_ID, filter);

  const filteredFc = (scaleFiltered.checked && selected.length)
    ? { type: 'FeatureCollection', features: currentGeoJSON.features.filter(f => selected.includes(String((f.properties as any)?.[DEV_CATEGORY_FIELD] ?? ''))) } as GeoJSON.FeatureCollection
    : undefined;

  const field = currentField || 'REALLANDVA';
  renderMapFor(
    mapUnder,
    field,
    normalizationMode,
    /*invert*/ underInvertHeights?.checked || false,
    underRampSelect?.value || rampSelect.value,
    /*reverse*/ false,
    parseFloat(underOpacityInput?.value || '0'),
    filteredFc
  );
}

function renderRatioNow() {
  if (!currentGeoJSON || !mapRatio.getLayer(LAYER_ID)) return;
  renderMapFor(
    mapRatio,
    'IMPR_LAND_RATIO',
    'asis',
    /*invert*/ ratioInvertHeights?.checked ?? true,
    ratioRampSelect?.value || 'Reds',
    /*reverse*/ true,
    parseFloat(ratioOpacityInput?.value || '0')
  );
}


function fitToData(fc: GeoJSON.FeatureCollection) {
  const b = bbox(fc); if (!b) return;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 800 });
}

function fitToDataAll(fc: GeoJSON.FeatureCollection) {
  const b = bbox(fc); if (!b) return;
  const bounds: [[number, number], [number, number]] = [[b[0], b[1]], [b[2], b[3]]];
  map.fitBounds(bounds, { padding: 40, duration: 800 });
  mapUnder.fitBounds(bounds, { padding: 40, duration: 800 });
  mapRatio.fitBounds(bounds, { padding: 40, duration: 800 });
}

// ---- Quality toggle (runtime supersampling) ----
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

/* ---------------- Helpers ---------------- */
function computeDisplayedMetricFromProps(props: Record<string, any>): number | null {
  if (!currentField) return null;
  let base: number | null;
  if (currentField === 'IMPR_LAND_RATIO') {
    const num = numOrNull(props.REALIMPROV);
    const den = numOrNull(props.REALLANDVA);
    base = (num != null && den != null && den > 0) ? num / den : null;
  } else {
    base = numOrNull(props[currentField]);
  }
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

// Queue an update; newer calls replace older ones.
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
  if (!list.length) fieldSelect.append(new Option('No numeric fields available', ''));
  else {
    fieldSelect.append(new Option('— choose —', ''));
    for (const n of list) fieldSelect.append(new Option(FIELD_LABELS[n] ?? n, n));
  }
}

function polygonsOnly(fc: GeoJSON.FeatureCollection) {
  return fc.features.filter(
    f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  );
}

function getNumericValuesNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding'): number[] {
  const vals: number[] = [];
  for (const f of fc.features) {
    const p = (f.properties as any) || {};
    let base: number;
    if (field === 'IMPR_LAND_RATIO') {
      const num = Number(p?.REALIMPROV);
      const den = Number(p?.REALLANDVA);
      if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) continue;
      base = num / den;
    } else {
      base = Number(p?.[field]);
      if (!Number.isFinite(base)) continue;
    }

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

// Build a step expression: first color is < break1, then each break raises the color.
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

// Auto-multiplier so p-th percentile reaches capMeters, in given units
function computeAndApplyAutoMultiplier(
  unitsKeyOrAuto: 'auto' | keyof typeof UNIT_TO_METERS = 'auto',
  capMeters = 1000,
  p = 99,
  fcOverride?: GeoJSON.FeatureCollection
) {
  const src = fcOverride || currentGeoJSON;
  if (!src || !currentField) return;

  // values for the CURRENT normalization mode
  const vals = getNumericValuesNormalized(src, currentField, normalizationMode);
  let scaleVals = vals;
  if (invertHeights.checked) {
    let maxV = -Infinity;
    for (const v of vals) if (v > maxV) maxV = v;
    scaleVals = vals.map(v => maxV - v);
  }
  const pVal = percentile(scaleVals, p);
  if (!Number.isFinite(pVal) || pVal <= 0) return;

  // ---- Color domain / breaks ----
  if (colorMode === 'quantiles') {
    let ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    if (reverseColors && ramp) ramp = ramp.slice().reverse();
    colorBreaks = quantileBreaks(vals, ramp.length, 1, 99); // p1..p99 equal-frequency bins
    colorDomain = null;
  } else {
    // continuous = EQUAL INTERVAL classes across p1..p99
    let ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    if (reverseColors && ramp) ramp = ramp.slice().reverse();
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
  currentStats = computeStatsNormalized(src, currentField, normalizationMode);

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

function updateLegend() {
  let ramp = COLOR_RAMPS[rampSelect.value] || [];
  if (reverseColors && ramp.length) ramp = ramp.slice().reverse();
  legendEl.replaceChildren();
  if (!ramp.length) { legendEl.style.display = 'none'; return; }

  const row = document.createElement('div');
  row.style.display = 'flex'; row.style.gap = '6px'; row.style.alignItems = 'center'; row.style.flexWrap = 'wrap';

  const label = document.createElement('div'); label.textContent = 'Legend:'; label.style.fontSize = '12px';
  row.appendChild(label);

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

  const fieldsToShow = ALL_FIELDS;

  const rows = fieldsToShow.map(k => {
    const v = (props as any)[k];
    const printable = (typeof v === 'number') ? fmt(v) : (v ?? '—');
    const label = FIELD_LABELS[k] || k;
    return `
      <tr>
        <td style="padding:2px 6px; overflow-wrap:anywhere;">
          <code style="white-space:normal;">${label}</code>
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

function onMultInput() {
  const v = Number(multInput.value);
  if (!Number.isFinite(v)) return; // ignore interim typing states
  scheduleUpdate('applyOnly');
}

/* ---------------- Events ---------------- */

// Only recompute after data is loaded
[colorCont, colorQuant].forEach(el =>
  el?.addEventListener('change', () => {
    if (!currentGeoJSON) return;
    const val = (document.querySelector('input[name="colorMode"]:checked') as HTMLInputElement)?.value;
    if (val === 'continuous' || val === 'quantiles') {
      colorMode = val;
      scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
      saveSettings(currentTab);
    }
  })
);

rampSelect.addEventListener('change', () => {
  const needsRecompute = (colorMode === 'quantiles');
  scheduleUpdate(needsRecompute ? 'recomputeAndAutoScale' : 'applyOnly', /*refreshLegend*/ true);
  saveSettings(currentTab);
  renderUnderNow();
  renderRatioNow();
});

multInput.addEventListener('input', () => { onMultInput(); saveSettings(currentTab); });

multInput.addEventListener('change', () => { onMultInput(); saveSettings(currentTab); });

unitsSelect.addEventListener('change', () => { scheduleUpdate('applyOnly'); saveSettings(currentTab); });

opacityInput.addEventListener('input', () => {
  if (opacityOut) opacityOut.value = Number(opacityInput.value).toFixed(2);
  scheduleUpdate('applyOnly');
  saveSettings(currentTab);
  renderUnderNow();
  renderRatioNow();
});

// Under map listeners
underRampSelect?.addEventListener('change', () => { renderUnderNow(); });
underOpacityInput?.addEventListener('input', () => { if (underOpacityOut) underOpacityOut.value = Number(underOpacityInput.value).toFixed(2); renderUnderNow(); });
underInvertHeights?.addEventListener('change', () => { renderUnderNow(); });

// Ratio map listeners
ratioRampSelect?.addEventListener('change', () => { renderRatioNow(); });
ratioOpacityInput?.addEventListener('input', () => { if (ratioOpacityOut) ratioOpacityOut.value = Number(ratioOpacityInput.value).toFixed(2); renderRatioNow(); });
ratioInvertHeights?.addEventListener('change', () => { renderRatioNow(); });

fieldSelect.addEventListener('change', () => {
  currentField = fieldSelect.value || null;
  if (!currentGeoJSON || !currentField) return;
  scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
  saveSettings(currentTab);
});

async function loadDefaultDataset() {
  try {
    lastAsyncBuffer = await urlToAsyncBuffer('southbend.parquet');
    await loadSelectedColumns();
  } catch (err) {
    console.warn('Default dataset load failed', err);
  }
}

/* ---------------- Main ---------------- */

document.querySelectorAll<HTMLInputElement>('input[name="normMode"]').forEach(r => {
  r.addEventListener('change', () => {
    normalizationMode = (document.querySelector('input[name="normMode"]:checked') as HTMLInputElement)?.value as any;
    if (!currentGeoJSON || !currentField) return;
    scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
    saveSettings(currentTab);
  });
});

async function init() {
  await loadDataDictionary();
  unitsSelect.value = 'centimeters';
  // Defer all map-mutating actions until the style is fully loaded.
  map.once('load', async () => {
    setQuality('high');
    // Apply any saved basemap/style; re-add data after style switches.
    loadSettings('main');
    await loadDefaultDataset();
  });
}
init();
