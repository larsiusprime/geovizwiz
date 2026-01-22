// Imports
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import type { Expression } from 'maplibre-gl';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';
import { parquetMetadataAsync, parquetSchema } from 'hyparquet';


// Local imports
import { OSM_STYLE, SOURCE_ID, LAYER_ID, ERROR_LAYER_ID, HEIGHT_CAP_METERS, HEIGHT_PCTL, COLOR_RAMPS, UNIT_TO_METERS } from './config';
import { coerceScalar, sanitizeFeatureInPlace, sanitizeFeaturesInPlace, fileToAsyncBuffer, } from './utils.sanitize';
import { type AsyncBuffer } from './utils.sanitize';
import { roundGeometryInPlace, trimPropertiesInPlace, bbox } from './utils.geo';
import { numOrNull, fmt, percentile, quantileBreaks } from './utils.number';
import { makeFieldCheckbox, divider } from './utils.dom';


/* ---------------- Map Bootstrap ----------------- */


const HQ_PR = Math.min(3, window.devicePixelRatio * 2); // 2–3 is a good "HQ" target

const map = new maplibregl.Map({
  container: 'map',
  style: OSM_STYLE,
  center: [-95.3698, 29.7604],
  zoom: 10,
  pitch: 45,
  bearing: -20,
  hash: true,
  boxZoom: false,
  doubleClickZoom: false,
  pixelRatio: HQ_PR // supersample: render at higher internal resolution (smooth lines)
});
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
/* ---------------- Cursor Management ---------------- */

// Update cursor based on active tool
function updateCursor() {
  if (isInfoToolActive) {
    map.getCanvas().style.cursor = 'pointer';
  } else if (isPanToolActive) {
    map.getCanvas().style.cursor = 'grab';
  } else {
    // When SELECT mode is engaged, use arrow cursor
    map.getCanvas().style.cursor = 'default';
  }
}

/* ---------------- Helper Functions ---------------- */

// Helper function to get viewport coordinates for visual elements
function getViewportPoint(e: MouseEvent): maplibregl.Point {
  return new maplibregl.Point(e.clientX, e.clientY);
}

// Helper function to convert viewport coordinates to map container coordinates
function getMapPoint(e: MouseEvent): maplibregl.Point {
  const canvas = map.getCanvas();
  const rect = canvas.getBoundingClientRect();
  return new maplibregl.Point(
    e.clientX - rect.left,
    e.clientY - rect.top
  );
}

// Pan tool mouse handlers - just for cursor management
function handlePanMouseDown(e: MouseEvent) {
  if (!isPanToolActive || e.button !== 0) return;
  
  isPanning = true;
  map.getCanvas().style.cursor = 'grabbing';
}

function handlePanMouseMove(_e: MouseEvent) {
  // No special handling needed - MapLibre handles the panning
}

function handlePanMouseUp(_e: MouseEvent) {
  if (!isPanToolActive || !isPanning) return;
  
  isPanning = false;
  map.getCanvas().style.cursor = 'grab';
}


/* ---------------- Pan Tool ---------------- */

// Pan tool state
let isPanning = false;

/* ---------------- Rectangle Selection Tool ---------------- */

// Rectangle selection state
let isRectangleSelecting = false;
let isRectangleUnselecting = false;
let rectangleStartPoint: maplibregl.Point | null = null;
let rectangleElement: HTMLDivElement | null = null;
let originalDragPan: boolean | undefined;

// Inject marching-ants CSS once (uniform speed)
function ensureMarchingAntsStyles() {
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

function createRectangleElement(): HTMLDivElement {
  ensureMarchingAntsStyles();
  const rect = document.createElement('div');
  rect.className = 'selection-rect';
  document.body.appendChild(rect);
  return rect;
}

// Initialize rectangle element
rectangleElement = createRectangleElement();

// Rectangle selection mouse handlers
function handleRectangleMouseDown(e: MouseEvent) {
  // Only activate if we're in rectangle selection mode
  if (currentSelectionMode !== 'select-rectangle') return;
  
  // Only activate on left click (select only), shift+left click (add), or alt+left click (remove)
  if (e.button !== 0) return;
  
  // Prevent default behavior
  e.preventDefault();
  e.stopPropagation();
  
  // Determine mode based on modifier keys
  const isAddMode = e.shiftKey && !e.altKey;
  const isRemoveMode = e.altKey && !e.shiftKey;
  const isSelectOnlyMode = !e.shiftKey && !e.altKey;
  
  // Start rectangle selection/unselection
  if (isRemoveMode) {
    isRectangleUnselecting = true;
  } else {
    isRectangleSelecting = true;
  }
  
  // Store start point in viewport coordinates for visual positioning
  rectangleStartPoint = getViewportPoint(e);
  
  // Temporarily disable map drag pan
  originalDragPan = map.dragPan.isEnabled();
  map.dragPan.disable();
  
  // Show rectangle element with appropriate styling
  if (rectangleElement) {
    const viewportPoint = getViewportPoint(e);
    rectangleElement.style.display = 'block';
    rectangleElement.style.left = `${viewportPoint.x}px`;
    rectangleElement.style.top = `${viewportPoint.y}px`;
    rectangleElement.style.width = '0px';
    rectangleElement.style.height = '0px';
    
    // Apply styling based on mode
    if (isRemoveMode) {
      rectangleElement.classList.add('unselect');
    } else {
      rectangleElement.classList.remove('unselect');
    }
  }
  
  // Change cursor to arrow for SELECT mode
  map.getCanvas().style.cursor = 'default';
}

function handleRectangleMouseMove(e: MouseEvent) {
  if (currentSelectionMode !== 'select-rectangle' || (!isRectangleSelecting && !isRectangleUnselecting) || !rectangleStartPoint || !rectangleElement) return;
  
  // Calculate rectangle dimensions for visual positioning (viewport coordinates)
  const currentViewportPoint = getViewportPoint(e);
  const left = Math.min(rectangleStartPoint.x, currentViewportPoint.x);
  const top = Math.min(rectangleStartPoint.y, currentViewportPoint.y);
  const width = Math.abs(currentViewportPoint.x - rectangleStartPoint.x);
  const height = Math.abs(currentViewportPoint.y - rectangleStartPoint.y);
  
  // Update rectangle element
  rectangleElement.style.left = `${left}px`;
  rectangleElement.style.top = `${top}px`;
  rectangleElement.style.width = `${width}px`;
  rectangleElement.style.height = `${height}px`;
}

function handleRectangleMouseUp(e: MouseEvent) {
  if (currentSelectionMode !== 'select-rectangle' || (!isRectangleSelecting && !isRectangleUnselecting) || !rectangleStartPoint || !rectangleElement) return;
  
  // Get current point in viewport coordinates
  const currentViewportPoint = getViewportPoint(e);
  
  // Calculate rectangle dimensions in viewport coordinates
  const viewportLeft = Math.min(rectangleStartPoint.x, currentViewportPoint.x);
  const viewportTop = Math.min(rectangleStartPoint.y, currentViewportPoint.y);
  const viewportWidth = Math.abs(currentViewportPoint.x - rectangleStartPoint.x);
  const viewportHeight = Math.abs(currentViewportPoint.y - rectangleStartPoint.y);
  
  // Only process if rectangle has meaningful size
  if (viewportWidth > 5 && viewportHeight > 5) {
    // Convert viewport coordinates to map coordinates for selection logic
    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    
    // Convert viewport coordinates to map container coordinates
    const mapStartPoint = new maplibregl.Point(
      rectangleStartPoint.x - rect.left,
      rectangleStartPoint.y - rect.top
    );
    const mapCurrentPoint = new maplibregl.Point(
      currentViewportPoint.x - rect.left,
      currentViewportPoint.y - rect.top
    );
    
    // Convert to geographic coordinates
    const topLeft = map.unproject([mapStartPoint.x, mapStartPoint.y]);
    const bottomRight = map.unproject([mapCurrentPoint.x, mapCurrentPoint.y]);
    
    // Create bounding box
    const bbox: [number, number, number, number] = [
      Math.min(topLeft.lng, bottomRight.lng),
      Math.min(topLeft.lat, bottomRight.lat),
      Math.max(topLeft.lng, bottomRight.lng),
      Math.max(topLeft.lat, bottomRight.lat)
    ];
    
    // Log coordinates to console
    const mode = isRectangleUnselecting ? 'Unselect' : 'Select';
    console.log(`Rectangle ${mode} Coordinates:`);
    console.log('Viewport space:', { left: viewportLeft, top: viewportTop, width: viewportWidth, height: viewportHeight });
    console.log('Map coordinates (bbox):', bbox);
    console.log('Top-left:', { lng: topLeft.lng, lat: topLeft.lat });
    console.log('Bottom-right:', { lng: bottomRight.lng, lat: bottomRight.lat });
    
    // Handle different selection modes
    if (isRectangleUnselecting) {
      // Remove parcels from selection
      unselectParcelsInBoundingBox(bbox);
    } else {
      // Check if this is select-only mode (no modifiers)
      const isSelectOnlyMode = !e.shiftKey && !e.altKey;
      if (isSelectOnlyMode) {
        // Select only these parcels, unselect all others
        clearAllSelections();
        selectParcelsInBoundingBox(bbox);
      } else {
        // Add parcels to selection
        selectParcelsInBoundingBox(bbox);
      }
    }
  }
  
  // Clean up
  isRectangleSelecting = false;
  isRectangleUnselecting = false;
  rectangleStartPoint = null;
  
  // Hide rectangle element
  if (rectangleElement) {
    rectangleElement.style.display = 'none';
    rectangleElement.classList.remove('unselect');
  }
  
  // Restore map drag pan
  if (originalDragPan !== undefined) {
    if (originalDragPan) {
      map.dragPan.enable();
    }
    originalDragPan = undefined;
  }
  
  // Restore cursor
  updateCursor();
}

// Function to select parcels within a bounding box
function selectParcelsInBoundingBox(bbox: [number, number, number, number]) {
  if (!currentGeoJSON) {
    console.log('No data loaded to select from');
    return;
  }
  const sourceId = getCurrentSourceId();
  if (!sourceId) return;
  
  const [minLng, minLat, maxLng, maxLat] = bbox;
  let selectedCount = 0;
  
  // Check each feature to see if it intersects with the bounding box
  for (const feature of currentGeoJSON.features) {
    if (!feature.geometry || !feature.id) continue;
    
    // Check if the feature's bounding box intersects with our selection box
    if (featureIntersectsBbox(feature, bbox)) {
      const parcelId = getParcelId(feature);
      selectedParcels.add(parcelId);
      
      // Set feature state for highlighting
      map.setFeatureState(
        { source: sourceId, id: feature.id },
        { selected: true }
      );
      
      selectedCount++;
    }
  }
  
  console.log(`Selected ${selectedCount} parcels within the rectangle`);
  
  // Update the selection controls UI
  updateSelectionControls();
}

// Function to unselect parcels within a bounding box
function unselectParcelsInBoundingBox(bbox: [number, number, number, number]) {
  if (!currentGeoJSON) {
    console.log('No data loaded to unselect from');
    return;
  }
  const sourceId = getCurrentSourceId();
  if (!sourceId) return;
  
  const [minLng, minLat, maxLng, maxLat] = bbox;
  let unselectedCount = 0;
  
  // Check each feature to see if it intersects with the bounding box
  for (const feature of currentGeoJSON.features) {
    if (!feature.geometry || !feature.id) continue;
    
    // Check if the feature's bounding box intersects with our selection box
    if (featureIntersectsBbox(feature, bbox)) {
      const parcelId = getParcelId(feature);
      
      // Only unselect if it was previously selected
      if (selectedParcels.has(parcelId)) {
        selectedParcels.delete(parcelId);
        
        // Set feature state to remove highlighting
        map.setFeatureState(
          { source: sourceId, id: feature.id },
          { selected: false }
        );
        
        unselectedCount++;
      }
    }
  }
  
  console.log(`Unselected ${unselectedCount} parcels within the rectangle`);
  
  // Update the selection controls UI
  updateSelectionControls();
}

// Helper function to check if a feature intersects with a bounding box
function featureIntersectsBbox(feature: GeoJSON.Feature, bbox: [number, number, number, number]): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  
  if (feature.geometry.type === 'Polygon') {
    return polygonIntersectsBbox(feature.geometry.coordinates, bbox);
  } else if (feature.geometry.type === 'MultiPolygon') {
    return feature.geometry.coordinates.some(polygon => 
      polygonIntersectsBbox(polygon, bbox)
    );
  }
  
  return false;
}

