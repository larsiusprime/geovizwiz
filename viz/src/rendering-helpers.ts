/**
 * Pure / state-only rendering helpers extracted from rendering.ts (Track C).
 *
 * Color & map-expression primitives, polygon centroid, numeric-field detection,
 * and normalized-value/stats helpers. None of these touch the rendering DOM-ref
 * or callback seams; the two normalized helpers read S for the size fields.
 */
import { S } from './state';
import type { Expression } from 'maplibre-gl';
export function polygonCentroid(ring: number[][]): [number, number] | null {
  if (ring.length < 3) return null;
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = (x0 * y1) - (x1 * y0);
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area2) < 1e-12) return null;
  return [cx / (3 * area2), cy / (3 * area2)];
}

export function generatePseudoRandomColor(n: number, max_n: number, seed: string): string {
  if (max_n <= 0) throw new Error("max_n must be > 0");

  // --- small helpers ---
  const frac = (x: number) => x - Math.floor(x);
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const gcd = (a: number, b: number): number => {
    a = Math.abs(a) | 0;
    b = Math.abs(b) | 0;
    while (b !== 0) {
      const t = a % b;
      a = b; b = t;
    }
    return a || 1;
  };

  // FNV-1a 32-bit string hash -> uint32
  const fnv1a = (str: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };

  // One-shot 32-bit mix -> [0,1)
  const rand01 = (seedHash: number, i: number, salt: number): number => {
    // Murmur-ish finalizer chain
    let x = (seedHash ^ Math.imul(i + 0x9e3779b1, 0x85ebca6b) ^ salt) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return (x >>> 0) / 0x100000000;
  };

  // HSL -> RGB [0..255] integers
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    h = frac(h); s = clamp01(s); l = clamp01(l);
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t: number) => {
      t = frac(t);
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const r = Math.round(hue2rgb(h + 1/3) * 255);
    const g = Math.round(hue2rgb(h) * 255);
    const b = Math.round(hue2rgb(h - 1/3) * 255);
    return [r, g, b];
  };

  // --- core logic ---
  const hash = fnv1a(seed);

  // Permute index with a "golden step" that is coprime to max_n
  // This spreads nearby n far apart around the hue wheel.
  const phi = 0.618033988749895; // golden ratio conjugate
  let step = Math.floor(max_n * phi) || 1;
  // ensure step and max_n are coprime for a full cycle permutation
  while (gcd(step, max_n) !== 1) step = (step + 1) % max_n || 1;

  const start = hash % Math.max(1, max_n); // seed-dependent start
  const idx = ((start + (n % max_n + max_n) % max_n * step) % max_n) >>> 0;

  // Hue: uniformly cover [0,1) with a seed offset; center of each "bin" to avoid overlaps
  const hOffset = ((hash >>> 8) & 0xFFFFFF) / 0x1000000; // [0,1)
  const h = frac(hOffset + (idx + 0.5) / max_n);

  // Keep colors vivid: high S, mid/high L with tiny seed+index jitter for variety
  const s = 0.45 + 0.10 * rand01(hash, idx, 0xA8F1);
  const l = 0.56 + 0.16 * (rand01(hash, idx, 0xC0FFEE) - 0.5);

  const [r, g, b] = hslToRgb(h, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}

export function makeStepColorExpression(valueExpr: Expression, colors: string[], breaks: number[]): Expression {
  const c = colors.slice();                 // copy
  const b = breaks.slice();                 // copy
  if (b.length === 0) return ['step', valueExpr, c[0]] as any;

  const out: (string | number | Expression)[] = ['step', valueExpr, c[0]];
  // pair up thresholds with subsequent colors
  for (let i = 0; i < b.length && i + 1 < c.length; i++) {
    out.push(b[i], c[i + 1]);
  }
  return out as any;
}

export function makeColorExpressionFromExpr(valueExpr: Expression, colors: string[], min: number, max: number): Expression {
  const n = colors.length - 1;
  const stops: (number | string)[] = [];
  for (let i = 0; i < colors.length; i++) {
    const t = i / n;
    stops.push(min + t * (max - min), colors[i]);
  }
  // Clamp value into [min,max] to avoid outliers crushing the ramp
  const clamped: Expression = ['max', min, ['min', max, valueExpr]] as any;
  return ['interpolate', ['linear'], clamped, ...stops] as any;
}

export function detectNumericFieldsFromFeatures(features: GeoJSON.Feature[]): string[] {
  const counts: Record<string, number> = {}, nums: Record<string, number> = {};
  const isNumLike = (v: any) =>
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

  for (const f of features) {
    const p = (f.properties || {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      counts[k] = (counts[k] ?? 0) + 1;
      if (isNumLike(v)) nums[k] = (nums[k] ?? 0) + 1;
    }
  }
  return Object.keys(counts)
    .filter(k => (nums[k] ?? 0) >= Math.max(1, Math.ceil(0.6 * (counts[k] || 0))))
    .sort();
}

/**
 * Per-feature value under the given normalization mode, or `null` when the
 * feature can't contribute (non-numeric value, or a missing/≤0 denominator).
 * This is the single source of truth for "what number does this parcel show" —
 * the legend count, the breaks/stats, and the map paint expression must all
 * agree on it, otherwise the legend disagrees with the map.
 */
export function normalizedValue(
  props: Record<string, unknown> | null | undefined,
  field: string,
  mode: 'asis' | 'perLand' | 'perBuilding'
): number | null {
  const base = Number(props?.[field]);
  if (!Number.isFinite(base)) return null;

  if (mode === 'perLand' && S.landSizeField) {
    const d = Number(props?.[S.landSizeField]);
    if (!Number.isFinite(d) || d <= 0) return null;
    return base / d;
  }
  if (mode === 'perBuilding' && S.bldgSizeField) {
    const d = Number(props?.[S.bldgSizeField]);
    if (!Number.isFinite(d) || d <= 0) return null;
    return base / d;
  }
  return base;
}

/**
 * MapLibre expression sibling of `normalizedValue` — the per-feature value under
 * the given normalization mode, for use in paint/filter expressions. Invalid
 * denominators (≤0, or <0 / ==0 for buildings) collapse to 0 (flat), matching
 * the paint path. Keep this in lockstep with `normalizedValue` so the map and
 * the legend agree.
 */
export function normalizedValueExpression(field: string, mode: 'asis'|'perLand'|'perBuilding'): Expression {
  const base: Expression = ['to-number', ['get', field]] as any;
  if (mode === 'perLand' && S.landSizeField) {
    const den: Expression = ['to-number', ['get', S.landSizeField]] as any;
    return ['case', ['<=', den, 0], 0, ['/', base, den]] as any;
  }
  if (mode === 'perBuilding' && S.bldgSizeField) {
    const den: Expression = ['to-number', ['get', S.bldgSizeField]] as any;
    return ['case', ['<', den, 0], 0, ['==', den, 0], 0, ['/', base, den]] as any;
  }
  return base;
}

export function getNumericValuesNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding'): number[] {
  const vals: number[] = [];
  for (const f of fc.features) {
    const v = normalizedValue(f.properties as Record<string, unknown> | null, field, mode);
    if (v !== null) vals.push(v);
  }
  return vals;
}

export function computeStatsNormalized(fc: GeoJSON.FeatureCollection, field: string, mode: 'asis'|'perLand'|'perBuilding') {
  const vals = getNumericValuesNormalized(fc, field, mode);
  let min = Infinity, max = -Infinity;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) { min = 0; max = min + 1; }
  return { min, max };
}
