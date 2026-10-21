import { z } from 'zod';
import { formatDate } from '@/lib/format';

export const IMPRESSION_TYPES = ['digital_scan', 'conventional'] as const;
export type ImpressionType = (typeof IMPRESSION_TYPES)[number];

export const IMPRESSION_LABELS: Record<ImpressionType, string> = {
  digital_scan: 'Digital scan',
  conventional: 'Conventional impression',
};

export const NOT_TAKEN_LABEL = 'Not taken';

const blankToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

export const impressionSchema = z
  .object({
    siteId: z.string().min(1),
    patientId: z.string().min(1),
    expectedUpdatedAt: z.string().min(1),
    type: z.preprocess(blankToNull, z.enum(IMPRESSION_TYPES).nullable()),
    takenOn: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.').nullable().optional()),
  })
  .transform((v) => ({ ...v, takenOn: v.type ? (v.takenOn ?? null) : null }));

export function impressionSummary(site: { impression_type: ImpressionType | null; impression_taken_on: string | null }): string {
  if (!site.impression_type) return NOT_TAKEN_LABEL;
  const label = IMPRESSION_LABELS[site.impression_type];
  return site.impression_taken_on ? `${label} · ${formatDate(site.impression_taken_on)}` : label;
}
