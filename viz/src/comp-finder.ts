import maplibregl from 'maplibre-gl';
import * as XLSX from 'xlsx';

import { S } from './state';
import type { DataStore, LayerState } from './types';
import { bbox } from './utils.geo';
import { fmt, numOrNull } from './utils.number';

type Criterion = {
  id: string;
  field: string | null;
  fieldType: 'numeric' | 'categorical' | null;
  value: number | string[] | null;
  usePercent: boolean;
};

type SubjectField = {
  field: string;
  label: string;
  type: 'numeric' | 'categorical';
};

type CompRow = {
  id: string;
  feature: GeoJSON.Feature;
  deltas: Array<{ text: string; error?: string }>;
  parcelId: string;
  address: string;
};

type Elements = {
  panel: HTMLDivElement;
  subjectParcelId: HTMLSpanElement;
  subjectAddress: HTMLSpanElement;
  subjectFieldSelect: HTMLSelectElement;
  subjectTableHead: HTMLTableSectionElement;
  subjectTableBody: HTMLTableSectionElement;
  dataSourceSelect: HTMLSelectElement;
  distanceInput: HTMLInputElement;
  distanceUnitsSelect: HTMLSelectElement;
  criteriaTableBody: HTMLTableSectionElement;
  addCriterionButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
  compsTableHead: HTMLTableSectionElement;
  compsTableBody: HTMLTableSectionElement;
  compsTableContainer: HTMLDivElement;
  compsSelectAll: HTMLInputElement;
  markButton: HTMLButtonElement;
  zoomButton: HTMLButtonElement;
  exportCsvButton: HTMLButtonElement;
  exportExcelButton: HTMLButtonElement;
};

type Callbacks = {
  showCompFinderMenu: () => void;
};

let els: Elements;
let callbacks: Callbacks;

let subject: {
  feature: GeoJSON.Feature;
  dataStoreId: string;
  layerId: string;
  parcelId: string;
  address: string;
  center: [number, number];
} | null = null;

let subjectFields: SubjectField[] = [];
let criteria: Criterion[] = [];
let comps: CompRow[] = [];
let criteriaDirty = false;
let compMarkers = new Map<string, maplibregl.Marker>();
let subjectMarker: maplibregl.Marker | null = null;
let selectedCompIds = new Set<string>();
let isToolActive = false;

const COMP_MARKER_CLASS = 'comp-finder-marker';
const SUBJECT_MARKER_CLASS = 'comp-finder-marker subject';

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

function getCompDataStore(): DataStore | null {
  const id = els.dataSourceSelect.value || subject?.dataStoreId;
  if (!id) return null;
  return getDataStoreById(id);
}

function getCompDataStoreId(): string | null {
  return els.dataSourceSelect.value || subject?.dataStoreId || null;
}

function ensureMarker(elClass: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = elClass;
  return el;
}

function setCriteriaDirty(dirty: boolean) {
  criteriaDirty = dirty;
  els.compsTableContainer.classList.toggle('is-dirty', dirty);
  updateRefreshButtonLabel();
}

