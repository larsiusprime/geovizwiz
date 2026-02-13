/**
 * Map rendering, color/visualization expression builders, and related helpers.
 * Extracted from main.ts — all modules import shared state via `S` from ./state.
 */
import maplibregl from 'maplibre-gl';
import type { Expression } from 'maplibre-gl';

import { S } from './state';
import type { LayerState, QualityMode, UpdateMode, MetricUnitKey } from './types';
import {
  COLOR_RAMPS, UNIT_TO_METERS,
  HEIGHT_CAP_METERS, HEIGHT_PCTL,
  SOURCE_ID, LAYER_ID, ERROR_LAYER_ID,
} from './config';
import { numOrNull, fmt, percentile, quantileBreaks } from './utils.number';
import { bbox } from './utils.geo';
import { applyMapFilters } from './filters';
import {
  clearLegendVisibility,
  updateFloatingLegend,
  applyExtrusionWithVisibility,
} from './legend';
import {
  getParcelId,
  addParcelToSelection, removeParcelFromSelection, clearAllSelections,
} from './selection';
import { fitBoundsInVisibleMapArea } from './map-viewport';

/* ------------------------------------------------------------------ */
/*  DOM element refs injected from main.ts via initRenderingElements  */
/* ------------------------------------------------------------------ */

let _fieldSelect: HTMLSelectElement = null!;
let _rampSelect: HTMLSelectElement = null!;
let _opacityInput: HTMLInputElement = null!;
let _multInput: HTMLInputElement = null!;
let _unitsSelect: HTMLSelectElement = null!;
let _extrusionOptions: HTMLFieldSetElement = null!;
let _colorRampOptions: HTMLFieldSetElement | null = null;
let _colorScalingOptions: HTMLFieldSetElement | null = null;
let _opacityOptions: HTMLFieldSetElement | null = null;
let _colorOptions: HTMLDivElement | null = null;
let _paintDividerNumeric: HTMLDivElement | null = null;
let _paintDividerCategorical: HTMLDivElement | null = null;
let _paintDividerRamp: HTMLDivElement | null = null;
let _paintDividerScaling: HTMLDivElement | null = null;

export type RenderingElements = {
  fieldSelect: HTMLSelectElement;
  rampSelect: HTMLSelectElement;
  opacityInput: HTMLInputElement;
  multInput: HTMLInputElement;
  unitsSelect: HTMLSelectElement;
  extrusionOptions: HTMLFieldSetElement;
  colorRampOptions: HTMLFieldSetElement | null;
  colorScalingOptions: HTMLFieldSetElement | null;
  opacityOptions: HTMLFieldSetElement | null;
  colorOptions: HTMLDivElement | null;
  paintDividerNumeric: HTMLDivElement | null;
  paintDividerCategorical: HTMLDivElement | null;
  paintDividerRamp: HTMLDivElement | null;
  paintDividerScaling: HTMLDivElement | null;
};

export function initRenderingElements(els: RenderingElements) {
  _fieldSelect = els.fieldSelect;
  _rampSelect = els.rampSelect;
  _opacityInput = els.opacityInput;
  _multInput = els.multInput;
  _unitsSelect = els.unitsSelect;
  _extrusionOptions = els.extrusionOptions;
  _colorRampOptions = els.colorRampOptions;
  _colorScalingOptions = els.colorScalingOptions;
  _opacityOptions = els.opacityOptions;
  _colorOptions = els.colorOptions;
  _paintDividerNumeric = els.paintDividerNumeric;
  _paintDividerCategorical = els.paintDividerCategorical;
  _paintDividerRamp = els.paintDividerRamp;
  _paintDividerScaling = els.paintDividerScaling;
}

/* ------------------------------------------------------------------ */
/*  Callbacks injected from main.ts via initRenderingCallbacks         */
/* ------------------------------------------------------------------ */

let _getCurrentLayer: () => LayerState | null = () => null;
let _getCurrentLayerIds: () => { sourceId: string; layerId: string; errorLayerId: string } | null = () => null;
let _setLayerVisibility: (layer: LayerState, visible: boolean) => void = () => {};
let _setCurrentLayer: (id: string) => void = () => {};
let _showRenderingToast: (msg?: string) => void = () => {};
let _hideRenderingToast: () => void = () => {};
let _awaitFirstRenderedFeature: (layerId: string) => void = () => {};
let _showPopup: (props: Record<string, any>, lngLat: maplibregl.LngLatLike, parcelId: string) => void = () => {};
let _buildPopupHTML: (props: Record<string, any>, parcelId: string) => string = () => '';
let _addPopupSearchFunctionality: () => void = () => {};
let _addPopupEditFunctionality: (parcelId: string) => void = () => {};
let _refreshInspectView: () => void = () => {};
let _updateCursor: () => void = () => {};
let _isTextInputElement: (el: Element | null) => boolean = () => false;
let _activateTool: (tool: string) => void = () => {};
let _setCompFinderSubject: (feature: GeoJSON.Feature, layerId: string) => void = () => {};
let _hotkeys: { PAN: string; SELECT: string; INFO: string; COMP_FINDER: string } = {
  PAN: 'h',
  SELECT: 'v',
  INFO: 'i',
  COMP_FINDER: 'c',
};

