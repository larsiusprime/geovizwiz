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
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function matchesFilters(props: Record<string, any>, filters: FilterRule[], invert: boolean): boolean {
  const active = filters.filter((filter) => filter.active);
  if (!active.length) return !invert;
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

function refreshFieldOptions() {
  const numeric = numericFields();
  const categorical = categoricalFields();
  populateSelect(els.salePriceField, numeric, 'sale price');
  populateSelect(els.improvedSizeField, numeric, 'bldg sqft');
  populateSelect(els.landSizeField, numeric, 'land sqft');
  populateSelect(els.groupBySelect, categorical, 'group', true);
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
  if (!start || !valuation || !S.currentGeoJSON) return { points: [], grouped: [] };

  const dateField = entry.dateField || 'sale_date';
  const priceField = S.timeAdjustmentSettings.salePriceField;
  const improvedSizeField = S.timeAdjustmentSettings.improvedSizeField;
  const landSizeField = S.timeAdjustmentSettings.landSizeField;

  const points: SalePoint[] = S.currentGeoJSON.features.flatMap((feature: GeoJSON.Feature) => {
    const props = (feature.properties ?? {}) as Record<string, any>;
    const date = parseDate(props[dateField]);
    if (!date || date < start || date > valuation) return [];

    const rawPrice = safeNum(props[priceField]);
    if (rawPrice === null) return [];

    const improved = matchesFilters(props, S.timeAdjustmentSettings.improvedFilters, S.timeAdjustmentSettings.improvedFilterInvert);
    const vacant = matchesFilters(props, S.timeAdjustmentSettings.vacantFilters, S.timeAdjustmentSettings.vacantFilterInvert);
    const modeMatch = entry.displayMode === 'vacant' ? vacant : improved;
    if (!modeMatch) return [];

    const includeMatch = matchesFilters(props, entry.includeFilters, entry.includeFilterInvert);
    const excludeMatch = matchesFilters(props, entry.excludeFilters, entry.excludeFilterInvert);
    if (!includeMatch || excludeMatch) return [];

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

function renderChart() {
  const plotly = getPlotly();
  if (!plotly) return;
  const entry = currentEntry();
  if (!entry) {
    plotly.purge(els.chart);
    els.sampleCount.textContent = '0';
    return;
  }

  const { points, grouped } = computeSales(entry);
  els.sampleCount.textContent = String(points.length);

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
    return;
  }
  ensureDefaults(entry);

  els.entryDetails.style.display = 'grid';
  els.entryDetails.innerHTML = `
    <div class="time-adjustment-row compact">
      <span class="time-adjustment-label-text">Start</span>
      <input type="date" data-role="start" value="${entry.startDate ?? ''}" />
      <span class="time-adjustment-label-text">Valuation date</span>
      <input type="date" data-role="valuation" value="${entry.valuationDate ?? ''}" />
    </div>
    <div class="time-adjustment-row">
      <span class="time-adjustment-label-text">Date field</span>
      <input type="text" data-role="dateField" value="${entry.dateField ?? 'sale_date'}" />
    </div>
    <div style="display:grid; gap:6px; ${entry.startDate && entry.valuationDate ? '' : 'opacity:.5; pointer-events:none;'}">
      <div class="time-adjustment-row six">
        <span class="time-adjustment-label-text">Include</span>
        <button type="button" data-role="include" class="land-table-filter time-adjustment-conditions"><img src="${FILTER_ICON}" alt="Filters" /> conditions</button>
        <span class="time-adjustment-label-text">Exclude</span>
        <button type="button" data-role="exclude" class="land-table-filter time-adjustment-conditions"><img src="${FILTER_ICON}" alt="Filters" /> conditions</button>
        <button type="button" data-role="delete" class="land-schedule-button" style="padding:2px 6px; justify-self:end;">❌</button>
        <span></span>
      </div>
    </div>
  `;

  const deleteBtn = els.entryDetails.querySelector('[data-role="delete"]') as HTMLButtonElement;
  deleteBtn.addEventListener('click', () => {
    lastDeleted = { ...entry, includeFilters: cloneFilters(entry.includeFilters), excludeFilters: cloneFilters(entry.excludeFilters) };
    S.timeAdjustmentEntries = S.timeAdjustmentEntries.filter((item) => item.id !== entry.id);
    S.currentTimeAdjustmentEntryId = S.timeAdjustmentEntries[0]?.id ?? null;
    render();
  });

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

function toggleSection(button: HTMLButtonElement, body: HTMLDivElement) {
  const collapsed = body.classList.toggle('is-hidden');
  button.classList.toggle('is-collapsed', collapsed);
  button.textContent = collapsed ? '▶' : '▼';
}

export function initTimeAdjustmentElements(elements: Elements) {
  els = elements;

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

  els.entriesToggle.addEventListener('click', () => toggleSection(els.entriesToggle, els.entriesBody));
  els.settingsToggle.addEventListener('click', () => toggleSection(els.settingsToggle, els.settingsBody));
  els.dataToggle.addEventListener('click', () => toggleSection(els.dataToggle, els.dataBody));
  els.outliersToggle.addEventListener('click', () => toggleSection(els.outliersToggle, els.outliersBody));

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
}

export function refreshTimeAdjustmentPanel() {
  render();
}
