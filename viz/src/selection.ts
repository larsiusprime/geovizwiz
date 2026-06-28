/**
 * Selection-related functions extracted from main.ts.
 * All modules import `S` to read/write state.
 */
import maplibregl from 'maplibre-gl';
import { S } from './state';
import type { DataStore } from './types';
import { getSelectionFilterActiveCount, matchesSelectionFilters } from './filters';
import { createSaveLoadWidget, type SaveLoadWidgetHandle } from './save-load-widget';
import { showConfirm } from './modals';
import { FILTER_ICON, PIN_ICON_TILTED, RESIZE_ICON } from './icons';
import { featureIntersectsBbox, featureIntersectsPolygon, calculatePolygonBbox } from './selection-geometry';
import { normalizedValue } from './rendering-helpers';

/* ------------------------------------------------------------------ */
/*  Cross-module deps + callback seams                                 */
/* ------------------------------------------------------------------ */

// Direct imports (formerly callback seams). windows imports only state/dom-refs,
// so these are cycle-free; aliased to the _names to leave call sites untouched.
import { makeDraggable as _makeDraggable, ensureFloatingWindowVisible as _ensureFloatingWindowVisible } from './windows';

// Pure DOM nudge (formerly injected from main); selection owns it directly now.
const _refreshSelectionControlsDockLayout = () => window.dispatchEvent(new Event('resize'));

let _getCurrentSourceId: () => string | null = () => null;
let _updateCursor: () => void = () => {};
let _updateStatisticsResults: () => void = () => {};
let _scheduleScatterPlotRefresh: () => void = () => {};
let _updateHighlightColors: () => void = () => {};
let _persistCurrentLayerState: () => void = () => {};
let _registerSelectionControlsDocking: (panel: HTMLDivElement, pinButton: HTMLButtonElement) => void = () => {};
let _openSelectionConditionsFilters: () => void = () => {};
let _selectionSaveLoadWidget: SaveLoadWidgetHandle | null = null;
let _selectionSaveLoadStatus: HTMLDivElement | null = null;
let _selectionKeySelect: HTMLSelectElement | null = null;


export interface SelectionCallbacks {
  getCurrentSourceId: () => string | null;
  updateCursor: () => void;
  updateStatisticsResults: () => void;
  scheduleScatterPlotRefresh: () => void;
  updateHighlightColors: () => void;
  persistCurrentLayerState: () => void;
  registerSelectionControlsDocking: (panel: HTMLDivElement, pinButton: HTMLButtonElement) => void;
  openSelectionConditionsFilters: () => void;
}

export function initSelection(cb: SelectionCallbacks) {
  _getCurrentSourceId = cb.getCurrentSourceId;
  _updateCursor = cb.updateCursor;
  _updateStatisticsResults = cb.updateStatisticsResults;
  _scheduleScatterPlotRefresh = cb.scheduleScatterPlotRefresh;
  _updateHighlightColors = cb.updateHighlightColors;
  _persistCurrentLayerState = cb.persistCurrentLayerState;
  _registerSelectionControlsDocking = cb.registerSelectionControlsDocking;
  _openSelectionConditionsFilters = cb.openSelectionConditionsFilters;
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


/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

/* Geometry / hit-test helpers moved to ./selection-geometry.ts (Track C). */

/* ------------------------------------------------------------------ */
/*  Parcel ID helpers                                                 */
/* ------------------------------------------------------------------ */

export function getParcelId(feature: any): string {
  if (feature.properties && feature.properties.parcel_id) {
    return feature.properties.parcel_id.toString();
  }
  if (feature.properties && feature.properties.id) {
    return feature.properties.id.toString();
  }
  if (feature.id !== undefined && feature.id !== null) {
    return feature.id.toString();
  }
  return "";
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

  const store = getActiveDataStore();
  if (store?.isCivil && feature.id !== undefined) {
    void resolveCivilSelectionIds([feature.id]);
  }
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
    const store = getActiveDataStore();
    if (store?.isCivil && feature.id !== undefined) {
      void resolveCivilSelectionIds([feature.id]);
    }
  }
  updateSelectionControls();
}