export type RenderingCallbacks = {
  getCurrentLayer: () => LayerState | null;
  getCurrentLayerIds: () => { sourceId: string; layerId: string; errorLayerId: string } | null;
  setLayerVisibility: (layer: LayerState, visible: boolean) => void;
  setCurrentLayer: (id: string) => void;
  showRenderingToast: (msg?: string) => void;
  hideRenderingToast: () => void;
  awaitFirstRenderedFeature: (layerId: string) => void;
  showPopup: (props: Record<string, any>, lngLat: maplibregl.LngLatLike, parcelId: string) => void;
  buildPopupHTML: (props: Record<string, any>, parcelId: string) => string;
  addPopupSearchFunctionality: () => void;
  addPopupEditFunctionality: (parcelId: string) => void;
  refreshInspectView?: () => void;
  updateCursor: () => void;
  isTextInputElement: (el: Element | null) => boolean;
  activateTool: (tool: string) => void;
  setCompFinderSubject: (feature: GeoJSON.Feature, layerId: string) => void;
  hotkeys: { PAN: string; SELECT: string; INFO: string; COMP_FINDER: string };
};

export function initRenderingCallbacks(cb: RenderingCallbacks) {
  _getCurrentLayer = cb.getCurrentLayer;
  _getCurrentLayerIds = cb.getCurrentLayerIds;
  _setLayerVisibility = cb.setLayerVisibility;
  _setCurrentLayer = cb.setCurrentLayer;
  _showRenderingToast = cb.showRenderingToast;
  _hideRenderingToast = cb.hideRenderingToast;
  _awaitFirstRenderedFeature = cb.awaitFirstRenderedFeature;
  _showPopup = cb.showPopup;
  _buildPopupHTML = cb.buildPopupHTML;
  _addPopupSearchFunctionality = cb.addPopupSearchFunctionality;
  _addPopupEditFunctionality = cb.addPopupEditFunctionality;
  _refreshInspectView = cb.refreshInspectView ?? (() => {});
  void _buildPopupHTML;
  void _addPopupSearchFunctionality;
  void _addPopupEditFunctionality;
  _updateCursor = cb.updateCursor;
  _isTextInputElement = cb.isTextInputElement;
  _activateTool = cb.activateTool;
  _setCompFinderSubject = cb.setCompFinderSubject;
  _hotkeys = cb.hotkeys;
}

/* ================================================================== */
/*  Accessor helpers (thin wrappers around injected DOM refs)          */
/* ================================================================== */

export function getMultiplierValue(): number {
  const rawMult = Number(_multInput.value);
  return Number.isFinite(rawMult) ? rawMult : 0;
}

export function getUnitFactor(): number {
  return UNIT_TO_METERS[_unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
}

export function getOpacityValue(): number {
  return parseFloat(_opacityInput.value);
}

export function getRampName(): string {
  return _rampSelect?.value ?? 'Viridis';
}

/* ================================================================== */
/*  Map layer management                                               */
/* ================================================================== */

export function ensureErrorLayer(layer: LayerState) {
  if (S.map.getLayer(layer.errorLayerId)) return;
  S.map.addLayer({
    id: layer.errorLayerId,
    type: 'line',
    source: layer.sourceId,
    paint: {
      'line-color': '#ff3b30',          // red outline
      'line-width': 1.5,
      'line-dasharray': [1, 1.3],
      'line-opacity': 0.9
    }
  });
  // keep it above extrusions for visibility
  try { S.map.moveLayer(layer.errorLayerId); } catch {}
  _setLayerVisibility(layer, layer.visible);
}

export function updateErrorLayer() {
  const layer = _getCurrentLayer();
  if (!layer || !S.map.getSource(layer.sourceId)) return;
  ensureErrorLayer(layer);

  let filter: any = ['==', ['literal', 1], 2]; // matches nothing by default

  if (S.normalizationMode === 'perLand' && S.landSizeField) {
    // land invalid when ≤ 0  (zero not allowed)
    filter = ['<=', ['to-number', ['get', S.landSizeField]], 0];
  } else if (S.normalizationMode === 'perBuilding' && S.bldgSizeField) {
    // building invalid when negative (zero is allowed and not flagged)
    filter = ['<', ['to-number', ['get', S.bldgSizeField]], 0];
  }

  S.map.setFilter(layer.errorLayerId, filter);
}

export function addOrUpdateSource(fc: GeoJSON.FeatureCollection) {
  const layer = _getCurrentLayer();
  if (!layer) return;
  _showRenderingToast('Geometry is rendering');
  const existing = S.map.getSource(layer.sourceId) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
  } else {
    S.map.addSource(layer.sourceId, { type: 'geojson', data: fc });
    addExtrusionLayer(layer);
  }
  _awaitFirstRenderedFeature(layer.layerId);
}

let keyHandlersInstalled = false;


