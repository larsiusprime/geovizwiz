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
import { fitBoundsInVisibleMapArea } from './map-viewport';
import { numOrNull } from './utils.number';
import {
  buildLayerVisibilityExpression,
  evaluateFilterExpression,
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
} from './types';
import {
  scatterLayerName,
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
} from './dom-refs';

/* ------------------------------------------------------------------ */
/*  DOM element references                                             */
/*                                                                     */
/*  Plain DOM refs are imported directly from dom-refs (above). Only   */
/*  the constructed subject-selector bundle is injected via            */
/*  initScatterplotElements, since main.ts builds and shares it.       */
/* ------------------------------------------------------------------ */

let scatterSubjectControls: SubjectSelectorControls;
let scatterCategoryFieldSelect: HTMLSelectElement;
let scatterCategoryValueSelect: HTMLSelectElement;

export function initScatterplotElements(els: {
  scatterSubjectControls: SubjectSelectorControls;
}) {
  scatterSubjectControls = els.scatterSubjectControls;
  scatterCategoryFieldSelect = els.scatterSubjectControls.categoryFieldSelect;
  scatterCategoryValueSelect = els.scatterSubjectControls.categoryValueSelect;
}

/* ------------------------------------------------------------------ */
/*  Cross-module dependencies — direct imports (formerly callback seams).  */
/*  Pure downstream getters into layers/selection, which don't import      */
/*  scatterplot, so these are cycle-free.                                  */
/* ------------------------------------------------------------------ */

import {
  getScatterLayer as _getScatterLayer,
  getScatterDataStore as _getScatterDataStore,
} from './layers';
import { getParcelId as _getParcelId } from './selection';

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
  const layer = _getScatterLayer();
  const geoJSON = layer?.geojson ?? null;
  const categoricalFields = layer?.chosenCategoricalFields ?? [];
  const available = populateCategoryFields(geoJSON, categoricalFields, scatterCategoryFieldSelect);

  if (S.scatterCategoryField && available.includes(S.scatterCategoryField)) {
    scatterCategoryFieldSelect.value = S.scatterCategoryField;
  } else {
    S.scatterCategoryField = null;
  }
}

export function populateScatterCategoryValues(field: string | null) {
  const layer = _getScatterLayer();
  const geoJSON = layer?.geojson ?? null;
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
  const hasLayerData = Boolean(layer?.geojson);
  if (!hasLayerData) {
    scatterSubjectControls.buttons.forEach(button => { button.disabled = true; });
    scatterSubjectControls.categoryControls.style.display = 'none';
    scatterCategoryFieldSelect.disabled = true;
    scatterCategoryValueSelect.disabled = true;
    return;
  }
  scatterSubjectControls.buttons.forEach(button => { button.disabled = false; });
  updateSubjectControls(
    scatterSubjectControls,
    S.scatterSubjectMode,
    true,
    !S.scatterCategoryField || scatterCategoryValueSelect.options.length > 1
  );
}

function updateScatterSubjectButtons() {
  updateSubjectButtons(scatterSubjectControls, S.scatterSubjectMode);
}

