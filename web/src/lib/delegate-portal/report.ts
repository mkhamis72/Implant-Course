import { toCsv } from '@/lib/csv';
import { productLabel } from '@/lib/inventory/labels';
import { describeTeeth } from '@/lib/restorations/restorations';
import { restorationStageLabel, restorationTypeLabel } from '@/lib/reports/course-report';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState, type Technique } from '@/lib/inventory/types';

/** A row of public.my_report(): the signed-in delegate's own implants. */
export type MyReportRow = {
  site_id: string; role: 'placing' | 'assisting'; course_name: string | null; patient_name: string; file_no: string;
  tooth: number; state: string; placed_on: string | null; brand: string | null; system: string | null; platform: string | null;
  diameter_mm: number | null; length_mm: number | null; description: string | null; lot_no: string | null;
  last_outcome: string | null; technique: Technique | null;
};

/** A row of public.my_restorations() / delegate_restorations(): a restoration the delegate fitted. */
export type MyRestorationRow = {
  restoration_id: string; course_name: string | null; patient_name: string; file_no: string; teeth: number[];
  stage: string; type: string; fitted_on: string; ended_on: string | null;
};
/** These readers carry no end kind, so an ended restoration is just "Ended". */
export const myRestorationStatus = (r: Pick<MyRestorationRow, 'ended_on'>) => (r.ended_on === null ? 'Current' : 'Ended');

/** The restorations table appended to a delegate's CSV: a blank line, then its own header. */
export function restorationsCsvSection(restorations: MyRestorationRow[]): string {
  if (restorations.length === 0) return '';
  const section = toCsv(
    ['restoration', 'course', 'patient', 'file_no', 'teeth', 'stage', 'type', 'fitted_on', 'status'],
    restorations.map((r) => [
      'restoration', r.course_name ?? '', r.patient_name, r.file_no, describeTeeth(r.teeth), restorationStageLabel(r.stage),
      restorationTypeLabel(r.type), r.fitted_on, myRestorationStatus(r),
    ]),
  );
  return `\r\n${section.replace(/^\uFEFF/, '')}`;
}

/** Placed implants always have an implant product. */
export function implantOf(r: MyReportRow): string {
  if (!r.brand) return '—';
  return productLabel({
    type: 'implant', brand: r.brand, system: r.system ?? '', platform: r.platform ?? '', description: r.description ?? '',
    diameter_mm: r.diameter_mm, length_mm: r.length_mm,
  });
}

export const roleLabel = (r: MyReportRow) => (r.role === 'placing' ? 'Placed' : 'Assisted');
export const stateLabel = (r: MyReportRow) => SITE_STATE_LABELS[r.state as SiteState] ?? r.state;
export const outcomeLabel = (r: MyReportRow) => (r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '');

export function myReportCsv(rows: MyReportRow[], restorations: MyRestorationRow[] = []): string {
  return toCsv(
    ['Course', 'Patient', 'File', 'Tooth', 'Role', 'Implant', 'Technique', 'Lot', 'Placed on', 'State', 'Last follow-up'],
    rows.map((r) => [
      r.course_name ?? '', r.patient_name, r.file_no, r.tooth, roleLabel(r), r.brand ? implantOf(r) : '',
      r.technique ? TECHNIQUE_LABELS[r.technique] : '', r.lot_no ?? '', r.placed_on ?? '', stateLabel(r), outcomeLabel(r),
    ]),
  ) + restorationsCsvSection(restorations);
}
