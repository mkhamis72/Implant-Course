import { addDays } from '@/lib/dates';
import type { LotOnHand } from './types';

/** Batches that can be used today for this product: in stock, not expired; soonest expiry first, no expiry last. */
export function availableLots(lots: readonly LotOnHand[], productId: string, today: string): LotOnHand[] {
  return lots
    .filter((l) => l.product_id === productId && l.on_hand > 0 && !(l.expiry && l.expiry < today))
    .sort((a, b) => {
      if (a.expiry !== b.expiry) {
        if (!a.expiry) return 1;
        if (!b.expiry) return -1;
        return a.expiry < b.expiry ? -1 : 1;
      }
      return a.received_on < b.received_on ? -1 : a.received_on > b.received_on ? 1 : 0;
    });
}

export function stockFlags(
  row: { on_hand: number; reorder_level: number; nearest_expiry: string | null },
  today: string,
  alertDays: number,
): { low: boolean; expiring: boolean } {
  return {
    low: row.reorder_level > 0 && row.on_hand <= row.reorder_level,
    expiring: row.nearest_expiry !== null && row.nearest_expiry <= addDays(today, alertDays),
  };
}