function polygonCentroid(ring: number[][]): [number, number] | null {
  if (ring.length < 3) return null;
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = (x0 * y1) - (x1 * y0);
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area2) < 1e-12) return null;
  return [cx / (3 * area2), cy / (3 * area2)];
}

function getFeatureInspectFocusLngLat(feature: GeoJSON.Feature, fallback: maplibregl.LngLat): maplibregl.LngLatLike {
  const geom = feature.geometry;
  if (!geom) return fallback;

  if (geom.type === 'Polygon') {
    const centroid = polygonCentroid((geom.coordinates?.[0] ?? []) as number[][]);
    if (centroid) return centroid as [number, number];
  }

  if (geom.type === 'MultiPolygon') {
    let best: { area: number; centroid: [number, number] } | null = null;
    for (const poly of geom.coordinates as number[][][][]) {
      const ring = poly?.[0] ?? [];
      const centroid = polygonCentroid(ring as number[][]);
      if (!centroid) continue;
      let area = 0;
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        area += (x0 * y1) - (x1 * y0);
      }
      const absArea = Math.abs(area);
      if (!best || absArea > best.area) {
        best = { area: absArea, centroid };
      }
    }
    if (best) return best.centroid;
  }

  const bounds = bbox({ type: 'FeatureCollection', features: [feature] });
  if (bounds) {
    return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] as [number, number];
  }
  return fallback;
}

export function addExtrusionLayer(layer: LayerState) {
  if (S.map.getLayer(layer.layerId)) return;
  S.map.addLayer({
    id: layer.layerId, type: 'fill-extrusion', source: layer.sourceId,
    paint: {
      'fill-extrusion-color': '#888',
      'fill-extrusion-height': 0,
      'fill-extrusion-opacity': parseFloat(_opacityInput.value),
      'fill-extrusion-vertical-gradient': true
    }
  });
  _setLayerVisibility(layer, layer.visible);

  // NEW: parcel selection and inspection
  S.map.on('click', layer.layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    if (S.currentLayerId !== layer.id) {
      _setCurrentLayer(layer.id);
    }

    // Handle info tool
    if (S.isInfoToolActive) {
      const props = (f.properties || {}) as Record<string, any>;
      const parcelId = getParcelId(f);
      const focusLngLat = getFeatureInspectFocusLngLat(f as GeoJSON.Feature, e.lngLat);
      _showPopup(props, focusLngLat, parcelId);
      return;
    }

    if (S.isCompFinderToolActive) {
      _setCompFinderSubject(f, layer.id);
      return;
    }

    // Handle selection tools
    if (S.currentSelectionMode === 'select-one') {
      // Handle different click modes
      if (e.originalEvent.shiftKey) {
        // Shift-click: always add to selection
        addParcelToSelection(f);
      } else if (e.originalEvent.altKey) {
        // Alt-click: always remove from selection
        removeParcelFromSelection(f);
      } else {
        // Regular left-click: select only this parcel, unselect all others
        clearAllSelections();
        addParcelToSelection(f);
      }
    }
  });

  // Right-click to close popup
  S.map.on('contextmenu', layer.layerId, (e) => {
    if (S.activePopup) {
      S.activePopup.remove();
      S.activePopup = null;
      S.lastPicked = null;
      if (S.inspectFocusMarker) { S.inspectFocusMarker.remove(); S.inspectFocusMarker = null; }
    }
  });

  S.map.on('mouseenter', layer.layerId, () => {
    if (S.isInfoToolActive) {
      S.map.getCanvas().style.cursor = 'pointer';
    }
  });
  S.map.on('mouseleave', layer.layerId, () => {
    _updateCursor();
  });

  // Keyboard event handling
  if (!keyHandlersInstalled) {
    document.addEventListener('keydown', (e) => {
      // ESC key to close popup
      if (e.key === 'Escape' && S.activePopup) {
        S.activePopup.remove();
        S.activePopup = null;
        S.lastPicked = null;
        if (S.inspectFocusMarker) { S.inspectFocusMarker.remove(); S.inspectFocusMarker = null; }
      }

      const activeElement = document.activeElement;
      if (_isTextInputElement(activeElement) || _isTextInputElement(e.target as Element | null)) {
        return;
      }

      // Hotkey handling
      const key = e.key.toLowerCase();
      if (key === _hotkeys.PAN) {
        e.preventDefault();
        _activateTool('pan');
      } else if (key === _hotkeys.SELECT) {
        e.preventDefault();
        _activateTool('select');
      } else if (key === _hotkeys.INFO) {
        e.preventDefault();
        _activateTool('info');
      } else if (key === _hotkeys.COMP_FINDER) {
        e.preventDefault();
        _activateTool('comp-finder');
      }
    });
    keyHandlersInstalled = true;
  }

  ensureErrorLayer(layer);
}

/* ================================================================== */
/*  Color / expression builders                                        */
/* ================================================================== */

