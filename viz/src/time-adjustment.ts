import { S } from './state';
import { cloneFilters, setFiltersContext } from './filters';
import type {
  FilterRule,
  TimeAdjustmentEntry,
  TimeAdjustmentGranularity,
  TimeAdjustmentMethod,
  TimeAdjustmentDisplayMode
} from './types';

const FILTER_ICON = new URL('./svg/filters.svg', import.meta.url).href;

type Elements = {
  panel: HTMLDivElement;
  showFiltersPanel: () => void;
  salePriceField: HTMLSelectElement;
  improvedFilterButton: HTMLButtonElement;
  improvedSizeField: HTMLSelectElement;
  vacantFilterButton: HTMLButtonElement;
  landSizeField: HTMLSelectElement;
  entriesToggle: HTMLButtonElement;
  entriesBody: HTMLDivElement;
  settingsToggle: HTMLButtonElement;
  settingsBody: HTMLDivElement;
  dataToggle: HTMLButtonElement;
  dataBody: HTMLDivElement;
  outliersToggle: HTMLButtonElement;
  outliersBody: HTMLDivElement;
  entryNameInput: HTMLInputElement;
  addEntryButton: HTMLButtonElement;
  entrySelect: HTMLSelectElement;
  entryDetails: HTMLDivElement;
  deleteEntryButton: HTMLButtonElement;
  undoDeleteButton: HTMLButtonElement;
  sampleCount: HTMLSpanElement;
  displaySelect: HTMLSelectElement;
  groupBySelect: HTMLSelectElement;
  granularitySelect: HTMLSelectElement;
  methodSelect: HTMLSelectElement;
  minSampleInput: HTMLInputElement;
  priceLowInput: HTMLInputElement;
  priceHighInput: HTMLInputElement;
  sizeLowInput: HTMLInputElement;
  sizeHighInput: HTMLInputElement;
  ratioLowInput: HTMLInputElement;
  ratioHighInput: HTMLInputElement;
  trendToggleButton: HTMLButtonElement;
  exportCsvButton: HTMLButtonElement;
  exportExcelButton: HTMLButtonElement;
  chart: HTMLDivElement;
  spinner: HTMLDivElement;
  chartMessage: HTMLDivElement;
  sizeHeader: HTMLTableCellElement;
  ratioHeader: HTMLTableCellElement;
};

type SalePoint = {
  date: Date;
  value: number;
  rawPrice: number;
  rawSize: number | null;
  outlier: boolean;
};

type GroupedPoints = Array<{ key: string; values: number[]; dates: Date[] }>;

let els: Elements;
let pendingTrendTimer: number | null = null;
let lastDeleted: TimeAdjustmentEntry | null = null;

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function ensureDefaultEntry() {
  const hasDefault = S.timeAdjustmentEntries.some((entry) => entry.isDefault);
  if (!hasDefault) {
    const defaultEntry: TimeAdjustmentEntry = {
      id: uid('taf'),
      name: 'Default',
      isDefault: true,
      startDate: null,
      valuationDate: null,
      dateField: 'sale_date',
      displayMode: 'improved',
      groupByField: null,
      granularity: 'month',
      method: 'median',
      minSample: 5,
      outlierPriceLow: null,
      outlierPriceHigh: null,
      outlierSizeLow: null,
      outlierSizeHigh: null,
      outlierRatioLow: null,
      outlierRatioHigh: null,
      includeFilters: [],
      includeFilterInvert: false,
      excludeFilters: [],
      excludeFilterInvert: false,
      trendVisible: false,
    };
    S.timeAdjustmentEntries.unshift(defaultEntry);
    if (!S.currentTimeAdjustmentEntryId) {
      S.currentTimeAdjustmentEntryId = defaultEntry.id;
    }
  }
}

function getPlotly(): any | null {
  return (window as any).Plotly ?? null;
}

function safeNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  // Handle Date objects (already parsed by GeoParquet)
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  // Handle numeric timestamps (milliseconds since epoch)
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
    return null;
  }
  // Handle string dates
  if (typeof value === 'string' && value.trim()) {
    // Try ISO format first (e.g., "2024-01-01")
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(date.getTime())) return date;
    // Try parsing as numeric string (timestamp stored as string)
    const n = Number(value);
    if (Number.isFinite(n)) {
      const numDate = new Date(n);
      if (!Number.isNaN(numDate.getTime())) return numDate;
    }
    return null;
  }
  return null;
}

function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function findDateRange(dateField: string): { min: Date | null; max: Date | null } {
  if (!S.currentGeoJSON?.features?.length) return { min: null, max: null };

  // DEBUG: Sample first 5 raw values to see what we're working with
  const sampleValues = S.currentGeoJSON.features.slice(0, 5).map((f: GeoJSON.Feature) => {
    const props = (f.properties ?? {}) as Record<string, any>;
    const raw = props[dateField];
    return { raw, type: typeof raw, parsed: parseDate(raw) };
  });
  console.log('[TimeAdjust] findDateRange samples:', { dateField, sampleValues });

  let min: Date | null = null;
  let max: Date | null = null;

  for (const feature of S.currentGeoJSON.features) {
    const props = (feature as GeoJSON.Feature).properties ?? {};
    const date = parseDate(props[dateField]);
    if (!date) continue;
    if (!min || date < min) min = date;
    if (!max || date > max) max = date;
  }

  return { min, max };
}

