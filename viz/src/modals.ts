/**
 * Modal dialog logic extracted from main.ts.
 *
 * Handles:
 *  - Numeric field chooser modal
 *  - Categorical field chooser modal
 *  - Size identification modal
 *  - Add layer modal
 *  - Auto-pick heuristics for field selection
 */

import { S } from './state';
import { makeFieldCheckbox, divider } from './utils.dom';
import type { LayerState, DataStore } from './types';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const UNIT_TOKENS = new Set([
  'sqft','ft2','sf','sqm','m2','km2','sqkm','mi2','sqmi',
  'ac','acre','acres','ha','hectare','hectares','acreage'
]);

const AREA_UNIT_CHOICES: { key: string, label: string }[] = [
  { key: 'sqm', label: 'square meters (m\u00B2)' },
  { key: 'sqft', label: 'square feet (ft\u00B2)' },
  { key: 'acres', label: 'acres' },
  { key: 'hectares', label: 'hectares' },
  { key: 'sqkm', label: 'square kilometers (km\u00B2)' },
  { key: 'sqmi', label: 'square miles (mi\u00B2)' },
  { key: 'other', label: 'other / unknown' }
];

/* ------------------------------------------------------------------ */
/*  DOM element references (set once via initModalElements)            */
/* ------------------------------------------------------------------ */

// Overlays
let numericModalOverlay: HTMLElement;
let categoricalModalOverlay: HTMLElement;
let sizeOverlay: HTMLElement;
let addLayerOverlay: HTMLDivElement;

// Numeric modal
let rowCountEl: HTMLElement;
let geomColEl: HTMLElement;
let numericFieldListEl: HTMLElement;
let btnAllNumeric: HTMLButtonElement;
let btnNoneNumeric: HTMLButtonElement;
let btnCancelNumericModal: HTMLButtonElement;
let btnConfirmNumericModal: HTMLButtonElement;

// Categorical modal
let categoricalRowCountEl: HTMLElement;
let categoricalGeomColEl: HTMLElement;
let categoricalFieldListEl: HTMLElement;
let btnAllCategorical: HTMLButtonElement;
let btnNoneCategorical: HTMLButtonElement;
let btnCancelCategoricalModal: HTMLButtonElement;
let btnConfirmCategoricalModal: HTMLButtonElement;

// Size modal
let bldgFieldSel: HTMLSelectElement;
let bldgUnitSel: HTMLSelectElement;
let landFieldSel: HTMLSelectElement;
let landUnitSel: HTMLSelectElement;
let salePriceFieldSel: HTMLSelectElement;
let saleDateFieldSel: HTMLSelectElement;
let validSaleFieldSel: HTMLSelectElement;
let vacantSaleFieldSel: HTMLSelectElement;
let parcelIdFieldSel: HTMLSelectElement;
let addressFieldSel: HTMLSelectElement;
let bldgQualityFieldSel: HTMLSelectElement;
let bldgConditionFieldSel: HTMLSelectElement;
let bldgAgeFieldSel: HTMLSelectElement;
let bldgEffAgeFieldSel: HTMLSelectElement;
let bldgBedsFieldSel: HTMLSelectElement;
let bldgBathsFieldSel: HTMLSelectElement;
let bldgTypeFieldSel: HTMLSelectElement;
let landTypeFieldSel: HTMLSelectElement;
let landZoningFieldSel: HTMLSelectElement;
let saleIdFieldSel: HTMLSelectElement;
let fullMarketValueFieldSel: HTMLSelectElement;
let assessedValueFieldSel: HTMLSelectElement;
let landValueFieldSel: HTMLSelectElement;
let improvementValueFieldSel: HTMLSelectElement;
let btnSizeBack: HTMLButtonElement;
let btnSizeSkip: HTMLButtonElement;
let btnSizeOk: HTMLButtonElement;

// Normalization elements (paint panel)
let normLand: HTMLInputElement;
let normBldg: HTMLInputElement;
let normLandUnitEl: HTMLElement;
let normBldgUnitEl: HTMLElement;

// Normalization elements (stats panel)
let statsNormAsIs: HTMLInputElement;
let statsNormLand: HTMLInputElement;
let statsNormBldg: HTMLInputElement;
let statsNormLandUnitEl: HTMLElement;
let statsNormBldgUnitEl: HTMLElement;

