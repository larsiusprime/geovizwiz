/**
 * Export 3D Object File menu (UI glue).
 *
 * Increment 1: lays out the controls' behavior — live output readout (model
 * dimensions, triangle/file estimates derived purely from the current hex
 * layer's bbox + count) and the "enable Hexagons" gating. The actual mesh build
 * + download is wired in a later increment; the Export button is inert for now.
 */
import { S } from './state';
import { bbox } from './utils.geo';
import type { HexCellInput } from './mesh/heightfield-mesh';
import { requestMeshExport, cancelMeshExport } from './mesh/mesh.client';

const byId = (id: string) => document.getElementById(id);

// Rough triangle count for a welded hex heightfield: hexagon tops (~4 tris) +
// inter-hex/perimeter walls (~6 tris each shared) + a small base contribution.
const TRIS_PER_HEX = 14;

let wired = false;

// Collapsible section: same behavior as the other floating menus
// (land-schedule-collapse-toggle rotates via .is-collapsed; body hides).
function wireCollapse(toggleId: string, bodyId: string, name: string): void {
  const btn = byId(toggleId) as HTMLButtonElement | null;
  const body = byId(bodyId) as HTMLElement | null;
  if (!btn || !body) return;
  const openDisplay = body.style.display || 'grid'; // grid for most, flex for Format
  btn.addEventListener('click', () => {
    const collapsed = btn.classList.toggle('is-collapsed');
    body.style.display = collapsed ? 'none' : openDisplay;
    btn.title = `${collapsed ? 'Expand' : 'Collapse'} ${name}`;
  });
}

/** Wire input + section listeners once (called from main.ts after DOM is ready). */
export function initExport3DMenu(): void {
  if (wired) return;
  wired = true;
  for (const id of ['expFootprint', 'expMaxHeight', 'expBaseThickness', 'expFmtStl', 'expFmtObj']) {
    byId(id)?.addEventListener('input', recomputeOutput);
  }
  wireCollapse('expSourceToggle', 'expSourceBody', 'Source');
  wireCollapse('expSizeToggle', 'expSizeBody', 'Size');
  wireCollapse('expOutputToggle', 'expOutputBody', 'Output');
  byId('btnDoExport3D')?.addEventListener('click', () => {
    if (exporting) cancelExport();
    else doExport();
  });
}

let exporting = false;

function setExportButtonLabel(label: string): void {
  const btn = byId('btnDoExport3D');
  if (btn) btn.textContent = label;
}

function setStatus(msg: string, isError = false): void {
  const el = byId('export3DStatus') as HTMLElement | null;
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#dc2626' : '#16a34a';
}