// Helper function to check if a polygon intersects with a bounding box
function polygonIntersectsBbox(polygon: number[][][], bbox: [number, number, number, number]): boolean {
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
  // This handles cases where the selection rectangle is smaller than the polygon
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

// Point-in-polygon test using ray casting algorithm
function pointInPolygon(point: number[], polygon: number[][]): boolean {
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

// Also handle mouse events on the document to catch mouse up outside the map
document.addEventListener('mouseup', handleRectangleMouseUp);
document.addEventListener('mouseup', handleLassoMouseUp);


/* ---------------- UI elements ---------------- */


const fileInput = document.getElementById('file') as HTMLInputElement;
const fieldSelect = document.getElementById('field') as HTMLSelectElement;
const rampSelect = document.getElementById('ramp') as HTMLSelectElement;
const enable3DCheckbox = document.getElementById('enable3D') as HTMLInputElement;
const extrusionOptions = document.getElementById('extrusionOptions') as HTMLFieldSetElement;
const multInput = document.getElementById('mult') as HTMLInputElement;
const unitsSelect = document.getElementById('units') as HTMLSelectElement;
const layerList = document.getElementById('layerList') as HTMLDivElement;
const layerDataStoreSelect = document.getElementById('layerDataStoreSelect') as HTMLSelectElement;
const addLayerFromStoreButton = document.getElementById('addLayerFromStore') as HTMLButtonElement;
const opacityInput = document.getElementById('opacity') as HTMLInputElement;
const opacityOut = document.getElementById('opacityVal') as HTMLOutputElement
const normAsIs = document.getElementById('norm-asis') as HTMLInputElement;
const normLand = document.getElementById('norm-land') as HTMLInputElement;
const normBldg = document.getElementById('norm-bldg') as HTMLInputElement;
const normLandUnitEl = document.getElementById('normLandUnit') as HTMLElement;
const normBldgUnitEl = document.getElementById('normBldgUnit') as HTMLElement;
const sharedOptions = document.getElementById('sharedOptions') as HTMLFieldSetElement;

// Camera view buttons
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
(document.getElementById('btn-persp') as HTMLButtonElement)?.addEventListener('click', () => setPerspective());
(document.getElementById('btn-ortho') as HTMLButtonElement)?.addEventListener('click', () => setOrtho());
viewButtons.forEach(btn => btn.onclick = () => setView(btn.dataset.view!));

// Zoom to data button
const btnZoomTo = document.getElementById('btn-zoomto') as HTMLButtonElement;
btnZoomTo.onclick = () => { if (currentGeoJSON) fitToData(currentGeoJSON); };
if (addLayerFromStoreButton) {
  addLayerFromStoreButton.addEventListener('click', () => {
    const selectedId = layerDataStoreSelect?.value;
    if (!selectedId) return;
    addLayerFromDataStore(selectedId);
  });
}

// Window elements
const controlsEl = document.getElementById('controls') as HTMLDivElement;
const settingsContent = document.getElementById('settingsContent') as HTMLDivElement;

// Quality button (create after elements are declared)
const btnQuality = document.createElement('button');
btnQuality.id = 'btn-quality';
btnQuality.textContent = 'Quality: Fast';
btnQuality.style.cssText = 'border:1px solid #ddd;background:#f8f8f8;padding:6px 8px;border-radius:8px;cursor:pointer;margin-bottom:8px;';
btnQuality.onclick = () => setQuality(qualityMode === 'high' ? 'fast' : 'high');
settingsContent.prepend(btnQuality); // position at top of settings content
const btnMinimizeSettings = document.getElementById('btnMinimizeSettings') as HTMLButtonElement;

// Toolbar elements
const legendToolButton = document.getElementById('legendToolButton') as HTMLButtonElement;

// Floating legend elements
const floatingLegend = document.getElementById('floatingLegend') as HTMLDivElement;
const btnMinimizeLegend = document.getElementById('btnMinimizeLegend') as HTMLButtonElement;
const legendTitle = document.getElementById('legendTitle') as HTMLDivElement;
const legendContent = document.getElementById('legendContent') as HTMLDivElement;

// Modal overlays
const numericModalOverlay = document.getElementById('numericModalOverlay')!;
const categoricalModalOverlay = document.getElementById('categoricalModalOverlay')!;
const sizeOverlay = document.getElementById('sizeOverlay')!;
const loadingOverlay = document.getElementById('loadingOverlay')!;

// Numeric modal elements
const rowCountEl = document.getElementById('rowCount')!;
const geomColEl = document.getElementById('geomCol')!;
const numericFieldListEl = document.getElementById('numericFieldList')!;

const btnAllNumeric = document.getElementById('btnAllNumeric') as HTMLButtonElement;
const btnNoneNumeric = document.getElementById('btnNoneNumeric') as HTMLButtonElement;
const btnCancelNumericModal = document.getElementById('btnCancelNumericModal') as HTMLButtonElement;
const btnConfirmNumericModal = document.getElementById('btnConfirmNumericModal') as HTMLButtonElement;

// Categorical modal elements
const categoricalRowCountEl = document.getElementById('categoricalRowCount')!;
const categoricalGeomColEl = document.getElementById('categoricalGeomCol')!;
const categoricalFieldListEl = document.getElementById('categoricalFieldList')!;

const btnAllCategorical = document.getElementById('btnAllCategorical') as HTMLButtonElement;
const btnNoneCategorical = document.getElementById('btnNoneCategorical') as HTMLButtonElement;
const btnCancelCategoricalModal = document.getElementById('btnCancelCategoricalModal') as HTMLButtonElement;
const btnConfirmCategoricalModal = document.getElementById('btnConfirmCategoricalModal') as HTMLButtonElement;

const bldgFieldSel = document.getElementById('bldgField') as HTMLSelectElement;
const bldgUnitSel = document.getElementById('bldgUnit') as HTMLSelectElement;
const landFieldSel = document.getElementById('landField') as HTMLSelectElement;
const landUnitSel = document.getElementById('landUnit') as HTMLSelectElement;
const btnSizeBack = document.getElementById('btnSizeBack') as HTMLButtonElement;
const btnSizeSkip = document.getElementById('btnSizeSkip') as HTMLButtonElement;
const btnSizeOk = document.getElementById('btnSizeOk') as HTMLButtonElement;

const progressEl = document.getElementById('progress')!;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressMsg = document.getElementById('progressMsg') as HTMLDivElement;

// Color scaling radios
const colorCont = document.getElementById('color-cont') as HTMLInputElement | null;
const colorQuant = document.getElementById('color-quant') as HTMLInputElement | null;

// Color picker elements
const colorOptions = document.getElementById('colorOptions') as HTMLDivElement;
const colorPicker = document.getElementById('colorPicker') as HTMLInputElement;
const btnCancelColorPicker = document.getElementById('btnCancelColorPicker') as HTMLButtonElement;
const btnConfirmColorPicker = document.getElementById('btnConfirmColorPicker') as HTMLButtonElement;

// Color ramp choices
for (const key of Object.keys(COLOR_RAMPS)) {
  const opt = document.createElement('option'); opt.value = key; opt.textContent = key; rampSelect.appendChild(opt);
}
rampSelect.value = 'Viridis';


/* ---------------- Constants ---------------- */


// Token sets we match against
const UNIT_TOKENS = new Set([
  'sqft','ft2','sf','sqm','m2','km2','sqkm','mi2','sqmi',
  'ac','acre','acres','ha','hectare','hectares','acreage'
]);

const AREA_UNIT_CHOICES: { key: string, label: string }[] = [
  { key: 'sqm', label: 'square meters (m²)' },
  { key: 'sqft', label: 'square feet (ft²)' },
  { key: 'acres', label: 'acres' },
  { key: 'hectares', label: 'hectares' },
  { key: 'sqkm', label: 'square kilometers (km²)' },
  { key: 'sqmi', label: 'square miles (mi²)' },
  { key: 'other', label: 'other / unknown' }
];

const FAST_PR = window.devicePixelRatio;                  // normal speed
const HIGH_PR = Math.min(3, window.devicePixelRatio * 2); // 2–3x is a good HQ target


/* ---------------- State ---------------- */

type LayerState = {
  id: string;
  name: string;
  dataStoreId: string;
  sourceId: string;
  layerId: string;
  errorLayerId: string;
  visible: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  field: string | null;
  fieldType: 'numeric' | 'categorical' | null;
  stats: { min: number; max: number } | null;
  normalizationMode: 'asis' | 'perLand' | 'perBuilding';
  colorMode: ColorMode;
  categoricalColorMode: CategoricalColorMode;
  singleColorValue: string;
  ramp: string;
  colorDomain: { lo: number; hi: number; label: string } | null;
  colorBreaks: number[] | null;
  cachedExtrusionSettings: { multiplier: number; unit: string } | null;
  chosenNumericFields: string[];
  chosenCategoricalFields: string[];
  landSizeField: string | null;
  landSizeUnitLabel: string | null;
  bldgSizeField: string | null;
  bldgSizeUnitLabel: string | null;
  hiddenLegendItems: Set<string>;
  selectedLegendItems: Set<string>;
  selectedParcels: Set<string>;
  highlightColor: string;
  legendSortField: 'name' | 'count' | null;
  legendSortDirection: 'asc' | 'desc';
  customColors: Map<string, string>;
  is3DMode: boolean;
};

type DataStore = {
  id: string;
  name: string;
  file: File;
  asyncBuffer: AsyncBuffer;
  geojson: GeoJSON.FeatureCollection | null;
  numericFieldsFromSchema: string[];
  categoricalFieldsFromSchema: string[];
  chosenNumericFields: string[];
  chosenCategoricalFields: string[];
  landSizeField: string | null;
  landSizeUnitLabel: string | null;
  bldgSizeField: string | null;
  bldgSizeUnitLabel: string | null;
};

const layers = new Map<string, LayerState>();
const layerOrder: string[] = [];
let currentLayerId: string | null = null;
let layerCounter = 0;
const dataStores = new Map<string, DataStore>();
const dataStoreOrder: string[] = [];
let currentDataStoreId: string | null = null;


let currentGeoJSON: GeoJSON.FeatureCollection | null = null;
let currentField: string | null = null;
let currentFieldType: 'numeric' | 'categorical' | null = null;
let currentStats: { min: number; max: number } | null = null;

let normalizationMode: 'asis' | 'perLand' | 'perBuilding' = 'asis';
type ColorMode = 'continuous' | 'quantiles';
let colorMode: ColorMode = 'quantiles';

// For categorical fields
type CategoricalColorMode = 'random' | 'single' | 'colorRamp';
let categoricalColorMode: CategoricalColorMode = 'random';
let singleColorValue: string = '#3b82f6'; // Default blue color

// For continuous mode we may still show a domain label; optional
let colorDomain: { lo: number; hi: number; label: string } | null = null;

// For quantiles: thresholds between classes
let colorBreaks: number[] | null = null;

// 3D extrusion settings
let is3DMode = false; // Default to 2D mode
let cachedExtrusionSettings: { multiplier: number; unit: string } | null = null;

// staged loading
let lastFile: File | null = null;
let lastAsyncBuffer: AsyncBuffer | null = null;
let lastNumericFieldsFromSchema: string[] = [];
let lastCategoricalFieldsFromSchema: string[] = [];
let chosenNumericFields: string[] = [];
let chosenCategoricalFields: string[] = [];
let cancelRequested = false;

// size identification
let landSizeField: string | null = null;
let landSizeUnitLabel: string | null = null;
let bldgSizeField: string | null = null;
let bldgSizeUnitLabel: string | null = null;

// Welcome overlay (hide UI until a file is chosen)
let welcomeEl: HTMLDivElement | null = null;

// Non-blocking "Geometry is rendering..." toast
let renderToastEl: HTMLDivElement | null = null;
let dotsTimer: number | null = null;

type QualityMode = 'fast' | 'high';
let qualityMode: QualityMode = 'fast';


// --- popup state ---
let activePopup: maplibregl.Popup | null = null;
let lastPicked: { props: Record<string, any>, lngLat: maplibregl.LngLatLike } | null = null;

type UpdateMode = 'applyOnly' | 'recomputeAndAutoScale';

let _updTimer: number | null = null;
let _pendingMode: UpdateMode = 'applyOnly';
let _pendingRefreshLegend = false;

type MetricUnitKey = 'centimeters' | 'meters' | 'kilometers';

// Window state
let isSettingsMinimized = false;
let isLegendVisible = true;  // Start with legend visible
let isLegendMinimized = false;
let hiddenLegendItems = new Set<string>(); // Track which categories/ranges are hidden

// Selection state
let selectedLegendItems = new Set<string>(); // Track which categories/ranges are selected

// New parcel selection system
let selectedParcels = new Set<string>(); // Track selected parcel IDs
let highlightColor = '#FFFF00'; // Default bright yellow
let selectionControlsPanel: HTMLDivElement | null = null;

// Sorting state
let legendSortField: 'name' | 'count' | null = 'count';
let legendSortDirection: 'asc' | 'desc' = 'desc';

// Drag state
let isDragging = false;
let dragTarget: HTMLElement | null = null;
let dragOffset = { x: 0, y: 0 };

/* ---------------- FUNCTIONS ----------------- */

function getCurrentLayer(): LayerState | null {
  return currentLayerId ? layers.get(currentLayerId) ?? null : null;
}

function getCurrentLayerIds() {
  const layer = getCurrentLayer();
  if (!layer) return null;
  return { sourceId: layer.sourceId, layerId: layer.layerId, errorLayerId: layer.errorLayerId };
}

function getCurrentSourceId() {
  return getCurrentLayerIds()?.sourceId ?? null;
}

function createDataStore(file: File, asyncBuffer: AsyncBuffer): DataStore {
  const id = `store-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const name = file.name.replace(/\.[^/.]+$/, '') || file.name;
  return {
    id,
    name,
    file,
    asyncBuffer,
    geojson: null,
    numericFieldsFromSchema: [],
    categoricalFieldsFromSchema: [],
    chosenNumericFields: [],
    chosenCategoricalFields: [],
    landSizeField: null,
    landSizeUnitLabel: null,
    bldgSizeField: null,
    bldgSizeUnitLabel: null
  };
}

function renderDataStoreOptions() {
  if (!layerDataStoreSelect) return;
  layerDataStoreSelect.replaceChildren();

  if (dataStoreOrder.length === 0) {
    const opt = new Option('No data loaded yet', '');
    layerDataStoreSelect.appendChild(opt);
    layerDataStoreSelect.disabled = true;
    if (addLayerFromStoreButton) addLayerFromStoreButton.disabled = true;
    return;
  }

  dataStoreOrder.forEach(storeId => {
    const store = dataStores.get(storeId);
    if (!store) return;
    const opt = new Option(store.name, storeId);
    layerDataStoreSelect.appendChild(opt);
  });
  layerDataStoreSelect.disabled = false;
  if (addLayerFromStoreButton) addLayerFromStoreButton.disabled = false;
  if (!layerDataStoreSelect.value && currentDataStoreId) {
    layerDataStoreSelect.value = currentDataStoreId;
  }
}

function createLayerState(name: string, dataStoreId: string): LayerState {
  layerCounter += 1;
  const suffix = `layer-${layerCounter}`;
  return {
    id: suffix,
    name,
    dataStoreId,
    sourceId: `${SOURCE_ID}-${suffix}`,
    layerId: `${LAYER_ID}-${suffix}`,
    errorLayerId: `${ERROR_LAYER_ID}-${suffix}`,
    visible: true,
    geojson: null,
    field: null,
    fieldType: null,
    stats: null,
    normalizationMode: 'asis',
    colorMode: 'quantiles',
    categoricalColorMode: 'random',
    singleColorValue: '#3b82f6',
    ramp: rampSelect?.value ?? 'Viridis',
    colorDomain: null,
    colorBreaks: null,
    cachedExtrusionSettings: null,
    chosenNumericFields: [],
    chosenCategoricalFields: [],
    landSizeField: null,
    landSizeUnitLabel: null,
    bldgSizeField: null,
    bldgSizeUnitLabel: null,
    hiddenLegendItems: new Set(),
    selectedLegendItems: new Set(),
    selectedParcels: new Set(),
    highlightColor: '#FFFF00',
    legendSortField: 'count',
    legendSortDirection: 'desc',
    customColors: new Map(),
    is3DMode: false
  };
}

function persistCurrentLayerState() {
  const layer = getCurrentLayer();
  if (!layer) return;
  layer.geojson = currentGeoJSON;
  layer.field = currentField;
  layer.fieldType = currentFieldType;
  layer.stats = currentStats;
  layer.normalizationMode = normalizationMode;
  layer.colorMode = colorMode;
  layer.categoricalColorMode = categoricalColorMode;
  layer.singleColorValue = singleColorValue;
  layer.ramp = rampSelect?.value ?? layer.ramp;
  layer.colorDomain = colorDomain;
  layer.colorBreaks = colorBreaks;
  layer.cachedExtrusionSettings = cachedExtrusionSettings;
  layer.chosenNumericFields = [...chosenNumericFields];
  layer.chosenCategoricalFields = [...chosenCategoricalFields];
  layer.landSizeField = landSizeField;
  layer.landSizeUnitLabel = landSizeUnitLabel;
  layer.bldgSizeField = bldgSizeField;
  layer.bldgSizeUnitLabel = bldgSizeUnitLabel;
  layer.hiddenLegendItems = hiddenLegendItems;
  layer.selectedLegendItems = selectedLegendItems;
  layer.selectedParcels = selectedParcels;
  layer.highlightColor = highlightColor;
  layer.legendSortField = legendSortField;
  layer.legendSortDirection = legendSortDirection;
  layer.customColors = customColors;
  layer.is3DMode = is3DMode;
}

function applyLayerState(layer: LayerState) {
  currentGeoJSON = layer.geojson;
  currentField = layer.field;
  currentFieldType = layer.fieldType;
  currentStats = layer.stats;
  normalizationMode = layer.normalizationMode;
  colorMode = layer.colorMode;
  categoricalColorMode = layer.categoricalColorMode;
  singleColorValue = layer.singleColorValue;
  colorDomain = layer.colorDomain;
  colorBreaks = layer.colorBreaks;
  cachedExtrusionSettings = layer.cachedExtrusionSettings;
  chosenNumericFields = [...layer.chosenNumericFields];
  chosenCategoricalFields = [...layer.chosenCategoricalFields];
  landSizeField = layer.landSizeField;
  landSizeUnitLabel = layer.landSizeUnitLabel;
  bldgSizeField = layer.bldgSizeField;
  bldgSizeUnitLabel = layer.bldgSizeUnitLabel;
  hiddenLegendItems = layer.hiddenLegendItems;
  selectedLegendItems = layer.selectedLegendItems;
  selectedParcels = layer.selectedParcels;
  highlightColor = layer.highlightColor;
  legendSortField = layer.legendSortField;
  legendSortDirection = layer.legendSortDirection;
  customColors = layer.customColors;
  is3DMode = layer.is3DMode;
  currentDataStoreId = layer.dataStoreId;
  const store = dataStores.get(layer.dataStoreId);
  if (store) {
    lastFile = store.file;
    lastAsyncBuffer = store.asyncBuffer;
    lastNumericFieldsFromSchema = [...store.numericFieldsFromSchema];
    lastCategoricalFieldsFromSchema = [...store.categoricalFieldsFromSchema];
  }

  setSizeState(bldgSizeField, bldgSizeUnitLabel, landSizeField, landSizeUnitLabel);

  if (fieldSelect) {
    if (!currentGeoJSON) {
      fieldSelect.replaceChildren(new Option('— load a file first —', ''));
      fieldSelect.value = '';
    } else {
      const allAvailableFields = [
        ...chosenNumericFields.filter(k => currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k))),
        ...chosenCategoricalFields.filter(k => currentGeoJSON?.features?.some(f => f?.properties?.hasOwnProperty(k)))
      ];
      populateFieldDropdownFromList(allAvailableFields);
      fieldSelect.value = currentField ?? '';
    }
  }

  if (normAsIs && normLand && normBldg) {
    normAsIs.checked = normalizationMode === 'asis';
    normLand.checked = normalizationMode === 'perLand';
    normBldg.checked = normalizationMode === 'perBuilding';
  }

  if (colorCont && colorQuant) {
    colorCont.checked = colorMode === 'continuous';
    colorQuant.checked = colorMode === 'quantiles';
  }

  document.querySelectorAll<HTMLInputElement>('input[name="categoricalColorMode"]').forEach(radio => {
    radio.checked = radio.value === categoricalColorMode;
  });

  if (rampSelect && layer.ramp) {
    rampSelect.value = layer.ramp;
  }

  if (colorPicker) {
    colorPicker.value = singleColorValue;
  }

  enable3DCheckbox.checked = is3DMode;
  updateFieldTypeUI();
  update3DUI();
  updateFloatingLegend();
  updateSelectionControls();
  renderDataStoreOptions();

  if (map.getLayer(layer.layerId)) {
    setLayerVisibility(layer, layer.visible);
  }

  if (selectionControlsPanel) {
    const picker = selectionControlsPanel.querySelector('#highlightColorPicker') as HTMLInputElement | null;
    if (picker) picker.value = highlightColor;
  }
}

function registerLayer(layer: LayerState) {
  layers.set(layer.id, layer);
  layerOrder.unshift(layer.id);
  currentLayerId = layer.id;
  applyLayerState(layer);
  applyLayerOrderToMap();
  renderLayerList();
}

function moveLayerInOrder(layerId: string, direction: 'up' | 'down') {
  const index = layerOrder.indexOf(layerId);
  if (index === -1) return;
  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= layerOrder.length) return;
  layerOrder.splice(index, 1);
  layerOrder.splice(newIndex, 0, layerId);
  applyLayerOrderToMap();
  renderLayerList();
}

function applyLayerOrderToMap() {
  for (let i = layerOrder.length - 1; i >= 0; i -= 1) {
    const layerId = layerOrder[i];
    const layer = layers.get(layerId);
    if (!layer) continue;
    if (map.getLayer(layer.layerId)) {
      map.moveLayer(layer.layerId);
    }
    if (map.getLayer(layer.errorLayerId)) {
      map.moveLayer(layer.errorLayerId);
    }
  }
}

function addLayerFromDataStore(storeId: string) {
  const store = dataStores.get(storeId);
  if (!store) return;
  if (!store.geojson) {
    alert('That data set is not ready yet. Finish loading it first.');
    return;
  }
  persistCurrentLayerState();
  const layerName = `${store.name} (copy ${layerOrder.length + 1})`;
  const layer = createLayerState(layerName, store.id);
  layer.geojson = store.geojson;
  layer.chosenNumericFields = [...store.chosenNumericFields];
  layer.chosenCategoricalFields = [...store.chosenCategoricalFields];
  layer.landSizeField = store.landSizeField;
  layer.landSizeUnitLabel = store.landSizeUnitLabel;
  layer.bldgSizeField = store.bldgSizeField;
  layer.bldgSizeUnitLabel = store.bldgSizeUnitLabel;
  registerLayer(layer);
  addOrUpdateSource(layer.geojson);
  applyGrayRendering();
  applyLayerOrderToMap();
}

function setCurrentLayer(layerId: string) {
  if (currentLayerId === layerId) return;
  persistCurrentLayerState();
  const layer = layers.get(layerId);
  if (!layer) return;
  currentLayerId = layerId;
  applyLayerState(layer);
  renderLayerList();
  if (currentGeoJSON && currentField) {
    applyExtrusionWithVisibility();
  } else if (currentGeoJSON) {
    applyGrayRendering();
  }
}

function setLayerVisibility(layer: LayerState, visible: boolean) {
  layer.visible = visible;
  const visibility = visible ? 'visible' : 'none';
  if (map.getLayer(layer.layerId)) {
    map.setLayoutProperty(layer.layerId, 'visibility', visibility);
  }
  if (map.getLayer(layer.errorLayerId)) {
    map.setLayoutProperty(layer.errorLayerId, 'visibility', visibility);
  }
}

function removeLayer(layerId: string) {
  const layer = layers.get(layerId);
  if (!layer) return;
  if (map.getLayer(layer.layerId)) map.removeLayer(layer.layerId);
  if (map.getLayer(layer.errorLayerId)) map.removeLayer(layer.errorLayerId);
  if (map.getSource(layer.sourceId)) map.removeSource(layer.sourceId);
  layers.delete(layerId);
  const idx = layerOrder.indexOf(layerId);
  if (idx >= 0) layerOrder.splice(idx, 1);

  if (currentLayerId === layerId) {
    currentLayerId = layerOrder.length ? layerOrder[0] : null;
    if (currentLayerId) {
      applyLayerState(layers.get(currentLayerId)!);
    } else {
      currentGeoJSON = null;
      currentField = null;
      currentFieldType = null;
      currentStats = null;
      colorBreaks = null;
      colorDomain = null;
      customColors = new Map();
      hiddenLegendItems = new Set();
      selectedLegendItems = new Set();
      selectedParcels = new Set();
      highlightColor = '#FFFF00';
      fieldSelect.replaceChildren(new Option('— load a file first —', ''));
      updateFieldTypeUI();
      updateFloatingLegend();
      if (selectionControlsPanel) {
        selectionControlsPanel.style.display = 'none';
      }
    }
  }
  renderLayerList();
  applyLayerOrderToMap();
}

// Window management functions
function minimizeSettings() {
  isSettingsMinimized = true;
  settingsContent.style.display = 'none';
  controlsEl.style.display = 'none';
  
  // Update toolbar button states
  updateToolbarButtonStates();
}

function showSettings() {
  isSettingsMinimized = false;
  settingsContent.style.display = 'block';
  controlsEl.style.display = 'grid';
  
  // Update toolbar button states
  updateToolbarButtonStates();
}

function minimizeLegend() {
  isLegendMinimized = true;
  legendContent.style.display = 'none';
  floatingLegend.style.display = 'none';
  isLegendVisible = false;
  
  // Update toolbar button states
  updateToolbarButtonStates();
  
  // Update selection controls position
  updateSelectionControlsPosition();
  // Update legend position
  updateLegendPosition();
}

function showLegend() {
  isLegendMinimized = false;
  isLegendVisible = true;
  legendContent.style.display = 'block';
  floatingLegend.style.display = 'block';
  
  // Update toolbar button states
  updateToolbarButtonStates();
  
  updateFloatingLegend();
  // Update selection controls position
  updateSelectionControlsPosition();
  // Update legend position
  updateLegendPosition();
}

// Dragging functions
function makeDraggable(element: HTMLElement) {
  const header = element.querySelector('.window-header') as HTMLElement;
  if (!header) return;

  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragTarget = element;
    const rect = element.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    
    // Prevent text selection during drag
    e.preventDefault();
    document.body.style.userSelect = 'none';
  });
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging || !dragTarget) return;
  
  const x = e.clientX - dragOffset.x;
  const y = e.clientY - dragOffset.y;
  
  // Keep window within viewport bounds
  const rect = dragTarget.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width;
  const maxY = window.innerHeight - rect.height;
  
  const clampedX = Math.max(0, Math.min(x, maxX));
  const clampedY = Math.max(0, Math.min(y, maxY));
  
  dragTarget.style.left = `${clampedX}px`;
  dragTarget.style.top = `${clampedY}px`;
  dragTarget.style.transform = 'none'; // Remove any transform when dragging
  
  // If dragging the selection controls panel, update legend position
  if (dragTarget.id === 'selectionControlsPanel') {
    updateLegendPosition();
  }
}

function handleMouseUp() {
  isDragging = false;
  dragTarget = null;
  document.body.style.userSelect = '';
}

function renderLayerList() {
  if (!layerList) return;
  layerList.replaceChildren();

  if (layerOrder.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No layers loaded yet.';
    layerList.appendChild(empty);
    return;
  }

  layerOrder.forEach(layerId => {
    const layer = layers.get(layerId);
    if (!layer) return;

    const row = document.createElement('div');
    row.className = `layer-row${layerId === currentLayerId ? ' current' : ''}`;

    const visibilityToggle = document.createElement('input');
    visibilityToggle.type = 'checkbox';
    visibilityToggle.checked = layer.visible;
    visibilityToggle.title = layer.visible ? 'Hide layer' : 'Show layer';
    visibilityToggle.addEventListener('change', () => {
      setLayerVisibility(layer, visibilityToggle.checked);
      visibilityToggle.title = visibilityToggle.checked ? 'Hide layer' : 'Show layer';
    });

    const currentRadio = document.createElement('input');
    currentRadio.type = 'radio';
    currentRadio.name = 'currentLayer';
    currentRadio.checked = layerId === currentLayerId;
    currentRadio.title = 'Set as current layer';
    currentRadio.addEventListener('change', () => {
      if (currentRadio.checked) setCurrentLayer(layerId);
    });

    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'layer-name';
    nameButton.textContent = layer.name || `Layer ${layerId}`;
    nameButton.addEventListener('click', () => setCurrentLayer(layerId));

    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'layer-action-btn';
    moveUpBtn.textContent = 'Up';
    moveUpBtn.disabled = layerOrder.indexOf(layerId) === 0;
    moveUpBtn.addEventListener('click', () => moveLayerInOrder(layerId, 'up'));

    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'layer-action-btn';
    moveDownBtn.textContent = 'Down';
    moveDownBtn.disabled = layerOrder.indexOf(layerId) === layerOrder.length - 1;
    moveDownBtn.addEventListener('click', () => moveLayerInOrder(layerId, 'down'));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'layer-action-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (!confirm(`Delete layer "${layer.name}"?`)) return;
      removeLayer(layerId);
      applyLayerOrderToMap();
    });

    row.append(visibilityToggle, currentRadio, nameButton, moveUpBtn, moveDownBtn, deleteBtn);
    layerList.appendChild(row);
  });
}

// Floating legend functions
function hideFloatingLegend() {
  isLegendVisible = false;
  floatingLegend.style.display = 'none';
}

function clearLegendVisibility() {
  hiddenLegendItems.clear();
  selectedLegendItems.clear();
  customColors.clear();

  // Reset to default sorting state
  if (currentFieldType == 'categorical'){
    legendSortField = 'count';
    legendSortDirection = 'desc';
  } else {
    legendSortField = 'name';
    legendSortDirection = 'asc';
  }

  // Clear cached extrusion settings when legend visibility is cleared
  cachedExtrusionSettings = null;

  // Reapply the current visualization to show all items
  if (currentGeoJSON && currentField) {
    applyExtrusion();
  }
  updateMarkupLayer();
  persistCurrentLayerState();
}

function updateFloatingLegend() {
  if (!isLegendVisible || !currentGeoJSON) return;
  
  // Clear previous content
  legendContent.replaceChildren();
  
  // Update title to just "Legend"
  legendTitle.textContent = 'Legend';
  
  if (!currentField) {
    // Show "No field selected" message
    const noFieldInfo = document.createElement('div');
    noFieldInfo.style.cssText = `
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
      padding: 4px 0;
      border-bottom: 1px solid #eee;
    `;
    noFieldInfo.innerHTML = `
      <div style="font-weight: 600; color: #333;">No field selected</div>
      <div>All parcels shown in gray</div>
    `;
    legendContent.appendChild(noFieldInfo);
    return;
  }
  
  // Add field name and type at the top of the legend content
  const fieldInfo = document.createElement('div');
  fieldInfo.style.cssText = `
    font-size: 12px;
    color: #666;
    margin-bottom: 8px;
    padding: 4px 0;
    border-bottom: 1px solid #eee;
  `;
  fieldInfo.innerHTML = `
    <div style="font-weight: 600; color: #333;">${currentField}</div>
    <div>Type: ${currentFieldType}</div>
  `;
  legendContent.appendChild(fieldInfo);
  
  // Add zoom to selected button on its own row
  const zoomRow = document.createElement('div');
  zoomRow.style.cssText = `
    display: flex;
    justify-content: flex-end;
    padding: 4px;
    margin-bottom: 4px;
    border-bottom: 1px solid #eee;
  `;
  
  const zoomBtn = document.createElement('button');
  zoomBtn.textContent = 'Zoom to selected';
  zoomBtn.title = 'Zoom to bounding box of selected items';
  zoomBtn.style.cssText = `
    border: 1px solid #ccc;
    background: #f8f9fa;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
  `;
  
  zoomBtn.onclick = () => {
    if (selectedLegendItems.size === 0) {
      // Show a toast or alert that no items are selected
      return;
    }
    
    // Get the bounding box from the markup layer source
    const markupSource = map.getSource('markup-source') as maplibregl.GeoJSONSource;
    if (markupSource) {
      const data = markupSource.serialize();
      if (data.data && typeof data.data === 'object' && 'features' in data.data && Array.isArray(data.data.features) && data.data.features.length > 0) {
        const feature = data.data.features[0];
        if (feature.geometry.type === 'Polygon' && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length > 0) {
          const bbox = feature.geometry.coordinates[0];
          const bounds: [number, number, number, number] = [
            Math.min(...bbox.map((coord: number[]) => coord[0])),
            Math.min(...bbox.map((coord: number[]) => coord[1])),
            Math.max(...bbox.map((coord: number[]) => coord[0])),
            Math.max(...bbox.map((coord: number[]) => coord[1]))
          ];
          
          map.fitBounds(bounds, { padding: 50 });
        }
      }
    }
  };
  
  zoomRow.appendChild(zoomBtn);
  legendContent.appendChild(zoomRow);
  
  // Add header bar with column headers
  const headerBar = document.createElement('div');
  headerBar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
    margin-bottom: 4px;
    border-bottom: 1px solid #eee;
    font-size: 12px;
    font-weight: 600;
  `;
  
  // Eye toggle all button
  const eyeAllBtn = document.createElement('button');
  eyeAllBtn.textContent = '👁️';
  eyeAllBtn.title = 'Toggle all visibility';
  eyeAllBtn.style.cssText = `
    border: none;
    background: none;
    cursor: pointer;
    font-size: 14px;
    padding: 2px;
    flex-shrink: 0;
  `;
  
  eyeAllBtn.onclick = () => {
    if (currentFieldType === 'categorical') {
      // Toggle all categorical items
      const categories = new Set<string>();
      for (const feature of currentGeoJSON!.features) {
        const value = feature.properties?.[currentField!];
        if (value != null && value !== '' && value !== undefined) {
          categories.add(String(value));
        }
      }
      
      const allHidden = Array.from(categories).every(cat => hiddenLegendItems.has(cat));
      if (allHidden) {
        // Show all
        categories.forEach(cat => hiddenLegendItems.delete(cat));
      } else {
        // Hide all
        categories.forEach(cat => hiddenLegendItems.add(cat));
      }
    } else {
      // Toggle all numeric ranges
      const ranges = colorMode === 'quantiles' && colorBreaks && colorBreaks.length 
        ? colorBreaks.length + 1 
        : 10;
      
      const allHidden = Array.from({length: ranges}, (_, i) => `range_${i}`).every(rangeKey => hiddenLegendItems.has(rangeKey));
      if (allHidden) {
        // Show all
        for (let i = 0; i < ranges; i++) {
          hiddenLegendItems.delete(`range_${i}`);
        }
      } else {
        // Hide all
        for (let i = 0; i < ranges; i++) {
          hiddenLegendItems.add(`range_${i}`);
        }
      }
    }
    
    updateFloatingLegend();
    applyExtrusionWithVisibility();
  };
  
  // Checkbox toggle all
  const checkboxAll = document.createElement('input');
  checkboxAll.type = 'checkbox';
  checkboxAll.style.cssText = `
    margin: 0;
    flex-shrink: 0;
  `;
  
  // Set initial state based on current selections
  if (currentFieldType === 'categorical') {
    const categories = new Set<string>();
    for (const feature of currentGeoJSON!.features) {
      const value = feature.properties?.[currentField!];
      if (value != null && value !== '' && value !== undefined) {
        categories.add(String(value));
      }
    }
    checkboxAll.checked = categories.size > 0 && Array.from(categories).every(cat => selectedLegendItems.has(cat));
  } else {
    const ranges = colorMode === 'quantiles' && colorBreaks && colorBreaks.length 
      ? colorBreaks.length + 1 
      : 10;
    checkboxAll.checked = ranges > 0 && Array.from({length: ranges}, (_, i) => `range_${i}`).every(rangeKey => selectedLegendItems.has(rangeKey));
  }
  
  checkboxAll.onchange = () => {
    if (currentFieldType === 'categorical') {
      // Toggle all categorical items
      const categories = new Set<string>();
      for (const feature of currentGeoJSON!.features) {
        const value = feature.properties?.[currentField!];
        if (value != null && value !== '' && value !== undefined) {
          categories.add(String(value));
        }
      }
      
      if (checkboxAll.checked) {
        // Select all
        categories.forEach(cat => selectedLegendItems.add(cat));
      } else {
        // Deselect all
        categories.forEach(cat => selectedLegendItems.delete(cat));
      }
    } else {
      // Toggle all numeric ranges
      const ranges = colorMode === 'quantiles' && colorBreaks && colorBreaks.length 
        ? colorBreaks.length + 1 
        : 10;
      
      if (checkboxAll.checked) {
        // Select all
        for (let i = 0; i < ranges; i++) {
          selectedLegendItems.add(`range_${i}`);
        }
      } else {
        // Deselect all
        for (let i = 0; i < ranges; i++) {
          selectedLegendItems.delete(`range_${i}`);
        }
      }
    }
    
    updateMarkupLayer();
    updateFloatingLegend(); // Refresh to update checkbox states
  };
  
  // Add blank space for swatch column
  const swatchSpacer = document.createElement('div');
  swatchSpacer.style.cssText = `
    width: 20px;
    flex-shrink: 0;
  `;
  
            // Add column headers as buttons
          const nameHeader = document.createElement('button');
          nameHeader.textContent = 'Name';
          nameHeader.style.cssText = `
            font-size: 12px;
            font-weight: 600;
            flex-grow: 1;
            margin-left: 8px;
            border: 1px solid #ccc;
            background: #f8f9fa;
            cursor: pointer;
            text-align: left;
            padding: 4px 6px;
            border-radius: 4px;
            transition: all 0.2s ease;
            color: #333;
          `;
          
          const countHeader = document.createElement('button');
          countHeader.textContent = '#';
          countHeader.style.cssText = `
            font-size: 12px;
            font-weight: 600;
            width: 30px;
            text-align: center;
            flex-shrink: 0;
            border: 1px solid #ccc;
            background: #f8f9fa;
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 4px;
            transition: all 0.2s ease;
            color: #333;
          `;
  
            // Add sorting functionality
          nameHeader.onclick = () => {
            if (legendSortField === 'name') {
              legendSortDirection = legendSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
              legendSortField = 'name';
              legendSortDirection = 'asc';
            }
            updateFloatingLegend();
            persistCurrentLayerState();
          };

          countHeader.onclick = () => {
            if (legendSortField === 'count') {
              legendSortDirection = legendSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
              legendSortField = 'count';
              legendSortDirection = 'asc';
            }
            updateFloatingLegend();
            persistCurrentLayerState();
          };

          // Add hover effects
          nameHeader.onmouseenter = () => {
            nameHeader.style.background = '#e9ecef';
            nameHeader.style.borderColor = '#adb5bd';
            nameHeader.style.transform = 'translateY(-1px)';
          };

          nameHeader.onmouseleave = () => {
            nameHeader.style.background = '#f8f9fa';
            nameHeader.style.borderColor = '#ccc';
            nameHeader.style.transform = 'translateY(0)';
          };

          countHeader.onmouseenter = () => {
            countHeader.style.background = '#e9ecef';
            countHeader.style.borderColor = '#adb5bd';
            countHeader.style.transform = 'translateY(-1px)';
          };

          countHeader.onmouseleave = () => {
            countHeader.style.background = '#f8f9fa';
            countHeader.style.borderColor = '#ccc';
            countHeader.style.transform = 'translateY(0)';
          };
  
  // Update button text to show sort indicators
  const updateSortIndicators = () => {
    nameHeader.textContent = 'Name';
    countHeader.textContent = '#';
    
    if (legendSortField === 'name') {
      nameHeader.textContent += legendSortDirection === 'asc' ? ' ↑' : ' ↓';
    } else if (legendSortField === 'count') {
      countHeader.textContent += legendSortDirection === 'asc' ? ' ↑' : ' ↓';
    }
  };
  
  updateSortIndicators();
  
  headerBar.appendChild(eyeAllBtn);
  headerBar.appendChild(checkboxAll);
  headerBar.appendChild(swatchSpacer);
  headerBar.appendChild(nameHeader);
  headerBar.appendChild(countHeader);
  legendContent.appendChild(headerBar);
  
  // Store references to update sort indicators later
  (legendContent as any)._nameHeader = nameHeader;
  (legendContent as any)._countHeader = countHeader;
  (legendContent as any)._updateSortIndicators = updateSortIndicators;
  
  if (currentFieldType === 'categorical') {
    updateCategoricalFloatingLegend();
  } else {
    updateNumericFloatingLegend();
  }
}

function updateCategoricalFloatingLegend() {
  if (!currentField || !currentGeoJSON) return;
  
  // Pre-calculate counts for all categories in a single pass
  const categoryCounts = new Map<string, number>();
  for (const feature of currentGeoJSON.features) {
    const value = feature.properties?.[currentField];
    if (value != null && value !== '' && value !== undefined) {
      const category = String(value);
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
  }
  
  let sortedCategories = Array.from(categoryCounts.keys());
  
  // Apply sorting if specified
  if (legendSortField === 'name') {
    sortedCategories.sort((a, b) => {
      const comparison = a.localeCompare(b);
      return legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else if (legendSortField === 'count') {
    sortedCategories.sort((a, b) => {
      const countA = categoryCounts.get(a) || 0;
      const countB = categoryCounts.get(b) || 0;
      const comparison = countA - countB;
      return legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else {
    // Default alphabetical sort
    sortedCategories.sort();
  }

  const pairs = buildCategoricalColorPairs();
  const categoryToColor = new Map<string, string>();
  for (const pair of pairs) {
    const category : string = pair[0];
    const color : string = pair[1];
    categoryToColor.set(category, color);
  }

  let fallbackColor = '#888';
  if (categoricalColorMode === 'single') {
    fallbackColor = singleColorValue;
  }
  

  // Add search bar to legend
  const searchContainer = document.createElement('div');
  searchContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    padding: 4px;
  `;
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search categories...';
  searchInput.style.cssText = `
    flex: 1;
    padding: 4px 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 12px;
  `;
  
  searchContainer.appendChild(searchInput);
  legendContent.appendChild(searchContainer);
  
  // Create legend items
  sortedCategories.forEach(category => {
    const color = categoryToColor.get(category) || fallbackColor;
    const isHidden = hiddenLegendItems.has(category);
    const count = categoryCounts.get(category) || 0;
    
    const item = document.createElement('div');
    item.setAttribute('data-category', category);
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      border-radius: 4px;
      margin-bottom: 2px;
      ${isHidden ? 'opacity: 0.5;' : ''}
    `;
    
    // Color swatch
    const swatch = document.createElement('div');
    swatch.style.cssText = `
      width: 20px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid #ddd;
      background: ${color};
      flex-shrink: 0;
    `;
    
    // Category label
    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 12px;
      flex-grow: 1;
      word-break: break-word;
    `;
    label.textContent = category;
    
    // Count display
    const countDisplay = document.createElement('div');
    countDisplay.style.cssText = `
      font-size: 12px;
      width: 30px;
      text-align: center;
      flex-shrink: 0;
      color: #666;
    `;
    countDisplay.textContent = count.toString();
    
     // Eye toggle button
     const eyeBtn = document.createElement('button');
     eyeBtn.textContent = isHidden ? '👁️‍🗨️' : '👁️';
     eyeBtn.title = isHidden ? 'Show this category' : 'Hide this category';
     eyeBtn.style.cssText = `
       border: none;
       background: none;
       cursor: pointer;
       font-size: 14px;
       padding: 2px;
       flex-shrink: 0;
     `;
     
     eyeBtn.onclick = () => {
       if (hiddenLegendItems.has(category)) {
         hiddenLegendItems.delete(category);
       } else {
         hiddenLegendItems.add(category);
       }
       updateFloatingLegend();
       applyExtrusionWithVisibility();
     };
     
     // Selection checkbox
     const checkbox = document.createElement('input');
     checkbox.type = 'checkbox';
     checkbox.checked = selectedLegendItems.has(category);
     checkbox.style.cssText = `
       margin: 0;
       flex-shrink: 0;
     `;
     
     checkbox.onchange = () => {
       const sourceId = getCurrentSourceId();
       if (!sourceId) return;
       if (checkbox.checked) {
         selectedLegendItems.add(category);
         // Add all parcels in this category to selection
         if (currentGeoJSON) {
           for (const feature of currentGeoJSON.features) {
             const value = feature.properties?.[currentField!];
             if (value != null && value !== '' && value !== undefined) {
               const featureCategory = String(value);
               if (featureCategory === category && feature.id !== undefined) {
                 const parcelId = getParcelId(feature);
                 selectedParcels.add(parcelId);
                 map.setFeatureState(
                   { source: sourceId, id: feature.id },
                   { selected: true }
                 );
               }
             }
           }
         }
       } else {
         selectedLegendItems.delete(category);
         // Remove all parcels in this category from selection
         if (currentGeoJSON) {
           for (const feature of currentGeoJSON.features) {
             const value = feature.properties?.[currentField!];
             if (value != null && value !== '' && value !== undefined) {
               const featureCategory = String(value);
               if (featureCategory === category && feature.id !== undefined) {
                 const parcelId = getParcelId(feature);
                 selectedParcels.delete(parcelId);
                 map.setFeatureState(
                   { source: sourceId, id: feature.id },
                   { selected: false }
                 );
               }
             }
           }
         }
       }
       updateSelectionControls();
       updateFloatingLegend(); // Refresh to update header checkbox state
     };
     
     // Make swatch clickable for color picker
     swatch.style.cursor = 'pointer';
     swatch.onclick = () => openSwatchColorPicker(category, color, swatch);
     
     item.appendChild(eyeBtn);
     item.appendChild(checkbox);
     item.appendChild(swatch);
     item.appendChild(label);
     item.appendChild(countDisplay);
     legendContent.appendChild(item);
  });
  
  // Update sort indicators
  if ((legendContent as any)._updateSortIndicators) {
    (legendContent as any)._updateSortIndicators();
  }
  
  // Add search functionality
  const filterCategories = (searchText: string) => {
    const items = legendContent.querySelectorAll('[data-category]');
    items.forEach(item => {
      const category = item.getAttribute('data-category') || '';
      const matches = category.toLowerCase().includes(searchText.toLowerCase());
      (item as HTMLElement).style.display = matches ? 'flex' : 'none';
    });
  };
  
  searchInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    filterCategories(target.value);
  });
  
}

function updateNumericFloatingLegend() {
  if (!currentField || !currentGeoJSON || !currentStats) return;
  
  const ranges = buildNumericColorRanges();
  if (ranges.length === 0) return;
  
  // Convert ranges to the format expected by the legend
  const legendRanges: { min: number; max: number; color: string; label: string; rangeKey: string }[] = ranges.map(range => ({
    min: range.min,
    max: range.max,
    color: range.color,
    label: `${fmt(range.min)} - ${fmt(range.max)}`,
    rangeKey: range.rangeKey
  }));
  
  // Pre-calculate counts for all ranges in a single pass
  const rangeCounts = new Map<string, number>();
  for (const feature of currentGeoJSON!.features) {
    const value = feature.properties?.[currentField!];
    if (value != null && value !== '' && value !== undefined) {
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        // Find which range this value belongs to
        for (let i = 0; i < legendRanges.length; i++) {
          const range = legendRanges[i];
          if (numValue >= range.min && numValue <= range.max) {
            const rangeKey = range.rangeKey;
            rangeCounts.set(rangeKey, (rangeCounts.get(rangeKey) || 0) + 1);
            break;
          }
        }
      }
    }
  }
  
  // Create array of range data with counts for sorting
  const rangeData = legendRanges.map((range, index) => {
    const rangeKey = range.rangeKey;
    const count = rangeCounts.get(rangeKey) || 0;
    return { range, index, rangeKey, count };
  });
  
  // Apply sorting if specified
  if (legendSortField === 'name') {
    rangeData.sort((a, b) => {
      // For numeric fields, sort by the actual numeric values (min value of each range)
      const comparison = a.range.min - b.range.min;
      return legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else if (legendSortField === 'count') {
    rangeData.sort((a, b) => {
      const comparison = a.count - b.count;
      return legendSortDirection === 'asc' ? comparison : -comparison;
    });
  }
  
  // Add search bar to legend
  const searchContainer = document.createElement('div');
  searchContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    padding: 4px;
  `;
  
  const searchLabel = document.createElement('span');
  searchLabel.textContent = 'Find:';
  searchLabel.style.cssText = 'font-size: 12px;';
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search ranges...';
  searchInput.style.cssText = `
    flex: 1;
    padding: 4px 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 12px;
  `;
  
  const clearButton = document.createElement('button');
  clearButton.textContent = 'Clear';
  clearButton.style.cssText = `
    padding: 4px 8px;
    border: 1px solid #ddd;
    background: #f8f8f8;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  `;
  
  searchContainer.appendChild(searchLabel);
  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(clearButton);
  legendContent.appendChild(searchContainer);
  
  // Create legend items
  rangeData.forEach(({ range, index, rangeKey, count }) => {
    const isHidden = hiddenLegendItems.has(rangeKey);
    
    // Color is already applied from the inner function
    const color = range.color;
    
    const item = document.createElement('div');
    item.setAttribute('data-range', range.label);
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      border-radius: 4px;
      margin-bottom: 2px;
      ${isHidden ? 'opacity: 0.5;' : ''}
    `;
    
    // Color swatch
    const swatch = document.createElement('div');
    swatch.style.cssText = `
      width: 20px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid #ddd;
      background: ${color};
      flex-shrink: 0;
    `;
    
    // Range label
    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 12px;
      flex-grow: 1;
    `;
    label.textContent = range.label;
    
    // Count display
    const countDisplay = document.createElement('div');
    countDisplay.style.cssText = `
      font-size: 12px;
      width: 30px;
      text-align: center;
      flex-shrink: 0;
      color: #666;
    `;
    countDisplay.textContent = count.toString();
    
         // Eye toggle button
     const eyeBtn = document.createElement('button');
     eyeBtn.textContent = isHidden ? '👁️‍🗨️' : '👁️';
     eyeBtn.title = isHidden ? 'Show this range' : 'Hide this range';
     eyeBtn.style.cssText = `
       border: none;
       background: none;
       cursor: pointer;
       font-size: 14px;
       padding: 2px;
       flex-shrink: 0;
     `;
     
     eyeBtn.onclick = () => {
       if (hiddenLegendItems.has(rangeKey)) {
         hiddenLegendItems.delete(rangeKey);
       } else {
         hiddenLegendItems.add(rangeKey);
       }
       updateFloatingLegend();
       applyExtrusionWithVisibility();
     };
     
     // Selection checkbox
     const checkbox = document.createElement('input');
     checkbox.type = 'checkbox';
     checkbox.checked = selectedLegendItems.has(rangeKey);
     checkbox.style.cssText = `
       margin: 0;
       flex-shrink: 0;
     `;
     
     checkbox.onchange = () => {
       const sourceId = getCurrentSourceId();
       if (!sourceId) return;
       if (checkbox.checked) {
         selectedLegendItems.add(rangeKey);
         // Add all parcels in this range to selection
         if (currentGeoJSON) {
           for (const feature of currentGeoJSON.features) {
             const value = Number(feature.properties?.[currentField!]);
             if (Number.isFinite(value)) {
               if (value >= range.min && value <= range.max && feature.id !== undefined) {
                 const parcelId = getParcelId(feature);
                 selectedParcels.add(parcelId);
                 map.setFeatureState(
                   { source: sourceId, id: feature.id },
                   { selected: true }
                 );
               }
             }
           }
         }
       } else {
         selectedLegendItems.delete(rangeKey);
         // Remove all parcels in this range from selection
         if (currentGeoJSON) {
           for (const feature of currentGeoJSON.features) {
             const value = Number(feature.properties?.[currentField!]);
             if (Number.isFinite(value)) {
               if (value >= range.min && value <= range.max && feature.id !== undefined) {
                 const parcelId = getParcelId(feature);
                 selectedParcels.delete(parcelId);
                 map.setFeatureState(
                   { source: sourceId, id: feature.id },
                   { selected: false }
                 );
               }
             }
           }
         }
       }
       updateSelectionControls();
       updateFloatingLegend(); // Refresh to update header checkbox state
     };
     
     // Make swatch clickable for color picker
     swatch.style.cursor = 'pointer';
     swatch.onclick = () => openSwatchColorPicker(rangeKey, color, swatch);
     
     item.appendChild(eyeBtn);
     item.appendChild(checkbox);
     item.appendChild(swatch);
     item.appendChild(label);
     item.appendChild(countDisplay);
     legendContent.appendChild(item);
  });
  
  // Update sort indicators
  if ((legendContent as any)._updateSortIndicators) {
    (legendContent as any)._updateSortIndicators();
  }
  
  // Add search functionality
  const filterRanges = (searchText: string) => {
    const items = legendContent.querySelectorAll('[data-range]');
    items.forEach(item => {
      const rangeLabel = item.getAttribute('data-range') || '';
      const matches = rangeLabel.toLowerCase().includes(searchText.toLowerCase());
      (item as HTMLElement).style.display = matches ? 'flex' : 'none';
    });
  };
  
  searchInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    filterRanges(target.value);
  });
  
  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    filterRanges('');
  });
}

// Custom color overrides for individual legend items
let customColors = new Map<string, string>();

function openSwatchColorPicker(itemKey: string, currentColor: string, swatchElement: HTMLElement) {
  // Create a temporary color input
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = currentColor;
  colorInput.style.cssText = `
    position: fixed;
    z-index: 10000;
    opacity: 0;
    pointer-events: none;
  `;
  
  // Position the color picker over the swatch using fixed positioning
  const rect = swatchElement.getBoundingClientRect();
  colorInput.style.left = `${rect.left}px`;
  colorInput.style.top = `${rect.top}px`;
  colorInput.style.width = `${rect.width}px`;
  colorInput.style.height = `${rect.height}px`;
  
  document.body.appendChild(colorInput);
  
  colorInput.addEventListener('change', () => {
    const newColor = colorInput.value;
    customColors.set(itemKey, newColor);
    
    // Update the visualization
    applyExtrusionWithCustomColors();
    updateFloatingLegend();
    
    document.body.removeChild(colorInput);
  });
  
  colorInput.addEventListener('blur', () => {
    // If user cancels, remove the input
    if (document.body.contains(colorInput)) {
      document.body.removeChild(colorInput);
    }
  });
  
  // Trigger the color picker
  colorInput.click();
}

function applyExtrusionWithCustomColors() {
  if (!currentGeoJSON || !currentField) return;
  const ids = getCurrentLayerIds();
  if (!ids) return;
  
  // If we have custom colors, we need to rebuild the color expression
  if (customColors.size > 0) {
    let colorExpr: any;
    
    if (currentFieldType === 'categorical') {
      colorExpr = buildCategoricalColorExpression();
    } else {
      colorExpr = buildNumericColorExpression();
    }
    
    map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
    
    // Apply height and opacity for numeric fields
    if (currentFieldType === 'numeric') {
      const rawMult = Number(multInput.value);
      const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
      const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
      const valueExpr = buildValueExpression();
      const heightExpr: any = is3DMode ? ['*', valueExpr, multiplier * unitFactor] : 0;
      
      map.setPaintProperty(ids.layerId, 'fill-extrusion-height', heightExpr);
    } else {
      map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
    }
    
    map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  } else {
    // No custom colors, use normal extrusion
    applyExtrusion();
  }
}





function applyVisibilityFilters() {
  const ids = getCurrentLayerIds();
  if (!ids) return;
  // Apply visibility filters if any items are hidden
  if (hiddenLegendItems.size > 0) {
    let filter: any[] = ['all'];
    
    if (currentFieldType === 'categorical') {
      // Hide specific categories
      const hiddenCategories = Array.from(hiddenLegendItems);
      if (hiddenCategories.length > 0) {
        filter.push(['!', ['in', ['get', currentField], ['literal', hiddenCategories]]]);
      }
    } else {
      // For numeric fields, hide specific ranges
      if (!currentStats) return;
      
      const ranges: { min: number; max: number }[] = [];
      if (colorMode === 'quantiles' && colorBreaks && colorBreaks.length) {
        const breaks = [currentStats.min, ...colorBreaks, currentStats.max];
        for (let i = 0; i < breaks.length - 1; i++) {
          ranges.push({ min: breaks[i], max: breaks[i + 1] });
        }
      } else {
        const min = currentStats.min;
        const max = currentStats.max;
        const step = (max - min) / 10;
        for (let i = 0; i < 10; i++) {
          ranges.push({
            min: min + (step * i),
            max: i === 9 ? max : min + (step * (i + 1))
          });
        }
      }
      
      // Create conditions to hide ranges
      hiddenLegendItems.forEach(rangeKey => {
        const index = parseInt(rangeKey.split('_')[1]);
        if (ranges[index]) {
          const range = ranges[index];
          filter.push(['!', ['all',
            ['>=', ['get', currentField], range.min],
            ['<=', ['get', currentField], range.max]
          ]]);
        }
      });
    }
    
    // Apply the filter to the layer
    if (filter.length > 1) {
      map.setFilter(ids.layerId, filter as any);
    }
  } else {
    // Clear any filters
    map.setFilter(ids.layerId, null);
  }
}

function applyExtrusionWithVisibility() {
  if (!currentGeoJSON || !currentField) return;
  
  // Use custom colors if available, otherwise normal extrusion
  if (customColors.size > 0) {
    applyExtrusionWithCustomColors();
  } else {
    applyExtrusion();
  }
  applyVisibilityFilters();
  updateMarkupLayer();
}


// Minimal bounding polygon (convex hull) for Polygon/MultiPolygon features.
// Uses Andrew's monotone chain (O(n log n) for sort, linear after).
function minimalBoundingPolygon(
  features: ReadonlyArray<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>
): GeoJSON.Feature<GeoJSON.Polygon> {
  type LngLat = [number, number];

  // 1) Collect all [lng, lat] vertices from the input features
  const pts: LngLat[] = [];
  for (const f of features) {
    if (!f?.geometry) continue;
    if (f.geometry.type === 'Polygon') {
      for (const ring of f.geometry.coordinates) {
        for (const c of ring) pts.push([c[0], c[1]]);
      }
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates) {
        for (const ring of poly) {
          for (const c of ring) pts.push([c[0], c[1]]);
        }
      }
    }
  }

  // No points → empty polygon
  if (pts.length === 0) {
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[]] },
      properties: { empty: true }
    };
  }

  // 2) Sort by lng, then lat and de-dup
  pts.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const unique: LngLat[] = [];
  for (const p of pts) {
    const last = unique[unique.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) unique.push(p);
  }

  // If fewer than 3 unique points, fall back to axis-aligned bbox polygon
  if (unique.length < 3) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of unique) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
    // If still degenerate (e.g., a single point), this yields a zero-area ring
    const ring: LngLat[] = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat]
    ];
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { algorithm: 'bbox_fallback' }
    };
  }

  // 3) Monotone chain hull
  const cross = (o: LngLat, a: LngLat, b: LngLat) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: LngLat[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: LngLat[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // 4) Combine and close ring
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const ring = hull.concat([hull[0]]);

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { algorithm: 'monotone_chain' }
  };
}



