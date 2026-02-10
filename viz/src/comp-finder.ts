import maplibregl from 'maplibre-gl';
import * as XLSX from 'xlsx';
import PIN_SVG from './svg/pin.svg?raw';

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
  distanceInput: HTMLInputElement;
  distanceUnitsSelect: HTMLSelectElement;
  criteriaTableBody: HTMLTableSectionElement;
  addCriterionButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
  dirtyIndicator: HTMLSpanElement;
  spinner: HTMLDivElement;
  resultsRow: HTMLDivElement;
  resultsSummary: HTMLSpanElement;
  pager: HTMLDivElement;
  compsTableHead: HTMLTableSectionElement;
  compsTableBody: HTMLTableSectionElement;
  compsTableContainer: HTMLDivElement;
  compsSelectAll: HTMLInputElement;
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

let criteria: Criterion[] = [];
let extraFields: Array<{ field: string; type: 'numeric' | 'categorical' }> = [];
let comps: CompRow[] = [];
let criteriaDirty = false;
let compMarkers = new Map<string, maplibregl.Marker>();
let subjectMarker: maplibregl.Marker | null = null;
let selectedCompIds = new Set<string>();
let isToolActive = false;
let isMenuVisible = false;
let isFinding = false;
let currentPage = 1;
let sortField: string | null = null;
let sortDirection: 'asc' | 'desc' = 'asc';

const COMP_MARKER_CLASS = 'comp-finder-marker';
const SUBJECT_MARKER_CLASS = 'comp-finder-marker subject';
const COMPS_PER_PAGE = 3;
const COMP_DISTANCE_SOURCE_ID = 'comp-finder-distance-source';
const COMP_DISTANCE_FILL_LAYER_ID = 'comp-finder-distance-fill';
const COMP_DISTANCE_OUTLINE_BLACK_ID = 'comp-finder-distance-outline-black';
const COMP_DISTANCE_OUTLINE_WHITE_ID = 'comp-finder-distance-outline-white';



function destinationPoint(center: [number, number], bearingDeg: number, distanceMeters: number): [number, number] {
  const R = 6371008.8;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (center[1] * Math.PI) / 180;
  const lon1 = (center[0] * Math.PI) / 180;
  const dByR = distanceMeters / R;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinD = Math.sin(dByR);
  const cosD = Math.cos(dByR);
  const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
  return [((lon2 * 180) / Math.PI + 540) % 360 - 180, (lat2 * 180) / Math.PI];
}

