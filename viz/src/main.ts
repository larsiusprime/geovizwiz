// Imports
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';
import { parquetMetadataAsync, parquetSchema } from 'hyparquet';
import PIN_SVG_RAW from './svg/pin.svg?raw';
import { createCollapseToggle, escapeHtml, isTextInputElement } from './utils.dom';
import { EYE_ICON_OPEN, EYE_ICON_CLOSED, PIN_ICON, PIN_ICON_TILTED } from './icons';
import {
  fileInput,
  fieldSelect,
  rampSelect,
  enable3DCheckbox,
  multInput,
  unitsSelect,
  hexResRow,
  enableHexCheckbox,
  hexResInput,
  hexResReadout,
  enable3DRow,
  threeDSection,
  threeDSectionContent,
  threeDSectionToggle,
  layerList,
  addLayerFromStoreButton,
  settingsOtherActions,
  opacityInput,
  opacityOut,
  colorRampOptions,
  colorScalingOptions,
  opacityOptions,
  paintDividerNumeric,
  paintDividerCategorical,
  paintDividerRamp,
  paintDividerScaling,
  btnZoomTo,
  appEl,
  pinnedPanelsEl,
  controlsEl,
  settingsContent,
  settingsControlsEl,
  settingsMenuContent,
  paintSectionToggle,
  paintSectionContent,
  statisticsControlsEl,
  statisticsContent,
  statsSubjectSection,
  statsLayerName,
  scatterplotControlsEl,
  scatterplotContent,
  scatterLayerName,
  scatterSubjectSection,
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
  filtersControlsEl,
  filtersContent,
  filtersListEl,
  filtersInvertToggle,
  addFilterButton,
  filtersSavedContainer,
  btnPinLayers,
  btnPinSettings,
  btnPinFilters,
  btnPinStatistics,
  btnPinScatterplot,
  btnPinLandSchedule,
  btnPinTimeAdjustment,
  btnPinLegend,
  statsFieldSelect,
  statsNormModeSelect,
  statsDetails,
  statsNumericBlock,
  statsCategoricalBlock,
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
  statsOverflowMinPct,
  statsOverflowMaxPct,
  statsLayerToggle,
  statsLayerBody,
  statsFieldToggle,
  statsSummaryToggle,
  statsSummaryBody,
  statsPercentilesToggle,
  statsPercentilesBody,
  statsHistogramToggle,
  statsHistogramBody,
  landScheduleControlsEl,
  timeAdjustmentControlsEl,
  timeAdjustmentContent,
  landScheduleContent,
  landScheduleTableSelect,
  landScheduleTableSelectRow,
  landScheduleAddTableButton,
  landScheduleTableContainer,
  landScheduleTablesSection,
  landScheduleTablesToggle,
  landScheduleTablesContent,
  landScheduleCurveSection,
  landScheduleCurveToggle,
  landScheduleCurveContent,
  landScheduleCurveChart,
  landScheduleAdjustmentsSection,
  landScheduleAdjustmentsToggle,
  landScheduleAdjustmentsContent,
  landScheduleAdjustmentsContainer,
  landScheduleAddAdjustmentButton,
  timeAdjustmentTrendToggle,
  timeAdjustmentTrendBody,
  timeAdjustmentFiltersToggle,
  timeAdjustmentFiltersBody,
  compFinderCriteriaToggle,
  compFinderCriteriaBody,
  compFinderCompsToggle,
  compFinderCompsBody,
  btnMinimizeLayers,
  btnMinimizeSettingsMenu,
  btnMinimizeStatistics,
  btnMinimizeScatterplot,
  btnMinimizeFilters,
  btnMinimizeLandSchedule,
  btnMinimizeTimeAdjustment,
  btnMinimizeCompFinder,
  btnMinimizeInspect,
  btnMinimizeWrite,
  floatingLegend,
  btnMinimizeLegend,
  legendTitle,
  legendContent,
  compFinderControlsEl,
  compFinderContent,
  btnPinCompFinder,
  inspectControlsEl,
  inspectContent,
  btnPinInspect,
  export3DControlsEl,
  export3DContent,
  btnPinExport3D,
  btnMinimizeExport3D,
  btnExport3D,
  writeControlsEl,
  writeContent,
  btnPinWrite,
  writeDataSource,
  writeApplyTo,
  writeSelectionCount,
  writeFieldSelect,
  writeNewFieldNameRow,
  writeNewFieldTypeRow,
  writeNewFieldName,
  writeNewFieldType,
  writeEditMode,
  writeConstantSection,
  writeEquationSection,
  writeSubmit,
  writeCancel,
  writeSpinner,
  writeError,
  writeStatus,
  compFinderDataSourceSelect,
  compFinderUseDistance,
  compFinderDistanceInput,
  compFinderDistanceUnits,
  compFinderUseSelection,
  compFinderCriteriaThresholdError,
  compFinderCriteriaWidgets,
  compFinderCriteriaTableBody,
  compFinderAddCriterion,
  compFinderRefresh,
  compFinderDirtyIndicator,
  compFinderNoCompsIndicator,
  compFinderSpinner,
  compFinderResultsRow,
  compFinderResultsSummary,
  compFinderPager,
  compFinderEmptyState,
  compFinderCriteriaSection,
  compFinderCompsSection,
  compFinderCriteriaCompsDivider,
  compFinderCompsTableHead,
  compFinderCompsTableBody,
  compFinderCompsTableContainer,
  compFinderAddFieldSelect,
  compFinderAddFieldButton,
  compFinderAddFieldRow,
  compFinderZoomButton,
  compFinderExportCsv,
  compFinderExportExcel,
  addLayerOverlay,
  progressBar,
  progressMsg,
  dataStoreList,
  btnBrowseDataSource,
  btnCancelAddLayer,
  settingsDataSourcesToggle,
  settingsDataSourcesList,
  confirmDeleteDataSourceOverlay,
  confirmDeleteDataSourceText,
  btnCancelDeleteDataSource,
  btnConfirmDeleteDataSource,
  colorCont,
  colorQuant,
  colorModeSelect,
  normModeSelect,
  fieldVisualizeToggle,
  fieldVisualizeBody,
  colorOptions,
  colorPicker,
  btnCancelColorPicker,
  btnConfirmColorPicker,
  numericModalOverlay,
  categoricalModalOverlay,
  sizeOverlay,
  loadingOverlay,
  progressEl,
} from './dom-refs';

// Local imports
import { OSM_STYLE, SATELLITE_STYLE, COLOR_RAMPS, UNIT_TO_METERS } from './config';
import { sanitizeFeaturesInPlace, fileToAsyncBuffer } from './utils.sanitize';
import { roundGeometryInPlace, trimPropertiesInPlace } from './utils.geo';
import { fmt, parseStrictNumber } from './utils.number';
import type {
  BasemapMode,
  ParcelFieldPatch,
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
  renderStatsLayerOptions, getCurrentStatsSubjectSelection,
} from './statistics';
import {
  initScatterplotElements, initScatterplotCallbacks,
  populateScatterCategoryValues,
  updateScatterSubjectControls, setScatterSubjectMode,
  setScatterRangeInputs,
  scheduleScatterPlotRefresh,
  refreshScatterPanel, renderScatterLayerOptions,
  clearScatterSelection, clearScatterHover, zoomToScatterSelection,
  initScatterplotMapLayers, getCurrentScatterSubjectSelection,
} from './scatterplot';


import { S } from './state';
import {
  initFilterElements, initFilterCallbacks,
  getCategoricalValues,
  createFilterRule, updateFiltersUIState, renderFiltersList,
  refreshFiltersUI,
  applyActiveFilterAction,
  persistFiltersContext,
  setSelectionFiltersContext,
  invalidateFiltersContextIf,
} from './filters';
import {
  createWindowManager, initWindowCallbacks, initPositionElements,
  positionSettingsPanel, positionStatisticsPanel,
  positionScatterplotPanel, positionFiltersPanel, positionLandSchedulePanel, positionTimeAdjustmentPanel,
  updateFiltersPanelLayout, refreshWindowMinHeight, refreshWindowMinWidth,
  initWindowDocking, registerDockableWindow, enableWindowResizing,
  makeDraggable, handleMouseMove, handleMouseUp,
  ensureFloatingWindowVisible,
} from './windows';
import {
  initSelection, initSelectionElements,
  getParcelId, findFeatureByParcelId,
  addParcelToSelection, clearAllSelections,
  updateSelectionControls,
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
  openSizeModal, openAddLayerModal, closeAddLayerModal,
  setSizeState,
} from './modals';
import {
  initCompFinderElements,
  initCompFinderCallbacks,
  setCompFinderSubject,
  setCompFinderToolActive,
  setCompFinderMenuVisible,
} from './comp-finder';
import {
  initToolbarCallbacks, initializeToolbar,
  updateToolbarButtonStates, updateCursor,
  activateTool, HOTKEYS,
} from './toolbar';
import {
  addOrUpdateSource,
  initRenderingElements, initRenderingCallbacks,
  applyGrayRendering, applyExtrusion,
  buildCategoricalColorPairs, buildCategoricalColorExpression,
  buildNumericColorRanges, buildNumericColorExpression,
  buildValueExpression,
  fitToData, setQuality,
  scheduleUpdate, chooseBestMetricUnitForMultiplier,
  populateFieldDropdownFromList,
  getNumericValuesNormalized,
  update3DUI, updateFieldTypeUI,
  setPerspective, setOrtho, setView,
} from './rendering';
import { startHexUpdateIfActive, cancelHexUpdate, getCommittedHexState } from './hex-layer';
import { initExport3DMenu, refreshExport3DMenu } from './export-3d';
import {
  addLandScheduleAdjustment,
  addLandScheduleTable,
  initLandScheduleCallbacks,
  initLandScheduleElements,
  refreshLandSchedulePanel,
  setActiveLandScheduleTable,
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
import { getRuntimeMode, isBrowserMode, isDesktopMode, isHostedMode } from './runtime-mode';
(window as any).savedFiltersStore = S.savedFiltersStore;

/* ---------------- Runtime Mode ----------------- */

const runtimeMode = getRuntimeMode();
console.info(`[viz] runtime mode: ${runtimeMode}`);
if (isBrowserMode()) {
  console.info('[viz] browser mode features enabled');
} else if (isDesktopMode()) {
  console.info('[viz] desktop mode features enabled');
} else if (isHostedMode()) {
  console.info('[viz] hosted mode features enabled');
}
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-viz-runtime-mode', runtimeMode);
}

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


/* ---------------- Pan Tool (see ./toolbar.ts) ---------------- */


/* ---------------- Selection (see ./selection.ts) ---------------- */


/* ---------------- UI elements ---------------- */


// Camera view buttons
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
(document.getElementById('btn-persp') as HTMLButtonElement)?.addEventListener('click', () => setPerspective());
(document.getElementById('btn-ortho') as HTMLButtonElement)?.addEventListener('click', () => setOrtho());
viewButtons.forEach(btn => btn.onclick = () => setView(btn.dataset.view!));

