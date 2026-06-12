/**
 * Mesh validation — replicates trimesh's `is_volume` verdict (watertight +
 * consistent winding + positive volume) in pure JS, after merging coincident
 * vertices (which is what a slicer/validator does). Used as an export self-check
 * so we always know whether an export is a strict manifold solid.
 *
 * Note: this does NOT check self-intersections (needs CGAL/Netfabb); for that,
 * use the slicer or tools/verify-stl.py. But watertight + manifold-edges +
 * winding + positive volume is the property that matters most, and it matches
 * what trimesh reports.
 */
import type { IndexedMesh } from './heightfield-mesh';

export interface MeshReport {
  triangles: number;
  mergedVertices: number;
  boundaryEdges: number;     // shared by exactly 1 face → holes
  nonManifoldEdges: number;  // shared by >2 faces
  degenerateTriangles: number;
  windingConsistent: boolean;
  volumeMm3: number;
  watertight: boolean;       // boundaryEdges === 0 && nonManifoldEdges === 0
  isSolid: boolean;          // watertight && windingConsistent && volume > 0
}

export function validateMesh(mesh: IndexedMesh): MeshReport {
  const { positions, indices } = mesh;
  const triCount = indices.length / 3;

  // Merge coincident vertices by quantized position (1e-3 mm).
  const Q = 1e3;
  const vmap = new Map<string, number>();
  const mergedPos: number[] = [];
  const remap = new Int32Array(positions.length / 3);
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const key = `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
    let mi = vmap.get(key);
    if (mi === undefined) { mi = mergedPos.length / 3; mergedPos.push(x, y, z); vmap.set(key, mi); }
    remap[v] = mi;
  }

  const undirected = new Map<string, number>();
  const directed = new Map<string, number>();
  const ukey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  let degenerate = 0;
  let volume6 = 0; // 6× signed volume

  for (let t = 0; t < triCount; t++) {
    const a = remap[indices[t * 3]], b = remap[indices[t * 3 + 1]], c = remap[indices[t * 3 + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }

    for (const [i, j] of [[a, b], [b, c], [c, a]] as const) {
      undirected.set(ukey(i, j), (undirected.get(ukey(i, j)) ?? 0) + 1);
      directed.set(`${i}>${j}`, (directed.get(`${i}>${j}`) ?? 0) + 1);
    }

    // signed volume of tetrahedron (origin, v0, v1, v2): v0 · (v1 × v2)
    const ax = mergedPos[a * 3], ay = mergedPos[a * 3 + 1], az = mergedPos[a * 3 + 2];
    const bx = mergedPos[b * 3], by = mergedPos[b * 3 + 1], bz = mergedPos[b * 3 + 2];
    const cx = mergedPos[c * 3], cy = mergedPos[c * 3 + 1], cz = mergedPos[c * 3 + 2];
    const crx = by * cz - bz * cy, cry = bz * cx - bx * cz, crz = bx * cy - by * cx;
    volume6 += ax * crx + ay * cry + az * crz;
  }

  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const count of undirected.values()) {
    if (count === 1) boundaryEdges++;
    else if (count > 2) nonManifoldEdges++;
  }
  let windingConsistent = true;
  for (const count of directed.values()) {
    if (count > 1) { windingConsistent = false; break; } // an edge traversed twice the same way
  }

  const volumeMm3 = Math.abs(volume6) / 6;
  const watertight = boundaryEdges === 0 && nonManifoldEdges === 0;
  return {
    triangles: triCount,
    mergedVertices: mergedPos.length / 3,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles: degenerate,
    windingConsistent,
    volumeMm3,
    watertight,
    isSolid: watertight && windingConsistent && volume6 > 0,
  };
}
