import { productLabel } from '@/lib/inventory/labels';
import type { Product } from '@/lib/inventory/types';
import type { BookingSpare } from '@/lib/schedule/types';

/**
 * A booking card's implants: one line per tooth, in tooth order, with the planned implant and its spares (0125),
 * e.g. `Tooth 14 · Implant: <label> · Spares: <labels>`. Teeth with neither get no line; nothing at all renders null.
 */
export function BookingImplants({
  implants,
  spares,
}: {
  implants: { tooth: number; product: Product | null }[];
  spares: BookingSpare[];
}) {
  const teeth = new Map<number, { planned?: Product; spares: Product[] }>();
  const entry = (tooth: number) => teeth.get(tooth) ?? teeth.set(tooth, { spares: [] }).get(tooth)!;
  for (const i of implants) if (i.product) entry(i.tooth).planned = i.product;
  for (const s of [...spares].sort((a, b) => a.position - b.position)) if (s.product) entry(s.tooth).spares.push(s.product);
  if (teeth.size === 0) return null;
  return (
    <>
      {[...teeth].sort(([a], [b]) => a - b).map(([tooth, { planned, spares: list }]) => {
        const parts = [`Tooth ${tooth}`];
        if (planned) parts.push(`Implant: ${productLabel(planned)}`);
        if (list.length > 0) parts.push(`Spares: ${list.map(productLabel).join(', ')}`);
        return <div key={tooth}>{parts.join(' · ')}</div>;
      })}
    </>
  );
}
