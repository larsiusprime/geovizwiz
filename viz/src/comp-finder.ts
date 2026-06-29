import maplibregl from 'maplibre-gl';
import { perfSpan } from './perf.js';
import PIN_SVG from './svg/pin.svg?raw';

import { S } from './state';
import type { DataStore, LayerState } from './types';
import { fmt, numOrNull } from './utils.number';
import { el, makeButton } from './utils.dom';
import { downloadText, rowsToCsv, downloadXlsx } from './utils.export';
import { centerOnLngLatInVisibleMapArea, fitBoundsInVisibleMapArea } from './map-viewport';
import {
  makeDistanceCircleFeature, getFeatureCenter, isValidLngLat, distanceMeters, getPageTokens, getDeltaClass, buildDelta,
} from './comp-finder-helpers';
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { create } from "@bufbuild/protobuf";
import type { ComparableCriteria } from "@civil-labs/civil-api-js";
import { ParcelsService, GetEquityComparablesRequestSchema, GetSalesComparablesRequestSchema, ComparableCriteriaSchema, ParcelAttribute } from "@civil-labs/civil-api-js";
import { resolveCivilSelectionIds } from './selection';
import enTranslations from '../locales/en.json';
import esTranslations from '../locales/es.json';

const translations: Record<string, Record<string, string>> = {
  en: enTranslations,
  es: esTranslations
};

function t(key: string): string {
  const lang = localStorage.getItem('language') || 'en';
  const langDict = translations[lang] || translations['en'];
  return langDict[key] || key;
}

function getParcelAttributeForField(store: DataStore, field: string): ParcelAttribute | null {
  if (field === store.landSizeField) return ParcelAttribute.LAND_AREA_SQ_FT;
  if (field === store.bldgSizeField) return ParcelAttribute.IMPROVEMENT_AREA_SQ_FT;
  if (field === store.bldgAgeField) return ParcelAttribute.IMPROVEMENT_YEAR_BUILT;
  if (field === store.bldgEffAgeField) return ParcelAttribute.IMPROVEMENT_EFFECTIVE_YEAR_BUILT;
  if (field === store.bldgBedsField) return ParcelAttribute.BEDROOMS;
  if (field === store.bldgBathsField) return ParcelAttribute.BATHROOMS;
  if (field === store.bldgConditionField) return ParcelAttribute.CONDITION_ID;
  if (field === store.bldgTypeField) return ParcelAttribute.IMPROVEMENT_TYPE_ID;
  if (field === store.landTypeField) return ParcelAttribute.LAND_USE_ID;
  if (field === store.landZoningField) return ParcelAttribute.ZONING_ID;
  return null;
}

function getFieldLabel(store: DataStore | null, field: string): string {
  if (store?.isCivil) {
    const attr = getParcelAttributeForField(store, field);
    if (attr !== null) {
      const key = ParcelAttribute[attr].toLowerCase();
      return t(key);
    }
  }
  return field;
}

import {
  compFinderControlsEl,
  compFinderDataSourceSelect,
  compFinderUseDistance,
  compFinderDistanceInput,
  compFinderDistanceUnits,
  compFinderUseSelection,
  compFinderCriteriaThresholdError,
  compFinderCriteriaWidgets,
  compFinderCriteriaTableBody,
  compFinderAddCriterion,
  compFinderRefresh,
  compFinderDirtyIndicator,
  compFinderNoCompsIndicator,
  compFinderSpinner,
  compFinderResultsRow,
  compFinderResultsSummary,
  compFinderPager,
  compFinderEmptyState,
  compFinderCriteriaSection,
  compFinderCompsSection,
  compFinderCriteriaCompsDivider,
  compFinderCompsTableHead,
  compFinderCompsTableBody,
  compFinderCompsTableContainer,
  compFinderAddFieldSelect,
  compFinderAddFieldButton,
  compFinderAddFieldRow,
  compFinderZoomButton,
  compFinderExportCsv,
  compFinderExportExcel,
} from './dom-refs';

type Criterion = {
  id: string;
  field: string | null;
  fieldType: 'numeric' | 'categorical' | null;
  value: number | string[] | null;
  usePercent: boolean;
};

type CompRow = {
  id: string;
  feature: GeoJSON.Feature;
  deltas: Array<{ text: string; error?: string; sign?: 'positive' | 'negative' | 'neutral' | 'error' }>;
  parcelId: string;
  address: string;
};

type Elements = {
  panel: HTMLDivElement;
  dataSourceSelect: HTMLSelectElement;
  distanceEnabledInput: HTMLInputElement;
  distanceInput: HTMLInputElement;
  distanceUnitsSelect: HTMLSelectElement;
  selectionEnabledInput: HTMLInputElement;
  thresholdError: HTMLDivElement;
  criteriaWidgets: HTMLDivElement;
  criteriaTableBody: HTMLTableSectionElement;
  addCriterionButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
  dirtyIndicator: HTMLSpanElement;
  noCompsIndicator: HTMLSpanElement;
  spinner: HTMLDivElement;
  resultsRow: HTMLDivElement;
  resultsSummary: HTMLSpanElement;
  pager: HTMLDivElement;
  emptyState: HTMLDivElement;
  criteriaSection: HTMLDivElement;
  compsSection: HTMLDivElement;
  criteriaCompsDivider: HTMLDivElement;
  compsTableHead: HTMLTableSectionElement;
  compsTableBody: HTMLTableSectionElement;
  compsTableContainer: HTMLDivElement;
  addFieldSelect: HTMLSelectElement;
  addFieldButton: HTMLButtonElement;
  addFieldRow: HTMLDivElement;
  zoomButton: HTMLButtonElement;
  exportCsvButton: HTMLButtonElement;
  exportExcelButton: HTMLButtonElement;
};

type Callbacks = {
  showCompFinderMenu: () => void;
};

const els: Elements = {
  panel: compFinderControlsEl,
  dataSourceSelect: compFinderDataSourceSelect,
  distanceEnabledInput: compFinderUseDistance,
  distanceInput: compFinderDistanceInput,
  distanceUnitsSelect: compFinderDistanceUnits,
  selectionEnabledInput: compFinderUseSelection,
  thresholdError: compFinderCriteriaThresholdError,
  criteriaWidgets: compFinderCriteriaWidgets,
  criteriaTableBody: compFinderCriteriaTableBody,
  addCriterionButton: compFinderAddCriterion,
  refreshButton: compFinderRefresh,
  dirtyIndicator: compFinderDirtyIndicator,
  noCompsIndicator: compFinderNoCompsIndicator,
  spinner: compFinderSpinner,
  resultsRow: compFinderResultsRow,
  resultsSummary: compFinderResultsSummary,
  pager: compFinderPager,
  emptyState: compFinderEmptyState,
  criteriaSection: compFinderCriteriaSection,
  compsSection: compFinderCompsSection,
  criteriaCompsDivider: compFinderCriteriaCompsDivider,
  compsTableHead: compFinderCompsTableHead,
  compsTableBody: compFinderCompsTableBody,
  compsTableContainer: compFinderCompsTableContainer,
  addFieldSelect: compFinderAddFieldSelect,
  addFieldButton: compFinderAddFieldButton,
  addFieldRow: compFinderAddFieldRow,
  zoomButton: compFinderZoomButton,
  exportCsvButton: compFinderExportCsv,
  exportExcelButton: compFinderExportExcel,
};
let callbacks: Callbacks;