// Zoom to data button
btnZoomTo.onclick = () => { if (S.currentGeoJSON) fitToData(S.currentGeoJSON); };
if (addLayerFromStoreButton) {
  addLayerFromStoreButton.addEventListener('click', () => {
    openAddLayerModal();
  });
}

// Window elements

const statsSubjectControls = buildSubjectSelector(statsSubjectSection, { title: null });
const scatterSubjectControls = buildSubjectSelector(scatterSubjectSection, { title: null });

const statsSubjectButtons = statsSubjectControls.buttons;
const statsCategoryFieldSelect = statsSubjectControls.categoryFieldSelect;
const statsCategoryValueSelect = statsSubjectControls.categoryValueSelect;
const statsSelectOnMapButton = statsSubjectControls.selectOnMapButton;

const scatterSubjectButtons = scatterSubjectControls.buttons;
const scatterCategoryFieldSelect = scatterSubjectControls.categoryFieldSelect;
const scatterCategoryValueSelect = scatterSubjectControls.categoryValueSelect;
const scatterSelectOnMapButton = scatterSubjectControls.selectOnMapButton;


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

// Floating legend elements




// Settings menu Data Sources section elements

// Color scaling radios

// Color picker elements

const setPaintSectionCollapsed = createCollapseToggle({
  contentEl: paintSectionContent,
  toggleEl: paintSectionToggle,
  label: 'Paint',
  setState: (c) => { S.isPaintCollapsed = c; },
  refresh: () => refreshWindowMinHeight(controlsEl),
});

setPaintSectionCollapsed(S.isPaintCollapsed);
paintSectionToggle.addEventListener('click', () => {
  setPaintSectionCollapsed(!S.isPaintCollapsed);
});

// "3D" section: collapsible like Paint (independent of the Enable 3D toggle,
// which controls whether the section is shown at all — see update3DUI).
const setThreeDSectionCollapsed = createCollapseToggle({
  contentEl: threeDSectionContent,
  toggleEl: threeDSectionToggle,
  label: '3D',
  setState: (c) => { S.is3DSectionCollapsed = c; },
  refresh: () => refreshWindowMinHeight(controlsEl),
});

setThreeDSectionCollapsed(S.is3DSectionCollapsed);
threeDSectionToggle.addEventListener('click', () => {
  setThreeDSectionCollapsed(!S.is3DSectionCollapsed);
});

const setFieldVisualizeCollapsed = createCollapseToggle({
  contentEl: fieldVisualizeBody,
  toggleEl: fieldVisualizeToggle,
  label: 'Field to visualize',
  refresh: () => refreshWindowMinHeight(controlsEl),
});

setFieldVisualizeCollapsed(false);
fieldVisualizeToggle.addEventListener('click', () => {
  setFieldVisualizeCollapsed(fieldVisualizeBody.style.display !== 'none');
});

const setStatsLayerCollapsed = createCollapseToggle({
  contentEl: statsLayerBody,
  toggleEl: statsLayerToggle,
  label: 'Layer',
  setState: (c) => { S.isStatsLayerCollapsed = c; },
  refresh: () => refreshWindowMinHeight(statisticsControlsEl),
});

const setStatsFieldCollapsed = createCollapseToggle({
  contentEl: statisticsSection,
  toggleEl: statsFieldToggle,
  label: 'Field',
  setState: (c) => { S.isStatsFieldCollapsed = c; },
  refresh: () => refreshWindowMinHeight(statisticsControlsEl),
});

const setStatsSummaryCollapsed = createCollapseToggle({
  contentEl: statsSummaryBody,
  toggleEl: statsSummaryToggle,
  label: 'Statistics',
  display: 'block',
  setState: (c) => { S.isStatsSummaryCollapsed = c; },
  refresh: () => refreshWindowMinHeight(statisticsControlsEl),
});

const setStatsPercentilesCollapsed = createCollapseToggle({
  contentEl: statsPercentilesBody,
  toggleEl: statsPercentilesToggle,
  label: 'Percentiles',
  display: 'block',
  setState: (c) => { S.isStatsPercentilesCollapsed = c; },
  refresh: () => refreshWindowMinHeight(statisticsControlsEl),
});

const setStatsHistogramCollapsed = createCollapseToggle({
  contentEl: statsHistogramBody,
  toggleEl: statsHistogramToggle,
  label: 'Histogram',
  display: 'block',
  setState: (c) => { S.isStatsHistogramCollapsed = c; },
  refresh: () => refreshWindowMinHeight(statisticsControlsEl),
});

setStatsLayerCollapsed(S.isStatsLayerCollapsed);
setStatsFieldCollapsed(S.isStatsFieldCollapsed);
setStatsSummaryCollapsed(S.isStatsSummaryCollapsed);
setStatsPercentilesCollapsed(S.isStatsPercentilesCollapsed);
setStatsHistogramCollapsed(S.isStatsHistogramCollapsed);

statsLayerToggle.addEventListener('click', () => {
  setStatsLayerCollapsed(!S.isStatsLayerCollapsed);
});

statsFieldToggle.addEventListener('click', () => {
  setStatsFieldCollapsed(!S.isStatsFieldCollapsed);
});

statsSummaryToggle.addEventListener('click', () => {
  setStatsSummaryCollapsed(!S.isStatsSummaryCollapsed);
});

statsPercentilesToggle.addEventListener('click', () => {
  setStatsPercentilesCollapsed(!S.isStatsPercentilesCollapsed);
});

statsHistogramToggle.addEventListener('click', () => {
  setStatsHistogramCollapsed(!S.isStatsHistogramCollapsed);
});

const setLandScheduleTablesCollapsed = createCollapseToggle({
  contentEl: landScheduleTablesContent,
  toggleEl: landScheduleTablesToggle,
  label: 'Land tables',
  setState: (c) => { S.isLandScheduleTablesCollapsed = c; },
  refresh: () => refreshWindowMinHeight(landScheduleControlsEl),
});

const setLandScheduleCurveCollapsed = createCollapseToggle({
  contentEl: landScheduleCurveContent,
  toggleEl: landScheduleCurveToggle,
  label: 'Curve',
  display: 'block',
  setState: (c) => { S.isLandScheduleCurveCollapsed = c; },
  refresh: () => refreshWindowMinHeight(landScheduleControlsEl),
});

const setLandScheduleAdjustmentsCollapsed = createCollapseToggle({
  contentEl: landScheduleAdjustmentsContent,
  toggleEl: landScheduleAdjustmentsToggle,
  label: 'Adjustments',
  setState: (c) => { S.isLandScheduleAdjustmentsCollapsed = c; },
  refresh: () => { refreshWindowMinWidth(landScheduleControlsEl); refreshWindowMinHeight(landScheduleControlsEl); },
});

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

// Time Adjustment collapse toggles
const setTimeAdjustmentTrendCollapsed = createCollapseToggle({
  contentEl: timeAdjustmentTrendBody,
  toggleEl: timeAdjustmentTrendToggle,
  label: 'Trend',
  display: 'class',
  setState: (c) => { S.isTimeAdjustmentTrendCollapsed = c; },
  refresh: () => refreshWindowMinHeight(timeAdjustmentControlsEl),
});

const setTimeAdjustmentFiltersCollapsed = createCollapseToggle({
  contentEl: timeAdjustmentFiltersBody,
  toggleEl: timeAdjustmentFiltersToggle,
  label: 'Filters',
  display: 'class',
  setState: (c) => { S.isTimeAdjustmentFiltersCollapsed = c; },
  refresh: () => refreshWindowMinHeight(timeAdjustmentControlsEl),
});

setTimeAdjustmentTrendCollapsed(S.isTimeAdjustmentTrendCollapsed);
setTimeAdjustmentFiltersCollapsed(S.isTimeAdjustmentFiltersCollapsed);

timeAdjustmentTrendToggle.addEventListener('click', () => {
  setTimeAdjustmentTrendCollapsed(!S.isTimeAdjustmentTrendCollapsed);
});

timeAdjustmentFiltersToggle.addEventListener('click', () => {
  setTimeAdjustmentFiltersCollapsed(!S.isTimeAdjustmentFiltersCollapsed);
});

const setCompFinderCriteriaCollapsed = createCollapseToggle({
  contentEl: compFinderCriteriaBody,
  toggleEl: compFinderCriteriaToggle,
  label: 'Criteria',
  setState: (c) => { S.isCompFinderCriteriaCollapsed = c; },
  refresh: () => refreshWindowMinHeight(compFinderControlsEl),
});

const setCompFinderCompsCollapsed = createCollapseToggle({
  contentEl: compFinderCompsBody,
  toggleEl: compFinderCompsToggle,
  label: 'Comps',
  setState: (c) => { S.isCompFinderCompsCollapsed = c; },
  refresh: () => refreshWindowMinHeight(compFinderControlsEl),
});

setCompFinderCriteriaCollapsed(S.isCompFinderCriteriaCollapsed);
setCompFinderCompsCollapsed(S.isCompFinderCompsCollapsed);

compFinderCriteriaToggle.addEventListener('click', () => {
  setCompFinderCriteriaCollapsed(!S.isCompFinderCriteriaCollapsed);
});

compFinderCompsToggle.addEventListener('click', () => {
  setCompFinderCompsCollapsed(!S.isCompFinderCompsCollapsed);
});

