import type { Area } from '@/lib/auth/permissions';

/** Switchable modules (spec: modular design). `teaching` is the course-organizer type feature, not switchable. */
export const MODULES = ['inventory', 'statistics'] as const;
export type Module = (typeof MODULES)[number];
export type Feature = Module | 'teaching';
export type CompanyKind = 'course_organizer' | 'clinic';

export const MODULE_LABELS: Record<Module, string> = { inventory: 'Inventory', statistics: 'Statistics' };
/** Which company types can be chosen in the console (Clinic arrives in release 3). */
export const KIND_AVAILABLE: Record<CompanyKind, boolean> = { course_organizer: true, clinic: false };
export const KIND_LABELS: Record<CompanyKind, string> = { course_organizer: 'Course organizer', clinic: 'Clinic' };

/** Mirrors the `case` in public.can() (0109). Areas not listed are core and never gated. */
export const AREA_FEATURE: Partial<Record<Area, Feature>> = {
  research: 'statistics',
  inventory: 'inventory',
  courses: 'teaching',
  delegates: 'teaching',
};

/** True when the area has no feature, `features` is unknown (no company context), or the feature is listed. */
export function areaOn(features: readonly Feature[] | undefined, area: Area): boolean {
  const feature = AREA_FEATURE[area];
  return !feature || !features || features.includes(feature);
}

/** True when the company's features list the feature. */
export function featureOn(features: readonly Feature[], f: Feature): boolean {
  return features.includes(f);
}

const KNOWN: readonly string[] = [...MODULES, 'teaching'];

export function toFeatures(raw: unknown): Feature[] {
  return Array.isArray(raw) ? (raw.filter((f) => typeof f === 'string' && KNOWN.includes(f)) as Feature[]) : [];
}

/** True when the company teaches (a course organizer); a clinic has no courses, delegates or supervisors. */
export function teachingOn(features: readonly Feature[]): boolean {
  return featureOn(features, 'teaching');
}