function prefillEntryDates(entry: TimeAdjustmentEntry) {
  if (entry.startDate && entry.valuationDate) return; // Already has dates

  const dateField = entry.dateField || 'sale_date';
  const { min, max } = findDateRange(dateField);

  console.log('[TimeAdjust] Date range found:', { dateField, min, max });

  if (min && !entry.startDate) {
    entry.startDate = toDateInput(min);
  }
  if (max && !entry.valuationDate) {
    entry.valuationDate = toDateInput(max);
  }
}

function formatPeriodLabel(date: Date, granularity: TimeAdjustmentGranularity): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (granularity === 'year') return String(y);
  if (granularity === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function getAllFields(): string[] {
  const first = S.currentGeoJSON?.features?.[0]?.properties;
  return first ? Object.keys(first) : [];
}

function numericFields(): string[] {
  const fields = getAllFields();
  if (!S.currentGeoJSON?.features?.length) return [];
  return fields.filter((field) => S.currentGeoJSON!.features.some((feature: GeoJSON.Feature) => safeNum(feature.properties?.[field]) !== null));
}

function categoricalFields(): string[] {
  const fields = getAllFields();
  if (!S.currentGeoJSON?.features?.length) return [];
  return fields.filter((field) => S.currentGeoJSON!.features.some((feature: GeoJSON.Feature) => typeof feature.properties?.[field] === 'string'));
}

function ensureDefaults(entry: TimeAdjustmentEntry) {
  if (!entry.displayMode) entry.displayMode = 'improved';
  if (!entry.granularity) entry.granularity = 'month';
  if (!entry.method) entry.method = 'median';
  if (!Number.isFinite(entry.minSample)) entry.minSample = 5;
  entry.includeFilters = entry.includeFilters ?? [];
  entry.excludeFilters = entry.excludeFilters ?? [];
  entry.includeFilterInvert = entry.includeFilterInvert ?? false;
  entry.excludeFilterInvert = entry.excludeFilterInvert ?? false;
}

function currentEntry(): TimeAdjustmentEntry | null {
  if (!S.currentTimeAdjustmentEntryId) return null;
  return S.timeAdjustmentEntries.find((entry) => entry.id === S.currentTimeAdjustmentEntryId) ?? null;
}

function matchesRule(props: Record<string, any>, filter: FilterRule): boolean {
  if (!filter.active || !filter.field || !filter.fieldType || !filter.operator) return true;
  const value = props[filter.field];

  if (filter.fieldType === 'numeric') {
    const left = safeNum(value);
    const right = safeNum(filter.value);
    if (left === null || right === null) return false;
    switch (filter.operator) {
      case 'lt': return left < right;
      case 'gt': return left > right;
      case 'lte': return left <= right;
      case 'gte': return left >= right;
      case 'eq': return left === right;
      case 'neq': return left !== right;
      default: return false;
    }
  }

  if (filter.fieldType === 'categorical') {
    const left = value == null ? '' : String(value);
    if (filter.operator === 'eq') return left === String(filter.value ?? '');
    if (filter.operator === 'neq') return left !== String(filter.value ?? '');
    if (filter.operator === 'any') return Array.isArray(filter.value) ? filter.value.includes(left) : false;
    if (filter.operator === 'not-any') return Array.isArray(filter.value) ? !filter.value.includes(left) : true;
  }

  if (filter.fieldType === 'reference') {
    if (filter.operator === 'ref-true') return value === true;
    if (filter.operator === 'ref-false') return value === false;
  }

  return true;
}

function matchesFilters(props: Record<string, any>, filters: FilterRule[], invert: boolean, default_if_empty: boolean): boolean {
  const active = filters.filter((filter) => filter.active);
  if (!active.length) return default_if_empty;  // No filters = return default
  const hit = active.every((filter) => matchesRule(props, filter));
  return invert ? !hit : hit;
}

function populateSelect(select: HTMLSelectElement, fields: string[], placeholder: string, includeNone = false) {
  const previous = select.value;
  select.replaceChildren();
  if (includeNone) {
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(None)';
    select.append(none);
  } else {
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholder;
    ph.disabled = true;
    ph.selected = true;
    select.append(ph);
  }
  fields.forEach((field) => {
    const option = document.createElement('option');
    option.value = field;
    option.textContent = field;
    select.append(option);
  });
  if (previous && fields.includes(previous)) select.value = previous;
}

function updateConditionsButton(button: HTMLButtonElement, filters: FilterRule[]) {
  const activeCount = filters.filter((filter) => filter.active).length;
  button.innerHTML = `<img src="${FILTER_ICON}" alt="Filters" /> conditions${activeCount ? ` (${activeCount})` : ''}`;
  button.classList.toggle('is-active', activeCount > 0);
}

function guessFieldByKeywords(fields: string[], keywords: string[]): string | null {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  for (const field of fields) {
    const lowerField = field.toLowerCase();
    if (lowerKeywords.some((kw) => lowerField.includes(kw))) {
      return field;
    }
  }
  return null;
}

function prefillFromMetadata() {
  const store = S.currentDataStoreId ? S.dataStores.get(S.currentDataStoreId) : null;
  const numeric = numericFields();

  // Prefill improved size field from metadata
  if (!S.timeAdjustmentSettings.improvedSizeField && store?.bldgSizeField && numeric.includes(store.bldgSizeField)) {
    S.timeAdjustmentSettings.improvedSizeField = store.bldgSizeField;
  }

  // Prefill land size field from metadata
  if (!S.timeAdjustmentSettings.landSizeField && store?.landSizeField && numeric.includes(store.landSizeField)) {
    S.timeAdjustmentSettings.landSizeField = store.landSizeField;
  }

  // Guess sale price field using heuristic
  if (!S.timeAdjustmentSettings.salePriceField) {
    const guessed = guessFieldByKeywords(numeric, ['sale_price', 'saleprice', 'sale', 'price', 'sold']);
    if (guessed) {
      S.timeAdjustmentSettings.salePriceField = guessed;
    }
  }
}

function refreshFieldOptions() {
  const numeric = numericFields();
  const categorical = categoricalFields();

  // Prefill from metadata if fields are empty
  prefillFromMetadata();

  populateSelect(els.salePriceField, numeric, 'sale price');
  populateSelect(els.improvedSizeField, numeric, 'bldg sqft');
  populateSelect(els.landSizeField, numeric, 'land sqft');
  populateSelect(els.groupBySelect, categorical, 'group', true);

  // Apply prefilled values to selects
  if (S.timeAdjustmentSettings.salePriceField && numeric.includes(S.timeAdjustmentSettings.salePriceField)) {
    els.salePriceField.value = S.timeAdjustmentSettings.salePriceField;
  }
  if (S.timeAdjustmentSettings.improvedSizeField && numeric.includes(S.timeAdjustmentSettings.improvedSizeField)) {
    els.improvedSizeField.value = S.timeAdjustmentSettings.improvedSizeField;
  }
  if (S.timeAdjustmentSettings.landSizeField && numeric.includes(S.timeAdjustmentSettings.landSizeField)) {
    els.landSizeField.value = S.timeAdjustmentSettings.landSizeField;
  }

  updateConditionsButton(els.improvedFilterButton, S.timeAdjustmentSettings.improvedFilters);
  updateConditionsButton(els.vacantFilterButton, S.timeAdjustmentSettings.vacantFilters);
}

function renderEntrySelect() {
  const previous = els.entrySelect.value;
  els.entrySelect.replaceChildren();
  const base = document.createElement('option');
  base.value = '';
  base.textContent = 'select time adjustment';
  base.disabled = true;
  base.selected = true;
  els.entrySelect.append(base);

  S.timeAdjustmentEntries.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    els.entrySelect.append(option);
  });

  const selected = S.currentTimeAdjustmentEntryId ?? previous;
  if (selected && S.timeAdjustmentEntries.some((entry) => entry.id === selected)) {
    els.entrySelect.value = selected;
  }
  els.undoDeleteButton.style.display = lastDeleted ? 'inline-flex' : 'none';
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function linearSolve(matrix: number[][], vector: number[]): number[] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= div;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function regressionFactors(grouped: Array<{ key: string; values: number[] }>, baselineKey: string): Record<string, number> {
  const groups = grouped.filter((group) => group.values.length > 0);
  const columns = groups.map((group) => group.key).filter((key) => key !== baselineKey);
  const xRows: number[][] = [];
  const yVals: number[] = [];

  groups.forEach((group) => {
    group.values.forEach((value) => {
      if (value <= 0) return;
      xRows.push([1, ...columns.map((key) => (key === group.key ? 1 : 0))]);
      yVals.push(Math.log(value));
    });
  });

  const p = columns.length + 1;
  if (xRows.length <= p) return Object.fromEntries(groups.map((group) => [group.key, median(group.values)]));

  const xtx = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
  const xty = Array.from({ length: p }, () => 0);
  xRows.forEach((row, i) => {
    for (let a = 0; a < p; a += 1) {
      xty[a] += row[a] * yVals[i];
      for (let b = 0; b < p; b += 1) xtx[a][b] += row[a] * row[b];
    }
  });

  const beta = linearSolve(xtx, xty);
  if (!beta) return Object.fromEntries(groups.map((group) => [group.key, median(group.values)]));

  const out: Record<string, number> = { [baselineKey]: Math.exp(beta[0]) };
  columns.forEach((key, idx) => { out[key] = Math.exp(beta[0] + beta[idx + 1]); });
  return out;
}

