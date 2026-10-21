import { z } from 'zod';
import { addDays, isRealDate, todayIso } from '@/lib/dates';

export const RESTORATION_STAGES = ['temporary', 'final'] as const;
export type RestorationStage = (typeof RESTORATION_STAGES)[number];
export const STAGE_LABELS: Record<RestorationStage, string> = { temporary: 'Temporary', final: 'Final' };

export const RESTORATION_TYPES = ['single_crown', 'bridge', 'overdenture', 'full_arch'] as const;
export type RestorationType = (typeof RESTORATION_TYPES)[number];
export const RESTORATION_TYPE_LABELS: Record<RestorationType, string> = {
  single_crown: 'Single crown', bridge: 'Bridge', overdenture: 'Overdenture', full_arch: 'Full arch',
};

export const RETENTIONS = ['screw', 'cement', 'attachment'] as const;
export type Retention = (typeof RETENTIONS)[number];
export const RETENTION_LABELS: Record<Retention, string> = {
  screw: 'Screw-retained', cement: 'Cement-retained', attachment: 'Attachment (removable)',
};

export const MATERIALS = ['zirconia', 'lithium_disilicate', 'metal_ceramic', 'pmma_acrylic', 'composite', 'metal_framework', 'other'] as const;
export type Material = (typeof MATERIALS)[number];
export const MATERIAL_LABELS: Record<Material, string> = {
  zirconia: 'Zirconia', lithium_disilicate: 'Lithium disilicate', metal_ceramic: 'Metal-ceramic', pmma_acrylic: 'PMMA / acrylic',
  composite: 'Composite', metal_framework: 'Metal framework', other: 'Other',
};

export const PROBLEM_TYPES = ['chipping', 'fracture', 'debonding', 'screw_loosening', 'screw_fracture', 'wear', 'other'] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];
export const PROBLEM_TYPE_LABELS: Record<ProblemType, string> = {
  chipping: 'Chipping', fracture: 'Fracture', debonding: 'Debonding / loss of retention', screw_loosening: 'Screw loosening',
  screw_fracture: 'Screw fracture', wear: 'Wear', other: 'Other',
};

export const PROBLEM_ACTIONS = ['recemented', 'retightened', 'repaired', 'none', 'other'] as const;
export type ProblemAction = (typeof PROBLEM_ACTIONS)[number];
export const PROBLEM_ACTION_LABELS: Record<ProblemAction, string> = {
  recemented: 'Recemented', retightened: 'Retightened', repaired: 'Repaired / polished', none: 'None', other: 'Other',
};

export type Loading = 'immediate' | 'early' | 'conventional';
export const LOADING_LABELS: Record<Loading, string> = { immediate: 'Immediate', early: 'Early', conventional: 'Conventional' };
/** ITI consensus: immediate within 1 week of placement, early up to 2 months, conventional after. */
export const LOADING_IMMEDIATE_DAYS = 7;
export const LOADING_EARLY_MONTHS = 2;

export type RestorationProblem = {
  id: string; noticed_on: string; type: ProblemType; action: ProblemAction; notes: string; updated_at: string;
};

export type Restoration = {
  id: string;
  stage: RestorationStage;
  type: RestorationType;
  teeth: number[];
  fitted_on: string;
  retention: Retention | null;
  material: Material | null;
  delegate_id: string | null;
  supervisor_id: string | null;
  course_id: string | null;
  notes: string;
  ended_on: string | null;
  end_kind: 'replaced' | 'remade' | null;
  end_reason: string | null;
  updated_at: string;
  site_ids: string[];
  problems: RestorationProblem[];
  /** Names for display (embedded when loaded; a course the reader can't see comes back null). */
  delegate?: { full_name: string } | null;
  supervisor?: { full_name: string } | null;
  course?: { name: string } | null;
};

export const ARCH_ORDER: { upper: number[]; lower: number[] } = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
};

export function jawOf(tooth: number): 'upper' | 'lower' {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 2 ? 'upper' : 'lower';
}

/** The contiguous run from the first to the last implant in arch order. */
export function defaultTeeth(implantTeeth: number[]): number[] {
  if (implantTeeth.length === 0) return [];
  const arch = ARCH_ORDER[jawOf(implantTeeth[0])];
  const pos = implantTeeth.map((t) => arch.indexOf(t));
  return arch.slice(Math.min(...pos), Math.max(...pos) + 1);
}

/** "36" or "34–36" (teeth are stored in arch order). */
export function describeTeeth(teeth: number[]): string {
  return teeth.length <= 1 ? String(teeth[0] ?? '') : `${teeth[0]}–${teeth[teeth.length - 1]}`;
}

export const isCurrent = (r: Restoration) => r.ended_on === null;

export function currentRestoration(siteId: string, all: Restoration[]): Restoration | null {
  return all.find((r) => isCurrent(r) && r.site_ids.includes(siteId)) ?? null;
}

