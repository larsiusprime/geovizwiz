/**
 * Shared mutable application state.
 * All modules import `S` to read/write state.
 * Scalar properties must be accessed as `S.xxx` (not destructured for writes).
 * Reference types (Map, Set) can be mutated via their methods.
 */
import maplibregl from 'maplibre-gl';
import type {
  LayerState, DataStore, FilterRule, SavedFilterEntry,
  ParcelPatchMap, ColorMode, CategoricalColorMode, QualityMode,
  UpdateMode, SubjectMode, FilterMode, FilterActionMode,
  LandScheduleEntry, NumericFilterOperator, CategoricalFilterOperator, ReferenceFilterOperator,
  TimeAdjustmentEntry, TimeAdjustmentSettings
} from './types';
import type { AsyncBuffer } from './utils.sanitize';

export const S = {
  // --- Map ---
  map: null! as maplibregl.Map,
  currentBasemap: 'streets' as 'streets' | 'satellite' | 'none',
  lastBasemapMode: 'streets' as 'streets' | 'satellite',

  // --- Layers & Data ---
  layers: new Map<string, LayerState>(),
  layerOrder: [] as string[],
  currentLayerId: null as string | null,
  layerCounter: 0,
  dataStores: new Map<string, DataStore>(),
  dataStoreOrder: [] as string[],
  currentDataStoreId: null as string | null,

  // --- Current layer state ---
  currentGeoJSON: null as GeoJSON.FeatureCollection | null,
  currentField: null as string | null,
  currentFieldType: null as 'numeric' | 'categorical' | null,
  currentStats: null as { min: number; max: number } | null,
  parcelPatchMap: new Map() as ParcelPatchMap,

  // --- Visualization ---
  normalizationMode: 'asis' as 'asis' | 'perLand' | 'perBuilding',
  colorMode: 'quantiles' as ColorMode,
  categoricalColorMode: 'random' as CategoricalColorMode,
  singleColorValue: '#3b82f6',
  colorDomain: null as { lo: number; hi: number; label: string } | null,
  colorBreaks: null as number[] | null,
  is3DMode: false,
  cachedExtrusionSettings: null as { multiplier: number; unit: string } | null,

  // --- Staged loading ---
  lastFile: null as File | null,
  lastAsyncBuffer: null as AsyncBuffer | null,
  lastNumericFieldsFromSchema: [] as string[],
  lastCategoricalFieldsFromSchema: [] as string[],
  chosenNumericFields: [] as string[],
  chosenCategoricalFields: [] as string[],
  cancelRequested: false,

  // --- Size identification ---
  landSizeField: null as string | null,
  landSizeUnitLabel: null as string | null,
  bldgSizeField: null as string | null,
  bldgSizeUnitLabel: null as string | null,
  parcelIdField: null as string | null,
  addressField: null as string | null,
  bldgQualityField: null as string | null,
  bldgConditionField: null as string | null,
  bldgAgeField: null as string | null,
  bldgEffAgeField: null as string | null,
  bldgBedsField: null as string | null,
  bldgBathsField: null as string | null,
  bldgTypeField: null as string | null,
  landTypeField: null as string | null,
  landZoningField: null as string | null,
  saleIdField: null as string | null,
  fullMarketValueField: null as string | null,
  assessedValueField: null as string | null,
  landValueField: null as string | null,
  improvementValueField: null as string | null,

  // --- UI overlays ---
  welcomeEl: null as HTMLDivElement | null,
  renderToastEl: null as HTMLDivElement | null,
  dotsTimer: null as number | null,
  qualityMode: 'fast' as QualityMode,

  // --- Popup ---
  activePopup: null as maplibregl.Popup | null,
  lastPicked: null as { props: Record<string, any>; lngLat: maplibregl.LngLatLike; parcelId: string } | null,
  inspectFocusMarker: null as maplibregl.Marker | null,

  // --- Update scheduling ---
  _updTimer: null as number | null,
  _pendingMode: 'applyOnly' as UpdateMode,
  _pendingRefreshLegend: false,

  // --- Window state ---
  isLayersMinimized: false,
  isSettingsMenuMinimized: false,
  isSettingsDataSourcesCollapsed: false,
  isPaintCollapsed: false,
  isLegendVisible: true,
  isLegendMinimized: false,
  isStatisticsMinimized: true,
  isScatterplotMinimized: true,
  isFiltersMinimized: true,
  isLandScheduleMinimized: true,
  isLandScheduleTablesCollapsed: false,
  isLandScheduleCurveCollapsed: false,
  isLandScheduleAdjustmentsCollapsed: false,
  isTimeAdjustmentMinimized: true,
  isTimeAdjustmentTrendCollapsed: false,
  isTimeAdjustmentFiltersCollapsed: true,
  isCompFinderMinimized: true,
  isInspectMinimized: true,
  isCompFinderSubjectCollapsed: false,
  isCompFinderCriteriaCollapsed: false,
  isCompFinderCompsCollapsed: false,
  hiddenLegendItems: new Set<string>(),

  // --- Statistics ---
  statsSubjectMode: 'all' as SubjectMode,
  statsCategoryValueMap: [] as Array<{ label: string; value: unknown }>,
  statsCategoryField: null as string | null,
  statsCategoryValueIndices: [] as string[],
  statsField: null as string | null,
  statsFieldType: null as 'numeric' | 'categorical' | null,
  statsNormalizationMode: 'asis' as 'asis' | 'perLand' | 'perBuilding',
  statsValuesCache: [] as number[],
  statsOverflowPct: { min: 5, max: 95 },
  statsLayerId: null as string | null,
  statsFilteredName: null as string | null,

  // --- Scatterplot ---
  scatterSubjectMode: 'all' as SubjectMode,
  scatterCategoryValueMap: [] as Array<{ label: string; value: unknown }>,
  scatterCategoryField: null as string | null,
  scatterCategoryValueIndices: [] as string[],
  scatterXField: null as string | null,
  scatterYField: null as string | null,
  scatterRangeIsCustom: false,
  scatterDefaultRange: { xMin: null as number | null, xMax: null as number | null, yMin: null as number | null, yMax: null as number | null },
  isUpdatingScatterRangeInputs: false,
  scatterLayerId: null as string | null,
  scatterPlotRefreshTimer: null as number | null,
  scatterFilteredName: null as string | null,
  scatterColorByField: null as string | null,
  scatterSelectedParcelIds: new Set<string>(),
  scatterHoveredParcelId: null as string | null,

  // --- Land schedule ---
  landScheduleStore: {
    tables: [],
    activeTableId: null,
    adjustments: [],
  } as LandScheduleEntry,
  isUpdatingLandScheduleUI: false,

  // --- Time adjustment ---
  timeAdjustmentEntries: [] as TimeAdjustmentEntry[],
  currentTimeAdjustmentEntryId: null as string | null,
  timeAdjustmentSettings: {
    dataSourceId: '',
    salePriceField: '',
    saleDateField: '',
    validSaleField: '',
    vacantSaleField: '',
    improvedFilters: [],
    improvedFilterInvert: false,
    improvedSizeField: '',
    vacantFilters: [],
    vacantFilterInvert: false,
    landSizeField: '',
  } as TimeAdjustmentSettings,

  // --- Selection ---
  selectedLegendItems: new Set<string>(),
  selectedParcels: new Set<string>(),
  highlightColor: '#FFFF00',
  selectionControlsPanel: null as HTMLDivElement | null,

  // --- Legend sorting ---
  legendSortField: 'count' as 'name' | 'count' | null,
  legendSortDirection: 'desc' as 'asc' | 'desc',

  // --- Custom colors ---
  customColors: new Map<string, string>(),

  // --- Drag ---
  isDragging: false,
  dragTarget: null as HTMLElement | null,
  dragOffset: { x: 0, y: 0 },

  // --- Filters ---
  filters: [] as FilterRule[],
  filterMode: 'none' as FilterMode,
  filterActionMode: 'none' as FilterActionMode,
  filterInvert: false,
  savedFiltersStore: new Map<string, SavedFilterEntry>(),
  savedFiltersPanelMode: 'none' as 'none' | 'save' | 'load',
  savedFilterMatchName: null as string | null,

  // --- Tool state ---
  isInfoToolActive: false,
  isPanToolActive: false,
  isCompFinderToolActive: false,
  isPanning: false,
  currentSelectionMode: 'select-one' as string,

  // --- Rectangle selection ---
  isRectangleSelecting: false,
  isRectangleUnselecting: false,
  rectangleStartPoint: null as maplibregl.Point | null,
  rectangleElement: null as HTMLDivElement | null,
  originalDragPan: undefined as boolean | undefined,
};

// --- Constants (not mutable but shared) ---

export const NUMERIC_FILTER_OPERATORS: Array<{ value: NumericFilterOperator; label: string }> = [
  { value: 'lt', label: '<' },
  { value: 'gt', label: '>' },
  { value: 'lte', label: '<=' },
  { value: 'gte', label: '>=' },
  { value: 'eq', label: '=' },
  { value: 'neq', label: 'not =' }
];

export const CATEGORICAL_FILTER_OPERATORS: Array<{ value: CategoricalFilterOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: 'not =' },
  { value: 'any', label: 'any of...' },
  { value: 'not-any', label: 'not any of...' }
];

export const REFERENCE_FILTER_OPERATORS: Array<{ value: ReferenceFilterOperator; label: string }> = [
  { value: 'ref-true', label: 'TRUE' },
  { value: 'ref-false', label: 'FALSE' }
];