let subject: {
  feature: GeoJSON.Feature;
  dataStoreId: string;
  layerId: string;
  parcelId: string;
  address: string;
  center: [number, number];
} | null = null;

let criteria: Criterion[] = [];
let extraFields: Array<{ field: string; type: 'numeric' | 'categorical' }> = [];
let comps: CompRow[] = [];
let compMarkers = new Map<string, maplibregl.Marker>();
let subjectMarker: maplibregl.Marker | null = null;
let isMenuVisible = false;
let currentPage = 1;
let sortField: string | null = null;
let sortDirection: 'asc' | 'desc' = 'asc';
let hasAttemptedFind = false;

const COMP_MARKER_CLASS = 'comp-finder-marker';
const SUBJECT_MARKER_CLASS = 'comp-finder-marker subject';
const COMPS_PER_PAGE = 3;
const COMP_DISTANCE_SOURCE_ID = 'comp-finder-distance-source';
const COMP_DISTANCE_FILL_LAYER_ID = 'comp-finder-distance-fill';
const COMP_DISTANCE_OUTLINE_BLACK_ID = 'comp-finder-distance-outline-black';
const COMP_DISTANCE_OUTLINE_WHITE_ID = 'comp-finder-distance-outline-white';

const COMP_FINDER_DEBUG = true;

function compDebug(message: string, payload?: Record<string, unknown>) {
  if (!COMP_FINDER_DEBUG) return;
  if (payload) console.debug(`[comp-finder] ${message}`, payload);
  else console.debug(`[comp-finder] ${message}`);
}





function clearDistanceOverlay() {
  if (S.map.getLayer(COMP_DISTANCE_OUTLINE_WHITE_ID)) S.map.removeLayer(COMP_DISTANCE_OUTLINE_WHITE_ID);
  if (S.map.getLayer(COMP_DISTANCE_OUTLINE_BLACK_ID)) S.map.removeLayer(COMP_DISTANCE_OUTLINE_BLACK_ID);
  if (S.map.getLayer(COMP_DISTANCE_FILL_LAYER_ID)) S.map.removeLayer(COMP_DISTANCE_FILL_LAYER_ID);
  if (S.map.getSource(COMP_DISTANCE_SOURCE_ID)) S.map.removeSource(COMP_DISTANCE_SOURCE_ID);
}

