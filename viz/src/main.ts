// Imports
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import type { Expression } from 'maplibre-gl';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';
import { parquetMetadataAsync, parquetSchema } from 'hyparquet';


// Local imports
import { OSM_STYLE, SATELLITE_STYLE, HEIGHT_CAP_METERS, HEIGHT_PCTL, COLOR_RAMPS, UNIT_TO_METERS } from './config';
import { coerceScalar, sanitizeFeatureInPlace, sanitizeFeaturesInPlace, fileToAsyncBuffer, } from './utils.sanitize';
import { roundGeometryInPlace, trimPropertiesInPlace, bbox } from './utils.geo';
import { numOrNull, fmt, percentile, quantileBreaks } from './utils.number';
import type {
  BasemapMode,
  NumericFilterOperator, CategoricalFilterOperator,
  ParcelFieldPatch,
  QualityMode, UpdateMode, MetricUnitKey,
  SubjectMode,
} from './types';
import {
  buildSubjectSelector,
  initStatisticsElements, initStatisticsCallbacks,
  resetStatisticsDisplay,
  populateStatisticsCategoryValues,
  getStatsFieldType,
  parsePercentInputValue, setPercentInputValue,
  updateStatisticsSectionVisibility,
  updateStatisticsResults, refreshStatisticsPanel,
  updateStatisticsSubjectControls, setStatsSubjectMode,
  renderStatsLayerOptions,
} from './statistics';
import {
  initScatterplotElements, initScatterplotCallbacks,
  populateScatterCategoryValues,
  updateScatterSubjectControls, setScatterSubjectMode,
  setScatterRangeInputs,
  scheduleScatterPlotRefresh,
  refreshScatterPanel, renderScatterLayerOptions,
  clearScatterSelection, clearScatterHover, zoomToScatterSelection,
  initScatterplotMapLayers,
} from './scatterplot';


import { S } from './state';
import {
  initFilterElements, initFilterCallbacks,
  setSavedFiltersPanelMode, updateSavedFiltersUIState,
  saveCurrentFilters, applySavedFilter,
  getCategoricalValues,
  createFilterRule, updateFiltersUIState, renderFiltersList,
  refreshFiltersUI,
  applyActiveFilterAction,
  persistFiltersContext,
  invalidateFiltersContextIf,
} from './filters';
import {
  createWindowManager, initWindowCallbacks, initPositionElements,
  positionSettingsPanel, positionStatisticsPanel,
  positionScatterplotPanel, positionFiltersPanel, positionLandSchedulePanel, positionTimeAdjustmentPanel,
  updateFiltersPanelLayout, refreshWindowMinHeight,
  initWindowDocking, registerDockableWindow, enableWindowResizing,
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
  clearLegendVisibility,
  updateFloatingLegend, updateLegendPosition,
  updateHighlightColors,
  applyExtrusionWithVisibility,
} from './legend';
import {
  initModalElements, initModalCallbacks,
  openNumericFieldChooserModal, openCategoricalFieldChooserModal,
  openSizeModal, openAddLayerModal, closeAddLayerModal,
  setSizeState,
} from './modals';
import {
  initToolbarCallbacks, initializeToolbar,
  updateToolbarButtonStates, updateCursor,
  activateTool, HOTKEYS,
} from './toolbar';
import {
  addOrUpdateSource,
  initRenderingElements, initRenderingCallbacks,
  applyGrayRendering, applyExtrusion,
  generatePseudoRandomColor,
  buildCategoricalColorPairs, buildCategoricalColorExpression,
  buildNumericColorRanges, buildNumericColorExpression,
  buildValueExpression,
  fitToData, setQuality,
  computeDisplayedMetricFromProps, computeExtrusionHeightMeters,
  scheduleUpdate, chooseBestMetricUnitForMultiplier,
  populateFieldDropdownFromList, detectNumericFieldsFromFeatures,
  getNumericValuesNormalized, computeStatsNormalized,
  makeStepColorExpression, computeAndApplyAutoMultiplier,
  makeColorExpressionFromExpr,
  update3DUI, updateFieldTypeUI,
  setPerspective, setOrtho, setView,
  getMultiplierValue, getUnitFactor, getOpacityValue,
} from './rendering';
import {
  addLandScheduleAdjustment,
  addLandScheduleTable,
  initLandScheduleCallbacks,
  initLandScheduleElements,
  refreshLandSchedulePanel,
  renderLandScheduleTables,
  setActiveLandScheduleTable,
  updateLandScheduleValueOptions,
} from './land-schedule';

