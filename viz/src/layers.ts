/**
 * Layer management logic extracted from main.ts.
 *
 * Handles creating, switching, persisting, and rendering layers
 * and data stores. Heavy cross-module coupling is managed via
 * init callbacks so that this module has no direct imports from
 * main.ts.
 */
import { S, PRIMARY_COLOR } from './state';
import { fieldsForPicker } from './field-availability.js';
import { SOURCE_ID, LAYER_ID, ERROR_LAYER_ID } from './config';
import type { BasemapMode, LayerState, DataStore } from './types';
import type { AsyncBuffer } from './utils.sanitize';
import { cloneFilters, setFiltersContext, isFilterComplete } from './filters';
import { refreshLandSchedulePanel } from './land-schedule';
import { FILTER_ICON, CHART_ICON, SCATTER_ICON, STREET_ICON, SATELLITE_ICON } from './icons';

/* ------------------------------------------------------------------ */
/*  DOM element references — imported directly from dom-refs.          */
/* ------------------------------------------------------------------ */

import {
  layerList as _layerList,
  dataStoreList as _dataStoreList,
  fieldSelect as _fieldSelect,
  rampSelect as _rampSelect,
  opacityInput as _opacityInput,
  opacityOut as _opacityOut,
  normModeSelect as _normModeSelect,
  colorModeSelect as _colorModeSelect,
  colorPicker as _colorPicker,
  enable3DCheckbox as _enable3DCheckbox,
  enableHexCheckbox as _enableHexCheckbox,
  hexResInput as _hexResInput,
  hexResReadout as _hexResReadout,
  filtersInvertToggle as _filtersInvertToggle,
} from './dom-refs';

/* ------------------------------------------------------------------ */
/*  Callbacks into other modules (set once via initLayerCallbacks)     */
/* ------------------------------------------------------------------ */

let _setSizeState: (bldgField: string | null, bldgUnit: string | null, landField: string | null, landUnit: string | null) => void;
let _populateFieldDropdownFromList: (list: string[]) => void;
let _updateFieldTypeUI: () => void;
let _update3DUI: () => void;
let _updateFloatingLegend: () => void;
let _updateSelectionControls: () => void;
let _refreshStatisticsPanel: () => void;
let _refreshScatterPanel: () => void;
let _refreshFiltersUI: () => void;
let _showFiltersPanel: () => void;
let _showStatisticsPanel: () => void;
let _showScatterplotPanel: () => void;
let _renderStatsLayerOptions: () => void;
let _renderScatterLayerOptions: () => void;
let _addOrUpdateSource: (fc: GeoJSON.FeatureCollection) => void;
let _applyGrayRendering: () => void;
let _applyExtrusionWithVisibility: () => void;
let _closeAddLayerModal: () => void;
let _createEyeButton: (isHidden: boolean, title: string) => HTMLButtonElement;
let _setEyeButtonIcon: (button: HTMLButtonElement, isHidden: boolean) => void;
let _setBasemapMode: (mode: BasemapMode) => void;
let _refreshInspectConfigPanel: () => void = () => {};

export function initLayerCallbacks(cbs: {
  setSizeState: (bldgField: string | null, bldgUnit: string | null, landField: string | null, landUnit: string | null) => void;
  populateFieldDropdownFromList: (list: string[]) => void;
  updateFieldTypeUI: () => void;
  update3DUI: () => void;
  updateFloatingLegend: () => void;
  updateSelectionControls: () => void;
  refreshStatisticsPanel: () => void;
  refreshScatterPanel: () => void;
  refreshFiltersUI: () => void;
  showFiltersPanel: () => void;
  showStatisticsPanel: () => void;
  showScatterplotPanel: () => void;
  renderStatsLayerOptions: () => void;
  renderScatterLayerOptions: () => void;
  addOrUpdateSource: (fc: GeoJSON.FeatureCollection) => void;
  applyGrayRendering: () => void;
  applyExtrusionWithVisibility: () => void;
  closeAddLayerModal: () => void;
  createEyeButton: (isHidden: boolean, title: string) => HTMLButtonElement;
  setEyeButtonIcon: (button: HTMLButtonElement, isHidden: boolean) => void;
  setBasemapMode: (mode: BasemapMode) => void;
  refreshInspectConfigPanel?: () => void;
}) {
  _setSizeState = cbs.setSizeState;
  _populateFieldDropdownFromList = cbs.populateFieldDropdownFromList;
  _updateFieldTypeUI = cbs.updateFieldTypeUI;
  _update3DUI = cbs.update3DUI;
  _updateFloatingLegend = cbs.updateFloatingLegend;
  _updateSelectionControls = cbs.updateSelectionControls;
  _refreshStatisticsPanel = cbs.refreshStatisticsPanel;
  _refreshScatterPanel = cbs.refreshScatterPanel;
  _refreshFiltersUI = cbs.refreshFiltersUI;
  _showFiltersPanel = cbs.showFiltersPanel;
  _showStatisticsPanel = cbs.showStatisticsPanel;
  _showScatterplotPanel = cbs.showScatterplotPanel;
  _renderStatsLayerOptions = cbs.renderStatsLayerOptions;
  _renderScatterLayerOptions = cbs.renderScatterLayerOptions;
  _addOrUpdateSource = cbs.addOrUpdateSource;
  _applyGrayRendering = cbs.applyGrayRendering;
  _applyExtrusionWithVisibility = cbs.applyExtrusionWithVisibility;
  _closeAddLayerModal = cbs.closeAddLayerModal;
  _createEyeButton = cbs.createEyeButton;
  _setEyeButtonIcon = cbs.setEyeButtonIcon;
  _setBasemapMode = cbs.setBasemapMode;
  if (cbs.refreshInspectConfigPanel) {
    _refreshInspectConfigPanel = cbs.refreshInspectConfigPanel;
  }
}

