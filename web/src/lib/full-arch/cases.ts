import { z } from 'zod';
import { isRealDate } from '@/lib/dates';
import { blankToNull } from '@/lib/form-values';
import type { ImplantSite } from '@/lib/inventory/types';
import type { Restoration } from '@/lib/restorations/restorations';

export const ARCHES = ['upper', 'lower'] as const;
export type Arch = (typeof ARCHES)[number];
export const ARCH_LABELS: Record<Arch, string> = { upper: 'Upper arch', lower: 'Lower arch' };

export const CONFIGURATIONS = ['all_on_4', 'all_on_6', 'all_on_x', 'other'] as const;
export type Configuration = (typeof CONFIGURATIONS)[number];
export const CONFIGURATION_LABELS: Record<Configuration, string> = {
  all_on_4: 'All-on-4', all_on_6: 'All-on-6', all_on_x: 'All-on-X', other: 'Other',
};

export const CASE_STAGES = ['scan', 'lab_design', 'try_in'] as const;
export type CaseStage = (typeof CASE_STAGES)[number];
export const CASE_STAGE_LABELS: Record<CaseStage, string> = {
  scan: 'Scan / impression', lab_design: 'Lab and design approved', try_in: 'Try-in',
};

export type CaseStageRow = {
  stage: CaseStage; done_on: string; lab: string | null; passive_fit: boolean | null; occlusion: string | null; notes: string;
};

export type FullArchCase = {
  id: string; arch: Arch; configuration: Configuration; name: string; notes: string;
  closed_at: string | null; close_reason: string | null; updated_at: string; stages: CaseStageRow[];
};

export type CaseStatus = 'planned' | 'in_treatment' | 'completed' | 'closed';
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  planned: 'Planned', in_treatment: 'In treatment', completed: 'Completed', closed: 'Closed',
};

/** Restoration types that count as a case's bridge; a single crown on a case implant stays linked but never does. */
const BRIDGE_TYPES: readonly Restoration['type'][] = ['bridge', 'full_arch', 'overdenture'];

/** Loaded restorations leave voided ones out already, but a voided one never counts. */
const isVoided = (r: Restoration) => !!(r as { voided_at?: string | null }).voided_at;

const byLatestFitted = (a: Restoration, b: Restoration) => b.fitted_on.localeCompare(a.fitted_on);

export type CaseBridges = {
  /** The latest linked temporary bridge, even if a final has since replaced it. */
  temporary: Restoration | null;
  /** The current (not ended) final bridges linked to the case, latest fitted first. */
  finals: Restoration[];
  /** The finals cover every placed or restored implant of the case (failed ones aren't needed; none placed = never). */
  complete: boolean;
  /** The latest fitted date among the finals, once complete. */
  deliveredOn: string | null;
  /** Teeth of the needed implants, in arch order, and those the finals cover. */
  neededTeeth: number[];
  coveredTeeth: number[];
};

const archIndex = (tooth: number) => {
  const q = Math.floor(tooth / 10);
  const n = tooth % 10;
  return q === 1 || q === 4 ? -n : n; // right side first (18…11 | 21…28; 48…41 | 31…38)
};

export function caseBridges(
  c: FullArchCase, sites: readonly ImplantSite[], restorations: readonly Restoration[],
): CaseBridges {
  const bridges = restorations.filter((r) => r.case_id === c.id && BRIDGE_TYPES.includes(r.type) && !isVoided(r));
  const temporary = bridges.filter((r) => r.stage === 'temporary').sort(byLatestFitted)[0] ?? null;
  const finals = bridges.filter((r) => r.stage === 'final' && !r.ended_on).sort(byLatestFitted);
  const needed = sites
    .filter((s) => s.case_id === c.id && (s.state === 'placed' || s.state === 'restored'))
    .sort((a, b) => archIndex(a.tooth) - archIndex(b.tooth));
  const coveredIds = new Set(finals.flatMap((r) => r.site_ids ?? []));
  const covered = needed.filter((s) => coveredIds.has(s.id));
  const complete = needed.length > 0 && covered.length === needed.length;
  return {
    temporary, finals, complete,
    deliveredOn: complete ? finals[0].fitted_on : null,
    neededTeeth: needed.map((s) => s.tooth),
    coveredTeeth: covered.map((s) => s.tooth),
  };
}

