import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { YES_NO, type YesNo } from '@/lib/patients/risk-factors';

export const PLACEMENT_TIMINGS = ['immediate', 'early_soft_tissue', 'early_partial_bone', 'delayed'] as const;
export type PlacementTiming = (typeof PLACEMENT_TIMINGS)[number];
export const PLACEMENT_TIMING_LABELS: Record<PlacementTiming, string> = {
  immediate: 'Immediate (at extraction)',
  early_soft_tissue: 'Early, soft-tissue healing (~4–8 weeks)',
  early_partial_bone: 'Early, partial bone healing (~12–16 weeks)',
  delayed: 'Delayed (healed ridge)',
};
/** ITI placement types 1–4, shown beside the choice. */
export const PLACEMENT_TIMING_HELP: Record<PlacementTiming, string> = {
  immediate: 'Type 1: placed the same day as the extraction.',
  early_soft_tissue: 'Type 2: socket covered by soft tissue, usually 4–8 weeks after extraction.',
  early_partial_bone: 'Type 3: partial bone fill of the socket, usually 12–16 weeks after extraction.',
  delayed: 'Type 4: fully healed ridge, usually more than 16 weeks after extraction.',
};
const TIMING_SHORT: Record<PlacementTiming, string> = {
  immediate: 'Immediate', early_soft_tissue: 'Early (soft tissue)', early_partial_bone: 'Early (partial bone)', delayed: 'Delayed',
};
const TIMING_SENTENCE: Record<Exclude<PlacementTiming, 'immediate'>, [string, string]> = {
  early_soft_tissue: ['Early placement with soft-tissue healing', '4–8 weeks'],
  early_partial_bone: ['Early placement with partial bone healing', '12–16 weeks'],
  delayed: ['Delayed placement', 'more than 16 weeks'],
};
/** Usual days from extraction; outside them the form warns but never blocks. */
const USUAL_DAYS: Record<PlacementTiming, [number, number]> = {
  immediate: [0, 0], early_soft_tissue: [28, 56], early_partial_bone: [84, 112], delayed: [113, Infinity],
};

export const PHENOTYPES = ['thin', 'thick'] as const;
export type Phenotype = (typeof PHENOTYPES)[number];
export const PHENOTYPE_LABELS: Record<Phenotype, string> = { thin: 'Thin', thick: 'Thick' };

export const FLAPS = ['flapless', 'crestal', 'crestal_releasing', 'papilla_sparing', 'other'] as const;
export type Flap = (typeof FLAPS)[number];
export const FLAP_LABELS: Record<Flap, string> = {
  flapless: 'Flapless', crestal: 'Crestal incision', crestal_releasing: 'Crestal + releasing incisions',
  papilla_sparing: 'Papilla-sparing', other: 'Other flap',
};

export const TORQUE_TYPES = ['peak', 'final'] as const;
export type TorqueType = (typeof TORQUE_TYPES)[number];
export const TORQUE_TYPE_LABELS: Record<TorqueType, string> = { peak: 'Peak', final: 'Final' };

export const HEALINGS = ['submerged', 'transmucosal', 'immediate_provisional'] as const;
export type Healing = (typeof HEALINGS)[number];
export const HEALING_LABELS: Record<Healing, string> = {
  submerged: 'Submerged (cover screw)', transmucosal: 'Transmucosal (healing abutment)', immediate_provisional: 'Immediate provisional',
};

export const YES_NO_LABELS: Record<YesNo, string> = { yes: 'Yes', no: 'No' };

export const GRAFT_PROCEDURES = [
  'socket_preservation', 'gbr', 'horizontal_augmentation', 'vertical_augmentation', 'sinus_crestal', 'sinus_lateral', 'ridge_split', 'other',
] as const;
export type GraftProcedure = (typeof GRAFT_PROCEDURES)[number];
export const GRAFT_PROCEDURE_LABELS: Record<GraftProcedure, string> = {
  socket_preservation: 'Socket preservation', gbr: 'GBR', horizontal_augmentation: 'Horizontal augmentation',
  vertical_augmentation: 'Vertical augmentation', sinus_crestal: 'Sinus lift, crestal', sinus_lateral: 'Sinus lift, lateral window',
  ridge_split: 'Ridge split', other: 'Other procedure',
};

