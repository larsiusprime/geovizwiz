import type { AsyncBuffer } from './utils.sanitize';

export type BasemapMode = 'streets' | 'satellite' | 'none';

export type FilterFieldType = 'numeric' | 'categorical';
export type FilterMode = 'none' | 'show' | 'hide';
export type FilterActionMode = 'none' | 'select' | 'show' | 'hide';
export type NumericFilterOperator = 'lt' | 'gt' | 'lte' | 'gte' | 'eq' | 'neq';
export type CategoricalFilterOperator = 'eq' | 'neq' | 'any' | 'not-any';
export type FilterOperator = NumericFilterOperator | CategoricalFilterOperator;

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
export type SubjectMode = 'all' | 'visible' | 'selected' | 'category' | 'filtered';
export type LandSchedulePerUnit = 'lot' | 'area' | 'frontage';

export type LandScheduleBaseLot = {
  min: number | null;
  max: number | null;
  value: number | null;
  per: LandSchedulePerUnit | null;
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
  filters: FilterRule[];
  filterMode: FilterMode;
  filterActionMode: FilterActionMode;
  filterInvert: boolean;
  parcelPatchMap: ParcelPatchMap;
};

export type DataStore = {
  id: string;
  name: string;
  file: File;
  asyncBuffer: AsyncBuffer;
  geojson: GeoJSON.FeatureCollection | null;
  numericFieldsFromSchema: string[];
  categoricalFieldsFromSchema: string[];
  chosenNumericFields: string[];
  chosenCategoricalFields: string[];
  landSizeField: string | null;
  landSizeUnitLabel: string | null;
  bldgSizeField: string | null;
  bldgSizeUnitLabel: string | null;
};

export type SubjectSelectorControls = {
  buttons: HTMLButtonElement[];
  categoryControls: HTMLDivElement;
  categoryFieldSelect: HTMLSelectElement;
  categoryValueSelect: HTMLSelectElement;
  filterControls: HTMLDivElement;
  filterSelect: HTMLSelectElement;
  filterEmptyState: HTMLDivElement;
};

export type SubjectSelectorOptions = {
  title?: string | null;
};

// Project file serialization types
export type SerializedDataSource = {
  id: string;
  name: string;
  parquetFile: string;
  chosenNumericFields: string[];
  chosenCategoricalFields: string[];
  allNumericFields: boolean;
  allCategoricalFields: boolean;
  landSizeField: string | null;
  landSizeUnitLabel: string | null;
  bldgSizeField: string | null;
  bldgSizeUnitLabel: string | null;
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
};
