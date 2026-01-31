// Imports
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import type { Expression } from 'maplibre-gl';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';
import { parquetMetadataAsync, parquetSchema } from 'hyparquet';


// Local imports
import { OSM_STYLE, SATELLITE_STYLE, SOURCE_ID, LAYER_ID, ERROR_LAYER_ID, HEIGHT_CAP_METERS, HEIGHT_PCTL, COLOR_RAMPS, UNIT_TO_METERS } from './config';
import { coerceScalar, sanitizeFeatureInPlace, sanitizeFeaturesInPlace, fileToAsyncBuffer, } from './utils.sanitize';
import { type AsyncBuffer } from './utils.sanitize';
import { roundGeometryInPlace, trimPropertiesInPlace, bbox } from './utils.geo';
import { numOrNull, fmt, percentile, quantileBreaks } from './utils.number';
import { makeFieldCheckbox, divider } from './utils.dom';
import type {
  BasemapMode,
  NumericFilterOperator, CategoricalFilterOperator,
  ParcelFieldPatch,
  QualityMode, UpdateMode, MetricUnitKey,
  SubjectMode, LandSchedulePerUnit, LandScheduleBaseLot,
  LayerState, DataStore, SubjectSelectorControls, SubjectSelectorOptions
} from './types';


import { S, LAND_SCHEDULE_DEFAULT_KEY, LAND_SCHEDULE_DEFAULT_LABEL } from './state';
import {
  initFilterElements, initFilterCallbacks,
  cloneFilters,
  setSavedFiltersPanelMode, updateSavedFiltersUIState,
  saveCurrentFilters, applySavedFilter,
  getCategoricalValues,
  buildSavedFilterExpression, evaluateFilterExpression,
  buildLayerVisibilityExpression,
  applyMapFilters, applyVisibilityFilters,
  createFilterRule, updateFiltersUIState, renderFiltersList,
  refreshFiltersUI, renderSubjectFilterOptions,
  applyActiveFilterAction, setFilterActionMode,
} from './filters';
import {
  createWindowManager, initWindowCallbacks, initPositionElements,
  positionPaintPanel, positionSettingsPanel, positionStatisticsPanel,
  positionScatterplotPanel, positionFiltersPanel, positionLandSchedulePanel,
  updateFiltersPanelLayout, updatePaintButtonState,
  makeDraggable, handleMouseMove, handleMouseUp,
  type WindowManager
} from './windows';
import {
  initSelection, initSelectionElements,
  handleRectangleMouseDown, handleRectangleMouseMove, handleRectangleMouseUp,
  featureIntersectsBbox,
  applyCategorySelection, applyRangeSelection,
  getParcelId, findFeatureByParcelId,
  addParcelToSelection, removeParcelFromSelection, clearAllSelections,
  updateSelectionControls, updateSelectionControlsPosition,
  handleLassoMouseDown, handleLassoMouseMove, handleLassoMouseUp,
  handlePolygonMouseDown, handlePolygonMouseMove, handlePolygonDoubleClick,
} from './selection';
import {
  initLegendElements, initLegendCallbacks,
  hideFloatingLegend, clearLegendVisibility,
  updateFloatingLegend, updateLegendPosition,
  updateHighlightColors,
  applyExtrusionWithCustomColors, applyExtrusionWithVisibility,
} from './legend';
(window as any).savedFiltersStore = S.savedFiltersStore;

/* ---------------- Map Bootstrap ----------------- */


const HQ_PR = Math.min(3, window.devicePixelRatio * 2); // 2–3 is a good "HQ" target

S.map = new maplibregl.Map({
  container: 'map',
  style: OSM_STYLE,
  center: [-95.3698, 29.7604],
  zoom: 10,
  pitch: 45,
  bearing: -20,
  hash: true,
  boxZoom: false,
  doubleClickZoom: false,
  pixelRatio: HQ_PR // supersample: render at higher internal resolution (smooth lines)
});
S.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');


function updateBasemapButtonStates() {
  basemapButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.basemap === S.currentBasemap);
  });
}

const BASEMAP_LAYER_IDS: Record<BasemapMode, string> = {
  streets: 'osm-tiles',
  satellite: 'satellite-tiles',
  none: 'background'
};

const BASEMAP_SOURCE_IDS: Partial<Record<BasemapMode, string>> = {
  streets: 'osm-tiles',
  satellite: 'satellite-tiles'
};

const ALL_BASEMAP_LAYER_IDS = new Set(Object.values(BASEMAP_LAYER_IDS));

function getBasemapSourceConfig(mode: BasemapMode) {
  if (mode === 'streets') {
    return OSM_STYLE.sources['osm-tiles'];
  }
  if (mode === 'satellite') {
    return SATELLITE_STYLE.sources['satellite-tiles'];
  }
  return null;
}

function getBasemapInsertBeforeId() {
  const styleLayers = S.map.getStyle().layers ?? [];
  const nextLayer = styleLayers.find(layer => !ALL_BASEMAP_LAYER_IDS.has(layer.id));
  return nextLayer?.id;
}

function removeBasemap(mode: BasemapMode) {
  const layerId = BASEMAP_LAYER_IDS[mode];
  if (S.map.getLayer(layerId)) {
    S.map.removeLayer(layerId);
  }
  const sourceId = BASEMAP_SOURCE_IDS[mode];
  if (sourceId && S.map.getSource(sourceId)) {
    S.map.removeSource(sourceId);
  }
}

function addBasemap(mode: BasemapMode) {
  const beforeId = getBasemapInsertBeforeId();
  if (mode === 'none') {
    S.map.addLayer({
      id: BASEMAP_LAYER_IDS.none,
      type: 'background',
      paint: { 'background-color': '#f8f8f8' }
    }, beforeId);
    return;
  }

  const sourceConfig = getBasemapSourceConfig(mode);
  if (!sourceConfig) return;
  const sourceId = BASEMAP_SOURCE_IDS[mode]!;
  if (!S.map.getSource(sourceId)) {
    S.map.addSource(sourceId, {
      type: 'raster',
      tiles: sourceConfig.tiles,
      tileSize: sourceConfig.tileSize,
      attribution: sourceConfig.attribution
    });
  }
  S.map.addLayer({
    id: BASEMAP_LAYER_IDS[mode],
    type: 'raster',
    source: sourceId,
    minzoom: sourceConfig.minzoom ?? 0,
    maxzoom: sourceConfig.maxzoom ?? 19
  }, beforeId);
}

function setBasemapMode(mode: BasemapMode) {
  if (mode === S.currentBasemap) return;
  removeBasemap(S.currentBasemap);
  S.currentBasemap = mode;
  updateBasemapButtonStates();
  addBasemap(mode);
}

/* ---------------- Cursor Management ---------------- */

// Update cursor based on active tool
function updateCursor() {
  if (S.isInfoToolActive) {
    S.map.getCanvas().style.cursor = 'pointer';
  } else if (S.isPanToolActive) {
    S.map.getCanvas().style.cursor = 'grab';
  } else {
    // When SELECT mode is engaged, use arrow cursor
    S.map.getCanvas().style.cursor = 'default';
  }
}

/* ---------------- Helper Functions ---------------- */

// Helper function to get viewport coordinates for visual elements
function getViewportPoint(e: MouseEvent): maplibregl.Point {
  return new maplibregl.Point(e.clientX, e.clientY);
}

// Helper function to convert viewport coordinates to map container coordinates
function getMapPoint(e: MouseEvent): maplibregl.Point {
  const canvas = S.map.getCanvas();
  const rect = canvas.getBoundingClientRect();
  return new maplibregl.Point(
    e.clientX - rect.left,
    e.clientY - rect.top
  );
}

// Pan tool mouse handlers - just for cursor management
function handlePanMouseDown(e: MouseEvent) {
  if (!S.isPanToolActive || e.button !== 0) return;
  
  S.isPanning = true;
  S.map.getCanvas().style.cursor = 'grabbing';
}

function handlePanMouseMove(_e: MouseEvent) {
  // No special handling needed - MapLibre handles the panning
}

function handlePanMouseUp(_e: MouseEvent) {
  if (!S.isPanToolActive || !S.isPanning) return;
  
  S.isPanning = false;
  S.map.getCanvas().style.cursor = 'grab';
}


/* ---------------- Pan Tool ---------------- */


/* ---------------- Selection (see ./selection.ts) ---------------- */


/* ---------------- UI elements ---------------- */


const fileInput = document.getElementById('file') as HTMLInputElement;
const fieldSelect = document.getElementById('field') as HTMLSelectElement;
const rampSelect = document.getElementById('ramp') as HTMLSelectElement;
const enable3DCheckbox = document.getElementById('enable3D') as HTMLInputElement;
const extrusionOptions = document.getElementById('extrusionOptions') as HTMLFieldSetElement;
const multInput = document.getElementById('mult') as HTMLInputElement;
const unitsSelect = document.getElementById('units') as HTMLSelectElement;
const layerList = document.getElementById('layerList') as HTMLDivElement;
const addLayerFromStoreButton = document.getElementById('addLayerFromStore') as HTMLButtonElement;
const settingsOtherActions = document.getElementById('settingsOtherActions') as HTMLDivElement;
const btnPaintMenu = document.getElementById('btnPaintMenu') as HTMLButtonElement;
const opacityInput = document.getElementById('opacity') as HTMLInputElement;
const opacityOut = document.getElementById('opacityVal') as HTMLOutputElement
const normAsIs = document.getElementById('norm-asis') as HTMLInputElement;
const normLand = document.getElementById('norm-land') as HTMLInputElement;
const normBldg = document.getElementById('norm-bldg') as HTMLInputElement;
const normLandUnitEl = document.getElementById('normLandUnit') as HTMLElement;
const normBldgUnitEl = document.getElementById('normBldgUnit') as HTMLElement;
const colorRampOptions = document.getElementById('colorRampOptions') as HTMLFieldSetElement;
const colorScalingOptions = document.getElementById('colorScalingOptions') as HTMLFieldSetElement;
const opacityOptions = document.getElementById('opacityOptions') as HTMLFieldSetElement;
const paintDividerNumeric = document.getElementById('paintDividerNumeric') as HTMLDivElement;
const paintDividerCategorical = document.getElementById('paintDividerCategorical') as HTMLDivElement;
const paintDividerRamp = document.getElementById('paintDividerRamp') as HTMLDivElement;
const paintDividerScaling = document.getElementById('paintDividerScaling') as HTMLDivElement;
const currentLayerSource = document.getElementById('currentLayerSource') as HTMLDivElement;
const basemapButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-basemap]'));

// Camera view buttons
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
(document.getElementById('btn-persp') as HTMLButtonElement)?.addEventListener('click', () => setPerspective());
(document.getElementById('btn-ortho') as HTMLButtonElement)?.addEventListener('click', () => setOrtho());
viewButtons.forEach(btn => btn.onclick = () => setView(btn.dataset.view!));

basemapButtons.forEach(button => {
  button.addEventListener('click', () => {
    const mode = button.dataset.basemap as BasemapMode | undefined;
    if (mode) {
      setBasemapMode(mode);
    }
  });
});
updateBasemapButtonStates();

// Zoom to data button
const btnZoomTo = document.getElementById('btn-zoomto') as HTMLButtonElement;
btnZoomTo.onclick = () => { if (S.currentGeoJSON) fitToData(S.currentGeoJSON); };
if (addLayerFromStoreButton) {
  addLayerFromStoreButton.addEventListener('click', () => {
    openAddLayerModal();
  });
}

// Window elements
const controlsEl = document.getElementById('controls') as HTMLDivElement;
const settingsContent = document.getElementById('settingsContent') as HTMLDivElement;
const settingsControlsEl = document.getElementById('settingsControls') as HTMLDivElement;
const settingsMenuContent = document.getElementById('settingsMenuContent') as HTMLDivElement;
const paintControlsEl = document.getElementById('paintControls') as HTMLDivElement;
const paintContent = document.getElementById('paintContent') as HTMLDivElement;
const statisticsControlsEl = document.getElementById('statisticsControls') as HTMLDivElement;
const statisticsContent = document.getElementById('statisticsContent') as HTMLDivElement;
const statsSubjectSection = document.getElementById('statsSubjectSection') as HTMLDivElement;
const statsLayerSelect = document.getElementById('statsLayerSelect') as HTMLSelectElement;
const scatterplotControlsEl = document.getElementById('scatterplotControls') as HTMLDivElement;
const scatterplotContent = document.getElementById('scatterplotContent') as HTMLDivElement;
const scatterLayerSelect = document.getElementById('scatterLayerSelect') as HTMLSelectElement;
const scatterSubjectSection = document.getElementById('scatterSubjectSection') as HTMLDivElement;
const scatterXFieldSelect = document.getElementById('scatterXField') as HTMLSelectElement;
const scatterYFieldSelect = document.getElementById('scatterYField') as HTMLSelectElement;
const scatterXMinInput = document.getElementById('scatterXMin') as HTMLInputElement;
const scatterXMaxInput = document.getElementById('scatterXMax') as HTMLInputElement;
const scatterYMinInput = document.getElementById('scatterYMin') as HTMLInputElement;
const scatterYMaxInput = document.getElementById('scatterYMax') as HTMLInputElement;
const scatterResetExtentsButton = document.getElementById('scatterResetExtents') as HTMLButtonElement;
const scatterPlot = document.getElementById('scatterPlot') as HTMLDivElement;
const scatterPlotEmpty = document.getElementById('scatterPlotEmpty') as HTMLDivElement;
const filtersControlsEl = document.getElementById('filtersControls') as HTMLDivElement;
const filtersContent = document.getElementById('filtersContent') as HTMLDivElement;
const filtersListEl = document.getElementById('filtersList') as HTMLDivElement;
const filtersInvertToggle = document.getElementById('filtersInvertToggle') as HTMLInputElement;
const addFilterButton = document.getElementById('addFilterButton') as HTMLButtonElement;
const filtersSaveToggle = document.getElementById('filtersSaveToggle') as HTMLButtonElement;
const filtersLoadToggle = document.getElementById('filtersLoadToggle') as HTMLButtonElement;
const filtersSavePanel = document.getElementById('filtersSavePanel') as HTMLDivElement;
const filtersLoadPanel = document.getElementById('filtersLoadPanel') as HTMLDivElement;
const filtersSaveControls = document.getElementById('filtersSaveControls') as HTMLDivElement;
const filtersSaveNameInput = document.getElementById('filtersSaveName') as HTMLInputElement;
const filtersSaveConfirmButton = document.getElementById('filtersSaveConfirm') as HTMLButtonElement;
const filtersSavedStatus = document.getElementById('filtersSavedStatus') as HTMLDivElement;
const filtersLoadControls = document.getElementById('filtersLoadControls') as HTMLDivElement;
const filtersLoadSelect = document.getElementById('filtersLoadSelect') as HTMLSelectElement;
const filtersSelectButton = document.getElementById('filtersSelectButton') as HTMLButtonElement;
const filtersShowButton = document.getElementById('filtersShowButton') as HTMLButtonElement;
const filtersHideButton = document.getElementById('filtersHideButton') as HTMLButtonElement;

const statsSubjectControls = buildSubjectSelector(statsSubjectSection);
const scatterSubjectControls = buildSubjectSelector(scatterSubjectSection, { title: null });

const statsSubjectButtons = statsSubjectControls.buttons;
const statsCategoryFieldSelect = statsSubjectControls.categoryFieldSelect;
const statsCategoryValueSelect = statsSubjectControls.categoryValueSelect;

const scatterSubjectButtons = scatterSubjectControls.buttons;
const scatterCategoryFieldSelect = scatterSubjectControls.categoryFieldSelect;
const scatterCategoryValueSelect = scatterSubjectControls.categoryValueSelect;
const statsFieldSelect = document.getElementById('statsField') as HTMLSelectElement;
const statsDetails = document.getElementById('statsDetails') as HTMLDivElement;
const statsNumericBlock = document.getElementById('statsNumericBlock') as HTMLDivElement;
const statsCategoricalBlock = document.getElementById('statsCategoricalBlock') as HTMLDivElement;
const statsNormalizationControls = document.getElementById('statsNormalizationControls') as HTMLDivElement;
const statisticsSection = document.getElementById('statisticsSection') as HTMLDivElement;
const statsParcelCount = document.getElementById('statsParcelCount') as HTMLSpanElement;
const statsMedian = document.getElementById('statsMedian') as HTMLSpanElement;
const statsMean = document.getElementById('statsMean') as HTMLSpanElement;
const statsStdDev = document.getElementById('statsStdDev') as HTMLSpanElement;
const statsCod = document.getElementById('statsCod') as HTMLSpanElement;
const statsPercentiles = document.getElementById('statsPercentiles') as HTMLTableSectionElement;
const statsHistogram = document.getElementById('statsHistogram') as HTMLDivElement;
const statsCategoricalParcelCount = document.getElementById('statsCategoricalParcelCount') as HTMLSpanElement;
const statsCategoricalUniqueCount = document.getElementById('statsCategoricalUniqueCount') as HTMLSpanElement;
const statsCategoricalModalValue = document.getElementById('statsCategoricalModalValue') as HTMLSpanElement;
const statsCategoricalValues = document.getElementById('statsCategoricalValues') as HTMLTableSectionElement;
const statsNormAsIs = document.getElementById('stats-norm-asis') as HTMLInputElement;
const statsNormLand = document.getElementById('stats-norm-land') as HTMLInputElement;
const statsNormBldg = document.getElementById('stats-norm-bldg') as HTMLInputElement;
const statsNormLandUnitEl = document.getElementById('statsNormLandUnit') as HTMLElement;
const statsNormBldgUnitEl = document.getElementById('statsNormBldgUnit') as HTMLElement;
const statsOverflowMinPct = document.getElementById('statsOverflowMinPct') as HTMLInputElement;
const statsOverflowMaxPct = document.getElementById('statsOverflowMaxPct') as HTMLInputElement;
const landScheduleControlsEl = document.getElementById('landScheduleControls') as HTMLDivElement;
const landScheduleContent = document.getElementById('landScheduleContent') as HTMLDivElement;
const landScheduleFieldSelect = document.getElementById('landScheduleFieldSelect') as HTMLSelectElement;
const landScheduleValueRow = document.getElementById('landScheduleValueRow') as HTMLDivElement;
const landScheduleFieldLabel = document.getElementById('landScheduleFieldLabel') as HTMLSpanElement;
const landScheduleValueSelect = document.getElementById('landScheduleValueSelect') as HTMLSelectElement;
const landScheduleValuationSection = document.getElementById('landScheduleValuationSection') as HTMLDivElement;
const landScheduleBaseMin = document.getElementById('landScheduleBaseMin') as HTMLInputElement;
const landScheduleBaseMax = document.getElementById('landScheduleBaseMax') as HTMLInputElement;
const landScheduleBaseValue = document.getElementById('landScheduleBaseValue') as HTMLInputElement;
const landScheduleBasePer = document.getElementById('landScheduleBasePer') as HTMLSelectElement;

const EYE_ICON_OPEN = new URL('./svg/eye.svg', import.meta.url).href;
const EYE_ICON_CLOSED = new URL('./svg/eye_closed.svg', import.meta.url).href;
const PENCIL_ICON = new URL('./svg/pencil.svg', import.meta.url).href;

function setEyeButtonIcon(button: HTMLButtonElement, isHidden: boolean) {
  const img = button.querySelector('img');
  if (!img) return;
  img.src = isHidden ? EYE_ICON_CLOSED : EYE_ICON_OPEN;
  img.alt = isHidden ? 'Hidden' : 'Visible';
}

function createEyeButton(isHidden: boolean, title: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'eye-button';
  button.title = title;
  const img = document.createElement('img');
  img.src = isHidden ? EYE_ICON_CLOSED : EYE_ICON_OPEN;
  img.alt = isHidden ? 'Hidden' : 'Visible';
  button.appendChild(img);
  return button;
}

// Quality button (create after elements are declared)
const btnQuality = document.createElement('button');
btnQuality.id = 'btn-quality';
btnQuality.textContent = 'Quality: Fast';
btnQuality.onclick = () => setQuality(S.qualityMode === 'high' ? 'fast' : 'high');
if (settingsOtherActions) {
  settingsOtherActions.prepend(btnQuality);
} else {
  settingsMenuContent.prepend(btnQuality);
}
const btnMinimizeLayers = document.getElementById('btnMinimizeLayers') as HTMLButtonElement;
const btnMinimizeSettingsMenu = document.getElementById('btnMinimizeSettingsMenu') as HTMLButtonElement;
const btnMinimizePaint = document.getElementById('btnMinimizePaint') as HTMLButtonElement;
const btnMinimizeStatistics = document.getElementById('btnMinimizeStatistics') as HTMLButtonElement;
const btnMinimizeScatterplot = document.getElementById('btnMinimizeScatterplot') as HTMLButtonElement;
const btnMinimizeFilters = document.getElementById('btnMinimizeFilters') as HTMLButtonElement;
const btnMinimizeLandSchedule = document.getElementById('btnMinimizeLandSchedule') as HTMLButtonElement;

// Toolbar elements
const legendToolButton = document.getElementById('legendToolButton') as HTMLButtonElement;
const statisticsToolButton = document.getElementById('statisticsToolButton') as HTMLButtonElement;
const scatterplotToolButton = document.getElementById('scatterplotToolButton') as HTMLButtonElement;
const filtersToolButton = document.getElementById('filtersToolButton') as HTMLButtonElement;
const landScheduleToolButton = document.getElementById('landScheduleToolButton') as HTMLButtonElement;

// Floating legend elements
const floatingLegend = document.getElementById('floatingLegend') as HTMLDivElement;
const btnMinimizeLegend = document.getElementById('btnMinimizeLegend') as HTMLButtonElement;
const legendTitle = document.getElementById('legendTitle') as HTMLDivElement;
const legendContent = document.getElementById('legendContent') as HTMLDivElement;

// Modal overlays
const numericModalOverlay = document.getElementById('numericModalOverlay')!;
const categoricalModalOverlay = document.getElementById('categoricalModalOverlay')!;
const sizeOverlay = document.getElementById('sizeOverlay')!;
const addLayerOverlay = document.getElementById('addLayerOverlay') as HTMLDivElement;
const loadingOverlay = document.getElementById('loadingOverlay')!;

// Numeric modal elements
const rowCountEl = document.getElementById('rowCount')!;
const geomColEl = document.getElementById('geomCol')!;
const numericFieldListEl = document.getElementById('numericFieldList')!;

const btnAllNumeric = document.getElementById('btnAllNumeric') as HTMLButtonElement;
const btnNoneNumeric = document.getElementById('btnNoneNumeric') as HTMLButtonElement;
const btnCancelNumericModal = document.getElementById('btnCancelNumericModal') as HTMLButtonElement;
const btnConfirmNumericModal = document.getElementById('btnConfirmNumericModal') as HTMLButtonElement;

// Categorical modal elements
const categoricalRowCountEl = document.getElementById('categoricalRowCount')!;
const categoricalGeomColEl = document.getElementById('categoricalGeomCol')!;
const categoricalFieldListEl = document.getElementById('categoricalFieldList')!;

const btnAllCategorical = document.getElementById('btnAllCategorical') as HTMLButtonElement;
const btnNoneCategorical = document.getElementById('btnNoneCategorical') as HTMLButtonElement;
const btnCancelCategoricalModal = document.getElementById('btnCancelCategoricalModal') as HTMLButtonElement;
const btnConfirmCategoricalModal = document.getElementById('btnConfirmCategoricalModal') as HTMLButtonElement;

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

const dataStoreList = document.getElementById('dataStoreList') as HTMLDivElement;
const btnBrowseDataSource = document.getElementById('btnBrowseDataSource') as HTMLButtonElement;
const btnCancelAddLayer = document.getElementById('btnCancelAddLayer') as HTMLButtonElement;

// Color scaling radios
const colorCont = document.getElementById('color-cont') as HTMLInputElement | null;
const colorQuant = document.getElementById('color-quant') as HTMLInputElement | null;

// Color picker elements
const colorOptions = document.getElementById('colorOptions') as HTMLDivElement;
const colorPicker = document.getElementById('colorPicker') as HTMLInputElement;
const btnCancelColorPicker = document.getElementById('btnCancelColorPicker') as HTMLButtonElement;
const btnConfirmColorPicker = document.getElementById('btnConfirmColorPicker') as HTMLButtonElement;

// Color ramp choices
for (const key of Object.keys(COLOR_RAMPS)) {
  const opt = document.createElement('option'); opt.value = key; opt.textContent = key; rampSelect.appendChild(opt);
}
rampSelect.value = 'Viridis';


/* ---------------- Constants ---------------- */


// Token sets we match against
const UNIT_TOKENS = new Set([
  'sqft','ft2','sf','sqm','m2','km2','sqkm','mi2','sqmi',
  'ac','acre','acres','ha','hectare','hectares','acreage'
]);

const AREA_UNIT_CHOICES: { key: string, label: string }[] = [
  { key: 'sqm', label: 'square meters (m²)' },
  { key: 'sqft', label: 'square feet (ft²)' },
  { key: 'acres', label: 'acres' },
  { key: 'hectares', label: 'hectares' },
  { key: 'sqkm', label: 'square kilometers (km²)' },
  { key: 'sqmi', label: 'square miles (mi²)' },
  { key: 'other', label: 'other / unknown' }
];

const FAST_PR = window.devicePixelRatio;                  // normal speed
const HIGH_PR = Math.min(3, window.devicePixelRatio * 2); // 2–3x is a good HQ target


/* ---------------- FUNCTIONS ----------------- */

function getCurrentLayer(): LayerState | null {
  return S.currentLayerId ? S.layers.get(S.currentLayerId) ?? null : null;
}

function getCurrentLayerIds() {
  const layer = getCurrentLayer();
  if (!layer) return null;
  return { sourceId: layer.sourceId, layerId: layer.layerId, errorLayerId: layer.errorLayerId };
}

function getCurrentSourceId() {
  return getCurrentLayerIds()?.sourceId ?? null;
}

