/**
 * Main-thread client for the H3 aggregation worker.
 *
 * Owns the worker lifecycle, sends parcel geometry once per dataset, debounces
 * rapid requests (slider drags), supersedes stale jobs by id, and surfaces
 * progress/result via callbacks. Cancellation is cooperative: `cancel()` tells
 * the worker to abort the in-flight pass and stops delivering its callbacks.
 */
import type { HexOutMsg } from './h3-aggregate.types';

export interface HexJobParams {
  field: string;
  denomField: string | null;
  reducer: 'sum' | 'ratio';
  resolution: number;
  /** Optional visibility predicate; parcels for which it returns false are excluded. */
  keep?: (feature: GeoJSON.Feature) => boolean;
}

export interface HexJobCallbacks {
  onProgress: (fraction: number) => void;
  onResult: (fc: GeoJSON.FeatureCollection) => void;
}

let worker: Worker | null = null;
let initializedFor: GeoJSON.FeatureCollection | null = null;
let jobSeq = 0;
let latestJobId = 0;
let debounceTimer: number | null = null;
let callbacks: HexJobCallbacks | null = null;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./h3-aggregate.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<HexOutMsg>) => {
      const msg = e.data;
      if (msg.jobId !== latestJobId || !callbacks) return; // ignore superseded/canceled
      if (msg.type === 'progress') {
        callbacks.onProgress(msg.total > 0 ? msg.processed / msg.total : 1);
      } else if (msg.type === 'result') {
        callbacks.onResult(msg.fc);
      }
    };
  }
  return worker;
}

/**
 * Request a hex aggregation. Debounced; the latest call wins. `callbacks` are
 * only invoked for this (latest) job — earlier in-flight jobs are ignored.
 */
export function requestHexAggregation(
  parcels: GeoJSON.FeatureCollection,
  params: HexJobParams,
  cbs: HexJobCallbacks,
  debounceMs = 100,
): void {
  callbacks = cbs;
  const w = ensureWorker();
  callbacks.onProgress(0); // show feedback immediately, before the debounce settles

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;

    // Send geometry once per dataset (reference identity = same dataset).
    if (initializedFor !== parcels) {
      w.postMessage({ type: 'init', geoms: parcels.features.map((f) => f.geometry) });
      initializedFor = parcels;
    }

    const ratio = params.reducer === 'ratio' && !!params.denomField;
    const keep = params.keep;
    const n = parcels.features.length;
    const num = new Float64Array(n);
    const den = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const feat = parcels.features[i];
      // Filtered-out parcels: NaN numerator → the worker skips them entirely.
      if (keep && !keep(feat)) { num[i] = NaN; continue; }
      const p = (feat.properties || {}) as Record<string, any>;
      num[i] = Number(p[params.field]);
      den[i] = ratio ? Number(p[params.denomField!]) : 1;
    }

    const jobId = ++jobSeq;
    latestJobId = jobId;
    w.postMessage(
      { type: 'job', jobId, resolution: params.resolution, ratio, num, den },
      [num.buffer, den.buffer],
    );
  }, debounceMs);
}

/** Abort the in-flight aggregation (if any) and stop delivering its callbacks. */
export function cancelHexAggregation(): void {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  latestJobId = ++jobSeq; // any outstanding result/progress is now stale
  callbacks = null;
  worker?.postMessage({ type: 'cancel' });
}

/** Drop the resident-geometry cache (call when the dataset is replaced). */
export function resetHexWorker(): void {
  initializedFor = null;
}
