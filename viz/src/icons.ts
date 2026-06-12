/**
 * Shared SVG icon asset URLs.
 *
 * Single source for icon constants that were previously re-declared across
 * modules. Vite resolves `new URL('./svg/...', import.meta.url)` relative to
 * this file (in src/), matching the original per-module resolution.
 */
export const FILTER_ICON = new URL('./svg/filters.svg', import.meta.url).href;
export const PIN_ICON = new URL('./svg/thumbtack.svg', import.meta.url).href;
export const PIN_ICON_TILTED = new URL('./svg/thumbtack-tilted.svg', import.meta.url).href;
export const EYE_ICON_OPEN = new URL('./svg/eye.svg', import.meta.url).href;
export const EYE_ICON_CLOSED = new URL('./svg/eye_closed.svg', import.meta.url).href;
export const CHART_ICON = new URL('./svg/chart.svg', import.meta.url).href;
export const SCATTER_ICON = new URL('./svg/scatter.svg', import.meta.url).href;
export const STREET_ICON = new URL('./svg/streets.svg', import.meta.url).href;
export const SATELLITE_ICON = new URL('./svg/globe.svg', import.meta.url).href;
export const RESIZE_ICON = new URL('./svg/expand.svg', import.meta.url).href;
