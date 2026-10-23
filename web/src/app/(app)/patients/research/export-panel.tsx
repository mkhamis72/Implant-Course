import { RESEARCH_FILTER_KEYS, type ResearchFilters } from '@/lib/research/view';
import { formatDateTime } from '@/lib/format';

/** GET form to the export route; the current filters ride along as hidden fields. */
export function ExportForm({ filters }: { filters: ResearchFilters }) {
  return (
    <form className="card flex flex-wrap items-center gap-4" action="/patients/research/export" method="get" aria-label="Export">
      {RESEARCH_FILTER_KEYS.filter((k) => filters[k]).map((k) => <input key={k} type="hidden" name={k} value={filters[k]} />)}
      <span className="label !mb-0">Export these implants (anonymised)</span>
      <label className="flex items-center gap-2"><input type="radio" name="format" value="xlsx" defaultChecked /> Excel (.xlsx)</label>
      <label className="flex items-center gap-2"><input type="radio" name="format" value="csv" /> CSV files (.zip)</label>
      <button className="btn">Export</button>
    </form>
  );
}

export type ExportLogRow = {
  id: string
  exported_at: string
  format: string
  filters: Record<string, string | null>
  row_counts: Record<string, number>
  exporter: string | null
}

const describe = (o: Record<string, unknown>, sep: string) => Object.entries(o).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k} ${v}`).join(sep);

/** Admins only: who exported what. */
export function ExportLog({ isAdmin, rows }: { isAdmin: boolean; rows: ExportLogRow[] }) {
  if (!isAdmin) return null;
  return (
    <section className="card space-y-3" aria-labelledby="recent-exports">
      <h2 id="recent-exports">Recent exports</h2>
      {rows.length === 0 ? <p className="text-muted">No exports yet.</p> : (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Format</th><th>Filters</th><th>Rows</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="When">{formatDateTime(r.exported_at)}</td>
                <td data-label="Who">{r.exporter ?? 'Unknown'}</td>
                <td data-label="Format">{r.format === 'xlsx' ? 'Excel' : 'CSV zip'}</td>
                <td data-label="Filters">{describe(r.filters, ', ') || 'None'}</td>
                <td data-label="Rows">{describe(r.row_counts, ', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