export function clearAllSelections() {
  const sourceId = _getCurrentSourceId();
  if (sourceId) {
    const store = getActiveDataStore();
    const isCivil = store?.isCivil || false;

    if (isCivil) {
      for (const fidStr of S.selectedParcels) {
        const fid = Number(fidStr);
        if (!isNaN(fid)) {
          S.map.setFeatureState(
            { source: sourceId, id: fid },
            { selected: false }
          );
        }
      }
    } else if (S.currentGeoJSON) {
      for (const feature of S.currentGeoJSON.features) {
        if (feature.id !== undefined) {
          S.map.setFeatureState(
            { source: sourceId, id: feature.id },
            { selected: false }
          );
        }
      }
    }
  }
  S.selectedParcels.clear();
  updateSelectionControls();
}

/* ------------------------------------------------------------------ */
/*  Saved selection helpers                                            */
/* ------------------------------------------------------------------ */

/** Return the list of ID field names the user chose in the key dropdown. */
function getSelectedKeyFields(): string[] {
  const mode = _selectionKeySelect?.value ?? '';
  if (mode === 'both') {
    const fields: string[] = [];
    if (S.parcelIdField) fields.push(S.parcelIdField);
    if (S.saleIdField)   fields.push(S.saleIdField);
    return fields;
  }
  if (mode === 'parcel' && S.parcelIdField) return [S.parcelIdField];
  if (mode === 'sale'   && S.saleIdField)   return [S.saleIdField];
  return [];
}

/** Return all possible key mode options based on currently configured fields. */
function getKeyModeOptions(): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [];
  const hasParcel = Boolean(S.parcelIdField);
  const hasSale   = Boolean(S.saleIdField);
  if (hasParcel && hasSale) {
    opts.push({ value: 'both',   label: `${S.parcelIdField} + ${S.saleIdField}` });
    opts.push({ value: 'parcel', label: `${S.parcelIdField}` });
    opts.push({ value: 'sale',   label: `${S.saleIdField}` });
  } else if (hasParcel) {
    opts.push({ value: 'parcel', label: `${S.parcelIdField}` });
  } else if (hasSale) {
    opts.push({ value: 'sale',   label: `${S.saleIdField}` });
  }
  return opts;
}

function refreshKeySelector() {
  if (!_selectionKeySelect) return;
  const prev = _selectionKeySelect.value;
  _selectionKeySelect.replaceChildren();
  const opts = getKeyModeOptions();
  if (opts.length === 0) {
    _selectionKeySelect.appendChild(new Option('No ID fields configured', ''));
    _selectionKeySelect.disabled = true;
  } else {
    for (const o of opts) _selectionKeySelect.appendChild(new Option(o.label, o.value));
    _selectionKeySelect.disabled = false;
    // Restore previous value if still valid
    if (opts.some(o => o.value === prev)) _selectionKeySelect.value = prev;
  }
}

function buildParcelKey(feature: GeoJSON.Feature, keyFields: string[]): Record<string, string> {
  const key: Record<string, string> = {};
  for (const f of keyFields) {
    key[f] = String(feature.properties?.[f] ?? '');
  }
  return key;
}

function getCurrentDataSourceName(): string | null {
  if (!S.currentLayerId) return null;
  const layer = S.layers.get(S.currentLayerId);
  if (!layer) return null;
  return S.dataStores.get(layer.dataStoreId)?.name ?? null;
}

function setSelectionSaveLoadStatus(msg: string, isError = false) {
  if (!_selectionSaveLoadStatus) return;
  _selectionSaveLoadStatus.textContent = msg;
  _selectionSaveLoadStatus.style.color = isError ? '#b91c1c' : '#111827';
  _selectionSaveLoadStatus.style.display = msg ? 'block' : 'none';
}