export function initModalElements(els: {
  numericModalOverlay: HTMLElement;
  categoricalModalOverlay: HTMLElement;
  sizeOverlay: HTMLElement;
  addLayerOverlay: HTMLDivElement;
  rowCountEl: HTMLElement;
  geomColEl: HTMLElement;
  numericFieldListEl: HTMLElement;
  btnAllNumeric: HTMLButtonElement;
  btnNoneNumeric: HTMLButtonElement;
  btnCancelNumericModal: HTMLButtonElement;
  btnConfirmNumericModal: HTMLButtonElement;
  categoricalRowCountEl: HTMLElement;
  categoricalGeomColEl: HTMLElement;
  categoricalFieldListEl: HTMLElement;
  btnAllCategorical: HTMLButtonElement;
  btnNoneCategorical: HTMLButtonElement;
  btnCancelCategoricalModal: HTMLButtonElement;
  btnConfirmCategoricalModal: HTMLButtonElement;
  bldgFieldSel: HTMLSelectElement;
  bldgUnitSel: HTMLSelectElement;
  landFieldSel: HTMLSelectElement;
  landUnitSel: HTMLSelectElement;
  salePriceFieldSel: HTMLSelectElement;
  saleDateFieldSel: HTMLSelectElement;
  validSaleFieldSel: HTMLSelectElement;
  vacantSaleFieldSel: HTMLSelectElement;
  parcelIdFieldSel: HTMLSelectElement;
  addressFieldSel: HTMLSelectElement;
  bldgQualityFieldSel: HTMLSelectElement;
  bldgConditionFieldSel: HTMLSelectElement;
  bldgAgeFieldSel: HTMLSelectElement;
  bldgEffAgeFieldSel: HTMLSelectElement;
  bldgBedsFieldSel: HTMLSelectElement;
  bldgBathsFieldSel: HTMLSelectElement;
  bldgTypeFieldSel: HTMLSelectElement;
  landTypeFieldSel: HTMLSelectElement;
  landZoningFieldSel: HTMLSelectElement;
  saleIdFieldSel: HTMLSelectElement;
  fullMarketValueFieldSel: HTMLSelectElement;
  assessedValueFieldSel: HTMLSelectElement;
  landValueFieldSel: HTMLSelectElement;
  improvementValueFieldSel: HTMLSelectElement;
  btnSizeBack: HTMLButtonElement;
  btnSizeSkip: HTMLButtonElement;
  btnSizeOk: HTMLButtonElement;
  normLand: HTMLInputElement;
  normBldg: HTMLInputElement;
  normLandUnitEl: HTMLElement;
  normBldgUnitEl: HTMLElement;
  statsNormAsIs: HTMLInputElement;
  statsNormLand: HTMLInputElement;
  statsNormBldg: HTMLInputElement;
  statsNormLandUnitEl: HTMLElement;
  statsNormBldgUnitEl: HTMLElement;
}) {
  numericModalOverlay = els.numericModalOverlay;
  categoricalModalOverlay = els.categoricalModalOverlay;
  sizeOverlay = els.sizeOverlay;
  addLayerOverlay = els.addLayerOverlay;
  rowCountEl = els.rowCountEl;
  geomColEl = els.geomColEl;
  numericFieldListEl = els.numericFieldListEl;
  btnAllNumeric = els.btnAllNumeric;
  btnNoneNumeric = els.btnNoneNumeric;
  btnCancelNumericModal = els.btnCancelNumericModal;
  btnConfirmNumericModal = els.btnConfirmNumericModal;
  categoricalRowCountEl = els.categoricalRowCountEl;
  categoricalGeomColEl = els.categoricalGeomColEl;
  categoricalFieldListEl = els.categoricalFieldListEl;
  btnAllCategorical = els.btnAllCategorical;
  btnNoneCategorical = els.btnNoneCategorical;
  btnCancelCategoricalModal = els.btnCancelCategoricalModal;
  btnConfirmCategoricalModal = els.btnConfirmCategoricalModal;
  bldgFieldSel = els.bldgFieldSel;
  bldgUnitSel = els.bldgUnitSel;
  landFieldSel = els.landFieldSel;
  landUnitSel = els.landUnitSel;
  salePriceFieldSel = els.salePriceFieldSel;
  saleDateFieldSel = els.saleDateFieldSel;
  validSaleFieldSel = els.validSaleFieldSel;
  vacantSaleFieldSel = els.vacantSaleFieldSel;
  parcelIdFieldSel = els.parcelIdFieldSel;
  addressFieldSel = els.addressFieldSel;
  bldgQualityFieldSel = els.bldgQualityFieldSel;
  bldgConditionFieldSel = els.bldgConditionFieldSel;
  bldgAgeFieldSel = els.bldgAgeFieldSel;
  bldgEffAgeFieldSel = els.bldgEffAgeFieldSel;
  bldgBedsFieldSel = els.bldgBedsFieldSel;
  bldgBathsFieldSel = els.bldgBathsFieldSel;
  bldgTypeFieldSel = els.bldgTypeFieldSel;
  landTypeFieldSel = els.landTypeFieldSel;
  landZoningFieldSel = els.landZoningFieldSel;
  saleIdFieldSel = els.saleIdFieldSel;
  fullMarketValueFieldSel = els.fullMarketValueFieldSel;
  assessedValueFieldSel = els.assessedValueFieldSel;
  landValueFieldSel = els.landValueFieldSel;
  improvementValueFieldSel = els.improvementValueFieldSel;
  btnSizeBack = els.btnSizeBack;
  btnSizeSkip = els.btnSizeSkip;
  btnSizeOk = els.btnSizeOk;
  normLand = els.normLand;
  normBldg = els.normBldg;
  normLandUnitEl = els.normLandUnitEl;
  normBldgUnitEl = els.normBldgUnitEl;
  statsNormAsIs = els.statsNormAsIs;
  statsNormLand = els.statsNormLand;
  statsNormBldg = els.statsNormBldg;
  statsNormLandUnitEl = els.statsNormLandUnitEl;
  statsNormBldgUnitEl = els.statsNormBldgUnitEl;
}

/* ------------------------------------------------------------------ */
/*  Callbacks into main.ts (set once via initModalCallbacks)           */
/* ------------------------------------------------------------------ */

let _clearData: () => void;
let _loadSelectedColumns: () => void;
let _getCurrentLayer: () => LayerState | null;
let _renderDataStoreList: () => void;

export function initModalCallbacks(cbs: {
  clearData: () => void;
  loadSelectedColumns: () => void;
  getCurrentLayer: () => LayerState | null;
  renderDataStoreList: () => void;
}) {
  _clearData = cbs.clearData;
  _loadSelectedColumns = cbs.loadSelectedColumns;
  _getCurrentLayer = cbs.getCurrentLayer;
  _renderDataStoreList = cbs.renderDataStoreList;
}

/* ------------------------------------------------------------------ */
/*  Auto-pick heuristics                                               */
/* ------------------------------------------------------------------ */

