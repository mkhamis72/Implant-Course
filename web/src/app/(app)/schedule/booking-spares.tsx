import { productLabel } from '@/lib/inventory/labels';
import type { BookingSpare } from '@/lib/schedule/types';

/** A booking card's spare implants (0125): one line per tooth that has any, in position order; nothing without spares. */
export function BookingSpares({ spares }: { spares: BookingSpare[] }) {
  const byTooth = new Map<number, BookingSpare[]>();
  for (const s of [...spares].sort((a, b) => a.tooth - b.tooth || a.position - b.position)) {
    if (s.product) byTooth.set(s.tooth, [...(byTooth.get(s.tooth) ?? []), s]);
  }
  if (byTooth.size === 0) return null;
  return (
    <>
      {[...byTooth].map(([tooth, list]) => (
        <div key={tooth}>Tooth {tooth} · Spares: {list.map((s) => productLabel(s.product!)).join(', ')}</div>
      ))}
    </>
  );
}