async function saveCurrentSelection(name: string): Promise<boolean | void> {
  const trimmedName = name.trim();
  if (!trimmedName) return false;

  const keyFields = getSelectedKeyFields();
  if (keyFields.length === 0) {
    window.alert('Configure a Parcel ID or Sale ID field before saving selections.');
    return false;
  }

  if (S.savedSelectionsStore.has(trimmedName)) {
    const overwrite = await showConfirm({
      title: 'Overwrite selection?',
      message: `Selection "${trimmedName}" already exists. Overwrite it?`,
      confirmText: 'Overwrite',
    });
    if (!overwrite) return false;
  }

  // Build keys for selected parcels and check for partial-duplicate warnings
  const parcelKeys: Array<Record<string, string>> = [];
  const keyToSelectedCount = new Map<string, number>();
  const keyToTotalCount = new Map<string, number>();

  if (S.currentGeoJSON) {
    for (const feature of S.currentGeoJSON.features) {
      if (feature.id === undefined) continue;
      const compoundKey = buildParcelKey(feature, keyFields);
      const keyStr = JSON.stringify(compoundKey);
      keyToTotalCount.set(keyStr, (keyToTotalCount.get(keyStr) ?? 0) + 1);

      const pid = getParcelId(feature as any);
      if (S.selectedParcels.has(pid)) {
        parcelKeys.push(compoundKey);
        keyToSelectedCount.set(keyStr, (keyToSelectedCount.get(keyStr) ?? 0) + 1);
      }
    }
  }

  // Check for partial duplicates: keys where some-but-not-all features are selected
  const partialWarnings: string[] = [];
  for (const [keyStr, selectedCount] of keyToSelectedCount) {
    const totalCount = keyToTotalCount.get(keyStr) ?? 0;
    if (selectedCount < totalCount) {
      const keyObj = JSON.parse(keyStr);
      const keyDesc = Object.entries(keyObj).map(([k, v]) => `${k}="${v}"`).join(', ');
      partialWarnings.push(
        `${totalCount} parcels share key (${keyDesc}) but only ${selectedCount} selected — loading will restore all ${totalCount}.`
      );
    }
  }

  if (partialWarnings.length > 0) {
    const maxShow = 5;
    let msg = 'Some IDs match more parcels than you selected:\n\n';
    msg += partialWarnings.slice(0, maxShow).join('\n');
    if (partialWarnings.length > maxShow) {
      msg += `\n...and ${partialWarnings.length - maxShow} more.`;
    }
    const proceed = await showConfirm({
      title: 'Save selection anyway?',
      message: msg,
      confirmText: 'Save anyway',
    });
    if (!proceed) return false;
  }

  // Deduplicate: store unique keys only (since loading selects all matches)
  const seen = new Set<string>();
  const uniqueKeys: Array<Record<string, string>> = [];
  for (const k of parcelKeys) {
    const s = JSON.stringify(k);
    if (!seen.has(s)) {
      seen.add(s);
      uniqueKeys.push(k);
    }
  }

  S.savedSelectionsStore.set(trimmedName, {
    name: trimmedName,
    keyFields,
    parcelKeys: uniqueKeys,
    sourceName: getCurrentDataSourceName(),
  });

  setSelectionSaveLoadStatus(`Saved ${S.selectedParcels.size} parcels as "${trimmedName}".`);
}

