import { toCsv } from '@/lib/csv';
import { productLabel } from '@/lib/inventory/labels';
import { describeTeeth, RESTORATION_TYPE_LABELS, STAGE_LABELS, type RestorationStage, type RestorationType } from '@/lib/restorations/restorations';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState, type Technique } from '@/lib/inventory/types';

/** A row of public.course_report(course): one implant placed in the course. */
export type CourseReportRow = {
  site_id: string; session_id: string | null; session_title: string | null; session_date: string | null; slot_start: string | null;
  patient_name: string; file_no: string; tooth: number; state: string; placed_on: string | null;
  placing_delegate: string | null; assisting_delegate: string | null; supervisor: string | null;
  brand: string | null; system: string | null; platform: string | null; diameter_mm: number | string | null; length_mm: number | string | null;
  description: string | null; lot_no: string | null;
  torque_ncm: number | string | null; isq: number | string | null; bone_type: string | null; technique: string | null; graft: string;
  last_outcome: string | null;
};
/** A row of public.course_restorations(course): one restoration fitted in the course. */
export type CourseRestorationRow = {
  restoration_id: string; patient_name: string; file_no: string; teeth: number[]; stage: string; type: string; fitted_on: string;
  delegate_id: string | null; delegate: string | null; supervisor: string | null; ended_on: string | null; end_kind: string | null;
};
export type Stats = { n: number; mean: number | null; median: number | null; min: number | null; max: number | null };
export type Summary = {
  implants: number;
  restorations: number;
  patients: number;
  byTechnique: Record<string, number>;
  byState: Record<string, number>;
  byBoneType: Record<string, number>;
  bySize: Record<string, number>;
  torque: Stats;
  isq: Stats;
  delegates: { name: string; placed: number; assisted: number; meanTorque: number | null; restored: number }[];
  supervisors: { name: string; count: number }[];
};
export type SessionGroup = { sessionId: string | null; title: string; date: string | null; rows: CourseReportRow[]; summary: Summary };

export const UNLINKED = 'Not linked to a session';

