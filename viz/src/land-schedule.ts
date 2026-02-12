/**
 * Land-schedule panel logic extracted from main.ts.
 *
 * Manages land schedule tables and adjustments.
 */
import { S } from './state';
import { setFiltersContext, cloneFilters, invalidateFiltersContextIf } from './filters';
import type {
  FilterRule,
  LandScheduleAdjustment,
  LandScheduleAdjustmentOperation,
  LandScheduleAdjustmentSizeUnit,
  LandScheduleEntry,
  LandScheduleRow,
  LandScheduleTable,
  LandScheduleUnit,
  LandScheduleValueMode
} from './types';

const UNIT_OPTIONS: Array<{ value: LandScheduleUnit; label: string; header: string }> = [
  { value: 'sqft', label: 'area (sqft)', header: 'sqft' },
  { value: 'acre', label: 'area (acre)', header: 'acre' },
  { value: 'ft', label: 'frontage (ft)', header: 'ft' },
  { value: 'sqm', label: 'area (sqm)', header: 'sqm' },
  { value: 'hectare', label: 'area (hectare)', header: 'hectare' },
  { value: 'm', label: 'frontage (m)', header: 'm' },
];

const ADJUSTMENT_OPERATION_OPTIONS: Array<{ value: LandScheduleAdjustmentOperation; label: string }> = [
  { value: 'multiply', label: 'Multiply' },
  { value: 'add', label: 'Add' },
];

const ADJUSTMENT_UNIT_OPTIONS: Array<{ value: LandScheduleAdjustmentSizeUnit; label: string }> = [
  { value: 'per-improved-area', label: 'improved area' },
  { value: 'per-land-area', label: 'land area' },
  { value: 'per-frontage', label: 'frontage' },
  { value: 'per-pick-field', label: '(pick field)' },
  { value: 'flat', label: 'flat amount' },
];

const IMPROVED_AREA_UNITS = ['sqft', 'sqm'] as const;
const LAND_AREA_UNITS = ['sqft', 'sqm', 'acre', 'hectare'] as const;
const FRONTAGE_UNITS = [
  { value: 'front-foot', label: 'foot' },
  { value: 'front-meter', label: 'meter' },
] as const;

const FILTER_ICON = new URL('./svg/filters.svg', import.meta.url).href;

/* ------------------------------------------------------------------ */
/*  DOM element references (set once via initLandScheduleElements)     */
/* ------------------------------------------------------------------ */

let landScheduleTableSelect: HTMLSelectElement;
let landScheduleTableSelectRow: HTMLDivElement;
let landScheduleAddTableButton: HTMLButtonElement;
let landScheduleTableContainer: HTMLDivElement;
let landScheduleCurveSection: HTMLDivElement;
let landScheduleCurveChart: HTMLDivElement;
let landScheduleTablesSection: HTMLDivElement;
let landScheduleAdjustmentsSection: HTMLDivElement;
let landScheduleAdjustmentsContainer: HTMLDivElement;
let landScheduleAddAdjustmentButton: HTMLButtonElement;
let landScheduleFilterButton: HTMLButtonElement | null = null;

let showFiltersPanel: (() => void) | null = null;

export function initLandScheduleElements(els: {
  landScheduleTableSelect: HTMLSelectElement;
  landScheduleTableSelectRow: HTMLDivElement;
  landScheduleAddTableButton: HTMLButtonElement;
  landScheduleTableContainer: HTMLDivElement;
  landScheduleCurveSection: HTMLDivElement;
  landScheduleCurveChart: HTMLDivElement;
  landScheduleTablesSection: HTMLDivElement;
  landScheduleAdjustmentsSection: HTMLDivElement;
  landScheduleAdjustmentsContainer: HTMLDivElement;
  landScheduleAddAdjustmentButton: HTMLButtonElement;
}) {
  landScheduleTableSelect = els.landScheduleTableSelect;
  landScheduleTableSelectRow = els.landScheduleTableSelectRow;
  landScheduleAddTableButton = els.landScheduleAddTableButton;
  landScheduleTableContainer = els.landScheduleTableContainer;
  landScheduleCurveSection = els.landScheduleCurveSection;
  landScheduleCurveChart = els.landScheduleCurveChart;
  landScheduleTablesSection = els.landScheduleTablesSection;
  landScheduleAdjustmentsSection = els.landScheduleAdjustmentsSection;
  landScheduleAdjustmentsContainer = els.landScheduleAdjustmentsContainer;
  landScheduleAddAdjustmentButton = els.landScheduleAddAdjustmentButton;
}

