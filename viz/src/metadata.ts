// metadata.ts - Project save/load functionality

import { S } from './state.js';
import type {
  DataStore,
  LayerState,
  SavedFilterEntry,
  SavedSelectionEntry,
  ProjectFileV1,
  SerializedDataSource,
  SerializedLayer,
  SerializedLandSchedule,
  SerializedLandScheduleEntry,
  SerializedLandScheduleAdjustment,
  SerializedLandScheduleTable,
  LandScheduleEntry
} from './types.js';
import { persistCurrentLayerState, renderDataStoreList, renderLayerList, registerLayer, applyLayerState, applyLayerOrderToMap } from './layers.js';
import { cloneFilters } from './filters.js';
import { revealUI } from './main.js';
import { addOrUpdateSource, applyGrayRendering, ensureErrorLayer } from './rendering.js';
import { applyExtrusionWithVisibility } from './legend.js';
import { prepullAllCivilStoresLookups } from './civil-integration.js';

function serializeDataSource(store: DataStore): SerializedDataSource {
  return {
    id: store.id,
    name: store.name,
    parquetFile: store.file?.name ?? '',
    isCivil: store.isCivil,
    civilGateway: store.civilGateway,
    civilAuthIssuer: store.civilAuthIssuer,
    civilToken: store.civilToken,
    civilOIDCConfig: store.civilOIDCConfig,
    civilTileJson: store.civilTileJson,
    civilZoningMap: store.civilZoningMap,
    civilLandUseMap: store.civilLandUseMap,
    civilLandUseTypeMap: store.civilLandUseTypeMap,
    chosenNumericFields: [...store.chosenNumericFields],
    chosenCategoricalFields: [...store.chosenCategoricalFields],
    allNumericFields: store.chosenNumericFields.length === store.numericFieldsFromSchema.length,
    allCategoricalFields: store.chosenCategoricalFields.length === store.categoricalFieldsFromSchema.length,
    landSizeField: store.landSizeField,
    landSizeUnitLabel: store.landSizeUnitLabel,
    bldgSizeField: store.bldgSizeField,
    bldgSizeUnitLabel: store.bldgSizeUnitLabel,
    salePriceField: store.salePriceField,
    saleDateField: store.saleDateField,
    validSaleField: store.validSaleField,
    vacantSaleField: store.vacantSaleField,
    parcelIdField: store.parcelIdField,
    addressField: store.addressField,
    bldgQualityField: store.bldgQualityField,
    bldgConditionField: store.bldgConditionField,
    bldgAgeField: store.bldgAgeField,
    bldgEffAgeField: store.bldgEffAgeField,
    bldgBedsField: store.bldgBedsField,
    bldgBathsField: store.bldgBathsField,
    bldgTypeField: store.bldgTypeField,
    landTypeField: store.landTypeField,
    landZoningField: store.landZoningField,
    saleIdField: store.saleIdField,
    fullMarketValueField: store.fullMarketValueField,
    assessedValueField: store.assessedValueField,
    landValueField: store.landValueField,
    improvementValueField: store.improvementValueField,
  };
}

function serializeLayer(layer: LayerState): SerializedLayer {
  // Convert Sets to arrays, Maps to objects
  return {
    id: layer.id,
    name: layer.name,
    dataStoreId: layer.dataStoreId,
    visible: layer.visible,
    field: layer.field,
    fieldType: layer.fieldType,
    normalizationMode: layer.normalizationMode,
    colorMode: layer.colorMode,
    categoricalColorMode: layer.categoricalColorMode,
    singleColorValue: layer.singleColorValue,
    ramp: layer.ramp,
    colorDomain: layer.colorDomain,
    colorBreaks: layer.colorBreaks ? [...layer.colorBreaks] : null,
    opacity: layer.opacity,
    is3DMode: layer.is3DMode,
    cachedExtrusionSettings: layer.cachedExtrusionSettings,
    highlightColor: layer.highlightColor,
    legendSortField: layer.legendSortField,
    legendSortDirection: layer.legendSortDirection,
    hiddenLegendItems: Array.from(layer.hiddenLegendItems),
    customColors: Object.fromEntries(layer.customColors),
    filters: layer.filters.map(f => ({...f})),
    filterMode: layer.filterMode,
    filterActionMode: layer.filterActionMode,
    filterInvert: layer.filterInvert,
    civilValuationId: layer.civilValuationId,
    civilNeighborhoodDefinitionId: layer.civilNeighborhoodDefinitionId,
    civilLegalAsOf: layer.civilLegalAsOf
  };
}

