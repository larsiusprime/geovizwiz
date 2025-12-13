import './style.css';
import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  EllipsoidTerrainProvider,
  GeoJsonDataSource,
  GoogleMaps,
  Math as CesiumMath,
  OpenStreetMapImageryProvider,
  Viewer,
  type Cesium3DTileset
} from 'cesium';
import { toGeoJson } from 'geoparquet';
import { compressors } from 'hyparquet-compressors';
import { parquetMetadataAsync } from 'hyparquet';

type AsyncBuffer = { byteLength: number; slice(start: number, end?: number): Promise<ArrayBuffer> };

type FieldStats = { min: number; max: number };

type LoadedParcels = {
  source: GeoJsonDataSource;
  stats: Record<string, FieldStats>;
  numericFields: string[];
};

const DEFAULT_CAMERA = Cartesian3.fromDegrees(-95.3698, 29.7604, 12000);
const DEFAULT_COLOR_RAMPS: Record<string, [string, string]> = {
  sunset: ['#fb923c', '#7c2d12'],
  ocean: ['#22d3ee', '#1e3a8a'],
  forest: ['#4ade80', '#14532d']
};

let viewer: Viewer;
let googleTileset: Cesium3DTileset | null = null;
let parcels: LoadedParcels | null = null;
let currentRampKey = 'sunset';
let googleKey: string | null = null;

function fileToAsyncBuffer(file: File): AsyncBuffer {
  return {
    byteLength: file.size,
    async slice(start, end) {
      return file.slice(start, end ?? file.size).arrayBuffer();
    }
  };
}

function buildUi() {
  const app = document.getElementById('app');
  if (!app) throw new Error('app container missing');
  app.innerHTML = `
    <div class="panel">
      <h1>Earth POC</h1>
      <section>
        <h2>Google Key</h2>
        <label for="google-key">Google Maps API key</label>
        <input id="google-key" type="text" placeholder="Paste your API key" autocomplete="off" />
        <div class="row" style="margin-top:8px;">
          <button id="apply-key" class="primary">Apply key</button>
          <button id="toggle-google" disabled>Show Google 3D</button>
        </div>
        <p class="small">Key stays in the browser only. Without it, the Google 3D tileset stays off.</p>
        <div id="google-status" class="banner warn">Google 3D tiles are off.</div>
      </section>

      <section>
        <h2>Parquet</h2>
        <label for="parquet-file">Upload a GeoParquet file</label>
        <input id="parquet-file" type="file" accept=".parquet" />
        <div id="parquet-status" class="banner warn" style="margin-top:8px;">No parcels loaded.</div>
      </section>

      <section>
        <h2>Styling</h2>
        <div class="field-row">
          <div>
            <label for="height-field">Height field</label>
            <select id="height-field"></select>
          </div>
          <div>
            <label for="color-field">Color field</label>
            <select id="color-field"></select>
          </div>
        </div>
        <div class="slider-row" style="margin-top:10px;">
          <label for="height-scale" style="min-width:110px;">Height scale</label>
          <input id="height-scale" type="range" min="0" max="20" step="0.5" value="1" />
          <span id="height-scale-value" class="small">1×</span>
        </div>
        <div class="slider-row" style="margin-top:10px;">
          <label for="base-height" style="min-width:110px;">Base height (m)</label>
          <input id="base-height" type="number" min="0" value="0" />
        </div>
        <div class="row" style="margin-top:10px; align-items:center;">
          <div>
            <label for="color-ramp">Color ramp</label>
            <select id="color-ramp"></select>
          </div>
          <div id="ramp-chip" class="color-chip" aria-label="Ramp preview"></div>
        </div>
        <div class="row" style="margin-top:12px;">
          <button id="restyle" class="primary" disabled>Apply styling</button>
          <button id="reset-view">Reset view</button>
        </div>
      </section>

      <section>
        <h2>Layers</h2>
        <div class="toggle-row">
          <span>Base imagery</span>
          <span class="small">OpenStreetMap</span>
        </div>
        <div class="toggle-row" style="margin-top:6px;">
          <span>Google photorealistic</span>
          <span id="google-toggle-state" class="small">Off</span>
        </div>
      </section>
    </div>
    <div id="map"></div>
  `;
}

function initViewer() {
  viewer = new Viewer('map', {
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: true,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    terrainProvider: new EllipsoidTerrainProvider(),
    imageryProvider: new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
  });
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.camera.setView({ destination: DEFAULT_CAMERA, orientation: { heading: CesiumMath.toRadians(-20), pitch: CesiumMath.toRadians(-25), roll: 0 } });
}