function tokenizeName(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function isKeyField(name: string) {
  const tokens = tokenizeName(name);

  // EXCLUDE length/perimeter from "key" suggestions
  if (tokens.some(t => t === 'length' || t === 'perimeter' || t === 'perim')) return false;

  // "value" or "valuation" -> key
  const valueHits = tokens.includes('value') || tokens.includes('valuation');

  // Size-ish -> key: 'area' or any unit token (incl. 'acreage', 'ha', etc.)
  const sizeHits = tokens.some(t => t === 'area' || UNIT_TOKENS.has(t));

  return valueHits || sizeHits;
}

export function containsUnit(name: string): boolean {
  const tokens = tokenizeName(name);
  return tokens.some(t => UNIT_TOKENS.has(t));
}

export function containsKeyword(name: string, kind: 'building'|'land'): boolean {
  const tokens = tokenizeName(name);
  // building: treat stems/spellings of 'building' and 'improvement' as buildingy
  if (kind === 'building') return tokens.some(t => /^(bldg|build|building|impr|improv)/.test(t));
  // land: treat 'land', 'acre', and 'acreage' as landy
  return tokens.some(t => /^(land|acre|acreage)/.test(t));
}

// score lower = better
export function scoreValueField(name: string): number {
  const tokens = tokenizeName(name);

  // Category ranking (lower is better)
  const has = (re: RegExp) => tokens.some(t => re.test(t));

  const isLand     = has(/^land$/);
  const isPropLike = has(/^property$/) || has(/^market$/) || has(/^total$/);
  const isBldgLike = has(/^building$/) || has(/^bldg$/) || has(/^impr/) || has(/^improve/);

  let catRank = 3;                // default "other"
  if (isLand)        catRank = 0; // best
  else if (isPropLike) catRank = 1;
  else if (isBldgLike) catRank = 2;

  // Start with category weight
  let score = catRank * 100;

  // Bonus for containing "valu" (as in "value" or "valuation")
  const hasValue = tokens.includes('valu') || /valu/i.test(name);
  if (hasValue) score -= 20;

  // Gentle tie-breakers (keep small so they don't swamp category/bonus)
  // Fewer tokens and shorter total name are better.
  score += tokens.length * 0.5;
  score += Math.min(20, name.length / 50); // tiny nudge for very long names

  return score;
}

// score lower = better
export function scoreSizeField(name: string, kind: 'building'|'land'): number {
  const tokens = tokenizeName(name);

  // broaden land keywords to include 'acre' / 'acreage'
  const kwIdx = tokens.findIndex(t =>
    kind === 'building'
      ? /^(bldg|build|building|impr|improv)/.test(t)
      : /^(land|acre|acreage)/.test(t)    // was just /^land/
  );

  const unitIdx = tokens.findIndex(t => UNIT_TOKENS.has(t));
  if (kwIdx === -1 || unitIdx === -1) return Number.POSITIVE_INFINITY;

  const extras = tokens.filter((t, i) => i !== kwIdx && i !== unitIdx && t !== 'area' && t !== 'total');

  let score = 0;
  score += extras.length * 10;
  score += tokens.length * 0.5;
  if (unitIdx !== tokens.length - 1) score += 2;
  if (kwIdx > 0) score += 0.5;
  return score;
}

function guessAreaUnitKey(name: string | null): string | undefined {
  const g = guessAreaUnitFromFieldName(name || '');
  return g || undefined; // reuse existing unit-guess function
}

export function autoPickOne(kind: 'building'|'land', fields: string[]): { field?: string, unitKey?: string } {
  let best: { field?: string, unitKey?: string } = {};
  let bestScore = Number.POSITIVE_INFINITY;
  for (const f of fields) {
    const s = scoreSizeField(f, kind);
    if (s < bestScore) {
      bestScore = s;
      best = { field: f, unitKey: guessAreaUnitKey(f) };
    }
  }
  return best;
}

export function autoPickMainField(fields: string[]): string {
  let best: string = "";
  let bestScore = Number.POSITIVE_INFINITY;
  for (const f of fields) {
    const s = scoreValueField(f);
    if (s < bestScore) {
      bestScore = s;
      best = f;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Sale data auto-pick heuristics                                     */
/* ------------------------------------------------------------------ */

type KeywordGroup = readonly string[];

/**
 * Normalize a string into lowercase tokens:
 * - lowercase
 * - replace non-alphanumeric separators with spaces
 * - split on whitespace
 *
 * Examples:
 *   "sale_price"   -> ["sale", "price"]
 *   "isVacantSale" -> ["isvacantsale"] (camelCase not split)
 */
function normalizeToTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Scan fields first, return the first field that matches ANY keyword group.
 * A keyword group matches if ALL of its keywords are found in the field tokens.
 */
function guessFieldByKeywordGroups(
  fields: string[],
  keywordGroups: readonly KeywordGroup[]
): string | null {
  const normalizedGroups = keywordGroups.map(g => g.flatMap(normalizeToTokens));

  for (const groupTokens of normalizedGroups) {
    for (const field of fields) {
      const tokenSet = new Set(normalizeToTokens(field));
      if (groupTokens.every(t => tokenSet.has(t))) return field;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Specific field heuristics                                          */
/* ------------------------------------------------------------------ */

export function autoPickVacantSaleField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["vacant", "sale"],
    ["vacant", "sold"],
    ["unimproved", "sale"],
    ["unimproved", "sold"],
    ["vacantsale"],
    ["unimprovedsale"],
    ["vacant"],
    ["is", "vacant"]
  ]);
}

export function autoPickSalePriceField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["sale", "price"],
    ["sale", "amt"],
    ["sold", "price"],
    ["sold", "amt"],
    ["saleprice"],
    ["saleamt"],
    ["soldprice"],
    ["soldamt"]
  ]);
}

export function autoPickSaleDateField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["sale", "date"],
    ["sold", "date"],
    ["sale", "dt"],
    ["saledate"],
    ["solddate"],
    ["saledt"],
  ]);
}

export function autoPickValidSaleField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["valid", "sale"],
    ["valid"],
    ["qualified"],
    ["arms", "length"],
    ["armslength"],
  ]);
}

/* ------------------------------------------------------------------ */
/*  Additional field auto-pick heuristics                              */
/* ------------------------------------------------------------------ */

export function autoPickParcelIdField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["key"],
    ["parcel", "id"],
    ["parcelid"],
    ["geoid"],
    ["geo", "id"],
    ["parcel", "num"],
    ["parcel", "no"],
    ["pin"],
    ["apn"],
  ]);
}

export function autoPickAddressField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["address"],
    ["addr"],
    ["street", "addr"],
    ["situs"],
    ["situs", "addr"],
  ]);
}

export function autoPickBldgQualityField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["quality"],
    ["grade"],
    ["bldg", "class"],
    ["building", "class"],
  ]);
}

export function autoPickBldgConditionField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["condition"],
    ["cond"],
    ["bldg", "cond"],
    ["building", "cond"],
    ["pct", "good"],
    ["percent", "good"]
  ]);
}

export function autoPickBldgAgeField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["actual", "age"],
    ["age"],
    ["yr", "built"],
    ["year", "built"],
  ]);
}

export function autoPickBldgEffAgeField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["eff", "age"],
    ["effective", "age"],
    ["effage"],
  ]);
}

export function autoPickBldgBedsField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["bedrooms"],
    ["bedroom"],
    ["beds"],
    ["bed"],
  ]);
}

export function autoPickBldgBathsField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["bathrooms"],
    ["bathroom"],
    ["baths"],
    ["bath"],
  ]);
}

export function autoPickBldgTypeField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["property", "use"],
    ["property", "type"],
    ["prop", "use"],
    ["prop", "type"],
    ["bldg", "type"],
    ["building", "type"],
    ["use", "code"],
    ["state", "class"],
    ["state", "code"]
  ]);
}

export function autoPickLandTypeField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["land", "type"],
    ["land", "use"],
    ["land", "class"]
  ]);
}

export function autoPickLandZoningField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["zoning"],
    ["zone"],
  ]);
}

export function autoPickSaleIdField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["sale", "key"],
    ["sale", "id"],
    ["book"],
    ["instrument"],
    ["deed"],
  ]);
}

export function autoPickFullMarketValueField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["full", "market", "value"],
    ["full", "mkt", "value"],
    ["market", "value"],
    ["market"],
    ["fmv"],
  ]);
}

export function autoPickAssessedValueField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["assessed", "value"],
    ["taxable", "value"],
    ["total", "assessed"],
    ["assessed"],
  ]);
}

export function autoPickLandValueField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["land", "value"],
    ["land", "assessed"],
    ["land", "val"],
  ]);
}

export function autoPickImprovementValueField(numericFields: string[]): string | null {
  return guessFieldByKeywordGroups(numericFields, [
    ["improvement", "value"],
    ["bldg", "value"],
    ["building", "value"],
    ["impr", "value"],
    ["improvement", "val"],
  ]);
}

/* ------------------------------------------------------------------ */
/*  Dropdown helpers                                                   */
/* ------------------------------------------------------------------ */

export function fillUnitSelect(sel: HTMLSelectElement, preselectKey?: string) {
  sel.replaceChildren(new Option('— select unit —', ''));
  for (const u of AREA_UNIT_CHOICES) sel.appendChild(new Option(u.label, u.key));
  if (preselectKey) sel.value = preselectKey;
}