function createDataStore(file: File, asyncBuffer: AsyncBuffer): DataStore {
  const id = `store-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const name = file.name.replace(/\.[^/.]+$/, '') || file.name;
  return {
    id,
    name,
    file,
    asyncBuffer,
    geojson: null,
    numericFieldsFromSchema: [],
    categoricalFieldsFromSchema: [],
    chosenNumericFields: [],
    chosenCategoricalFields: [],
    landSizeField: null,
    landSizeUnitLabel: null,
    bldgSizeField: null,
    bldgSizeUnitLabel: null
  };
}

function renderDataStoreList() {
  if (!dataStoreList) return;
  dataStoreList.replaceChildren();

  if (S.dataStoreOrder.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No data sources loaded yet.';
    dataStoreList.appendChild(empty);
    return;
  }

  S.dataStoreOrder.forEach(storeId => {
    const store = S.dataStores.get(storeId);
    if (!store) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'data-store-button';
    btn.textContent = store.name;
    btn.addEventListener('click', () => {
      if (addLayerFromDataStore(store.id)) {
        closeAddLayerModal();
      }
    });
    dataStoreList.appendChild(btn);
  });
}

function getLayerPanelName(layerId: string): string {
  const layer = S.layers.get(layerId);
  if (!layer) return '';
  const index = S.layerOrder.indexOf(layerId);
  return layer.field ?? `layer ${index + 1}`;
}

function getLayerSelectLabel(layerId: string): string {
  const layer = S.layers.get(layerId);
  if (!layer) return '';
  const baseName = getLayerPanelName(layerId);
  const store = S.dataStores.get(layer.dataStoreId);
  const sourceLabel = store?.file?.name ?? store?.name ?? 'Unknown source';
  return `${baseName} (${sourceLabel})`;
}

function renderLayerSelectOptions(
  select: HTMLSelectElement,
  selectedId: string | null,
  placeholderText: string
): string | null {
  select.replaceChildren();
  const placeholder = new Option(placeholderText, '');
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  if (S.layerOrder.length === 0) {
    select.disabled = true;
    return null;
  }

  S.layerOrder.forEach(layerId => {
    select.appendChild(new Option(getLayerSelectLabel(layerId), layerId));
  });

  select.disabled = false;
  if (selectedId && S.layers.has(selectedId)) {
    select.value = selectedId;
    return selectedId;
  }
  const fallback = S.currentLayerId ?? S.layerOrder[0] ?? null;
  if (fallback) {
    select.value = fallback;
    return fallback;
  }
  return null;
}

function getStatsLayer(): LayerState | null {
  return S.statsLayerId ? S.layers.get(S.statsLayerId) ?? null : null;
}

function getScatterLayer(): LayerState | null {
  return S.scatterLayerId ? S.layers.get(S.scatterLayerId) ?? null : null;
}

function getLayerDataStore(layer: LayerState | null): DataStore | null {
  return layer ? S.dataStores.get(layer.dataStoreId) ?? null : null;
}

function getLayerGeoJSON(layer: LayerState | null): GeoJSON.FeatureCollection | null {
  return layer?.geojson ?? null;
}

function getScatterDataStore(): DataStore | null {
  return getLayerDataStore(getScatterLayer());
}

function renderStatsLayerOptions() {
  if (!statsLayerSelect) return;
  S.statsLayerId = renderLayerSelectOptions(statsLayerSelect, S.statsLayerId, 'Choose a layer');
}

function renderScatterLayerOptions() {
  if (!scatterLayerSelect) return;
  S.scatterLayerId = renderLayerSelectOptions(scatterLayerSelect, S.scatterLayerId, 'Choose a layer');
}

function openAddLayerModal() {
  if (!addLayerOverlay) return;
  renderDataStoreList();
  addLayerOverlay.classList.add('show');
}

function closeAddLayerModal() {
  if (!addLayerOverlay) return;
  addLayerOverlay.classList.remove('show');
}

function createLayerState(name: string, dataStoreId: string): LayerState {
  S.layerCounter += 1;
  const suffix = `layer-${S.layerCounter}`;
  return {
    id: suffix,
    name,
    dataStoreId,
    sourceId: `${SOURCE_ID}-${suffix}`,
    layerId: `${LAYER_ID}-${suffix}`,
    errorLayerId: `${ERROR_LAYER_ID}-${suffix}`,
    visible: true,
    geojson: null,
    field: null,
    fieldType: null,
    stats: null,
    normalizationMode: 'asis',
    colorMode: 'quantiles',
    categoricalColorMode: 'random',
    singleColorValue: '#3b82f6',
    ramp: rampSelect?.value ?? 'Viridis',
    colorDomain: null,
    colorBreaks: null,
    cachedExtrusionSettings: null,
    chosenNumericFields: [],
    chosenCategoricalFields: [],
    landSizeField: null,
    landSizeUnitLabel: null,
    bldgSizeField: null,
    bldgSizeUnitLabel: null,
    hiddenLegendItems: new Set(),
    selectedLegendItems: new Set(),
    selectedParcels: new Set(),
    highlightColor: '#FFFF00',
    legendSortField: 'count',
    legendSortDirection: 'desc',
    customColors: new Map(),
    opacity: parseFloat(opacityInput.value),
    is3DMode: false,
    filters: [],
    filterMode: 'none',
    filterActionMode: 'none',
    filterInvert: false,
    parcelPatchMap: new Map()
  };
}

function persistCurrentLayerState() {
  const layer = getCurrentLayer();
  if (!layer) return;
  layer.geojson = S.currentGeoJSON;
  layer.field = S.currentField;
  layer.fieldType = S.currentFieldType;
  layer.stats = S.currentStats;
  layer.normalizationMode = S.normalizationMode;
  layer.colorMode = S.colorMode;
  layer.categoricalColorMode = S.categoricalColorMode;
  layer.singleColorValue = S.singleColorValue;
  layer.ramp = rampSelect?.value ?? layer.ramp;
  layer.colorDomain = S.colorDomain;
  layer.colorBreaks = S.colorBreaks;
  layer.cachedExtrusionSettings = S.cachedExtrusionSettings;
  layer.chosenNumericFields = [...S.chosenNumericFields];
  layer.chosenCategoricalFields = [...S.chosenCategoricalFields];
  layer.landSizeField = S.landSizeField;
  layer.landSizeUnitLabel = S.landSizeUnitLabel;
  layer.bldgSizeField = S.bldgSizeField;
  layer.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
  layer.hiddenLegendItems = S.hiddenLegendItems;
  layer.selectedLegendItems = S.selectedLegendItems;
  layer.selectedParcels = S.selectedParcels;
  layer.highlightColor = S.highlightColor;
  layer.legendSortField = S.legendSortField;
  layer.legendSortDirection = S.legendSortDirection;
  layer.customColors = S.customColors;
  layer.opacity = parseFloat(opacityInput.value);
  layer.is3DMode = S.is3DMode;
  layer.filters = cloneFilters(S.filters);
  layer.filterMode = S.filterMode;
  layer.filterActionMode = S.filterActionMode;
  layer.filterInvert = S.filterInvert;
  layer.parcelPatchMap = S.parcelPatchMap;
}

function applyLayerState(layer: LayerState) {
  S.currentGeoJSON = layer.geojson;
  S.currentField = layer.field;
  S.currentFieldType = layer.fieldType;
  S.currentStats = layer.stats;
  S.normalizationMode = layer.normalizationMode;
  S.colorMode = layer.colorMode;
  S.categoricalColorMode = layer.categoricalColorMode;
  S.singleColorValue = layer.singleColorValue;
  S.colorDomain = layer.colorDomain;
  S.colorBreaks = layer.colorBreaks;
  S.cachedExtrusionSettings = layer.cachedExtrusionSettings;
  S.chosenNumericFields = [...layer.chosenNumericFields];
  S.chosenCategoricalFields = [...layer.chosenCategoricalFields];
  S.landSizeField = layer.landSizeField;
  S.landSizeUnitLabel = layer.landSizeUnitLabel;
  S.bldgSizeField = layer.bldgSizeField;
  S.bldgSizeUnitLabel = layer.bldgSizeUnitLabel;
  S.hiddenLegendItems = layer.hiddenLegendItems;
  S.selectedLegendItems = layer.selectedLegendItems;
  S.selectedParcels = layer.selectedParcels;
  S.highlightColor = layer.highlightColor;
  S.legendSortField = layer.legendSortField;
  S.legendSortDirection = layer.legendSortDirection;
  S.customColors = layer.customColors;
  opacityInput.value = String(layer.opacity);
  if (opacityOut) opacityOut.value = Number(layer.opacity).toFixed(2);
  S.is3DMode = layer.is3DMode;
  S.filters = cloneFilters(layer.filters ?? []);
  S.parcelPatchMap = layer.parcelPatchMap ?? new Map();
  S.filterMode = layer.filterMode ?? 'none';
  S.filterActionMode = layer.filterActionMode ?? 'none';
  S.filterInvert = layer.filterInvert ?? false;
  if (filtersInvertToggle) {
    filtersInvertToggle.checked = S.filterInvert;
  }
  S.currentDataStoreId = layer.dataStoreId;
  const store = S.dataStores.get(layer.dataStoreId);
  if (store) {
    S.lastFile = store.file;
    S.lastAsyncBuffer = store.asyncBuffer;
    S.lastNumericFieldsFromSchema = [...store.numericFieldsFromSchema];
    S.lastCategoricalFieldsFromSchema = [...store.categoricalFieldsFromSchema];
  }

  setSizeState(S.bldgSizeField, S.bldgSizeUnitLabel, S.landSizeField, S.landSizeUnitLabel);

  if (fieldSelect) {
    if (!S.currentGeoJSON) {
      fieldSelect.replaceChildren(new Option('— load a file first —', ''));
      fieldSelect.value = '';
    } else {
      const allAvailableFields = [
        ...S.chosenNumericFields.filter(k => S.currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))),
        ...S.chosenCategoricalFields.filter(k => S.currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k)))
      ];
      populateFieldDropdownFromList(allAvailableFields);
      fieldSelect.value = S.currentField ?? '';
    }
  }

  if (normAsIs && normLand && normBldg) {
    normAsIs.checked = S.normalizationMode === 'asis';
    normLand.checked = S.normalizationMode === 'perLand';
    normBldg.checked = S.normalizationMode === 'perBuilding';
  }

  if (colorCont && colorQuant) {
    colorCont.checked = S.colorMode === 'continuous';
    colorQuant.checked = S.colorMode === 'quantiles';
  }

  document.querySelectorAll<HTMLInputElement>('input[name="categoricalColorMode"]').forEach(radio => {
    radio.checked = radio.value === S.categoricalColorMode;
  });

  if (rampSelect && layer.ramp) {
    rampSelect.value = layer.ramp;
  }

  if (colorPicker) {
    colorPicker.value = S.singleColorValue;
  }

  enable3DCheckbox.checked = S.is3DMode;
  updateCurrentLayerDetails();
  updateFieldTypeUI();
  update3DUI();
  updateFloatingLegend();
  updateSelectionControls();
  renderDataStoreList();
  refreshStatisticsPanel();
  refreshScatterPanel();
  refreshLandSchedulePanel();

  if (S.map.getLayer(layer.layerId)) {
    setLayerVisibility(layer, layer.visible);
  }

  if (S.selectionControlsPanel) {
    const picker = S.selectionControlsPanel.querySelector('#highlightColorPicker') as HTMLInputElement | null;
    if (picker) picker.value = S.highlightColor;
  }

  refreshFiltersUI();
}

function registerLayer(layer: LayerState) {
  S.layers.set(layer.id, layer);
  S.layerOrder.unshift(layer.id);
  S.currentLayerId = layer.id;
  applyLayerState(layer);
  applyLayerOrderToMap();
  renderLayerList();
}

function moveLayerInOrder(layerId: string, direction: 'up' | 'down') {
  const index = S.layerOrder.indexOf(layerId);
  if (index === -1) return;
  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= S.layerOrder.length) return;
  S.layerOrder.splice(index, 1);
  S.layerOrder.splice(newIndex, 0, layerId);
  applyLayerOrderToMap();
  renderLayerList();
}

function applyLayerOrderToMap() {
  for (let i = S.layerOrder.length - 1; i >= 0; i -= 1) {
    const layerId = S.layerOrder[i];
    const layer = S.layers.get(layerId);
    if (!layer) continue;
    if (S.map.getLayer(layer.layerId)) {
      S.map.moveLayer(layer.layerId);
    }
    if (S.map.getLayer(layer.errorLayerId)) {
      S.map.moveLayer(layer.errorLayerId);
    }
  }
}

function addLayerFromDataStore(storeId: string): boolean {
  const store = S.dataStores.get(storeId);
  if (!store) return false;
  if (!store.geojson) {
    alert('That data set is not ready yet. Finish loading it first.');
    return false;
  }
  persistCurrentLayerState();
  const layerName = `${store.name} (copy ${S.layerOrder.length + 1})`;
  const layer = createLayerState(layerName, store.id);
  layer.geojson = store.geojson;
  layer.chosenNumericFields = [...store.chosenNumericFields];
  layer.chosenCategoricalFields = [...store.chosenCategoricalFields];
  layer.landSizeField = store.landSizeField;
  layer.landSizeUnitLabel = store.landSizeUnitLabel;
  layer.bldgSizeField = store.bldgSizeField;
  layer.bldgSizeUnitLabel = store.bldgSizeUnitLabel;
  registerLayer(layer);
  addOrUpdateSource(layer.geojson);
  applyGrayRendering();
  applyLayerOrderToMap();
  return true;
}

function setCurrentLayer(layerId: string) {
  if (S.currentLayerId === layerId) return;
  persistCurrentLayerState();
  const layer = S.layers.get(layerId);
  if (!layer) return;
  S.currentLayerId = layerId;
  applyLayerState(layer);
  renderLayerList();
  if (S.currentGeoJSON && S.currentField) {
    applyExtrusionWithVisibility();
  } else if (S.currentGeoJSON) {
    applyGrayRendering();
  }
}

function setLayerVisibility(layer: LayerState, visible: boolean) {
  layer.visible = visible;
  const visibility = visible ? 'visible' : 'none';
  if (S.map.getLayer(layer.layerId)) {
    S.map.setLayoutProperty(layer.layerId, 'visibility', visibility);
  }
  if (S.map.getLayer(layer.errorLayerId)) {
    S.map.setLayoutProperty(layer.errorLayerId, 'visibility', visibility);
  }
}

function removeLayer(layerId: string) {
  const layer = S.layers.get(layerId);
  if (!layer) return;
  if (S.map.getLayer(layer.layerId)) S.map.removeLayer(layer.layerId);
  if (S.map.getLayer(layer.errorLayerId)) S.map.removeLayer(layer.errorLayerId);
  if (S.map.getSource(layer.sourceId)) S.map.removeSource(layer.sourceId);
  S.layers.delete(layerId);
  const idx = S.layerOrder.indexOf(layerId);
  if (idx >= 0) S.layerOrder.splice(idx, 1);

  if (S.currentLayerId === layerId) {
    S.currentLayerId = S.layerOrder.length ? S.layerOrder[0] : null;
    if (S.currentLayerId) {
      applyLayerState(S.layers.get(S.currentLayerId)!);
    } else {
      S.currentGeoJSON = null;
      S.currentField = null;
      S.currentFieldType = null;
      S.currentStats = null;
      S.colorBreaks = null;
      S.colorDomain = null;
      S.customColors = new Map();
      S.hiddenLegendItems = new Set();
      S.selectedLegendItems = new Set();
      S.selectedParcels = new Set();
      S.highlightColor = '#FFFF00';
      S.filters = [];
      S.filterMode = 'none';
      S.filterActionMode = 'none';
      S.filterInvert = false;
      if (filtersInvertToggle) {
        filtersInvertToggle.checked = false;
      }
      fieldSelect.replaceChildren(new Option('— load a file first —', ''));
      updateFieldTypeUI();
      updateFloatingLegend();
      refreshFiltersUI();
      refreshStatisticsPanel();
      refreshScatterPanel();
      refreshLandSchedulePanel();
      if (S.selectionControlsPanel) {
        S.selectionControlsPanel.style.display = 'none';
      }
    }
  }
  renderLayerList();
  applyLayerOrderToMap();
}

// Window management — using createWindowManager from windows.ts
// The paint window manager is declared first so layers can reference minimizePaint in its onMinimize.
const paintWin = createWindowManager({
  getMinimized: () => S.isPaintMinimized,
  setMinimized: (v) => { S.isPaintMinimized = v; },
  contentEl: paintContent,
  controlsEl: paintControlsEl,
  positionFn: positionPaintPanel,
});

const layersWin = createWindowManager({
  getMinimized: () => S.isLayersMinimized,
  setMinimized: (v) => { S.isLayersMinimized = v; },
  contentEl: settingsContent,
  controlsEl: controlsEl,
  contentDisplay: 'block',
  positionFn: () => { positionPaintPanel(); positionSettingsPanel(); },
  onMinimize: () => { paintWin.minimize(); },
});

const settingsMenuWin = createWindowManager({
  getMinimized: () => S.isSettingsMenuMinimized,
  setMinimized: (v) => { S.isSettingsMenuMinimized = v; },
  contentEl: settingsMenuContent,
  controlsEl: settingsControlsEl,
  positionFn: positionSettingsPanel,
});

const legendWin = createWindowManager({
  getMinimized: () => S.isLegendMinimized,
  setMinimized: (v) => { S.isLegendMinimized = v; },
  contentEl: legendContent,
  controlsEl: floatingLegend,
  contentDisplay: 'block',
  onMinimize: () => {
    S.isLegendVisible = false;
    updateSelectionControlsPosition();
    updateLegendPosition();
  },
  onShow: () => {
    S.isLegendVisible = true;
    // Override the default 'grid' — floating legend uses 'block'
    floatingLegend.style.display = 'block';
    updateFloatingLegend();
    updateSelectionControlsPosition();
    updateLegendPosition();
  },
});

const statisticsWin = createWindowManager({
  getMinimized: () => S.isStatisticsMinimized,
  setMinimized: (v) => { S.isStatisticsMinimized = v; },
  contentEl: statisticsContent,
  controlsEl: statisticsControlsEl,
  positionFn: positionStatisticsPanel,
});

const scatterplotWin = createWindowManager({
  getMinimized: () => S.isScatterplotMinimized,
  setMinimized: (v) => { S.isScatterplotMinimized = v; },
  contentEl: scatterplotContent,
  controlsEl: scatterplotControlsEl,
  positionFn: positionScatterplotPanel,
  onShow: () => { scheduleScatterPlotRefresh(); },
});

const filtersWin = createWindowManager({
  getMinimized: () => S.isFiltersMinimized,
  setMinimized: (v) => { S.isFiltersMinimized = v; },
  contentEl: filtersContent,
  controlsEl: filtersControlsEl,
  positionFn: positionFiltersPanel,
  onShow: () => { updateFiltersPanelLayout(); },
});

const landScheduleWin = createWindowManager({
  getMinimized: () => S.isLandScheduleMinimized,
  setMinimized: (v) => { S.isLandScheduleMinimized = v; },
  contentEl: landScheduleContent,
  controlsEl: landScheduleControlsEl,
  positionFn: positionLandSchedulePanel,
});

// Convenience aliases matching the old function names
const minimizeLayers = layersWin.minimize;
const showLayers = layersWin.show;
const minimizeSettingsMenu = settingsMenuWin.minimize;
const showSettingsMenu = settingsMenuWin.show;
const toggleSettingsMenu = settingsMenuWin.toggle;
const minimizePaint = paintWin.minimize;
const showPaint = paintWin.show;
const togglePaint = paintWin.toggle;
const minimizeLegend = legendWin.minimize;
const showLegend = legendWin.show;
const minimizeStatistics = statisticsWin.minimize;
const showStatistics = statisticsWin.show;
const toggleStatistics = statisticsWin.toggle;
const minimizeScatterplot = scatterplotWin.minimize;
const showScatterplot = scatterplotWin.show;
const toggleScatterplot = scatterplotWin.toggle;
const minimizeFilters = filtersWin.minimize;
const showFilters = filtersWin.show;
const toggleFilters = filtersWin.toggle;
const minimizeLandSchedule = landScheduleWin.minimize;
const showLandSchedule = landScheduleWin.show;
const toggleLandSchedule = landScheduleWin.toggle;

// Wire callbacks and DOM elements into the windows module
initWindowCallbacks({
  updateToolbarButtonStates,
  updateLegendPosition,
});
initPositionElements({
  controlsEl,
  paintControlsEl,
  settingsControlsEl,
  statisticsControlsEl,
  scatterplotControlsEl,
  filtersControlsEl,
  filtersContent,
  filtersListEl,
  landScheduleControlsEl,
});

// Wire DOM elements and callbacks into the filters module
initFilterElements({
  filtersListEl,
  filtersInvertToggle,
  addFilterButton,
  filtersSaveToggle,
  filtersLoadToggle,
  filtersSavePanel,
  filtersLoadPanel,
  filtersSaveControls,
  filtersSaveNameInput,
  filtersSaveConfirmButton,
  filtersSavedStatus,
  filtersLoadControls,
  filtersLoadSelect,
  filtersSelectButton,
  filtersShowButton,
  filtersHideButton,
});
initFilterCallbacks({
  persistCurrentLayerState,
  updateStatisticsSectionVisibility,
  updateStatisticsResults,
  scheduleScatterPlotRefresh,
  getCurrentLayerIds,
  getCurrentSourceId,
  clearLegendVisibility,
  clearAllSelections,
  updateSelectionControls,
  getParcelId,
  statsSubjectControls,
  scatterSubjectControls,
});

function resetStatisticsDisplay() {
  statsParcelCount.textContent = '—';
  statsMedian.textContent = '—';
  statsMean.textContent = '—';
  statsStdDev.textContent = '—';
  statsCod.textContent = '—';
  statsPercentiles.replaceChildren();
  statsHistogram.replaceChildren();
  statsOverflowMinPct.disabled = true;
  statsOverflowMaxPct.disabled = true;
  statsCategoricalParcelCount.textContent = '—';
  statsCategoricalUniqueCount.textContent = '—';
  statsCategoricalModalValue.textContent = '—';
  statsCategoricalValues.replaceChildren();
}

function buildSubjectSelector(container: HTMLElement, options: SubjectSelectorOptions = {}): SubjectSelectorControls {
  container.replaceChildren();
  const subjectBlock = document.createElement('div');
  subjectBlock.style.display = 'grid';
  subjectBlock.style.gap = '6px';

  const titleText = options.title ?? 'Subject:';
  let title: HTMLDivElement | null = null;
  if (titleText) {
    title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.fontSize = '12px';
    title.textContent = titleText;
  }

  const actions = document.createElement('div');
  actions.className = 'filters-actions stats-subject-actions';

  const buttons: HTMLButtonElement[] = [];
  const modes: Array<{ mode: SubjectMode; label: string }> = [
    { mode: 'all', label: 'All' },
    { mode: 'visible', label: 'Visible' },
    { mode: 'selected', label: 'Selected' },
    { mode: 'category', label: 'Category' },
    { mode: 'filtered', label: 'Filtered' }
  ];
  modes.forEach(({ mode, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.subjectMode = mode;
    button.textContent = label;
    actions.appendChild(button);
    buttons.push(button);
  });

  if (title) {
    subjectBlock.append(title);
  }
  subjectBlock.append(actions);

  const categoryControls = document.createElement('div');
  categoryControls.style.display = 'none';
  categoryControls.style.gap = '6px';
  categoryControls.style.marginTop = '8px';

  const categoryFieldSelect = document.createElement('select');
  const fieldPlaceholder = new Option('Choose a field', '');
  fieldPlaceholder.disabled = true;
  fieldPlaceholder.selected = true;
  categoryFieldSelect.appendChild(fieldPlaceholder);

  const categoryValueSelect = document.createElement('select');
  categoryValueSelect.multiple = true;
  categoryValueSelect.size = 4;
  categoryValueSelect.disabled = true;
  const valuePlaceholder = new Option('Choose value(s)', '');
  valuePlaceholder.disabled = true;
  valuePlaceholder.selected = true;
  categoryValueSelect.appendChild(valuePlaceholder);

  categoryControls.append(categoryFieldSelect, categoryValueSelect);
  const filterControls = document.createElement('div');
  filterControls.style.display = 'none';
  filterControls.style.gap = '6px';
  filterControls.style.marginTop = '8px';

  const filterSelect = document.createElement('select');
  const filterPlaceholder = new Option('Choose a saved filter', '');
  filterPlaceholder.disabled = true;
  filterPlaceholder.selected = true;
  filterSelect.appendChild(filterPlaceholder);

  const filterEmptyState = document.createElement('div');
  filterEmptyState.className = 'muted';
  filterEmptyState.textContent = "You haven't saved any filters yet.";

  filterControls.append(filterSelect, filterEmptyState);
  container.append(subjectBlock, categoryControls, filterControls);

  return { buttons, categoryControls, categoryFieldSelect, categoryValueSelect, filterControls, filterSelect, filterEmptyState };
}

function updateSubjectButtons(controls: SubjectSelectorControls, mode: SubjectMode) {
  controls.buttons.forEach(button => {
    button.classList.toggle('active', button.dataset.subjectMode === mode);
  });
}

function updateSubjectControls(
  controls: SubjectSelectorControls,
  mode: SubjectMode,
  hasFieldOptions: boolean,
  hasFieldSelected: boolean
) {
  const isCategory = mode === 'category';
  const isFiltered = mode === 'filtered';
  controls.categoryControls.style.display = isCategory ? 'grid' : 'none';
  controls.categoryFieldSelect.disabled = !isCategory || !hasFieldOptions;
  controls.categoryValueSelect.disabled = !isCategory || !hasFieldSelected;
  controls.filterControls.style.display = isFiltered ? 'grid' : 'none';
  if (!isFiltered) {
    return;
  }
  const hasFilters = S.savedFiltersStore.size > 0;
  controls.filterSelect.disabled = !hasFilters;
  controls.filterSelect.style.display = hasFilters ? 'block' : 'none';
  controls.filterEmptyState.style.display = hasFilters ? 'none' : 'block';
}

function populateStatisticsCategoryFields() {
  const layer = getStatsLayer();
  const dataStore = getLayerDataStore(layer);
  statsCategoryFieldSelect.replaceChildren();
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  statsCategoryFieldSelect.appendChild(placeholder);

  if (!dataStore?.geojson) {
    statsCategoryFieldSelect.disabled = true;
    S.statsCategoryField = null;
    return;
  }

  const availableCategorical = dataStore.chosenCategoricalFields.filter(k =>
    dataStore.geojson?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );

  availableCategorical.forEach(field => {
    statsCategoryFieldSelect.appendChild(new Option(field, field));
  });

  statsCategoryFieldSelect.disabled = availableCategorical.length === 0;
  if (S.statsCategoryField && availableCategorical.includes(S.statsCategoryField)) {
    statsCategoryFieldSelect.value = S.statsCategoryField;
  } else {
    S.statsCategoryField = null;
  }
}

function populateStatisticsCategoryValues(field: string | null) {
  const layer = getStatsLayer();
  const dataStore = getLayerDataStore(layer);
  statsCategoryValueSelect.replaceChildren();
  const placeholder = new Option('Choose value(s)', '');
  placeholder.disabled = true;
  placeholder.selected = S.statsCategoryValueIndices.length === 0;
  statsCategoryValueSelect.appendChild(placeholder);

  if (!dataStore?.geojson || !field) {
    statsCategoryValueSelect.disabled = true;
    S.statsCategoryValueMap = [];
    S.statsCategoryValueIndices = [];
    return;
  }

  const valueMap = new Map<string, { label: string; value: unknown }>();
  dataStore.geojson.features.forEach(feature => {
    const raw = (feature.properties as Record<string, unknown> | undefined)?.[field];
    if (raw === null || raw === undefined) return;
    const key = `${typeof raw}:${String(raw)}`;
    if (!valueMap.has(key)) {
      valueMap.set(key, { label: String(raw), value: raw });
    }
  });

  S.statsCategoryValueMap = Array.from(valueMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  S.statsCategoryValueMap.forEach((entry, index) => {
    statsCategoryValueSelect.appendChild(new Option(entry.label, String(index)));
  });

  statsCategoryValueSelect.disabled = false;
  const validSelections = new Set(
    S.statsCategoryValueIndices.filter(index => S.statsCategoryValueMap[Number(index)])
  );
  S.statsCategoryValueIndices = Array.from(validSelections);
  Array.from(statsCategoryValueSelect.options).forEach(option => {
    option.selected = validSelections.has(option.value);
  });
  if (S.statsCategoryValueIndices.length === 0) {
    placeholder.selected = true;
  }
}

function getStatsFieldType(field: string | null, numericFields: string[], categoricalFields: string[]) {
  if (!field) return null;
  if (numericFields.includes(field)) return 'numeric';
  if (categoricalFields.includes(field)) return 'categorical';
  return null;
}

function populateStatisticsFields() {
  const layer = getStatsLayer();
  const dataStore = getLayerDataStore(layer);
  const useDataSource = S.statsSubjectMode === 'category' || S.statsSubjectMode === 'filtered';
  const sourceGeoJSON = useDataSource ? dataStore?.geojson ?? null : getLayerGeoJSON(layer);
  const numericFields = useDataSource ? dataStore?.chosenNumericFields ?? [] : layer?.chosenNumericFields ?? [];
  const categoricalFields = useDataSource ? dataStore?.chosenCategoricalFields ?? [] : layer?.chosenCategoricalFields ?? [];

  statsFieldSelect.replaceChildren();
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  statsFieldSelect.appendChild(placeholder);

  if (!sourceGeoJSON) {
    statsFieldSelect.disabled = true;
    S.statsField = null;
    S.statsFieldType = null;
    return;
  }

  const availableNumeric = numericFields.filter(k =>
    sourceGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );
  const availableCategorical = categoricalFields.filter(k =>
    sourceGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );
  const availableFields = [...availableNumeric, ...availableCategorical];
  availableFields.forEach(field => {
    statsFieldSelect.appendChild(new Option(field, field));
  });
  statsFieldSelect.disabled = availableFields.length === 0;
  if (S.statsField && availableFields.includes(S.statsField)) {
    statsFieldSelect.value = S.statsField;
    S.statsFieldType = getStatsFieldType(S.statsField, numericFields, categoricalFields);
  } else {
    S.statsField = null;
    S.statsFieldType = null;
  }
}

function computeStatisticsValues(values: number[]) {
  if (values.length === 0) {
    return {
      min: NaN,
      max: NaN,
      median: NaN,
      mean: NaN,
      stdDev: NaN,
      cod: NaN,
      percentiles: [] as Array<{ label: string; value: number }>
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const median = percentile(values, 50);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const absDeviation = values.reduce((sum, v) => sum + Math.abs(v - median), 0) / values.length;
  const cod = Number.isFinite(median) && median !== 0 ? (absDeviation / Math.abs(median)) * 100 : NaN;
  const percentiles = [10, 25, 50, 75, 90].map(p => ({
    label: `p${p}`,
    value: percentile(values, p)
  }));

  return { min, max, median, mean, stdDev, cod, percentiles };
}

function formatPercentValue(value: number) {
  const rounded = Math.round(value * 10) / 10;
  const decimals = Number.isInteger(rounded) ? 0 : 1;
  return `${rounded.toFixed(decimals)}%`;
}

function parsePercentInputValue(raw: string) {
  const cleaned = raw.replace('%', '').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function setPercentInputValue(input: HTMLInputElement, value: number) {
  input.value = formatPercentValue(value);
}

function getHistogramDomain(values: number[]) {
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

function updateOverflowControls(values: number[]) {
  if (values.length === 0) {
    statsOverflowMinPct.disabled = true;
    statsOverflowMaxPct.disabled = true;
    return;
  }

  statsOverflowMinPct.disabled = false;
  statsOverflowMaxPct.disabled = false;

  setPercentInputValue(statsOverflowMinPct, S.statsOverflowPct.min);
  setPercentInputValue(statsOverflowMaxPct, S.statsOverflowPct.max);
}

function renderStatisticsHistogram(values: number[]) {
  statsHistogram.replaceChildren();
  if (values.length === 0) {
    updateOverflowControls(values);
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No data';
    empty.style.gridColumn = '1 / -1';
    statsHistogram.appendChild(empty);
    return;
  }

  updateOverflowControls(values);
  const domain = getHistogramDomain(values);
  const minAbs = percentile(values, S.statsOverflowPct.min);
  const maxAbs = percentile(values, S.statsOverflowPct.max);
  const overflowMin = Math.min(minAbs, maxAbs);
  const overflowMax = Math.max(minAbs, maxAbs);

  const buckets = 10;
  const counts = new Array(buckets).fill(0);
  const interiorBins = buckets - 2;
  const interiorStart = overflowMin;
  const interiorEnd = overflowMax;
  const interiorSpan = interiorEnd - interiorStart || 1;
  const interiorStep = interiorSpan / interiorBins;

  values.forEach(value => {
    if (value <= overflowMin) {
      counts[0] += 1;
      return;
    }
    if (value >= overflowMax) {
      counts[buckets - 1] += 1;
      return;
    }
    const idx = Math.min(
      interiorBins - 1,
      Math.floor((value - interiorStart) / interiorStep)
    );
    counts[1 + idx] += 1;
  });

  const maxCount = Math.max(...counts, 1);
  counts.forEach((count, idx) => {
    const bin = document.createElement('div');
    bin.className = 'histogram-bin';
    let rangeStart = domain.min;
    let rangeEnd = domain.max;
    if (idx === 0) {
      rangeEnd = overflowMin;
    } else if (idx === buckets - 1) {
      rangeStart = overflowMax;
    } else {
      rangeStart = interiorStart + interiorStep * (idx - 1);
      rangeEnd = interiorStart + interiorStep * idx;
    }
    bin.title = `${fmt(rangeStart)}–${fmt(rangeEnd)} (${count})`;
    if (count > 0) {
      const bar = document.createElement('div');
      bar.className = 'histogram-bar';
      bar.style.height = `${(count / maxCount) * 100}%`;
      bin.appendChild(bar);
    } else {
      const spacer = document.createElement('div');
      spacer.style.height = '100%';
      spacer.style.width = '100%';
      spacer.style.opacity = '0';
      bin.appendChild(spacer);
    }
    statsHistogram.appendChild(bin);
  });
}

function getScatterSubjectSelection(
  layer: LayerState,
  layerGeoJSON: GeoJSON.FeatureCollection | null,
  dataGeoJSON: GeoJSON.FeatureCollection | null,
  mode: SubjectMode,
  categoryField: string | null,
  categoryValueIndices: string[],
  categoryValueMap: Array<{ label: string; value: unknown }>,
  filteredName: string | null
): GeoJSON.Feature[] {
  if (mode === 'visible') {
    if (!layerGeoJSON) return [];
    const visibilityExpr = buildLayerVisibilityExpression(layer);
    return visibilityExpr
      ? layerGeoJSON.features.filter(feature => evaluateFilterExpression(visibilityExpr, feature))
      : layerGeoJSON.features;
  }
  if (mode === 'selected') {
    if (!layerGeoJSON) return [];
    return layerGeoJSON.features.filter(feature => layer.selectedParcels.has(getParcelId(feature)));
  }
  if (mode === 'category') {
    if (!dataGeoJSON || !categoryField || categoryValueIndices.length === 0) return [];
    const selectedValues = new Set(
      categoryValueIndices
        .map(index => categoryValueMap[Number(index)])
        .filter((entry): entry is { label: string; value: unknown } => Boolean(entry))
        .map(entry => entry.value)
    );
    return dataGeoJSON.features.filter(feature => {
      const value = (feature.properties as Record<string, unknown> | undefined)?.[categoryField];
      return selectedValues.has(value);
    });
  }
  if (mode === 'filtered') {
    if (!dataGeoJSON || !filteredName) return [];
    const entry = S.savedFiltersStore.get(filteredName);
    if (!entry) return [];
    const filterExpr = buildSavedFilterExpression(entry);
    if (!filterExpr) return [];
    return dataGeoJSON.features.filter(feature => evaluateFilterExpression(filterExpr, feature));
  }
  return layerGeoJSON?.features ?? [];
}

function getStatsSourceContext() {
  const layer = getStatsLayer();
  const dataStore = getLayerDataStore(layer);
  return {
    layer,
    layerGeoJSON: getLayerGeoJSON(layer),
    dataStore,
    dataGeoJSON: dataStore?.geojson ?? null
  };
}

function getStatsNormalizationContext() {
  const { layer, dataStore } = getStatsSourceContext();
  const useDataSource = S.statsSubjectMode === 'category' || S.statsSubjectMode === 'filtered';
  return {
    landField: useDataSource ? dataStore?.landSizeField ?? null : layer?.landSizeField ?? null,
    landUnit: useDataSource ? dataStore?.landSizeUnitLabel ?? null : layer?.landSizeUnitLabel ?? null,
    bldgField: useDataSource ? dataStore?.bldgSizeField ?? null : layer?.bldgSizeField ?? null,
    bldgUnit: useDataSource ? dataStore?.bldgSizeUnitLabel ?? null : layer?.bldgSizeUnitLabel ?? null
  };
}

function updateStatisticsNormalizationControls() {
  const context = getStatsNormalizationContext();
  statsNormLand.disabled = !context.landField;
  statsNormBldg.disabled = !context.bldgField;
  statsNormLandUnitEl.textContent = context.landField ? (context.landUnit ?? '(unit)') : '(unit)';
  statsNormBldgUnitEl.textContent = context.bldgField ? (context.bldgUnit ?? '(unit)') : '(unit)';

  if (S.statsNormalizationMode === 'perLand' && !context.landField) {
    S.statsNormalizationMode = 'asis';
    statsNormAsIs.checked = true;
  }
  if (S.statsNormalizationMode === 'perBuilding' && !context.bldgField) {
    S.statsNormalizationMode = 'asis';
    statsNormAsIs.checked = true;
  }
}

function getStatsSubjectSelection(
  mode: SubjectMode,
  categoryField: string | null,
  categoryValueIndices: string[],
  categoryValueMap: Array<{ label: string; value: unknown }>,
  filteredName: string | null
): GeoJSON.Feature[] {
  const { layer, layerGeoJSON, dataGeoJSON } = getStatsSourceContext();
  if (!layer) return [];
  if (!layerGeoJSON && (mode === 'all' || mode === 'visible' || mode === 'selected')) {
    return [];
  }

  if (mode === 'visible') {
    if (!layerGeoJSON) return [];
    const visibilityExpr = buildLayerVisibilityExpression(layer);
    return visibilityExpr
      ? layerGeoJSON.features.filter(feature => evaluateFilterExpression(visibilityExpr, feature))
      : layerGeoJSON.features;
  }
  if (mode === 'selected') {
    if (!layerGeoJSON) return [];
    return layerGeoJSON.features.filter(feature => layer.selectedParcels.has(getParcelId(feature)));
  }
  if (mode === 'category') {
    if (!dataGeoJSON || !categoryField || categoryValueIndices.length === 0) return [];
    const selectedValues = new Set(
      categoryValueIndices
        .map(index => categoryValueMap[Number(index)])
        .filter((entry): entry is { label: string; value: unknown } => Boolean(entry))
        .map(entry => entry.value)
    );
    return dataGeoJSON.features.filter(feature => {
      const value = (feature.properties as Record<string, unknown> | undefined)?.[categoryField];
      return selectedValues.has(value);
    });
  }
  if (mode === 'filtered') {
    if (!dataGeoJSON || !filteredName) return [];
    const entry = S.savedFiltersStore.get(filteredName);
    if (!entry) return [];
    const filterExpr = buildSavedFilterExpression(entry);
    if (!filterExpr) return [];
    return dataGeoJSON.features.filter(feature => evaluateFilterExpression(filterExpr, feature));
  }
  return layerGeoJSON?.features ?? [];
}

function updateStatisticsResults() {
  const { layer, layerGeoJSON, dataGeoJSON, dataStore } = getStatsSourceContext();
  const useDataSource = S.statsSubjectMode === 'category' || S.statsSubjectMode === 'filtered';
  const sourceGeoJSON = useDataSource ? dataGeoJSON : layerGeoJSON;
  const numericFields = useDataSource ? dataStore?.chosenNumericFields ?? [] : layer?.chosenNumericFields ?? [];
  const categoricalFields = useDataSource ? dataStore?.chosenCategoricalFields ?? [] : layer?.chosenCategoricalFields ?? [];

  updateStatisticsNormalizationControls();

  if (!sourceGeoJSON || !S.statsField) {
    S.statsValuesCache = [];
    resetStatisticsDisplay();
    return;
  }
  if (S.statsSubjectMode === 'category' && (!S.statsCategoryField || S.statsCategoryValueIndices.length === 0)) {
    S.statsValuesCache = [];
    resetStatisticsDisplay();
    return;
  }
  if (S.statsSubjectMode === 'filtered' && !S.statsFilteredName) {
    S.statsValuesCache = [];
    resetStatisticsDisplay();
    return;
  }
  S.statsFieldType = getStatsFieldType(S.statsField, numericFields, categoricalFields);
  if (!S.statsFieldType) {
    S.statsValuesCache = [];
    resetStatisticsDisplay();
    return;
  }

  const selection = getStatsSubjectSelection(
    S.statsSubjectMode,
    S.statsCategoryField,
    S.statsCategoryValueIndices,
    S.statsCategoryValueMap,
    S.statsFilteredName
  );

  const totalCount = sourceGeoJSON.features.length;
  const selectionCount = selection.length;
  const percent = totalCount > 0 ? (selectionCount / totalCount) * 100 : 0;
  const parcelText = `${selectionCount.toLocaleString()} (${percent.toFixed(1)}%)`;
  statsParcelCount.textContent = parcelText;
  statsCategoricalParcelCount.textContent = parcelText;

  if (S.statsFieldType === 'numeric') {
    const values = selection
      .map(feature => {
        const props = (feature.properties as Record<string, unknown> | undefined) ?? {};
        let base = numOrNull(props[S.statsField]);
        if (base === null) return null;

        const normalizationContext = getStatsNormalizationContext();
        if (S.statsNormalizationMode === 'perLand' && normalizationContext.landField) {
          const denom = numOrNull(props[normalizationContext.landField]);
          if (denom === null || denom <= 0) return null;
          base = base / denom;
        } else if (S.statsNormalizationMode === 'perBuilding' && normalizationContext.bldgField) {
          const denom = numOrNull(props[normalizationContext.bldgField]);
          if (denom === null || denom <= 0) return null;
          base = base / denom;
        }
        return base;
      })
      .filter((value): value is number => value !== null);
    S.statsValuesCache = values;

    const stats = computeStatisticsValues(values);
    const percentileRows = [
      { label: 'min', value: stats.min },
      ...stats.percentiles,
      { label: 'max', value: stats.max }
    ];
    statsMedian.textContent = Number.isFinite(stats.median) ? fmt(stats.median) : '—';
    statsMean.textContent = Number.isFinite(stats.mean) ? fmt(stats.mean) : '—';
    statsStdDev.textContent = Number.isFinite(stats.stdDev) ? fmt(stats.stdDev) : '—';
    statsCod.textContent = Number.isFinite(stats.cod) ? `${fmt(stats.cod)}%` : '—';

    statsPercentiles.replaceChildren();
    const sortedValues = values.slice().sort((a, b) => a - b);
    percentileRows.forEach(item => {
      const row = document.createElement('tr');
      const labelCell = document.createElement('td');
      labelCell.textContent = item.label;
      const valueCell = document.createElement('td');
      valueCell.textContent = Number.isFinite(item.value) ? fmt(item.value) : '—';
      const countCell = document.createElement('td');
      if (Number.isFinite(item.value)) {
        const cutoff = item.value;
        const count = sortedValues.filter(v => v <= cutoff).length;
        countCell.textContent = count.toLocaleString();
      } else {
        countCell.textContent = '—';
      }
      row.append(labelCell, valueCell, countCell);
      statsPercentiles.appendChild(row);
    });

    renderStatisticsHistogram(values);
    return;
  }

  S.statsValuesCache = [];
  statsMedian.textContent = '—';
  statsMean.textContent = '—';
  statsStdDev.textContent = '—';
  statsCod.textContent = '—';
  statsPercentiles.replaceChildren();
  statsHistogram.replaceChildren();
  statsOverflowMinPct.disabled = true;
  statsOverflowMaxPct.disabled = true;

  const counts = new Map<string, number>();
  selection.forEach(feature => {
    const props = (feature.properties as Record<string, unknown> | undefined) ?? {};
    const raw = props[S.statsField];
    if (raw === null || raw === undefined || raw === '') return;
    const key = String(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  statsCategoricalUniqueCount.textContent = counts.size.toLocaleString();
  const entries = Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });
  if (entries.length > 0) {
    const modal = entries[0];
    statsCategoricalModalValue.textContent = `${modal.label} (${modal.count.toLocaleString()})`;
  } else {
    statsCategoricalModalValue.textContent = '—';
  }

  statsCategoricalValues.replaceChildren();
  entries.forEach(entry => {
    const row = document.createElement('tr');
    const valueCell = document.createElement('td');
    valueCell.textContent = entry.label;
    const countCell = document.createElement('td');
    countCell.textContent = entry.count.toLocaleString();
    row.append(valueCell, countCell);
    statsCategoricalValues.appendChild(row);
  });
}

function updateStatisticsSubjectControls() {
  const layer = getStatsLayer();
  const hasLayerData = Boolean(layer?.geojson);
  if (!hasLayerData) {
    statsSubjectControls.buttons.forEach(button => { button.disabled = true; });
    statsSubjectControls.categoryControls.style.display = 'none';
    statsSubjectControls.filterControls.style.display = 'none';
    statsCategoryFieldSelect.disabled = true;
    statsCategoryValueSelect.disabled = true;
    return;
  }
  statsSubjectControls.buttons.forEach(button => { button.disabled = false; });
  updateSubjectControls(
    statsSubjectControls,
    S.statsSubjectMode,
    statsCategoryFieldSelect.options.length > 1,
    Boolean(S.statsCategoryField)
  );
}

function updateStatisticsSubjectButtons() {
  updateSubjectButtons(statsSubjectControls, S.statsSubjectMode);
}

function setStatsSubjectMode(mode: SubjectMode) {
  S.statsSubjectMode = mode;
  updateStatisticsSubjectButtons();
  updateStatisticsSubjectControls();
  updateStatisticsSectionVisibility();
  updateStatisticsResults();
}

function updateStatisticsSectionVisibility() {
  const shouldShow = S.statsSubjectMode !== 'category' || S.statsCategoryValueIndices.length > 0;
  statisticsSection.style.display = shouldShow ? 'grid' : 'none';
  if (!shouldShow) {
    statsDetails.style.display = 'none';
    statsNumericBlock.style.display = 'none';
    statsCategoricalBlock.style.display = 'none';
    return;
  }
  populateStatisticsFields();
  const hasField = Boolean(S.statsField);
  statsDetails.style.display = hasField ? 'grid' : 'none';
  if (!hasField) {
    S.statsFieldType = null;
    statsNumericBlock.style.display = 'none';
    statsCategoricalBlock.style.display = 'none';
    return;
  }
  const layer = getStatsLayer();
  const dataStore = getLayerDataStore(layer);
  const useDataSource = S.statsSubjectMode === 'category' || S.statsSubjectMode === 'filtered';
  const numericFields = useDataSource ? dataStore?.chosenNumericFields ?? [] : layer?.chosenNumericFields ?? [];
  const categoricalFields = useDataSource ? dataStore?.chosenCategoricalFields ?? [] : layer?.chosenCategoricalFields ?? [];
  S.statsFieldType = getStatsFieldType(S.statsField, numericFields, categoricalFields);
  if (!S.statsFieldType) {
    statsNumericBlock.style.display = 'none';
    statsCategoricalBlock.style.display = 'none';
    statsNormalizationControls.style.display = 'none';
    return;
  }
  const isNumeric = S.statsFieldType === 'numeric';
  statsNumericBlock.style.display = isNumeric ? 'grid' : 'none';
  statsCategoricalBlock.style.display = isNumeric ? 'none' : 'grid';
  statsNormalizationControls.style.display = isNumeric ? 'grid' : 'none';
  updateStatisticsNormalizationControls();
}

function refreshStatisticsPanel() {
  populateStatisticsCategoryFields();
  populateStatisticsCategoryValues(S.statsCategoryField);

  S.statsFilteredName = renderSubjectFilterOptions(statsSubjectControls, S.statsFilteredName);
  updateStatisticsSubjectButtons();
  updateStatisticsSubjectControls();
  updateStatisticsSectionVisibility();

  if (S.statsField) {
    updateStatisticsResults();
  } else {
    resetStatisticsDisplay();
  }
}

function populateScatterCategoryFields() {
  scatterCategoryFieldSelect.replaceChildren();
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  scatterCategoryFieldSelect.appendChild(placeholder);

  const scatterStore = getScatterDataStore();
  const scatterGeoJSON = scatterStore?.geojson ?? null;
  if (!scatterGeoJSON || !scatterStore) {
    scatterCategoryFieldSelect.disabled = true;
    S.scatterCategoryField = null;
    return;
  }

  const availableCategorical = scatterStore.chosenCategoricalFields.filter(k =>
    scatterGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );

  availableCategorical.forEach(field => {
    scatterCategoryFieldSelect.appendChild(new Option(field, field));
  });

  scatterCategoryFieldSelect.disabled = availableCategorical.length === 0;
  if (S.scatterCategoryField && availableCategorical.includes(S.scatterCategoryField)) {
    scatterCategoryFieldSelect.value = S.scatterCategoryField;
  } else {
    S.scatterCategoryField = null;
  }
}

function populateScatterCategoryValues(field: string | null) {
  scatterCategoryValueSelect.replaceChildren();
  const placeholder = new Option('Choose value(s)', '');
  placeholder.disabled = true;
  placeholder.selected = S.scatterCategoryValueIndices.length === 0;
  scatterCategoryValueSelect.appendChild(placeholder);

  const scatterStore = getScatterDataStore();
  const scatterGeoJSON = scatterStore?.geojson ?? null;
  if (!scatterGeoJSON || !field) {
    scatterCategoryValueSelect.disabled = true;
    S.scatterCategoryValueMap = [];
    S.scatterCategoryValueIndices = [];
    return;
  }

  const valueMap = new Map<string, { label: string; value: unknown }>();
  scatterGeoJSON.features.forEach(feature => {
    const raw = (feature.properties as Record<string, unknown> | undefined)?.[field];
    if (raw === null || raw === undefined) return;
    const key = `${typeof raw}:${String(raw)}`;
    if (!valueMap.has(key)) {
      valueMap.set(key, { label: String(raw), value: raw });
    }
  });

  S.scatterCategoryValueMap = Array.from(valueMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  S.scatterCategoryValueMap.forEach((entry, index) => {
    scatterCategoryValueSelect.appendChild(new Option(entry.label, String(index)));
  });

  scatterCategoryValueSelect.disabled = false;
  const validSelections = new Set(
    S.scatterCategoryValueIndices.filter(index => S.scatterCategoryValueMap[Number(index)])
  );
  S.scatterCategoryValueIndices = Array.from(validSelections);
  Array.from(scatterCategoryValueSelect.options).forEach(option => {
    option.selected = validSelections.has(option.value);
  });
  if (S.scatterCategoryValueIndices.length === 0) {
    placeholder.selected = true;
  }
}

function populateScatterFieldSelect(
  select: HTMLSelectElement,
  currentValue: string | null,
  availableNumeric: string[]
): string | null {
  select.replaceChildren();
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  const scatterStore = getScatterDataStore();
  const scatterGeoJSON = scatterStore?.geojson ?? null;
  if (!scatterGeoJSON) {
    select.disabled = true;
    return null;
  }

  availableNumeric.forEach(field => {
    select.appendChild(new Option(field, field));
  });

  select.disabled = availableNumeric.length === 0;
  if (currentValue && availableNumeric.includes(currentValue)) {
    select.value = currentValue;
    return currentValue;
  }
  return null;
}

function populateScatterFields() {
  const scatterStore = getScatterDataStore();
  const scatterGeoJSON = scatterStore?.geojson ?? null;
  if (!scatterGeoJSON || !scatterStore) {
    S.scatterXField = null;
    S.scatterYField = null;
    scatterXFieldSelect.disabled = true;
    scatterYFieldSelect.disabled = true;
    return;
  }
  const availableNumeric = scatterStore.chosenNumericFields.filter(k =>
    scatterGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );
  S.scatterXField = populateScatterFieldSelect(scatterXFieldSelect, S.scatterXField, availableNumeric);
  S.scatterYField = populateScatterFieldSelect(scatterYFieldSelect, S.scatterYField, availableNumeric);
}

function updateScatterSubjectControls() {
  const layer = getScatterLayer();
  const scatterStore = getScatterDataStore();
  const scatterGeoJSON = scatterStore?.geojson ?? null;
  if (!layer || !scatterGeoJSON) {
    scatterSubjectControls.buttons.forEach(button => { button.disabled = true; });
    scatterSubjectControls.categoryControls.style.display = 'none';
    scatterSubjectControls.filterControls.style.display = 'none';
    scatterCategoryFieldSelect.disabled = true;
    scatterCategoryValueSelect.disabled = true;
    return;
  }
  scatterSubjectControls.buttons.forEach(button => { button.disabled = false; });
  updateSubjectControls(
    scatterSubjectControls,
    S.scatterSubjectMode,
    scatterCategoryFieldSelect.options.length > 1,
    Boolean(S.scatterCategoryField)
  );
}

function updateScatterSubjectButtons() {
  updateSubjectButtons(scatterSubjectControls, S.scatterSubjectMode);
}

function setScatterSubjectMode(mode: SubjectMode) {
  S.scatterSubjectMode = mode;
  updateScatterSubjectButtons();
  updateScatterSubjectControls();
  S.scatterRangeIsCustom = false;
  scheduleScatterPlotRefresh();
}

function getPlotly(): any | null {
  return (window as any).Plotly ?? null;
}

function parseScatterRangeInput(input: HTMLInputElement): number | null {
  const value = input.value.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setScatterRangeInputs(range: { xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null }) {
  S.isUpdatingScatterRangeInputs = true;
  scatterXMinInput.value = range.xMin === null ? '' : String(range.xMin);
  scatterXMaxInput.value = range.xMax === null ? '' : String(range.xMax);
  scatterYMinInput.value = range.yMin === null ? '' : String(range.yMin);
  scatterYMaxInput.value = range.yMax === null ? '' : String(range.yMax);
  S.isUpdatingScatterRangeInputs = false;
}

function setScatterRangeControlsEnabled(enabled: boolean) {
  scatterXMinInput.disabled = !enabled;
  scatterXMaxInput.disabled = !enabled;
  scatterYMinInput.disabled = !enabled;
  scatterYMaxInput.disabled = !enabled;
  scatterResetExtentsButton.disabled = !enabled;
}

function clearScatterRangeControls() {
  setScatterRangeInputs({ xMin: null, xMax: null, yMin: null, yMax: null });
  S.scatterRangeIsCustom = false;
}

function resetScatterPlot(message: string) {
  scatterPlotEmpty.textContent = message;
  scatterPlotEmpty.style.display = 'block';
  setScatterRangeControlsEnabled(false);
  clearScatterRangeControls();
  const plotly = getPlotly();
  if (plotly) {
    plotly.purge(scatterPlot);
  }
  scatterPlot.innerHTML = '';
}

function updateScatterPlot() {
  const plotly = getPlotly();
  if (!plotly) {
    resetScatterPlot('Plotly is still loading. Please try again in a moment.');
    return;
  }
  const layer = getScatterLayer();
  if (!layer) {
    resetScatterPlot('Select a layer to render the scatterplot.');
    return;
  }
  const scatterStore = getScatterDataStore();
  const scatterGeoJSON = scatterStore?.geojson ?? null;
  if (!scatterGeoJSON || !layer.geojson) {
    resetScatterPlot('Load data to render the scatterplot.');
    return;
  }
  if (S.scatterSubjectMode === 'category' && (!S.scatterCategoryField || S.scatterCategoryValueIndices.length === 0)) {
    resetScatterPlot('Choose category values to render the scatterplot.');
    return;
  }
  if (S.scatterSubjectMode === 'filtered' && !S.scatterFilteredName) {
    if (S.savedFiltersStore.size === 0) {
      resetScatterPlot('No saved filters available for the scatterplot.');
    } else {
      resetScatterPlot('Select a saved filter to render the scatterplot.');
    }
    return;
  }
  if (!S.scatterXField || !S.scatterYField) {
    resetScatterPlot('Select X and Y fields to render the scatterplot.');
    return;
  }

  const selection = getScatterSubjectSelection(
    layer,
    layer.geojson,
    scatterGeoJSON,
    S.scatterSubjectMode,
    S.scatterCategoryField,
    S.scatterCategoryValueIndices,
    S.scatterCategoryValueMap,
    S.scatterFilteredName
  );
  const xValues: number[] = [];
  const yValues: number[] = [];
  selection.forEach(feature => {
    const props = (feature.properties as Record<string, unknown> | undefined) ?? {};
    const xVal = numOrNull(props[S.scatterXField]);
    const yVal = numOrNull(props[S.scatterYField]);
    if (xVal === null || yVal === null) return;
    xValues.push(xVal);
    yValues.push(yVal);
  });

  if (xValues.length === 0) {
    resetScatterPlot('No data available for the current selection.');
    return;
  }

  scatterPlotEmpty.style.display = 'none';
  setScatterRangeControlsEnabled(true);
  const xMinDefault = Math.min(...xValues);
  const xMaxDefault = Math.max(...xValues);
  const yMinDefault = Math.min(...yValues);
  const yMaxDefault = Math.max(...yValues);
  S.scatterDefaultRange = { xMin: xMinDefault, xMax: xMaxDefault, yMin: yMinDefault, yMax: yMaxDefault };
  if (!S.scatterRangeIsCustom) {
    setScatterRangeInputs(S.scatterDefaultRange);
  }
  const xMin = S.scatterRangeIsCustom ? (parseScatterRangeInput(scatterXMinInput) ?? xMinDefault) : xMinDefault;
  const xMax = S.scatterRangeIsCustom ? (parseScatterRangeInput(scatterXMaxInput) ?? xMaxDefault) : xMaxDefault;
  const yMin = S.scatterRangeIsCustom ? (parseScatterRangeInput(scatterYMinInput) ?? yMinDefault) : yMinDefault;
  const yMax = S.scatterRangeIsCustom ? (parseScatterRangeInput(scatterYMaxInput) ?? yMaxDefault) : yMaxDefault;
  const trace = {
    x: xValues,
    y: yValues,
    type: 'scatter',
    mode: 'markers',
    marker: { size: 6, color: 'rgba(59, 130, 246, 0.7)' }
  };
  const layout = {
    margin: { l: 48, r: 16, t: 8, b: 42 },
    height: 220,
    xaxis: { title: S.scatterXField, range: [Math.min(xMin, xMax), Math.max(xMin, xMax)] },
    yaxis: { title: S.scatterYField, range: [Math.min(yMin, yMax), Math.max(yMin, yMax)] }
  };
  const config = { displayModeBar: false, responsive: true, staticPlot: true };
  plotly.react(scatterPlot, [trace], layout, config);
}

function scheduleScatterPlotRefresh() {
  if (S.scatterPlotRefreshTimer !== null) {
    window.clearTimeout(S.scatterPlotRefreshTimer);
  }
  S.scatterPlotRefreshTimer = window.setTimeout(() => {
    S.scatterPlotRefreshTimer = null;
    if (S.isScatterplotMinimized) return;
    updateScatterPlot();
  }, 250);
}

function refreshScatterPanel() {
  renderScatterLayerOptions();
  populateScatterCategoryFields();
  populateScatterCategoryValues(S.scatterCategoryField);
  populateScatterFields();
  S.scatterFilteredName = renderSubjectFilterOptions(scatterSubjectControls, S.scatterFilteredName);
  updateScatterSubjectButtons();
  updateScatterSubjectControls();
  scheduleScatterPlotRefresh();
}

// Dragging functions

function updateCurrentLayerDetails() {
  if (!currentLayerSource) return;
  if (!S.currentLayerId) {
    currentLayerSource.textContent = 'source: —';
    return;
  }
  const layer = S.layers.get(S.currentLayerId);
  if (!layer) {
    currentLayerSource.textContent = 'source: —';
    return;
  }
  const store = S.dataStores.get(layer.dataStoreId);
  const sourceName = store?.file?.name ?? store?.name ?? '—';
  currentLayerSource.textContent = `source: ${sourceName}`;
}

function renderLayerList() {
  if (!layerList) return;
  layerList.replaceChildren();

  if (S.layerOrder.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No layers loaded yet.';
    layerList.appendChild(empty);
    updateCurrentLayerDetails();
    S.statsLayerId = null;
    S.scatterLayerId = null;
    renderStatsLayerOptions();
    renderScatterLayerOptions();
    refreshStatisticsPanel();
    refreshScatterPanel();
    return;
  }

  S.layerOrder.forEach((layerId, index) => {
    const layer = S.layers.get(layerId);
    if (!layer) return;

    const row = document.createElement('div');
    row.className = `layer-row${layerId === S.currentLayerId ? ' current' : ''}`;

    const visibilityToggle = createEyeButton(!layer.visible, layer.visible ? 'Hide layer' : 'Show layer');
    visibilityToggle.addEventListener('click', () => {
      const nextVisible = !layer.visible;
      setLayerVisibility(layer, nextVisible);
      visibilityToggle.title = nextVisible ? 'Hide layer' : 'Show layer';
      setEyeButtonIcon(visibilityToggle, !nextVisible);
    });

    const currentRadio = document.createElement('input');
    currentRadio.type = 'radio';
    currentRadio.name = 'currentLayer';
    currentRadio.checked = layerId === S.currentLayerId;
    currentRadio.title = 'Set as current layer';
    currentRadio.addEventListener('change', () => {
      if (currentRadio.checked) setCurrentLayer(layerId);
    });

    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'layer-name';
    nameButton.textContent = layer.field ?? `layer ${index + 1}`
    nameButton.addEventListener('click', () => setCurrentLayer(layerId));

    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'layer-action-btn';
    moveUpBtn.textContent = '▲';
    moveUpBtn.title = 'Move layer up';
    moveUpBtn.disabled = S.layerOrder.indexOf(layerId) === 0;
    moveUpBtn.addEventListener('click', () => moveLayerInOrder(layerId, 'up'));

    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'layer-action-btn';
    moveDownBtn.textContent = '▼';
    moveDownBtn.title = 'Move layer down';
    moveDownBtn.disabled = S.layerOrder.indexOf(layerId) === S.layerOrder.length - 1;
    moveDownBtn.addEventListener('click', () => moveLayerInOrder(layerId, 'down'));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'layer-action-btn';
    deleteBtn.textContent = '❌';
    deleteBtn.title = 'Delete layer';
    deleteBtn.addEventListener('click', () => {
      if (!confirm(`Delete layer "${layer.name}"?`)) return;
      removeLayer(layerId);
      applyLayerOrderToMap();
    });

    row.append(visibilityToggle, currentRadio, nameButton, moveUpBtn, moveDownBtn, deleteBtn);
    layerList.appendChild(row);
  });

  updateCurrentLayerDetails();
  const prevStatsLayer = S.statsLayerId;
  const prevScatterLayer = S.scatterLayerId;
  renderStatsLayerOptions();
  renderScatterLayerOptions();
  if (prevStatsLayer !== S.statsLayerId) {
    S.statsCategoryField = null;
    S.statsCategoryValueIndices = [];
    S.statsField = null;
    S.statsFieldType = null;
    refreshStatisticsPanel();
  }
  if (prevScatterLayer !== S.scatterLayerId) {
    S.scatterCategoryField = null;
    S.scatterCategoryValueIndices = [];
    S.scatterXField = null;
    S.scatterYField = null;
    S.scatterRangeIsCustom = false;
    refreshScatterPanel();
  }
}

// Floating legend functions — see ./legend.ts

// updateFloatingLegend, updateCategoricalFloatingLegend, updateNumericFloatingLegend,
// openSwatchColorPicker, applyExtrusionWithCustomColors — moved to ./legend.ts
  
  // Add field name and type at the top of the legend content
  const fieldInfo = document.createElement('div');
  fieldInfo.style.cssText = `
    font-size: 12px;
    color: #666;
    margin-bottom: 8px;
    padding: 4px 0;
    border-bottom: 1px solid #eee;
  `;
  fieldInfo.innerHTML = `
    <div style="font-weight: 600; color: #333;">${S.currentField}</div>
    <div>Type: ${S.currentFieldType}</div>
  `;
  legendContent.appendChild(fieldInfo);
  
  // Add zoom to selected button on its own row
  const zoomRow = document.createElement('div');
  zoomRow.style.cssText = `
    display: flex;
    justify-content: flex-end;
    padding: 4px;
    margin-bottom: 4px;
    border-bottom: 1px solid #eee;
  `;
  
  const zoomBtn = document.createElement('button');
  zoomBtn.textContent = 'Zoom to selected';
  zoomBtn.title = 'Zoom to bounding box of selected items';
  zoomBtn.style.cssText = `
    border: 1px solid #ccc;
    background: #f8f9fa;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
  `;
  
  zoomBtn.onclick = () => {
    if (S.selectedLegendItems.size === 0) {
      // Show a toast or alert that no items are selected
      return;
    }
    
    // Get the bounding box from the markup layer source
    const markupSource = S.map.getSource('markup-source') as maplibregl.GeoJSONSource;
    if (markupSource) {
      const data = markupSource.serialize();
      if (data.data && typeof data.data === 'object' && 'features' in data.data && Array.isArray(data.data.features) && data.data.features.length > 0) {
        const feature = data.data.features[0];
        if (feature.geometry.type === 'Polygon' && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length > 0) {
          const bbox = feature.geometry.coordinates[0];
          const bounds: [number, number, number, number] = [
            Math.min(...bbox.map((coord: number[]) => coord[0])),
            Math.min(...bbox.map((coord: number[]) => coord[1])),
            Math.max(...bbox.map((coord: number[]) => coord[0])),
            Math.max(...bbox.map((coord: number[]) => coord[1]))
          ];
          
          S.map.fitBounds(bounds, { padding: 50 });
        }
      }
    }
  };
  
  zoomRow.appendChild(zoomBtn);
  legendContent.appendChild(zoomRow);
  
  // Add header bar with column headers
  const headerBar = document.createElement('div');
  headerBar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
    margin-bottom: 4px;
    border-bottom: 1px solid #eee;
    font-size: 12px;
    font-weight: 600;
  `;
  
  function getLegendCategories() {
    const categories = new Set<string>();
    if (!S.currentGeoJSON) return categories;
    for (const feature of S.currentGeoJSON.features) {
      const value = feature.properties?.[S.currentField!];
      if (value != null && value !== '' && value !== undefined) {
        categories.add(String(value));
      }
    }
    return categories;
  }

  const isAllLegendHidden = () => {
    if (S.currentFieldType === 'categorical') {
      const categories = getLegendCategories();
      return categories.size > 0 && Array.from(categories).every(cat => S.hiddenLegendItems.has(cat));
    }
    const ranges = S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length
      ? S.colorBreaks.length + 1
      : 10;
    return Array.from({ length: ranges }, (_, i) => `range_${i}`).every(rangeKey => S.hiddenLegendItems.has(rangeKey));
  };

  // Eye toggle all button
  const eyeAllBtn = createEyeButton(isAllLegendHidden(), 'Toggle all visibility');
  
  eyeAllBtn.onclick = () => {
    if (S.currentFieldType === 'categorical') {
      // Toggle all categorical items
      const categories = new Set<string>();
      for (const feature of S.currentGeoJSON!.features) {
        const value = feature.properties?.[S.currentField!];
        if (value != null && value !== '' && value !== undefined) {
          categories.add(String(value));
        }
      }
      
      const allHidden = Array.from(categories).every(cat => S.hiddenLegendItems.has(cat));
      if (allHidden) {
        // Show all
        categories.forEach(cat => S.hiddenLegendItems.delete(cat));
      } else {
        // Hide all
        categories.forEach(cat => S.hiddenLegendItems.add(cat));
      }
    } else {
      // Toggle all numeric ranges
      const ranges = S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length 
        ? S.colorBreaks.length + 1 
        : 10;
      
      const allHidden = Array.from({length: ranges}, (_, i) => `range_${i}`).every(rangeKey => S.hiddenLegendItems.has(rangeKey));
      if (allHidden) {
        // Show all
        for (let i = 0; i < ranges; i++) {
          S.hiddenLegendItems.delete(`range_${i}`);
        }
      } else {
        // Hide all
        for (let i = 0; i < ranges; i++) {
          S.hiddenLegendItems.add(`range_${i}`);
        }
      }
    }
    
    updateFloatingLegend();
    applyExtrusionWithVisibility();
  };

  

  const getLegendRanges = () => {
    const rangeBounds: { min: number; max: number; key: string }[] = [];
    if (!S.currentStats) return rangeBounds;
    if (S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length) {
      const breaks = [S.currentStats.min, ...S.colorBreaks, S.currentStats.max];
      for (let i = 0; i < breaks.length - 1; i++) {
        rangeBounds.push({ min: breaks[i], max: breaks[i + 1], key: `range_${i}` });
      }
    } else {
      const min = S.currentStats.min;
      const max = S.currentStats.max;
      const step = (max - min) / 10;
      for (let i = 0; i < 10; i++) {
        rangeBounds.push({
          min: min + (step * i),
          max: i === 9 ? max : min + (step * (i + 1)),
          key: `range_${i}`
        });
      }
    }
    return rangeBounds;
  };

  // Checkbox toggle all
  const checkboxAll = document.createElement('input');
  checkboxAll.type = 'checkbox';
  checkboxAll.style.cssText = `
    margin: 0;
    flex-shrink: 0;
  `;
  
  // Set initial state based on current selections
  if (S.currentFieldType === 'categorical') {
    const categories = getLegendCategories();
    checkboxAll.checked = categories.size > 0 && Array.from(categories).every(cat => S.selectedLegendItems.has(cat));
  } else {
    const ranges = S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length
      ? S.colorBreaks.length + 1
      : 10;
    checkboxAll.checked = ranges > 0 && Array.from({length: ranges}, (_, i) => `range_${i}`).every(rangeKey => S.selectedLegendItems.has(rangeKey));
  }
  
  checkboxAll.onchange = () => {
    const sourceId = getCurrentSourceId();
    if (!sourceId) return;
    if (S.currentFieldType === 'categorical') {
      const categories = getLegendCategories();
      categories.forEach(category => applyCategorySelection(category, checkboxAll.checked, sourceId));
    } else {
      const ranges = getLegendRanges();
      ranges.forEach(range => applyRangeSelection(range.key, range, checkboxAll.checked, sourceId));
    }
    
    updateSelectionControls();
    updateFloatingLegend(); // Refresh to update checkbox states
  };
  
  // Add blank space for swatch column
  const swatchSpacer = document.createElement('div');
  swatchSpacer.style.cssText = `
    width: 20px;
    flex-shrink: 0;
  `;
  
  // Add column headers as buttons
  const nameHeader = document.createElement('button');
  nameHeader.textContent = 'Name';
  nameHeader.style.cssText = `
    font-size: 12px;
    font-weight: 600;
    flex-grow: 1;
    margin-left: 8px;
    border: 1px solid #ccc;
    background: #f8f9fa;
    cursor: pointer;
    text-align: left;
    padding: 4px 6px;
    border-radius: 4px;
    transition: all 0.2s ease;
    color: #333;
  `;
  
  const countHeader = document.createElement('button');
  countHeader.textContent = '#';
  countHeader.style.cssText = `
    font-size: 12px;
    font-weight: 600;
    width: 30px;
    text-align: center;
    flex-shrink: 0;
    border: 1px solid #ccc;
    background: #f8f9fa;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    transition: all 0.2s ease;
    color: #333;
  `;

  // Add sorting functionality
  nameHeader.onclick = () => {
    if (S.legendSortField === 'name') {
      S.legendSortDirection = S.legendSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      S.legendSortField = 'name';
      S.legendSortDirection = 'asc';
    }
    updateFloatingLegend();
    persistCurrentLayerState();
  };

  countHeader.onclick = () => {
    if (S.legendSortField === 'count') {
      S.legendSortDirection = S.legendSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      S.legendSortField = 'count';
      S.legendSortDirection = 'asc';
    }
    updateFloatingLegend();
    persistCurrentLayerState();
  };

  // Add hover effects
  nameHeader.onmouseenter = () => {
    nameHeader.style.background = '#e9ecef';
    nameHeader.style.borderColor = '#adb5bd';
    nameHeader.style.transform = 'translateY(-1px)';
  };

  nameHeader.onmouseleave = () => {
    nameHeader.style.background = '#f8f9fa';
    nameHeader.style.borderColor = '#ccc';
    nameHeader.style.transform = 'translateY(0)';
  };

  countHeader.onmouseenter = () => {
    countHeader.style.background = '#e9ecef';
    countHeader.style.borderColor = '#adb5bd';
    countHeader.style.transform = 'translateY(-1px)';
  };

  countHeader.onmouseleave = () => {
    countHeader.style.background = '#f8f9fa';
    countHeader.style.borderColor = '#ccc';
    countHeader.style.transform = 'translateY(0)';
  };
  
  // Update button text to show sort indicators
  const updateSortIndicators = () => {
    nameHeader.textContent = 'Name';
    countHeader.textContent = '#';
    
    if (S.legendSortField === 'name') {
      nameHeader.textContent += S.legendSortDirection === 'asc' ? ' ↑' : ' ↓';
    } else if (S.legendSortField === 'count') {
      countHeader.textContent += S.legendSortDirection === 'asc' ? ' ↑' : ' ↓';
    }
  };
  
  updateSortIndicators();
  
  headerBar.appendChild(eyeAllBtn);
  headerBar.appendChild(checkboxAll);
  headerBar.appendChild(swatchSpacer);
  headerBar.appendChild(nameHeader);
  headerBar.appendChild(countHeader);
  legendContent.appendChild(headerBar);
  
  // Store references to update sort indicators later
  (legendContent as any)._nameHeader = nameHeader;
  (legendContent as any)._countHeader = countHeader;
  (legendContent as any)._updateSortIndicators = updateSortIndicators;
  
  if (S.currentFieldType === 'categorical') {
    updateCategoricalFloatingLegend();
  } else {
    updateNumericFloatingLegend();
  }
}

