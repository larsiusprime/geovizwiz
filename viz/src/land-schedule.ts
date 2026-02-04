/**
 * Land-schedule panel logic extracted from main.ts.
 *
 * Manages field/value selectors and per-value land schedule tables.
 */
import { S, LAND_SCHEDULE_DEFAULT_KEY, LAND_SCHEDULE_DEFAULT_LABEL } from './state';
import { getCategoricalValues } from './filters';

type LandScheduleUnit = 'sqft' | 'acre' | 'ft' | 'sqm' | 'hectare' | 'm';

type LandScheduleRow = {
  min: number | null;
  max: number | null;
  value: number | null;
};

type LandScheduleTable = {
  id: string;
  name: string;
  unit: LandScheduleUnit;
  rows: LandScheduleRow[];
  filters: unknown[];
};

type LandScheduleAdjustmentOperation = 'multiply' | 'add';
type LandScheduleAdjustmentUnit = 'per-area' | 'frontage' | 'flat';

type LandScheduleAdjustment = {
  id: string;
  name: string;
  operation: LandScheduleAdjustmentOperation;
  sizeUnit: LandScheduleAdjustmentUnit;
  value: number | null;
  filters: unknown[];
};

type LandScheduleEntry = {
  tables: LandScheduleTable[];
  activeTableId: string | null;
  adjustments: LandScheduleAdjustment[];
  adjustmentsCollapsed: boolean;
};

const landScheduleStore = new Map<string, Map<string, LandScheduleEntry>>();

const UNIT_OPTIONS: Array<{ value: LandScheduleUnit; label: string; header: string }> = [
  { value: 'sqft', label: 'area (sqft)', header: 'sqft' },
  { value: 'acre', label: 'area (acre)', header: 'acre' },
  { value: 'ft', label: 'frontage (ft)', header: 'ft' },
  { value: 'sqm', label: 'area (sqm)', header: 'sqm' },
  { value: 'hectare', label: 'area (hectare)', header: 'hectare' },
  { value: 'm', label: 'frontage (m)', header: 'm' },
];

const ADJUSTMENT_UNIT_OPTIONS: Array<{ value: LandScheduleAdjustmentUnit; label: string }> = [
  { value: 'per-area', label: 'Per area (sqft/acre or sqm/hectare)' },
  { value: 'frontage', label: 'Frontage (feet or meters)' },
  { value: 'flat', label: 'Flat amount (no unit)' },
];

/* ------------------------------------------------------------------ */
/*  DOM element references (set once via initLandScheduleElements)     */
/* ------------------------------------------------------------------ */

let landScheduleFieldSelect: HTMLSelectElement;
let landScheduleValueSelect: HTMLSelectElement;
let landScheduleValueRow: HTMLDivElement;
let landScheduleApplyButton: HTMLButtonElement;
let landScheduleTableSelect: HTMLSelectElement;
let landScheduleTableSelectRow: HTMLDivElement;
let landScheduleAddTableButton: HTMLButtonElement;
let landScheduleTableContainer: HTMLDivElement;

let showFiltersPanel: (() => void) | null = null;

export function initLandScheduleElements(els: {
  landScheduleFieldSelect: HTMLSelectElement;
  landScheduleValueSelect: HTMLSelectElement;
  landScheduleValueRow: HTMLDivElement;
  landScheduleApplyButton: HTMLButtonElement;
  landScheduleTableSelect: HTMLSelectElement;
  landScheduleTableSelectRow: HTMLDivElement;
  landScheduleAddTableButton: HTMLButtonElement;
  landScheduleTableContainer: HTMLDivElement;
}) {
  landScheduleFieldSelect = els.landScheduleFieldSelect;
  landScheduleValueSelect = els.landScheduleValueSelect;
  landScheduleValueRow = els.landScheduleValueRow;
  landScheduleApplyButton = els.landScheduleApplyButton;
  landScheduleTableSelect = els.landScheduleTableSelect;
  landScheduleTableSelectRow = els.landScheduleTableSelectRow;
  landScheduleAddTableButton = els.landScheduleAddTableButton;
  landScheduleTableContainer = els.landScheduleTableContainer;
}

