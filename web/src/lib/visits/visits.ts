import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { FOLLOWUP_OUTCOMES, OUTCOME_LABELS, type FollowupOutcome } from '@/lib/inventory/types';
import { YES_NO, type YesNo } from '@/lib/patients/risk-factors';

export const VISIT_STATUSES = ['upcoming', 'due', 'overdue', 'missed', 'done', 'did_not_attend', 'not_needed'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  upcoming: 'Upcoming', due: 'Due', overdue: 'Overdue', missed: 'Missed', done: 'Done',
  did_not_attend: 'Did not attend', not_needed: 'Not needed',
};
export const VISIT_STATUS_BADGE: Record<VisitStatus, string> = {
  upcoming: 'badge', due: 'badge badge-accent', overdue: 'badge badge-warn', missed: 'badge badge-bad',
  done: 'badge badge-ok', did_not_attend: 'badge badge-warn', not_needed: 'badge',
};

export const ATTENDANCE = ['attended', 'did_not_attend', 'not_needed'] as const;
export type Attendance = (typeof ATTENDANCE)[number];
export const ATTENDANCE_LABELS: Record<Attendance, string> = {
  attended: 'Attended', did_not_attend: 'Did not attend', not_needed: 'Not needed',
};

export const PROSTHESIS_STATUSES = ['stable', 'loose', 'not_restored'] as const;
export type ProsthesisStatus = (typeof PROSTHESIS_STATUSES)[number];
export const PROSTHESIS_LABELS: Record<ProsthesisStatus, string> = { stable: 'Stable', loose: 'Loose', not_restored: 'Not restored yet' };

/** The four probing sites, with their column names (database) and field names (form). */
export const PROBING_SITES = [
  { key: 'mesial', short: 'M', label: 'mesial', depth: 'probing_mesial', bop: 'bop_mesial', depthField: 'probingMesial', bopField: 'bopMesial' },
  { key: 'buccal', short: 'B', label: 'buccal', depth: 'probing_buccal', bop: 'bop_buccal', depthField: 'probingBuccal', bopField: 'bopBuccal' },
  { key: 'distal', short: 'D', label: 'distal', depth: 'probing_distal', bop: 'bop_distal', depthField: 'probingDistal', bopField: 'bopDistal' },
  { key: 'lingual', short: 'L', label: 'lingual', depth: 'probing_lingual', bop: 'bop_lingual', depthField: 'probingLingual', bopField: 'bopLingual' },
] as const;

/** One row of implant_visits (0046). Status is calculated in the database only. */
export type VisitRow = {
  site_id: string;
  tooth: number;
  visit_key: string;
  label: string;
  target_date: string;
  window_start: string;
  window_end: string;
  status: VisitStatus;
  followup_id: string | null;
};

export type VisitFindings = {
  pain_score: number | null;
  patient_concerns: string;
  swelling: YesNo | null;
  suppuration: YesNo | null;
  plaque: YesNo | null;
  mobility: YesNo | null;
  probing_mesial: number | null;
  probing_buccal: number | null;
  probing_distal: number | null;
  probing_lingual: number | null;
  bop_mesial: YesNo | null;
  bop_buccal: YesNo | null;
  bop_distal: YesNo | null;
  bop_lingual: YesNo | null;
  isq: number | null;
  prosthesis_status: ProsthesisStatus | null;
  radiograph_taken: YesNo | null;
  recommended_treatment: string;
};

export function visitResult(f: { outcome: FollowupOutcome | null; attendance: Attendance | null }): string {
  if (f.outcome) return OUTCOME_LABELS[f.outcome];
  return f.attendance ? ATTENDANCE_LABELS[f.attendance] : '';
}

const byTarget = (a: VisitRow, b: VisitRow) => (a.target_date < b.target_date ? -1 : a.target_date > b.target_date ? 1 : 0);

export function nextVisit(rows: VisitRow[], siteId: string): VisitRow | null {
  const mine = rows.filter((r) => r.site_id === siteId).sort(byTarget);
  return mine.find((r) => r.status === 'due' || r.status === 'overdue') ?? mine.find((r) => r.status === 'upcoming') ?? null;
}

export function recordableVisits(rows: VisitRow[], siteId: string): VisitRow[] {
  return rows.filter((r) => r.site_id === siteId && r.followup_id === null).sort(byTarget);
}

export function prepickVisit(rows: VisitRow[], siteId: string): string {
  const open = recordableVisits(rows, siteId);
  // Due or overdue first; visits missed long ago come after (the latest one, so old implants don't pre-pick a stale early review).
  const missed = open.filter((r) => r.status === 'missed');
  return (open.find((r) => r.status === 'due' || r.status === 'overdue') ?? missed[missed.length - 1] ?? open.find((r) => r.status === 'upcoming'))
    ?.visit_key ?? '';
}

export function summarizeFindings(f: VisitFindings): string {
  const depths = PROBING_SITES.filter((s) => f[s.depth] !== null).map((s) => `${s.short} ${f[s.depth]}`);
  const bleeding = PROBING_SITES.filter((s) => f[s.bop] === 'yes').map((s) => s.short);
  return [
    f.pain_score !== null ? `Pain ${f.pain_score}/10` : null,
    depths.length ? `PD ${depths.join(' · ')} mm` : null,
    bleeding.length ? `BOP ${bleeding.join(', ')}` : null,
    f.isq !== null ? `ISQ ${f.isq}` : null,
    f.swelling === 'yes' ? 'Swelling' : null,
    f.suppuration === 'yes' ? 'Suppuration' : null,
    f.plaque === 'yes' ? 'Plaque' : null,
    f.mobility ? (f.mobility === 'yes' ? 'Mobile' : 'No mobility') : null,
    f.prosthesis_status ? PROSTHESIS_LABELS[f.prosthesis_status] : null,
    f.radiograph_taken === 'yes' ? 'X-ray' : null,
    f.patient_concerns.trim() ? `Concerns: ${f.patient_concerns.trim()}` : null,
    f.recommended_treatment.trim() ? `Plan: ${f.recommended_treatment.trim()}` : null,
  ].filter((x): x is string => x !== null).join(' · ');
}