function serializeSavedFilters(): SavedFilterEntry[] {
  const result: SavedFilterEntry[] = [];
  S.savedFiltersStore.forEach((entry) => {
    result.push({
      name: entry.name,
      filters: entry.filters.map(f => ({...f})),
      filterInvert: entry.filterInvert
    });
  });
  return result;
}

function serializeSavedSelections(): SavedSelectionEntry[] {
  const result: SavedSelectionEntry[] = [];
  S.savedSelectionsStore.forEach((entry) => {
    result.push({
      name: entry.name,
      keyFields: [...entry.keyFields],
      parcelKeys: entry.parcelKeys.map(k => ({...k})),
      sourceName: entry.sourceName,
    });
  });
  return result;
}

function serializeLandSchedules(): SerializedLandSchedule {
  const tables: SerializedLandScheduleTable[] = (S.landScheduleStore.tables ?? []).map(table => ({
    id: table.id,
    name: table.name,
    unit: table.unit,
    valueMode: table.valueMode,
    rows: table.rows.map(row => ({ ...row })),
    filters: cloneFilters(table.filters ?? []),
    filterInvert: table.filterInvert ?? false,
  }));
  const adjustments: SerializedLandScheduleAdjustment[] = (S.landScheduleStore.adjustments ?? []).map(adjustment => ({
    id: adjustment.id,
    name: adjustment.name,
    operation: adjustment.operation,
    sizeUnit: adjustment.sizeUnit,
    sizeUnitDetail: adjustment.sizeUnitDetail ?? null,
    value: adjustment.value,
    filters: cloneFilters(adjustment.filters ?? []),
    filterInvert: adjustment.filterInvert ?? false,
  }));
  return {
    tables,
    activeTableId: S.landScheduleStore.activeTableId,
    adjustments,
  };
}

/** Build the serializable project snapshot from current app state. Shared by
 *  the browser download (`exportProject`) and the desktop in-place save. */
export function buildProjectFile(): ProjectFileV1 {
  // Persist current layer state before serializing.
  if (S.currentLayerId) {
    persistCurrentLayerState();
  }

  // Serialize all data sources
  const dataSources: SerializedDataSource[] = [];
  S.dataStores.forEach(store => {
    dataSources.push(serializeDataSource(store));
  });

  // Serialize all layers
  const serializedLayers: SerializedLayer[] = [];
  S.layers.forEach(layer => {
    serializedLayers.push(serializeLayer(layer));
  });

  const projectName = dataSources[0]?.name || 'Untitled Project';
  return {
    version: '1.0',
    created: new Date().toISOString(),
    projectName,
    dataSources,
    layers: serializedLayers,
    savedFilters: serializeSavedFilters(),
    savedSelections: serializeSavedSelections(),
    landSchedule: serializeLandSchedules()
  };
}

