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

/** A restoration that counts: loaded restorations leave voided ones out already, but a voided one is never current. */
function isCurrent(r: Restoration): boolean {
  return !r.ended_on && !(r as { voided_at?: string | null }).voided_at;
}

export function caseStatus(c: FullArchCase, sites: readonly ImplantSite[], restorations: readonly Restoration[]): CaseStatus {
  if (c.closed_at) return 'closed';
  if (restorations.some((r) => r.case_id === c.id && r.stage === 'final' && isCurrent(r))) return 'completed';
  if (sites.some((s) => s.case_id === c.id && ['placed', 'restored', 'failed'].includes(s.state))) return 'in_treatment';
  return 'planned';
}

export function caseTitle(c: FullArchCase): string {
  return `${ARCH_LABELS[c.arch]} · ${c.name.trim() || CONFIGURATION_LABELS[c.configuration]}`;
}

/** The current temporary and final bridge linked to the case (the latest fitted if several). */
export function caseBridges(
  c: FullArchCase, restorations: readonly Restoration[],
): { temporary: Restoration | null; final: Restoration | null } {
  const latest = (stage: Restoration['stage']) =>
    restorations
      .filter((r) => r.case_id === c.id && r.stage === stage && isCurrent(r))
      .sort((a, b) => b.fitted_on.localeCompare(a.fitted_on))[0] ?? null;
  return { temporary: latest('temporary'), final: latest('final') };
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
