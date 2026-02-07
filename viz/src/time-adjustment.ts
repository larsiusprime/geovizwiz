import { S } from './state';
import { cloneFilters, setFiltersContext } from './filters';
import type {
  FilterRule,
  TimeAdjustmentEntry,
  TimeAdjustmentGranularity,
  TimeAdjustmentMethod,
} from './types';

const FILTER_ICON = new URL('./svg/filters.svg', import.meta.url).href;

type Elements = {
  panel: HTMLDivElement;
  showFiltersPanel: () => void;
  entriesToggle: HTMLButtonElement;
  entriesBody: HTMLDivElement;
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
  chartModeSelect: HTMLSelectElement;
  chartGroupSelect: HTMLSelectElement;
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
let chartMode: 'improved' | 'vacant' = 'improved';
let chartGroupValue: string = ''; // empty string means "(All)"

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

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    return lower === 'true' || lower === 'yes' || lower === 'y' || lower === '1';
  }
  return Boolean(value);
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

  if (min && max && !entry.startDate) {
    // Clamp start date to no earlier than Jan 1 of 5 years before max date
    const fiveYearsBeforeMax = new Date(max.getFullYear() - 5, 0, 1);
    const clampedMin = min < fiveYearsBeforeMax ? fiveYearsBeforeMax : min;
    entry.startDate = toDateInput(clampedMin);
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

/**
 * Get the midpoint date of a period (for linear interpolation).
 * Monthly: 15th of the month
 * Quarterly: 15th of the middle month (Feb, May, Aug, Nov)
 * Yearly: July 1st
 */
function periodMidpoint(key: string, granularity: TimeAdjustmentGranularity): Date {
  if (granularity === 'year') {
    // key = "2024"
    const year = parseInt(key, 10);
    return new Date(year, 6, 1); // July 1st
  }
  if (granularity === 'quarter') {
    // key = "2024-Q1"
    const [yearStr, qStr] = key.split('-Q');
    const year = parseInt(yearStr, 10);
    const quarter = parseInt(qStr, 10);
    // Q1: Jan-Mar -> mid Feb (month 1, day 15)
    // Q2: Apr-Jun -> mid May (month 4, day 15)
    // Q3: Jul-Sep -> mid Aug (month 7, day 15)
    // Q4: Oct-Dec -> mid Nov (month 10, day 15)
    const midMonth = (quarter - 1) * 3 + 1; // 1, 4, 7, 10
    return new Date(year, midMonth, 15);
  }
  // month: key = "2024-01"
  const [yearStr, monthStr] = key.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-indexed
  return new Date(year, month, 15); // 15th of month
}

type TrendItemWithMidpoint = { key: string; factor: number; midpoint: Date };

/**
 * Linearly interpolate factor for a given date between period midpoints.
 * - Dates before first midpoint use first factor
 * - Dates after last midpoint use last factor
 * - Dates between midpoints are linearly interpolated
 */
function interpolateFactor(date: Date, sortedTrend: TrendItemWithMidpoint[]): number {
  if (!sortedTrend.length) return 1;

  const time = date.getTime();

  // Edge case: before first midpoint
  if (time <= sortedTrend[0].midpoint.getTime()) {
    return sortedTrend[0].factor;
  }

  // Edge case: after last midpoint
  const last = sortedTrend[sortedTrend.length - 1];
  if (time >= last.midpoint.getTime()) {
    return last.factor;
  }

  // Find bracketing items and interpolate
  for (let i = 0; i < sortedTrend.length - 1; i++) {
    const a = sortedTrend[i];
    const b = sortedTrend[i + 1];
    if (time >= a.midpoint.getTime() && time <= b.midpoint.getTime()) {
      // Linear interpolation: t is the fraction between a and b
      const t = (time - a.midpoint.getTime()) / (b.midpoint.getTime() - a.midpoint.getTime());
      return a.factor + t * (b.factor - a.factor);
    }
  }

  // Fallback (shouldn't reach here)
  return last.factor;
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

function getUniqueGroupValues(groupByField: string | null): string[] {
  if (!groupByField || !S.currentGeoJSON?.features?.length) return [];
  const values = new Set<string>();
  for (const feature of S.currentGeoJSON.features) {
    const props = (feature as GeoJSON.Feature).properties ?? {};
    const val = props[groupByField];
    if (val != null && val !== '') {
      values.add(String(val));
    }
  }
  return Array.from(values).sort();
}

function populateChartGroupSelect(groupByField: string | null) {
  const previous = els.chartGroupSelect.value;
  els.chartGroupSelect.replaceChildren();

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = '(All)';
  els.chartGroupSelect.append(allOption);

  const uniqueValues = getUniqueGroupValues(groupByField);
  for (const val of uniqueValues) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    els.chartGroupSelect.append(opt);
  }

  // Restore previous selection if still valid
  if (previous && uniqueValues.includes(previous)) {
    els.chartGroupSelect.value = previous;
  } else {
    els.chartGroupSelect.value = '';
    chartGroupValue = '';
  }
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
  const categorical = categoricalFields();

  // Prefill from metadata if fields are empty
  prefillFromMetadata();

  populateSelect(els.groupBySelect, categorical, 'group', true);
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

type ChartFilters = {
  mode: 'improved' | 'vacant';
  groupField: string | null;
  groupValue: string; // empty = all
};

function computeSales(entry: TimeAdjustmentEntry, chartFilters?: ChartFilters): { points: SalePoint[]; grouped: GroupedPoints } {
  ensureDefaults(entry);
  const start = parseDate(entry.startDate);
  const valuation = parseDate(entry.valuationDate);

  if (!start || !valuation || !S.currentGeoJSON) {
    return { points: [], grouped: [] };
  }

  const dateField = entry.dateField || 'sale_date';
  const priceField = S.timeAdjustmentSettings.salePriceField;
  const improvedSizeField = S.timeAdjustmentSettings.improvedSizeField;
  const landSizeField = S.timeAdjustmentSettings.landSizeField;

  // Use chart-specific filters if provided, otherwise use entry defaults
  const effectiveMode = chartFilters?.mode ?? entry.displayMode;
  const groupField = chartFilters?.groupField ?? entry.groupByField;
  const groupValue = chartFilters?.groupValue ?? '';

  const points: SalePoint[] = S.currentGeoJSON.features.flatMap((feature: GeoJSON.Feature) => {
    const props = (feature.properties ?? {}) as Record<string, any>;
    const date = parseDate(props[dateField]);
    if (!date || date < start || date > valuation) return [];

    const rawPrice = safeNum(props[priceField]);
    if (rawPrice === null) return [];

    // Determine if sale is vacant based on vacantSaleField
    const vacantSaleField = S.timeAdjustmentSettings.vacantSaleField;
    const isVacantSale = vacantSaleField ? isTruthy(props[vacantSaleField]) : false;

    // Filter by display mode (vacant vs improved)
    if (effectiveMode === 'vacant' && !isVacantSale) return [];
    if (effectiveMode === 'improved' && isVacantSale) return [];

    // Filter by group value if specified
    if (groupField && groupValue) {
      const propVal = props[groupField];
      if (propVal == null || String(propVal) !== groupValue) return [];
    }

    const includeMatch = matchesFilters(props, entry.includeFilters, entry.includeFilterInvert, true);
    const excludeMatch = matchesFilters(props, entry.excludeFilters, entry.excludeFilterInvert, false);
    if (!includeMatch || excludeMatch) return [];

    const sizeRaw = effectiveMode === 'vacant' ? safeNum(props[landSizeField]) : safeNum(props[improvedSizeField]);
    // Skip sales without valid size data - we can't compute price per sqft
    if (sizeRaw === null || sizeRaw <= 0) return [];
    const ratio = rawPrice / sizeRaw;

    const outlierPrice = (entry.outlierPriceLow != null && rawPrice < entry.outlierPriceLow)
      || (entry.outlierPriceHigh != null && rawPrice > entry.outlierPriceHigh);
    const outlierSize = (sizeRaw !== null) && ((entry.outlierSizeLow != null && sizeRaw < entry.outlierSizeLow)
      || (entry.outlierSizeHigh != null && sizeRaw > entry.outlierSizeHigh));
    // Check the ratio value for outlier detection
    const valueToPlot = ratio;
    const outlierRatio = (entry.outlierRatioLow != null && valueToPlot < entry.outlierRatioLow)
      || (entry.outlierRatioHigh != null && valueToPlot > entry.outlierRatioHigh);

    return [{ date, value: ratio, rawPrice, rawSize: sizeRaw, outlier: outlierPrice || outlierSize || outlierRatio }];
  });

  // Only include non-outlier points in grouped values for trend calculation
  const groupedMap = new Map<string, { values: number[]; dates: Date[] }>();
  points.forEach((point) => {
    if (point.outlier) return; // Skip outliers for trend calculation
    const key = formatPeriodLabel(point.date, entry.granularity === 'peak' ? 'month' : entry.granularity);
    if (!groupedMap.has(key)) groupedMap.set(key, { values: [], dates: [] });
    groupedMap.get(key)!.values.push(point.value);
    groupedMap.get(key)!.dates.push(point.date);
  });

  const grouped = Array.from(groupedMap.entries()).map(([key, val]) => ({ key, values: val.values, dates: val.dates }));
  grouped.sort((a, b) => a.key.localeCompare(b.key));
  return { points, grouped };
}

type TrendResult = {
  items: Array<{ key: string; factor: number; rawValue: number }>;
  anchor: number;
};

function computeTrend(entry: TimeAdjustmentEntry, grouped: GroupedPoints): TrendResult {
  const eligible = grouped.filter((group) => group.values.length >= entry.minSample);
  if (!eligible.length) return { items: [], anchor: 1 };

  const baseline = eligible.reduce((best, group) => (group.values.length > best.values.length ? group : best), eligible[0]).key;

  let raw: Record<string, number> = {};
  if (entry.method === 'mean') raw = Object.fromEntries(eligible.map((g) => [g.key, mean(g.values)]));
  else if (entry.method === 'regression') raw = regressionFactors(eligible.map((g) => ({ key: g.key, values: g.values })), baseline);
  else raw = Object.fromEntries(eligible.map((g) => [g.key, median(g.values)]));

  const valuationDate = parseDate(entry.valuationDate);
  const valuationKey = valuationDate ? formatPeriodLabel(valuationDate, entry.granularity === 'peak' ? 'month' : entry.granularity) : eligible[eligible.length - 1].key;
  const anchor = raw[valuationKey] ?? raw[eligible[eligible.length - 1].key] ?? 1;
  const normalized = eligible.map((group) => ({
    key: group.key,
    factor: anchor === 0 ? 1 : (raw[group.key] ?? 1) / anchor,
    rawValue: raw[group.key] ?? 0,
  }));

  // Sort normalized by key to ensure chronological order
  normalized.sort((a, b) => a.key.localeCompare(b.key));

  if (entry.granularity !== 'peak') return { items: normalized, anchor };

  // Peak mode: for each year, include January, peak month, and December
  // Group by year first
  const byYear = new Map<string, Array<{ key: string; factor: number; rawValue: number }>>();
  for (const item of normalized) {
    // Key format is "YYYY-MM", extract year
    const year = item.key.substring(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(item);
  }

  const result: Array<{ key: string; factor: number; rawValue: number }> = [];
  const sortedYears = Array.from(byYear.keys()).sort();

  for (const year of sortedYears) {
    const yearData = byYear.get(year)!;
    if (yearData.length === 0) continue;

    // Sort by month within the year
    yearData.sort((a, b) => a.key.localeCompare(b.key));

    // Find January (YYYY-01), December (YYYY-12), and peak month
    const jan = yearData.find((d) => d.key === `${year}-01`);
    const dec = yearData.find((d) => d.key === `${year}-12`);
    const peak = yearData.reduce((best, curr) => (curr.factor > best.factor ? curr : best), yearData[0]);

    // Add points in chronological order, avoiding duplicates
    const added = new Set<string>();
    if (jan && !added.has(jan.key)) { result.push(jan); added.add(jan.key); }
    if (peak && !added.has(peak.key)) { result.push(peak); added.add(peak.key); }
    if (dec && !added.has(dec.key)) { result.push(dec); added.add(dec.key); }
  }

  // Sort final result chronologically
  result.sort((a, b) => a.key.localeCompare(b.key));
  return { items: result, anchor };
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

  // Use chart-specific filters
  const chartFilters: ChartFilters = {
    mode: chartMode,
    groupField: entry.groupByField,
    groupValue: chartGroupValue,
  };

  const { points, grouped } = computeSales(entry, chartFilters);
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
    marker: { size: 4, opacity: 0.5, color: '#1f2937' }
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

  // Compute trend once for reuse
  const trendResult = entry.trendVisible ? computeTrend(entry, grouped) : { items: [], anchor: 1 };
  const trendItems = trendResult.items;

  if (entry.trendVisible && trendItems.length > 0) {
    // Plot raw values on primary Y-axis (same scale as sales)
    traces.push({
      x: trendItems.map((item) => item.key),
      y: trendItems.map((item) => item.rawValue),
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Trend',
      line: { color: '#2563eb', width: 2 },
      marker: { size: 6 }
    });
  }

  // Calculate Y-axis range from inliers and trend values (start at 0, extend to max + 10% buffer)
  const trendMaxY = trendItems.length > 0 ? Math.max(...trendItems.map((t) => t.rawValue)) : 0;
  const yMax = Math.max(yInlier.length > 0 ? Math.max(...yInlier) : 0, trendMaxY) * 1.1 || 100;
  const yRange: [number, number] = [0, yMax];

  // Y-axis label depends on mode
  const sizeUnit = chartMode === 'vacant' ? 'land sqft' : 'bldg sqft';
  const yAxisLabel = `Price / ${sizeUnit}`;

  // Collect all unique x categories and sort them chronologically
  const allCategories = new Set<string>([...xInlier, ...xOutlier]);
  trendItems.forEach((t) => allCategories.add(t.key));
  const sortedCategories = Array.from(allCategories).sort();

  const layout: Record<string, any> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 14, b: 40 },
    xaxis: {
      title: 'Time period',
      automargin: true,
      fixedrange: true,
      categoryorder: 'array',
      categoryarray: sortedCategories,
    },
    yaxis: { title: yAxisLabel, range: yRange, rangemode: 'tozero', fixedrange: true },
    showlegend: true,
    legend: { x: 0, y: 1, xanchor: 'left', yanchor: 'top', orientation: 'h' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    dragmode: false,
  };

  const config = {
    displayModeBar: false,
    responsive: true,
    scrollZoom: false,
    doubleClick: false,
    staticPlot: false, // false to allow hover
  };

  plotly.react(els.chart, traces, layout, config);
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
  // Use chart-specific filters for export
  const chartFilters: ChartFilters = {
    mode: chartMode,
    groupField: entry.groupByField,
    groupValue: chartGroupValue,
  };

  const { grouped } = computeSales(entry, chartFilters);
  const trendResult = computeTrend(entry, grouped);
  const trend = trendResult.items;
  if (!trend.length) {
    window.alert('No trend data to export.');
    return;
  }

  // Build filename suffix with mode and group info
  let filenameSuffix = `_${chartMode}`;
  if (entry.groupByField && chartGroupValue) {
    // Sanitize field and value for filename
    const safeField = entry.groupByField.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeValue = chartGroupValue.replace(/[^a-zA-Z0-9_-]/g, '_');
    filenameSuffix += `_${safeField}_${safeValue}`;
  }

  const header = entry.granularity === 'year' ? 'Year' : entry.granularity === 'quarter' ? 'Quarter' : 'Month';
  const rows = trend.map((item) => `${item.key},${item.factor.toFixed(6)}`);
  const csv = `${header},Factor\n${rows.join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${entry.name}${filenameSuffix}_time_adjustment.csv`;
  a.click();
  URL.revokeObjectURL(a.href);

  const days: string[] = [];
  const start = parseDate(entry.startDate);
  const end = parseDate(entry.valuationDate);
  if (start && end) {
    const granularity = entry.granularity === 'peak' ? 'month' : entry.granularity;
    // Build sorted trend with midpoint dates for interpolation
    const sortedWithMidpoints: TrendItemWithMidpoint[] = [...trend]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((item) => ({
        key: item.key,
        factor: item.factor,
        midpoint: periodMidpoint(item.key, granularity),
      }));

    const step = 24 * 60 * 60 * 1000;
    for (let t = start.getTime(); t <= end.getTime(); t += step) {
      const d = new Date(t);
      const factor = interpolateFactor(d, sortedWithMidpoints);
      days.push(`${toDateInput(d)},${factor.toFixed(6)}`);
    }
  }
  const dailyBlob = new Blob([`Day,Factor\n${days.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const dailyLink = document.createElement('a');
  dailyLink.href = URL.createObjectURL(dailyBlob);
  dailyLink.download = `${entry.name}${filenameSuffix}_time_adjustment_daily.csv`;
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

  const sizeLabel = chartMode === 'vacant' ? 'Land size' : 'Improved size';
  els.sizeHeader.textContent = sizeLabel;
  els.ratioHeader.textContent = `Price/${sizeLabel}`;

  // Populate chart-specific dropdowns
  els.chartModeSelect.value = chartMode;
  populateChartGroupSelect(entry?.groupByField ?? null);

  scheduleTrendRender();
}

export function initTimeAdjustmentElements(elements: Elements) {
  els = elements;

  // Ensure a default entry exists and is selected
  ensureDefaultEntry();

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

  const bindEntrySetting = (setter: (entry: TimeAdjustmentEntry) => void) => {
    const entry = currentEntry();
    if (!entry) return;
    setter(entry);
    scheduleTrendRender();
  };

  els.groupBySelect.addEventListener('change', () => bindEntrySetting((entry) => {
    entry.groupByField = els.groupBySelect.value || null;
    // Update chart group value dropdown when group by field changes
    populateChartGroupSelect(entry.groupByField);
  }));
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

  els.chartModeSelect.addEventListener('change', () => {
    chartMode = els.chartModeSelect.value as 'improved' | 'vacant';
    // Update outlier table headers to match current chart mode
    const sizeLabel = chartMode === 'vacant' ? 'Land size' : 'Improved size';
    els.sizeHeader.textContent = sizeLabel;
    els.ratioHeader.textContent = `Price/${sizeLabel}`;
    scheduleTrendRender();
  });

  els.chartGroupSelect.addEventListener('change', () => {
    chartGroupValue = els.chartGroupSelect.value;
    scheduleTrendRender();
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