export function fillFieldSelect(sel: HTMLSelectElement, fields: string[]) {
  sel.replaceChildren(new Option('— no selection —', ''));
  for (const f of fields) sel.appendChild(new Option(f, f));
}

export function guessAreaUnitFromFieldName(name: string | null): string | null {
  if (!name) return null;
  const s = name.toLowerCase();
  if (/(sq_?ft|sqft|ft2|ft\^2|_sf\b)/.test(s)) return 'sqft';
  if (/(sq_?m|sqm|m2|m\^2|_m2\b)/.test(s)) return 'sqm';
  if (/(acres?|_acres?\b|_ac\b)/.test(s)) return 'acres';
  if (/(hectares?|_ha\b)/.test(s)) return 'hectares';
  if (/(km2|sqkm|_km2\b)/.test(s)) return 'sqkm';
  if (/(mi2|sqmi|_mi2\b)/.test(s)) return 'sqmi';
  return null;
}

function valueToUnitLabel(key: string): string | null {
  const item = AREA_UNIT_CHOICES.find(u => u.key === key);
  return item ? item.label : null;
}

/* ------------------------------------------------------------------ */
/*  setSizeState                                                       */
/* ------------------------------------------------------------------ */

export type SizeAndSaleState = {
  bldgField: string | null;
  bldgUnit: string | null;
  landField: string | null;
  landUnit: string | null;
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

export type ExtraKeyFields = {
  parcelId: string | null;
  address: string | null;
  bldgQuality: string | null;
  bldgCondition: string | null;
  bldgAge: string | null;
  bldgEffAge: string | null;
  bldgBeds: string | null;
  bldgBaths: string | null;
  bldgType: string | null;
  landType: string | null;
  landZoning: string | null;
  saleId: string | null;
  fullMarketValue: string | null;
  assessedValue: string | null;
  landValue: string | null;
  improvementValue: string | null;
};

export function setSizeState(
  bField: string | null, bUnit: string | null,
  lField: string | null, lUnit: string | null,
  saleData?: { price: string | null; date: string | null; valid: string | null; vacant: string | null },
  extraFields?: ExtraKeyFields
) {
  S.bldgSizeField = bField || null;
  S.bldgSizeUnitLabel = bUnit || null;
  S.landSizeField = lField || null;
  S.landSizeUnitLabel = lUnit || null;
  const activeLayer = _getCurrentLayer();
  if (activeLayer) {
    activeLayer.bldgSizeField = S.bldgSizeField;
    activeLayer.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
    activeLayer.landSizeField = S.landSizeField;
    activeLayer.landSizeUnitLabel = S.landSizeUnitLabel;
  }
  const activeStore = activeLayer
    ? S.dataStores.get(activeLayer.dataStoreId)
    : (S.currentDataStoreId ? S.dataStores.get(S.currentDataStoreId) ?? null : null);
  if (!activeStore) {
    console.warn('[Classification] No explicit data-source context while setting classified fields.');
  }
  if (activeStore) {
    activeStore.bldgSizeField = S.bldgSizeField;
    activeStore.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
    activeStore.landSizeField = S.landSizeField;
    activeStore.landSizeUnitLabel = S.landSizeUnitLabel;
  }

  if (activeStore) {
    for (const layer of S.layers.values()) {
      if (layer.dataStoreId !== activeStore.id) continue;
      layer.bldgSizeField = S.bldgSizeField;
      layer.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
      layer.landSizeField = S.landSizeField;
      layer.landSizeUnitLabel = S.landSizeUnitLabel;
    }
  }

  // Handle sale data fields
  if (saleData) {
    S.timeAdjustmentSettings.salePriceField = saleData.price || '';
    S.timeAdjustmentSettings.saleDateField = saleData.date || '';
    S.timeAdjustmentSettings.validSaleField = saleData.valid || '';
    S.timeAdjustmentSettings.vacantSaleField = saleData.vacant || '';
    S.timeAdjustmentSettings.improvedSizeField = bField || '';
    S.timeAdjustmentSettings.landSizeField = lField || '';
    if (activeStore) {
      activeStore.salePriceField = saleData.price || null;
      activeStore.saleDateField = saleData.date || null;
      activeStore.validSaleField = saleData.valid || null;
      activeStore.vacantSaleField = saleData.vacant || null;
    }
  }

  // Handle extra key fields
  if (extraFields) {
    S.parcelIdField = extraFields.parcelId || null;
    S.addressField = extraFields.address || null;
    S.bldgQualityField = extraFields.bldgQuality || null;
    S.bldgConditionField = extraFields.bldgCondition || null;
    S.bldgAgeField = extraFields.bldgAge || null;
    S.bldgEffAgeField = extraFields.bldgEffAge || null;
    S.bldgBedsField = extraFields.bldgBeds || null;
    S.bldgBathsField = extraFields.bldgBaths || null;
    S.bldgTypeField = extraFields.bldgType || null;
    S.landTypeField = extraFields.landType || null;
    S.landZoningField = extraFields.landZoning || null;
    S.saleIdField = extraFields.saleId || null;
    S.fullMarketValueField = extraFields.fullMarketValue || null;
    S.assessedValueField = extraFields.assessedValue || null;
    S.landValueField = extraFields.landValue || null;
    S.improvementValueField = extraFields.improvementValue || null;
    if (activeStore) {
      activeStore.parcelIdField = extraFields.parcelId || null;
      activeStore.addressField = extraFields.address || null;
      activeStore.bldgQualityField = extraFields.bldgQuality || null;
      activeStore.bldgConditionField = extraFields.bldgCondition || null;
      activeStore.bldgAgeField = extraFields.bldgAge || null;
      activeStore.bldgEffAgeField = extraFields.bldgEffAge || null;
      activeStore.bldgBedsField = extraFields.bldgBeds || null;
      activeStore.bldgBathsField = extraFields.bldgBaths || null;
      activeStore.bldgTypeField = extraFields.bldgType || null;
      activeStore.landTypeField = extraFields.landType || null;
      activeStore.landZoningField = extraFields.landZoning || null;
      activeStore.saleIdField = extraFields.saleId || null;
      activeStore.fullMarketValueField = extraFields.fullMarketValue || null;
      activeStore.assessedValueField = extraFields.assessedValue || null;
      activeStore.landValueField = extraFields.landValue || null;
      activeStore.improvementValueField = extraFields.improvementValue || null;
    }
  }

  // enable/disable normalization radios
  normLand.disabled = !S.landSizeField;
  normBldg.disabled = !S.bldgSizeField;
  normLandUnitEl.textContent = S.landSizeField ? (S.landSizeUnitLabel ?? '(unit)') : '(unit)';
  normBldgUnitEl.textContent = S.bldgSizeField ? (S.bldgSizeUnitLabel ?? '(unit)') : '(unit)';

  statsNormLand.disabled = !S.landSizeField;
  statsNormBldg.disabled = !S.bldgSizeField;
  statsNormLandUnitEl.textContent = S.landSizeField ? (S.landSizeUnitLabel ?? '(unit)') : '(unit)';
  statsNormBldgUnitEl.textContent = S.bldgSizeField ? (S.bldgSizeUnitLabel ?? '(unit)') : '(unit)';

  const normModeSelect = document.getElementById('normModeSelect') as HTMLSelectElement | null;
  if (normModeSelect) {
    const perLandOption = normModeSelect.querySelector('option[value="perLand"]') as HTMLOptionElement | null;
    const perBuildingOption = normModeSelect.querySelector('option[value="perBuilding"]') as HTMLOptionElement | null;
    if (perLandOption) {
      perLandOption.disabled = !S.landSizeField;
      perLandOption.textContent = `…per land size ${S.landSizeField ? (S.landSizeUnitLabel ?? '(unit)') : '(unit)'}`;
    }
    if (perBuildingOption) {
      perBuildingOption.disabled = !S.bldgSizeField;
      perBuildingOption.textContent = `…per building size ${S.bldgSizeField ? (S.bldgSizeUnitLabel ?? '(unit)') : '(unit)'}`;
    }
  }

  if (S.statsNormalizationMode === 'perLand' && !S.landSizeField) {
    S.statsNormalizationMode = 'asis';
    statsNormAsIs.checked = true;
  }
  if (S.statsNormalizationMode === 'perBuilding' && !S.bldgSizeField) {
    S.statsNormalizationMode = 'asis';
    statsNormAsIs.checked = true;
  }


}

/* ------------------------------------------------------------------ */
/*  Modal 2: Numeric field chooser (was Modal 1)                       */
/* ------------------------------------------------------------------ */

export function openNumericFieldChooserModal(opts: {
  rowCount: number;
  geometryCol: string;
  numericFields: string[];
}) {
  rowCountEl.textContent = opts.rowCount.toLocaleString();
  geomColEl.textContent = opts.geometryCol || '(unknown)';
  numericFieldListEl.replaceChildren();

  const allNumeric = opts.numericFields;
  const { lockedNumeric } = getLockedFieldsFromClassification();

  // Split numeric into key and other
  const keyNumeric = allNumeric.filter(isKeyField);
  const otherNumeric = allNumeric.filter(n => !isKeyField(n));

  // Within KEY numeric fields, find the single best building/land size candidates
  const bCandidatesKey = keyNumeric.filter(n => containsKeyword(n, 'building') && containsUnit(n));
  const lCandidatesKey = keyNumeric.filter(n => containsKeyword(n, 'land') && containsUnit(n));
  const bBest = autoPickOne('building', bCandidatesKey).field;
  const lBest = autoPickOne('land', lCandidatesKey).field;

  // Normalize for robust comparisons
  const bSet = new Set(bCandidatesKey.map(s => s.toLowerCase()));
  const lSet = new Set(lCandidatesKey.map(s => s.toLowerCase()));
  const bBestLC = bBest?.toLowerCase() ?? '';
  const lBestLC = lBest?.toLowerCase() ?? '';

  // Helper: should a KEY numeric field be prechecked?
  const shouldPrecheckKey = (name: string) => {
    if (lockedNumeric.has(name)) return true; // locked fields always checked
    const n = name.toLowerCase();
    if (bSet.has(n)) return n === bBestLC;
    if (lSet.has(n)) return n === lBestLC;
    return true;
  };

  // Helper: should an OTHER numeric field be prechecked?
  const shouldPrecheckOther = (name: string) => lockedNumeric.has(name);

  if (allNumeric.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No numeric fields were found in the schema.';
    p.className = 'muted';
    numericFieldListEl.appendChild(p);
  } else {
    // Show locked fields first (if any are not already in keyNumeric)
    const lockedNotKey = allNumeric.filter(n => lockedNumeric.has(n) && !isKeyField(n));
    const otherNotLocked = otherNumeric.filter(n => !lockedNumeric.has(n));

    if (keyNumeric.length) {
      const t2 = document.createElement('div');
      t2.className = 'section-subtitle';
      t2.textContent = 'Suggested key fields';
      numericFieldListEl.appendChild(t2);
      const g = document.createElement('div');
      g.className = 'fieldlist';
      for (const name of keyNumeric) {
        const isLocked = lockedNumeric.has(name);
        g.appendChild(makeFieldCheckbox(name, shouldPrecheckKey(name), 'numeric', isLocked));
      }
      numericFieldListEl.appendChild(g);
      numericFieldListEl.appendChild(divider());
    }

    if (lockedNotKey.length) {
      const t2 = document.createElement('div');
      t2.className = 'section-subtitle';
      t2.textContent = 'Required by key field classification';
      numericFieldListEl.appendChild(t2);
      const g = document.createElement('div');
      g.className = 'fieldlist';
      for (const name of lockedNotKey) g.appendChild(makeFieldCheckbox(name, true, 'numeric', true));
      numericFieldListEl.appendChild(g);
      numericFieldListEl.appendChild(divider());
    }

    if (otherNotLocked.length) {
      const t2 = document.createElement('div');
      t2.className = 'section-subtitle';
      t2.textContent = 'Other numeric fields';
      numericFieldListEl.appendChild(t2);
      const g = document.createElement('div');
      g.className = 'fieldlist';
      for (const name of otherNotLocked) g.appendChild(makeFieldCheckbox(name, shouldPrecheckOther(name), 'numeric'));
      numericFieldListEl.appendChild(g);
    }
  }

  // Buttons
  btnAllNumeric.onclick = () => {
    numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:disabled)')
      .forEach(c => (c.checked = true));
  };
  btnNoneNumeric.onclick = () => numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:disabled)')
    .forEach(c => (c.checked = false));
  btnCancelNumericModal.onclick = () => { numericModalOverlay.classList.remove('show'); _clearData(); };
  btnConfirmNumericModal.onclick = () => {
    const allCheckboxes = numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    S.chosenNumericFields = [];

    allCheckboxes.forEach(c => {
      if (c.checked) {
        S.chosenNumericFields.push(c.name);
      }
    });

    numericModalOverlay.classList.remove('show');

    // If there are categorical fields available, show that modal next
    if (S.lastCategoricalFieldsFromSchema.length > 0) {
      openCategoricalFieldChooserModal({
        rowCount: Number(rowCountEl.textContent?.replace(/,/g, '') || '0'),
        geometryCol: geomColEl.textContent || 'geometry',
        categoricalFields: S.lastCategoricalFieldsFromSchema
      });
    } else {
      // No categorical fields, proceed to load
      if (S.chosenNumericFields.length === 0) {
        alert('Please select at least one numeric field.');
        numericModalOverlay.classList.add('show');
        return;
      }
      _loadSelectedColumns();
    }
  };

  // Add a "Back" button to return to classification modal
  const existingNumericBack = numericModalOverlay.querySelector<HTMLButtonElement>(
    'button[data-role="back-to-classification"]'
  );
  if (existingNumericBack) existingNumericBack.remove();
  const numericBackButton = document.createElement('button');
  numericBackButton.textContent = 'Back';
  numericBackButton.dataset.role = 'back-to-classification';
  numericBackButton.onclick = () => {
    numericModalOverlay.classList.remove('show');
    openSizeModal();
  };
  const numericFooter = numericModalOverlay.querySelector('.footer');
  if (numericFooter) numericFooter.insertBefore(numericBackButton, numericFooter.firstChild);

  numericModalOverlay.classList.add('show');
}

