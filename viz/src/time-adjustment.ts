import { S } from './state';
import { cloneFilters, setFiltersContext } from './filters';
import type {
  FilterRule,
  TimeAdjustmentEntry,
  TimeAdjustmentGranularity,
  TimeAdjustmentMethod,
} from './types';
import { downloadCsvZip, downloadXlsx } from './utils.export';

const FILTER_ICON = new URL('./svg/filters.svg', import.meta.url).href;

type Elements = {
  panel: HTMLDivElement;
  showFiltersPanel: () => void;
  dataSourceSelect: HTMLSelectElement;
  // Date range inputs
  startInput: HTMLInputElement;
  valuationInput: HTMLInputElement;
  // Trend section
  trendToggle: HTMLButtonElement;
  trendBody: HTMLDivElement;
  sampleCount: HTMLSpanElement;
  groupBySelect: HTMLSelectElement;
  chartGroupSelect: HTMLSelectElement;
  granularitySelect: HTMLSelectElement;
  methodSelect: HTMLSelectElement;
  chartModeSelect: HTMLSelectElement;
  chart: HTMLDivElement;
  yAxisControl: HTMLDivElement;
  yMaxInput: HTMLInputElement;
  yMaxSlider: HTMLInputElement;
  spinner: HTMLDivElement;
  chartMessage: HTMLDivElement;
  exportCsvButton: HTMLButtonElement;
  exportExcelButton: HTMLButtonElement;
  // Filters section
  filtersToggle: HTMLButtonElement;
  filtersBody: HTMLDivElement;
  includeButton: HTMLButtonElement;
  excludeButton: HTMLButtonElement;
  priceLowInput: HTMLInputElement;
  priceHighInput: HTMLInputElement;
  sizeLowInput: HTMLInputElement;
  sizeHighInput: HTMLInputElement;
  ratioLowInput: HTMLInputElement;
  ratioHighInput: HTMLInputElement;
  minSampleInput: HTMLInputElement;
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
let chartMode: 'improved' | 'vacant' = 'improved';
let chartGroupValue: string = ''; // empty string means "(All)"
let hasAutoTriggeredTrend = false; // Track if we've auto-clicked "Plot trend" on first load
let naturalYMin = 0;
let naturalYMax = 100;
let displayedYMax: number | null = null;
let hasCustomYMax = false;

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}


function getEligibleTimeAdjustmentStores() {
  const stores = Array.from(S.dataStores.values()).filter((store) => (
    Boolean(store.geojson?.features?.length)
    && Boolean(store.salePriceField)
    && Boolean(store.saleDateField)
  ));
  return stores;
}

function getSelectedTimeAdjustmentStore() {
  const stores = getEligibleTimeAdjustmentStores();
  if (!stores.length) return null;

  const selectedId = S.timeAdjustmentSettings.dataSourceId;
  const selected = selectedId ? stores.find((store) => store.id === selectedId) ?? null : null;
  const resolved = selected ?? stores[0];

  if (S.timeAdjustmentSettings.dataSourceId !== resolved.id) {
    S.timeAdjustmentSettings.dataSourceId = resolved.id;
  }

  if (resolved.salePriceField) S.timeAdjustmentSettings.salePriceField = resolved.salePriceField;
  if (resolved.saleDateField) S.timeAdjustmentSettings.saleDateField = resolved.saleDateField;

  return resolved;
}

