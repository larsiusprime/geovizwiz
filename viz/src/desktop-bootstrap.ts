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
import { createDataStore, createLayerState, registerLayer, renderDataStoreList, removeLayer, applyLayerOrderToMap, setCurrentLayer } from './layers.js';
import { addOrUpdateSourceForLayer, applyGrayRendering, scheduleUpdate, computeAndApplyAutoMultiplier } from './rendering.js';
import { buildProjectFile, deserializeLayer, applyRestoredCollections } from './metadata.js';
import type { DataStore, ProjectFileV1, SerializedDataSource } from './types.js';
import { perfLog, perfNow } from './perf.js';

/** Above this many features in view, skip the heavy geometry fetch and ask the
 *  user to zoom in. Pulling hundreds of thousands of polygons over IPC and into
 *  the renderer was the source of the pan-to-dense-area crash. */
const MAX_RENDER_FEATURES = 60000;

let projectLoaded = false;
let projectLoadedResolvers: (() => void)[] = [];

export function whenProjectLoaded(): Promise<void> {
  if (typeof window === 'undefined' || !window.vizDesktop || projectLoaded) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    projectLoadedResolvers.push(resolve);
  });
}

function markProjectLoaded() {
  projectLoaded = true;
  const resolvers = projectLoadedResolvers;
  projectLoadedResolvers = [];
  for (const r of resolvers) r();
}

export interface DesktopHost {
  /** Reveal the main app chrome (same as the browser upload flow does). */
  revealUI(): void;
  /** Populate the field dropdown + refresh stats/scatter/etc. panels. */
  onSourceLoaded(fields: string[]): void;
  /** Refresh the viewport-dependent panels after new geometry/attrs arrive
   *  (no dropdown reset — used on pan and on a lean re-fetch). */
  onViewportData?(): void;
  /** Callback when a project is loaded or restored, even if empty or Civil-only. */
  onProjectLoaded?(): void;
}

let host: DesktopHost | null = null;
/** Each desktop source is streamed by viewport into its OWN layer. */
interface StreamedLayer { sourceId: string; layerId: string; }
const streamed: StreamedLayer[] = [];
/** Source metadata (fields, table) by source id. */
const sourceById = new Map<string, SourceInfo>();
let moveTimer: number | null = null;
/** Columns last fetched per source (lean-column tracking, keyed by sourceId). */
const lastFetchedFieldsBySource = new Map<string, Set<string>>();
/** Extra columns requested by panels whose field state isn't in `S`
 *  (e.g. comp-finder criteria), via the `viz:request-fields` event. */
const extraRequestedFields = new Set<string>();
let fieldRefetchTimer: number | null = null;
/** Set when the user cancels an in-flight project load; guards the reveal step. */
let loadCancelled = false;
/** Aborts the in-flight geometry parse so cancel takes effect immediately. */
let loadAbort: AbortController | null = null;
/** True while restoring saved project state — suppresses auto-save and the
 *  stream's auto-recompute so saved color breaks survive. */
let restoring = false;
let saveTimer: number | null = null;

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

/**
 * The attribute columns a given SOURCE needs loaded on its visible features —
 * the lean-column strategy, now per-source. A source's layers contribute their
 * colorized field + normalization sizes; the panels contribute their fields
 * ONLY for the source backing the current layer (panels read the current layer's
 * data). The inspect popup is NOT here — it fetches a clicked parcel's full row
 * on demand (see main.ts). comp-finder registers criteria via `viz:request-fields`.
 */