/* ------------------------------------------------------------------ */
/*  Modal 3: Categorical field chooser (was Modal 2)                   */
/* ------------------------------------------------------------------ */

export function openCategoricalFieldChooserModal(opts: {
  rowCount: number;
  geometryCol: string;
  categoricalFields: string[];
}) {
  categoricalRowCountEl.textContent = opts.rowCount.toLocaleString();
  categoricalGeomColEl.textContent = opts.geometryCol || '(unknown)';
  categoricalFieldListEl.replaceChildren();

  const allCategorical = opts.categoricalFields;
  const { lockedCategorical } = getLockedFieldsFromClassification();

  if (allCategorical.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No categorical fields were found in the schema.';
    p.className = 'muted';
    categoricalFieldListEl.appendChild(p);
  } else {
    const lockedFields = allCategorical.filter(n => lockedCategorical.has(n));
    const unlockedFields = allCategorical.filter(n => !lockedCategorical.has(n));

    if (lockedFields.length) {
      const t2 = document.createElement('div');
      t2.className = 'section-subtitle';
      t2.textContent = 'Required by key field classification';
      categoricalFieldListEl.appendChild(t2);
      const g = document.createElement('div');
      g.className = 'fieldlist';
      for (const name of lockedFields) g.appendChild(makeFieldCheckbox(name, true, 'categorical', true));
      categoricalFieldListEl.appendChild(g);
      categoricalFieldListEl.appendChild(divider());
    }

    if (unlockedFields.length) {
      const t2 = document.createElement('div');
      t2.className = 'section-subtitle';
      t2.textContent = 'Other categorical fields';
      categoricalFieldListEl.appendChild(t2);
      const g = document.createElement('div');
      g.className = 'fieldlist';
      for (const name of unlockedFields) g.appendChild(makeFieldCheckbox(name, false, 'categorical'));
      categoricalFieldListEl.appendChild(g);
    }
  }

  // Buttons
  btnAllCategorical.onclick = () => {
    categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:disabled)')
      .forEach(c => (c.checked = true));
  };
  btnNoneCategorical.onclick = () => categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:disabled)')
    .forEach(c => (c.checked = false));
  btnCancelCategoricalModal.onclick = () => { categoricalModalOverlay.classList.remove('show'); _clearData(); };
  btnConfirmCategoricalModal.onclick = () => {
    const allCheckboxes = categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    S.chosenCategoricalFields = [];

    allCheckboxes.forEach(c => {
      if (c.checked) {
        S.chosenCategoricalFields.push(c.name);
      }
    });

    // Check if at least one field is selected (either numeric or categorical)
    if (S.chosenNumericFields.length === 0 && S.chosenCategoricalFields.length === 0) {
      alert('Please select at least one field (numeric or categorical).');
      categoricalModalOverlay.classList.add('show');
      return;
    }

    categoricalModalOverlay.classList.remove('show');
    // Final step: load the data
    _loadSelectedColumns();
  };

  // Add a "Back" button to return to numeric modal
  const existingBackButton = categoricalModalOverlay.querySelector<HTMLButtonElement>(
    'button[data-role="back-to-numeric-fields"]'
  );
  if (existingBackButton) existingBackButton.remove();
  const backButton = document.createElement('button');
  backButton.textContent = 'Back';
  backButton.dataset.role = 'back-to-numeric-fields';
  backButton.onclick = () => {
    categoricalModalOverlay.classList.remove('show');
    openNumericFieldChooserModal({
      rowCount: Number(categoricalRowCountEl.textContent?.replace(/,/g, '') || '0'),
      geometryCol: categoricalGeomColEl.textContent || 'geometry',
      numericFields: S.lastNumericFieldsFromSchema
    });
  };

  // Insert back button before the footer
  const footer = categoricalModalOverlay.querySelector('.footer');
  if (footer) footer.insertBefore(backButton, footer.firstChild);

  categoricalModalOverlay.classList.add('show');
}

