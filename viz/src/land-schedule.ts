/**
 * Land-schedule panel logic extracted from main.ts.
 *
 * Manages the land schedule field/value selectors and per-value
 * base-lot valuation inputs (min, max, value, per-unit).
 */
import { S, LAND_SCHEDULE_DEFAULT_KEY, LAND_SCHEDULE_DEFAULT_LABEL } from './state';
import type { LandSchedulePerUnit, LandScheduleBaseLot } from './types';
import { getCategoricalValues } from './filters';

/* ------------------------------------------------------------------ */
/*  DOM element references (set once via initLandScheduleElements)     */
/* ------------------------------------------------------------------ */

let landScheduleFieldSelect: HTMLSelectElement;
let landScheduleValueSelect: HTMLSelectElement;
let landScheduleBaseMin: HTMLInputElement;
let landScheduleBaseMax: HTMLInputElement;
let landScheduleBaseValue: HTMLInputElement;
let landScheduleBasePer: HTMLSelectElement;
let landScheduleValuationSection: HTMLDivElement;
let landScheduleFieldLabel: HTMLSpanElement;
let landScheduleValueRow: HTMLDivElement;

export function initLandScheduleElements(els: {
  landScheduleFieldSelect: HTMLSelectElement;
  landScheduleValueSelect: HTMLSelectElement;
  landScheduleBaseMin: HTMLInputElement;
  landScheduleBaseMax: HTMLInputElement;
  landScheduleBaseValue: HTMLInputElement;
  landScheduleBasePer: HTMLSelectElement;
  landScheduleValuationSection: HTMLDivElement;
  landScheduleFieldLabel: HTMLSpanElement;
  landScheduleValueRow: HTMLDivElement;
}) {
  landScheduleFieldSelect = els.landScheduleFieldSelect;
  landScheduleValueSelect = els.landScheduleValueSelect;
  landScheduleBaseMin = els.landScheduleBaseMin;
  landScheduleBaseMax = els.landScheduleBaseMax;
  landScheduleBaseValue = els.landScheduleBaseValue;
  landScheduleBasePer = els.landScheduleBasePer;
  landScheduleValuationSection = els.landScheduleValuationSection;
  landScheduleFieldLabel = els.landScheduleFieldLabel;
  landScheduleValueRow = els.landScheduleValueRow;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getLandScheduleEntry(field: string, valueKey: string): LandScheduleBaseLot {
  let fieldMap = S.landScheduleStore.get(field);
  if (!fieldMap) {
    fieldMap = new Map();
    S.landScheduleStore.set(field, fieldMap);
  }
  let entry = fieldMap.get(valueKey);
  if (!entry) {
    entry = {
      min: null,
      max: null,
      value: null,
      per: null
    };
    fieldMap.set(valueKey, entry);
  }
  return entry;
}

function getAvailableLandScheduleFields(): string[] {
  if (!S.currentGeoJSON) return [];
  return S.chosenCategoricalFields.filter(k =>
    S.currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))
  );
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function setLandScheduleInputValue(input: HTMLInputElement, value: number | null) {
  input.value = value === null ? '' : String(value);
}

/* ------------------------------------------------------------------ */
/*  Exported functions                                                */
/* ------------------------------------------------------------------ */

export function updateLandScheduleValueOptions() {
  landScheduleValueSelect.replaceChildren();
  landScheduleValuationSection.style.display = 'none';
  if (!S.currentLandScheduleField) {
    landScheduleValueRow.style.display = 'none';
    S.currentLandScheduleValue = null;
    return;
  }

  landScheduleFieldLabel.textContent = S.currentLandScheduleField;
  landScheduleValueRow.style.display = 'grid';

  landScheduleValueSelect.appendChild(new Option(LAND_SCHEDULE_DEFAULT_LABEL, LAND_SCHEDULE_DEFAULT_KEY));
  const values = getCategoricalValues(S.currentLandScheduleField);
  values.forEach(value => landScheduleValueSelect.appendChild(new Option(value, value)));

  if (S.currentLandScheduleValue && (S.currentLandScheduleValue === LAND_SCHEDULE_DEFAULT_KEY || values.includes(S.currentLandScheduleValue))) {
    landScheduleValueSelect.value = S.currentLandScheduleValue;
    updateLandScheduleInputsFromStore();
  } else {
    landScheduleValueSelect.selectedIndex = -1;
    S.currentLandScheduleValue = null;
  }
}

export function updateLandScheduleInputsFromStore() {
  if (!S.currentLandScheduleField || !S.currentLandScheduleValue) {
    landScheduleValuationSection.style.display = 'none';
    return;
  }
  const entry = getLandScheduleEntry(S.currentLandScheduleField, S.currentLandScheduleValue);
  S.isUpdatingLandScheduleUI = true;
  setLandScheduleInputValue(landScheduleBaseMin, entry.min);
  setLandScheduleInputValue(landScheduleBaseMax, entry.max);
  setLandScheduleInputValue(landScheduleBaseValue, entry.value);
  landScheduleBasePer.value = entry.per ?? '';
  landScheduleValuationSection.style.display = 'grid';
  S.isUpdatingLandScheduleUI = false;
}

export function updateLandScheduleStoreFromInputs() {
  if (S.isUpdatingLandScheduleUI || !S.currentLandScheduleField || !S.currentLandScheduleValue) return;
  const entry = getLandScheduleEntry(S.currentLandScheduleField, S.currentLandScheduleValue);
  entry.min = parseOptionalNumber(landScheduleBaseMin.value);
  entry.max = parseOptionalNumber(landScheduleBaseMax.value);
  entry.value = parseOptionalNumber(landScheduleBaseValue.value);
  entry.per = (landScheduleBasePer.value as LandSchedulePerUnit) || null;
}

export function refreshLandSchedulePanel() {
  landScheduleFieldSelect.replaceChildren();
  landScheduleValuationSection.style.display = 'none';
  const availableFields = getAvailableLandScheduleFields();

  if (!availableFields.length) {
    landScheduleFieldSelect.appendChild(new Option('No categorical fields', ''));
    landScheduleFieldSelect.value = '';
    landScheduleFieldSelect.disabled = true;
    S.currentLandScheduleField = null;
    S.currentLandScheduleValue = null;
    landScheduleValueRow.style.display = 'none';
    return;
  }

  landScheduleFieldSelect.disabled = false;
  const placeholder = new Option('Choose a field', '');
  placeholder.disabled = true;
  landScheduleFieldSelect.appendChild(placeholder);
  availableFields.forEach(field => landScheduleFieldSelect.appendChild(new Option(field, field)));

  if (S.currentLandScheduleField && availableFields.includes(S.currentLandScheduleField)) {
    landScheduleFieldSelect.value = S.currentLandScheduleField;
  } else {
    landScheduleFieldSelect.value = '';
    S.currentLandScheduleField = null;
    S.currentLandScheduleValue = null;
  }

  updateLandScheduleValueOptions();
}
