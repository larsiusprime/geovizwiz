/**
 * Statistics panel logic extracted from main.ts.
 *
 * All functions that compute descriptive statistics, render the histogram,
 * manage subject/category selection for the stats panel, and control the
 * normalization options live here.
 */
import { S } from './state';
import { fmt, percentile, numOrNull } from './utils.number';
import {
  buildLayerVisibilityExpression,
  evaluateFilterExpression,
} from './filters';
import type {
  SubjectMode,
  SubjectSelectorControls,
  SubjectSelectorOptions,
  LayerState,
  DataStore,
} from './types';

/* ------------------------------------------------------------------ */
/*  Shared helpers (used by both statistics and scatterplot modules)   */
/* ------------------------------------------------------------------ */

/**
 * Build a subject-mode selector UI (All / Visible / Selected)
 * inside the given container. Returns references to the created DOM elements.
 */
export function buildSubjectSelector(
  container: HTMLElement,
  options: SubjectSelectorOptions = {}
): SubjectSelectorControls {
  container.replaceChildren();
  const subjectBlock = document.createElement('div');
  subjectBlock.style.display = 'grid';
  subjectBlock.style.gap = '6px';

  const titleText = options.title !== undefined ? options.title : 'Subject:';
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
    { mode: 'selected', label: 'Selected' }
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
  container.append(subjectBlock, categoryControls);

  return { buttons, categoryControls, categoryFieldSelect, categoryValueSelect };
}

export function updateSubjectButtons(controls: SubjectSelectorControls, mode: SubjectMode) {
  controls.buttons.forEach(button => {
    button.classList.toggle('active', button.dataset.subjectMode === mode);
  });
}

export function updateSubjectControls(
  controls: SubjectSelectorControls,
  mode: SubjectMode,
  hasFieldOptions: boolean,
  hasFieldSelected: boolean
) {
  const isCategory = mode === 'category';
  controls.categoryControls.style.display = isCategory ? 'grid' : 'none';
  controls.categoryFieldSelect.disabled = !isCategory || !hasFieldOptions;
  controls.categoryValueSelect.disabled = !isCategory || !hasFieldSelected;
}

/**
 * Shared helper: populate a category-field <select> from a data-store's
 * categorical fields.  Returns the list of available categorical field names.
 */
export function populateCategoryFields(
  geoJSON: GeoJSON.FeatureCollection | null,
  categoricalFields: string[],
  select: HTMLSelectElement
): string[] {
  select.replaceChildren();
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  if (!geoJSON) {
    select.disabled = true;
    return [];
  }

  const available = categoricalFields.filter(k =>
    geoJSON.features?.some(f => f?.properties?.hasOwnProperty(k))
  );

  available.forEach(field => {
    select.appendChild(new Option(field, field));
  });

  select.disabled = available.length === 0;
  return available;
}

/**
 * Shared helper: populate a category-value multi-<select> from features
 * for a given categorical field.
 */
