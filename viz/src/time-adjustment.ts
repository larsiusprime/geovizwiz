import { S } from './state';
import type { TimeAdjustmentEntry, TimeAdjustmentGranularity, TimeAdjustmentMethod, TimeAdjustmentDisplayMode } from './types';

type Elements = {
  panel: HTMLDivElement;
  salePriceField: HTMLSelectElement;
  improvedFilterField: HTMLSelectElement;
  improvedSizeField: HTMLSelectElement;
  vacantFilterField: HTMLSelectElement;
  landSizeField: HTMLSelectElement;
  entriesToggle: HTMLButtonElement;
  entriesBody: HTMLDivElement;
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
};

let els: Elements;
let pendingTrendTimer: number | null = null;
let lastDeleted: TimeAdjustmentEntry | null = null;

type SalePoint = {
  date: Date;
  value: number;
  rawPrice: number;
  rawSize: number | null;
  outlier: boolean;
};

type GroupedPoints = Array<{ key: string; values: number[]; dates: Date[] }>;

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
  if (!first) return [];
  return Object.keys(first);
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
}

function currentEntry(): TimeAdjustmentEntry | null {
  if (!S.currentTimeAdjustmentEntryId) return null;
  return S.timeAdjustmentEntries.find((entry) => entry.id === S.currentTimeAdjustmentEntryId) ?? null;
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
  if (previous && fields.includes(previous)) {
    select.value = previous;
  }
}

function refreshFieldOptions() {
  const n = numericFields();
  const c = categoricalFields();
  populateSelect(els.salePriceField, n, 'sale price');
  populateSelect(els.improvedSizeField, n, 'bldg sqft');
  populateSelect(els.landSizeField, n, 'land sqft');
  populateSelect(els.improvedFilterField, c, 'conditions');
  populateSelect(els.vacantFilterField, c, 'conditions');
  populateSelect(els.groupBySelect, c, 'group', true);
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
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
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
      for (let j = col; j <= n; j += 1) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }
  return a.map((row) => row[n]);
}

function regressionFactors(grouped: Array<{ key: string; values: number[] }>, baselineKey: string): Record<string, number> {
  const groups = grouped.filter((item) => item.values.length > 0);
  const baselineIdx = groups.findIndex((item) => item.key === baselineKey);
  if (baselineIdx < 0 || groups.length < 2) {
    return Object.fromEntries(groups.map((item) => [item.key, median(item.values)]));
  }

  const keys = groups.map((item) => item.key);
  const columns = keys.filter((key) => key !== baselineKey);
  const xRows: number[][] = [];
  const y: number[] = [];

  groups.forEach((group) => {
    group.values.forEach((value) => {
      if (value <= 0) return;
      const row = [1, ...columns.map((key) => (key === group.key ? 1 : 0))];
      xRows.push(row);
      y.push(Math.log(value));
    });
  });

  const p = columns.length + 1;
  if (xRows.length <= p) {
    return Object.fromEntries(groups.map((item) => [item.key, median(item.values)]));
  }

  const xtx = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
  const xty = Array.from({ length: p }, () => 0);
  xRows.forEach((row, i) => {
    for (let a = 0; a < p; a += 1) {
      xty[a] += row[a] * y[i];
      for (let b = 0; b < p; b += 1) {
        xtx[a][b] += row[a] * row[b];
      }
    }
  });
  const beta = linearSolve(xtx, xty);
  if (!beta) {
    return Object.fromEntries(groups.map((item) => [item.key, median(item.values)]));
  }
  const output: Record<string, number> = { [baselineKey]: Math.exp(beta[0]) };
  columns.forEach((key, idx) => {
    output[key] = Math.exp(beta[0] + beta[idx + 1]);
  });
  return output;
}

