import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';

export const COMPLICATION_CATEGORIES = ['surgical', 'biological', 'mechanical'] as const;
export type ComplicationCategory = (typeof COMPLICATION_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ComplicationCategory, string> = {
  surgical: 'Surgical', biological: 'Biological', mechanical: 'Mechanical / prosthetic',
};

export const COMPLICATION_TYPES: Record<ComplicationCategory, readonly string[]> = {
  surgical: ['intraoperative_injury', 'haemorrhage', 'nerve_symptoms', 'sinus_complication', 'wound_dehiscence', 'infection',
    'graft_exposure_loss', 'early_osseointegration_loss', 'other'],
  biological: ['mucositis', 'peri_implantitis', 'progressive_bone_loss', 'suppuration', 'persistent_pain', 'soft_tissue_recession', 'other'],
  mechanical: ['implant_fracture', 'abutment_fracture', 'screw_loosening', 'screw_fracture', 'restoration_fracture',
    'loss_of_retention', 'prosthetic_remake', 'other'],
};
export const TYPE_LABELS: Record<string, string> = {
  intraoperative_injury: 'Intraoperative injury', haemorrhage: 'Haemorrhage', nerve_symptoms: 'Nerve symptoms',
  sinus_complication: 'Sinus complication', wound_dehiscence: 'Wound dehiscence', infection: 'Infection',
  graft_exposure_loss: 'Graft exposure / loss', early_osseointegration_loss: 'Early loss of osseointegration',
  mucositis: 'Peri-implant mucositis', peri_implantitis: 'Peri-implantitis', progressive_bone_loss: 'Progressive bone loss',
  suppuration: 'Suppuration', persistent_pain: 'Persistent pain', soft_tissue_recession: 'Soft-tissue recession',
  implant_fracture: 'Implant fracture', abutment_fracture: 'Abutment fracture', screw_loosening: 'Screw loosening',
  screw_fracture: 'Screw fracture', restoration_fracture: 'Restoration fracture / chipping', loss_of_retention: 'Loss of retention',
  prosthetic_remake: 'Prosthetic remake', other: 'Other',
};

export const SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = { mild: 'Mild', moderate: 'Moderate', severe: 'Severe' };

/** 2017 World Workshop case definitions, shown as guidance only. */
export const CASE_DEFINITIONS: Partial<Record<string, string>> = {
  mucositis: 'Bleeding and/or suppuration on gentle probing, with or without increased probing depth, and no bone loss beyond initial bone remodelling.',
  peri_implantitis: 'Bleeding and/or suppuration on gentle probing, increased probing depth compared with previous examinations, and bone loss beyond initial bone remodelling. Without previous data: probing depth ≥ 6 mm with bleeding, and bone level ≥ 3 mm apical to the most coronal part of the intraosseous implant.',
};

export type ImplantComplication = {
  id: string;
  site_id: string;
  category: ComplicationCategory;
  type: string;
  other_type: string;
  noticed_on: string;
  severity: Severity | null;
  treatment: string;
  resolved_on: string | null;
  followup_id: string | null;
  notes: string;
  voided_at: string | null;
  voided_reason: string;
  updated_at: string;
};

export const isOpen = (c: ImplantComplication) => !c.voided_at && c.resolved_on === null;

export function describeComplication(c: ImplantComplication): string {
  return [
    c.type === 'other' ? `Other: ${c.other_type}` : TYPE_LABELS[c.type] ?? c.type,
    c.severity ? SEVERITY_LABELS[c.severity] : null,
    `noticed ${formatDate(c.noticed_on)}`,
    c.resolved_on ? `resolved ${formatDate(c.resolved_on)}` : null,
    c.treatment || null,
  ].filter(Boolean).join(' · ');
}

/** Teeth whose implant in place (placed or restored) has an open complication; a failed implant is not flagged. */
export function openComplicationTeeth(
  sites: readonly { tooth: number; state: string; complications: readonly ImplantComplication[] }[],
): Partial<Record<number, boolean>> {
  const teeth: Partial<Record<number, boolean>> = {};
  for (const s of sites) {
    if ((s.state === 'placed' || s.state === 'restored') && s.complications.some(isOpen)) teeth[s.tooth] = true;
  }
  return teeth;
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const RESOLVED = 'The resolved date must be on or after the date noticed, and not in the future.';

export const complicationSchema = z
  .object({
    complicationId: z.preprocess(blankToNull, z.string().uuid().nullable()),
    expectedUpdatedAt: z.preprocess(blankToNull, z.string().nullable()),
    siteId: z.string().uuid({ message: 'Implant not found.' }),
    patientId: z.string().uuid({ message: 'Patient not found.' }),
    category: z.enum(COMPLICATION_CATEGORIES, { message: 'Choose the complication category.' }),
    type: z.string().min(1, { message: 'Choose the complication type.' }),
    otherType: z.string().trim().max(120, { message: 'Keep the description under 120 characters.' }).default(''),
    noticedOn: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter when the complication was noticed (today or earlier).' }),
    severity: z.preprocess(blankToNull, z.enum(SEVERITIES, { message: 'Choose the severity from the list.' }).nullable()),
    treatment: z.string().trim().max(1000, { message: 'Keep the treatment under 1000 characters.' }).default(''),
    resolvedOn: z.preprocess(blankToNull, z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: RESOLVED }).nullable()),
    followupId: z.preprocess(blankToNull, z.string().uuid({ message: 'Choose a visit of this implant.' }).nullable()),
    notes: z.string().trim().max(1000, { message: 'Keep the notes under 1000 characters.' }).default(''),
  })
  .superRefine((v, ctx) => {
    if (!COMPLICATION_TYPES[v.category].includes(v.type)) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'Choose the complication type.' });
    } else if (v.type === 'other' && !v.otherType) {
      ctx.addIssue({ code: 'custom', path: ['otherType'], message: 'Describe the other complication.' });
    }
    if (v.resolvedOn && v.resolvedOn < v.noticedOn) ctx.addIssue({ code: 'custom', path: ['resolvedOn'], message: RESOLVED });
  });

export type ComplicationInput = z.output<typeof complicationSchema>;

export function toDetails(v: ComplicationInput) {
  return {
    category: v.category, type: v.type, other_type: v.type === 'other' ? v.otherType : '', noticed_on: v.noticedOn,
    severity: v.severity, treatment: v.treatment, resolved_on: v.resolvedOn, followup_id: v.followupId, notes: v.notes,
  };
}