function updateCategoricalFloatingLegend() {
  if (!S.currentField || !S.currentGeoJSON) return;
  
  // Pre-calculate counts for all categories in a single pass
  const categoryCounts = new Map<string, number>();
  for (const feature of S.currentGeoJSON.features) {
    const value = feature.properties?.[S.currentField];
    if (value != null && value !== '' && value !== undefined) {
      const category = String(value);
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
  }
  
  let sortedCategories = Array.from(categoryCounts.keys());
  
  // Apply sorting if specified
  if (S.legendSortField === 'name') {
    sortedCategories.sort((a, b) => {
      const comparison = a.localeCompare(b);
      return S.legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else if (S.legendSortField === 'count') {
    sortedCategories.sort((a, b) => {
      const countA = categoryCounts.get(a) || 0;
      const countB = categoryCounts.get(b) || 0;
      const comparison = countA - countB;
      return S.legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else {
    // Default alphabetical sort
    sortedCategories.sort();
  }

  const pairs = buildCategoricalColorPairs();
  const categoryToColor = new Map<string, string>();
  for (const pair of pairs) {
    const category : string = pair[0];
    const color : string = pair[1];
    categoryToColor.set(category, color);
  }

  let fallbackColor = '#888';
  if (S.categoricalColorMode === 'single') {
    fallbackColor = S.singleColorValue;
  }
  

  // Add search bar to legend
  const searchContainer = document.createElement('div');
  searchContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    padding: 4px;
  `;
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search categories...';
  searchInput.style.cssText = `
    flex: 1;
    padding: 4px 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 12px;
  `;
  
  searchContainer.appendChild(searchInput);
  legendContent.appendChild(searchContainer);
  
  // Create legend items
  sortedCategories.forEach(category => {
    const color = categoryToColor.get(category) || fallbackColor;
    const isHidden = S.hiddenLegendItems.has(category);
    const count = categoryCounts.get(category) || 0;
    
    const item = document.createElement('div');
    item.setAttribute('data-category', category);
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      border-radius: 4px;
      margin-bottom: 2px;
      ${isHidden ? 'opacity: 0.5;' : ''}
    `;
    
    // Color swatch
    const swatch = document.createElement('div');
    swatch.style.cssText = `
      width: 20px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid #ddd;
      background: ${color};
      flex-shrink: 0;
    `;
    
    // Category label
    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 12px;
      flex-grow: 1;
      word-break: break-word;
    `;
    label.textContent = category;
    
    // Count display
    const countDisplay = document.createElement('div');
    countDisplay.style.cssText = `
      font-size: 12px;
      width: 30px;
      text-align: center;
      flex-shrink: 0;
      color: #666;
    `;
    countDisplay.textContent = count.toString();
    
     // Eye toggle button
     const eyeBtn = createEyeButton(isHidden, isHidden ? 'Show this category' : 'Hide this category');
     
     eyeBtn.onclick = () => {
       if (S.hiddenLegendItems.has(category)) {
         S.hiddenLegendItems.delete(category);
       } else {
         S.hiddenLegendItems.add(category);
       }
       updateFloatingLegend();
       applyExtrusionWithVisibility();
     };
     
     // Selection checkbox
     const checkbox = document.createElement('input');
     checkbox.type = 'checkbox';
     checkbox.checked = S.selectedLegendItems.has(category);
     checkbox.style.cssText = `
       margin: 0;
       flex-shrink: 0;
     `;
     
     checkbox.onchange = () => {
       const sourceId = getCurrentSourceId();
       if (!sourceId) return;
       applyCategorySelection(category, checkbox.checked, sourceId);
       updateSelectionControls();
       updateFloatingLegend(); // Refresh to update header checkbox state
     };
     
     // Make swatch clickable for color picker
     swatch.style.cursor = 'pointer';
     swatch.onclick = () => openSwatchColorPicker(category, color, swatch);
     
     item.appendChild(eyeBtn);
     item.appendChild(checkbox);
     item.appendChild(swatch);
     item.appendChild(label);
     item.appendChild(countDisplay);
     legendContent.appendChild(item);
  });
  
  // Update sort indicators
  if ((legendContent as any)._updateSortIndicators) {
    (legendContent as any)._updateSortIndicators();
  }
  
  // Add search functionality
  const filterCategories = (searchText: string) => {
    const items = legendContent.querySelectorAll('[data-category]');
    items.forEach(item => {
      const category = item.getAttribute('data-category') || '';
      const matches = category.toLowerCase().includes(searchText.toLowerCase());
      (item as HTMLElement).style.display = matches ? 'flex' : 'none';
    });
  };
  
  searchInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    filterCategories(target.value);
  });
  
}

function updateNumericFloatingLegend() {
  if (!S.currentField || !S.currentGeoJSON || !S.currentStats) return;
  
  const ranges = buildNumericColorRanges();
  if (ranges.length === 0) return;
  
  // Convert ranges to the format expected by the legend
  const legendRanges: { min: number; max: number; color: string; label: string; rangeKey: string }[] = ranges.map(range => ({
    min: range.min,
    max: range.max,
    color: range.color,
    label: `${fmt(range.min)} - ${fmt(range.max)}`,
    rangeKey: range.rangeKey
  }));
  
  // Pre-calculate counts for all ranges in a single pass
  const rangeCounts = new Map<string, number>();
  for (const feature of S.currentGeoJSON!.features) {
    const value = feature.properties?.[S.currentField!];
    if (value != null && value !== '' && value !== undefined) {
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        // Find which range this value belongs to
        for (let i = 0; i < legendRanges.length; i++) {
          const range = legendRanges[i];
          if (numValue >= range.min && numValue <= range.max) {
            const rangeKey = range.rangeKey;
            rangeCounts.set(rangeKey, (rangeCounts.get(rangeKey) || 0) + 1);
            break;
          }
        }
      }
    }
  }
  
  // Create array of range data with counts for sorting
  const rangeData = legendRanges.map((range, index) => {
    const rangeKey = range.rangeKey;
    const count = rangeCounts.get(rangeKey) || 0;
    return { range, index, rangeKey, count };
  });
  
  // Apply sorting if specified
  if (S.legendSortField === 'name') {
    rangeData.sort((a, b) => {
      // For numeric fields, sort by the actual numeric values (min value of each range)
      const comparison = a.range.min - b.range.min;
      return S.legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else if (S.legendSortField === 'count') {
    rangeData.sort((a, b) => {
      const comparison = a.count - b.count;
      return S.legendSortDirection === 'asc' ? comparison : -comparison;
    });
  }
  
  // Add search bar to legend
  const searchContainer = document.createElement('div');
  searchContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    padding: 4px;
  `;
  
  const searchLabel = document.createElement('span');
  searchLabel.textContent = 'Find:';
  searchLabel.style.cssText = 'font-size: 12px;';
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search ranges...';
  searchInput.style.cssText = `
    flex: 1;
    padding: 4px 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 12px;
  `;
  
  const clearButton = document.createElement('button');
  clearButton.textContent = 'Clear';
  clearButton.style.cssText = `
    padding: 4px 8px;
    border: 1px solid #ddd;
    background: #f8f8f8;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  `;
  
  searchContainer.appendChild(searchLabel);
  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(clearButton);
  legendContent.appendChild(searchContainer);
  
  // Create legend items
  rangeData.forEach(({ range, index, rangeKey, count }) => {
    const isHidden = S.hiddenLegendItems.has(rangeKey);
    
    // Color is already applied from the inner function
    const color = range.color;
    
    const item = document.createElement('div');
    item.setAttribute('data-range', range.label);
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      border-radius: 4px;
      margin-bottom: 2px;
      ${isHidden ? 'opacity: 0.5;' : ''}
    `;
    
    // Color swatch
    const swatch = document.createElement('div');
    swatch.style.cssText = `
      width: 20px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid #ddd;
      background: ${color};
      flex-shrink: 0;
    `;
    
    // Range label
    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 12px;
      flex-grow: 1;
    `;
    label.textContent = range.label;
    
    // Count display
    const countDisplay = document.createElement('div');
    countDisplay.style.cssText = `
      font-size: 12px;
      width: 30px;
      text-align: center;
      flex-shrink: 0;
      color: #666;
    `;
    countDisplay.textContent = count.toString();
    
         // Eye toggle button
     const eyeBtn = createEyeButton(isHidden, isHidden ? 'Show this range' : 'Hide this range');
     
     eyeBtn.onclick = () => {
       if (S.hiddenLegendItems.has(rangeKey)) {
         S.hiddenLegendItems.delete(rangeKey);
       } else {
         S.hiddenLegendItems.add(rangeKey);
       }
       updateFloatingLegend();
       applyExtrusionWithVisibility();
     };
     
     // Selection checkbox
     const checkbox = document.createElement('input');
     checkbox.type = 'checkbox';
     checkbox.checked = S.selectedLegendItems.has(rangeKey);
     checkbox.style.cssText = `
       margin: 0;
       flex-shrink: 0;
     `;
     
     checkbox.onchange = () => {
       const sourceId = getCurrentSourceId();
       if (!sourceId) return;
       applyRangeSelection(rangeKey, range, checkbox.checked, sourceId);
       updateSelectionControls();
       updateFloatingLegend(); // Refresh to update header checkbox state
     };
     
     // Make swatch clickable for color picker
     swatch.style.cursor = 'pointer';
     swatch.onclick = () => openSwatchColorPicker(rangeKey, color, swatch);
     
     item.appendChild(eyeBtn);
     item.appendChild(checkbox);
     item.appendChild(swatch);
     item.appendChild(label);
     item.appendChild(countDisplay);
     legendContent.appendChild(item);
  });
  
  // Update sort indicators
  if ((legendContent as any)._updateSortIndicators) {
    (legendContent as any)._updateSortIndicators();
  }
  
  // Add search functionality
  const filterRanges = (searchText: string) => {
    const items = legendContent.querySelectorAll('[data-range]');
    items.forEach(item => {
      const rangeLabel = item.getAttribute('data-range') || '';
      const matches = rangeLabel.toLowerCase().includes(searchText.toLowerCase());
      (item as HTMLElement).style.display = matches ? 'flex' : 'none';
    });
  };
  
  searchInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    filterRanges(target.value);
  });
  
  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    filterRanges('');
  });
}

// Custom color overrides for individual legend items

function openSwatchColorPicker(itemKey: string, currentColor: string, swatchElement: HTMLElement) {
  // Create a temporary color input
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = currentColor;
  colorInput.style.cssText = `
    position: fixed;
    z-index: 10000;
    opacity: 0;
    pointer-events: none;
  `;
  
  // Position the color picker over the swatch using fixed positioning
  const rect = swatchElement.getBoundingClientRect();
  colorInput.style.left = `${rect.left}px`;
  colorInput.style.top = `${rect.top}px`;
  colorInput.style.width = `${rect.width}px`;
  colorInput.style.height = `${rect.height}px`;
  
  document.body.appendChild(colorInput);
  
  colorInput.addEventListener('change', () => {
    const newColor = colorInput.value;
    S.customColors.set(itemKey, newColor);
    
    // Update the visualization
    applyExtrusionWithCustomColors();
    updateFloatingLegend();
    
    document.body.removeChild(colorInput);
  });
  
  colorInput.addEventListener('blur', () => {
    // If user cancels, remove the input
    if (document.body.contains(colorInput)) {
      document.body.removeChild(colorInput);
    }
  });
  
  // Trigger the color picker
  colorInput.click();
}

function applyExtrusionWithCustomColors() {
  if (!S.currentGeoJSON || !S.currentField) return;
  const ids = getCurrentLayerIds();
  if (!ids) return;
  
  // If we have custom colors, we need to rebuild the color expression
  if (S.customColors.size > 0) {
    let colorExpr: any;
    
    if (S.currentFieldType === 'categorical') {
      colorExpr = buildCategoricalColorExpression();
    } else {
      colorExpr = buildNumericColorExpression();
    }
    
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
    
    // Apply height and opacity for numeric fields
    if (S.currentFieldType === 'numeric') {
      const rawMult = Number(multInput.value);
      const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
      const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
      const valueExpr = buildValueExpression();
      const heightExpr: any = S.is3DMode ? ['*', valueExpr, multiplier * unitFactor] : 0;
      
      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', heightExpr);
    } else {
      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
    }
    
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  } else {
    // No custom colors, use normal extrusion
    applyExtrusion();
  }
}


function getLandScheduleEntry(field: string, valueKey: string): LandScheduleBaseLot {
  let fieldMap = S.landScheduleStore.get(field);
  if (!fieldMap) {
    fieldMap = new Map();
    S.landScheduleStore.set(field, fieldMap);
  }
  let entry = fieldMap.get(valueKey);
  if (!entry) {
    entry = {
      min: null,
      max: null,
      value: null,
      per: null
    };
    fieldMap.set(valueKey, entry);
  }
  return entry;
}

function getAvailableLandScheduleFields(): string[] {
  if (!S.currentGeoJSON) return [];
  return S.chosenCategoricalFields.filter(k =>
    S.currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function setLandScheduleInputValue(input: HTMLInputElement, value: number | null) {
  input.value = value === null ? '' : String(value);
}

function updateLandScheduleInputsFromStore() {
  if (!S.currentLandScheduleField || !S.currentLandScheduleValue) {
    landScheduleValuationSection.style.display = 'none';
    return;
  }
  const entry = getLandScheduleEntry(S.currentLandScheduleField, S.currentLandScheduleValue);
  S.isUpdatingLandScheduleUI = true;
  setLandScheduleInputValue(landScheduleBaseMin, entry.min);
  setLandScheduleInputValue(landScheduleBaseMax, entry.max);
  setLandScheduleInputValue(landScheduleBaseValue, entry.value);
  landScheduleBasePer.value = entry.per ?? '';
  landScheduleValuationSection.style.display = 'grid';
  S.isUpdatingLandScheduleUI = false;
}

function updateLandScheduleStoreFromInputs() {
  if (S.isUpdatingLandScheduleUI || !S.currentLandScheduleField || !S.currentLandScheduleValue) return;
  const entry = getLandScheduleEntry(S.currentLandScheduleField, S.currentLandScheduleValue);
  entry.min = parseOptionalNumber(landScheduleBaseMin.value);
  entry.max = parseOptionalNumber(landScheduleBaseMax.value);
  entry.value = parseOptionalNumber(landScheduleBaseValue.value);
  entry.per = (landScheduleBasePer.value as LandSchedulePerUnit) || null;
}

function updateLandScheduleValueOptions() {
  landScheduleValueSelect.replaceChildren();
  landScheduleValuationSection.style.display = 'none';
  if (!S.currentLandScheduleField) {
    landScheduleValueRow.style.display = 'none';
    S.currentLandScheduleValue = null;
    return;
  }

  landScheduleFieldLabel.textContent = S.currentLandScheduleField;
  landScheduleValueRow.style.display = 'grid';

  landScheduleValueSelect.appendChild(new Option(LAND_SCHEDULE_DEFAULT_LABEL, LAND_SCHEDULE_DEFAULT_KEY));
  const values = getCategoricalValues(S.currentLandScheduleField);
  values.forEach(value => landScheduleValueSelect.appendChild(new Option(value, value)));

  if (S.currentLandScheduleValue && (S.currentLandScheduleValue === LAND_SCHEDULE_DEFAULT_KEY || values.includes(S.currentLandScheduleValue))) {
    landScheduleValueSelect.value = S.currentLandScheduleValue;
    updateLandScheduleInputsFromStore();
  } else {
    landScheduleValueSelect.selectedIndex = -1;
    S.currentLandScheduleValue = null;
  }
}

function refreshLandSchedulePanel() {
  landScheduleFieldSelect.replaceChildren();
  landScheduleValuationSection.style.display = 'none';
  const availableFields = getAvailableLandScheduleFields();

  if (!availableFields.length) {
    landScheduleFieldSelect.appendChild(new Option('No categorical fields', ''));
    landScheduleFieldSelect.value = '';
    landScheduleFieldSelect.disabled = true;
    S.currentLandScheduleField = null;
    S.currentLandScheduleValue = null;
    landScheduleValueRow.style.display = 'none';
    return;
  }

  landScheduleFieldSelect.disabled = false;
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  landScheduleFieldSelect.appendChild(placeholder);
  availableFields.forEach(field => landScheduleFieldSelect.appendChild(new Option(field, field)));

  if (S.currentLandScheduleField && availableFields.includes(S.currentLandScheduleField)) {
    landScheduleFieldSelect.value = S.currentLandScheduleField;
  } else {
    landScheduleFieldSelect.value = '';
    S.currentLandScheduleField = null;
    S.currentLandScheduleValue = null;
  }

  updateLandScheduleValueOptions();
}

function applyExtrusionWithVisibility() {
  if (!S.currentGeoJSON || !S.currentField) return;
  
  // Use custom colors if available, otherwise normal extrusion
  if (S.customColors.size > 0) {
    applyExtrusionWithCustomColors();
  } else {
    applyExtrusion();
  }
  applyVisibilityFilters();
}


function updateHighlightColors() {
  const ids = getCurrentLayerIds();
  if (!ids) return;
  if (S.currentFieldType === 'categorical') {
    const colorExpr = buildCategoricalColorExpression();
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
  } else {
    applyExtrusion();
  }
}

function updateLegendPosition() {
  if (!floatingLegend || !S.selectionControlsPanel) return;
  const panelRect = S.selectionControlsPanel.getBoundingClientRect();
  const panelBottom = panelRect.bottom;
  const legendTop = panelBottom + 10;
  floatingLegend.style.top = `${legendTop}px`;
}

// Minimal bounding polygon (convex hull) for Polygon/MultiPolygon features.
// Uses Andrew's monotone chain (O(n log n) for sort, linear after).


function installWelcome() {
  minimizeLayers();
  minimizeSettingsMenu();
  minimizePaint();
  minimizeFilters();

  S.welcomeEl = document.createElement('div');
  S.welcomeEl.id = 'welcomeOverlay';
  S.welcomeEl.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(180deg,#f9fafb,transparent 55%);z-index:20;';
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.12);padding:18px 20px;max-width:560px;width:min(92vw,560px);display:grid;gap:12px;text-align:center;';
  card.innerHTML = `
    <div style="font-size:16px;font-weight:600;">Load a GeoParquet file</div>
    <div style="color:#666;font-size:13px;">Choose a <code>.parquet</code> to visualize.</div>
    <div style="color:#666;font-size:13px;">TIP: make sure it has polygon geometry; lines/points won't work.</div>
  `;
  const row = document.createElement('div');
  row.style.cssText='display:flex;gap:10px;justify-content:center;flex-wrap:wrap';

  const btnBrowse = document.createElement('button');
  btnBrowse.textContent='Browse GeoParquet…';
  btnBrowse.style.cssText='border:1px solid #ddd;background:#f8f8f8;padding:8px 12px;border-radius:10px;cursor:pointer;';
  btnBrowse.onclick = () => fileInput.click();

  row.append(btnBrowse);
  card.append(row);
  S.welcomeEl.append(card);
  document.body.append(S.welcomeEl);
}

function revealUI() {
  if (S.welcomeEl) { S.welcomeEl.remove(); S.welcomeEl = null; }
  showLayers();
  showPaint();
  minimizeSettingsMenu();
}

function ensureRenderToast() {
  if (S.renderToastEl) return;
  S.renderToastEl = document.createElement('div');
  S.renderToastEl.style.cssText = `
    position:absolute; top:12px; left:50%; transform:translateX(-50%);
    background:#111; color:#fff; padding:6px 10px; border-radius:999px;
    font-size:12px; opacity:0; transition:opacity .2s; z-index:25; pointer-events:none;
  `;
  S.renderToastEl.textContent = 'Geometry is rendering...';
  document.body.append(S.renderToastEl);
}

function showRenderingToast(msg = 'Geometry is rendering') {
  ensureRenderToast();
  let i = 0;
  if (S.dotsTimer) { clearInterval(S.dotsTimer); S.dotsTimer = null; }
  S.renderToastEl!.style.opacity = '0.92';
  S.renderToastEl!.textContent = `${msg}`;
  S.dotsTimer = window.setInterval(() => {
    i = (i + 1) % 4;
    S.renderToastEl!.textContent = `${msg}${'.'.repeat(i)}`;
  }, 400);
}

function hideRenderingToast() {
  if (S.dotsTimer) { clearInterval(S.dotsTimer); S.dotsTimer = null; }
  if (S.renderToastEl) S.renderToastEl.style.opacity = '0';
}

function awaitFirstRenderedFeature(layerId: string) {
  // poll one frame at a time; hide toast when the first extrusion is visible
  let tries = 0;
  const maxTries = 600; // ~10s at 60fps
  const tick = () => {
    tries++;
    if (!S.map.getLayer(layerId)) { if (tries < maxTries) return requestAnimationFrame(tick); else return hideRenderingToast(); }
    const feats = S.map.queryRenderedFeatures({ layers: [layerId] });
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



// Heuristics for "key fields"
function isKeyField(name: string) {
  const tokens = tokenizeName(name);

  // EXCLUDE length/perimeter from "key" suggestions
  if (tokens.some(t => t === 'length' || t === 'perimeter' || t === 'perim')) return false;

  // "value" or "valuation" → key
  const valueHits = tokens.includes('value') || tokens.includes('valuation');

  // Size-ish → key: 'area' or any unit token (incl. 'acreage', 'ha', etc.)
  const sizeHits = tokens.some(t => t === 'area' || UNIT_TOKENS.has(t));

  return valueHits || sizeHits;
}

function tokenizeName(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function containsUnit(name: string): boolean {
  const tokens = tokenizeName(name);
  return tokens.some(t => UNIT_TOKENS.has(t));
}

function containsKeyword(name: string, kind: 'building'|'land'): boolean {
  const tokens = tokenizeName(name);
  // building: treat stems/spellings of 'building' and 'improvement' as buildingy
  if (kind === 'building') return tokens.some(t => /^(bldg|build|building|impr|improv)/.test(t));
  // land: treat 'land', 'acre', and 'acreage' as landy
  return tokens.some(t => /^(land|acre|acreage)/.test(t));
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

// score lower = better
function scoreSizeField(name: string, kind: 'building'|'land'): number {
  const tokens = tokenizeName(name);

  // broaden land keywords to include 'acre' / 'acreage'
  const kwIdx = tokens.findIndex(t =>
    kind === 'building'
      ? /^(bldg|build|building|impr|improv)/.test(t)
      : /^(land|acre|acreage)/.test(t)    // ← was just /^land/
  );

  const unitIdx = tokens.findIndex(t => UNIT_TOKENS.has(t));
  if (kwIdx === -1 || unitIdx === -1) return Number.POSITIVE_INFINITY;

  const extras = tokens.filter((t, i) => i !== kwIdx && i !== unitIdx && t !== 'area' && t !== 'total');

  let score = 0;
  score += extras.length * 10;
  score += tokens.length * 0.5;
  if (unitIdx !== tokens.length - 1) score += 2;
  if (kwIdx > 0) score += 0.5;
  return score;
}


function guessAreaUnitKey(name: string | null): string | undefined {
  const g = guessAreaUnitFromFieldName(name || '');
  return g || undefined; // reuse existing unit-guess function
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

function autoPickMainField(fields: string[]): string {
  let best: string = "";
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

/* ---------------- Modal 1: Numeric field chooser ---------------- */

function openNumericFieldChooserModal(opts: { 
  rowCount: number; 
  geometryCol: string; 
  numericFields: string[];
}) {
  rowCountEl.textContent = opts.rowCount.toLocaleString();
  geomColEl.textContent = opts.geometryCol || '(unknown)';
  numericFieldListEl.replaceChildren();

  const allNumeric = opts.numericFields;

  // Split numeric into key and other
  const keyNumeric = allNumeric.filter(isKeyField);
  const otherNumeric = allNumeric.filter(n => !isKeyField(n));

  // Within KEY numeric fields, find the single best building/land size candidates
  const bCandidatesKey = keyNumeric.filter(n => containsKeyword(n, 'building') && containsUnit(n));
  const lCandidatesKey = keyNumeric.filter(n => containsKeyword(n, 'land') && containsUnit(n));
  const bBest = autoPickOne('building', bCandidatesKey).field;
  const lBest = autoPickOne('land', lCandidatesKey).field;
   
  // Normalize for robust comparisons
  const bSet = new Set(bCandidatesKey.map(s => s.toLowerCase()));
  const lSet = new Set(lCandidatesKey.map(s => s.toLowerCase()));
  const bBestLC = bBest?.toLowerCase() ?? '';
  const lBestLC = lBest?.toLowerCase() ?? '';
   
  // Helper: should a KEY numeric field be prechecked?
  const shouldPrecheckKey = (name: string) => {
    const n = name.toLowerCase();
    if (bSet.has(n)) return n === bBestLC;
    if (lSet.has(n)) return n === lBestLC;
    return true;
  };

  if (allNumeric.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No numeric fields were found in the schema.';
    p.className = 'muted';
    numericFieldListEl.appendChild(p);
  } else {
    if (keyNumeric.length) {
      const t2 = document.createElement('div'); 
      t2.className = 'section-subtitle'; 
      t2.textContent = 'Suggested key fields';
      numericFieldListEl.appendChild(t2);
      const g = document.createElement('div'); 
      g.className = 'fieldlist';
      for (const name of keyNumeric) g.appendChild(makeFieldCheckbox(name, shouldPrecheckKey(name), 'numeric'));
      numericFieldListEl.appendChild(g);
      numericFieldListEl.appendChild(divider());
    }

    if (otherNumeric.length) {
      const t2 = document.createElement('div'); 
      t2.className = 'section-subtitle'; 
      t2.textContent = 'Other numeric fields';
      numericFieldListEl.appendChild(t2);
      const g = document.createElement('div'); 
      g.className = 'fieldlist';
      for (const name of otherNumeric) g.appendChild(makeFieldCheckbox(name, false, 'numeric'));
      numericFieldListEl.appendChild(g);
    }
  }

  // Buttons
  btnAllNumeric.onclick = () => {
    numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
      .forEach(c => (c.checked = true));
  };
  btnNoneNumeric.onclick = () => numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    .forEach(c => (c.checked = false));
  btnCancelNumericModal.onclick = () => { numericModalOverlay.classList.remove('show'); clearData(); };
  btnConfirmNumericModal.onclick = () => {
    const allCheckboxes = numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    S.chosenNumericFields = [];
    
    allCheckboxes.forEach(c => {
      if (c.checked) {
        S.chosenNumericFields.push(c.name);
      }
    });
    
    numericModalOverlay.classList.remove('show');
    
    // If there are categorical fields available, show that modal next
    if (S.lastCategoricalFieldsFromSchema.length > 0) {
      openCategoricalFieldChooserModal({ 
        rowCount: Number(rowCountEl.textContent?.replace(/,/g, '') || '0'), 
        geometryCol: geomColEl.textContent || 'geometry', 
        categoricalFields: S.lastCategoricalFieldsFromSchema
      });
    } else {
      // No categorical fields, proceed to size modal
      if (S.chosenNumericFields.length === 0) {
        alert('Please select at least one numeric field.');
        numericModalOverlay.classList.add('show');
        return;
      }
      openSizeModal();
    }
  };

  numericModalOverlay.classList.add('show');
}

/* ---------------- Modal 2: Categorical field chooser ---------------- */

function openCategoricalFieldChooserModal(opts: { 
  rowCount: number; 
  geometryCol: string; 
  categoricalFields: string[];
}) {
  categoricalRowCountEl.textContent = opts.rowCount.toLocaleString();
  categoricalGeomColEl.textContent = opts.geometryCol || '(unknown)';
  categoricalFieldListEl.replaceChildren();

  const allCategorical = opts.categoricalFields;

  if (allCategorical.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No categorical fields were found in the schema.';
    p.className = 'muted';
    categoricalFieldListEl.appendChild(p);
  } else {
    const g = document.createElement('div'); 
    g.className = 'fieldlist';
    for (const name of allCategorical) g.appendChild(makeFieldCheckbox(name, false, 'categorical'));
    categoricalFieldListEl.appendChild(g);
  }

  // Buttons
  btnAllCategorical.onclick = () => {
    categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
      .forEach(c => (c.checked = true));
  };
  btnNoneCategorical.onclick = () => categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    .forEach(c => (c.checked = false));
  btnCancelCategoricalModal.onclick = () => { categoricalModalOverlay.classList.remove('show'); clearData(); };
  btnConfirmCategoricalModal.onclick = () => {
    const allCheckboxes = categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    S.chosenCategoricalFields = [];
    
    allCheckboxes.forEach(c => {
      if (c.checked) {
        S.chosenCategoricalFields.push(c.name);
      }
    });
    
    // Check if at least one field is selected (either numeric or categorical)
    if (S.chosenNumericFields.length === 0 && S.chosenCategoricalFields.length === 0) {
      alert('Please select at least one field (numeric or categorical).');
      categoricalModalOverlay.classList.add('show');
      return;
    }
    
    categoricalModalOverlay.classList.remove('show');
    openSizeModal();
  };
  
  // Add a "Back" button to return to numeric modal
  const existingBackButton = categoricalModalOverlay.querySelector<HTMLButtonElement>(
    'button[data-role="back-to-numeric-fields"]'
  );
  if (existingBackButton) {
    existingBackButton.remove();
  }
  const backButton = document.createElement('button');
  backButton.textContent = 'Back to Numeric Fields';
  backButton.dataset.role = 'back-to-numeric-fields';
  backButton.onclick = () => {
    categoricalModalOverlay.classList.remove('show');
    openNumericFieldChooserModal({ 
      rowCount: Number(categoricalRowCountEl.textContent?.replace(/,/g, '') || '0'), 
      geometryCol: categoricalGeomColEl.textContent || 'geometry', 
      numericFields: S.lastNumericFieldsFromSchema
    });
  };
  
  // Insert back button before the footer
  const footer = categoricalModalOverlay.querySelector('.footer');
  if (footer) {
    footer.insertBefore(backButton, footer.firstChild);
  }

  categoricalModalOverlay.classList.add('show');
}

/* ---------------- Modal 2: size identification ---------------- */

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
  fillFieldSelect(bldgFieldSel, S.chosenNumericFields);
  fillFieldSelect(landFieldSel, S.chosenNumericFields);
  fillUnitSelect(bldgUnitSel);
  fillUnitSelect(landUnitSel);
  
  // --- AUTO-PICK using heuristic ---
  const bGuess = autoPickOne('building', S.chosenNumericFields);
  const lGuess = autoPickOne('land', S.chosenNumericFields);

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

  btnSizeBack.onclick = () => { 
    sizeOverlay.classList.remove('show'); 
    // Go back to the appropriate modal based on what was shown
    if (S.lastCategoricalFieldsFromSchema.length > 0) {
      openCategoricalFieldChooserModal({ 
        rowCount: Number(categoricalRowCountEl.textContent?.replace(/,/g, '') || '0'), 
        geometryCol: categoricalGeomColEl.textContent || 'geometry', 
        categoricalFields: S.lastCategoricalFieldsFromSchema
      });
    } else {
      openNumericFieldChooserModal({ 
        rowCount: Number(rowCountEl.textContent?.replace(/,/g, '') || '0'), 
        geometryCol: geomColEl.textContent || 'geometry', 
        numericFields: S.lastNumericFieldsFromSchema
      });
    }
  };
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
  S.bldgSizeField = bField || null;
  S.bldgSizeUnitLabel = bUnit || null;
  S.landSizeField = lField || null;
  S.landSizeUnitLabel = lUnit || null;
  const activeLayer = getCurrentLayer();
  if (activeLayer) {
    activeLayer.bldgSizeField = S.bldgSizeField;
    activeLayer.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
    activeLayer.landSizeField = S.landSizeField;
    activeLayer.landSizeUnitLabel = S.landSizeUnitLabel;
  }
  const activeStore = activeLayer ? S.dataStores.get(activeLayer.dataStoreId) : null;
  if (activeStore) {
    activeStore.bldgSizeField = S.bldgSizeField;
    activeStore.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
    activeStore.landSizeField = S.landSizeField;
    activeStore.landSizeUnitLabel = S.landSizeUnitLabel;
  }
  // enable/disable normalization radios
  normLand.disabled = !S.landSizeField;
  normBldg.disabled = !S.bldgSizeField;
  normLandUnitEl.textContent = S.landSizeField ? (S.landSizeUnitLabel ?? '(unit)') : '(unit)';
  normBldgUnitEl.textContent = S.bldgSizeField ? (S.bldgSizeUnitLabel ?? '(unit)') : '(unit)';

  statsNormLand.disabled = !S.landSizeField;
  statsNormBldg.disabled = !S.bldgSizeField;
  statsNormLandUnitEl.textContent = S.landSizeField ? (S.landSizeUnitLabel ?? '(unit)') : '(unit)';
  statsNormBldgUnitEl.textContent = S.bldgSizeField ? (S.bldgSizeUnitLabel ?? '(unit)') : '(unit)';

  if (S.statsNormalizationMode === 'perLand' && !S.landSizeField) {
    S.statsNormalizationMode = 'asis';
    statsNormAsIs.checked = true;
  }
  if (S.statsNormalizationMode === 'perBuilding' && !S.bldgSizeField) {
    S.statsNormalizationMode = 'asis';
    statsNormAsIs.checked = true;
  }
}

/* ---------------- Loading overlay helpers ---------------- */
function showLoading(msg = 'Parsing GeoParquet…', determinate = false) {
  S.cancelRequested = false;
  progressMsg.textContent = msg;
  progressEl.classList.toggle('indeterminate', !determinate);
  progressBar.style.width = determinate ? '0%' : '30%';
  loadingOverlay.classList.add('show');
}
function hideLoading() { loadingOverlay.classList.remove('show'); }
(document.getElementById('btnCancelLoading') as HTMLButtonElement).onclick = () => {
  S.cancelRequested = true;
  hideLoading();
  clearData();
};

/* ---------------- Load selected columns (+ geometry) ---------------- */
async function loadSelectedColumns() {
  if (!S.lastAsyncBuffer || !S.lastFile) return;
  showLoading('Reading geometry + selected fields…');

  try {
    const result: any = await toGeoJson({ file: S.lastAsyncBuffer, compressors });
    if (S.cancelRequested) return;

    const fc: GeoJSON.FeatureCollection | undefined =
      result?.type === 'FeatureCollection' ? result : result?.geojson;
    if (!fc?.features) throw new Error('Parser returned no FeatureCollection.');

    let features = fc.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
    if (features.length === 0) throw new Error('No Polygon/MultiPolygon features found.');

    sanitizeFeaturesInPlace(features);

    const keep = new Set<string>([
      'id','ID','fid','FID','name','NAME', 
      ...S.chosenNumericFields,
      ...S.chosenCategoricalFields,
      S.bldgSizeField || '', 
      S.landSizeField || ''
    ]);
    trimPropertiesInPlace(features, keep);

    for (const f of features) roundGeometryInPlace(f);

    // Ensure all features have IDs for the selection system
    features.forEach((feature, index) => {
      if (feature.id === undefined) {
        feature.id = index;
      }
    });

    if (S.cancelRequested) return;
    S.currentGeoJSON = { type: 'FeatureCollection', features };
    S.parcelPatchMap = new Map();
    const activeLayer = getCurrentLayer();
    if (activeLayer) {
      activeLayer.geojson = S.currentGeoJSON;
      activeLayer.parcelPatchMap = S.parcelPatchMap;
      activeLayer.chosenNumericFields = [...S.chosenNumericFields];
      activeLayer.chosenCategoricalFields = [...S.chosenCategoricalFields];
      activeLayer.landSizeField = S.landSizeField;
      activeLayer.landSizeUnitLabel = S.landSizeUnitLabel;
      activeLayer.bldgSizeField = S.bldgSizeField;
      activeLayer.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
    }
    const activeStore = activeLayer ? S.dataStores.get(activeLayer.dataStoreId) : null;
    if (activeStore) {
      activeStore.geojson = S.currentGeoJSON;
      activeStore.chosenNumericFields = [...S.chosenNumericFields];
      activeStore.chosenCategoricalFields = [...S.chosenCategoricalFields];
      activeStore.landSizeField = S.landSizeField;
      activeStore.landSizeUnitLabel = S.landSizeUnitLabel;
      activeStore.bldgSizeField = S.bldgSizeField;
      activeStore.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
    }

    // Check which fields actually exist in the data
    const availableNumeric = S.chosenNumericFields.filter(k => {
      return features.some(f => f?.properties?.hasOwnProperty(k));
    });
    
    const availableCategorical = S.chosenCategoricalFields.filter(k => {
      return features.some(f => f?.properties?.hasOwnProperty(k));
    });

    // Combine all available fields for the dropdown
    const allAvailableFields = [...availableNumeric, ...availableCategorical];
    populateFieldDropdownFromList(allAvailableFields);

    // Don't auto-select a field - let user choose
    S.currentField = null;
    S.currentFieldType = null;
    
    // Set field select to "-- choose --" (empty value)
    fieldSelect.value = '';

    addOrUpdateSource(S.currentGeoJSON);

    // Apply gray rendering when no field is selected
    applyGrayRendering();
    refreshStatisticsPanel();
    refreshScatterPanel();
    refreshLandSchedulePanel();

    fitToData(S.currentGeoJSON);
    persistCurrentLayerState();
  } catch (err: any) {
    console.error('GeoParquet load failed:', err);
    if (!S.cancelRequested) alert(`GeoParquet load failed: ${err?.message ?? err}`);
  } finally {
    hideLoading();
  }
}

/* ---------------- Map helpers ---------------- */
function ensureErrorLayer(layer: LayerState) {
  if (S.map.getLayer(layer.errorLayerId)) return;
  S.map.addLayer({
    id: layer.errorLayerId,
    type: 'line',
    source: layer.sourceId,
    paint: {
      'line-color': '#ff3b30',          // red outline
      'line-width': 1.5,
      'line-dasharray': [1, 1.3],
      'line-opacity': 0.9
    }
  });
  // keep it above extrusions for visibility
  try { S.map.moveLayer(layer.errorLayerId); } catch {}
  setLayerVisibility(layer, layer.visible);
}

function updateErrorLayer() {
  const layer = getCurrentLayer();
  if (!layer || !S.map.getSource(layer.sourceId)) return;
  ensureErrorLayer(layer);

  let filter: any = ['==', ['literal', 1], 2]; // matches nothing by default

  if (S.normalizationMode === 'perLand' && S.landSizeField) {
    // land invalid when ≤ 0  (zero not allowed)
    filter = ['<=', ['to-number', ['get', S.landSizeField]], 0];
  } else if (S.normalizationMode === 'perBuilding' && S.bldgSizeField) {
    // building invalid when negative (zero is allowed and not flagged)
    filter = ['<', ['to-number', ['get', S.bldgSizeField]], 0];
  }

  S.map.setFilter(layer.errorLayerId, filter);
}
function clearData() {
  if (S.currentLayerId) {
    removeLayer(S.currentLayerId);
  }
  if (S.map.getLayer('markup-layer')) S.map.removeLayer('markup-layer');
  if (S.map.getLayer('markup-layer-outline')) S.map.removeLayer('markup-layer-outline');
  if (S.map.getSource('markup-source')) S.map.removeSource('markup-source');
  S.parcelPatchMap = new Map();
  hideRenderingToast();
}
function addOrUpdateSource(fc: GeoJSON.FeatureCollection) {
  const layer = getCurrentLayer();
  if (!layer) return;
  showRenderingToast('Geometry is rendering');
  const existing = S.map.getSource(layer.sourceId) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
  } else {
    S.map.addSource(layer.sourceId, { type: 'geojson', data: fc });
    addExtrusionLayer(layer);
  }
  awaitFirstRenderedFeature(layer.layerId);
}

let keyHandlersInstalled = false;

function addExtrusionLayer(layer: LayerState) {
  if (S.map.getLayer(layer.layerId)) return;
  S.map.addLayer({
    id: layer.layerId, type: 'fill-extrusion', source: layer.sourceId,
    paint: {
      'fill-extrusion-color': '#888',
      'fill-extrusion-height': 0,
      'fill-extrusion-opacity': parseFloat(opacityInput.value),
      'fill-extrusion-vertical-gradient': true
    }
  });
  setLayerVisibility(layer, layer.visible);

  // NEW: parcel selection and inspection
  S.map.on('click', layer.layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    if (S.currentLayerId !== layer.id) {
      setCurrentLayer(layer.id);
    }
    
    // Handle info tool
    if (S.isInfoToolActive) {
      const props = (f.properties || {}) as Record<string, any>;
      const parcelId = getParcelId(f);
      showPopup(props, e.lngLat, parcelId);
      return;
    }
    
    // Handle selection tools
    if (S.currentSelectionMode === 'select-one') {
      // Handle different click modes
      if (e.originalEvent.shiftKey) {
        // Shift-click: always add to selection
        addParcelToSelection(f);
      } else if (e.originalEvent.altKey) {
        // Alt-click: always remove from selection
        removeParcelFromSelection(f);
      } else {
        // Regular left-click: select only this parcel, unselect all others
        clearAllSelections();
        addParcelToSelection(f);
      }
    }
  });
  
  // Right-click to close popup
  S.map.on('contextmenu', layer.layerId, (e) => {
    if (S.activePopup) {
      S.activePopup.remove();
      S.activePopup = null;
      S.lastPicked = null;
    }
  });
  
  S.map.on('mouseenter', layer.layerId, () => { 
    if (S.isInfoToolActive) {
      S.map.getCanvas().style.cursor = 'pointer';
    }
  });
  S.map.on('mouseleave', layer.layerId, () => { 
    updateCursor();
  });
  
  // Keyboard event handling
  if (!keyHandlersInstalled) {
    document.addEventListener('keydown', (e) => {
      // ESC key to close popup
      if (e.key === 'Escape' && S.activePopup) {
        S.activePopup.remove();
        S.activePopup = null;
        S.lastPicked = null;
      }

      const activeElement = document.activeElement;
      if (isTextInputElement(activeElement) || isTextInputElement(e.target as Element | null)) {
        return;
      }
      
      // Hotkey handling
      const key = e.key.toLowerCase();
      if (key === HOTKEYS.PAN) {
        e.preventDefault();
        activateTool('pan');
      } else if (key === HOTKEYS.SELECT) {
        e.preventDefault();
        activateTool('select');
      } else if (key === HOTKEYS.INFO) {
        e.preventDefault();
        activateTool('info');
      }
    });
    keyHandlersInstalled = true;
  }
  
  ensureErrorLayer(layer);
}

function showPopup(props: Record<string, any>, lngLat: maplibregl.LngLatLike, parcelId: string) {
  // Only show popup if info tool is active
  if (!S.isInfoToolActive) return;
  
  if (S.activePopup) S.activePopup.remove();
  S.activePopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: '460px'          // ← wider than default 240px
  })
    .setLngLat(lngLat)
    .setHTML(buildPopupHTML(props, parcelId))
    .addTo(S.map);
  S.lastPicked = { props, lngLat, parcelId };
  
  // Add search functionality to the popup
  addPopupSearchFunctionality();
  addPopupEditFunctionality(parcelId);
}

function isTextInputElement(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLInputElement) {
    const nonTextTypes = new Set([
      'button',
      'checkbox',
      'color',
      'date',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit'
    ]);
    if (nonTextTypes.has(element.type)) return false;
    if (element.disabled || element.readOnly) return false;
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    if (element.disabled || element.readOnly) return false;
    return true;
  }
  if (element instanceof HTMLSelectElement) return false;
  return (element as HTMLElement).isContentEditable;
}

function addPopupSearchFunctionality() {
  setTimeout(() => {
    const popupElement = S.activePopup?.getElement();
    if (popupElement) {
      const searchInput = popupElement.querySelector('#popupSearch') as HTMLInputElement;
      const tableBody = popupElement.querySelector('#popupFieldsTable') as HTMLTableSectionElement;
      
      if (searchInput && tableBody) {
        const filterFields = (searchText: string) => {
          const rows = tableBody.querySelectorAll('tr');
          rows.forEach(row => {
            const fieldNameCell = row.querySelector('td:first-child code');
            if (fieldNameCell) {
              const fieldName = fieldNameCell.textContent || '';
              const matches = fieldName.toLowerCase().includes(searchText.toLowerCase());
              (row as HTMLElement).style.display = matches ? '' : 'none';
            }
          });
        };
        
        searchInput.addEventListener('input', (e) => {
          const target = e.target as HTMLInputElement;
          filterFields(target.value);
        });
      }
    }
  }, 0);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPopupFieldType(field: string): 'numeric' | 'categorical' {
  if (S.chosenNumericFields.includes(field) || field === S.landSizeField || field === S.bldgSizeField) {
    return 'numeric';
  }
  return 'categorical';
}

function valuesEqualForField(fieldType: 'numeric' | 'categorical', a: any, b: any): boolean {
  if (fieldType === 'numeric') {
    const aNum = Number(a);
    const bNum = Number(b);
    if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) return false;
    return Object.is(aNum, bNum);
  }
  return String(a ?? '') === String(b ?? '');
}

function normalizeFieldValue(fieldType: 'numeric' | 'categorical', value: any): any {
  if (fieldType === 'numeric') {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  if (value === null || value === undefined) return '';
  return String(value);
}

function getParcelPatchEntry(parcelId: string, field: string): ParcelFieldPatch | undefined {
  return S.parcelPatchMap.get(parcelId)?.get(field);
}

function setParcelPatchEntry(parcelId: string, field: string, original: any, current: any) {
  let parcelEntry = S.parcelPatchMap.get(parcelId);
  if (!parcelEntry) {
    parcelEntry = new Map();
    S.parcelPatchMap.set(parcelId, parcelEntry);
  }
  parcelEntry.set(field, { original, current });
}

function clearParcelPatchEntry(parcelId: string, field: string) {
  const parcelEntry = S.parcelPatchMap.get(parcelId);
  if (!parcelEntry) return;
  parcelEntry.delete(field);
  if (parcelEntry.size === 0) {
    S.parcelPatchMap.delete(parcelId);
  }
}

function isFieldChanged(parcelId: string, field: string, fieldType: 'numeric' | 'categorical'): boolean {
  const patch = getParcelPatchEntry(parcelId, field);
  if (!patch) return false;
  return !valuesEqualForField(fieldType, patch.original, patch.current);
}



function updateMapSourceData() {
  if (!S.currentGeoJSON) return;
  const layer = getCurrentLayer();
  if (!layer) return;
  const source = S.map.getSource(layer.sourceId) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(S.currentGeoJSON);
  }
}

function updateLastPickedProps(parcelId: string, field: string, value: any) {
  if (S.lastPicked && S.lastPicked.parcelId === parcelId) {
    S.lastPicked.props[field] = value;
  }
}

function formatPopupValue(fieldType: 'numeric' | 'categorical', value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  if (fieldType === 'numeric') {
    const num = Number(value);
    return Number.isFinite(num) ? fmt(num) : '—';
  }
  return String(value);
}

function addPopupEditFunctionality(parcelId: string) {
  setTimeout(() => {
    const popupElement = S.activePopup?.getElement();
    if (!popupElement) return;
    const tableBody = popupElement.querySelector('#popupFieldsTable') as HTMLTableSectionElement | null;
    if (!tableBody || tableBody.dataset.editHandlersAttached === 'true') return;
    tableBody.dataset.editHandlersAttached = 'true';

    const updateRowChangedState = (row: HTMLTableRowElement, field: string, fieldType: 'numeric' | 'categorical') => {
      const changed = isFieldChanged(parcelId, field, fieldType);
      row.style.background = changed ? 'rgba(255, 0, 0, 0.08)' : '';
      const fieldCell = row.querySelector('td:first-child code') as HTMLElement | null;
      if (fieldCell) fieldCell.style.fontWeight = changed ? '700' : '';
      const resetButton = row.querySelector('.popup-reset-btn') as HTMLButtonElement | null;
      if (resetButton) resetButton.style.display = changed ? 'inline-flex' : 'none';
    };

    const setEditButtonToPencil = (button: HTMLButtonElement | null) => {
      if (!button) return;
      button.innerHTML = `✏️`;
    };

    const exitEditMode = (row: HTMLTableRowElement, field: string, fieldType: 'numeric' | 'categorical', displayValue: any) => {
      row.dataset.editing = 'false';
      row.style.background = '';
      const valueCell = row.querySelector('[data-value-cell]') as HTMLTableCellElement | null;
      if (valueCell) {
        valueCell.textContent = formatPopupValue(fieldType, displayValue);
      }
      const editButton = row.querySelector('.popup-edit-btn') as HTMLButtonElement | null;
      setEditButtonToPencil(editButton);
      updateRowChangedState(row, field, fieldType);
    };

    const getCurrentFieldValue = (parcelIdValue: string, field: string, fieldType: 'numeric' | 'categorical') => {
      const patch = getParcelPatchEntry(parcelIdValue, field);
      if (patch) return patch.current;
      const feature = findFeatureByParcelId(parcelIdValue);
      return normalizeFieldValue(fieldType, feature?.properties?.[field]);
    };

    const acceptInputValue = (row: HTMLTableRowElement, field: string, fieldType: 'numeric' | 'categorical', input: HTMLInputElement) => {
      const currentValue = row.dataset.lastValidValue ?? input.value;
      if (fieldType === 'numeric') {
        const trimmed = input.value.trim();
        if (!trimmed) {
          input.value = currentValue;
          return;
        }
        const num = Number(trimmed);
        if (!Number.isFinite(num)) {
          input.value = currentValue;
          return;
        }
        const normalized = String(num);
        input.value = normalized;
        row.dataset.pendingValue = normalized;
        row.dataset.lastValidValue = normalized;
      } else {
        const nextValue = input.value;
        row.dataset.pendingValue = nextValue;
        row.dataset.lastValidValue = nextValue;
      }
    };

    const commitRowValue = (row: HTMLTableRowElement, field: string, fieldType: 'numeric' | 'categorical') => {
      const input = row.querySelector('input') as HTMLInputElement | null;
      if (input) {
        acceptInputValue(row, field, fieldType, input);
      }
      const pendingValue = row.dataset.pendingValue ?? row.dataset.lastValidValue ?? '';
      const normalized = normalizeFieldValue(fieldType, pendingValue);
      if (fieldType === 'numeric' && normalized === null) {
        const currentValue = getCurrentFieldValue(parcelId, field, fieldType);
        exitEditMode(row, field, fieldType, currentValue);
        return;
      }

      const feature = findFeatureByParcelId(parcelId);
      if (!feature || !feature.properties) return;
      const existingPatch = getParcelPatchEntry(parcelId, field);
      const originalValue = existingPatch
        ? existingPatch.original
        : normalizeFieldValue(fieldType, feature.properties[field]);
      if (valuesEqualForField(fieldType, originalValue, normalized)) {
        clearParcelPatchEntry(parcelId, field);
        feature.properties[field] = originalValue;
      } else {
        setParcelPatchEntry(parcelId, field, originalValue, normalized);
        feature.properties[field] = normalized;
      }

      updateMapSourceData();
      updateLastPickedProps(parcelId, field, feature.properties[field]);
      exitEditMode(row, field, fieldType, feature.properties[field]);
    };

    const resetRowValue = (row: HTMLTableRowElement, field: string, fieldType: 'numeric' | 'categorical') => {
      const patch = getParcelPatchEntry(parcelId, field);
      if (!patch) return;
      const feature = findFeatureByParcelId(parcelId);
      if (!feature || !feature.properties) return;
      feature.properties[field] = patch.original;
      clearParcelPatchEntry(parcelId, field);
      updateMapSourceData();
      updateLastPickedProps(parcelId, field, feature.properties[field]);
      exitEditMode(row, field, fieldType, feature.properties[field]);
    };

    const enterEditMode = (row: HTMLTableRowElement, field: string, fieldType: 'numeric' | 'categorical') => {
      row.dataset.editing = 'true';
      row.style.background = '#fff4b8';
      const editButton = row.querySelector('.popup-edit-btn') as HTMLButtonElement | null;
      if (editButton) editButton.textContent = '💾';

      const valueCell = row.querySelector('[data-value-cell]') as HTMLTableCellElement | null;
      if (!valueCell) return;
      valueCell.replaceChildren();

      const input = document.createElement('input');
      input.type = fieldType === 'numeric' ? 'number' : 'text';
      if (fieldType === 'numeric') {
        input.step = 'any';
      }
      input.style.width = '100%';
      input.style.boxSizing = 'border-box';
      input.style.fontSize = '12px';
      input.style.padding = '2px 4px';

      const currentValue = getCurrentFieldValue(parcelId, field, fieldType);
      input.value = currentValue === null || currentValue === undefined ? '' : String(currentValue);
      row.dataset.lastValidValue = input.value;
      row.dataset.pendingValue = input.value;

      if (fieldType === 'categorical') {
        const values = getCategoricalValues(field);
        if (values.length > 0 && values.length < 50) {
          const listId = `popup-values-${parcelId}-${field.replace(/[^a-z0-9_-]/gi, '_')}`;
          const datalist = document.createElement('datalist');
          datalist.id = listId;
          values
            .filter(value => String(value) !== String(currentValue))
            .forEach(value => {
              const option = document.createElement('option');
              option.value = String(value);
              datalist.appendChild(option);
            });
          input.setAttribute('list', listId);
          valueCell.appendChild(datalist);
        }
      }

      input.addEventListener('blur', () => acceptInputValue(row, field, fieldType, input));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          acceptInputValue(row, field, fieldType, input);
          input.blur();
        }
      });
      valueCell.appendChild(input);
      input.focus();
      input.select();
    };

    tableBody.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const editButton = target.closest('.popup-edit-btn') as HTMLButtonElement | null;
      const resetButton = target.closest('.popup-reset-btn') as HTMLButtonElement | null;
      if (!editButton && !resetButton) return;
      const row = (editButton ?? resetButton)?.closest('tr') as HTMLTableRowElement | null;
      if (!row) return;
      const field = row.dataset.field;
      const fieldType = row.dataset.fieldType as 'numeric' | 'categorical' | undefined;
      if (!field || !fieldType) return;

      if (resetButton) {
        resetRowValue(row, field, fieldType);
        return;
      }
      if (row.dataset.editing === 'true') {
        commitRowValue(row, field, fieldType);
      } else {
        enterEditMode(row, field, fieldType);
      }
    });
  }, 0);
}

