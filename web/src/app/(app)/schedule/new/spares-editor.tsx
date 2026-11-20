'use client';

import { productLabel } from '@/lib/inventory/labels';
import type { Product } from '@/lib/inventory/types';
import { MAX_SPARES } from '@/lib/schedule/schemas';

type Props = {
  /** The tooth as typed in its row (may still be empty): names the selects. */
  tooth: string;
  /** Spare product ids in order; '' is a spare not chosen yet. */
  value: string[];
  products: Product[];
  onChange: (value: string[]) => void;
};

/** A tooth's spare implants (0125): up to 5, each chosen from the same implant list as the planned one. */
export function SparesEditor({ tooth, value, products, onChange }: Props) {
  const of = (n: number) => `${n + 1}${tooth.trim() ? ` for tooth ${tooth.trim()}` : ''}`;
  return (
    <div className="space-y-1 pl-4 text-sm">
      <span className="text-muted">Spares</span>
      {value.map((id, n) => (
        <div key={n} className="flex items-center gap-2">
          <select
            className="input flex-1 py-1"
            aria-label={`Spare ${of(n)}`}
            value={id}
            onChange={(e) => onChange(value.map((v, j) => (j === n ? e.target.value : v)))}
          >
            <option value="">Choose a spare…</option>
            {products.map((pr) => <option key={pr.id} value={pr.id}>{productLabel(pr)}</option>)}
          </select>
          <button
            type="button"
            className="px-2 text-muted hover:text-bad"
            aria-label={`Remove spare ${of(n)}`}
            onClick={() => onChange(value.filter((_, j) => j !== n))}
          >
            ×
          </button>
        </div>
      ))}
      {value.length < MAX_SPARES && (
        <button type="button" className="block text-accent hover:underline" onClick={() => onChange([...value, ''])}>
          + Add spare
        </button>
      )}
    </div>
  );
}