function collectNeededFieldsForSource(sourceId: string): string[] {
  const source = sourceById.get(sourceId);
  if (!source) return [];
  const set = new Set<string>();
  const add = (f?: string | null) => { if (f) set.add(f); };

  add(source.parcelIdField);
  // Each layer backed by this source contributes the columns it renders.
  for (const layer of S.layers.values()) {
    if (layer.dataStoreId !== sourceId) continue;
    add(layer.field);
    add(layer.landSizeField);
    add(layer.bldgSizeField);
  }

  // Panel fields apply only to the source backing the CURRENT layer.
  const currentLayer = S.currentLayerId ? S.layers.get(S.currentLayerId) : null;
  if (currentLayer && currentLayer.dataStoreId === sourceId) {
    add(S.currentField);
    add(S.landSizeField);
    add(S.bldgSizeField);
    add(S.addressField);
    add(S.statsField);
    add(S.statsCategoryField);
    add(S.scatterXField);
    add(S.scatterYField);
    add(S.scatterColorByField);
    add(S.scatterCategoryField);
    const ta = S.timeAdjustmentSettings;
    add(ta?.salePriceField);
    add(ta?.saleDateField);
    add(ta?.validSaleField);
    add(ta?.vacantSaleField);
    for (const rule of S.filters ?? []) {
      add(rule.field);
      if (rule.fieldType === 'reference' && typeof rule.value === 'string') {
        const saved = S.savedFiltersStore.get(rule.value);
        for (const r of saved?.filters ?? []) add(r.field);
      }
    }
    for (const f of extraRequestedFields) add(f);
  }

  const valid = new Set<string>([...source.numericFields, ...source.categoricalFields]);
  return [...set].filter((f) => valid.has(f));
}

/** Re-stream if any source now needs columns it doesn't have loaded (debounced).
 *  Triggered by UI `change` events and `viz:request-fields`. */
function scheduleFieldRefetch(): void {
  if (streamed.length === 0) return;
  if (fieldRefetchTimer != null) window.clearTimeout(fieldRefetchTimer);
  fieldRefetchTimer = window.setTimeout(() => {
    fieldRefetchTimer = null;
    const grew = streamed.some((entry) => {
      const needed = collectNeededFieldsForSource(entry.sourceId);
      const last = lastFetchedFieldsBySource.get(entry.sourceId) ?? new Set<string>();
      return needed.some((f) => !last.has(f));
    });
    if (grew) void refreshViewport();
  }, 150);
}

/** Stream ONE source's viewport into ITS layer's map source. Current-layer-only
 *  side effects (S.currentGeoJSON, recompute, panel refresh) run only when this
 *  entry is the current layer. */
async function streamLayer(entry: StreamedLayer, signal?: AbortSignal): Promise<void> {
  const source = sourceById.get(entry.sourceId);
  const layer = S.layers.get(entry.layerId);
  if (!source || !layer || !host) return;
  const repo = getRepository();
  const fields = collectNeededFieldsForSource(entry.sourceId);
  const zoom = S.map.getZoom();
  const bbox = currentBBox();
  const isCurrent = S.currentLayerId === entry.layerId;
  const tTotal = perfNow();
  try {
    const count = await repo.countGeometryByBBox(entry.sourceId, bbox);
    if (signal?.aborted || !S.layers.has(entry.layerId)) return;
    if (count > MAX_RENDER_FEATURES) {
      // Only the current layer surfaces the zoom-in banner (avoid cross-layer noise).
      if (isCurrent) setViewportMessage(`${count.toLocaleString()} features in view — zoom in to render (limit ${MAX_RENDER_FEATURES.toLocaleString()}).`);
      return;
    }
    if (isCurrent) setViewportMessage(null);

    const fc = await repo.queryGeometryByBBox(entry.sourceId, bbox, {
      fields,
      zoom,
      simplifyTolerance: toleranceForZoom(zoom),
      limit: MAX_RENDER_FEATURES,
      signal
    });
    if (signal?.aborted || !S.layers.has(entry.layerId)) return;
    const prevFields = lastFetchedFieldsBySource.get(entry.sourceId) ?? new Set<string>();
    lastFetchedFieldsBySource.set(entry.sourceId, new Set(fields));
    layer.geojson = fc;
    // Panels (scatterplot, comp-finder) read the DATA STORE's geojson.
    const ds = S.dataStores.get(entry.sourceId);
    if (ds) ds.geojson = fc;
    addOrUpdateSourceForLayer(layer, fc);
    if (isCurrent && !restoring) {
      S.currentGeoJSON = fc;
      if (S.currentField == null) {
        applyGrayRendering();
      } else if (!prevFields.has(S.currentField)) {
        // The colorized field's data just arrived via a lean re-fetch — recompute.
        scheduleUpdate('recomputeAndAutoScale', true);
      }
      host.onViewportData?.();
    } else if (isCurrent) {
      // Restoring: keep saved breaks/colors (the restore cycle paints each layer).
      S.currentGeoJSON = fc;
    }
    perfLog('streamLayer', perfNow() - tTotal, { source: source.name, features: fc.features.length, cols: fields.length, current: isCurrent });
  } catch (err) {
    console.error('[desktop] stream failed:', err);
  }
}

