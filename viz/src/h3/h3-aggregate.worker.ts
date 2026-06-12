/**
 * H3 aggregation worker.
 *
 * Holds the parcel geometry resident across jobs. Each job runs the expensive
 * coverage pass (`polygonToCells` per parcel) in yielding chunks so it stays
 * cancelable: if a newer job arrives, or a `cancel` message comes in, the
 * in-flight pass aborts at the next chunk boundary. Coverage is cached by
 * resolution, so a job that only changes the field/normalization (same
 * resolution) skips straight to the cheap deposit/reduce step.
 */
import { coverCellsForGeometry, reduceToHexFC } from './h3-aggregate';
import type { HexInMsg, HexJobMsg, HexOutMsg } from './h3-aggregate.types';

const ctx = self as unknown as Worker;
const post = (msg: HexOutMsg) => ctx.postMessage(msg);

const COVER_CHUNK = 1500; // parcels per yield during the coverage pass

let geoms: (GeoJSON.Geometry | null)[] = [];

// Coverage cache: target cells per parcel, valid for `cacheRes`.
let cache: string[][] = [];
let cacheRes: number | null = null;

// The job the worker should currently be working on. A running pass compares
// against this each chunk; a mismatch (newer job or cancel) aborts it.
let activeJobId = 0;
let pending: HexJobMsg | null = null;
let running = false;

ctx.onmessage = (e: MessageEvent<HexInMsg>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      geoms = msg.geoms;
      cache = [];
      cacheRes = null;
      return;
    case 'cancel':
      activeJobId = 0; // abort any running pass; drop anything queued
      pending = null;
      return;
    case 'job':
      pending = msg;
      activeJobId = msg.jobId; // supersedes any running pass
      if (!running) void pump();
      return;
  }
};

async function pump(): Promise<void> {
  running = true;
  try {
    while (pending) {
      const job = pending;
      pending = null;
      await processJob(job);
    }
  } finally {
    running = false;
  }
}

const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

async function processJob(job: HexJobMsg): Promise<void> {
  const { jobId, resolution, ratio, num, den } = job;
  const n = geoms.length;

  // (1) Coverage — expensive. Reuse cache when the resolution is unchanged.
  if (cacheRes !== resolution || cache.length !== n) {
    const next: string[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      next[i] = coverCellsForGeometry(geoms[i], resolution);
      if ((i % COVER_CHUNK) === 0) {
        post({ type: 'progress', jobId, processed: i, total: n });
        await yieldToLoop();
        if (activeJobId !== jobId) return; // superseded or canceled
      }
    }
    if (activeJobId !== jobId) return;
    cache = next;
    cacheRes = resolution;
  }
  post({ type: 'progress', jobId, processed: n, total: n });

  // (2) Deposit — cheap. Distribute each parcel's num/den across its cells.
  const numByCell = new Map<string, number>();
  const denByCell = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const ni = num[i];
    if (!Number.isFinite(ni)) continue;
    const di = ratio ? den[i] : 1;
    if (ratio && (!Number.isFinite(di) || di <= 0)) continue;
    const cells = cache[i];
    const L = cells.length;
    if (L === 0) continue;
    const w = 1 / L;
    for (let k = 0; k < L; k++) {
      const cell = cells[k];
      numByCell.set(cell, (numByCell.get(cell) ?? 0) + ni * w);
      denByCell.set(cell, (denByCell.get(cell) ?? 0) + di * w);
    }
  }
  if (activeJobId !== jobId) return;

  // (3) Reduce + build the hex FeatureCollection (h3 cellToBoundary).
  const fc = reduceToHexFC(numByCell, denByCell, ratio);
  if (activeJobId !== jobId) return;
  post({ type: 'result', jobId, fc });
}
