import type { Chair } from './types';

type Item = { id: string; chair_id: string; start: number; end: number };

/** Side-by-side lanes for bookings that overlap on the same chair. */
export function assignLanes(items: readonly Item[]): Record<string, { lane: number; lanes: number }> {
  const result: Record<string, { lane: number; lanes: number }> = {};
  const byChair = new Map<string, Item[]>();
  for (const item of items) byChair.set(item.chair_id, [...(byChair.get(item.chair_id) ?? []), item]);
  for (const list of byChair.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
    let group: Item[] = [];
    let groupEnd = -1;
    const laneEnds: number[] = [];
    const flush = () => {
      for (const g of group) result[g.id].lanes = laneEnds.length;
      group = [];
      laneEnds.length = 0;
    };
    for (const item of sorted) {
      if (item.start >= groupEnd) flush();
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane < 0) lane = laneEnds.push(item.end) - 1;
      else laneEnds[lane] = item.end;
      result[item.id] = { lane, lanes: 1 };
      group.push(item);
      groupEnd = Math.max(groupEnd, item.end);
    }
    flush();
  }
  return result;
}

/** Active chairs plus any inactive chair that still has bookings on the day. */
export function dayColumns(chairs: readonly Chair[], bookedChairIds: readonly string[]): { id: string; name: string }[] {
  return chairs
    .filter((c) => c.active || bookedChairIds.includes(c.id))
    .map((c) => ({ id: c.id, name: c.active ? c.name : `${c.name} (inactive)` }));
}