/** Re-stream every active source into its own layer (current layer first).
 *  Prunes registry entries whose layer was removed. */
async function refreshViewport(signal?: AbortSignal): Promise<void> {
  if (!host || streamed.length === 0) return;
  for (let i = streamed.length - 1; i >= 0; i -= 1) {
    if (!S.layers.has(streamed[i].layerId)) streamed.splice(i, 1);
  }
  const ordered = [...streamed].sort(
    (a, b) => Number(b.layerId === S.currentLayerId) - Number(a.layerId === S.currentLayerId)
  );
  for (const entry of ordered) {
    if (signal?.aborted) return;
    await streamLayer(entry, signal); // sequential — single DB connection
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

/** Build + register a synthetic desktop data store for a DB source (geometry
 *  comes from the DB; a synthetic File satisfies the datastore factory). */
function registerDesktopDataStore(source: SourceInfo): DataStore {
  sourceById.set(source.id, source);
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
  return ds;
}

/** Build + register a synthetic desktop data store for a Civil OS source. */
function registerCivilDataStore(m: SerializedDataSource): DataStore {
  const storeId = m.id;
  const newStore: DataStore = {
    id: storeId,
    name: m.name || `Civil OS: ${m.civilGateway}`,
    file: null,
    asyncBuffer: null,
    geojson: { type: 'FeatureCollection', features: [] },
    numericFieldsFromSchema: [],
    categoricalFieldsFromSchema: [],
    chosenNumericFields: [],
    chosenCategoricalFields: [],
    landSizeField: null,
    landSizeUnitLabel: null,
    bldgSizeField: null,
    bldgSizeUnitLabel: null,
    salePriceField: null,
    saleDateField: null,
    validSaleField: null,
    vacantSaleField: null,
    parcelIdField: null,
    addressField: null,
    bldgQualityField: null,
    bldgConditionField: null,
    bldgAgeField: null,
    bldgEffAgeField: null,
    bldgBedsField: null,
    bldgBathsField: null,
    bldgTypeField: null,
    landTypeField: null,
    landZoningField: null,
    saleIdField: null,
    fullMarketValueField: null,
    assessedValueField: null,
    landValueField: null,
    improvementValueField: null,
    isCivil: true,
    civilGateway: m.civilGateway,
    civilAuthIssuer: m.civilAuthIssuer,
    civilToken: m.civilToken,
    civilOIDCConfig: m.civilOIDCConfig,
    civilTileJson: m.civilTileJson
  };
  S.dataStores.set(storeId, newStore);
  if (!S.dataStoreOrder.includes(storeId)) S.dataStoreOrder.push(storeId);
  S.currentDataStoreId = storeId;
  renderDataStoreList();
  return newStore;
}

/** Copy serialized semantic-field classification onto a data store (restore). */
function applySerializedClassification(ds: DataStore, m: SerializedDataSource) {
  ds.landSizeField = m.landSizeField; ds.landSizeUnitLabel = m.landSizeUnitLabel;
  ds.bldgSizeField = m.bldgSizeField; ds.bldgSizeUnitLabel = m.bldgSizeUnitLabel;
  ds.salePriceField = m.salePriceField ?? null;
  ds.saleDateField = m.saleDateField ?? null;
  ds.validSaleField = m.validSaleField ?? null;
  ds.vacantSaleField = m.vacantSaleField ?? null;
  ds.parcelIdField = m.parcelIdField ?? ds.parcelIdField;
  ds.addressField = m.addressField ?? null;
  ds.bldgQualityField = m.bldgQualityField ?? null;
  ds.bldgConditionField = m.bldgConditionField ?? null;
  ds.bldgAgeField = m.bldgAgeField ?? null;
  ds.bldgEffAgeField = m.bldgEffAgeField ?? null;
  ds.bldgBedsField = m.bldgBedsField ?? null;
  ds.bldgBathsField = m.bldgBathsField ?? null;
  ds.bldgTypeField = m.bldgTypeField ?? null;
  ds.landTypeField = m.landTypeField ?? null;
  ds.landZoningField = m.landZoningField ?? null;
  ds.saleIdField = m.saleIdField ?? null;
  ds.fullMarketValueField = m.fullMarketValueField ?? null;
  ds.assessedValueField = m.assessedValueField ?? null;
  ds.landValueField = m.landValueField ?? null;
  ds.improvementValueField = m.improvementValueField ?? null;
}

/** Debounced auto-save of the full app state into viz-project.json. Suppressed
 *  while restoring or when no project is loaded. */
function scheduleDesktopSave() {
  if (restoring || !projectLoaded) return;
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    try {
      void window.vizDesktop?.project.saveAppState(buildProjectFile()).catch(() => { /* ignore */ });
    } catch (err) {
      console.error('[desktop] auto-save failed:', err);
    }
  }, 1500);
}

