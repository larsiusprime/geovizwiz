import { triggerDownload } from '../export/download.js';

const MODEL_GROUPS = ['single_family', 'multi_family', 'commercial', 'industrial', 'mobile_home', 'agricultural'];

export default function startSyntheticApp() {
  const byId = (id) => document.getElementById(id);
  const logEl = byId('log');
  const statusEl = byId('status');
  const mParcels = byId('mParcels');
  const mSales = byId('mSales');
  const mCrs = byId('mCrs');
  const generateBtn = byId('generateBtn');
  const cancelBtn = byId('cancelBtn');
  const exportBtn = byId('exportBtn');

  const state = { worker: null, result: null };

  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/style.json',
    center: [-87.6298, 41.8781],
    zoom: 10
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  map.on('load', () => {
    map.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'parcels-fill',
      type: 'fill',
      source: 'parcels',
      paint: {
        'fill-color': ['match', ['get', 'neighborhood'],
          'CBD', '#f97316',
          'inner ring', '#f59e0b',
          'suburb', '#84cc16',
          'exurb', '#22c55e',
          'commercial corridors', '#0ea5e9',
          'industrial sector', '#6b7280',
          'rural outlying', '#a3a3a3',
          '#8b5cf6'
        ],
        'fill-opacity': 0.55
      }
    });
    map.addLayer({ id: 'parcels-line', type: 'line', source: 'parcels', paint: { 'line-color': '#334155', 'line-width': 0.4 } });
  });

  const log = (msg) => {
    logEl.textContent += `${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  const readNumber = (id, fallback) => {
    const v = Number(byId(id).value);
    return Number.isFinite(v) ? v : fallback;
  };

  const buildConfig = () => {
    const saleProbabilities = Object.fromEntries(MODEL_GROUPS.map((g) => [g, Math.max(0, Math.min(1, readNumber(`p_${g}`, 0.05)))]));
    return {
      cityName: byId('cityName').value.trim() || 'Unknown',
      centerLat: readNumber('centerLat', 41.8781),
      centerLon: readNumber('centerLon', -87.6298),
      seed: byId('seed').value.trim() || 'synthetic-city',
      parcelCount: Math.min(10000, Math.max(100, Math.round(readNumber('parcelCount', 5000)))),
      repaintYears: Math.max(1, Math.round(readNumber('repaintYears', 5))),
      invalidPct: Math.max(0, Math.min(100, readNumber('invalidPct', 8))),
      saleProbabilities,
      startYear: 1980,
      endYear: new Date().getFullYear(),
      nominalPriceList: [1, 5, 10, 50, 100, 500, 1000]
    };
  };

  const setBusy = (busy) => {
    generateBtn.disabled = busy;
    cancelBtn.disabled = !busy;
  };

  const updateMap = (featureCollection) => {
    const src = map.getSource('parcels');
    if (src) src.setData(featureCollection);
    const first = featureCollection?.features?.[0];
    if (first?.geometry?.coordinates?.[0]?.[0]) {
      const [lon, lat] = first.geometry.coordinates[0][0];
      map.easeTo({ center: [lon, lat], zoom: 11, duration: 650 });
    }
  };

  generateBtn.onclick = () => {
    const config = buildConfig();
    if (state.worker) state.worker.terminate();
    state.result = null;
    exportBtn.disabled = true;
    logEl.textContent = '';
    statusEl.textContent = 'Generating...';
    setBusy(true);

    const worker = new Worker(new URL('./syntheticWorker.js', import.meta.url), { type: 'module' });
    state.worker = worker;

    worker.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'log') log(payload.message);
      if (type === 'progress') statusEl.textContent = payload.message;
      if (type === 'milestone') updateMap(payload.featureCollection);
      if (type === 'success') {
        state.result = payload;
        statusEl.textContent = 'Generation complete.';
        mParcels.textContent = String(payload.universeCount || 0);
        mSales.textContent = String(payload.salesCount || 0);
        mCrs.textContent = payload.crs || 'EPSG:4326';
        updateMap(payload.preview || { type: 'FeatureCollection', features: [] });
        exportBtn.disabled = false;
        setBusy(false);
        worker.terminate();
        state.worker = null;
      }
      if (type === 'error') {
        statusEl.textContent = payload.message || 'Generation failed.';
        setBusy(false);
        worker.terminate();
        state.worker = null;
      }
    };

    worker.onerror = (err) => {
      statusEl.textContent = err.message || 'Worker failure.';
      setBusy(false);
      worker.terminate();
      state.worker = null;
    };

    worker.postMessage({ mode: 'generate', config });
  };

  cancelBtn.onclick = () => {
    if (!state.worker) return;
    state.worker.terminate();
    state.worker = null;
    setBusy(false);
    statusEl.textContent = 'Canceled.';
    log('Generation canceled by user.');
  };

  exportBtn.onclick = () => {
    if (!state.result) return;
    const worker = new Worker(new URL('./syntheticWorker.js', import.meta.url), { type: 'module' });
    statusEl.textContent = 'Building export ZIP...';
    exportBtn.disabled = true;

    worker.onmessage = async (event) => {
      const { type, payload } = event.data || {};
      if (type === 'progress') statusEl.textContent = payload.message;
      if (type === 'error') {
        statusEl.textContent = payload.message || 'Export failed.';
        exportBtn.disabled = false;
        worker.terminate();
      }
      if (type === 'zip') {
        const zipBlob = payload.zipBlob;
        triggerDownload(zipBlob, payload.filename || 'synthetic_city.zip');
        statusEl.textContent = 'Export complete.';
        exportBtn.disabled = false;
        worker.terminate();
      }
    };

    worker.postMessage({ mode: 'export', payload: state.result });
  };
}
