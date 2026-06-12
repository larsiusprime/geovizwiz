/**
 * Main-thread client for the mesh-export worker. Owns the worker, supersedes
 * stale jobs, and surfaces progress/result/error via callbacks. Cancellation
 * marks the current job stale (its result is dropped) and tells the worker.
 */
import type { HexCellInput, HeightfieldOptions } from './heightfield-mesh';

export interface MeshExportResult {
  stl?: ArrayBuffer;
  obj?: string;
  triangleCount: number;
  dims: { x: number; y: number; z: number };
}

export interface MeshExportCallbacks {
  onProgress: (fraction: number) => void;
  onResult: (result: MeshExportResult) => void;
  onError?: (message: string) => void;
}

let worker: Worker | null = null;
let jobSeq = 0;
let latestJobId = 0;
let callbacks: MeshExportCallbacks | null = null;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<any>) => {
      const msg = e.data;
      if (msg.jobId !== latestJobId || !callbacks) return;
      if (msg.type === 'progress') callbacks.onProgress(msg.fraction);
      else if (msg.type === 'result') callbacks.onResult(msg as MeshExportResult);
      else if (msg.type === 'error') callbacks.onError?.(msg.message);
    };
  }
  return worker;
}

export function requestMeshExport(
  cells: HexCellInput[],
  opts: HeightfieldOptions,
  formats: { stl: boolean; obj: boolean },
  cbs: MeshExportCallbacks,
): void {
  callbacks = cbs;
  const w = ensureWorker();
  const jobId = ++jobSeq;
  latestJobId = jobId;
  cbs.onProgress(0);
  w.postMessage({ type: 'build', jobId, cells, opts, formats });
}

export function cancelMeshExport(): void {
  latestJobId = ++jobSeq; // any outstanding result is now stale
  callbacks = null;
  worker?.postMessage({ type: 'cancel' });
}