function loadSavedSelection(name: string) {
  const entry = S.savedSelectionsStore.get(name);
  if (!entry || !S.currentGeoJSON) return;

  const sourceId = _getCurrentSourceId();
  if (!sourceId) return;

  // Check field availability
  const sampleProps = S.currentGeoJSON.features[0]?.properties ?? {};
  const availableFields = Object.keys(sampleProps);
  const matchFields = entry.keyFields.filter(f => availableFields.includes(f));
  const missingFields = entry.keyFields.filter(f => !availableFields.includes(f));

  if (matchFields.length === 0) {
    setSelectionSaveLoadStatus(
      `Cannot load: fields [${entry.keyFields.join(', ')}] not in current layer.`,
      true
    );
    return;
  }

  // Build a set of keys to match, projected onto available fields only
  const savedKeySet = new Set<string>();
  for (const k of entry.parcelKeys) {
    const projected: Record<string, string> = {};
    for (const f of matchFields) projected[f] = k[f] ?? '';
    savedKeySet.add(JSON.stringify(projected));
  }

  // Clear current selection
  for (const feature of S.currentGeoJSON.features) {
    if (feature.id === undefined) continue;
    const pid = getParcelId(feature as any);
    if (S.selectedParcels.has(pid)) {
      S.selectedParcels.delete(pid);
      S.map.setFeatureState({ source: sourceId, id: feature.id }, { selected: false });
    }
  }

  // Select matches
  let matched = 0;
  for (const feature of S.currentGeoJSON.features) {
    if (feature.id === undefined) continue;
    const key: Record<string, string> = {};
    for (const f of matchFields) key[f] = String(feature.properties?.[f] ?? '');
    if (savedKeySet.has(JSON.stringify(key))) {
      const pid = getParcelId(feature as any);
      S.selectedParcels.add(pid);
      S.map.setFeatureState({ source: sourceId, id: feature.id }, { selected: true });
      matched++;
    }
  }

  _persistCurrentLayerState();
  updateSelectionControls();

  // Build status message
  const srcLabel = entry.sourceName ? ` (from: ${entry.sourceName})` : '';
  let statusMsg: string;
  if (missingFields.length > 0) {
    statusMsg = `Loaded ${matched} parcels using partial key [${matchFields.join(', ')}] — ${missingFields.join(', ')} not in current layer${srcLabel}`;
  } else if (matched === 0) {
    statusMsg = `No matching parcels found${srcLabel}`;
  } else {
    const uniqueKeys = entry.parcelKeys.length;
    statusMsg = `Loaded ${matched} parcels (${uniqueKeys} unique key${uniqueKeys !== 1 ? 's' : ''})${srcLabel}`;
  }
  setSelectionSaveLoadStatus(statusMsg, matched === 0);
}

