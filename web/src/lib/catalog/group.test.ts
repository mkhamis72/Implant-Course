import { describe, it, expect } from 'vitest';
import { groupCatalog, itemLabel, type CatalogItem, type CompanyProduct } from './group';

const item = (id: string, over: Partial<CatalogItem> = {}): CatalogItem => ({
  id, type: 'implant', brand: 'Oxy Implant', system: 'PSK-MDK · PSK Normo', platform: 'Standard conical',
  diameter_mm: 4, length_mm: 10, ref_code: `R${id}`, description: '', retired: false, ...over,
});
const product = (id: string, over: Partial<CompanyProduct> = {}): CompanyProduct => ({
  id, type: 'implant', brand: 'Oxy Implant', system: 'PSK-MDK · PSK Normo', platform: '', diameter_mm: 4, length_mm: 10,
  ref_code: '', description: '', active: true, is_sample: false, catalog_item_id: null, ...over,
});

describe('itemLabel', () => {
  it('shows the size, then the description; else the ref code', () => {
    expect(itemLabel(item('a'))).toBe('Ø4.0 × 10 mm');
    expect(itemLabel(item('a', { type: 'healing_abutment', diameter_mm: null, length_mm: null, description: 'Cuff 3 mm' })))
      .toBe('Cuff 3 mm');
    expect(itemLabel(item('a', { type: 'ti_base', diameter_mm: null, length_mm: null }))).toBe('Ra');
  });
});

describe('groupCatalog', () => {
  it('groups brand → system → platform → type, with on / total counts', () => {
    const items = [
      item('1'), item('2', { length_mm: 11.5 }),
      item('3', { system: 'MD EXT · Standard', platform: 'Internal hex' }),
      item('4', { type: 'healing_abutment', diameter_mm: null, length_mm: null, description: 'H' }),
    ];
    const g = groupCatalog(items, [product('p1', { catalog_item_id: '1' }), product('p4', { catalog_item_id: '4' })]);
    expect(g.brands).toHaveLength(1);
    const [brand] = g.brands;
    expect({ on: brand.on, total: brand.total }).toEqual({ on: 2, total: 4 });
    expect(brand.systems.map((s) => [s.system, s.on, s.total])).toEqual([
      ['MD EXT · Standard', 0, 1], ['PSK-MDK · PSK Normo', 2, 3],
    ]);
    const normo = brand.systems[1];
    expect(normo.platforms.map((p) => p.platform)).toEqual(['Standard conical']);
    expect(normo.platforms[0].types.map((t) => [t.type, t.rows.map((r) => [r.itemId, r.on])])).toEqual([
      ['implant', [['1', true], ['2', false]]],
      ['healing_abutment', [['4', true]]],
    ]);
  });

  it('counts a linked but inactive product as off', () => {
    const g = groupCatalog([item('1')], [product('p1', { catalog_item_id: '1', active: false })]);
    expect(g.brands[0].on).toBe(0);
    expect(g.brands[0].systems[0].platforms[0].types[0].rows[0].on).toBe(false);
  });

  it('lists hand-entered products under own, leaving out inactive samples', () => {
    const g = groupCatalog([], [
      product('own', { brand: 'Local', system: '', type: 'other', description: 'Healing cap' }),
      product('off', { brand: 'Local', active: false }),
      product('sample', { brand: 'Straumann', is_sample: true, active: false }),
      product('linked', { catalog_item_id: 'x' }),
    ]);
    expect(g.own.map((o) => [o.productId, o.on])).toEqual([['own', true], ['off', false]]);
    expect(g.own[0].label).toBe('Local · Healing cap');
  });

  it('ignores retired items in counts and brand ticks', () => {
    const items = [item('1'), item('2', { retired: true }), item('3', { retired: true })];
    const g = groupCatalog(items, [product('p3', { catalog_item_id: '3' })]);
    const [brand] = g.brands;
    expect({ on: brand.on, total: brand.total }).toEqual({ on: 0, total: 1 });
    // A retired item stays listed only while the company still has it on, so it can be switched off.
    expect(brand.systems[0].platforms[0].types[0].rows.map((r) => [r.itemId, r.retired, r.on])).toEqual([
      ['1', false, false], ['3', true, true],
    ]);
  });
});