export function buildValueExpression(): Expression {
  if (!S.currentField) return ['literal', 0] as any;
  const base: Expression = ['to-number', ['get', S.currentField]] as any;

  if (S.normalizationMode === 'perLand' && S.landSizeField) {
    const den: Expression = ['to-number', ['get', S.landSizeField]] as any;
    // Land invalid when ≤ 0 => height 0 (flat); outline layer will flag it.
    return ['case',
      ['<=', den, 0], 0,
      ['/', base, den]
    ] as any;
  }

  if (S.normalizationMode === 'perBuilding' && S.bldgSizeField) {
    const den: Expression = ['to-number', ['get', S.bldgSizeField]] as any;
    // Building invalid when < 0 => height 0 (flat) and flagged.
    // Building == 0 is allowed conceptually (no building) but we can't divide by 0 => also 0 height (not flagged).
    return ['case',
      ['<', den, 0], 0,
      ['==', den, 0], 0,
      ['/', base, den]
    ] as any;
  }

  return base;
}

/**
 * Pseudo-random, bright, saturated color for item `n` out of `max_n`, seeded by `seed`.
 * - Successive n are far apart via a coprime "golden step" permutation mod max_n
 * - High saturation & mid/high lightness for vivid, easy-to-tell-apart colors
 * - Deterministic across runs for the same (n, max_n, seed)
 */
export function generatePseudoRandomColor(n: number, max_n: number, seed: string): string {
  if (max_n <= 0) throw new Error("max_n must be > 0");

  // --- small helpers ---
  const frac = (x: number) => x - Math.floor(x);
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const gcd = (a: number, b: number): number => {
    a = Math.abs(a) | 0;
    b = Math.abs(b) | 0;
    while (b !== 0) {
      const t = a % b;
      a = b; b = t;
    }
    return a || 1;
  };

  // FNV-1a 32-bit string hash -> uint32
  const fnv1a = (str: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };

  // One-shot 32-bit mix -> [0,1)
  const rand01 = (seedHash: number, i: number, salt: number): number => {
    // Murmur-ish finalizer chain
    let x = (seedHash ^ Math.imul(i + 0x9e3779b1, 0x85ebca6b) ^ salt) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return (x >>> 0) / 0x100000000;
  };

  // HSL -> RGB [0..255] integers
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    h = frac(h); s = clamp01(s); l = clamp01(l);
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t: number) => {
      t = frac(t);
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const r = Math.round(hue2rgb(h + 1/3) * 255);
    const g = Math.round(hue2rgb(h) * 255);
    const b = Math.round(hue2rgb(h - 1/3) * 255);
    return [r, g, b];
  };

  // --- core logic ---
  const hash = fnv1a(seed);

  // Permute index with a "golden step" that is coprime to max_n
  // This spreads nearby n far apart around the hue wheel.
  const phi = 0.618033988749895; // golden ratio conjugate
  let step = Math.floor(max_n * phi) || 1;
  // ensure step and max_n are coprime for a full cycle permutation
  while (gcd(step, max_n) !== 1) step = (step + 1) % max_n || 1;

  const start = hash % Math.max(1, max_n); // seed-dependent start
  const idx = ((start + (n % max_n + max_n) % max_n * step) % max_n) >>> 0;

  // Hue: uniformly cover [0,1) with a seed offset; center of each "bin" to avoid overlaps
  const hOffset = ((hash >>> 8) & 0xFFFFFF) / 0x1000000; // [0,1)
  const h = frac(hOffset + (idx + 0.5) / max_n);

  // Keep colors vivid: high S, mid/high L with tiny seed+index jitter for variety
  const s = 0.45 + 0.10 * rand01(hash, idx, 0xA8F1);
  const l = 0.56 + 0.16 * (rand01(hash, idx, 0xC0FFEE) - 0.5);

  const [r, g, b] = hslToRgb(h, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}


export function buildCategoricalColorPairs(): Array<[string, string]> {
  if (!S.currentField || !S.currentGeoJSON) return [];

  // Collect unique categories
  const categories = new Set<string>();
  for (const feature of S.currentGeoJSON.features) {
    const value = feature.properties?.[S.currentField];
    if (value != null && value !== '' && value !== undefined) {
      categories.add(String(value));
    }
  }

  const sortedCategories = Array.from(categories).sort();

  if (sortedCategories.length === 0) {
    return [];
  }

  const pairs: Array<[string, string]> = [];

  if (S.categoricalColorMode === 'single') {
    // Single color mode: map empty string to the single color
    pairs.push(['', S.singleColorValue]);
  } else if (S.categoricalColorMode === 'colorRamp') {
    // Color ramp: sort categories alphabetically and assign colors linearly
    const ramp = COLOR_RAMPS[_rampSelect.value] || COLOR_RAMPS['Viridis'];
    const denom = Math.max(1, sortedCategories.length - 1);

    for (let i = 0; i < sortedCategories.length; i++) {
      const category = sortedCategories[i];
      const colorIndex = Math.round((i / denom) * (ramp.length - 1));
      const color = ramp[colorIndex];
      pairs.push([category, color]);
    }
  } else {
    // Random colors mode
    for (let i = 0; i < sortedCategories.length; i++) {
      const category = sortedCategories[i];
      const color = generatePseudoRandomColor(i, sortedCategories.length, "my-random-seed");
      pairs.push([category, color]);
    }
  }

  // Apply custom colors if they exist
  const finalPairs: any[] = [];
  for (const [category, defaultColor] of pairs) {
    const color = S.customColors.has(category) ? S.customColors.get(category)! : defaultColor;
    finalPairs.push([category, color]);
  }

  return finalPairs;
}