function updateMarkupLayer() {
  // DISABLED: Old bounding polygon system
  // The new parcel selection system uses feature state highlighting instead
  return;
  
  /* Original code commented out:
  if (!currentGeoJSON) return;
  
  // Remove existing markup layers if they exist
  if (map.getLayer('markup-layer')) {
    map.removeLayer('markup-layer');
  }
  if (map.getLayer('markup-layer-outline')) {
    map.removeLayer('markup-layer-outline');
  }
  if (map.getSource('markup-source')) {
    map.removeSource('markup-source');
  }
  
  // If no items are selected, don't show anything
  if (selectedLegendItems.size === 0) return;
  
  // Collect all features that are selected
  const selectedFeatures: GeoJSON.Feature[] = [];
  
  if (currentFieldType === 'categorical') {
    // For categorical fields, collect features with selected categories
    for (const feature of currentGeoJSON.features) {
      const value = feature.properties?.[currentField!];
      if (value != null && value !== '' && value !== undefined) {
        const category = String(value);
        if (selectedLegendItems.has(category)) {
          selectedFeatures.push(feature);
        }
      }
    }
  } else {
    // For numeric fields, collect features in selected ranges
    if (!currentStats) return;
    
    const ranges: { min: number; max: number }[] = [];
    if (colorMode === 'quantiles' && colorBreaks && colorBreaks.length) {
      const breaks = [currentStats.min, ...colorBreaks, currentStats.max];
      for (let i = 0; i < breaks.length - 1; i++) {
        ranges.push({ min: breaks[i], max: breaks[i + 1] });
      }
    } else {
      const min = currentStats.min;
      const max = currentStats.max;
      const step = (max - min) / 10;
      for (let i = 0; i < 10; i++) {
        ranges.push({
          min: min + (step * i),
          max: i === 9 ? max : min + (step * (i + 1))
        });
      }
    }
    
    // Check each feature against selected ranges
    for (const feature of currentGeoJSON.features) {
      const value = Number(feature.properties?.[currentField!]);
      if (Number.isFinite(value)) {
        for (let i = 0; i < ranges.length; i++) {
          const rangeKey = `range_${i}`;
          if (selectedLegendItems.has(rangeKey)) {
            const range = ranges[i];
            if (value >= range.min && value <= range.max) {
              selectedFeatures.push(feature);
              break; // Only add once per feature
            }
          }
        }
      }
    }
  }
  
  // If no features are selected, don't show bounding box
  if (selectedFeatures.length === 0) {
    return;
  } 
  
  // Filter features to only include Polygon and MultiPolygon geometries
  const polygonFeatures = selectedFeatures.filter(feature => 
    feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'
  ) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[];
  
  // If no polygon features, don't show bounding box
  if (polygonFeatures.length === 0) {
    return;
  }
  
  const boundingBox: GeoJSON.Feature = minimalBoundingPolygon(polygonFeatures);
  
  // Add markup source and layer
  map.addSource('markup-source', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [boundingBox]
    }
  });
  
  // Add black outline layer first (so it appears behind the yellow line)
  map.addLayer({
    id: 'markup-layer-outline',
    type: 'line',
    source: 'markup-source',
    paint: {
      'line-color': '#000000', // Black outline
      'line-width': 5, // Slightly wider than the yellow line
      'line-opacity': 1.0
    }
  });
  
  // Add yellow line layer on top
  map.addLayer({
    id: 'markup-layer',
    type: 'line',
    source: 'markup-source',
    paint: {
      'line-color': '#FFED00', // Yellow color
      'line-width': 3,
      'line-opacity': 1.0
    }
  });
  */
}