export function initLandScheduleCallbacks(cbs: { showFiltersPanel?: () => void }) {
  showFiltersPanel = cbs.showFiltersPanel ?? null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getCurrentEntry(): LandScheduleEntry {
  if (!S.landScheduleStore) {
    S.landScheduleStore = {
      tables: [],
      activeTableId: null,
      adjustments: [],
    };
  }
  return S.landScheduleStore;
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function getDefaultAreaUnitForLabel(label: string | null, fallback: string) {
  const normalized = (label ?? '').toLowerCase();
  if (normalized.includes('meter')) return 'sqm';
  if (normalized.includes('hectare')) return 'hectare';
  if (normalized.includes('acre')) return 'acre';
  return fallback;
}

function getUnitDetailOptions(sizeUnit: LandScheduleAdjustmentSizeUnit): Array<{ value: string; label: string }> {
  if (sizeUnit === 'per-improved-area') {
    return IMPROVED_AREA_UNITS.map(unit => ({ value: unit, label: unit }));
  }
  if (sizeUnit === 'per-land-area') {
    return LAND_AREA_UNITS.map(unit => ({ value: unit, label: unit }));
  }
  if (sizeUnit === 'per-frontage') {
    return FRONTAGE_UNITS.map(unit => ({ value: unit.value, label: unit.label }));
  }
  if (sizeUnit === 'per-pick-field') {
    return S.chosenNumericFields.map(field => ({ value: field, label: field }));
  }
  return [];
}

function getDefaultUnitDetail(sizeUnit: LandScheduleAdjustmentSizeUnit) {
  if (sizeUnit === 'per-improved-area') {
    return getDefaultAreaUnitForLabel(S.bldgSizeUnitLabel, 'sqft');
  }
  if (sizeUnit === 'per-land-area') {
    return getDefaultAreaUnitForLabel(S.landSizeUnitLabel, 'sqft');
  }
  if (sizeUnit === 'per-frontage') {
    return 'front-foot';
  }
  if (sizeUnit === 'per-pick-field') {
    return S.chosenNumericFields[0] ?? null;
  }
  return null;
}

function normalizeLegacyAdjustmentSizeUnit(sizeUnit: LandScheduleAdjustmentSizeUnit | 'area' | 'frontage' | 'flat'): LandScheduleAdjustmentSizeUnit {
  if (sizeUnit === 'area') return 'per-land-area';
  if (sizeUnit === 'frontage') return 'per-frontage';
  return sizeUnit;
}

function setLandScheduleInputValue(input: HTMLInputElement, value: number | null) {
  input.value = value === null ? '' : String(value);
}

function getValueHeaderText(unit: LandScheduleUnit, mode: LandScheduleValueMode) {
  if (mode === 'flat') {
    return 'Value';
  }
  const option = UNIT_OPTIONS.find(opt => opt.value === unit);
  const suffix = option ? option.header : unit;
  if (mode === 'per-unit-marginal') {
    return `Value / ${suffix} (marginal)`;
  }
  return `Value / ${suffix}`;
}

function updateValueHeader(headerEl: HTMLElement, unit: LandScheduleUnit, mode: LandScheduleValueMode) {
  headerEl.textContent = getValueHeaderText(unit, mode);
}

function getPlotly(): any | null {
  return (window as any).Plotly ?? null;
}

function getUnitAxisLabel(unit: LandScheduleUnit) {
  const option = UNIT_OPTIONS.find(opt => opt.value === unit);
  return option ? option.header : unit;
}

function getValueModeTooltip(unit: LandScheduleUnit, mode: LandScheduleValueMode) {
  const unitLabel = getUnitAxisLabel(unit);
  if (mode === 'flat') {
    return 'Lots within the size range are valued at exactly this';
  }
  if (mode === 'per-unit') {
    return `Lots within the size range are valued at (value/${unitLabel}) x (the lot's area)`;
  }
  return 'The size ranges work like marginal income tax brackets. So the first chunk of size is valued at the first rate, and then the next chunk of size bigger than that is valued at the next rate, and so on.';
}

function formatRangeValue(value: number | null) {
  return value === null ? '—' : String(value);
}

function updateRowTooltip(
  table: LandScheduleTable,
  row: LandScheduleRow,
  rowIndex: number,
  minInput: HTMLInputElement,
  maxInput: HTMLInputElement
) {
  const unitLabel = getUnitAxisLabel(table.unit);
  const minVal = formatRangeValue(row.min);
  const maxVal = formatRangeValue(row.max);
  const minQualifier = rowIndex === 0 ? 'greater than or equal to' : 'greater than';
  const text = `This row targets parcels ${minQualifier} ${minVal} ${unitLabel}s and less than or equal to ${maxVal} ${unitLabel}s.`;
  minInput.title = text;
  maxInput.title = text;
}

function updateAllRowTooltips(table: LandScheduleTable, tbody: HTMLTableSectionElement) {
  table.rows.forEach((row, index) => {
    const rowEl = tbody.querySelector(`tr[data-row-index="${index}"]`) as HTMLTableRowElement | null;
    const minInput = rowEl?.querySelector('[data-role="min"]') as HTMLInputElement | null;
    const maxInput = rowEl?.querySelector('[data-role="max"]') as HTMLInputElement | null;
    if (minInput && maxInput) {
      updateRowTooltip(table, row, index, minInput, maxInput);
    }
  });
}

function updateLandScheduleCurve(table: LandScheduleTable | null) {
  const plotly = getPlotly();
  if (!plotly || !landScheduleCurveChart) return;
  if (!table) {
    plotly.purge(landScheduleCurveChart);
    landScheduleCurveChart.replaceChildren();
    return;
  }

  const xValues = table.rows.map((row, index) => {
    const candidate = row.max ?? row.min ?? (index === 0 ? 0 : table.rows[index - 1]?.max ?? 0);
    return candidate ?? 0;
  });
  const yValues = table.rows.map(row => row.value ?? null);

  const trace = {
    x: xValues,
    y: yValues,
    mode: 'lines+markers',
    type: 'scatter',
    line: { color: '#3b82f6' },
    marker: { size: 6, color: '#1f2937' },
    hovertemplate: 'x: %{x}<br>y: %{y}<extra></extra>',
  };

  const xAxisLabel = getUnitAxisLabel(table.unit);
  const layout = {
    margin: { l: 40, r: 16, t: 10, b: 36 },
    xaxis: { title: xAxisLabel, fixedrange: true, zeroline: false },
    yaxis: { title: getValueHeaderText(table.unit, table.valueMode), fixedrange: true, zeroline: false },
    dragmode: false,
    showlegend: false,
    hovermode: 'closest',
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  };
  const config = {
    displayModeBar: false,
    responsive: true,
  };

  plotly.react(landScheduleCurveChart, [trace], layout, config);
}

function enforceRowBounds(
  table: LandScheduleTable,
  tbody: HTMLTableSectionElement,
  row: LandScheduleRow,
  maxInput: HTMLInputElement
) {
  if (row.min !== null && row.max !== null && row.max < row.min) {
    row.max = row.min;
    setLandScheduleInputValue(maxInput, row.max);
  }
  syncDerivedRowMins(table, tbody);
  updateLandScheduleCurve(table);
}

function hasActiveTableFilters(table: LandScheduleTable) {
  return table.filters.some(filter => filter.active);
}

function hasActiveAdjustmentFilters(adjustment: LandScheduleAdjustment) {
  return adjustment.filters.some(filter => filter.active);
}

function updateLandScheduleFilterButtonState(table: LandScheduleTable | null) {
  if (!landScheduleFilterButton) return;
  const isActive = table ? hasActiveTableFilters(table) : false;
  landScheduleFilterButton.classList.toggle('is-active', isActive);
  landScheduleFilterButton.classList.toggle('is-muted', !isActive);
}

function updateAdjustmentFilterButtonState(button: HTMLButtonElement, adjustment: LandScheduleAdjustment) {
  const isActive = hasActiveAdjustmentFilters(adjustment);
  button.classList.toggle('is-active', isActive);
  button.classList.toggle('is-muted', !isActive);
}

function createTableRow(table: LandScheduleTable, rowIndex: number, tbody: HTMLTableSectionElement) {
  const row = table.rows[rowIndex];
  const tr = document.createElement('tr');
  tr.dataset.rowIndex = String(rowIndex);

  const minTd = document.createElement('td');
  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.inputMode = 'decimal';
  minInput.dataset.role = 'min';
  if (rowIndex > 0) {
    minInput.disabled = true;
  }
  setLandScheduleInputValue(minInput, row.min);
  minTd.append(minInput);

  const maxTd = document.createElement('td');
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.inputMode = 'decimal';
  maxInput.dataset.role = 'max';
  setLandScheduleInputValue(maxInput, row.max);
  maxInput.addEventListener('input', () => {
    row.max = parseOptionalNumber(maxInput.value);
    updateLandScheduleCurve(table);
    updateRowTooltip(table, row, rowIndex, minInput, maxInput);
  });
  const settleMax = () => enforceRowBounds(table, tbody, row, maxInput);
  maxInput.addEventListener('blur', settleMax);
  maxInput.addEventListener('change', settleMax);
  maxTd.append(maxInput);

  minInput.addEventListener('input', () => {
    if (rowIndex !== 0) return;
    row.min = parseOptionalNumber(minInput.value);
    updateLandScheduleCurve(table);
    updateRowTooltip(table, row, rowIndex, minInput, maxInput);
  });
  const settleMin = () => {
    if (rowIndex !== 0) return;
    enforceRowBounds(table, tbody, row, maxInput);
  };
  minInput.addEventListener('blur', settleMin);
  minInput.addEventListener('change', settleMin);

  const valueTd = document.createElement('td');
  const valueInput = document.createElement('input');
  valueInput.type = 'number';
  valueInput.inputMode = 'decimal';
  valueInput.dataset.role = 'value';
  setLandScheduleInputValue(valueInput, row.value);
  valueInput.addEventListener('input', () => {
    row.value = parseOptionalNumber(valueInput.value);
    updateLandScheduleCurve(table);
  });
  valueTd.appendChild(valueInput);

  updateRowTooltip(table, row, rowIndex, minInput, maxInput);

  const deleteTd = document.createElement('td');
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'land-table-delete-row';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', () => {
    table.rows.splice(rowIndex, 1);
    renderLandScheduleTables();
  });
  deleteTd.appendChild(deleteBtn);

  tr.append(minTd, maxTd, valueTd, deleteTd);
  return tr;
}

