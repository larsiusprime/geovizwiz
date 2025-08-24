export function coerceScalar(v: any): any {
  if (typeof v === 'bigint') {
    const big = v as bigint;
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    return (big <= max && big >= min) ? Number(big) : big.toString();
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return v;
    const negMatch = s.match(/^\(([^)]+)\)$/);
    const core = (negMatch ? s.slice(1, -1) : s).replace(/[$,\s]/g, '');
    const n = Number(core);
    return Number.isFinite(n) ? (negMatch ? -n : n) : v;
  }
  return v;
}

export function sanitizeFeatureInPlace(f: GeoJSON.Feature) {
  if (typeof (f as any).id === 'bigint') (f as any).id = (f as any).id.toString();
  const p = (f.properties || {}) as Record<string, any>;
  for (const k in p) p[k] = coerceScalar(p[k]);
}

export function sanitizeFeaturesInPlace(features: GeoJSON.Feature[]) {
  for (const f of features) sanitizeFeatureInPlace(f);
}

// AsyncBuffer from File (unchanged)
export type AsyncBuffer = { byteLength: number; slice(start: number, end?: number): Promise<ArrayBuffer> };

export function fileToAsyncBuffer(file: File): AsyncBuffer {
  return { byteLength: file.size, async slice(start, end) { return await file.slice(start, end ?? file.size).arrayBuffer(); } };
}

export async function urlToAsyncBuffer(url: string): Promise<AsyncBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  const buf = await resp.arrayBuffer();
  return { byteLength: buf.byteLength, async slice(start, end) { return buf.slice(start, end ?? buf.byteLength); } };
}