/* --- value expression builder (handles normalization) --- */
function buildValueExpression(): Expression {
  if (!S.currentField) return ['literal', 0] as any;
  const base: Expression = ['to-number', ['get', S.currentField]] as any;

  if (S.normalizationMode === 'perLand' && S.landSizeField) {
    const den: Expression = ['to-number', ['get', S.landSizeField]] as any;
    // Land invalid when ≤ 0 ⇒ height 0 (flat); outline layer will flag it.
    return ['case',
      ['<=', den, 0], 0,
      ['/', base, den]
    ] as any;
  }

  if (S.normalizationMode === 'perBuilding' && S.bldgSizeField) {
    const den: Expression = ['to-number', ['get', S.bldgSizeField]] as any;
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


function applyGrayRendering() {
  if (!S.currentGeoJSON) return;
  const ids = getCurrentLayerIds();
  if (!ids) return;
  
  // Apply gray color and no extrusion when no field is selected
  S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', '#888');
  S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
  S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(opacityInput.value));

  applyMapFilters();
  
  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (S.activePopup && S.lastPicked) {
    S.activePopup.setHTML(buildPopupHTML(S.lastPicked.props, S.lastPicked.parcelId)).setLngLat(S.lastPicked.lngLat);
    addPopupSearchFunctionality();
    addPopupEditFunctionality(S.lastPicked.parcelId);
  }
}

function applyExtrusion() {
  if (!S.currentGeoJSON) return;
  const ids = getCurrentLayerIds();
  if (!ids) return;
  
  // If no field is selected, apply gray rendering
  if (!S.currentField) {
    applyGrayRendering();
    return;
  }

  if (S.currentFieldType === 'categorical') {
    // For categorical fields, no extrusion - just color
    const colorExpr = buildCategoricalColorExpression();
    
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  } else {
    // For numeric fields, use the new color expression builder
    const colorExpr = buildNumericColorExpression();
    const valueExpr = buildValueExpression();
    
    const rawMult = Number(multInput.value);
    const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
    const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
    const heightExpr: Expression = S.is3DMode ? ['*', valueExpr, multiplier * unitFactor] as any : 0;

    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', heightExpr);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  }

  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (S.activePopup && S.lastPicked) {
    S.activePopup.setHTML(buildPopupHTML(S.lastPicked.props, S.lastPicked.parcelId)).setLngLat(S.lastPicked.lngLat);
    addPopupSearchFunctionality();
    addPopupEditFunctionality(S.lastPicked.parcelId);
  }
}


/**
 * Pseudo-random, bright, saturated color for item `n` out of `max_n`, seeded by `seed`.
 * - Successive n are far apart via a coprime "golden step" permutation mod max_n
 * - High saturation & mid/high lightness for vivid, easy-to-tell-apart colors
 * - Deterministic across runs for the same (n, max_n, seed)
 */
function generatePseudoRandomColor(n: number, max_n: number, seed: string): string {
  if (max_n <= 0) throw new Error("max_n must be > 0");

  // --- small helpers ---
  const frac = (x: number) => x - Math.floor(x);
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const gcd = (a: number, b: number): number => {
    a = Math.abs(a) | 0;
    b = Math.abs(b) | 0;
    while (b !== 0) {
      const t = a % b;
      a = b; b = t;
    }
    return a || 1;
  };

  // FNV-1a 32-bit string hash → uint32
  const fnv1a = (str: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };

  // One-shot 32-bit mix -> [0,1)
  const rand01 = (seedHash: number, i: number, salt: number): number => {
    // Murmur-ish finalizer chain
    let x = (seedHash ^ Math.imul(i + 0x9e3779b1, 0x85ebca6b) ^ salt) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return (x >>> 0) / 0x100000000;
  };

  // HSL → RGB [0..255] integers
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    h = frac(h); s = clamp01(s); l = clamp01(l);
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t: number) => {
      t = frac(t);
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const r = Math.round(hue2rgb(h + 1/3) * 255);
    const g = Math.round(hue2rgb(h) * 255);
    const b = Math.round(hue2rgb(h - 1/3) * 255);
    return [r, g, b];
  };

  // --- core logic ---
  const hash = fnv1a(seed);

  // Permute index with a "golden step" that is coprime to max_n
  // This spreads nearby n far apart around the hue wheel.
  const phi = 0.618033988749895; // golden ratio conjugate
  let step = Math.floor(max_n * phi) || 1;
  // ensure step and max_n are coprime for a full cycle permutation
  while (gcd(step, max_n) !== 1) step = (step + 1) % max_n || 1;

  const start = hash % Math.max(1, max_n); // seed-dependent start
  const idx = ((start + (n % max_n + max_n) % max_n * step) % max_n) >>> 0;

  // Hue: uniformly cover [0,1) with a seed offset; center of each "bin" to avoid overlaps
  const hOffset = ((hash >>> 8) & 0xFFFFFF) / 0x1000000; // [0,1)
  const h = frac(hOffset + (idx + 0.5) / max_n);

  // Keep colors vivid: high S, mid/high L with tiny seed+index jitter for variety
  const s = 0.45 + 0.10 * rand01(hash, idx, 0xA8F1);         
  const l = 0.56 + 0.16 * (rand01(hash, idx, 0xC0FFEE) - 0.5); 

  const [r, g, b] = hslToRgb(h, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}


function buildCategoricalColorPairs(): Array<[string, string]> {
  if (!S.currentField || !S.currentGeoJSON) return [];
  
  // Collect unique categories
  const categories = new Set<string>();
  for (const feature of S.currentGeoJSON.features) {
    const value = feature.properties?.[S.currentField];
    if (value != null && value !== '' && value !== undefined) {
      categories.add(String(value));
    }
  }
  
  const sortedCategories = Array.from(categories).sort();
  
  if (sortedCategories.length === 0) {
    return [];
  }
  
  const pairs: Array<[string, string]> = [];
  
  if (S.categoricalColorMode === 'single') {
    // Single color mode: map empty string to the single color
    pairs.push(['', S.singleColorValue]);
  } else if (S.categoricalColorMode === 'colorRamp') {
    // Color ramp: sort categories alphabetically and assign colors linearly
    const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    const denom = Math.max(1, sortedCategories.length - 1);
    
    for (let i = 0; i < sortedCategories.length; i++) {
      const category = sortedCategories[i];
      const colorIndex = Math.round((i / denom) * (ramp.length - 1));
      const color = ramp[colorIndex];
      pairs.push([category, color]);
    }
  } else {
    // Random colors mode
    for (let i = 0; i < sortedCategories.length; i++) {
      const category = sortedCategories[i];
      const color = generatePseudoRandomColor(i, sortedCategories.length, "my-random-seed");
      pairs.push([category, color]);
    }
  }
  
  // Apply custom colors if they exist
  const finalPairs: any[] = [];
  for (const [category, defaultColor] of pairs) {
    const color = S.customColors.has(category) ? S.customColors.get(category)! : defaultColor;
    finalPairs.push([category, color]);
  }
  
  return finalPairs;
}

function buildCategoricalColorExpression(): Expression {
  if (!S.currentField || !S.currentGeoJSON) return ['literal', '#888'] as any;
  
  // Get the base color pairs from the inner function
  const pairs = buildCategoricalColorPairs();
  // flatten pairs into an array of strings
  let fallbackColor = '#888';
  if (S.categoricalColorMode === 'single') {
    fallbackColor = S.singleColorValue;
  }

  if (S.customColors.size === 0) {
    if (pairs.length === 0) {
      return ['literal', '#888'] as any;
    }
    if (S.categoricalColorMode === 'single') {
      return ['literal', fallbackColor] as any;
    }
  }
  const val = ['to-string', ['coalesce', ['get', S.currentField], '']] as any;

  // Build the final expression with fallback
  const flattenedPairs = pairs.flat();
  const baseResult = ['case',
    ['==', val, ''], fallbackColor,
    ['match', val, ...flattenedPairs, fallbackColor]
  ] as any;
  
  // Add highlighting for selected parcels
  const result = ['case',
    ['boolean', ['feature-state', 'selected'], false], S.highlightColor,
    baseResult
  ] as any;
  
  return result;
}

function fitToData(fc: GeoJSON.FeatureCollection) {
  const b = bbox(fc); if (!b) return;
  S.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 800 });
}

