export function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmt(n: any, digits = 2): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n ?? '—');
  if (Math.abs(x) >= 1) return x.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (x === 0) return '0';
  return x.toLocaleString(undefined, { maximumSignificantDigits: 3 });
}

export function percentile(vals: number[], p: number): number {
  if (!vals.length) return NaN;
  const a = vals.slice().sort((x, y) => x - y);
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const t = idx - lo;
  return a[lo] + (a[hi] - a[lo]) * t;
}

export function quantileBreaks(values: number[], k: number, lowPct = 1, highPct = 99): number[] {
  const ks = Math.max(2, Math.min(k, 12));
  const out: number[] = [];
  for (let i = 1; i < ks; i++) {
    const p = lowPct + (highPct - lowPct) * (i / ks);
    const q = percentile(values, p);
    if (Number.isFinite(q)) out.push(q);
  }
  out.sort((a,b)=>a-b);
  return out.filter((v, i) => i === 0 || v > out[i-1]);
}
