/**
 * Selection-related functions extracted from main.ts.
 * All modules import `S` to read/write state.
 */
import maplibregl from 'maplibre-gl';
import { S } from './state';
import { getActiveFilters, matchesCurrentActiveFilters } from './filters';

/* ------------------------------------------------------------------ */
/*  Callbacks into main.ts (set once via initSelection)               */
/* ------------------------------------------------------------------ */

let _getCurrentSourceId: () => string | null = () => null;
let _updateCursor: () => void = () => {};
let _makeDraggable: (el: HTMLElement) => void = () => {};
let _updateStatisticsResults: () => void = () => {};
let _scheduleScatterPlotRefresh: () => void = () => {};
let _updateHighlightColors: () => void = () => {};
let _persistCurrentLayerState: () => void = () => {};
let _updateLegendPosition: () => void = () => {};
let _getFloatingLegend: () => HTMLDivElement | null = () => null;
let _registerSelectionControlsDocking: (panel: HTMLDivElement, pinButton: HTMLButtonElement) => void = () => {};
let _refreshSelectionControlsDockLayout: () => void = () => {};
let _openSelectionConditionsFilters: () => void = () => {};
let _selectionControlsInvariantTimer: number | null = null;

const PIN_ICON = new URL('./svg/thumbtack.svg', import.meta.url).href;
const PIN_ICON_TILTED = new URL('./svg/thumbtack-tilted.svg', import.meta.url).href;

export interface SelectionCallbacks {
  getCurrentSourceId: () => string | null;
  updateCursor: () => void;
  makeDraggable: (el: HTMLElement) => void;
  updateStatisticsResults: () => void;
  scheduleScatterPlotRefresh: () => void;
  updateHighlightColors: () => void;
  persistCurrentLayerState: () => void;
  updateLegendPosition: () => void;
  getFloatingLegend: () => HTMLDivElement | null;
  registerSelectionControlsDocking: (panel: HTMLDivElement, pinButton: HTMLButtonElement) => void;
  refreshSelectionControlsDockLayout: () => void;
  openSelectionConditionsFilters: () => void;
}

export function initSelection(cb: SelectionCallbacks) {
  _getCurrentSourceId = cb.getCurrentSourceId;
  _updateCursor = cb.updateCursor;
  _makeDraggable = cb.makeDraggable;
  _updateStatisticsResults = cb.updateStatisticsResults;
  _scheduleScatterPlotRefresh = cb.scheduleScatterPlotRefresh;
  _updateHighlightColors = cb.updateHighlightColors;
  _persistCurrentLayerState = cb.persistCurrentLayerState;
  _updateLegendPosition = cb.updateLegendPosition;
  _getFloatingLegend = cb.getFloatingLegend;
  _registerSelectionControlsDocking = cb.registerSelectionControlsDocking;
  _refreshSelectionControlsDockLayout = cb.refreshSelectionControlsDockLayout;
  _openSelectionConditionsFilters = cb.openSelectionConditionsFilters;

  if (_selectionControlsInvariantTimer === null) {
    _selectionControlsInvariantTimer = window.setInterval(() => {
      enforceSelectionControlsVisibilityInvariant();
    }, 150);
  }
}

/* ------------------------------------------------------------------ */
/*  Helper: viewport / map coordinate conversion                      */
/* ------------------------------------------------------------------ */

function getViewportPoint(e: MouseEvent): maplibregl.Point {
  return new maplibregl.Point(e.clientX, e.clientY);
}

/* ------------------------------------------------------------------ */
/*  Marching-ants CSS injection                                       */
/* ------------------------------------------------------------------ */