// New parcel selection system functions
function getParcelId(feature: any): string {
  // Use the feature's unique ID, which is guaranteed to be unique
  return feature.id.toString();
}

function toggleParcelSelection(feature: any) {
  const sourceId = getCurrentSourceId();
  if (!sourceId) return;
  const parcelId = getParcelId(feature);
  if (selectedParcels.has(parcelId)) {
    selectedParcels.delete(parcelId);
    map.setFeatureState(
      { source: sourceId, id: feature.id },
      { selected: false }
    );
  } else {
    selectedParcels.add(parcelId);
    map.setFeatureState(
      { source: sourceId, id: feature.id },
      { selected: true }
    );
  }
  updateSelectionControls();
}

function addParcelToSelection(feature: any) {
  const sourceId = getCurrentSourceId();
  if (!sourceId) return;
  const parcelId = getParcelId(feature);
  selectedParcels.add(parcelId);
  map.setFeatureState(
    { source: sourceId, id: feature.id },
    { selected: true }
  );
  updateSelectionControls();
}

function removeParcelFromSelection(feature: any) {
  const sourceId = getCurrentSourceId();
  if (!sourceId) return;
  const parcelId = getParcelId(feature);
  selectedParcels.delete(parcelId);
  map.setFeatureState(
    { source: sourceId, id: feature.id },
    { selected: false }
  );
  updateSelectionControls();
}

function clearAllSelections() {
  const sourceId = getCurrentSourceId();
  if (!sourceId) return;
  // Clear all feature states
  if (currentGeoJSON) {
    for (const feature of currentGeoJSON.features) {
      if (feature.id !== undefined) {
        map.setFeatureState(
          { source: sourceId, id: feature.id },
          { selected: false }
        );
      }
    }
  }
  selectedParcels.clear();
  updateSelectionControls();
}

function updateSelectionControls() {
  if (selectedParcels.size === 0) {
    // Hide selection controls panel
    if (selectionControlsPanel) {
      selectionControlsPanel.style.display = 'none';
    }
  } else {
    // Show selection controls panel
    if (!selectionControlsPanel) {
      createSelectionControlsPanel();
    }
    if (selectionControlsPanel) {
      selectionControlsPanel.style.display = 'block';
      // Update the count
      const countElement = selectionControlsPanel.querySelector('#selectedCount');
      if (countElement) {
        countElement.textContent = selectedParcels.size.toString();
      }
    }
  }
}

function createSelectionControlsPanel() {
  // Remove existing panel if it exists
  if (selectionControlsPanel) {
    selectionControlsPanel.remove();
  }

  // Create new panel
  selectionControlsPanel = document.createElement('div');
  selectionControlsPanel.id = 'selectionControlsPanel';
  
  // Check if legend is visible and adjust positioning
  const legendVisible = floatingLegend && floatingLegend.style.display !== 'none';
  const legendWidth = legendVisible ? 280 : 0; // Legend max-width is 280px
  const legendRight = 20; // Legend right margin
  const panelRight = legendVisible ? (legendWidth + legendRight + 10) : 20; // Add 10px gap
  
  selectionControlsPanel.style.cssText = `
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
    cursor: move;
  `;

  selectionControlsPanel.innerHTML = `
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
    </div>
    <div style="padding: 12px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="font-size: 12px;">Selected:</span>
        <span id="selectedCount" style="font-weight: 600;">${selectedParcels.size}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span style="font-size: 12px;">Highlight color:</span>
        <input type="color" id="highlightColorPicker" value="${highlightColor}" style="width: 30px; height: 20px; border: 1px solid #ddd; border-radius: 3px; cursor: pointer;">
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
    </div>
  `;

  // Add event listeners
  const unselectAllBtn = selectionControlsPanel.querySelector('#unselectAllBtn') as HTMLButtonElement;
  const colorPicker = selectionControlsPanel.querySelector('#highlightColorPicker') as HTMLInputElement;

  unselectAllBtn.addEventListener('click', clearAllSelections);
  
  colorPicker.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    highlightColor = target.value;
    updateHighlightColors();
    persistCurrentLayerState();
  });

  // Add to document
  document.body.appendChild(selectionControlsPanel);
  
  // Make the panel draggable
  makeDraggable(selectionControlsPanel);
  
  // Update legend position to be below the panel
  updateLegendPosition();
}

function updateHighlightColors() {
  // Update the fill color expression to include highlighting
  const ids = getCurrentLayerIds();
  if (!ids) return;
  if (currentFieldType === 'categorical') {
    // For categorical fields, rebuild the color expression with highlighting
    const colorExpr = buildCategoricalColorExpression();
    map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
  } else {
    applyExtrusion();
  }
}

function updateSelectionControlsPosition() {
  if (!selectionControlsPanel) return;
  
  const legendVisible = floatingLegend && floatingLegend.style.display !== 'none';
  const legendWidth = legendVisible ? 280 : 0;
  const legendRight = 20;
  const panelRight = legendVisible ? (legendWidth + legendRight + 10) : 20;
  
  selectionControlsPanel.style.right = `${panelRight}px`;
}

