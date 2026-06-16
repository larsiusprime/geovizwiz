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
import { createDataStore, createLayerState, registerLayer, renderDataStoreList, removeLayer } from './layers.js';
import { addOrUpdateSource, applyGrayRendering } from './rendering.js';
import { buildProjectFile } from './metadata.js';

/** Above this many features in view, skip the heavy geometry fetch and ask the
 *  user to zoom in. Pulling hundreds of thousands of polygons over IPC and into
 *  the renderer was the source of the pan-to-dense-area crash. */
const MAX_RENDER_FEATURES = 60000;

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
/** Set when the user cancels an in-flight project load; guards the reveal step. */
let loadCancelled = false;
/** Aborts the in-flight geometry parse so cancel takes effect immediately. */
let loadAbort: AbortController | null = null;

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
async function refreshViewport(signal?: AbortSignal): Promise<void> {
  if (!activeSource || !host) return;
  const src = activeSource;
  const repo = getRepository();
  const fields = [...src.numericFields, ...src.categoricalFields];
  const zoom = S.map.getZoom();
  const bbox = currentBBox();
  try {
    // Cheap count first (R-tree accelerated). Bail before pulling a crushing
    // number of polygons into the renderer.
    const count = await repo.countGeometryByBBox(src.id, bbox);
    if (activeSource !== src || signal?.aborted) return; // switched / cancelled
    if (count > MAX_RENDER_FEATURES) {
      setViewportMessage(`${count.toLocaleString()} features in view — zoom in to render (limit ${MAX_RENDER_FEATURES.toLocaleString()}).`);
      return;
    }
    setViewportMessage(null);

    const fc = await repo.queryGeometryByBBox(src.id, bbox, {
      fields,
      zoom,
      simplifyTolerance: toleranceForZoom(zoom),
      limit: MAX_RENDER_FEATURES,
      signal
    });
    if (activeSource !== src || signal?.aborted) return; // switched / cancelled
    S.currentGeoJSON = fc;
    const layer = activeLayerId ? S.layers.get(activeLayerId) : null;
    if (layer) layer.geojson = fc;
    addOrUpdateSource(fc);
    if (S.currentField == null) applyGrayRendering();
  } catch (err) {
    console.error('[desktop] viewport query failed:', err);
  }
}

/* A small bottom-center banner for viewport-level notices (e.g. "zoom in"). */
let viewportMsgEl: HTMLDivElement | null = null;
function setViewportMessage(msg: string | null) {
  if (!msg) {
    if (viewportMsgEl) viewportMsgEl.style.display = 'none';
    return;
  }
  if (!viewportMsgEl) {
    viewportMsgEl = document.createElement('div');
    Object.assign(viewportMsgEl.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(15,23,42,0.9)', color: '#fff', padding: '8px 14px',
      borderRadius: '999px', fontSize: '13px', zIndex: '9998', pointerEvents: 'none',
      boxShadow: '0 4px 14px rgba(0,0,0,0.3)'
    } as CSSStyleDeclaration);
    document.body.appendChild(viewportMsgEl);
  }
  viewportMsgEl.textContent = msg;
  viewportMsgEl.style.display = 'block';
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

  // Keep the loading view up until the first geometry is actually rendered, so
  // the picker doesn't flash the app chrome over a blank map mid-load.
  setLoadingMessage('Loading geometry…');

  // First activation: jump to the data's full extent BEFORE streaming. The map
  // boots at a default location (Houston); a bbox query there returns nothing,
  // so without this the data never appears and the camera never centers.
  if (firstLoad) {
    firstLoad = false;
    const extent = await getRepository().getSourceExtent(source.id).catch(() => null);
    if (loadCancelled) return;
    if (extent) {
      S.map.fitBounds(
        [[extent.minLng, extent.minLat], [extent.maxLng, extent.maxLat]],
        { padding: 40, duration: 0 }
      );
    }
  }

  // Stream the (now correctly-positioned) viewport before revealing. The signal
  // lets Cancel abort the (potentially large) parse mid-flight.
  await refreshViewport(loadAbort?.signal);
  if (loadCancelled) return; // cancelled mid-load; stay on the chooser

  host.revealUI();
  hidePicker();
  // Install the streamer after the explicit first load so it doesn't race a
  // moveend-triggered one.
  S.map.off('moveend', onMoveEnd);
  S.map.on('moveend', onMoveEnd);
  host.onSourceLoaded([...source.numericFields, ...source.categoricalFields]);
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