export function buildCategoricalColorExpression(): Expression {
  if (!S.currentField || !S.currentGeoJSON) return ['literal', '#888'] as any;

  // Get the base color pairs from the inner function
  const pairs = buildCategoricalColorPairs();
  // flatten pairs into an array of strings
  let fallbackColor = '#888';
  if (S.categoricalColorMode === 'single') {
    fallbackColor = S.singleColorValue;
  }

  if (S.customColors.size === 0) {
    if (pairs.length === 0) {
      return ['literal', '#888'] as any;
    }
    if (S.categoricalColorMode === 'single') {
      return ['literal', fallbackColor] as any;
    }
  }
  const val = ['to-string', ['coalesce', ['get', S.currentField], '']] as any;

  // Build the final expression with fallback
  const flattenedPairs = pairs.flat();
  const baseResult = ['case',
    ['==', val, ''], fallbackColor,
    ['match', val, ...flattenedPairs, fallbackColor]
  ] as any;

  // Add highlighting for selected parcels
  const result = ['case',
    ['boolean', ['feature-state', 'selected'], false], S.highlightColor,
    baseResult
  ] as any;

  return result;
}

export function buildNumericColorRanges(): Array<{ min: number; max: number; color: string; rangeKey: string }> {
  if (!S.currentField || !S.currentGeoJSON || !S.currentStats) return [];

  const ramp = COLOR_RAMPS[_rampSelect.value] || COLOR_RAMPS['Viridis'];
  let ranges: Array<{ min: number; max: number; color: string; rangeKey: string }> = [];

  if (S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length) {
    // Use quantile breaks for ranges
    const breaks = [S.currentStats.min, ...S.colorBreaks, S.currentStats.max];
    for (let i = 0; i < breaks.length - 1; i++) {
      const min = breaks[i];
      const max = breaks[i + 1];
      const rangeKey = `range_${i}`;
      const defaultColor = ramp[Math.min(i, ramp.length - 1)];
      const color = S.customColors.get(rangeKey) || defaultColor;
      ranges.push({ min, max, color, rangeKey });
    }
  } else {
    // Linear intervals - create 10 ranges
    const min = S.currentStats.min;
    const max = S.currentStats.max;
    const step = (max - min) / 10;

    for (let i = 0; i < 10; i++) {
      const rangeMin = min + (step * i);
      const rangeMax = i === 9 ? max : min + (step * (i + 1));
      const rangeKey = `range_${i}`;
      const colorIndex = Math.floor((i / 9) * (ramp.length - 1));
      const defaultColor = ramp[colorIndex];
      const color = S.customColors.get(rangeKey) || defaultColor;
      ranges.push({ min: rangeMin, max: rangeMax, color, rangeKey });
    }
  }

  return ranges;
}

export function buildNumericColorExpression(): Expression {
  if (!S.currentField || !S.currentGeoJSON || !S.currentStats) return ['literal', '#888'] as any;

  const ranges = buildNumericColorRanges();
  if (ranges.length === 0) {
    return ['literal', '#888'] as any;
  }

  const valueExpr = buildValueExpression();

  // Build a step expression with the ranges
  const cases: any[] = ['case'];

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (i === ranges.length - 1) {
      // Last range includes the max value
      cases.push(['all',
        ['>=', valueExpr, range.min],
        ['<=', valueExpr, range.max]
      ], ['literal', range.color]);
    } else {
      cases.push(['all',
        ['>=', valueExpr, range.min],
        ['<', valueExpr, range.max]
      ], ['literal', range.color]);
    }
  }

  // Default color
  cases.push(['literal', '#888']);

  // Add highlighting for selected parcels
  const baseResult = cases as any;
  const result = ['case',
    ['boolean', ['feature-state', 'selected'], false], S.highlightColor,
    baseResult
  ] as any;

  return result;
}

// Build a step expression: first color is < break1, then each break raises the color.
export function makeStepColorExpression(valueExpr: Expression, colors: string[], breaks: number[]): Expression {
  const c = colors.slice();                 // copy
  const b = breaks.slice();                 // copy
  if (b.length === 0) return ['step', valueExpr, c[0]] as any;

  const out: (string | number | Expression)[] = ['step', valueExpr, c[0]];
  // pair up thresholds with subsequent colors
  for (let i = 0; i < b.length && i + 1 < c.length; i++) {
    out.push(b[i], c[i + 1]);
  }
  return out as any;
}

export function makeColorExpressionFromExpr(valueExpr: Expression, colors: string[], min: number, max: number): Expression {
  const n = colors.length - 1;
  const stops: (number | string)[] = [];
  for (let i = 0; i < colors.length; i++) {
    const t = i / n;
    stops.push(min + t * (max - min), colors[i]);
  }
  // Clamp value into [min,max] to avoid outliers crushing the ramp
  const clamped: Expression = ['max', min, ['min', max, valueExpr]] as any;
  return ['interpolate', ['linear'], clamped, ...stops] as any;
}