/** Rebuild the project to its saved state: data stores + layers + per-layer
 *  settings + saved filters/selections/land-schedule. Returns false when there's
 *  nothing restorable (caller falls back to activating the primary source). */
async function restoreProjectAppState(app: ProjectFileV1): Promise<boolean> {
  const dbSources = await getRepository().listSources();
  if (loadCancelled) return false;
  const byId = new Map(dbSources.map((s) => [s.id, s]));
  const byName = new Map(dbSources.map((s) => [s.name, s]));

  const sourceForStore = new Map<string, any>(); // serialized dataStoreId → live source or serialized civil meta
  for (const dsMeta of app.dataSources ?? []) {
    if (dsMeta.isCivil) {
      sourceForStore.set(dsMeta.id, dsMeta);
    } else {
      const src = byId.get(dsMeta.id) ?? byName.get(dsMeta.name);
      if (src) sourceForStore.set(dsMeta.id, src);
    }
  }
  const layersToRestore = (app.layers ?? []).filter((l) => sourceForStore.has(l.dataStoreId));
  const hasCivil = (app.dataSources ?? []).some(ds => ds.isCivil);
  if (layersToRestore.length === 0 && !hasCivil) return false;

  restoring = true;
  try {
    applyRestoredCollections(app);

    // One data store per resolved source.
    const storeReady = new Set<string>();
    for (const dsMeta of app.dataSources ?? []) {
      const src = sourceForStore.get(dsMeta.id);
      if (!src || storeReady.has(dsMeta.id)) continue;
      storeReady.add(dsMeta.id);
      if (dsMeta.isCivil) {
        applySerializedClassification(registerCivilDataStore(dsMeta), dsMeta);
      } else {
        applySerializedClassification(registerDesktopDataStore(src), dsMeta);
      }
    }

    // Layers (saved order) bound to their source's store, with saved settings.
    for (const sl of layersToRestore) {
      const src = sourceForStore.get(sl.dataStoreId)!;
      const isCivil = src.isCivil;
      const storeId = isCivil ? src.id : src.id;
      const store = S.dataStores.get(storeId);
      const layer = createLayerState(sl.name, storeId);
      Object.assign(layer, deserializeLayer(sl), {
        id: layer.id,
        dataStoreId: storeId,
        sourceId: layer.sourceId,
        layerId: layer.layerId,
        errorLayerId: layer.errorLayerId,
        geojson: null,
        stats: null,
      });
      // Chosen fields + size classification live on the data store, NOT the
      // serialized layer — copy them so the field picker + normalization work
      // (otherwise the restored layer shows "No fields selected" and stays gray).
      if (store) {
        layer.chosenNumericFields = [...store.chosenNumericFields];
        layer.chosenCategoricalFields = [...store.chosenCategoricalFields];
        layer.landSizeField = store.landSizeField;
        layer.landSizeUnitLabel = store.landSizeUnitLabel;
        layer.bldgSizeField = store.bldgSizeField;
        layer.bldgSizeUnitLabel = store.bldgSizeUnitLabel;
      }
      registerLayer(layer);
      if (isCivil) {
        addOrUpdateSourceForLayer(layer, null as any);
      } else {
        streamed.push({ sourceId: storeId, layerId: layer.id });
      }
    }
    if (streamed.length === 0 && !app.dataSources?.some(ds => ds.isCivil)) return false;

    if (streamed.length > 0) {
      const primary = sourceById.get(streamed[0].sourceId)!;
      const extent = await getRepository().getSourceExtent(primary.id).catch(() => null);
      if (loadCancelled) return false;
      if (extent) S.map.fitBounds([[extent.minLng, extent.minLat], [extent.maxLng, extent.maxLat]], { padding: 40, duration: 0 });

      // Stream every layer's data (restoring ⇒ streamLayer skips auto-recompute).
      await refreshViewport(loadAbort?.signal);
      if (loadCancelled) return false;

      // Paint each layer by briefly making it current. For layers with a field,
      // recompute color breaks against the streamed data (the same path a field
      // change uses) so coloring is correct — cached breaks alone can render gray.
      S.currentLayerId = '';
      for (const e of [...streamed]) {
        setCurrentLayer(e.layerId);
        const lyr = S.layers.get(e.layerId);
        if (lyr?.field && S.currentGeoJSON?.features?.length) {
          computeAndApplyAutoMultiplier('auto');
        }
      }
      setCurrentLayer(streamed[0].layerId);
      applyLayerOrderToMap();

      host?.revealUI();
      hidePicker();
      S.map.off('moveend', onMoveEnd);
      S.map.on('moveend', onMoveEnd);
      host?.onSourceLoaded([...primary.numericFields, ...primary.categoricalFields]);
    } else {
      // Civil-only project
      const civilLayers = (app.layers ?? []).filter(l => {
        const ds = app.dataSources?.find(d => d.id === l.dataStoreId);
        return ds?.isCivil;
      });
      if (civilLayers.length > 0) {
        setCurrentLayer(civilLayers[0].id);
      }
      applyLayerOrderToMap();
      host?.revealUI();
      hidePicker();
    }
    return true;
  } finally {
    restoring = false;
  }
}