import {
  initTimeAdjustmentElements,
  refreshTimeAdjustmentPanel,
} from './time-adjustment';
import {
  initLayerElements, initLayerCallbacks,
  getCurrentLayer, getCurrentLayerIds, getCurrentSourceId,
  setCurrentLayer, setLayerVisibility,
  createLayerState, persistCurrentLayerState,
  registerLayer, removeLayer,
  renderLayerList,
  getStatsLayer, getScatterLayer, getLayerDataStore, getLayerGeoJSON, getScatterDataStore,
  createDataStore, renderDataStoreList,
} from './layers';
import { initMetadataModule } from './metadata.js';
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
S.map.on('load', () => {
  initScatterplotMapLayers();
});


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
  if (mode !== 'none') {
    S.lastBasemapMode = mode;
  }
  addBasemap(mode);
  renderLayerList();
}

/* ---------------- Cursor Management (see ./toolbar.ts) ---------------- */

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

/* ---------------- Pan Tool (see ./toolbar.ts) ---------------- */


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
// Camera view buttons
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
(document.getElementById('btn-persp') as HTMLButtonElement)?.addEventListener('click', () => setPerspective());
(document.getElementById('btn-ortho') as HTMLButtonElement)?.addEventListener('click', () => setOrtho());
viewButtons.forEach(btn => btn.onclick = () => setView(btn.dataset.view!));

// Zoom to data button
const btnZoomTo = document.getElementById('btn-zoomto') as HTMLButtonElement;
btnZoomTo.onclick = () => { if (S.currentGeoJSON) fitToData(S.currentGeoJSON); };
if (addLayerFromStoreButton) {
  addLayerFromStoreButton.addEventListener('click', () => {
    openAddLayerModal();
  });
}

// Window elements
const appEl = document.getElementById('app') as HTMLDivElement;
const pinnedPanelsEl = document.getElementById('pinnedPanels') as HTMLDivElement;
const controlsEl = document.getElementById('controls') as HTMLDivElement;
const settingsContent = document.getElementById('settingsContent') as HTMLDivElement;
const settingsControlsEl = document.getElementById('settingsControls') as HTMLDivElement;
const settingsMenuContent = document.getElementById('settingsMenuContent') as HTMLDivElement;
const paintSectionToggle = document.getElementById('paintSectionToggle') as HTMLButtonElement;
const paintSectionContent = document.getElementById('paintSectionContent') as HTMLDivElement;
const statisticsControlsEl = document.getElementById('statisticsControls') as HTMLDivElement;
const statisticsContent = document.getElementById('statisticsContent') as HTMLDivElement;
const statsSubjectSection = document.getElementById('statsSubjectSection') as HTMLDivElement;
const statsLayerName = document.getElementById('statsLayerName') as HTMLDivElement;
const scatterplotControlsEl = document.getElementById('scatterplotControls') as HTMLDivElement;
const scatterplotContent = document.getElementById('scatterplotContent') as HTMLDivElement;
const scatterLayerName = document.getElementById('scatterLayerName') as HTMLDivElement;
const scatterSubjectSection = document.getElementById('scatterSubjectSection') as HTMLDivElement;
const scatterXFieldSelect = document.getElementById('scatterXField') as HTMLSelectElement;
const scatterYFieldSelect = document.getElementById('scatterYField') as HTMLSelectElement;
const scatterXMinInput = document.getElementById('scatterXMin') as HTMLInputElement;
const scatterXMaxInput = document.getElementById('scatterXMax') as HTMLInputElement;
const scatterYMinInput = document.getElementById('scatterYMin') as HTMLInputElement;
const scatterYMaxInput = document.getElementById('scatterYMax') as HTMLInputElement;
const scatterResetExtentsButton = document.getElementById('scatterResetExtents') as HTMLButtonElement;
const scatterColorByFieldSelect = document.getElementById('scatterColorByField') as HTMLSelectElement;
const scatterSelectionControls = document.getElementById('scatterSelectionControls') as HTMLDivElement;
const scatterZoomToSelectionButton = document.getElementById('scatterZoomToSelection') as HTMLButtonElement;
const scatterClearSelectionButton = document.getElementById('scatterClearSelection') as HTMLButtonElement;
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
const btnPinLayers = document.getElementById('btnPinLayers') as HTMLButtonElement;
const btnPinSettings = document.getElementById('btnPinSettings') as HTMLButtonElement;
const btnPinFilters = document.getElementById('btnPinFilters') as HTMLButtonElement;
const btnPinStatistics = document.getElementById('btnPinStatistics') as HTMLButtonElement;
const btnPinScatterplot = document.getElementById('btnPinScatterplot') as HTMLButtonElement;
const btnPinLandSchedule = document.getElementById('btnPinLandSchedule') as HTMLButtonElement;
const btnPinTimeAdjustment = document.getElementById('btnPinTimeAdjustment') as HTMLButtonElement;
const btnPinLegend = document.getElementById('btnPinLegend') as HTMLButtonElement;

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
const timeAdjustmentControlsEl = document.getElementById('timeAdjustmentControls') as HTMLDivElement;
const timeAdjustmentContent = document.getElementById('timeAdjustmentContent') as HTMLDivElement;
const landScheduleContent = document.getElementById('landScheduleContent') as HTMLDivElement;
const landScheduleFieldSelect = document.getElementById('landScheduleFieldSelect') as HTMLSelectElement;
const landScheduleValueRow = document.getElementById('landScheduleValueRow') as HTMLDivElement;
const landScheduleValueSelect = document.getElementById('landScheduleValueSelect') as HTMLSelectElement;
const landScheduleTableSelect = document.getElementById('landScheduleTableSelect') as HTMLSelectElement;
const landScheduleTableSelectRow = document.getElementById('landScheduleTableSelectRow') as HTMLDivElement;
const landScheduleAddTableButton = document.getElementById('landScheduleAddTable') as HTMLButtonElement;
const landScheduleTableContainer = document.getElementById('landScheduleTableContainer') as HTMLDivElement;
const landScheduleTablesSection = document.getElementById('landScheduleTablesSection') as HTMLDivElement;
const landScheduleTablesToggle = document.getElementById('landScheduleTablesToggle') as HTMLButtonElement;
const landScheduleTablesContent = document.getElementById('landScheduleTablesContent') as HTMLDivElement;
const landScheduleCurveToggle = document.getElementById('landScheduleCurveToggle') as HTMLButtonElement;
const landScheduleCurveContent = document.getElementById('landScheduleCurveContent') as HTMLDivElement;
const landScheduleCurveChart = document.getElementById('landScheduleCurveChart') as HTMLDivElement;
const landScheduleAdjustmentsSection = document.getElementById('landScheduleAdjustmentsSection') as HTMLDivElement;
const landScheduleAdjustmentsToggle = document.getElementById('landScheduleAdjustmentsToggle') as HTMLButtonElement;
const landScheduleAdjustmentsContent = document.getElementById('landScheduleAdjustmentsContent') as HTMLDivElement;
const landScheduleAdjustmentsContainer = document.getElementById('landScheduleAdjustmentsContainer') as HTMLDivElement;
const landScheduleAddAdjustmentButton = document.getElementById('landScheduleAddAdjustment') as HTMLButtonElement;