/* ------------------------------------------------------------------ */
/*  Locked fields helper                                               */
/* ------------------------------------------------------------------ */

/**
 * Collect all non-empty field values from the classification dropdowns.
 * Returns sets of locked numeric and categorical field names.
 */
function getLockedFieldsFromClassification(): { lockedNumeric: Set<string>; lockedCategorical: Set<string> } {
  const numSet = new Set(S.lastNumericFieldsFromSchema.map(f => f.toLowerCase()));
  const catSet = new Set(S.lastCategoricalFieldsFromSchema.map(f => f.toLowerCase()));
  const lockedNumeric = new Set<string>();
  const lockedCategorical = new Set<string>();

  // All field-select elements in the classification modal
  const selects: HTMLSelectElement[] = [
    parcelIdFieldSel, addressFieldSel,
    bldgFieldSel, bldgQualityFieldSel, bldgConditionFieldSel,
    bldgAgeFieldSel, bldgEffAgeFieldSel, bldgBedsFieldSel, bldgBathsFieldSel, bldgTypeFieldSel,
    landFieldSel, landTypeFieldSel, landZoningFieldSel,
    fullMarketValueFieldSel, assessedValueFieldSel, landValueFieldSel, improvementValueFieldSel,
    saleIdFieldSel, salePriceFieldSel, saleDateFieldSel, validSaleFieldSel, vacantSaleFieldSel,
  ];

  for (const sel of selects) {
    const v = sel.value;
    if (!v) continue;
    const vLC = v.toLowerCase();
    if (numSet.has(vLC)) lockedNumeric.add(v);
    if (catSet.has(vLC)) lockedCategorical.add(v);
  }

  return { lockedNumeric, lockedCategorical };
}

/* ------------------------------------------------------------------ */
/*  Modal 1: Key field classification (was Modal 3)                    */
/* ------------------------------------------------------------------ */

export type OpenSizeModalOptions = {
  dataStoreId?: string;
  mode?: 'ingest' | 'reclassify';
  onSave?: () => void;
  onCancel?: () => void;
};