// ---- Quality toggle (runtime supersampling) ----
function setQuality(mode: QualityMode) {
  S.qualityMode = mode;
  const pr = (mode === 'high') ? HIGH_PR : FAST_PR;

  // setPixelRatio is available on MapLibre >= 2; fall back with a warn otherwise
  const anyMap = S.map as any;
  if (typeof anyMap.setPixelRatio === 'function') {
    anyMap.setPixelRatio(pr);
    S.map.resize(); // apply immediately
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
function setPerspective() { S.map.easeTo({ pitch: 60, duration: 600 }); }
function setOrtho() { S.map.easeTo({ pitch: 0, duration: 600 }); }
function setView(which: string) {
  const views: Record<string, Partial<maplibregl.CameraOptions>> = {
    top: { pitch: 0, bearing: 0 }, perspective: { pitch: 60, bearing: -30 },
    north: { pitch: 60, bearing: 0 }, east: { pitch: 60, bearing: 90 },
    south: { pitch: 60, bearing: 180 }, west: { pitch: 60, bearing: 270 }
  };
  S.map.easeTo({ duration: 700, ...(views[which] || views.perspective) });
}

/* ---------------- Helpers ---------------- */
function computeDisplayedMetricFromProps(props: Record<string, any>): number | null {
  if (!S.currentField) return null;
  let base = numOrNull(props[S.currentField]);
  if (base == null) return null;

  if (S.normalizationMode === 'perLand' && S.landSizeField) {
    const d = numOrNull(props[S.landSizeField]);
    if (d == null || d <= 0) return null;
    base = base / d;
  } else if (S.normalizationMode === 'perBuilding' && S.bldgSizeField) {
    const d = numOrNull(props[S.bldgSizeField]);
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
  if (!S.currentGeoJSON) return;   // <- hard stop until data exists

  S._pendingMode = mode;
  S._pendingRefreshLegend = refreshLegend;
  if (S._updTimer) clearTimeout(S._updTimer);
  S._updTimer = window.setTimeout(() => {
    S._updTimer = null;
    // Clear legend visibility when refreshing colorization
    if (S._pendingRefreshLegend) {
      clearLegendVisibility();
    }
    
    if (S._pendingMode === 'recomputeAndAutoScale') {
      computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL);
      if (S._pendingRefreshLegend) {
        updateFloatingLegend();
      }
    } else {
      applyExtrusionWithVisibility();
      if (S._pendingRefreshLegend) {
        updateFloatingLegend();
      }
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
  if (!list.length) fieldSelect.append(new Option('No fields selected', ''));
  else {
    fieldSelect.append(new Option('— choose —', ''));
    for (const n of list) fieldSelect.append(new Option(n, n));
  }
}

function detectNumericFieldsFromFeatures(features: GeoJSON.Feature[]): string[] {
  const counts: Record<string, number> = {}, nums: Record<string, number> = {};
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
  return Object.keys(counts)
    .filter(k => (nums[k] ?? 0) >= Math.max(1, Math.ceil(0.6 * (counts[k] || 0))))
    .sort();
}


function getNumericValuesNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding'): number[] {
  const vals: number[] = [];
  for (const f of fc.features) {
    const p = (f.properties as any) || {};
    let base = Number(p?.[field]);
    if (!Number.isFinite(base)) continue;

    if (mode === 'perLand' && S.landSizeField) {
      const d = Number(p?.[S.landSizeField]);
      if (!Number.isFinite(d) || d <= 0) continue;
      base = base / d;
    } else if (mode === 'perBuilding' && S.bldgSizeField) {
      const d = Number(p?.[S.bldgSizeField]);
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
  p = 99
) {
  if (!S.currentGeoJSON || !S.currentField) return;

  // values for the CURRENT normalization mode
  const vals = getNumericValuesNormalized(S.currentGeoJSON, S.currentField, S.normalizationMode);
  const pVal = percentile(vals, p);
  if (!Number.isFinite(pVal) || pVal <= 0) return;

  // ---- Color domain / breaks ----
  if (S.colorMode === 'quantiles') {
    const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    S.colorBreaks = quantileBreaks(vals, ramp.length, 1, 99); // p1..p99 equal-frequency bins
    S.colorDomain = null;
  } else {
    // continuous = EQUAL INTERVAL classes across p1..p99
    const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    const pLow = percentile(vals, 1);
    const pHigh = percentile(vals, 99);
    let lo = Number.isFinite(pLow) ? pLow : 0;
    let hi = Number.isFinite(pHigh) ? pHigh : 1;
    if (!(hi > lo)) { lo = 0; hi = 1; }
    S.colorDomain = { lo, hi, label: 'p1–p99' };
   
    // build equal-interval thresholds: colors => k classes => k-1 breaks
    const classes = Math.max(2, ramp.length);
    const step = (hi - lo) / classes;
    const breaks: number[] = [];
    for (let i = 1; i < classes; i++) breaks.push(lo + step * i);
    S.colorBreaks = breaks;
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
  S.currentStats = computeStatsNormalized(S.currentGeoJSON, S.currentField, S.normalizationMode);

  console.debug('autoScale', {
    mode: S.normalizationMode,
    field: S.currentField,
    pctl: p,
    pVal,
    unit: unitKey,
    multiplier,
    colorMode: S.colorMode,
    colorBreaks: S.colorBreaks,
    colorDomain: S.colorDomain,
    stats: S.currentStats
  });

  applyExtrusionWithVisibility();
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


function currentModeErrorMessage(props: Record<string, any>): string | null {
  if (S.normalizationMode === 'perLand' && S.landSizeField) {
    const v = Number((props as any)[S.landSizeField]);
    if (!Number.isFinite(v) || v <= 0) return '⚠ Invalid land size (≤ 0 or missing)';
  } else if (S.normalizationMode === 'perBuilding' && S.bldgSizeField) {
    const v = Number((props as any)[S.bldgSizeField]);
    if (Number.isFinite(v) && v < 0) return '⚠ Negative building size';
    if (v === 0) return 'ℹ Building size is 0 — shown flat (not an error)';
  }
  return null;
}

function buildPopupHTML(props: Record<string, any>, parcelId: string): string {
  const title = props.name ?? props.NAME ?? props.id ?? props.ID ?? '';
  const metric = computeDisplayedMetricFromProps(props);
  const heightM = metric != null ? computeExtrusionHeightMeters(metric) : null;

  const unitKey = unitsSelect.value as keyof typeof UNIT_TO_METERS;
  const unitText = (unitsSelect.options[unitsSelect.selectedIndex]?.text || unitKey);

  const fieldsToShow = Array.from(new Set([
    ...S.chosenNumericFields,
    ...S.chosenCategoricalFields,
    ...(S.landSizeField ? [S.landSizeField] : []),
    ...(S.bldgSizeField ? [S.bldgSizeField] : []),
  ]));

  const rows = fieldsToShow.map(k => {
    const fieldType = getPopupFieldType(k);
    const patch = getParcelPatchEntry(parcelId, k);
    const v = patch ? patch.current : (props as any)[k];
    const printable = escapeHtml(formatPopupValue(fieldType, v));
    const changed = isFieldChanged(parcelId, k, fieldType);
    const rowStyle = changed ? 'background: rgba(255, 0, 0, 0.08);' : '';
    const nameStyle = changed ? 'font-weight:700;' : '';
    return `
      <tr data-field="${escapeHtml(k)}" data-field-type="${fieldType}" style="${rowStyle}">
        <td style="padding:2px 6px; overflow-wrap:anywhere;">
          <code style="white-space:normal;${nameStyle}">${escapeHtml(k)}</code>
        </td>
        <td style="padding:2px 6px; text-align:right; white-space:nowrap;" data-value-cell>
          ${printable}
        </td>
        <td style="padding:2px 6px; text-align:right; white-space:nowrap;">
          <button type="button" class="popup-edit-btn" title="Edit value" style="background:none;border:none;cursor:pointer;font-size:12px;line-height:1;">
            ✏️
          </button>
        </td>
        <td style="padding:2px 6px; text-align:right; white-space:nowrap;">
          <button type="button" class="popup-reset-btn" title="Reset to original" style="background:none;border:none;cursor:pointer;font-size:12px;line-height:1;${changed ? '' : 'display:none;'}">↩</button>
        </td>
      </tr>`;
  }).join('');

  const modeLabel =
    S.normalizationMode === 'perLand' ? `per ${S.landSizeField || 'land size'}` :
    S.normalizationMode === 'perBuilding' ? `per ${S.bldgSizeField || 'building size'}` :
    'as-is';

  const metricRow = S.currentFieldType === 'categorical' 
    ? `<div><strong>Category</strong>: ${S.currentField ? (props[S.currentField] ?? '—') : '—'}</div>`
    : (metric != null)
      ? `<div><strong>Display metric (${modeLabel})</strong>: ${fmt(metric)}</div>`
      : `<div><strong>Display metric</strong>: —</div>`;

  const heightRow = S.currentFieldType === 'categorical'
    ? `<div><strong>Extrusion height</strong>: Flat (no extrusion for categorical fields)</div>`
    : !S.is3DMode
      ? `<div><strong>Extrusion height</strong>: Flat (3D mode disabled)</div>`
      : (heightM != null)
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
      ${S.is3DMode && S.currentFieldType === 'numeric' ? 
        `<div style="margin-top:6px; font-size:12px; color:#666">
          Multiplier × unit: ${fmt(Number(multInput.value))} × ${unitKey}
        </div>` : ''}
      <div style="height:1px;background:#eee;margin:6px 0"></div>
      <div style="font-weight:600;margin-bottom:2px">Loaded fields</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <input type="text" id="popupSearch" placeholder="Search fields..." style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px;">
      </div>
      <div style="overflow-y:auto; max-height:400px;">
        <table style="width:100%; border-collapse:collapse; font-size:12px; table-layout:fixed;">
          <colgroup>
          <col span="1" style="width:53%">
          <col span="1" style="width:29%">
          <col span="1" style="width:9%">
          <col span="1" style="width:9%">
          </colgroup>
          <tbody id="popupFieldsTable">
          ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

function onMultInput() {
  const v = Number(multInput.value);
  if (!Number.isFinite(v)) return; // ignore interim typing states
  scheduleUpdate('applyOnly');
}


function update3DUI() {
  if (S.currentFieldType === 'numeric') {
    extrusionOptions.style.display = S.is3DMode ? 'grid' : 'none';
  } else {
    extrusionOptions.style.display = 'none';
  }
}

function computeAndSetGoodExtrusionDefaults() {
  if (!S.currentGeoJSON || !S.currentField || S.currentFieldType !== 'numeric') return;
  
  const vals = getNumericValuesNormalized(S.currentGeoJSON, S.currentField, S.normalizationMode);
  if (vals.length === 0) return;
  
  // Sort values and get p99
  vals.sort((a, b) => a - b);
  const p99 = vals[Math.floor(vals.length * 0.99)];
  
  // Use existing function to choose best unit and multiplier
  const { unit, multiplier } = chooseBestMetricUnitForMultiplier(p99);
  
  // Set the values
  multInput.value = String(multiplier);
  unitsSelect.value = unit;
  
  // Cache the settings
  S.cachedExtrusionSettings = { multiplier, unit };
}

function updateFieldTypeUI() {
  const numericOptions = document.getElementById('numericOptions');
  const categoricalOptions = document.getElementById('categoricalOptions');
  
  if (!S.currentField) {
    // Hide all options when no field is selected
    if (numericOptions) numericOptions.style.display = 'none';
    if (categoricalOptions) categoricalOptions.style.display = 'none';
    if (colorOptions) colorOptions.style.display = 'none';
    if (colorRampOptions) colorRampOptions.style.display = 'none';
    if (colorScalingOptions) colorScalingOptions.style.display = 'none';
    if (opacityOptions) opacityOptions.style.display = 'none';
    if (paintDividerNumeric) paintDividerNumeric.style.display = 'none';
    if (paintDividerCategorical) paintDividerCategorical.style.display = 'none';
    if (paintDividerRamp) paintDividerRamp.style.display = 'none';
    if (paintDividerScaling) paintDividerScaling.style.display = 'none';
    extrusionOptions.style.display = 'none';
  } else {
    const showNumericOptions = S.currentFieldType === 'numeric';
    const showCategoricalOptions = S.currentFieldType === 'categorical';
    const showColorRampOptions = showNumericOptions || (showCategoricalOptions && S.categoricalColorMode === 'colorRamp');
    const showColorScalingOptions = showNumericOptions;
    const showOpacityOptions = true;
    
    if (colorRampOptions) colorRampOptions.style.display = showColorRampOptions ? 'grid' : 'none';
    if (colorScalingOptions) colorScalingOptions.style.display = showColorScalingOptions ? 'grid' : 'none';
    if (opacityOptions) opacityOptions.style.display = showOpacityOptions ? 'grid' : 'none';
    
    if (showNumericOptions) {
      if (numericOptions) numericOptions.style.display = 'grid';
      if (categoricalOptions) categoricalOptions.style.display = 'none';
      if (colorOptions) colorOptions.style.display = 'none';
      update3DUI(); // This will show/hide extrusion options based on 3D mode
    } else if (showCategoricalOptions) {
      if (numericOptions) numericOptions.style.display = 'none';
      if (categoricalOptions) categoricalOptions.style.display = 'grid';
      if (colorOptions) colorOptions.style.display = 'none';
      extrusionOptions.style.display = 'none';
      
      // Show/hide color options based on selected mode
      if (colorOptions) {
        colorOptions.style.display = S.categoricalColorMode === 'single' ? 'block' : 'none';
      }
    }

    const sectionVisibility = [
      showNumericOptions,
      showCategoricalOptions,
      showColorRampOptions,
      showColorScalingOptions,
      showOpacityOptions
    ];
    const dividers = [paintDividerNumeric, paintDividerCategorical, paintDividerRamp, paintDividerScaling];
    dividers.forEach((divider, index) => {
      if (!divider) return;
      const hasPrev = sectionVisibility[index];
      const hasNext = sectionVisibility.slice(index + 1).some(Boolean);
      divider.style.display = hasPrev && hasNext ? 'block' : 'none';
    });
  }
}

/* ---------------- Events ---------------- */

if (btnBrowseDataSource) {
  btnBrowseDataSource.addEventListener('click', () => fileInput.click());
}

if (btnCancelAddLayer) {
  btnCancelAddLayer.addEventListener('click', closeAddLayerModal);
}

if (addLayerOverlay) {
  addLayerOverlay.addEventListener('click', (event) => {
    if (event.target === addLayerOverlay) {
      closeAddLayerModal();
    }
  });
}

// File load: read METADATA ONLY
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  persistCurrentLayerState();
  const dataStore = createDataStore(file, fileToAsyncBuffer(file));
  S.dataStores.set(dataStore.id, dataStore);
  S.dataStoreOrder.push(dataStore.id);
  S.currentDataStoreId = dataStore.id;
  renderDataStoreList();
  registerLayer(createLayerState(dataStore.name, dataStore.id));
  closeAddLayerModal();

  revealUI();
  try {
    S.lastFile = dataStore.file;
    S.lastAsyncBuffer = dataStore.asyncBuffer;

    const md = await parquetMetadataAsync(S.lastAsyncBuffer);
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
    
    // numeric and categorical top-level columns (not geometry)
    const schemaTree: any = parquetSchema(md);
    const top = Array.isArray(schemaTree?.children) ? schemaTree.children : [];
    const numeric: string[] = [];
    const categorical: string[] = [];

    for (const node of top) {
      const name = node?.element?.name ?? node?.name;
      if (!name || name === primaryGeom) continue;
      
      const el = node.element ?? {};
      const typeStr = String(el.type?.type ?? el.type ?? el.physicalType ?? el.primitiveType ?? '');
      const logical = String(el.logicalType?.type ?? el.logicalType ?? el.convertedType ?? '');
      
      const isNumeric =
        ['DOUBLE','FLOAT','INT32','INT64','INT16','INT8'].includes(typeStr.toUpperCase()) ||
        logical.toUpperCase() === 'DECIMAL';
      
      // Everything that's not numeric is categorical (including strings, booleans, etc.)
      const isCategorical = !isNumeric;
      
      if (isNumeric) numeric.push(name);
      else if (isCategorical) categorical.push(name);
    }

    S.lastNumericFieldsFromSchema = numeric.sort();
    S.lastCategoricalFieldsFromSchema = categorical.sort();
    dataStore.numericFieldsFromSchema = [...S.lastNumericFieldsFromSchema];
    dataStore.categoricalFieldsFromSchema = [...S.lastCategoricalFieldsFromSchema];

    // Show numeric fields modal first, then categorical if needed
    if (S.lastNumericFieldsFromSchema.length > 0) {
      openNumericFieldChooserModal({ 
        rowCount: numRows, 
        geometryCol: primaryGeom, 
        numericFields: S.lastNumericFieldsFromSchema
      });
    } else if (S.lastCategoricalFieldsFromSchema.length > 0) {
      openCategoricalFieldChooserModal({ 
        rowCount: numRows, 
        geometryCol: primaryGeom, 
        categoricalFields: S.lastCategoricalFieldsFromSchema
      });
    } else {
      alert('No numeric or categorical fields found in the file.');
    }
  } catch (err: any) {
    console.error('Metadata read failed:', err);
    alert(`Could not read Parquet metadata: ${err?.message ?? err}`);
  }
});

// Only recompute after data is loaded
[colorCont, colorQuant].forEach(el =>
  el?.addEventListener('change', () => {
    if (!S.currentGeoJSON) return;
    const val = (document.querySelector('input[name="colorMode"]:checked') as HTMLInputElement)?.value;
    if (val === 'continuous' || val === 'quantiles') {
      S.colorMode = val;
      scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
      persistCurrentLayerState();
    }
  })
);

// Categorical color mode event listeners
document.querySelectorAll<HTMLInputElement>('input[name="categoricalColorMode"]').forEach(el =>
  el.addEventListener('change', () => {
    
    if (!S.currentGeoJSON || S.currentFieldType !== 'categorical') return;
    const val = (document.querySelector('input[name="categoricalColorMode"]:checked') as HTMLInputElement)?.value;
    if (val === 'random' || val === 'single' || val === 'colorRamp') {
      S.categoricalColorMode = val;
      
      // Show/hide color options
      if (colorOptions) {
        colorOptions.style.display = S.categoricalColorMode === 'single' ? 'block' : 'none';
      }
      
      // Show/hide color ramp widget based on categorical color mode
      const rampContainer = rampSelect.parentElement?.parentElement;
      if (rampContainer) {
        rampContainer.style.display = (S.categoricalColorMode === 'colorRamp' || S.currentFieldType !== 'categorical') ? 'block' : 'none';
      }
      
      scheduleUpdate('applyOnly', /*refreshLegend*/ true);
      persistCurrentLayerState();
    }
  })
);

// Color picker event listeners
btnCancelColorPicker.addEventListener('click', () => {
  // Reset color picker to current value
  colorPicker.value = S.singleColorValue;
});

btnConfirmColorPicker.addEventListener('click', () => {
  S.singleColorValue = colorPicker.value;
  
  // Update the map if we're currently using single color mode
  if (S.currentFieldType === 'categorical' && S.categoricalColorMode === 'single') {
    scheduleUpdate('applyOnly', /*refreshLegend*/ true);
  }
  persistCurrentLayerState();
});

// Update color picker when single color mode is selected
colorPicker.addEventListener('input', () => {
  // Update the map in real-time as user changes color
  if (S.currentFieldType === 'categorical' && S.categoricalColorMode === 'single') {
    S.singleColorValue = colorPicker.value;
    scheduleUpdate('applyOnly', /*refreshLegend*/ true);
  }
  persistCurrentLayerState();
});

// Window management event listeners
btnMinimizeLayers.addEventListener('click', minimizeLayers);
btnMinimizeSettingsMenu.addEventListener('click', minimizeSettingsMenu);
btnMinimizePaint.addEventListener('click', minimizePaint);
btnMinimizeLegend.addEventListener('click', minimizeLegend);
btnMinimizeStatistics.addEventListener('click', minimizeStatistics);
btnMinimizeScatterplot.addEventListener('click', minimizeScatterplot);
btnMinimizeFilters.addEventListener('click', minimizeFilters);
btnMinimizeLandSchedule.addEventListener('click', minimizeLandSchedule);
btnPaintMenu.addEventListener('click', togglePaint);

landScheduleFieldSelect.addEventListener('change', () => {
  S.currentLandScheduleField = landScheduleFieldSelect.value || null;
  S.currentLandScheduleValue = null;
  updateLandScheduleValueOptions();
});

landScheduleValueSelect.addEventListener('change', () => {
  S.currentLandScheduleValue = landScheduleValueSelect.value || null;
  updateLandScheduleInputsFromStore();
});

landScheduleBaseMin.addEventListener('input', updateLandScheduleStoreFromInputs);
landScheduleBaseMax.addEventListener('input', updateLandScheduleStoreFromInputs);
landScheduleBaseValue.addEventListener('input', updateLandScheduleStoreFromInputs);
landScheduleBasePer.addEventListener('change', () => {
  updateLandScheduleStoreFromInputs();
});

filtersSaveToggle.addEventListener('click', () => {
  if (filtersSaveToggle.disabled) return;
  setSavedFiltersPanelMode('save');
});

filtersLoadToggle.addEventListener('click', () => {
  if (filtersLoadToggle.disabled) return;
  setSavedFiltersPanelMode('load');
});

filtersSaveNameInput.addEventListener('input', () => {
  updateSavedFiltersUIState();
});

filtersSaveConfirmButton.addEventListener('click', () => {
  saveCurrentFilters(filtersSaveNameInput.value);
});

filtersLoadSelect.addEventListener('change', () => {
  const selected = filtersLoadSelect.value;
  if (!selected) return;
  applySavedFilter(selected);
});

addFilterButton.addEventListener('click', () => {
  S.filters.push(createFilterRule());
  renderFiltersList();
  updateFiltersUIState();
  persistCurrentLayerState();
});

filtersSelectButton.addEventListener('click', () => {
  setFilterActionMode('select');
});

filtersShowButton.addEventListener('click', () => {
  setFilterActionMode('show');
});

filtersHideButton.addEventListener('click', () => {
  setFilterActionMode('hide');
});

filtersInvertToggle.addEventListener('change', () => {
  S.filterInvert = filtersInvertToggle.checked;
  applyActiveFilterAction();
  applyMapFilters();
  updateSavedFiltersUIState();
  persistCurrentLayerState();
});

statsLayerSelect.addEventListener('change', () => {
  S.statsLayerId = statsLayerSelect.value || null;
  S.statsCategoryField = null;
  S.statsCategoryValueIndices = [];
  S.statsField = null;
  S.statsFieldType = null;
  refreshStatisticsPanel();
  resetStatisticsDisplay();
});

scatterLayerSelect.addEventListener('change', () => {
  S.scatterLayerId = scatterLayerSelect.value || null;
  S.scatterCategoryField = null;
  S.scatterCategoryValueIndices = [];
  S.scatterXField = null;
  S.scatterYField = null;
  S.scatterRangeIsCustom = false;
  refreshScatterPanel();
});

statsSubjectButtons.forEach(button => {
  button.addEventListener('click', () => {
    const mode = button.dataset.subjectMode as SubjectMode | undefined;
    if (!mode) return;
    setStatsSubjectMode(mode);
  });
});

scatterSubjectButtons.forEach(button => {
  button.addEventListener('click', () => {
    const mode = button.dataset.subjectMode as SubjectMode | undefined;
    if (!mode) return;
    setScatterSubjectMode(mode);
  });
});

statsSubjectControls.filterSelect.addEventListener('change', () => {
  S.statsFilteredName = statsSubjectControls.filterSelect.value || null;
  updateStatisticsSectionVisibility();
  updateStatisticsResults();
});

scatterSubjectControls.filterSelect.addEventListener('change', () => {
  S.scatterFilteredName = scatterSubjectControls.filterSelect.value || null;
  S.scatterRangeIsCustom = false;
  scheduleScatterPlotRefresh();
});

statsCategoryFieldSelect.addEventListener('change', () => {
  S.statsCategoryField = statsCategoryFieldSelect.value || null;
  S.statsCategoryValueIndices = [];
  populateStatisticsCategoryValues(S.statsCategoryField);
  updateStatisticsSubjectControls();
  updateStatisticsSectionVisibility();
  resetStatisticsDisplay();
});

statsCategoryValueSelect.addEventListener('change', () => {
  S.statsCategoryValueIndices = Array.from(statsCategoryValueSelect.selectedOptions)
    .map(option => option.value)
    .filter(value => value);
  updateStatisticsSectionVisibility();
  if (S.statsCategoryValueIndices.length > 0 && S.statsField) {
    updateStatisticsResults();
    return;
  }
  resetStatisticsDisplay();
});

scatterCategoryFieldSelect.addEventListener('change', () => {
  S.scatterCategoryField = scatterCategoryFieldSelect.value || null;
  S.scatterCategoryValueIndices = [];
  populateScatterCategoryValues(S.scatterCategoryField);
  updateScatterSubjectControls();
  S.scatterRangeIsCustom = false;
  scheduleScatterPlotRefresh();
});

scatterCategoryValueSelect.addEventListener('change', () => {
  S.scatterCategoryValueIndices = Array.from(scatterCategoryValueSelect.selectedOptions)
    .map(option => option.value)
    .filter(value => value);
  updateScatterSubjectControls();
  S.scatterRangeIsCustom = false;
  scheduleScatterPlotRefresh();
});

statsFieldSelect.addEventListener('change', () => {
  S.statsField = statsFieldSelect.value || null;
  const layer = getStatsLayer();
  const dataStore = getLayerDataStore(layer);
  const useDataSource = S.statsSubjectMode === 'category' || S.statsSubjectMode === 'filtered';
  const numericFields = useDataSource ? dataStore?.chosenNumericFields ?? [] : layer?.chosenNumericFields ?? [];
  const categoricalFields = useDataSource ? dataStore?.chosenCategoricalFields ?? [] : layer?.chosenCategoricalFields ?? [];
  S.statsFieldType = getStatsFieldType(S.statsField, numericFields, categoricalFields);
  updateStatisticsSectionVisibility();
  if (S.statsField) {
    updateStatisticsResults();
  } else {
    resetStatisticsDisplay();
  }
});

scatterXFieldSelect.addEventListener('change', () => {
  S.scatterXField = scatterXFieldSelect.value || null;
  S.scatterRangeIsCustom = false;
  scheduleScatterPlotRefresh();
});

scatterYFieldSelect.addEventListener('change', () => {
  S.scatterYField = scatterYFieldSelect.value || null;
  S.scatterRangeIsCustom = false;
  scheduleScatterPlotRefresh();
});

function handleScatterRangeInput() {
  if (S.isUpdatingScatterRangeInputs) return;
  S.scatterRangeIsCustom = true;
  scheduleScatterPlotRefresh();
}

scatterXMinInput.addEventListener('input', handleScatterRangeInput);
scatterXMaxInput.addEventListener('input', handleScatterRangeInput);
scatterYMinInput.addEventListener('input', handleScatterRangeInput);
scatterYMaxInput.addEventListener('input', handleScatterRangeInput);
scatterResetExtentsButton.addEventListener('click', () => {
  S.scatterRangeIsCustom = false;
  setScatterRangeInputs(S.scatterDefaultRange);
  scheduleScatterPlotRefresh();
});

document.querySelectorAll<HTMLInputElement>('input[name="statsNormMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    S.statsNormalizationMode = (document.querySelector('input[name="statsNormMode"]:checked') as HTMLInputElement)
      ?.value as 'asis' | 'perLand' | 'perBuilding';
    updateStatisticsResults();
  });
});

function clampOverflowPercent(minValue: number, maxValue: number) {
  let minPct = Math.max(0, Math.min(minValue, 100));
  let maxPct = Math.max(0, Math.min(maxValue, 100));
  if (minPct > maxPct) {
    [minPct, maxPct] = [maxPct, minPct];
  }
  S.statsOverflowPct = { min: minPct, max: maxPct };
  setPercentInputValue(statsOverflowMinPct, S.statsOverflowPct.min);
  setPercentInputValue(statsOverflowMaxPct, S.statsOverflowPct.max);
}

function applyOverflowFromPercent() {
  if (!S.statsValuesCache.length) return;
  updateStatisticsResults();
}

function bindPercentInput(input: HTMLInputElement) {
  input.addEventListener('focus', () => {
    const parsed = parsePercentInputValue(input.value);
    input.value = parsed === null ? '' : String(parsed);
  });
  input.addEventListener('blur', () => {
    const parsed = parsePercentInputValue(input.value);
    if (parsed === null) {
      input.value = '';
      return;
    }
    setPercentInputValue(input, parsed);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = Number(input.dataset.step ?? '0.1');
    const current = parsePercentInputValue(input.value) ?? 0;
    const delta = event.key === 'ArrowUp' ? step : -step;
    const next = Math.min(100, Math.max(0, current + delta));
    setPercentInputValue(input, next);
    const minPct = parsePercentInputValue(statsOverflowMinPct.value);
    const maxPct = parsePercentInputValue(statsOverflowMaxPct.value);
    if (minPct !== null && maxPct !== null) {
      clampOverflowPercent(minPct, maxPct);
      applyOverflowFromPercent();
    }
  });
  input.addEventListener('input', () => {
    const minPct = parsePercentInputValue(statsOverflowMinPct.value);
    const maxPct = parsePercentInputValue(statsOverflowMaxPct.value);
    if (minPct === null || maxPct === null) return;
    clampOverflowPercent(minPct, maxPct);
    applyOverflowFromPercent();
  });
}

bindPercentInput(statsOverflowMinPct);
bindPercentInput(statsOverflowMaxPct);


// No longer needed - legend toggle removed from settings

// Global mouse event listeners for dragging
document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);
window.addEventListener('resize', () => {
  updateFiltersPanelLayout();
});

// Make windows draggable
makeDraggable(controlsEl);
makeDraggable(settingsControlsEl);
makeDraggable(paintControlsEl);
makeDraggable(floatingLegend);
makeDraggable(statisticsControlsEl);
makeDraggable(scatterplotControlsEl);
makeDraggable(filtersControlsEl);
makeDraggable(landScheduleControlsEl);
positionPaintPanel();
positionSettingsPanel();
positionFiltersPanel();
positionLandSchedulePanel();
updatePaintButtonState(btnPaintMenu);

rampSelect.addEventListener('change', () => {
  // if quantiles, new color count ⇒ recompute breaks
  const needsRecompute = (S.colorMode === 'quantiles');
  // Also update if using categorical color ramp
  const needsCategoricalUpdate = (S.currentFieldType === 'categorical' && S.categoricalColorMode === 'colorRamp');
  scheduleUpdate(needsRecompute || needsCategoricalUpdate ? 'recomputeAndAutoScale' : 'applyOnly', /*refreshLegend*/ true);
  persistCurrentLayerState();
});

multInput.addEventListener('input', onMultInput);

multInput.addEventListener('change', () => {
  onMultInput();
  // Cache the current extrusion settings
  if (S.is3DMode && S.currentFieldType === 'numeric') {
    S.cachedExtrusionSettings = {
      multiplier: Number(multInput.value),
      unit: unitsSelect.value
    };
  }
  persistCurrentLayerState();
});

unitsSelect.addEventListener('change', () => {
  scheduleUpdate('applyOnly');
  // Cache the current extrusion settings
  if (S.is3DMode && S.currentFieldType === 'numeric') {
    S.cachedExtrusionSettings = {
      multiplier: Number(multInput.value),
      unit: unitsSelect.value
    };
  }
  persistCurrentLayerState();
});

opacityInput.addEventListener('input', () => {
  if (opacityOut) opacityOut.value = Number(opacityInput.value).toFixed(2);
  scheduleUpdate('applyOnly');
  persistCurrentLayerState();
});

fieldSelect.addEventListener('change', () => {
  S.currentField = fieldSelect.value || null;
  if (!S.currentGeoJSON) return;
  
  if (!S.currentField) {
    // No field selected - apply gray rendering
    S.currentFieldType = null;
    S.currentStats = null;
    updateFieldTypeUI();
    applyGrayRendering();
    updateFloatingLegend();
    // Clear markup layer when no field is selected
    if (S.map.getLayer('markup-layer')) S.map.removeLayer('markup-layer');
    if (S.map.getLayer('markup-layer-outline')) S.map.removeLayer('markup-layer-outline');
    if (S.map.getSource('markup-source')) S.map.removeSource('markup-source');
    persistCurrentLayerState();
    return;
  }
  
  // Determine field type
  if (S.chosenNumericFields.includes(S.currentField)) {
    S.currentFieldType = 'numeric';
  } else if (S.chosenCategoricalFields.includes(S.currentField)) {
    S.currentFieldType = 'categorical';
  }
  
  // Update UI based on field type
  updateFieldTypeUI();
  
  // Ensure categorical color mode is properly set if switching to categorical
  if (S.currentFieldType === 'categorical') {
    // Make sure the radio button is checked
    const radioButton = document.querySelector(`input[name="categoricalColorMode"][value="${S.categoricalColorMode}"]`) as HTMLInputElement;
    if (radioButton) {
      radioButton.checked = true;
    }
  }
  
  // Clear legend selections when field changes, but preserve parcel selections
  S.selectedLegendItems.clear();
  // Note: selectedParcels is preserved so highlighting continues to work
  
  // Clear cached extrusion settings when field changes
  S.cachedExtrusionSettings = null;
  
  // Reset to default sorting state when field changes
  if (S.currentFieldType === 'categorical') {
    S.legendSortField = 'name';
  } else {
    S.legendSortField = 'count';
  }
  S.legendSortDirection = 'desc';
  
  if (S.map.getLayer('markup-layer')) S.map.removeLayer('markup-layer');
  if (S.map.getLayer('markup-layer-outline')) S.map.removeLayer('markup-layer-outline');
  if (S.map.getSource('markup-source')) S.map.removeSource('markup-source');
  
  scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
  persistCurrentLayerState();
  renderLayerList();
});

document.querySelectorAll<HTMLInputElement>('input[name="normMode"]').forEach(r => {
  r.addEventListener('change', () => {
    S.normalizationMode = (document.querySelector('input[name="normMode"]:checked') as HTMLInputElement)?.value as any;
    // Clear cached extrusion settings when normalization mode changes
    S.cachedExtrusionSettings = null;
    if (!S.currentGeoJSON || !S.currentField) return;
    scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
    persistCurrentLayerState();
  });
});

// 3D checkbox event listener
enable3DCheckbox.addEventListener('change', () => {
  S.is3DMode = enable3DCheckbox.checked;
  update3DUI();
  
  if (S.is3DMode && !S.cachedExtrusionSettings) {
    // First time enabling 3D - compute good defaults
    computeAndSetGoodExtrusionDefaults();
  } else if (S.is3DMode && S.cachedExtrusionSettings) {
    // Restore cached settings
    multInput.value = String(S.cachedExtrusionSettings.multiplier);
    unitsSelect.value = S.cachedExtrusionSettings.unit;
  }
  
  // Apply the current visualization
  if (S.currentGeoJSON && S.currentField) {
    applyExtrusion();
  }
  persistCurrentLayerState();
});

/* ---------------- Main ---------------- */

// default height units
unitsSelect.value = 'centimeters';

// Initialize UI - show numeric options by default, hide categorical
updateFieldTypeUI();
refreshFiltersUI();

setQuality('high');
renderLayerList();
renderDataStoreList();
refreshStatisticsPanel();
refreshScatterPanel();
refreshLandSchedulePanel();

function buildNumericColorRanges(): Array<{ min: number; max: number; color: string; rangeKey: string }> {
  if (!S.currentField || !S.currentGeoJSON || !S.currentStats) return [];
  
  const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
  let ranges: Array<{ min: number; max: number; color: string; rangeKey: string }> = [];
  
  if (S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length) {
    // Use quantile breaks for ranges
    const breaks = [S.currentStats.min, ...S.colorBreaks, S.currentStats.max];
    for (let i = 0; i < breaks.length - 1; i++) {
      const min = breaks[i];
      const max = breaks[i + 1];
      const rangeKey = `range_${i}`;
      const defaultColor = ramp[Math.min(i, ramp.length - 1)];
      const color = S.customColors.get(rangeKey) || defaultColor;
      ranges.push({ min, max, color, rangeKey });
    }
  } else {
    // Linear intervals - create 10 ranges
    const min = S.currentStats.min;
    const max = S.currentStats.max;
    const step = (max - min) / 10;
    
    for (let i = 0; i < 10; i++) {
      const rangeMin = min + (step * i);
      const rangeMax = i === 9 ? max : min + (step * (i + 1));
      const rangeKey = `range_${i}`;
      const colorIndex = Math.floor((i / 9) * (ramp.length - 1));
      const defaultColor = ramp[colorIndex];
      const color = S.customColors.get(rangeKey) || defaultColor;
      ranges.push({ min: rangeMin, max: rangeMax, color, rangeKey });
    }
  }
  
  return ranges;
}

function buildNumericColorExpression(): Expression {
  if (!S.currentField || !S.currentGeoJSON || !S.currentStats) return ['literal', '#888'] as any;
  
  const ranges = buildNumericColorRanges();
  if (ranges.length === 0) {
    return ['literal', '#888'] as any;
  }
  
  const valueExpr = buildValueExpression();
  
  // Build a step expression with the ranges
  const cases: any[] = ['case'];
  
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (i === ranges.length - 1) {
      // Last range includes the max value
      cases.push(['all',
        ['>=', valueExpr, range.min],
        ['<=', valueExpr, range.max]
      ], ['literal', range.color]);
    } else {
      cases.push(['all',
        ['>=', valueExpr, range.min],
        ['<', valueExpr, range.max]
      ], ['literal', range.color]);
    }
  }
  
  // Default color
  cases.push(['literal', '#888']);
  
  // Add highlighting for selected parcels
  const baseResult = cases as any;
  const result = ['case',
    ['boolean', ['feature-state', 'selected'], false], S.highlightColor,
    baseResult
  ] as any;
  
  return result;
}

/* ---------------- Vertical Toolbar ---------------- */

// Toolbar state

// Toolbar elements
const selectToolButton = document.getElementById('selectToolButton') as HTMLButtonElement;
const layersToolButton = document.getElementById('layersToolButton') as HTMLButtonElement;
const settingsToolButton = document.getElementById('settingsToolButton') as HTMLButtonElement;
const infoToolButton = document.getElementById('infoToolButton') as HTMLButtonElement;
const panToolButton = document.getElementById('panToolButton') as HTMLButtonElement;
const selectSubmenu = document.getElementById('selectSubmenu') as HTMLDivElement;
const submenuButtons = document.querySelectorAll('.submenu-button') as NodeListOf<HTMLButtonElement>;

// Tool state

// Hotkey definitions - easily changeable
const HOTKEYS = {
  PAN: 'h',
  SELECT: 'v',
  INFO: 'i'
};

// Icon mappings for different selection modes
const selectionModeIcons: Record<string, string> = {
  'select-one': new URL('./svg/select_cursor.svg', import.meta.url).href,
  'select-rectangle': new URL('./svg/select_rectangle.svg', import.meta.url).href,
  'select-lasso': new URL('./svg/select_lasso.svg', import.meta.url).href,
  'select-polygon': new URL('./svg/select_polygon.svg', import.meta.url).href
};
const cornerTriangleIcon = new URL('./svg/corner_triangle.svg', import.meta.url).href;

// Update the main toolbar button icon based on current selection mode
function updateToolbarIcon() {
  const iconPath = selectionModeIcons[S.currentSelectionMode];
  selectToolButton.innerHTML = `<img src="${iconPath}" alt="Select" />
          <span class="hotkey">V</span>
          <img src="${cornerTriangleIcon}" alt="" class="corner-triangle" />`;
}

// Update submenu active states
function updateSubmenuActiveStates() {
  submenuButtons.forEach(button => {
    const mode = button.getAttribute('data-mode');
    if (mode === S.currentSelectionMode) {
      button.classList.add('active-tool');
    } else {
      button.classList.remove('active-tool');
    }
  });
}

// Function to activate a specific tool and deactivate others
function activateTool(tool: 'pan' | 'info' | 'select') {
  // Deactivate all tools first
  S.isPanToolActive = false;
  S.isInfoToolActive = false;
  
  // Remove active-tool class from all buttons
  panToolButton.classList.remove('active-tool');
  infoToolButton.classList.remove('active-tool');
  selectToolButton.classList.remove('active-tool');
  
  // Activate the specified tool
  switch (tool) {
    case 'pan':
      S.isPanToolActive = true;
      panToolButton.classList.add('active-tool');
      // Enable drag pan for pan tool
      S.map.dragPan.enable();
      break;
    case 'info':
      S.isInfoToolActive = true;
      infoToolButton.classList.add('active-tool');
      // Disable drag pan for info tool
      S.map.dragPan.disable();
      break;
    case 'select':
      selectToolButton.classList.add('active-tool');
      // Disable drag pan for select tool
      S.map.dragPan.disable();
      break;
  }
  
  // Update selection mode handlers
  setupSelectionModeHandlers();
  
  // Update cursor
  updateCursor();
  
  // Close popup if info tool is deactivated
  if (!S.isInfoToolActive && S.activePopup) {
    S.activePopup.remove();
    S.activePopup = null;
    S.lastPicked = null;
  }
}

// Handle submenu button clicks
function handleSubmenuButtonClick(mode: string) {
  S.currentSelectionMode = mode as any;
  updateToolbarIcon();
  updateSubmenuActiveStates();
  selectSubmenu.classList.remove('show');
  
  // Activate select tool
  activateTool('select');
  
  console.log(`Selection mode changed to: ${mode}`);
}

// Set up event handlers based on current selection mode
function setupSelectionModeHandlers() {
  const mapContainer = S.map.getContainer();
  
  // Remove all existing mouse event listeners
  mapContainer.removeEventListener('mousedown', handleRectangleMouseDown);
  mapContainer.removeEventListener('mousemove', handleRectangleMouseMove);
  mapContainer.removeEventListener('mouseup', handleRectangleMouseUp);
  mapContainer.removeEventListener('mousedown', handleLassoMouseDown);
  mapContainer.removeEventListener('mousemove', handleLassoMouseMove);
  mapContainer.removeEventListener('mouseup', handleLassoMouseUp);
  mapContainer.removeEventListener('mousedown', handlePolygonMouseDown);
  mapContainer.removeEventListener('mousemove', handlePolygonMouseMove);
  mapContainer.removeEventListener('dblclick', handlePolygonDoubleClick);
  mapContainer.removeEventListener('mousedown', handlePanMouseDown);
  mapContainer.removeEventListener('mousemove', handlePanMouseMove);
  mapContainer.removeEventListener('mouseup', handlePanMouseUp);
  
  // Add pan tool event listeners if pan tool is active
  if (S.isPanToolActive) {
    mapContainer.addEventListener('mousedown', handlePanMouseDown);
    mapContainer.addEventListener('mousemove', handlePanMouseMove);
    mapContainer.addEventListener('mouseup', handlePanMouseUp);
    return;
  }
  
  // If info tool is active, don't add any selection event listeners
  if (S.isInfoToolActive) {
    return;
  }
  
  // Add event listeners based on current mode
  switch (S.currentSelectionMode) {
    case 'select-rectangle':
      mapContainer.addEventListener('mousedown', handleRectangleMouseDown);
      mapContainer.addEventListener('mousemove', handleRectangleMouseMove);
      mapContainer.addEventListener('mouseup', handleRectangleMouseUp);
      break;
    case 'select-lasso':
      mapContainer.addEventListener('mousedown', handleLassoMouseDown);
      mapContainer.addEventListener('mousemove', handleLassoMouseMove);
      mapContainer.addEventListener('mouseup', handleLassoMouseUp);
      break;
    case 'select-polygon':
      mapContainer.addEventListener('mousedown', handlePolygonMouseDown);
      mapContainer.addEventListener('mousemove', handlePolygonMouseMove);
      mapContainer.addEventListener('dblclick', handlePolygonDoubleClick);
      break;
    case 'select-one':
      // This mode uses the existing map click handler
      break;
  }
}

// Helper function to close all submenus
function closeAllSubmenus() {
  selectSubmenu.classList.remove('show');
}

function positionSubmenu(button: HTMLElement, submenu: HTMLElement) {
  submenu.style.top = `${button.offsetTop}px`;
}

// Initialize toolbar
function initializeToolbar() {
  // Set initial state
  updateToolbarIcon();
  updateSubmenuActiveStates();
  
  // Set initial button states based on window visibility
  updateToolbarButtonStates();
  
  // Activate pan tool by default
  activateTool('pan');
  
  // Set up initial selection mode handlers
  setupSelectionModeHandlers();
  
  // Set initial cursor state
  updateCursor();
  
  // Handle main select button click and hold behavior
  let selectButtonHoldTimer: number | null = null;
  let selectButtonHoldDuration = 200; // milliseconds to hold before showing submenu

  selectToolButton.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    
    // Start hold timer
    selectButtonHoldTimer = window.setTimeout(() => {
      positionSubmenu(selectToolButton, selectSubmenu);
      selectSubmenu.classList.add('show');
      selectButtonHoldTimer = null;
    }, selectButtonHoldDuration);
  });

  selectToolButton.addEventListener('mouseup', (e) => {
    e.stopPropagation();
    
    // If timer is still running, it was a quick click - toggle current option
    if (selectButtonHoldTimer) {
      clearTimeout(selectButtonHoldTimer);
      selectButtonHoldTimer = null;
      
      // Toggle the current selection mode
      const currentButton = selectSubmenu.querySelector(`[data-mode="${S.currentSelectionMode}"]`) as HTMLButtonElement;
      if (currentButton) {
        handleSubmenuButtonClick(S.currentSelectionMode);
      }
      // Close submenu after toggling
      closeAllSubmenus();
    }
  });

  selectToolButton.addEventListener('mouseleave', () => {
    // Clear timer if mouse leaves button
    if (selectButtonHoldTimer) {
      clearTimeout(selectButtonHoldTimer);
      selectButtonHoldTimer = null;
    }
  });
  
  // Handle layers button click
  layersToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    if (S.isLayersMinimized) {
      showLayers();
    } else {
      minimizeLayers();
    }
  });

  settingsToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    toggleSettingsMenu();
  });

  filtersToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    toggleFilters();
  });
  
  // Handle pan button click
  panToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    
    if (S.isPanToolActive) {
      // If pan is already active, deactivate it
      activateTool('select');
    } else {
      // Activate pan tool
      activateTool('pan');
    }
  });
  
  // Handle info button click
  infoToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    
    if (S.isInfoToolActive) {
      // If info is already active, deactivate it
      activateTool('select');
    } else {
      // Activate info tool
      activateTool('info');
    }
  });
  
  // Handle legend button click
  legendToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    if (S.isLegendMinimized) {
      showLegend();
    } else {
      minimizeLegend();
    }
  });

  statisticsToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    toggleStatistics();
  });

  scatterplotToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    toggleScatterplot();
  });

  landScheduleToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    toggleLandSchedule();
  });
  
  // Handle submenu button clicks
  submenuButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = button.getAttribute('data-mode');
      if (mode) {
        handleSubmenuButtonClick(mode);
        // Close submenu after selecting an option
        closeAllSubmenus();
      }
    });
  });
  
  // Close submenu when clicking outside
  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (!selectToolButton.contains(target) && !selectSubmenu.contains(target)) {
      closeAllSubmenus();
    }
  });
}

