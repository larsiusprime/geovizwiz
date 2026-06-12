/**
 * Shared SVG icon asset URLs.
 *
 * Centralizes icon constants that were previously re-declared in multiple
 * modules. Vite resolves `new URL('./svg/...', import.meta.url)` relative to
 * this file (in src/), matching the original per-module resolution.
 */
export const FILTER_ICON = new URL('./svg/filters.svg', import.meta.url).href;
