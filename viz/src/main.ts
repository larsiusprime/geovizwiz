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
  }

  @media (prefers-reduced-motion: reduce) {
    .selection-rect { animation-duration: 2s; }
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
  // Only activate on shift+left click (select) or alt+left click (unselect)
  if (!((e.shiftKey && !e.altKey) || (e.altKey && !e.shiftKey)) || e.button !== 0) return;
  
  // Prevent default behavior
  e.preventDefault();
  e.stopPropagation();
  
  // Determine mode based on modifier keys
  const isUnselectMode = e.altKey && !e.shiftKey;
  
  // Start rectangle selection/unselection
  if (isUnselectMode) {
    isRectangleUnselecting = true;
  } else {
    isRectangleSelecting = true;
  }
  
  rectangleStartPoint = new maplibregl.Point(e.clientX, e.clientY);
  
  // Temporarily disable map drag pan
  originalDragPan = map.dragPan.isEnabled();
  map.dragPan.disable();
  
  // Show rectangle element with appropriate styling
  if (rectangleElement) {
    rectangleElement.style.display = 'block';
    rectangleElement.style.left = `${e.clientX}px`;
    rectangleElement.style.top = `${e.clientY}px`;
    rectangleElement.style.width = '0px';
    rectangleElement.style.height = '0px';
    
    // Apply unselect styling if in unselect mode
    if (isUnselectMode) {
      rectangleElement.classList.add('unselect');
    } else {
      rectangleElement.classList.remove('unselect');
    }
  }
  
  // Change cursor
  map.getCanvas().style.cursor = 'crosshair';
}

function handleRectangleMouseMove(e: MouseEvent) {
  if ((!isRectangleSelecting && !isRectangleUnselecting) || !rectangleStartPoint || !rectangleElement) return;
  
  // Calculate rectangle dimensions
  const currentPoint = new maplibregl.Point(e.clientX, e.clientY);
  const left = Math.min(rectangleStartPoint.x, currentPoint.x);
  const top = Math.min(rectangleStartPoint.y, currentPoint.y);
  const width = Math.abs(currentPoint.x - rectangleStartPoint.x);
  const height = Math.abs(currentPoint.y - rectangleStartPoint.y);
  
  // Update rectangle element
  rectangleElement.style.left = `${left}px`;
  rectangleElement.style.top = `${top}px`;
  rectangleElement.style.width = `${width}px`;
  rectangleElement.style.height = `${height}px`;
}

