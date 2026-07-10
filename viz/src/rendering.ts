/**
 * Map rendering, color/visualization expression builders, and related helpers.
 * Extracted from main.ts — all modules import shared state via `S` from ./state.
 */
import maplibregl from 'maplibre-gl';
import type { Expression } from 'maplibre-gl';

import { S } from './state';
import type { LayerState, QualityMode, UpdateMode, MetricUnitKey } from './types';
import { ParcelsService } from "@civil-labs/civil-api-js";
import enTranslations from '../locales/en.json';
import esTranslations from '../locales/es.json';

function getLocalizedFieldName(field: string): string {
  const lang = (localStorage.getItem('language') || 'en').split('-')[0].toLowerCase();
  const translations: Record<string, Record<string, string>> = {
    en: enTranslations,
    es: esTranslations
  };
  const langDict = translations[lang] || translations['en'];
  return langDict[field] || field;
}
import { getCivilClient } from "./civil-integration";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  COLOR_RAMPS, UNIT_TO_METERS,
  HEIGHT_CAP_METERS, HEIGHT_PCTL,
} from './config';
import { numOrNull, percentile, quantileBreaks } from './utils.number';
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
  getActiveDataStore,
} from './selection';
import { fitBoundsInVisibleMapArea } from './map-viewport';
import { refreshWindowMinHeight } from './windows';
import { controlsEl } from './dom-refs';
import {
  polygonCentroid, generatePseudoRandomColor, makeStepColorExpression, makeColorExpressionFromExpr, detectNumericFieldsFromFeatures, getNumericValuesNormalized, computeStatsNormalized, normalizedValueExpression,
} from './rendering-helpers';
// Re-exported for modules that historically imported these from ./rendering:
export {
  generatePseudoRandomColor, makeStepColorExpression, makeColorExpressionFromExpr, detectNumericFieldsFromFeatures, getNumericValuesNormalized, computeStatsNormalized,
};

/* ------------------------------------------------------------------ */
/*  DOM element refs — imported directly from dom-refs.                 */
/* ------------------------------------------------------------------ */

import {
  fieldSelect as _fieldSelect,
  rampSelect as _rampSelect,
  opacityInput as _opacityInput,
  multInput as _multInput,
  unitsSelect as _unitsSelect,
  hexResRow as _hexResRow,
  threeDSection as _threeDSection,
  enable3DRow as _enable3DRow,
  colorRampOptions as _colorRampOptions,
  colorScalingOptions as _colorScalingOptions,
  opacityOptions as _opacityOptions,
  colorOptions as _colorOptions,
  paintDividerNumeric as _paintDividerNumeric,
  paintDividerCategorical as _paintDividerCategorical,
  paintDividerRamp as _paintDividerRamp,
  paintDividerScaling as _paintDividerScaling,
} from './dom-refs';

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
// Direct imports (formerly callback seams). toolbar/utils.dom/comp-finder are
// near-leaf here (none imports rendering), so these are cycle-free. Aliased to
// the _names to leave call sites unchanged.
import { updateCursor as _updateCursor, activateTool, HOTKEYS as _hotkeys } from './toolbar';
import { isTextInputElement as _isTextInputElement } from './utils.dom';
import { setCompFinderSubject as _setCompFinderSubject } from './comp-finder';
// activateTool takes a tool-union; keep the string→union cast the seam had.
const _activateTool = (tool: string) => activateTool(tool as 'pan' | 'info' | 'select' | 'comp-finder' | 'write');

export type RenderingCallbacks = {
  getCurrentLayer: () => LayerState | null;
  getCurrentLayerIds: () => { sourceId: string; layerId: string; errorLayerId: string } | null;
  setLayerVisibility: (layer: LayerState, visible: boolean) => void;
  setCurrentLayer: (id: string) => void;
  showRenderingToast: (msg?: string) => void;
  hideRenderingToast?: () => void;
  awaitFirstRenderedFeature: (layerId: string) => void;
  showPopup: (props: Record<string, any>, lngLat: maplibregl.LngLatLike, parcelId: string) => void;
  buildPopupHTML: (props: Record<string, any>, parcelId: string) => string;
  addPopupSearchFunctionality: () => void;
  addPopupEditFunctionality: (parcelId: string) => void;
  refreshInspectView?: () => void;
};

