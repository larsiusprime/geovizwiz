/**
 * Scatterplot panel logic extracted from main.ts.
 *
 * All functions that populate scatter axis fields, manage subject/category
 * selection, compute range controls, and render the Plotly scatter chart
 * live here.
 */
import maplibregl from 'maplibre-gl';
import { S } from './state';
import { generatePseudoRandomColor } from './rendering';
import { numOrNull } from './utils.number';
import {
  buildLayerVisibilityExpression,
  evaluateFilterExpression,
  buildSavedFilterExpression,
  renderSubjectFilterOptions,
} from './filters';
import {
  populateCategoryFields,
  populateCategoryValues,
  updateSubjectButtons,
  updateSubjectControls,
} from './statistics';
import type {
  SubjectMode,
  SubjectSelectorControls,
  LayerState,
  DataStore,
} from './types';

/* ------------------------------------------------------------------ */
/*  DOM element references (set once via initScatterplotElements)      */
/* ------------------------------------------------------------------ */

let scatterLayerSelect: HTMLSelectElement;
let scatterSubjectControls: SubjectSelectorControls;
let scatterCategoryFieldSelect: HTMLSelectElement;
let scatterCategoryValueSelect: HTMLSelectElement;
let scatterXFieldSelect: HTMLSelectElement;
let scatterYFieldSelect: HTMLSelectElement;
let scatterXMinInput: HTMLInputElement;
let scatterXMaxInput: HTMLInputElement;
let scatterYMinInput: HTMLInputElement;
let scatterYMaxInput: HTMLInputElement;
let scatterResetExtentsButton: HTMLButtonElement;
let scatterColorByFieldSelect: HTMLSelectElement;
let scatterSelectionControls: HTMLDivElement;
let scatterZoomToSelectionButton: HTMLButtonElement;
let scatterClearSelectionButton: HTMLButtonElement;
let scatterPlot: HTMLDivElement;
let scatterPlotEmpty: HTMLDivElement;

export function initScatterplotElements(els: {
  scatterLayerSelect: HTMLSelectElement;
  scatterSubjectControls: SubjectSelectorControls;
  scatterXFieldSelect: HTMLSelectElement;
  scatterYFieldSelect: HTMLSelectElement;
  scatterXMinInput: HTMLInputElement;
  scatterXMaxInput: HTMLInputElement;
  scatterYMinInput: HTMLInputElement;
  scatterYMaxInput: HTMLInputElement;
  scatterResetExtentsButton: HTMLButtonElement;
  scatterColorByFieldSelect: HTMLSelectElement;
  scatterSelectionControls: HTMLDivElement;
  scatterZoomToSelectionButton: HTMLButtonElement;
  scatterClearSelectionButton: HTMLButtonElement;
  scatterPlot: HTMLDivElement;
  scatterPlotEmpty: HTMLDivElement;
}) {
  scatterLayerSelect = els.scatterLayerSelect;
  scatterSubjectControls = els.scatterSubjectControls;
  scatterCategoryFieldSelect = els.scatterSubjectControls.categoryFieldSelect;
  scatterCategoryValueSelect = els.scatterSubjectControls.categoryValueSelect;
  scatterXFieldSelect = els.scatterXFieldSelect;
  scatterYFieldSelect = els.scatterYFieldSelect;
  scatterXMinInput = els.scatterXMinInput;
  scatterXMaxInput = els.scatterXMaxInput;
  scatterYMinInput = els.scatterYMinInput;
  scatterYMaxInput = els.scatterYMaxInput;
  scatterResetExtentsButton = els.scatterResetExtentsButton;
  scatterColorByFieldSelect = els.scatterColorByFieldSelect;
  scatterSelectionControls = els.scatterSelectionControls;
  scatterZoomToSelectionButton = els.scatterZoomToSelectionButton;
  scatterClearSelectionButton = els.scatterClearSelectionButton;
  scatterPlot = els.scatterPlot;
  scatterPlotEmpty = els.scatterPlotEmpty;
}

/* ------------------------------------------------------------------ */
/*  Callbacks into main.ts (set once via initScatterplotCallbacks)     */
/* ------------------------------------------------------------------ */

let _getScatterLayer: () => LayerState | null;
let _getScatterDataStore: () => DataStore | null;
let _getLayerDataStore: (layer: LayerState | null) => DataStore | null;
let _renderLayerSelectOptions: (
  select: HTMLSelectElement,
  selectedId: string | null,
  placeholderText: string
) => string | null;
let _getParcelId: (feature: GeoJSON.Feature) => string;

