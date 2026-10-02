import { describe, it, expect } from 'vitest';
import { CATALOG_HEADERS, catalogRow } from './catalog-csv';

describe('catalog CSV', () => {
  it('has one column per checked field, in order', () => {
    expect(CATALOG_HEADERS).toEqual(['Type', 'Brand', 'System', 'Platform', 'Diameter (mm)', 'Length (mm)', 'Ref code', 'Description', 'Sample', 'Active']);
  });
  it('maps a product to readable values', () => {
    expect(catalogRow({
      type: 'implant', brand: 'MIS', system: 'C1', platform: 'NP', diameter_mm: 3.75, length_mm: 13,
      ref_code: 'C1-37513', description: '', is_sample: true, active: true,
    })).toEqual(['Implant', 'MIS', 'C1', 'NP', 3.75, 13, 'C1-37513', '', 'yes — verify', 'yes']);
  });
});