function updateRefreshButtonLabel() {
  if (comps.length > 0) {
    els.refreshButton.textContent = criteriaDirty ? 'Refresh comps' : 'Refresh comps';
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
  const hasSelection = selectedCompIds.size > 0;
  els.markButton.disabled = !hasSelection;
  els.zoomButton.disabled = !hasSelection;
  els.exportCsvButton.disabled = !hasSelection;
  els.exportExcelButton.disabled = !hasSelection;
}

function updateSubjectMarker() {
  if (!subject || !isToolActive) {
    clearSubjectMarker();
    return;
  }
  if (!subjectMarker) {
    subjectMarker = new maplibregl.Marker({ element: ensureMarker(SUBJECT_MARKER_CLASS) });
  }
  subjectMarker.setLngLat(subject.center).addTo(S.map);
}

function updateCompMarkers() {
  clearCompMarkers();
  if (!isToolActive) return;
  for (const comp of comps) {
    if (!selectedCompIds.has(comp.id)) continue;
    const center = getFeatureCenter(comp.feature);
    if (!center) continue;
    const marker = new maplibregl.Marker({ element: ensureMarker(COMP_MARKER_CLASS) })
      .setLngLat(center)
      .addTo(S.map);
    compMarkers.set(comp.id, marker);
  }
}

function getFeatureCenter(feature: GeoJSON.Feature): [number, number] | null {
  if (!feature.geometry) return null;
  const bounds = bbox({ type: 'FeatureCollection', features: [feature] });
  if (!bounds) return null;
  const [minLng, minLat, maxLng, maxLat] = bounds;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function getDistanceLimitMeters(): number | null {
  const distanceValue = numOrNull(els.distanceInput.value);
  if (!distanceValue || distanceValue <= 0) return null;
  const unit = els.distanceUnitsSelect.value;
  const unitToMeters: Record<string, number> = {
    ft: 0.3048,
    m: 1,
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

function getDisplayLabelForField(field: string, store: DataStore): string {
  if (field === store.bldgTypeField) return 'Type';
  if (field === store.landTypeField) return 'Land';
  if (field === store.bldgAgeField) return 'Age';
  if (field === store.bldgQualityField) return 'Qual';
  if (field === store.bldgConditionField) return 'Cond';
  if (field === store.bldgSizeField) return 'Bldg';
  if (field === store.landSizeField) return 'Land';
  return field;
}

function ensureDefaultSubjectFields(store: DataStore) {
  const defaults = [
    store.bldgTypeField,
    store.landTypeField,
    store.bldgAgeField,
    store.bldgQualityField,
    store.bldgConditionField,
  ].filter(Boolean) as string[];

  subjectFields = defaults.map((field) => ({
    field,
    label: getDisplayLabelForField(field, store),
    type: store.chosenNumericFields.includes(field) ? 'numeric' : 'categorical',
  }));
}

function renderSubjectFieldsSelect(store: DataStore) {
  const available = [
    ...store.chosenNumericFields.map((field) => ({ field, type: 'numeric' as const })),
    ...store.chosenCategoricalFields.map((field) => ({ field, type: 'categorical' as const })),
  ];
  els.subjectFieldSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select field';
  placeholder.disabled = true;
  placeholder.selected = true;
  els.subjectFieldSelect.appendChild(placeholder);
  available.forEach(({ field }) => {
    const option = document.createElement('option');
    option.value = field;
    option.textContent = field;
    els.subjectFieldSelect.appendChild(option);
  });
}

function renderSubjectTable() {
  const store = getDataStoreForSubject();
  if (!store || !subject) return;
  els.subjectTableHead.innerHTML = '';
  els.subjectTableBody.innerHTML = '';
  if (!subjectFields.length) return;

  const headRow = document.createElement('tr');
  subjectFields.forEach((entry) => {
    const th = document.createElement('th');
    th.textContent = entry.label;
    headRow.appendChild(th);
  });
  els.subjectTableHead.appendChild(headRow);

  const bodyRow = document.createElement('tr');
  subjectFields.forEach((entry) => {
    const td = document.createElement('td');
    const value = getFieldValue(subject.feature, entry.field);
    if (entry.type === 'numeric') {
      td.textContent = value === null || value === undefined ? '—' : fmt(value);
    } else {
      td.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
    }
    bodyRow.appendChild(td);
  });
  els.subjectTableBody.appendChild(bodyRow);
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
      if (row.field === field) {
        option.selected = true;
      }
      fieldSelect.appendChild(option);
    });
    fieldSelect.addEventListener('change', () => {
      const selected = fieldSelect.selectedOptions[0];
      row.field = selected?.value ?? null;
      row.fieldType = (selected?.dataset.fieldType as 'numeric' | 'categorical' | null) ?? null;
      row.value = row.fieldType === 'categorical' ? [] : null;
      row.usePercent = false;
      setCriteriaDirty(true);
      renderCriteriaTable();
    });
    fieldCell.appendChild(fieldSelect);
    tr.appendChild(fieldCell);

    const valueCell = document.createElement('td');
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
      input.value = row.value !== null && row.value !== undefined ? String(row.value) : '';
      input.style.width = '90px';
      input.addEventListener('input', () => {
        row.value = numOrNull(input.value);
        setCriteriaDirty(true);
      });
      wrapper.append(prefix, input);
      valueCell.appendChild(wrapper);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = row.usePercent;
      checkbox.addEventListener('change', () => {
        row.usePercent = checkbox.checked;
        setCriteriaDirty(true);
      });
      percentCell.appendChild(checkbox);
    } else if (row.fieldType === 'categorical') {
      const wrapper = document.createElement('div');
      wrapper.className = 'comp-finder-row';
      const prefix = document.createElement('span');
      prefix.className = 'muted';
      prefix.textContent = '=';
      const select = document.createElement('select');
      select.multiple = true;
      select.style.minWidth = '140px';
      const values = row.field ? getCategoricalValuesForField(row.field) : [];
      values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = Array.isArray(row.value) && row.value.includes(value);
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        row.value = Array.from(select.selectedOptions).map((opt) => opt.value);
        setCriteriaDirty(true);
      });
      wrapper.append(prefix, select);
      valueCell.appendChild(wrapper);

      percentCell.textContent = 'N/A';
      percentCell.classList.add('muted');
    } else {
      valueCell.textContent = '—';
      percentCell.textContent = '—';
      percentCell.classList.add('muted');
    }

    tr.appendChild(valueCell);
    tr.appendChild(percentCell);

    const deleteCell = document.createElement('td');
    deleteCell.className = 'center';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = '❌';
    deleteButton.addEventListener('click', () => {
      criteria = criteria.filter((item) => item.id !== row.id);
      setCriteriaDirty(true);
      renderCriteriaTable();
    });
    deleteCell.appendChild(deleteButton);
    tr.appendChild(deleteCell);

    els.criteriaTableBody.appendChild(tr);
  });
}

