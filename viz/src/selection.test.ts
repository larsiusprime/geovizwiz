import { vi } from 'vitest';

// 1. Mock UI-coupled modules before importing selection logic
vi.mock('./dom-refs.js', () => ({
  fileInput: null,
  fieldSelect: null,
  rampSelect: null,
  opacityInput: null,
  outlineOpacityInput: null,
  extrusionToggle: null,
  extrusionHeightInput: null,
  extrusionMinHeightInput: null,
  extrusionMultiplierInput: null,
  extrusionBaseMultiplierInput: null,
  extrusionHeightSelect: null,
  extrusionMinHeightSelect: null,
  btnSaveLayerStyle: null,
  btnLoadLayerStyle: null,
  layerStyleStatus: null,
  statsSubjectSelect: null,
  statsResultTextarea: null,
  scatterplotCard: null,
  scatterSubjectSelect: null,
  scatterXSelect: null,
  scatterYSelect: null,
  legendCard: null,
  legendTitle: null,
  legendColors: null,
  legendLabels: null,
  btnOpenFilterPanel: null,
  btnOpenLegendFilterPanel: null,
  filterCard: null,
  filterList: null,
  filterActiveCount: null,
  btnAddFilter: null,
  legendFilterCard: null,
  legendFilterList: null,
  legendFilterActiveCount: null,
  btnAddLegendFilter: null,
  btnOpenSelectionFilterPanel: null,
  selectionFilterCard: null,
  selectionFilterList: null,
  selectionFilterActiveCount: null,
  btnAddSelectionFilter: null,
  layerDropdown: null,
  dataStoreDropdown: null,
  btnDeleteLayer: null,
  btnDeleteDataStore: null,
  layerList: null,
  btnNewParquetLayer: null,
  btnOpenNewLayerOverlay: null,
  newLayerOverlay: null,
  newLayerNameInput: null,
  btnConfirmCreateLayer: null,
  btnCancelCreateLayer: null,
  btnSelectAllParquets: null,
  btnNewCivilOSDataSource: null,
  civilSetupOverlay: null,
  civilDomainInput: null,
  civilSetupError: null,
  btnCancelCivilSetup: null,
  btnConfirmCivilSetup: null
}));

vi.stubGlobal('document', {
  getElementById: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  createElement: vi.fn().mockReturnValue({
    style: {},
    appendChild: vi.fn(),
    querySelector: vi.fn().mockReturnValue({
      style: {},
      addEventListener: vi.fn(),
      querySelector: vi.fn().mockReturnValue({
        style: {},
        addEventListener: vi.fn(),
        insertBefore: vi.fn()
      }),
      appendChild: vi.fn(),
      insertBefore: vi.fn()
    }),
    replaceChildren: vi.fn(),
    insertBefore: vi.fn()
  }),
  body: {
    appendChild: vi.fn()
  }
});

vi.stubGlobal('window', {
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
});

// 2. Mock state and other UI dependencies
vi.mock('./state.js', () => ({
  S: {
    currentLayerId: null,
    layers: new Map(),
    dataStores: new Map(),
    selectedParcels: new Set(),
    map: {
      setFeatureState: vi.fn(),
    },
  },
}));

vi.mock('./windows.js', () => ({
  makeDraggable: vi.fn(),
  ensureFloatingWindowVisible: vi.fn(),
}));

vi.mock('./save-load-widget.js', () => ({
  createSaveLoadWidget: vi.fn().mockReturnValue({
    element: {
      querySelector: vi.fn().mockReturnValue({
        insertBefore: vi.fn()
      })
    },
    update: vi.fn()
  }),
}));

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCivilSelectionIds } from './selection';
import { S } from './state';
import type { DataStore } from './types';

describe('resolveCivilSelectionIds', () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    S.currentLayerId = 'layer1';
    S.selectedParcels.clear();
    S.layers.clear();
    S.dataStores.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing if no active datastore or not civil', async () => {
    await resolveCivilSelectionIds([123]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls GetParcelIdsByFeatureId and maps results', async () => {
    const mockStore: DataStore = {
      id: 'store1',
      name: 'Civil OS Store',
      isCivil: true,
      civilGateway: 'https://gateway.civil.app',
      civilToken: 'token123',
      civilFeatureToParcelIdMap: new Map(),
    } as any;

    S.layers.set('layer1', { id: 'layer1', dataStoreId: 'store1', layerId: 'layer1-layer', sourceId: 'source1' } as any);
    S.dataStores.set('store1', mockStore);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        parcelIds: {
          '123': 'parcel-uuid-123',
          '456': 'parcel-uuid-456',
        },
      }),
    });

    await resolveCivilSelectionIds([123, 456]);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://gateway.civil.app/civil.public.parcels.v1.ParcelsService/GetParcelIdsByFeatureId',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token123',
        },
      })
    );

    expect(mockStore.civilFeatureToParcelIdMap?.get(123)).toBe('parcel-uuid-123');
    expect(mockStore.civilFeatureToParcelIdMap?.get(456)).toBe('parcel-uuid-456');
  });
});
