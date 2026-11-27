// One row of implant_rehab_vars (0146): implant type, geometry and the current full-arch case, merged by implant into
// Compare by and Explore. null = not recorded.
import { IMPLANT_TYPES, type ImplantType } from '@/lib/inventory/types';
import { CONFIGURATIONS, type Configuration } from '@/lib/full-arch/cases';

export type RehabVars = {
  site_id: string;
  implant_type: ImplantType | null;
  angulation_deg: number | null;
  angulation_direction: string | null;
  anchorage: string | null;
  case_id: string | null;
  case_configuration: Configuration | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** A reader row as PostgREST returns it (numeric can arrive as a string) → RehabVars. */
export function toRehabVars(r: Record<string, unknown>): RehabVars {
  const type = r.implant_type;
  const cfg = r.case_configuration;
  return {
    site_id: String(r.site_id),
    implant_type: (IMPLANT_TYPES as readonly unknown[]).includes(type) ? (type as ImplantType) : null,
    angulation_deg: num(r.angulation_deg),
    angulation_direction: str(r.angulation_direction),
    anchorage: str(r.anchorage),
    case_id: str(r.case_id),
    case_configuration: (CONFIGURATIONS as readonly unknown[]).includes(cfg) ? (cfg as Configuration) : null,
  };
}