function getMatchingSavedSelectionName(): string | null {
  if (S.selectedParcels.size === 0) return null;
  const keyFields = getSelectedKeyFields();
  if (keyFields.length === 0) return null;

  // Build current selection's key set
  const currentKeys = new Set<string>();
  for (const feature of S.currentGeoJSON?.features ?? []) {
    const pid = getParcelId(feature as any);
    if (S.selectedParcels.has(pid)) {
      const key = buildParcelKey(feature, keyFields);
      currentKeys.add(JSON.stringify(key));
    }
  }
  const currentSorted = JSON.stringify([...currentKeys].sort());

  for (const [entryName, entry] of S.savedSelectionsStore) {
    const entrySorted = JSON.stringify(
      entry.parcelKeys.map(k => JSON.stringify(k)).sort()
    );
    if (entrySorted === currentSorted) return entryName;
  }
  return null;
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

  S.selectionControlsPanel.style.cssText = `
    position: absolute;
    top: 60px;
    left: 120px;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 15;
    backdrop-filter: blur(4px);
    min-width: 240px;
    min-height: 120px;
    cursor: move;
    display: grid;
    grid-template-rows: auto 1fr;
  `;
  S.selectionControlsPanel.classList.add('viz-window');
  S.selectionControlsPanel.dataset.minWidth = '240';

  S.selectionControlsPanel.innerHTML = `
    <div class="window-header" style="border-radius: 8px 8px 0 0;">
      <div style="font-weight: 600; font-size: 13px;">Selection Controls</div>
      <div class="window-actions">
        <button id="btnPinSelectionControls" class="window-pin" type="button" title="Pin" aria-pressed="false">
          <img src="${PIN_ICON_TILTED}" alt="Pin menu" style="width:14px;height:14px;display:block;">
        </button>
        <button id="btnCloseSelectionControls" type="button" title="Close" aria-label="Close" style="width:22px;height:22px;border:none;background:none;border-radius:6px;outline:none;box-shadow:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;">❌</button>
      </div>
    </div>
    <div data-window-content style="padding: 12px; display: block;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
        <input type="color" id="highlightColorPicker" value="${S.highlightColor}" style="width: 30px; height: 20px; border: 1px solid #ddd; border-radius: 3px; cursor: pointer;">
        <span style="font-size: 12px;">Selected:</span>
        <span id="selectedCount" style="font-weight: 600;">${S.selectedParcels.size}</span>
        <button id="unselectAllBtn" style="
          border: 1px solid #ddd;
          background: #f8f8f8;
          padding: 4px 8px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          margin-left: auto;
          width: auto;
          white-space: nowrap;
        ">Unselect all</button>
      </div>
      <div style="margin-top: 10px; border-top: 1px solid #e5e7eb; padding-top: 10px; display: grid; gap: 8px;">
        <div style="font-size: 12px; font-weight: 600;">Select with filter:</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="selectionFilterConditionsBtn" type="button" style="
            flex: 1 1 auto;
            min-width: 0;
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
          "><img src="${FILTER_ICON}" alt="Filters" style="width:12px;height:12px;">conditions...</button>
          <select id="selectionFilterOperation" style="
            flex: 0 0 142px;
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
        </div>
        <div style="display: flex; justify-content: flex-end;">
          <button id="selectionFilterApplyBtn" style="
            border: 1px solid #ddd;
            background: #f8f8f8;
            padding: 6px 18px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            width: auto;
            text-transform: lowercase;
          ">apply</button>
        </div>
        <div id="selectionFilterStatus" style="font-size: 12px; min-height: 16px; color: #111827;"></div>
      </div>
    </div>
    <div class="window-resize-edge" aria-hidden="true"></div>
    <div class="window-resize-handle" aria-hidden="true">
      <img src="${RESIZE_ICON}" alt="" />
    </div>
  `;

  const unselectAllBtn = S.selectionControlsPanel.querySelector('#unselectAllBtn') as HTMLButtonElement;
  const colorPicker = S.selectionControlsPanel.querySelector('#highlightColorPicker') as HTMLInputElement;
  const pinButton = S.selectionControlsPanel.querySelector('#btnPinSelectionControls') as HTMLButtonElement;
  const closeButton = S.selectionControlsPanel.querySelector('#btnCloseSelectionControls') as HTMLButtonElement;
  const conditionsBtn = S.selectionControlsPanel.querySelector('#selectionFilterConditionsBtn') as HTMLButtonElement;
  const operationSelect = S.selectionControlsPanel.querySelector('#selectionFilterOperation') as HTMLSelectElement;
  const applyBtn = S.selectionControlsPanel.querySelector('#selectionFilterApplyBtn') as HTMLButtonElement;
  const statusLine = S.selectionControlsPanel.querySelector('#selectionFilterStatus') as HTMLDivElement;

  const updateConditionsButtonState = () => {
    const activeCount = S.currentLayerId ? getSelectionFilterActiveCount(S.currentLayerId) : 0;
    const iconEl = conditionsBtn.querySelector('img') as HTMLImageElement | null;
    if (iconEl) {
      iconEl.style.filter = activeCount > 0
        ? 'invert(19%) sepia(96%) saturate(7079%) hue-rotate(355deg) brightness(100%) contrast(112%)'
        : 'none';
    }
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
    const currentLayerId = S.currentLayerId;
    if (!currentLayerId) {
      setSelectionStatus('No conditions specified.', true);
      return;
    }
    const activeCount = getSelectionFilterActiveCount(currentLayerId);
    if (activeCount === 0) {
      setSelectionStatus('No conditions specified.', true);
      return;
    }

    const sourceId = _getCurrentSourceId();
    if (!sourceId) {
      setSelectionStatus('No conditions specified.', true);
      return;
    }

    const matchedFeatures = S.currentGeoJSON.features.filter((feature) => feature.id !== undefined && matchesSelectionFilters(feature, currentLayerId));
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
    updateConditionsButtonState();
    updateSelectionControls();
  };

  unselectAllBtn.addEventListener('click', clearAllSelections);
  conditionsBtn.addEventListener('click', () => {
    _openSelectionConditionsFilters();
    updateConditionsButtonState();
  });
  applyBtn.addEventListener('click', applySelectionFromConditions);
  closeButton.addEventListener('click', () => {
    S.selectionControlsPanel?.style.setProperty('display', 'none');
    if (S.selectionControlsPanel?.classList.contains('is-pinned')) {
      _refreshSelectionControlsDockLayout();
    }
  });

  colorPicker.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    S.highlightColor = target.value;
    _updateHighlightColors();
    _persistCurrentLayerState();
  });

  updateConditionsButtonState();

  // --- Save/Load selections section ---
  const contentDiv = S.selectionControlsPanel.querySelector('[data-window-content]') as HTMLDivElement;
  const saveLoadSection = document.createElement('div');
  saveLoadSection.style.cssText = 'margin-top: 10px; border-top: 1px solid #e5e7eb; padding-top: 10px; display: grid; gap: 8px;';

  // Save/Load widget
  _selectionSaveLoadWidget = createSaveLoadWidget({
    label: 'selection',
    idPrefix: 'selections',
    onSave: (name) => saveCurrentSelection(name),
    onLoad: (name) => loadSavedSelection(name),
    getEntries: () => Array.from(S.savedSelectionsStore.keys()),
    canSave: () => S.selectedParcels.size > 0 && getSelectedKeyFields().length > 0,
    canLoad: () => S.savedSelectionsStore.size > 0,
    getMatchName: () => getMatchingSavedSelectionName(),
  });
  // Inject key selector into the widget's save panel (only visible when Save tab is open)
  const savePanel = _selectionSaveLoadWidget.element.querySelector('#selectionsSavePanel') as HTMLDivElement;
  if (savePanel) {
    const keyRow = document.createElement('div');
    keyRow.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 12px;';
    const keyLabel = document.createElement('span');
    keyLabel.textContent = 'Key:';
    keyLabel.style.fontWeight = '600';
    _selectionKeySelect = document.createElement('select');
    _selectionKeySelect.style.cssText = 'flex: 1; border: 1px solid #ddd; background: #fff; padding: 4px 6px; border-radius: 6px; font-size: 12px; cursor: pointer;';
    keyRow.appendChild(keyLabel);
    keyRow.appendChild(_selectionKeySelect);
    refreshKeySelector();
    savePanel.insertBefore(keyRow, savePanel.firstChild);
  }

  saveLoadSection.appendChild(_selectionSaveLoadWidget.element);

  // Status line for load feedback
  _selectionSaveLoadStatus = document.createElement('div');
  _selectionSaveLoadStatus.style.cssText = 'font-size: 12px; color: #111827; display: none;';
  saveLoadSection.appendChild(_selectionSaveLoadStatus);

  contentDiv.appendChild(saveLoadSection);

  document.body.appendChild(S.selectionControlsPanel);
  _registerSelectionControlsDocking(S.selectionControlsPanel, pinButton);
  _makeDraggable(S.selectionControlsPanel);
  _ensureFloatingWindowVisible(S.selectionControlsPanel);
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