function renderCompsTable() {
  els.compsTableHead.innerHTML = '';
  els.compsTableBody.innerHTML = '';

  const headRow = document.createElement('tr');
  const selectAllTh = document.createElement('th');
  selectAllTh.className = 'center';
  selectAllTh.appendChild(els.compsSelectAll);
  headRow.appendChild(selectAllTh);

  const idTh = document.createElement('th');
  idTh.textContent = 'ID';
  headRow.appendChild(idTh);

  const addressTh = document.createElement('th');
  addressTh.textContent = 'Address';
  headRow.appendChild(addressTh);

  subjectFields.forEach((entry) => {
    const th = document.createElement('th');
    th.textContent = entry.label;
    headRow.appendChild(th);
  });

  els.compsTableHead.appendChild(headRow);

  comps.forEach((row) => {
    const tr = document.createElement('tr');
    const selectTd = document.createElement('td');
    selectTd.className = 'center';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedCompIds.has(row.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedCompIds.add(row.id);
      } else {
        selectedCompIds.delete(row.id);
      }
      updateSelectAllState();
      updateActionButtons();
      updateCompMarkers();
    });
    selectTd.appendChild(checkbox);
    tr.appendChild(selectTd);

    const idTd = document.createElement('td');
    idTd.textContent = row.parcelId || '—';
    tr.appendChild(idTd);

    const addrTd = document.createElement('td');
    addrTd.textContent = row.address || '—';
    tr.appendChild(addrTd);

    row.deltas.forEach((delta) => {
      const td = document.createElement('td');
      td.textContent = delta.text;
      if (delta.error) {
        td.title = delta.error;
      }
      tr.appendChild(td);
    });

    els.compsTableBody.appendChild(tr);
  });
}

function updateSelectAllState() {
  const allIds = comps.map((row) => row.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedCompIds.has(id));
  els.compsSelectAll.checked = allSelected;
  els.compsSelectAll.indeterminate = !allSelected && selectedCompIds.size > 0;
}

function getCategoricalValuesForField(field: string): string[] {
  const store = getCompDataStore();
  if (!store?.geojson) return [];
  const values = new Set<string>();
  for (const feature of store.geojson.features) {
    const raw = feature.properties?.[field];
    if (raw === undefined || raw === null || raw === '') continue;
    values.add(String(raw));
  }
  return Array.from(values).sort();
}

function passesCriteria(feature: GeoJSON.Feature): boolean {
  if (!subject) return false;
  for (const row of criteria) {
    if (!row.field || !row.fieldType) continue;
    if (row.fieldType === 'numeric') {
      const range = numOrNull(row.value);
      if (!range || range <= 0) continue;
      const subjectValue = numOrNull(getFieldValue(subject.feature, row.field));
      const compValue = numOrNull(getFieldValue(feature, row.field));
      if (subjectValue === null || compValue === null) return false;
      const allowedRange = row.usePercent ? Math.abs(subjectValue) * (range / 100) : range;
      if (!Number.isFinite(allowedRange)) return false;
      if (compValue < subjectValue - allowedRange || compValue > subjectValue + allowedRange) {
        return false;
      }
    } else if (row.fieldType === 'categorical') {
      if (!Array.isArray(row.value) || row.value.length === 0) continue;
      const compValue = getFieldValue(feature, row.field);
      if (!row.value.includes(String(compValue))) return false;
    }
  }
  return true;
}