export const GRAFT_TIMINGS = ['simultaneous', 'staged'] as const;
export type GraftTiming = (typeof GRAFT_TIMINGS)[number];
export const GRAFT_TIMING_LABELS: Record<GraftTiming, string> = { simultaneous: 'Simultaneous', staged: 'Staged (before placement)' };

export const GRAFT_MATERIALS = ['autogenous', 'allograft', 'xenograft', 'alloplast', 'combination', 'none'] as const;
export type GraftMaterial = (typeof GRAFT_MATERIALS)[number];
export const GRAFT_MATERIAL_LABELS: Record<GraftMaterial, string> = {
  autogenous: 'Autogenous', allograft: 'Allograft', xenograft: 'Xenograft', alloplast: 'Alloplast', combination: 'Combination',
  none: 'No graft material',
};

export const MEMBRANES = ['none', 'resorbable', 'non_resorbable'] as const;
export type Membrane = (typeof MEMBRANES)[number];
export const MEMBRANE_LABELS: Record<Membrane, string> = {
  none: 'No membrane', resorbable: 'Resorbable membrane', non_resorbable: 'Non-resorbable membrane',
};

export type ImplantSurgery = {
  site_id: string;
  extraction_date: string | null;
  placement_timing: PlacementTiming | null;
  soft_tissue_phenotype: Phenotype | null;
  keratinized_mucosa_mm: number | null;
  flap: Flap | null;
  torque_type: TorqueType | null;
  healing: Healing | null;
  primary_closure: YesNo | null;
  grafting_performed: YesNo | null;
  updated_at: string;
};

export type ImplantGraft = {
  id: string;
  site_id: string;
  procedure: GraftProcedure;
  timing: GraftTiming;
  performed_on: string | null;
  material: GraftMaterial | null;
  product: string;
  membrane: Membrane | null;
  notes: string;
  created_at: string;
};

export const SURGERY_FIELD_LABELS = {
  placement_timing: 'placement timing', extraction_date: 'extraction date', soft_tissue_phenotype: 'phenotype',
  keratinized_mucosa_mm: 'keratinized mucosa', flap: 'flap', torque_type: 'torque type', healing: 'healing',
  primary_closure: 'primary closure', grafting_performed: 'grafting performed',
} as const;
type SurgeryField = keyof typeof SURGERY_FIELD_LABELS;
const SURGERY_FIELDS = Object.keys(SURGERY_FIELD_LABELS) as SurgeryField[];
export const SURGERY_TOTAL = SURGERY_FIELDS.length;

export function daysSinceExtraction(extraction: string | null, placedOn: string | null): number | null {
  if (!extraction || !placedOn) return null;
  return Math.round((Date.parse(`${placedOn}T00:00:00Z`) - Date.parse(`${extraction}T00:00:00Z`)) / 86_400_000);
}

const span = (days: number) => (days < 14 ? `${days} ${days === 1 ? 'day' : 'days'}` : `${Math.round(days / 7)} weeks`);

export function timingWarning(timing: PlacementTiming | null, days: number | null): string | null {
  if (!timing || days === null) return null;
  const [min, max] = USUAL_DAYS[timing];
  if (days >= min && days <= max) return null;
  if (timing === 'immediate') return `An immediate placement is on the extraction day; this is ${span(days)} after it.`;
  const [what, range] = TIMING_SENTENCE[timing];
  return `${what} usually means ${range} after extraction; this is ${span(days)}.`;
}

export function surgeryCompleteness(s: ImplantSurgery | null): { recorded: number; total: number } {
  const recorded = s ? SURGERY_FIELDS.filter((f) => s[f] !== null && s[f] !== undefined).length : 0;
  return { recorded, total: SURGERY_TOTAL };
}

