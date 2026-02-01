/**
 * Scatterplot panel logic extracted from main.ts.
 *
 * All functions that populate scatter axis fields, manage subject/category
 * selection, compute range controls, and render the Plotly scatter chart
 * live here.
 */
import { S } from './state';
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
  S.scatterFilteredName = renderSubjectFilterOptions(scatterSubjectControls, S.scatterFilteredName);
  updateScatterSubjectButtons();
  updateScatterSubjectControls();
  scheduleScatterPlotRefresh();
}

export function renderScatterLayerOptions() {
  if (!scatterLayerSelect) return;
  S.scatterLayerId = _renderLayerSelectOptions(scatterLayerSelect, S.scatterLayerId, 'Choose a layer');
}