function currentGeoJSONForTimeAdjustment(): GeoJSON.FeatureCollection | null {
  return getSelectedTimeAdjustmentStore()?.geojson ?? null;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatYAxisValue(value: number): string {
  const abs = Math.abs(value);
  const compact = (divisor: number, suffix: string) => `${(value / divisor).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}${suffix}`;
  if (abs >= 1_000_000_000) return compact(1_000_000_000, 'B');
  if (abs >= 1_000_000) return compact(1_000_000, 'M');
  if (abs >= 1_000) return compact(1_000, 'K');
  if (abs >= 100) return value.toFixed(1).replace(/\.0$/, '');
  if (abs >= 10) return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return value.toFixed(3).replace(/\.000$/, '').replace(/(\.\d\d)0$/, '$1');
}

function parseYAxisValue(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const match = trimmed.match(/^(-?\d*\.?\d+)\s*([kmb])?$/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = (match[2] ?? '').toUpperCase();
  if (suffix === 'K') return base * 1_000;
  if (suffix === 'M') return base * 1_000_000;
  if (suffix === 'B') return base * 1_000_000_000;
  return base;
}

function syncYAxisControls() {
  if (!els) return;
  els.yMaxSlider.min = String(naturalYMin);
  els.yMaxSlider.max = String(naturalYMax);
  const safeYMax = displayedYMax ?? naturalYMax;
  els.yMaxSlider.value = String(safeYMax);
  els.yMaxInput.min = String(naturalYMin);
  els.yMaxInput.max = String(naturalYMax);
  els.yMaxInput.value = formatYAxisValue(safeYMax);
  const disabled = naturalYMax <= naturalYMin;
  els.yAxisControl.style.display = disabled ? 'none' : 'flex';
  els.yMaxSlider.disabled = disabled;
  els.yMaxInput.disabled = disabled;
}

function applyDisplayedYMax(raw: number, rerender = true) {
  const next = clamp(raw, naturalYMin, naturalYMax);
  displayedYMax = Number.isFinite(next) ? next : naturalYMax;
  hasCustomYMax = true;
  syncYAxisControls();
  if (rerender) renderChart();
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
  const geojson = currentGeoJSONForTimeAdjustment();
  if (!geojson?.features?.length) return { min: null, max: null };

  let min: Date | null = null;
  let max: Date | null = null;

  for (const feature of geojson.features) {
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

  const selectedStore = getSelectedTimeAdjustmentStore();
  const dateField = selectedStore?.saleDateField || entry.dateField || 'sale_date';
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
  const first = currentGeoJSONForTimeAdjustment()?.features?.[0]?.properties;
  return first ? Object.keys(first) : [];
}

function numericFields(): string[] {
  const fields = getAllFields();
  const geojson = currentGeoJSONForTimeAdjustment();
  if (!geojson?.features?.length) return [];
  return fields.filter((field) => geojson.features.some((feature: GeoJSON.Feature) => safeNum(feature.properties?.[field]) !== null));
}

function categoricalFields(): string[] {
  const fields = getAllFields();
  const geojson = currentGeoJSONForTimeAdjustment();
  if (!geojson?.features?.length) return [];
  return fields.filter((field) => geojson.features.some((feature: GeoJSON.Feature) => typeof feature.properties?.[field] === 'string'));
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
  const geojson = currentGeoJSONForTimeAdjustment();
  if (!groupByField || !geojson?.features?.length) return [];
  const values = new Set<string>();
  for (const feature of geojson.features) {
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
  const store = getSelectedTimeAdjustmentStore();
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


function refreshDataSourceSelect() {
  const stores = getEligibleTimeAdjustmentStores();
  const previous = S.timeAdjustmentSettings.dataSourceId;
  els.dataSourceSelect.replaceChildren();

  if (!stores.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No eligible source';
    els.dataSourceSelect.append(empty);
    els.dataSourceSelect.disabled = true;
    S.timeAdjustmentSettings.dataSourceId = '';
    return;
  }

  stores.forEach((store) => {
    const option = document.createElement('option');
    option.value = store.id;
    option.textContent = store.name;
    els.dataSourceSelect.append(option);
  });

  els.dataSourceSelect.disabled = false;

  const preferred = previous && stores.some((store) => store.id === previous)
    ? previous
    : stores[0].id;
  els.dataSourceSelect.value = preferred;
  S.timeAdjustmentSettings.dataSourceId = preferred;
  getSelectedTimeAdjustmentStore();
}

function refreshFieldOptions() {
  refreshDataSourceSelect();
  const categorical = categoricalFields();

  // Prefill from metadata if fields are empty
  prefillFromMetadata();

  populateSelect(els.groupBySelect, categorical, 'group', true);
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

  const geojson = currentGeoJSONForTimeAdjustment();
  const store = getSelectedTimeAdjustmentStore();

  if (!start || !valuation || !geojson || !store) {
    return { points: [], grouped: [] };
  }

  const dateField = store.saleDateField || entry.dateField || 'sale_date';
  const priceField = store.salePriceField || S.timeAdjustmentSettings.salePriceField;
  const improvedSizeField = store.bldgSizeField || S.timeAdjustmentSettings.improvedSizeField;
  const landSizeField = store.landSizeField || S.timeAdjustmentSettings.landSizeField;

  // Use chart-specific filters if provided, otherwise use entry defaults
  const effectiveMode = chartFilters?.mode ?? entry.displayMode;
  const groupField = chartFilters?.groupField ?? entry.groupByField;
  const groupValue = chartFilters?.groupValue ?? '';

  const points: SalePoint[] = geojson.features.flatMap((feature: GeoJSON.Feature) => {
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
  const store = getSelectedTimeAdjustmentStore();
  if (!store?.salePriceField || !store.saleDateField) {
    warnings.push('Select a data source with sale price/date fields');
  }
  if (!entry.startDate || !entry.valuationDate) {
    warnings.push('Start and valuation dates required');
  }
  if (!currentGeoJSONForTimeAdjustment()?.features?.length) {
    warnings.push('No eligible data source loaded');
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
    marker: { size: 4, opacity: 0.1, color: '#1f2937' }
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

  const allYValues = [...yInlier, ...yOutlier, ...trendItems.map((t) => t.rawValue)].filter((value) => Number.isFinite(value));
  const nonZeroValues = allYValues.filter((value) => value !== 0);
  const dataMin = allYValues.length ? Math.min(...allYValues) : 0;
  const dataMax = allYValues.length ? Math.max(...allYValues) : 100;
  const bufferedMax = dataMax > 0 ? dataMax * 1.1 : dataMax + Math.max(10, Math.abs(dataMax) * 0.1);
  const lowestNonZero = nonZeroValues.length ? Math.min(...nonZeroValues) : 1;

  // Slider lower bound should be the lowest non-zero data point.
  naturalYMin = lowestNonZero;
  naturalYMax = Math.max(naturalYMin + 1, bufferedMax, dataMax, naturalYMin + 0.001);
  if (!hasCustomYMax || displayedYMax == null) {
    displayedYMax = naturalYMax;
  } else {
    displayedYMax = clamp(displayedYMax, naturalYMin, naturalYMax);
  }
  syncYAxisControls();

  // Graph lower bound should be 0 for non-negative data, but allow negatives when present.
  const graphYMin = dataMin < 0 ? dataMin : 0;
  const yRange: [number, number] = [graphYMin, displayedYMax];

  // Y-axis label depends on mode
  const sizeUnit = chartMode === 'vacant' ? 'land sqft' : 'bldg sqft';
  const yAxisLabel = `Price / ${sizeUnit}`;

  // Collect all unique x categories and sort them chronologically
  const allCategories = new Set<string>([...xInlier, ...xOutlier]);
  trendItems.forEach((t) => allCategories.add(t.key));
  const sortedCategories = Array.from(allCategories).sort();

  const layout: Record<string, any> = {
    autosize: true,
    margin: { l: 96, r: 30, t: 14, b: 40 },
    xaxis: {
      title: 'Time period',
      automargin: true,
      fixedrange: true,
      categoryorder: 'array',
      categoryarray: sortedCategories,
    },
    yaxis: { title: yAxisLabel, range: yRange, rangemode: 'tozero', fixedrange: true },
    showlegend: false,
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
  if (!entry) return;

  ensureDefaults(entry);

  // Prefill dates from data if not already set
  prefillEntryDates(entry);

  // Update static date inputs
  els.startInput.value = entry.startDate ?? '';
  els.valuationInput.value = entry.valuationDate ?? '';

  // Update Include/Exclude buttons
  updateConditionsButton(els.includeButton, entry.includeFilters);
  updateConditionsButton(els.excludeButton, entry.excludeFilters);
}

function parseOptionalNumeric(input: HTMLInputElement): number | null {
  if (!input.value.trim()) return null;
  const n = Number(input.value);
  return Number.isFinite(n) ? n : null;
}

function buildExportFilename(entry: TimeAdjustmentEntry, suffix?: string): string {
  let filename = 'time_adjustment';

  // Add group field and value if filtering by group
  if (entry.groupByField && chartGroupValue) {
    const safeField = entry.groupByField.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeValue = chartGroupValue.replace(/[^a-zA-Z0-9_-]/g, '_');
    filename += `_${safeField}_${safeValue}`;
  }

  // Add mode (improved/vacant)
  filename += `_${chartMode}`;

  // Add optional suffix (e.g., "_daily")
  if (suffix) {
    filename += suffix;
  }

  return filename;
}

type ExportRow = {
  period: string;
  startIndexed: number;
  endIndexed: number;
  correctionFactor: number;
};

type ExportData = {
  header: string;
  mainRows: ExportRow[];
  dailyRows: ExportRow[];
};

function generateExportData(entry: TimeAdjustmentEntry): ExportData | null {
  const chartFilters: ChartFilters = {
    mode: chartMode,
    groupField: entry.groupByField,
    groupValue: chartGroupValue,
  };

  const { grouped } = computeSales(entry, chartFilters);
  const trendResult = computeTrend(entry, grouped);
  const trend = trendResult.items;

  if (!trend.length) return null;

  const header = entry.granularity === 'year' ? 'Year' : entry.granularity === 'quarter' ? 'Quarter' : 'Month';

  const sortedTrend = [...trend].sort((a, b) => a.key.localeCompare(b.key));
  const earliestFactor = sortedTrend[0]?.factor ?? 1;
  const latestFactor = sortedTrend[sortedTrend.length - 1]?.factor ?? 1;

  const mapRow = (period: string, factor: number): ExportRow => {
    const startIndexed = earliestFactor === 0 ? 1 : factor / earliestFactor;
    const endIndexed = latestFactor === 0 ? 1 : factor / latestFactor;
    const correctionFactor = endIndexed === 0 ? 1 : 1 / endIndexed;

    return {
      period,
      startIndexed,
      endIndexed,
      correctionFactor,
    };
  };

  const mainRows = sortedTrend.map((item) => mapRow(item.key, item.factor));

  // Build daily data with interpolation
  const dailyRows: ExportRow[] = [];
  const start = parseDate(entry.startDate);
  const end = parseDate(entry.valuationDate);

  if (start && end) {
    const granularity = entry.granularity === 'peak' ? 'month' : entry.granularity;
    const sortedWithMidpoints: TrendItemWithMidpoint[] = sortedTrend
      .map((item) => ({
        key: item.key,
        factor: item.factor,
        midpoint: periodMidpoint(item.key, granularity),
      }));

    const step = 24 * 60 * 60 * 1000;
    for (let t = start.getTime(); t <= end.getTime(); t += step) {
      const d = new Date(t);
      const factor = interpolateFactor(d, sortedWithMidpoints);
      dailyRows.push(mapRow(toDateInput(d), factor));
    }
  }

  return { header, mainRows, dailyRows };
}

async function exportCsvZip(entry: TimeAdjustmentEntry) {
  const data = generateExportData(entry);
  if (!data) {
    window.alert('No trend data to export.');
    return;
  }

  const baseFilename = buildExportFilename(entry);

  // Build CSV strings
  const mainCsv = `${data.header},start_indexed,end_indexed,correction_factor\n${data.mainRows.map((r) => `${r.period},${r.startIndexed.toFixed(6)},${r.endIndexed.toFixed(6)},${r.correctionFactor.toFixed(6)}`).join('\n')}`;
  const dailyCsv = `Day,start_indexed,end_indexed,correction_factor\n${data.dailyRows.map((r) => `${r.period},${r.startIndexed.toFixed(6)},${r.endIndexed.toFixed(6)},${r.correctionFactor.toFixed(6)}`).join('\n')}`;

  await downloadCsvZip(`${baseFilename}.zip`, [
    { name: `${baseFilename}.csv`, content: mainCsv },
    { name: `${baseFilename}_daily.csv`, content: dailyCsv },
  ]);
}

function exportExcel(entry: TimeAdjustmentEntry) {
  const data = generateExportData(entry);
  if (!data) {
    window.alert('No trend data to export.');
    return;
  }

  const baseFilename = buildExportFilename(entry);

  const mainData = [[data.header, 'start_indexed', 'end_indexed', 'correction_factor'], ...data.mainRows.map((r) => [r.period, r.startIndexed, r.endIndexed, r.correctionFactor])];
  const dailyData = [['Day', 'start_indexed', 'end_indexed', 'correction_factor'], ...data.dailyRows.map((r) => [r.period, r.startIndexed, r.endIndexed, r.correctionFactor])];

  downloadXlsx(`${baseFilename}.xlsx`, [
    { name: 'Period', aoa: mainData },
    { name: 'Daily', aoa: dailyData },
  ]);
}

function render() {
  refreshFieldOptions();
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
  }

  const sizeLabel = chartMode === 'vacant' ? 'Land size' : 'Improved size';
  els.sizeHeader.textContent = sizeLabel;
  els.ratioHeader.textContent = `Price/${sizeLabel}`;

  // Populate chart-specific dropdowns
  els.dataSourceSelect.value = S.timeAdjustmentSettings.dataSourceId;
  els.chartModeSelect.value = chartMode;
  populateChartGroupSelect(entry?.groupByField ?? null);

  scheduleTrendRender();
}

export function initTimeAdjustmentElements(elements: Elements) {
  els = elements;

  // Ensure a default entry exists and is selected
  ensureDefaultEntry();

  // Note: Collapse toggle event listeners are handled in main.ts for consistency

  // Set up filter icon images
  const includeIcon = els.includeButton.querySelector('img');
  const excludeIcon = els.excludeButton.querySelector('img');
  if (includeIcon) includeIcon.src = FILTER_ICON;
  if (excludeIcon) excludeIcon.src = FILTER_ICON;

  // Date input listeners
  els.startInput.addEventListener('change', () => {
    const entry = currentEntry();
    if (entry) {
      entry.startDate = els.startInput.value || null;
      scheduleTrendRender();
    }
  });

  els.valuationInput.addEventListener('change', () => {
    const entry = currentEntry();
    if (entry) {
      entry.valuationDate = els.valuationInput.value || null;
      scheduleTrendRender();
    }
  });

  // Include/Exclude filter buttons
  const entry = currentEntry();
  if (entry) {
    bindFilterButton(
      els.includeButton,
      `timeAdjustment:include`,
      `Time adjustment include filters`,
      () => currentEntry()?.includeFilters ?? [],
      () => currentEntry()?.includeFilterInvert ?? false,
      (filters, invert) => {
        const e = currentEntry();
        if (e) {
          e.includeFilters = cloneFilters(filters);
          e.includeFilterInvert = invert;
          updateConditionsButton(els.includeButton, e.includeFilters);
          scheduleTrendRender();
        }
      }
    );
    bindFilterButton(
      els.excludeButton,
      `timeAdjustment:exclude`,
      `Time adjustment exclude filters`,
      () => currentEntry()?.excludeFilters ?? [],
      () => currentEntry()?.excludeFilterInvert ?? false,
      (filters, invert) => {
        const e = currentEntry();
        if (e) {
          e.excludeFilters = cloneFilters(filters);
          e.excludeFilterInvert = invert;
          updateConditionsButton(els.excludeButton, e.excludeFilters);
          scheduleTrendRender();
        }
      }
    );
  }

  const bindEntrySetting = (setter: (entry: TimeAdjustmentEntry) => void) => {
    const entry = currentEntry();
    if (!entry) return;
    setter(entry);
    scheduleTrendRender();
  };


  els.dataSourceSelect.addEventListener('change', () => {
    S.timeAdjustmentSettings.dataSourceId = els.dataSourceSelect.value;
    getSelectedTimeAdjustmentStore();
    render();
  });

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

  const onYAxisInput = (value: string) => {
    const parsed = parseYAxisValue(value);
    if (!Number.isFinite(parsed)) return;
    applyDisplayedYMax(parsed);
  };

  els.yMaxSlider.addEventListener('input', () => onYAxisInput(els.yMaxSlider.value));
  els.yMaxInput.addEventListener('input', () => onYAxisInput(els.yMaxInput.value));
  els.yMaxInput.addEventListener('change', () => {
    const parsed = parseYAxisValue(els.yMaxInput.value);
    const fallback = displayedYMax ?? naturalYMax;
    applyDisplayedYMax(Number.isFinite(parsed) ? parsed : fallback, false);
    syncYAxisControls();
  });

  els.exportCsvButton.addEventListener('click', () => {
    const entry = currentEntry();
    if (!entry) return;
    exportCsvZip(entry);
  });

  els.exportExcelButton.addEventListener('click', () => {
    const entry = currentEntry();
    if (!entry) return;
    exportExcel(entry);
  });

  // Initial render to populate UI
  render();
}

export function refreshTimeAdjustmentPanel() {
  // Auto-trigger "Plot trend" on first load if there's valid data
  if (!hasAutoTriggeredTrend) {
    const entry = currentEntry();
    if (entry) {
      const warnings = getConfigWarnings(entry);
      // If no warnings (valid config), auto-enable trend
      if (warnings.length === 0) {
        hasAutoTriggeredTrend = true;
        entry.trendVisible = true;
      }
    }
  }
  render();
}