const EYE_ICON_OPEN = new URL('./svg/eye.svg', import.meta.url).href;
const EYE_ICON_CLOSED = new URL('./svg/eye_closed.svg', import.meta.url).href;
const PENCIL_ICON = new URL('./svg/pencil.svg', import.meta.url).href;
const PIN_ICON = new URL('./svg/thumbtack.svg', import.meta.url).href;
const PIN_ICON_TILTED = new URL('./svg/thumbtack-tilted.svg', import.meta.url).href;

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

function initPinButton(button: HTMLButtonElement) {
  const img = button.querySelector('img');
  if (!img) return;
  button.dataset.pinSrc = PIN_ICON;
  button.dataset.unpinSrc = PIN_ICON_TILTED;
  img.src = PIN_ICON_TILTED;
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
const btnMinimizeStatistics = document.getElementById('btnMinimizeStatistics') as HTMLButtonElement;
const btnMinimizeScatterplot = document.getElementById('btnMinimizeScatterplot') as HTMLButtonElement;
const btnMinimizeFilters = document.getElementById('btnMinimizeFilters') as HTMLButtonElement;
const btnMinimizeLandSchedule = document.getElementById('btnMinimizeLandSchedule') as HTMLButtonElement;
const btnMinimizeTimeAdjustment = document.getElementById('btnMinimizeTimeAdjustment') as HTMLButtonElement;

// Floating legend elements
const floatingLegend = document.getElementById('floatingLegend') as HTMLDivElement;
const btnMinimizeLegend = document.getElementById('btnMinimizeLegend') as HTMLButtonElement;
const legendTitle = document.getElementById('legendTitle') as HTMLDivElement;
const legendContent = document.getElementById('legendContent') as HTMLDivElement;

// Modal overlays (managed by modals.ts via initModalElements)
const numericModalOverlay = document.getElementById('numericModalOverlay')!;
const categoricalModalOverlay = document.getElementById('categoricalModalOverlay')!;
const sizeOverlay = document.getElementById('sizeOverlay')!;
const addLayerOverlay = document.getElementById('addLayerOverlay') as HTMLDivElement;
const loadingOverlay = document.getElementById('loadingOverlay')!;

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

const setPaintSectionCollapsed = (collapsed: boolean) => {
  S.isPaintCollapsed = collapsed;
  paintSectionContent.style.display = collapsed ? 'none' : 'grid';
  paintSectionToggle.classList.toggle('is-collapsed', collapsed);
  paintSectionToggle.title = collapsed ? 'Expand Paint' : 'Collapse Paint';
  refreshWindowMinHeight(controlsEl);
};

setPaintSectionCollapsed(S.isPaintCollapsed);
paintSectionToggle.addEventListener('click', () => {
  setPaintSectionCollapsed(!S.isPaintCollapsed);
});

const setLandScheduleTablesCollapsed = (collapsed: boolean) => {
  S.isLandScheduleTablesCollapsed = collapsed;
  landScheduleTablesContent.style.display = collapsed ? 'none' : 'grid';
  landScheduleTablesToggle.classList.toggle('is-collapsed', collapsed);
  landScheduleTablesToggle.title = collapsed ? 'Expand Size tables' : 'Collapse Size tables';
  refreshWindowMinHeight(landScheduleControlsEl);
};

const setLandScheduleCurveCollapsed = (collapsed: boolean) => {
  S.isLandScheduleCurveCollapsed = collapsed;
  landScheduleCurveContent.style.display = collapsed ? 'none' : 'block';
  landScheduleCurveToggle.classList.toggle('is-collapsed', collapsed);
  landScheduleCurveToggle.title = collapsed ? 'Expand Curve' : 'Collapse Curve';
  refreshWindowMinHeight(landScheduleControlsEl);
};

const setLandScheduleAdjustmentsCollapsed = (collapsed: boolean) => {
  S.isLandScheduleAdjustmentsCollapsed = collapsed;
  landScheduleAdjustmentsContent.style.display = collapsed ? 'none' : 'grid';
  landScheduleAdjustmentsToggle.classList.toggle('is-collapsed', collapsed);
  landScheduleAdjustmentsToggle.title = collapsed ? 'Expand Adjustments' : 'Collapse Adjustments';
  refreshWindowMinHeight(landScheduleControlsEl);
};

setLandScheduleTablesCollapsed(S.isLandScheduleTablesCollapsed);
setLandScheduleCurveCollapsed(S.isLandScheduleCurveCollapsed);
setLandScheduleAdjustmentsCollapsed(S.isLandScheduleAdjustmentsCollapsed);

landScheduleTablesToggle.addEventListener('click', () => {
  setLandScheduleTablesCollapsed(!S.isLandScheduleTablesCollapsed);
});

landScheduleCurveToggle.addEventListener('click', () => {
  setLandScheduleCurveCollapsed(!S.isLandScheduleCurveCollapsed);
});

landScheduleAdjustmentsToggle.addEventListener('click', () => {
  setLandScheduleAdjustmentsCollapsed(!S.isLandScheduleAdjustmentsCollapsed);
});

// Color ramp choices
for (const key of Object.keys(COLOR_RAMPS)) {
  const opt = document.createElement('option'); opt.value = key; opt.textContent = key; rampSelect.appendChild(opt);
}
rampSelect.value = 'Viridis';


/* ---------------- Layer & Data Store functions — see ./layers.ts ----------------- */

// Window management — using createWindowManager from windows.ts
const layersWin = createWindowManager({
  getMinimized: () => S.isLayersMinimized,
  setMinimized: (v) => { S.isLayersMinimized = v; },
  contentEl: settingsContent,
  controlsEl: controlsEl,
  contentDisplay: 'block',
  positionFn: () => { positionSettingsPanel(); },
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
  onMinimize: () => {
    clearScatterHover();
    clearScatterSelection();
  },
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
  onMinimize: () => {
    invalidateFiltersContextIf(context => context.type === 'landSchedule');
  },
});

const timeAdjustmentWin = createWindowManager({
  getMinimized: () => S.isTimeAdjustmentMinimized,
  setMinimized: (v) => { S.isTimeAdjustmentMinimized = v; },
  contentEl: timeAdjustmentContent,
  controlsEl: timeAdjustmentControlsEl,
  positionFn: positionTimeAdjustmentPanel,
  onShow: () => { refreshTimeAdjustmentPanel(); },
});

// Convenience aliases matching the old function names
const minimizeLayers = layersWin.minimize;
const showLayers = layersWin.show;
const minimizeSettingsMenu = settingsMenuWin.minimize;
const showSettingsMenu = settingsMenuWin.show;
const toggleSettingsMenu = settingsMenuWin.toggle;
const minimizeLegend = legendWin.minimize;
const showLegend = legendWin.show;
const minimizeStatistics = statisticsWin.minimize;
const showStatistics = statisticsWin.show;
const minimizeScatterplot = scatterplotWin.minimize;
const showScatterplot = scatterplotWin.show;
const minimizeFilters = filtersWin.minimize;
const showFilters = filtersWin.show;
const minimizeLandSchedule = landScheduleWin.minimize;
const showLandSchedule = landScheduleWin.show;
const toggleLandSchedule = landScheduleWin.toggle;
const minimizeTimeAdjustment = timeAdjustmentWin.minimize;
const toggleTimeAdjustment = timeAdjustmentWin.toggle;

// Wire callbacks and DOM elements into the windows module
initWindowCallbacks({
  updateToolbarButtonStates,
  updateLegendPosition,
});
initPositionElements({
  controlsEl,
  settingsControlsEl,
  statisticsControlsEl,
  scatterplotControlsEl,
  filtersControlsEl,
  filtersContent,
  filtersListEl,
  landScheduleControlsEl,
  timeAdjustmentControlsEl,
});
initWindowDocking({
  pinnedContainer: pinnedPanelsEl,
  appContainer: appEl,
});
[
  btnPinLayers,
  btnPinSettings,
  btnPinFilters,
  btnPinStatistics,
  btnPinScatterplot,
  btnPinLandSchedule,
  btnPinTimeAdjustment,
  btnPinLegend,
].forEach(initPinButton);
registerDockableWindow(controlsEl, btnPinLayers);
registerDockableWindow(settingsControlsEl, btnPinSettings);
registerDockableWindow(filtersControlsEl, btnPinFilters);
registerDockableWindow(statisticsControlsEl, btnPinStatistics);
registerDockableWindow(scatterplotControlsEl, btnPinScatterplot);
registerDockableWindow(landScheduleControlsEl, btnPinLandSchedule);
registerDockableWindow(timeAdjustmentControlsEl, btnPinTimeAdjustment);
registerDockableWindow(floatingLegend, btnPinLegend);
enableWindowResizing(controlsEl);
enableWindowResizing(settingsControlsEl);
enableWindowResizing(filtersControlsEl);
enableWindowResizing(statisticsControlsEl);
enableWindowResizing(scatterplotControlsEl);
enableWindowResizing(landScheduleControlsEl);
enableWindowResizing(timeAdjustmentControlsEl);
enableWindowResizing(floatingLegend);

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
  filtersContextLine: document.getElementById('filtersContextLine') as HTMLDivElement,
});
initFilterCallbacks({
  persistCurrentLayerState,
  renderLayerList,
  updateStatisticsResults,
  scheduleScatterPlotRefresh,
  getCurrentLayerIds,
  clearLegendVisibility,
  hideFiltersPanel: minimizeFilters,
});