export function exportProject() {
  const projectFile = buildProjectFile();
  const projectName = projectFile.projectName ?? 'Untitled Project';

  const json = JSON.stringify(projectFile, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const filename = `${projectName.replace(/[^a-z0-9]/gi, '_')}.geovizwiz.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function validateProjectFile(data: any): data is ProjectFileV1 {
  if (!data || typeof data !== 'object') return false;
  if (data.version !== '1.0') return false;
  if (!Array.isArray(data.dataSources)) return false;
  if (!Array.isArray(data.layers)) return false;
  if (!Array.isArray(data.savedFilters)) return false;
  if (data.landSchedule && typeof data.landSchedule !== 'object') return false;
  if (data.landSchedules && !Array.isArray(data.landSchedules)) return false;
  return true;
}

export function deserializeLayer(serialized: SerializedLayer): Partial<LayerState> {
  // Convert arrays to Sets, objects to Maps
  return {
    id: serialized.id,
    name: serialized.name,
    dataStoreId: serialized.dataStoreId,
    visible: serialized.visible,
    field: serialized.field,
    fieldType: serialized.fieldType,
    normalizationMode: serialized.normalizationMode,
    colorMode: serialized.colorMode,
    categoricalColorMode: serialized.categoricalColorMode,
    singleColorValue: serialized.singleColorValue,
    ramp: serialized.ramp,
    colorDomain: serialized.colorDomain,
    colorBreaks: serialized.colorBreaks ? [...serialized.colorBreaks] : null,
    opacity: serialized.opacity,
    is3DMode: serialized.is3DMode,
    cachedExtrusionSettings: serialized.cachedExtrusionSettings,
    highlightColor: serialized.highlightColor,
    legendSortField: serialized.legendSortField,
    legendSortDirection: serialized.legendSortDirection,
    hiddenLegendItems: new Set(serialized.hiddenLegendItems),
    selectedLegendItems: new Set(),  // Runtime state
    customColors: new Map(Object.entries(serialized.customColors)),
    filters: serialized.filters.map(f => ({...f})),
    filterMode: serialized.filterMode,
    filterActionMode: serialized.filterActionMode,
    filterInvert: serialized.filterInvert,
    selectedParcels: new Set(),  // Runtime state
    parcelPatchMap: new Map(),    // Runtime state (future: deserialize if present)
    civilValuationId: serialized.civilValuationId,
    civilNeighborhoodDefinitionId: serialized.civilNeighborhoodDefinitionId,
    civilLegalAsOf: serialized.civilLegalAsOf
  };
}

/** Restore saved filters / selections / land-schedule from a project snapshot
 *  into `S`. Shared by the browser project loader and the desktop restorer. */
export function applyRestoredCollections(projectData: ProjectFileV1) {
  // Restore saved filters
  projectData.savedFilters.forEach((entry: SavedFilterEntry) => {
    S.savedFiltersStore.set(entry.name, {
      name: entry.name,
      filters: entry.filters.map(f => ({...f})),
      filterInvert: entry.filterInvert
    });
  });

  // Restore saved selections
  if (projectData.savedSelections) {
    projectData.savedSelections.forEach((entry: SavedSelectionEntry) => {
      S.savedSelectionsStore.set(entry.name, {
        name: entry.name,
        keyFields: [...entry.keyFields],
        parcelKeys: entry.parcelKeys.map(k => ({...k})),
        sourceName: entry.sourceName ?? null,
      });
    });
  }

  if (projectData.landSchedule) {
    S.landScheduleStore = {
      tables: (projectData.landSchedule.tables ?? []).map(table => ({
        id: table.id,
        name: table.name,
        unit: table.unit,
        valueMode: table.valueMode ?? 'per-unit',
        rows: table.rows.map(row => ({ ...row })),
        filters: (table.filters ?? []).map(f => ({ ...f })),
        filterInvert: table.filterInvert ?? false,
      })),
      activeTableId: projectData.landSchedule.activeTableId ?? null,
      adjustments: (projectData.landSchedule.adjustments ?? []).map(adjustment => ({
        id: adjustment.id,
        name: adjustment.name,
        operation: adjustment.operation ?? 'add',
        sizeUnit: (((adjustment.sizeUnit as unknown as string | null) === 'area')
          ? 'per-land-area'
          : ((adjustment.sizeUnit as unknown as string | null) === 'frontage')
            ? 'per-frontage'
            : adjustment.sizeUnit) ?? 'flat',
        sizeUnitDetail: adjustment.sizeUnitDetail ?? null,
        value: adjustment.value ?? null,
        filters: (adjustment.filters ?? []).map(f => ({ ...f })),
        filterInvert: adjustment.filterInvert ?? false,
      })),
    };
  } else if (projectData.landSchedules && projectData.landSchedules.length > 0) {
    const merged = projectData.landSchedules.reduce((acc: LandScheduleEntry, entry: SerializedLandScheduleEntry) => {
      acc.tables.push(...entry.tables.map(table => ({
        id: table.id,
        name: table.name,
        unit: table.unit,
        valueMode: table.valueMode ?? 'per-unit',
        rows: table.rows.map(row => ({ ...row })),
        filters: (table.filters ?? []).map(f => ({ ...f })),
        filterInvert: table.filterInvert ?? false,
      })));
      acc.adjustments.push(...(entry.adjustments ?? []).map(adjustment => ({
        id: adjustment.id,
        name: adjustment.name,
        operation: adjustment.operation ?? 'add',
        sizeUnit: (((adjustment.sizeUnit as unknown as string | null) === 'area')
          ? 'per-land-area'
          : ((adjustment.sizeUnit as unknown as string | null) === 'frontage')
            ? 'per-frontage'
            : adjustment.sizeUnit) ?? 'flat',
        sizeUnitDetail: adjustment.sizeUnitDetail ?? null,
        value: adjustment.value ?? null,
        filters: (adjustment.filters ?? []).map(f => ({ ...f })),
        filterInvert: adjustment.filterInvert ?? false,
      })));
      acc.activeTableId = acc.activeTableId ?? entry.activeTableId ?? null;
      return acc;
    }, {
      tables: [],
      activeTableId: null,
      adjustments: [],
    });
    S.landScheduleStore = merged;
  }
}

export async function loadProjectFile(file: File) {
  try {
    const text = await file.text();
    const projectData = JSON.parse(text);

    if (!validateProjectFile(projectData)) {
      alert('Invalid project file format.');
      return;
    }

    // Build a map of expected parquet file names to see what's already loaded
    const expectedFiles = new Map<string, SerializedDataSource>();
    projectData.dataSources.forEach(ds => {
      expectedFiles.set(ds.parquetFile, ds);
    });

    // Check which data sources are already loaded
    const existingStores = new Map<string, DataStore>(); // parquet filename -> DataStore
    const missingFiles: string[] = [];

    S.dataStores.forEach(store => {
      if (store.file && expectedFiles.has(store.file.name)) {
        existingStores.set(store.file.name, store);
      }
    });

    // Identify missing files
    expectedFiles.forEach((_ds, filename) => {
      if (!existingStores.has(filename)) {
        missingFiles.push(filename);
      }
    });

    // Clear current session
    // First, properly remove all layers from the map
    const layerIdsToRemove = [...S.layerOrder];
    for (const layerId of layerIdsToRemove) {
      const layer = S.layers.get(layerId);
      if (!layer) continue;

      // Remove from map
      if (S.map.getLayer(layer.layerId)) S.map.removeLayer(layer.layerId);
      if (S.map.getLayer(layer.errorLayerId)) S.map.removeLayer(layer.errorLayerId);
      if (S.map.getSource(layer.sourceId)) S.map.removeSource(layer.sourceId);
    }

    S.layers.clear();
    S.layerOrder.length = 0;
    S.savedFiltersStore.clear();
    S.savedSelectionsStore.clear();
    S.landScheduleStore = {
      tables: [],
      activeTableId: null,
      adjustments: [],
    };
    S.currentLayerId = null;
    S.currentDataStoreId = null;

    // Clear dataStores but keep existing ones that match our project
    const storesToKeep = new Map<string, DataStore>();
    S.dataStores.forEach(store => {
      if (store.file && existingStores.has(store.file.name)) {
        storesToKeep.set(store.file.name, store);
      } else if (store.isCivil) {
        storesToKeep.set(store.id, store);
      }
    });

    S.dataStores.clear();
    S.dataStoreOrder.length = 0;

    applyRestoredCollections(projectData);

    // Create or reuse data stores
    const dataStoreMap = new Map<string, string>();  // old ID -> new ID

    for (const dsData of projectData.dataSources) {
      if (dsData.isCivil) {
        dataStoreMap.set(dsData.id, dsData.id);
        const civilStore: DataStore = {
          id: dsData.id,
          name: dsData.name,
          file: null,
          asyncBuffer: null,
          geojson: { type: 'FeatureCollection', features: [] },
          numericFieldsFromSchema: [],
          categoricalFieldsFromSchema: [],
          chosenNumericFields: [...dsData.chosenNumericFields],
          chosenCategoricalFields: [...dsData.chosenCategoricalFields],
          landSizeField: dsData.landSizeField,
          landSizeUnitLabel: dsData.landSizeUnitLabel,
          bldgSizeField: dsData.bldgSizeField,
          bldgSizeUnitLabel: dsData.bldgSizeUnitLabel,
          salePriceField: dsData.salePriceField ?? null,
          saleDateField: dsData.saleDateField ?? null,
          validSaleField: dsData.validSaleField ?? null,
          vacantSaleField: dsData.vacantSaleField ?? null,
          parcelIdField: dsData.parcelIdField ?? null,
          addressField: dsData.addressField ?? null,
          bldgQualityField: dsData.bldgQualityField ?? null,
          bldgConditionField: dsData.bldgConditionField ?? null,
          bldgAgeField: dsData.bldgAgeField ?? null,
          bldgEffAgeField: dsData.bldgEffAgeField ?? null,
          bldgBedsField: dsData.bldgBedsField ?? null,
          bldgBathsField: dsData.bldgBathsField ?? null,
          bldgTypeField: dsData.bldgTypeField ?? null,
          landTypeField: dsData.landTypeField ?? null,
          landZoningField: dsData.landZoningField ?? null,
          saleIdField: dsData.saleIdField ?? null,
          fullMarketValueField: dsData.fullMarketValueField ?? null,
          assessedValueField: dsData.assessedValueField ?? null,
          landValueField: dsData.landValueField ?? null,
          improvementValueField: dsData.improvementValueField ?? null,
          isCivil: true,
          civilGateway: dsData.civilGateway,
          civilAuthIssuer: dsData.civilAuthIssuer,
          civilToken: dsData.civilToken,
          civilOIDCConfig: dsData.civilOIDCConfig,
          civilTileJson: dsData.civilTileJson,
          civilZoningMap: dsData.civilZoningMap,
          civilLandUseMap: dsData.civilLandUseMap,
          civilLandUseTypeMap: dsData.civilLandUseTypeMap
        };
        S.dataStores.set(dsData.id, civilStore);
        S.dataStoreOrder.push(dsData.id);
        continue;
      }

      const existingStore = existingStores.get(dsData.parquetFile);

      if (existingStore) {
        // Reuse existing loaded dataStore and apply saved configuration
        dataStoreMap.set(dsData.id, existingStore.id);

        // Update configuration from saved project
        existingStore.name = dsData.name;
        existingStore.chosenNumericFields = [...dsData.chosenNumericFields];
        existingStore.chosenCategoricalFields = [...dsData.chosenCategoricalFields];
        existingStore.landSizeField = dsData.landSizeField;
        existingStore.landSizeUnitLabel = dsData.landSizeUnitLabel;
        existingStore.bldgSizeField = dsData.bldgSizeField;
        existingStore.bldgSizeUnitLabel = dsData.bldgSizeUnitLabel;
        existingStore.salePriceField = dsData.salePriceField ?? null;
        existingStore.saleDateField = dsData.saleDateField ?? null;
        existingStore.validSaleField = dsData.validSaleField ?? null;
        existingStore.vacantSaleField = dsData.vacantSaleField ?? null;
        existingStore.parcelIdField = dsData.parcelIdField ?? null;
        existingStore.addressField = dsData.addressField ?? null;
        existingStore.bldgQualityField = dsData.bldgQualityField ?? null;
        existingStore.bldgConditionField = dsData.bldgConditionField ?? null;
        existingStore.bldgAgeField = dsData.bldgAgeField ?? null;
        existingStore.bldgEffAgeField = dsData.bldgEffAgeField ?? null;
        existingStore.bldgBedsField = dsData.bldgBedsField ?? null;
        existingStore.bldgBathsField = dsData.bldgBathsField ?? null;
        existingStore.bldgTypeField = dsData.bldgTypeField ?? null;
        existingStore.landTypeField = dsData.landTypeField ?? null;
        existingStore.landZoningField = dsData.landZoningField ?? null;
        existingStore.saleIdField = dsData.saleIdField ?? null;
        existingStore.fullMarketValueField = dsData.fullMarketValueField ?? null;
        existingStore.assessedValueField = dsData.assessedValueField ?? null;
        existingStore.landValueField = dsData.landValueField ?? null;
        existingStore.improvementValueField = dsData.improvementValueField ?? null;

        // Handle "all fields" mode
        if (dsData.allNumericFields) {
          existingStore.chosenNumericFields = [...existingStore.numericFieldsFromSchema];
        }
        if (dsData.allCategoricalFields) {
          existingStore.chosenCategoricalFields = [...existingStore.categoricalFieldsFromSchema];
        }

        S.dataStores.set(existingStore.id, existingStore);
        S.dataStoreOrder.push(existingStore.id);
      } else {
        // Create placeholder DataStore (will be populated when user loads parquet)
        const placeholderId = `datastore-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        dataStoreMap.set(dsData.id, placeholderId);

        // Store metadata for later use
        const placeholder: Partial<DataStore> = {
          id: placeholderId,
          name: dsData.name,
          file: null as any,  // Will be set when user loads parquet
          asyncBuffer: null as any,
          geojson: null,
          numericFieldsFromSchema: [],
          categoricalFieldsFromSchema: [],
          chosenNumericFields: [...dsData.chosenNumericFields],
          chosenCategoricalFields: [...dsData.chosenCategoricalFields],
          landSizeField: dsData.landSizeField,
          landSizeUnitLabel: dsData.landSizeUnitLabel,
          bldgSizeField: dsData.bldgSizeField,
          bldgSizeUnitLabel: dsData.bldgSizeUnitLabel,
          salePriceField: dsData.salePriceField ?? null,
          saleDateField: dsData.saleDateField ?? null,
          validSaleField: dsData.validSaleField ?? null,
          vacantSaleField: dsData.vacantSaleField ?? null,
          parcelIdField: dsData.parcelIdField ?? null,
          addressField: dsData.addressField ?? null,
          bldgQualityField: dsData.bldgQualityField ?? null,
          bldgConditionField: dsData.bldgConditionField ?? null,
          bldgAgeField: dsData.bldgAgeField ?? null,
          bldgEffAgeField: dsData.bldgEffAgeField ?? null,
          bldgBedsField: dsData.bldgBedsField ?? null,
          bldgBathsField: dsData.bldgBathsField ?? null,
          bldgTypeField: dsData.bldgTypeField ?? null,
          landTypeField: dsData.landTypeField ?? null,
          landZoningField: dsData.landZoningField ?? null,
          saleIdField: dsData.saleIdField ?? null,
          fullMarketValueField: dsData.fullMarketValueField ?? null,
          assessedValueField: dsData.assessedValueField ?? null,
          landValueField: dsData.landValueField ?? null,
          improvementValueField: dsData.improvementValueField ?? null,
        };

        // Store reference to expected parquet file
        (placeholder as any)._expectedParquetFile = dsData.parquetFile;
        (placeholder as any)._allNumericFields = dsData.allNumericFields;
        (placeholder as any)._allCategoricalFields = dsData.allCategoricalFields;

        S.dataStores.set(placeholderId, placeholder as DataStore);
        S.dataStoreOrder.push(placeholderId);
      }
    }

    // Restore layers
    let hasAnyGeojson = false;
    for (const layerData of projectData.layers) {
      const newDataStoreId = dataStoreMap.get(layerData.dataStoreId);
      if (!newDataStoreId) continue;

      const dataStore = S.dataStores.get(newDataStoreId);
      if (!dataStore) continue;

      // Increment layer counter to avoid ID collisions
      S.layerCounter += 1;
      const suffix = `layer-${S.layerCounter}`;

      const restoredLayer: LayerState = {
        ...deserializeLayer(layerData),
        id: suffix,
        dataStoreId: newDataStoreId,
        sourceId: `source-${suffix}`,
        layerId: `layer-${suffix}`,
        errorLayerId: `error-${suffix}`,
        geojson: dataStore.geojson,  // Use actual geojson if available
        stats: null     // Will be recalculated
      } as LayerState;

      // Copy field selections from dataStore
      restoredLayer.chosenNumericFields = [...dataStore.chosenNumericFields];
      restoredLayer.chosenCategoricalFields = [...dataStore.chosenCategoricalFields];
      restoredLayer.landSizeField = dataStore.landSizeField;
      restoredLayer.landSizeUnitLabel = dataStore.landSizeUnitLabel;
      restoredLayer.bldgSizeField = dataStore.bldgSizeField;
      restoredLayer.bldgSizeUnitLabel = dataStore.bldgSizeUnitLabel;

      // Register the layer
      registerLayer(restoredLayer);

      // If we have geojson, add it to the map
      if (dataStore.geojson) {
        hasAnyGeojson = true;
        addOrUpdateSource(dataStore.geojson);
        ensureErrorLayer(restoredLayer);
      }
    }

    // Apply layer state for the first layer and render
    if (S.layerOrder.length > 0) {
      const firstLayer = S.layers.get(S.layerOrder[0]);
      if (firstLayer) {
        S.currentLayerId = firstLayer.id;
        S.currentDataStoreId = firstLayer.dataStoreId;
        applyLayerState(firstLayer);

        // Apply visualization if we have data
        if (firstLayer.geojson) {
          if (firstLayer.field) {
            applyExtrusionWithVisibility();
          } else {
            applyGrayRendering();
          }
        }
      }
    }

    // Apply layer ordering to map
    applyLayerOrderToMap();

    // Update UI
    renderDataStoreList();
    renderLayerList();
    window.dispatchEvent(new CustomEvent('data-sources-changed'));
    prepullAllCivilStoresLookups();
    revealUI();

    // Notify user about status
    if (missingFiles.length > 0) {
      alert(`Project loaded successfully!\n\nMissing data sources:\n${
        missingFiles.map(f => `- ${f}`).join('\n')
      }\n\nPlease load the parquet files using "Browse for file…"`);
    } else if (hasAnyGeojson) {
      // All data loaded, everything restored
      console.log('Project loaded successfully with all data sources.');
    } else {
      alert(`Project loaded successfully!\n\nData sources needed:\n${
        projectData.dataSources.map((ds: SerializedDataSource) => `- ${ds.isCivil ? (ds.civilGateway || ds.name) : ds.parquetFile}`).join('\n')
      }\n\nPlease load the parquet files using "Browse for file…"`);
    }

  } catch (err: any) {
    console.error('Failed to load project:', err);
    alert(`Failed to load project file: ${err?.message || err}`);
  }
}

export function initMetadataModule() {
  // Export button
  const btnExportProject = document.getElementById('btnExportProject') as HTMLButtonElement;
  btnExportProject?.addEventListener('click', exportProject);

  // Import buttons and file input
  const projectFileInput = document.getElementById('projectFile') as HTMLInputElement;
  const btnLoadProject = document.getElementById('btnLoadProject') as HTMLButtonElement;
  const btnImportProject = document.getElementById('btnImportProject') as HTMLButtonElement;

  btnLoadProject?.addEventListener('click', () => projectFileInput.click());
  btnImportProject?.addEventListener('click', () => projectFileInput.click());

  projectFileInput?.addEventListener('change', async () => {
    const file = projectFileInput.files?.[0];
    if (!file) return;
    await loadProjectFile(file);
    projectFileInput.value = '';  // Allow re-loading same file
  });
}