function makeDistanceCircleFeature(center: [number, number], radiusMeters: number): GeoJSON.Feature {
  const coordinates: [number, number][] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i += 1) {
    coordinates.push(destinationPoint(center, (i / steps) * 360, radiusMeters));
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
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
  const radiusMeters = getDistanceLimitMeters();
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

function getCompDataStore(): DataStore | null {
  const id = els.dataSourceSelect.value || subject?.dataStoreId;
  if (!id) return null;
  return getDataStoreById(id);
}

function ensureMarker(elClass: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = elClass;
  el.innerHTML = PIN_SVG;

  const middle = elClass.includes('subject') ? '#facc15' : '#93c5fd';
  el.style.setProperty('--c-middle', middle);
  el.style.setProperty('--c-dot', '#000000');
  el.style.setProperty('--c-outline1', '#000000');
  el.style.setProperty('--c-outline2', '#ffffff');
  return el;
}

function setFinding(next: boolean) {
  isFinding = next;
  els.spinner.style.display = next ? 'inline-block' : 'none';
  els.refreshButton.disabled = next;
}

function setCriteriaDirty(dirty: boolean) {
  criteriaDirty = dirty;
  els.compsTableContainer.classList.toggle('is-dirty', dirty);
  els.dirtyIndicator.style.display = dirty && comps.length > 0 ? 'inline' : 'none';
  updateRefreshButtonLabel();
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
  const hasSelection = selectedCompIds.size > 0;
  els.zoomButton.disabled = !hasSelection;
  els.exportCsvButton.disabled = !hasSelection;
  els.exportExcelButton.disabled = !hasSelection;
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
    if (!selectedCompIds.has(comp.id)) continue;
    const center = getFeatureCenter(comp.feature);
    if (!center) continue;
    const marker = new maplibregl.Marker({ element: ensureMarker(COMP_MARKER_CLASS), anchor: 'bottom' })
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

function renderAddFieldOptions() {
  const current = new Set([...criteria.map((c) => c.field).filter(Boolean) as string[], ...extraFields.map((f) => f.field)]);
  const available = getIntersectionFields().filter((entry) => !current.has(entry.field));
  els.addFieldSelect.innerHTML = '';
  available.forEach((entry, idx) => {
    const option = document.createElement('option');
    option.value = entry.field;
    option.textContent = entry.field;
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
      input.value = row.value !== null && row.value !== undefined ? String(row.value) : '10';
      input.style.width = '90px';
      input.addEventListener('input', () => {
        row.value = numOrNull(input.value);
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
}

function buildCompsSortValue(comp: CompRow, field: string) {
  if (field === '__id') return comp.parcelId;
  if (field === '__address') return comp.address;
  return getFieldValue(comp.feature, field);
}

function sortCompsRows(rows: CompRow[]): CompRow[] {
  if (!sortField) return rows;
  const dir = sortDirection === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = buildCompsSortValue(a, sortField);
    const vb = buildCompsSortValue(b, sortField);
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

function getPageTokens(total: number, page: number): Array<number | '...'> {
  if (total <= 5) return Array.from({ length: total }, (_, idx) => idx + 1);
  if (page <= 2) return [1, 2, 3, 4, '...', total];
  if (page >= total - 1) return [1, '...', total - 3, total - 2, total - 1, total];
  return [1, '...', page - 1, page, page + 1, '...', total];
}

function renderPager() {
  const total = totalPages();
  currentPage = Math.min(Math.max(currentPage, 1), total);
  els.pager.innerHTML = '';

  const prev = document.createElement('button');
  prev.className = 'comp-finder-page-btn';
  prev.textContent = '◀';
  prev.disabled = currentPage <= 1;
  prev.addEventListener('click', () => {
    currentPage = Math.max(1, currentPage - 1);
    renderCompsTable();
  });
  els.pager.appendChild(prev);

  getPageTokens(total, currentPage).forEach((token) => {
    if (token === '...') {
      const span = document.createElement('span');
      span.textContent = '…';
      els.pager.appendChild(span);
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'comp-finder-page-btn';
    if (token === currentPage) btn.classList.add('is-active');
    btn.textContent = String(token);
    btn.addEventListener('click', () => {
      currentPage = token;
      renderCompsTable();
    });
    els.pager.appendChild(btn);
  });

  const next = document.createElement('button');
  next.className = 'comp-finder-page-btn';
  next.textContent = '▶';
  next.disabled = currentPage >= total;
  next.addEventListener('click', () => {
    currentPage = Math.min(total, currentPage + 1);
    renderCompsTable();
  });
  els.pager.appendChild(next);
}

function updateSelectAllState() {
  const allIds = comps.map((row) => row.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedCompIds.has(id));
  els.compsSelectAll.checked = allSelected;
  els.compsSelectAll.indeterminate = !allSelected && selectedCompIds.size > 0;
}

function getDeltaClass(delta: { sign?: 'positive' | 'negative' | 'neutral' | 'error' }) {
  if (delta.sign === 'positive') return 'comp-finder-delta-positive';
  if (delta.sign === 'negative') return 'comp-finder-delta-negative';
  return '';
}

function renderSortableRowLabel(label: string, fieldKey: string): HTMLElement {
  const button = document.createElement('span');
  button.className = 'comp-finder-sort-label';
  const arrow = sortField === fieldKey ? (sortDirection === 'asc' ? '▾' : '▴') : '';
  button.textContent = arrow ? `${label} ${arrow}` : label;
  button.addEventListener('click', () => {
    if (sortField === fieldKey) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = fieldKey;
      sortDirection = 'asc';
    }
    renderCompsTable();
  });
  return button;
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

  const head = document.createElement('tr');
  const removeTh = document.createElement('th');
  removeTh.textContent = '';
  const fieldTh = document.createElement('th');
  fieldTh.textContent = 'Field';
  const subjectTh = document.createElement('th');
  subjectTh.textContent = 'Subject';
  head.append(removeTh, fieldTh, subjectTh);
  visible.forEach((_, idx) => {
    const th = document.createElement('th');
    th.textContent = `Comp ${((currentPage - 1) * COMPS_PER_PAGE) + idx + 1}`;
    head.appendChild(th);
  });
  els.compsTableHead.appendChild(head);

  const selectRow = document.createElement('tr');
  const selectRemove = document.createElement('td');
  selectRemove.textContent = '';
  const selectField = document.createElement('td');
  selectField.textContent = 'Select';
  const selectSubject = document.createElement('td');
  updateSelectAllState();
  const selectAllWrap = document.createElement('label');
  selectAllWrap.className = 'comp-finder-select-all-wrap';
  const selectAllLabel = document.createElement('span');
  selectAllLabel.className = 'comp-finder-select-all-label';
  selectAllLabel.textContent = 'all';
  selectAllWrap.append(els.compsSelectAll, selectAllLabel);
  selectSubject.appendChild(selectAllWrap);
  selectRow.append(selectRemove, selectField, selectSubject);
  visible.forEach((comp) => {
    const td = document.createElement('td');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = selectedCompIds.has(comp.id);
    check.addEventListener('change', () => {
      if (check.checked) selectedCompIds.add(comp.id);
      else selectedCompIds.delete(comp.id);
      updateSelectAllState();
      updateActionButtons();
      updateMapArtifacts();
      renderCompsTable();
    });
    td.appendChild(check);
    selectRow.appendChild(td);
  });
  els.compsTableBody.appendChild(selectRow);

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
    td.textContent = comp.parcelId || '—';
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
    td.textContent = comp.address || '—';
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
        updateAddFieldOptions();
      });
      removeTd.appendChild(removeButton);
    }
    const fieldTd = document.createElement('td');
    fieldTd.appendChild(renderSortableRowLabel(entry.field, entry.field));
    const subjectTd = document.createElement('td');
    subjectTd.textContent = formatSubjectValue(entry.field, entry.type);
    row.append(removeTd, fieldTd, subjectTd);

    visible.forEach((comp) => {
      const td = document.createElement('td');
      if (entry.source === 'criteria') {
        const allFields = getComparisonFields().filter((f) => f.source === 'criteria');
        const deltaIndex = allFields.findIndex((f) => f.field === entry.field);
        const delta = comp.deltas[deltaIndex];
        td.textContent = delta?.text ?? '—';
        if (delta?.error) td.title = delta.error;
        const cls = getDeltaClass(delta || {});
        if (cls) td.classList.add(cls);
      } else {
        const val = getFieldValue(comp.feature, entry.field);
        td.textContent = val === null || val === undefined || val === '' ? '—' : (entry.type === 'numeric' ? fmt(val) : String(val));
      }
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
      if (!range || range <= 0) continue;
      const subjectValue = numOrNull(getFieldValue(subject.feature, row.field));
      const compValue = numOrNull(getFieldValue(feature, row.field));
      if (subjectValue === null || compValue === null) return false;
      const allowedRange = row.usePercent ? Math.abs(subjectValue) * (range / 100) : range;
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

function buildDelta(value: any, subjectValue: any, type: 'numeric' | 'categorical') {
  if (type === 'numeric') {
    const compVal = numOrNull(value);
    const subjVal = numOrNull(subjectValue);
    if (compVal === null || subjVal === null) return { text: 'ERROR', error: 'Missing numeric value', sign: 'error' as const };
    const delta = compVal - subjVal;
    if (delta === 0) return { text: '=', sign: 'neutral' as const };
    const sign = delta > 0 ? '+' : '';
    return { text: `${sign}${fmt(delta)}`, sign: delta > 0 ? 'positive' as const : 'negative' as const };
  }
  if (value === null || value === undefined || subjectValue === null || subjectValue === undefined) {
    return { text: 'ERROR', error: 'Missing categorical value', sign: 'error' as const };
  }
  return { text: String(value) === String(subjectValue) ? '=' : '≠', sign: 'neutral' as const };
}

async function findComps() {
  if (!subject) return;
  const compStore = getCompDataStore();
  if (!compStore?.geojson) return;

  setFinding(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const criteriaFields = getComparisonFields().filter((entry) => entry.source === 'criteria');
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

    const deltas = criteriaFields.map((entry) => {
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

  currentPage = 1;
  setCriteriaDirty(false);
  updateRefreshButtonLabel();
  updateSelectAllState();
  updateActionButtons();
  renderCompsTable();
  updateMapArtifacts();
  setFinding(false);
}

function handleSelectAllToggle() {
  const checked = els.compsSelectAll.checked;
  if (checked) comps.forEach((row) => selectedCompIds.add(row.id));
  else selectedCompIds.clear();
  updateSelectAllState();
  updateActionButtons();
  updateMapArtifacts();
  renderCompsTable();
}

function handleZoomToComps() {
  if (selectedCompIds.size === 0) return;
  const selectedFeatures = comps.filter((row) => selectedCompIds.has(row.id)).map((row) => row.feature);
  const bounds = bbox({ type: 'FeatureCollection', features: selectedFeatures });
  if (!bounds) return;
  S.map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 60, duration: 600 });
}

function buildExportRows() {
  if (!subject) return [];
  const comparisonFields = getComparisonFields();
  const criteriaFields = comparisonFields.filter((f) => f.source === 'criteria');
  const rows: Record<string, any>[] = [];

  const subjectRow: Record<string, any> = {
    is_subject: 'TRUE',
    parcel_id: subject.parcelId || '',
    address: subject.address || '',
  };
  comparisonFields.forEach((entry) => {
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
    comparisonFields.forEach((entry) => {
      compRow[entry.field] = getFieldValue(row.feature, entry.field);
    });
    criteriaFields.forEach((entry, idx) => {
      compRow[`delta_${entry.field}`] = row.deltas[idx]?.text ?? '';
    });
    extraFields.forEach((entry) => {
      if (!compRow.hasOwnProperty(`delta_${entry.field}`)) {
        compRow[`delta_${entry.field}`] = buildDelta(
          getFieldValue(row.feature, entry.field),
          getFieldValue(subject.feature, entry.field),
          entry.type,
        ).text;
      }
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
    ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? '')).join(',')),
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
  if (subject?.dataStoreId) els.dataSourceSelect.value = subject.dataStoreId;
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

function ensureDefaultCriteria(store: DataStore) {
  if (criteria.length > 0 || !subject) return;
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
    const subjectValue = getFieldValue(subject.feature, field);
    criteria.push({
      id: uid('criterion'),
      field,
      fieldType,
      value: (subjectValue === null || subjectValue === undefined || subjectValue === '') ? [] : [String(subjectValue)],
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
  currentPage = 1;
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
  refreshDataSources();

  if (!els.distanceInput.value) els.distanceInput.value = '1';
  if (!els.distanceUnitsSelect.value) els.distanceUnitsSelect.value = 'mi';
  els.distanceInput.value = '1';
  els.distanceUnitsSelect.value = 'mi';

  ensureDefaultCriteria(store);
  syncCriteriaFields();
  renderCriteriaTable();
  resetComps();
  updateMapArtifacts();
}

export function setCompFinderToolActive(active: boolean) {
  isToolActive = active;
}

export function setCompFinderMenuVisible(visible: boolean) {
  isMenuVisible = visible;
  if (!visible) {
    clearSubjectMarker();
    clearCompMarkers();
    clearDistanceOverlay();
    return;
  }
  updateMapArtifacts();
}

export function initCompFinderElements(elements: Elements) {
  els = elements;

  els.dataSourceSelect.addEventListener('change', () => {
    syncCriteriaFields();
    renderCriteriaTable();
    resetComps();
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

  els.compsSelectAll.addEventListener('change', handleSelectAllToggle);

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

  renderCompsUI();
  renderAddFieldOptions();
}

export function initCompFinderCallbacks(cb: Callbacks) {
  callbacks = cb;
}