export function showSelectionControlsPanel() {
  if (!S.selectionControlsPanel || !S.selectionControlsPanel.isConnected) {
    createSelectionControlsPanel();
  }
  if (!S.selectionControlsPanel) return;

  const currentLayerId = S.currentLayerId ?? null;
  S.selectionControlsPanel.dataset.selectionContextLayerId = currentLayerId ?? '';
  ensureSelectionControlsOpen(S.selectionControlsPanel);

  syncSelectionControlsPanelState();
}

function syncSelectionControlsPanelState() {
  if (!S.selectionControlsPanel || !S.selectionControlsPanel.isConnected) return;

  const currentLayerId = S.currentLayerId ?? null;
  S.selectionControlsPanel.dataset.selectionContextLayerId = currentLayerId ?? '';

  const countElement = S.selectionControlsPanel.querySelector('#selectedCount');
  if (countElement) {
    countElement.textContent = S.selectedParcels.size.toString();
  }

  const conditionsBtn = S.selectionControlsPanel.querySelector('#selectionFilterConditionsBtn') as HTMLButtonElement | null;
  if (conditionsBtn) {
    const activeCount = currentLayerId ? getSelectionFilterActiveCount(currentLayerId) : 0;
    const iconEl = conditionsBtn.querySelector('img') as HTMLImageElement | null;
    if (iconEl) {
      iconEl.style.filter = activeCount > 0
        ? 'invert(19%) sepia(96%) saturate(7079%) hue-rotate(355deg) brightness(100%) contrast(112%)'
        : 'none';
    }
  }
}

