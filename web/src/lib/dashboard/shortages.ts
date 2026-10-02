import type { PullRow } from '@/lib/schedule/types';

export type ShortageRow = PullRow & { day: 'Today' | 'Tomorrow' };

/**
 * Products the next two days' planned implants are short of. Tomorrow is compared against what
 * is left after today's planned implants are used, not against today's full stock.
 */
export function dashboardShortages(today: readonly PullRow[], tomorrow: readonly PullRow[]): ShortageRow[] {
  const todayNeed = new Map(today.filter((r) => r.product_id).map((r) => [r.product_id as string, r.needed]));
  const rows: ShortageRow[] = [
    ...today.map((r) => ({ ...r, day: 'Today' as const })),
    ...tomorrow.map((r) => ({
      ...r,
      day: 'Tomorrow' as const,
      available: Math.max(0, r.available - (r.product_id ? (todayNeed.get(r.product_id) ?? 0) : 0)),
    })),
  ];
  return rows.filter((r) => r.product_id && r.needed > r.available);
}