/** Register a source as a streamed layer and do its first viewport load.
 *  `fit` centers the map on the source's extent (primary source / restore);
 *  `reveal` ends the project picker (initial load only). The new layer becomes
 *  the current layer. Returns the created layer id. */
async function addStreamedSource(
  source: SourceInfo,
  opts: { fit: boolean; reveal: boolean }
): Promise<string | null> {
  if (!host) return null;
  registerDesktopDataStore(source);

  const layer = createLayerState(source.name, source.id);
  layer.chosenNumericFields = [...source.numericFields];
  layer.chosenCategoricalFields = [...source.categoricalFields];
  registerLayer(layer); // becomes the current layer
  S.currentLayerId = layer.id;
  streamed.push({ sourceId: source.id, layerId: layer.id });

  // Mirror loadSelectedColumns' state setup for the new current layer.
  S.chosenNumericFields = [...source.numericFields];
  S.chosenCategoricalFields = [...source.categoricalFields];
  S.currentField = null;
  S.currentFieldType = null;
  S.parcelPatchMap = new Map();

  setLoadingMessage('Loading geometry…');

  if (opts.fit) {
    const extent = await getRepository().getSourceExtent(source.id).catch(() => null);
    if (loadCancelled) return null;
    if (extent) {
      S.map.fitBounds(
        [[extent.minLng, extent.minLat], [extent.maxLng, extent.maxLat]],
        { padding: 40, duration: 0 }
      );
    }
  }

  await streamLayer({ sourceId: source.id, layerId: layer.id }, loadAbort?.signal);
  if (loadCancelled) return null;

  if (opts.reveal) {
    host.revealUI();
    hidePicker();
  }
  // (Re)install the streamer (idempotent) after the explicit first load.
  S.map.off('moveend', onMoveEnd);
  S.map.on('moveend', onMoveEnd);
  host.onSourceLoaded([...source.numericFields, ...source.categoricalFields]);
  scheduleDesktopSave(); // persist the new layer/source
  return layer.id;
}