/* ------------------------------------------------------------------ */
/*  Pure helpers (no cross-module deps)                               */
/* ------------------------------------------------------------------ */

export function getCurrentLayer(): LayerState | null {
  return S.currentLayerId ? S.layers.get(S.currentLayerId) ?? null : null;
}

export function getCurrentLayerIds() {
  const layer = getCurrentLayer();
  if (!layer) return null;
  return { sourceId: layer.sourceId, layerId: layer.layerId, errorLayerId: layer.errorLayerId };
}

export function getCurrentSourceId() {
  return getCurrentLayerIds()?.sourceId ?? null;
}

export function getStatsLayer(): LayerState | null {
  return S.statsLayerId ? S.layers.get(S.statsLayerId) ?? null : null;
}

export function getScatterLayer(): LayerState | null {
  return S.scatterLayerId ? S.layers.get(S.scatterLayerId) ?? null : null;
}

export function getLayerDataStore(layer: LayerState | null): DataStore | null {
  return layer ? S.dataStores.get(layer.dataStoreId) ?? null : null;
}

export function getLayerGeoJSON(layer: LayerState | null): GeoJSON.FeatureCollection | null {
  return layer?.geojson ?? null;
}

export function getScatterDataStore(): DataStore | null {
  return getLayerDataStore(getScatterLayer());
}

export function getLayerPanelName(layerId: string): string {
  const layer = S.layers.get(layerId);
  if (!layer) return '';
  const index = S.layerOrder.indexOf(layerId);
  return layer.field ?? `layer ${index + 1}`;
}

export function getLayerSelectLabel(layerId: string): string {
  const layer = S.layers.get(layerId);
  if (!layer) return '';
  const baseName = getLayerPanelName(layerId);
  const store = S.dataStores.get(layer.dataStoreId);
  const sourceLabel = store?.file?.name ?? store?.name ?? 'Unknown source';
  return `${baseName} (${sourceLabel})`;
}