function computeSales(entry: TimeAdjustmentEntry): { points: SalePoint[]; grouped: GroupedPoints } {
  ensureDefaults(entry);
  const start = parseDate(entry.startDate);
  const valuation = parseDate(entry.valuationDate);

  // DEBUG: Log the date parsing for start/valuation
  console.log('[TimeAdjust] Date parsing:', {
    entryStartDate: entry.startDate,
    entryValuationDate: entry.valuationDate,
    parsedStart: start,
    parsedValuation: valuation,
    startTime: start?.getTime(),
    valuationTime: valuation?.getTime(),
  });

  if (!start || !valuation || !S.currentGeoJSON) {
    console.log('[TimeAdjust] Early exit:', { hasStart: !!start, hasValuation: !!valuation, hasGeoJSON: !!S.currentGeoJSON });
    return { points: [], grouped: [] };
  }

  const dateField = entry.dateField || 'sale_date';
  const priceField = S.timeAdjustmentSettings.salePriceField;
  const improvedSizeField = S.timeAdjustmentSettings.improvedSizeField;
  const landSizeField = S.timeAdjustmentSettings.landSizeField;

  // DEBUG: Sample first 3 features to see what the date field contains
  const sampleFeatures = S.currentGeoJSON.features.slice(0, 3);
  console.log('[TimeAdjust] Sample date values from first 3 features:', sampleFeatures.map((f: GeoJSON.Feature) => {
    const props = (f.properties ?? {}) as Record<string, any>;
    const rawValue = props[dateField];
    const parsed = parseDate(rawValue);
    return {
      rawValue,
      rawType: typeof rawValue,
      parsed,
      parsedTime: parsed?.getTime(),
      inRange: parsed ? (parsed >= start && parsed <= valuation) : false,
    };
  }));

  // Diagnostic counters
  let totalFeatures = 0;
  let hadDateField = 0;
  let parsedOk = 0;
  let inRange = 0;
  let passedPrice = 0;
  let passedModeFilter = 0;
  let passedIncludeExclude = 0;

  // Log filter config
  console.log('[TimeAdjust] Filter config:', {
    displayMode: entry.displayMode,
    improvedFilters: S.timeAdjustmentSettings.improvedFilters,
    improvedFilterInvert: S.timeAdjustmentSettings.improvedFilterInvert,
    vacantFilters: S.timeAdjustmentSettings.vacantFilters,
    vacantFilterInvert: S.timeAdjustmentSettings.vacantFilterInvert,
  });

  const points: SalePoint[] = S.currentGeoJSON.features.flatMap((feature: GeoJSON.Feature) => {
    totalFeatures++;
    const props = (feature.properties ?? {}) as Record<string, any>;
    const rawDateValue = props[dateField];
    if (rawDateValue !== undefined && rawDateValue !== null) hadDateField++;
    const date = parseDate(rawDateValue);
    if (date) parsedOk++;
    if (!date || date < start || date > valuation) return [];
    inRange++;

    const rawPrice = safeNum(props[priceField]);
    if (rawPrice === null) return [];
    passedPrice++;

    const improved = matchesFilters(props, S.timeAdjustmentSettings.improvedFilters, S.timeAdjustmentSettings.improvedFilterInvert, true);
    const vacant = matchesFilters(props, S.timeAdjustmentSettings.vacantFilters, S.timeAdjustmentSettings.vacantFilterInvert, true);
    const modeMatch = entry.displayMode === 'vacant' ? vacant : improved;
    if (!modeMatch) return [];
    passedModeFilter++;
    
    const includeMatch = matchesFilters(props, entry.includeFilters, entry.includeFilterInvert, true);
    const excludeMatch = matchesFilters(props, entry.excludeFilters, entry.excludeFilterInvert, false);
    if (!includeMatch || excludeMatch) return [];
    passedIncludeExclude++;

    const sizeRaw = entry.displayMode === 'vacant' ? safeNum(props[landSizeField]) : safeNum(props[improvedSizeField]);
    const sizeForRatio = sizeRaw ?? 1;
    const ratio = sizeForRatio === 0 ? null : rawPrice / sizeForRatio;

    const outlierPrice = (entry.outlierPriceLow != null && rawPrice < entry.outlierPriceLow)
      || (entry.outlierPriceHigh != null && rawPrice > entry.outlierPriceHigh);
    const outlierSize = (sizeRaw !== null) && ((entry.outlierSizeLow != null && sizeRaw < entry.outlierSizeLow)
      || (entry.outlierSizeHigh != null && sizeRaw > entry.outlierSizeHigh));
    const outlierRatio = (ratio !== null) && ((entry.outlierRatioLow != null && ratio < entry.outlierRatioLow)
      || (entry.outlierRatioHigh != null && ratio > entry.outlierRatioHigh));

    return [{ date, value: ratio ?? rawPrice, rawPrice, rawSize: sizeRaw, outlier: outlierPrice || outlierSize || outlierRatio }];
  });

  // DEBUG: Summary of filtering
  console.log('[TimeAdjust] Filter summary:', {
    totalFeatures,
    hadDateField,
    parsedOk,
    inRange,
    passedPrice,
    passedModeFilter,
    passedIncludeExclude,
    finalCount: points.length,
  });

  const groupedMap = new Map<string, { values: number[]; dates: Date[] }>();
  points.forEach((point) => {
    const key = formatPeriodLabel(point.date, entry.granularity === 'peak' ? 'month' : entry.granularity);
    if (!groupedMap.has(key)) groupedMap.set(key, { values: [], dates: [] });
    groupedMap.get(key)!.values.push(point.value);
    groupedMap.get(key)!.dates.push(point.date);
  });

  const grouped = Array.from(groupedMap.entries()).map(([key, val]) => ({ key, values: val.values, dates: val.dates }));
  grouped.sort((a, b) => a.key.localeCompare(b.key));
  return { points, grouped };
}

