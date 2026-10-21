import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canSeeImplants, reportAccessNote } from '@/lib/auth/permissions';
import { formatDate, formatTime } from '@/lib/format';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState, type Technique } from '@/lib/inventory/types';
import type { Course } from '@/lib/schedule/types';
import {
  bySession, implantLabel, restorationStageLabel, restorationStatus, restorationTypeLabel, summarise,
  type CourseReportRow, type CourseRestorationRow, type Stats, type Summary,
} from '@/lib/reports/course-report';
import { describeTeeth } from '@/lib/restorations/restorations';
import { PrintButton } from '../../../schedule/pull-list/print-button';

const dash = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v));
const statLine = (label: string, s: Stats, unit = '') =>
  s.n === 0 ? `${label}: not recorded` : `${label}: mean ${s.mean}${unit} · median ${s.median}${unit} · range ${s.min}–${s.max}${unit} (n=${s.n})`;
const counts = (rec: Record<string, number>, label: (k: string) => string = (k) => k) =>
  Object.entries(rec)
    .map(([k, n]) => `${label(k)} ${n}`)
    .join(' · ') || '—';
const techniqueLabel = (k: string) => (k === 'not_set' ? 'Not set' : (TECHNIQUE_LABELS[k as Technique] ?? k));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function SummaryLine({ s }: { s: Summary }) {
  return (
    <p className="text-sm">
      {plural(s.implants, 'implant')} · {plural(s.patients, 'patient')} · {counts(s.byTechnique, techniqueLabel)}
      {s.torque.n > 0 && <> · torque {s.torque.mean} Ncm mean</>}
      {s.isq.n > 0 && <> · ISQ {s.isq.mean} mean</>}
    </p>
  );
}

