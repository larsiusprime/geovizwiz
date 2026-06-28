import type { AsyncBuffer } from './utils.sanitize';

export type BasemapMode = 'streets' | 'satellite' | 'none';

export type FilterFieldType = 'numeric' | 'categorical' | 'reference';
export type FilterMode = 'none' | 'show' | 'hide';
export type FilterActionMode = 'none' | 'select' | 'show' | 'hide';
export type NumericFilterOperator = 'lt' | 'gt' | 'lte' | 'gte' | 'eq' | 'neq';
export type CategoricalFilterOperator = 'eq' | 'neq' | 'any' | 'not-any';
export type ReferenceFilterOperator = 'ref-true' | 'ref-false';
export type FilterOperator = NumericFilterOperator | CategoricalFilterOperator | ReferenceFilterOperator;

export type FilterRule = {
  id: string;
  field: string | null;
  fieldType: FilterFieldType | null;
  operator: FilterOperator | null;
  value: number | string | string[] | null;
  active: boolean;
};

export type SavedFilterEntry = {
  name: string;
  filters: FilterRule[];
  filterInvert: boolean;
};

export type SavedSelectionEntry = {
  name: string;
  /** Which field names were used to build the compound keys */
  keyFields: string[];
  /** One compound key per selected parcel */
  parcelKeys: Array<Record<string, string>>;
  /** Originating data source name (for status messages on load) */
  sourceName: string | null;
};

export type ParcelFieldPatch = {
  original: any;
  current: any;
};

export type ParcelPatchMap = Map<string, Map<string, ParcelFieldPatch>>;

export type ColorMode = 'continuous' | 'quantiles';
export type CategoricalColorMode = 'random' | 'single' | 'colorRamp';
export type QualityMode = 'fast' | 'high';
export type UpdateMode = 'applyOnly' | 'recomputeAndAutoScale';
export type MetricUnitKey = 'centimeters' | 'meters' | 'kilometers';
export type SubjectMode = 'all' | 'visible' | 'selected' | 'group';
export type LandSchedulePerUnit = 'lot' | 'area' | 'frontage';

export type LandScheduleBaseLot = {
  min: number | null;
  max: number | null;
  value: number | null;
  per: LandSchedulePerUnit | null;
};

export type LandScheduleUnit = 'sqft' | 'acre' | 'ft' | 'sqm' | 'hectare' | 'm';

export type LandScheduleValueMode = 'flat' | 'per-unit' | 'per-unit-marginal';

export type LandScheduleRow = {
  min: number | null;
  max: number | null;
  value: number | null;
};

export type LandScheduleAdjustmentOperation = 'multiply' | 'add';

export type LandScheduleAdjustmentSizeUnit = 'per-improved-area' | 'per-land-area' | 'per-frontage' | 'per-pick-field' | 'flat';

export type LandScheduleAdjustment = {
  id: string;
  name: string;
  operation: LandScheduleAdjustmentOperation;
  sizeUnit: LandScheduleAdjustmentSizeUnit;
  sizeUnitDetail: string | null;
  value: number | null;
  filters: FilterRule[];
  filterInvert: boolean;
};

export type LandScheduleTable = {
  id: string;
  name: string;
  unit: LandScheduleUnit;
  valueMode: LandScheduleValueMode;
  rows: LandScheduleRow[];
  filters: FilterRule[];
  filterInvert: boolean;
};

export type LandScheduleEntry = {
  tables: LandScheduleTable[];
  activeTableId: string | null;
  adjustments: LandScheduleAdjustment[];
};

export type TimeAdjustmentGranularity = 'year' | 'peak' | 'quarter' | 'month';
export type TimeAdjustmentMethod = 'median' | 'mean' | 'regression';
export type TimeAdjustmentDisplayMode = 'improved' | 'vacant';