type PickerView = 'chooser' | 'project' | 'loading';

/** Show exactly one of the picker's views and hide the others. */
function setPickerView(view: PickerView) {
  showPicker();
  const map: Record<PickerView, string> = {
    chooser: '.desktop-view-chooser',
    project: '.desktop-view-project',
    loading: '.desktop-view-loading',
  };
  (Object.keys(map) as PickerView[]).forEach((v) => {
    const el = pickerEl?.querySelector(map[v]) as HTMLElement | null;
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
}

/** Show the initial chooser (New / Open). */
function showChooserView() {
  setPickerView('chooser');
  setStatus('');
}

/** Show the dedicated per-project view (import a source, or go back). */
function showProjectView(name: string) {
  setPickerView('project');
  const nameEl = pickerEl?.querySelector('.desktop-project-name') as HTMLElement | null;
  if (nameEl) nameEl.textContent = name;
  setStatus('');
}

/** Show the dedicated loading view (spinner + message [+ progress] [+ cancel]). */
function showLoadingView(message: string, cancellable: boolean) {
  loadCancelled = false;
  loadAbort = new AbortController();
  setPickerView('loading');
  setLoadingMessage(message);
  setLoadingProgress(null); // spinner-only until a real fraction is known
  const cancelBtn = pickerEl?.querySelector('.desktop-cancel-btn') as HTMLElement | null;
  if (cancelBtn) cancelBtn.style.display = cancellable ? 'inline-block' : 'none';
  setStatus('');
}

function setLoadingMessage(message: string) {
  const el = pickerEl?.querySelector('.desktop-loading-msg') as HTMLElement | null;
  if (el) el.textContent = message;
}

/** Determinate progress in [0,1], or null for indeterminate (spinner only).
 *  Per AGENTS.md, show this whenever a meaningful fraction is available. */
function setLoadingProgress(fraction: number | null) {
  const wrap = pickerEl?.querySelector('.desktop-progress') as HTMLElement | null;
  const bar = pickerEl?.querySelector('.desktop-progress-bar') as HTMLElement | null;
  if (!wrap || !bar) return;
  if (fraction == null) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

/** Drop any partially-initialized render state from an in-flight load. Runs
 *  synchronously so cancel is instant; nulling `activeSource` also makes any
 *  in-flight `refreshViewport` bail at its identity guard when it resolves. */
function teardownActiveProject() {
  S.map.off('moveend', onMoveEnd);
  if (moveTimer != null) { window.clearTimeout(moveTimer); moveTimer = null; }
  setViewportMessage(null);
  const layerId = activeLayerId;
  activeSource = null;
  activeLayerId = null;
  firstLoad = true;
  if (layerId && S.layers.has(layerId)) {
    try { removeLayer(layerId); } catch { /* ignore */ }
  }
  S.dataStores.clear();
  S.dataStoreOrder.length = 0;
  S.currentDataStoreId = null;
  S.currentLayerId = null;
  S.currentGeoJSON = null;
}

/** Cancel an in-flight load. Gives immediate "Cancelling…" feedback, aborts the
 *  in-flight parse, then (after the acknowledgment paints) tears down and
 *  returns to the chooser. The in-flight async also bails via `loadCancelled` /
 *  the `refreshViewport` identity guard; the DB is dropped in the background so
 *  the UI never blocks behind the running query. */
function handleCancelLoad() {
  if (loadCancelled) return;   // ignore repeat clicks
  loadCancelled = true;
  loadAbort?.abort();          // stop the in-flight parse at its next chunk

  // Instant acknowledgment: flip the loading view to a cancelling state.
  setLoadingMessage('Cancelling…');
  const cancelBtn = pickerEl?.querySelector('.desktop-cancel-btn') as HTMLElement | null;
  if (cancelBtn) cancelBtn.style.display = 'none';

  // Let "Cancelling…" actually paint (two frames) before swapping to the
  // chooser, so the click clearly registers even though the rest is async.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    teardownActiveProject();
    showChooserView();
    void window.vizDesktop?.project.close().catch(() => { /* ignore */ });
  }));
}