/* ================================================================== */
/*  Rendering application                                              */
/* ================================================================== */

export function applyGrayRendering() {
  if (!S.currentGeoJSON) return;
  const ids = _getCurrentLayerIds();
  if (!ids) return;

  // Apply gray color and no extrusion when no field is selected
  S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', '#888');
  S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
  S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(_opacityInput.value));

  applyMapFilters();

  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (S.lastPicked) _refreshInspectView();
}

export function applyExtrusion() {
  if (!S.currentGeoJSON) return;
  const ids = _getCurrentLayerIds();
  if (!ids) return;

  // If no field is selected, apply gray rendering
  if (!S.currentField) {
    applyGrayRendering();
    return;
  }

  if (S.currentFieldType === 'categorical') {
    // For categorical fields, no extrusion - just color
    const colorExpr = buildCategoricalColorExpression();

    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(_opacityInput.value));
  } else {
    // For numeric fields, use the new color expression builder
    const colorExpr = buildNumericColorExpression();
    const valueExpr = buildValueExpression();

    const rawMult = Number(_multInput.value);
    const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
    const unitFactor = UNIT_TO_METERS[_unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
    const heightExpr: Expression = S.is3DMode ? ['*', valueExpr, multiplier * unitFactor] as any : 0;

    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', heightExpr);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(_opacityInput.value));
  }

  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (S.lastPicked) _refreshInspectView();
}

export function fitToData(fc: GeoJSON.FeatureCollection) {
  const b = bbox(fc); if (!b) return;
  fitBoundsInVisibleMapArea([[b[0], b[1]], [b[2], b[3]]], { inset: 16, duration: 800 });
}

const FAST_PR = window.devicePixelRatio;                  // normal speed
const HIGH_PR = Math.min(3, window.devicePixelRatio * 2); // 2-3x is a good HQ target

// ---- Quality toggle (runtime supersampling) ----
export function setQuality(mode: QualityMode) {
  S.qualityMode = mode;
  const pr = (mode === 'high') ? HIGH_PR : FAST_PR;

  // setPixelRatio is available on MapLibre >= 2; fall back with a warn otherwise
  const anyMap = S.map as any;
  if (typeof anyMap.setPixelRatio === 'function') {
    anyMap.setPixelRatio(pr);
    S.map.resize(); // apply immediately
    // optional debug of effective value (after clamping)
    if (typeof anyMap.getPixelRatio === 'function') {
      console.debug('pixelRatio applied:', anyMap.getPixelRatio());
    }
  } else {
    console.warn('setPixelRatio() not available in this MapLibre build; toggle requires recreating the map.');
  }

  // reflect in UI button, if present
  const btn = document.getElementById('btn-quality') as HTMLButtonElement | null;
  if (btn) btn.textContent = (mode === 'high') ? 'Quality: High' : 'Quality: Fast';
}

/* ================================================================== */
/*  Visualization helpers                                              */
/* ================================================================== */

export function computeDisplayedMetricFromProps(props: Record<string, any>): number | null {
  if (!S.currentField) return null;
  let base = numOrNull(props[S.currentField]);
  if (base == null) return null;

  if (S.normalizationMode === 'perLand' && S.landSizeField) {
    const d = numOrNull(props[S.landSizeField]);
    if (d == null || d <= 0) return null;
    base = base / d;
  } else if (S.normalizationMode === 'perBuilding' && S.bldgSizeField) {
    const d = numOrNull(props[S.bldgSizeField]);
    if (d == null || d <= 0) return null;
    base = base / d;
  }
  return base;
}

export function computeExtrusionHeightMeters(metricValue: number): number {
  const unitFactor = UNIT_TO_METERS[_unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
  const mult = Number(_multInput.value);
  const multiplier = Number.isFinite(mult) ? mult : 0;
  return metricValue * multiplier * unitFactor;
}

// Queue an update; newer calls replace older ones.
export function scheduleUpdate(mode: UpdateMode, refreshLegend = false, debounceMs = 80) {
  if (!S.currentGeoJSON) return;   // <- hard stop until data exists

  S._pendingMode = mode;
  S._pendingRefreshLegend = refreshLegend;
  if (S._updTimer) clearTimeout(S._updTimer);
  S._updTimer = window.setTimeout(() => {
    S._updTimer = null;
    // Clear legend visibility when refreshing colorization
    if (S._pendingRefreshLegend) {
      clearLegendVisibility();
    }

    if (S._pendingMode === 'recomputeAndAutoScale') {
      computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL);
      if (S._pendingRefreshLegend) {
        updateFloatingLegend();
      }
    } else {
      applyExtrusionWithVisibility();
      if (S._pendingRefreshLegend) {
        updateFloatingLegend();
      }
    }
  }, debounceMs);
}