function computeTrend(entry: TimeAdjustmentEntry, grouped: GroupedPoints): Array<{ key: string; factor: number }> {
  const eligible = grouped.filter((group) => group.values.length >= entry.minSample);
  if (!eligible.length) return [];

  const baseline = eligible.reduce((best, group) => (group.values.length > best.values.length ? group : best), eligible[0]).key;

  let raw: Record<string, number> = {};
  if (entry.method === 'mean') raw = Object.fromEntries(eligible.map((g) => [g.key, mean(g.values)]));
  else if (entry.method === 'regression') raw = regressionFactors(eligible.map((g) => ({ key: g.key, values: g.values })), baseline);
  else raw = Object.fromEntries(eligible.map((g) => [g.key, median(g.values)]));

  const valuationDate = parseDate(entry.valuationDate);
  const valuationKey = valuationDate ? formatPeriodLabel(valuationDate, entry.granularity === 'peak' ? 'month' : entry.granularity) : eligible[eligible.length - 1].key;
  const anchor = raw[valuationKey] ?? raw[eligible[eligible.length - 1].key] ?? 1;
  const normalized = eligible.map((group) => ({ key: group.key, factor: anchor === 0 ? 1 : (raw[group.key] ?? 1) / anchor }));

  if (entry.granularity !== 'peak' || normalized.length <= 2) return normalized;
  const jan = normalized[0];
  const dec = normalized[normalized.length - 1];
  const peak = normalized.reduce((best, curr) => (curr.factor > best.factor ? curr : best), normalized[0]);
  return [jan, peak, dec];
}

