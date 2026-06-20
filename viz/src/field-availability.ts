import { isDesktopMode } from './runtime-mode.js';

/**
 * The fields a panel's field-picker should offer.
 *
 * In DESKTOP mode attributes are fetched on demand (lean columns), so the
 * currently-loaded features only carry the fields actually in use — filtering a
 * picker to "fields present on the loaded features" would wrongly hide the rest
 * of the schema. So in desktop we offer ALL chosen fields; selecting one then
 * triggers the on-demand re-fetch (see desktop-bootstrap `collectNeededFields`).
 *
 * In BROWSER mode behavior is unchanged: offer only fields actually present on
 * the loaded features (guards against columns the uploaded file doesn't have).
 */
export function fieldsForPicker(
  chosen: string[],
  fc: GeoJSON.FeatureCollection | null | undefined
): string[] {
  if (isDesktopMode()) return [...chosen];
  if (!fc?.features) return [];
  return chosen.filter((k) => fc.features.some((f) => f?.properties?.hasOwnProperty(k)));
}