function updateDistanceOverlay() {
  if (!isMenuVisible || !subject) {
    clearDistanceOverlay();
    return;
  }
  const radiusMeters = els.distanceEnabledInput.checked ? getDistanceLimitMeters() : null;
  if (!radiusMeters) {
    clearDistanceOverlay();
    return;
  }
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [makeDistanceCircleFeature(subject.center, radiusMeters)],
  };
  const existing = S.map.getSource(COMP_DISTANCE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else {
    S.map.addSource(COMP_DISTANCE_SOURCE_ID, { type: 'geojson', data });
    S.map.addLayer({ id: COMP_DISTANCE_FILL_LAYER_ID, type: 'fill', source: COMP_DISTANCE_SOURCE_ID, paint: { 'fill-color': '#fef3c7', 'fill-opacity': 0.35 } });
    S.map.addLayer({ id: COMP_DISTANCE_OUTLINE_BLACK_ID, type: 'line', source: COMP_DISTANCE_SOURCE_ID, paint: { 'line-color': '#111827', 'line-width': 2, 'line-dasharray': [2, 2] } });
    S.map.addLayer({ id: COMP_DISTANCE_OUTLINE_WHITE_ID, type: 'line', source: COMP_DISTANCE_SOURCE_ID, paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-dasharray': [2, 2] } });
  }
}

function updateMapArtifacts() {
  updateSubjectMarker();
  updateCompMarkers();
  updateDistanceOverlay();
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function getLayerById(layerId: string): LayerState | null {
  return S.layers.get(layerId) ?? null;
}

function getDataStoreById(id: string): DataStore | null {
  return S.dataStores.get(id) ?? null;
}

function getDataStoreForSubject(): DataStore | null {
  if (!subject) return null;
  return getDataStoreById(subject.dataStoreId);
}

function getCompLayer(): LayerState | null {
  const layerId = els.dataSourceSelect.value || subject?.layerId;
  if (!layerId) return null;
  return getLayerById(layerId);
}

function getCompDataStore(): DataStore | null {
  const layer = getCompLayer();
  if (!layer) return null;
  return getDataStoreById(layer.dataStoreId);
}

function ensureMarker(elClass: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = elClass;
  el.innerHTML = `<div class="comp-finder-pin-bounce-wrap">${PIN_SVG}</div>`;

  const middle = elClass.includes('subject') ? '#facc15' : '#93c5fd';
  el.style.setProperty('--c-middle', middle);
  el.style.setProperty('--c-dot', '#000000');
  el.style.setProperty('--c-outline1', '#000000');
  el.style.setProperty('--c-outline2', '#ffffff');
  return el;
}

function setFinding(next: boolean) {
  els.spinner.style.display = next ? 'inline-block' : 'none';
  els.refreshButton.disabled = next;
}

function setCriteriaDirty(dirty: boolean) {
  els.compsTableContainer.classList.toggle('is-dirty', dirty);
  els.dirtyIndicator.style.display = dirty && comps.length > 0 ? 'inline' : 'none';
  updateRefreshButtonLabel();
  updateNoCompsIndicator();
}


function updateNoCompsIndicator() {
  const show = hasAttemptedFind && comps.length === 0 && Boolean(subject);
  els.noCompsIndicator.style.display = show ? 'inline' : 'none';
}

function updateRefreshButtonLabel() {
  if (comps.length > 0) {
    els.refreshButton.textContent = 'Refresh comps';
  } else {
    els.refreshButton.textContent = 'Find comps';
  }
}

function clearCompMarkers() {
  for (const marker of compMarkers.values()) {
    marker.remove();
  }
  compMarkers.clear();
}

function clearSubjectMarker() {
  if (subjectMarker) {
    subjectMarker.remove();
    subjectMarker = null;
  }
}

function updateActionButtons() {
  els.zoomButton.disabled = false;
  els.exportCsvButton.disabled = false;
  els.exportExcelButton.disabled = false;
}

function updateSubjectMarker() {
  if (!subject || !isMenuVisible) {
    clearSubjectMarker();
    return;
  }
  if (!subjectMarker) {
    subjectMarker = new maplibregl.Marker({ element: ensureMarker(SUBJECT_MARKER_CLASS), anchor: 'bottom' });
  }
  subjectMarker.setLngLat(subject.center).addTo(S.map);
}

function updateCompMarkers() {
  clearCompMarkers();
  if (!isMenuVisible) return;
  for (const comp of comps) {
    const center = getFeatureCenter(comp.feature);
    if (!center) continue;
    const marker = new maplibregl.Marker({ element: ensureMarker(COMP_MARKER_CLASS), anchor: 'bottom' })
      .setLngLat(center)
      .addTo(S.map);
    marker.getElement().addEventListener('click', (event) => {
      event.stopPropagation();
      const targetLayerId = els.dataSourceSelect.value || subject?.layerId;
      if (targetLayerId) setCompFinderSubject(comp.feature, targetLayerId);
    });
    compMarkers.set(comp.id, marker);
  }
}




function getDistanceLimitMeters(): number | null {
  const distanceValue = numOrNull(els.distanceInput.value);
  if (distanceValue === null || distanceValue < 0) return null;
  const unit = els.distanceUnitsSelect.value;
  const unitToMeters: Record<string, number> = {
    mi: 1609.344,
    km: 1000,
  };
  return distanceValue * (unitToMeters[unit] ?? 1);
}

function getFieldValue(feature: GeoJSON.Feature, field: string | null): any {
  if (!field) return null;
  return feature.properties?.[field];
}

function getAvailableFieldsForDataStore(dataStore: DataStore | null) {
  if (!dataStore) return { numeric: [] as string[], categorical: [] as string[] };
  if (dataStore.isCivil) {
    const numeric = [
      dataStore.landSizeField,
      dataStore.bldgSizeField,
      dataStore.bldgBedsField,
      dataStore.bldgBathsField,
      dataStore.bldgAgeField,
      dataStore.bldgEffAgeField,
    ].filter(Boolean) as string[];

    const categorical = [
      dataStore.bldgConditionField,
      dataStore.bldgTypeField,
      dataStore.landTypeField,
      dataStore.landZoningField,
    ].filter(Boolean) as string[];

    return { numeric, categorical };
  }
  return {
    numeric: dataStore.chosenNumericFields ?? [],
    categorical: dataStore.chosenCategoricalFields ?? [],
  };
}

function getIntersectionFields(): Array<{ field: string; type: 'numeric' | 'categorical' }> {
  const subjectStore = getDataStoreForSubject();
  const compStore = getCompDataStore();
  if (!subjectStore || !compStore) return [];
  const subjectFields = getAvailableFieldsForDataStore(subjectStore);
  const compFields = getAvailableFieldsForDataStore(compStore);
  const numeric = subjectFields.numeric.filter((f) => compFields.numeric.includes(f));
  const categorical = subjectFields.categorical.filter((f) => compFields.categorical.includes(f));
  return [
    ...numeric.map((field) => ({ field, type: 'numeric' as const })),
    ...categorical.map((field) => ({ field, type: 'categorical' as const })),
  ];
}

function getFieldType(field: string): 'numeric' | 'categorical' | null {
  const match = getIntersectionFields().find((entry) => entry.field === field);
  return match?.type ?? null;
}

function formatSubjectValue(field: string | null, type: 'numeric' | 'categorical' | null): string {
  if (!subject || !field || !type) return '—';
  const value = getFieldValue(subject.feature, field);
  if (value === null || value === undefined || value === '') return '—';
  return type === 'numeric' ? fmt(value) : String(value);
}

function getComparisonFields(): Array<{ field: string; type: 'numeric' | 'categorical'; source: 'criteria' | 'extra' }> {
  const out: Array<{ field: string; type: 'numeric' | 'categorical'; source: 'criteria' | 'extra' }> = [];
  const seen = new Set<string>();
  criteria.forEach((row) => {
    if (!row.field || !row.fieldType || seen.has(row.field)) return;
    seen.add(row.field);
    out.push({ field: row.field, type: row.fieldType, source: 'criteria' });
  });
  extraFields.forEach((row) => {
    if (seen.has(row.field)) return;
    seen.add(row.field);
    out.push({ field: row.field, type: row.type, source: 'extra' });
  });
  return out;
}

function getCategoricalValuesForField(field: string): Array<{value: string, label: string}> {
  const store = getCompDataStore();
  if (!store) return [];
  if (store.isCivil) {
    let mapToUse: Record<string, any> | undefined;
    if (field === store.landZoningField) mapToUse = store.civilZoningMap;
    else if (field === store.landTypeField) mapToUse = store.civilLandUseMap;
    else if (field === store.bldgTypeField) mapToUse = store.civilImprovementTypeMap;
    else if (field === store.bldgConditionField) mapToUse = store.civilImprovementConditionMap;
    
    if (mapToUse) {
      return Object.values(mapToUse).map((v: any) => ({
        value: String(v.code || v.id || ''),
        label: t(v.name || v.code || String(v.id || ''))
      })).filter(x => x.value).sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  if (!store.geojson) return [];
  const values = new Set<string>();
  for (const feature of store.geojson.features) {
    const raw = feature.properties?.[field];
    if (raw === undefined || raw === null || raw === '') continue;
    values.add(String(raw));
  }
  return Array.from(values).sort().map(v => ({ value: v, label: v }));
}

function renderAddFieldOptions() {
  const current = new Set([...criteria.map((c) => c.field).filter(Boolean) as string[], ...extraFields.map((f) => f.field)]);
  const available = getIntersectionFields().filter((entry) => !current.has(entry.field));
  els.addFieldSelect.innerHTML = '';
  available.forEach((entry, idx) => {
    const option = document.createElement('option');
    option.value = entry.field;
    option.textContent = `${getFieldLabel(getCompDataStore(), entry.field)} (${entry.type})`;
    if (idx === 0) option.selected = true;
    els.addFieldSelect.appendChild(option);
  });
  els.addFieldButton.disabled = available.length === 0;
}

function renderCriteriaTable() {
  const availableFields = getIntersectionFields();
  els.criteriaTableBody.innerHTML = '';

  criteria.forEach((row) => {
    if (row.field && !row.fieldType) {
      const match = availableFields.find((item) => item.field === row.field);
      row.fieldType = match?.type ?? null;
    }
    const tr = document.createElement('tr');
    const fieldCell = document.createElement('td');
    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'comp-finder-criteria-field-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select field';
    placeholder.disabled = true;
    placeholder.selected = !row.field;
    fieldSelect.appendChild(placeholder);
    availableFields.forEach(({ field, type }) => {
      const option = document.createElement('option');
      option.value = field;
      option.textContent = field;
      option.dataset.fieldType = type;
      if (row.field === field) option.selected = true;
      fieldSelect.appendChild(option);
    });
    fieldSelect.addEventListener('change', () => {
      const selected = fieldSelect.selectedOptions[0];
      row.field = selected?.value ?? null;
      row.fieldType = (selected?.dataset.fieldType as 'numeric' | 'categorical' | null) ?? null;
      if (row.fieldType === 'categorical' && row.field) {
        const subjectValue = getFieldValue(subject!.feature, row.field);
        row.value = (subjectValue === null || subjectValue === undefined || subjectValue === '') ? [] : [String(subjectValue)];
      } else {
        row.value = row.fieldType === 'numeric' ? 10 : null;
      }
      row.usePercent = row.fieldType === 'numeric';
      setCriteriaDirty(true);
      renderCriteriaTable();
      renderCompsTable();
    });
    fieldCell.appendChild(fieldSelect);
    tr.appendChild(fieldCell);

    const subjectCell = document.createElement('td');
    subjectCell.textContent = formatSubjectValue(row.field, row.fieldType);
    tr.appendChild(subjectCell);

    const toleranceCell = document.createElement('td');
    const percentCell = document.createElement('td');
    percentCell.className = 'center';

    if (row.fieldType === 'numeric') {
      const wrapper = document.createElement('div');
      wrapper.className = 'comp-finder-row';
      const prefix = document.createElement('span');
      prefix.className = 'muted';
      prefix.textContent = '+/-';
      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.min = '0';
      input.value = row.value !== null && row.value !== undefined ? String(row.value) : '10';
      input.style.width = '90px';
      input.addEventListener('input', () => {
        const numericValue = numOrNull(input.value);
        if (numericValue === null) {
          row.value = null;
        } else {
          const sanitizedValue = Math.max(0, numericValue);
          row.value = sanitizedValue;
          if (sanitizedValue !== numericValue) {
            input.value = String(sanitizedValue);
          }
        }
        setCriteriaDirty(true);
      });
      wrapper.append(prefix, input);
      toleranceCell.appendChild(wrapper);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = row.usePercent;
      checkbox.addEventListener('change', () => {
        row.usePercent = checkbox.checked;
        setCriteriaDirty(true);
      });
      percentCell.appendChild(checkbox);
    } else if (row.fieldType === 'categorical') {
      const select = document.createElement('select');
      select.className = 'comp-finder-criteria-categorical';
      select.multiple = true;
            const values = row.field ? getCategoricalValuesForField(row.field) : [];
      values.forEach((v) => {
        const option = document.createElement('option');
        option.value = v.value;
        option.textContent = v.label;
        option.selected = Array.isArray(row.value) && row.value.includes(v.value);
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        row.value = Array.from(select.selectedOptions).map((opt) => opt.value);
        setCriteriaDirty(true);
      });
      toleranceCell.appendChild(select);

      percentCell.textContent = 'N/A';
      percentCell.classList.add('muted');
    } else {
      toleranceCell.textContent = '—';
      percentCell.textContent = '—';
      percentCell.classList.add('muted');
    }

    tr.appendChild(toleranceCell);
    tr.appendChild(percentCell);

    const deleteCell = document.createElement('td');
    deleteCell.className = 'center';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'comp-finder-delete-btn';
    deleteButton.textContent = '❌';
    deleteButton.addEventListener('click', () => {
      criteria = criteria.filter((item) => item.id !== row.id);
      setCriteriaDirty(true);
      renderCriteriaTable();
      renderCompsTable();
    });
    deleteCell.appendChild(deleteButton);
    tr.appendChild(deleteCell);

    els.criteriaTableBody.appendChild(tr);
  });

  renderAddFieldOptions();

  // Desktop streams a lean column set; make sure the criteria fields are loaded
  // on the visible features so comps can be evaluated. No-op in browser.
  if (window.vizDesktop) {
    window.dispatchEvent(new CustomEvent('viz:request-fields', {
      detail: getComparisonFields().map((f) => f.field)
    }));
  }
}

function buildCompsSortValue(comp: CompRow, field: string) {
  if (field === '__id') return comp.parcelId;
  if (field === '__address') return comp.address;
  return getFieldValue(comp.feature, field);
}

function sortCompsRows(rows: CompRow[]): CompRow[] {
  if (!sortField) return rows;
  const field = sortField;
  const dir = sortDirection === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = buildCompsSortValue(a, field);
    const vb = buildCompsSortValue(b, field);
    const na = numOrNull(va);
    const nb = numOrNull(vb);
    if (na !== null && nb !== null) return (na - nb) * dir;
    return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
  });
}

function getSortedComps(): CompRow[] {
  return sortCompsRows(comps);
}

function totalPages() {
  return Math.max(1, Math.ceil(comps.length / COMPS_PER_PAGE));
}

function getVisibleComps(): CompRow[] {
  const sorted = getSortedComps();
  const start = (currentPage - 1) * COMPS_PER_PAGE;
  return sorted.slice(start, start + COMPS_PER_PAGE);
}


function renderPager() {
  const total = totalPages();
  currentPage = Math.min(Math.max(currentPage, 1), total);
  els.pager.innerHTML = '';

  const prev = el('button', {
    className: 'comp-finder-page-btn',
    text: '◀',
    on: { click: () => { currentPage = Math.max(1, currentPage - 1); renderCompsTable(); } },
  });
  prev.disabled = currentPage <= 1;
  els.pager.appendChild(prev);

  getPageTokens(total, currentPage).forEach((token) => {
    if (token === '...') {
      els.pager.appendChild(el('span', { text: '…' }));
      return;
    }
    const btn = el('button', {
      className: 'comp-finder-page-btn',
      text: String(token),
      on: { click: () => { currentPage = token; renderCompsTable(); } },
    });
    if (token === currentPage) btn.classList.add('is-active');
    els.pager.appendChild(btn);
  });

  const next = el('button', {
    className: 'comp-finder-page-btn',
    text: '▶',
    on: { click: () => { currentPage = Math.min(total, currentPage + 1); renderCompsTable(); } },
  });
  next.disabled = currentPage >= total;
  els.pager.appendChild(next);
}


function renderSortableRowLabel(label: string, fieldKey: string): HTMLElement {
  const arrow = sortField === fieldKey ? (sortDirection === 'asc' ? '▾' : '▴') : '';
  return el('span', {
    className: 'comp-finder-sort-label',
    text: arrow ? `${label} ${arrow}` : label,
    on: {
      click: () => {
        if (sortField === fieldKey) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = fieldKey;
          sortDirection = 'asc';
        }
        renderCompsTable();
      },
    },
  });
}

function bounceCompMarker(comp: CompRow) {
  const marker = compMarkers.get(comp.id);
  if (!marker) return;
  const markerEl = marker.getElement();
  const bounceEl = markerEl.querySelector('.comp-finder-pin-bounce-wrap') as HTMLElement | null;
  if (!bounceEl) return;
  bounceEl.classList.remove('is-bouncing');
  // Force reflow so repeated clicks restart the animation.
  void bounceEl.offsetWidth;
  bounceEl.classList.add('is-bouncing');
}

function bounceSubjectMarker() {
  if (!subjectMarker) return;
  const markerEl = subjectMarker.getElement();
  const bounceEl = markerEl.querySelector('.comp-finder-pin-bounce-wrap') as HTMLElement | null;
  if (!bounceEl) return;
  bounceEl.classList.remove('is-bouncing');
  void bounceEl.offsetWidth;
  bounceEl.classList.add('is-bouncing');
}

function centerOnSubject() {
  if (!subject || !isValidLngLat(subject.center)) {
    console.warn('[comp-finder] centerOnSubject skipped invalid center', { subjectCenter: subject?.center, subjectParcelId: subject?.parcelId });
    return;
  }
  const subj = subject;

  const duration = 500;
  const didStart = centerOnLngLatInVisibleMapArea(subject.center, { inset: 12, duration });
  compDebug('centerOnSubject invoked', {
    subjectCenter: subject.center,
    didStart,
    currentZoom: S.map?.getZoom?.(),
  });
  if (!didStart) return;

  let bounced = false;
  const onCenterComplete = () => {
    if (bounced) return;
    bounced = true;
    window.clearTimeout(fallbackTimer);
    S.map.off('moveend', onCenterComplete);
    compDebug('centerOnSubject bounce trigger', { subjectCenter: subj.center, subjectParcelId: subj.parcelId });
    bounceSubjectMarker();
  };

  S.map.on('moveend', onCenterComplete);
  const fallbackTimer = window.setTimeout(onCenterComplete, duration + 220);
}

function centerOnComp(comp: CompRow) {
  const center = getFeatureCenter(comp.feature);
  if (!isValidLngLat(center)) {
    console.warn('[comp-finder] centerOnComp skipped invalid center', { compId: comp.id, center });
    return;
  }

  const duration = 500;
  const didStart = centerOnLngLatInVisibleMapArea(center, { inset: 12, duration });
  compDebug('centerOnComp invoked', {
    compId: comp.id,
    center,
    didStart,
    currentZoom: S.map?.getZoom?.(),
  });
  if (!didStart) return;

  let bounced = false;
  const onCenterComplete = () => {
    if (bounced) return;
    bounced = true;
    window.clearTimeout(fallbackTimer);
    S.map.off('moveend', onCenterComplete);
    compDebug('centerOnComp bounce trigger', { compId: comp.id, center });
    bounceCompMarker(comp);
  };

  S.map.on('moveend', onCenterComplete);
  const fallbackTimer = window.setTimeout(onCenterComplete, duration + 220);
}

function buildCompColumnButton(label: string, comp: CompRow, options?: { isHeader?: boolean; titlePrefix?: string }) {
  const titlePrefix = options?.titlePrefix ?? 'Center map on';
  const label2 = `${titlePrefix} ${comp.parcelId || 'comp parcel'}`;
  const button = makeButton(label, {
    className: 'comp-finder-comp-column-button',
    title: label2,
    attrs: { 'aria-label': label2 },
    on: { click: () => centerOnComp(comp) },
  });
  if (options?.isHeader) button.classList.add('is-header');
  return button;
}

function buildSubjectColumnButton(label = 'Subject') {
  const title = `Center map on ${subject?.parcelId || 'subject parcel'}`;
  return makeButton(label, {
    className: 'comp-finder-comp-column-button is-header',
    title,
    attrs: { 'aria-label': title },
    on: { click: () => centerOnSubject() },
  });
}

function renderCompsTable() {
  const comparisonFields = getComparisonFields();
  const visible = getVisibleComps();

  els.resultsSummary.textContent = `Results: ${comps.length}`;
  renderPager();

  els.compsTableHead.innerHTML = '';
  els.compsTableBody.innerHTML = '';

  const hasComps = comps.length > 0;
  els.resultsRow.style.display = hasComps ? 'flex' : 'none';
  els.compsTableContainer.style.display = hasComps ? 'block' : 'none';
  els.addFieldRow.style.display = hasComps ? 'flex' : 'none';
  if (!hasComps) {
    els.dirtyIndicator.style.display = 'none';
    return;
  }

  updateNoCompsIndicator();
  els.compsTableContainer.scrollTop = 0;

  const head = document.createElement('tr');
  const removeTh = document.createElement('th');
  removeTh.textContent = '';
  const fieldTh = document.createElement('th');
  fieldTh.textContent = 'Field';
  const subjectTh = document.createElement('th');
  subjectTh.appendChild(buildSubjectColumnButton('Subject'));
  head.append(removeTh, fieldTh, subjectTh);
  visible.forEach((_, idx) => {
    const th = document.createElement('th');
    const comp = visible[idx];
    const label = `Comp ${((currentPage - 1) * COMPS_PER_PAGE) + idx + 1}`;
    th.appendChild(buildCompColumnButton(label, comp, { isHeader: true, titlePrefix: 'Center map on' }));
    head.appendChild(th);
  });
  els.compsTableHead.appendChild(head);


  const idRow = document.createElement('tr');
  const idRemove = document.createElement('td');
  idRemove.textContent = '';
  const idField = document.createElement('td');
  idField.appendChild(renderSortableRowLabel('ID', '__id'));
  const idSubject = document.createElement('td');
  idSubject.textContent = subject?.parcelId || '—';
  idRow.append(idRemove, idField, idSubject);
  visible.forEach((comp) => {
    const td = document.createElement('td');
    td.appendChild(buildCompColumnButton(comp.parcelId || '—', comp));
    idRow.appendChild(td);
  });
  els.compsTableBody.appendChild(idRow);

  const addrRow = document.createElement('tr');
  const addrRemove = document.createElement('td');
  addrRemove.textContent = '';
  const addrField = document.createElement('td');
  addrField.appendChild(renderSortableRowLabel('Address', '__address'));
  const addrSubject = document.createElement('td');
  addrSubject.textContent = subject?.address || '—';
  addrRow.append(addrRemove, addrField, addrSubject);
  visible.forEach((comp) => {
    const td = document.createElement('td');
    td.appendChild(buildCompColumnButton(comp.address || '—', comp));
    addrRow.appendChild(td);
  });
  els.compsTableBody.appendChild(addrRow);

  comparisonFields.forEach((entry, entryIndex) => {
    if (entry.source === 'extra' && entryIndex > 0 && comparisonFields[entryIndex - 1]?.source !== 'extra') {
      const divider = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3 + visible.length;
      td.textContent = 'Extra fields';
      td.className = 'muted';
      divider.appendChild(td);
      els.compsTableBody.appendChild(divider);
    }

    const row = document.createElement('tr');
    row.className = entry.source === 'criteria' ? 'comp-finder-criteria-row' : 'comp-finder-extra-row';

    const removeTd = document.createElement('td');
    if (entry.source === 'extra') {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'comp-finder-delete-btn';
      removeButton.textContent = '❌';
      removeButton.title = 'Remove field';
      removeButton.addEventListener('click', () => {
        extraFields = extraFields.filter((item) => item.field !== entry.field);
        setCriteriaDirty(true);
        renderCompsTable();
        renderAddFieldOptions();
      });
      removeTd.appendChild(removeButton);
    }
    const fieldTd = document.createElement('td');
    fieldTd.appendChild(renderSortableRowLabel(getFieldLabel(getCompDataStore(), entry.field), entry.field));
    const subjectTd = document.createElement('td');
    subjectTd.textContent = formatSubjectValue(entry.field, entry.type);
    row.append(removeTd, fieldTd, subjectTd);

    visible.forEach((comp) => {
      const td = document.createElement('td');
      let text = '—';
      if (entry.source === 'criteria') {
        const allFields = getComparisonFields().filter((f) => f.source === 'criteria');
        const deltaIndex = allFields.findIndex((f) => f.field === entry.field);
        const delta = comp.deltas[deltaIndex];
        text = delta?.text ?? '—';
        if (delta?.error) td.title = delta.error;
        const cls = getDeltaClass(delta || {});
        if (cls) td.classList.add(cls);
      } else {
        const val = getFieldValue(comp.feature, entry.field);
        text = val === null || val === undefined || val === '' ? '—' : (entry.type === 'numeric' ? fmt(val) : String(val));
      }
      td.appendChild(buildCompColumnButton(text, comp));
      row.appendChild(td);
    });

    els.compsTableBody.appendChild(row);
  });
}

function passesCriteria(feature: GeoJSON.Feature): boolean {
  if (!subject) return false;
  for (const row of criteria) {
    if (!row.field || !row.fieldType) continue;
    if (row.fieldType === 'numeric') {
      const range = numOrNull(row.value);
      if (range === null) continue;
      const subjectValue = numOrNull(getFieldValue(subject.feature, row.field));
      const compValue = numOrNull(getFieldValue(feature, row.field));
      if (subjectValue === null || compValue === null) return false;
      const nonNegativeRange = Math.max(0, range);
      const allowedRange = row.usePercent ? Math.abs(subjectValue) * (nonNegativeRange / 100) : nonNegativeRange;
      if (!Number.isFinite(allowedRange)) return false;
      if (compValue < subjectValue - allowedRange || compValue > subjectValue + allowedRange) return false;
    } else {
      if (!Array.isArray(row.value) || row.value.length === 0) continue;
      const compValue = getFieldValue(feature, row.field);
      if (!row.value.includes(String(compValue))) return false;
    }
  }
  return true;
}



function expandPanelForCompsIfNeeded() {
  if (!isMenuVisible) return;
  const panel = els.panel;
  const header = panel.querySelector('.window-header') as HTMLElement | null;
  const content = panel.querySelector('[data-window-content]') as HTMLElement | null;
  if (!content) return;

  const panelRect = panel.getBoundingClientRect();
  const headerHeight = header?.getBoundingClientRect().height ?? 0;
  const neededHeight = headerHeight + content.scrollHeight + 2;
  const viewportMaxHeight = Math.max(320, window.innerHeight - panelRect.top - 12);
  const targetHeight = Math.min(viewportMaxHeight, neededHeight);

  if (targetHeight > panelRect.height + 2) {
    panel.style.height = `${Math.ceil(targetHeight)}px`;
  }
}

async function findComps() {
  return perfSpan('panel:findComps', findCompsImpl);
}
async function findCompsImpl() {
  if (!subject) return;
  if (!hasAnyThresholdEnabled()) {
    comps = [];
    currentPage = 1;
    hasAttemptedFind = true;
    setCriteriaDirty(false);
    renderCompsUI();
    updateMapArtifacts();
    return;
  }

  const compLayer = getCompLayer();
  const compStore = getCompDataStore();
  if (!compLayer || !compStore?.geojson) return;

  setFinding(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const criteriaFields = getComparisonFields().filter((entry) => entry.source === 'criteria');
  const subjectCenter = subject.center;
  const subjectFeature = subject.feature;
  const useDistance = els.distanceEnabledInput.checked;
  const useSelection = els.selectionEnabledInput.checked;
  const distanceLimit = useDistance ? getDistanceLimitMeters() : null;
  const selectedParcels = compLayer.selectedParcels;
  const subjectParcelId = subject.parcelId;

  comps = [];

  if (compStore.isCivil) {
    if (useSelection) {
      await resolveCivilSelectionIds(Array.from(selectedParcels), compStore);
    }
    
    const criteriaArr = criteriaFields.map(entry => {
       const attr = getParcelAttributeForField(compStore, entry.field);
       if (attr === null) return null;
       const row = criteria.find(c => c.field === entry.field);
       if (!row) return null;
       
       if (entry.type === 'numeric') {
         let tol = 0;
         const val = numOrNull(row.value);
         if (val !== null) {
           tol = row.usePercent ? val / 100 : val;
         }
         return create(ComparableCriteriaSchema, {
           attribute: attr,
           minNumericalTolerance: tol,
           maxNumericalTolerance: tol
         });
       } else {
         return create(ComparableCriteriaSchema, {
           attribute: attr,
           categoricalTolerance: Array.isArray(row.value) ? row.value : []
         });
       }
    }).filter(Boolean) as ComparableCriteria[];

    let wkt = '';
    if (useDistance && distanceLimit !== null) {
      const circleFeat = makeDistanceCircleFeature(subjectCenter, distanceLimit);
      if (circleFeat && circleFeat.geometry.type === 'Polygon') {
        const coords = circleFeat.geometry.coordinates[0];
        const wktCoords = coords.map((c: any) => `${c[0]} ${c[1]}`).join(', ');
        wkt = `POLYGON((${wktCoords}))`;
      }
    }

    const transport = createConnectTransport({
      baseUrl: compStore.civilGateway!,
      interceptors: [
        (next) => async (req) => {
          req.header.set("Authorization", `Bearer ${compStore.civilToken}`);
          return await next(req);
        }
      ]
    });
    const client = createClient(ParcelsService, transport);
    const selectedParcelIds = useSelection 
      ? Array.from(selectedParcels).map(fid => compStore.civilFeatureToParcelIdMap?.get(Number(fid))).filter(Boolean) as string[]
      : [];

    const eqReq = create(GetEquityComparablesRequestSchema, { wktPolygon: wkt, criteria: criteriaArr, selectedParcelIds });
    const saleReq = create(GetSalesComparablesRequestSchema, { wktPolygon: wkt, criteria: criteriaArr, selectedParcelIds });

    const fetchedIds = new Set<string>();
    const mergeComp = (c: any) => {
      if (c.parcelId === subjectParcelId || fetchedIds.has(c.parcelId)) return;
      fetchedIds.add(c.parcelId);
      
      const featureIdStr = String(c.featureId);
      const feature = compStore.geojson!.features.find((f: any) => String(f.id) === featureIdStr);
      if (!feature) return;
      
      const deltas = criteriaFields.map((entry) => {
        const compVal = getFieldValue(feature, entry.field);
        const subjVal = getFieldValue(subjectFeature, entry.field);
        return buildDelta(compVal, subjVal, entry.type);
      });

      comps.push({
        id: c.parcelId || uid('comp'),
        feature,
        deltas,
        parcelId: c.parcelId || '—',
        address: c.formattedAddress || '—',
      });
    };

    try {
      const [eqRes, saleRes] = await Promise.all([
        client.getEquityComparables(eqReq),
        client.getSalesComparables(saleReq)
      ]);
      Object.values(eqRes.parcels || {}).forEach(mergeComp);
      Object.values(saleRes.parcels || {}).forEach(mergeComp);
    } catch (err) {
      console.error("Failed to fetch civil comps:", err);
    }
  } else {
    for (const feature of compStore.geojson.features) {
      const compCenter = getFeatureCenter(feature);
      if (!compCenter) continue;
      const parcelId = String(getFieldValue(feature, compStore.parcelIdField) ?? '');
      const featureId = feature.id === undefined || feature.id === null ? null : String(feature.id);
      if (parcelId && subjectParcelId && parcelId === subjectParcelId) continue;

      if (useDistance && distanceLimit !== null) {
        const dist = distanceMeters(subjectCenter, compCenter);
        if (dist > distanceLimit) continue;
      }

      if (useSelection) {
        if (!featureId || !selectedParcels.has(featureId)) continue;
      }

      if (!passesCriteria(feature)) continue;

      const deltas = criteriaFields.map((entry) => {
        const compVal = getFieldValue(feature, entry.field);
        const subjVal = getFieldValue(subjectFeature, entry.field);
        return buildDelta(compVal, subjVal, entry.type);
      });

      comps.push({
        id: parcelId || uid('comp'),
        feature,
        deltas,
        parcelId: parcelId || '—',
        address: String(getFieldValue(feature, compStore.addressField) ?? '—'),
      });
    }
  }

  currentPage = 1;
  hasAttemptedFind = true;
  setCriteriaDirty(false);
  updateRefreshButtonLabel();
  updateActionButtons();
  updateNoCompsIndicator();
  renderCompsTable();
  updateMapArtifacts();
  setTimeout(() => expandPanelForCompsIfNeeded(), 0);
  setFinding(false);
}

function handleZoomToComps() {
  if (!subject) return;
  compDebug('zoomTo click start', {
    subjectCenter: subject.center,
    compsTotal: comps.length,
  });
  const centers: [number, number][] = [];
  if (isValidLngLat(subject.center)) centers.push(subject.center);
  else console.warn('[comp-finder] zoomTo invalid subject center', { subjectCenter: subject.center, subjectParcelId: subject.parcelId });

  const inspectedCompCenters: Array<{ compId: string; center: [number, number] | null; valid: boolean }> = [];
  comps.forEach((row) => {
    const center = getFeatureCenter(row.feature);
    const valid = isValidLngLat(center);
    inspectedCompCenters.push({ compId: row.id, center, valid });
    if (valid) centers.push(center);
  });
  compDebug('zoomTo center inspection', {
    inspectedCompCenters,
    acceptedCenterCount: centers.length,
  });

  if (centers.length === 0) {
    console.warn('[comp-finder] zoomTo aborted: no valid centers available', {
      subjectCenter: subject.center,
      inspectedCompCenters,
    });
    return;
  }

  const bounds = centers.reduce(
    (acc, coord) => acc.extend(coord),
    new maplibregl.LngLatBounds(centers[0], centers[0]),
  );
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  compDebug('zoomTo computed bounds', {
    centers,
    sw,
    ne,
    isSinglePoint: centers.length === 1,
  });

  if (centers.length === 1) {
    const centered = centerOnLngLatInVisibleMapArea(centers[0], { inset: 16, duration: 600 });
    compDebug('zoomTo single-point center result', { centered, center: centers[0] });
    return;
  }

  const fitted = fitBoundsInVisibleMapArea(bounds, { inset: 24, duration: 600 });
  compDebug('zoomTo fit result', { fitted, sw, ne });
}

function buildExportRows() {
  if (!subject) return [];
  const comparisonFields = getComparisonFields();
  const rows: Record<string, any>[] = [];

  const subjectRow: Record<string, any> = {
    is_subject: 'TRUE',
    parcel_id: subject.parcelId || '',
    address: subject.address || '',
  };

  comparisonFields.forEach((entry) => {
    const subjectValue = getFieldValue(subject!.feature, entry.field);
    subjectRow[entry.field] = subjectValue;
    subjectRow[`delta_${entry.field}`] = entry.type === 'numeric' ? 0 : '=';
  });
  rows.push(subjectRow);

  comps.forEach((row) => {
    const compRow: Record<string, any> = {
      is_subject: 'FALSE',
      parcel_id: row.parcelId,
      address: row.address,
    };

    comparisonFields.forEach((entry) => {
      const compValue = getFieldValue(row.feature, entry.field);
      const subjectValue = getFieldValue(subject!.feature, entry.field);
      compRow[entry.field] = compValue;

      if (entry.type === 'numeric') {
        const compNum = numOrNull(compValue);
        const subjNum = numOrNull(subjectValue);
        compRow[`delta_${entry.field}`] = (compNum === null || subjNum === null) ? '' : (compNum - subjNum);
      } else {
        compRow[`delta_${entry.field}`] = String(compValue) === String(subjectValue) ? '=' : String(compValue ?? '');
      }
    });

    rows.push(compRow);
  });

  return rows;
}

function exportCsv() {
  const rows = buildExportRows();
  if (!rows.length) return;
  downloadText(rowsToCsv(rows), 'comp_finder_comps.csv');
}

function exportExcel() {
  const rows = buildExportRows();
  if (!rows.length) return;
  downloadXlsx('comp_finder_comps.xlsx', [{ name: 'comps', json: rows }]);
}

function refreshDataSources() {
  els.dataSourceSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose layer';
  placeholder.disabled = true;
  placeholder.selected = true;
  els.dataSourceSelect.appendChild(placeholder);
  S.layerOrder.forEach((layerId) => {
    const layer = getLayerById(layerId);
    if (!layer) return;
    const option = document.createElement('option');
    option.value = layer.id;
    option.textContent = layer.name;
    els.dataSourceSelect.appendChild(option);
  });
  if (subject?.layerId && S.layers.has(subject.layerId)) {
    els.dataSourceSelect.value = subject.layerId;
  } else if (S.layerOrder.length > 0) {
    els.dataSourceSelect.value = S.layerOrder[0];
  }
}

function syncCriteriaFields() {
  const available = new Set(getIntersectionFields().map((item) => item.field));
  criteria.forEach((row) => {
    if (row.field && !available.has(row.field)) {
      row.field = null;
      row.fieldType = null;
      row.value = null;
      row.usePercent = false;
    }
  });
  extraFields = extraFields.filter((row) => available.has(row.field));
}

function syncCategoricalCriteriaToSubject() {
  if (!subject) return;
  const subj = subject;
  criteria.forEach((row) => {
    if (row.fieldType !== 'categorical' || !row.field) return;
    const subjectValue = getFieldValue(subj.feature, row.field);
    row.value = (subjectValue === null || subjectValue === undefined || subjectValue === '')
      ? []
      : [String(subjectValue)];
  });
}

function ensureDefaultCriteria(store: DataStore) {
  if (criteria.length > 0 || !subject) return;
  const subj = subject;
  const defaults = [
    store.bldgSizeField,
    store.landSizeField,
    store.bldgAgeField,
    store.bldgTypeField,
  ].filter(Boolean) as string[];

  defaults.forEach((field) => {
    const fieldType = getFieldType(field);
    if (!fieldType) return;
    if (fieldType === 'numeric') {
      criteria.push({ id: uid('criterion'), field, fieldType, value: 10, usePercent: true });
      return;
    }
    const subjectValue = getFieldValue(subj.feature, field);
    criteria.push({
      id: uid('criterion'),
      field,
      fieldType,
      value: (subjectValue === null || subjectValue === undefined || subjectValue === '') ? [] : [String(subjectValue)],
      usePercent: false,
    });
  });
}

function hasAnyThresholdEnabled() {
  return els.distanceEnabledInput.checked || els.selectionEnabledInput.checked;
}

function updateThresholdUI() {
  const hasSubject = Boolean(subject);
  const hasThreshold = hasAnyThresholdEnabled();
  const showError = hasSubject && !hasThreshold;

  els.distanceInput.disabled = !els.distanceEnabledInput.checked;
  els.distanceUnitsSelect.disabled = !els.distanceEnabledInput.checked;
  els.thresholdError.style.display = showError ? 'block' : 'none';
  els.criteriaWidgets.style.display = showError ? 'none' : 'block';
  els.criteriaCompsDivider.style.display = hasSubject && !showError ? 'block' : 'none';
  els.compsSection.style.display = hasSubject && !showError ? 'grid' : 'none';
}

function updateEmptyStateUI() {
  const hasSubject = Boolean(subject);
  els.emptyState.style.display = hasSubject ? 'none' : 'block';
  els.criteriaSection.style.display = hasSubject ? 'grid' : 'none';
  updateThresholdUI();
  updateNoCompsIndicator();
  setTimeout(() => expandPanelForCompsIfNeeded(), 0);
}

function renderCompsUI() {
  updateRefreshButtonLabel();
  updateActionButtons();
  renderCompsTable();
}

function resetComps() {
  comps = [];
  currentPage = 1;
  hasAttemptedFind = false;
  setCriteriaDirty(false);
  renderCompsUI();
  clearCompMarkers();
}

export function setCompFinderSubject(feature: GeoJSON.Feature, layerId: string) {
  const layer = getLayerById(layerId);
  if (!layer) return;
  const store = getDataStoreById(layer.dataStoreId);
  if (!store) return;
  const center = getFeatureCenter(feature);
  if (!center) return;

  subject = {
    feature,
    dataStoreId: store.id,
    layerId,
    parcelId: String(getFieldValue(feature, store.parcelIdField) ?? ''),
    address: String(getFieldValue(feature, store.addressField) ?? ''),
    center,
  };

  callbacks.showCompFinderMenu();
  updateEmptyStateUI();
  refreshDataSources();

  if (!els.distanceInput.value) els.distanceInput.value = '1';
  if (!els.distanceUnitsSelect.value) els.distanceUnitsSelect.value = 'mi';
  els.distanceEnabledInput.checked = true;
  els.selectionEnabledInput.checked = false;
  els.distanceInput.value = '1';
  els.distanceUnitsSelect.value = 'mi';

  ensureDefaultCriteria(store);
  syncCriteriaFields();
  syncCategoricalCriteriaToSubject();
  renderCriteriaTable();
  resetComps();
  updateMapArtifacts();
}

export function setCompFinderToolActive(_active: boolean) {
  // Reserved hook: comp-finder tool activation currently needs no side effects.
}

export function setCompFinderMenuVisible(visible: boolean) {
  isMenuVisible = visible;
  updateEmptyStateUI();
  if (!visible) {
    clearSubjectMarker();
    clearCompMarkers();
    clearDistanceOverlay();
    return;
  }
  updateMapArtifacts();
}

export function initCompFinderElements() {
  els.dataSourceSelect.addEventListener('change', () => {
    syncCriteriaFields();
    renderCriteriaTable();
    resetComps();
  });

  els.distanceEnabledInput.addEventListener('change', () => {
    setCriteriaDirty(true);
    updateEmptyStateUI();
    updateDistanceOverlay();
  });
  els.selectionEnabledInput.addEventListener('change', () => {
    setCriteriaDirty(true);
    updateEmptyStateUI();
  });
  els.distanceInput.addEventListener('input', () => {
    setCriteriaDirty(true);
    updateDistanceOverlay();
  });
  els.distanceUnitsSelect.addEventListener('change', () => {
    setCriteriaDirty(true);
    updateDistanceOverlay();
  });

  els.addCriterionButton.addEventListener('click', () => {
    criteria.push({ id: uid('criterion'), field: null, fieldType: null, value: null, usePercent: false });
    setCriteriaDirty(true);
    renderCriteriaTable();
  });

  els.refreshButton.addEventListener('click', () => {
    findComps();
  });

  els.addFieldButton.addEventListener('click', () => {
    const field = els.addFieldSelect.value;
    if (!field) return;
    const type = getFieldType(field);
    if (!type) return;
    if (extraFields.some((entry) => entry.field === field)) return;
    extraFields.push({ field, type });
    renderCriteriaTable();
    renderCompsTable();
  });

  els.zoomButton.addEventListener('click', handleZoomToComps);
  els.exportCsvButton.addEventListener('click', exportCsv);
  els.exportExcelButton.addEventListener('click', exportExcel);

  updateEmptyStateUI();
  renderCompsUI();
  renderAddFieldOptions();
}

export function initCompFinderCallbacks(cb: Callbacks) {
  callbacks = cb;
}