export function initLandScheduleCallbacks(cbs: { showFiltersPanel?: () => void }) {
  showFiltersPanel = cbs.showFiltersPanel ?? null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getLandScheduleEntry(field: string, valueKey: string): LandScheduleEntry {
  let fieldMap = landScheduleStore.get(field);
  if (!fieldMap) {
    fieldMap = new Map();
    landScheduleStore.set(field, fieldMap);
  }
  let entry = fieldMap.get(valueKey);
  if (!entry) {
    entry = {
      tables: [],
      activeTableId: null,
      adjustments: [],
      adjustmentsCollapsed: false,
    };
    fieldMap.set(valueKey, entry);
  }
  return entry;
}

function getCurrentEntry(): LandScheduleEntry | null {
  if (!S.currentLandScheduleField || !S.currentLandScheduleValue) return null;
  return getLandScheduleEntry(S.currentLandScheduleField, S.currentLandScheduleValue);
}

function getAvailableLandScheduleFields(): string[] {
  if (!S.currentGeoJSON) return [];
  return S.chosenCategoricalFields.filter(k =>
    S.currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function setLandScheduleInputValue(input: HTMLInputElement, value: number | null) {
  input.value = value === null ? '' : String(value);
}

function updateValueHeader(headerEl: HTMLElement, unit: LandScheduleUnit) {
  const option = UNIT_OPTIONS.find(opt => opt.value === unit);
  const suffix = option ? option.header : unit;
  headerEl.textContent = `Value / ${suffix}`;
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
  minTd.appendChild(minInput);

  const maxTd = document.createElement('td');
  const maxInput = document.createElement('input');
  maxInput.type = 'number';
  maxInput.inputMode = 'decimal';
  maxInput.dataset.role = 'max';
  setLandScheduleInputValue(maxInput, row.max);
  maxInput.addEventListener('input', () => {
    const parsed = parseOptionalNumber(maxInput.value);
    row.max = parsed;
    if (row.min !== null && row.max !== null && row.max < row.min) {
      row.max = row.min;
      setLandScheduleInputValue(maxInput, row.max);
    }
    syncDerivedRowMins(table, tbody);
  });
  maxTd.appendChild(maxInput);

  minInput.addEventListener('input', () => {
    if (rowIndex !== 0) return;
    row.min = parseOptionalNumber(minInput.value);
    if (row.min !== null && row.max !== null && row.max < row.min) {
      row.max = row.min;
      setLandScheduleInputValue(maxInput, row.max);
    }
    syncDerivedRowMins(table, tbody);
  });

  const valueTd = document.createElement('td');
  const valueInput = document.createElement('input');
  valueInput.type = 'number';
  valueInput.inputMode = 'decimal';
  valueInput.dataset.role = 'value';
  setLandScheduleInputValue(valueInput, row.value);
  valueInput.addEventListener('input', () => {
    row.value = parseOptionalNumber(valueInput.value);
  });
  valueTd.appendChild(valueInput);

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
    if (minInput) {
      setLandScheduleInputValue(minInput, row.min);
    }
    if (row.min !== null && row.max !== null && row.max < row.min) {
      row.max = row.min;
      if (maxInput) {
        setLandScheduleInputValue(maxInput, row.max);
      }
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

  const card = document.createElement('div');
  card.className = 'land-table-card';
  card.dataset.tableId = activeTable.id;

  const header = document.createElement('div');
  header.className = 'land-table-header';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name:';
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
  nameLabel.appendChild(nameInput);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'land-table-delete';
  deleteBtn.textContent = '×';
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

  header.append(nameLabel, deleteBtn);

  const controls = document.createElement('div');
  controls.className = 'land-table-controls';
  const filterButton = document.createElement('button');
  filterButton.type = 'button';
  filterButton.className = 'land-table-filter';
  filterButton.textContent = '▽';
  filterButton.title = 'Add filters to this table';
  filterButton.addEventListener('click', () => {
    showFiltersPanel?.();
  });

  const unitWrap = document.createElement('div');
  unitWrap.className = 'land-table-unit';
  const unitLabel = document.createElement('span');
  unitLabel.textContent = 'Unit:';
  const unitSelect = document.createElement('select');
  UNIT_OPTIONS.forEach(option => {
    unitSelect.appendChild(new Option(option.label, option.value));
  });
  unitSelect.value = activeTable.unit;
  unitSelect.addEventListener('change', () => {
    activeTable.unit = unitSelect.value as LandScheduleUnit;
    updateValueHeader(valueHeader, activeTable.unit);
  });
  unitWrap.append(unitLabel, unitSelect);
  controls.append(filterButton, unitWrap);

  const tableEl = document.createElement('table');
  tableEl.className = 'land-table-grid';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const minHeader = document.createElement('th');
  minHeader.textContent = 'Min';
  const maxHeader = document.createElement('th');
  maxHeader.textContent = 'Max';
  const valueHeader = document.createElement('th');
  valueHeader.dataset.role = 'value-header';
  updateValueHeader(valueHeader, activeTable.unit);
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
  actions.appendChild(addRowBtn);

  card.append(header, controls, tableEl, actions);
  landScheduleTableContainer.appendChild(card);

  syncDerivedRowMins(activeTable, tbody);
}

function renderAdjustmentsSection(entry: LandScheduleEntry) {
  const section = document.createElement('div');
  section.className = 'land-adjustments';

  const headerButton = document.createElement('button');
  headerButton.type = 'button';
  headerButton.className = 'land-adjustments-toggle';
  headerButton.setAttribute('aria-expanded', String(!entry.adjustmentsCollapsed));

  const headerIcon = document.createElement('span');
  headerIcon.className = 'land-adjustments-icon';
  headerIcon.textContent = entry.adjustmentsCollapsed ? '►' : '▼';
  const headerText = document.createElement('span');
  headerText.textContent = 'Adjustments';
  headerButton.append(headerIcon, headerText);

  const body = document.createElement('div');
  body.className = 'land-adjustments-body';
  body.style.display = entry.adjustmentsCollapsed ? 'none' : 'grid';

  const updateCollapsedState = () => {
    entry.adjustmentsCollapsed = !entry.adjustmentsCollapsed;
    headerButton.setAttribute('aria-expanded', String(!entry.adjustmentsCollapsed));
    headerIcon.textContent = entry.adjustmentsCollapsed ? '►' : '▼';
    body.style.display = entry.adjustmentsCollapsed ? 'none' : 'grid';
  };

  headerButton.addEventListener('click', updateCollapsedState);

  entry.adjustments.forEach(adjustment => {
    body.appendChild(createAdjustmentCard(entry, adjustment));
  });

  const addRow = document.createElement('div');
  addRow.className = 'land-adjustments-actions';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'land-schedule-button';
  addButton.textContent = 'add adjustment';
  addButton.addEventListener('click', () => {
    entry.adjustments.push({
      id: `adjust-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: '',
      operation: 'multiply',
      sizeUnit: 'per-area',
      value: 1,
      filters: [],
    });
    renderLandScheduleTables();
  });
  addRow.appendChild(addButton);

  body.appendChild(addRow);
  section.append(headerButton, body);
  landScheduleTableContainer.appendChild(section);
}

function createAdjustmentCard(entry: LandScheduleEntry, adjustment: LandScheduleAdjustment) {
  const card = document.createElement('div');
  card.className = 'land-adjustment-card';

  const headerRow = document.createElement('div');
  headerRow.className = 'land-adjustment-header';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name:';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = adjustment.name;
  nameInput.addEventListener('input', () => {
    adjustment.name = nameInput.value;
  });
  nameLabel.appendChild(nameInput);
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'land-adjustment-delete';
  deleteButton.textContent = '×';
  deleteButton.title = 'Delete adjustment';
  deleteButton.addEventListener('click', () => {
    entry.adjustments = entry.adjustments.filter(item => item.id !== adjustment.id);
    renderLandScheduleTables();
  });
  headerRow.append(nameLabel, deleteButton);

  const conditionsRow = document.createElement('div');
  conditionsRow.className = 'land-adjustment-row';
  const conditionsLabel = document.createElement('span');
  conditionsLabel.textContent = 'Conditions:';
  const conditionsButton = document.createElement('button');
  conditionsButton.type = 'button';
  conditionsButton.className = 'land-adjustment-conditions';
  const filterIcon = document.createElement('img');
  filterIcon.src = './src/svg/filters.svg';
  filterIcon.alt = '';
  const filterText = document.createElement('span');
  filterText.textContent = 'Filters';
  conditionsButton.append(filterIcon, filterText);
  conditionsButton.addEventListener('click', () => {
    showFiltersPanel?.();
  });
  conditionsRow.append(conditionsLabel, conditionsButton);

  const operationRow = document.createElement('div');
  operationRow.className = 'land-adjustment-row';
  const operationLabel = document.createElement('label');
  operationLabel.textContent = 'Operation:';
  const operationSelect = document.createElement('select');
  operationSelect.appendChild(new Option('Multiply', 'multiply'));
  operationSelect.appendChild(new Option('Add', 'add'));
  operationSelect.value = adjustment.operation;
  operationSelect.addEventListener('change', () => {
    adjustment.operation = operationSelect.value as LandScheduleAdjustmentOperation;
    if (adjustment.operation === 'multiply' && adjustment.value === null) {
      adjustment.value = 1;
    }
    if (adjustment.operation === 'add' && adjustment.value === null) {
      adjustment.value = 0;
    }
    updateValueDisplay();
  });
  operationRow.append(operationLabel, operationSelect);

  const unitRow = document.createElement('div');
  unitRow.className = 'land-adjustment-row';
  const unitLabel = document.createElement('label');
  unitLabel.textContent = 'Size unit:';
  const unitSelect = document.createElement('select');
  ADJUSTMENT_UNIT_OPTIONS.forEach(option => {
    unitSelect.appendChild(new Option(option.label, option.value));
  });
  unitSelect.value = adjustment.sizeUnit;
  unitSelect.addEventListener('change', () => {
    adjustment.sizeUnit = unitSelect.value as LandScheduleAdjustmentUnit;
  });
  unitRow.append(unitLabel, unitSelect);

  const valueRow = document.createElement('div');
  valueRow.className = 'land-adjustment-row';
  const valueLabel = document.createElement('label');
  valueLabel.textContent = 'Value:';
  const valueWrap = document.createElement('div');
  valueWrap.className = 'land-adjustment-value';
  const valueInput = document.createElement('input');
  valueInput.type = 'number';
  valueInput.inputMode = 'decimal';
  valueInput.value = adjustment.value === null ? '' : String(adjustment.value);
  valueInput.addEventListener('input', () => {
    adjustment.value = parseOptionalNumber(valueInput.value);
  });
  const valueSuffix = document.createElement('span');
  valueSuffix.className = 'land-adjustment-suffix';
  valueSuffix.textContent = 'x';
  valueWrap.append(valueInput, valueSuffix);
  valueRow.append(valueLabel, valueWrap);

  const updateValueDisplay = () => {
    const isMultiply = adjustment.operation === 'multiply';
    valueWrap.classList.toggle('is-multiply', isMultiply);
    valueSuffix.style.display = isMultiply ? 'inline' : 'none';
    valueInput.step = isMultiply ? '0.01' : 'any';
    if (adjustment.value === null) {
      valueInput.value = '';
    } else if (isMultiply) {
      valueInput.value = Number(adjustment.value).toFixed(2);
    } else {
      valueInput.value = String(adjustment.value);
    }
  };

  updateValueDisplay();

  card.append(headerRow, conditionsRow, operationRow, unitRow, valueRow);
  return card;
}

/* ------------------------------------------------------------------ */
/*  Exported functions                                                */
/* ------------------------------------------------------------------ */

export function updateLandScheduleValueOptions() {
  landScheduleValueSelect.replaceChildren();

  if (!S.currentLandScheduleField) {
    landScheduleValueRow.style.display = 'none';
    landScheduleValueSelect.disabled = true;
    landScheduleApplyButton.disabled = true;
    S.currentLandScheduleValue = null;
    renderLandScheduleTables();
    return;
  }

  landScheduleValueSelect.appendChild(new Option(LAND_SCHEDULE_DEFAULT_LABEL, LAND_SCHEDULE_DEFAULT_KEY));
  const values = getCategoricalValues(S.currentLandScheduleField);
  values.forEach(value => landScheduleValueSelect.appendChild(new Option(value, value)));

  landScheduleValueRow.style.display = 'flex';
  landScheduleValueSelect.disabled = false;
  landScheduleApplyButton.disabled = false;

  if (S.currentLandScheduleValue && (S.currentLandScheduleValue === LAND_SCHEDULE_DEFAULT_KEY || values.includes(S.currentLandScheduleValue))) {
    landScheduleValueSelect.value = S.currentLandScheduleValue;
  } else {
    landScheduleValueSelect.value = LAND_SCHEDULE_DEFAULT_KEY;
    S.currentLandScheduleValue = LAND_SCHEDULE_DEFAULT_KEY;
  }

  renderLandScheduleTables();
}

export function renderLandScheduleTables() {
  const entry = getCurrentEntry();
  landScheduleTableContainer.replaceChildren();

  if (!entry) {
    landScheduleTableSelectRow.style.display = 'none';
    landScheduleAddTableButton.disabled = true;
    return;
  }

  landScheduleAddTableButton.disabled = false;

  if (entry.tables.length === 0) {
    landScheduleTableSelectRow.style.display = 'none';
  } else {
    landScheduleTableSelectRow.style.display = 'flex';
    renderTableSelectOptions(entry);
    renderActiveTable(entry);
  }
  renderAdjustmentsSection(entry);
}

export function addLandScheduleTable() {
  const entry = getCurrentEntry();
  if (!entry) return;
  const nextIndex = entry.tables.length + 1;
  const newTable: LandScheduleTable = {
    id: `table-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: `Table ${nextIndex}`,
    unit: 'sqft',
    rows: [{ min: null, max: null, value: null }],
    filters: [],
  };
  entry.tables.push(newTable);
  entry.activeTableId = newTable.id;
  renderLandScheduleTables();
}

export function setActiveLandScheduleTable(tableId: string | null) {
  const entry = getCurrentEntry();
  if (!entry) return;
  entry.activeTableId = tableId;
  renderLandScheduleTables();
}

export function refreshLandSchedulePanel() {
  landScheduleFieldSelect.replaceChildren();
  const availableFields = getAvailableLandScheduleFields();

  if (!availableFields.length) {
    landScheduleFieldSelect.appendChild(new Option('No categorical fields', ''));
    landScheduleFieldSelect.value = '';
    landScheduleFieldSelect.disabled = true;
    S.currentLandScheduleField = null;
    S.currentLandScheduleValue = null;
    updateLandScheduleValueOptions();
    return;
  }

  landScheduleFieldSelect.disabled = false;
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  landScheduleFieldSelect.appendChild(placeholder);
  availableFields.forEach(field => landScheduleFieldSelect.appendChild(new Option(field, field)));

  if (S.currentLandScheduleField && availableFields.includes(S.currentLandScheduleField)) {
    landScheduleFieldSelect.value = S.currentLandScheduleField;
  } else {
    landScheduleFieldSelect.value = '';
    S.currentLandScheduleField = null;
    S.currentLandScheduleValue = null;
  }

  updateLandScheduleValueOptions();
}