export function initScatterplotCallbacks(cbs: {
  getScatterLayer: () => LayerState | null;
  getScatterDataStore: () => DataStore | null;
  getLayerDataStore: (layer: LayerState | null) => DataStore | null;
  renderLayerSelectOptions: (
    select: HTMLSelectElement,
    selectedId: string | null,
    placeholderText: string
  ) => string | null;
  getParcelId: (feature: GeoJSON.Feature) => string;
}) {
  _getScatterLayer = cbs.getScatterLayer;
  _getScatterDataStore = cbs.getScatterDataStore;
  _getLayerDataStore = cbs.getLayerDataStore;
  _renderLayerSelectOptions = cbs.renderLayerSelectOptions;
  _getParcelId = cbs.getParcelId;
}

/* ------------------------------------------------------------------ */
/*  Scatterplot functions                                             */
/* ------------------------------------------------------------------ */

type ScatterPoint = {
  index: number;
  parcelId: string;
  coordinates: [number, number] | null;
  categoryValue: string | null;
};

const SCATTER_HOVER_SOURCE_ID = 'scatterplot-hover';
const SCATTER_SELECTED_SOURCE_ID = 'scatterplot-selected';
const SCATTER_HOVER_LAYER_ID = 'scatterplot-hover-layer';
const SCATTER_SELECTED_LAYER_ID = 'scatterplot-selected-layer';

let scatterPlotPoints: ScatterPoint[] = [];
let scatterPlotPointsByParcelId = new Map<string, ScatterPoint>();
let scatterPlotEventsBound = false;

export function populateScatterCategoryFields() {
  const scatterStore = _getScatterDataStore();
  const geoJSON = scatterStore?.geojson ?? null;
  const categoricalFields = scatterStore?.chosenCategoricalFields ?? [];
  const available = populateCategoryFields(geoJSON, categoricalFields, scatterCategoryFieldSelect);

  if (S.scatterCategoryField && available.includes(S.scatterCategoryField)) {
    scatterCategoryFieldSelect.value = S.scatterCategoryField;
  } else {
    S.scatterCategoryField = null;
  }
}

export function populateScatterCategoryValues(field: string | null) {
  const scatterStore = _getScatterDataStore();
  const geoJSON = scatterStore?.geojson ?? null;
  const result = populateCategoryValues(
    geoJSON,
    field,
    scatterCategoryValueSelect,
    S.scatterCategoryValueIndices
  );
  S.scatterCategoryValueMap = result.valueMap;
  S.scatterCategoryValueIndices = result.indices;
}