export function ensureMarchingAntsStyles() {
  if (document.getElementById('marching-ants-style')) return;

  const css = `
  :root {
    --ants-size: 8px;        /* dash length */
    --ants-thickness: 2px;   /* border thickness */
    --ants-speed: 0.6s;      /* one dash per cycle */
    --ants-a: #fff;          /* color A */
    --ants-b: #000;          /* color B */
    --ants-fill: rgba(59,130,246,0.10);
    --ants-fill-unselect: rgba(239,68,68,0.10);
  }

  /* Animate only px on the moving axis; anchor the other axis with 0/100% */
  @keyframes ants {
    from {
      background-position:
        0 0,          /* top    */
        0 100%,       /* bottom */
        0 0,          /* left   */
        100% 0;       /* right  */
    }
    to {
      background-position:
        var(--ants-size) 0,
        var(--ants-size) 100%,
        0 var(--ants-size),
        100% var(--ants-size);
    }
  }

  /* Animated stroke dash for SVG paths */
  @keyframes stroke-ants {
    from { stroke-dashoffset: 0; }
    to { stroke-dashoffset: calc(var(--ants-size) * 2); }
  }

  .selection-rect {
    position: absolute;
    pointer-events: none;
    z-index: 1000;
    display: none;
    box-sizing: border-box;

    /* fill sits under the ants */
    background-color: var(--ants-fill);

    /* 4 edge layers */
    background-image:
      linear-gradient(90deg, var(--ants-a) 50%, var(--ants-b) 0), /* top */
      linear-gradient(90deg, var(--ants-a) 50%, var(--ants-b) 0), /* bottom */
      linear-gradient(0deg,  var(--ants-a) 50%, var(--ants-b) 0), /* left */
      linear-gradient(0deg,  var(--ants-a) 50%, var(--ants-b) 0); /* right */

    background-size:
      var(--ants-size) var(--ants-thickness),
      var(--ants-size) var(--ants-thickness),
      var(--ants-thickness) var(--ants-size),
      var(--ants-thickness) var(--ants-size);

    background-repeat:
      repeat-x, repeat-x, repeat-y, repeat-y;

    /* Start positions match @keyframes 'from' so interpolation is px-only */
    background-position:
      0 0,
      0 100%,
      0 0,
      100% 0;

    animation: ants var(--ants-speed) linear infinite;
  }

  .selection-rect.unselect {
    background-color: var(--ants-fill-unselect);
    background-image:
      linear-gradient(90deg, #ffffff 50%, #ef4444 0), /* top */
      linear-gradient(90deg, #ffffff 50%, #ef4444 0), /* bottom */
      linear-gradient(0deg,  #ffffff 50%, #ef4444 0), /* left */
      linear-gradient(0deg,  #ffffff 50%, #ef4444 0); /* right */
  }

  /* Lasso path with animated marching ants - dual path approach */
  .lasso-path {
    stroke-width: var(--ants-thickness);
    stroke-linejoin: round;
    stroke-linecap: round;
    fill: none;
    stroke-dasharray: var(--ants-size), var(--ants-size);
    animation: stroke-ants var(--ants-speed) linear infinite;
  }

  .lasso-path.select {
    stroke: var(--ants-b);
  }

  .lasso-path.unselect {
    stroke: #ef4444;
  }

  .lasso-path-bg {
    stroke-width: var(--ants-thickness);
    stroke-linejoin: round;
    stroke-linecap: round;
    fill: none;
    animation: stroke-ants var(--ants-speed) linear infinite;
    animation-direction: reverse;
  }

  .lasso-path-bg.select {
    stroke: var(--ants-a);
  }

  .lasso-path-bg.unselect {
    stroke: #ffffff;
  }

  .lasso-fill {
    fill: var(--ants-fill);
  }

  .lasso-fill.unselect {
    fill: var(--ants-fill-unselect);
  }

  /* Polygon selection styles */
  .polygon-fill {
    fill: var(--ants-fill);
  }

  .polygon-fill.unselect {
    fill: var(--ants-fill-unselect);
  }

  .polygon-path {
    stroke-width: var(--ants-thickness);
    stroke-linejoin: round;
    stroke-linecap: round;
    fill: none;
    stroke-dasharray: var(--ants-size), var(--ants-size);
    animation: stroke-ants var(--ants-speed) linear infinite;
  }

  .polygon-path.select {
    stroke: var(--ants-b);
  }

  .polygon-path.unselect {
    stroke: #ef4444;
  }

  .polygon-path-bg {
    stroke-width: var(--ants-thickness);
    stroke-linejoin: round;
    stroke-linecap: round;
    fill: none;
    animation: stroke-ants var(--ants-speed) linear infinite;
    animation-direction: reverse;
  }

  .polygon-path-bg.select {
    stroke: var(--ants-a);
  }

  .polygon-path-bg.unselect {
    stroke: #ffffff;
  }

  /* Polygon closing indicator */
  .polygon-closing-indicator {
    fill: #ffffff;
    stroke-width: 2px;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .polygon-closing-indicator.select {
    stroke: #000000;
  }

  .polygon-closing-indicator.unselect {
    stroke: #ef4444;
  }

  @media (prefers-reduced-motion: reduce) {
    .selection-rect, .lasso-path, .polygon-path { animation-duration: 2s; }
  }
  `;

  const style = document.createElement('style');
  style.id = 'marching-ants-style';
  style.textContent = css;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

/** Point-in-polygon test using ray casting algorithm */
export function pointInPolygon(point: number[], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/** Check if a polygon ring set intersects with a bounding box */
export function polygonIntersectsBbox(polygon: number[][][], bbox: [number, number, number, number]): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;

  // Check if any point of the polygon is inside the bbox
  for (const ring of polygon) {
    for (const coord of ring) {
      const [lng, lat] = coord;
      if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
        return true;
      }
    }
  }

  // Also check if the bbox is completely inside the polygon
  const bboxCorners = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat]
  ];

  for (const corner of bboxCorners) {
    if (pointInPolygon(corner, polygon[0])) {
      return true;
    }
  }

  return false;
}

/** Check if a feature intersects with a bounding box */
export function featureIntersectsBbox(feature: GeoJSON.Feature, bbox: [number, number, number, number]): boolean {
  const geom = feature.geometry as GeoJSON.Geometry;
  if (geom.type === 'Polygon') {
    return polygonIntersectsBbox((geom as GeoJSON.Polygon).coordinates, bbox);
  } else if (geom.type === 'MultiPolygon') {
    return (geom as GeoJSON.MultiPolygon).coordinates.some(polygon =>
      polygonIntersectsBbox(polygon, bbox)
    );
  }

  return false;
}

/** Check if a polygon ring set intersects with another polygon */
function polygonIntersectsPolygon(polygon1: number[][][], polygon2: number[][]): boolean {
  // Check if any point of polygon1 is inside polygon2
  for (const ring of polygon1) {
    for (const coord of ring) {
      const [lng, lat] = coord;
      if (pointInPolygon([lng, lat], polygon2)) {
        return true;
      }
    }
  }

  // Also check if any point of polygon2 is inside polygon1
  for (const coord of polygon2) {
    const [lng, lat] = coord;
    if (pointInPolygon([lng, lat], polygon1[0])) {
      return true;
    }
  }

  return false;
}

/** Check if a feature intersects with a polygon */
function featureIntersectsPolygon(feature: GeoJSON.Feature, polygon: number[][]): boolean {
  const geom = feature.geometry as GeoJSON.Geometry;
  if (geom.type === 'Polygon') {
    return polygonIntersectsPolygon((geom as GeoJSON.Polygon).coordinates, polygon);
  } else if (geom.type === 'MultiPolygon') {
    return (geom as GeoJSON.MultiPolygon).coordinates.some(poly =>
      polygonIntersectsPolygon(poly, polygon)
    );
  }

  return false;
}

/** Calculate bounding box for a polygon */
function calculatePolygonBbox(polygon: number[][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const coord of polygon) {
    const [lng, lat] = coord;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat];
}

/* ------------------------------------------------------------------ */
/*  Parcel ID helpers                                                 */
/* ------------------------------------------------------------------ */

export function getParcelId(feature: any): string {
  return feature.id.toString();
}

export function findFeatureByParcelId(parcelId: string): GeoJSON.Feature | null {
  if (!S.currentGeoJSON) return null;
  return S.currentGeoJSON.features.find(feature => getParcelId(feature) === parcelId) ?? null;
}

/* ------------------------------------------------------------------ */
/*  Selection management                                              */
/* ------------------------------------------------------------------ */

export function addParcelToSelection(feature: any) {
  const sourceId = _getCurrentSourceId();
  if (!sourceId) return;
  const parcelId = getParcelId(feature);
  S.selectedParcels.add(parcelId);
  S.map.setFeatureState(
    { source: sourceId, id: feature.id },
    { selected: true }
  );
  updateSelectionControls();
}