export function chooseBestMetricUnitForMultiplier(p99: number, capMeters = 1000): { unit: MetricUnitKey; multiplier: number } {
  const candidates: MetricUnitKey[] = ['centimeters', 'meters', 'kilometers'];
  const RANGE_MIN = 1, RANGE_MAX = 100;

  let best = { unit: 'centimeters' as MetricUnitKey, multiplier: Infinity, score: Infinity };

  for (const u of candidates) {
    const unitFactor = UNIT_TO_METERS[u]; // meters per unit
    const mult = capMeters / (unitFactor * p99);

    const inRange = mult >= RANGE_MIN && mult <= RANGE_MAX;
    const distToRange = inRange ? 0 : Math.min(Math.abs(mult - RANGE_MIN), Math.abs(mult - RANGE_MAX));
    const tieBias = Math.abs(Math.log10(Math.max(1e-12, mult)) - 1); // prefer closer to ~10 if inside

    // Primary: be inside [1,100]; Secondary: closer to the band; Tertiary: closer to 10 within the band
    const score = (inRange ? 0 : 1) * 1e6 + distToRange * 1e3 + (inRange ? tieBias : 0);

    if (score < best.score) best = { unit: u, multiplier: mult, score };
  }
  return { unit: best.unit, multiplier: best.multiplier };
}

export function populateFieldDropdownFromList(list: string[]) {
  _fieldSelect.replaceChildren();
  if (!list.length) _fieldSelect.append(new Option('No fields selected', ''));
  else {
    _fieldSelect.append(new Option('— choose —', ''));
    for (const n of list) _fieldSelect.append(new Option(n, n));
  }
}

export function detectNumericFieldsFromFeatures(features: GeoJSON.Feature[]): string[] {
  const counts: Record<string, number> = {}, nums: Record<string, number> = {};
  const isNumLike = (v: any) =>
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

  for (const f of features) {
    const p = (f.properties || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      counts[k] = (counts[k] ?? 0) + 1;
      if (isNumLike(v)) nums[k] = (nums[k] ?? 0) + 1;
    }
  }
  return Object.keys(counts)
    .filter(k => (nums[k] ?? 0) >= Math.max(1, Math.ceil(0.6 * (counts[k] || 0))))
    .sort();
}


export function getNumericValuesNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding'): number[] {
  const vals: number[] = [];
  for (const f of fc.features) {
    const p = (f.properties as any) || {};
    let base = Number(p?.[field]);
    if (!Number.isFinite(base)) continue;

    if (mode === 'perLand' && S.landSizeField) {
      const d = Number(p?.[S.landSizeField]);
      if (!Number.isFinite(d) || d <= 0) continue;
      base = base / d;
    } else if (mode === 'perBuilding' && S.bldgSizeField) {
      const d = Number(p?.[S.bldgSizeField]);
      if (!Number.isFinite(d) || d <= 0) continue;
      base = base / d;
    }
    vals.push(base);
  }
  return vals;
}

export function computeStatsNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding') {
  const vals = getNumericValuesNormalized(fc, field, mode);
  let min = Infinity, max = -Infinity;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) { min = 0; max = min + 1; }
  return { min, max };
}

// Auto-multiplier so p-th percentile reaches capMeters, in given units
export function computeAndApplyAutoMultiplier(
  unitsKeyOrAuto: 'auto' | keyof typeof UNIT_TO_METERS = 'auto',
  capMeters = 1000,
  p = 99
) {
  if (!S.currentGeoJSON || !S.currentField) return;

  // values for the CURRENT normalization mode
  const vals = getNumericValuesNormalized(S.currentGeoJSON, S.currentField, S.normalizationMode);
  const pVal = percentile(vals, p);
  if (!Number.isFinite(pVal) || pVal <= 0) return;

  // ---- Color domain / breaks ----
  if (S.colorMode === 'quantiles') {
    const ramp = COLOR_RAMPS[_rampSelect.value] || COLOR_RAMPS['Viridis'];
    S.colorBreaks = quantileBreaks(vals, ramp.length, 1, 99); // p1..p99 equal-frequency bins
    S.colorDomain = null;
  } else {
    // continuous = EQUAL INTERVAL classes across p1..p99
    const ramp = COLOR_RAMPS[_rampSelect.value] || COLOR_RAMPS['Viridis'];
    const pLow = percentile(vals, 1);
    const pHigh = percentile(vals, 99);
    let lo = Number.isFinite(pLow) ? pLow : 0;
    let hi = Number.isFinite(pHigh) ? pHigh : 1;
    if (!(hi > lo)) { lo = 0; hi = 1; }
    S.colorDomain = { lo, hi, label: 'p1\u2013p99' };

    // build equal-interval thresholds: colors => k classes => k-1 breaks
    const classes = Math.max(2, ramp.length);
    const step = (hi - lo) / classes;
    const breaks: number[] = [];
    for (let i = 1; i < classes; i++) breaks.push(lo + step * i);
    S.colorBreaks = breaks;
  }

  // ---- Height autoscale: anchor p-th percentile to capMeters ----
  let unitKey: keyof typeof UNIT_TO_METERS;
  let multiplier: number;
  if (unitsKeyOrAuto === 'auto') {
    const best = chooseBestMetricUnitForMultiplier(pVal, capMeters);
    unitKey = best.unit;
    multiplier = best.multiplier;
  } else {
    unitKey = unitsKeyOrAuto;
    const unitFactor = UNIT_TO_METERS[unitKey];
    multiplier = capMeters / (unitFactor * pVal);
  }

  _unitsSelect.value = unitKey;
  _multInput.value = String(multiplier);

  // stats for legend fallback
  S.currentStats = computeStatsNormalized(S.currentGeoJSON, S.currentField, S.normalizationMode);

  console.debug('autoScale', {
    mode: S.normalizationMode,
    field: S.currentField,
    pctl: p,
    pVal,
    unit: unitKey,
    multiplier,
    colorMode: S.colorMode,
    colorBreaks: S.colorBreaks,
    colorDomain: S.colorDomain,
    stats: S.currentStats
  });

  applyExtrusionWithVisibility();
}

