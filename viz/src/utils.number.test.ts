import { describe, it, expect } from 'vitest';
import { numOrNull, parseStrictNumber, fmt, percentile, quantileBreaks } from './utils.number';

describe('numOrNull', () => {
  it('passes through finite numbers and numeric strings', () => {
    expect(numOrNull(5)).toBe(5);
    expect(numOrNull('5')).toBe(5);
    expect(numOrNull('5.5')).toBe(5.5);
    expect(numOrNull('-3')).toBe(-3);
  });
  it('returns null for non-finite / non-numeric input', () => {
    expect(numOrNull('abc')).toBeNull();
    expect(numOrNull('5px')).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull(NaN)).toBeNull();
    expect(numOrNull(Infinity)).toBeNull();
  });
  it('documents the Number() coercion quirk: null/"" coerce to 0', () => {
    // Number(null) === 0 and Number('') === 0 — both finite, so they pass.
    // (Callers that need to reject these must check before calling.)
    expect(numOrNull(null)).toBe(0);
    expect(numOrNull('')).toBe(0);
  });
});

describe('parseStrictNumber', () => {
  it('accepts plain signed integers and decimals (trimmed)', () => {
    expect(parseStrictNumber('5')).toBe(5);
    expect(parseStrictNumber('-5')).toBe(-5);
    expect(parseStrictNumber('5.5')).toBe(5.5);
    expect(parseStrictNumber('  42  ')).toBe(42);
  });
  it('rejects anything that is not a plain number literal', () => {
    expect(parseStrictNumber('')).toBeNull();
    expect(parseStrictNumber('5px')).toBeNull();
    expect(parseStrictNumber('1e3')).toBeNull();
    expect(parseStrictNumber('0x10')).toBeNull();
    expect(parseStrictNumber('5.')).toBeNull();
    expect(parseStrictNumber('.5')).toBeNull();
  });
});

describe('fmt', () => {
  it('handles the locale-independent branches', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(null)).toBe('0'); // Number(null) === 0
    expect(fmt(undefined)).toBe('—');
    expect(fmt('abc')).toBe('abc'); // non-finite → String(value ?? '—')
  });
});

describe('percentile', () => {
  it('returns NaN for an empty array', () => {
    expect(percentile([], 50)).toBeNaN();
  });
  it('interpolates between ranks and sorts its input', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([4, 2, 1, 3], 50)).toBe(2.5); // unsorted input
    expect(percentile([10, 20], 0)).toBe(10);
    expect(percentile([10, 20], 100)).toBe(20);
  });
});

describe('quantileBreaks', () => {
  it('returns a strictly-increasing, deduped, sorted set of breaks', () => {
    const breaks = quantileBreaks(Array.from({ length: 100 }, (_, i) => i + 1), 4);
    expect(breaks.length).toBeGreaterThan(0);
    expect(breaks.length).toBeLessThanOrEqual(3); // k-1 interior breaks
    for (let i = 1; i < breaks.length; i++) {
      expect(breaks[i]).toBeGreaterThan(breaks[i - 1]);
    }
  });
  it('collapses to a single break when all values are equal', () => {
    expect(quantileBreaks([5, 5, 5, 5], 4)).toEqual([5]);
  });
  it('clamps k to [2, 12]', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(quantileBreaks(vals, 1).length).toBeLessThanOrEqual(1); // ks=2 → 1 interior break
    expect(quantileBreaks(vals, 100).length).toBeLessThanOrEqual(11); // ks=12 → ≤11 breaks
  });
});