export function initRenderingCallbacks(cb: RenderingCallbacks) {
  _getCurrentLayer = cb.getCurrentLayer;
  _getCurrentLayerIds = cb.getCurrentLayerIds;
  _setLayerVisibility = cb.setLayerVisibility;
  _setCurrentLayer = cb.setCurrentLayer;
  _showRenderingToast = cb.showRenderingToast;
  _hideRenderingToast = cb.hideRenderingToast ?? (() => {});
  _awaitFirstRenderedFeature = cb.awaitFirstRenderedFeature;
  _showPopup = cb.showPopup;
  _buildPopupHTML = cb.buildPopupHTML;
  _addPopupSearchFunctionality = cb.addPopupSearchFunctionality;
  _addPopupEditFunctionality = cb.addPopupEditFunctionality;
  _refreshInspectView = cb.refreshInspectView ?? (() => {});
  void _buildPopupHTML;
  void _addPopupSearchFunctionality;
  void _addPopupEditFunctionality;
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
  return _rampSelect?.value ?? 'Magma';
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

  // Hex summary features have no land/building size field — never flag them.
  if (S.hexMode && S.hexGeoJSON) {
    S.map.setFilter(layer.errorLayerId, ['==', ['literal', 1], 2]);
    return;
  }

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
  addOrUpdateSourceForLayer(layer, fc);
}

/** Update (or create) a SPECIFIC layer's map source — used by desktop's
 *  multi-source streamer to feed each layer its own data without touching the
 *  current-layer assumption. `addOrUpdateSource` is the current-layer wrapper. */
export function addOrUpdateSourceForLayer(layer: LayerState, fc: GeoJSON.FeatureCollection) {
  _showRenderingToast('Geometry is rendering');
  const store = S.dataStores.get(layer.dataStoreId);
  const isCivil = store?.isCivil;

  const existing = S.map.getSource(layer.sourceId);
  if (existing) {
    if (!isCivil && fc) {
      (existing as maplibregl.GeoJSONSource).setData(fc);
    }
  } else {
    if (isCivil) {
      let tileJson = store?.civilTileJson;
      if (!tileJson) {
        tileJson = {
          tilejson: '3.0.0',
          tiles: [`${store?.civilGateway}/tiles/get_parcel_tiles/{z}/{x}/{y}`],
          vector_layers: [{ id: 'parcels' }]
        };
      }

      if (tileJson.tiles && store?.civilGateway) {
        tileJson.tiles = tileJson.tiles.map((url: string) => {
          if (url.startsWith('/')) {
            return store.civilGateway + url;
          }
          return url;
        });
      }

      S.map.addSource(layer.sourceId, {
        type: 'vector',
        ...tileJson
      });
    } else {
      S.map.addSource(layer.sourceId, { type: 'geojson', data: fc });
    }
    addExtrusionLayer(layer);
  }
  _awaitFirstRenderedFeature(layer.layerId);
}

let keyHandlersInstalled = false;



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

async function getParcelByFeatureId(
  gateway: string,
  token: string,
  featureId: number | string
) {
  const client = getCivilClient(ParcelsService, gateway, token) as any;
  
  const req: any = {
    featureIds: [BigInt(featureId)]
  };

  if (S.civilValuationId) {
    req.valuationId = S.civilValuationId;
  }
  if (S.civilNeighborhoodDefinitionId) {
    req.neighborhoodDefinitionId = S.civilNeighborhoodDefinitionId;
  }
  if (S.civilLegalAsOf) {
    try {
      req.legalAsOf = timestampFromDate(new Date(S.civilLegalAsOf));
    } catch (e) {
      console.warn("Failed to parse S.civilLegalAsOf:", e);
    }
  }

  const res = await client.getParcelsWithImprovementSummaryByFeatureId(req);
  return res;
}

