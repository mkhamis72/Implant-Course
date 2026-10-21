import { describe, expect, it } from 'vitest';
import { impressionSchema, impressionSummary } from './impression';

describe('impressionSummary', () => {
  it('says not taken without a type', () => {
    expect(impressionSummary({ impression_type: null, impression_taken_on: null })).toBe('Not taken');
  });
  it('names the type, with the date when known', () => {
    expect(impressionSummary({ impression_type: 'digital_scan', impression_taken_on: null })).toBe('Digital scan');
    expect(impressionSummary({ impression_type: 'digital_scan', impression_taken_on: '2026-11-03' })).toBe('Digital scan · 03 Nov 2026');
  });
});

describe('impressionSchema', () => {
  const base = { siteId: 's', patientId: 'p', expectedUpdatedAt: '2026-10-21T10:00:00Z' };
  it('maps a blank type to null and drops the date', () => {
    const r = impressionSchema.parse({ ...base, type: '', takenOn: '2026-11-03' });
    expect(r.type).toBeNull();
    expect(r.takenOn).toBeNull();
  });
  it('keeps the date for a real type and treats a blank date as null', () => {
    expect(impressionSchema.parse({ ...base, type: 'conventional', takenOn: '2026-11-03' }).takenOn).toBe('2026-11-03');
    expect(impressionSchema.parse({ ...base, type: 'conventional', takenOn: '' }).takenOn).toBeNull();
  });
  it('rejects an unknown type', () => {
    expect(impressionSchema.safeParse({ ...base, type: 'photo' }).success).toBe(false);
  });
});