function populateRampSelect() {
  const rampSelect = document.getElementById('color-ramp') as HTMLSelectElement;
  rampSelect.innerHTML = '';
  Object.keys(DEFAULT_COLOR_RAMPS).forEach((key) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    rampSelect.appendChild(opt);
  });
  rampSelect.value = currentRampKey;
  updateRampChip();
}

function updateRampChip() {
  const chip = document.getElementById('ramp-chip');
  const ramp = DEFAULT_COLOR_RAMPS[currentRampKey];
  if (chip && ramp) {
    chip.setAttribute('style', `background: linear-gradient(90deg, ${ramp[0]}, ${ramp[1]});`);
  }
}

function setGoogleStatus(message: string, kind: 'warn' | 'ok' | 'err') {
  const el = document.getElementById('google-status');
  if (!el) return;
  el.textContent = message;
  el.className = `banner ${kind}`;
  const toggleState = document.getElementById('google-toggle-state');
  if (toggleState) toggleState.textContent = googleTileset?.show ? 'On' : 'Off';
}

function setParquetStatus(message: string, kind: 'warn' | 'ok' | 'err') {
  const el = document.getElementById('parquet-status');
  if (!el) return;
  el.textContent = message;
  el.className = `banner ${kind}`;
}

function fillFieldSelect(select: HTMLSelectElement, fields: string[]) {
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'None';
  select.appendChild(none);
  fields.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    select.appendChild(opt);
  });
}

