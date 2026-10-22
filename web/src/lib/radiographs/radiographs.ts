import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';

export const RADIOGRAPH_TYPES = ['periapical', 'cbct'] as const;
export type RadiographType = (typeof RADIOGRAPH_TYPES)[number];
export const RADIOGRAPH_TYPE_LABELS: Record<RadiographType, string> = { periapical: 'Periapical', cbct: 'CBCT' };

export const RADIOGRAPH_PURPOSES = ['planning', 'baseline', 'loading', 'follow_up', 'other'] as const;
export type RadiographPurpose = (typeof RADIOGRAPH_PURPOSES)[number];
export const RADIOGRAPH_PURPOSE_LABELS: Record<RadiographPurpose, string> = {
  planning: 'Planning', baseline: 'Baseline (after placement)', loading: 'Loading / crown fit', follow_up: 'Follow-up', other: 'Other',
};
/** Purposes that need an implant placed by the X-ray's date on one of its teeth. */
export const IMPLANT_PURPOSES: readonly RadiographPurpose[] = ['baseline', 'loading', 'follow_up'];

/** Implant states a bone level can be recorded for. */
export const MEASURABLE_STATES = ['placed', 'restored', 'failed'] as const;

export const BONE_LEVEL_MIN = -5;
export const BONE_LEVEL_MAX = 15;

export type BoneLevel = { site: string; tooth: number; mesial_mm: number | null; distal_mm: number | null };

export type Radiograph = {
  id: string;
  taken_on: string;
  type: RadiographType;
  purpose: RadiographPurpose;
  teeth: number[];
  link: string | null;
  notes: string;
  updated_at: string;
  levels: BoneLevel[];
};

export function boneLevelLabel(mm: number | null): string {
  return mm === null ? '—' : `${mm} mm`;
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const BONE_FIELD = /^(mesial|distal)_(.+)$/;

const base = z
  .object({
    patientId: z.string().uuid({ message: 'Patient not found.' }),
    id: z.preprocess(blankToNull, z.string().uuid({ message: 'X-ray not found.' }).nullable()),
    expectedUpdatedAt: z.preprocess(blankToNull, z.string().nullable()),
    takenOn: z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the date the X-ray was taken (today or earlier).' }),
    type: z.enum(RADIOGRAPH_TYPES, { message: 'Choose the X-ray type.' }),
    purpose: z.enum(RADIOGRAPH_PURPOSES, { message: 'Choose the purpose of the X-ray.' }),
    teeth: z.preprocess(
      (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]),
      z.array(z.coerce.number().int({ message: 'Each tooth must be a valid FDI tooth.' })).min(1, { message: 'Choose at least one tooth on the X-ray.' }),
    ),
    link: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() || null : v ?? null),
      z.string().max(2000, { message: 'Enter a link starting with http:// or https://.' })
        .regex(/^https?:\/\//, { message: 'Enter a link starting with http:// or https://.' }).nullable(),
    ),
    notes: z.string().trim().max(1000, { message: 'Keep the notes under 1000 characters.' }).default(''),
  })
  .passthrough();

/** The form's flat input: fields plus repeated `teeth` and `mesial_<siteId>` / `distal_<siteId>` measurement fields. */
export const radiographSchema = base.transform((v, ctx) => {
  const raw = new Map<string, { mesial_mm: number | null; distal_mm: number | null }>();
  for (const [key, value] of Object.entries(v)) {
    const m = BONE_FIELD.exec(key);
    if (!m) continue;
    const [, side, site] = m;
    const text = typeof value === 'string' ? value.trim() : value;
    let n: number | null = null;
    if (text !== '' && text !== null && text !== undefined) {
      n = Number(text);
      if (!Number.isFinite(n) || n < BONE_LEVEL_MIN || n > BONE_LEVEL_MAX) {
        ctx.addIssue({ code: 'custom', path: [key], message: `Bone levels must be numbers between ${BONE_LEVEL_MIN} and ${BONE_LEVEL_MAX} mm.` });
        return z.NEVER;
      }
    }
    const row = raw.get(site) ?? { mesial_mm: null, distal_mm: null };
    row[side === 'mesial' ? 'mesial_mm' : 'distal_mm'] = n;
    raw.set(site, row);
  }
  const levels = [...raw.entries()]
    .filter(([, r]) => r.mesial_mm !== null || r.distal_mm !== null)
    .map(([site, r]) => ({ site, ...r }));
  return {
    patientId: v.patientId, id: v.id, expectedUpdatedAt: v.expectedUpdatedAt, takenOn: v.takenOn, type: v.type, purpose: v.purpose,
    teeth: v.teeth, link: v.link, notes: v.notes, levels,
  };
});