// Color ramp choices
for (const key of Object.keys(COLOR_RAMPS)) {
  const opt = document.createElement('option'); opt.value = key; opt.textContent = key; rampSelect.appendChild(opt);
}
rampSelect.value = 'Magma';


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
    updateLegendPosition();
  },
  onShow: () => {
    S.isLegendVisible = true;
    // Override the default 'grid' — floating legend uses 'block'
    floatingLegend.style.display = 'block';
    updateFloatingLegend();
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

const compFinderWin = createWindowManager({
  getMinimized: () => S.isCompFinderMinimized,
  setMinimized: (v) => { S.isCompFinderMinimized = v; },
  contentEl: compFinderContent,
  controlsEl: compFinderControlsEl,
});

const inspectWin = createWindowManager({
  getMinimized: () => S.isInspectMinimized,
  setMinimized: (v) => { S.isInspectMinimized = v; },
  contentEl: inspectContent,
  controlsEl: inspectControlsEl,
  contentDisplay: 'block',
});

const writeWin = createWindowManager({
  getMinimized: () => S.isWriteMinimized,
  setMinimized: (v) => { S.isWriteMinimized = v; },
  contentEl: writeContent,
  controlsEl: writeControlsEl,
  contentDisplay: 'block',
  onShow: () => {
    resetWriteMenu();
  },
});

const export3DWin = createWindowManager({
  getMinimized: () => S.isExport3DMinimized,
  setMinimized: (v) => { S.isExport3DMinimized = v; },
  contentEl: export3DContent,
  controlsEl: export3DControlsEl,
  contentDisplay: 'block',
  onShow: () => { refreshExport3DMenu(); },
});

// Convenience aliases matching the old function names
const minimizeLayers = layersWin.minimize;
const showLayers = layersWin.show;
const minimizeSettingsMenu = settingsMenuWin.minimize;
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
const toggleLandSchedule = landScheduleWin.toggle;
const minimizeTimeAdjustment = timeAdjustmentWin.minimize;
const toggleTimeAdjustment = timeAdjustmentWin.toggle;
const minimizeCompFinder = () => {
  compFinderWin.minimize();
  setCompFinderMenuVisible(false);
};
const showCompFinder = () => {
  compFinderWin.show();
  setCompFinderMenuVisible(true);
};
const minimizeInspect = inspectWin.minimize;
const showInspect = inspectWin.show;
const minimizeWrite = writeWin.minimize;
const showWrite = writeWin.show;
const toggleWrite = writeWin.toggle;

// Wire callbacks and DOM elements into the windows module
initWindowCallbacks({
  updateToolbarButtonStates,
  onPinnedStateChanged: (element, pinned) => {
    if (element !== inspectControlsEl) return;
    if (pinned) {
      if (S.activePopup) {
        suppressPopupCloseClear = true;
        S.activePopup.remove();
        suppressPopupCloseClear = false;
        S.activePopup = null;
      }
      if (!S.isInspectMinimized) {
        renderInspectPinnedContent();
      }
      return;
    }
    if (S.lastPicked) {
      showPopupForLastPicked();
      minimizeInspect();
    } else {
      minimizeInspect();
    }
  },
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
  btnPinCompFinder,
  btnPinInspect,
  btnPinExport3D,
  btnPinWrite,
  btnPinLandSchedule,
  btnPinTimeAdjustment,
  btnPinLegend,
].forEach(initPinButton);
registerDockableWindow(controlsEl, btnPinLayers);
registerDockableWindow(settingsControlsEl, btnPinSettings);
registerDockableWindow(filtersControlsEl, btnPinFilters);
registerDockableWindow(statisticsControlsEl, btnPinStatistics);
registerDockableWindow(scatterplotControlsEl, btnPinScatterplot);
registerDockableWindow(compFinderControlsEl, btnPinCompFinder);
registerDockableWindow(inspectControlsEl, btnPinInspect);
registerDockableWindow(export3DControlsEl, btnPinExport3D);
registerDockableWindow(writeControlsEl, btnPinWrite);
registerDockableWindow(landScheduleControlsEl, btnPinLandSchedule);
registerDockableWindow(timeAdjustmentControlsEl, btnPinTimeAdjustment);
registerDockableWindow(floatingLegend, btnPinLegend);
enableWindowResizing(controlsEl);
enableWindowResizing(settingsControlsEl);
enableWindowResizing(filtersControlsEl);
enableWindowResizing(statisticsControlsEl);
enableWindowResizing(scatterplotControlsEl);
enableWindowResizing(compFinderControlsEl);
enableWindowResizing(inspectControlsEl);
enableWindowResizing(export3DControlsEl);
enableWindowResizing(writeControlsEl);
enableWindowResizing(landScheduleControlsEl);
enableWindowResizing(timeAdjustmentControlsEl);
enableWindowResizing(floatingLegend);

// Wire DOM elements and callbacks into the filters module
initFilterElements({
  filtersListEl,
  filtersInvertToggle,
  addFilterButton,
  filtersSavedContainer,
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
  // When filters change in hex mode, re-aggregate from the now-visible parcels.
  onFiltersChanged: () => { if (S.hexMode) startHexUpdateIfActive(); },
});

// Wire DOM elements and callbacks into the rendering module
initRenderingElements({
  fieldSelect,
  rampSelect,
  opacityInput,
  multInput,
  unitsSelect,
  hexResRow,
  threeDSection,
  enable3DRow,
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
  awaitFirstRenderedFeature,
  showPopup,
  buildPopupHTML,
  addPopupSearchFunctionality,
  addPopupEditFunctionality,
  refreshInspectView: () => {
    if (!S.lastPicked) {
      if (isInspectPinned() && !S.isInspectMinimized) {
        renderInspectPinnedContent();
      }
      return;
    }
    if (isInspectPinned()) {
      if (!S.isInspectMinimized) {
        renderInspectPinnedContent();
      }
      return;
    }
    showPopupForLastPicked();
  },
  updateCursor,
  isTextInputElement,
  activateTool: (tool: string) => activateTool(tool as 'pan' | 'info' | 'select' | 'comp-finder' | 'write'),
  setCompFinderSubject: (feature: GeoJSON.Feature, layerId: string) => setCompFinderSubject(feature, layerId),
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
  salePriceFieldSel: document.getElementById('salePriceField') as HTMLSelectElement,
  saleDateFieldSel: document.getElementById('saleDateField') as HTMLSelectElement,
  validSaleFieldSel: document.getElementById('validSaleField') as HTMLSelectElement,
  vacantSaleFieldSel: document.getElementById('vacantSaleField') as HTMLSelectElement,
  parcelIdFieldSel: document.getElementById('parcelIdField') as HTMLSelectElement,
  addressFieldSel: document.getElementById('addressField') as HTMLSelectElement,
  bldgQualityFieldSel: document.getElementById('bldgQualityField') as HTMLSelectElement,
  bldgConditionFieldSel: document.getElementById('bldgConditionField') as HTMLSelectElement,
  bldgAgeFieldSel: document.getElementById('bldgAgeField') as HTMLSelectElement,
  bldgEffAgeFieldSel: document.getElementById('bldgEffAgeField') as HTMLSelectElement,
  bldgBedsFieldSel: document.getElementById('bldgBedsField') as HTMLSelectElement,
  bldgBathsFieldSel: document.getElementById('bldgBathsField') as HTMLSelectElement,
  bldgTypeFieldSel: document.getElementById('bldgTypeField') as HTMLSelectElement,
  landTypeFieldSel: document.getElementById('landTypeField') as HTMLSelectElement,
  landZoningFieldSel: document.getElementById('landZoningField') as HTMLSelectElement,
  saleIdFieldSel: document.getElementById('saleIdField') as HTMLSelectElement,
  fullMarketValueFieldSel: document.getElementById('fullMarketValueField') as HTMLSelectElement,
  assessedValueFieldSel: document.getElementById('assessedValueField') as HTMLSelectElement,
  landValueFieldSel: document.getElementById('landValueField') as HTMLSelectElement,
  improvementValueFieldSel: document.getElementById('improvementValueField') as HTMLSelectElement,
  btnSizeBack: document.getElementById('btnSizeBack') as HTMLButtonElement,
  btnSizeSkip: document.getElementById('btnSizeSkip') as HTMLButtonElement,
  btnSizeOk: document.getElementById('btnSizeOk') as HTMLButtonElement,
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
  statsNormModeSelect,
  statsDetails,
  statsNumericBlock,
  statsCategoricalBlock,
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
  landScheduleTableSelect,
  landScheduleTableSelectRow,
  landScheduleAddTableButton,
  landScheduleTableContainer,
  landScheduleCurveSection,
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
  dataSourceSelect: document.getElementById('timeAdjustmentDataSource') as HTMLSelectElement,
  // Date range inputs
  startInput: document.getElementById('timeAdjustmentStart') as HTMLInputElement,
  valuationInput: document.getElementById('timeAdjustmentValuation') as HTMLInputElement,
  // Trend section
  trendToggle: document.getElementById('timeAdjustmentTrendToggle') as HTMLButtonElement,
  trendBody: document.getElementById('timeAdjustmentTrendBody') as HTMLDivElement,
  sampleCount: document.getElementById('timeAdjustmentSampleCount') as HTMLSpanElement,
  groupBySelect: document.getElementById('timeAdjustmentGroupBy') as HTMLSelectElement,
  chartGroupSelect: document.getElementById('timeAdjustmentChartGroup') as HTMLSelectElement,
  granularitySelect: document.getElementById('timeAdjustmentGranularity') as HTMLSelectElement,
  methodSelect: document.getElementById('timeAdjustmentMethod') as HTMLSelectElement,
  chartModeSelect: document.getElementById('timeAdjustmentChartMode') as HTMLSelectElement,
  chart: document.getElementById('timeAdjustmentChart') as HTMLDivElement,
  yAxisControl: document.getElementById('timeAdjustmentYAxisControl') as HTMLDivElement,
  yMaxInput: document.getElementById('timeAdjustmentYMaxInput') as HTMLInputElement,
  yMaxSlider: document.getElementById('timeAdjustmentYMaxSlider') as HTMLInputElement,
  spinner: document.getElementById('timeAdjustmentSpinner') as HTMLDivElement,
  chartMessage: document.getElementById('timeAdjustmentChartMessage') as HTMLDivElement,
  exportCsvButton: document.getElementById('timeAdjustmentExportCsv') as HTMLButtonElement,
  exportExcelButton: document.getElementById('timeAdjustmentExportExcel') as HTMLButtonElement,
  // Filters section
  filtersToggle: document.getElementById('timeAdjustmentFiltersToggle') as HTMLButtonElement,
  filtersBody: document.getElementById('timeAdjustmentFiltersBody') as HTMLDivElement,
  includeButton: document.getElementById('timeAdjustmentIncludeBtn') as HTMLButtonElement,
  excludeButton: document.getElementById('timeAdjustmentExcludeBtn') as HTMLButtonElement,
  priceLowInput: document.getElementById('timeAdjustmentPriceLow') as HTMLInputElement,
  priceHighInput: document.getElementById('timeAdjustmentPriceHigh') as HTMLInputElement,
  sizeLowInput: document.getElementById('timeAdjustmentSizeLow') as HTMLInputElement,
  sizeHighInput: document.getElementById('timeAdjustmentSizeHigh') as HTMLInputElement,
  ratioLowInput: document.getElementById('timeAdjustmentRatioLow') as HTMLInputElement,
  ratioHighInput: document.getElementById('timeAdjustmentRatioHigh') as HTMLInputElement,
  minSampleInput: document.getElementById('timeAdjustmentMinSample') as HTMLInputElement,
  sizeHeader: document.getElementById('timeAdjustmentSizeHeader') as HTMLTableCellElement,
  ratioHeader: document.getElementById('timeAdjustmentRatioHeader') as HTMLTableCellElement,
});

initCompFinderElements({
  panel: compFinderControlsEl,
  dataSourceSelect: compFinderDataSourceSelect,
  distanceEnabledInput: compFinderUseDistance,
  distanceInput: compFinderDistanceInput,
  distanceUnitsSelect: compFinderDistanceUnits,
  selectionEnabledInput: compFinderUseSelection,
  thresholdError: compFinderCriteriaThresholdError,
  criteriaWidgets: compFinderCriteriaWidgets,
  criteriaTableBody: compFinderCriteriaTableBody,
  addCriterionButton: compFinderAddCriterion,
  refreshButton: compFinderRefresh,
  dirtyIndicator: compFinderDirtyIndicator,
  noCompsIndicator: compFinderNoCompsIndicator,
  spinner: compFinderSpinner,
  resultsRow: compFinderResultsRow,
  resultsSummary: compFinderResultsSummary,
  pager: compFinderPager,
  emptyState: compFinderEmptyState,
  criteriaSection: compFinderCriteriaSection,
  compsSection: compFinderCompsSection,
  criteriaCompsDivider: compFinderCriteriaCompsDivider,
  compsTableHead: compFinderCompsTableHead,
  compsTableBody: compFinderCompsTableBody,
  compsTableContainer: compFinderCompsTableContainer,
  addFieldSelect: compFinderAddFieldSelect,
  addFieldButton: compFinderAddFieldButton,
  addFieldRow: compFinderAddFieldRow,
  zoomButton: compFinderZoomButton,
  exportCsvButton: compFinderExportCsv,
  exportExcelButton: compFinderExportExcel,
});
initCompFinderCallbacks({
  showCompFinderMenu: showCompFinder,
});
setCompFinderMenuVisible(!S.isCompFinderMinimized);

// Wire DOM elements and callbacks into the layers module
initLayerElements({
  layerList,
  dataStoreList,
  fieldSelect,
  rampSelect,
  opacityInput,
  opacityOut,
  normModeSelect,
  colorCont,
  colorQuant,
  colorModeSelect,
  colorPicker,
  enable3DCheckbox: enable3DCheckbox,
  enableHexCheckbox,
  hexResInput,
  hexResReadout,
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
  minimizeLegend();

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

  // Initial panel state is now established (Layers/Settings/Filters minimized,
  // welcome shown) — reveal the UI, ending the app-loading guard.
  document.body.classList.remove('app-loading');
}

export function revealUI() {
  document.body.classList.remove('app-loading');
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

/* ---------------- Settings menu Data Sources section ---------------- */
let pendingDeleteDataSourceId: string | null = null;

function setSettingsDataSourcesCollapsed(collapsed: boolean) {
  S.isSettingsDataSourcesCollapsed = collapsed;
  settingsDataSourcesList.style.display = collapsed ? 'none' : 'grid';
  settingsDataSourcesToggle.classList.toggle('is-collapsed', collapsed);
  // Arrow rotation is handled by CSS (.settings-data-sources-header.is-collapsed .toggle);
  // do not swap textContent (per AGENTS.md collapsible-section convention).
  refreshWindowMinHeight(settingsControlsEl);
}

function closeDependentPanelsForDataSourceChange() {
  minimizeLegend();
  minimizeFilters();
  minimizeStatistics();
  minimizeScatterplot();
  minimizeLandSchedule();
  minimizeTimeAdjustment();
  minimizeCompFinder();
}

function applyStoreClassificationToActiveState(storeId: string | null) {
  const store = storeId ? S.dataStores.get(storeId) ?? null : null;
  if (!store) return;
  S.currentDataStoreId = store.id;
  S.bldgSizeField = store.bldgSizeField;
  S.bldgSizeUnitLabel = store.bldgSizeUnitLabel;
  S.landSizeField = store.landSizeField;
  S.landSizeUnitLabel = store.landSizeUnitLabel;
  S.timeAdjustmentSettings.dataSourceId = store.id;
  S.timeAdjustmentSettings.salePriceField = store.salePriceField || '';
  S.timeAdjustmentSettings.saleDateField = store.saleDateField || '';
  S.timeAdjustmentSettings.validSaleField = store.validSaleField || '';
  S.timeAdjustmentSettings.vacantSaleField = store.vacantSaleField || '';
  S.timeAdjustmentSettings.improvedSizeField = store.bldgSizeField || '';
  S.timeAdjustmentSettings.landSizeField = store.landSizeField || '';
  S.parcelIdField = store.parcelIdField;
  S.addressField = store.addressField;
  S.bldgQualityField = store.bldgQualityField;
  S.bldgConditionField = store.bldgConditionField;
  S.bldgAgeField = store.bldgAgeField;
  S.bldgEffAgeField = store.bldgEffAgeField;
  S.bldgBedsField = store.bldgBedsField;
  S.bldgBathsField = store.bldgBathsField;
  S.bldgTypeField = store.bldgTypeField;
  S.landTypeField = store.landTypeField;
  S.landZoningField = store.landZoningField;
  S.saleIdField = store.saleIdField;
  S.fullMarketValueField = store.fullMarketValueField;
  S.assessedValueField = store.assessedValueField;
  S.landValueField = store.landValueField;
  S.improvementValueField = store.improvementValueField;
}

function getPrimaryOrActiveDataStoreId() {
  if (S.currentDataStoreId && S.dataStores.has(S.currentDataStoreId)) {
    return S.currentDataStoreId;
  }
  if (S.currentLayerId) {
    const layer = getCurrentLayer();
    if (layer && S.dataStores.has(layer.dataStoreId)) return layer.dataStoreId;
  }
  const fallback = S.dataStoreOrder.find(id => S.dataStores.has(id)) ?? null;
  console.warn('[DataSource] Ambiguous current source context; falling back to primary/active source.', {
    currentDataStoreId: S.currentDataStoreId,
    currentLayerId: S.currentLayerId,
    fallback,
  });
  return fallback;
}

function removeDataSourceAndDerivedArtifacts(storeId: string) {
  const store = S.dataStores.get(storeId);
  if (!store) return;

  const affectedLayerIds = S.layerOrder.filter(layerId => S.layers.get(layerId)?.dataStoreId === storeId);
  affectedLayerIds.forEach(layerId => removeLayer(layerId));

  // Time adjustment keeps a single live config (no per-source saved entries), so
  // there's nothing to prune here beyond resetting the active source below.
  if (S.timeAdjustmentSettings.dataSourceId === storeId) {
    S.timeAdjustmentSettings.dataSourceId = '';
    S.timeAdjustmentSettings.salePriceField = '';
    S.timeAdjustmentSettings.saleDateField = '';
    S.timeAdjustmentSettings.validSaleField = '';
    S.timeAdjustmentSettings.vacantSaleField = '';
    S.timeAdjustmentSettings.improvedSizeField = '';
    S.timeAdjustmentSettings.landSizeField = '';
  }

  S.dataStores.delete(storeId);
  const storeIndex = S.dataStoreOrder.indexOf(storeId);
  if (storeIndex >= 0) {
    S.dataStoreOrder.splice(storeIndex, 1);
  }

  const nextStoreId = getPrimaryOrActiveDataStoreId();
  if (nextStoreId) {
    applyStoreClassificationToActiveState(nextStoreId);
  } else {
    S.currentDataStoreId = null;
  }

  closeDependentPanelsForDataSourceChange();
  renderDataStoreList();
  renderLayerList();
  renderSettingsDataSourcesSection();
  refreshTimeAdjustmentPanel();
}

function openDeleteDataSourceConfirm(storeId: string) {
  const store = S.dataStores.get(storeId);
  if (!store) return;
  pendingDeleteDataSourceId = storeId;
  confirmDeleteDataSourceText.textContent = `Delete data source "${store.file?.name ?? store.name}" and all derived artifacts? This action cannot be undone.`;
  confirmDeleteDataSourceOverlay.classList.add('show');
}

function renderSettingsDataSourcesSection() {
  settingsDataSourcesList.replaceChildren();

  if (S.dataStoreOrder.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No data sources loaded yet.';
    settingsDataSourcesList.appendChild(empty);
    return;
  }

  S.dataStoreOrder.forEach(storeId => {
    const store = S.dataStores.get(storeId);
    if (!store) return;

    const row = document.createElement('div');
    row.className = 'settings-data-source-row';

    const sourceName = document.createElement('div');
    sourceName.className = 'settings-data-source-name';
    sourceName.title = store.file?.name ?? store.name;
    sourceName.textContent = store.file?.name ?? store.name;

    const classifyBtn = document.createElement('button');
    classifyBtn.type = 'button';
    classifyBtn.textContent = 'classify…';
    const hasSchema = (store.numericFieldsFromSchema.length + store.categoricalFieldsFromSchema.length) > 0;
    classifyBtn.disabled = !hasSchema;
    classifyBtn.title = hasSchema ? 'Reclassify key fields' : 'Load this source file first to classify fields';
    classifyBtn.addEventListener('click', () => {
      if (!hasSchema) return;
      S.currentDataStoreId = store.id;
      S.lastNumericFieldsFromSchema = [...store.numericFieldsFromSchema];
      S.lastCategoricalFieldsFromSchema = [...store.categoricalFieldsFromSchema];
      openSizeModal({
        dataStoreId: store.id,
        mode: 'reclassify',
        onSave: () => {
          applyStoreClassificationToActiveState(store.id);
          persistCurrentLayerState();
          refreshTimeAdjustmentPanel();
          renderSettingsDataSourcesSection();
        },
      });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'settings-data-source-delete';
    deleteBtn.title = 'Delete data source';
    deleteBtn.textContent = '❌';
    deleteBtn.addEventListener('click', () => openDeleteDataSourceConfirm(store.id));

    row.append(sourceName, classifyBtn, deleteBtn);
    settingsDataSourcesList.appendChild(row);
  });
}

settingsDataSourcesToggle.addEventListener('click', () => {
  setSettingsDataSourcesCollapsed(!S.isSettingsDataSourcesCollapsed);
});

btnCancelDeleteDataSource.addEventListener('click', () => {
  pendingDeleteDataSourceId = null;
  confirmDeleteDataSourceOverlay.classList.remove('show');
});

btnConfirmDeleteDataSource.addEventListener('click', () => {
  const storeId = pendingDeleteDataSourceId;
  pendingDeleteDataSourceId = null;
  confirmDeleteDataSourceOverlay.classList.remove('show');
  if (!storeId) return;
  removeDataSourceAndDerivedArtifacts(storeId);
});

setSettingsDataSourcesCollapsed(S.isSettingsDataSourcesCollapsed);
renderSettingsDataSourcesSection();
window.addEventListener('data-sources-changed', () => {
  renderSettingsDataSourcesSection();
});

/* ---------------- Load selected columns (+ geometry) ---------------- */
async function loadSelectedColumns() {
  if (!S.lastAsyncBuffer || !S.lastFile) return;
  showLoading('Reading geometry + selected fields…');
  const hadDataBeforeLoad = Boolean(S.currentGeoJSON?.features?.length);
  let shouldAutoZoomAfterLoad = false;

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
    renderSettingsDataSourcesSection();

    shouldAutoZoomAfterLoad = !hadDataBeforeLoad && S.currentGeoJSON.features.length > 0;
    persistCurrentLayerState();
  } catch (err: any) {
    console.error('GeoParquet load failed:', err);
    if (!S.cancelRequested) alert(`GeoParquet load failed: ${err?.message ?? err}`);
  } finally {
    hideLoading();
    if (shouldAutoZoomAfterLoad && S.currentGeoJSON) {
      requestAnimationFrame(() => fitToData(S.currentGeoJSON!));
    }
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

let suppressPopupCloseClear = false;

function isInspectPinned() {
  return inspectControlsEl.dataset.pinned === 'true';
}

function buildInspectEmptyHTML() {
  return '<div style="padding: 4px 2px; color:#6b7280; font-size: 12.5px;">select a parcel to inspect it</div>';
}

function removeInspectFocusMarker() {
  if (S.inspectFocusMarker) {
    S.inspectFocusMarker.remove();
    S.inspectFocusMarker = null;
  }
}

function createInspectFocusMarker() {
  const markerEl = document.createElement('div');
  markerEl.className = 'inspect-focus-marker';
  markerEl.style.width = '26px';
  markerEl.style.height = '26px';
  markerEl.style.transform = 'translate(-13px, -26px)';
  markerEl.style.setProperty('--c-outline2', '#ffffff');
  markerEl.style.setProperty('--c-outline1', '#000000');
  markerEl.style.setProperty('--c-middle', '#dc2626');
  markerEl.style.setProperty('--c-dot', '#000000');
  markerEl.innerHTML = PIN_SVG_RAW;
  return new maplibregl.Marker({ element: markerEl, anchor: 'bottom' });
}

function syncInspectFocusMarker() {
  removeInspectFocusMarker();
  if (!S.lastPicked) return;
  S.inspectFocusMarker = createInspectFocusMarker().setLngLat(S.lastPicked.lngLat).addTo(S.map);
}

function renderInspectPinnedContent() {
  if (!isInspectPinned()) return;
  if (!S.lastPicked) {
    inspectContent.innerHTML = buildInspectEmptyHTML();
    return;
  }
  inspectContent.innerHTML = buildPopupHTML(S.lastPicked.props, S.lastPicked.parcelId);
  addPopupSearchFunctionality();
  addPopupEditFunctionality(S.lastPicked.parcelId);
}

function clearInspectState() {
  if (S.activePopup) {
    suppressPopupCloseClear = true;
    S.activePopup.remove();
    suppressPopupCloseClear = false;
    S.activePopup = null;
  }
  S.lastPicked = null;
  removeInspectFocusMarker();
  if (isInspectPinned() && !S.isInspectMinimized) {
    renderInspectPinnedContent();
  }
}

function closeInspectMenu() {
  clearInspectState();
  minimizeInspect();
}

function showPopupForLastPicked() {
  if (!S.lastPicked || isInspectPinned()) return;

  if (S.activePopup) {
    suppressPopupCloseClear = true;
    S.activePopup.remove();
    suppressPopupCloseClear = false;
  }

  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: true,
    maxWidth: '460px'
  })
    .setLngLat(S.lastPicked.lngLat)
    .setHTML(buildPopupHTML(S.lastPicked.props, S.lastPicked.parcelId))
    .addTo(S.map);

  popup.on('close', () => {
    if (S.activePopup !== popup) return;
    S.activePopup = null;
    if (!suppressPopupCloseClear) {
      S.lastPicked = null;
      removeInspectFocusMarker();
      if (isInspectPinned() && !S.isInspectMinimized) {
        renderInspectPinnedContent();
      }
    }
  });

  S.activePopup = popup;
  addPopupSearchFunctionality();
  addPopupEditFunctionality(S.lastPicked.parcelId);
}

function showPopup(props: Record<string, any>, lngLat: maplibregl.LngLatLike, parcelId: string) {
  // Only show popup if info tool is active
  if (!S.isInfoToolActive) return;

  S.lastPicked = { props, lngLat, parcelId };
  syncInspectFocusMarker();

  if (isInspectPinned()) {
    showInspect();
    renderInspectPinnedContent();
    if (S.activePopup) {
      suppressPopupCloseClear = true;
      S.activePopup.remove();
      suppressPopupCloseClear = false;
      S.activePopup = null;
    }
    return;
  }

  showPopupForLastPicked();
  minimizeInspect();
}

function addPopupSearchFunctionality() {
  setTimeout(() => {
    const popupElement = isInspectPinned() ? inspectContent : S.activePopup?.getElement();
    if (popupElement) {
      const pinButton = popupElement.querySelector('.inspect-popup-pin-btn') as HTMLButtonElement | null;
      if (pinButton && pinButton.dataset.pinHandlerAttached !== 'true') {
        pinButton.dataset.pinHandlerAttached = 'true';
        pinButton.addEventListener('click', (event) => {
          event.preventDefault();
          showInspect();
          if (!isInspectPinned()) {
            btnPinInspect.click();
          }
          renderInspectPinnedContent();
          if (S.activePopup) {
            suppressPopupCloseClear = true;
            S.activePopup.remove();
            suppressPopupCloseClear = false;
            S.activePopup = null;
          }
        });
      }

      const closeButton = popupElement.querySelector('.inspect-popup-close-btn') as HTMLButtonElement | null;
      if (closeButton && closeButton.dataset.closeHandlerAttached !== 'true') {
        closeButton.dataset.closeHandlerAttached = 'true';
        closeButton.addEventListener('click', (event) => {
          event.preventDefault();
          closeInspectMenu();
        });
      }

      const searchInput = popupElement.querySelector('#popupSearch') as HTMLInputElement;
      const tableBody = popupElement.querySelector('#popupFieldsTable') as HTMLTableSectionElement;
      
      if (searchInput && tableBody) {
        const filterFields = (searchText: string) => {
          const rows = tableBody.querySelectorAll('tr');
          rows.forEach(row => {
            const fieldNameCell = row.querySelector('code');
            if (fieldNameCell) {
              const fieldName = fieldNameCell.textContent || '';
              const matches = fieldName.toLowerCase().startsWith(searchText.toLowerCase());
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

type WriteMode = 'constant' | 'equation' | 'revert';
type WriteOperand = { kind: 'field'; field: string } | { kind: 'constant'; valueType: 'numeric' | 'categorical'; value: string };

let writeSelectionCountTimer: number | null = null;
let writeBusy = false;
let writeCancelRequested = false;
let writeSafetyTimer: number | null = null;

const DATA_SOURCE_FIELDS_UPDATED_EVENT = 'data-source-fields-updated';

function getWriteDataStore() {
  const id = writeDataSource.value;
  return id ? (S.dataStores.get(id) ?? null) : null;
}

function getLayersForDataSource(dataStoreId: string) {
  return S.layerOrder.map(id => S.layers.get(id)).filter((layer): layer is NonNullable<typeof layer> => Boolean(layer && layer.dataStoreId === dataStoreId));
}

function getSelectedParcelIdsForDataSource(dataStoreId: string): Set<string> {
  const selected = new Set<string>();
  getLayersForDataSource(dataStoreId).forEach(layer => {
    layer.selectedParcels.forEach(parcelId => selected.add(parcelId));
  });
  return selected;
}

function getAllFieldsForStore(store: NonNullable<ReturnType<typeof getWriteDataStore>>) {
  return [...store.chosenNumericFields, ...store.chosenCategoricalFields]
    .filter((field, index, arr) => arr.indexOf(field) === index)
    .sort((a, b) => a.localeCompare(b));
}

function getFieldTypeFromStore(store: NonNullable<ReturnType<typeof getWriteDataStore>>, field: string): 'numeric' | 'categorical' {
  return store.chosenNumericFields.includes(field) ? 'numeric' : 'categorical';
}

function setWriteError(message: string) {
  writeError.textContent = message;
}

function setWriteStatus(message: string, isZero = false) {
  writeStatus.textContent = message;
  writeStatus.classList.toggle('is-zero', isZero);
}

function validateParquetFieldName(name: string) {
  if (!name.trim()) return 'Field name is required.';
  if (name.length > 100) return 'Field name must be 100 characters or fewer.';
  if (/\p{C}/u.test(name)) return 'Field name cannot include control characters.';
  return '';
}

function setWriteMenuDisabled(disabled: boolean) {
  const controls = writeControlsEl.querySelectorAll('select, input, button');
  controls.forEach((el) => {
    if ((el as HTMLElement).id === 'writeCancel') return;
    (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = disabled;
  });
  writeSpinner.style.display = disabled ? 'inline-block' : 'none';
  writeCancel.style.display = disabled ? 'inline-block' : 'none';
  writeBusy = disabled;
}

function updateWriteSelectionCount() {
  const store = getWriteDataStore();
  if (!store || writeApplyTo.value !== 'selection') {
    writeSelectionCount.textContent = '';
    return;
  }
  const count = getSelectedParcelIdsForDataSource(store.id).size;
  writeSelectionCount.textContent = `(${count.toLocaleString()})`;
}

function buildWriteOperandSelect(id: string, fields: string[]) {
  const select = document.createElement('select');
  select.id = id;
  select.innerHTML = `<option value="__constant__">Type a constant</option>${fields.map(field => `<option value="${escapeHtml(field)}">${escapeHtml(field)}</option>`).join('')}`;
  return select;
}

function renderWriteConstantUI() {
  writeConstantSection.replaceChildren();
  const store = getWriteDataStore();
  if (!store) return;
  const isCreate = writeFieldSelect.value === '__new__';
  const type = isCreate ? (writeNewFieldType.value as 'numeric' | 'categorical') : getFieldTypeFromStore(store, writeFieldSelect.value);

  const row = document.createElement('div');
  row.className = 'write-row';
  const inputType = type === 'numeric' ? 'number' : 'text';
  row.innerHTML = `<label for="writeConstantValue">New value</label><input id="writeConstantValue" type="${inputType}" ${type === 'numeric' ? 'step="any"' : ''} /><span>(${type})</span>`;
  writeConstantSection.appendChild(row);
}

function renderWriteEquationUI() {
  writeEquationSection.replaceChildren();
  const store = getWriteDataStore();
  if (!store) return;
  const fields = getAllFieldsForStore(store);
  const row = document.createElement('div');
  row.className = 'write-equation-row';
  const lhs = buildWriteOperandSelect('writeEquationLhs', fields);
  const rhs = buildWriteOperandSelect('writeEquationRhs', fields);
  const operator = document.createElement('select');
  operator.id = 'writeEquationOperator';
  ['+', '-', '×', '÷', '^'].forEach(op => {
    const option = document.createElement('option');
    option.value = op;
    option.textContent = op;
    operator.appendChild(option);
  });
  row.append(lhs, operator, rhs);
  writeEquationSection.appendChild(row);

  const constantTypeRow = document.createElement('div');
  constantTypeRow.className = 'write-equation-row';
  constantTypeRow.id = 'writeEquationConstantTypeRow';
  constantTypeRow.style.display = 'none';

  const lhsType = document.createElement('select');
  lhsType.id = 'writeEquationLhsConstantType';
  lhsType.innerHTML = '<option value="categorical">Categorical</option><option value="numeric">Numeric</option>';
  const rhsType = document.createElement('select');
  rhsType.id = 'writeEquationRhsConstantType';
  rhsType.innerHTML = '<option value="categorical">Categorical</option><option value="numeric">Numeric</option>';
  const typeSpacer = document.createElement('span');
  constantTypeRow.append(lhsType, typeSpacer, rhsType);
  writeEquationSection.appendChild(constantTypeRow);

  const constantValueRow = document.createElement('div');
  constantValueRow.className = 'write-equation-row';
  constantValueRow.id = 'writeEquationConstantValueRow';
  constantValueRow.style.display = 'none';
  const lhsValue = document.createElement('input');
  lhsValue.id = 'writeEquationLhsConstantValue';
  lhsValue.type = 'text';
  const rhsValue = document.createElement('input');
  rhsValue.id = 'writeEquationRhsConstantValue';
  rhsValue.type = 'text';
  const valueSpacer = document.createElement('span');
  constantValueRow.append(lhsValue, valueSpacer, rhsValue);
  writeEquationSection.appendChild(constantValueRow);

  const syncConstantWidgets = () => {
    const lhsIsConstant = lhs.value === '__constant__';
    const rhsIsConstant = rhs.value === '__constant__';
    constantTypeRow.style.display = lhsIsConstant || rhsIsConstant ? 'grid' : 'none';
    constantValueRow.style.display = lhsIsConstant || rhsIsConstant ? 'grid' : 'none';

    lhsType.style.visibility = lhsIsConstant ? 'visible' : 'hidden';
    lhsType.disabled = !lhsIsConstant;
    lhsValue.style.visibility = lhsIsConstant ? 'visible' : 'hidden';
    lhsValue.disabled = !lhsIsConstant;

    rhsType.style.visibility = rhsIsConstant ? 'visible' : 'hidden';
    rhsType.disabled = !rhsIsConstant;
    rhsValue.style.visibility = rhsIsConstant ? 'visible' : 'hidden';
    rhsValue.disabled = !rhsIsConstant;

    if (!lhsIsConstant) lhsValue.value = '';
    if (!rhsIsConstant) rhsValue.value = '';
  };

  const syncInputType = (side: 'lhs' | 'rhs') => {
    const typeSelect = side === 'lhs' ? lhsType : rhsType;
    const valueInput = side === 'lhs' ? lhsValue : rhsValue;
    valueInput.type = typeSelect.value === 'numeric' ? 'number' : 'text';
    valueInput.step = typeSelect.value === 'numeric' ? 'any' : '';
    valueInput.value = '';
  };

  lhs.addEventListener('change', syncConstantWidgets);
  rhs.addEventListener('change', syncConstantWidgets);
  lhsType.addEventListener('change', () => syncInputType('lhs'));
  rhsType.addEventListener('change', () => syncInputType('rhs'));
  syncConstantWidgets();

  const divisionRow = document.createElement('div');
  divisionRow.id = 'writeDivisionByZeroRow';
  divisionRow.className = 'write-row';
  divisionRow.style.display = 'none';
  divisionRow.innerHTML = '<label for="writeDivisionByZero">Divide by zero</label><select id="writeDivisionByZero"><option value="set-null">Set null</option><option value="skip">Skip parcel</option><option value="error">Fail operation</option></select><span></span>';
  writeEquationSection.appendChild(divisionRow);

  operator.addEventListener('change', () => {
    divisionRow.style.display = operator.value === '÷' ? 'grid' : 'none';
  });
}

function refreshWriteUI() {
  const store = getWriteDataStore();
  const hasStore = Boolean(store);
  writeApplyTo.disabled = !hasStore;
  writeFieldSelect.disabled = !hasStore;
  writeEditMode.disabled = !hasStore;
  if (!store) {
    writeFieldSelect.innerHTML = '<option value="">No fields</option>';
    writeConstantSection.replaceChildren();
    writeEquationSection.replaceChildren();
    return;
  }

  const fields = getAllFieldsForStore(store);
  const prevFieldValue = writeFieldSelect.value;
  writeFieldSelect.innerHTML = `<option value="__new__">(Create new field)</option>${fields.map(field => `<option value="${escapeHtml(field)}">${escapeHtml(field)}</option>`).join('')}`;
  if (prevFieldValue && (prevFieldValue === '__new__' || fields.includes(prevFieldValue))) {
    writeFieldSelect.value = prevFieldValue;
  }
  const currentMode = writeEditMode.value as WriteMode;
  const isCreate = writeFieldSelect.value === '__new__';
  writeNewFieldNameRow.style.display = isCreate ? 'grid' : 'none';
  writeNewFieldTypeRow.style.display = isCreate ? 'grid' : 'none';
  writeConstantSection.style.display = currentMode === 'constant' ? 'grid' : 'none';
  writeEquationSection.style.display = currentMode === 'equation' ? 'grid' : 'none';
  if (currentMode === 'constant') renderWriteConstantUI();
  if (currentMode === 'equation') renderWriteEquationUI();
  updateWriteSelectionCount();
}

function getOperandValue(operand: WriteOperand, props: Record<string, any>) {
  if (operand.kind === 'field') return props[operand.field];
  if (operand.valueType === 'numeric') return parseStrictNumber(operand.value) ?? Number.NaN;
  return String(operand.value);
}

function readEquationOperand(side: 'lhs' | 'rhs', fields: string[]): WriteOperand | null {
  const select = writeEquationSection.querySelector(`#writeEquation${side === 'lhs' ? 'Lhs' : 'Rhs'}`) as HTMLSelectElement | null;
  if (!select) return null;
  if (select.value !== '__constant__') {
    if (!fields.includes(select.value)) return null;
    return { kind: 'field', field: select.value };
  }
  const typeSelect = writeEquationSection.querySelector(`#writeEquation${side === 'lhs' ? 'Lhs' : 'Rhs'}ConstantType`) as HTMLSelectElement | null;
  const valueInput = writeEquationSection.querySelector(`#writeEquation${side === 'lhs' ? 'Lhs' : 'Rhs'}ConstantValue`) as HTMLInputElement | null;
  if (!typeSelect || !valueInput) return null;
  return { kind: 'constant', valueType: typeSelect.value as 'numeric' | 'categorical', value: valueInput.value };
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

function updateMapSourceDataForLayer(layerId: string) {
  const layer = S.layers.get(layerId);
  if (!layer || !layer.geojson) return;
  const source = S.map.getSource(layer.sourceId) as maplibregl.GeoJSONSource | undefined;
  if (source) source.setData(layer.geojson);
}

function dispatchDataSourceFieldsUpdated(dataStoreId: string, field: string, fieldType: 'numeric' | 'categorical') {
  window.dispatchEvent(new CustomEvent(DATA_SOURCE_FIELDS_UPDATED_EVENT, {
    detail: { dataStoreId, field, fieldType },
  }));
}

function refreshMenusBoundToDataSource(dataStoreId: string) {
  const hasAffectedLayer = S.layerOrder.some((layerId) => S.layers.get(layerId)?.dataStoreId === dataStoreId);
  if (!hasAffectedLayer) return;

  // Always refresh the Layers panel itself so all datasource-bound layers expose new fields immediately.
  renderLayerList();

  const currentLayer = getCurrentLayer();
  if (!currentLayer || currentLayer.dataStoreId !== dataStoreId) return;

  if (S.currentGeoJSON) {
    const allAvailableFields = [
      ...S.chosenNumericFields.filter((k) => S.currentGeoJSON?.features?.some((f) => f?.properties?.hasOwnProperty(k))),
      ...S.chosenCategoricalFields.filter((k) => S.currentGeoJSON?.features?.some((f) => f?.properties?.hasOwnProperty(k))),
    ];
    populateFieldDropdownFromList(allAvailableFields);
    fieldSelect.value = S.currentField ?? '';
  }

  renderDataStoreList();
  refreshFiltersUI();
  refreshStatisticsPanel();
  refreshScatterPanel();
  refreshLandSchedulePanel();
  refreshTimeAdjustmentPanel();
  renderStatsLayerOptions();
  renderScatterLayerOptions();
  if (S.isInspectMinimized || !S.lastPicked) return;
  if (isInspectPinned()) {
    renderInspectPinnedContent();
    return;
  }
  showPopupForLastPicked();
}

function setParcelPatchForLayer(layerId: string, parcelId: string, field: string, original: any, current: any, fieldType: 'numeric' | 'categorical') {
  const layer = S.layers.get(layerId);
  if (!layer) return;
  let parcelEntry = layer.parcelPatchMap.get(parcelId);
  if (!parcelEntry) {
    parcelEntry = new Map();
    layer.parcelPatchMap.set(parcelId, parcelEntry);
  }
  if (valuesEqualForField(fieldType, original, current)) {
    parcelEntry.delete(field);
    if (parcelEntry.size === 0) layer.parcelPatchMap.delete(parcelId);
    return;
  }
  parcelEntry.set(field, { original, current });
}

async function runWriteOperation() {
  setWriteError('');
  const store = getWriteDataStore();
  if (!store || !store.geojson) {
    setWriteError('Select a valid data source.');
    return;
  }
  const features = store.geojson.features;
  const fieldSelection = writeFieldSelect.value;
  const isCreateField = fieldSelection === '__new__';
  let targetField = fieldSelection;
  let targetFieldType: 'numeric' | 'categorical' = 'categorical';
  if (isCreateField) {
    const validationError = validateParquetFieldName(writeNewFieldName.value);
    if (validationError) {
      setWriteError(validationError);
      return;
    }
    targetField = writeNewFieldName.value;
    if (getAllFieldsForStore(store).includes(targetField)) {
      setWriteError('Field already exists in this data source.');
      return;
    }
    targetFieldType = writeNewFieldType.value as 'numeric' | 'categorical';
  } else {
    targetFieldType = getFieldTypeFromStore(store, targetField);
  }

  const selectedIds = getSelectedParcelIdsForDataSource(store.id);
  const targetParcelSet = writeApplyTo.value === 'selection' ? selectedIds : null;
  const mode = writeEditMode.value as WriteMode;
  const operator = (writeEquationSection.querySelector('#writeEquationOperator') as HTMLSelectElement | null)?.value;
  const divisionMode = (writeEquationSection.querySelector('#writeDivisionByZero') as HTMLSelectElement | null)?.value ?? 'set-null';

  let constantValue: any = null;
  if (mode === 'constant') {
    const input = writeConstantSection.querySelector('#writeConstantValue') as HTMLInputElement | null;
    const raw = input?.value ?? '';
    if (targetFieldType === 'numeric') {
      const parsed = parseStrictNumber(raw);
      if (parsed === null) {
        setWriteError('Enter a valid numeric constant (no scientific notation).');
        return;
      }
      constantValue = parsed;
    } else {
      constantValue = String(raw);
    }
  }

  const fields = getAllFieldsForStore(store);
  const lhs = mode === 'equation' ? readEquationOperand('lhs', fields) : null;
  const rhs = mode === 'equation' ? readEquationOperand('rhs', fields) : null;
  if (mode === 'equation' && (!lhs || !rhs || !operator)) {
    setWriteError('Equation is incomplete.');
    return;
  }
  if (mode === 'equation' && targetFieldType === 'categorical' && operator !== '+') {
    setWriteError('Categorical fields only support + for concatenation.');
    return;
  }

  setWriteMenuDisabled(true);
  writeCancelRequested = false;
  const startTime = Date.now();
  writeSafetyTimer = window.setTimeout(() => {
    writeCancelRequested = true;
    setWriteError('Write operation timed out and was canceled.');
  }, 20000);

  const stagedChanges: Array<{ feature: GeoJSON.Feature; parcelId: string; previous: any; next: any }> = [];
  const layerIds = getLayersForDataSource(store.id).map(layer => layer.id);

  for (let i = 0; i < features.length; i += 1) {
    if (writeCancelRequested || Date.now() - startTime > 20000) break;
    if (i % 400 === 0) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const feature = features[i];
    const props = (feature.properties ??= {} as Record<string, any>);
    const parcelId = getParcelId(feature as any);
    if (targetParcelSet && !targetParcelSet.has(parcelId)) continue;

    const hadTargetField = Object.prototype.hasOwnProperty.call(props, targetField);
    const previous = normalizeFieldValue(targetFieldType, props[targetField]);
    let next = previous;

    if (mode === 'constant') {
      next = normalizeFieldValue(targetFieldType, constantValue);
    } else if (mode === 'revert') {
      const layer = layerIds.length > 0 ? S.layers.get(layerIds[0]) : null;
      const patch = layer?.parcelPatchMap.get(parcelId)?.get(targetField);
      if (!patch) continue;
      next = patch.original;
    } else if (mode === 'equation' && lhs && rhs && operator) {
      const left = getOperandValue(lhs, props);
      const right = getOperandValue(rhs, props);
      if (targetFieldType === 'categorical') {
        next = `${left ?? ''}${right ?? ''}`;
      } else {
        const lNum = Number(left);
        const rNum = Number(right);
        if (!Number.isFinite(lNum) || !Number.isFinite(rNum)) continue;
        switch (operator) {
          case '+': next = lNum + rNum; break;
          case '-': next = lNum - rNum; break;
          case '×': next = lNum * rNum; break;
          case '÷':
            if (rNum === 0) {
              if (divisionMode === 'skip') continue;
              if (divisionMode === 'error') {
                setWriteError('Division by zero encountered.');
                writeCancelRequested = true;
                break;
              }
              next = null;
              break;
            }
            next = lNum / rNum;
            break;
          case '^': next = lNum ** rNum; break;
        }
      }
      if (writeCancelRequested) break;
    }

    const unchangedValue = valuesEqualForField(targetFieldType, previous, next);
    if (unchangedValue && (!isCreateField || hadTargetField)) continue;
    stagedChanges.push({ feature, parcelId, previous, next });
  }

  if (writeSafetyTimer) { clearTimeout(writeSafetyTimer); writeSafetyTimer = null; }
  setWriteMenuDisabled(false);
  if (writeCancelRequested) {
    if (!writeError.textContent) setWriteError('Write operation canceled. No changes applied.');
    return;
  }

  if (isCreateField) {
    if (targetFieldType === 'numeric') {
      if (!store.chosenNumericFields.includes(targetField)) store.chosenNumericFields.push(targetField);
    } else if (!store.chosenCategoricalFields.includes(targetField)) {
      store.chosenCategoricalFields.push(targetField);
    }
    getLayersForDataSource(store.id).forEach(layer => {
      if (targetFieldType === 'numeric' && !layer.chosenNumericFields.includes(targetField)) layer.chosenNumericFields.push(targetField);
      if (targetFieldType === 'categorical' && !layer.chosenCategoricalFields.includes(targetField)) layer.chosenCategoricalFields.push(targetField);
    });

    const activeLayer = getCurrentLayer();
    const activeStateBoundToStore = S.currentDataStoreId === store.id || activeLayer?.dataStoreId === store.id;
    if (activeStateBoundToStore) {
      if (targetFieldType === 'numeric' && !S.chosenNumericFields.includes(targetField)) S.chosenNumericFields.push(targetField);
      if (targetFieldType === 'categorical' && !S.chosenCategoricalFields.includes(targetField)) S.chosenCategoricalFields.push(targetField);
    }
  }

  stagedChanges.forEach(({ feature, parcelId, previous, next }) => {
    const props = (feature.properties ??= {} as Record<string, any>);
    props[targetField] = next;
    layerIds.forEach(layerId => {
      const layer = S.layers.get(layerId);
      if (!layer) return;
      const existingPatch = layer.parcelPatchMap.get(parcelId)?.get(targetField);
      const original = existingPatch ? existingPatch.original : previous;
      setParcelPatchForLayer(layerId, parcelId, targetField, original, next, targetFieldType);
    });
  });

  const changed = stagedChanges.length;

  layerIds.forEach(updateMapSourceDataForLayer);
  if (S.currentLayerId && layerIds.includes(S.currentLayerId)) {
    S.parcelPatchMap = S.layers.get(S.currentLayerId)?.parcelPatchMap ?? new Map();
    if (S.lastPicked) {
      const picked = findFeatureByParcelId(S.lastPicked.parcelId);
      if (picked?.properties) {
        S.lastPicked.props = { ...picked.properties };
      }
    }
  }

  if (isCreateField) {
    dispatchDataSourceFieldsUpdated(store.id, targetField, targetFieldType);
  }

  if (changed === 0) {
    setWriteStatus('0 parcels affected.', true);
  } else if (mode === 'revert') {
    setWriteStatus(`Reverted ${changed.toLocaleString()} parcels.`);
  } else {
    setWriteStatus(`Updated ${changed.toLocaleString()} parcels.`);
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
    const popupElement = isInspectPinned() ? inspectContent : S.activePopup?.getElement();
    if (!popupElement) return;
    const tableBody = popupElement.querySelector('#popupFieldsTable') as HTMLTableSectionElement | null;
    if (!tableBody || tableBody.dataset.editHandlersAttached === 'true') return;
    tableBody.dataset.editHandlersAttached = 'true';

    const updateRowChangedState = (row: HTMLTableRowElement, field: string, fieldType: 'numeric' | 'categorical') => {
      const changed = isFieldChanged(parcelId, field, fieldType);
      row.style.background = changed ? 'rgba(255, 0, 0, 0.08)' : '';
      const fieldCell = row.querySelector('code') as HTMLElement | null;
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

    const acceptInputValue = (row: HTMLTableRowElement, _field: string, fieldType: 'numeric' | 'categorical', input: HTMLInputElement) => {
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


function buildPopupHTML(props: Record<string, any>, parcelId: string): string {
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
        <td style="padding:2px 4px; text-align:left; white-space:nowrap; vertical-align:top;">
          <button type="button" class="popup-edit-btn" title="Edit value" style="background:none;border:none;cursor:pointer;font-size:12px;line-height:1;">✏️</button>
        </td>
        <td style="padding:2px 4px; text-align:left; white-space:nowrap; vertical-align:top;">
          <button type="button" class="popup-reset-btn" title="Reset to original" style="background:none;border:none;cursor:pointer;font-size:12px;line-height:1;${changed ? '' : 'display:none;'}">↩</button>
        </td>
        <td style="padding:2px 6px; overflow-wrap:anywhere; vertical-align:top;">
          <code style="white-space:normal;${nameStyle}">${escapeHtml(k)}</code>
        </td>
        <td style="padding:2px 6px; text-align:right; white-space:normal; overflow-wrap:anywhere;" data-value-cell>
          ${printable}
        </td>
      </tr>`;
  }).join('');

  const showInlinePin = !isInspectPinned();
  const popupContainerStyle = showInlinePin
    ? 'max-width:min(92vw, 460px); font-size:12.5px; line-height:1.35;'
    : 'max-width:none; width:100%; height:100%; display:flex; flex-direction:column; font-size:12.5px; line-height:1.35;';
  const popupScrollStyle = showInlinePin
    ? 'overflow-y:auto; max-height:400px;'
    : 'overflow-y:auto; max-height:none; flex:1; min-height:0;';

  return `
    <div class="gvw-pop" style="${popupContainerStyle}">
      ${showInlinePin ? `<div style="display:flex; align-items:center; justify-content:flex-end; gap:6px; margin-bottom:4px;">
        <button type="button" class="inspect-popup-pin-btn" title="Pin" style="border:none;background:none;cursor:pointer;padding:2px;width:20px;height:20px;border-radius:3px;display:flex;align-items:center;justify-content:center;"><img src="${PIN_ICON_TILTED}" alt="Pin menu" style="width:14px;height:14px;display:block;"></button>
        <button type="button" class="inspect-popup-close-btn" title="Close" style="border:none;background:none;cursor:pointer;font-size:14px;color:#666;padding:2px;width:20px;height:20px;border-radius:3px;display:flex;align-items:center;justify-content:center;">❌</button>
      </div>` : ''}
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <input type="text" id="popupSearch" placeholder="Search fields..." style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px;">
      </div>
      <div style="${popupScrollStyle}">
        <table style="width:100%; border-collapse:collapse; font-size:12px; table-layout:fixed;">
          <colgroup>
          <col span="1" style="width:8%">
          <col span="1" style="width:8%">
          <col span="1" style="width:44%">
          <col span="1" style="width:40%">
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
  // Show 3 decimals so the field stays compact (the raw value can run to ~15
  // digits). Guard tiny values so they don't round away to 0.
  const mult = Number(multiplier.toFixed(3)) || Number(multiplier.toPrecision(3));

  // Set the values
  multInput.value = String(mult);
  unitsSelect.value = unit;

  // Cache the settings
  S.cachedExtrusionSettings = { multiplier: mult, unit };
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
      dataStore.salePriceField = matchingPlaceholder.salePriceField;
      dataStore.saleDateField = matchingPlaceholder.saleDateField;
      dataStore.validSaleField = matchingPlaceholder.validSaleField;
      dataStore.vacantSaleField = matchingPlaceholder.vacantSaleField;

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
      S.timeAdjustmentSettings.salePriceField = dataStore.salePriceField || '';
      S.timeAdjustmentSettings.saleDateField = dataStore.saleDateField || '';
      S.timeAdjustmentSettings.validSaleField = dataStore.validSaleField || '';
      S.timeAdjustmentSettings.vacantSaleField = dataStore.vacantSaleField || '';

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
      // Normal flow: show wizard starting with key field classification
      if (S.lastNumericFieldsFromSchema.length > 0 || S.lastCategoricalFieldsFromSchema.length > 0) {
        // Store row count / geom col for later modals to reference
        (document.getElementById('rowCount') as HTMLElement).textContent = numRows.toLocaleString();
        (document.getElementById('geomCol') as HTMLElement).textContent = primaryGeom || '(unknown)';
        openSizeModal();
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
      if (colorModeSelect) colorModeSelect.value = S.colorMode;
      scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
      persistCurrentLayerState();
    }
  })
);

if (colorModeSelect) {
  colorModeSelect.addEventListener('change', () => {
    if (!S.currentGeoJSON) return;
    const next = colorModeSelect.value;
    const target = next === 'continuous' ? colorCont : colorQuant;
    if (target) {
      target.checked = true;
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

if (normModeSelect) {
  normModeSelect.addEventListener('change', () => {
    const next = normModeSelect.value as 'asis' | 'perLand' | 'perBuilding';
    if (next === 'perLand' && !S.landSizeField) {
      normModeSelect.value = S.normalizationMode;
      return;
    }
    if (next === 'perBuilding' && !S.bldgSizeField) {
      normModeSelect.value = S.normalizationMode;
      return;
    }

    S.normalizationMode = next;
    // Clear cached extrusion settings when normalization mode changes
    S.cachedExtrusionSettings = null;
    if (!S.currentGeoJSON || !S.currentField) return;
    // Re-aggregate (e.g. value/acre vs as-is) for the new mode, or recompute parcels.
    if (!startHexUpdateIfActive()) scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
    persistCurrentLayerState();
  });
}

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
        rampContainer.style.display = (S.categoricalColorMode === 'colorRamp' || S.currentFieldType !== 'categorical') ? '' : 'none';
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
btnMinimizeCompFinder.addEventListener('click', minimizeCompFinder);
btnMinimizeInspect.addEventListener('click', closeInspectMenu);
btnMinimizeWrite.addEventListener('click', () => {
  minimizeWrite();
  if (S.isWriteToolActive) activateTool('select');
});

function resetWriteMenu() {
  writeDataSource.replaceChildren();
  if (S.dataStoreOrder.length === 0) {
    const option = new Option('No data sources loaded', '');
    option.disabled = true;
    option.selected = true;
    writeDataSource.appendChild(option);
  } else {
    S.dataStoreOrder.forEach((storeId, index) => {
      const store = S.dataStores.get(storeId);
      if (!store) return;
      const option = new Option(store.file?.name ?? store.name, store.id);
      if ((S.currentDataStoreId && S.currentDataStoreId === store.id) || (!S.currentDataStoreId && index === 0)) {
        option.selected = true;
      }
      writeDataSource.appendChild(option);
    });
  }
  writeApplyTo.value = 'all';
  writeEditMode.value = 'constant';
  writeFieldSelect.value = '__new__';
  writeNewFieldName.value = '';
  writeNewFieldType.value = 'categorical';
  setWriteError('');
  setWriteStatus('');
  refreshWriteUI();
}

writeDataSource.addEventListener('change', () => {
  setWriteError('');
  refreshWriteUI();
});
writeApplyTo.addEventListener('change', updateWriteSelectionCount);
writeFieldSelect.addEventListener('change', refreshWriteUI);
writeNewFieldType.addEventListener('change', refreshWriteUI);
writeEditMode.addEventListener('change', refreshWriteUI);
writeSubmit.addEventListener('click', () => {
  if (writeBusy) return;
  void runWriteOperation();
});
writeCancel.addEventListener('click', () => {
  writeCancelRequested = true;
  setWriteError('Write operation canceled. No changes applied.');
});

window.addEventListener('data-sources-changed', () => {
  resetWriteMenu();
});

window.addEventListener(DATA_SOURCE_FIELDS_UPDATED_EVENT, (event) => {
  const detail = (event as CustomEvent<{ dataStoreId?: string }>).detail;
  const dataStoreId = detail?.dataStoreId;
  if (!dataStoreId) return;
  if (writeDataSource.value === dataStoreId) {
    refreshWriteUI();
  }
  refreshMenusBoundToDataSource(dataStoreId);
});

if (writeSelectionCountTimer) {
  window.clearInterval(writeSelectionCountTimer);
}
writeSelectionCountTimer = window.setInterval(() => {
  if (!S.isWriteMinimized) updateWriteSelectionCount();
}, 300);

resetWriteMenu();

landScheduleAddTableButton.addEventListener('click', () => {
  addLandScheduleTable();
  refreshWindowMinWidth(landScheduleControlsEl);
});

landScheduleAddAdjustmentButton.addEventListener('click', () => {
  addLandScheduleAdjustment();
  refreshWindowMinWidth(landScheduleControlsEl);
});

landScheduleTableSelect.addEventListener('change', () => {
  setActiveLandScheduleTable(landScheduleTableSelect.value || null);
  refreshWindowMinWidth(landScheduleControlsEl);
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


function replaceMapSelectionFromFeatures(features: GeoJSON.Feature[], contextLabel: string) {
  if (features.length === 0) {
    alert(`No parcels are currently resolved for ${contextLabel}.`);
    return;
  }
  clearAllSelections();
  features.forEach(feature => addParcelToSelection(feature));
}

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

statsLayerName.addEventListener('change', () => {
  const selectedLayerId = statsLayerName.value || null;
  if (selectedLayerId === S.statsLayerId) return;
  S.statsLayerId = selectedLayerId;
  renderStatsLayerOptions();
  refreshStatisticsPanel();
});

scatterLayerName.addEventListener('change', () => {
  const selectedLayerId = scatterLayerName.value || null;
  if (selectedLayerId === S.scatterLayerId) return;
  S.scatterLayerId = selectedLayerId;
  S.scatterRangeIsCustom = false;
  renderScatterLayerOptions();
  refreshScatterPanel();
});

statsCategoryFieldSelect.addEventListener('change', () => {
  S.statsCategoryField = statsCategoryFieldSelect.value || null;
  S.statsCategoryValueIndices = [];
  populateStatisticsCategoryValues(S.statsCategoryField);
  updateStatisticsSubjectControls();
  updateStatisticsSectionVisibility();
  if (S.statsField && (!S.statsCategoryField || S.statsCategoryValueIndices.length > 0)) {
    updateStatisticsResults();
  } else {
    resetStatisticsDisplay();
  }
});

statsCategoryValueSelect.addEventListener('change', () => {
  const selected = statsCategoryValueSelect.value || '';
  S.statsCategoryValueIndices = selected ? [selected] : [];
  updateStatisticsSectionVisibility();
  if ((!S.statsCategoryField || S.statsCategoryValueIndices.length > 0) && S.statsField) {
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
  const selected = scatterCategoryValueSelect.value || '';
  S.scatterCategoryValueIndices = selected ? [selected] : [];
  updateScatterSubjectControls();
  S.scatterRangeIsCustom = false;
  scheduleScatterPlotRefresh();
});

statsSelectOnMapButton.addEventListener('click', () => {
  replaceMapSelectionFromFeatures(getCurrentStatsSubjectSelection(), 'the Statistics Group selection');
});

scatterSelectOnMapButton.addEventListener('click', () => {
  replaceMapSelectionFromFeatures(getCurrentScatterSubjectSelection(), 'the Scatterplot Group selection');
});

scatterColorByFieldSelect.addEventListener('change', () => {
  S.scatterColorByField = scatterColorByFieldSelect.value || null;
  scheduleScatterPlotRefresh();
});

statsFieldSelect.addEventListener('change', () => {
  S.statsField = statsFieldSelect.value || null;
  const layer = getStatsLayer();
  const numericFields = layer?.chosenNumericFields ?? [];
  const categoricalFields = layer?.chosenCategoricalFields ?? [];
  S.statsFieldType = getStatsFieldType(S.statsField, numericFields, categoricalFields);
  updateStatisticsSectionVisibility();
  if (S.statsField) {
    updateStatisticsResults();
  } else {
    resetStatisticsDisplay();
  }
});

if (statsNormModeSelect) {
  statsNormModeSelect.addEventListener('change', () => {
    const next = statsNormModeSelect.value as 'asis' | 'perLand' | 'perBuilding';
    const perLandOpt = statsNormModeSelect.querySelector('option[value="perLand"]') as HTMLOptionElement | null;
    const perBldgOpt = statsNormModeSelect.querySelector('option[value="perBuilding"]') as HTMLOptionElement | null;
    if (next === 'perLand' && perLandOpt?.disabled) {
      statsNormModeSelect.value = S.statsNormalizationMode;
      return;
    }
    if (next === 'perBuilding' && perBldgOpt?.disabled) {
      statsNormModeSelect.value = S.statsNormalizationMode;
      return;
    }
    S.statsNormalizationMode = next;
    updateStatisticsResults();
  });
}

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
makeDraggable(compFinderControlsEl);
makeDraggable(inspectControlsEl);
makeDraggable(export3DControlsEl);
makeDraggable(writeControlsEl);
makeDraggable(landScheduleControlsEl);
makeDraggable(timeAdjustmentControlsEl);
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

  // Rebuild hexes for the new field (async), or restore parcels + recompute.
  if (!startHexUpdateIfActive()) scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
  persistCurrentLayerState();
  renderLayerList();
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
  
  // Apply the current visualization. In hex mode this kicks off an async build
  // (rendered when it completes); otherwise render parcels immediately.
  if (S.currentGeoJSON && S.currentField) {
    if (!startHexUpdateIfActive()) applyExtrusion();
  }
  persistCurrentLayerState();
});

// Hexagon-summary toggle: switch between per-parcel extrusion and an H3 hex summary.
enableHexCheckbox.addEventListener('change', () => {
  S.hexMode = enableHexCheckbox.checked;
  update3DUI(); // shows/hides the resolution slider row
  if (S.currentGeoJSON && S.currentField) {
    // Turning hex on starts an async build; turning it off restores parcels now.
    if (!startHexUpdateIfActive()) scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
  }
  persistCurrentLayerState();
});

// H3 resolution slider: live readout immediately; the worker client debounces
// and supersedes, so we can fire on every input tick.
hexResInput.addEventListener('input', () => {
  const res = Number(hexResInput.value);
  S.hexResolution = res;
  if (hexResReadout) hexResReadout.value = String(res);
  if (S.hexMode && S.currentGeoJSON && S.currentField) startHexUpdateIfActive();
  persistCurrentLayerState();
});

// "Export 3D Object File" button → open its floating menu (invoked only here).
initExport3DMenu();
btnExport3D.addEventListener('click', () => export3DWin.show());
btnMinimizeExport3D.addEventListener('click', () => export3DWin.minimize());

// Cancel button on the hex progress bar: abort the in-flight build and revert
// all controls to the settings that were active before the operation started
// (i.e. the config matching the view still on screen, kept via keep-last-good).
document.getElementById('hexProgressCancel')?.addEventListener('click', () => {
  cancelHexUpdate();
  const snap = getCommittedHexState();
  if (snap && S.hexGeoJSON) {
    // Revert to the previously-committed hex config (those hexes are still shown).
    S.hexMode = snap.hexMode;
    S.hexResolution = snap.hexResolution;
    S.currentField = snap.currentField;
    S.currentFieldType = snap.currentFieldType;
    S.normalizationMode = snap.normalizationMode;
    S.is3DMode = snap.is3DMode;

    enableHexCheckbox.checked = snap.hexMode;
    enable3DCheckbox.checked = snap.is3DMode;
    hexResInput.value = String(snap.hexResolution);
    if (hexResReadout) hexResReadout.value = String(snap.hexResolution);
    fieldSelect.value = snap.currentField ?? '';
    if (normModeSelect) normModeSelect.value = snap.normalizationMode;

    update3DUI();
    if (S.currentGeoJSON && S.currentField) applyExtrusion();
  } else {
    // No committed hexes (first build) — revert to parcels.
    S.hexMode = false;
    enableHexCheckbox.checked = false;
    update3DUI();
    if (S.currentGeoJSON && S.currentField) applyExtrusion();
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
  showCompFinderMenu: showCompFinder,
  setCompFinderToolActive: setCompFinderToolActive,
  toggleWriteMenu: toggleWrite,
  showWriteMenu: showWrite,
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
  registerSelectionControlsDocking: (panel, pinButton) => {
    initPinButton(pinButton);
    registerDockableWindow(panel, pinButton);
    enableWindowResizing(panel);
  },
  refreshSelectionControlsDockLayout: () => {
    window.dispatchEvent(new Event('resize'));
  },
  openSelectionConditionsFilters: () => {
    const layer = getCurrentLayer();
    if (!layer) return;
    setSelectionFiltersContext(layer.id, layer.name || layer.field || `layer ${S.layerOrder.indexOf(layer.id) + 1}`);
    showFilters();
  },
  ensureFloatingWindowVisible,
});
initSelectionElements();