export function populateScatterFieldSelect(
  select: HTMLSelectElement,
  currentValue: string | null,
  availableNumeric: string[]
): string | null {
  select.replaceChildren();
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  const scatterStore = _getScatterDataStore();
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

export function populateScatterFields() {
  const scatterStore = _getScatterDataStore();
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

export function populateScatterColorByFields() {
  const scatterStore = _getScatterDataStore();
  const scatterGeoJSON = scatterStore?.geojson ?? null;
  scatterColorByFieldSelect.replaceChildren();
  scatterColorByFieldSelect.appendChild(new Option('None', ''));

  if (!scatterGeoJSON || !scatterStore) {
    S.scatterColorByField = null;
    scatterColorByFieldSelect.disabled = true;
    return;
  }

  const availableCategorical = scatterStore.chosenCategoricalFields.filter(k =>
    scatterGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );

  availableCategorical.forEach(field => {
    scatterColorByFieldSelect.appendChild(new Option(field, field));
  });

  scatterColorByFieldSelect.disabled = availableCategorical.length === 0;
  if (S.scatterColorByField && availableCategorical.includes(S.scatterColorByField)) {
    scatterColorByFieldSelect.value = S.scatterColorByField;
  } else {
    S.scatterColorByField = null;
    scatterColorByFieldSelect.value = '';
  }
}

export function updateScatterSubjectControls() {
  const layer = _getScatterLayer();
  const scatterStore = _getScatterDataStore();
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

export function setScatterSubjectMode(mode: SubjectMode) {
  S.scatterSubjectMode = mode;
  updateScatterSubjectButtons();
  updateScatterSubjectControls();
  S.scatterRangeIsCustom = false;
  scheduleScatterPlotRefresh();
}

function getPlotly(): any | null {
  return (window as any).Plotly ?? null;
}

export function parseScatterRangeInput(input: HTMLInputElement): number | null {
  const value = input.value.trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setScatterRangeInputs(range: { xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null }) {
  S.isUpdatingScatterRangeInputs = true;
  scatterXMinInput.value = range.xMin === null ? '' : String(range.xMin);
  scatterXMaxInput.value = range.xMax === null ? '' : String(range.xMax);
  scatterYMinInput.value = range.yMin === null ? '' : String(range.yMin);
  scatterYMaxInput.value = range.yMax === null ? '' : String(range.yMax);
  S.isUpdatingScatterRangeInputs = false;
}

export function setScatterRangeControlsEnabled(enabled: boolean) {
  scatterXMinInput.disabled = !enabled;
  scatterXMaxInput.disabled = !enabled;
  scatterYMinInput.disabled = !enabled;
  scatterYMaxInput.disabled = !enabled;
  scatterResetExtentsButton.disabled = !enabled;
}

export function clearScatterRangeControls() {
  setScatterRangeInputs({ xMin: null, xMax: null, yMin: null, yMax: null });
  S.scatterRangeIsCustom = false;
}

function updateScatterSelectionControls() {
  if (!scatterSelectionControls) return;
  const hasSelection = S.scatterSelectedParcelIds.size > 0;
  scatterSelectionControls.style.display = hasSelection ? 'flex' : 'none';
  if (scatterZoomToSelectionButton) {
    scatterZoomToSelectionButton.disabled = !hasSelection;
  }
  if (scatterClearSelectionButton) {
    scatterClearSelectionButton.disabled = !hasSelection;
  }
}

function getFeatureCenter(feature: GeoJSON.Feature): [number, number] | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const coords = geometry.coordinates as [number, number];
    return [coords[0], coords[1]];
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const walk = (coords: any) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords as [number, number];
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    } else {
      coords.forEach(walk);
    }
  };

  walk(geometry.coordinates);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    return null;
  }
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

function ensureScatterPinLayers() {
  if (!S.map || !S.map.isStyleLoaded()) return;
  if (!S.map.getSource(SCATTER_SELECTED_SOURCE_ID)) {
    S.map.addSource(SCATTER_SELECTED_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!S.map.getSource(SCATTER_HOVER_SOURCE_ID)) {
    S.map.addSource(SCATTER_HOVER_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!S.map.getLayer(SCATTER_SELECTED_LAYER_ID)) {
    S.map.addLayer({
      id: SCATTER_SELECTED_LAYER_ID,
      type: 'circle',
      source: SCATTER_SELECTED_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': '#22c55e',
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9
      }
    });
  }
  if (!S.map.getLayer(SCATTER_HOVER_LAYER_ID)) {
    S.map.addLayer({
      id: SCATTER_HOVER_LAYER_ID,
      type: 'circle',
      source: SCATTER_HOVER_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': '#f97316',
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.9
      }
    });
  }
}

function setScatterPinSourceData(sourceId: string, features: GeoJSON.Feature[]) {
  if (!S.map || !S.map.isStyleLoaded()) return;
  const source = S.map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  source.setData({
    type: 'FeatureCollection',
    features
  });
}

function updateScatterPinSources() {
  if (S.isScatterplotMinimized) {
    setScatterPinSourceData(SCATTER_SELECTED_SOURCE_ID, []);
    setScatterPinSourceData(SCATTER_HOVER_SOURCE_ID, []);
    return;
  }
  ensureScatterPinLayers();

  const selectedFeatures: GeoJSON.Feature[] = [];
  S.scatterSelectedParcelIds.forEach(parcelId => {
    const point = scatterPlotPointsByParcelId.get(parcelId);
    if (!point?.coordinates) return;
    selectedFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: point.coordinates },
      properties: { parcelId }
    });
  });

  const hoveredId = S.scatterHoveredParcelId;
  const hoveredPoint = hoveredId ? scatterPlotPointsByParcelId.get(hoveredId) : null;
  const hoverFeatures: GeoJSON.Feature[] = [];
  if (hoveredPoint?.coordinates && !S.scatterSelectedParcelIds.has(hoveredPoint.parcelId)) {
    hoverFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: hoveredPoint.coordinates },
      properties: { parcelId: hoveredPoint.parcelId }
    });
  }

  setScatterPinSourceData(SCATTER_SELECTED_SOURCE_ID, selectedFeatures);
  setScatterPinSourceData(SCATTER_HOVER_SOURCE_ID, hoverFeatures);
}

function updateScatterPlotSelectionDisplay() {
  updateScatterSelectionControls();
  updateScatterPinSources();
  const plotly = getPlotly();
  if (!plotly) return;
  const indices: number[] = [];
  S.scatterSelectedParcelIds.forEach(parcelId => {
    const point = scatterPlotPointsByParcelId.get(parcelId);
    if (point) indices.push(point.index);
  });
  if (scatterPlot && scatterPlotPoints.length > 0) {
    plotly.restyle(scatterPlot, { selectedpoints: [indices] });
  }
}