/* ================================================================== */
/*  Camera presets                                                     */
/* ================================================================== */

export function setPerspective() { S.map.easeTo({ pitch: 60, duration: 600 }); }
export function setOrtho() { S.map.easeTo({ pitch: 0, duration: 600 }); }
export function setView(which: string) {
  const views: Record<string, Partial<maplibregl.CameraOptions>> = {
    top: { pitch: 0, bearing: 0 }, perspective: { pitch: 60, bearing: -30 },
    north: { pitch: 60, bearing: 0 }, east: { pitch: 60, bearing: 90 },
    south: { pitch: 60, bearing: 180 }, west: { pitch: 60, bearing: 270 }
  };
  S.map.easeTo({ duration: 700, ...(views[which] || views.perspective) });
}

/* ================================================================== */
/*  UI helpers                                                         */
/* ================================================================== */

export function update3DUI() {
  if (S.currentFieldType === 'numeric') {
    _extrusionOptions.style.display = S.is3DMode ? 'grid' : 'none';
  } else {
    _extrusionOptions.style.display = 'none';
  }
}

export function updateFieldTypeUI() {
  const numericOptions = document.getElementById('numericOptions');
  const categoricalOptions = document.getElementById('categoricalOptions');

  if (!S.currentField) {
    // Hide all options when no field is selected
    if (numericOptions) numericOptions.style.display = 'none';
    if (categoricalOptions) categoricalOptions.style.display = 'none';
    if (_colorOptions) _colorOptions.style.display = 'none';
    if (_colorRampOptions) _colorRampOptions.style.display = 'none';
    if (_colorScalingOptions) _colorScalingOptions.style.display = 'none';
    if (_opacityOptions) _opacityOptions.style.display = 'none';
    if (_paintDividerNumeric) _paintDividerNumeric.style.display = 'none';
    if (_paintDividerCategorical) _paintDividerCategorical.style.display = 'none';
    if (_paintDividerRamp) _paintDividerRamp.style.display = 'none';
    if (_paintDividerScaling) _paintDividerScaling.style.display = 'none';
    _extrusionOptions.style.display = 'none';
  } else {
    const showNumericOptions = S.currentFieldType === 'numeric';
    const showCategoricalOptions = S.currentFieldType === 'categorical';
    const showColorRampOptions = showNumericOptions || (showCategoricalOptions && S.categoricalColorMode === 'colorRamp');
    const showColorScalingOptions = showNumericOptions;
    const showOpacityOptions = true;

    if (_colorRampOptions) _colorRampOptions.style.display = showColorRampOptions ? 'grid' : 'none';
    if (_colorScalingOptions) _colorScalingOptions.style.display = showColorScalingOptions ? 'grid' : 'none';
    if (_opacityOptions) _opacityOptions.style.display = showOpacityOptions ? 'grid' : 'none';

    if (showNumericOptions) {
      if (numericOptions) numericOptions.style.display = 'grid';
      if (categoricalOptions) categoricalOptions.style.display = 'none';
      if (_colorOptions) _colorOptions.style.display = 'none';
      update3DUI(); // This will show/hide extrusion options based on 3D mode
    } else if (showCategoricalOptions) {
      if (numericOptions) numericOptions.style.display = 'none';
      if (categoricalOptions) categoricalOptions.style.display = 'grid';
      if (_colorOptions) _colorOptions.style.display = 'none';
      _extrusionOptions.style.display = 'none';

      // Show/hide color options based on selected mode
      if (_colorOptions) {
        _colorOptions.style.display = S.categoricalColorMode === 'single' ? 'block' : 'none';
      }
    }

    const sectionVisibility = [
      showNumericOptions,
      showCategoricalOptions,
      showColorRampOptions,
      showColorScalingOptions,
      showOpacityOptions
    ];
    const dividers = [_paintDividerNumeric, _paintDividerCategorical, _paintDividerRamp, _paintDividerScaling];
    dividers.forEach((divider, index) => {
      if (!divider) return;
      const hasPrev = sectionVisibility[index];
      const hasNext = sectionVisibility.slice(index + 1).some(Boolean);
      divider.style.display = hasPrev && hasNext ? 'block' : 'none';
    });
  }
}
