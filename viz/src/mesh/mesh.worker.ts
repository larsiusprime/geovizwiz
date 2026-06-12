/**
 * Mesh-export worker: builds the printable mesh and serializes STL/OBJ off the
 * main thread so the UI stays responsive. Progress is posted from the build's
 * per-cell loop. The build itself is synchronous (fast relative to aggregation),
 * so cancellation is by supersede: a newer job or a cancel marks the in-flight
 * job stale and its result is dropped on the main thread.
 */
import { buildHexHeightfieldMesh, type HexCellInput, type HeightfieldOptions } from './heightfield-mesh';
import { meshToBinarySTL, meshToOBJ } from './mesh-export';

interface BuildMsg {
  type: 'build';
  jobId: number;
  cells: HexCellInput[];
  opts: HeightfieldOptions;
  formats: { stl: boolean; obj: boolean };
}
type InMsg = BuildMsg | { type: 'cancel' };

const ctx = self as unknown as Worker;
let activeJobId = 0;

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'cancel') { activeJobId = 0; return; }
  if (msg.type !== 'build') return;

  const { jobId, cells, opts, formats } = msg;
  activeJobId = jobId;
  try {
    const mesh = buildHexHeightfieldMesh(cells, opts, {
      onProgress: (f) => { if (activeJobId === jobId) ctx.postMessage({ type: 'progress', jobId, fraction: f * 0.9 }); },
    });
    if (activeJobId !== jobId) return; // superseded / canceled

    ctx.postMessage({ type: 'progress', jobId, fraction: 0.95 });
    const out: any = { type: 'result', jobId, triangleCount: mesh.triangleCount, dims: mesh.dims };
    const transfer: Transferable[] = [];
    if (formats.stl) { const buf = meshToBinarySTL(mesh); out.stl = buf; transfer.push(buf); }
    if (formats.obj) { out.obj = meshToOBJ(mesh); }
    if (activeJobId !== jobId) return;
    ctx.postMessage(out, transfer);
  } catch (err) {
    if (activeJobId === jobId) ctx.postMessage({ type: 'error', jobId, message: String(err) });
  }
};