function syncScatterSelectionWithPlot() {
  const available = new Set(scatterPlotPoints.map(point => point.parcelId));
  for (const parcelId of Array.from(S.scatterSelectedParcelIds)) {
    if (!available.has(parcelId)) {
      S.scatterSelectedParcelIds.delete(parcelId);
    }
  }
  if (S.scatterHoveredParcelId && !available.has(S.scatterHoveredParcelId)) {
    S.scatterHoveredParcelId = null;
  }
}

export function clearScatterSelection() {
  S.scatterSelectedParcelIds.clear();
  updateScatterPlotSelectionDisplay();
}

export function clearScatterHover() {
  if (!S.scatterHoveredParcelId) return;
  S.scatterHoveredParcelId = null;
  updateScatterPinSources();
}

export function zoomToScatterSelection() {
  if (S.scatterSelectedParcelIds.size === 0) return;
  const coords: [number, number][] = [];
  S.scatterSelectedParcelIds.forEach(parcelId => {
    const point = scatterPlotPointsByParcelId.get(parcelId);
    if (point?.coordinates) coords.push(point.coordinates);
  });
  if (coords.length === 0) return;
  const bounds = coords.reduce(
    (acc, coord) => acc.extend(coord),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );
  S.map.fitBounds(bounds, { padding: 60, maxZoom: 17 });
}

export function initScatterplotMapLayers() {
  ensureScatterPinLayers();
  updateScatterPinSources();
}

export function resetScatterPlot(message: string) {
  scatterPlotEmpty.textContent = message;
  scatterPlotEmpty.style.display = 'block';
  setScatterRangeControlsEnabled(false);
  clearScatterRangeControls();
  const plotly = getPlotly();
  if (plotly) {
    plotly.purge(scatterPlot);
  }
  scatterPlot.innerHTML = '';
  scatterPlotEventsBound = false;
  scatterPlotPoints = [];
  scatterPlotPointsByParcelId.clear();
  clearScatterHover();
  clearScatterSelection();
}

function handleScatterPlotClick(event: any) {
  const pointIndex = event?.points?.[0]?.pointIndex as number | undefined;
  if (pointIndex === undefined) return;
  const point = scatterPlotPoints[pointIndex];
  if (!point) return;
  if (S.scatterSelectedParcelIds.has(point.parcelId)) {
    S.scatterSelectedParcelIds.delete(point.parcelId);
  } else {
    S.scatterSelectedParcelIds.clear();
    S.scatterSelectedParcelIds.add(point.parcelId);
  }
  updateScatterPlotSelectionDisplay();
}

function handleScatterPlotHover(event: any) {
  const pointIndex = event?.points?.[0]?.pointIndex as number | undefined;
  if (pointIndex === undefined) return;
  const point = scatterPlotPoints[pointIndex];
  if (!point) return;
  S.scatterHoveredParcelId = point.parcelId;
  updateScatterPinSources();
}

function handleScatterPlotUnhover() {
  clearScatterHover();
}