// Wire DOM elements and callbacks into the rendering module
initRenderingElements({
  fieldSelect,
  rampSelect,
  opacityInput,
  multInput,
  unitsSelect,
  extrusionOptions,
  colorRampOptions,
  colorScalingOptions,
  opacityOptions,
  colorOptions,
  paintDividerNumeric,
  paintDividerCategorical,
  paintDividerRamp,
  paintDividerScaling,
});
initRenderingCallbacks({
  getCurrentLayer,
  getCurrentLayerIds,
  setLayerVisibility,
  setCurrentLayer,
  showRenderingToast,
  hideRenderingToast,
  awaitFirstRenderedFeature,
  showPopup,
  buildPopupHTML,
  addPopupSearchFunctionality,
  addPopupEditFunctionality,
  updateCursor,
  isTextInputElement,
  activateTool: (tool: string) => activateTool(tool as 'pan' | 'info' | 'select'),
  hotkeys: HOTKEYS,
});

// Wire DOM elements and callbacks into the legend module
initLegendElements({
  floatingLegend,
  legendContent,
  legendTitle,
});
initLegendCallbacks({
  persistCurrentLayerState,
  renderLayerList,
  applyExtrusion,
  getCurrentLayerIds,
  getCurrentSourceId,
  buildCategoricalColorPairs,
  buildCategoricalColorExpression,
  buildNumericColorRanges,
  buildNumericColorExpression,
  buildValueExpression,
  createEyeButton,
  getMultiplierValue: () => {
    const rawMult = Number(multInput.value);
    return Number.isFinite(rawMult) ? rawMult : 0;
  },
  getUnitFactor: () => UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1,
  getOpacityValue: () => parseFloat(opacityInput.value),
});

