/**
 * Filter-related logic extracted from main.ts.
 *
 * All functions that deal with filter rules, filter expressions (MapLibre),
 * saved filters, and the filters panel UI live here.
 */
import type { Expression } from 'maplibre-gl';
import {
  S,
  NUMERIC_FILTER_OPERATORS,
  CATEGORICAL_FILTER_OPERATORS,
  REFERENCE_FILTER_OPERATORS
} from './state';
import { numOrNull } from './utils.number';
import { updateFiltersPanelLayout } from './windows';
import type {
  FilterFieldType, FilterMode, FilterActionMode,
  FilterOperator, FilterRule, SavedFilterEntry,
  ColorMode, LayerState
} from './types';

const FILTER_REFERENCE_FIELD = '__named_filter__';
const FILTER_REFERENCE_LABEL = 'Named filter...';

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
let filtersContextLine: HTMLDivElement;

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
  filtersContextLine: HTMLDivElement;
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
  filtersContextLine = els.filtersContextLine;
  updateFiltersContextLine();
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
let _hideFiltersPanel: () => void;

type FiltersContext =
  | { type: 'layer' }
  | {
      type: 'landSchedule';
      getFilters: () => FilterRule[];
      getFilterInvert: () => boolean;
      setFilters: (filters: FilterRule[], filterInvert: boolean) => void;
      label: string;
      key: string;
    };

let filtersContext: FiltersContext = { type: 'layer' };
let layerFiltersSnapshot: {
  filters: FilterRule[];
  filterInvert: boolean;
  filterMode: FilterMode;
  filterActionMode: FilterActionMode;
} | null = null;

function getLayerContextLabel() {
  const layer = S.currentLayerId ? S.layers.get(S.currentLayerId) : null;
  const name = layer?.name || layer?.field || 'Current layer';
  return `Layer: ${name}`;
}

function updateFiltersContextLine() {
  if (!filtersContextLine) return;
  const label = filtersContext.type === 'landSchedule' ? filtersContext.label : getLayerContextLabel();
  filtersContextLine.textContent = `Context: "${label}"`;
}
export function initFilterCallbacks(cbs: {
  persistCurrentLayerState: () => void;
  renderLayerList: () => void;
  updateStatisticsResults: () => void;
  scheduleScatterPlotRefresh: () => void;
  getCurrentLayerIds: () => { sourceId: string; layerId: string; errorLayerId: string } | null;
  clearLegendVisibility: () => void;
  hideFiltersPanel: () => void;
}) {
  _persistCurrentLayerState = cbs.persistCurrentLayerState;
  _renderLayerList = cbs.renderLayerList;
  _updateStatisticsResults = cbs.updateStatisticsResults;
  _scheduleScatterPlotRefresh = cbs.scheduleScatterPlotRefresh;
  _getCurrentLayerIds = cbs.getCurrentLayerIds;
  _clearLegendVisibility = cbs.clearLegendVisibility;
  _hideFiltersPanel = cbs.hideFiltersPanel;
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

export function setFiltersContext(context: FiltersContext) {
  if (context.type === 'landSchedule') {
    if (!layerFiltersSnapshot) {
      layerFiltersSnapshot = {
        filters: cloneFilters(S.filters),
        filterInvert: S.filterInvert,
        filterMode: S.filterMode,
        filterActionMode: S.filterActionMode,
      };
    }
    S.filters = cloneFilters(context.getFilters());
    S.filterInvert = context.getFilterInvert();
    S.filterMode = 'none';
    S.filterActionMode = 'none';
  } else if (filtersContext.type === 'landSchedule' && layerFiltersSnapshot) {
    S.filters = cloneFilters(layerFiltersSnapshot.filters);
    S.filterInvert = layerFiltersSnapshot.filterInvert;
    S.filterMode = layerFiltersSnapshot.filterMode;
    S.filterActionMode = layerFiltersSnapshot.filterActionMode;
    layerFiltersSnapshot = null;
  }

  filtersContext = context;
  if (filtersInvertToggle) {
    filtersInvertToggle.checked = S.filterInvert;
  }
  updateFiltersContextLine();
  renderFiltersList();
  updateFiltersUIState();
}

export function persistFiltersContext() {
  if (filtersContext.type === 'landSchedule') {
    filtersContext.setFilters(cloneFilters(S.filters), S.filterInvert);
    return;
  }
  _persistCurrentLayerState();
}

export function invalidateFiltersContextIf(predicate: (context: FiltersContext) => boolean) {
  if (!predicate(filtersContext)) return;
  if (filtersContext.type === 'landSchedule') {
    setFiltersContext({ type: 'layer' });
  }
  _hideFiltersPanel?.();
}

function getReferenceFilterName(filter: FilterRule): string | null {
  if (filter.fieldType !== 'reference') return null;
  if (typeof filter.value !== 'string') return null;
  const trimmed = filter.value.trim();
  return trimmed ? trimmed : null;
}

function getSavedFilterReferenceGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  S.savedFiltersStore.forEach(entry => {
    const references = entry.filters
      .map(rule => getReferenceFilterName(rule))
      .filter((name): name is string => Boolean(name));
    graph.set(entry.name, references);
  });
  return graph;
}

