import { describe, it, expect } from 'vitest';
import { areaOn, featureOn, toFeatures } from './modules';

describe('areaOn', () => {
  it('closes an area whose feature is not listed', () => {
    expect(areaOn(['inventory', 'teaching'], 'research')).toBe(false);
  });
  it('keeps core areas and listed features', () => {
    expect(areaOn(['inventory', 'teaching'], 'checklists')).toBe(true);
    expect(areaOn(['inventory', 'teaching'], 'inventory')).toBe(true);
  });
  it('is open without company context', () => {
    expect(areaOn(undefined, 'research')).toBe(true);
  });
});

describe('toFeatures', () => {
  it('keeps only known names', () => {
    expect(toFeatures(['statistics', 'bogus'])).toEqual(['statistics']);
    expect(toFeatures(null)).toEqual([]);
  });
});

describe("featureOn", () => {
  it("is true only when the feature is listed", () => {
    expect(featureOn(["inventory", "teaching"], "inventory")).toBe(true);
    expect(featureOn(["teaching"], "inventory")).toBe(false);
    expect(featureOn([], "inventory")).toBe(false);
  });
});

describe('teachingOn', () => {
  it('is true only when teaching is listed', async () => {
    const { teachingOn } = await import('./modules');
    expect(teachingOn(['inventory', 'teaching'])).toBe(true);
    expect(teachingOn(['inventory', 'statistics'])).toBe(false);
  });
});