export function openSizeModal(options: OpenSizeModalOptions = {}) {
  const mode = options.mode ?? 'ingest';
  const targetStoreId = options.dataStoreId ?? S.currentDataStoreId;
  const targetStore = targetStoreId ? S.dataStores.get(targetStoreId) ?? null : null;

  // Now first step: use ALL schema fields (not just chosen ones)
  const numericFields = S.lastNumericFieldsFromSchema;
  const categoricalFields = S.lastCategoricalFieldsFromSchema;
  const allFields = [...numericFields, ...categoricalFields];

  // --- Populate dropdowns with type-restricted field pools ---

  // Top level
  fillFieldSelect(parcelIdFieldSel, allFields);
  fillFieldSelect(addressFieldSel, categoricalFields);

  // Building/Improvement
  fillFieldSelect(bldgFieldSel, numericFields);
  fillUnitSelect(bldgUnitSel);
  fillFieldSelect(bldgQualityFieldSel, numericFields);
  fillFieldSelect(bldgConditionFieldSel, numericFields);
  fillFieldSelect(bldgAgeFieldSel, numericFields);
  fillFieldSelect(bldgEffAgeFieldSel, numericFields);
  fillFieldSelect(bldgBedsFieldSel, numericFields);
  fillFieldSelect(bldgBathsFieldSel, numericFields);
  fillFieldSelect(bldgTypeFieldSel, categoricalFields);

  // Land
  fillFieldSelect(landFieldSel, numericFields);
  fillUnitSelect(landUnitSel);
  fillFieldSelect(landTypeFieldSel, categoricalFields);
  fillFieldSelect(landZoningFieldSel, categoricalFields);

  // Assessed Values
  fillFieldSelect(fullMarketValueFieldSel, numericFields);
  fillFieldSelect(assessedValueFieldSel, numericFields);
  fillFieldSelect(landValueFieldSel, numericFields);
  fillFieldSelect(improvementValueFieldSel, numericFields);

  // Sale
  fillFieldSelect(saleIdFieldSel, categoricalFields);
  fillFieldSelect(salePriceFieldSel, numericFields);
  fillFieldSelect(saleDateFieldSel, allFields);
  fillFieldSelect(validSaleFieldSel, allFields);
  fillFieldSelect(vacantSaleFieldSel, allFields);

  // --- AUTO-PICK using heuristics ---
  const parcelIdGuess = autoPickParcelIdField(allFields);
  if (parcelIdGuess) parcelIdFieldSel.value = parcelIdGuess;
  const addressGuess = autoPickAddressField(categoricalFields);
  if (addressGuess) addressFieldSel.value = addressGuess;

  const bGuess = autoPickOne('building', numericFields);
  const lGuess = autoPickOne('land', numericFields);
  if (bGuess.field) {
    bldgFieldSel.value = bGuess.field;
    const u = bGuess.unitKey || guessAreaUnitFromFieldName(bGuess.field);
    if (u) bldgUnitSel.value = u;
  }
  if (lGuess.field) {
    landFieldSel.value = lGuess.field;
    const u = lGuess.unitKey || guessAreaUnitFromFieldName(lGuess.field);
    if (u) landUnitSel.value = u;
  }

  const bldgQualityGuess = autoPickBldgQualityField(numericFields);
  if (bldgQualityGuess) bldgQualityFieldSel.value = bldgQualityGuess;
  const bldgConditionGuess = autoPickBldgConditionField(numericFields);
  if (bldgConditionGuess) bldgConditionFieldSel.value = bldgConditionGuess;
  const bldgAgeGuess = autoPickBldgAgeField(numericFields);
  if (bldgAgeGuess) bldgAgeFieldSel.value = bldgAgeGuess;
  const bldgEffAgeGuess = autoPickBldgEffAgeField(numericFields);
  if (bldgEffAgeGuess) bldgEffAgeFieldSel.value = bldgEffAgeGuess;
  const bldgBedsGuess = autoPickBldgBedsField(numericFields);
  if (bldgBedsGuess) bldgBedsFieldSel.value = bldgBedsGuess;
  const bldgBathsGuess = autoPickBldgBathsField(numericFields);
  if (bldgBathsGuess) bldgBathsFieldSel.value = bldgBathsGuess;
  const bldgTypeGuess = autoPickBldgTypeField(categoricalFields);
  if (bldgTypeGuess) bldgTypeFieldSel.value = bldgTypeGuess;

  const landTypeGuess = autoPickLandTypeField(categoricalFields);
  if (landTypeGuess) landTypeFieldSel.value = landTypeGuess;
  const landZoningGuess = autoPickLandZoningField(categoricalFields);
  if (landZoningGuess) landZoningFieldSel.value = landZoningGuess;

  const fullMarketValueGuess = autoPickFullMarketValueField(numericFields);
  if (fullMarketValueGuess) fullMarketValueFieldSel.value = fullMarketValueGuess;
  const assessedValueGuess = autoPickAssessedValueField(numericFields);
  if (assessedValueGuess) assessedValueFieldSel.value = assessedValueGuess;
  const landValueGuess = autoPickLandValueField(numericFields);
  if (landValueGuess) landValueFieldSel.value = landValueGuess;
  const improvementValueGuess = autoPickImprovementValueField(numericFields);
  if (improvementValueGuess) improvementValueFieldSel.value = improvementValueGuess;

  const salePriceGuess = autoPickSalePriceField(numericFields);
  if (salePriceGuess) {
    salePriceFieldSel.value = salePriceGuess;

    const saleIdGuess = autoPickSaleIdField(categoricalFields);
    if (saleIdGuess) saleIdFieldSel.value = saleIdGuess;
    const saleDateGuess = autoPickSaleDateField(allFields);
    if (saleDateGuess) saleDateFieldSel.value = saleDateGuess;
    const validSaleGuess = autoPickValidSaleField(allFields);
    if (validSaleGuess) validSaleFieldSel.value = validSaleGuess;
    const vacantSaleGuess = autoPickVacantSaleField(allFields);
    if (vacantSaleGuess) vacantSaleFieldSel.value = vacantSaleGuess;
  }

  if (targetStore) {
    parcelIdFieldSel.value = targetStore.parcelIdField || parcelIdFieldSel.value;
    addressFieldSel.value = targetStore.addressField || addressFieldSel.value;
    bldgFieldSel.value = targetStore.bldgSizeField || bldgFieldSel.value;
    bldgQualityFieldSel.value = targetStore.bldgQualityField || bldgQualityFieldSel.value;
    bldgConditionFieldSel.value = targetStore.bldgConditionField || bldgConditionFieldSel.value;
    bldgAgeFieldSel.value = targetStore.bldgAgeField || bldgAgeFieldSel.value;
    bldgEffAgeFieldSel.value = targetStore.bldgEffAgeField || bldgEffAgeFieldSel.value;
    bldgBedsFieldSel.value = targetStore.bldgBedsField || bldgBedsFieldSel.value;
    bldgBathsFieldSel.value = targetStore.bldgBathsField || bldgBathsFieldSel.value;
    bldgTypeFieldSel.value = targetStore.bldgTypeField || bldgTypeFieldSel.value;
    landFieldSel.value = targetStore.landSizeField || landFieldSel.value;
    landTypeFieldSel.value = targetStore.landTypeField || landTypeFieldSel.value;
    landZoningFieldSel.value = targetStore.landZoningField || landZoningFieldSel.value;
    saleIdFieldSel.value = targetStore.saleIdField || saleIdFieldSel.value;
    salePriceFieldSel.value = targetStore.salePriceField || salePriceFieldSel.value;
    saleDateFieldSel.value = targetStore.saleDateField || saleDateFieldSel.value;
    validSaleFieldSel.value = targetStore.validSaleField || validSaleFieldSel.value;
    vacantSaleFieldSel.value = targetStore.vacantSaleField || vacantSaleFieldSel.value;
    fullMarketValueFieldSel.value = targetStore.fullMarketValueField || fullMarketValueFieldSel.value;
    assessedValueFieldSel.value = targetStore.assessedValueField || assessedValueFieldSel.value;
    landValueFieldSel.value = targetStore.landValueField || landValueFieldSel.value;
    improvementValueFieldSel.value = targetStore.improvementValueField || improvementValueFieldSel.value;
    if (targetStore.bldgSizeUnitLabel) {
      const unit = AREA_UNIT_CHOICES.find(choice => choice.label === targetStore.bldgSizeUnitLabel);
      if (unit) bldgUnitSel.value = unit.key;
    }
    if (targetStore.landSizeUnitLabel) {
      const unit = AREA_UNIT_CHOICES.find(choice => choice.label === targetStore.landSizeUnitLabel);
      if (unit) landUnitSel.value = unit.key;
    }
  }

  bldgFieldSel.onchange = () => {
    const g = guessAreaUnitFromFieldName(bldgFieldSel.value);
    if (g) bldgUnitSel.value = g;
  };
  landFieldSel.onchange = () => {
    const g = guessAreaUnitFromFieldName(landFieldSel.value);
    if (g) landUnitSel.value = g;
  };

  btnSizeBack.textContent = 'Cancel';
  btnSizeSkip.style.display = mode === 'ingest' ? '' : 'none';
  btnSizeOk.textContent = mode === 'ingest' ? 'Continue' : 'Save';

  btnSizeBack.onclick = () => {
    sizeOverlay.classList.remove('show');
    if (mode === 'ingest') {
      _clearData();
    }
    options.onCancel?.();
  };

  btnSizeSkip.onclick = () => {
    if (mode !== 'ingest') return;
    sizeOverlay.classList.remove('show');
    openNumericFieldChooserModal({
      rowCount: Number(rowCountEl.textContent?.replace(/,/g, '') || '0'),
      geometryCol: geomColEl.textContent || 'geometry',
      numericFields: S.lastNumericFieldsFromSchema
    });
  };

  btnSizeOk.onclick = () => {
    const nextBldgField = bldgFieldSel.value || null;
    const nextBldgUnit = valueToUnitLabel(bldgUnitSel.value || '');
    const nextLandField = landFieldSel.value || null;
    const nextLandUnit = valueToUnitLabel(landUnitSel.value || '');
    const saleData = {
      price: salePriceFieldSel.value || null,
      date: saleDateFieldSel.value || null,
      valid: validSaleFieldSel.value || null,
      vacant: vacantSaleFieldSel.value || null,
    };
    const extraFields = {
      parcelId: parcelIdFieldSel.value || null,
      address: addressFieldSel.value || null,
      bldgQuality: bldgQualityFieldSel.value || null,
      bldgCondition: bldgConditionFieldSel.value || null,
      bldgAge: bldgAgeFieldSel.value || null,
      bldgEffAge: bldgEffAgeFieldSel.value || null,
      bldgBeds: bldgBedsFieldSel.value || null,
      bldgBaths: bldgBathsFieldSel.value || null,
      bldgType: bldgTypeFieldSel.value || null,
      landType: landTypeFieldSel.value || null,
      landZoning: landZoningFieldSel.value || null,
      saleId: saleIdFieldSel.value || null,
      fullMarketValue: fullMarketValueFieldSel.value || null,
      assessedValue: assessedValueFieldSel.value || null,
      landValue: landValueFieldSel.value || null,
      improvementValue: improvementValueFieldSel.value || null,
    };

    if (targetStore) {
      const previousStoreId = S.currentDataStoreId;
      S.currentDataStoreId = targetStore.id;
      setSizeState(nextBldgField, nextBldgUnit, nextLandField, nextLandUnit, saleData, extraFields);
      S.currentDataStoreId = previousStoreId;
    } else {
      setSizeState(nextBldgField, nextBldgUnit, nextLandField, nextLandUnit, saleData, extraFields);
    }

    sizeOverlay.classList.remove('show');
    options.onSave?.();

    if (mode === 'ingest') {
      openNumericFieldChooserModal({
        rowCount: Number(rowCountEl.textContent?.replace(/,/g, '') || '0'),
        geometryCol: geomColEl.textContent || 'geometry',
        numericFields: S.lastNumericFieldsFromSchema
      });
    }
  };

  sizeOverlay.classList.add('show');
}