export default async function CourseReportPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePermission('courses');
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: course }, { data, error }, { data: restoData, error: restoError }] = await Promise.all([
    supabase.from('courses').select('*').eq('id', id).maybeSingle(),
    supabase.rpc('course_report', { p_course: id }),
    supabase.rpc('course_restorations', { p_course: id }),
  ]);
  if (!course) notFound();
  if (error || restoError) throw new Error('Could not load the course report');
  const c = course as Course;
  const rows = (data ?? []) as CourseReportRow[];
  const restorations = (restoData ?? []) as CourseRestorationRow[];
  const all = summarise(rows, restorations);
  const sessions = bySession(rows);
  const note = reportAccessNote(profile);

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="page-header">
        <div>
          <h1>Report · {c.name}</h1>
          <p className="text-muted">
            {formatDate(c.start_date)} – {formatDate(c.end_date)}
            {c.venue && <> · {c.venue}</>}
          </p>
        </div>
        <div className="flex items-center gap-3 print:hidden">
          <Link href={`/courses/${c.id}`} className="text-accent hover:underline">Back to course</Link>
          <a href={`/courses/${c.id}/report.csv`} className="btn-secondary btn" download>Download CSV</a>
          <PrintButton />
        </div>
      </div>
      {note && <p className="rounded-md bg-warn-soft p-3 text-sm text-warn">{note}</p>}
      {/* Without access to implant records the figures below would read as "nothing placed". */}
      {canSeeImplants(profile) && (
        <>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
        <div className="card space-y-1">
          <h2 className="font-semibold">Totals</h2>
          <p className="text-sm">{plural(all.implants, 'implant')} · {plural(all.restorations, 'restoration')} · {plural(all.patients, 'patient')}</p>
          <p className="text-sm text-muted">{counts(all.byState, (k) => SITE_STATE_LABELS[k as SiteState] ?? k)}</p>
        </div>
        <div className="card space-y-1">
          <h2 className="font-semibold">Technique</h2>
          <p className="text-sm">{counts(all.byTechnique, techniqueLabel)}</p>
        </div>
        <div className="card space-y-1">
          <h2 className="font-semibold">Stability</h2>
          <p className="text-sm">{statLine('Torque', all.torque, ' Ncm')}</p>
          <p className="text-sm">{statLine('ISQ', all.isq)}</p>
        </div>
        <div className="card space-y-1">
          <h2 className="font-semibold">Bone type</h2>
          <p className="text-sm">{counts(all.byBoneType)}</p>
        </div>
        <div className="card space-y-1 sm:col-span-2">
          <h2 className="font-semibold">Implant sizes</h2>
          <p className="text-sm">{counts(all.bySize)}</p>
        </div>
      </section>

      <section className="card space-y-2 break-inside-avoid" data-testid="report-delegates">
        <h2 className="font-semibold">Implants by delegate</h2>
        {all.delegates.length === 0 ? (
          <p className="text-sm text-muted">No implants placed yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Delegate</th>
                <th>Placed</th>
                <th>Assisted</th>
                <th>Mean torque (Ncm)</th>
                <th>Restored</th>
              </tr>
            </thead>
            <tbody>
              {all.delegates.map((d) => (
                <tr key={d.name}>
                  <td data-label="Delegate">{d.name}</td>
                  <td data-label="Placed">{d.placed}</td>
                  <td data-label="Assisted">{d.assisted}</td>
                  <td data-label="Mean torque (Ncm)">{dash(d.meanTorque)}</td>
                  <td data-label="Restored">{d.restored}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {sessions.map((g) => (
        <section key={g.sessionId ?? 'unlinked'} data-testid="report-session" className="card space-y-2 break-inside-avoid">
          <h2 className="font-semibold">
            {g.title}
            {g.date && <span className="font-normal text-muted"> · {formatDate(g.date)}</span>}
          </h2>
          <SummaryLine s={g.summary} />
          <div className="overflow-x-auto print:overflow-visible">
            <table className="table print:text-[10px]">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Tooth</th>
                  <th>Implant</th>
                  <th>Lot</th>
                  <th>Placed by</th>
                  <th>Assisted by</th>
                  <th>Supervisor</th>
                  <th>Torque (Ncm)</th>
                  <th>ISQ</th>
                  <th>Bone</th>
                  <th>Technique</th>
                  <th>State</th>
                  <th>Last follow-up</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.site_id} data-testid="report-implant">
                    <td data-label="Time">{r.slot_start ? formatTime(r.slot_start) : r.placed_on ? formatDate(r.placed_on) : '—'}</td>
                    <td data-label="Patient">{r.patient_name} ({r.file_no})</td>
                    <td data-label="Tooth">{r.tooth}</td>
                    <td data-label="Implant">{implantLabel(r)}</td>
                    <td data-label="Lot">{dash(r.lot_no)}</td>
                    <td data-label="Placed by">{dash(r.placing_delegate)}</td>
                    <td data-label="Assisted by">{dash(r.assisting_delegate)}</td>
                    <td data-label="Supervisor">{dash(r.supervisor)}</td>
                    <td data-label="Torque">{dash(r.torque_ncm)}</td>
                    <td data-label="ISQ">{dash(r.isq)}</td>
                    <td data-label="Bone">{dash(r.bone_type)}</td>
                    <td data-label="Technique">{r.technique ? TECHNIQUE_LABELS[r.technique as Technique] : '—'}</td>
                    <td data-label="State">{SITE_STATE_LABELS[r.state as SiteState] ?? r.state}</td>
                    <td data-label="Last follow-up">{r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {sessions.length === 0 && <p className="card text-muted">No implants placed in this course yet.</p>}

      <section className="card space-y-2 break-inside-avoid" data-testid="report-restorations">
        <h2 className="font-semibold">Restorations</h2>
        {restorations.length === 0 ? (
          <p className="text-sm text-muted">No restorations fitted in this course yet.</p>
        ) : (
          <div className="overflow-x-auto print:overflow-visible">
            <table className="table print:text-[10px]">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Teeth</th>
                  <th>Stage</th>
                  <th>Type</th>
                  <th>Fitted</th>
                  <th>Delegate</th>
                  <th>Supervisor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {restorations.map((r) => (
                  <tr key={r.restoration_id} data-testid="report-restoration">
                    <td data-label="Patient">{r.patient_name} ({r.file_no})</td>
                    <td data-label="Teeth">{describeTeeth(r.teeth)}</td>
                    <td data-label="Stage">{restorationStageLabel(r.stage)}</td>
                    <td data-label="Type">{restorationTypeLabel(r.type)}</td>
                    <td data-label="Fitted">{formatDate(r.fitted_on)}</td>
                    <td data-label="Delegate">{dash(r.delegate)}</td>
                    <td data-label="Supervisor">{dash(r.supervisor)}</td>
                    <td data-label="Status">{restorationStatus(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}