function attachScatterPlotEvents() {
  if (scatterPlotEventsBound) return;
  const plotly = getPlotly();
  if (!plotly || !scatterPlot) return;
  if (typeof (scatterPlot as any).on !== 'function') return;
  (scatterPlot as any).on('plotly_click', handleScatterPlotClick);
  (scatterPlot as any).on('plotly_deselect', clearScatterSelection);
  (scatterPlot as any).on('plotly_hover', handleScatterPlotHover);
  (scatterPlot as any).on('plotly_unhover', handleScatterPlotUnhover);
  scatterPlotEventsBound = true;
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
    return layerGeoJSON.features.filter(feature => layer.selectedParcels.has(_getParcelId(feature)));
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

export function updateScatterPlot() {
  const plotly = getPlotly();
  if (!plotly) {
    resetScatterPlot('Plotly is still loading. Please try again in a moment.');
    return;
  }
  const layer = _getScatterLayer();
  if (!layer) {
    resetScatterPlot('Select a layer to render the scatterplot.');
    return;
  }
  const scatterStore = _getScatterDataStore();
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
  const pointData: ScatterPoint[] = [];
  const categoryLabels: string[] = [];
  const colorByField = S.scatterColorByField;
  selection.forEach(feature => {
    const props = (feature.properties as Record<string, unknown> | undefined) ?? {};
    const xVal = numOrNull(props[S.scatterXField]);
    const yVal = numOrNull(props[S.scatterYField]);
    if (xVal === null || yVal === null) return;
    const index = xValues.length;
    xValues.push(xVal);
    yValues.push(yVal);
    const parcelId = _getParcelId(feature);
    const coordinates = getFeatureCenter(feature);
    const rawCategoryValue = colorByField ? props[colorByField] : null;
    const categoryLabel = colorByField
      ? (rawCategoryValue === null || rawCategoryValue === undefined || rawCategoryValue === '' ? 'Unknown' : String(rawCategoryValue))
      : null;
    if (categoryLabel) {
      categoryLabels.push(categoryLabel);
    }
    pointData.push({
      index,
      parcelId,
      coordinates,
      categoryValue: categoryLabel,
    });
  });

  if (xValues.length === 0) {
    resetScatterPlot('No data available for the current selection.');
    return;
  }

  scatterPlotPoints = pointData;
  scatterPlotPointsByParcelId = new Map(
    pointData.map(point => [point.parcelId, point])
  );
  syncScatterSelectionWithPlot();

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
  const selectedPoints: number[] = [];
  S.scatterSelectedParcelIds.forEach(parcelId => {
    const point = scatterPlotPointsByParcelId.get(parcelId);
    if (point) selectedPoints.push(point.index);
  });
  let markerColor: string | string[] = 'rgba(59, 130, 246, 0.7)';
  let customdata: (string | null)[] | undefined;
  let hoverTemplate = 'X: %{x}<br>Y: %{y}<extra></extra>';
  if (colorByField) {
    const uniqueCategories = Array.from(new Set(categoryLabels)).sort();
    const categoryColorMap = new Map<string, string>();
    const total = Math.max(1, uniqueCategories.length);
    uniqueCategories.forEach((category, idx) => {
      categoryColorMap.set(category, generatePseudoRandomColor(idx, total, 'scatterplot-color'));
    });
    const colors = pointData.map(point => {
      const key = point.categoryValue ?? 'Unknown';
      return categoryColorMap.get(key) ?? 'rgba(148, 163, 184, 0.8)';
    });
    markerColor = colors;
    customdata = pointData.map(point => point.categoryValue ?? 'Unknown');
    hoverTemplate = `X: %{x}<br>Y: %{y}<br>${colorByField}: %{customdata}<extra></extra>`;
  }
  const trace = {
    x: xValues,
    y: yValues,
    type: 'scatter',
    mode: 'markers',
    marker: { size: 6, color: markerColor },
    customdata,
    hovertemplate: hoverTemplate,
    selectedpoints: selectedPoints,
    selected: { marker: { size: 8, opacity: 1, line: { color: '#0f172a', width: 1 } } },
    unselected: { marker: { opacity: 0.55 } }
  };
  const layout = {
    margin: { l: 48, r: 16, t: 8, b: 42 },
    height: 220,
    dragmode: false,
    hovermode: 'closest',
    xaxis: { title: S.scatterXField, range: [Math.min(xMin, xMax), Math.max(xMin, xMax)] },
    yaxis: { title: S.scatterYField, range: [Math.min(yMin, yMax), Math.max(yMin, yMax)] }
  };
  const config = { displayModeBar: false, responsive: true, staticPlot: false };
  plotly.react(scatterPlot, [trace], layout, config);
  attachScatterPlotEvents();
  updateScatterPlotSelectionDisplay();
}

export function scheduleScatterPlotRefresh() {
  if (S.scatterPlotRefreshTimer !== null) {
    window.clearTimeout(S.scatterPlotRefreshTimer);
  }
  S.scatterPlotRefreshTimer = window.setTimeout(() => {
    S.scatterPlotRefreshTimer = null;
    if (S.isScatterplotMinimized) return;
    updateScatterPlot();
  }, 250);
}

export function refreshScatterPanel() {
  renderScatterLayerOptions();
  populateScatterCategoryFields();
  populateScatterCategoryValues(S.scatterCategoryField);
  populateScatterFields();
  populateScatterColorByFields();
  S.scatterFilteredName = renderSubjectFilterOptions(scatterSubjectControls, S.scatterFilteredName);
  updateScatterSubjectButtons();
  updateScatterSubjectControls();
  scheduleScatterPlotRefresh();
}

export function renderScatterLayerOptions() {
  if (!scatterLayerSelect) return;
  S.scatterLayerId = _renderLayerSelectOptions(scatterLayerSelect, S.scatterLayerId, 'Choose a layer');
}