// PostgREST returns numeric as a JSON number; strings are tolerated.
const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Count, mean, median and range of the recorded values; nulls (not recorded) are ignored. */
export function stats(values: (number | string | null)[]): Stats {
  const xs = values
    .map(num)
    .filter((v): v is number => v !== null && !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, mean: null, median: null, min: null, max: null };
  const mid = Math.floor(xs.length / 2);
  const median = round1(xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
  return { n: xs.length, mean: round1(xs.reduce((a, b) => a + b, 0) / xs.length), median, min: xs[0], max: xs[xs.length - 1] };
}

/** Placed implants always have an implant product. */
export function implantLabel(r: CourseReportRow): string {
  if (!r.brand) return '—';
  return productLabel({
    type: 'implant', brand: r.brand, system: r.system ?? '', platform: r.platform ?? '', description: r.description ?? '',
    diameter_mm: num(r.diameter_mm), length_mm: num(r.length_mm),
  });
}

function tally(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

export const restorationStatus = (r: Pick<CourseRestorationRow, 'ended_on' | 'end_kind'>) =>
  r.ended_on === null ? 'Current' : r.end_kind === 'remade' ? 'Remade' : 'Replaced';
export const restorationStageLabel = (s: string) => STAGE_LABELS[s as RestorationStage] ?? s;
export const restorationTypeLabel = (t: string) => RESTORATION_TYPE_LABELS[t as RestorationType] ?? t;

export function summarise(rows: CourseReportRow[], restorations: CourseRestorationRow[] = []): Summary {
  const people = new Map<string, { placed: number; assisted: number; torques: (number | string | null)[]; restored: number }>();
  const person = (name: string) => {
    if (!people.has(name)) people.set(name, { placed: 0, assisted: 0, torques: [], restored: 0 });
    return people.get(name)!;
  };
  for (const r of rows) {
    if (r.placing_delegate) {
      const p = person(r.placing_delegate);
      p.placed += 1;
      p.torques.push(r.torque_ncm);
    }
    if (r.assisting_delegate) person(r.assisting_delegate).assisted += 1;
  }
  for (const r of restorations) if (r.delegate) person(r.delegate).restored += 1;
  const sup = tally(rows.map((r) => r.supervisor).filter((s): s is string => Boolean(s)));
  return {
    implants: rows.length,
    restorations: restorations.length,
    patients: new Set(rows.map((r) => r.file_no)).size,
    byTechnique: tally(rows.map((r) => r.technique ?? 'not_set')),
    byState: tally(rows.map((r) => r.state)),
    byBoneType: tally(rows.map((r) => r.bone_type ?? 'Not recorded')),
    bySize: tally(rows.map(implantLabel)),
    torque: stats(rows.map((r) => r.torque_ncm)),
    isq: stats(rows.map((r) => r.isq)),
    delegates: [...people.entries()]
      .map(([name, p]) => ({ name, placed: p.placed, assisted: p.assisted, meanTorque: stats(p.torques).mean, restored: p.restored }))
      .sort((a, b) => b.placed - a.placed || a.name.localeCompare(b.name)),
    supervisors: Object.entries(sup)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** One group per surgery session, by date; placements not linked to a session come last. */
export function bySession(rows: CourseReportRow[]): SessionGroup[] {
  const groups = new Map<string, { sessionId: string | null; title: string; date: string | null; rows: CourseReportRow[] }>();
  for (const r of rows) {
    const key = r.session_id ?? '__unlinked';
    if (!groups.has(key)) groups.set(key, { sessionId: r.session_id, title: r.session_title ?? UNLINKED, date: r.session_date, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  return [...groups.values()]
    .sort((a, b) => (a.sessionId === null ? 1 : b.sessionId === null ? -1 : (a.date ?? '').localeCompare(b.date ?? '')))
    .map((g) => ({ ...g, summary: summarise(g.rows) }));
}

/** One row per implant: ISO dates, plain numbers, empty cells for values not recorded. */
export function courseReportCsv(rows: CourseReportRow[], restorations: CourseRestorationRow[] = []): string {
  const implants = toCsv(
    [
      'Session', 'Session date', 'Patient', 'File', 'Tooth', 'Placed on', 'State', 'Placed by', 'Assisted by', 'Supervisor',
      'Brand', 'System', 'Diameter (mm)', 'Length (mm)', 'Implant', 'Lot', 'Torque (Ncm)', 'ISQ', 'Bone type', 'Technique', 'Graft',
      'Last follow-up',
    ],
    rows.map((r) => [
      r.session_title ?? UNLINKED, r.session_date ?? '', r.patient_name, r.file_no, r.tooth, r.placed_on ?? '',
      SITE_STATE_LABELS[r.state as SiteState] ?? r.state, r.placing_delegate ?? '', r.assisting_delegate ?? '', r.supervisor ?? '',
      r.brand ?? '', r.system ?? '', num(r.diameter_mm), num(r.length_mm), r.brand ? implantLabel(r) : '', r.lot_no ?? '',
      num(r.torque_ncm), num(r.isq), r.bone_type ?? '', r.technique ? TECHNIQUE_LABELS[r.technique as Technique] : '', r.graft,
      r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '',
    ]),
  );
  if (restorations.length === 0) return implants;
  // A second table after a blank line; the leading column says what kind of row it is.
  const section = toCsv(
    ['restoration', 'patient', 'file_no', 'teeth', 'stage', 'type', 'fitted_on', 'delegate', 'status'],
    restorations.map((r) => [
      'restoration', r.patient_name, r.file_no, describeTeeth(r.teeth), restorationStageLabel(r.stage), restorationTypeLabel(r.type),
      r.fitted_on, r.delegate ?? '', restorationStatus(r),
    ]),
  );
  return `${implants}\r\n${section.replace(/^\uFEFF/, '')}`;
}