// Wire DOM elements and callbacks into the modals module
initModalElements({
  numericModalOverlay,
  categoricalModalOverlay,
  sizeOverlay,
  addLayerOverlay,
  rowCountEl: document.getElementById('rowCount')!,
  geomColEl: document.getElementById('geomCol')!,
  numericFieldListEl: document.getElementById('numericFieldList')!,
  btnAllNumeric: document.getElementById('btnAllNumeric') as HTMLButtonElement,
  btnNoneNumeric: document.getElementById('btnNoneNumeric') as HTMLButtonElement,
  btnCancelNumericModal: document.getElementById('btnCancelNumericModal') as HTMLButtonElement,
  btnConfirmNumericModal: document.getElementById('btnConfirmNumericModal') as HTMLButtonElement,
  categoricalRowCountEl: document.getElementById('categoricalRowCount')!,
  categoricalGeomColEl: document.getElementById('categoricalGeomCol')!,
  categoricalFieldListEl: document.getElementById('categoricalFieldList')!,
  btnAllCategorical: document.getElementById('btnAllCategorical') as HTMLButtonElement,
  btnNoneCategorical: document.getElementById('btnNoneCategorical') as HTMLButtonElement,
  btnCancelCategoricalModal: document.getElementById('btnCancelCategoricalModal') as HTMLButtonElement,
  btnConfirmCategoricalModal: document.getElementById('btnConfirmCategoricalModal') as HTMLButtonElement,
  bldgFieldSel: document.getElementById('bldgField') as HTMLSelectElement,
  bldgUnitSel: document.getElementById('bldgUnit') as HTMLSelectElement,
  landFieldSel: document.getElementById('landField') as HTMLSelectElement,
  landUnitSel: document.getElementById('landUnit') as HTMLSelectElement,
  btnSizeBack: document.getElementById('btnSizeBack') as HTMLButtonElement,
  btnSizeSkip: document.getElementById('btnSizeSkip') as HTMLButtonElement,
  btnSizeOk: document.getElementById('btnSizeOk') as HTMLButtonElement,
  normLand,
  normBldg,
  normLandUnitEl,
  normBldgUnitEl,
  statsNormAsIs,
  statsNormLand,
  statsNormBldg,
  statsNormLandUnitEl,
  statsNormBldgUnitEl,
});
initModalCallbacks({
  clearData,
  loadSelectedColumns,
  getCurrentLayer,
  renderDataStoreList,
});

