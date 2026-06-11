/**
 * Desktop-mode bootstrap (gated by isDesktopMode()).
 *
 * Owns the desktop-only surfaces that have no browser equivalent:
 *   - a project picker overlay (create / open project),
 *   - an import action (file -> DuckDB table via the main process),
 *   - a viewport controller that streams geometry for the current map view
 *     from the project DB and feeds it into the EXISTING in-memory render path.
 *
 * Phase 1 streams geometry + chosen attribute fields together (bbox-first), so
 * downstream rendering/stats/filters operate on `S.currentGeoJSON` exactly as
 * in the browser. None of this is imported by the browser build's hot path.
 */

import { S } from './state.js';
import { getRepository } from './data/index.js';
import type { SourceInfo } from './data/index.js';
import { createDataStore, createLayerState, registerLayer, renderDataStoreList } from './layers.js';
import { addOrUpdateSource, applyGrayRendering, fitToData } from './rendering.js';

export interface DesktopHost {
  /** Reveal the main app chrome (same as the browser upload flow does). */
  revealUI(): void;
  /** Populate the field dropdown + refresh stats/scatter/etc. panels. */
  onSourceLoaded(fields: string[]): void;
}

let host: DesktopHost | null = null;
let activeSource: SourceInfo | null = null;
let activeLayerId: string | null = null;
let moveTimer: number | null = null;
let firstLoad = true;

/** Zoom-dependent simplification tolerance in degrees. */
function toleranceForZoom(zoom: number): number {
  if (zoom >= 16) return 0;
  if (zoom >= 14) return 0.00001;
  if (zoom >= 12) return 0.00004;
  if (zoom >= 10) return 0.00015;
  return 0.0006;
}

function currentBBox() {
  const b = S.map.getBounds();
  return { minLng: b.getWest(), minLat: b.getSouth(), maxLng: b.getEast(), maxLat: b.getNorth() };
}

/** Re-query the viewport and update the in-memory render source. */
async function refreshViewport(): Promise<void> {
  if (!activeSource || !host) return;
  const repo = getRepository();
  const fields = [...activeSource.numericFields, ...activeSource.categoricalFields];
  const zoom = S.map.getZoom();
  try {
    const fc = await repo.queryGeometryByBBox(activeSource.id, currentBBox(), {
      fields,
      zoom,
      simplifyTolerance: toleranceForZoom(zoom),
      limit: 250000
    });
    S.currentGeoJSON = fc;
    const layer = activeLayerId ? S.layers.get(activeLayerId) : null;
    if (layer) layer.geojson = fc;
    addOrUpdateSource(fc);
    if (S.currentField == null) applyGrayRendering();
  } catch (err) {
    console.error('[desktop] viewport query failed:', err);
  }
}

const onMoveEnd = () => {
  if (moveTimer != null) window.clearTimeout(moveTimer);
  moveTimer = window.setTimeout(() => { void refreshViewport(); }, 250);
};

/** Make a freshly-imported (or opened) source the active rendered source. */
async function activateSource(source: SourceInfo): Promise<void> {
  if (!host) return;
  activeSource = source;

  // Reuse the existing datastore/layer machinery. A synthetic File satisfies
  // the factory; desktop never reads parquet bytes from it.
  const file = new File([], `${source.name}.parquet`);
  const ds = createDataStore(file, { byteLength: 0, slice: async () => new ArrayBuffer(0) } as any);
  ds.id = source.id; // align datastore id with the DB source id
  ds.name = source.name;
  ds.numericFieldsFromSchema = [...source.numericFields];
  ds.categoricalFieldsFromSchema = [...source.categoricalFields];
  ds.chosenNumericFields = [...source.numericFields];
  ds.chosenCategoricalFields = [...source.categoricalFields];
  ds.parcelIdField = source.parcelIdField;
  S.dataStores.set(ds.id, ds);
  if (!S.dataStoreOrder.includes(ds.id)) S.dataStoreOrder.push(ds.id);
  S.currentDataStoreId = ds.id;
  renderDataStoreList();

  const layer = createLayerState(source.name, ds.id);
  layer.chosenNumericFields = [...source.numericFields];
  layer.chosenCategoricalFields = [...source.categoricalFields];
  registerLayer(layer);
  activeLayerId = layer.id;
  S.currentLayerId = layer.id;

  // Mirror loadSelectedColumns' state setup.
  S.chosenNumericFields = [...source.numericFields];
  S.chosenCategoricalFields = [...source.categoricalFields];
  S.currentField = null;
  S.currentFieldType = null;
  S.parcelPatchMap = new Map();

  host.revealUI();
  hidePicker();

  // Install the viewport streamer and do the first load.
  S.map.off('moveend', onMoveEnd);
  S.map.on('moveend', onMoveEnd);
  await refreshViewport();
  host.onSourceLoaded([...source.numericFields, ...source.categoricalFields]);

  if (firstLoad && S.currentGeoJSON?.features?.length) {
    firstLoad = false;
    requestAnimationFrame(() => fitToData(S.currentGeoJSON!));
  }
}