function buildDelta(value: any, subjectValue: any, type: 'numeric' | 'categorical') {
  if (type === 'numeric') {
    const compVal = numOrNull(value);
    const subjVal = numOrNull(subjectValue);
    if (compVal === null || subjVal === null) {
      return { text: 'ERROR', error: 'Missing numeric value' };
    }
    const delta = compVal - subjVal;
    if (delta === 0) return { text: '=' };
    const sign = delta > 0 ? '+' : '';
    return { text: `${sign}${fmt(delta)}` };
  }
  if (value === null || value === undefined || subjectValue === null || subjectValue === undefined) {
    return { text: 'ERROR', error: 'Missing categorical value' };
  }
  return { text: String(value) === String(subjectValue) ? '=' : '≠' };
}

function findComps() {
  if (!subject) return;
  const compStore = getCompDataStore();
  if (!compStore?.geojson) return;

  const subjectCenter = subject.center;
  const distanceLimit = getDistanceLimitMeters();
  const subjectParcelId = subject.parcelId;
  comps = [];
  selectedCompIds.clear();

  for (const feature of compStore.geojson.features) {
    const compCenter = getFeatureCenter(feature);
    if (!compCenter) continue;
    const parcelId = String(getFieldValue(feature, compStore.parcelIdField) ?? '');
    if (parcelId && subjectParcelId && parcelId === subjectParcelId) continue;
    if (distanceLimit) {
      const dist = distanceMeters(subjectCenter, compCenter);
      if (dist > distanceLimit) continue;
    }
    if (!passesCriteria(feature)) continue;

    const deltas = subjectFields.map((entry) => {
      const compVal = getFieldValue(feature, entry.field);
      const subjVal = getFieldValue(subject.feature, entry.field);
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

  setCriteriaDirty(false);
  updateRefreshButtonLabel();
  updateSelectAllState();
  updateActionButtons();
  renderCompsTable();
  updateCompMarkers();
}

function handleSelectAllToggle() {
  if (els.compsSelectAll.checked) {
    comps.forEach((row) => selectedCompIds.add(row.id));
  } else {
    selectedCompIds.clear();
  }
  renderCompsTable();
  updateActionButtons();
  updateCompMarkers();
}

function handleMarkComps() {
  updateCompMarkers();
}

function handleZoomToComps() {
  if (selectedCompIds.size === 0) return;
  const selectedFeatures = comps
    .filter((row) => selectedCompIds.has(row.id))
    .map((row) => row.feature);
  const bounds = bbox({ type: 'FeatureCollection', features: selectedFeatures });
  if (!bounds) return;
  S.map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 60, duration: 600 });
}

function buildExportRows() {
  if (!subject) return [];
  const rows: Record<string, any>[] = [];
  const subjectRow: Record<string, any> = {
    is_subject: 'TRUE',
    parcel_id: subject.parcelId || '',
    address: subject.address || '',
  };
  subjectFields.forEach((entry) => {
    subjectRow[entry.field] = getFieldValue(subject.feature, entry.field);
    const delta = buildDelta(
      getFieldValue(subject.feature, entry.field),
      getFieldValue(subject.feature, entry.field),
      entry.type,
    );
    subjectRow[`delta_${entry.field}`] = delta.text;
  });
  rows.push(subjectRow);

  comps.forEach((row) => {
    if (!selectedCompIds.has(row.id)) return;
    const compRow: Record<string, any> = {
      is_subject: 'FALSE',
      parcel_id: row.parcelId,
      address: row.address,
    };
    subjectFields.forEach((entry, idx) => {
      compRow[entry.field] = getFieldValue(row.feature, entry.field);
      compRow[`delta_${entry.field}`] = row.deltas[idx]?.text ?? '';
    });
    rows.push(compRow);
  });
  return rows;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const rows = buildExportRows();
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => JSON.stringify(row[header] ?? '')).join(',')
    ),
  ].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv' }), 'comp_finder_comps.csv');
}

function exportExcel() {
  const rows = buildExportRows();
  if (!rows.length) return;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'comps');
  XLSX.writeFile(wb, 'comp_finder_comps.xlsx');
}