function handleRectangleMouseUp(e: MouseEvent) {
  if ((!isRectangleSelecting && !isRectangleUnselecting) || !rectangleStartPoint || !rectangleElement) return;
  
  // Calculate final rectangle
  const currentPoint = new maplibregl.Point(e.clientX, e.clientY);
  const left = Math.min(rectangleStartPoint.x, currentPoint.x);
  const top = Math.min(rectangleStartPoint.y, currentPoint.y);
  const width = Math.abs(currentPoint.x - rectangleStartPoint.x);
  const height = Math.abs(currentPoint.y - rectangleStartPoint.y);
  
  // Only process if rectangle has meaningful size
  if (width > 5 && height > 5) {
    // Convert screen coordinates to map coordinates
    const topLeft = map.unproject([left, top]);
    const bottomRight = map.unproject([left + width, top + height]);
    
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
    console.log('Screen space:', { left, top, width, height });
    console.log('Map coordinates (bbox):', bbox);
    console.log('Top-left:', { lng: topLeft.lng, lat: topLeft.lat });
    console.log('Bottom-right:', { lng: bottomRight.lng, lat: bottomRight.lat });
    
    // Select or unselect all parcels within the bounding box
    if (isRectangleUnselecting) {
      unselectParcelsInBoundingBox(bbox);
    } else {
      selectParcelsInBoundingBox(bbox);
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
  map.getCanvas().style.cursor = '';
}

// Function to select parcels within a bounding box
function selectParcelsInBoundingBox(bbox: [number, number, number, number]) {
  if (!currentGeoJSON) {
    console.log('No data loaded to select from');
    return;
  }
  
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
        { source: SOURCE_ID, id: feature.id },
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
          { source: SOURCE_ID, id: feature.id },
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

// Add event listeners to map container
const mapContainer = map.getContainer();
mapContainer.addEventListener('mousedown', handleRectangleMouseDown);
mapContainer.addEventListener('mousemove', handleRectangleMouseMove);
mapContainer.addEventListener('mouseup', handleRectangleMouseUp);

// Also handle mouse events on the document to catch mouse up outside the map
document.addEventListener('mouseup', handleRectangleMouseUp);


/* ---------------- UI elements ---------------- */


const fileInput = document.getElementById('file') as HTMLInputElement;
const fieldSelect = document.getElementById('field') as HTMLSelectElement;
const rampSelect = document.getElementById('ramp') as HTMLSelectElement;
const enable3DCheckbox = document.getElementById('enable3D') as HTMLInputElement;
const extrusionOptions = document.getElementById('extrusionOptions') as HTMLFieldSetElement;
const multInput = document.getElementById('mult') as HTMLInputElement;
const unitsSelect = document.getElementById('units') as HTMLSelectElement;
const opacityInput = document.getElementById('opacity') as HTMLInputElement;
const opacityOut = document.getElementById('opacityVal') as HTMLOutputElement
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
          };

          countHeader.onclick = () => {
            if (legendSortField === 'count') {
              legendSortDirection = legendSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
              legendSortField = 'count';
              legendSortDirection = 'asc';
            }
            updateFloatingLegend();
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
  
  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(clearButton);
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
                   { source: SOURCE_ID, id: feature.id },
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
                   { source: SOURCE_ID, id: feature.id },
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
  
  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    filterCategories('');
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
                   { source: SOURCE_ID, id: feature.id },
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
                   { source: SOURCE_ID, id: feature.id },
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
  
  // If we have custom colors, we need to rebuild the color expression
  if (customColors.size > 0) {
    let colorExpr: any;
    
    if (currentFieldType === 'categorical') {
      colorExpr = buildCategoricalColorExpression();
    } else {
      colorExpr = buildNumericColorExpression();
    }
    
    map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
    
    // Apply height and opacity for numeric fields
    if (currentFieldType === 'numeric') {
      const rawMult = Number(multInput.value);
      const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
      const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
      const valueExpr = buildValueExpression();
      const heightExpr: any = is3DMode ? ['*', valueExpr, multiplier * unitFactor] : 0;
      
      map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', heightExpr);
    } else {
      map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', 0);
    }
    
    map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  } else {
    // No custom colors, use normal extrusion
    applyExtrusion();
  }
}





function applyVisibilityFilters() {
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
      map.setFilter(LAYER_ID, filter as any);
    }
  } else {
    // Clear any filters
    map.setFilter(LAYER_ID, null);
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
  const parcelId = getParcelId(feature);
  if (selectedParcels.has(parcelId)) {
    selectedParcels.delete(parcelId);
    map.setFeatureState(
      { source: SOURCE_ID, id: feature.id },
      { selected: false }
    );
  } else {
    selectedParcels.add(parcelId);
    map.setFeatureState(
      { source: SOURCE_ID, id: feature.id },
      { selected: true }
    );
  }
  updateSelectionControls();
}

function addParcelToSelection(feature: any) {
  const parcelId = getParcelId(feature);
  selectedParcels.add(parcelId);
  map.setFeatureState(
    { source: SOURCE_ID, id: feature.id },
    { selected: true }
  );
  updateSelectionControls();
}

function removeParcelFromSelection(feature: any) {
  const parcelId = getParcelId(feature);
  selectedParcels.delete(parcelId);
  map.setFeatureState(
    { source: SOURCE_ID, id: feature.id },
    { selected: false }
  );
  updateSelectionControls();
}

function clearAllSelections() {
  // Clear all feature states
  if (currentGeoJSON) {
    for (const feature of currentGeoJSON.features) {
      if (feature.id !== undefined) {
        map.setFeatureState(
          { source: SOURCE_ID, id: feature.id },
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
  if (currentFieldType === 'categorical') {
    // For categorical fields, rebuild the color expression with highlighting
    const colorExpr = buildCategoricalColorExpression();
    map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
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

function awaitFirstRenderedFeature() {
  // poll one frame at a time; hide toast when the first extrusion is visible
  let tries = 0;
  const maxTries = 600; // ~10s at 60fps
  const tick = () => {
    tries++;
    if (!map.getLayer(LAYER_ID)) { if (tries < maxTries) return requestAnimationFrame(tick); else return hideRenderingToast(); }
    const feats = map.queryRenderedFeatures({ layers: [LAYER_ID] });
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
  } catch (err: any) {
    console.error('GeoParquet load failed:', err);
    if (!cancelRequested) alert(`GeoParquet load failed: ${err?.message ?? err}`);
  } finally {
    hideLoading();
  }
}

/* ---------------- Map helpers ---------------- */
function ensureErrorLayer() {
  if (map.getLayer(ERROR_LAYER_ID)) return;
  map.addLayer({
    id: ERROR_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    paint: {
      'line-color': '#ff3b30',          // red outline
      'line-width': 1.5,
      'line-dasharray': [1, 1.3],
      'line-opacity': 0.9
    }
  });
  // keep it above extrusions for visibility
  try { map.moveLayer(ERROR_LAYER_ID); } catch {}
}

function updateErrorLayer() {
  if (!map.getSource(SOURCE_ID)) return;
  ensureErrorLayer();

  let filter: any = ['==', ['literal', 1], 2]; // matches nothing by default

  if (normalizationMode === 'perLand' && landSizeField) {
    // land invalid when ≤ 0  (zero not allowed)
    filter = ['<=', ['to-number', ['get', landSizeField]], 0];
  } else if (normalizationMode === 'perBuilding' && bldgSizeField) {
    // building invalid when negative (zero is allowed and not flagged)
    filter = ['<', ['to-number', ['get', bldgSizeField]], 0];
  }

  map.setFilter(ERROR_LAYER_ID, filter);
}
function clearData() {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  if (map.getLayer('markup-layer')) map.removeLayer('markup-layer');
  if (map.getLayer('markup-layer-outline')) map.removeLayer('markup-layer-outline');
  if (map.getSource('markup-source')) map.removeSource('markup-source');
  currentGeoJSON = null; currentField = null; currentStats = null;
  fieldSelect.replaceChildren(new Option('— load a file first —', ''));
  // Clear cached extrusion settings when data is cleared
  cachedExtrusionSettings = null;
  
  // Clear selection state
  selectedParcels.clear();
  selectedLegendItems.clear();
  if (selectionControlsPanel) {
    selectionControlsPanel.style.display = 'none';
  }
  
  hideRenderingToast();
}
function addOrUpdateSource(fc: GeoJSON.FeatureCollection) {
  showRenderingToast('Geometry is rendering');
  const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
  } else {
    map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
    addExtrusionLayer();
  }
  awaitFirstRenderedFeature();
}

function addExtrusionLayer() {
  if (map.getLayer(LAYER_ID)) return;
  map.addLayer({
    id: LAYER_ID, type: 'fill-extrusion', source: SOURCE_ID,
    paint: {
      'fill-extrusion-color': '#888',
      'fill-extrusion-height': 0,
      'fill-extrusion-opacity': parseFloat(opacityInput.value),
      'fill-extrusion-vertical-gradient': true
    }
  });

  // NEW: parcel selection and inspection
  map.on('click', LAYER_ID, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    
    // Handle different click modes
    if (e.originalEvent.shiftKey) {
      // Shift-click: always add to selection
      addParcelToSelection(f);
    } else if (e.originalEvent.altKey) {
      // Alt-click: always remove from selection
      removeParcelFromSelection(f);
    } else {
      // Regular left-click: toggle selection
      toggleParcelSelection(f);
    }
  });
  
  // Right-click for inspection popup
  map.on('contextmenu', LAYER_ID, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const props = (f.properties || {}) as Record<string, any>;
    showPopup(props, e.lngLat);
  });
  
  map.on('mouseenter', LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
  ensureErrorLayer();
}

function showPopup(props: Record<string, any>, lngLat: maplibregl.LngLatLike) {
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
      const clearButton = popupElement.querySelector('#popupSearchClear') as HTMLButtonElement;
      const tableBody = popupElement.querySelector('#popupFieldsTable') as HTMLTableSectionElement;
      
      if (searchInput && clearButton && tableBody) {
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
        
        clearButton.addEventListener('click', () => {
          searchInput.value = '';
          filterFields('');
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
  
  // Apply gray color and no extrusion when no field is selected
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', '#888');
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', 0);
  map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  
  // Clear any filters
  map.setFilter(LAYER_ID, null);
  
  // refresh which features are flagged as erroneous for current mode
  updateErrorLayer();

  if (activePopup && lastPicked) {
    activePopup.setHTML(buildPopupHTML(lastPicked.props)).setLngLat(lastPicked.lngLat);
    addPopupSearchFunctionality();
  }
}

function applyExtrusion() {
  if (!currentGeoJSON) return;
  
  // If no field is selected, apply gray rendering
  if (!currentField) {
    applyGrayRendering();
    return;
  }

  if (currentFieldType === 'categorical') {
    // For categorical fields, no extrusion - just color
    const colorExpr = buildCategoricalColorExpression();
    
    map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
    map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', 0);
    map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
  } else {
    // For numeric fields, use the new color expression builder
    const colorExpr = buildNumericColorExpression();
    const valueExpr = buildValueExpression();
    
    const rawMult = Number(multInput.value);
    const multiplier = Number.isFinite(rawMult) ? rawMult : 0;
    const unitFactor = UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
    const heightExpr: Expression = is3DMode ? ['*', valueExpr, multiplier * unitFactor] as any : 0;

    map.setPaintProperty(LAYER_ID, 'fill-extrusion-color', colorExpr);
    map.setPaintProperty(LAYER_ID, 'fill-extrusion-height', heightExpr);
    map.setPaintProperty(LAYER_ID, 'fill-extrusion-opacity', parseFloat(opacityInput.value));
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
        <button id="popupSearchClear" style="padding:4px 8px;border:1px solid #ddd;background:#f8f8f8;border-radius:4px;cursor:pointer;font-size:12px;">Clear</button>
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

  revealUI();
  try {
    lastFile = file;
    lastAsyncBuffer = fileToAsyncBuffer(file);

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
});

// Update color picker when single color mode is selected
colorPicker.addEventListener('input', () => {
  // Update the map in real-time as user changes color
  if (currentFieldType === 'categorical' && categoricalColorMode === 'single') {
    singleColorValue = colorPicker.value;
    scheduleUpdate('applyOnly', /*refreshLegend*/ true);
  }
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
});

opacityInput.addEventListener('input', () => {
  if (opacityOut) opacityOut.value = Number(opacityInput.value).toFixed(2);
  scheduleUpdate('applyOnly');
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
});

document.querySelectorAll<HTMLInputElement>('input[name="normMode"]').forEach(r => {
  r.addEventListener('change', () => {
    normalizationMode = (document.querySelector('input[name="normMode"]:checked') as HTMLInputElement)?.value as any;
    // Clear cached extrusion settings when normalization mode changes
    cachedExtrusionSettings = null;
    if (!currentGeoJSON || !currentField) return;
    scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
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
});

/* ---------------- Main ---------------- */

// default height units
unitsSelect.value = 'centimeters';

// Initialize UI - show numeric options by default, hide categorical
updateFieldTypeUI();

installWelcome();
setQuality('high');

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
let currentSelectionMode: 'select-one' | 'select-rectangle' | 'select-lasso' | 'select-polygon' | 'off' = 'select-one';

// Toolbar elements
const selectToolButton = document.getElementById('selectToolButton') as HTMLButtonElement;
const settingsToolButton = document.getElementById('settingsToolButton') as HTMLButtonElement;
const selectSubmenu = document.getElementById('selectSubmenu') as HTMLDivElement;
const submenuButtons = document.querySelectorAll('.submenu-button') as NodeListOf<HTMLButtonElement>;

// Icon mappings for different selection modes
const selectionModeIcons: Record<string, string> = {
  'select-one': 'src/svg/select_cursor.svg',
  'select-rectangle': 'src/svg/select_rectangle.svg',
  'select-lasso': 'src/svg/select_lasso.svg',
  'select-polygon': 'src/svg/select_polygon.svg',
  'off': 'src/svg/select_none.svg'
};

// Update the main toolbar button icon based on current selection mode
function updateToolbarIcon() {
  const iconPath = selectionModeIcons[currentSelectionMode];
  selectToolButton.innerHTML = `<img src="${iconPath}" alt="Select" />`;
  
  // Update active state
  if (currentSelectionMode === 'off') {
    selectToolButton.classList.remove('active');
  } else {
    selectToolButton.classList.add('active');
  }
}

// Update submenu active states
function updateSubmenuActiveStates() {
  submenuButtons.forEach(button => {
    const mode = button.getAttribute('data-mode');
    if (mode === currentSelectionMode) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });
}

// Handle submenu button clicks
function handleSubmenuButtonClick(mode: string) {
  currentSelectionMode = mode as any;
  updateToolbarIcon();
  updateSubmenuActiveStates();
  selectSubmenu.classList.remove('show');
  
  // TODO: Implement mode-specific functionality
  console.log(`Selection mode changed to: ${mode}`);
}

// Initialize toolbar
function initializeToolbar() {
  // Set initial state
  updateToolbarIcon();
  updateSubmenuActiveStates();
  
  // Set initial button states based on window visibility
  updateToolbarButtonStates();
  
  // Handle main select button click
  selectToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    selectSubmenu.classList.toggle('show');
  });
  
  // Handle settings button click
  settingsToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isSettingsMinimized) {
      showSettings();
    } else {
      minimizeSettings();
    }
  });
  
  // Handle legend button click
  legendToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
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
      }
    });
  });
  
  // Close submenu when clicking outside
  document.addEventListener('click', (e) => {
    if (!selectToolButton.contains(e.target as Node) && !selectSubmenu.contains(e.target as Node)) {
      selectSubmenu.classList.remove('show');
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


