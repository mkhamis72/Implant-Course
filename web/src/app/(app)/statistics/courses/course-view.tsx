import { Fragment } from 'react';
import Link from 'next/link';
import { courseExploreHref, metricRows, type CourseSummary } from '@/lib/analysis/course-overview';
import { formatDate } from '@/lib/format';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function MetricTable({ label, summaries }: { label: string; summaries: CourseSummary[] }) {
  const rows = metricRows(summaries);
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <div className="overflow-x-auto">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            <th>Measure</th>
            {summaries.map((s) => <th key={s.id}>{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group}>
              <tr>
                <td colSpan={summaries.length + 1} data-label="Section" className="font-medium">{group}</td>
              </tr>
              {rows.filter((r) => r.group === group).map((r) => (
                <tr key={r.label}>
                  <td data-label="Measure">{r.label}</td>
                  {r.values.map((v, i) => <td key={summaries[i].id} data-label={summaries[i].name}>{v}</td>)}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CourseLine({ summary: s }: { summary: CourseSummary }) {
  const parts = [s.name, ...(s.startDate ? [formatDate(s.startDate)] : []), plural(s.implants, 'implant'), plural(s.patients, 'patient')];
  return <span>{parts.join(' · ')}</span>;
}

/** GET form: the ticked courses live in the address (`c=`), so a comparison can be shared. */
export function CourseView({ summaries, selected }: { summaries: CourseSummary[]; selected: CourseSummary[] }) {
  if (summaries.length === 0) return <p className="text-muted">No courses yet.</p>;
  const ticked = new Set(selected.map((s) => s.id));
  return (
    <div className="space-y-6">
      {selected.length >= 2 && (
        <section className="card space-y-3">
          <h2>Side by side</h2>
          <p className="text-sm text-muted">Counts describe each course; they are not a ranking. Later courses have had less time for follow-up.</p>
          {selected.some((s) => s.thin) && (
            <p className="rounded-md bg-warn-soft p-3 text-sm text-warn">⚠ A course here has under 30 implants: read its counts as a small sample.</p>
          )}
          <MetricTable label="Side-by-side comparison" summaries={selected} />
          <Link href={courseExploreHref(selected.map((s) => s.id))} className="text-accent hover:underline">Explore these courses</Link>
        </section>
      )}
      {/* Keyed: a checkbox ticked by hand keeps its state across a re-render of the same route. */}
      <form key={[...ticked].join()} className="space-y-3" aria-label="Courses">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn">Compare</button>
          {selected.length > 0 && <Link href="/statistics/courses" className="text-accent hover:underline">Clear</Link>}
          {selected.length === 1 && <span className="text-sm text-muted">Tick at least two courses to compare them.</span>}
        </div>
        <ul className="space-y-3">
          {summaries.map((s) => (
            <li key={s.id} className="card flex items-start gap-3">
              <input type="checkbox" className="mt-1" name="c" value={s.id} defaultChecked={ticked.has(s.id)} aria-label={`Compare ${s.name}`} />
              <details className="min-w-0 flex-1 space-y-3">
                <summary className="cursor-pointer">
                  <CourseLine summary={s} />
                  {s.thin && <span className="ml-2 text-sm text-warn">⚠ Small sample</span>}
                </summary>
                <MetricTable label={`${s.name} in detail`} summaries={[s]} />
                <Link href={courseExploreHref([s.id])} className="text-accent hover:underline">{`Explore ${s.name}`}</Link>
              </details>
            </li>
          ))}
        </ul>
      </form>
    </div>
  );
}