export function populateCategoryValues(
  geoJSON: GeoJSON.FeatureCollection | null,
  field: string | null,
  select: HTMLSelectElement,
  currentIndices: string[]
): { valueMap: Array<{ label: string; value: unknown }>; indices: string[] } {
  select.replaceChildren();
  const placeholder = new Option('Choose value(s)', '');
  placeholder.disabled = true;
  placeholder.selected = currentIndices.length === 0;
  select.appendChild(placeholder);

  if (!geoJSON || !field) {
    select.disabled = true;
    return { valueMap: [], indices: [] };
  }

  const rawMap = new Map<string, { label: string; value: unknown }>();
  geoJSON.features.forEach(feature => {
    const raw = (feature.properties as Record<string, unknown> | undefined)?.[field];
    if (raw === null || raw === undefined) return;
    const key = `${typeof raw}:${String(raw)}`;
    if (!rawMap.has(key)) {
      rawMap.set(key, { label: String(raw), value: raw });
    }
  });

  const valueMap = Array.from(rawMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  valueMap.forEach((entry, index) => {
    select.appendChild(new Option(entry.label, String(index)));
  });

  select.disabled = false;
  const validSelections = new Set(
    currentIndices.filter(index => valueMap[Number(index)])
  );
  const indices = Array.from(validSelections);
  Array.from(select.options).forEach(option => {
    option.selected = validSelections.has(option.value);
  });
  if (indices.length === 0) {
    placeholder.selected = true;
  }
  return { valueMap, indices };
}

/* ------------------------------------------------------------------ */
/*  DOM element references (set once via initStatisticsElements)       */
/* ------------------------------------------------------------------ */

let statsLayerName: HTMLSelectElement;
let statsSubjectControls: SubjectSelectorControls;
let statsCategoryFieldSelect: HTMLSelectElement;
let statsCategoryValueSelect: HTMLSelectElement;
let statsFieldSelect: HTMLSelectElement;
let statsDetails: HTMLDivElement;
let statsNumericBlock: HTMLDivElement;
let statsCategoricalBlock: HTMLDivElement;
let statsNormalizationControls: HTMLDivElement;
let statisticsSection: HTMLDivElement;
let statsParcelCount: HTMLSpanElement;
let statsMedian: HTMLSpanElement;
let statsMean: HTMLSpanElement;
let statsStdDev: HTMLSpanElement;
let statsCod: HTMLSpanElement;
let statsPercentiles: HTMLTableSectionElement;
let statsHistogram: HTMLDivElement;
let statsCategoricalParcelCount: HTMLSpanElement;
let statsCategoricalUniqueCount: HTMLSpanElement;
let statsCategoricalModalValue: HTMLSpanElement;
let statsCategoricalValues: HTMLTableSectionElement;
let statsNormAsIs: HTMLInputElement;
let statsNormLand: HTMLInputElement;
let statsNormBldg: HTMLInputElement;
let statsNormLandUnitEl: HTMLElement;
let statsNormBldgUnitEl: HTMLElement;
let statsOverflowMinPct: HTMLInputElement;
let statsOverflowMaxPct: HTMLInputElement;

export function initStatisticsElements(els: {
  statsLayerName: HTMLSelectElement;
  statsSubjectControls: SubjectSelectorControls;
  statsFieldSelect: HTMLSelectElement;
  statsDetails: HTMLDivElement;
  statsNumericBlock: HTMLDivElement;
  statsCategoricalBlock: HTMLDivElement;
  statsNormalizationControls: HTMLDivElement;
  statisticsSection: HTMLDivElement;
  statsParcelCount: HTMLSpanElement;
  statsMedian: HTMLSpanElement;
  statsMean: HTMLSpanElement;
  statsStdDev: HTMLSpanElement;
  statsCod: HTMLSpanElement;
  statsPercentiles: HTMLTableSectionElement;
  statsHistogram: HTMLDivElement;
  statsCategoricalParcelCount: HTMLSpanElement;
  statsCategoricalUniqueCount: HTMLSpanElement;
  statsCategoricalModalValue: HTMLSpanElement;
  statsCategoricalValues: HTMLTableSectionElement;
  statsNormAsIs: HTMLInputElement;
  statsNormLand: HTMLInputElement;
  statsNormBldg: HTMLInputElement;
  statsNormLandUnitEl: HTMLElement;
  statsNormBldgUnitEl: HTMLElement;
  statsOverflowMinPct: HTMLInputElement;
  statsOverflowMaxPct: HTMLInputElement;
}) {
  statsLayerName = els.statsLayerName;
  statsSubjectControls = els.statsSubjectControls;
  statsCategoryFieldSelect = els.statsSubjectControls.categoryFieldSelect;
  statsCategoryValueSelect = els.statsSubjectControls.categoryValueSelect;
  statsFieldSelect = els.statsFieldSelect;
  statsDetails = els.statsDetails;
  statsNumericBlock = els.statsNumericBlock;
  statsCategoricalBlock = els.statsCategoricalBlock;
  statsNormalizationControls = els.statsNormalizationControls;
  statisticsSection = els.statisticsSection;
  statsParcelCount = els.statsParcelCount;
  statsMedian = els.statsMedian;
  statsMean = els.statsMean;
  statsStdDev = els.statsStdDev;
  statsCod = els.statsCod;
  statsPercentiles = els.statsPercentiles;
  statsHistogram = els.statsHistogram;
  statsCategoricalParcelCount = els.statsCategoricalParcelCount;
  statsCategoricalUniqueCount = els.statsCategoricalUniqueCount;
  statsCategoricalModalValue = els.statsCategoricalModalValue;
  statsCategoricalValues = els.statsCategoricalValues;
  statsNormAsIs = els.statsNormAsIs;
  statsNormLand = els.statsNormLand;
  statsNormBldg = els.statsNormBldg;
  statsNormLandUnitEl = els.statsNormLandUnitEl;
  statsNormBldgUnitEl = els.statsNormBldgUnitEl;
  statsOverflowMinPct = els.statsOverflowMinPct;
  statsOverflowMaxPct = els.statsOverflowMaxPct;
}

/* ------------------------------------------------------------------ */
/*  Callbacks into main.ts (set once via initStatisticsCallbacks)      */
/* ------------------------------------------------------------------ */

let _getStatsLayer: () => LayerState | null;
let _getLayerDataStore: (layer: LayerState | null) => DataStore | null;
let _getLayerGeoJSON: (layer: LayerState | null) => GeoJSON.FeatureCollection | null;
let _getParcelId: (feature: GeoJSON.Feature) => string;

export function initStatisticsCallbacks(cbs: {
  getStatsLayer: () => LayerState | null;
  getLayerDataStore: (layer: LayerState | null) => DataStore | null;
  getLayerGeoJSON: (layer: LayerState | null) => GeoJSON.FeatureCollection | null;
  getParcelId: (feature: GeoJSON.Feature) => string;
}) {
  _getStatsLayer = cbs.getStatsLayer;
  _getLayerDataStore = cbs.getLayerDataStore;
  _getLayerGeoJSON = cbs.getLayerGeoJSON;
  _getParcelId = cbs.getParcelId;
}

/* ------------------------------------------------------------------ */
/*  Statistics functions                                               */
/* ------------------------------------------------------------------ */

export function resetStatisticsDisplay() {
  statsParcelCount.textContent = '\u2014';
  statsMedian.textContent = '\u2014';
  statsMean.textContent = '\u2014';
  statsStdDev.textContent = '\u2014';
  statsCod.textContent = '\u2014';
  statsPercentiles.replaceChildren();
  statsHistogram.replaceChildren();
  statsOverflowMinPct.disabled = true;
  statsOverflowMaxPct.disabled = true;
  statsCategoricalParcelCount.textContent = '\u2014';
  statsCategoricalUniqueCount.textContent = '\u2014';
  statsCategoricalModalValue.textContent = '\u2014';
  statsCategoricalValues.replaceChildren();
}

export function populateStatisticsCategoryFields() {
  const layer = _getStatsLayer();
  const dataStore = _getLayerDataStore(layer);
  const geoJSON = dataStore?.geojson ?? null;
  const categoricalFields = dataStore?.chosenCategoricalFields ?? [];
  const available = populateCategoryFields(geoJSON, categoricalFields, statsCategoryFieldSelect);

  if (S.statsCategoryField && available.includes(S.statsCategoryField)) {
    statsCategoryFieldSelect.value = S.statsCategoryField;
  } else {
    S.statsCategoryField = null;
  }
}

export function populateStatisticsCategoryValues(field: string | null) {
  const layer = _getStatsLayer();
  const dataStore = _getLayerDataStore(layer);
  const geoJSON = dataStore?.geojson ?? null;
  const result = populateCategoryValues(
    geoJSON,
    field,
    statsCategoryValueSelect,
    S.statsCategoryValueIndices
  );
  S.statsCategoryValueMap = result.valueMap;
  S.statsCategoryValueIndices = result.indices;
}

export function getStatsFieldType(field: string | null, numericFields: string[], categoricalFields: string[]) {
  if (!field) return null;
  if (numericFields.includes(field)) return 'numeric';
  if (categoricalFields.includes(field)) return 'categorical';
  return null;
}

export function populateStatisticsFields() {
  const layer = _getStatsLayer();
  const dataStore = _getLayerDataStore(layer);
  const useDataSource = S.statsSubjectMode === 'category';
  const sourceGeoJSON = useDataSource ? dataStore?.geojson ?? null : _getLayerGeoJSON(layer);
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

export function computeStatisticsValues(values: number[]) {
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

export function formatPercentValue(value: number) {
  const rounded = Math.round(value * 10) / 10;
  const decimals = Number.isInteger(rounded) ? 0 : 1;
  return `${rounded.toFixed(decimals)}%`;
}

export function parsePercentInputValue(raw: string) {
  const cleaned = raw.replace('%', '').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function setPercentInputValue(input: HTMLInputElement, value: number) {
  input.value = formatPercentValue(value);
}

export function getHistogramDomain(values: number[]) {
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function updateOverflowControls(values: number[]) {
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

export function renderStatisticsHistogram(values: number[]) {
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
    bin.title = `${fmt(rangeStart)}\u2013${fmt(rangeEnd)} (${count})`;
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

export function getStatsSourceContext() {
  const layer = _getStatsLayer();
  const dataStore = _getLayerDataStore(layer);
  return {
    layer,
    layerGeoJSON: _getLayerGeoJSON(layer),
    dataStore,
    dataGeoJSON: dataStore?.geojson ?? null
  };
}

export function getStatsNormalizationContext() {
  const { layer, dataStore } = getStatsSourceContext();
  const useDataSource = S.statsSubjectMode === 'category';
  return {
    landField: useDataSource ? dataStore?.landSizeField ?? null : layer?.landSizeField ?? null,
    landUnit: useDataSource ? dataStore?.landSizeUnitLabel ?? null : layer?.landSizeUnitLabel ?? null,
    bldgField: useDataSource ? dataStore?.bldgSizeField ?? null : layer?.bldgSizeField ?? null,
    bldgUnit: useDataSource ? dataStore?.bldgSizeUnitLabel ?? null : layer?.bldgSizeUnitLabel ?? null
  };
}

export function updateStatisticsNormalizationControls() {
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

export function getStatsSubjectSelection(
  mode: SubjectMode,
  categoryField: string | null,
  categoryValueIndices: string[],
  categoryValueMap: Array<{ label: string; value: unknown }>
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
  return layerGeoJSON?.features ?? [];
}

export function updateStatisticsResults() {
  const { layer, layerGeoJSON, dataGeoJSON, dataStore } = getStatsSourceContext();
  const useDataSource = S.statsSubjectMode === 'category';
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
    S.statsCategoryValueMap
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
    statsMedian.textContent = Number.isFinite(stats.median) ? fmt(stats.median) : '\u2014';
    statsMean.textContent = Number.isFinite(stats.mean) ? fmt(stats.mean) : '\u2014';
    statsStdDev.textContent = Number.isFinite(stats.stdDev) ? fmt(stats.stdDev) : '\u2014';
    statsCod.textContent = Number.isFinite(stats.cod) ? `${fmt(stats.cod)}%` : '\u2014';

    statsPercentiles.replaceChildren();
    const sortedValues = values.slice().sort((a, b) => a - b);
    percentileRows.forEach(item => {
      const row = document.createElement('tr');
      const labelCell = document.createElement('td');
      labelCell.textContent = item.label;
      const valueCell = document.createElement('td');
      valueCell.textContent = Number.isFinite(item.value) ? fmt(item.value) : '\u2014';
      const countCell = document.createElement('td');
      if (Number.isFinite(item.value)) {
        const cutoff = item.value;
        const count = sortedValues.filter(v => v <= cutoff).length;
        countCell.textContent = count.toLocaleString();
      } else {
        countCell.textContent = '\u2014';
      }
      row.append(labelCell, valueCell, countCell);
      statsPercentiles.appendChild(row);
    });

    renderStatisticsHistogram(values);
    return;
  }

  S.statsValuesCache = [];
  statsMedian.textContent = '\u2014';
  statsMean.textContent = '\u2014';
  statsStdDev.textContent = '\u2014';
  statsCod.textContent = '\u2014';
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
    statsCategoricalModalValue.textContent = '\u2014';
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

export function updateStatisticsSubjectControls() {
  const layer = _getStatsLayer();
  const hasLayerData = Boolean(layer?.geojson);
  if (!hasLayerData) {
    statsSubjectControls.buttons.forEach(button => { button.disabled = true; });
    statsSubjectControls.categoryControls.style.display = 'none';
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

export function setStatsSubjectMode(mode: SubjectMode) {
  const allowedModes: SubjectMode[] = ['all', 'visible', 'selected'];
  S.statsSubjectMode = allowedModes.includes(mode) ? mode : 'all';
  updateStatisticsSubjectButtons();
  updateStatisticsSubjectControls();
  updateStatisticsSectionVisibility();
  updateStatisticsResults();
}

export function updateStatisticsSectionVisibility() {
  populateStatisticsFields();
  const hasField = Boolean(S.statsField);
  statsDetails.style.display = hasField ? 'grid' : 'none';
  if (!hasField) {
    S.statsFieldType = null;
    statsNumericBlock.style.display = 'none';
    statsCategoricalBlock.style.display = 'none';
    return;
  }
  const layer = _getStatsLayer();
  const numericFields = layer?.chosenNumericFields ?? [];
  const categoricalFields = layer?.chosenCategoricalFields ?? [];
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

export function refreshStatisticsPanel() {
  populateStatisticsCategoryFields();
  populateStatisticsCategoryValues(S.statsCategoryField);

  const allowedModes: SubjectMode[] = ['all', 'visible', 'selected'];
  if (!allowedModes.includes(S.statsSubjectMode)) {
    S.statsSubjectMode = 'all';
  }
  updateStatisticsSubjectButtons();
  updateStatisticsSubjectControls();
  updateStatisticsSectionVisibility();

  if (S.statsField) {
    updateStatisticsResults();
  } else {
    resetStatisticsDisplay();
  }
}

function resolveStatsLayerId(): string | null {
  if (S.statsLayerId && S.layers.has(S.statsLayerId)) {
    return S.statsLayerId;
  }
  return S.currentLayerId ?? S.layerOrder[0] ?? null;
}

function getStatsLayerLabel(layerId: string | null): string {
  if (!layerId) return 'Select a layer to view statistics.';
  const layer = S.layers.get(layerId);
  if (!layer) return 'Select a layer to view statistics.';
  const index = S.layerOrder.indexOf(layerId);
  const baseName = layer.field ?? `layer ${index + 1}`;
  const store = S.dataStores.get(layer.dataStoreId);
  const sourceLabel = store?.file?.name ?? store?.name ?? 'Unknown source';
  return `${baseName} (${sourceLabel})`;
}

export function renderStatsLayerOptions() {
  if (!statsLayerName) return;
  const nextLayerId = resolveStatsLayerId();
  S.statsLayerId = nextLayerId;

  const previousValue = statsLayerName.value;
  statsLayerName.replaceChildren();

  if (!S.layerOrder.length) {
    const empty = new Option('Select a layer to view statistics.', '');
    empty.disabled = true;
    empty.selected = true;
    statsLayerName.appendChild(empty);
    statsLayerName.disabled = true;
    return;
  }

  S.layerOrder.forEach((layerId, index) => {
    const label = getStatsLayerLabel(layerId) || `layer ${index + 1}`;
    statsLayerName.appendChild(new Option(label, layerId));
  });

  statsLayerName.disabled = false;
  const targetValue = nextLayerId && S.layers.has(nextLayerId) ? nextLayerId : previousValue;
  if (targetValue && S.layers.has(targetValue)) {
    statsLayerName.value = targetValue;
    S.statsLayerId = targetValue;
  }
}
