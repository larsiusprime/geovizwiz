/**
 * Hex-summary layer orchestration.
 *
 * Decides whether the current layer should show an H3 hex summary or raw
 * parcels, drives the aggregation worker, and swaps the map source when a result
 * arrives. Aggregation is asynchronous: the previous view stays on screen
 * (keep-last-good) until the new hex layer is ready, and an in-flight build can
 * be canceled (toggle off, 3D off, or the progress bar's Cancel button).
 *
 * The user's chosen field + normalization mode are left untouched — they define
 * WHAT is aggregated. The hex layer renders the precomputed `hexMetric` through
 * the existing extrusion/color path (see `buildValueExpression` /
 * `computeAndApplyAutoMultiplier`, which read `hexMetric` when `S.hexMode`).
 */
import { S } from './state';
import type { HexReducer } from './h3/h3-aggregate';
import { requestHexAggregation, cancelHexAggregation } from './h3/h3-aggregate.client';
import { addOrUpdateSource, scheduleUpdate } from './rendering';
import { isParcelVisibleUnderFilters } from './filters';

/* ---------------- progress UI ---------------- */

let _prog: HTMLElement | null = null;
let _fill: HTMLElement | null = null;
let _pct: HTMLElement | null = null;

function progEls(): HTMLElement | null {
  if (!_prog) {
    _prog = document.getElementById('hexProgress');
    _fill = _prog?.querySelector('.hex-progress-fill') as HTMLElement | null;
    _pct = _prog?.querySelector('.hex-progress-pct') as HTMLElement | null;
  }
  return _prog;
}

function setFill(fraction: number): void {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  if (_fill) _fill.style.width = `${pct}%`;
  if (_pct) _pct.textContent = `${pct}%`;
}

function showHexProgress(): void {
  const el = progEls();
  if (el) { el.setAttribute('data-visible', '1'); setFill(0); }
}

function hideHexProgress(): void {
  const el = progEls();
  if (el) el.removeAttribute('data-visible');
}

/* ---------------- committed-state snapshot ---------------- */

/**
 * The settings that match the view currently on screen. Captured whenever a hex
 * build completes (or we revert to parcels), it lags behind in-flight edits — so
 * it is exactly "the settings active before the current operation started," which
 * is what we restore to when a build is canceled.
 */
export interface HexSnapshot {
  hexMode: boolean;
  hexResolution: number;
  currentField: string | null;
  currentFieldType: 'numeric' | 'categorical' | null;
  normalizationMode: 'asis' | 'perLand' | 'perBuilding';
  is3DMode: boolean;
}

let committed: HexSnapshot | null = null;

function snapshot(): HexSnapshot {
  return {
    hexMode: S.hexMode,
    hexResolution: S.hexResolution,
    currentField: S.currentField,
    currentFieldType: S.currentFieldType,
    normalizationMode: S.normalizationMode,
    is3DMode: S.is3DMode,
  };
}

/** The config matching the on-screen view, or null when showing parcels. */
export function getCommittedHexState(): HexSnapshot | null {
  return committed;
}

/* ---------------- orchestration ---------------- */

// True when the current state should display a hex summary rather than parcels.
function wantHex(): boolean {
  return !!(
    S.is3DMode &&
    S.hexMode &&
    S.currentFieldType === 'numeric' &&
    S.currentField &&
    S.currentGeoJSON
  );
}

function startJob(): void {
  // value/acre (perLand) and perBuilding are ratios; as-is is a plain sum. A
  // missing denominator field degrades to sum, mirroring per-parcel rendering.
  const denomField =
    S.normalizationMode === 'perLand' ? S.landSizeField :
    S.normalizationMode === 'perBuilding' ? S.bldgSizeField :
    null;
  const reducer: HexReducer = S.normalizationMode !== 'asis' && denomField ? 'ratio' : 'sum';

  showHexProgress();
  requestHexAggregation(
    S.currentGeoJSON!,
    { field: S.currentField!, denomField, reducer, resolution: S.hexResolution, keep: isParcelVisibleUnderFilters },
    {
      onProgress: (f) => setFill(f),
      onResult: (fc) => {
        S.hexGeoJSON = fc;
        addOrUpdateSource(fc);          // swap parcels → hexes only now (keep-last-good)
        committed = snapshot();         // this config now matches the on-screen view
        hideHexProgress();
        scheduleUpdate('recomputeAndAutoScale', /*refreshLegend*/ true);
      },
    },
  );
}

// Restore the raw parcel geometry to the map source.
export function restoreParcelData(): void {
  S.hexGeoJSON = null;
  committed = null; // parcels are the baseline now
  if (S.currentGeoJSON) addOrUpdateSource(S.currentGeoJSON);
}

/**
 * Reconcile the map with the current hex/parcel intent. Call before scheduling a
 * recompute whenever something affecting the hex summary changes (hex toggle,
 * resolution, field, normalization, 3D toggle).
 *
 * Returns true if a hex build was started (the caller should NOT render — the
 * result handler does). Returns false when not in hex mode (caller renders
 * parcels normally); any in-flight build is canceled and parcels restored.
 */
export function startHexUpdateIfActive(): boolean {
  if (wantHex()) {
    startJob();
    return true;
  }
  cancelHexAggregation();
  hideHexProgress();
  if (S.hexGeoJSON) restoreParcelData();
  return false;
}

/** Cancel an in-flight hex build and hide the progress UI (keeps current view). */
export function cancelHexUpdate(): void {
  cancelHexAggregation();
  hideHexProgress();
}
