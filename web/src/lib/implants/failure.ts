import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';

export const FAILURE_TYPES = ['lost', 'removed', 'failed_in_place'] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];
export const FAILURE_TYPE_LABELS: Record<FailureType, string> = { lost: 'Lost', removed: 'Removed', failed_in_place: 'Failed in place' };

export const FAILURE_REASONS = ['no_osseointegration', 'peri_implantitis', 'fracture', 'malposition', 'other'] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];
export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  no_osseointegration: 'No osseointegration', peri_implantitis: 'Peri-implantitis', fracture: 'Fracture', malposition: 'Malposition', other: 'Other',
};

/** Components at abutment level or beyond: a failure after the first of these (or of any restoration) is late. */
const ABUTMENT_LEVEL = ['ti_base', 'multi_unit', 'abutment', 'final_restoration'];

type FailureSite = {
  failed_on: string | null;
  failure_type: FailureType | null;
  failure_reason: FailureReason | null;
  failure_notes: string;
  components: readonly { component_type: string; fitted_on: string; voided_at: string | null }[];
};

/** Restorations fitted on this implant (temporary or final, voided ones left out) count as loading too. */
type FittedRestoration = { fitted_on: string };

export function failureTiming(site: FailureSite, restorations: readonly FittedRestoration[] = []): 'early' | 'late' | null {
  if (!site.failed_on) return null;
  const first = [
    ...site.components.filter((c) => !c.voided_at && ABUTMENT_LEVEL.includes(c.component_type)).map((c) => c.fitted_on),
    ...restorations.map((r) => r.fitted_on),
  ].sort()[0];
  return first !== undefined && first <= site.failed_on ? 'late' : 'early';
}

export function describeFailure(site: FailureSite, restorations: readonly FittedRestoration[] = []): string {
  return [
    site.failure_type ? FAILURE_TYPE_LABELS[site.failure_type] : null,
    site.failure_reason ? FAILURE_REASON_LABELS[site.failure_reason] : null,
    site.failed_on ? formatDate(site.failed_on) : null,
    failureTiming(site, restorations),
  ].filter(Boolean).join(' · ');
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);

export const failureSchema = z.object({
  siteId: z.string().uuid({ message: 'Implant not found.' }),
  patientId: z.string().uuid({ message: 'Patient not found.' }),
  expectedUpdatedAt: z.preprocess(blankToNull, z.string().nullable()),
  failedOn: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the failure date (today or earlier).' }),
  failureType: z.enum(FAILURE_TYPES, { message: 'Choose the failure type.' }),
  failureReason: z.enum(FAILURE_REASONS, { message: 'Choose the failure reason.' }),
  failureNotes: z.string().trim().max(1000, { message: 'Keep the failure notes under 1000 characters.' }).default(''),
});
