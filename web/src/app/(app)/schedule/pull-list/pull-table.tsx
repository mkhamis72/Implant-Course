import { productLabel } from '@/lib/inventory/labels';
import type { PullRow } from '@/lib/schedule/types';

/** The day's implants: needed (planned) and spares counted apart; a shortage counts only what is needed. */
export function PullTable({ rows }: { rows: PullRow[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Implant</th>
          <th className="text-right">Needed</th>
          <th className="text-right">Spares</th>
          <th className="text-right">Usable stock</th>
          <th>Shortage</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const short = r.needed - r.available;
          return (
            <tr key={r.product_id ?? 'unchosen'} data-testid="pull-row">
              <td data-label="Implant">{r.product_id ? productLabel(r) : 'Implant not chosen yet'}</td>
              <td data-label="Needed" className="text-right">{r.needed}</td>
              <td data-label="Spares" className="text-right">{r.spares}</td>
              <td data-label="Usable stock" className="text-right">{r.product_id ? r.available : '—'}</td>
              <td data-label="Shortage">
                {r.product_id && short > 0 && <span className="badge badge-bad">Short by {short}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