function computeSales(entry: TimeAdjustmentEntry): { points: SalePoint[]; grouped: GroupedPoints } {
  ensureDefaults(entry);
  const start = entry.startDate ? parseDate(entry.startDate) : null;
  const valuation = entry.valuationDate ? parseDate(entry.valuationDate) : null;
  if (!start || !valuation || !S.currentGeoJSON) {
    return { points: [], grouped: [] };
  }

  const dateField = entry.dateField || 'sale_date';
  const priceField = S.timeAdjustmentSettings.salePriceField;
  const improvedSizeField = S.timeAdjustmentSettings.improvedSizeField;
  const landSizeField = S.timeAdjustmentSettings.landSizeField;
  const improvedFilterField = S.timeAdjustmentSettings.improvedFilterField;
  const vacantFilterField = S.timeAdjustmentSettings.vacantFilterField;

  const points: SalePoint[] = S.currentGeoJSON.features.flatMap((feature: GeoJSON.Feature) => {
    const props = feature.properties ?? {};
    const date = parseDate(props[dateField]);
    if (!date || date < start || date > valuation) return [];

    const rawPrice = safeNum(props[priceField]);
    if (rawPrice === null) return [];

    const isImproved = improvedFilterField ? Boolean(props[improvedFilterField]) : true;
    const isVacant = vacantFilterField ? Boolean(props[vacantFilterField]) : !isImproved;

    const sizeRaw = entry.displayMode === 'vacant' ? safeNum(props[landSizeField]) : safeNum(props[improvedSizeField]);
    const sizeForRatio = sizeRaw ?? 1;
    const ratio = sizeForRatio === 0 ? null : rawPrice / sizeForRatio;

    const outlierPrice = (entry.outlierPriceLow !== null && entry.outlierPriceLow !== undefined && rawPrice < entry.outlierPriceLow)
      || (entry.outlierPriceHigh !== null && entry.outlierPriceHigh !== undefined && rawPrice > entry.outlierPriceHigh);
    const outlierSize = (sizeRaw !== null) && ((entry.outlierSizeLow !== null && entry.outlierSizeLow !== undefined && sizeRaw < entry.outlierSizeLow)
      || (entry.outlierSizeHigh !== null && entry.outlierSizeHigh !== undefined && sizeRaw > entry.outlierSizeHigh));
    const outlierRatio = (ratio !== null) && ((entry.outlierRatioLow !== null && entry.outlierRatioLow !== undefined && ratio < entry.outlierRatioLow)
      || (entry.outlierRatioHigh !== null && entry.outlierRatioHigh !== undefined && ratio > entry.outlierRatioHigh));

    const useMode = entry.displayMode === 'vacant' ? isVacant : isImproved;
    if (!useMode) return [];

    return [{ date, value: ratio ?? rawPrice, rawPrice, rawSize: sizeRaw, outlier: outlierPrice || outlierSize || outlierRatio }];
  });

  const groupedMap = new Map<string, { values: number[]; dates: Date[] }>();
  points.forEach((point: SalePoint) => {
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
  const minSample = entry.minSample;
  const eligible = grouped.filter((group) => group.values.length >= minSample);
  if (!eligible.length) return [] as Array<{ key: string; factor: number }>;

  const baseline = eligible.reduce((best, group) => (group.values.length > best.values.length ? group : best), eligible[0]).key;

  let rawFactors: Record<string, number> = {};
  if (entry.method === 'mean') {
    rawFactors = Object.fromEntries(eligible.map((group) => [group.key, mean(group.values)]));
  } else if (entry.method === 'regression') {
    rawFactors = regressionFactors(eligible.map((g) => ({ key: g.key, values: g.values })), baseline);
  } else {
    rawFactors = Object.fromEntries(eligible.map((group) => [group.key, median(group.values)]));
  }

  const valuationDate = parseDate(entry.valuationDate);
  const valuationKey = valuationDate ? formatPeriodLabel(valuationDate, entry.granularity === 'peak' ? 'month' : entry.granularity) : eligible[eligible.length - 1].key;
  const anchor = rawFactors[valuationKey] ?? rawFactors[eligible[eligible.length - 1].key] ?? 1;
  const normalized = eligible.map((group) => ({ key: group.key, factor: anchor === 0 ? 1 : (rawFactors[group.key] ?? 1) / anchor }));

  if (entry.granularity !== 'peak' || normalized.length <= 2) return normalized;
  const jan = normalized[0];
  const dec = normalized[normalized.length - 1];
  const peak = normalized.reduce((best, curr) => (curr.factor > best.factor ? curr : best), normalized[0]);
  return [jan, peak, dec];
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
  }, 600);
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

  const xOutlier: string[] = [];
  const yOutlier: number[] = [];
  const xInlier: string[] = [];
  const yInlier: number[] = [];

  points.forEach((point: SalePoint) => {
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
    marker: { size: 6, color: '#1f2937' }
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
      x: trend.map((t) => t.key),
      y: trend.map((t) => t.factor),
      yaxis: 'y2',
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Trend factor',
      line: { color: '#2563eb', width: 2 },
      marker: { size: 6 }
    });
  }

  const layout: any = {
    margin: { l: 42, r: 42, t: 20, b: 42 },
    showlegend: true,
    xaxis: { title: 'Time period' },
    yaxis: { title: 'Sale price' },
    yaxis2: { title: 'Factor', overlaying: 'y', side: 'right', tickformat: '.2f' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)'
  };

  plotly.react(els.chart, traces, layout, { displayModeBar: false, responsive: true });
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
    <div class="time-adjustment-entry-head"><strong>Name:</strong> ${entry.name} <button type="button" data-role="delete" class="land-schedule-button" style="padding:2px 6px;">❌</button></div>
    <label>Start: <input type="date" data-role="start" value="${entry.startDate ?? ''}" /></label>
    <label>Valuation date: <input type="date" data-role="valuation" value="${entry.valuationDate ?? ''}" /></label>
    <label>Date field: <input type="text" data-role="dateField" value="${entry.dateField ?? 'sale_date'}" /></label>
    <div class="divider"></div>
    <div style="display:grid; gap:8px; ${entry.startDate && entry.valuationDate ? '' : 'opacity:.5; pointer-events:none;'}">
      <div>Sales in sample: <strong id="timeAdjustmentSampleInEntry">0</strong></div>
    </div>
  `;

  const deleteBtn = els.entryDetails.querySelector('[data-role="delete"]') as HTMLButtonElement;
  deleteBtn.addEventListener('click', () => {
    lastDeleted = { ...entry };
    S.timeAdjustmentEntries = S.timeAdjustmentEntries.filter((item) => item.id !== entry.id);
    S.currentTimeAdjustmentEntryId = S.timeAdjustmentEntries[0]?.id ?? null;
    render();
  });

  const startInput = els.entryDetails.querySelector('[data-role="start"]') as HTMLInputElement;
  const valuationInput = els.entryDetails.querySelector('[data-role="valuation"]') as HTMLInputElement;
  const dateFieldInput = els.entryDetails.querySelector('[data-role="dateField"]') as HTMLInputElement;

  startInput.addEventListener('change', () => {
    entry.startDate = startInput.value || null;
    scheduleTrendRender();
  });
  valuationInput.addEventListener('change', () => {
    entry.valuationDate = valuationInput.value || null;
    scheduleTrendRender();
  });
  dateFieldInput.addEventListener('change', () => {
    entry.dateField = dateFieldInput.value || 'sale_date';
    scheduleTrendRender();
  });
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

  // Daily interpolation export (not zipped without extra dependency)
  const days: string[] = [];
  const start = parseDate(entry.startDate);
  const end = parseDate(entry.valuationDate);
  if (start && end) {
    const sorted = [...trend].sort((a, b) => a.key.localeCompare(b.key));
    const dayMs = 24 * 60 * 60 * 1000;
    for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
      const d = new Date(t);
      const key = formatPeriodLabel(d, entry.granularity === 'peak' ? 'month' : entry.granularity);
      const exact = sorted.find((item) => item.key === key)?.factor ?? sorted[sorted.length - 1].factor;
      days.push(`${toDateInput(d)},${exact.toFixed(6)}`);
    }
    const daily = new Blob([`Day,Factor\n${days.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const dailyA = document.createElement('a');
    dailyA.href = URL.createObjectURL(daily);
    dailyA.download = `${entry.name}_time_adjustment_daily.csv`;
    dailyA.click();
    URL.revokeObjectURL(dailyA.href);
  }

  window.alert('CSV files were exported separately. Zip packaging and Excel workbook export require adding a dedicated library.');
}