function extractNumericFields(features: GeoJSON.Feature[]): string[] {
  const counts: Record<string, number> = {};
  for (const f of features) {
    const props = f.properties ?? {};
    for (const [k, v] of Object.entries(props)) {
      if (typeof v === 'number' && Number.isFinite(v)) counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return Object.keys(counts).filter((k) => counts[k] > 0).sort();
}

function computeStats(features: GeoJSON.Feature[], fields: string[]): Record<string, FieldStats> {
  const stats: Record<string, FieldStats> = {};
  for (const field of fields) stats[field] = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
  for (const f of features) {
    const props = f.properties ?? {};
    for (const field of fields) {
      const v = (props as Record<string, unknown>)[field];
      if (typeof v === 'number' && Number.isFinite(v)) {
        stats[field].min = Math.min(stats[field].min, v);
        stats[field].max = Math.max(stats[field].max, v);
      }
    }
  }
  return stats;
}

function interpolateColor(min: number, max: number, value: number, ramp: [string, string]): Color {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return Color.fromCssColorString(ramp[0]);
  }
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const start = Color.fromCssColorString(ramp[0]);
  const end = Color.fromCssColorString(ramp[1]);
  return Color.fromAlpha(Color.lerp(start, end, t, new Color()), 0.9);
}

async function applyGoogleTiles() {
  const input = document.getElementById('google-key') as HTMLInputElement;
  googleKey = input.value.trim() || null;
  if (!googleKey) {
    setGoogleStatus('No key provided. Google tiles are off.', 'warn');
    return;
  }
  const toggleBtn = document.getElementById('toggle-google') as HTMLButtonElement;
  toggleBtn.disabled = true;
  try {
    GoogleMaps.defaultApiKey = googleKey;
    if (!googleTileset) {
      googleTileset = await GoogleMaps.createPhotorealistic3DTileset();
      googleTileset.show = true;
      viewer.scene.primitives.add(googleTileset);
    } else {
      googleTileset.show = true;
    }
    toggleBtn.textContent = 'Hide Google 3D';
    toggleBtn.disabled = false;
    setGoogleStatus('Google photorealistic tiles active.', 'ok');
  } catch (err) {
    console.error(err);
    setGoogleStatus('Failed to load Google tiles. Check the key and billing.', 'err');
    toggleBtn.disabled = false;
  }
}

function toggleGoogleTiles() {
  if (!googleTileset) {
    void applyGoogleTiles();
    return;
  }
  googleTileset.show = !googleTileset.show;
  const btn = document.getElementById('toggle-google') as HTMLButtonElement;
  btn.textContent = googleTileset.show ? 'Hide Google 3D' : 'Show Google 3D';
  setGoogleStatus(googleTileset.show ? 'Google photorealistic tiles active.' : 'Google tiles hidden.', googleTileset.show ? 'ok' : 'warn');
}

async function loadParquet(file: File) {
  try {
    const asyncBuffer = fileToAsyncBuffer(file);
    await parquetMetadataAsync(asyncBuffer);
    const geojson: GeoJSON.FeatureCollection = await toGeoJson({ file: asyncBuffer, compressors });
    if (!geojson.features?.length) throw new Error('No features found');

    const numericFields = extractNumericFields(geojson.features);
    const stats = computeStats(geojson.features, numericFields);

    if (parcels) {
      viewer.dataSources.remove(parcels.source, true);
      parcels = null;
    }
    const dataSource = await GeoJsonDataSource.load(geojson, {
      clampToGround: false
    });
    viewer.dataSources.add(dataSource);
    parcels = { source: dataSource, stats, numericFields };

    const heightField = document.getElementById('height-field') as HTMLSelectElement;
    const colorField = document.getElementById('color-field') as HTMLSelectElement;
    fillFieldSelect(heightField, numericFields);
    fillFieldSelect(colorField, numericFields);
    heightField.value = numericFields[0] ?? '';
    colorField.value = numericFields[0] ?? '';

    (document.getElementById('restyle') as HTMLButtonElement).disabled = false;
    setParquetStatus(`Loaded ${geojson.features.length} features.`, 'ok');
    viewer.flyTo(dataSource);
    applyStyling();
  } catch (err) {
    console.error(err);
    setParquetStatus('Failed to load parquet. Make sure it is GeoParquet.', 'err');
  }
}

function applyStyling() {
  if (!parcels) return;
  const heightField = (document.getElementById('height-field') as HTMLSelectElement).value;
  const colorField = (document.getElementById('color-field') as HTMLSelectElement).value;
  const heightScale = Number((document.getElementById('height-scale') as HTMLInputElement).value);
  const baseHeight = Number((document.getElementById('base-height') as HTMLInputElement).value) || 0;
  const ramp = DEFAULT_COLOR_RAMPS[currentRampKey];
  const colorStats = colorField ? parcels.stats[colorField] : null;

  const entities = parcels.source.entities.values;
  for (const entity of entities) {
    const props = entity.properties ?? {};
    if (entity.polygon) {
      const hVal = heightField && props[heightField] ? props[heightField].getValue() : null;
      const height = baseHeight + (Number.isFinite(hVal) ? Number(hVal) * heightScale : 0);
      entity.polygon.extrudedHeight = height;
      entity.polygon.height = 0;
      const colorVal = colorField && props[colorField] ? props[colorField].getValue() : null;
      const color = ramp ? interpolateColor(colorStats?.min ?? 0, colorStats?.max ?? 1, Number(colorVal), ramp) : Color.WHITE;
      entity.polygon.material = new ColorMaterialProperty(color);
      entity.polygon.outline = true;
      entity.polygon.outlineColor = Color.fromAlpha(Color.BLACK, 0.6);
    }
  }
  const label = document.getElementById('height-scale-value');
  if (label) label.textContent = `${heightScale.toFixed(1)}×`;
}

function bindEvents() {
  const applyKey = document.getElementById('apply-key') as HTMLButtonElement;
  const toggleGoogleBtn = document.getElementById('toggle-google') as HTMLButtonElement;
  const parquetInput = document.getElementById('parquet-file') as HTMLInputElement;
  const restyleBtn = document.getElementById('restyle') as HTMLButtonElement;
  const rampSelect = document.getElementById('color-ramp') as HTMLSelectElement;

  applyKey.addEventListener('click', () => void applyGoogleTiles());
  toggleGoogleBtn.addEventListener('click', toggleGoogleTiles);
  parquetInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadParquet(file);
  });
  restyleBtn.addEventListener('click', applyStyling);
  rampSelect.addEventListener('change', (e) => {
    currentRampKey = (e.target as HTMLSelectElement).value;
    updateRampChip();
    applyStyling();
  });
  (document.getElementById('height-scale') as HTMLInputElement).addEventListener('input', applyStyling);
  (document.getElementById('base-height') as HTMLInputElement).addEventListener('change', applyStyling);
  (document.getElementById('reset-view') as HTMLButtonElement).addEventListener('click', () => {
    viewer.flyTo(viewer.scene.globe, { offset: new Cartesian3(0, 0, 0) });
    viewer.camera.flyTo({ destination: DEFAULT_CAMERA, orientation: { heading: CesiumMath.toRadians(-20), pitch: CesiumMath.toRadians(-25), roll: 0 }, duration: 1.6 });
  });
}

function bootstrap() {
  buildUi();
  initViewer();
  populateRampSelect();
  bindEvents();
}

bootstrap();