// The live time-adjustment config for the currently-selected data source.
// (Time adjustment is compute-and-export only; there are no saved/named entries.)
export type TimeAdjustmentEntry = {
  startDate: string | null;
  valuationDate: string | null;
  dateField: string;
  displayMode: TimeAdjustmentDisplayMode;
  groupByField: string | null;
  granularity: TimeAdjustmentGranularity;
  method: TimeAdjustmentMethod;
  minSample: number;
  outlierPriceLow: number | null;
  outlierPriceHigh: number | null;
  outlierSizeLow: number | null;
  outlierSizeHigh: number | null;
  outlierRatioLow: number | null;
  outlierRatioHigh: number | null;
  includeFilters: FilterRule[];
  includeFilterInvert: boolean;
  excludeFilters: FilterRule[];
  excludeFilterInvert: boolean;
  trendVisible: boolean;
};

export type TimeAdjustmentSettings = {
  dataSourceId: string;
  salePriceField: string;
  saleDateField: string;
  validSaleField: string;
  vacantSaleField: string;
  improvedFilters: FilterRule[];
  improvedFilterInvert: boolean;
  improvedSizeField: string;
  vacantFilters: FilterRule[];
  vacantFilterInvert: boolean;
  landSizeField: string;
};

export type LayerState = {
  id: string;
  name: string;
  dataStoreId: string;
  sourceId: string;
  layerId: string;
  errorLayerId: string;
  visible: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  field: string | null;
  fieldType: 'numeric' | 'categorical' | null;
  stats: { min: number; max: number } | null;
  normalizationMode: 'asis' | 'perLand' | 'perBuilding';
  colorMode: ColorMode;
  categoricalColorMode: CategoricalColorMode;
  singleColorValue: string;
  ramp: string;
  colorDomain: { lo: number; hi: number; label: string } | null;
  colorBreaks: number[] | null;
  cachedExtrusionSettings: { multiplier: number; unit: string } | null;
  chosenNumericFields: string[];
  chosenCategoricalFields: string[];
  landSizeField: string | null;
  landSizeUnitLabel: string | null;
  bldgSizeField: string | null;
  bldgSizeUnitLabel: string | null;
  hiddenLegendItems: Set<string>;
  selectedLegendItems: Set<string>;
  selectedParcels: Set<string>;
  highlightColor: string;
  legendSortField: 'name' | 'count' | null;
  legendSortDirection: 'asc' | 'desc';
  customColors: Map<string, string>;
  opacity: number;
  is3DMode: boolean;
  hexMode: boolean;
  hexResolution: number;
  filters: FilterRule[];
  filterMode: FilterMode;
  filterActionMode: FilterActionMode;
  filterInvert: boolean;
  parcelPatchMap: ParcelPatchMap;
};

export type DataStore = {
  id: string;
  name: string;
  file: File | null;
  asyncBuffer: AsyncBuffer | null;
  isCivil?: boolean;
  civilGateway?: string;
  civilAuthIssuer?: string;
  civilToken?: string;
  civilOIDCConfig?: any;
  civilTileJson?: any;
  civilZoningMap?: Record<string, any>;
  civilLandUseMap?: Record<string, any>;
  civilLandUseTypeMap?: Record<string, any>;
  civilFeatureToParcelIdMap?: Map<number, string>;
  geojson: GeoJSON.FeatureCollection | null;
  numericFieldsFromSchema: string[];
  categoricalFieldsFromSchema: string[];
  chosenNumericFields: string[];
  chosenCategoricalFields: string[];
  landSizeField: string | null;
  landSizeUnitLabel: string | null;
  bldgSizeField: string | null;
  bldgSizeUnitLabel: string | null;
  salePriceField: string | null;
  saleDateField: string | null;
  validSaleField: string | null;
  vacantSaleField: string | null;
  parcelIdField: string | null;
  addressField: string | null;
  bldgQualityField: string | null;
  bldgConditionField: string | null;
  bldgAgeField: string | null;
  bldgEffAgeField: string | null;
  bldgBedsField: string | null;
  bldgBathsField: string | null;
  bldgTypeField: string | null;
  landTypeField: string | null;
  landZoningField: string | null;
  saleIdField: string | null;
  fullMarketValueField: string | null;
  assessedValueField: string | null;
  landValueField: string | null;
  improvementValueField: string | null;
};