export function removeParcelFromSelection(feature: any) {
  const sourceId = _getCurrentSourceId();
  if (!sourceId) return;
  const parcelId = getParcelId(feature);
  S.selectedParcels.delete(parcelId);
  S.map.setFeatureState(
    { source: sourceId, id: feature.id },
    { selected: false }
  );
  updateSelectionControls();
}

export function toggleParcelSelection(feature: any) {
  const sourceId = _getCurrentSourceId();
  if (!sourceId) return;
  const parcelId = getParcelId(feature);
  if (S.selectedParcels.has(parcelId)) {
    S.selectedParcels.delete(parcelId);
    S.map.setFeatureState(
      { source: sourceId, id: feature.id },
      { selected: false }
    );
  } else {
    S.selectedParcels.add(parcelId);
    S.map.setFeatureState(
      { source: sourceId, id: feature.id },
      { selected: true }
    );
  }
  updateSelectionControls();
}

export function clearAllSelections() {
  const sourceId = _getCurrentSourceId();
  if (!sourceId) return;
  if (S.currentGeoJSON) {
    for (const feature of S.currentGeoJSON.features) {
      if (feature.id !== undefined) {
        S.map.setFeatureState(
          { source: sourceId, id: feature.id },
          { selected: false }
        );
      }
    }
  }
  S.selectedParcels.clear();
  updateSelectionControls();
}

/* ------------------------------------------------------------------ */
/*  Selection controls panel                                          */
/* ------------------------------------------------------------------ */

function createSelectionControlsPanel() {
  if (S.selectionControlsPanel) {
    S.selectionControlsPanel.remove();
  }

  S.selectionControlsPanel = document.createElement('div');
  S.selectionControlsPanel.id = 'selectionControlsPanel';

  const floatingLegend = _getFloatingLegend();
  const legendVisible = floatingLegend && floatingLegend.style.display !== 'none';
  const legendWidth = legendVisible ? 280 : 0;
  const legendRight = 20;
  const panelRight = legendVisible ? (legendWidth + legendRight + 10) : 20;

  S.selectionControlsPanel.style.cssText = `
    position: absolute;
    top: 60px;
    right: ${panelRight}px;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 15;
    backdrop-filter: blur(4px);
    min-width: 200px;
    min-height: 120px;
    cursor: move;
    display: grid;
    grid-template-rows: auto 1fr;
  `;
  S.selectionControlsPanel.classList.add('viz-window');

  S.selectionControlsPanel.innerHTML = `
    <div class="window-header" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      background: rgba(248, 248, 248, 0.8);
      border-radius: 8px 8px 0 0;
      cursor: move;
    ">
      <div style="font-weight: 600; font-size: 13px;">Selection Controls</div>
      <div class="window-actions">
        <button id="btnPinSelectionControls" class="window-pin" type="button" title="Pin" aria-pressed="false">
          <img src="${PIN_ICON_TILTED}" alt="Pin menu" style="width:14px;height:14px;display:block;">
        </button>
      </div>
    </div>
    <div data-window-content style="padding: 12px; display: block;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="font-size: 12px;">Selected:</span>
        <span id="selectedCount" style="font-weight: 600;">${S.selectedParcels.size}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="font-size: 12px;">Highlight color:</span>
        <input type="color" id="highlightColorPicker" value="${S.highlightColor}" style="width: 30px; height: 20px; border: 1px solid #ddd; border-radius: 3px; cursor: pointer;">
      </div>
      <button id="unselectAllBtn" style="
        width: 100%;
        border: 1px solid #ddd;
        background: #f8f8f8;
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
      ">Unselect All</button>
      <div style="margin-top: 10px; border-top: 1px solid #e5e7eb; padding-top: 10px; display: grid; gap: 8px;">
        <div style="font-size: 12px; font-weight: 600;">Select with filter:</div>
        <button id="selectionFilterConditionsBtn" type="button" style="
          width: 100%;
          border: 1px solid #ddd;
          background: #f8f8f8;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          justify-content: center;
        "><img src="./src/svg/filters.svg" alt="Filters" style="width:12px;height:12px;">conditions...</button>
        <select id="selectionFilterOperation" style="
          width: 100%;
          border: 1px solid #ddd;
          background: #fff;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
        ">
          <option value="add" selected>add to selection</option>
          <option value="remove">remove from selection</option>
          <option value="set">set selection to</option>
        </select>
        <button id="selectionFilterApplyBtn" style="
          width: 100%;
          border: 1px solid #ddd;
          background: #f8f8f8;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
        ">Apply</button>
        <div id="selectionFilterStatus" style="font-size: 12px; min-height: 16px; color: #111827;"></div>
      </div>
    </div>
  `;

  const unselectAllBtn = S.selectionControlsPanel.querySelector('#unselectAllBtn') as HTMLButtonElement;
  const colorPicker = S.selectionControlsPanel.querySelector('#highlightColorPicker') as HTMLInputElement;
  const pinButton = S.selectionControlsPanel.querySelector('#btnPinSelectionControls') as HTMLButtonElement;
  const conditionsBtn = S.selectionControlsPanel.querySelector('#selectionFilterConditionsBtn') as HTMLButtonElement;
  const operationSelect = S.selectionControlsPanel.querySelector('#selectionFilterOperation') as HTMLSelectElement;
  const applyBtn = S.selectionControlsPanel.querySelector('#selectionFilterApplyBtn') as HTMLButtonElement;
  const statusLine = S.selectionControlsPanel.querySelector('#selectionFilterStatus') as HTMLDivElement;

  const updateConditionsButtonState = () => {
    const activeCount = getActiveFilters().length;
    conditionsBtn.style.color = activeCount > 0 ? '#b91c1c' : '#111827';
    conditionsBtn.style.borderColor = activeCount > 0 ? '#ef4444' : '#ddd';
  };

  const setSelectionStatus = (message: string, red = false) => {
    statusLine.textContent = message;
    statusLine.style.color = red ? '#b91c1c' : '#111827';
  };

  const applySelectionFromConditions = () => {
    if (!S.currentGeoJSON) {
      setSelectionStatus('No conditions specified.', true);
      return;
    }
    const activeFilters = getActiveFilters();
    if (activeFilters.length === 0) {
      setSelectionStatus('No conditions specified.', true);
      return;
    }

    const sourceId = _getCurrentSourceId();
    if (!sourceId) {
      setSelectionStatus('No conditions specified.', true);
      return;
    }

    const matchedFeatures = S.currentGeoJSON.features.filter((feature) => feature.id !== undefined && matchesCurrentActiveFilters(feature));
    const matchedIds = new Set<string>(matchedFeatures.map(feature => getParcelId(feature as any)));
    const operation = operationSelect.value;

    if (operation === 'add') {
      let added = 0;
      let alreadySelected = 0;
      matchedFeatures.forEach((feature) => {
        const parcelId = getParcelId(feature as any);
        if (S.selectedParcels.has(parcelId)) {
          alreadySelected += 1;
          return;
        }
        S.selectedParcels.add(parcelId);
        S.map.setFeatureState({ source: sourceId, id: feature.id! }, { selected: true });
        added += 1;
      });
      const suffix = alreadySelected > 0 ? ` (${alreadySelected.toLocaleString()} already selected)` : '';
      setSelectionStatus(`Added ${added.toLocaleString()} parcels to selection${suffix}.`, added === 0);
    } else if (operation === 'remove') {
      let removed = 0;
      matchedFeatures.forEach((feature) => {
        const parcelId = getParcelId(feature as any);
        if (!S.selectedParcels.has(parcelId)) return;
        S.selectedParcels.delete(parcelId);
        S.map.setFeatureState({ source: sourceId, id: feature.id! }, { selected: false });
        removed += 1;
      });
      setSelectionStatus(`Removed ${removed.toLocaleString()} parcels from selection.`, removed === 0);
    } else {
      let changed = 0;
      for (const feature of S.currentGeoJSON.features) {
        if (feature.id === undefined) continue;
        const parcelId = getParcelId(feature as any);
        const shouldBeSelected = matchedIds.has(parcelId);
        const wasSelected = S.selectedParcels.has(parcelId);
        if (shouldBeSelected !== wasSelected) {
          changed += 1;
        }
        if (shouldBeSelected) {
          S.selectedParcels.add(parcelId);
        } else {
          S.selectedParcels.delete(parcelId);
        }
        S.map.setFeatureState({ source: sourceId, id: feature.id }, { selected: shouldBeSelected });
      }
      const matchCount = matchedIds.size;
      setSelectionStatus(`Set selection to ${matchCount.toLocaleString()} parcels.`, changed === 0 || matchCount === 0);
    }

    _persistCurrentLayerState();
    updateSelectionControls();
  };

  unselectAllBtn.addEventListener('click', clearAllSelections);
  conditionsBtn.addEventListener('click', () => {
    _openSelectionConditionsFilters();
    updateConditionsButtonState();
  });
  applyBtn.addEventListener('click', applySelectionFromConditions);

  colorPicker.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    S.highlightColor = target.value;
    _updateHighlightColors();
    _persistCurrentLayerState();
  });

  updateConditionsButtonState();

  document.body.appendChild(S.selectionControlsPanel);
  _registerSelectionControlsDocking(S.selectionControlsPanel, pinButton);
  _makeDraggable(S.selectionControlsPanel);
  _updateLegendPosition();
}