async function loadProjectSources() {
  showLoadingView('Loading project…', /* cancellable */ true);
  const repo = getRepository();
  let sources;
  try {
    sources = await repo.listSources();
  } catch (err: any) {
    if (loadCancelled) return;
    console.error('[desktop] failed to list sources:', err);
    showChooserView();
    setStatus(`Failed to load project: ${err?.message ?? err}`);
    return;
  }
  if (loadCancelled) return;
  const withGeom = sources.find((s) => s.hasGeometry) ?? sources[0];
  if (withGeom) {
    await activateSource(withGeom);
  } else {
    // Empty project: hand off to the dedicated project-init view.
    const current = await window.vizDesktop?.project.current();
    if (loadCancelled) return;
    showProjectView(current?.meta?.name ?? 'Untitled project');
  }
}

async function handleCreate() {
  const api = window.vizDesktop;
  if (!api) return;
  const picked = await api.pickProjectDir();
  if (picked.canceled || !picked.projectRoot) return;
  showLoadingView('Creating project…', /* cancellable */ false);
  try {
    await api.project.create(picked.projectRoot);
    // The picked folder IS the project now; load it (a fresh project has no
    // sources, so loadProjectSources lands on the import view).
    await loadProjectSources();
  } catch (err: any) {
    console.error('[desktop] create failed:', err);
    showChooserView();
    setStatus(`Create failed: ${err?.message ?? err}`);
  }
}

async function handleOpen() {
  const api = window.vizDesktop;
  if (!api) return;
  try {
    const res = await api.project.open(undefined); // OS dialog (modal)
    if (res.canceled) return;
    await loadProjectSources();
  } catch (err: any) {
    console.error('[desktop] open failed:', err);
    showChooserView();
    setStatus(`Open failed: ${err?.message ?? err}`);
  }
}

async function handleImport() {
  const api = window.vizDesktop;
  if (!api) return;
  const pick = await api.pickSourceFile();
  if (pick.canceled || !pick.sourcePath) return;
  // DB write can't be safely aborted mid-flight, so this load is not cancellable.
  showLoadingView('Importing & indexing… (this can take a moment for large files)', /* cancellable */ false);
  try {
    const record = await api.db.importSource({
      sourcePath: pick.sourcePath,
      parcelIdField: S.parcelIdField ?? undefined
    });
    const repo = getRepository();
    const sources = await repo.listSources();
    const match = sources.find((s) => s.id === record.id) ?? sources.find((s) => s.hasGeometry);
    if (match) {
      await activateSource(match);
    } else {
      const current = await api.project.current().catch(() => null);
      showProjectView(current?.meta?.name ?? 'Untitled project');
    }
  } catch (err: any) {
    console.error('[desktop] import failed:', err);
    const current = await api.project.current().catch(() => null);
    showProjectView(current?.meta?.name ?? 'Untitled project');
    setStatus(`Import failed: ${err?.message ?? err}`);
  }
}

