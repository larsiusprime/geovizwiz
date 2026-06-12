/**
 * Build a watertight, printable mesh from an H3 hex layer. Pure (no DOM/state);
 * uses h3-js for geometry.
 *
 * The whole bounding rectangle is tiled ("fill to base"): occupied hexes get
 * relief, empty hexes sit flat at base level. Each hex is emitted as its own
 * closed prism (top + bottom + full-height side walls) — every prism is an
 * independently watertight, correctly-wound solid, so the union is reliably
 * printable (slicers union the touching columns). This sidesteps the unpaired
 * vertical-edge problem of a single welded skin at hex corners.
 *
 * Heights map the metric so the tallest hex prints at `maxHeightMm` above the
 * base; horizontal extent is scaled so the longest side equals `footprintMm`.
 */
import { cellToBoundary } from 'h3-js';

export interface IndexedMesh {
  positions: Float32Array; // xyz triplets, mm, Z up
  indices: Uint32Array;    // triangles (CCW = outward)
  vertexCount: number;
  triangleCount: number;
  dims: { x: number; y: number; z: number }; // bounding size, mm
}

export interface HeightfieldOptions {
  footprintMm: number;     // longest horizontal side
  maxHeightMm: number;     // tallest relief above the base
  baseThicknessMm: number; // solid slab beneath everything
}

export interface HexCellInput { h3: string; metric: number; }

export interface BuildHooks {
  onProgress?: (fraction: number) => void;
}

export function buildHexHeightfieldMesh(
  cells: HexCellInput[],
  opts: HeightfieldOptions,
  hooks?: BuildHooks,
): IndexedMesh {
  const empty: IndexedMesh = {
    positions: new Float32Array(0), indices: new Uint32Array(0),
    vertexCount: 0, triangleCount: 0, dims: { x: 0, y: 0, z: 0 },
  };

  // --- occupied cells + max metric (for relief scaling) ---
  const occupied = new Map<string, number>();
  let maxMetric = 0;
  for (const c of cells) {
    if (!c.h3 || !Number.isFinite(c.metric)) continue;
    occupied.set(c.h3, c.metric);
    if (c.metric > maxMetric) maxMetric = c.metric;
  }
  if (occupied.size === 0) return empty;

  // --- bbox of occupied cell boundaries ---
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const h3 of occupied.keys()) {
    for (const [lng, lat] of cellToBoundary(h3, true) as number[][]) {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
  }

  // --- local equirectangular projection → mm, scaled so longest side = footprint ---
  const lat0 = (minLat + maxLat) / 2;
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const mPerDegLat = 111320;
  const widthM = (maxLng - minLng) * mPerDegLng;
  const heightM = (maxLat - minLat) * mPerDegLat;
  const scale = opts.footprintMm / Math.max(widthM, heightM, 1e-9);
  const proj = (lng: number, lat: number): [number, number] =>
    [(lng - minLng) * mPerDegLng * scale, (lat - minLat) * mPerDegLat * scale];

  // --- heights ---
  const reliefOf = (metric: number) => (maxMetric > 0 ? (Math.max(0, metric) / maxMetric) * opts.maxHeightMm : 0);

  // --- mesh accumulators (per-cell vertices: no cross-cell welding) ---
  const positions: number[] = [];
  const indices: number[] = [];
  const addV = (x: number, y: number, z: number): number => {
    const i = positions.length / 3;
    positions.push(x, y, z);
    return i;
  };
  // Push a triangle, flipping winding so its normal aligns with `ref` (outward).
  const pushTri = (i0: number, i1: number, i2: number, ref: [number, number, number]) => {
    const ax = positions[i1 * 3] - positions[i0 * 3];
    const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
    const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const bx = positions[i2 * 3] - positions[i0 * 3];
    const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
    const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    if (nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) indices.push(i0, i2, i1);
    else indices.push(i0, i1, i2);
  };

  // --- rectangular base slab (0 → baseThickness) over the bounding box ---
  // A single clean rectangle instead of tiling the bbox with hexes (which left a
  // jagged perimeter and far more triangles). Empty areas are this flat slab top.
  const X = widthM * scale, Y = heightM * scale, zb = opts.baseThicknessMm;
  {
    const b00 = addV(0, 0, 0), b10 = addV(X, 0, 0), b11 = addV(X, Y, 0), b01 = addV(0, Y, 0);
    const t00 = addV(0, 0, zb), t10 = addV(X, 0, zb), t11 = addV(X, Y, zb), t01 = addV(0, Y, zb);
    pushTri(t00, t10, t11, [0, 0, 1]); pushTri(t00, t11, t01, [0, 0, 1]);    // top
    pushTri(b00, b10, b11, [0, 0, -1]); pushTri(b00, b11, b01, [0, 0, -1]);  // bottom
    pushTri(b00, b10, t10, [0, -1, 0]); pushTri(b00, t10, t00, [0, -1, 0]);  // y = 0
    pushTri(b10, b11, t11, [1, 0, 0]); pushTri(b10, t11, t10, [1, 0, 0]);    // x = X
    pushTri(b11, b01, t01, [0, 1, 0]); pushTri(b11, t01, t11, [0, 1, 0]);    // y = Y
    pushTri(b01, b00, t00, [-1, 0, 0]); pushTri(b01, t00, t01, [-1, 0, 0]);  // x = 0
  }

  // --- relief columns for occupied hexes (0 → top), sitting within the slab ---
  let maxZ = zb;
  const total = occupied.size;
  let processed = 0;
  for (const [h3, metric] of occupied) {
    if ((processed++ & 2047) === 0) hooks?.onProgress?.(processed / total);
    const topZ = zb + reliefOf(metric);
    if (topZ <= zb + 1e-4) continue; // no relief → the flat slab already covers it
    if (topZ > maxZ) maxZ = topZ;

    const bnd = cellToBoundary(h3, true) as number[][];
    const closed = bnd.length > 1 && bnd[0][0] === bnd[bnd.length - 1][0] && bnd[0][1] === bnd[bnd.length - 1][1];
    const pts = closed ? bnd.slice(0, -1) : bnd;
    const N = pts.length;
    if (N < 3) continue;
    const xy = pts.map(([lng, lat]) => proj(lng, lat));

    // centre (for outward wall normals)
    let cx = 0, cy = 0;
    for (const [x, y] of xy) { cx += x; cy += y; }
    cx /= N; cy /= N;

    // fresh vertices for this prism's top and bottom rings
    const top = xy.map(([x, y]) => addV(x, y, topZ));
    const bot = xy.map(([x, y]) => addV(x, y, 0));

    // top fan (normal up), bottom fan (normal down)
    for (let k = 1; k < N - 1; k++) pushTri(top[0], top[k], top[k + 1], [0, 0, 1]);
    for (let k = 1; k < N - 1; k++) pushTri(bot[0], bot[k], bot[k + 1], [0, 0, -1]);

    // full-height side walls on every edge (closes the prism)
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const ref: [number, number, number] = [(xy[i][0] + xy[j][0]) / 2 - cx, (xy[i][1] + xy[j][1]) / 2 - cy, 0];
      pushTri(bot[i], bot[j], top[j], ref);
      pushTri(bot[i], top[j], top[i], ref);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    dims: { x: widthM * scale, y: heightM * scale, z: maxZ },
  };
}