function getConfigWarnings(entry: TimeAdjustmentEntry): string[] {
  const warnings: string[] = [];
  if (!S.timeAdjustmentSettings.salePriceField) {
    warnings.push('No sale price field selected');
  }
  if (!entry.startDate || !entry.valuationDate) {
    warnings.push('Start and valuation dates required');
  }
  if (!S.currentGeoJSON || !S.currentGeoJSON.features.length) {
    warnings.push('No data loaded');
  }
  return warnings;
}

function renderChart() {
  const plotly = getPlotly();
  if (!plotly) return;
  const entry = currentEntry();
  if (!entry) {
    plotly.purge(els.chart);
    els.sampleCount.textContent = '0';
    els.chartMessage.textContent = '';
    return;
  }

  const { points, grouped } = computeSales(entry);
  els.sampleCount.textContent = String(points.length);

  // Show warnings if no sales and there are configuration issues
  if (points.length === 0) {
    const warnings = getConfigWarnings(entry);
    if (warnings.length) {
      els.chartMessage.textContent = warnings.join('; ');
    } else {
      els.chartMessage.textContent = 'No matching sales found in date range';
    }
  } else {
    els.chartMessage.textContent = '';
  }

  const xInlier: string[] = [];
  const yInlier: number[] = [];
  const xOutlier: string[] = [];
  const yOutlier: number[] = [];
  points.forEach((point) => {
    const key = formatPeriodLabel(point.date, entry.granularity === 'peak' ? 'month' : entry.granularity);
    if (point.outlier) {
      xOutlier.push(key);
      yOutlier.push(point.value);
    } else {
      xInlier.push(key);
      yInlier.push(point.value);
    }
  });

  const traces: any[] = [{
    x: xInlier,
    y: yInlier,
    type: 'scatter',
    mode: 'markers',
    name: 'Sales',
    marker: { size: 5, color: '#1f2937' }
  }];
  if (xOutlier.length) {
    traces.push({
      x: xOutlier,
      y: yOutlier,
      type: 'scatter',
      mode: 'markers',
      name: 'Outlier',
      marker: { size: 6, color: '#fff', line: { color: '#ef4444', width: 1 }, symbol: 'circle-open' }
    });
  }

  if (entry.trendVisible) {
    const trend = computeTrend(entry, grouped);
    traces.push({
      x: trend.map((item) => item.key),
      y: trend.map((item) => item.factor),
      yaxis: 'y2',
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Trend factor',
      line: { color: '#2563eb', width: 2 },
      marker: { size: 6 }
    });
  }

  const layout = {
    margin: { l: 40, r: 44, t: 14, b: 40 },
    xaxis: { title: 'Time period' },
    yaxis: { title: 'Sale price' },
    yaxis2: { title: 'Factor', overlaying: 'y', side: 'right', tickformat: '.2f' },
    showlegend: true,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)'
  };

  plotly.react(els.chart, traces, layout, { displayModeBar: false, responsive: true });
}