/** A current restoration as the odontogram draws it: one bar under `teeth`. */
export type RestorationSpan = { id: string; teeth: number[]; implantTeeth: number[]; label: string; temporary: boolean };

/** One span per current restoration; implant teeth in arch order (the first one opens for a pontic). */
export function restorationSpans(all: Restoration[], sites: readonly { id: string; tooth: number }[]): RestorationSpan[] {
  const toothOf = new Map(sites.map((s) => [s.id, s.tooth]));
  return all.filter(isCurrent).flatMap((r) => {
    if (r.teeth.length === 0) return [];
    const arch = ARCH_ORDER[jawOf(r.teeth[0])];
    const implantTeeth = r.site_ids
      .map((id) => toothOf.get(id))
      .filter((t): t is number => t !== undefined)
      .sort((a, b) => arch.indexOf(a) - arch.indexOf(b));
    if (implantTeeth.length === 0) return [];
    const label =
      r.type === 'single_crown' ? 'Crown'
      : r.type === 'bridge' ? `Bridge ${describeTeeth(r.teeth)}`
      : `${RESTORATION_TYPE_LABELS[r.type]} · ${implantTeeth.join(', ')}`;
    return [{ id: r.id, teeth: r.teeth, implantTeeth, label, temporary: r.stage === 'temporary' }];
  });
}

/** The same day of the month `months` later, clamped to the end of a shorter month. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Loading of an implant from its first restoration (temporary or final), never stored. */
export function loadingOf(placedOn: string, restorations: Restoration[]): Loading | null {
  const first = restorations.map((r) => r.fitted_on).sort()[0];
  if (first === undefined) return null;
  if (first <= addDays(placedOn, LOADING_IMMEDIATE_DAYS)) return 'immediate';
  if (first <= addMonths(placedOn, LOADING_EARLY_MONTHS)) return 'early';
  return 'conventional';
}

export type CourseOption = { id: string; name: string; start_date: string; end_date: string };

/** Courses running on the date first, the others after (each in the order given). */
export function coursesForDate(courses: CourseOption[], date: string) {
  const runs = (c: CourseOption) => c.start_date <= date && date <= c.end_date;
  return { running: courses.filter(runs), others: courses.filter((c) => !runs(c)) };
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalId = (message: string) => z.preprocess(blankToNull, z.string().uuid({ message }).nullable());

const details = {
  patientId: z.string().uuid({ message: 'Patient not found.' }),
  retention: z.preprocess(blankToNull, z.enum(RETENTIONS, { message: 'Choose the retention from the list.' }).nullable()),
  material: z.preprocess(blankToNull, z.enum(MATERIALS, { message: 'Choose the material from the list.' }).nullable()),
  delegateId: optionalId('Choose a delegate from the list.'),
  supervisorId: optionalId('Choose a supervisor from the list.'),
  courseId: optionalId('Choose a course from the list.'),
  notes: z.string().trim().max(1000, { message: 'Keep the notes under 1000 characters.' }).default(''),
};

export const restorationSchema = z
  .object({
    ...details,
    stage: z.enum(RESTORATION_STAGES, { message: 'Choose temporary or final.' }),
    type: z.enum(RESTORATION_TYPES, { message: 'Choose the restoration type.' }),
    sites: z.array(z.string().uuid({ message: 'Choose placed implants of this patient.' })),
    teeth: z.array(z.coerce.number().int()),
    fittedOn: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the date fitted (from the placement date to today).' }),
    remakeReason: z.preprocess(blankToNull, z.string().trim().max(500, { message: 'Keep the reason under 500 characters.' }).nullable()),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'single_crown' && v.sites.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['sites'], message: 'A single crown sits on one implant.' });
    }
    if (v.type !== 'single_crown' && v.sites.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['sites'], message: 'A bridge, overdenture or full arch sits on at least two implants.' });
    }
  });

export const restorationEditSchema = z.object({
  ...details,
  restorationId: z.string().uuid({ message: 'Restoration not found.' }),
  expectedUpdatedAt: z.string().min(1, { message: 'This restoration was changed by someone else. Reload to see it.' }),
});

const problemDetails = {
  patientId: z.string().uuid({ message: 'Patient not found.' }),
  restorationId: z.string().uuid({ message: 'Restoration not found.' }),
  type: z.enum(PROBLEM_TYPES, { message: 'Choose the problem type.' }),
  action: z.enum(PROBLEM_ACTIONS, { message: 'Choose the action taken.' }),
  noticedOn: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter when the problem was noticed (from the date fitted to today).' }),
  notes: z.string().trim().max(1000, { message: 'Keep the notes under 1000 characters.' }).default(''),
};

export const problemSchema = z.object(problemDetails);

export const problemEditSchema = z.object({
  ...problemDetails,
  problemId: z.string().uuid({ message: 'Problem not found.' }),
  expectedUpdatedAt: z.string().min(1, { message: 'This problem was changed by someone else. Reload to see it.' }),
});