export function updateSelectionControls() {
  syncSelectionControlsPanelState();

  refreshKeySelector();
  _selectionSaveLoadWidget?.update();

  if (S.statsSubjectMode === 'selected') {
    _updateStatisticsResults();
  }
  if (S.scatterSubjectMode === 'selected') {
    _scheduleScatterPlotRefresh();
  }
}

export function updateSelectionControlsPosition() {
  // no-op: selection controls follow standard floating window behavior
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
    // Bin by the normalized value (matching the legend breaks + map paint), so
    // selecting a tier works under per-area normalization.
    const value = normalizedValue(
      feature.properties as Record<string, unknown> | null,
      S.currentField!,
      S.normalizationMode
    );
    if (value !== null && feature.id !== undefined) {
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
  const sourceId = _getCurrentSourceId();
  if (!sourceId) return;

  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;

  let featuresToProcess: any[] = [];
  if (isCivil) {
    const currentLayer = S.currentLayerId ? S.layers.get(S.currentLayerId) : null;
    if (currentLayer) {
      featuresToProcess = S.map.queryRenderedFeatures({ layers: [currentLayer.layerId] });
    }
  } else if (S.currentGeoJSON) {
    featuresToProcess = S.currentGeoJSON.features;
  } else {
    console.log(`No data loaded to ${shouldSelect ? 'select' : 'unselect'} from`);
    return;
  }

  let count = 0;
  const newlySelectedFeatureIds: number[] = [];

  for (const feature of featuresToProcess) {
    if (!feature.geometry || !feature.id) continue;

    if (!intersectionTest(feature)) continue;

    const parcelId = getParcelId(feature);

    if (shouldSelect) {
      S.selectedParcels.add(parcelId);
      S.map.setFeatureState(
        { source: sourceId, id: feature.id },
        { selected: true }
      );
      if (isCivil) {
        newlySelectedFeatureIds.push(feature.id);
      }
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

  if (isCivil && shouldSelect && newlySelectedFeatureIds.length > 0) {
    void resolveCivilSelectionIds(newlySelectedFeatureIds);
  }

  updateSelectionControls();
}

/* ------------------------------------------------------------------ */
/*  Polygon selection (thin wrappers with broad-phase filtering)      */
/* ------------------------------------------------------------------ */

export function selectParcelsInPolygon(polygon: number[][]) {
  const bbox = calculatePolygonBbox(polygon);
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;

  if (!isCivil && !S.currentGeoJSON) {
    console.log('No data loaded to select from');
    return;
  }
  // Log broad-phase info
  if (!isCivil && S.currentGeoJSON) {
    const candidateCount = S.currentGeoJSON.features.filter(f =>
      f.geometry && f.id && featureIntersectsBbox(f, bbox)
    ).length;
    console.log(`Broad-phase filtering: ${candidateCount} features out of ${S.currentGeoJSON.features.length} candidates`);
  }

  updateParcelsInArea(
    (feature) => featureIntersectsBbox(feature, bbox) && featureIntersectsPolygon(feature, polygon),
    true
  );
}

export function unselectParcelsInPolygon(polygon: number[][]) {
  const bbox = calculatePolygonBbox(polygon);
  const store = getActiveDataStore();
  const isCivil = store?.isCivil || false;

  if (!isCivil && !S.currentGeoJSON) {
    console.log('No data loaded to unselect from');
    return;
  }
  if (!isCivil && S.currentGeoJSON) {
    const candidateCount = S.currentGeoJSON.features.filter(f =>
      f.geometry && f.id && featureIntersectsBbox(f, bbox)
    ).length;
    console.log(`Broad-phase filtering: ${candidateCount} features out of ${S.currentGeoJSON.features.length} candidates`);
  }

  updateParcelsInArea(
    (feature) => featureIntersectsBbox(feature, bbox) && featureIntersectsPolygon(feature, polygon),
    false
  );
}

/* ------------------------------------------------------------------ */
/*  Rectangle selection tool                                          */
/* ------------------------------------------------------------------ */

export function createRectangleElement(): HTMLDivElement {
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

    // Build the rectangle's four screen corners, then unproject each to ground
    // coordinates and select via the polygon path. Using all four corners (not
    // just the two diagonal ones) keeps the result correct when the map has a
    // non-zero bearing or pitch: the screen rectangle maps to a skewed
    // quadrilateral on the ground, so a 2-corner axis-aligned bbox would only
    // catch a diagonal sliver. Routing through selectParcelsInPolygon reuses
    // the same ground-accurate hit-testing that lasso/polygon selection use.
    const startX = S.rectangleStartPoint.x;
    const startY = S.rectangleStartPoint.y;
    const endX = currentViewportPoint.x;
    const endY = currentViewportPoint.y;
    const screenCorners: Array<[number, number]> = [
      [startX, startY],
      [endX, startY],
      [endX, endY],
      [startX, endY],
      [startX, startY], // close the ring
    ];
    const polygon = screenCorners.map(([cx, cy]) => {
      const ll = S.map.unproject([cx - rect.left, cy - rect.top]);
      return [ll.lng, ll.lat];
    });

    const mode = S.isRectangleUnselecting ? 'Unselect' : 'Select';
    console.log(`Rectangle ${mode} polygon:`, polygon);

    if (S.isRectangleUnselecting) {
      unselectParcelsInPolygon(polygon);
    } else {
      const isSelectOnlyMode = !e.shiftKey && !e.altKey;
      if (isSelectOnlyMode) {
        clearAllSelections();
      }
      selectParcelsInPolygon(polygon);
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

  // Polygon element
  polygonElement = createPolygonElement();

  // Document-level mouse-up listeners for catching releases outside the map
  document.addEventListener('mouseup', handleRectangleMouseUp);
  document.addEventListener('mouseup', handleLassoMouseUp);
}

export function getActiveDataStore(): DataStore | null {
  if (!S.currentLayerId) return null;
  const layer = S.layers.get(S.currentLayerId);
  if (!layer) return null;
  return S.dataStores.get(layer.dataStoreId) ?? null;
}

export async function resolveCivilSelectionIds(featureIds: (number | string)[]) {
  const store = getActiveDataStore();
  if (!store || !store.isCivil || !store.civilGateway || !store.civilToken) return;

  store.civilFeatureToParcelIdMap = store.civilFeatureToParcelIdMap || new Map<number, string>();
  const numericIds = featureIds
    .map(id => Number(id))
    .filter(id => !isNaN(id) && !store.civilFeatureToParcelIdMap!.has(id));

  if (numericIds.length === 0) return;

  try {
    const url = `${store.civilGateway}/civil.public.parcels.v1.ParcelsService/GetParcelIdsByFeatureId`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${store.civilToken}`
      },
      body: JSON.stringify({
        featureIds: numericIds.map(String),
        feature_ids: numericIds.map(String)
      })
    });
    if (response.ok) {
      const data = await response.json();
      const parcelIdsMap = data.parcelIds || data.parcel_ids || {};
      for (const [fidStr, pid] of Object.entries(parcelIdsMap)) {
        const fid = Number(fidStr);
        if (!isNaN(fid) && pid) {
          store.civilFeatureToParcelIdMap!.set(fid, String(pid));
        }
      }
      console.log(`Resolved and mapped ${Object.keys(parcelIdsMap).length} feature IDs to parcel IDs`);
    }
  } catch (err) {
    console.error("Failed to resolve parcel IDs by feature IDs:", err);
  }
}