function exportBaseName(): string {
  const name = (S.currentLayerId && S.layers.get(S.currentLayerId)?.name) || 'hexmodel';
  return name.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'hexmodel';
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cancelExport(): void {
  cancelMeshExport();
  exporting = false;
  setExportButtonLabel('Export');
  setStatus('Export canceled.');
}

function doExport(): void {
  const fc = S.hexGeoJSON;
  if (!fc || fc.features.length === 0) { setStatus('No hexagon layer to export.', true); return; }

  const wantStl = (byId('expFmtStl') as HTMLInputElement | null)?.checked ?? false;
  const wantObj = (byId('expFmtObj') as HTMLInputElement | null)?.checked ?? false;
  if (!wantStl && !wantObj) { setStatus('Select at least one format (STL or OBJ).', true); return; }

  const cells: HexCellInput[] = fc.features.map((f) => ({
    h3: (f.properties as any)?.h3 as string,
    metric: Number((f.properties as any)?.hexMetric),
  }));
  const base = exportBaseName();

  exporting = true;
  setExportButtonLabel('Cancel');
  setStatus('Building mesh… 0%');

  requestMeshExport(
    cells,
    {
      footprintMm: numInput('expFootprint', 180),
      maxHeightMm: numInput('expMaxHeight', 30),
      baseThicknessMm: numInput('expBaseThickness', 2),
    },
    { stl: wantStl, obj: wantObj },
    {
      onProgress: (f) => setStatus(`Building mesh… ${Math.round(f * 100)}%`),
      onResult: (res) => {
        exporting = false;
        setExportButtonLabel('Export');
        if (res.triangleCount === 0) { setStatus('Mesh was empty — nothing to export.', true); return; }
        const saved: string[] = [];
        if (res.stl) { download(new Blob([res.stl], { type: 'model/stl' }), `${base}.stl`); saved.push(`${base}.stl`); }
        if (res.obj) { download(new Blob([res.obj], { type: 'model/obj' }), `${base}.obj`); saved.push(`${base}.obj`); }
        setStatus(`Saved ${saved.join(', ')} · ${res.triangleCount.toLocaleString()} triangles`);
      },
      onError: (msg) => {
        exporting = false;
        setExportButtonLabel('Export');
        console.error('[export3d] export failed', msg);
        setStatus('Export failed — see console.', true);
      },
    },
  );
}

/** Refresh source line, gating, and the output readout. Call when the menu opens. */
export function refreshExport3DMenu(): void {
  const notice = byId('export3DNotice');
  const body = byId('export3DBody');
  const active = !!(S.hexMode && S.hexGeoJSON);
  if (notice) notice.style.display = active ? 'none' : 'block';
  if (body) body.style.display = active ? 'grid' : 'none';
  if (!active) return;

  const src = byId('export3DSource');
  if (src) {
    const n = S.hexGeoJSON!.features.length;
    src.textContent = `Hexagon summary · res ${S.hexResolution} · ${n.toLocaleString()} hexes`;
  }
  setStatus('');
  recomputeOutput();
}

function numInput(id: string, fallback: number): number {
  const v = Number((byId(id) as HTMLInputElement | null)?.value);
  return Number.isFinite(v) ? v : fallback;
}

function recomputeOutput(): void {
  const fc = S.hexGeoJSON;
  if (!fc) return;

  const dims = byId('expModelDims');
  const geom = byId('expGeometry');
  const fileEst = byId('expFileEst');

  const b = bbox(fc);
  if (!b) {
    if (dims) dims.textContent = '—';
    if (geom) geom.textContent = '—';
    if (fileEst) fileEst.textContent = '—';
    return;
  }

  const footprint = numInput('expFootprint', 180);
  const maxHeight = numInput('expMaxHeight', 30);
  const baseThickness = numInput('expBaseThickness', 2);

  // Local equirectangular extent (metres), then scale longest side to footprint.
  const [minLng, minLat, maxLng, maxLat] = b;
  const lat0 = (minLat + maxLat) / 2;
  const widthM = (maxLng - minLng) * 111320 * Math.cos((lat0 * Math.PI) / 180);
  const heightM = (maxLat - minLat) * 111320;
  const longestM = Math.max(widthM, heightM) || 1;
  const scale = footprint / longestM; // mm per metre (horizontal)
  const modelX = widthM * scale;
  const modelY = heightM * scale;
  const modelZ = baseThickness + maxHeight; // base slab + tallest relief

  const hexes = fc.features.length;
  const triangles = hexes * TRIS_PER_HEX;

  if (dims) dims.textContent = `≈ ${Math.round(modelX)} × ${Math.round(modelY)} × ${Math.round(modelZ)} mm`;
  if (geom) geom.textContent = `${hexes.toLocaleString()} hexes · ~${Math.max(1, Math.round(triangles / 1000))}k triangles`;

  const stl = (byId('expFmtStl') as HTMLInputElement | null)?.checked;
  const obj = (byId('expFmtObj') as HTMLInputElement | null)?.checked;
  const stlBytes = 84 + triangles * 50; // binary STL: 80-byte header + count + 50 B/tri
  const parts: string[] = [];
  if (stl) parts.push(`model.stl (~${(stlBytes / 1048576).toFixed(1)} MB)`);
  if (obj) parts.push('model.obj');
  if (fileEst) fileEst.textContent = parts.length ? parts.join(', ') : '(no format selected)';
}