function ensureSelectionControlsOpen(panel: HTMLDivElement) {
  panel.style.display = 'block';
  if (panel.dataset.pinnedCollapsed !== 'true') return;

  panel.dataset.pinnedCollapsed = 'false';
  panel.classList.remove('is-pinned-collapsed');
  panel.style.minHeight = panel.dataset.expandedMinHeight ?? '';
  panel.style.height = '';

  const contentEl = panel.querySelector('[data-window-content]') as HTMLDivElement | null;
  if (contentEl) {
    const expandedDisplay = contentEl.dataset.expandedDisplay || 'block';
    contentEl.style.display = expandedDisplay;
  }

  const collapseButton = panel.querySelector('.window-pin-collapse') as HTMLButtonElement | null;
  if (collapseButton) {
    collapseButton.title = 'Collapse pinned menu';
    collapseButton.setAttribute('aria-expanded', 'true');
    collapseButton.style.transform = 'none';
  }

  if (panel.classList.contains('is-pinned')) {
    _refreshSelectionControlsDockLayout();
  }
}

function enforceSelectionControlsVisibilityInvariant() {
  if (S.selectedParcels.size <= 0) return;

  if (!S.selectionControlsPanel || !S.selectionControlsPanel.isConnected) {
    createSelectionControlsPanel();
  }

  if (!S.selectionControlsPanel) return;

  ensureSelectionControlsOpen(S.selectionControlsPanel);
  const countElement = S.selectionControlsPanel.querySelector('#selectedCount');
  if (countElement) {
    countElement.textContent = S.selectedParcels.size.toString();
  }

  const conditionsBtn = S.selectionControlsPanel.querySelector('#selectionFilterConditionsBtn') as HTMLButtonElement | null;
  if (conditionsBtn) {
    const activeCount = getActiveFilters().length;
    conditionsBtn.style.color = activeCount > 0 ? '#b91c1c' : '#111827';
    conditionsBtn.style.borderColor = activeCount > 0 ? '#ef4444' : '#ddd';
  }
}

export function updateSelectionControls() {
  if (S.selectedParcels.size === 0) {
    if (S.selectionControlsPanel) {
      S.selectionControlsPanel.style.display = 'none';
      if (S.selectionControlsPanel.classList.contains('is-pinned')) {
        _refreshSelectionControlsDockLayout();
      }
    }
  } else {
    enforceSelectionControlsVisibilityInvariant();
  }
  if (S.statsSubjectMode === 'selected') {
    _updateStatisticsResults();
  }
  if (S.scatterSubjectMode === 'selected') {
    _scheduleScatterPlotRefresh();
  }
}