export type SubjectSelectorControls = {
  buttons: HTMLButtonElement[];
  categoryControls: HTMLDivElement;
  categoryFieldSelect: HTMLSelectElement;
  categoryValueSelect: HTMLSelectElement;
  selectOnMapButton: HTMLButtonElement;
};

export type SubjectSelectorOptions = {
  title?: string | null;
};

// Project file serialization types
export type SerializedDataSource = {
  id: string;
  name: string;
  parquetFile: string;
  isCivil?: boolean;
  civilGateway?: string;
  civilAuthIssuer?: string;
  civilToken?: string;
  civilOIDCConfig?: any;
  civilTileJson?: any;
  civilZoningMap?: Record<string, any>;
  civilLandUseMap?: Record<string, any>;
  civilLandUseTypeMap?: Record<string, any>;
  chosenNumericFields: string[];
  chosenCategoricalFields: string[];
  allNumericFields: boolean;
  allCategoricalFields: boolean;
  landSizeField: string | null;
  landSizeUnitLabel: string | null;
  bldgSizeField: string | null;
  bldgSizeUnitLabel: string | null;
  salePriceField?: string | null;
  saleDateField?: string | null;
  validSaleField?: string | null;
  vacantSaleField?: string | null;
  parcelIdField?: string | null;
  addressField?: string | null;
  bldgQualityField?: string | null;
  bldgConditionField?: string | null;
  bldgAgeField?: string | null;
  bldgEffAgeField?: string | null;
  bldgBedsField?: string | null;
  bldgBathsField?: string | null;
  bldgTypeField?: string | null;
  landTypeField?: string | null;
  landZoningField?: string | null;
  saleIdField?: string | null;
  fullMarketValueField?: string | null;
  assessedValueField?: string | null;
  landValueField?: string | null;
  improvementValueField?: string | null;
};

export type SerializedLayer = {
  id: string;
  name: string;
  dataStoreId: string;
  visible: boolean;
  field: string | null;
  fieldType: 'numeric' | 'categorical' | null;
  normalizationMode: 'asis' | 'perLand' | 'perBuilding';
  colorMode: ColorMode;
  categoricalColorMode: CategoricalColorMode;
  singleColorValue: string;
  ramp: string;
  colorDomain: { lo: number; hi: number; label: string } | null;
  colorBreaks: number[] | null;
  opacity: number;
  is3DMode: boolean;
  cachedExtrusionSettings: { multiplier: number; unit: string } | null;
  highlightColor: string;
  legendSortField: 'name' | 'count' | null;
  legendSortDirection: 'asc' | 'desc';
  hiddenLegendItems: string[];
  customColors: Record<string, string>;
  filters: FilterRule[];
  filterMode: FilterMode;
  filterActionMode: FilterActionMode;
  filterInvert: boolean;
};

export type ProjectFileV1 = {
  version: '1.0';
  created: string;
  projectName?: string;
  dataSources: SerializedDataSource[];
  layers: SerializedLayer[];
  savedFilters: SavedFilterEntry[];
  savedSelections?: SavedSelectionEntry[];
  landSchedule?: SerializedLandSchedule;
  landSchedules?: SerializedLandScheduleEntry[];
};

export type SerializedLandSchedule = {
  tables: SerializedLandScheduleTable[];
  activeTableId: string | null;
  adjustments: SerializedLandScheduleAdjustment[];
};

export type SerializedLandScheduleTable = {
  id: string;
  name: string;
  unit: LandScheduleUnit;
  valueMode: LandScheduleValueMode;
  rows: LandScheduleRow[];
  filters: FilterRule[];
  filterInvert: boolean;
};

export type SerializedLandScheduleAdjustment = {
  id: string;
  name: string;
  operation: LandScheduleAdjustmentOperation;
  sizeUnit: LandScheduleAdjustmentSizeUnit;
  sizeUnitDetail?: string | null;
  value: number | null;
  filters: FilterRule[];
  filterInvert: boolean;
};

export type SerializedLandScheduleEntry = {
  field: string;
  valueKey: string;
  tables: SerializedLandScheduleTable[];
  activeTableId: string | null;
  adjustments: SerializedLandScheduleAdjustment[];
};