function syncDerivedRowMins(table: LandScheduleTable, tbody: HTMLTableSectionElement) {
  for (let i = 1; i < table.rows.length; i += 1) {
    const row = table.rows[i];
    row.min = table.rows[i - 1].max;
    const rowEl = tbody.querySelector(`tr[data-row-index="${i}"]`) as HTMLTableRowElement | null;
    const minInput = rowEl?.querySelector('input[data-role="min"]') as HTMLInputElement | null;
    const maxInput = rowEl?.querySelector('input[data-role="max"]') as HTMLInputElement | null;
    const minInfo = rowEl?.querySelector('[data-role="min-info"]') as HTMLElement | null;
    const maxInfo = rowEl?.querySelector('[data-role="max-info"]') as HTMLElement | null;
    if (minInput) {
      setLandScheduleInputValue(minInput, row.min);
    }
    if (row.min !== null && row.max !== null && row.max < row.min) {
      row.max = row.min;
      if (maxInput) {
        setLandScheduleInputValue(maxInput, row.max);
      }
    }
    if (minInfo && maxInfo) {
      updateRowTooltip(table, row, i, minInfo, maxInfo);
    }
  }
}

function renderTableSelectOptions(entry: LandScheduleEntry) {
  landScheduleTableSelect.replaceChildren();
  entry.tables.forEach(table => {
    const option = new Option(table.name || 'Untitled table', table.id);
    landScheduleTableSelect.appendChild(option);
  });
  if (!entry.activeTableId || !entry.tables.some(table => table.id === entry.activeTableId)) {
    entry.activeTableId = entry.tables[0]?.id ?? null;
  }
  if (entry.activeTableId) {
    landScheduleTableSelect.value = entry.activeTableId;
  }
}