export function caseStatus(c: FullArchCase, sites: readonly ImplantSite[], restorations: readonly Restoration[]): CaseStatus {
  if (c.closed_at) return 'closed';
  if (caseBridges(c, sites, restorations).complete) return 'completed';
  if (sites.some((s) => s.case_id === c.id && ['placed', 'restored', 'failed'].includes(s.state))) return 'in_treatment';
  return 'planned';
}

export function caseTitle(c: FullArchCase): string {
  return `${ARCH_LABELS[c.arch]} · ${c.name.trim() || CONFIGURATION_LABELS[c.configuration]}`;
}

// ── Schemas (limits: the plan's Global Constraints; SQL stays the authority) ───────────────────────────
const id = (message: string) => z.string().uuid({ message });
const text = (max: number, message: string) => z.string().trim().max(max, { message }).default('');
const optionalText = (max: number, message: string) => z.preprocess(blankToNull, z.string().trim().max(max, { message }).nullable());

export const caseFields = {
  configuration: z.enum(CONFIGURATIONS, { message: 'Choose the configuration.' }),
  name: text(60, 'Keep the name to 60 characters.'),
  notes: text(1000, 'Keep the notes to 1000 characters.'),
};

export const caseSchema = z.object({
  patientId: id('Patient not found.'),
  arch: z.enum(ARCHES, { message: 'Choose the arch.' }),
  ...caseFields,
  sites: z.array(id('Choose implants of this patient.')).default([]),
});

export const caseEditSchema = z.object({
  patientId: id('Patient not found.'),
  caseId: id('Case not found.'),
  ...caseFields,
  expectedUpdatedAt: z.string().min(1, { message: 'Someone else changed this case. Reload and try again.' }),
});

export const caseSitesSchema = z.object({
  patientId: id('Patient not found.'),
  caseId: id('Case not found.'),
  sites: z.array(id('Choose implants of this patient.')),
  expectedUpdatedAt: z.string().min(1, { message: 'Someone else changed this case. Reload and try again.' }),
});

export const caseRestorationSchema = z.object({
  patientId: id('Patient not found.'),
  restorationId: id('Restoration not found.'),
  caseId: z.preprocess(blankToNull, id('Case not found.').nullable()),
});

export const caseStageSchema = z.object({
  patientId: id('Patient not found.'),
  caseId: id('Case not found.'),
  stage: z.enum(CASE_STAGES, { message: 'Choose the stage.' }),
  doneOn: z.string().refine((v) => isRealDate(v), { message: 'Enter the date of the stage.' }),
  lab: optionalText(120, 'Keep the lab to 120 characters.'),
  passiveFit: z.preprocess(blankToNull, z.boolean().nullable()),
  occlusion: optionalText(500, 'Keep the occlusion to 500 characters.'),
  notes: text(1000, 'Keep the notes to 1000 characters.'),
}).superRefine((v, ctx) => {
  if (v.lab !== null && v.stage !== 'lab_design') {
    ctx.addIssue({ code: 'custom', path: ['lab'], message: 'The lab is recorded only for Lab and design.' });
  }
  if ((v.passiveFit !== null || v.occlusion !== null) && v.stage !== 'try_in') {
    ctx.addIssue({ code: 'custom', path: ['passiveFit'], message: 'Passive fit and occlusion are recorded only for the try-in.' });
  }
});

export const clearStageSchema = z.object({
  patientId: id('Patient not found.'),
  caseId: id('Case not found.'),
  stage: z.enum(CASE_STAGES, { message: 'Choose the stage.' }),
});

export const closeCaseSchema = z.object({
  patientId: id('Patient not found.'),
  caseId: id('Case not found.'),
  reason: z.string().trim().min(1, { message: 'Give a reason to close the case.' }).max(500, { message: 'Keep the reason to 500 characters.' }),
  expectedUpdatedAt: z.string().min(1, { message: 'Someone else changed this case. Reload and try again.' }),
});

export const reopenCaseSchema = z.object({
  patientId: id('Patient not found.'),
  caseId: id('Case not found.'),
  expectedUpdatedAt: z.string().min(1, { message: 'Someone else changed this case. Reload and try again.' }),
});