export function updateSelectionControlsPosition() {
  if (!S.selectionControlsPanel) return;
  if (S.selectionControlsPanel.classList.contains('is-pinned')) return;
  if (S.selectionControlsPanel.dataset.userPositioned === 'true') return;

  const floatingLegend = _getFloatingLegend();
  const legendVisible = floatingLegend && floatingLegend.style.display !== 'none';
  const legendWidth = legendVisible ? 280 : 0;
  const legendRight = 20;
  const panelRight = legendVisible ? (legendWidth + legendRight + 10) : 20;

  S.selectionControlsPanel.style.right = `${panelRight}px`;
}

/* ------------------------------------------------------------------ */
/*  Category / range selection                                        */
/* ------------------------------------------------------------------ */

export function applyCategorySelection(category: string, shouldSelect: boolean, sourceId: string) {
  console.log(`Category = ${category} shouldSelect = ${shouldSelect} sourceId = ${sourceId}`);
  if (shouldSelect) {
    S.selectedLegendItems.add(category);
  } else {
    S.selectedLegendItems.delete(category);
  }
  if (!S.currentGeoJSON) return;
  for (const feature of S.currentGeoJSON.features) {
    const value = feature.properties?.[S.currentField!];
    if (value != null && value !== '' && value !== undefined) {
      const featureCategory = String(value);
      if (featureCategory === category && feature.id !== undefined) {
        const parcelId = getParcelId(feature);
        if (shouldSelect) {
          S.selectedParcels.add(parcelId);
        } else {
          S.selectedParcels.delete(parcelId);
        }
        S.map.setFeatureState(
          { source: sourceId, id: feature.id },
          { selected: shouldSelect }
        );
      }
    }
  }
}

