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
    { mode: 'selected', label: 'Selected' },
    { mode: 'group', label: 'Group...' }
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
  categoryControls.style.gap = '8px';
  categoryControls.style.marginTop = '8px';
  categoryControls.style.gridTemplateColumns = 'minmax(0, 1fr) minmax(0, 1fr)';

  const categoryFieldSelect = document.createElement('select');
  categoryFieldSelect.className = 'layer-source-name';
  const fieldPlaceholder = new Option('Everything', '');
  fieldPlaceholder.selected = true;
  categoryFieldSelect.appendChild(fieldPlaceholder);

  const categoryValueSelect = document.createElement('select');
  categoryValueSelect.className = 'layer-source-name';
  categoryValueSelect.disabled = true;
  const valuePlaceholder = new Option('Choose value', '');
  valuePlaceholder.disabled = true;
  valuePlaceholder.selected = true;
  categoryValueSelect.appendChild(valuePlaceholder);

  const selectOnMapButton = document.createElement('button');
  selectOnMapButton.type = 'button';
  selectOnMapButton.textContent = 'Select on map';
  selectOnMapButton.style.gridColumn = '2';
  selectOnMapButton.style.justifySelf = 'stretch';

  categoryControls.append(categoryFieldSelect, categoryValueSelect, selectOnMapButton);
  container.append(subjectBlock, categoryControls);

  return { buttons, categoryControls, categoryFieldSelect, categoryValueSelect, selectOnMapButton };
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
  hasFieldChosen: boolean
) {
  const isGroup = mode === 'group';
  controls.categoryControls.style.display = isGroup ? 'grid' : 'none';
  controls.categoryFieldSelect.disabled = !isGroup || !hasFieldOptions;
  controls.categoryValueSelect.disabled = !isGroup || !hasFieldChosen;
  controls.selectOnMapButton.disabled = !isGroup;
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
  const placeholder = new Option('Everything', '');
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

  select.disabled = false;
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
  const placeholder = new Option('Choose value', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  if (!geoJSON || !field) {
    select.disabled = true;
    return { valueMap: [], indices: [] };
  }

  const formatCount = (count: number) => {
    if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(count >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, '')}B`;
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(count);
  };

  const buckets = new Map<string, { label: string; value: unknown; count: number }>();
  geoJSON.features.forEach(feature => {
    const raw = (feature.properties as Record<string, unknown> | undefined)?.[field];
    let key: string;
    let label: string;
    if (raw === undefined) {
      key = 'undefined';
      label = '(undefined)';
    } else if (raw === null) {
      key = 'null';
      label = '(null)';
    } else if (typeof raw === 'string' && raw.length === 0) {
      key = 'string:';
      label = '(empty)';
    } else {
      key = `${typeof raw}:${String(raw)}`;
      label = String(raw);
    }
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { label, value: raw, count: 1 });
    }
  });

  const sortedEntries = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  sortedEntries.forEach((entry, index) => {
    select.appendChild(new Option(`(${formatCount(entry.count)}) ${entry.label}`, String(index)));
  });

  select.disabled = sortedEntries.length === 0;

  const valueMap = sortedEntries.map(({ label, value }) => ({ label, value }));
  const selectedIndex = currentIndices.length ? currentIndices[0] : '';
  const hasSelected = selectedIndex !== '' && valueMap[Number(selectedIndex)];
  if (hasSelected) {
    select.value = selectedIndex;
    placeholder.selected = false;
    return { valueMap, indices: [selectedIndex] };
  }

  placeholder.selected = true;
  return { valueMap, indices: [] };
}


/* ------------------------------------------------------------------ */
/*  DOM element references (set once via initStatisticsElements)       */
/* ------------------------------------------------------------------ */

let statsLayerName: HTMLSelectElement;
let statsSubjectControls: SubjectSelectorControls;
let statsCategoryFieldSelect: HTMLSelectElement;
let statsCategoryValueSelect: HTMLSelectElement;
let statsFieldSelect: HTMLSelectElement;
let statsNormModeSelect: HTMLSelectElement | null = null;
let statsDetails: HTMLDivElement;
let statsNumericBlock: HTMLDivElement;
let statsCategoricalBlock: HTMLDivElement;
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
let statsOverflowMinPct: HTMLInputElement;
let statsOverflowMaxPct: HTMLInputElement;

export function initStatisticsElements(els: {
  statsLayerName: HTMLSelectElement;
  statsSubjectControls: SubjectSelectorControls;
  statsFieldSelect: HTMLSelectElement;
  statsNormModeSelect?: HTMLSelectElement | null;
  statsDetails: HTMLDivElement;
  statsNumericBlock: HTMLDivElement;
  statsCategoricalBlock: HTMLDivElement;
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
  statsOverflowMinPct: HTMLInputElement;
  statsOverflowMaxPct: HTMLInputElement;
}) {
  statsLayerName = els.statsLayerName;
  statsSubjectControls = els.statsSubjectControls;
  statsCategoryFieldSelect = els.statsSubjectControls.categoryFieldSelect;
  statsCategoryValueSelect = els.statsSubjectControls.categoryValueSelect;
  statsFieldSelect = els.statsFieldSelect;
  statsNormModeSelect = els.statsNormModeSelect ?? null;
  statsDetails = els.statsDetails;
  statsNumericBlock = els.statsNumericBlock;
  statsCategoricalBlock = els.statsCategoricalBlock;
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
  const geoJSON = _getLayerGeoJSON(layer);
  const categoricalFields = layer?.chosenCategoricalFields ?? [];
  const available = populateCategoryFields(geoJSON, categoricalFields, statsCategoryFieldSelect);

  if (S.statsCategoryField && available.includes(S.statsCategoryField)) {
    statsCategoryFieldSelect.value = S.statsCategoryField;
  } else {
    S.statsCategoryField = null;
  }
}

export function populateStatisticsCategoryValues(field: string | null) {
  const layer = _getStatsLayer();
  const geoJSON = _getLayerGeoJSON(layer);
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
  const sourceGeoJSON = _getLayerGeoJSON(layer);
  const numericFields = layer?.chosenNumericFields ?? [];
  const categoricalFields = layer?.chosenCategoricalFields ?? [];

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
  const { layer } = getStatsSourceContext();
  return {
    landField: layer?.landSizeField ?? null,
    landUnit: layer?.landSizeUnitLabel ?? null,
    bldgField: layer?.bldgSizeField ?? null,
    bldgUnit: layer?.bldgSizeUnitLabel ?? null
  };
}

export function updateStatisticsNormalizationControls() {
  const context = getStatsNormalizationContext();

  if (S.statsNormalizationMode === 'perLand' && !context.landField) S.statsNormalizationMode = 'asis';
  if (S.statsNormalizationMode === 'perBuilding' && !context.bldgField) S.statsNormalizationMode = 'asis';

  if (statsNormModeSelect) {
    const perLandOption = statsNormModeSelect.querySelector('option[value="perLand"]') as HTMLOptionElement | null;
    const perBuildingOption = statsNormModeSelect.querySelector('option[value="perBuilding"]') as HTMLOptionElement | null;
    if (perLandOption) {
      perLandOption.disabled = !context.landField;
      perLandOption.textContent = `…per land size ${context.landField ? (context.landUnit ?? '(unit)') : '(unit)'}`;
    }
    if (perBuildingOption) {
      perBuildingOption.disabled = !context.bldgField;
      perBuildingOption.textContent = `…per building size ${context.bldgField ? (context.bldgUnit ?? '(unit)') : '(unit)'}`;
    }
    statsNormModeSelect.value = S.statsNormalizationMode;
  }
}

export function getStatsSubjectSelection(
  mode: SubjectMode,
  categoryField: string | null,
  categoryValueIndices: string[],
  categoryValueMap: Array<{ label: string; value: unknown }>
): GeoJSON.Feature[] {
  const { layer, layerGeoJSON } = getStatsSourceContext();
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


export function getCurrentStatsSubjectSelection(): GeoJSON.Feature[] {
  return getStatsSubjectSelection(
    S.statsSubjectMode,
    S.statsCategoryField,
    S.statsCategoryValueIndices,
    S.statsCategoryValueMap
  );
}

export function updateStatisticsResults() {
  const { layer, layerGeoJSON } = getStatsSourceContext();
  const sourceGeoJSON = layerGeoJSON;
  const numericFields = layer?.chosenNumericFields ?? [];
  const categoricalFields = layer?.chosenCategoricalFields ?? [];

  updateStatisticsNormalizationControls();

  if (!sourceGeoJSON || !S.statsField) {
    S.statsValuesCache = [];
    resetStatisticsDisplay();
    return;
  }
  if (S.statsSubjectMode === 'group' && S.statsCategoryField && S.statsCategoryValueIndices.length === 0) {
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
        let base = numOrNull(props[S.statsField ?? '']);
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
    const raw = props[S.statsField ?? ''];
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
    true,
    !S.statsCategoryField || statsCategoryValueSelect.options.length > 1
  );
}

function updateStatisticsSubjectButtons() {
  updateSubjectButtons(statsSubjectControls, S.statsSubjectMode);
}

export function setStatsSubjectMode(mode: SubjectMode) {
  const allowedModes: SubjectMode[] = ['all', 'visible', 'selected', 'group'];
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
    return;
  }
  const isNumeric = S.statsFieldType === 'numeric';
  statsNumericBlock.style.display = isNumeric ? 'grid' : 'none';
  statsCategoricalBlock.style.display = isNumeric ? 'none' : 'grid';
  updateStatisticsNormalizationControls();
}

export function refreshStatisticsPanel() {
  populateStatisticsCategoryFields();
  populateStatisticsCategoryValues(S.statsCategoryField);

  const allowedModes: SubjectMode[] = ['all', 'visible', 'selected', 'group'];
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
