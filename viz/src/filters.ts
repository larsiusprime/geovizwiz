/**
 * Filter-related logic extracted from main.ts.
 *
 * All functions that deal with filter rules, filter expressions (MapLibre),
 * saved filters, and the filters panel UI live here.
 */
import type { Expression } from 'maplibre-gl';
import { S, NUMERIC_FILTER_OPERATORS, CATEGORICAL_FILTER_OPERATORS } from './state';
import { numOrNull } from './utils.number';
import { updateFiltersPanelLayout } from './windows';
import type {
  FilterFieldType, FilterMode,
  FilterOperator, FilterRule, SavedFilterEntry,
  ColorMode, LayerState
} from './types';

/* ------------------------------------------------------------------ */
/*  DOM element references (set once via initFilterElements)          */
/* ------------------------------------------------------------------ */

let filtersListEl: HTMLDivElement;
let filtersInvertToggle: HTMLInputElement;
let addFilterButton: HTMLButtonElement;
let filtersSaveToggle: HTMLButtonElement;
let filtersLoadToggle: HTMLButtonElement;
let filtersSavePanel: HTMLDivElement;
let filtersLoadPanel: HTMLDivElement;
let filtersSaveControls: HTMLDivElement;
let filtersSaveNameInput: HTMLInputElement;
let filtersSaveConfirmButton: HTMLButtonElement;
let filtersSavedStatus: HTMLDivElement;
let filtersLoadControls: HTMLDivElement;
let filtersLoadSelect: HTMLSelectElement;

export function initFilterElements(els: {
  filtersListEl: HTMLDivElement;
  filtersInvertToggle: HTMLInputElement;
  addFilterButton: HTMLButtonElement;
  filtersSaveToggle: HTMLButtonElement;
  filtersLoadToggle: HTMLButtonElement;
  filtersSavePanel: HTMLDivElement;
  filtersLoadPanel: HTMLDivElement;
  filtersSaveControls: HTMLDivElement;
  filtersSaveNameInput: HTMLInputElement;
  filtersSaveConfirmButton: HTMLButtonElement;
  filtersSavedStatus: HTMLDivElement;
  filtersLoadControls: HTMLDivElement;
  filtersLoadSelect: HTMLSelectElement;
}) {
  filtersListEl = els.filtersListEl;
  filtersInvertToggle = els.filtersInvertToggle;
  addFilterButton = els.addFilterButton;
  filtersSaveToggle = els.filtersSaveToggle;
  filtersLoadToggle = els.filtersLoadToggle;
  filtersSavePanel = els.filtersSavePanel;
  filtersLoadPanel = els.filtersLoadPanel;
  filtersSaveControls = els.filtersSaveControls;
  filtersSaveNameInput = els.filtersSaveNameInput;
  filtersSaveConfirmButton = els.filtersSaveConfirmButton;
  filtersSavedStatus = els.filtersSavedStatus;
  filtersLoadControls = els.filtersLoadControls;
  filtersLoadSelect = els.filtersLoadSelect;
}

/* ------------------------------------------------------------------ */
/*  Callbacks into main.ts (set once via initFilterCallbacks)         */
/* ------------------------------------------------------------------ */

let _persistCurrentLayerState: () => void;
let _renderLayerList: () => void;
let _updateStatisticsResults: () => void;
let _scheduleScatterPlotRefresh: () => void;
let _getCurrentLayerIds: () => { sourceId: string; layerId: string; errorLayerId: string } | null;
let _clearLegendVisibility: () => void;
export function initFilterCallbacks(cbs: {
  persistCurrentLayerState: () => void;
  renderLayerList: () => void;
  updateStatisticsResults: () => void;
  scheduleScatterPlotRefresh: () => void;
  getCurrentLayerIds: () => { sourceId: string; layerId: string; errorLayerId: string } | null;
  clearLegendVisibility: () => void;
}) {
  _persistCurrentLayerState = cbs.persistCurrentLayerState;
  _renderLayerList = cbs.renderLayerList;
  _updateStatisticsResults = cbs.updateStatisticsResults;
  _scheduleScatterPlotRefresh = cbs.scheduleScatterPlotRefresh;
  _getCurrentLayerIds = cbs.getCurrentLayerIds;
  _clearLegendVisibility = cbs.clearLegendVisibility;
}

