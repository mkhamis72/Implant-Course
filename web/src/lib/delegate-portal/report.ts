import { toCsv } from '@/lib/csv';
import { productLabel } from '@/lib/inventory/labels';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState, type Technique } from '@/lib/inventory/types';

/** A row of public.my_report(): the signed-in delegate's own implants. */
export type MyReportRow = {
  site_id: string; role: 'placing' | 'assisting'; course_name: string | null; patient_name: string; file_no: string;
  tooth: number; state: string; placed_on: string | null; brand: string | null; system: string | null; platform: string | null;
  diameter_mm: number | null; length_mm: number | null; description: string | null; lot_no: string | null;
  last_outcome: string | null; technique: Technique | null;
};

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

export function myReportCsv(rows: MyReportRow[]): string {
  return toCsv(
    ['Course', 'Patient', 'File', 'Tooth', 'Role', 'Implant', 'Technique', 'Lot', 'Placed on', 'State', 'Last follow-up'],
    rows.map((r) => [
      r.course_name ?? '', r.patient_name, r.file_no, r.tooth, roleLabel(r), r.brand ? implantOf(r) : '',
      r.technique ? TECHNIQUE_LABELS[r.technique] : '', r.lot_no ?? '', r.placed_on ?? '', stateLabel(r), outcomeLabel(r),
    ]),
  );
}