const blankToNull = (v: unknown) => {
  const t = typeof v === 'string' ? v.trim() : v;
  return t === '' || t === undefined || t === null ? null : t;
};
const number = (message: string, check: (n: number) => boolean) =>
  z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number({ message }).refine(check, { message }).nullable());
const choice = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.preprocess(blankToNull, z.enum(values, { message }).nullable());
const yesNo = choice(YES_NO, 'Choose yes or no.');
const text = (max: number) => z.string().trim().max(max, { message: `Keep it under ${max} characters.` }).default('');
const PROBING = 'Enter probing depths from 0 to 15 mm.';
const depth = number(PROBING, (n) => n >= 0 && n <= 15);
const VISIT_KEY = /^(early_review|osseointegration|month_6|month_12|year_([2-9]|[1-9][0-9]))$/;

export const visitSchema = z
  .object({
    siteId: z.string().uuid({ message: 'Implant not found.' }),
    patientId: z.string().uuid({ message: 'Patient not found.' }),
    date: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the visit date (today or earlier).' }),
    visitKey: z.preprocess(blankToNull, z.string().regex(VISIT_KEY, { message: 'Choose the visit.' }).nullable()),
    checkType: z.string().trim().max(60, { message: 'Keep the visit name under 60 characters.' }).default(''),
    attendance: z.enum(ATTENDANCE, { message: 'Choose whether the patient attended.' }),
    outcome: choice(FOLLOWUP_OUTCOMES, 'Choose the outcome.'),
    painScore: number('Enter a pain score from 0 to 10.', (n) => Number.isInteger(n) && n >= 0 && n <= 10),
    patientConcerns: text(1000),
    swelling: yesNo,
    suppuration: yesNo,
    plaque: yesNo,
    mobility: yesNo,
    probingMesial: depth,
    probingBuccal: depth,
    probingDistal: depth,
    probingLingual: depth,
    bopMesial: yesNo,
    bopBuccal: yesNo,
    bopDistal: yesNo,
    bopLingual: yesNo,
    isq: number('Enter an ISQ from 0 to 100.', (n) => n >= 0 && n <= 100),
    prosthesisStatus: choice(PROSTHESIS_STATUSES, 'Choose the prosthesis status from the list.'),
    radiographTaken: yesNo,
    recommendedTreatment: text(1000),
    notes: text(1000),
  })
  .superRefine((v, ctx) => {
    if (!v.visitKey && !v.checkType) {
      ctx.addIssue({ code: 'custom', path: ['checkType'], message: 'Enter what the visit was for (e.g. pain review).' });
    }
    if (v.attendance === 'attended' && !v.outcome) ctx.addIssue({ code: 'custom', path: ['outcome'], message: 'Choose the outcome.' });
    if (v.attendance === 'not_needed' && !v.notes) {
      ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Say why the visit was not needed.' });
    }
  })
  .transform((v) => {
    if (v.attendance !== 'attended') {
      // Values typed before switching to "did not attend" / "not needed" are not findings.
      return {
        ...v, outcome: null, painScore: null, patientConcerns: '', swelling: null, suppuration: null, plaque: null, mobility: null,
        probingMesial: null, probingBuccal: null, probingDistal: null, probingLingual: null,
        bopMesial: null, bopBuccal: null, bopDistal: null, bopLingual: null,
        isq: null, prosthesisStatus: null, radiographTaken: null, recommendedTreatment: '',
      };
    }
    // An untick on a probed site means no bleeding; an unprobed site's bleeding is not assessed.
    const bop = (b: YesNo | null, d: number | null): YesNo | null => b ?? (d !== null ? 'no' : null);
    return {
      ...v,
      bopMesial: bop(v.bopMesial, v.probingMesial),
      bopBuccal: bop(v.bopBuccal, v.probingBuccal),
      bopDistal: bop(v.bopDistal, v.probingDistal),
      bopLingual: bop(v.bopLingual, v.probingLingual),
    };
  });

export type VisitInput = z.output<typeof visitSchema>;

/** The findings object record_visit expects: snake_case keys, nothing that was not assessed. */
export function toFindings(v: VisitInput): Record<string, string | number> {
  const all: Record<string, string | number | null> = {
    pain_score: v.painScore, patient_concerns: v.patientConcerns, swelling: v.swelling, suppuration: v.suppuration,
    plaque: v.plaque, mobility: v.mobility, probing_mesial: v.probingMesial, probing_buccal: v.probingBuccal,
    probing_distal: v.probingDistal, probing_lingual: v.probingLingual, bop_mesial: v.bopMesial, bop_buccal: v.bopBuccal,
    bop_distal: v.bopDistal, bop_lingual: v.bopLingual, isq: v.isq, prosthesis_status: v.prosthesisStatus,
    radiograph_taken: v.radiographTaken, recommended_treatment: v.recommendedTreatment,
  };
  return Object.fromEntries(Object.entries(all).filter(([, x]) => x !== null && x !== '')) as Record<string, string | number>;
}