export function applyRangeSelection(
  rangeKey: string,
  range: { min: number; max: number },
  shouldSelect: boolean,
  sourceId: string
) {
  if (shouldSelect) {
    S.selectedLegendItems.add(rangeKey);
  } else {
    S.selectedLegendItems.delete(rangeKey);
  }
  if (!S.currentGeoJSON) return;
  for (const feature of S.currentGeoJSON.features) {
    const value = Number(feature.properties?.[S.currentField!]);
    if (Number.isFinite(value) && feature.id !== undefined) {
      if (value >= range.min && value <= range.max) {
        const parcelId = getParcelId(feature);
        if (shouldSelect) {
          S.selectedParcels.add(parcelId);
        } else {
          S.selectedParcels.delete(parcelId);
        }
        S.map.setFeatureState(
          { source: sourceId, id: feature.id },
          { selected: shouldSelect }
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Generic area selection helper (deduplicates bbox/polygon funcs)   */
/* ------------------------------------------------------------------ */

function updateParcelsInArea(
  intersectionTest: (feature: GeoJSON.Feature) => boolean,
  shouldSelect: boolean
): void {
  if (!S.currentGeoJSON) {
    console.log(`No data loaded to ${shouldSelect ? 'select' : 'unselect'} from`);
    return;
  }
  const sourceId = _getCurrentSourceId();
  if (!sourceId) return;

  let count = 0;

  for (const feature of S.currentGeoJSON.features) {
    if (!feature.geometry || !feature.id) continue;

    if (!intersectionTest(feature)) continue;

    const parcelId = getParcelId(feature);

    if (shouldSelect) {
      S.selectedParcels.add(parcelId);
      S.map.setFeatureState(
        { source: sourceId, id: feature.id },
        { selected: true }
      );
      count++;
    } else {
      // Only unselect if it was previously selected
      if (S.selectedParcels.has(parcelId)) {
        S.selectedParcels.delete(parcelId);
        S.map.setFeatureState(
          { source: sourceId, id: feature.id },
          { selected: false }
        );
        count++;
      }
    }
  }

  const verb = shouldSelect ? 'Selected' : 'Unselected';
  console.log(`${verb} ${count} parcels within the area`);
  updateSelectionControls();
}

/* ------------------------------------------------------------------ */
/*  Bounding-box selection (thin wrappers)                            */
/* ------------------------------------------------------------------ */

export function selectParcelsInBoundingBox(bbox: [number, number, number, number]) {
  updateParcelsInArea(
    (feature) => featureIntersectsBbox(feature, bbox),
    true
  );
}

export function unselectParcelsInBoundingBox(bbox: [number, number, number, number]) {
  updateParcelsInArea(
    (feature) => featureIntersectsBbox(feature, bbox),
    false
  );
}

/* ------------------------------------------------------------------ */
/*  Polygon selection (thin wrappers with broad-phase filtering)      */
/* ------------------------------------------------------------------ */

export function selectParcelsInPolygon(polygon: number[][]) {
  const bbox = calculatePolygonBbox(polygon);
  if (!S.currentGeoJSON) {
    console.log('No data loaded to select from');
    return;
  }
  // Log broad-phase info
  const candidateCount = S.currentGeoJSON.features.filter(f =>
    f.geometry && f.id && featureIntersectsBbox(f, bbox)
  ).length;
  console.log(`Broad-phase filtering: ${candidateCount} features out of ${S.currentGeoJSON.features.length} candidates`);

  updateParcelsInArea(
    (feature) => featureIntersectsBbox(feature, bbox) && featureIntersectsPolygon(feature, polygon),
    true
  );
}

export function unselectParcelsInPolygon(polygon: number[][]) {
  const bbox = calculatePolygonBbox(polygon);
  if (!S.currentGeoJSON) {
    console.log('No data loaded to unselect from');
    return;
  }
  const candidateCount = S.currentGeoJSON.features.filter(f =>
    f.geometry && f.id && featureIntersectsBbox(f, bbox)
  ).length;
  console.log(`Broad-phase filtering: ${candidateCount} features out of ${S.currentGeoJSON.features.length} candidates`);

  updateParcelsInArea(
    (feature) => featureIntersectsBbox(feature, bbox) && featureIntersectsPolygon(feature, polygon),
    false
  );
}

/* ------------------------------------------------------------------ */
/*  Rectangle selection tool                                          */
/* ------------------------------------------------------------------ */

export function createRectangleElement(): HTMLDivElement {
  ensureMarchingAntsStyles();
  const rect = document.createElement('div');
  rect.className = 'selection-rect';
  document.body.appendChild(rect);
  return rect;
}

export function handleRectangleMouseDown(e: MouseEvent) {
  if (S.currentSelectionMode !== 'select-rectangle') return;
  if (e.button !== 0) return;

  e.preventDefault();
  e.stopPropagation();

  const isRemoveMode = e.altKey && !e.shiftKey;

  if (isRemoveMode) {
    S.isRectangleUnselecting = true;
  } else {
    S.isRectangleSelecting = true;
  }

  S.rectangleStartPoint = getViewportPoint(e);

  S.originalDragPan = S.map.dragPan.isEnabled();
  S.map.dragPan.disable();

  if (S.rectangleElement) {
    const viewportPoint = getViewportPoint(e);
    S.rectangleElement.style.display = 'block';
    S.rectangleElement.style.left = `${viewportPoint.x}px`;
    S.rectangleElement.style.top = `${viewportPoint.y}px`;
    S.rectangleElement.style.width = '0px';
    S.rectangleElement.style.height = '0px';

    if (isRemoveMode) {
      S.rectangleElement.classList.add('unselect');
    } else {
      S.rectangleElement.classList.remove('unselect');
    }
  }

  S.map.getCanvas().style.cursor = 'default';
}

export function handleRectangleMouseMove(e: MouseEvent) {
  if (S.currentSelectionMode !== 'select-rectangle' || (!S.isRectangleSelecting && !S.isRectangleUnselecting) || !S.rectangleStartPoint || !S.rectangleElement) return;

  const currentViewportPoint = getViewportPoint(e);
  const left = Math.min(S.rectangleStartPoint.x, currentViewportPoint.x);
  const top = Math.min(S.rectangleStartPoint.y, currentViewportPoint.y);
  const width = Math.abs(currentViewportPoint.x - S.rectangleStartPoint.x);
  const height = Math.abs(currentViewportPoint.y - S.rectangleStartPoint.y);

  S.rectangleElement.style.left = `${left}px`;
  S.rectangleElement.style.top = `${top}px`;
  S.rectangleElement.style.width = `${width}px`;
  S.rectangleElement.style.height = `${height}px`;
}

export function handleRectangleMouseUp(e: MouseEvent) {
  if (S.currentSelectionMode !== 'select-rectangle' || (!S.isRectangleSelecting && !S.isRectangleUnselecting) || !S.rectangleStartPoint || !S.rectangleElement) return;

  const currentViewportPoint = getViewportPoint(e);

  const viewportWidth = Math.abs(currentViewportPoint.x - S.rectangleStartPoint.x);
  const viewportHeight = Math.abs(currentViewportPoint.y - S.rectangleStartPoint.y);

  if (viewportWidth > 5 && viewportHeight > 5) {
    const canvas = S.map.getCanvas();
    const rect = canvas.getBoundingClientRect();

    const mapStartPoint = new maplibregl.Point(
      S.rectangleStartPoint.x - rect.left,
      S.rectangleStartPoint.y - rect.top
    );
    const mapCurrentPoint = new maplibregl.Point(
      currentViewportPoint.x - rect.left,
      currentViewportPoint.y - rect.top
    );

    const topLeft = S.map.unproject([mapStartPoint.x, mapStartPoint.y]);
    const bottomRight = S.map.unproject([mapCurrentPoint.x, mapCurrentPoint.y]);

    const bbox: [number, number, number, number] = [
      Math.min(topLeft.lng, bottomRight.lng),
      Math.min(topLeft.lat, bottomRight.lat),
      Math.max(topLeft.lng, bottomRight.lng),
      Math.max(topLeft.lat, bottomRight.lat)
    ];

    const viewportLeft = Math.min(S.rectangleStartPoint.x, currentViewportPoint.x);
    const viewportTop = Math.min(S.rectangleStartPoint.y, currentViewportPoint.y);
    const mode = S.isRectangleUnselecting ? 'Unselect' : 'Select';
    console.log(`Rectangle ${mode} Coordinates:`);
    console.log('Viewport space:', { left: viewportLeft, top: viewportTop, width: viewportWidth, height: viewportHeight });
    console.log('Map coordinates (bbox):', bbox);
    console.log('Top-left:', { lng: topLeft.lng, lat: topLeft.lat });
    console.log('Bottom-right:', { lng: bottomRight.lng, lat: bottomRight.lat });

    if (S.isRectangleUnselecting) {
      unselectParcelsInBoundingBox(bbox);
    } else {
      const isSelectOnlyMode = !e.shiftKey && !e.altKey;
      if (isSelectOnlyMode) {
        clearAllSelections();
        selectParcelsInBoundingBox(bbox);
      } else {
        selectParcelsInBoundingBox(bbox);
      }
    }
  }

  S.isRectangleSelecting = false;
  S.isRectangleUnselecting = false;
  S.rectangleStartPoint = null;

  if (S.rectangleElement) {
    S.rectangleElement.style.display = 'none';
    S.rectangleElement.classList.remove('unselect');
  }

  if (S.originalDragPan !== undefined) {
    if (S.originalDragPan) {
      S.map.dragPan.enable();
    }
    S.originalDragPan = undefined;
  }

  _updateCursor();
}

/* ------------------------------------------------------------------ */
/*  Lasso selection tool                                              */
/* ------------------------------------------------------------------ */

let isLassoSelecting = false;
let isLassoUnselecting = false;
let lassoPoints: maplibregl.Point[] = [];
let lassoElement: HTMLDivElement | null = null;
let lassoSVG: SVGElement | null = null;
let lassoPath: SVGPathElement | null = null;

export function createLassoElement(): HTMLDivElement {
  const lasso = document.createElement('div');
  lasso.className = 'lasso-selection';
  lasso.style.cssText = `
    position: absolute;
    pointer-events: none;
    z-index: 1000;
    display: none;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  `;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  `;

  const fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fillPath.setAttribute('class', 'lasso-fill');

  const bgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  bgPath.setAttribute('class', 'lasso-path-bg select');

  const fgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fgPath.setAttribute('class', 'lasso-path select');

  svg.appendChild(fillPath);
  svg.appendChild(bgPath);
  svg.appendChild(fgPath);
  lasso.appendChild(svg);
  document.body.appendChild(lasso);

  return lasso;
}

function updateLassoPath() {
  if (!lassoElement || lassoPoints.length < 2) return;

  const fillPath = lassoElement.querySelector('.lasso-fill') as SVGPathElement;
  const bgPath = lassoElement.querySelector('.lasso-path-bg') as SVGPathElement;
  const fgPath = lassoElement.querySelector('.lasso-path') as SVGPathElement;

  if (!fillPath || !bgPath || !fgPath) return;

  let pathData = `M ${lassoPoints[0].x} ${lassoPoints[0].y}`;

  for (let i = 1; i < lassoPoints.length; i++) {
    pathData += ` L ${lassoPoints[i].x} ${lassoPoints[i].y}`;
  }

  if (lassoPoints.length > 2) {
    pathData += ` Z`;
  }

  fillPath.setAttribute('d', pathData);
  bgPath.setAttribute('d', pathData);
  fgPath.setAttribute('d', pathData);
}

export function handleLassoMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;

  e.preventDefault();
  e.stopPropagation();

  const isRemoveMode = e.altKey && !e.shiftKey;

  if (isRemoveMode) {
    isLassoUnselecting = true;
  } else {
    isLassoSelecting = true;
  }

  lassoPoints = [getViewportPoint(e)];

  S.originalDragPan = S.map.dragPan.isEnabled();
  S.map.dragPan.disable();

  if (lassoElement) {
    lassoElement.style.display = 'block';

    const fillPath = lassoElement.querySelector('.lasso-fill') as SVGPathElement;
    const bgPath = lassoElement.querySelector('.lasso-path-bg') as SVGPathElement;
    const fgPath = lassoElement.querySelector('.lasso-path') as SVGPathElement;

    if (isRemoveMode) {
      fillPath?.setAttribute('class', 'lasso-fill unselect');
      bgPath?.setAttribute('class', 'lasso-path-bg unselect');
      fgPath?.setAttribute('class', 'lasso-path unselect');
    } else {
      fillPath?.setAttribute('class', 'lasso-fill');
      bgPath?.setAttribute('class', 'lasso-path-bg select');
      fgPath?.setAttribute('class', 'lasso-path select');
    }
  }

  S.map.getCanvas().style.cursor = 'default';
}

export function handleLassoMouseMove(e: MouseEvent) {
  if ((!isLassoSelecting && !isLassoUnselecting) || !lassoElement) return;

  const currentPoint = getViewportPoint(e);
  const lastPoint = lassoPoints[lassoPoints.length - 1];

  if (currentPoint.dist(lastPoint) >= 5) {
    lassoPoints.push(currentPoint);
    updateLassoPath();
  }
}

export function handleLassoMouseUp(e: MouseEvent) {
  if ((!isLassoSelecting && !isLassoUnselecting) || !lassoElement) return;

  if (lassoPoints.length >= 3) {
    lassoPoints.push(lassoPoints[0]);
    updateLassoPath();

    const mapCoordinates = lassoPoints.map(point => {
      const canvas = S.map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const mapPoint = new maplibregl.Point(
        point.x - rect.left,
        point.y - rect.top
      );
      return S.map.unproject([mapPoint.x, mapPoint.y]);
    });

    const polygon = mapCoordinates.map(coord => [coord.lng, coord.lat]);

    const mode = isLassoUnselecting ? 'Unselect' : 'Select';
    console.log(`Lasso ${mode} Coordinates:`, polygon);

    if (isLassoUnselecting) {
      unselectParcelsInPolygon(polygon);
    } else {
      const isSelectOnlyMode = !e.shiftKey && !e.altKey;
      if (isSelectOnlyMode) {
        clearAllSelections();
      }
      selectParcelsInPolygon(polygon);
    }
  }

  isLassoSelecting = false;
  isLassoUnselecting = false;
  lassoPoints = [];

  if (lassoElement) {
    lassoElement.style.display = 'none';
  }

  if (S.originalDragPan !== undefined) {
    if (S.originalDragPan) {
      S.map.dragPan.enable();
    }
    S.originalDragPan = undefined;
  }

  _updateCursor();
}

/* ------------------------------------------------------------------ */
/*  Polygon selection tool                                            */
/* ------------------------------------------------------------------ */

let isPolygonSelecting = false;
let isPolygonUnselecting = false;
let polygonPoints: maplibregl.Point[] = [];
let polygonElement: HTMLDivElement | null = null;
let polygonSVG: SVGElement | null = null;
let polygonPath: SVGPathElement | null = null;
let polygonStartPoint: maplibregl.Point | null = null;
let isPolygonClosing = false;
let polygonSelectionMode: 'select-only' | 'add' | 'remove' = 'select-only';

export function createPolygonElement(): HTMLDivElement {
  const polygon = document.createElement('div');
  polygon.className = 'polygon-selection';
  polygon.style.cssText = `
    position: absolute;
    pointer-events: none;
    z-index: 1000;
    display: none;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  `;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  `;

  const fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fillPath.setAttribute('class', 'polygon-fill');

  const bgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  bgPath.setAttribute('class', 'polygon-path-bg select');

  const fgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fgPath.setAttribute('class', 'polygon-path select');

  const closingIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  closingIndicator.setAttribute('class', 'polygon-closing-indicator');
  closingIndicator.setAttribute('r', '8');
  closingIndicator.style.display = 'none';

  svg.appendChild(fillPath);
  svg.appendChild(bgPath);
  svg.appendChild(fgPath);
  svg.appendChild(closingIndicator);
  polygon.appendChild(svg);
  document.body.appendChild(polygon);

  return polygon;
}

function updatePolygonPath(currentMousePoint?: maplibregl.Point) {
  if (!polygonElement || polygonPoints.length === 0) return;

  const fillPath = polygonElement.querySelector('.polygon-fill') as SVGPathElement;
  const bgPath = polygonElement.querySelector('.polygon-path-bg') as SVGPathElement;
  const fgPath = polygonElement.querySelector('.polygon-path') as SVGPathElement;

  if (!fillPath || !bgPath || !fgPath) return;

  let pathData = `M ${polygonPoints[0].x} ${polygonPoints[0].y}`;

  for (let i = 1; i < polygonPoints.length; i++) {
    pathData += ` L ${polygonPoints[i].x} ${polygonPoints[i].y}`;
  }

  if (currentMousePoint && polygonPoints.length > 0) {
    pathData += ` L ${currentMousePoint.x} ${currentMousePoint.y}`;
  }

  if (polygonPoints.length >= 3) {
    pathData += ` Z`;
  }

  fillPath.setAttribute('d', pathData);
  bgPath.setAttribute('d', pathData);
  fgPath.setAttribute('d', pathData);
}

function closePolygon() {
  if ((!isPolygonSelecting && !isPolygonUnselecting) || !polygonElement || polygonPoints.length < 3) return;

  const mapCoordinates = polygonPoints.map(point => {
    const canvas = S.map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const mapPoint = new maplibregl.Point(
      point.x - rect.left,
      point.y - rect.top
    );
    return S.map.unproject([mapPoint.x, mapPoint.y]);
  });

  const polygon = mapCoordinates.map(coord => [coord.lng, coord.lat]);

  const mode = isPolygonUnselecting ? 'Unselect' : 'Select';
  console.log(`Polygon ${mode} Coordinates:`, polygon);

  if (polygonSelectionMode === 'remove') {
    unselectParcelsInPolygon(polygon);
  } else if (polygonSelectionMode === 'select-only') {
    clearAllSelections();
    selectParcelsInPolygon(polygon);
  } else {
    selectParcelsInPolygon(polygon);
  }

  isPolygonSelecting = false;
  isPolygonUnselecting = false;
  polygonPoints = [];
  polygonStartPoint = null;
  isPolygonClosing = false;

  if (polygonElement) {
    polygonElement.style.display = 'none';
    const closingIndicator = polygonElement.querySelector('.polygon-closing-indicator') as SVGCircleElement;
    if (closingIndicator) {
      closingIndicator.style.display = 'none';
    }
  }

  if (S.originalDragPan !== undefined) {
    if (S.originalDragPan) {
      S.map.dragPan.enable();
    }
    S.originalDragPan = undefined;
  }

  _updateCursor();
}

export function handlePolygonMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;

  e.preventDefault();
  e.stopPropagation();

  const isAddMode = e.shiftKey && !e.altKey;
  const isRemoveMode = e.altKey && !e.shiftKey;
  const currentPoint = getViewportPoint(e);

  if (polygonPoints.length === 0) {
    isPolygonSelecting = !isRemoveMode;
    isPolygonUnselecting = isRemoveMode;

    if (isRemoveMode) {
      polygonSelectionMode = 'remove';
    } else if (isAddMode) {
      polygonSelectionMode = 'add';
    } else {
      polygonSelectionMode = 'select-only';
    }

    polygonStartPoint = currentPoint;
    polygonPoints = [currentPoint];

    S.originalDragPan = S.map.dragPan.isEnabled();
    S.map.dragPan.disable();

    if (polygonElement) {
      polygonElement.style.display = 'block';

      const fillPath = polygonElement.querySelector('.polygon-fill') as SVGPathElement;
      const bgPath = polygonElement.querySelector('.polygon-path-bg') as SVGPathElement;
      const fgPath = polygonElement.querySelector('.polygon-path') as SVGPathElement;

      if (isRemoveMode) {
        fillPath?.setAttribute('class', 'polygon-fill unselect');
        bgPath?.setAttribute('class', 'polygon-path-bg unselect');
        fgPath?.setAttribute('class', 'polygon-path unselect');
      } else {
        fillPath?.setAttribute('class', 'polygon-fill');
        bgPath?.setAttribute('class', 'polygon-path-bg select');
        fgPath?.setAttribute('class', 'polygon-path select');
      }
    }

    S.map.getCanvas().style.cursor = 'default';
  } else {
    if (polygonStartPoint && currentPoint.dist(polygonStartPoint) <= 10) {
      closePolygon();
    } else {
      polygonPoints.push(currentPoint);
      updatePolygonPath();
    }
  }
}

export function handlePolygonMouseMove(e: MouseEvent) {
  if ((!isPolygonSelecting && !isPolygonUnselecting) || !polygonElement || polygonPoints.length === 0) return;

  const currentPoint = getViewportPoint(e);

  if (polygonStartPoint && currentPoint.dist(polygonStartPoint) <= 10) {
    if (!isPolygonClosing) {
      isPolygonClosing = true;
      const closingIndicator = polygonElement.querySelector('.polygon-closing-indicator') as SVGCircleElement;
      if (closingIndicator) {
        const isUnselectMode = isPolygonUnselecting;
        closingIndicator.setAttribute('cx', polygonStartPoint.x.toString());
        closingIndicator.setAttribute('cy', polygonStartPoint.y.toString());
        closingIndicator.setAttribute('class', `polygon-closing-indicator ${isUnselectMode ? 'unselect' : 'select'}`);
        closingIndicator.style.display = 'block';
      }
    }
  } else {
    if (isPolygonClosing) {
      isPolygonClosing = false;
      const closingIndicator = polygonElement.querySelector('.polygon-closing-indicator') as SVGCircleElement;
      if (closingIndicator) {
        closingIndicator.style.display = 'none';
      }
    }
  }

  updatePolygonPath(currentPoint);
}

export function handlePolygonDoubleClick(e: MouseEvent) {
  if ((!isPolygonSelecting && !isPolygonUnselecting) || polygonPoints.length < 3) return;

  e.preventDefault();
  e.stopPropagation();

  closePolygon();
}

/* ------------------------------------------------------------------ */
/*  Initialization (create DOM elements + document-level listeners)   */
/* ------------------------------------------------------------------ */

export function initSelectionElements() {
  // Rectangle element
  S.rectangleElement = createRectangleElement();

  // Lasso element
  lassoElement = createLassoElement();
  lassoSVG = lassoElement.querySelector('svg') as SVGElement;
  lassoPath = lassoElement.querySelector('.lasso-path') as SVGPathElement;

  // Polygon element
  polygonElement = createPolygonElement();
  polygonSVG = polygonElement.querySelector('svg') as SVGElement;
  polygonPath = polygonElement.querySelector('.polygon-path') as SVGPathElement;

  // Document-level mouse-up listeners for catching releases outside the map
  document.addEventListener('mouseup', handleRectangleMouseUp);
  document.addEventListener('mouseup', handleLassoMouseUp);
}