function refreshDataSources() {
  els.dataSourceSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose data source';
  placeholder.disabled = true;
  placeholder.selected = true;
  els.dataSourceSelect.appendChild(placeholder);
  S.dataStoreOrder.forEach((id) => {
    const store = getDataStoreById(id);
    if (!store) return;
    const option = document.createElement('option');
    option.value = id;
    option.textContent = store.name;
    els.dataSourceSelect.appendChild(option);
  });
  if (subject?.dataStoreId) {
    els.dataSourceSelect.value = subject.dataStoreId;
  }
}

function updateSubjectInfo() {
  if (!subject) return;
  els.subjectParcelId.textContent = subject.parcelId || '—';
  els.subjectAddress.textContent = subject.address || '—';
}

function updateSubjectFields() {
  const store = getDataStoreForSubject();
  if (!store) return;
  ensureDefaultSubjectFields(store);
  renderSubjectFieldsSelect(store);
  renderSubjectTable();
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
}

function ensureDefaultCriteria(store: DataStore) {
  if (criteria.length > 0) return;
  const defaults = [
    store.bldgSizeField,
    store.landSizeField,
    store.bldgAgeField,
    store.bldgTypeField,
  ].filter(Boolean) as string[];
  defaults.forEach((field) => {
    const isNumeric = store.chosenNumericFields.includes(field);
    criteria.push({
      id: uid('criterion'),
      field,
      fieldType: isNumeric ? 'numeric' : 'categorical',
      value: isNumeric ? null : [],
      usePercent: false,
    });
  });
}

function renderCompsUI() {
  updateRefreshButtonLabel();
  updateSelectAllState();
  updateActionButtons();
  renderCompsTable();
}

function resetComps() {
  comps = [];
  selectedCompIds.clear();
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
  const parcelId = String(getFieldValue(feature, store.parcelIdField) ?? '');
  const address = String(getFieldValue(feature, store.addressField) ?? '');
  subject = {
    feature,
    dataStoreId: store.id,
    layerId,
    parcelId,
    address,
    center,
  };
  callbacks.showCompFinderMenu();
  refreshDataSources();
  updateSubjectInfo();
  updateSubjectFields();
  ensureDefaultCriteria(store);
  syncCriteriaFields();
  renderCriteriaTable();
  resetComps();
  updateSubjectMarker();
}

export function setCompFinderToolActive(active: boolean) {
  isToolActive = active;
  if (!active) {
    clearSubjectMarker();
    clearCompMarkers();
    return;
  }
  updateSubjectMarker();
  updateCompMarkers();
}

export function initCompFinderElements(elements: Elements) {
  els = elements;
  els.subjectFieldSelect.addEventListener('change', () => {
    const store = getDataStoreForSubject();
    if (!store) return;
    const field = els.subjectFieldSelect.value;
    if (!field) return;
    if (subjectFields.some((entry) => entry.field === field)) return;
    const type = store.chosenNumericFields.includes(field) ? 'numeric' : 'categorical';
    subjectFields.push({ field, label: getDisplayLabelForField(field, store), type });
    renderSubjectTable();
    els.subjectFieldSelect.selectedIndex = 0;
  });

  els.dataSourceSelect.addEventListener('change', () => {
    syncCriteriaFields();
    renderCriteriaTable();
    resetComps();
  });

  els.distanceInput.addEventListener('input', () => {
    setCriteriaDirty(true);
  });
  els.distanceUnitsSelect.addEventListener('change', () => {
    setCriteriaDirty(true);
  });

  els.addCriterionButton.addEventListener('click', () => {
    criteria.push({
      id: uid('criterion'),
      field: null,
      fieldType: null,
      value: null,
      usePercent: false,
    });
    setCriteriaDirty(true);
    renderCriteriaTable();
  });

  els.refreshButton.addEventListener('click', () => {
    findComps();
  });

  els.compsSelectAll.addEventListener('change', handleSelectAllToggle);
  els.markButton.addEventListener('click', handleMarkComps);
  els.zoomButton.addEventListener('click', handleZoomToComps);
  els.exportCsvButton.addEventListener('click', exportCsv);
  els.exportExcelButton.addEventListener('click', exportExcel);
}

export function initCompFinderCallbacks(cb: Callbacks) {
  callbacks = cb;
}