function scheduleTrendRender() {
  if (pendingTrendTimer) window.clearTimeout(pendingTrendTimer);
  els.spinner.style.display = 'block';
  pendingTrendTimer = window.setTimeout(() => {
    pendingTrendTimer = null;
    try {
      renderChart();
      els.chartMessage.textContent = '';
    } catch (error) {
      els.chartMessage.textContent = `Trend error: ${(error as Error).message}`;
    } finally {
      els.spinner.style.display = 'none';
    }
  }, 650);
}

function bindFilterButton(button: HTMLButtonElement, key: string, label: string, getFilters: () => FilterRule[], getInvert: () => boolean, setFilters: (filters: FilterRule[], invert: boolean) => void) {
  button.addEventListener('click', () => {
    setFiltersContext({
      type: 'landSchedule',
      getFilters,
      getFilterInvert: getInvert,
      setFilters: (filters: FilterRule[], invert: boolean) => {
        setFilters(filters, invert);
        updateConditionsButton(button, getFilters());
        scheduleTrendRender();
      },
      label,
      key,
    });
    els.showFiltersPanel();
  });
}

function bindEntryDetails() {
  const entry = currentEntry();
  if (!entry) {
    els.entryDetails.style.display = 'none';
    els.deleteEntryButton.style.display = 'none';
    return;
  }
  ensureDefaults(entry);

  // Prefill dates from data if not already set
  prefillEntryDates(entry);

  // Update static delete button visibility
  els.deleteEntryButton.style.display = entry.isDefault ? 'none' : 'inline-flex';

  els.entryDetails.style.display = 'grid';
  els.entryDetails.innerHTML = `
    <div class="time-adjustment-row compact" style="grid-template-columns: auto 1fr auto 1fr auto 1fr;">
      <span class="time-adjustment-label-text">Date field</span>
      <input type="text" data-role="dateField" value="${entry.dateField ?? 'sale_date'}" style="min-width:80px;" />
      <span class="time-adjustment-label-text">Start</span>
      <input type="date" data-role="start" value="${entry.startDate ?? ''}" />
      <span class="time-adjustment-label-text">Valuation</span>
      <input type="date" data-role="valuation" value="${entry.valuationDate ?? ''}" />
    </div>
    <div class="time-adjustment-row" style="grid-template-columns: auto 1fr auto 1fr;">
      <span class="time-adjustment-label-text">Include</span>
      <button type="button" data-role="include" class="land-table-filter time-adjustment-conditions"><img src="${FILTER_ICON}" alt="Filters" /> conditions</button>
      <span class="time-adjustment-label-text">Exclude</span>
      <button type="button" data-role="exclude" class="land-table-filter time-adjustment-conditions"><img src="${FILTER_ICON}" alt="Filters" /> conditions</button>
    </div>
  `;

  const startInput = els.entryDetails.querySelector('[data-role="start"]') as HTMLInputElement;
  const valuationInput = els.entryDetails.querySelector('[data-role="valuation"]') as HTMLInputElement;
  const dateFieldInput = els.entryDetails.querySelector('[data-role="dateField"]') as HTMLInputElement;
  startInput.addEventListener('change', () => { entry.startDate = startInput.value || null; scheduleTrendRender(); });
  valuationInput.addEventListener('change', () => { entry.valuationDate = valuationInput.value || null; scheduleTrendRender(); });
  dateFieldInput.addEventListener('change', () => { entry.dateField = dateFieldInput.value || 'sale_date'; scheduleTrendRender(); });

  const includeBtn = els.entryDetails.querySelector('[data-role="include"]') as HTMLButtonElement;
  const excludeBtn = els.entryDetails.querySelector('[data-role="exclude"]') as HTMLButtonElement;
  updateConditionsButton(includeBtn, entry.includeFilters);
  updateConditionsButton(excludeBtn, entry.excludeFilters);
  bindFilterButton(
    includeBtn,
    `timeAdjustment:entry:${entry.id}:include`,
    `Time adjustment entry include: ${entry.name}`,
    () => entry.includeFilters,
    () => entry.includeFilterInvert,
    (filters, invert) => {
      entry.includeFilters = cloneFilters(filters);
      entry.includeFilterInvert = invert;
    }
  );
  bindFilterButton(
    excludeBtn,
    `timeAdjustment:entry:${entry.id}:exclude`,
    `Time adjustment entry exclude: ${entry.name}`,
    () => entry.excludeFilters,
    () => entry.excludeFilterInvert,
    (filters, invert) => {
      entry.excludeFilters = cloneFilters(filters);
      entry.excludeFilterInvert = invert;
    }
  );
}