export function describeSurgery(s: ImplantSurgery | null, placedOn: string | null): string[] {
  if (!s) return [];
  const days = daysSinceExtraction(s.extraction_date, placedOn);
  return [
    s.placement_timing ? TIMING_SHORT[s.placement_timing] : null,
    days !== null ? `${days} ${days === 1 ? 'day' : 'days'} after extraction` : null,
    s.soft_tissue_phenotype ? `${PHENOTYPE_LABELS[s.soft_tissue_phenotype]} phenotype` : null,
    s.keratinized_mucosa_mm !== null ? `Keratinized mucosa ${s.keratinized_mucosa_mm} mm` : null,
    s.flap ? FLAP_LABELS[s.flap] : null,
    s.torque_type ? `${TORQUE_TYPE_LABELS[s.torque_type]} torque` : null,
    s.healing ? HEALING_LABELS[s.healing] : null,
    s.primary_closure ? (s.primary_closure === 'yes' ? 'Primary closure' : 'No primary closure') : null,
    s.grafting_performed ? (s.grafting_performed === 'yes' ? 'Grafted' : 'No grafting') : null,
  ].filter((x): x is string => x !== null);
}

export function describeGraft(g: ImplantGraft): string {
  return [
    GRAFT_PROCEDURE_LABELS[g.procedure],
    g.material ? GRAFT_MATERIAL_LABELS[g.material] : null,
    g.membrane ? MEMBRANE_LABELS[g.membrane] : null,
    g.timing === 'staged' && g.performed_on ? `Staged (${formatDate(g.performed_on)})` : 'Simultaneous',
    g.product || null,
  ].filter(Boolean).join(' · ');
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.preprocess(blankToNull, z.enum(values, { message }).nullable());
const optionalPastDate = (message: string) =>
  z.preprocess(blankToNull, z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message }).nullable());
const id = (message: string) => z.string({ message }).uuid({ message });
const KM = 'Enter the keratinized mucosa width from 0 to 15 mm.';

export const surgerySchema = z.object({
  siteId: id('Implant not found.'),
  patientId: id('Patient not found.'),
  expectedUpdatedAt: z.preprocess(blankToNull, z.string().nullable()),
  extractionDate: optionalPastDate('Enter a real extraction date (today or earlier).'),
  placementTiming: optionalEnum(PLACEMENT_TIMINGS, 'Choose the placement timing from the list.'),
  softTissuePhenotype: optionalEnum(PHENOTYPES, 'Choose thin or thick.'),
  keratinizedMucosaMm: z.preprocess(
    (v) => (blankToNull(v) === null ? null : Number(v)),
    z.number({ message: KM }).min(0, { message: KM }).max(15, { message: KM }).nullable(),
  ),
  flap: optionalEnum(FLAPS, 'Choose the flap from the list.'),
  torqueType: optionalEnum(TORQUE_TYPES, 'Choose peak or final.'),
  healing: optionalEnum(HEALINGS, 'Choose the healing from the list.'),
  primaryClosure: optionalEnum(YES_NO, 'Choose yes or no.'),
  graftingPerformed: optionalEnum(YES_NO, 'Choose yes or no.'),
});

export const graftSchema = z
  .object({
    graftId: z.preprocess(blankToNull, z.string().uuid().nullable()),
    siteId: id('Implant not found.'),
    patientId: id('Patient not found.'),
    procedure: z.enum(GRAFT_PROCEDURES, { message: 'Choose the graft procedure.' }),
    timing: z.enum(GRAFT_TIMINGS, { message: 'Choose simultaneous or staged.' }),
    performedOn: optionalPastDate('Enter the date of the staged graft.'),
    material: optionalEnum(GRAFT_MATERIALS, 'Choose the graft material from the list.'),
    product: z.string().trim().max(120, { message: 'Keep the product under 120 characters.' }).default(''),
    membrane: optionalEnum(MEMBRANES, 'Choose the membrane from the list.'),
    notes: z.string().trim().max(500, { message: 'Keep the notes under 500 characters.' }).default(''),
  })
  .superRefine((g, ctx) => {
    if (g.timing === 'staged' && !g.performedOn) {
      ctx.addIssue({ code: 'custom', path: ['performedOn'], message: 'Enter the date of the staged graft.' });
    }
  })
  .transform((g) => ({ ...g, performedOn: g.timing === 'staged' ? g.performedOn : null }));