// Wire DOM elements and callbacks into the statistics module
initStatisticsElements({
  statsLayerName,
  statsSubjectControls,
  statsFieldSelect,
  statsDetails,
  statsNumericBlock,
  statsCategoricalBlock,
  statsNormalizationControls,
  statisticsSection,
  statsParcelCount,
  statsMedian,
  statsMean,
  statsStdDev,
  statsCod,
  statsPercentiles,
  statsHistogram,
  statsCategoricalParcelCount,
  statsCategoricalUniqueCount,
  statsCategoricalModalValue,
  statsCategoricalValues,
  statsNormAsIs,
  statsNormLand,
  statsNormBldg,
  statsNormLandUnitEl,
  statsNormBldgUnitEl,
  statsOverflowMinPct,
  statsOverflowMaxPct,
});
initStatisticsCallbacks({
  getStatsLayer,
  getLayerDataStore,
  getLayerGeoJSON,
  getParcelId,
});

// Wire DOM elements and callbacks into the scatterplot module
initScatterplotElements({
  scatterLayerName,
  scatterSubjectControls,
  scatterXFieldSelect,
  scatterYFieldSelect,
  scatterXMinInput,
  scatterXMaxInput,
  scatterYMinInput,
  scatterYMaxInput,
  scatterResetExtentsButton,
  scatterColorByFieldSelect,
  scatterSelectionControls,
  scatterZoomToSelectionButton,
  scatterClearSelectionButton,
  scatterPlot,
  scatterPlotEmpty,
});
initScatterplotCallbacks({
  getScatterLayer,
  getScatterDataStore,
  getParcelId,
});

// Wire DOM elements into the land-schedule module
initLandScheduleElements({
  landScheduleFieldSelect,
  landScheduleValueSelect,
  landScheduleValueRow,
  landScheduleTableSelect,
  landScheduleTableSelectRow,
  landScheduleAddTableButton,
  landScheduleTableContainer,
  landScheduleCurveChart,
  landScheduleTablesSection,
  landScheduleAdjustmentsSection,
  landScheduleAdjustmentsContainer,
  landScheduleAddAdjustmentButton,
});
initLandScheduleCallbacks({
  showFiltersPanel: showFilters,
});

