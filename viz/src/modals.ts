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
    ["parcel", "id"],
    ["parcelid"],
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
    ["bldg", "type"],
    ["building", "type"],
    ["prop", "type"],
    ["property", "type"],
    ["use", "code"],
  ]);
}

export function autoPickLandTypeField(allFields: string[]): string | null {
  return guessFieldByKeywordGroups(allFields, [
    ["land", "type"],
    ["land", "use"],
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
    ["sale", "id"],
    ["book"],
    ["instrument"],
    ["deed"],
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
  const activeStore = activeLayer ? S.dataStores.get(activeLayer.dataStoreId) : null;
  if (activeStore) {
    activeStore.bldgSizeField = S.bldgSizeField;
    activeStore.bldgSizeUnitLabel = S.bldgSizeUnitLabel;
    activeStore.landSizeField = S.landSizeField;
    activeStore.landSizeUnitLabel = S.landSizeUnitLabel;
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
/*  Modal 1: Numeric field chooser                                     */
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
    const n = name.toLowerCase();
    if (bSet.has(n)) return n === bBestLC;
    if (lSet.has(n)) return n === lBestLC;
    return true;
  };

  if (allNumeric.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No numeric fields were found in the schema.';
    p.className = 'muted';
    numericFieldListEl.appendChild(p);
  } else {
    if (keyNumeric.length) {
      const t2 = document.createElement('div');
      t2.className = 'section-subtitle';
      t2.textContent = 'Suggested key fields';
      numericFieldListEl.appendChild(t2);
      const g = document.createElement('div');
      g.className = 'fieldlist';
      for (const name of keyNumeric) g.appendChild(makeFieldCheckbox(name, shouldPrecheckKey(name), 'numeric'));
      numericFieldListEl.appendChild(g);
      numericFieldListEl.appendChild(divider());
    }

    if (otherNumeric.length) {
      const t2 = document.createElement('div');
      t2.className = 'section-subtitle';
      t2.textContent = 'Other numeric fields';
      numericFieldListEl.appendChild(t2);
      const g = document.createElement('div');
      g.className = 'fieldlist';
      for (const name of otherNumeric) g.appendChild(makeFieldCheckbox(name, false, 'numeric'));
      numericFieldListEl.appendChild(g);
    }
  }

  // Buttons
  btnAllNumeric.onclick = () => {
    numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
      .forEach(c => (c.checked = true));
  };
  btnNoneNumeric.onclick = () => numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
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
      // No categorical fields, proceed to size modal
      if (S.chosenNumericFields.length === 0) {
        alert('Please select at least one numeric field.');
        numericModalOverlay.classList.add('show');
        return;
      }
      openSizeModal();
    }
  };

  numericModalOverlay.classList.add('show');
}

/* ------------------------------------------------------------------ */
/*  Modal 2: Categorical field chooser                                 */
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

  if (allCategorical.length === 0) {
    const p = document.createElement('div');
    p.textContent = 'No categorical fields were found in the schema.';
    p.className = 'muted';
    categoricalFieldListEl.appendChild(p);
  } else {
    const g = document.createElement('div');
    g.className = 'fieldlist';
    for (const name of allCategorical) g.appendChild(makeFieldCheckbox(name, false, 'categorical'));
    categoricalFieldListEl.appendChild(g);
  }

  // Buttons
  btnAllCategorical.onclick = () => {
    categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
      .forEach(c => (c.checked = true));
  };
  btnNoneCategorical.onclick = () => categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
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
    openSizeModal();
  };

  // Add a "Back" button to return to numeric modal
  const existingBackButton = categoricalModalOverlay.querySelector<HTMLButtonElement>(
    'button[data-role="back-to-numeric-fields"]'
  );
  if (existingBackButton) {
    existingBackButton.remove();
  }
  const backButton = document.createElement('button');
  backButton.textContent = 'Back to Numeric Fields';
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
  if (footer) {
    footer.insertBefore(backButton, footer.firstChild);
  }

  categoricalModalOverlay.classList.add('show');
}

/* ------------------------------------------------------------------ */
/*  Modal 3: Size identification                                       */
/* ------------------------------------------------------------------ */