/* ------------------------------------------------------------------ */
/*  Filter utilities                                                  */
/* ------------------------------------------------------------------ */

export function cloneFilters(source: FilterRule[]): FilterRule[] {
  return source.map(filter => ({
    ...filter,
    value: Array.isArray(filter.value) ? [...filter.value] : filter.value
  }));
}

export function serializeFiltersForComparison(source: FilterRule[], invert: boolean): string {
  return JSON.stringify({
    invert,
    rules: source.map(rule => ({
      field: rule.field,
      fieldType: rule.fieldType,
      operator: rule.operator,
      value: Array.isArray(rule.value) ? [...rule.value] : rule.value,
      active: rule.active
    }))
  });
}

export function getMatchingSavedFilterName(): string | null {
  const current = serializeFiltersForComparison(S.filters, S.filterInvert);
  for (const [name, entry] of S.savedFiltersStore.entries()) {
    const candidate = serializeFiltersForComparison(entry.filters, entry.filterInvert);
    if (candidate === current) return name;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Saved filters UI                                                  */
/* ------------------------------------------------------------------ */

export function renderSavedFiltersOptions() {
  if (!filtersLoadSelect) return;
  filtersLoadSelect.replaceChildren();
  const placeholder = new Option('Choose a saved filter', '');
  placeholder.disabled = true;
  placeholder.selected = true;
  filtersLoadSelect.appendChild(placeholder);
  S.savedFiltersStore.forEach((entry, name) => {
    filtersLoadSelect.appendChild(new Option(entry.name, name));
  });

  if (S.savedFilterMatchName) {
    filtersLoadSelect.value = S.savedFilterMatchName;
  }

  filtersLoadSelect.disabled = S.savedFiltersStore.size === 0;
}

export function setSavedFiltersPanelMode(nextMode: 'none' | 'save' | 'load') {
  S.savedFiltersPanelMode = nextMode;
  updateSavedFiltersUIState();
}

export function updateSavedFiltersUIState() {
  const hasConditions = S.filters.length > 0;
  const hasSaved = S.savedFiltersStore.size > 0;
  if (!hasConditions && S.savedFiltersPanelMode === 'save') {
    S.savedFiltersPanelMode = 'none';
  }
  if (!hasSaved && S.savedFiltersPanelMode === 'load') {
    S.savedFiltersPanelMode = 'none';
  }

  S.savedFilterMatchName = getMatchingSavedFilterName();

  if (filtersSaveToggle) {
    filtersSaveToggle.disabled = !hasConditions;
    const isActive = S.savedFiltersPanelMode === 'save';
    filtersSaveToggle.classList.toggle('active', isActive);
    filtersSaveToggle.setAttribute('aria-selected', String(isActive));
    filtersSaveToggle.tabIndex = isActive ? 0 : -1;
  }
  if (filtersLoadToggle) {
    filtersLoadToggle.disabled = !hasSaved;
    const isActive = S.savedFiltersPanelMode === 'load';
    filtersLoadToggle.classList.toggle('active', isActive);
    filtersLoadToggle.setAttribute('aria-selected', String(isActive));
    filtersLoadToggle.tabIndex = isActive ? 0 : -1;
  }

  const showSave = S.savedFiltersPanelMode === 'save' && hasConditions;
  const showLoad = S.savedFiltersPanelMode === 'load' && hasSaved;
  const hasMatch = Boolean(S.savedFilterMatchName);

  if (filtersSavePanel) {
    filtersSavePanel.style.display = showSave ? 'grid' : 'none';
  }
  if (filtersLoadPanel) {
    filtersLoadPanel.style.display = showLoad ? 'grid' : 'none';
  }
  if (filtersSaveControls) {
    filtersSaveControls.style.display = showSave && !hasMatch ? 'grid' : 'none';
  }
  if (filtersSavedStatus) {
    filtersSavedStatus.style.display = showSave && hasMatch ? 'block' : 'none';
    if (showSave && hasMatch) {
      filtersSavedStatus.textContent = `Saved as: "${S.savedFilterMatchName}"`;
    }
  }
  if (filtersLoadControls) {
    filtersLoadControls.style.display = showLoad ? 'grid' : 'none';
  }

  if (filtersSaveConfirmButton) {
    const hasName = Boolean(filtersSaveNameInput?.value.trim());
    filtersSaveConfirmButton.disabled = !showSave || !hasName;
  }

  if (showLoad) {
    renderSavedFiltersOptions();
  }

}

export function saveCurrentFilters(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  if (S.savedFiltersStore.has(trimmedName)) {
    const overwrite = window.confirm('You already have a filter with this name. Overwrite? Yes/Cancel');
    if (!overwrite) return;
  }
  S.savedFiltersStore.set(trimmedName, {
    name: trimmedName,
    filters: cloneFilters(S.filters),
    filterInvert: S.filterInvert
  });
  S.savedFilterMatchName = trimmedName;
  updateSavedFiltersUIState();
}

export function applySavedFilter(name: string) {
  const entry = S.savedFiltersStore.get(name);
  if (!entry) return;
  S.filters = cloneFilters(entry.filters);
  S.filterInvert = entry.filterInvert;
  if (filtersInvertToggle) {
    filtersInvertToggle.checked = S.filterInvert;
  }
  renderFiltersList();
  updateFiltersUIState();
  applyActiveFilterAction();
  _persistCurrentLayerState();
}

/* ------------------------------------------------------------------ */
/*  Filter field helpers                                              */
/* ------------------------------------------------------------------ */

export function getAvailableFilterFields() {
  if (!S.currentGeoJSON) return [];
  const availableNumeric = S.chosenNumericFields.filter(k =>
    S.currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );
  const availableCategorical = S.chosenCategoricalFields.filter(k =>
    S.currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );
  return [
    ...availableNumeric.map(field => ({ field, type: 'numeric' as const })),
    ...availableCategorical.map(field => ({ field, type: 'categorical' as const }))
  ];
}

export function syncFiltersWithAvailableFields() {
  const availableFields = new Set(getAvailableFilterFields().map(item => item.field));
  S.filters.forEach(filter => {
    if (filter.field && !availableFields.has(filter.field)) {
      filter.field = null;
      filter.fieldType = null;
      filter.operator = null;
      filter.value = null;
    }
  });
}

export function getCategoricalValues(field: string): string[] {
  if (!S.currentGeoJSON) return [];
  const values = new Set<string>();
  for (const feature of S.currentGeoJSON.features) {
    const raw = feature.properties?.[field];
    if (raw === undefined || raw === null || raw === '') continue;
    values.add(String(raw));
  }
  return Array.from(values).sort();
}

/* ------------------------------------------------------------------ */
/*  Filter completeness helpers                                       */
/* ------------------------------------------------------------------ */

export function isFilterComplete(filter: FilterRule): boolean {
  if (!filter.active || !filter.field || !filter.operator) return false;
  if (filter.value === null || filter.value === undefined) return false;
  if (Array.isArray(filter.value)) return filter.value.length > 0;
  if (typeof filter.value === 'string') return filter.value.trim().length > 0;
  return Number.isFinite(filter.value);
}

export function getActiveFilters(): FilterRule[] {
  return S.filters.filter(isFilterComplete);
}

/* ------------------------------------------------------------------ */
/*  Filter expressions (MapLibre)                                     */
/* ------------------------------------------------------------------ */

function buildFilterExpression(filter: FilterRule): any | null {
  if (!filter.field || !filter.operator || filter.value === null) return null;
  if (filter.fieldType === 'numeric') {
    if (!Number.isFinite(filter.value)) return null;
    const value = Number(filter.value);
    const fieldExpr: Expression = ['to-number', ['get', filter.field]] as any;
    switch (filter.operator) {
      case 'lt':
        return ['<', fieldExpr, value];
      case 'gt':
        return ['>', fieldExpr, value];
      case 'lte':
        return ['<=', fieldExpr, value];
      case 'gte':
        return ['>=', fieldExpr, value];
      case 'eq':
        return ['==', fieldExpr, value];
      case 'neq':
        return ['!=', fieldExpr, value];
      default:
        return null;
    }
  }

  if (filter.fieldType === 'categorical') {
    const fieldExpr: Expression = ['to-string', ['get', filter.field]] as any;
    if (filter.operator === 'eq') {
      return ['==', fieldExpr, String(filter.value)];
    }
    if (filter.operator === 'neq') {
      return ['!=', fieldExpr, String(filter.value)];
    }
    if ((filter.operator === 'any' || filter.operator === 'not-any') && Array.isArray(filter.value)) {
      const expr: any = ['in', fieldExpr, ['literal', filter.value.map(String)]];
      return filter.operator === 'not-any' ? ['!', expr] : expr;
    }
  }
  return null;
}

function buildFiltersExpression(activeFilters: FilterRule[]): any | null {
  if (!activeFilters.length) return null;
  const expressions = activeFilters
    .map(filter => buildFilterExpression(filter))
    .filter(Boolean) as any[];
  if (!expressions.length) return null;
  return expressions.length === 1 ? expressions[0] : ['all', ...expressions];
}

export function buildSavedFilterExpression(entry: SavedFilterEntry): any | null {
  const activeFilters = entry.filters.filter(isFilterComplete);
  const baseExpr = buildFiltersExpression(activeFilters);
  if (!baseExpr) return null;
  return entry.filterInvert ? ['!', baseExpr] : baseExpr;
}

function buildFilterModeExpression(): any | null {
  if (S.filterMode === 'none') return null;
  const activeFilters = getActiveFilters();
  const baseExpr = buildFiltersExpression(activeFilters);
  if (!baseExpr) return null;
  const modeExpr = S.filterMode === 'hide' ? ['!', baseExpr] : baseExpr;
  return S.filterInvert ? ['!', modeExpr] : modeExpr;
}

function resolveFilterValue(expr: any, feature: GeoJSON.Feature): any {
  if (!Array.isArray(expr)) return expr;
  const op = expr[0];
  switch (op) {
    case 'get': {
      const props = (feature.properties as Record<string, unknown> | undefined) ?? {};
      return props[expr[1]];
    }
    case 'literal':
      return expr[1];
    case 'to-number': {
      const value = resolveFilterValue(expr[1], feature);
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : NaN;
    }
    case 'to-string': {
      const value = resolveFilterValue(expr[1], feature);
      return value === null || value === undefined ? '' : String(value);
    }
    default:
      return expr;
  }
}

export function evaluateFilterExpression(expr: any, feature: GeoJSON.Feature): boolean {
  if (!Array.isArray(expr)) return Boolean(expr);
  const op = expr[0];
  switch (op) {
    case 'all':
      return expr.slice(1).every((clause: any) => evaluateFilterExpression(clause, feature));
    case '!':
      return !evaluateFilterExpression(expr[1], feature);
    case 'in': {
      const value = resolveFilterValue(expr[1], feature);
      const list = resolveFilterValue(expr[2], feature);
      return Array.isArray(list) ? list.includes(value) : false;
    }
    case '==':
      return resolveFilterValue(expr[1], feature) === resolveFilterValue(expr[2], feature);
    case '!=':
      return resolveFilterValue(expr[1], feature) !== resolveFilterValue(expr[2], feature);
    case '<':
      return resolveFilterValue(expr[1], feature) < resolveFilterValue(expr[2], feature);
    case '>':
      return resolveFilterValue(expr[1], feature) > resolveFilterValue(expr[2], feature);
    case '<=':
      return resolveFilterValue(expr[1], feature) <= resolveFilterValue(expr[2], feature);
    case '>=':
      return resolveFilterValue(expr[1], feature) >= resolveFilterValue(expr[2], feature);
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Legend visibility filter (used by combined visibility expressions) */
/* ------------------------------------------------------------------ */

export function buildLegendVisibilityFilterForState(
  field: string | null,
  fieldType: 'numeric' | 'categorical' | null,
  stats: { min: number; max: number } | null,
  mode: ColorMode,
  breaks: number[] | null,
  hiddenItems: Set<string>
): any | null {
  if (!field || hiddenItems.size === 0) return null;
  const conditions: any[] = [];

  if (fieldType === 'categorical') {
    const hiddenCategories = Array.from(hiddenItems);
    if (hiddenCategories.length > 0) {
      conditions.push(['!', ['in', ['to-string', ['get', field]], ['literal', hiddenCategories]]]);
    }
  } else {
    if (!stats) return null;
    const ranges: { min: number; max: number }[] = [];
    if (mode === 'quantiles' && breaks && breaks.length) {
      const rangeBreaks = [stats.min, ...breaks, stats.max];
      for (let i = 0; i < rangeBreaks.length - 1; i++) {
        ranges.push({ min: rangeBreaks[i], max: rangeBreaks[i + 1] });
      }
    } else {
      const min = stats.min;
      const max = stats.max;
      const step = (max - min) / 10;
      for (let i = 0; i < 10; i++) {
        ranges.push({
          min: min + (step * i),
          max: i === 9 ? max : min + (step * (i + 1))
        });
      }
    }

    hiddenItems.forEach(rangeKey => {
      const index = parseInt(rangeKey.split('_')[1]);
      if (ranges[index]) {
        const range = ranges[index];
        conditions.push(['!', ['all',
          ['>=', ['get', field], range.min],
          ['<=', ['get', field], range.max]
        ]]);
      }
    });
  }

  if (!conditions.length) return null;
  return conditions.length === 1 ? conditions[0] : ['all', ...conditions];
}

export function buildLegendVisibilityFilter(): any | null {
  return buildLegendVisibilityFilterForState(
    S.currentField,
    S.currentFieldType,
    S.currentStats,
    S.colorMode,
    S.colorBreaks,
    S.hiddenLegendItems
  );
}

/* ------------------------------------------------------------------ */
/*  Combined visibility expressions                                   */
/* ------------------------------------------------------------------ */

function buildFilterModeExpressionForLayer(layer: LayerState): any | null {
  if (layer.filterMode === 'none') return null;
  const activeFilters = layer.filters.filter(isFilterComplete);
  const baseExpr = buildFiltersExpression(activeFilters);
  if (!baseExpr) return null;
  const modeExpr = layer.filterMode === 'hide' ? ['!', baseExpr] : baseExpr;
  return layer.filterInvert ? ['!', modeExpr] : modeExpr;
}

export function buildStatisticsVisibilityExpression(): any | null {
  const expressions: any[] = [];
  const legendExpr = buildLegendVisibilityFilter();
  if (legendExpr) expressions.push(legendExpr);
  const filterExpr = buildFilterModeExpression();
  if (filterExpr) expressions.push(filterExpr);
  if (!expressions.length) return null;
  return expressions.length === 1 ? expressions[0] : ['all', ...expressions];
}

export function buildLayerVisibilityExpression(layer: LayerState): any | null {
  const expressions: any[] = [];
  const legendExpr = buildLegendVisibilityFilterForState(
    layer.field,
    layer.fieldType,
    layer.stats,
    layer.colorMode,
    layer.colorBreaks,
    layer.hiddenLegendItems
  );
  if (legendExpr) expressions.push(legendExpr);
  const filterExpr = buildFilterModeExpressionForLayer(layer);
  if (filterExpr) expressions.push(filterExpr);
  if (!expressions.length) return null;
  return expressions.length === 1 ? expressions[0] : ['all', ...expressions];
}

export function applyMapFilters() {
  const ids = _getCurrentLayerIds();
  if (!ids) return;
  const expressions: any[] = ['all'];
  const legendExpr = buildLegendVisibilityFilter();
  if (legendExpr) expressions.push(legendExpr);
  const filterExpr = buildFilterModeExpression();
  if (filterExpr) expressions.push(filterExpr);
  if (expressions.length > 1) {
    S.map.setFilter(ids.layerId, expressions as any);
  } else {
    S.map.setFilter(ids.layerId, null);
  }
  if (S.statsSubjectMode === 'visible' && S.statsLayerId === S.currentLayerId) {
    _updateStatisticsResults();
  }
  if (S.scatterSubjectMode === 'visible' && S.scatterLayerId === S.currentLayerId) {
    _scheduleScatterPlotRefresh();
  }
}

export function applyVisibilityFilters() {
  applyMapFilters();
}

/* ------------------------------------------------------------------ */
/*  Filter rules                                                      */
/* ------------------------------------------------------------------ */

export function createFilterRule(): FilterRule {
  return {
    id: `filter-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    field: null,
    fieldType: null,
    operator: null,
    value: null,
    active: true
  };
}

export function updateFiltersUIState() {
  const hasData = Boolean(S.currentGeoJSON);
  const hasActiveFilters = getActiveFilters().length > 0;
  const canApply = hasData && hasActiveFilters;
  if (addFilterButton) addFilterButton.disabled = false;
  if (!canApply) {
    S.filterMode = 'none';
  }
  updateSavedFiltersUIState();
}

export function renderFiltersList() {
  if (!filtersListEl) return;
  filtersListEl.replaceChildren();

  const availableFields = getAvailableFilterFields();

  S.filters.forEach(filter => {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const widget = document.createElement('div');
    widget.className = 'filter-widget';

    const headerRow = document.createElement('div');
    headerRow.className = 'filter-widget-header';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'filter-toggle';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = filter.active;
    toggleInput.addEventListener('change', () => {
      filter.active = toggleInput.checked;
      updateFiltersUIState();
      applyActiveFilterAction();
      _persistCurrentLayerState();
    });
    toggleLabel.append(toggleInput);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'filter-control-btn filter-delete-btn';
    deleteButton.textContent = '\u274C';
    deleteButton.title = 'Delete filter';
    deleteButton.addEventListener('click', () => {
      S.filters = S.filters.filter(existing => existing.id !== filter.id);
      renderFiltersList();
      updateFiltersUIState();
      applyActiveFilterAction();
      _persistCurrentLayerState();
    });

    headerRow.append(toggleLabel, deleteButton);
    widget.appendChild(headerRow);

    const fieldRow = document.createElement('div');
    fieldRow.className = 'filter-widget-row';

    const fieldSelect = document.createElement('select');
    const placeholderOption = new Option('Select field', '');
    placeholderOption.disabled = true;
    placeholderOption.selected = !filter.field;
    fieldSelect.appendChild(placeholderOption);
    availableFields.forEach(item => {
      const option = new Option(item.field, item.field);
      option.dataset.type = item.type;
      fieldSelect.appendChild(option);
    });
    if (filter.field) {
      fieldSelect.value = filter.field;
    }

    fieldSelect.addEventListener('change', () => {
      const selected = fieldSelect.value;
      const selectedOption = fieldSelect.selectedOptions[0];
      filter.field = selected;
      filter.fieldType = (selectedOption?.dataset.type as FilterFieldType) ?? null;
      filter.operator = null;
      filter.value = null;
      renderFiltersList();
      updateFiltersUIState();
      applyActiveFilterAction();
      _persistCurrentLayerState();
    });

    fieldRow.appendChild(fieldSelect);
    widget.appendChild(fieldRow);

    if (filter.field && filter.fieldType) {
      const operatorRow = document.createElement('div');
      operatorRow.className = 'filter-widget-row split';

      const operatorSelect = document.createElement('select');
      const operatorPlaceholder = new Option('Select condition', '');
      operatorPlaceholder.disabled = true;
      operatorPlaceholder.selected = !filter.operator;
      operatorSelect.appendChild(operatorPlaceholder);
      const operatorOptions = filter.fieldType === 'numeric'
        ? NUMERIC_FILTER_OPERATORS
        : CATEGORICAL_FILTER_OPERATORS;
      operatorOptions.forEach(option => {
        operatorSelect.appendChild(new Option(option.label, option.value));
      });
      if (filter.operator) {
        operatorSelect.value = filter.operator;
      }
      operatorSelect.addEventListener('change', () => {
        filter.operator = operatorSelect.value as FilterOperator;
        filter.value = null;
        renderFiltersList();
        updateFiltersUIState();
        applyActiveFilterAction();
        _persistCurrentLayerState();
      });
      operatorRow.appendChild(operatorSelect);

      if (filter.fieldType === 'numeric') {
        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.placeholder = 'Value';
        valueInput.value = typeof filter.value === 'number' ? String(filter.value) : '';
        valueInput.disabled = !filter.operator;
        valueInput.addEventListener('input', () => {
          const parsed = Number(valueInput.value);
          filter.value = Number.isFinite(parsed) ? parsed : null;
          updateFiltersUIState();
          applyActiveFilterAction();
          _persistCurrentLayerState();
        });
        operatorRow.appendChild(valueInput);
      } else {
        const categoricalValues = filter.field ? getCategoricalValues(filter.field) : [];
        const valueSelect = document.createElement('select');
        valueSelect.className = 'filter-value-select';
        if (filter.operator === 'any' || filter.operator === 'not-any') {
          valueSelect.multiple = true;
        }
        const needsPlaceholder = !valueSelect.multiple;
        if (needsPlaceholder) {
          const valuePlaceholder = new Option('Select value', '');
          valuePlaceholder.disabled = true;
          valuePlaceholder.selected = !filter.value;
          valueSelect.appendChild(valuePlaceholder);
        }
        categoricalValues.forEach(value => {
          valueSelect.appendChild(new Option(value, value));
        });

        if (Array.isArray(filter.value)) {
          Array.from(valueSelect.options).forEach(option => {
            option.selected = filter.value.includes(option.value);
          });
        } else if (typeof filter.value === 'string') {
          valueSelect.value = filter.value;
        }

        valueSelect.disabled = !filter.operator;
        valueSelect.addEventListener('change', () => {
          if (valueSelect.multiple) {
            const values = Array.from(valueSelect.selectedOptions).map(option => option.value);
            filter.value = values;
          } else {
            filter.value = valueSelect.value || null;
          }
          updateFiltersUIState();
          applyActiveFilterAction();
          _persistCurrentLayerState();
        });
        operatorRow.appendChild(valueSelect);
      }

      widget.appendChild(operatorRow);
    }

    row.append(widget);
    filtersListEl.appendChild(row);
  });
  updateFiltersPanelLayout();
}

/* ------------------------------------------------------------------ */
/*  Filter UI refresh                                                 */
/* ------------------------------------------------------------------ */

export function refreshFiltersUI() {
  syncFiltersWithAvailableFields();
  renderFiltersList();
  updateFiltersUIState();
}

/* ------------------------------------------------------------------ */
/*  Filter matching (JS-side evaluation)                              */
/* ------------------------------------------------------------------ */

function matchesFilterRule(feature: GeoJSON.Feature, filter: FilterRule): boolean {
  if (!filter.field || !filter.operator) return false;
  const rawValue = feature.properties?.[filter.field];
  if (filter.fieldType === 'numeric') {
    const numericValue = numOrNull(rawValue);
    if (numericValue === null || filter.value === null || !Number.isFinite(filter.value)) return false;
    const target = Number(filter.value);
    switch (filter.operator) {
      case 'lt':
        return numericValue < target;
      case 'gt':
        return numericValue > target;
      case 'lte':
        return numericValue <= target;
      case 'gte':
        return numericValue >= target;
      case 'eq':
        return numericValue === target;
      case 'neq':
        return numericValue !== target;
      default:
        return false;
    }
  }

  if (filter.fieldType === 'categorical') {
    if (rawValue === null || rawValue === undefined) return false;
    const value = String(rawValue);
    if (filter.operator === 'eq') return value === String(filter.value);
    if (filter.operator === 'neq') return value !== String(filter.value);
    if ((filter.operator === 'any' || filter.operator === 'not-any') && Array.isArray(filter.value)) {
      const hasValue = filter.value.map(String).includes(value);
      return filter.operator === 'not-any' ? !hasValue : hasValue;
    }
  }

  return false;
}

function matchesActiveFilters(feature: GeoJSON.Feature): boolean {
  const activeFilters = getActiveFilters();
  if (!activeFilters.length) return false;
  const baseMatch = activeFilters.every(filter => matchesFilterRule(feature, filter));
  return S.filterInvert ? !baseMatch : baseMatch;
}

/* ------------------------------------------------------------------ */
/*  Filter actions                                                    */
/* ------------------------------------------------------------------ */

export function applyActiveFilterAction() {
  const hasActiveFilters = getActiveFilters().length > 0;
  const nextMode: FilterMode = hasActiveFilters ? 'show' : 'none';
  S.filterActionMode = 'none';
  S.filterMode = nextMode;
  if (nextMode !== 'none') {
    _clearLegendVisibility();
  }
  applyMapFilters();
  updateFiltersUIState();
  _renderLayerList();
}