initTimeAdjustmentElements({
  panel: timeAdjustmentControlsEl,
  showFiltersPanel: showFilters,
  salePriceField: document.getElementById('timeAdjustmentSalePriceField') as HTMLSelectElement,
  improvedFilterButton: document.getElementById('timeAdjustmentImprovedFilter') as HTMLButtonElement,
  improvedSizeField: document.getElementById('timeAdjustmentImprovedSize') as HTMLSelectElement,
  vacantFilterButton: document.getElementById('timeAdjustmentVacantFilter') as HTMLButtonElement,
  landSizeField: document.getElementById('timeAdjustmentLandSize') as HTMLSelectElement,
  entriesToggle: document.getElementById('timeAdjustmentEntriesToggle') as HTMLButtonElement,
  entriesBody: document.getElementById('timeAdjustmentEntriesBody') as HTMLDivElement,
  dataToggle: document.getElementById('timeAdjustmentDataToggle') as HTMLButtonElement,
  dataBody: document.getElementById('timeAdjustmentDataBody') as HTMLDivElement,
  entryNameInput: document.getElementById('timeAdjustmentEntryName') as HTMLInputElement,
  addEntryButton: document.getElementById('timeAdjustmentAddEntry') as HTMLButtonElement,
  entrySelect: document.getElementById('timeAdjustmentEntrySelect') as HTMLSelectElement,
  entryDetails: document.getElementById('timeAdjustmentEntryDetails') as HTMLDivElement,
  undoDeleteButton: document.getElementById('timeAdjustmentUndoDelete') as HTMLButtonElement,
  sampleCount: document.getElementById('timeAdjustmentSampleCount') as HTMLSpanElement,
  displaySelect: document.getElementById('timeAdjustmentDisplay') as HTMLSelectElement,
  groupBySelect: document.getElementById('timeAdjustmentGroupBy') as HTMLSelectElement,
  granularitySelect: document.getElementById('timeAdjustmentGranularity') as HTMLSelectElement,
  methodSelect: document.getElementById('timeAdjustmentMethod') as HTMLSelectElement,
  minSampleInput: document.getElementById('timeAdjustmentMinSample') as HTMLInputElement,
  priceLowInput: document.getElementById('timeAdjustmentPriceLow') as HTMLInputElement,
  priceHighInput: document.getElementById('timeAdjustmentPriceHigh') as HTMLInputElement,
  sizeLowInput: document.getElementById('timeAdjustmentSizeLow') as HTMLInputElement,
  sizeHighInput: document.getElementById('timeAdjustmentSizeHigh') as HTMLInputElement,
  ratioLowInput: document.getElementById('timeAdjustmentRatioLow') as HTMLInputElement,
  ratioHighInput: document.getElementById('timeAdjustmentRatioHigh') as HTMLInputElement,
  trendToggleButton: document.getElementById('timeAdjustmentPlotTrend') as HTMLButtonElement,
  exportCsvButton: document.getElementById('timeAdjustmentExportCsv') as HTMLButtonElement,
  exportExcelButton: document.getElementById('timeAdjustmentExportExcel') as HTMLButtonElement,
  chart: document.getElementById('timeAdjustmentChart') as HTMLDivElement,
  spinner: document.getElementById('timeAdjustmentSpinner') as HTMLDivElement,
  chartMessage: document.getElementById('timeAdjustmentChartMessage') as HTMLDivElement,
});

// Wire DOM elements and callbacks into the layers module
initLayerElements({
  layerList,
  dataStoreList,
  currentLayerSource,
  fieldSelect,
  rampSelect,
  opacityInput,
  opacityOut,
  normAsIs,
  normLand,
  normBldg,
  colorCont,
  colorQuant,
  colorPicker,
  enable3DCheckbox: enable3DCheckbox,
  filtersInvertToggle,
});
initLayerCallbacks({
  setSizeState,
  populateFieldDropdownFromList,
  updateFieldTypeUI,
  update3DUI,
  updateFloatingLegend,
  updateSelectionControls,
  refreshStatisticsPanel,
  refreshScatterPanel,
  refreshFiltersUI,
  showFiltersPanel: showFilters,
  showStatisticsPanel: showStatistics,
  showScatterplotPanel: showScatterplot,
  renderStatsLayerOptions,
  renderScatterLayerOptions,
  addOrUpdateSource,
  applyGrayRendering,
  applyExtrusionWithVisibility,
  closeAddLayerModal,
  createEyeButton,
  setEyeButtonIcon,
  setBasemapMode,
});

// Initialize metadata module for project save/load
initMetadataModule();

// renderLayerList, updateCurrentLayerDetails — see ./layers.ts

// Floating legend functions — see ./legend.ts

// Land schedule functions — see ./land-schedule.ts

// applyExtrusionWithVisibility, updateHighlightColors, updateLegendPosition — see ./legend.ts

// Minimal bounding polygon (convex hull) for Polygon/MultiPolygon features.
// Uses Andrew's monotone chain (O(n log n) for sort, linear after).