export function addExtrusionLayer(layer: LayerState) {
  if (S.map.getLayer(layer.layerId)) return;
  const store = S.dataStores.get(layer.dataStoreId);
  const isCivil = store?.isCivil;

  const layerDef: any = {
    id: layer.layerId,
    type: (isCivil && !S.is3DMode) ? 'fill' : 'fill-extrusion',
    source: layer.sourceId,
    paint: (isCivil && !S.is3DMode) ? {
      'fill-color': ['case',
        ['boolean', ['feature-state', 'selected'], false], S.highlightColor,
        '#e5e7eb'
      ],
      'fill-opacity': parseFloat(_opacityInput.value)
    } : {
      'fill-extrusion-color': '#888',
      'fill-extrusion-height': 0,
      'fill-extrusion-opacity': parseFloat(_opacityInput.value),
      'fill-extrusion-vertical-gradient': true
    }
  };

  if (isCivil) {
    let sourceLayer = 'parcels';
    const layers = store?.civilTileJson?.vector_layers || store?.civilTileJson?.vectorLayers;
    if (layers?.[0]?.id) {
      sourceLayer = layers[0].id;
    }
    layerDef['source-layer'] = sourceLayer;
  }

  S.map.addLayer(layerDef);
  _setLayerVisibility(layer, layer.visible);

  if (isCivil) {
    const outlineLayerId = `${layer.layerId}-outline`;
    if (!S.map.getLayer(outlineLayerId)) {
      const lineLayerDef: any = {
        id: outlineLayerId,
        type: 'line',
        source: layer.sourceId,
        'source-layer': layerDef['source-layer'],
        paint: {
          'line-color': '#000000',
          'line-width': 1.5,
          'line-opacity': 0.8
        }
      };
      S.map.addLayer(lineLayerDef);
    }
  }

  // NEW: parcel selection and inspection
  S.map.on('click', layer.layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    if (S.currentLayerId !== layer.id) {
      _setCurrentLayer(layer.id);
    }

    // Handle info tool
    if (S.isInfoToolActive) {
      if (isCivil && store?.civilGateway && store?.civilToken) {
        const featureId = f.id || f.properties?.feature_id || f.properties?.featureId;
        if (featureId) {
          _showRenderingToast('Fetching parcel data');
          getParcelByFeatureId(store.civilGateway, store.civilToken, featureId)
            .then(res => {
              _hideRenderingToast();
              const parcelSummary = Object.values(res.parcels || {})[0] as any;
              if (parcelSummary && parcelSummary.parcelDetails) {
                const details = parcelSummary.parcelDetails;
                const imp = parcelSummary.improvementSummary;
                let extraProps = {};
                if (details.properties) {
                  try {
                    extraProps = JSON.parse(details.properties);
                  } catch (err) {
                    console.warn("Failed to parse parcel properties JSON", err);
                  }
                }

                let neighborhoodName = details.neighborhoodId || '';
                if (store.civilNeighborhoodsMap && details.neighborhoodId) {
                  const nh = store.civilNeighborhoodsMap[details.neighborhoodId];
                  if (nh && nh.name) {
                    neighborhoodName = nh.name;
                  }
                }

                const fullProps: any = {
                  parcel_id: details.parcelId || '',
                  feature_id: Number(details.featureId || featureId),
                  formatted_address: details.formattedAddress || '',
                  address_id: details.addressId || '',
                  primary_owner_name: details.primaryOwnerName || '',
                  primary_owner_address: details.primaryOwnerAddress || '',
                  party_ids: details.partyIds || [],
                  land_use_id: details.landUseId || '',
                  neighborhood_id: neighborhoodName,
                  land_area_sq_ft: details.landAreaSqFt || 0,
                  frontage_ft: details.frontageFt || 0,
                  depth_ft: details.depthFt || 0,
                  zoning_ids: details.zoningIds || [],
                  market_land_value: details.marketLandValue || '',
                  assessed_land_value: details.assessedLandValue || '',
                  ...extraProps
                };

                if (imp) {
                  let conditionName = imp.primaryConditionId || '';
                  if (store.civilImprovementConditionMap && imp.primaryConditionId) {
                    const cond = store.civilImprovementConditionMap[imp.primaryConditionId];
                    if (cond && cond.name) {
                      conditionName = cond.name;
                    }
                  }

                  fullProps.improvement_ids = imp.improvementIds || [];
                  fullProps.primary_improvement_id = imp.primaryImprovementId || '';
                  fullProps.total_area_sq_ft = imp.totalAreaSqFt || 0;
                  fullProps.total_bathrooms = imp.totalBathrooms || 0;
                  fullProps.total_bedrooms = imp.totalBedrooms || 0;
                  fullProps.total_units = imp.totalUnits || 0;
                  fullProps.primary_year_built = imp.primaryYearBuilt || '';
                  fullProps.primary_effective_year_built = imp.primaryEffectiveYearBuilt || '';
                  fullProps.primary_condition_id = conditionName;
                  fullProps.total_market_improvement_value = imp.totalMarketImprovementValue || '';
                  fullProps.total_assessed_improvement_value = imp.totalAssessedImprovementValue || '';
                }

                const focusLngLat = getFeatureInspectFocusLngLat(f as GeoJSON.Feature, e.lngLat);
                _showPopup(fullProps, focusLngLat, fullProps.parcel_id);
              } else {
                _showRenderingToast('Parcel not found');
                setTimeout(() => _hideRenderingToast(), 2000);
              }
            })
            .catch(err => {
              console.error("Failed to fetch parcel by feature ID:", err);
              _showRenderingToast('Failed to fetch parcel data');
              setTimeout(() => _hideRenderingToast(), 2000);
            });
        }
        return;
      }

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
  S.map.on('contextmenu', layer.layerId, () => {
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
      } else if (key === _hotkeys.WRITE) {
        e.preventDefault();
        _activateTool('write');
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
  // Hex summary: the value/acre (or sum) is already baked into `hexMetric`.
  if (S.hexMode && S.hexGeoJSON) return ['to-number', ['get', 'hexMetric']] as any;

  if (!S.currentField) return ['literal', 0] as any;

  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;
  if (isCivil) {
    return ['to-number', ['coalesce', ['feature-state', S.currentField], 0]] as any;
  }

  // Single source of truth (shared with the legend visibility filter) for the
  // per-feature normalized value. Invalid denominators collapse to 0 (flat).
  return normalizedValueExpression(S.currentField, S.normalizationMode);
}

/**
 * Pseudo-random, bright, saturated color for item `n` out of `max_n`, seeded by `seed`.
 * - Successive n are far apart via a coprime "golden step" permutation mod max_n
 * - High saturation & mid/high lightness for vivid, easy-to-tell-apart colors
 * - Deterministic across runs for the same (n, max_n, seed)
 */


export function buildCategoricalColorPairs(): Array<[string, string]> {
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;
  if (!S.currentField || (!S.currentGeoJSON && !isCivil)) return [];

  // Collect unique categories
  const categories = new Set<string>();
  if (isCivil) {
    const currentLayer = _getCurrentLayer();
    if (currentLayer && S.map && S.map.getLayer(currentLayer.layerId)) {
      const features = S.map.queryRenderedFeatures({ layers: [currentLayer.layerId] });
      for (const f of features) {
        const pid = getParcelId(f.properties || {});
        if (pid) {
          const cached = S.civilAttributeCache.get(pid);
          const val = cached ? cached[S.currentField] : undefined;
          if (val !== undefined && val !== null && val !== '') {
            categories.add(String(val));
          }
        }
      }
    }
  } else {
    for (const feature of S.currentGeoJSON!.features) {
      const value = feature.properties?.[S.currentField];
      if (value != null && value !== '' && value !== undefined) {
        categories.add(String(value));
      }
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
    const ramp = COLOR_RAMPS[_rampSelect.value] || COLOR_RAMPS['Magma'];
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
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;
  if (!S.currentField || (!S.currentGeoJSON && !isCivil)) return ['literal', '#888'] as any;

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
  const val = isCivil
    ? ['to-string', ['coalesce', ['feature-state', S.currentField], '']] as any
    : ['to-string', ['coalesce', ['get', S.currentField], '']] as any;

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
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;
  if (!S.currentField || (!S.currentGeoJSON && !isCivil) || !S.currentStats) return [];

  const ramp = COLOR_RAMPS[_rampSelect.value] || COLOR_RAMPS['Magma'];
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
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;
  if (!S.currentField || (!S.currentGeoJSON && !isCivil) || !S.currentStats) return ['literal', '#888'] as any;

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


/* ================================================================== */
/*  Rendering application                                              */
/* ================================================================== */

export function applyGrayRendering() {
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;
  if (!isCivil && !S.currentGeoJSON) return;
  const ids = _getCurrentLayerIds();
  if (!ids) return;

  // Apply gray color when no field is selected, but preserve selected-feature highlighting.
  const grayWithSelectionColor: Expression = ['case',
    ['boolean', ['feature-state', 'selected'], false], S.highlightColor,
    isCivil ? '#e5e7eb' : '#888'
  ] as any;

  if (isCivil) {
    S.map.setPaintProperty(ids.layerId, 'fill-color', grayWithSelectionColor);
    S.map.setPaintProperty(ids.layerId, 'fill-opacity', parseFloat(_opacityInput.value));
  } else {
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', grayWithSelectionColor);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(_opacityInput.value));
  }

  applyMapFilters();

  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (S.lastPicked) _refreshInspectView();
}

export function applyExtrusion() {
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;
  if (!isCivil && !S.currentGeoJSON) return;
  const ids = _getCurrentLayerIds();
  if (!ids) return;

  const currentLayer = _getCurrentLayer();
  if (isCivil && currentLayer) {
    const mapLayer = S.map.getLayer(ids.layerId);
    const expectedType = S.is3DMode ? 'fill-extrusion' : 'fill';
    if (mapLayer && mapLayer.type !== expectedType) {
      // Recreate the layer!
      S.map.removeLayer(ids.layerId);
      const outlineLayerId = `${ids.layerId}-outline`;
      if (S.map.getLayer(outlineLayerId)) {
        S.map.removeLayer(outlineLayerId);
      }
      addExtrusionLayer(currentLayer);
    }
  }

  if (isCivil && !isFetchingCivilAttributes) {
    void checkAndFetchCivilAttributes();
  }

  // If no field is selected, apply gray rendering
  if (!S.currentField) {
    applyGrayRendering();
    return;
  }

  if (S.currentFieldType === 'categorical') {
    // For categorical fields, no extrusion - just color
    const colorExpr = buildCategoricalColorExpression();

    if (isCivil && !S.is3DMode) {
      S.map.setPaintProperty(ids.layerId, 'fill-color', colorExpr);
      S.map.setPaintProperty(ids.layerId, 'fill-opacity', parseFloat(_opacityInput.value));
    } else {
      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(_opacityInput.value));
    }
  } else {
    // For numeric fields, use the new color expression builder
    const colorExpr = buildNumericColorExpression();
    const valueExpr = buildValueExpression();

    if (isCivil && !S.is3DMode) {
      S.map.setPaintProperty(ids.layerId, 'fill-color', colorExpr);
      S.map.setPaintProperty(ids.layerId, 'fill-opacity', parseFloat(_opacityInput.value));
    } else {
      const rawMult = Number(_multInput.value);
      const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
      const unitFactor = UNIT_TO_METERS[_unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
      const heightExpr: Expression = S.is3DMode ? ['*', valueExpr, multiplier * unitFactor] as any : 0;

      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', heightExpr);
      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(_opacityInput.value));
    }
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
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;
  if (!S.currentGeoJSON && !isCivil) return;   // <- hard stop until data exists

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
    for (const n of list) {
      _fieldSelect.append(new Option(getLocalizedFieldName(n), n));
    }
  }
}





// Auto-multiplier so p-th percentile reaches capMeters, in given units
export function computeAndApplyAutoMultiplier(
  unitsKeyOrAuto: 'auto' | keyof typeof UNIT_TO_METERS = 'auto',
  capMeters = 1000,
  p = 99
) {
  if (!S.currentGeoJSON || !S.currentField) return;

  // In hex mode the displayed metric is the precomputed `hexMetric` (the ratio
  // is already baked in), so scale/breaks/stats come from the hex values as-is.
  const useHex = S.hexMode && !!S.hexGeoJSON;
  const srcFc = useHex ? S.hexGeoJSON! : S.currentGeoJSON;
  const srcField = useHex ? 'hexMetric' : S.currentField;
  const srcMode: 'asis' | 'perLand' | 'perBuilding' = useHex ? 'asis' : S.normalizationMode;

  // values for the CURRENT normalization mode
  const vals = getNumericValuesNormalized(srcFc, srcField, srcMode);
  const pVal = percentile(vals, p);
  if (!Number.isFinite(pVal) || pVal <= 0) return;

  // ---- Color domain / breaks ----
  if (S.colorMode === 'quantiles') {
    const ramp = COLOR_RAMPS[_rampSelect.value] || COLOR_RAMPS['Magma'];
    S.colorBreaks = quantileBreaks(vals, ramp.length, 1, 99); // p1..p99 equal-frequency bins
    S.colorDomain = null;
  } else {
    // continuous = EQUAL INTERVAL classes across p1..p99
    const ramp = COLOR_RAMPS[_rampSelect.value] || COLOR_RAMPS['Magma'];
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
  // Show 3 decimals to keep the input compact (guard tiny values from rounding to 0).
  _multInput.value = String(Number(multiplier.toFixed(3)) || Number(multiplier.toPrecision(3)));

  // stats for legend fallback
  S.currentStats = computeStatsNormalized(srcFc, srcField, srcMode);

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
  const numeric = S.currentFieldType === 'numeric';
  const show3D = numeric && S.is3DMode;
  // "Enable 3D" checkbox only makes sense for numeric fields.
  if (_enable3DRow) _enable3DRow.style.display = numeric ? 'block' : 'none';
  // The whole "3D" section appears only once 3D is enabled (numeric field).
  if (_threeDSection) _threeDSection.style.display = show3D ? 'block' : 'none';
  // Resolution control is revealed only when Hexagons is on.
  if (_hexResRow) _hexResRow.style.display = (show3D && S.hexMode) ? 'flex' : 'none';
}

export function updateFieldTypeUI() {
  const numericOptions = document.getElementById('numericOptions');
  const categoricalOptions = document.getElementById('categoricalOptions');
  const fieldTypeReadout = document.getElementById('fieldTypeReadout');

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
    update3DUI(); // hides the Enable 3D row + 3D section (no field)
    if (fieldTypeReadout) fieldTypeReadout.textContent = 'Field type: —';
  } else {
    const showNumericOptions = S.currentFieldType === 'numeric';
    const showCategoricalOptions = S.currentFieldType === 'categorical';
    const showColorRampOptions = showNumericOptions || (showCategoricalOptions && S.categoricalColorMode === 'colorRamp');
    const showColorScalingOptions = !!_colorScalingOptions && showNumericOptions;
    const showOpacityOptions = true;

    if (_colorRampOptions) {
      _colorRampOptions.style.display = showColorRampOptions ? 'grid' : 'none';
      // The categorical color-mode handler hides the inner ramp+scaling row when
      // not in ramp mode; restore it whenever the ramp options should show (e.g.
      // switching to a numeric field after a categorical random/single field).
      const rampRow = _colorRampOptions.querySelector<HTMLElement>('.field-visualize-row');
      if (rampRow) rampRow.style.display = showColorRampOptions ? '' : 'none';
    }
    if (_colorScalingOptions) _colorScalingOptions.style.display = showColorScalingOptions ? 'grid' : 'none';
    if (_opacityOptions) _opacityOptions.style.display = showOpacityOptions ? 'grid' : 'none';

    if (fieldTypeReadout) fieldTypeReadout.textContent = `Field type: ${S.currentFieldType ?? '—'}`;

    if (showNumericOptions) {
      if (numericOptions) numericOptions.style.display = 'grid';
      if (categoricalOptions) categoricalOptions.style.display = 'none';
      if (_colorOptions) _colorOptions.style.display = 'none';
      update3DUI(); // This will show/hide extrusion options based on 3D mode
    } else if (showCategoricalOptions) {
      if (numericOptions) numericOptions.style.display = 'none';
      if (categoricalOptions) categoricalOptions.style.display = 'grid';
      if (_colorOptions) _colorOptions.style.display = 'none';
      update3DUI(); // hides the Enable 3D row + 3D section (categorical field)

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

  // Paint options just appeared/disappeared, which changes the panel's content
  // height. Re-fit the Layers window so the chrome grows/shrinks to match
  // (otherwise docked, the content spills until you drag the resize grabber).
  refreshWindowMinHeight(controlsEl);
}

function getSingleAttributeMethodForField(field: string): string | null {
  switch (field) {
    case "land_area_sq_ft": return "getLandAreaSqftByParcelId";
    case "frontage_ft": return "getFrontageFtByParcelId";
    case "depth_ft": return "getDepthFtByParcelId";
    case "improvement_area_sq_ft": return "getImprovementAreaSqftByParcelId";
    case "primary_improvement_year_built": return "getPrimaryImprovementYearBuiltByParcelId";
    case "primary_improvement_effective_year_built": return "getPrimaryImprovementEffectiveYearBuiltByParcelId";
    case "bedrooms": return "getBedroomsByParcelId";
    case "bathrooms": return "getBathroomsByParcelId";
    case "units": return "getUnitsByParcelId";
    case "land_use_id": return "getLandUseIdSqftByParcelId";
    case "zoning_ids": return "getZoningIdByParcelId";
    case "primary_improvement_condition_id": return "getPrimaryImprovementConditionIdByParcelId";
    case "primary_improvement_type_id": return "getPrimaryImprovementTypeIdByParcelId";
  }
  return null;
}

export async function fetchAndCacheCivilAttributes(
  field: string,
  parcelIds: string[],
  gateway: string,
  token: string
) {
  const methodName = getSingleAttributeMethodForField(field);
  if (!methodName) return;

  const client = getCivilClient(ParcelsService, gateway, token) as any;
  try {
    const res = await client[methodName]({ parcelIds });
    if (res && res.values) {
      for (const [pid, val] of Object.entries(res.values)) {
        let cached = S.civilAttributeCache.get(pid);
        if (!cached) {
          cached = {};
          S.civilAttributeCache.set(pid, cached);
        }
        cached[field] = val;
      }
    }
  } catch (err) {
    console.error(`Failed to fetch civil attribute for ${field}:`, err);
  }
}

export function updateCivilFeatureStates() {
  const currentLayer = _getCurrentLayer();
  if (!currentLayer) return;
  const store = S.dataStores.get(currentLayer.dataStoreId);
  if (!store?.isCivil) return;

  if (!S.currentField) return;

  if (!S.map || !S.map.getLayer(currentLayer.layerId)) return;

  const features = S.map.queryRenderedFeatures({ layers: [currentLayer.layerId] });
  for (const f of features) {
    const pid = getParcelId(f.properties || {});
    const fid = f.id || f.properties?.feature_id || f.properties?.featureId;
    const numericFid = fid ? Number(fid) : null;
    if (pid && numericFid) {
      const cached = S.civilAttributeCache.get(pid);
      const val = cached ? cached[S.currentField] : undefined;
      if (val !== undefined && val !== null) {
        S.map.setFeatureState(
          { source: currentLayer.sourceId, sourceLayer: f.sourceLayer, id: numericFid },
          { [S.currentField]: val }
        );
      }
    }
  }
}

let isFetchingCivilAttributes = false;

export async function checkAndFetchCivilAttributes() {
  if (isFetchingCivilAttributes) return;
  const currentLayer = _getCurrentLayer();
  if (!currentLayer) return;
  const store = S.dataStores.get(currentLayer.dataStoreId);
  if (!store?.isCivil || !store?.civilGateway || !store?.civilToken) return;

  if (!S.currentField) return;

  if (!S.map || !S.map.getLayer(currentLayer.layerId)) return;

  const features = S.map.queryRenderedFeatures({ layers: [currentLayer.layerId] });
  const parcelIdsToFetch = new Set<string>();
  for (const f of features) {
    const pid = getParcelId(f.properties || {});
    if (pid) {
      const cached = S.civilAttributeCache.get(pid);
      if (!cached || cached[S.currentField] === undefined) {
        parcelIdsToFetch.add(pid);
      }
    }
  }

  if (parcelIdsToFetch.size === 0) {
    updateCivilFeatureStates();
    return;
  }

  isFetchingCivilAttributes = true;
  try {
    const ids = Array.from(parcelIdsToFetch);
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      await fetchAndCacheCivilAttributes(
        S.currentField,
        chunk,
        store.civilGateway,
        store.civilToken
      );
    }

    updateCivilFeatureStates();

    // Recompute stats/breaks/categories for the visible features
    const visibleFeatures = S.map.queryRenderedFeatures({ layers: [currentLayer.layerId] });
    if (S.currentFieldType === 'numeric') {
      const vals: number[] = [];
      for (const f of visibleFeatures) {
        const pid = getParcelId(f.properties || {});
        if (pid) {
          const cached = S.civilAttributeCache.get(pid);
          const val = cached ? cached[S.currentField] : undefined;
          if (val !== undefined && val !== null) {
            const num = Number(val);
            if (Number.isFinite(num)) vals.push(num);
          }
        }
      }
      if (vals.length > 0) {
        S.currentStats = {
          min: Math.min(...vals),
          max: Math.max(...vals)
        };
      } else {
        S.currentStats = { min: 0, max: 1 };
      }
    }

    applyExtrusion();
    updateFloatingLegend();
  } catch (err) {
    console.error("Error in checkAndFetchCivilAttributes:", err);
  } finally {
    isFetchingCivilAttributes = false;
  }
}