export function renderLayerSelectOptions(
  select: HTMLSelectElement,
  selectedId: string | null,
  placeholderText: string
): string | null {
  select.replaceChildren();
  const placeholder = new Option(placeholderText, '');
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  if (S.layerOrder.length === 0) {
    select.disabled = true;
    return null;
  }

  S.layerOrder.forEach(layerId => {
    select.appendChild(new Option(getLayerSelectLabel(layerId), layerId));
  });

  select.disabled = false;
  if (selectedId && S.layers.has(selectedId)) {
    select.value = selectedId;
    return selectedId;
  }
  const fallback = S.currentLayerId ?? S.layerOrder[0] ?? null;
  if (fallback) {
    select.value = fallback;
    return fallback;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Data store functions                                              */
/* ------------------------------------------------------------------ */

export function createDataStore(file: File, asyncBuffer: AsyncBuffer): DataStore {
  const id = `store-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const name = file.name.replace(/\.[^/.]+$/, '') || file.name;
  return {
    id,
    name,
    file,
    asyncBuffer,
    geojson: null,
    numericFieldsFromSchema: [],
    categoricalFieldsFromSchema: [],
    chosenNumericFields: [],
    chosenCategoricalFields: [],
    landSizeField: null,
    landSizeUnitLabel: null,
    bldgSizeField: null,
    bldgSizeUnitLabel: null,
    salePriceField: null,
    saleDateField: null,
    validSaleField: null,
    vacantSaleField: null,
    parcelIdField: null,
    addressField: null,
    bldgQualityField: null,
    bldgConditionField: null,
    bldgAgeField: null,
    bldgEffAgeField: null,
    bldgBedsField: null,
    bldgBathsField: null,
    bldgTypeField: null,
    landTypeField: null,
    landZoningField: null,
    saleIdField: null,
    fullMarketValueField: null,
    assessedValueField: null,
    landValueField: null,
    improvementValueField: null,
  };
}

export function renderDataStoreList() {
  if (!_dataStoreList) return;
  _dataStoreList.replaceChildren();

  if (S.dataStoreOrder.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No data sources loaded yet.';
    _dataStoreList.appendChild(empty);
    return;
  }

  S.dataStoreOrder.forEach(storeId => {
    const store = S.dataStores.get(storeId);
    if (!store) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'data-store-button';
    btn.textContent = store.name;
    btn.addEventListener('click', () => {
      if (addLayerFromDataStore(store.id)) {
        _closeAddLayerModal();
      }
    });
    _dataStoreList.appendChild(btn);
  });
}

/* ------------------------------------------------------------------ */
/*  Layer state management                                            */
/* ------------------------------------------------------------------ */

export function createLayerState(name: string, dataStoreId: string): LayerState {
  S.layerCounter += 1;
  const suffix = `layer-${S.layerCounter}`;
  return {
    id: suffix,
    name,
    dataStoreId,
    sourceId: `${SOURCE_ID}-${suffix}`,
    layerId: `${LAYER_ID}-${suffix}`,
    errorLayerId: `${ERROR_LAYER_ID}-${suffix}`,
    visible: true,
    geojson: null,
    field: null,
    fieldType: null,
    stats: null,
    normalizationMode: 'asis',
    colorMode: 'quantiles',
    categoricalColorMode: 'random',
    singleColorValue: PRIMARY_COLOR,
    ramp: _rampSelect?.value ?? 'Magma',
    colorDomain: null,
    colorBreaks: null,
    cachedExtrusionSettings: null,
    chosenNumericFields: [],
    chosenCategoricalFields: [],
    landSizeField: null,
    landSizeUnitLabel: null,
    bldgSizeField: null,
    bldgSizeUnitLabel: null,
    hiddenLegendItems: new Set(),
    selectedLegendItems: new Set(),
    selectedParcels: new Set(),
    highlightColor: '#00FF00',
    legendSortField: 'count',
    legendSortDirection: 'desc',
    customColors: new Map(),
    opacity: parseFloat(_opacityInput.value),
    is3DMode: false,
    hexMode: false,
    hexResolution: 8,
    filters: [],
    filterMode: 'none',
    filterActionMode: 'none',
    filterInvert: false,
    parcelPatchMap: new Map(),
    civilValuationId: undefined,
    civilNeighborhoodDefinitionId: undefined,
    civilLegalAsOf: undefined
  };
}

export function persistCurrentLayerState() {
  const layer = getCurrentLayer();
  if (!layer) return;
  layer.geojson = S.currentGeoJSON;
  layer.field = S.currentField;
  layer.fieldType = S.currentFieldType;
  layer.stats = S.currentStats;
  layer.normalizationMode = S.normalizationMode;
  layer.colorMode = S.colorMode;
  layer.categoricalColorMode = S.categoricalColorMode;
  layer.singleColorValue = S.singleColorValue;
  layer.ramp = _rampSelect?.value ?? layer.ramp;
  layer.colorDomain = S.colorDomain;
  layer.colorBreaks = S.colorBreaks;
  layer.cachedExtrusionSettings = S.cachedExtrusionSettings;
  layer.chosenNumericFields = [...S.chosenNumericFields];
  layer.chosenCategoricalFields = [...S.chosenCategoricalFields];
  layer.landSizeField = S.landSizeField;
  layer.landSizeUnitLabel = S.landSizeUnitLabel;
  layer.bldgSizeField = S.bldgSizeField;
  layer.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
  layer.hiddenLegendItems = S.hiddenLegendItems;
  layer.selectedLegendItems = S.selectedLegendItems;
  layer.selectedParcels = S.selectedParcels;
  layer.highlightColor = S.highlightColor;
  layer.legendSortField = S.legendSortField;
  layer.legendSortDirection = S.legendSortDirection;
  layer.customColors = S.customColors;
  layer.opacity = parseFloat(_opacityInput.value);
  layer.is3DMode = S.is3DMode;
  layer.hexMode = S.hexMode;
  layer.hexResolution = S.hexResolution;
  layer.filters = cloneFilters(S.filters);
  layer.filterMode = S.filterMode;
  layer.filterActionMode = S.filterActionMode;
  layer.filterInvert = S.filterInvert;
  layer.parcelPatchMap = S.parcelPatchMap;
  layer.civilValuationId = S.civilValuationId || undefined;
  layer.civilNeighborhoodDefinitionId = S.civilNeighborhoodDefinitionId || undefined;
  layer.civilLegalAsOf = S.civilLegalAsOf || undefined;
}

export function applyLayerState(layer: LayerState) {
  S.currentGeoJSON = layer.geojson;
  S.currentField = layer.field;
  S.currentFieldType = layer.fieldType;
  S.currentStats = layer.stats;
  S.normalizationMode = layer.normalizationMode;
  S.colorMode = layer.colorMode;
  S.categoricalColorMode = layer.categoricalColorMode;
  S.singleColorValue = layer.singleColorValue;
  S.colorDomain = layer.colorDomain;
  S.colorBreaks = layer.colorBreaks;
  S.cachedExtrusionSettings = layer.cachedExtrusionSettings;
  S.chosenNumericFields = [...layer.chosenNumericFields];
  S.chosenCategoricalFields = [...layer.chosenCategoricalFields];
  S.landSizeField = layer.landSizeField;
  S.landSizeUnitLabel = layer.landSizeUnitLabel;
  S.bldgSizeField = layer.bldgSizeField;
  S.bldgSizeUnitLabel = layer.bldgSizeUnitLabel;
  S.hiddenLegendItems = layer.hiddenLegendItems;
  S.selectedLegendItems = layer.selectedLegendItems;
  S.selectedParcels = layer.selectedParcels;
  S.highlightColor = layer.highlightColor;
  S.legendSortField = layer.legendSortField;
  S.legendSortDirection = layer.legendSortDirection;
  S.customColors = layer.customColors;
  _opacityInput.value = String(layer.opacity);
  if (_opacityOut) _opacityOut.value = Number(layer.opacity).toFixed(2);
  S.is3DMode = layer.is3DMode;
  S.hexMode = layer.hexMode ?? false;
  S.hexResolution = layer.hexResolution ?? 8;
  S.filters = cloneFilters(layer.filters ?? []);
  S.parcelPatchMap = layer.parcelPatchMap ?? new Map();
  S.filterMode = layer.filterMode ?? 'none';
  S.filterActionMode = layer.filterActionMode ?? 'none';
  S.filterInvert = layer.filterInvert ?? false;
  if (_filtersInvertToggle) {
    _filtersInvertToggle.checked = S.filterInvert;
  }
  S.civilValuationId = layer.civilValuationId || null;
  S.civilNeighborhoodDefinitionId = layer.civilNeighborhoodDefinitionId || null;
  S.civilLegalAsOf = layer.civilLegalAsOf || null;
  S.currentDataStoreId = layer.dataStoreId;
  const store = S.dataStores.get(layer.dataStoreId);
  if (store) {
    S.lastFile = store.file;
    S.lastAsyncBuffer = store.asyncBuffer;
    S.lastNumericFieldsFromSchema = [...store.numericFieldsFromSchema];
    S.lastCategoricalFieldsFromSchema = [...store.categoricalFieldsFromSchema];
    S.timeAdjustmentSettings.dataSourceId = store.id;
    S.timeAdjustmentSettings.salePriceField = store.salePriceField || '';
    S.timeAdjustmentSettings.saleDateField = store.saleDateField || '';
    S.timeAdjustmentSettings.validSaleField = store.validSaleField || '';
    S.timeAdjustmentSettings.vacantSaleField = store.vacantSaleField || '';
    S.timeAdjustmentSettings.improvedSizeField = store.bldgSizeField || '';
    S.timeAdjustmentSettings.landSizeField = store.landSizeField || '';
    S.parcelIdField = store.parcelIdField;
    S.addressField = store.addressField;
    S.bldgQualityField = store.bldgQualityField;
    S.bldgConditionField = store.bldgConditionField;
    S.bldgAgeField = store.bldgAgeField;
    S.bldgEffAgeField = store.bldgEffAgeField;
    S.bldgBedsField = store.bldgBedsField;
    S.bldgBathsField = store.bldgBathsField;
    S.bldgTypeField = store.bldgTypeField;
    S.landTypeField = store.landTypeField;
    S.landZoningField = store.landZoningField;
    S.saleIdField = store.saleIdField;
    S.fullMarketValueField = store.fullMarketValueField;
    S.assessedValueField = store.assessedValueField;
    S.landValueField = store.landValueField;
    S.improvementValueField = store.improvementValueField;
  }

  _setSizeState(S.bldgSizeField, S.bldgSizeUnitLabel, S.landSizeField, S.landSizeUnitLabel);

  if (_fieldSelect) {
    const store = S.dataStores.get(layer.dataStoreId);
    const isCivil = store?.isCivil || false;
    if (!S.currentGeoJSON && !isCivil) {
      _fieldSelect.replaceChildren(new Option('— load a file first —', ''));
      _fieldSelect.value = '';
    } else {
      if (isCivil) {
        const civilFields = [
          'land_area_sq_ft',
          'frontage_ft',
          'depth_ft',
          'land_use_id',
          'zoning_ids',
          'improvement_area_sq_ft',
          'bedrooms',
          'bathrooms',
          'units',
          'primary_improvement_year_built',
          'primary_improvement_effective_year_built',
          'primary_improvement_condition_id',
          'primary_improvement_type_id'
        ];
        _populateFieldDropdownFromList(civilFields);
      } else {
        const allAvailableFields = [
          ...fieldsForPicker(S.chosenNumericFields, S.currentGeoJSON),
          ...fieldsForPicker(S.chosenCategoricalFields, S.currentGeoJSON)
        ];
        _populateFieldDropdownFromList(allAvailableFields);
      }
      _fieldSelect.value = S.currentField ?? '';
    }
  }

  if (_normModeSelect) {
    const landUnit = S.landSizeField ? (S.landSizeUnitLabel ?? '(unit)') : '(unit)';
    const bldgUnit = S.bldgSizeField ? (S.bldgSizeUnitLabel ?? '(unit)') : '(unit)';
    const perLandOption = _normModeSelect.querySelector('option[value="perLand"]') as HTMLOptionElement | null;
    const perBuildingOption = _normModeSelect.querySelector('option[value="perBuilding"]') as HTMLOptionElement | null;
    if (perLandOption) {
      perLandOption.disabled = !S.landSizeField;
      perLandOption.textContent = `…per land size ${landUnit}`;
    }
    if (perBuildingOption) {
      perBuildingOption.disabled = !S.bldgSizeField;
      perBuildingOption.textContent = `…per building size ${bldgUnit}`;
    }
    _normModeSelect.value = S.normalizationMode;
  }

  if (_colorModeSelect) _colorModeSelect.value = S.colorMode;

  document.querySelectorAll<HTMLInputElement>('input[name="categoricalColorMode"]').forEach(radio => {
    radio.checked = radio.value === S.categoricalColorMode;
  });

  if (_rampSelect && layer.ramp) {
    _rampSelect.value = layer.ramp;
  }

  if (_colorPicker) {
    _colorPicker.value = S.singleColorValue;
  }

  _enable3DCheckbox.checked = S.is3DMode;
  if (_enableHexCheckbox) _enableHexCheckbox.checked = S.hexMode;
  if (_hexResInput) _hexResInput.value = String(S.hexResolution);
  if (_hexResReadout) _hexResReadout.value = String(S.hexResolution);
  updateCurrentLayerDetails();
  _updateFieldTypeUI();
  _update3DUI();
  _updateFloatingLegend();
  _updateSelectionControls();
  renderDataStoreList();
  _refreshStatisticsPanel();
  _refreshScatterPanel();
  refreshLandSchedulePanel();

  if (S.map.getLayer(layer.layerId)) {
    setLayerVisibility(layer, layer.visible);
  }

  if (S.selectionControlsPanel) {
    const picker = S.selectionControlsPanel.querySelector('#highlightColorPicker') as HTMLInputElement | null;
    if (picker) picker.value = S.highlightColor;
  }

  _refreshFiltersUI();
}

/* ------------------------------------------------------------------ */
/*  Layer list and ordering                                           */
/* ------------------------------------------------------------------ */

export function registerLayer(layer: LayerState) {
  S.layers.set(layer.id, layer);
  S.layerOrder.unshift(layer.id);
  S.currentLayerId = layer.id;
  applyLayerState(layer);
  applyLayerOrderToMap();
  renderLayerList();
}

export function moveLayerInOrder(layerId: string, direction: 'up' | 'down') {
  const index = S.layerOrder.indexOf(layerId);
  if (index === -1) return;
  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= S.layerOrder.length) return;
  S.layerOrder.splice(index, 1);
  S.layerOrder.splice(newIndex, 0, layerId);
  applyLayerOrderToMap();
  renderLayerList();
}

export function applyLayerOrderToMap() {
  for (let i = S.layerOrder.length - 1; i >= 0; i -= 1) {
    const layerId = S.layerOrder[i];
    const layer = S.layers.get(layerId);
    if (!layer) continue;
    if (S.map.getLayer(layer.layerId)) {
      S.map.moveLayer(layer.layerId);
    }
    if (S.map.getLayer(layer.errorLayerId)) {
      S.map.moveLayer(layer.errorLayerId);
    }
  }
}

export function addLayerFromDataStore(storeId: string): boolean {
  const store = S.dataStores.get(storeId);
  if (!store) return false;
  if (!store.geojson) {
    alert('That data set is not ready yet. Finish loading it first.');
    return false;
  }
  persistCurrentLayerState();
  const layerName = `${store.name} (copy ${S.layerOrder.length + 1})`;
  const layer = createLayerState(layerName, store.id);
  layer.geojson = store.geojson;
  layer.chosenNumericFields = [...store.chosenNumericFields];
  layer.chosenCategoricalFields = [...store.chosenCategoricalFields];
  layer.landSizeField = store.landSizeField;
  layer.landSizeUnitLabel = store.landSizeUnitLabel;
  layer.bldgSizeField = store.bldgSizeField;
  layer.bldgSizeUnitLabel = store.bldgSizeUnitLabel;
  registerLayer(layer);
  _addOrUpdateSource(layer.geojson);
  _applyGrayRendering();
  applyLayerOrderToMap();
  // Desktop: register the new layer so the viewport streamer keeps it fresh on
  // pan (it's backed by an already-streamed DB source). No-op in browser.
  if (window.vizDesktop) {
    window.dispatchEvent(new CustomEvent('viz:layer-added', {
      detail: { sourceId: store.id, layerId: layer.id }
    }));
  }
  return true;
}

export function setCurrentLayer(layerId: string) {
  if (S.currentLayerId === layerId) return;
  persistCurrentLayerState();
  const layer = S.layers.get(layerId);
  if (!layer) return;
  S.currentLayerId = layerId;
  applyLayerState(layer);
  _refreshInspectConfigPanel();
  renderLayerList();
  if (S.currentGeoJSON && S.currentField) {
    _applyExtrusionWithVisibility();
  } else if (S.currentGeoJSON) {
    _applyGrayRendering();
  }
  if (window.vizDesktop) window.dispatchEvent(new Event('viz:state-changed'));
}

export function setLayerVisibility(layer: LayerState, visible: boolean) {
  layer.visible = visible;
  const visibility = visible ? 'visible' : 'none';
  if (S.map.getLayer(layer.layerId)) {
    S.map.setLayoutProperty(layer.layerId, 'visibility', visibility);
  }
  if (S.map.getLayer(layer.errorLayerId)) {
    S.map.setLayoutProperty(layer.errorLayerId, 'visibility', visibility);
  }
  const outlineLayerId = `${layer.layerId}-outline`;
  if (S.map.getLayer(outlineLayerId)) {
    S.map.setLayoutProperty(outlineLayerId, 'visibility', visibility);
  }
}

export function removeLayer(layerId: string) {
  const layer = S.layers.get(layerId);
  if (!layer) return;
  if (S.map.getLayer(layer.layerId)) S.map.removeLayer(layer.layerId);
  if (S.map.getLayer(layer.errorLayerId)) S.map.removeLayer(layer.errorLayerId);
  const outlineLayerId = `${layer.layerId}-outline`;
  if (S.map.getLayer(outlineLayerId)) S.map.removeLayer(outlineLayerId);
  if (S.map.getSource(layer.sourceId)) S.map.removeSource(layer.sourceId);
  S.layers.delete(layerId);
  const idx = S.layerOrder.indexOf(layerId);
  if (idx >= 0) S.layerOrder.splice(idx, 1);

  if (S.currentLayerId === layerId) {
    S.currentLayerId = S.layerOrder.length ? S.layerOrder[0] : null;
    if (S.currentLayerId) {
      applyLayerState(S.layers.get(S.currentLayerId)!);
    } else {
      S.currentGeoJSON = null;
      S.currentField = null;
      S.currentFieldType = null;
      S.currentStats = null;
      S.colorBreaks = null;
      S.colorDomain = null;
      S.customColors = new Map();
      S.hiddenLegendItems = new Set();
      S.selectedLegendItems = new Set();
      S.selectedParcels = new Set();
      S.highlightColor = '#00FF00';
      S.filters = [];
      S.filterMode = 'none';
      S.filterActionMode = 'none';
      S.filterInvert = false;
      if (_filtersInvertToggle) {
        _filtersInvertToggle.checked = false;
      }
      _fieldSelect.replaceChildren(new Option('— load a file first —', ''));
      _updateFieldTypeUI();
      _updateFloatingLegend();
      _refreshFiltersUI();
      _refreshStatisticsPanel();
      _refreshScatterPanel();
      refreshLandSchedulePanel();
      if (S.selectionControlsPanel) {
        S.selectionControlsPanel.style.display = 'none';
      }
    }
  }
  renderLayerList();
  applyLayerOrderToMap();
  if (window.vizDesktop) window.dispatchEvent(new Event('viz:state-changed'));
}

/* ------------------------------------------------------------------ */
/*  UI rendering                                                      */
/* ------------------------------------------------------------------ */

export function updateCurrentLayerDetails() {
  // Current layer/source readout removed from UI.
}

export function renderLayerList() {
  if (!_layerList) return;
  _layerList.replaceChildren();

  if (S.layerOrder.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No layers loaded yet.';
    _layerList.appendChild(empty);
    updateCurrentLayerDetails();
    S.statsLayerId = null;
    S.scatterLayerId = null;
    _renderStatsLayerOptions();
    _renderScatterLayerOptions();
    _refreshStatisticsPanel();
    _refreshScatterPanel();
  } else {
    S.layerOrder.forEach((layerId, index) => {
      const layer = S.layers.get(layerId);
      if (!layer) return;

      const row = document.createElement('div');
      row.className = `layer-row${layerId === S.currentLayerId ? ' current' : ''}`;

      const visibilityToggle = _createEyeButton(!layer.visible, layer.visible ? 'Hide layer' : 'Show layer');
      visibilityToggle.addEventListener('click', () => {
        const nextVisible = !layer.visible;
        setLayerVisibility(layer, nextVisible);
        visibilityToggle.title = nextVisible ? 'Hide layer' : 'Show layer';
        _setEyeButtonIcon(visibilityToggle, !nextVisible);
      });

      const currentRadio = document.createElement('input');
      currentRadio.type = 'radio';
      currentRadio.name = 'currentLayer';
      currentRadio.checked = layerId === S.currentLayerId;
      currentRadio.title = 'Set as current layer';
      currentRadio.addEventListener('change', () => {
        if (currentRadio.checked) setCurrentLayer(layerId);
      });

      const nameButton = document.createElement('button');
      nameButton.type = 'button';
      nameButton.className = 'layer-name';
      nameButton.textContent = layer.field ?? `layer ${index + 1}`
      nameButton.addEventListener('click', () => setCurrentLayer(layerId));

      const moveUpBtn = document.createElement('button');
      moveUpBtn.type = 'button';
      moveUpBtn.className = 'layer-action-btn';
      moveUpBtn.textContent = '\u25B2';
      moveUpBtn.title = 'Move layer up';
      moveUpBtn.disabled = S.layerOrder.indexOf(layerId) === 0;
      moveUpBtn.addEventListener('click', () => moveLayerInOrder(layerId, 'up'));

      const moveDownBtn = document.createElement('button');
      moveDownBtn.type = 'button';
      moveDownBtn.className = 'layer-action-btn';
      moveDownBtn.textContent = '\u25BC';
      moveDownBtn.title = 'Move layer down';
      moveDownBtn.disabled = S.layerOrder.indexOf(layerId) === S.layerOrder.length - 1;
      moveDownBtn.addEventListener('click', () => moveLayerInOrder(layerId, 'down'));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'layer-action-btn';
      deleteBtn.textContent = '\u274C';
      deleteBtn.title = 'Delete layer';
      deleteBtn.addEventListener('click', () => {
        if (!confirm(`Delete layer "${layer.name}"?`)) return;
        removeLayer(layerId);
        applyLayerOrderToMap();
      });

      const toolsGroup = document.createElement('div');
      toolsGroup.className = 'layer-tools';

      const hasActiveFilters = (layer.filters ?? []).some(filter => isFilterComplete(filter));

      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = `layer-tool-btn${hasActiveFilters ? ' is-active' : ' is-muted'}`;
      filterBtn.title = 'Filters';
      filterBtn.innerHTML = `<img src="${FILTER_ICON}" alt="Filters" />`;
      filterBtn.addEventListener('click', () => {
        setCurrentLayer(layerId);
        setFiltersContext({ type: 'layer' });
        _showFiltersPanel();
      });

      const statsBtn = document.createElement('button');
      statsBtn.type = 'button';
      statsBtn.className = 'layer-tool-btn';
      statsBtn.title = 'Statistics';
      statsBtn.innerHTML = `<img src="${CHART_ICON}" alt="Statistics" />`;
      statsBtn.addEventListener('click', () => {
        const prevStatsLayer = S.statsLayerId;
        S.statsLayerId = layerId;
        if (prevStatsLayer !== S.statsLayerId) {
          S.statsCategoryField = null;
          S.statsCategoryValueIndices = [];
          S.statsField = null;
          S.statsFieldType = null;
        }
        _renderStatsLayerOptions();
        _refreshStatisticsPanel();
        _showStatisticsPanel();
      });

      const scatterBtn = document.createElement('button');
      scatterBtn.type = 'button';
      scatterBtn.className = 'layer-tool-btn';
      scatterBtn.title = 'Scatterplot';
      scatterBtn.innerHTML = `<img src="${SCATTER_ICON}" alt="Scatterplot" />`;
      scatterBtn.addEventListener('click', () => {
        const prevScatterLayer = S.scatterLayerId;
        S.scatterLayerId = layerId;
        if (prevScatterLayer !== S.scatterLayerId) {
          S.scatterCategoryField = null;
          S.scatterCategoryValueIndices = [];
          S.scatterXField = null;
          S.scatterYField = null;
          S.scatterRangeIsCustom = false;
          S.scatterColorByField = null;
        }
        _renderScatterLayerOptions();
        _refreshScatterPanel();
        _showScatterplotPanel();
      });

      toolsGroup.append(statsBtn, scatterBtn);

      const actionGroup = document.createElement('div');
      actionGroup.className = 'layer-actions';
      actionGroup.append(moveUpBtn, moveDownBtn, deleteBtn);

      row.append(currentRadio, visibilityToggle, filterBtn, nameButton, toolsGroup, actionGroup);
      _layerList.appendChild(row);
    });
  }

  const activeBasemap = S.currentBasemap === 'none' ? S.lastBasemapMode : S.currentBasemap;
  const basemapHidden = S.currentBasemap === 'none';

  const basemapRow = document.createElement('div');
  basemapRow.className = 'layer-row basemap-row';

  const basemapRadio = document.createElement('input');
  basemapRadio.type = 'radio';
  basemapRadio.disabled = true;
  basemapRadio.title = 'Basemap layer';

  const basemapEye = _createEyeButton(basemapHidden, basemapHidden ? 'Show basemap' : 'Hide basemap');
  basemapEye.addEventListener('click', () => {
    const nextMode: BasemapMode = basemapHidden ? S.lastBasemapMode : 'none';
    _setBasemapMode(nextMode);
  });

  const filterSpacer = document.createElement('div');

  const basemapName = document.createElement('span');
  basemapName.className = 'basemap-label';
  basemapName.textContent = activeBasemap;

  const basemapToggleGroup = document.createElement('div');
  basemapToggleGroup.className = 'layer-tools basemap-toggles';

  const streetsButton = document.createElement('button');
  streetsButton.type = 'button';
  streetsButton.className = `layer-tool-btn basemap-toggle${activeBasemap === 'streets' ? ' active' : ''}`;
  streetsButton.title = 'OSM basemap';
  streetsButton.innerHTML = `<img src="${STREET_ICON}" alt="Streets" />`;
  streetsButton.addEventListener('click', () => _setBasemapMode('streets'));

  const satelliteButton = document.createElement('button');
  satelliteButton.type = 'button';
  satelliteButton.className = `layer-tool-btn basemap-toggle${activeBasemap === 'satellite' ? ' active' : ''}`;
  satelliteButton.title = 'Satellite basemap';
  satelliteButton.innerHTML = `<img src="${SATELLITE_ICON}" alt="Satellite" />`;
  satelliteButton.addEventListener('click', () => _setBasemapMode('satellite'));

  basemapToggleGroup.append(streetsButton, satelliteButton);

  const actionSpacer = document.createElement('div');

  basemapRow.append(basemapRadio, basemapEye, filterSpacer, basemapName, basemapToggleGroup, actionSpacer);
  _layerList.appendChild(basemapRow);

  updateCurrentLayerDetails();
  if (S.layerOrder.length > 0) {
    const prevStatsLayer = S.statsLayerId;
    const prevScatterLayer = S.scatterLayerId;
    _renderStatsLayerOptions();
    _renderScatterLayerOptions();
    if (prevStatsLayer !== S.statsLayerId) {
      S.statsCategoryField = null;
      S.statsCategoryValueIndices = [];
      S.statsField = null;
      S.statsFieldType = null;
      _refreshStatisticsPanel();
    }
    if (prevScatterLayer !== S.scatterLayerId) {
      S.scatterCategoryField = null;
      S.scatterCategoryValueIndices = [];
      S.scatterXField = null;
      S.scatterYField = null;
      S.scatterRangeIsCustom = false;
      _refreshScatterPanel();
    }
  }
}