/* ----------------------------- UI: project picker ----------------------- */

let pickerEl: HTMLDivElement | null = null;

function setStatus(msg: string) {
  const el = pickerEl?.querySelector('.desktop-picker-status') as HTMLElement | null;
  if (el) el.textContent = msg;
}

function hidePicker() {
  if (pickerEl) pickerEl.style.display = 'none';
}

function showPicker() {
  if (pickerEl) pickerEl.style.display = 'flex';
}

async function loadProjectSources() {
  const repo = getRepository();
  const sources = await repo.listSources();
  const withGeom = sources.find((s) => s.hasGeometry) ?? sources[0];
  if (withGeom) {
    await activateSource(withGeom);
  } else {
    setStatus('Project opened. Import a data source to begin.');
    showImportControls();
  }
}

function showImportControls() {
  const importBtn = pickerEl?.querySelector('.desktop-import-btn') as HTMLElement | null;
  if (importBtn) importBtn.style.display = 'inline-block';
}

async function handleCreate() {
  const api = window.vizDesktop;
  if (!api) return;
  const parent = await api.pickParentDir();
  if (parent.canceled || !parent.parentDir) return;
  const name = window.prompt('New project name:', 'My Project');
  if (!name) return;
  setStatus('Creating project…');
  await api.project.create(parent.parentDir, name);
  setStatus(`Project "${name}" created. Import a data source to begin.`);
  showImportControls();
}

async function handleOpen() {
  const api = window.vizDesktop;
  if (!api) return;
  setStatus('Opening project…');
  const res = await api.project.open(undefined);
  if (res.canceled) { setStatus(''); return; }
  setStatus('Loading sources…');
  await loadProjectSources();
}

async function handleImport() {
  const api = window.vizDesktop;
  if (!api) return;
  const pick = await api.pickSourceFile();
  if (pick.canceled || !pick.sourcePath) return;
  setStatus('Importing & indexing… (this can take a moment for large files)');
  try {
    const record = await api.db.importSource({
      sourcePath: pick.sourcePath,
      parcelIdField: S.parcelIdField ?? undefined
    });
    setStatus(`Imported ${record.featureCount.toLocaleString()} features.`);
    // Refresh source list and render the new source.
    const repo = getRepository();
    const sources = await repo.listSources();
    const match = sources.find((s) => s.id === record.id) ?? sources.find((s) => s.hasGeometry);
    if (match) await activateSource(match);
  } catch (err: any) {
    console.error('[desktop] import failed:', err);
    setStatus(`Import failed: ${err?.message ?? err}`);
  }
}

function buildPicker() {
  pickerEl = document.createElement('div');
  pickerEl.className = 'desktop-picker-overlay';
  pickerEl.innerHTML = `
    <div class="desktop-picker-card">
      <h2>VIZ Desktop</h2>
      <p class="desktop-picker-sub">Open an existing project or create a new one. Each project is a folder with its own local database.</p>
      <div class="desktop-picker-actions">
        <button type="button" class="desktop-new-btn">New Project…</button>
        <button type="button" class="desktop-open-btn">Open Project…</button>
        <button type="button" class="desktop-import-btn" style="display:none;">Import Data Source…</button>
      </div>
      <p class="desktop-picker-status"></p>
    </div>`;
  // Minimal inline styling so it works without touching style.css.
  Object.assign(pickerEl.style, {
    position: 'fixed', inset: '0', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(15,23,42,0.85)', zIndex: '9999'
  } as CSSStyleDeclaration);
  const card = pickerEl.querySelector('.desktop-picker-card') as HTMLElement;
  Object.assign(card.style, {
    background: '#fff', color: '#0f172a', padding: '28px 32px', borderRadius: '12px',
    maxWidth: '460px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
  } as CSSStyleDeclaration);
  pickerEl.querySelectorAll('button').forEach((b) => {
    Object.assign((b as HTMLElement).style, {
      margin: '6px', padding: '10px 16px', border: '1px solid #cbd5e1',
      borderRadius: '8px', cursor: 'pointer', fontSize: '14px', background: '#f8fafc'
    } as CSSStyleDeclaration);
  });

  pickerEl.querySelector('.desktop-new-btn')!.addEventListener('click', () => void handleCreate());
  pickerEl.querySelector('.desktop-open-btn')!.addEventListener('click', () => void handleOpen());
  pickerEl.querySelector('.desktop-import-btn')!.addEventListener('click', () => void handleImport());
  document.body.appendChild(pickerEl);
}

/** Entry point — call once at startup when isDesktopMode(). */
export async function initDesktop(h: DesktopHost): Promise<void> {
  host = h;
  buildPicker();

  // If a project is already active (e.g. relaunch), skip straight to it.
  try {
    const current = await window.vizDesktop?.project.current();
    if (current?.projectRoot) {
      setStatus('Loading current project…');
      await loadProjectSources();
      return;
    }
  } catch { /* fall through to picker */ }

  showPicker();
}