function parseOptionalNumeric(input: HTMLInputElement): number | null {
  if (!input.value.trim()) return null;
  const n = Number(input.value);
  return Number.isFinite(n) ? n : null;
}

function exportMainAndDaily(entry: TimeAdjustmentEntry) {
  const { grouped } = computeSales(entry);
  const trend = computeTrend(entry, grouped);
  if (!trend.length) {
    window.alert('No trend data to export.');
    return;
  }

  const header = entry.granularity === 'year' ? 'Year' : entry.granularity === 'quarter' ? 'Quarter' : 'Month';
  const rows = trend.map((item) => `${item.key},${item.factor.toFixed(6)}`);
  const csv = `${header},Factor\n${rows.join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${entry.name}_time_adjustment.csv`;
  a.click();
  URL.revokeObjectURL(a.href);

  const days: string[] = [];
  const start = parseDate(entry.startDate);
  const end = parseDate(entry.valuationDate);
  if (start && end) {
    const sorted = [...trend].sort((a, b) => a.key.localeCompare(b.key));
    const step = 24 * 60 * 60 * 1000;
    for (let t = start.getTime(); t <= end.getTime(); t += step) {
      const d = new Date(t);
      const key = formatPeriodLabel(d, entry.granularity === 'peak' ? 'month' : entry.granularity);
      const factor = sorted.find((item) => item.key === key)?.factor ?? sorted[sorted.length - 1].factor;
      days.push(`${toDateInput(d)},${factor.toFixed(6)}`);
    }
  }
  const dailyBlob = new Blob([`Day,Factor\n${days.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const dailyLink = document.createElement('a');
  dailyLink.href = URL.createObjectURL(dailyBlob);
  dailyLink.download = `${entry.name}_time_adjustment_daily.csv`;
  dailyLink.click();
  URL.revokeObjectURL(dailyLink.href);

  window.alert('CSV files exported. Zip packaging / Excel workbook export still needs a dedicated library.');
}

function render() {
  refreshFieldOptions();
  renderEntrySelect();
  bindEntryDetails();

  const entry = currentEntry();
  if (entry) {
    ensureDefaults(entry);
    els.displaySelect.value = entry.displayMode;
    els.groupBySelect.value = entry.groupByField ?? '';
    els.granularitySelect.value = entry.granularity;
    els.methodSelect.value = entry.method;
    els.minSampleInput.value = String(entry.minSample);
    els.priceLowInput.value = entry.outlierPriceLow == null ? '' : String(entry.outlierPriceLow);
    els.priceHighInput.value = entry.outlierPriceHigh == null ? '' : String(entry.outlierPriceHigh);
    els.sizeLowInput.value = entry.outlierSizeLow == null ? '' : String(entry.outlierSizeLow);
    els.sizeHighInput.value = entry.outlierSizeHigh == null ? '' : String(entry.outlierSizeHigh);
    els.ratioLowInput.value = entry.outlierRatioLow == null ? '' : String(entry.outlierRatioLow);
    els.ratioHighInput.value = entry.outlierRatioHigh == null ? '' : String(entry.outlierRatioHigh);
    els.trendToggleButton.textContent = entry.trendVisible ? 'Hide trend' : 'Plot trend';
  }

  const sizeLabel = entry?.displayMode === 'vacant' ? 'Land size' : 'Improved size';
  els.sizeHeader.textContent = sizeLabel;
  els.ratioHeader.textContent = `Price/${sizeLabel}`;

  scheduleTrendRender();
}

export function initTimeAdjustmentElements(elements: Elements) {
  els = elements;

  // Ensure a default entry exists and is selected
  ensureDefaultEntry();

  bindFilterButton(
    els.improvedFilterButton,
    'timeAdjustment:settings:improved',
    'Time adjustment settings: improved filter',
    () => S.timeAdjustmentSettings.improvedFilters,
    () => S.timeAdjustmentSettings.improvedFilterInvert,
    (filters, invert) => {
      S.timeAdjustmentSettings.improvedFilters = cloneFilters(filters);
      S.timeAdjustmentSettings.improvedFilterInvert = invert;
    }
  );
  bindFilterButton(
    els.vacantFilterButton,
    'timeAdjustment:settings:vacant',
    'Time adjustment settings: vacant filter',
    () => S.timeAdjustmentSettings.vacantFilters,
    () => S.timeAdjustmentSettings.vacantFilterInvert,
    (filters, invert) => {
      S.timeAdjustmentSettings.vacantFilters = cloneFilters(filters);
      S.timeAdjustmentSettings.vacantFilterInvert = invert;
    }
  );
  // Note: Collapse toggle event listeners are handled in main.ts for consistency

  els.addEntryButton.addEventListener('click', () => {
    const name = els.entryNameInput.value.trim();
    if (!name) return;
    const entry: TimeAdjustmentEntry = {
      id: uid('taf'),
      name,
      startDate: null,
      valuationDate: null,
      dateField: 'sale_date',
      displayMode: 'improved',
      groupByField: null,
      granularity: 'month',
      method: 'median',
      minSample: 5,
      outlierPriceLow: null,
      outlierPriceHigh: null,
      outlierSizeLow: null,
      outlierSizeHigh: null,
      outlierRatioLow: null,
      outlierRatioHigh: null,
      includeFilters: [],
      includeFilterInvert: false,
      excludeFilters: [],
      excludeFilterInvert: false,
      trendVisible: false,
    };
    S.timeAdjustmentEntries.push(entry);
    S.currentTimeAdjustmentEntryId = entry.id;
    els.entryNameInput.value = '';
    render();
  });

  els.entrySelect.addEventListener('change', () => {
    S.currentTimeAdjustmentEntryId = els.entrySelect.value || null;
    render();
  });

  els.undoDeleteButton.addEventListener('click', () => {
    if (!lastDeleted) return;
    S.timeAdjustmentEntries.push(lastDeleted);
    S.currentTimeAdjustmentEntryId = lastDeleted.id;
    lastDeleted = null;
    render();
  });

  els.deleteEntryButton.addEventListener('click', () => {
    const entry = currentEntry();
    if (!entry || entry.isDefault) return;
    lastDeleted = { ...entry, includeFilters: cloneFilters(entry.includeFilters), excludeFilters: cloneFilters(entry.excludeFilters) };
    S.timeAdjustmentEntries = S.timeAdjustmentEntries.filter((item) => item.id !== entry.id);
    S.currentTimeAdjustmentEntryId = S.timeAdjustmentEntries[0]?.id ?? null;
    render();
  });

  els.salePriceField.addEventListener('change', () => {
    S.timeAdjustmentSettings.salePriceField = els.salePriceField.value;
    scheduleTrendRender();
  });
  els.improvedSizeField.addEventListener('change', () => {
    S.timeAdjustmentSettings.improvedSizeField = els.improvedSizeField.value;
    scheduleTrendRender();
  });
  els.landSizeField.addEventListener('change', () => {
    S.timeAdjustmentSettings.landSizeField = els.landSizeField.value;
    scheduleTrendRender();
  });

  const bindEntrySetting = (setter: (entry: TimeAdjustmentEntry) => void) => {
    const entry = currentEntry();
    if (!entry) return;
    setter(entry);
    scheduleTrendRender();
  };

  els.displaySelect.addEventListener('change', () => bindEntrySetting((entry) => { entry.displayMode = els.displaySelect.value as TimeAdjustmentDisplayMode; }));
  els.groupBySelect.addEventListener('change', () => bindEntrySetting((entry) => { entry.groupByField = els.groupBySelect.value || null; }));
  els.granularitySelect.addEventListener('change', () => bindEntrySetting((entry) => { entry.granularity = els.granularitySelect.value as TimeAdjustmentGranularity; }));
  els.methodSelect.addEventListener('change', () => bindEntrySetting((entry) => { entry.method = els.methodSelect.value as TimeAdjustmentMethod; }));
  els.minSampleInput.addEventListener('change', () => bindEntrySetting((entry) => {
    const value = Number(els.minSampleInput.value);
    entry.minSample = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 5;
    els.minSampleInput.value = String(entry.minSample);
  }));

  const bindOutliers = () => bindEntrySetting((entry) => {
    entry.outlierPriceLow = parseOptionalNumeric(els.priceLowInput);
    entry.outlierPriceHigh = parseOptionalNumeric(els.priceHighInput);
    entry.outlierSizeLow = parseOptionalNumeric(els.sizeLowInput);
    entry.outlierSizeHigh = parseOptionalNumeric(els.sizeHighInput);
    entry.outlierRatioLow = parseOptionalNumeric(els.ratioLowInput);
    entry.outlierRatioHigh = parseOptionalNumeric(els.ratioHighInput);
  });
  [els.priceLowInput, els.priceHighInput, els.sizeLowInput, els.sizeHighInput, els.ratioLowInput, els.ratioHighInput]
    .forEach((input) => input.addEventListener('change', bindOutliers));

  els.trendToggleButton.addEventListener('click', () => {
    const entry = currentEntry();
    if (!entry) return;
    entry.trendVisible = !entry.trendVisible;
    render();
  });

  els.exportCsvButton.addEventListener('click', () => {
    const entry = currentEntry();
    if (!entry) return;
    exportMainAndDaily(entry);
  });

  els.exportExcelButton.addEventListener('click', () => {
    window.alert('Excel export requires wiring an XLSX library.');
  });

  // Initial render to populate UI
  render();
}

export function refreshTimeAdjustmentPanel() {
  render();
}
