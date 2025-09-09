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
  // Try HTTP Range requests first to avoid downloading the whole file.
  // Falls back to a full GET if ranges are unavailable.
  // Requires `Access-Control-Expose-Headers: Content-Range` on the server
  // to read the total length from the browser.
  const rangeHeader = { Range: 'bytes=0-0' } as Record<string, string>;
  try {
    const probe = await fetch(url, { headers: rangeHeader, mode: 'cors' });
    const contentRange = probe.headers.get('Content-Range');
    const total = contentRange?.match(/\/(\d+)$/)?.[1];

    // Only use range logic if the server responded with 206 and a parseable total length
    if (probe.status === 206 && total) {
      const byteLength = Number(total);
      if (!Number.isFinite(byteLength) || byteLength <= 0) throw new Error('Unknown content length');

      return {
        byteLength,
        async slice(start: number, end?: number) {
          const endByte = (end != null) ? end - 1 : '';
          const headers: Record<string, string> = { Range: `bytes=${start}-${endByte}` };
          const part = await fetch(url, { headers, mode: 'cors' });
          if (!(part.status === 206 || part.status === 200)) {
            throw new Error(`Failed ranged fetch ${url}: ${part.status} ${part.statusText}`);
          }
          return await part.arrayBuffer();
        }
      };
    }

    // If the server ignored Range and returned the full file, use that buffer
    if (probe.status === 200) {
      const buf = await probe.arrayBuffer();
      return { byteLength: buf.byteLength, async slice(start, end) { return buf.slice(start, end ?? buf.byteLength); } };
    }
  } catch (e) {
    // Fall through to full fetch below
  }

  // Fallback: fetch the whole file
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  const buf = await resp.arrayBuffer();
  return { byteLength: buf.byteLength, async slice(start, end) { return buf.slice(start, end ?? buf.byteLength); } };
}