function render() {
  refreshFieldOptions();
  renderEntrySelect();
  bindEntryDetails();

  const entry = currentEntry();
  if (entry) {
    ensureDefaults(entry);
    els.displaySelect.value = entry.displayMode;
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

  scheduleTrendRender();
}

function parseOptionalNumeric(input: HTMLInputElement): number | null {
  if (!input.value.trim()) return null;
  const n = Number(input.value);
  return Number.isFinite(n) ? n : null;
}

export function initTimeAdjustmentElements(elements: Elements) {
  els = elements;

  els.entriesToggle.addEventListener('click', () => {
    const collapsed = els.entriesBody.style.display === 'none';
    els.entriesBody.style.display = collapsed ? 'grid' : 'none';
    els.entriesToggle.textContent = collapsed ? '▼ Time Adjustments' : '▶ Time Adjustments';
  });

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
  els.improvedFilterField.addEventListener('change', () => {
    S.timeAdjustmentSettings.improvedFilterField = els.improvedFilterField.value;
    scheduleTrendRender();
  });
  els.vacantFilterField.addEventListener('change', () => {
    S.timeAdjustmentSettings.vacantFilterField = els.vacantFilterField.value;
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

  const bindEntrySetting = (fn: (entry: TimeAdjustmentEntry) => void) => {
    const entry = currentEntry();
    if (!entry) return;
    fn(entry);
    scheduleTrendRender();
  };

  els.displaySelect.addEventListener('change', () => bindEntrySetting((entry) => {
    entry.displayMode = els.displaySelect.value as TimeAdjustmentDisplayMode;
  }));
  els.groupBySelect.addEventListener('change', () => bindEntrySetting((entry) => {
    entry.groupByField = els.groupBySelect.value || null;
  }));
  els.granularitySelect.addEventListener('change', () => bindEntrySetting((entry) => {
    entry.granularity = els.granularitySelect.value as TimeAdjustmentGranularity;
  }));
  els.methodSelect.addEventListener('change', () => bindEntrySetting((entry) => {
    entry.method = els.methodSelect.value as TimeAdjustmentMethod;
  }));
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
