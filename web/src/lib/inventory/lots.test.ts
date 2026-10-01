import { describe, it, expect } from 'vitest';
import { availableLots, stockFlags } from './lots';
import type { LotOnHand } from './types';

const lot = (id: string, extra: Partial<LotOnHand>): LotOnHand => ({
  stock_lot_id: id, product_id: 'p', lot_no: id, expiry: null, received_on: '2026-01-01', qty_received: 5, on_hand: 1, ...extra,
});

describe('availableLots', () => {
  it('offers usable batches of the product, soonest expiry first, no-expiry last', () => {
    const lots = [
      lot('no-expiry', {}),
      lot('late', { expiry: '2028-01-01' }),
      lot('soon', { expiry: '2026-12-01' }),
      lot('expired', { expiry: '2026-09-30' }),
      lot('empty', { on_hand: 0, expiry: '2026-11-01' }),
      lot('other', { product_id: 'q', expiry: '2026-10-15' }),
    ];
    expect(availableLots(lots, 'p', '2026-10-01').map((l) => l.stock_lot_id)).toEqual(['soon', 'late', 'no-expiry']);
  });
  it('a batch expiring today is still usable', () => {
    expect(availableLots([lot('today', { expiry: '2026-10-01' })], 'p', '2026-10-01')).toHaveLength(1);
  });
});

describe('stockFlags', () => {
  it('flags low stock and soon-expiring stock', () => {
    expect(stockFlags({ on_hand: 2, reorder_level: 3, nearest_expiry: '2026-11-15' }, '2026-10-01', 60)).toEqual({ low: true, expiring: true });
    expect(stockFlags({ on_hand: 4, reorder_level: 3, nearest_expiry: '2027-06-01' }, '2026-10-01', 60)).toEqual({ low: false, expiring: false });
    expect(stockFlags({ on_hand: 0, reorder_level: 0, nearest_expiry: null }, '2026-10-01', 60)).toEqual({ low: false, expiring: false });
  });
});