function updateLegendPosition() {
  if (!floatingLegend || !selectionControlsPanel) return;
  
  // Position legend below the selection controls panel
  const panelRect = selectionControlsPanel.getBoundingClientRect();
  const panelBottom = panelRect.bottom;
  const legendTop = panelBottom + 10; // 10px gap
  
  floatingLegend.style.top = `${legendTop}px`;
}

function installWelcome() {
  // hide controls initially
  if (controlsEl) controlsEl.style.display = 'none';

  welcomeEl = document.createElement('div');
  welcomeEl.id = 'welcomeOverlay';
  welcomeEl.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(180deg,#f9fafb,transparent 55%);z-index:20;';
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.12);padding:18px 20px;max-width:560px;width:min(92vw,560px);display:grid;gap:12px;text-align:center;';
  card.innerHTML = `
    <div style="font-size:16px;font-weight:600;">Load a GeoParquet file</div>
    <div style="color:#666;font-size:13px;">Choose a <code>.parquet</code> to visualize.</div>
    <div style="color:#666;font-size:13px;">TIP: make sure it has polygon geometry; lines/points won't work.</div>
  `;
  const row = document.createElement('div');
  row.style.cssText='display:flex;gap:10px;justify-content:center;flex-wrap:wrap';

  const btnBrowse = document.createElement('button');
  btnBrowse.textContent='Browse GeoParquet…';
  btnBrowse.style.cssText='border:1px solid #ddd;background:#f8f8f8;padding:8px 12px;border-radius:10px;cursor:pointer;';
  btnBrowse.onclick = () => fileInput.click();

  row.append(btnBrowse);
  card.append(row);
  welcomeEl.append(card);
  document.body.append(welcomeEl);
}

function revealUI() {
  if (welcomeEl) { welcomeEl.remove(); welcomeEl = null; }
  if (controlsEl) controlsEl.style.display = 'grid';
}

function ensureRenderToast() {
  if (renderToastEl) return;
  renderToastEl = document.createElement('div');
  renderToastEl.style.cssText = `
    position:absolute; top:12px; left:50%; transform:translateX(-50%);
    background:#111; color:#fff; padding:6px 10px; border-radius:999px;
    font-size:12px; opacity:0; transition:opacity .2s; z-index:25; pointer-events:none;
  `;
  renderToastEl.textContent = 'Geometry is rendering...';
  document.body.append(renderToastEl);
}

function showRenderingToast(msg = 'Geometry is rendering') {
  ensureRenderToast();
  let i = 0;
  if (dotsTimer) { clearInterval(dotsTimer); dotsTimer = null; }
  renderToastEl!.style.opacity = '0.92';
  renderToastEl!.textContent = `${msg}`;
  dotsTimer = window.setInterval(() => {
    i = (i + 1) % 4;
    renderToastEl!.textContent = `${msg}${'.'.repeat(i)}`;
  }, 400);
}

function hideRenderingToast() {
  if (dotsTimer) { clearInterval(dotsTimer); dotsTimer = null; }
  if (renderToastEl) renderToastEl.style.opacity = '0';
}

function awaitFirstRenderedFeature(layerId: string) {
  // poll one frame at a time; hide toast when the first extrusion is visible
  let tries = 0;
  const maxTries = 600; // ~10s at 60fps
  const tick = () => {
    tries++;
    if (!map.getLayer(layerId)) { if (tries < maxTries) return requestAnimationFrame(tick); else return hideRenderingToast(); }
    const feats = map.queryRenderedFeatures({ layers: [layerId] });
    if (feats && feats.length > 0) {
      hideRenderingToast();
    } else if (tries < maxTries) {
      requestAnimationFrame(tick);
    } else {
      hideRenderingToast();
    }
  };
  requestAnimationFrame(tick);
}



// Heuristics for "key fields"
function isKeyField(name: string) {
  const tokens = tokenizeName(name);

  // EXCLUDE length/perimeter from "key" suggestions
  if (tokens.some(t => t === 'length' || t === 'perimeter' || t === 'perim')) return false;

  // "value" or "valuation" → key
  const valueHits = tokens.includes('value') || tokens.includes('valuation');

  // Size-ish → key: 'area' or any unit token (incl. 'acreage', 'ha', etc.)
  const sizeHits = tokens.some(t => t === 'area' || UNIT_TOKENS.has(t));

  return valueHits || sizeHits;
}

