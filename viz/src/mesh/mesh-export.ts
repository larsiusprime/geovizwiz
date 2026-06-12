/**
 * Serialize an IndexedMesh to binary STL or OBJ. Pure, worker-safe.
 */
import type { IndexedMesh } from './heightfield-mesh';

/** Binary STL: 80-byte header + uint32 count + 50 bytes per triangle. */
export function meshToBinarySTL(mesh: IndexedMesh): ArrayBuffer {
  const { positions, indices, triangleCount } = mesh;
  const buf = new ArrayBuffer(84 + triangleCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triangleCount, true);

  let o = 84;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    // face normal from winding
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
    dv.setFloat32(o, ax, true); dv.setFloat32(o + 4, ay, true); dv.setFloat32(o + 8, az, true); o += 12;
    dv.setFloat32(o, bx, true); dv.setFloat32(o + 4, by, true); dv.setFloat32(o + 8, bz, true); o += 12;
    dv.setFloat32(o, cx, true); dv.setFloat32(o + 4, cy, true); dv.setFloat32(o + 8, cz, true); o += 12;
    dv.setUint16(o, 0, true); o += 2; // attribute byte count
  }
  return buf;
}

/** Wavefront OBJ (indexed, 1-based faces). */
export function meshToOBJ(mesh: IndexedMesh): string {
  const { positions, indices, vertexCount, triangleCount } = mesh;
  const parts: string[] = ['# geovizwiz 3D export', 'o hexmodel'];
  for (let i = 0; i < vertexCount; i++) {
    parts.push(`v ${positions[i * 3]} ${positions[i * 3 + 1]} ${positions[i * 3 + 2]}`);
  }
  for (let t = 0; t < triangleCount; t++) {
    parts.push(`f ${indices[t * 3] + 1} ${indices[t * 3 + 1] + 1} ${indices[t * 3 + 2] + 1}`);
  }
  return parts.join('\n') + '\n';
}
