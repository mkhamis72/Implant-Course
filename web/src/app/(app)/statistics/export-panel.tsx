import { RESEARCH_FILTER_KEYS, type ResearchFilters } from '@/lib/research/view';
import { formatDateTime } from '@/lib/format';

export type StudyOption = { id: string; title: string };

/** GET form to the export route; the current filters ride along as hidden fields. The study (optional) only labels the file. */
export function ExportForm({ filters, studies = [] }: { filters: ResearchFilters; studies?: StudyOption[] }) {
  return (
    <form className="card flex flex-wrap items-center gap-4" action="/statistics/export" method="get" aria-label="Export">
      {RESEARCH_FILTER_KEYS.filter((k) => filters[k]).map((k) => <input key={k} type="hidden" name={k} value={filters[k]} />)}
      <span className="label !mb-0">Export these implants (anonymised)</span>
      {studies.length > 0 && (
        <span className="flex items-center gap-2">
          <label htmlFor="export-study">Study</label>
          <select id="export-study" name="study" className="input w-auto" defaultValue="">
            <option value="">None</option>
            {studies.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </span>
      )}
      <label className="flex items-center gap-2"><input type="radio" name="format" value="xlsx" defaultChecked /> Excel (.xlsx)</label>
      <label className="flex items-center gap-2"><input type="radio" name="format" value="csv" /> CSV files (.zip)</label>
      <button className="btn">Export</button>
      <a className="text-accent" href="/statistics/analysis.R" download>Download R script</a>
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

type Names = Record<string, string>;

/** Admins only: who exported what. The log keeps course, delegate and study ids; they are shown by name / title. */
export function ExportLog({ isAdmin, rows, failed = false, courseNames = {}, delegateNames = {}, studyTitles = {} }: {
  isAdmin: boolean; rows: ExportLogRow[]; failed?: boolean; courseNames?: Names; delegateNames?: Names; studyTitles?: Names;
}) {
  if (!isAdmin) return null;
  const named = (f: Record<string, string | null>) => ({
    ...f,
    ...(f.course ? { course: courseNames[f.course] ?? '(deleted)' } : {}),
    ...(f.delegate ? { delegate: delegateNames[f.delegate] ?? '(deleted)' } : {}),
    ...(f.study ? { study: studyTitles[f.study] ?? '(deleted)' } : {}),
  });
  return (
    <section className="card space-y-3" aria-labelledby="recent-exports">
      <h2 id="recent-exports">Recent exports</h2>
      {failed ? <p className="text-bad">Could not load exports.</p> : rows.length === 0 ? <p className="text-muted">No exports yet.</p> : (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Format</th><th>Filters</th><th>Rows</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="When">{formatDateTime(r.exported_at)}</td>
                <td data-label="Who">{r.exporter ?? 'Unknown'}</td>
                <td data-label="Format">{r.format === 'xlsx' ? 'Excel' : 'CSV zip'}</td>
                <td data-label="Filters">{describe(named(r.filters), ', ') || 'None'}</td>
                <td data-label="Rows">{describe(r.row_counts, ', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