function tokenizeName(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function containsUnit(name: string): boolean {
  const tokens = tokenizeName(name);
  return tokens.some(t => UNIT_TOKENS.has(t));
}

function containsKeyword(name: string, kind: 'building'|'land'): boolean {
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
function scoreSizeField(name: string, kind: 'building'|'land'): number {
  const tokens = tokenizeName(name);

  // broaden land keywords to include 'acre' / 'acreage'
  const kwIdx = tokens.findIndex(t =>
    kind === 'building'
      ? /^(bldg|build|building|impr|improv)/.test(t)
      : /^(land|acre|acreage)/.test(t)    // ← was just /^land/
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

function autoPickOne(kind: 'building'|'land', fields: string[]): { field?: string, unitKey?: string } {
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

function autoPickMainField(fields: string[]): string {
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

/* ---------------- Modal 1: Numeric field chooser ---------------- */

function openNumericFieldChooserModal(opts: { 
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
  btnCancelNumericModal.onclick = () => { numericModalOverlay.classList.remove('show'); clearData(); };
  btnConfirmNumericModal.onclick = () => {
    const allCheckboxes = numericFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    chosenNumericFields = [];
    
    allCheckboxes.forEach(c => {
      if (c.checked) {
        chosenNumericFields.push(c.name);
      }
    });
    
    numericModalOverlay.classList.remove('show');
    
    // If there are categorical fields available, show that modal next
    if (lastCategoricalFieldsFromSchema.length > 0) {
      openCategoricalFieldChooserModal({ 
        rowCount: Number(rowCountEl.textContent?.replace(/,/g, '') || '0'), 
        geometryCol: geomColEl.textContent || 'geometry', 
        categoricalFields: lastCategoricalFieldsFromSchema
      });
    } else {
      // No categorical fields, proceed to size modal
      if (chosenNumericFields.length === 0) {
        alert('Please select at least one numeric field.');
        numericModalOverlay.classList.add('show');
        return;
      }
      openSizeModal();
    }
  };

  numericModalOverlay.classList.add('show');
}

/* ---------------- Modal 2: Categorical field chooser ---------------- */

function openCategoricalFieldChooserModal(opts: { 
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
  btnCancelCategoricalModal.onclick = () => { categoricalModalOverlay.classList.remove('show'); clearData(); };
  btnConfirmCategoricalModal.onclick = () => {
    const allCheckboxes = categoricalFieldListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    chosenCategoricalFields = [];
    
    allCheckboxes.forEach(c => {
      if (c.checked) {
        chosenCategoricalFields.push(c.name);
      }
    });
    
    // Check if at least one field is selected (either numeric or categorical)
    if (chosenNumericFields.length === 0 && chosenCategoricalFields.length === 0) {
      alert('Please select at least one field (numeric or categorical).');
      categoricalModalOverlay.classList.add('show');
      return;
    }
    
    categoricalModalOverlay.classList.remove('show');
    openSizeModal();
  };
  
  // Add a "Back" button to return to numeric modal
  const backButton = document.createElement('button');
  backButton.textContent = 'Back to Numeric Fields';
  backButton.onclick = () => {
    categoricalModalOverlay.classList.remove('show');
    openNumericFieldChooserModal({ 
      rowCount: Number(categoricalRowCountEl.textContent?.replace(/,/g, '') || '0'), 
      geometryCol: categoricalGeomColEl.textContent || 'geometry', 
      numericFields: lastNumericFieldsFromSchema
    });
  };
  
  // Insert back button before the footer
  const footer = categoricalModalOverlay.querySelector('.footer');
  if (footer) {
    footer.insertBefore(backButton, footer.firstChild);
  }

  categoricalModalOverlay.classList.add('show');
}

/* ---------------- Modal 2: size identification ---------------- */

function fillUnitSelect(sel: HTMLSelectElement, preselectKey?: string) {
  sel.replaceChildren(new Option('— select unit —', ''));
  for (const u of AREA_UNIT_CHOICES) sel.appendChild(new Option(u.label, u.key));
  if (preselectKey) sel.value = preselectKey;
}
function fillFieldSelect(sel: HTMLSelectElement, fields: string[]) {
  sel.replaceChildren(new Option('— no selection —', ''));
  for (const f of fields) sel.appendChild(new Option(f, f));
}
function guessAreaUnitFromFieldName(name: string | null): string | null {
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
function openSizeModal() {
  // options: only among the fields the user kept
  fillFieldSelect(bldgFieldSel, chosenNumericFields);
  fillFieldSelect(landFieldSel, chosenNumericFields);
  fillUnitSelect(bldgUnitSel);
  fillUnitSelect(landUnitSel);
  
  // --- AUTO-PICK using heuristic ---
  const bGuess = autoPickOne('building', chosenNumericFields);
  const lGuess = autoPickOne('land', chosenNumericFields);

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

  bldgFieldSel.onchange = () => {
    const g = guessAreaUnitFromFieldName(bldgFieldSel.value);
    if (g) bldgUnitSel.value = g;
  };
  landFieldSel.onchange = () => {
    const g = guessAreaUnitFromFieldName(landFieldSel.value);
    if (g) landUnitSel.value = g;
  };

  btnSizeBack.onclick = () => { 
    sizeOverlay.classList.remove('show'); 
    // Go back to the appropriate modal based on what was shown
    if (lastCategoricalFieldsFromSchema.length > 0) {
      openCategoricalFieldChooserModal({ 
        rowCount: Number(categoricalRowCountEl.textContent?.replace(/,/g, '') || '0'), 
        geometryCol: categoricalGeomColEl.textContent || 'geometry', 
        categoricalFields: lastCategoricalFieldsFromSchema
      });
    } else {
      openNumericFieldChooserModal({ 
        rowCount: Number(rowCountEl.textContent?.replace(/,/g, '') || '0'), 
        geometryCol: geomColEl.textContent || 'geometry', 
        numericFields: lastNumericFieldsFromSchema
      });
    }
  };
  btnSizeSkip.onclick = () => { setSizeState(null, null, null, null); sizeOverlay.classList.remove('show'); loadSelectedColumns(); };
  btnSizeOk.onclick = () => {
    setSizeState(
      bldgFieldSel.value || null,
      valueToUnitLabel(bldgUnitSel.value || ''),
      landFieldSel.value || null,
      valueToUnitLabel(landUnitSel.value || '')
    );
    sizeOverlay.classList.remove('show');
    loadSelectedColumns();
  };

  sizeOverlay.classList.add('show');
}
function valueToUnitLabel(key: string): string | null {
  const item = AREA_UNIT_CHOICES.find(u => u.key === key);
  return item ? item.label : null;
}
function setSizeState(bField: string | null, bUnit: string | null, lField: string | null, lUnit: string | null) {
  bldgSizeField = bField || null;
  bldgSizeUnitLabel = bUnit || null;
  landSizeField = lField || null;
  landSizeUnitLabel = lUnit || null;
  const activeLayer = getCurrentLayer();
  if (activeLayer) {
    activeLayer.bldgSizeField = bldgSizeField;
    activeLayer.bldgSizeUnitLabel = bldgSizeUnitLabel;
    activeLayer.landSizeField = landSizeField;
    activeLayer.landSizeUnitLabel = landSizeUnitLabel;
  }
  const activeStore = activeLayer ? dataStores.get(activeLayer.dataStoreId) : null;
  if (activeStore) {
    activeStore.bldgSizeField = bldgSizeField;
    activeStore.bldgSizeUnitLabel = bldgSizeUnitLabel;
    activeStore.landSizeField = landSizeField;
    activeStore.landSizeUnitLabel = landSizeUnitLabel;
  }
  // enable/disable normalization radios
  normLand.disabled = !landSizeField;
  normBldg.disabled = !bldgSizeField;
  normLandUnitEl.textContent = landSizeField ? (landSizeUnitLabel ?? '(unit)') : '(unit)';
  normBldgUnitEl.textContent = bldgSizeField ? (bldgSizeUnitLabel ?? '(unit)') : '(unit)';
}

/* ---------------- Loading overlay helpers ---------------- */
function showLoading(msg = 'Parsing GeoParquet…', determinate = false) {
  cancelRequested = false;
  progressMsg.textContent = msg;
  progressEl.classList.toggle('indeterminate', !determinate);
  progressBar.style.width = determinate ? '0%' : '30%';
  loadingOverlay.classList.add('show');
}
function hideLoading() { loadingOverlay.classList.remove('show'); }
(document.getElementById('btnCancelLoading') as HTMLButtonElement).onclick = () => {
  cancelRequested = true;
  hideLoading();
  clearData();
};

/* ---------------- Load selected columns (+ geometry) ---------------- */
async function loadSelectedColumns() {
  if (!lastAsyncBuffer || !lastFile) return;
  showLoading('Reading geometry + selected fields…');

  try {
    const result: any = await toGeoJson({ file: lastAsyncBuffer, compressors });
    if (cancelRequested) return;

    const fc: GeoJSON.FeatureCollection | undefined =
      result?.type === 'FeatureCollection' ? result : result?.geojson;
    if (!fc?.features) throw new Error('Parser returned no FeatureCollection.');

    let features = fc.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
    if (features.length === 0) throw new Error('No Polygon/MultiPolygon features found.');

    sanitizeFeaturesInPlace(features);

    const keep = new Set<string>([
      'id','ID','fid','FID','name','NAME', 
      ...chosenNumericFields, 
      ...chosenCategoricalFields,
      bldgSizeField || '', 
      landSizeField || ''
    ]);
    trimPropertiesInPlace(features, keep);

    for (const f of features) roundGeometryInPlace(f);

    // Ensure all features have IDs for the selection system
    features.forEach((feature, index) => {
      if (feature.id === undefined) {
        feature.id = index;
      }
    });

    if (cancelRequested) return;
    currentGeoJSON = { type: 'FeatureCollection', features };
    const activeLayer = getCurrentLayer();
    if (activeLayer) {
      activeLayer.geojson = currentGeoJSON;
      activeLayer.chosenNumericFields = [...chosenNumericFields];
      activeLayer.chosenCategoricalFields = [...chosenCategoricalFields];
      activeLayer.landSizeField = landSizeField;
      activeLayer.landSizeUnitLabel = landSizeUnitLabel;
      activeLayer.bldgSizeField = bldgSizeField;
      activeLayer.bldgSizeUnitLabel = bldgSizeUnitLabel;
    }
    const activeStore = activeLayer ? dataStores.get(activeLayer.dataStoreId) : null;
    if (activeStore) {
      activeStore.geojson = currentGeoJSON;
      activeStore.chosenNumericFields = [...chosenNumericFields];
      activeStore.chosenCategoricalFields = [...chosenCategoricalFields];
      activeStore.landSizeField = landSizeField;
      activeStore.landSizeUnitLabel = landSizeUnitLabel;
      activeStore.bldgSizeField = bldgSizeField;
      activeStore.bldgSizeUnitLabel = bldgSizeUnitLabel;
    }

    // Check which fields actually exist in the data
    const availableNumeric = chosenNumericFields.filter(k => {
      return features.some(f => f?.properties?.hasOwnProperty(k));
    });
    
    const availableCategorical = chosenCategoricalFields.filter(k => {
      return features.some(f => f?.properties?.hasOwnProperty(k));
    });

    // Combine all available fields for the dropdown
    const allAvailableFields = [...availableNumeric, ...availableCategorical];
    populateFieldDropdownFromList(allAvailableFields);

    // Don't auto-select a field - let user choose
    currentField = null;
    currentFieldType = null;
    
    // Set field select to "-- choose --" (empty value)
    fieldSelect.value = '';

    addOrUpdateSource(currentGeoJSON);

    // Apply gray rendering when no field is selected
    applyGrayRendering();

    fitToData(currentGeoJSON);
    persistCurrentLayerState();
  } catch (err: any) {
    console.error('GeoParquet load failed:', err);
    if (!cancelRequested) alert(`GeoParquet load failed: ${err?.message ?? err}`);
  } finally {
    hideLoading();
  }
}

/* ---------------- Map helpers ---------------- */
function ensureErrorLayer(layer: LayerState) {
  if (map.getLayer(layer.errorLayerId)) return;
  map.addLayer({
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
  try { map.moveLayer(layer.errorLayerId); } catch {}
  setLayerVisibility(layer, layer.visible);
}

function updateErrorLayer() {
  const layer = getCurrentLayer();
  if (!layer || !map.getSource(layer.sourceId)) return;
  ensureErrorLayer(layer);

  let filter: any = ['==', ['literal', 1], 2]; // matches nothing by default

  if (normalizationMode === 'perLand' && landSizeField) {
    // land invalid when ≤ 0  (zero not allowed)
    filter = ['<=', ['to-number', ['get', landSizeField]], 0];
  } else if (normalizationMode === 'perBuilding' && bldgSizeField) {
    // building invalid when negative (zero is allowed and not flagged)
    filter = ['<', ['to-number', ['get', bldgSizeField]], 0];
  }

  map.setFilter(layer.errorLayerId, filter);
}
function clearData() {
  if (currentLayerId) {
    removeLayer(currentLayerId);
  }
  if (map.getLayer('markup-layer')) map.removeLayer('markup-layer');
  if (map.getLayer('markup-layer-outline')) map.removeLayer('markup-layer-outline');
  if (map.getSource('markup-source')) map.removeSource('markup-source');
  hideRenderingToast();
}
function addOrUpdateSource(fc: GeoJSON.FeatureCollection) {
  const layer = getCurrentLayer();
  if (!layer) return;
  showRenderingToast('Geometry is rendering');
  const existing = map.getSource(layer.sourceId) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
  } else {
    map.addSource(layer.sourceId, { type: 'geojson', data: fc });
    addExtrusionLayer(layer);
  }
  awaitFirstRenderedFeature(layer.layerId);
}

let keyHandlersInstalled = false;

function addExtrusionLayer(layer: LayerState) {
  if (map.getLayer(layer.layerId)) return;
  map.addLayer({
    id: layer.layerId, type: 'fill-extrusion', source: layer.sourceId,
    paint: {
      'fill-extrusion-color': '#888',
      'fill-extrusion-height': 0,
      'fill-extrusion-opacity': parseFloat(opacityInput.value),
      'fill-extrusion-vertical-gradient': true
    }
  });
  setLayerVisibility(layer, layer.visible);

  // NEW: parcel selection and inspection
  map.on('click', layer.layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    if (currentLayerId !== layer.id) {
      setCurrentLayer(layer.id);
    }
    
    // Handle info tool
    if (isInfoToolActive) {
      const props = (f.properties || {}) as Record<string, any>;
      showPopup(props, e.lngLat);
      return;
    }
    
    // Handle selection tools
    if (currentSelectionMode === 'select-one') {
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
  map.on('contextmenu', layer.layerId, (e) => {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
      lastPicked = null;
    }
  });
  
  map.on('mouseenter', layer.layerId, () => { 
    if (isInfoToolActive) {
      map.getCanvas().style.cursor = 'pointer';
    }
  });
  map.on('mouseleave', layer.layerId, () => { 
    updateCursor();
  });
  
  // Keyboard event handling
  if (!keyHandlersInstalled) {
    document.addEventListener('keydown', (e) => {
      // ESC key to close popup
      if (e.key === 'Escape' && activePopup) {
        activePopup.remove();
        activePopup = null;
        lastPicked = null;
      }
      
      // Hotkey handling
      const key = e.key.toLowerCase();
      if (key === HOTKEYS.PAN) {
        e.preventDefault();
        activateTool('pan');
      } else if (key === HOTKEYS.SELECT) {
        e.preventDefault();
        activateTool('select');
      } else if (key === HOTKEYS.INFO) {
        e.preventDefault();
        activateTool('info');
      }
    });
    keyHandlersInstalled = true;
  }
  
  ensureErrorLayer(layer);
}

function showPopup(props: Record<string, any>, lngLat: maplibregl.LngLatLike) {
  // Only show popup if info tool is active
  if (!isInfoToolActive) return;
  
  if (activePopup) activePopup.remove();
  activePopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: '460px'          // ← wider than default 240px
  })
    .setLngLat(lngLat)
    .setHTML(buildPopupHTML(props))
    .addTo(map);
  lastPicked = { props, lngLat };
  
  // Add search functionality to the popup
  addPopupSearchFunctionality();
}

function addPopupSearchFunctionality() {
  setTimeout(() => {
    const popupElement = activePopup?.getElement();
    if (popupElement) {
      const searchInput = popupElement.querySelector('#popupSearch') as HTMLInputElement;
      const tableBody = popupElement.querySelector('#popupFieldsTable') as HTMLTableSectionElement;
      
      if (searchInput && tableBody) {
        const filterFields = (searchText: string) => {
          const rows = tableBody.querySelectorAll('tr');
          rows.forEach(row => {
            const fieldNameCell = row.querySelector('td:first-child code');
            if (fieldNameCell) {
              const fieldName = fieldNameCell.textContent || '';
              const matches = fieldName.toLowerCase().includes(searchText.toLowerCase());
              (row as HTMLElement).style.display = matches ? '' : 'none';
            }
          });
        };
        
        searchInput.addEventListener('input', (e) => {
          const target = e.target as HTMLInputElement;
          filterFields(target.value);
        });
      }
    }
  }, 0);
}

/* --- value expression builder (handles normalization) --- */
function buildValueExpression(): Expression {
  if (!currentField) return ['literal', 0] as any;
  const base: Expression = ['to-number', ['get', currentField]] as any;

  if (normalizationMode === 'perLand' && landSizeField) {
    const den: Expression = ['to-number', ['get', landSizeField]] as any;
    // Land invalid when ≤ 0 ⇒ height 0 (flat); outline layer will flag it.
    return ['case',
      ['<=', den, 0], 0,
      ['/', base, den]
    ] as any;
  }

  if (normalizationMode === 'perBuilding' && bldgSizeField) {
    const den: Expression = ['to-number', ['get', bldgSizeField]] as any;
    // Building invalid when < 0 ⇒ height 0 (flat) and flagged.
    // Building == 0 is allowed conceptually (no building) but we can't divide by 0 ⇒ also 0 height (not flagged).
    return ['case',
      ['<', den, 0], 0,
      ['==', den, 0], 0,
      ['/', base, den]
    ] as any;
  }

  return base;
}


function applyGrayRendering() {
  if (!currentGeoJSON) return;
  const ids = getCurrentLayerIds();
  if (!ids) return;
  
  // Apply gray color and no extrusion when no field is selected
  map.setPaintProperty(ids.layerId, 'fill-extrusion-color', '#888');
  map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
  map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  
  // Clear any filters
  map.setFilter(ids.layerId, null);
  
  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (activePopup && lastPicked) {
    activePopup.setHTML(buildPopupHTML(lastPicked.props)).setLngLat(lastPicked.lngLat);
    addPopupSearchFunctionality();
  }
}

function applyExtrusion() {
  if (!currentGeoJSON) return;
  const ids = getCurrentLayerIds();
  if (!ids) return;
  
  // If no field is selected, apply gray rendering
  if (!currentField) {
    applyGrayRendering();
    return;
  }

  if (currentFieldType === 'categorical') {
    // For categorical fields, no extrusion - just color
    const colorExpr = buildCategoricalColorExpression();
    
    map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
    map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
    map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  } else {
    // For numeric fields, use the new color expression builder
    const colorExpr = buildNumericColorExpression();
    const valueExpr = buildValueExpression();
    
    const rawMult = Number(multInput.value);
    const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
    const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
    const heightExpr: Expression = is3DMode ? ['*', valueExpr, multiplier * unitFactor] as any : 0;

    map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
    map.setPaintProperty(ids.layerId, 'fill-extrusion-height', heightExpr);
    map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  }

  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (activePopup && lastPicked) {
    activePopup.setHTML(buildPopupHTML(lastPicked.props)).setLngLat(lastPicked.lngLat);
    addPopupSearchFunctionality();
  }
}


/**
 * Pseudo-random, bright, saturated color for item `n` out of `max_n`, seeded by `seed`.
 * - Successive n are far apart via a coprime "golden step" permutation mod max_n
 * - High saturation & mid/high lightness for vivid, easy-to-tell-apart colors
 * - Deterministic across runs for the same (n, max_n, seed)
 */
function generatePseudoRandomColor(n: number, max_n: number, seed: string): string {
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

  // FNV-1a 32-bit string hash → uint32
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

  // HSL → RGB [0..255] integers
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


function buildCategoricalColorPairs(): Array<[string, string]> {
  if (!currentField || !currentGeoJSON) return [];
  
  // Collect unique categories
  const categories = new Set<string>();
  for (const feature of currentGeoJSON.features) {
    const value = feature.properties?.[currentField];
    if (value != null && value !== '' && value !== undefined) {
      categories.add(String(value));
    }
  }
  
  const sortedCategories = Array.from(categories).sort();
  
  if (sortedCategories.length === 0) {
    return [];
  }
  
  const pairs: Array<[string, string]> = [];
  
  if (categoricalColorMode === 'single') {
    // Single color mode: map empty string to the single color
    pairs.push(['', singleColorValue]);
  } else if (categoricalColorMode === 'colorRamp') {
    // Color ramp: sort categories alphabetically and assign colors linearly
    const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
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
    const color = customColors.has(category) ? customColors.get(category)! : defaultColor;
    finalPairs.push([category, color]);
  }
  
  return finalPairs;
}

function buildCategoricalColorExpression(): Expression {
  if (!currentField || !currentGeoJSON) return ['literal', '#888'] as any;
  
  // Get the base color pairs from the inner function
  const pairs = buildCategoricalColorPairs();
  // flatten pairs into an array of strings
  let fallbackColor = '#888';
  if (categoricalColorMode === 'single') {
    fallbackColor = singleColorValue;
  }

  if (customColors.size === 0) {
    if (pairs.length === 0) {
      return ['literal', '#888'] as any;
    }
    if (categoricalColorMode === 'single') {
      return ['literal', fallbackColor] as any;
    }
  }
  const val = ['to-string', ['coalesce', ['get', currentField], '']] as any;

  // Build the final expression with fallback
  const flattenedPairs = pairs.flat();
  const baseResult = ['case',
    ['==', val, ''], fallbackColor,
    ['match', val, ...flattenedPairs, fallbackColor]
  ] as any;
  
  // Add highlighting for selected parcels
  const result = ['case',
    ['boolean', ['feature-state', 'selected'], false], highlightColor,
    baseResult
  ] as any;
  
  return result;
}

function fitToData(fc: GeoJSON.FeatureCollection) {
  const b = bbox(fc); if (!b) return;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 800 });
}

// ---- Quality toggle (runtime supersampling) ----
function setQuality(mode: QualityMode) {
  qualityMode = mode;
  const pr = (mode === 'high') ? HIGH_PR : FAST_PR;

  // setPixelRatio is available on MapLibre >= 2; fall back with a warn otherwise
  const anyMap = map as any;
  if (typeof anyMap.setPixelRatio === 'function') {
    anyMap.setPixelRatio(pr);
    map.resize(); // apply immediately
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

/* ---------------- Camera presets ---------------- */
function setPerspective() { map.easeTo({ pitch: 60, duration: 600 }); }
function setOrtho() { map.easeTo({ pitch: 0, duration: 600 }); }
function setView(which: string) {
  const views: Record<string, Partial<maplibregl.CameraOptions>> = {
    top: { pitch: 0, bearing: 0 }, perspective: { pitch: 60, bearing: -30 },
    north: { pitch: 60, bearing: 0 }, east: { pitch: 60, bearing: 90 },
    south: { pitch: 60, bearing: 180 }, west: { pitch: 60, bearing: 270 }
  };
  map.easeTo({ duration: 700, ...(views[which] || views.perspective) });
}

/* ---------------- Helpers ---------------- */
function computeDisplayedMetricFromProps(props: Record<string, any>): number | null {
  if (!currentField) return null;
  let base = numOrNull(props[currentField]);
  if (base == null) return null;

  if (normalizationMode === 'perLand' && landSizeField) {
    const d = numOrNull(props[landSizeField]);
    if (d == null || d <= 0) return null;
    base = base / d;
  } else if (normalizationMode === 'perBuilding' && bldgSizeField) {
    const d = numOrNull(props[bldgSizeField]);
    if (d == null || d <= 0) return null;
    base = base / d;
  }
  return base;
}

function computeExtrusionHeightMeters(metricValue: number): number {
  const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
  const mult = Number(multInput.value);
  const multiplier = Number.isFinite(mult) ? mult : 0;
  return metricValue * multiplier * unitFactor;
}

// Queue an update; newer calls replace older ones.
function scheduleUpdate(mode: UpdateMode, refreshLegend = false, debounceMs = 80) {
  if (!currentGeoJSON) return;   // <- hard stop until data exists

  _pendingMode = mode;
  _pendingRefreshLegend = refreshLegend;
  if (_updTimer) clearTimeout(_updTimer);
  _updTimer = window.setTimeout(() => {
    _updTimer = null;
    // Clear legend visibility when refreshing colorization
    if (_pendingRefreshLegend) {
      clearLegendVisibility();
    }
    
    if (_pendingMode === 'recomputeAndAutoScale') {
      computeAndApplyAutoMultiplier('auto', HEIGHT_CAP_METERS, HEIGHT_PCTL);
      if (_pendingRefreshLegend) {
        updateFloatingLegend();
      }
    } else {
      applyExtrusionWithVisibility();
      if (_pendingRefreshLegend) {
        updateFloatingLegend();
      }
    }
  }, debounceMs);
}

function chooseBestMetricUnitForMultiplier(p99: number, capMeters = 1000): { unit: MetricUnitKey; multiplier: number } {
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

function populateFieldDropdownFromList(list: string[]) {
  fieldSelect.replaceChildren();
  if (!list.length) fieldSelect.append(new Option('No fields selected', ''));
  else {
    fieldSelect.append(new Option('— choose —', ''));
    for (const n of list) fieldSelect.append(new Option(n, n));
  }
}

function detectNumericFieldsFromFeatures(features: GeoJSON.Feature[]): string[] {
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

function polygonsOnly(fc: GeoJSON.FeatureCollection) {
  return fc.features.filter(
    f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  );
}

function getNumericValuesNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding'): number[] {
  const vals: number[] = [];
  for (const f of fc.features) {
    const p = (f.properties as any) || {};
    let base = Number(p?.[field]);
    if (!Number.isFinite(base)) continue;

    if (mode === 'perLand' && landSizeField) {
      const d = Number(p?.[landSizeField]);
      if (!Number.isFinite(d) || d <= 0) continue;
      base = base / d;
    } else if (mode === 'perBuilding' && bldgSizeField) {
      const d = Number(p?.[bldgSizeField]);
      if (!Number.isFinite(d) || d <= 0) continue;
      base = base / d;
    }
    vals.push(base);
  }
  return vals;
}

function computeStatsNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding') {
  const vals = getNumericValuesNormalized(fc, field, mode);
  let min = Infinity, max = -Infinity;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) { min = 0; max = min + 1; }
  return { min, max };
}

// Build a step expression: first color is < break1, then each break raises the color.
function makeStepColorExpression(valueExpr: Expression, colors: string[], breaks: number[]): Expression {
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

// Auto-multiplier so p-th percentile reaches capMeters, in given units
function computeAndApplyAutoMultiplier(
  unitsKeyOrAuto: 'auto' | keyof typeof UNIT_TO_METERS = 'auto',
  capMeters = 1000,
  p = 99
) {
  if (!currentGeoJSON || !currentField) return;

  // values for the CURRENT normalization mode
  const vals = getNumericValuesNormalized(currentGeoJSON, currentField, normalizationMode);
  const pVal = percentile(vals, p);
  if (!Number.isFinite(pVal) || pVal <= 0) return;

  // ---- Color domain / breaks ----
  if (colorMode === 'quantiles') {
    const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    colorBreaks = quantileBreaks(vals, ramp.length, 1, 99); // p1..p99 equal-frequency bins
    colorDomain = null;
  } else {
    // continuous = EQUAL INTERVAL classes across p1..p99
    const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
    const pLow = percentile(vals, 1);
    const pHigh = percentile(vals, 99);
    let lo = Number.isFinite(pLow) ? pLow : 0;
    let hi = Number.isFinite(pHigh) ? pHigh : 1;
    if (!(hi > lo)) { lo = 0; hi = 1; }
    colorDomain = { lo, hi, label: 'p1–p99' };
   
    // build equal-interval thresholds: colors => k classes => k-1 breaks
    const classes = Math.max(2, ramp.length);
    const step = (hi - lo) / classes;
    const breaks: number[] = [];
    for (let i = 1; i < classes; i++) breaks.push(lo + step * i);
    colorBreaks = breaks;
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

  unitsSelect.value = unitKey;
  multInput.value = String(multiplier);

  // stats for legend fallback
  currentStats = computeStatsNormalized(currentGeoJSON, currentField, normalizationMode);

  console.debug('autoScale', {
    mode: normalizationMode,
    field: currentField,
    pctl: p,
    pVal,
    unit: unitKey,
    multiplier,
    colorMode,
    colorBreaks,
    colorDomain,
    stats: currentStats
  });

  applyExtrusionWithVisibility();
}

function makeColorExpressionFromExpr(valueExpr: Expression, colors: string[], min: number, max: number): Expression {
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


function currentModeErrorMessage(props: Record<string, any>): string | null {
  if (normalizationMode === 'perLand' && landSizeField) {
    const v = Number((props as any)[landSizeField]);
    if (!Number.isFinite(v) || v <= 0) return '⚠ Invalid land size (≤ 0 or missing)';
  } else if (normalizationMode === 'perBuilding' && bldgSizeField) {
    const v = Number((props as any)[bldgSizeField]);
    if (Number.isFinite(v) && v < 0) return '⚠ Negative building size';
    if (v === 0) return 'ℹ Building size is 0 — shown flat (not an error)';
  }
  return null;
}

function buildPopupHTML(props: Record<string, any>): string {
  const title = props.name ?? props.NAME ?? props.id ?? props.ID ?? '';
  const metric = computeDisplayedMetricFromProps(props);
  const heightM = metric != null ? computeExtrusionHeightMeters(metric) : null;

  const unitKey = unitsSelect.value as keyof typeof UNIT_TO_METERS;
  const unitText = (unitsSelect.options[unitsSelect.selectedIndex]?.text || unitKey);

  const fieldsToShow = Array.from(new Set([
    ...chosenNumericFields,
    ...chosenCategoricalFields,
    ...(landSizeField ? [landSizeField] : []),
    ...(bldgSizeField ? [bldgSizeField] : []),
  ]));

  const rows = fieldsToShow.map(k => {
    const v = (props as any)[k];
    const printable = (typeof v === 'number') ? fmt(v) : (v ?? '—');
    return `
      <tr>
        <td style="padding:2px 6px; overflow-wrap:anywhere;">
          <code style="white-space:normal;">${k}</code>
        </td>
        <td style="padding:2px 6px; text-align:right; white-space:nowrap;">
          ${printable}
        </td>
      </tr>`;
  }).join('');

  const modeLabel =
    normalizationMode === 'perLand' ? `per ${landSizeField || 'land size'}` :
    normalizationMode === 'perBuilding' ? `per ${bldgSizeField || 'building size'}` :
    'as-is';

  const metricRow = currentFieldType === 'categorical' 
    ? `<div><strong>Category</strong>: ${currentField ? (props[currentField] ?? '—') : '—'}</div>`
    : (metric != null)
      ? `<div><strong>Display metric (${modeLabel})</strong>: ${fmt(metric)}</div>`
      : `<div><strong>Display metric</strong>: —</div>`;

  const heightRow = currentFieldType === 'categorical'
    ? `<div><strong>Extrusion height</strong>: Flat (no extrusion for categorical fields)</div>`
    : !is3DMode
      ? `<div><strong>Extrusion height</strong>: Flat (3D mode disabled)</div>`
      : (heightM != null)
        ? `<div><strong>Extrusion height</strong>: ${fmt(heightM / (UNIT_TO_METERS[unitKey] || 1))} ${unitText} (${fmt(heightM)} m)</div>`
        : `<div><strong>Extrusion height</strong>: —</div>`;

  const errMsg = currentModeErrorMessage(props);
  const errRow = errMsg ? `<div style="margin-top:4px;color:#b00020;">${errMsg}</div>` : '';

  return `
    <div class="gvw-pop" style="max-width:min(92vw, 460px); font-size:12.5px; line-height:1.35;">
      ${title ? `<div style="font-weight:600;margin-bottom:4px; overflow-wrap:anywhere;">${title}</div>` : ''}
      ${metricRow}
      ${heightRow}
	  ${errRow}
      ${is3DMode && currentFieldType === 'numeric' ? 
        `<div style="margin-top:6px; font-size:12px; color:#666">
          Multiplier × unit: ${fmt(Number(multInput.value))} × ${unitKey}
        </div>` : ''}
      <div style="height:1px;background:#eee;margin:6px 0"></div>
      <div style="font-weight:600;margin-bottom:2px">Loaded fields</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <input type="text" id="popupSearch" placeholder="Search fields..." style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px;">
      </div>
      <div style="overflow-y:auto; max-height:400px;">
        <table style="width:100%; border-collapse:collapse; font-size:12px; table-layout:fixed;">
          <colgroup>
            <col span="1" style="width:65%">
            <col span="1" style="width:35%">
          </colgroup>
          <tbody id="popupFieldsTable">
          ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

function onMultInput() {
  const v = Number(multInput.value);
  if (!Number.isFinite(v)) return; // ignore interim typing states
  scheduleUpdate('applyOnly');
}


function update3DUI() {
  if (currentFieldType === 'numeric') {
    extrusionOptions.style.display = is3DMode ? 'grid' : 'none';
  } else {
    extrusionOptions.style.display = 'none';
  }
}

function computeAndSetGoodExtrusionDefaults() {
  if (!currentGeoJSON || !currentField || currentFieldType !== 'numeric') return;
  
  const vals = getNumericValuesNormalized(currentGeoJSON, currentField, normalizationMode);
  if (vals.length === 0) return;
  
  // Sort values and get p99
  vals.sort((a, b) => a - b);
  const p99 = vals[Math.floor(vals.length * 0.99)];
  
  // Use existing function to choose best unit and multiplier
  const { unit, multiplier } = chooseBestMetricUnitForMultiplier(p99);
  
  // Set the values
  multInput.value = String(multiplier);
  unitsSelect.value = unit;
  
  // Cache the settings
  cachedExtrusionSettings = { multiplier, unit };
}

function updateFieldTypeUI() {
  const numericOptions = document.getElementById('numericOptions');
  const categoricalOptions = document.getElementById('categoricalOptions');
  
  if (!currentField) {
    // Hide all options when no field is selected
    if (numericOptions) numericOptions.style.display = 'none';
    if (categoricalOptions) categoricalOptions.style.display = 'none';
    if (colorOptions) colorOptions.style.display = 'none';
    if (sharedOptions) sharedOptions.style.display = 'none';
    extrusionOptions.style.display = 'none';
  } else {
    // Show shared options when a field is selected
    if (sharedOptions) sharedOptions.style.display = 'grid';
    
    if (currentFieldType === 'numeric') {
      if (numericOptions) numericOptions.style.display = 'grid';
      if (categoricalOptions) categoricalOptions.style.display = 'none';
      if (colorOptions) colorOptions.style.display = 'none';
      update3DUI(); // This will show/hide extrusion options based on 3D mode
    } else if (currentFieldType === 'categorical') {
      if (numericOptions) numericOptions.style.display = 'none';
      if (categoricalOptions) categoricalOptions.style.display = 'grid';
      if (colorOptions) colorOptions.style.display = 'none';
      extrusionOptions.style.display = 'none';
      
      // Show/hide color options based on selected mode
      if (colorOptions) {
        colorOptions.style.display = categoricalColorMode === 'single' ? 'block' : 'none';
      }
    }
	
	// Show/hide color ramp widget based on categorical color mode
	const rampContainer = rampSelect.parentElement?.parentElement;
	if (rampContainer) {
	  rampContainer.style.display = (categoricalColorMode === 'colorRamp' || currentFieldType === 'numeric') ? 'block' : 'none';
	}
  }
}

/* ---------------- Events ---------------- */

// File load: read METADATA ONLY
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  persistCurrentLayerState();
  const dataStore = createDataStore(file, fileToAsyncBuffer(file));
  dataStores.set(dataStore.id, dataStore);
  dataStoreOrder.push(dataStore.id);
  currentDataStoreId = dataStore.id;
  renderDataStoreOptions();
  registerLayer(createLayerState(dataStore.name, dataStore.id));

  revealUI();
  try {
    lastFile = dataStore.file;
    lastAsyncBuffer = dataStore.asyncBuffer;

    const md = await parquetMetadataAsync(lastAsyncBuffer);
    const numRows = Number(md.num_rows ?? 0);

    const kv = (md as any).key_value_metadata || (md as any).keyValueMetadata || [];
    const geoKV = kv.find((e: any) => String(e.key).toLowerCase() === 'geo');
    let primaryGeom = 'geometry';
    try {
      if (geoKV?.value) {
        const parsed = JSON.parse(geoKV.value);
        if (parsed?.primary_column) primaryGeom = parsed.primary_column;
      }
    } catch {}
    
    // numeric and categorical top-level columns (not geometry)
    const schemaTree: any = parquetSchema(md);
    const top = Array.isArray(schemaTree?.children) ? schemaTree.children : [];
    const numeric: string[] = [];
    const categorical: string[] = [];

    for (const node of top) {
      const name = node?.element?.name ?? node?.name;
      if (!name || name === primaryGeom) continue;
      
      const el = node.element ?? {};
      const typeStr = String(el.type?.type ?? el.type ?? el.physicalType ?? el.primitiveType ?? '');
      const logical = String(el.logicalType?.type ?? el.logicalType ?? el.convertedType ?? '');
      
      const isNumeric =
        ['DOUBLE','FLOAT','INT32','INT64','INT16','INT8'].includes(typeStr.toUpperCase()) ||
        logical.toUpperCase() === 'DECIMAL';
      
      // Everything that's not numeric is categorical (including strings, booleans, etc.)
      const isCategorical = !isNumeric;
      
      if (isNumeric) numeric.push(name);
      else if (isCategorical) categorical.push(name);
    }

    lastNumericFieldsFromSchema = numeric.sort();
    lastCategoricalFieldsFromSchema = categorical.sort();
    dataStore.numericFieldsFromSchema = [...lastNumericFieldsFromSchema];
    dataStore.categoricalFieldsFromSchema = [...lastCategoricalFieldsFromSchema];

    // Show numeric fields modal first, then categorical if needed
    if (lastNumericFieldsFromSchema.length > 0) {
      openNumericFieldChooserModal({ 
        rowCount: numRows, 
        geometryCol: primaryGeom, 
        numericFields: lastNumericFieldsFromSchema
      });
    } else if (lastCategoricalFieldsFromSchema.length > 0) {
      openCategoricalFieldChooserModal({ 
        rowCount: numRows, 
        geometryCol: primaryGeom, 
        categoricalFields: lastCategoricalFieldsFromSchema
      });
    } else {
      alert('No numeric or categorical fields found in the file.');
    }
  } catch (err: any) {
    console.error('Metadata read failed:', err);
    alert(`Could not read Parquet metadata: ${err?.message ?? err}`);
  }
});

// Only recompute after data is loaded
[colorCont, colorQuant].forEach(el =>
  el?.addEventListener('change', () => {
    if (!currentGeoJSON) return;
    const val = (document.querySelector('input[name="colorMode"]:checked') as HTMLInputElement)?.value;
    if (val === 'continuous' || val === 'quantiles') {
      colorMode = val;
      scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
      persistCurrentLayerState();
    }
  })
);

// Categorical color mode event listeners
document.querySelectorAll<HTMLInputElement>('input[name="categoricalColorMode"]').forEach(el =>
  el.addEventListener('change', () => {
    
    if (!currentGeoJSON || currentFieldType !== 'categorical') return;
    const val = (document.querySelector('input[name="categoricalColorMode"]:checked') as HTMLInputElement)?.value;
    if (val === 'random' || val === 'single' || val === 'colorRamp') {
      categoricalColorMode = val;
      
      // Show/hide color options
      if (colorOptions) {
        colorOptions.style.display = categoricalColorMode === 'single' ? 'block' : 'none';
      }
      
      // Show/hide color ramp widget based on categorical color mode
      const rampContainer = rampSelect.parentElement?.parentElement;
      if (rampContainer) {
        rampContainer.style.display = (categoricalColorMode === 'colorRamp' || currentFieldType !== 'categorical') ? 'block' : 'none';
      }
      
      scheduleUpdate('applyOnly', /*refreshLegend*/ true);
      persistCurrentLayerState();
    }
  })
);

// Color picker event listeners
btnCancelColorPicker.addEventListener('click', () => {
  // Reset color picker to current value
  colorPicker.value = singleColorValue;
});

btnConfirmColorPicker.addEventListener('click', () => {
  singleColorValue = colorPicker.value;
  
  // Update the map if we're currently using single color mode
  if (currentFieldType === 'categorical' && categoricalColorMode === 'single') {
    scheduleUpdate('applyOnly', /*refreshLegend*/ true);
  }
  persistCurrentLayerState();
});

// Update color picker when single color mode is selected
colorPicker.addEventListener('input', () => {
  // Update the map in real-time as user changes color
  if (currentFieldType === 'categorical' && categoricalColorMode === 'single') {
    singleColorValue = colorPicker.value;
    scheduleUpdate('applyOnly', /*refreshLegend*/ true);
  }
  persistCurrentLayerState();
});

// Window management event listeners
btnMinimizeSettings.addEventListener('click', minimizeSettings);
btnMinimizeLegend.addEventListener('click', minimizeLegend);

// No longer needed - legend toggle removed from settings

// Global mouse event listeners for dragging
document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);

// Make windows draggable
makeDraggable(controlsEl);
makeDraggable(floatingLegend);

rampSelect.addEventListener('change', () => {
  // if quantiles, new color count ⇒ recompute breaks
  const needsRecompute = (colorMode === 'quantiles');
  // Also update if using categorical color ramp
  const needsCategoricalUpdate = (currentFieldType === 'categorical' && categoricalColorMode === 'colorRamp');
  scheduleUpdate(needsRecompute || needsCategoricalUpdate ? 'recomputeAndAutoScale' : 'applyOnly', /*refreshLegend*/ true);
  persistCurrentLayerState();
});

multInput.addEventListener('input', onMultInput);

multInput.addEventListener('change', () => {
  onMultInput();
  // Cache the current extrusion settings
  if (is3DMode && currentFieldType === 'numeric') {
    cachedExtrusionSettings = {
      multiplier: Number(multInput.value),
      unit: unitsSelect.value
    };
  }
  persistCurrentLayerState();
});

unitsSelect.addEventListener('change', () => {
  scheduleUpdate('applyOnly');
  // Cache the current extrusion settings
  if (is3DMode && currentFieldType === 'numeric') {
    cachedExtrusionSettings = {
      multiplier: Number(multInput.value),
      unit: unitsSelect.value
    };
  }
  persistCurrentLayerState();
});

opacityInput.addEventListener('input', () => {
  if (opacityOut) opacityOut.value = Number(opacityInput.value).toFixed(2);
  scheduleUpdate('applyOnly');
  persistCurrentLayerState();
});

fieldSelect.addEventListener('change', () => {
  currentField = fieldSelect.value || null;
  if (!currentGeoJSON) return;
  
  if (!currentField) {
    // No field selected - apply gray rendering
    currentFieldType = null;
    currentStats = null;
    updateFieldTypeUI();
    applyGrayRendering();
    updateFloatingLegend();
    // Clear markup layer when no field is selected
    if (map.getLayer('markup-layer')) map.removeLayer('markup-layer');
    if (map.getLayer('markup-layer-outline')) map.removeLayer('markup-layer-outline');
    if (map.getSource('markup-source')) map.removeSource('markup-source');
    persistCurrentLayerState();
    return;
  }
  
  // Determine field type
  if (chosenNumericFields.includes(currentField)) {
    currentFieldType = 'numeric';
  } else if (chosenCategoricalFields.includes(currentField)) {
    currentFieldType = 'categorical';
  }
  
  // Update UI based on field type
  updateFieldTypeUI();
  
  // Ensure categorical color mode is properly set if switching to categorical
  if (currentFieldType === 'categorical') {
    // Make sure the radio button is checked
    const radioButton = document.querySelector(`input[name="categoricalColorMode"][value="${categoricalColorMode}"]`) as HTMLInputElement;
    if (radioButton) {
      radioButton.checked = true;
    }
  }
  
  // Clear legend selections when field changes, but preserve parcel selections
  selectedLegendItems.clear();
  // Note: selectedParcels is preserved so highlighting continues to work
  
  // Clear cached extrusion settings when field changes
  cachedExtrusionSettings = null;
  
  // Reset to default sorting state when field changes
  if (currentFieldType === 'categorical') {
    legendSortField = 'name';
  } else {
    legendSortField = 'count';
  }
  legendSortDirection = 'desc';
  
  if (map.getLayer('markup-layer')) map.removeLayer('markup-layer');
  if (map.getLayer('markup-layer-outline')) map.removeLayer('markup-layer-outline');
  if (map.getSource('markup-source')) map.removeSource('markup-source');
  
  scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
  persistCurrentLayerState();
});

document.querySelectorAll<HTMLInputElement>('input[name="normMode"]').forEach(r => {
  r.addEventListener('change', () => {
    normalizationMode = (document.querySelector('input[name="normMode"]:checked') as HTMLInputElement)?.value as any;
    // Clear cached extrusion settings when normalization mode changes
    cachedExtrusionSettings = null;
    if (!currentGeoJSON || !currentField) return;
    scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
    persistCurrentLayerState();
  });
});

// 3D checkbox event listener
enable3DCheckbox.addEventListener('change', () => {
  is3DMode = enable3DCheckbox.checked;
  update3DUI();
  
  if (is3DMode && !cachedExtrusionSettings) {
    // First time enabling 3D - compute good defaults
    computeAndSetGoodExtrusionDefaults();
  } else if (is3DMode && cachedExtrusionSettings) {
    // Restore cached settings
    multInput.value = String(cachedExtrusionSettings.multiplier);
    unitsSelect.value = cachedExtrusionSettings.unit;
  }
  
  // Apply the current visualization
  if (currentGeoJSON && currentField) {
    applyExtrusion();
  }
  persistCurrentLayerState();
});

/* ---------------- Main ---------------- */

// default height units
unitsSelect.value = 'centimeters';

// Initialize UI - show numeric options by default, hide categorical
updateFieldTypeUI();

installWelcome();
setQuality('high');
renderLayerList();
renderDataStoreOptions();

function buildNumericColorRanges(): Array<{ min: number; max: number; color: string; rangeKey: string }> {
  if (!currentField || !currentGeoJSON || !currentStats) return [];
  
  const ramp = COLOR_RAMPS[rampSelect.value] || COLOR_RAMPS['Viridis'];
  let ranges: Array<{ min: number; max: number; color: string; rangeKey: string }> = [];
  
  if (colorMode === 'quantiles' && colorBreaks && colorBreaks.length) {
    // Use quantile breaks for ranges
    const breaks = [currentStats.min, ...colorBreaks, currentStats.max];
    for (let i = 0; i < breaks.length - 1; i++) {
      const min = breaks[i];
      const max = breaks[i + 1];
      const rangeKey = `range_${i}`;
      const defaultColor = ramp[Math.min(i, ramp.length - 1)];
      const color = customColors.get(rangeKey) || defaultColor;
      ranges.push({ min, max, color, rangeKey });
    }
  } else {
    // Linear intervals - create 10 ranges
    const min = currentStats.min;
    const max = currentStats.max;
    const step = (max - min) / 10;
    
    for (let i = 0; i < 10; i++) {
      const rangeMin = min + (step * i);
      const rangeMax = i === 9 ? max : min + (step * (i + 1));
      const rangeKey = `range_${i}`;
      const colorIndex = Math.floor((i / 9) * (ramp.length - 1));
      const defaultColor = ramp[colorIndex];
      const color = customColors.get(rangeKey) || defaultColor;
      ranges.push({ min: rangeMin, max: rangeMax, color, rangeKey });
    }
  }
  
  return ranges;
}

function buildNumericColorExpression(): Expression {
  if (!currentField || !currentGeoJSON || !currentStats) return ['literal', '#888'] as any;
  
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
    ['boolean', ['feature-state', 'selected'], false], highlightColor,
    baseResult
  ] as any;
  
  return result;
}

/* ---------------- Vertical Toolbar ---------------- */

// Toolbar state
let currentSelectionMode: 'select-one' | 'select-rectangle' | 'select-lasso' | 'select-polygon' = 'select-one';

// Toolbar elements
const selectToolButton = document.getElementById('selectToolButton') as HTMLButtonElement;
const settingsToolButton = document.getElementById('settingsToolButton') as HTMLButtonElement;
const infoToolButton = document.getElementById('infoToolButton') as HTMLButtonElement;
const panToolButton = document.getElementById('panToolButton') as HTMLButtonElement;
const selectSubmenu = document.getElementById('selectSubmenu') as HTMLDivElement;
const submenuButtons = document.querySelectorAll('.submenu-button') as NodeListOf<HTMLButtonElement>;

// Tool state
let isInfoToolActive = false;
let isPanToolActive = false;

// Hotkey definitions - easily changeable
const HOTKEYS = {
  PAN: 'h',
  SELECT: 'v',
  INFO: 'i'
};

// Icon mappings for different selection modes
const selectionModeIcons: Record<string, string> = {
  'select-one': new URL('./svg/select_cursor.svg', import.meta.url).href,
  'select-rectangle': new URL('./svg/select_rectangle.svg', import.meta.url).href,
  'select-lasso': new URL('./svg/select_lasso.svg', import.meta.url).href,
  'select-polygon': new URL('./svg/select_polygon.svg', import.meta.url).href
};
const cornerTriangleIcon = new URL('./svg/corner_triangle.svg', import.meta.url).href;

// Update the main toolbar button icon based on current selection mode
function updateToolbarIcon() {
  const iconPath = selectionModeIcons[currentSelectionMode];
  selectToolButton.innerHTML = `<img src="${iconPath}" alt="Select" />
          <span class="hotkey">V</span>
          <img src="${cornerTriangleIcon}" alt="" class="corner-triangle" />`;
}

// Update submenu active states
function updateSubmenuActiveStates() {
  submenuButtons.forEach(button => {
    const mode = button.getAttribute('data-mode');
    if (mode === currentSelectionMode) {
      button.classList.add('active-tool');
    } else {
      button.classList.remove('active-tool');
    }
  });
}

// Function to activate a specific tool and deactivate others
function activateTool(tool: 'pan' | 'info' | 'select') {
  // Deactivate all tools first
  isPanToolActive = false;
  isInfoToolActive = false;
  
  // Remove active-tool class from all buttons
  panToolButton.classList.remove('active-tool');
  infoToolButton.classList.remove('active-tool');
  selectToolButton.classList.remove('active-tool');
  
  // Activate the specified tool
  switch (tool) {
    case 'pan':
      isPanToolActive = true;
      panToolButton.classList.add('active-tool');
      // Enable drag pan for pan tool
      map.dragPan.enable();
      break;
    case 'info':
      isInfoToolActive = true;
      infoToolButton.classList.add('active-tool');
      // Disable drag pan for info tool
      map.dragPan.disable();
      break;
    case 'select':
      selectToolButton.classList.add('active-tool');
      // Disable drag pan for select tool
      map.dragPan.disable();
      break;
  }
  
  // Update selection mode handlers
  setupSelectionModeHandlers();
  
  // Update cursor
  updateCursor();
  
  // Close popup if info tool is deactivated
  if (!isInfoToolActive && activePopup) {
    activePopup.remove();
    activePopup = null;
    lastPicked = null;
  }
}

// Handle submenu button clicks
function handleSubmenuButtonClick(mode: string) {
  currentSelectionMode = mode as any;
  updateToolbarIcon();
  updateSubmenuActiveStates();
  selectSubmenu.classList.remove('show');
  
  // Activate select tool
  activateTool('select');
  
  console.log(`Selection mode changed to: ${mode}`);
}

// Set up event handlers based on current selection mode
function setupSelectionModeHandlers() {
  const mapContainer = map.getContainer();
  
  // Remove all existing mouse event listeners
  mapContainer.removeEventListener('mousedown', handleRectangleMouseDown);
  mapContainer.removeEventListener('mousemove', handleRectangleMouseMove);
  mapContainer.removeEventListener('mouseup', handleRectangleMouseUp);
  mapContainer.removeEventListener('mousedown', handleLassoMouseDown);
  mapContainer.removeEventListener('mousemove', handleLassoMouseMove);
  mapContainer.removeEventListener('mouseup', handleLassoMouseUp);
  mapContainer.removeEventListener('mousedown', handlePolygonMouseDown);
  mapContainer.removeEventListener('mousemove', handlePolygonMouseMove);
  mapContainer.removeEventListener('dblclick', handlePolygonDoubleClick);
  mapContainer.removeEventListener('mousedown', handlePanMouseDown);
  mapContainer.removeEventListener('mousemove', handlePanMouseMove);
  mapContainer.removeEventListener('mouseup', handlePanMouseUp);
  
  // Add pan tool event listeners if pan tool is active
  if (isPanToolActive) {
    mapContainer.addEventListener('mousedown', handlePanMouseDown);
    mapContainer.addEventListener('mousemove', handlePanMouseMove);
    mapContainer.addEventListener('mouseup', handlePanMouseUp);
    return;
  }
  
  // If info tool is active, don't add any selection event listeners
  if (isInfoToolActive) {
    return;
  }
  
  // Add event listeners based on current mode
  switch (currentSelectionMode) {
    case 'select-rectangle':
      mapContainer.addEventListener('mousedown', handleRectangleMouseDown);
      mapContainer.addEventListener('mousemove', handleRectangleMouseMove);
      mapContainer.addEventListener('mouseup', handleRectangleMouseUp);
      break;
    case 'select-lasso':
      mapContainer.addEventListener('mousedown', handleLassoMouseDown);
      mapContainer.addEventListener('mousemove', handleLassoMouseMove);
      mapContainer.addEventListener('mouseup', handleLassoMouseUp);
      break;
    case 'select-polygon':
      mapContainer.addEventListener('mousedown', handlePolygonMouseDown);
      mapContainer.addEventListener('mousemove', handlePolygonMouseMove);
      mapContainer.addEventListener('dblclick', handlePolygonDoubleClick);
      break;
    case 'select-one':
      // This mode uses the existing map click handler
      break;
  }
}

// Helper function to close all submenus
function closeAllSubmenus() {
  selectSubmenu.classList.remove('show');
  // Add other submenus here if they exist in the future
}

// Initialize toolbar
function initializeToolbar() {
  // Set initial state
  updateToolbarIcon();
  updateSubmenuActiveStates();
  
  // Set initial button states based on window visibility
  updateToolbarButtonStates();
  
  // Activate pan tool by default
  activateTool('pan');
  
  // Set up initial selection mode handlers
  setupSelectionModeHandlers();
  
  // Set initial cursor state
  updateCursor();
  
  // Handle main select button click and hold behavior
  let selectButtonHoldTimer: number | null = null;
  let selectButtonHoldDuration = 200; // milliseconds to hold before showing submenu

  selectToolButton.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    
    // Start hold timer
    selectButtonHoldTimer = window.setTimeout(() => {
      selectSubmenu.classList.add('show');
      selectButtonHoldTimer = null;
    }, selectButtonHoldDuration);
  });

  selectToolButton.addEventListener('mouseup', (e) => {
    e.stopPropagation();
    
    // If timer is still running, it was a quick click - toggle current option
    if (selectButtonHoldTimer) {
      clearTimeout(selectButtonHoldTimer);
      selectButtonHoldTimer = null;
      
      // Toggle the current selection mode
      const currentButton = selectSubmenu.querySelector(`[data-mode="${currentSelectionMode}"]`) as HTMLButtonElement;
      if (currentButton) {
        handleSubmenuButtonClick(currentSelectionMode);
      }
      // Close submenu after toggling
      closeAllSubmenus();
    }
  });

  selectToolButton.addEventListener('mouseleave', () => {
    // Clear timer if mouse leaves button
    if (selectButtonHoldTimer) {
      clearTimeout(selectButtonHoldTimer);
      selectButtonHoldTimer = null;
    }
  });
  
  // Handle settings button click
  settingsToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    if (isSettingsMinimized) {
      showSettings();
    } else {
      minimizeSettings();
    }
  });
  
  // Handle pan button click
  panToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    
    if (isPanToolActive) {
      // If pan is already active, deactivate it
      activateTool('select');
    } else {
      // Activate pan tool
      activateTool('pan');
    }
  });
  
  // Handle info button click
  infoToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    
    if (isInfoToolActive) {
      // If info is already active, deactivate it
      activateTool('select');
    } else {
      // Activate info tool
      activateTool('info');
    }
  });
  
  // Handle legend button click
  legendToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    if (isLegendMinimized) {
      showLegend();
    } else {
      minimizeLegend();
    }
  });
  
  // Handle submenu button clicks
  submenuButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = button.getAttribute('data-mode');
      if (mode) {
        handleSubmenuButtonClick(mode);
        // Close submenu after selecting an option
        closeAllSubmenus();
      }
    });
  });
  
  // Close submenu when clicking outside
  document.addEventListener('click', (e) => {
    if (!selectToolButton.contains(e.target as Node) && !selectSubmenu.contains(e.target as Node)) {
      closeAllSubmenus();
    }
  });
}

// Update toolbar button states based on window visibility
function updateToolbarButtonStates() {
  // Settings button state
  if (isSettingsMinimized) {
    settingsToolButton.classList.add('inactive');
    settingsToolButton.classList.remove('active');
  } else {
    settingsToolButton.classList.remove('inactive');
    settingsToolButton.classList.add('active');
  }
  
  // Legend button state
  if (isLegendMinimized) {
    legendToolButton.classList.add('inactive');
    legendToolButton.classList.remove('active');
  } else {
    legendToolButton.classList.remove('inactive');
    legendToolButton.classList.add('active');
  }
}

// Initialize toolbar when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeToolbar);
} else {
  initializeToolbar();
}


/* ---------------- Lasso Selection Tool ---------------- */

// Lasso selection state
let isLassoSelecting = false;
let isLassoUnselecting = false;
let lassoPoints: maplibregl.Point[] = [];
let lassoElement: HTMLDivElement | null = null;
let lassoSVG: SVGElement | null = null;
let lassoPath: SVGPathElement | null = null;

// Create lasso drawing element
function createLassoElement(): HTMLDivElement {
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
  
  // Create SVG for lasso path
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  `;
  
  // Create fill path (for the colored background)
  const fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fillPath.setAttribute('class', 'lasso-fill');
  
  // Create background path (for the white dashes)
  const bgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  bgPath.setAttribute('class', 'lasso-path-bg select');
  
  // Create foreground path (for the black/red dashes)
  const fgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fgPath.setAttribute('class', 'lasso-path select');
  
  svg.appendChild(fillPath);
  svg.appendChild(bgPath);
  svg.appendChild(fgPath);
  lasso.appendChild(svg);
  document.body.appendChild(lasso);
  
  return lasso;
}

// Initialize lasso element
lassoElement = createLassoElement();
lassoSVG = lassoElement.querySelector('svg') as SVGElement;
lassoPath = lassoElement.querySelector('.lasso-path') as SVGPathElement;

// Lasso selection mouse handlers
function handleLassoMouseDown(e: MouseEvent) {
  // Only activate on left click (select only), shift+left click (add), or alt+left click (remove)
  if (e.button !== 0) return;
  
  // Prevent default behavior
  e.preventDefault();
  e.stopPropagation();
  
  // Determine mode based on modifier keys
  const isAddMode = e.shiftKey && !e.altKey;
  const isRemoveMode = e.altKey && !e.shiftKey;
  const isSelectOnlyMode = !e.shiftKey && !e.altKey;
  
  // Start lasso selection/unselection
  if (isRemoveMode) {
    isLassoUnselecting = true;
  } else {
    isLassoSelecting = true;
  }
  
  // Initialize lasso points (viewport coordinates for visual positioning)
  lassoPoints = [getViewportPoint(e)];
  
  // Temporarily disable map drag pan
  originalDragPan = map.dragPan.isEnabled();
  map.dragPan.disable();
  
  // Show lasso element
  if (lassoElement) {
    lassoElement.style.display = 'block';
    
    // Get all path elements
    const fillPath = lassoElement.querySelector('.lasso-fill') as SVGPathElement;
    const bgPath = lassoElement.querySelector('.lasso-path-bg') as SVGPathElement;
    const fgPath = lassoElement.querySelector('.lasso-path') as SVGPathElement;
    
    // Apply styling based on mode
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
  
  // Change cursor to arrow for SELECT mode
  map.getCanvas().style.cursor = 'default';
}

function handleLassoMouseMove(e: MouseEvent) {
  if ((!isLassoSelecting && !isLassoUnselecting) || !lassoElement) return;
  
  // Sample points every 5 pixels to avoid too many points (viewport coordinates for visual positioning)
  const currentPoint = getViewportPoint(e);
  const lastPoint = lassoPoints[lassoPoints.length - 1];
  
  if (currentPoint.dist(lastPoint) >= 5) {
    lassoPoints.push(currentPoint);
    updateLassoPath();
  }
}

function updateLassoPath() {
  if (!lassoElement || lassoPoints.length < 2) return;
  
  // Get all path elements
  const fillPath = lassoElement.querySelector('.lasso-fill') as SVGPathElement;
  const bgPath = lassoElement.querySelector('.lasso-path-bg') as SVGPathElement;
  const fgPath = lassoElement.querySelector('.lasso-path') as SVGPathElement;
  
  if (!fillPath || !bgPath || !fgPath) return;
  
  // Build SVG path
  let pathData = `M ${lassoPoints[0].x} ${lassoPoints[0].y}`;
  
  for (let i = 1; i < lassoPoints.length; i++) {
    pathData += ` L ${lassoPoints[i].x} ${lassoPoints[i].y}`;
  }
  
  // Close the path by connecting to the first point
  if (lassoPoints.length > 2) {
    pathData += ` Z`;
  }
  
  // Update all three paths with the same path data
  fillPath.setAttribute('d', pathData);
  bgPath.setAttribute('d', pathData);
  fgPath.setAttribute('d', pathData);
}

function handleLassoMouseUp(e: MouseEvent) {
  if ((!isLassoSelecting && !isLassoUnselecting) || !lassoElement) return;
  
  // Close the lasso by adding the first point again if we have enough points
  if (lassoPoints.length >= 3) {
    lassoPoints.push(lassoPoints[0]);
    updateLassoPath();
    
    // Convert viewport coordinates to map coordinates for selection logic
    const mapCoordinates = lassoPoints.map(point => {
      // Convert viewport coordinates to map container coordinates first
      const canvas = map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const mapPoint = new maplibregl.Point(
        point.x - rect.left,
        point.y - rect.top
      );
      return map.unproject([mapPoint.x, mapPoint.y]);
    });
    
    // Create a polygon from the coordinates
    const polygon = mapCoordinates.map(coord => [coord.lng, coord.lat]);
    
    // Log coordinates to console
    const mode = isLassoUnselecting ? 'Unselect' : 'Select';
    console.log(`Lasso ${mode} Coordinates:`, polygon);
    
    // Handle different selection modes
    if (isLassoUnselecting) {
      // Remove parcels from selection
      unselectParcelsInPolygon(polygon);
    } else {
      // Check if this is select-only mode (no modifiers)
      const isSelectOnlyMode = !e.shiftKey && !e.altKey;
      if (isSelectOnlyMode) {
        // Select only these parcels, unselect all others
        clearAllSelections();
      }
      // Add parcels to selection
      selectParcelsInPolygon(polygon);
    }
  }
  
  // Clean up
  isLassoSelecting = false;
  isLassoUnselecting = false;
  lassoPoints = [];
  
  // Hide lasso element
  if (lassoElement) {
    lassoElement.style.display = 'none';
  }
  
  // Restore map drag pan
  if (originalDragPan !== undefined) {
    if (originalDragPan) {
      map.dragPan.enable();
    }
    originalDragPan = undefined;
  }
  
  // Restore cursor
  updateCursor();
}

// Function to select parcels within a polygon
function selectParcelsInPolygon(polygon: number[][]) {
  if (!currentGeoJSON) {
    console.log('No data loaded to select from');
    return;
  }
  const sourceId = getCurrentSourceId();
  if (!sourceId) return;
  
  // Calculate bounding box for the lasso polygon
  const bbox = calculatePolygonBbox(polygon);
  
  let selectedCount = 0;
  
  // First, filter features by bounding box intersection (broad-phase collision detection)
  const candidateFeatures = currentGeoJSON.features.filter(feature => {
    if (!feature.geometry || !feature.id) return false;
    return featureIntersectsBbox(feature, bbox);
  });
  
  console.log(`Broad-phase filtering: ${candidateFeatures.length} features out of ${currentGeoJSON.features.length} candidates`);
  
  // Then, perform detailed polygon intersection checks only on the filtered subset
  for (const feature of candidateFeatures) {
    if (!feature.geometry || !feature.id) continue;
    
    // Check if the feature intersects with our lasso polygon
    if (featureIntersectsPolygon(feature, polygon)) {
      const parcelId = getParcelId(feature);
      selectedParcels.add(parcelId);
      
      // Set feature state for highlighting
      map.setFeatureState(
        { source: sourceId, id: feature.id },
        { selected: true }
      );
      
      selectedCount++;
    }
  }
  
  console.log(`Selected ${selectedCount} parcels within the lasso`);
  
  // Update the selection controls UI
  updateSelectionControls();
}

// Function to unselect parcels within a polygon
function unselectParcelsInPolygon(polygon: number[][]) {
  if (!currentGeoJSON) {
    console.log('No data loaded to unselect from');
    return;
  }
  const sourceId = getCurrentSourceId();
  if (!sourceId) return;
  
  // Calculate bounding box for the lasso polygon
  const bbox = calculatePolygonBbox(polygon);
  
  let unselectedCount = 0;
  
  // First, filter features by bounding box intersection (broad-phase collision detection)
  const candidateFeatures = currentGeoJSON.features.filter(feature => {
    if (!feature.geometry || !feature.id) return false;
    return featureIntersectsBbox(feature, bbox);
  });
  
  console.log(`Broad-phase filtering: ${candidateFeatures.length} features out of ${currentGeoJSON.features.length} candidates`);
  
  // Then, perform detailed polygon intersection checks only on the filtered subset
  for (const feature of candidateFeatures) {
    if (!feature.geometry || !feature.id) continue;
    
    // Check if the feature intersects with our lasso polygon
    if (featureIntersectsPolygon(feature, polygon)) {
      const parcelId = getParcelId(feature);
      
      // Only unselect if it was previously selected
      if (selectedParcels.has(parcelId)) {
        selectedParcels.delete(parcelId);
        
        // Set feature state to remove highlighting
        map.setFeatureState(
          { source: sourceId, id: feature.id },
          { selected: false }
        );
        
        unselectedCount++;
      }
    }
  }
  
  console.log(`Unselected ${unselectedCount} parcels within the lasso`);
  
  // Update the selection controls UI
  updateSelectionControls();
}

// Helper function to check if a feature intersects with a polygon
function featureIntersectsPolygon(feature: GeoJSON.Feature, polygon: number[][]): boolean {
  if (feature.geometry.type === 'Polygon') {
    return polygonIntersectsPolygon(feature.geometry.coordinates, polygon);
  } else if (feature.geometry.type === 'MultiPolygon') {
    return feature.geometry.coordinates.some(poly => 
      polygonIntersectsPolygon(poly, polygon)
    );
  }
  
  return false;
}

// Helper function to check if a polygon intersects with another polygon
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

// Helper function to calculate bounding box for a polygon
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


/* ---------------- Polygon Selection Tool ---------------- */

// Polygon selection state
let isPolygonSelecting = false;
let isPolygonUnselecting = false;
let polygonPoints: maplibregl.Point[] = [];
let polygonElement: HTMLDivElement | null = null;
let polygonSVG: SVGElement | null = null;
let polygonPath: SVGPathElement | null = null;
let polygonStartPoint: maplibregl.Point | null = null;
let isPolygonClosing = false;
let polygonSelectionMode: 'select-only' | 'add' | 'remove' = 'select-only';

// Create polygon drawing element (reuses lasso element structure)
function createPolygonElement(): HTMLDivElement {
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
  
  // Create SVG for polygon path
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  `;
  
  // Create fill path (for the colored background)
  const fillPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fillPath.setAttribute('class', 'polygon-fill');
  
  // Create background path (for the white dashes)
  const bgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  bgPath.setAttribute('class', 'polygon-path-bg select');
  
  // Create foreground path (for the black/red dashes)
  const fgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fgPath.setAttribute('class', 'polygon-path select');
  
  // Create closing indicator circle
  const closingIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  closingIndicator.setAttribute('class', 'polygon-closing-indicator');
  closingIndicator.setAttribute('r', '8'); // Slightly bigger than the 10px close detection radius
  closingIndicator.style.display = 'none';
  
  svg.appendChild(fillPath);
  svg.appendChild(bgPath);
  svg.appendChild(fgPath);
  svg.appendChild(closingIndicator);
  polygon.appendChild(svg);
  document.body.appendChild(polygon);
  
  return polygon;
}

// Initialize polygon element
polygonElement = createPolygonElement();
polygonSVG = polygonElement.querySelector('svg') as SVGElement;
polygonPath = polygonElement.querySelector('.polygon-path') as SVGPathElement;

// Polygon selection mouse handlers
function handlePolygonMouseDown(e: MouseEvent) {
  // Only activate on left click (select only), shift+left click (add), or alt+left click (remove)
  if (e.button !== 0) return;
  
  // Prevent default behavior
  e.preventDefault();
  e.stopPropagation();
  
  // Determine mode based on modifier keys
  const isAddMode = e.shiftKey && !e.altKey;
  const isRemoveMode = e.altKey && !e.shiftKey;
  const isSelectOnlyMode = !e.shiftKey && !e.altKey;
  const currentPoint = getViewportPoint(e);
  
  // If this is the first click, start polygon selection
  if (polygonPoints.length === 0) {
    isPolygonSelecting = !isRemoveMode;
    isPolygonUnselecting = isRemoveMode;
    
    // Store the selection mode
    if (isRemoveMode) {
      polygonSelectionMode = 'remove';
    } else if (isAddMode) {
      polygonSelectionMode = 'add';
    } else {
      polygonSelectionMode = 'select-only';
    }
    
    polygonStartPoint = currentPoint;
    polygonPoints = [currentPoint];
    
    // Temporarily disable map drag pan
    originalDragPan = map.dragPan.isEnabled();
    map.dragPan.disable();
    
    // Show polygon element
    if (polygonElement) {
      polygonElement.style.display = 'block';
      
      // Get all path elements
      const fillPath = polygonElement.querySelector('.polygon-fill') as SVGPathElement;
      const bgPath = polygonElement.querySelector('.polygon-path-bg') as SVGPathElement;
      const fgPath = polygonElement.querySelector('.polygon-path') as SVGPathElement;
      
      // Apply styling based on mode
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
    
    // Change cursor to arrow for SELECT mode
    map.getCanvas().style.cursor = 'default';
  } else {
    // Check if clicking near the start point to close the polygon
    if (polygonStartPoint && currentPoint.dist(polygonStartPoint) <= 10) {
      closePolygon();
    } else {
      // Add a new point to the polygon
      polygonPoints.push(currentPoint);
      updatePolygonPath();
    }
  }
}

function handlePolygonMouseMove(e: MouseEvent) {
  if ((!isPolygonSelecting && !isPolygonUnselecting) || !polygonElement || polygonPoints.length === 0) return;
  
  const currentPoint = getViewportPoint(e);
  
  // Check if we're near the start point for closing indication
  if (polygonStartPoint && currentPoint.dist(polygonStartPoint) <= 10) {
    if (!isPolygonClosing) {
      isPolygonClosing = true;
      // Show closing indicator
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
      // Hide closing indicator
      const closingIndicator = polygonElement.querySelector('.polygon-closing-indicator') as SVGCircleElement;
      if (closingIndicator) {
        closingIndicator.style.display = 'none';
      }
    }
  }
  
  // Update the path to show line from last point to current mouse position
  updatePolygonPath(currentPoint);
}

function updatePolygonPath(currentMousePoint?: maplibregl.Point) {
  if (!polygonElement || polygonPoints.length === 0) return;
  
  // Get all path elements
  const fillPath = polygonElement.querySelector('.polygon-fill') as SVGPathElement;
  const bgPath = polygonElement.querySelector('.polygon-path-bg') as SVGPathElement;
  const fgPath = polygonElement.querySelector('.polygon-path') as SVGPathElement;
  
  if (!fillPath || !bgPath || !fgPath) return;
  
  // Build SVG path
  let pathData = `M ${polygonPoints[0].x} ${polygonPoints[0].y}`;
  
  // Add lines between committed points
  for (let i = 1; i < polygonPoints.length; i++) {
    pathData += ` L ${polygonPoints[i].x} ${polygonPoints[i].y}`;
  }
  
  // Add line from last committed point to current mouse position
  if (currentMousePoint && polygonPoints.length > 0) {
    pathData += ` L ${currentMousePoint.x} ${currentMousePoint.y}`;
  }
  
  // Close the path if we have enough points
  if (polygonPoints.length >= 3) {
    pathData += ` Z`;
  }
  
  // Update all three paths with the same path data
  fillPath.setAttribute('d', pathData);
  bgPath.setAttribute('d', pathData);
  fgPath.setAttribute('d', pathData);
}

function handlePolygonDoubleClick(e: MouseEvent) {
  if ((!isPolygonSelecting && !isPolygonUnselecting) || polygonPoints.length < 3) return;
  
  // Prevent default behavior
  e.preventDefault();
  e.stopPropagation();
  
  // Close the polygon
  closePolygon();
}

function closePolygon() {
  if ((!isPolygonSelecting && !isPolygonUnselecting) || !polygonElement || polygonPoints.length < 3) return;
  
  // Convert viewport coordinates to map coordinates for selection logic
  const mapCoordinates = polygonPoints.map(point => {
    // Convert viewport coordinates to map container coordinates first
    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const mapPoint = new maplibregl.Point(
      point.x - rect.left,
      point.y - rect.top
    );
    return map.unproject([mapPoint.x, mapPoint.y]);
  });
  
  // Create a polygon from the coordinates
  const polygon = mapCoordinates.map(coord => [coord.lng, coord.lat]);
  
  // Log coordinates to console
  const mode = isPolygonUnselecting ? 'Unselect' : 'Select';
  console.log(`Polygon ${mode} Coordinates:`, polygon);
  
  // Handle different selection modes
  if (polygonSelectionMode === 'remove') {
    // Remove parcels from selection
    unselectParcelsInPolygon(polygon);
  } else if (polygonSelectionMode === 'select-only') {
    // Select only these parcels, unselect all others
    clearAllSelections();
    selectParcelsInPolygon(polygon);
  } else {
    // Add parcels to selection
    selectParcelsInPolygon(polygon);
  }
  
  // Clean up
  isPolygonSelecting = false;
  isPolygonUnselecting = false;
  polygonPoints = [];
  polygonStartPoint = null;
  isPolygonClosing = false;
  
  // Hide polygon element and closing indicator
  if (polygonElement) {
    polygonElement.style.display = 'none';
    const closingIndicator = polygonElement.querySelector('.polygon-closing-indicator') as SVGCircleElement;
    if (closingIndicator) {
      closingIndicator.style.display = 'none';
    }
  }
  
  // Restore map drag pan
  if (originalDragPan !== undefined) {
    if (originalDragPan) {
      map.dragPan.enable();
    }
    originalDragPan = undefined;
  }
  
  // Restore cursor
  updateCursor();
}