function isCircularSavedFilter(name: string): boolean {
  const graph = getSavedFilterReferenceGraph();
  const visited = new Set<string>();
  const stack = new Set<string>();

  const visit = (node: string): boolean => {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    const refs = graph.get(node) ?? [];
    for (const ref of refs) {
      if (!graph.has(ref)) continue;
      if (visit(ref)) return true;
    }
    stack.delete(node);
    return false;
  };

  return visit(name);
}

function showCircularFilterModal(name: string) {
  window.alert(`Circular filter reference detected. "${name}" cannot be used because it references itself (directly or indirectly).`);
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
  persistFiltersContext();
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
    if (filter.fieldType === 'reference') return;
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
  if (filter.fieldType === 'reference') {
    return typeof filter.value === 'string' && filter.value.trim().length > 0;
  }
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

function buildFilterExpression(filter: FilterRule, stack: Set<string>): any | null {
  if (!filter.field || !filter.operator || filter.value === null) return null;
  if (filter.fieldType === 'reference') {
    const referenceName = getReferenceFilterName(filter);
    if (!referenceName) return null;
    const entry = S.savedFiltersStore.get(referenceName);
    if (!entry) return null;
    const referenceExpr = buildSavedFilterExpression(entry, stack);
    if (!referenceExpr) return null;
    return filter.operator === 'ref-false' ? ['!', referenceExpr] : referenceExpr;
  }
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

function buildFiltersExpression(activeFilters: FilterRule[], stack: Set<string>): any | null {
  if (!activeFilters.length) return null;
  const expressions = activeFilters
    .map(filter => buildFilterExpression(filter, stack))
    .filter(Boolean) as any[];
  if (!expressions.length) return null;
  return expressions.length === 1 ? expressions[0] : ['all', ...expressions];
}

export function buildSavedFilterExpression(entry: SavedFilterEntry, stack: Set<string> = new Set()): any | null {
  if (stack.has(entry.name)) {
    showCircularFilterModal(entry.name);
    return null;
  }
  const nextStack = new Set(stack);
  nextStack.add(entry.name);
  const activeFilters = entry.filters.filter(isFilterComplete);
  const baseExpr = buildFiltersExpression(activeFilters, nextStack);
  if (!baseExpr) return null;
  return entry.filterInvert ? ['!', baseExpr] : baseExpr;
}

function buildFilterModeExpression(): any | null {
  if (S.filterMode === 'none') return null;
  const activeFilters = getActiveFilters();
  const baseExpr = buildFiltersExpression(activeFilters, new Set());
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
  const baseExpr = buildFiltersExpression(activeFilters, new Set());
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
  if (filtersContext.type === 'landSchedule') return;
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
  const savedFilterNames = Array.from(S.savedFiltersStore.values())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const circularSavedFilters = new Set(
    savedFilterNames.filter(name => isCircularSavedFilter(name))
  );

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
      persistFiltersContext();
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
      persistFiltersContext();
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
    const referenceOption = new Option(FILTER_REFERENCE_LABEL, FILTER_REFERENCE_FIELD);
    referenceOption.dataset.type = 'reference';
    fieldSelect.appendChild(referenceOption);
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
      persistFiltersContext();
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
        : filter.fieldType === 'categorical'
          ? CATEGORICAL_FILTER_OPERATORS
          : REFERENCE_FILTER_OPERATORS;
      operatorOptions.forEach(option => {
        operatorSelect.appendChild(new Option(option.label, option.value));
      });
      if (filter.operator) {
        operatorSelect.value = filter.operator;
      }
      operatorSelect.addEventListener('change', () => {
        filter.operator = operatorSelect.value as FilterOperator;
        if (filter.fieldType !== 'reference') {
          filter.value = null;
        }
        renderFiltersList();
        updateFiltersUIState();
        applyActiveFilterAction();
        persistFiltersContext();
      });
      if (filter.fieldType === 'reference') {
        operatorSelect.disabled = !filter.value;
      }
      operatorRow.appendChild(operatorSelect);

      if (filter.fieldType === 'reference') {
        const valueSelect = document.createElement('select');
        const valuePlaceholder = new Option('Select value', '');
        valuePlaceholder.disabled = true;
        valuePlaceholder.selected = !filter.value;
        valueSelect.appendChild(valuePlaceholder);

        if (savedFilterNames.length === 0) {
          const emptyOption = new Option('No saved filters available', '');
          emptyOption.disabled = true;
          valueSelect.appendChild(emptyOption);
          valueSelect.disabled = true;
        } else {
          savedFilterNames.forEach(name => {
            const option = new Option(name, name);
            valueSelect.appendChild(option);
          });
          if (typeof filter.value === 'string') {
            valueSelect.value = filter.value;
          }
        }

        valueSelect.addEventListener('change', () => {
          const selectedValue = valueSelect.value || null;
          if (!selectedValue) {
            filter.value = null;
            filter.operator = null;
            renderFiltersList();
            updateFiltersUIState();
            applyActiveFilterAction();
            persistFiltersContext();
            return;
          }
          if (circularSavedFilters.has(selectedValue) || isCircularSavedFilter(selectedValue)) {
            showCircularFilterModal(selectedValue);
            valueSelect.value = '';
            filter.value = null;
            filter.operator = null;
            renderFiltersList();
            updateFiltersUIState();
            applyActiveFilterAction();
            persistFiltersContext();
            return;
          }
          filter.value = selectedValue;
          renderFiltersList();
          updateFiltersUIState();
          applyActiveFilterAction();
          persistFiltersContext();
        });

        operatorRow.appendChild(valueSelect);
      } else if (filter.fieldType === 'numeric') {
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
          persistFiltersContext();
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
          persistFiltersContext();
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
  updateFiltersContextLine();
  renderFiltersList();
  updateFiltersUIState();
}

/* ------------------------------------------------------------------ */
/*  Filter matching (JS-side evaluation)                              */
/* ------------------------------------------------------------------ */

function matchesFilterRule(feature: GeoJSON.Feature, filter: FilterRule): boolean {
  if (!filter.field || !filter.operator) return false;
  if (filter.fieldType === 'reference') {
    const referenceName = getReferenceFilterName(filter);
    if (!referenceName) return false;
    const entry = S.savedFiltersStore.get(referenceName);
    if (!entry) return false;
    const referenceExpr = buildSavedFilterExpression(entry);
    if (!referenceExpr) return false;
    const resolved = evaluateFilterExpression(referenceExpr, feature);
    return filter.operator === 'ref-false' ? !resolved : resolved;
  }
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
  if (filtersContext.type === 'landSchedule') {
    persistFiltersContext();
    updateFiltersUIState();
    return;
  }
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
