import { describe, it, expect, afterEach } from 'vitest';
import { normalizedValue, normalizedValueExpression } from './rendering-helpers';
import { S } from './state';

const origLand = S.landSizeField;
const origBldg = S.bldgSizeField;
afterEach(() => {
  S.landSizeField = origLand;
  S.bldgSizeField = origBldg;
});

describe('normalizedValue', () => {
  it('asis: returns the raw field value', () => {
    expect(normalizedValue({ price: 250 }, 'price', 'asis')).toBe(250);
  });
  it('asis: returns null for non-numeric / missing values', () => {
    expect(normalizedValue({ price: 'n/a' }, 'price', 'asis')).toBeNull();
    expect(normalizedValue({}, 'price', 'asis')).toBeNull();
    expect(normalizedValue(null, 'price', 'asis')).toBeNull();
  });

  it('perLand: divides by the configured land-size field', () => {
    S.landSizeField = 'landSqft';
    expect(normalizedValue({ price: 1000, landSqft: 4 }, 'price', 'perLand')).toBe(250);
  });
  it('perLand: returns null when the denominator is missing or <= 0', () => {
    S.landSizeField = 'landSqft';
    expect(normalizedValue({ price: 1000, landSqft: 0 }, 'price', 'perLand')).toBeNull();
    expect(normalizedValue({ price: 1000, landSqft: -5 }, 'price', 'perLand')).toBeNull();
    expect(normalizedValue({ price: 1000 }, 'price', 'perLand')).toBeNull();
  });
  it('perLand: falls back to raw when no land-size field is configured', () => {
    S.landSizeField = null;
    expect(normalizedValue({ price: 1000, landSqft: 4 }, 'price', 'perLand')).toBe(1000);
  });

  it('perBuilding: divides by the configured building-size field', () => {
    S.bldgSizeField = 'bldgSqft';
    expect(normalizedValue({ price: 900, bldgSqft: 3 }, 'price', 'perBuilding')).toBe(300);
  });
  it('perBuilding: returns null when the denominator is invalid', () => {
    S.bldgSizeField = 'bldgSqft';
    expect(normalizedValue({ price: 900, bldgSqft: 0 }, 'price', 'perBuilding')).toBeNull();
  });
});

describe('normalizedValueExpression (map paint/filter sibling of normalizedValue)', () => {
  it('asis: is just the field value', () => {
    expect(normalizedValueExpression('price', 'asis')).toEqual(['to-number', ['get', 'price']]);
  });
  it('perLand: divides by the land-size field, guarding denom <= 0', () => {
    S.landSizeField = 'landSqft';
    expect(normalizedValueExpression('price', 'perLand')).toEqual([
      'case',
      ['<=', ['to-number', ['get', 'landSqft']], 0], 0,
      ['/', ['to-number', ['get', 'price']], ['to-number', ['get', 'landSqft']]],
    ]);
  });
  it('perBuilding: divides by the building-size field, guarding denom < 0 and == 0', () => {
    S.bldgSizeField = 'bldgSqft';
    expect(normalizedValueExpression('price', 'perBuilding')).toEqual([
      'case',
      ['<', ['to-number', ['get', 'bldgSqft']], 0], 0,
      ['==', ['to-number', ['get', 'bldgSqft']], 0], 0,
      ['/', ['to-number', ['get', 'price']], ['to-number', ['get', 'bldgSqft']]],
    ]);
  });
  it('falls back to raw when the size field is not configured', () => {
    S.landSizeField = null;
    expect(normalizedValueExpression('price', 'perLand')).toEqual(['to-number', ['get', 'price']]);
  });
});