export function openSizeModal() {
  // options: only among the fields the user kept
  const numericFields = S.chosenNumericFields;
  const allChosenFields = [...S.chosenNumericFields, ...S.chosenCategoricalFields];

  // --- Populate dropdowns ---

  // Top level
  fillFieldSelect(parcelIdFieldSel, allChosenFields);
  fillFieldSelect(addressFieldSel, allChosenFields);

  // Building/Improvement
  fillFieldSelect(bldgFieldSel, numericFields);
  fillUnitSelect(bldgUnitSel);
  fillFieldSelect(bldgQualityFieldSel, allChosenFields);
  fillFieldSelect(bldgConditionFieldSel, allChosenFields);
  fillFieldSelect(bldgAgeFieldSel, numericFields);
  fillFieldSelect(bldgEffAgeFieldSel, numericFields);
  fillFieldSelect(bldgBedsFieldSel, numericFields);
  fillFieldSelect(bldgBathsFieldSel, numericFields);
  fillFieldSelect(bldgTypeFieldSel, allChosenFields);

  // Land
  fillFieldSelect(landFieldSel, numericFields);
  fillUnitSelect(landUnitSel);
  fillFieldSelect(landTypeFieldSel, allChosenFields);
  fillFieldSelect(landZoningFieldSel, allChosenFields);

  // Sale
  fillFieldSelect(saleIdFieldSel, allChosenFields);
  fillFieldSelect(salePriceFieldSel, numericFields);
  fillFieldSelect(saleDateFieldSel, allChosenFields);
  fillFieldSelect(validSaleFieldSel, allChosenFields);
  fillFieldSelect(vacantSaleFieldSel, allChosenFields);

  // --- AUTO-PICK using heuristics ---

  // Top level
  const parcelIdGuess = autoPickParcelIdField(allChosenFields);
  if (parcelIdGuess) parcelIdFieldSel.value = parcelIdGuess;

  const addressGuess = autoPickAddressField(allChosenFields);
  if (addressGuess) addressFieldSel.value = addressGuess;

  // Building size + unit
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

  // Building extra fields
  const bldgQualityGuess = autoPickBldgQualityField(allChosenFields);
  if (bldgQualityGuess) bldgQualityFieldSel.value = bldgQualityGuess;

  const bldgConditionGuess = autoPickBldgConditionField(allChosenFields);
  if (bldgConditionGuess) bldgConditionFieldSel.value = bldgConditionGuess;

  const bldgAgeGuess = autoPickBldgAgeField(numericFields);
  if (bldgAgeGuess) bldgAgeFieldSel.value = bldgAgeGuess;

  const bldgEffAgeGuess = autoPickBldgEffAgeField(numericFields);
  if (bldgEffAgeGuess) bldgEffAgeFieldSel.value = bldgEffAgeGuess;

  const bldgBedsGuess = autoPickBldgBedsField(numericFields);
  if (bldgBedsGuess) bldgBedsFieldSel.value = bldgBedsGuess;

  const bldgBathsGuess = autoPickBldgBathsField(numericFields);
  if (bldgBathsGuess) bldgBathsFieldSel.value = bldgBathsGuess;

  const bldgTypeGuess = autoPickBldgTypeField(allChosenFields);
  if (bldgTypeGuess) bldgTypeFieldSel.value = bldgTypeGuess;

  // Land extra fields
  const landTypeGuess = autoPickLandTypeField(allChosenFields);
  if (landTypeGuess) landTypeFieldSel.value = landTypeGuess;

  const landZoningGuess = autoPickLandZoningField(allChosenFields);
  if (landZoningGuess) landZoningFieldSel.value = landZoningGuess;

  // Sale fields
  const saleIdGuess = autoPickSaleIdField(allChosenFields);
  if (saleIdGuess) saleIdFieldSel.value = saleIdGuess;

  const salePriceGuess = autoPickSalePriceField(numericFields);
  if (salePriceGuess) salePriceFieldSel.value = salePriceGuess;

  const saleDateGuess = autoPickSaleDateField(allChosenFields);
  if (saleDateGuess) saleDateFieldSel.value = saleDateGuess;

  const validSaleGuess = autoPickValidSaleField(allChosenFields);
  if (validSaleGuess) validSaleFieldSel.value = validSaleGuess;

  const vacantSaleGuess = autoPickVacantSaleField(allChosenFields);
  if (vacantSaleGuess) vacantSaleFieldSel.value = vacantSaleGuess;

  // --- onchange handlers for unit auto-guess ---
  bldgFieldSel.onchange = () => {
    const g = guessAreaUnitFromFieldName(bldgFieldSel.value);
    if (g) bldgUnitSel.value = g;
  };
  landFieldSel.onchange = () => {
    const g = guessAreaUnitFromFieldName(landFieldSel.value);
    if (g) landUnitSel.value = g;
  };

  // --- Button handlers ---
  btnSizeBack.onclick = () => {
    sizeOverlay.classList.remove('show');
    if (S.lastCategoricalFieldsFromSchema.length > 0) {
      openCategoricalFieldChooserModal({
        rowCount: Number(categoricalRowCountEl.textContent?.replace(/,/g, '') || '0'),
        geometryCol: categoricalGeomColEl.textContent || 'geometry',
        categoricalFields: S.lastCategoricalFieldsFromSchema
      });
    } else {
      openNumericFieldChooserModal({
        rowCount: Number(rowCountEl.textContent?.replace(/,/g, '') || '0'),
        geometryCol: geomColEl.textContent || 'geometry',
        numericFields: S.lastNumericFieldsFromSchema
      });
    }
  };

  btnSizeSkip.onclick = () => {
    setSizeState(null, null, null, null);
    sizeOverlay.classList.remove('show');
    _loadSelectedColumns();
  };

  btnSizeOk.onclick = () => {
    setSizeState(
      bldgFieldSel.value || null,
      valueToUnitLabel(bldgUnitSel.value || ''),
      landFieldSel.value || null,
      valueToUnitLabel(landUnitSel.value || ''),
      {
        price: salePriceFieldSel.value || null,
        date: saleDateFieldSel.value || null,
        valid: validSaleFieldSel.value || null,
        vacant: vacantSaleFieldSel.value || null,
      },
      {
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
      }
    );
    sizeOverlay.classList.remove('show');
    _loadSelectedColumns();
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