/* ------------------------------------------------------------------ */
/*  Add layer modal                                                    */
/* ------------------------------------------------------------------ */

export function openAddLayerModal() {
  if (!addLayerOverlay) return;
  _renderDataStoreList();
  addLayerOverlay.classList.add('show');
}

export function closeAddLayerModal() {
  if (!addLayerOverlay) return;
  addLayerOverlay.classList.remove('show');
}

/* ------------------------------------------------------------------ */
/*  Generic confirmation dialog                                        */
/* ------------------------------------------------------------------ */

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Add a `danger` class to the confirm button for destructive actions. */
  danger?: boolean;
};

/**
 * Promise-based replacement for window.confirm().
 *
 * Renders the app's standard .overlay/.modal chrome and resolves to
 * true (confirmed) or false (cancelled / dismissed via Cancel, Esc, or
 * backdrop click). Self-contained: builds and tears down its own DOM,
 * so it needs no wiring through initModalElements.
 */
export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '420px';

    if (opts.title) {
      const h3 = document.createElement('h3');
      h3.textContent = opts.title;
      modal.appendChild(h3);
    }

    const msg = document.createElement('div');
    msg.className = 'muted';
    msg.style.whiteSpace = 'pre-wrap';
    msg.textContent = opts.message;
    modal.appendChild(msg);

    const footer = document.createElement('div');
    footer.className = 'footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = opts.cancelText ?? 'Cancel';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = opts.confirmText ?? 'OK';
    if (opts.danger) confirmBtn.classList.add('danger');
    footer.append(cancelBtn, confirmBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = (result: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    };

    cancelBtn.addEventListener('click', () => cleanup(false));
    confirmBtn.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) cleanup(false);
    });
    document.addEventListener('keydown', onKey, true);

    confirmBtn.focus();
  });
}
