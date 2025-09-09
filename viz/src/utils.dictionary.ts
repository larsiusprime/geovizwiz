import { DEV_CATEGORY_FIELD } from './config';
import extraLabels from './data-dictionary.json';

// Core fields required for app functionality
const CORE_FIELD_LABELS: Record<string, string> = {
  [DEV_CATEGORY_FIELD]: 'Property Category',
  REALIMPROV: 'Improvements Assessed Value',
  REALIMPROV_per_sqft: 'Improvements Value per Sqft',
  REALLANDVA: 'Land Assessed Value',
  REALLANDVA_per_sqft: 'Land Value per Sqft',
  TLLDIMPROV: 'Total Land & Improvements',
  TLLDIMPROV_per_sqft: 'Total Land & Improvements per Sqft',
  IMPR_LAND_RATIO: 'Improvement to Land Ratio',
  IMPR_PCT_TOTAL: 'Improvements % of Total Value'
};

export let FIELD_LABELS: Record<string, string> = { ...CORE_FIELD_LABELS };
export let ALL_FIELDS: string[] = Object.keys(FIELD_LABELS);
export let NUMERIC_FIELDS: string[] = ALL_FIELDS.filter(k => k !== DEV_CATEGORY_FIELD);

// Merge additional labels from a JSON file bundled with the app (no network fetch)
export async function loadDataDictionary() {
  try {
    FIELD_LABELS = { ...FIELD_LABELS, ...(extraLabels as Record<string, string>) };
    ALL_FIELDS = Object.keys(FIELD_LABELS);
    NUMERIC_FIELDS = ALL_FIELDS.filter(k => k !== DEV_CATEGORY_FIELD);
  } catch {
    // ignore
  }
}