function buildPicker() {
  pickerEl = document.createElement('div');
  pickerEl.className = 'desktop-picker-overlay';
  pickerEl.innerHTML = `
    <div class="desktop-picker-card">
      <div class="desktop-view-chooser">
        <h2>VIZ Desktop</h2>
        <p class="desktop-picker-sub">Open an existing project or create a new one. Each project is a folder with its own local database.</p>
        <div class="desktop-picker-actions">
          <button type="button" class="desktop-new-btn">New Project…</button>
          <button type="button" class="desktop-open-btn">Open Project…</button>
        </div>
      </div>
      <div class="desktop-view-project" style="display:none;">
        <h2 class="desktop-project-name">Project</h2>
        <p class="desktop-picker-sub">This project has no data yet. Import a data source to begin.</p>
        <div class="desktop-picker-actions">
          <button type="button" class="desktop-import-btn">Import Data Source…</button>
        </div>
        <button type="button" class="desktop-back-btn">← Back to projects</button>
      </div>
      <div class="desktop-view-loading" style="display:none;">
        <div class="desktop-spinner" aria-hidden="true"></div>
        <p class="desktop-loading-msg" role="status" aria-live="polite">Loading…</p>
        <div class="desktop-progress" style="display:none;"><div class="desktop-progress-bar"></div></div>
        <button type="button" class="desktop-cancel-btn">Cancel</button>
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

  // The Back button visually de-emphasized (it's a secondary action).
  const backBtn = pickerEl.querySelector('.desktop-back-btn') as HTMLElement | null;
  if (backBtn) {
    Object.assign(backBtn.style, {
      background: 'transparent', border: 'none', color: '#475569',
      marginTop: '6px', fontSize: '13px'
    } as CSSStyleDeclaration);
  }

  pickerEl.querySelector('.desktop-new-btn')!.addEventListener('click', () => void handleCreate());
  pickerEl.querySelector('.desktop-open-btn')!.addEventListener('click', () => void handleOpen());
  pickerEl.querySelector('.desktop-import-btn')!.addEventListener('click', () => void handleImport());
  pickerEl.querySelector('.desktop-back-btn')!.addEventListener('click', () => showChooserView());
  pickerEl.querySelector('.desktop-cancel-btn')!.addEventListener('click', () => handleCancelLoad());
  document.body.appendChild(pickerEl);
}

/* --------------------------- Program menu (File) ------------------------- */

/** Brief auto-dismissing toast (e.g. "Project saved"), below the menu bar. */
let flashEl: HTMLDivElement | null = null;
let flashTimer: number | null = null;
function flashToast(msg: string): void {
  if (!flashEl) {
    flashEl = document.createElement('div');
    Object.assign(flashEl.style, {
      position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(15,23,42,0.92)', color: '#fff', padding: '8px 14px',
      borderRadius: '8px', fontSize: '13px', zIndex: '9998', pointerEvents: 'none',
      boxShadow: '0 4px 14px rgba(0,0,0,0.3)', transition: 'opacity 0.2s', opacity: '0'
    } as CSSStyleDeclaration);
    document.body.appendChild(flashEl);
  }
  flashEl.textContent = msg;
  flashEl.style.opacity = '1';
  if (flashTimer != null) window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { if (flashEl) flashEl.style.opacity = '0'; }, 1600);
}

/** Switching/closing a project resets a lot of global app state; a renderer
 *  reload is the clean, reliable way to get a fresh slate. The main process
 *  keeps the active-project pointer, so initDesktop re-enters the right state. */
function handleMenuAction(action: string): void {
  switch (action) {
    case 'open': void handleMenuOpen(); break;
    case 'new': void handleMenuNew(); break;
    case 'close': void handleMenuClose(); break;
    case 'save': void handleMenuSave(); break;
  }
}

/** Open — pick an existing project; on a valid choice, switch to it. */
async function handleMenuOpen(): Promise<void> {
  const api = window.vizDesktop;
  if (!api) return;
  try {
    const res = await api.project.open(undefined); // OS dialog; main swaps active project + DB
    if (res.canceled) return;                       // cancel/invalid → keep current project
    location.reload();                              // fresh slate; initDesktop loads the chosen project
  } catch (err: any) {
    console.error('[desktop] menu open failed:', err);
    window.alert(`Open failed: ${err?.message ?? err}`);
  }
}

/** New — pick/create a folder; on a valid choice, switch to the new project. */
async function handleMenuNew(): Promise<void> {
  const api = window.vizDesktop;
  if (!api) return;
  try {
    const picked = await api.pickProjectDir();
    if (picked.canceled || !picked.projectRoot) return;
    await api.project.create(picked.projectRoot);   // main swaps active project + DB
    location.reload();                              // fresh slate; initDesktop shows the new (empty) project
  } catch (err: any) {
    console.error('[desktop] menu new failed:', err);
    window.alert(`Create failed: ${err?.message ?? err}`);
  }
}

/** Close — close the active project and return to the opening (null) state. */
async function handleMenuClose(): Promise<void> {
  const api = window.vizDesktop;
  if (!api) return;
  try {
    await api.project.close(); // clears active project + closes its DB in main
  } catch (err) {
    console.error('[desktop] menu close failed:', err);
  }
  location.reload();           // initDesktop finds no current project → chooser
}

/** Save — persist the current app state into the project's viz-project.json. */
async function handleMenuSave(): Promise<void> {
  const api = window.vizDesktop;
  if (!api) return;
  try {
    const snapshot = buildProjectFile();
    await api.project.saveAppState(snapshot);
    flashToast('Project saved');
  } catch (err: any) {
    console.error('[desktop] menu save failed:', err);
    window.alert(`Save failed: ${err?.message ?? err}`);
  }
}

/** Entry point — call once at startup when isDesktopMode(). */
export async function initDesktop(h: DesktopHost): Promise<void> {
  host = h;
  // The File menu is the native OS application menu (built in the main process);
  // its clicks arrive here over IPC.
  window.vizDesktop?.onMenuAction?.(handleMenuAction);
  buildPicker();

  // If a project is already active (e.g. relaunch), skip straight to it.
  try {
    const current = await window.vizDesktop?.project.current();
    if (current?.projectRoot) {
      await loadProjectSources(); // shows its own loading view
      return;
    }
  } catch { /* fall through to chooser */ }

  showChooserView();
}