// Update toolbar button states based on window visibility
function updateToolbarButtonStates() {
  // Settings button state
  if (S.isLayersMinimized) {
    layersToolButton.classList.add('inactive');
    layersToolButton.classList.remove('active');
  } else {
    layersToolButton.classList.remove('inactive');
    layersToolButton.classList.add('active');
  }

  if (S.isSettingsMenuMinimized) {
    settingsToolButton.classList.add('inactive');
    settingsToolButton.classList.remove('active');
  } else {
    settingsToolButton.classList.remove('inactive');
    settingsToolButton.classList.add('active');
  }
  
  // Legend button state
  if (S.isLegendMinimized) {
    legendToolButton.classList.add('inactive');
    legendToolButton.classList.remove('active');
  } else {
    legendToolButton.classList.remove('inactive');
    legendToolButton.classList.add('active');
  }

  if (S.isStatisticsMinimized) {
    statisticsToolButton.classList.add('inactive');
    statisticsToolButton.classList.remove('active');
  } else {
    statisticsToolButton.classList.remove('inactive');
    statisticsToolButton.classList.add('active');
  }

  if (S.isScatterplotMinimized) {
    scatterplotToolButton.classList.add('inactive');
    scatterplotToolButton.classList.remove('active');
  } else {
    scatterplotToolButton.classList.remove('inactive');
    scatterplotToolButton.classList.add('active');
  }

  if (S.isFiltersMinimized) {
    filtersToolButton.classList.add('inactive');
    filtersToolButton.classList.remove('active');
  } else {
    filtersToolButton.classList.remove('inactive');
    filtersToolButton.classList.add('active');
  }

  if (S.isLandScheduleMinimized) {
    landScheduleToolButton.classList.add('inactive');
    landScheduleToolButton.classList.remove('active');
  } else {
    landScheduleToolButton.classList.remove('inactive');
    landScheduleToolButton.classList.add('active');
  }

  updatePaintButtonState(btnPaintMenu);
}

// Initialize toolbar when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeToolbar);
} else {
  initializeToolbar();
}

installWelcome();

// Initialize selection module with callbacks into main.ts
initSelection({
  getCurrentSourceId,
  updateCursor,
  makeDraggable,
  updateStatisticsResults,
  scheduleScatterPlotRefresh,
  updateHighlightColors,
  persistCurrentLayerState,
  updateLegendPosition,
  getFloatingLegend: () => floatingLegend,
});
initSelectionElements();
