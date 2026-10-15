import { describe, it, expect } from 'vitest';
import { onHandByProduct, pathOf, pickerState, sizeLabel } from './implant-picker';
import type { LotOnHand, Product } from './types';

const implant = (id: string, system: string, d: number, l: number, brand = 'Oxy Implant') =>
  ({ id, type: 'implant', brand, system, platform: '', diameter_mm: d, length_mm: l, description: '' }) as Product;
const lot = (product_id: string, on_hand: number, expiry: string | null = null) =>
  ({ stock_lot_id: `${product_id}-${on_hand}`, product_id, lot_no: null, expiry, received_on: '2026-01-01', qty_received: on_hand, on_hand }) as LotOnHand;

const micro10 = implant('m10', 'PSK-MDK · PSK Micro', 4, 10);
const micro8 = implant('m8', 'PSK-MDK · PSK Micro', 4, 8.5);
const micro35 = implant('m35', 'PSK-MDK · PSK Micro', 3.5, 13);
const normo = implant('n', 'PSK-MDK · PSK Normo', 4.5, 10);
const ext = implant('x', 'MD EXT · Standard', 4.1, 11.5);
const all = [micro10, normo, ext, micro8, micro35];
const none = { brand: '', line: '', type: '' };

describe('pathOf', () => {
  it('splits the system into line and type at " · "', () => {
    expect(pathOf(micro10)).toEqual({ brand: 'Oxy Implant', line: 'PSK-MDK', type: 'PSK Micro' });
    expect(pathOf(implant('e', 'E2E', 4, 10, 'Tag'))).toEqual({ brand: 'Tag', line: 'E2E', type: '' });
  });
});

describe('pickerState', () => {
  it('fills a step with a single option and lists the next one', () => {
    const s = pickerState(all, none, null, '');
    expect(s.brands).toEqual(['Oxy Implant']);
    expect(s.sel.brand).toBe('Oxy Implant');
    expect(s.lines).toEqual(['MD EXT', 'PSK-MDK']);
    expect(s.sel.line).toBe('');
    expect(s.types).toEqual([]);
    expect(s.sizes).toEqual([]);
  });
  it('lists types of the line, then sizes by diameter and length', () => {
    const s = pickerState(all, { brand: '', line: 'PSK-MDK', type: 'PSK Micro' }, null, '');
    expect(s.types).toEqual(['PSK Micro', 'PSK Normo']);
    expect(s.sizes.map((p) => p.id)).toEqual(['m35', 'm8', 'm10']);
  });
  it('goes straight to sizes when the line has no types', () => {
    const e1 = implant('e1', 'E2E', 4, 10, 'Tag');
    const s = pickerState([e1, micro10], { brand: 'Tag', line: '', type: '' }, null, '');
    expect(s.sel.line).toBe('E2E');
    expect(s.types).toEqual([]);
    expect(s.sizes.map((p) => p.id)).toEqual(['e1']);
  });
  it('drops a later choice that the earlier ones no longer allow', () => {
    const s = pickerState(all, { brand: 'Oxy Implant', line: 'MD EXT', type: 'PSK Micro' }, null, '');
    expect(s.sel).toEqual({ brand: 'Oxy Implant', line: 'MD EXT', type: 'Standard' });
  });
  it('with stock counts, hides sizes, types and lines without stock but keeps the chosen product', () => {
    const stock = new Map([['m10', 3]]);
    expect(pickerState(all, none, stock, '').lines).toEqual(['PSK-MDK']);
    const s = pickerState(all, { brand: '', line: 'PSK-MDK', type: '' }, stock, '');
    expect(s.types).toEqual(['PSK Micro']);
    expect(s.sizes.map((p) => p.id)).toEqual(['m10']);
    expect(pickerState(all, { brand: '', line: 'PSK-MDK', type: 'PSK Normo' }, stock, 'n').sizes.map((p) => p.id)).toEqual(['n']);
  });
});

describe('onHandByProduct', () => {
  it('counts only stock usable on the day', () => {
    const counts = onHandByProduct([lot('a', 2), lot('a', 3, '2026-12-01'), lot('b', 4, '2026-09-01')], '2026-10-01');
    expect(counts.get('a')).toBe(5);
    expect(counts.get('b')).toBeUndefined();
  });
});

describe('sizeLabel', () => {
  it('shows the size and the stock', () => {
    expect(sizeLabel(micro10, 3)).toBe('Ø4.0 × 10 mm · 3 in stock');
    expect(sizeLabel(micro8, 0)).toBe('Ø4.0 × 8.5 mm · none in stock');
    expect(sizeLabel(micro8, null)).toBe('Ø4.0 × 8.5 mm');
  });
});
