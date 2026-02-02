// metadata.ts - Project save/load functionality

import { S } from './state.js';
import type { DataStore, LayerState, SavedFilterEntry, ProjectFileV1, SerializedDataSource, SerializedLayer } from './types.js';
import { persistCurrentLayerState, renderDataStoreList, renderLayerList, registerLayer, applyLayerState, applyLayerOrderToMap } from './layers.js';
import { revealUI } from './main.js';
import { addOrUpdateSource, applyGrayRendering, ensureErrorLayer } from './rendering.js';
import { applyExtrusionWithVisibility } from './legend.js';

function serializeDataSource(store: DataStore): SerializedDataSource {
  return {
    id: store.id,
    name: store.name,
    parquetFile: store.file.name,
    chosenNumericFields: [...store.chosenNumericFields],
    chosenCategoricalFields: [...store.chosenCategoricalFields],
    allNumericFields: store.chosenNumericFields.length === store.numericFieldsFromSchema.length,
    allCategoricalFields: store.chosenCategoricalFields.length === store.categoricalFieldsFromSchema.length,
    landSizeField: store.landSizeField,
    landSizeUnitLabel: store.landSizeUnitLabel,
    bldgSizeField: store.bldgSizeField,
    bldgSizeUnitLabel: store.bldgSizeUnitLabel
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
    filterInvert: layer.filterInvert
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

export function exportProject() {
  // Persist current layer state before export
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

  const projectFile: ProjectFileV1 = {
    version: '1.0',
    created: new Date().toISOString(),
    projectName: dataSources[0]?.name || 'Untitled Project',
    dataSources,
    layers: serializedLayers,
    savedFilters: serializeSavedFilters()
  };

  const json = JSON.stringify(projectFile, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const filename = `${projectFile.projectName.replace(/[^a-z0-9]/gi, '_')}.geovizwiz.json`;

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
  return true;
}

function deserializeLayer(serialized: SerializedLayer): Partial<LayerState> {
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
    parcelPatchMap: new Map()    // Runtime state (future: deserialize if present)
  };
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
    expectedFiles.forEach((ds, filename) => {
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
    S.currentLayerId = null;
    S.currentDataStoreId = null;

    // Clear dataStores but keep existing ones that match our project
    const storesToKeep = new Map<string, DataStore>();
    S.dataStores.forEach(store => {
      if (store.file && existingStores.has(store.file.name)) {
        storesToKeep.set(store.file.name, store);
      }
    });

    S.dataStores.clear();
    S.dataStoreOrder.length = 0;

    // Restore saved filters
    projectData.savedFilters.forEach((entry: SavedFilterEntry) => {
      S.savedFiltersStore.set(entry.name, {
        name: entry.name,
        filters: entry.filters.map(f => ({...f})),
        filterInvert: entry.filterInvert
      });
    });

    // Create or reuse data stores
    const dataStoreMap = new Map<string, string>();  // old ID -> new ID

    for (const dsData of projectData.dataSources) {
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
          bldgSizeUnitLabel: dsData.bldgSizeUnitLabel
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
        projectData.dataSources.map((ds: SerializedDataSource) => `- ${ds.parquetFile}`).join('\n')
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