function renderActiveTable(entry: LandScheduleEntry) {
  landScheduleTableContainer.replaceChildren();
  const activeTable = entry.tables.find(table => table.id === entry.activeTableId);
  if (!activeTable) return;
  landScheduleFilterButton = null;
  activeTable.filters = activeTable.filters ?? [];
  activeTable.filterInvert = activeTable.filterInvert ?? false;
  activeTable.valueMode = activeTable.valueMode ?? 'per-unit';

  const card = document.createElement('div');
  card.className = 'land-table-card';
  card.dataset.tableId = activeTable.id;

  const header = document.createElement('div');
  header.className = 'land-table-header';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = activeTable.name;
  nameInput.addEventListener('input', () => {
    activeTable.name = nameInput.value;
    const option = landScheduleTableSelect.querySelector(`option[value="${activeTable.id}"]`);
    if (option) {
      option.textContent = activeTable.name || 'Untitled table';
    }
  });
  

  const filterButton = document.createElement('button');
  filterButton.type = 'button';
  filterButton.className = 'land-table-filter';
  filterButton.title = 'Conditions';
  filterButton.innerHTML = `<img src="${FILTER_ICON}" alt="Filters" /> Conditions...`;
  landScheduleFilterButton = filterButton;
  updateLandScheduleFilterButtonState(activeTable);
  const landScheduleContextKey = `table:${activeTable.id}`;
  filterButton.addEventListener('click', () => {
    setFiltersContext({
      type: 'landSchedule',
      getFilters: () => activeTable.filters,
      getFilterInvert: () => activeTable.filterInvert,
      setFilters: (filters: FilterRule[], filterInvert: boolean) => {
        activeTable.filters = cloneFilters(filters);
        activeTable.filterInvert = filterInvert;
        updateLandScheduleFilterButtonState(activeTable);
      },
      label: `Adjustment schedule / ${activeTable.name || 'Untitled table'}`,
      key: landScheduleContextKey,
    });
    showFiltersPanel?.();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'land-table-delete';
  deleteBtn.textContent = '❌';
  deleteBtn.title = 'Delete table';
  deleteBtn.addEventListener('click', () => {
    const confirmed = window.confirm('Delete this table?');
    if (!confirmed) return;
    entry.tables = entry.tables.filter(table => table.id !== activeTable.id);
    if (entry.activeTableId === activeTable.id) {
      entry.activeTableId = entry.tables[0]?.id ?? null;
    }
    renderLandScheduleTables();
  });

  header.append(nameInput, filterButton, deleteBtn);

  const controls = document.createElement('div');
  controls.className = 'land-table-controls';
  const unitWrap = document.createElement('div');
  unitWrap.className = 'land-table-unit';
  const unitLabel = document.createElement('span');
  unitLabel.textContent = 'Unit:';
  const unitSelect = document.createElement('select');
  UNIT_OPTIONS.forEach(option => {
    unitSelect.appendChild(new Option(option.label, option.value));
  });
  const valueWrap = document.createElement('div');
  valueWrap.className = 'land-table-value-mode';
  const valueLabel = document.createElement('span');
  valueLabel.textContent = 'Value:';
  const valueSelect = document.createElement('select');
  valueSelect.appendChild(new Option('Flat', 'flat'));
  valueSelect.appendChild(new Option('Per unit', 'per-unit'));
  valueSelect.appendChild(new Option('Per unit (marginal)', 'per-unit-marginal'));
  valueSelect.value = activeTable.valueMode;
  const valueInfo = document.createElement('span');
  valueInfo.className = 'land-table-info';
  valueInfo.textContent = 'ⓘ';
  valueInfo.title = getValueModeTooltip(activeTable.unit, activeTable.valueMode);
  valueSelect.addEventListener('change', () => {
    activeTable.valueMode = valueSelect.value as LandScheduleValueMode;
    updateValueHeader(valueHeader, activeTable.unit, activeTable.valueMode);
    valueInfo.title = getValueModeTooltip(activeTable.unit, activeTable.valueMode);
    updateLandScheduleCurve(activeTable);
  });
  valueWrap.append(valueLabel, valueSelect, valueInfo);

  unitSelect.value = activeTable.unit;
  unitSelect.addEventListener('change', () => {
    activeTable.unit = unitSelect.value as LandScheduleUnit;
    updateValueHeader(valueHeader, activeTable.unit, activeTable.valueMode);
    valueInfo.title = getValueModeTooltip(activeTable.unit, activeTable.valueMode);
    updateLandScheduleCurve(activeTable);
    updateAllRowTooltips(activeTable, tbody);
  });
  unitWrap.append(unitLabel, unitSelect);

  controls.append(unitWrap, valueWrap);

  const tableEl = document.createElement('table');
  tableEl.className = 'land-table-grid';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const minHeader = document.createElement('th');
  minHeader.textContent = 'Min ';
  const minHeaderInfo = document.createElement('span');
  minHeaderInfo.className = 'land-table-info';
  minHeaderInfo.textContent = 'ⓘ';
  minHeaderInfo.title = 'Minimum parcel size for the row. The first row is inclusive; later rows start just above the previous max.';
  minHeader.append(minHeaderInfo);
  const maxHeader = document.createElement('th');
  maxHeader.textContent = 'Max ';
  const maxHeaderInfo = document.createElement('span');
  maxHeaderInfo.className = 'land-table-info';
  maxHeaderInfo.textContent = 'ⓘ';
  maxHeaderInfo.title = 'Maximum parcel size for the row (inclusive).';
  maxHeader.append(maxHeaderInfo);
  const valueHeader = document.createElement('th');
  valueHeader.dataset.role = 'value-header';
  updateValueHeader(valueHeader, activeTable.unit, activeTable.valueMode);
  const deleteHeader = document.createElement('th');
  deleteHeader.textContent = '';
  headerRow.append(minHeader, maxHeader, valueHeader, deleteHeader);
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');
  activeTable.rows.forEach((_, index) => {
    tbody.appendChild(createTableRow(activeTable, index, tbody));
  });

  tableEl.append(thead, tbody);

  const actions = document.createElement('div');
  actions.className = 'land-table-actions';
  const addRowBtn = document.createElement('button');
  addRowBtn.type = 'button';
  addRowBtn.className = 'land-schedule-button';
  addRowBtn.textContent = 'add row';
  addRowBtn.addEventListener('click', () => {
    const lastRow = activeTable.rows[activeTable.rows.length - 1];
    activeTable.rows.push({
      min: lastRow ? lastRow.max : null,
      max: null,
      value: null,
    });
    renderLandScheduleTables();
  });
  actions.append(landScheduleAddTableButton, addRowBtn);

  card.append(header, controls, tableEl, actions);
  landScheduleTableContainer.appendChild(card);

  syncDerivedRowMins(activeTable, tbody);
  updateAllRowTooltips(activeTable, tbody);
  updateLandScheduleCurve(activeTable);
}

function renderLandScheduleAdjustments(entry: LandScheduleEntry) {
  landScheduleAdjustmentsContainer.replaceChildren();
  entry.adjustments = entry.adjustments ?? [];

  entry.adjustments.forEach(adjustment => {
    adjustment.sizeUnit = normalizeLegacyAdjustmentSizeUnit(adjustment.sizeUnit as LandScheduleAdjustmentSizeUnit | 'area' | 'frontage' | 'flat');
    if (adjustment.sizeUnitDetail === undefined) {
      adjustment.sizeUnitDetail = getDefaultUnitDetail(adjustment.sizeUnit);
    }

    const card = document.createElement('div');
    card.className = 'land-adjustment-card';
    card.dataset.adjustmentId = adjustment.id;

    const header = document.createElement('div');
    header.className = 'land-adjustment-header';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = adjustment.name;
    nameInput.addEventListener('input', () => {
      adjustment.name = nameInput.value;
    });
    
    const conditionsBtn = document.createElement('button');
    conditionsBtn.type = 'button';
    conditionsBtn.className = 'land-table-filter';
    conditionsBtn.title = 'Conditions';
    conditionsBtn.innerHTML = `<img src="${FILTER_ICON}" alt="Filters" /> Conditions`;
    updateAdjustmentFilterButtonState(conditionsBtn, adjustment);
    const adjustmentContextKey = `adj:${adjustment.id}`;
    conditionsBtn.addEventListener('click', () => {
      setFiltersContext({
        type: 'landSchedule',
        getFilters: () => adjustment.filters,
        getFilterInvert: () => adjustment.filterInvert,
        setFilters: (filters: FilterRule[], filterInvert: boolean) => {
          adjustment.filters = cloneFilters(filters);
          adjustment.filterInvert = filterInvert;
          updateAdjustmentFilterButtonState(conditionsBtn, adjustment);
        },
        label: `Adjustment schedule adjustment / ${adjustment.name || 'Untitled adjustment'}`,
        key: adjustmentContextKey,
      });
      showFiltersPanel?.();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'land-adjustment-delete';
    deleteBtn.textContent = '❌';
    deleteBtn.title = 'Delete adjustment';
    deleteBtn.addEventListener('click', () => {
      entry.adjustments = entry.adjustments.filter(item => item.id !== adjustment.id);
      renderLandScheduleAdjustments(entry);
    });

    header.append(nameInput, conditionsBtn, deleteBtn);

    const operationRow = document.createElement('div');
    operationRow.className = 'land-adjustment-row';
    const operationSelect = document.createElement('select');
    ADJUSTMENT_OPERATION_OPTIONS.forEach(option => {
      operationSelect.appendChild(new Option(option.label, option.value));
    });
    operationSelect.value = adjustment.operation;
    operationRow.append(operationSelect);

    const valueWrap = document.createElement('div');
    valueWrap.className = 'land-adjustment-value';
    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.inputMode = 'decimal';
    valueInput.step = '0.01';
    const valueSuffix = document.createElement('span');
    valueSuffix.className = 'land-adjustment-value-suffix';
    valueSuffix.textContent = 'x';
    valueWrap.append(valueInput, valueSuffix);
    operationRow.append(valueWrap);

    const unitSelect = document.createElement('select');
    unitSelect.className = 'land-adjustment-select-unit';
    ADJUSTMENT_UNIT_OPTIONS.forEach(option => {
      unitSelect.appendChild(new Option(option.label, option.value));
    });
    unitSelect.value = adjustment.sizeUnit;

    const perLabel = document.createElement('span');
    perLabel.className = 'land-adjustment-per-label';
    const perText = document.createElement('span');
    perText.className = 'land-adjustment-per-text';
    perText.textContent = 'per:';
    
    const unitDetailSelect = document.createElement('select');
    unitDetailSelect.className = 'land-adjustment-select-detail';
    const unitPair = document.createElement('span');
    unitPair.className = 'land-adjustment-unit-pair';
    unitPair.append(unitSelect, unitDetailSelect);
    perLabel.append(perText, unitPair);
    operationRow.append(perLabel);
    
    const syncValueUI = () => {
      const isMultiply = adjustment.operation === 'multiply';
      valueWrap.classList.toggle('is-multiply', isMultiply);
      valueSuffix.style.display = isMultiply ? 'inline-flex' : 'none';
      if (isMultiply && adjustment.value === null) {
        adjustment.value = 1;
      }
      setLandScheduleInputValue(valueInput, adjustment.value);
    };

    operationSelect.addEventListener('change', () => {
      adjustment.operation = operationSelect.value as LandScheduleAdjustmentOperation;
      syncValueUI();
    });

    unitSelect.addEventListener('change', () => {
      adjustment.sizeUnit = unitSelect.value as LandScheduleAdjustmentSizeUnit;
      adjustment.sizeUnitDetail = getDefaultUnitDetail(adjustment.sizeUnit);
      syncUnitDetailUI();
    });

    valueInput.addEventListener('input', () => {
      adjustment.value = parseOptionalNumber(valueInput.value);
    });

    const syncUnitDetailUI = () => {
      unitDetailSelect.replaceChildren();
      const options = getUnitDetailOptions(adjustment.sizeUnit);
      const showDetail = options.length > 0;
      unitDetailSelect.classList.toggle('is-hidden', !showDetail);
      unitDetailSelect.disabled = !showDetail;
      if (!showDetail) {
        adjustment.sizeUnitDetail = null;
        return;
      }
      options.forEach(option => {
        unitDetailSelect.appendChild(new Option(option.label, option.value));
      });
      const hasCurrent = adjustment.sizeUnitDetail && options.some(option => option.value === adjustment.sizeUnitDetail);
      const nextValue = hasCurrent ? adjustment.sizeUnitDetail : options[0]?.value ?? null;
      adjustment.sizeUnitDetail = nextValue;
      unitDetailSelect.value = nextValue ?? '';
    };

    unitDetailSelect.addEventListener('change', () => {
      adjustment.sizeUnitDetail = unitDetailSelect.value || null;
    });

    syncValueUI();
    syncUnitDetailUI();

    card.append(header, operationRow);
    landScheduleAdjustmentsContainer.appendChild(card);
  });
}

/* ------------------------------------------------------------------ */
/*  Exported functions                                                */
/* ------------------------------------------------------------------ */

export function renderLandScheduleTables() {
  const entry = getCurrentEntry();
  landScheduleTableContainer.replaceChildren();
  landScheduleFilterButton = null;
  landScheduleAdjustmentsContainer.replaceChildren();

  invalidateFiltersContextIf(context => {
    if (context.type !== 'landSchedule') return false;
    if (!entry) return true;
    if (context.key?.startsWith('adj:')) {
      return !entry.adjustments.some(adjustment => `adj:${adjustment.id}` === context.key);
    }
    const activeId = entry.activeTableId ?? '';
    const expectedKey = `table:${activeId}`;
    return context.key !== expectedKey;
  });

  landScheduleTablesSection.style.display = 'grid';
  landScheduleAddTableButton.disabled = false;
  landScheduleAdjustmentsSection.style.display = 'grid';
  landScheduleAddAdjustmentButton.disabled = false;

  if (entry.tables.length === 0) {
    landScheduleTableSelectRow.style.display = 'none';
    landScheduleTableContainer.appendChild(landScheduleAddTableButton);
    landScheduleCurveSection.style.display = 'none';
    updateLandScheduleCurve(null);
  } else {
    landScheduleTableSelectRow.style.display = 'flex';
    landScheduleCurveSection.style.display = '';
    renderTableSelectOptions(entry);
    renderActiveTable(entry);
  }

  renderLandScheduleAdjustments(entry);
}

export function addLandScheduleTable() {
  const entry = getCurrentEntry();
  const nextIndex = entry.tables.length + 1;
  const newTable: LandScheduleTable = {
    id: `table-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: `Table ${nextIndex}`,
    unit: 'sqft',
    valueMode: 'per-unit',
    rows: [{ min: null, max: null, value: null }],
    filters: [],
    filterInvert: false,
  };
  entry.tables.push(newTable);
  entry.activeTableId = newTable.id;
  renderLandScheduleTables();
}

export function addLandScheduleAdjustment() {
  const entry = getCurrentEntry();
  const nextIndex = entry.adjustments.length + 1;
  const newAdjustment: LandScheduleAdjustment = {
    id: `adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: `Adjustment ${nextIndex}`,
    operation: 'add',
    sizeUnit: 'flat',
    sizeUnitDetail: null,
    value: null,
    filters: [],
    filterInvert: false,
  };
  entry.adjustments.push(newAdjustment);
  renderLandScheduleAdjustments(entry);
}

export function setActiveLandScheduleTable(tableId: string | null) {
  const entry = getCurrentEntry();
  entry.activeTableId = tableId;
  renderLandScheduleTables();
}

export function refreshLandSchedulePanel() {
  renderLandScheduleTables();
}