function installWelcome() {
  minimizeLayers();
  minimizeSettingsMenu();
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

export function revealUI() {
  if (S.welcomeEl) { S.welcomeEl.remove(); S.welcomeEl = null; }
  showLayers();
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



/* (Heuristics, field choosers, size modal, and add-layer modal moved to modals.ts) */

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
refreshTimeAdjustmentPanel();

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

/* --- rendering functions → see rendering.ts --- */


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

    // Check if this parquet matches a placeholder from a loaded project
    const matchingPlaceholder = Array.from(S.dataStores.values()).find(
      ds => (ds as any)._expectedParquetFile === file.name && ds.id !== dataStore.id
    );

    if (matchingPlaceholder) {
      // This parquet was referenced in a loaded project - apply saved configuration
      dataStore.chosenNumericFields = [...matchingPlaceholder.chosenNumericFields];
      dataStore.chosenCategoricalFields = [...matchingPlaceholder.chosenCategoricalFields];
      dataStore.landSizeField = matchingPlaceholder.landSizeField;
      dataStore.landSizeUnitLabel = matchingPlaceholder.landSizeUnitLabel;
      dataStore.bldgSizeField = matchingPlaceholder.bldgSizeField;
      dataStore.bldgSizeUnitLabel = matchingPlaceholder.bldgSizeUnitLabel;

      // Handle "all fields" mode
      if ((matchingPlaceholder as any)._allNumericFields) {
        dataStore.chosenNumericFields = [...dataStore.numericFieldsFromSchema];
      }
      if ((matchingPlaceholder as any)._allCategoricalFields) {
        dataStore.chosenCategoricalFields = [...dataStore.categoricalFieldsFromSchema];
      }

      // Copy to S state
      S.chosenNumericFields = [...dataStore.chosenNumericFields];
      S.chosenCategoricalFields = [...dataStore.chosenCategoricalFields];
      S.landSizeField = dataStore.landSizeField;
      S.landSizeUnitLabel = dataStore.landSizeUnitLabel;
      S.bldgSizeField = dataStore.bldgSizeField;
      S.bldgSizeUnitLabel = dataStore.bldgSizeUnitLabel;

      // Remove the placeholder and replace with real dataStore
      S.dataStores.delete(matchingPlaceholder.id);
      const placeholderIndex = S.dataStoreOrder.indexOf(matchingPlaceholder.id);
      if (placeholderIndex >= 0) {
        S.dataStoreOrder[placeholderIndex] = dataStore.id;
      }

      // Update layers that referenced the placeholder
      S.layers.forEach(layer => {
        if (layer.dataStoreId === matchingPlaceholder.id) {
          layer.dataStoreId = dataStore.id;
        }
      });

      // Skip wizard, load data directly
      await loadSelectedColumns();
    } else {
      // Normal flow: show wizard
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
btnMinimizeLegend.addEventListener('click', minimizeLegend);
btnMinimizeStatistics.addEventListener('click', minimizeStatistics);
btnMinimizeScatterplot.addEventListener('click', minimizeScatterplot);
btnMinimizeFilters.addEventListener('click', minimizeFilters);
btnMinimizeLandSchedule.addEventListener('click', minimizeLandSchedule);
btnMinimizeTimeAdjustment.addEventListener('click', minimizeTimeAdjustment);

landScheduleFieldSelect.addEventListener('change', () => {
  S.currentLandScheduleField = landScheduleFieldSelect.value || null;
  S.currentLandScheduleValue = null;
  updateLandScheduleValueOptions();
});

landScheduleValueSelect.addEventListener('change', () => {
  S.currentLandScheduleValue = landScheduleValueSelect.value || null;
  renderLandScheduleTables();
});

landScheduleAddTableButton.addEventListener('click', () => {
  addLandScheduleTable();
});

landScheduleAddAdjustmentButton.addEventListener('click', () => {
  addLandScheduleAdjustment();
});

landScheduleTableSelect.addEventListener('change', () => {
  setActiveLandScheduleTable(landScheduleTableSelect.value || null);
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
  persistFiltersContext();
});

filtersInvertToggle.addEventListener('change', () => {
  S.filterInvert = filtersInvertToggle.checked;
  applyActiveFilterAction();
  persistFiltersContext();
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

scatterColorByFieldSelect.addEventListener('change', () => {
  S.scatterColorByField = scatterColorByFieldSelect.value || null;
  scheduleScatterPlotRefresh();
});

statsFieldSelect.addEventListener('change', () => {
  S.statsField = statsFieldSelect.value || null;
  const layer = getStatsLayer();
  const dataStore = getLayerDataStore(layer);
  const useDataSource = S.statsSubjectMode === 'category';
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

scatterZoomToSelectionButton.addEventListener('click', () => {
  zoomToScatterSelection();
});

scatterClearSelectionButton.addEventListener('click', () => {
  clearScatterSelection();
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
makeDraggable(floatingLegend);
makeDraggable(statisticsControlsEl);
makeDraggable(scatterplotControlsEl);
makeDraggable(filtersControlsEl);
makeDraggable(landScheduleControlsEl);
positionSettingsPanel();
positionFiltersPanel();
positionLandSchedulePanel();

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
refreshTimeAdjustmentPanel();

/* ---------------- Vertical Toolbar (see ./toolbar.ts) ---------------- */

// Wire callbacks into the toolbar module
initToolbarCallbacks({
  showLayers,
  minimizeLayers,
  toggleSettingsMenu,
  showLegend,
  minimizeLegend,
  toggleLandSchedule,
  toggleTimeAdjustment,
});

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