export function setScatterSubjectMode(mode: SubjectMode) {
  const allowedModes: SubjectMode[] = ['all', 'visible', 'selected', 'group'];
  S.scatterSubjectMode = allowedModes.includes(mode) ? mode : 'all';
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
  if (geometry.type === 'GeometryCollection') return null;

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
  if (S.ui.isScatterplotMinimized) {
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
  fitBoundsInVisibleMapArea(bounds, { inset: 24, maxZoom: 17 });
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
  _dataGeoJSON: GeoJSON.FeatureCollection | null,
  mode: SubjectMode,
  categoryField: string | null,
  categoryValueIndices: string[],
  categoryValueMap: Array<{ label: string; value: unknown }>
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
  if (mode === 'group') {
    if (!layerGeoJSON) return [];
    if (!categoryField) return layerGeoJSON.features;
    if (categoryValueIndices.length === 0) return [];
    const selected = categoryValueMap[Number(categoryValueIndices[0])];
    if (!selected) return [];
    return layerGeoJSON.features.filter(feature => {
      const value = (feature.properties as Record<string, unknown> | undefined)?.[categoryField];
      return value === selected.value;
    });
  }
  return layerGeoJSON?.features ?? [];
}


export function getCurrentScatterSubjectSelection(): GeoJSON.Feature[] {
  const layer = _getScatterLayer();
  const scatterStore = _getScatterDataStore();
  if (!layer || !layer.geojson || !scatterStore?.geojson) return [];
  return getScatterSubjectSelection(
    layer,
    layer.geojson,
    scatterStore.geojson,
    S.scatterSubjectMode,
    S.scatterCategoryField,
    S.scatterCategoryValueIndices,
    S.scatterCategoryValueMap
  );
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
  if (S.scatterSubjectMode === 'group' && S.scatterCategoryField && S.scatterCategoryValueIndices.length === 0) {
    resetScatterPlot('Choose value to render the scatterplot.');
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
    S.scatterCategoryValueMap
  );
  const xValues: number[] = [];
  const yValues: number[] = [];
  const pointData: ScatterPoint[] = [];
  const categoryLabels: string[] = [];
  const colorByField = S.scatterColorByField;
  selection.forEach(feature => {
    const props = (feature.properties as Record<string, unknown> | undefined) ?? {};
    const xVal = numOrNull(props[S.scatterXField ?? '']);
    const yVal = numOrNull(props[S.scatterYField ?? '']);
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
    if (S.ui.isScatterplotMinimized) return;
    updateScatterPlot();
  }, 250);
}

export function refreshScatterPanel() {
  renderScatterLayerOptions();
  populateScatterCategoryFields();
  populateScatterCategoryValues(S.scatterCategoryField);
  populateScatterFields();
  populateScatterColorByFields();
  const allowedModes: SubjectMode[] = ['all', 'visible', 'selected', 'group'];
  if (!allowedModes.includes(S.scatterSubjectMode)) {
    S.scatterSubjectMode = 'all';
  }
  updateScatterSubjectButtons();
  updateScatterSubjectControls();
  scheduleScatterPlotRefresh();
}

function resolveScatterLayerId(): string | null {
  if (S.scatterLayerId && S.layers.has(S.scatterLayerId)) {
    return S.scatterLayerId;
  }
  return S.currentLayerId ?? S.layerOrder[0] ?? null;
}

function getScatterLayerLabel(layerId: string | null): string {
  if (!layerId) return 'Select a layer to view the scatterplot.';
  const layer = S.layers.get(layerId);
  if (!layer) return 'Select a layer to view the scatterplot.';
  const index = S.layerOrder.indexOf(layerId);
  const baseName = layer.field ?? `layer ${index + 1}`;
  const store = S.dataStores.get(layer.dataStoreId);
  const sourceLabel = store?.file?.name ?? store?.name ?? 'Unknown source';
  return `${baseName} (${sourceLabel})`;
}

export function renderScatterLayerOptions() {
  if (!scatterLayerName) return;
  const nextLayerId = resolveScatterLayerId();
  S.scatterLayerId = nextLayerId;

  const previousValue = scatterLayerName.value;
  scatterLayerName.replaceChildren();

  if (!S.layerOrder.length) {
    const empty = new Option('Select a layer to view the scatterplot.', '');
    empty.disabled = true;
    empty.selected = true;
    scatterLayerName.appendChild(empty);
    scatterLayerName.disabled = true;
    return;
  }

  S.layerOrder.forEach((layerId, index) => {
    const label = getScatterLayerLabel(layerId) || `layer ${index + 1}`;
    scatterLayerName.appendChild(new Option(label, layerId));
  });

  scatterLayerName.disabled = false;
  const targetValue = nextLayerId && S.layers.has(nextLayerId) ? nextLayerId : previousValue;
  if (targetValue && S.layers.has(targetValue)) {
    scatterLayerName.value = targetValue;
    S.scatterLayerId = targetValue;
  }
}