/** Desktop "Add layer": import a new file into the project DB and stream it as
 *  an additional layer (does NOT replace existing layers or move the camera). */
export async function addDesktopLayerFromFile(): Promise<void> {
  const api = window.vizDesktop;
  if (!api) return;
  const pick = await api.pickSourceFile();
  if (pick.canceled || !pick.sourcePath) return;
  showLoadingView('Importing & indexing… (this can take a moment for large files)', /* cancellable */ false);
  try {
    const record = await api.db.importSource({ sourcePath: pick.sourcePath });
    const sources = await getRepository().listSources();
    const match = sources.find((s) => s.id === record.id);
    hidePicker();
    if (match) await addStreamedSource(match, { fit: false, reveal: false });
  } catch (err: any) {
    console.error('[desktop] add layer failed:', err);
    hidePicker();
    window.alert(`Add layer failed: ${err?.message ?? err}`);
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

/** Show the initial chooser (New / Open + recent projects). */
function showChooserView() {
  setPickerView('chooser');
  setStatus('');
  void renderRecents();
}

/** Populate the chooser's recent-projects list. Clicking an entry opens it,
 *  exactly as if the user browsed to and selected that folder. */
async function renderRecents() {
  const container = pickerEl?.querySelector('.desktop-recents') as HTMLElement | null;
  if (!container) return;
  let recents: { path: string; name: string; lastOpenedAt: string }[] = [];
  try {
    recents = (await window.vizDesktop?.project.recent()) ?? [];
  } catch {
    recents = [];
  }
  container.replaceChildren();
  if (!recents.length) return;

  const title = document.createElement('div');
  title.className = 'desktop-recents-title';
  title.textContent = 'Recent projects';
  container.appendChild(title);

  for (const r of recents) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'desktop-recent-item';
    const name = document.createElement('span');
    name.className = 'desktop-recent-name';
    name.textContent = r.name;
    const pathEl = document.createElement('span');
    pathEl.className = 'desktop-recent-path';
    pathEl.textContent = r.path;
    btn.append(name, pathEl);
    btn.title = `${r.path}\nLast opened ${new Date(r.lastOpenedAt).toLocaleString()}`;
    btn.addEventListener('click', () => void openProjectPath(r.path));
    container.appendChild(btn);
  }
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
 *  synchronously so cancel is instant; clearing the registry also makes any
 *  in-flight `streamLayer` bail (its layer is gone) when it resolves. */
function teardownActiveProject() {
  projectLoaded = false;
  projectLoadedResolvers = [];
  S.map.off('moveend', onMoveEnd);
  if (moveTimer != null) { window.clearTimeout(moveTimer); moveTimer = null; }
  setViewportMessage(null);
  const layerIds = streamed.map((e) => e.layerId);
  streamed.length = 0;
  sourceById.clear();
  lastFetchedFieldsBySource.clear();
  for (const id of layerIds) {
    if (S.layers.has(id)) { try { removeLayer(id); } catch { /* ignore */ } }
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

  // Restore the saved project state (layers + settings) if present.
  try {
    const current = await window.vizDesktop?.project.current();
    if (loadCancelled) return;
    const app = current?.meta?.app as ProjectFileV1 | null | undefined;
    const hasCivil = app?.dataSources?.some(ds => ds.isCivil);
    if (app && ((Array.isArray(app.layers) && app.layers.length > 0) || hasCivil)) {
      const ok = await restoreProjectAppState(app);
      if (loadCancelled) return;
      if (ok) {
        markProjectLoaded();
        host?.onProjectLoaded?.();
        return;
      }
    }
  } catch (err) {
    console.error('[desktop] restore failed, falling back:', err);
    if (loadCancelled) return;
  }

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
  const hasCivilSource = Array.from(S.dataStores.values()).some(ds => ds.isCivil);
  if (hasCivilSource) {
    hidePicker();
    host?.revealUI();
    markProjectLoaded();
    host?.onProjectLoaded?.();
    return;
  }
  const withGeom = sources.find((s) => s.hasGeometry) ?? sources[0];
  if (withGeom) {
    await addStreamedSource(withGeom, { fit: true, reveal: true });
    markProjectLoaded();
    host?.onProjectLoaded?.();
  } else {
    // Empty project: hand off to the dedicated project-init view.
    const current = await window.vizDesktop?.project.current();
    if (loadCancelled) return;
    showProjectView(current?.meta?.name ?? 'Untitled project');
    markProjectLoaded();
    host?.onProjectLoaded?.();
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
  // No path → the IPC layer shows the OS folder dialog.
  await openProjectPath(undefined);
}

/** Open a project by path (a recent-projects click) or via the OS folder dialog
 *  (path undefined). Both routes converge on the same load + loading view. */
async function openProjectPath(projectRoot?: string) {
  const api = window.vizDesktop;
  if (!api) return;
  try {
    const res = await api.project.open(projectRoot);
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
      await addStreamedSource(match, { fit: true, reveal: true });
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
        <div class="desktop-recents"></div>
      </div>
      <div class="desktop-view-project" style="display:none;">
        <h2 class="desktop-project-name">Project</h2>
        <p class="desktop-picker-sub">This project has no data yet. Import a data source to begin.</p>
        <div class="desktop-picker-actions">
          <button type="button" class="desktop-import-btn">Import Data Source…</button>
          <button type="button" class="desktop-civil-btn">New Civil OS Data Source…</button>
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
  // Set zIndex to 2995 so it covers the toolbar (2990) and submenus (2991),
  // but sits below global overlays and modal dialogs (3000).
  Object.assign(pickerEl.style, {
    position: 'fixed', inset: '0', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(15,23,42,0.85)', zIndex: '2995'
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
  pickerEl.querySelector('.desktop-civil-btn')!.addEventListener('click', () => {
    const btnNew = document.getElementById('btnNewCivilOSDataSource');
    if (btnNew) btnNew.click();
  });
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
  (window as any).hideDesktopPicker = hidePicker;
  // The File menu is the native OS application menu (built in the main process);
  // its clicks arrive here over IPC.
  window.vizDesktop?.onMenuAction?.(handleMenuAction);

  // Lean-column re-fetch triggers: any UI field <select>/<input> change, and an
  // explicit `viz:request-fields` event (carrying optional extra columns, e.g.
  // comp-finder criteria). Both no-op unless the needed set actually grew.
  document.addEventListener('change', () => { scheduleFieldRefetch(); scheduleDesktopSave(); });
  window.addEventListener('viz:request-fields', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (Array.isArray(detail)) {
      for (const f of detail) if (typeof f === 'string' && f) extraRequestedFields.add(f);
    }
    scheduleFieldRefetch();
    scheduleDesktopSave();
  });
  // App-state changes (layer switch / removal, etc.) → debounced auto-save.
  window.addEventListener('viz:state-changed', () => scheduleDesktopSave());

  // A layer added over an already-streamed source (Add layer → existing source):
  // register it so the viewport streamer keeps it fresh.
  window.addEventListener('viz:layer-added', (e: Event) => {
    const detail = (e as CustomEvent).detail as { sourceId?: string; layerId?: string } | undefined;
    if (!detail?.sourceId || !detail.layerId) return;
    if (!sourceById.has(detail.sourceId)) return; // not a streamed desktop source
    if (streamed.some((s) => s.layerId === detail.layerId)) return;
    streamed.push({ sourceId: detail.sourceId, layerId: detail.layerId });
    void streamLayer({ sourceId: detail.sourceId, layerId: detail.layerId });
  });

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
