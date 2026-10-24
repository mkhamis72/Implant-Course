// Research page plumbing: URL filters → reader arguments, drill-down lists and their links. Selection only reads the
// statuses SQL returned (implant_outcomes_detail / crown_outcomes_detail); nothing is recomputed here.
import type { CrownRow, ImplantRow } from './summary';
import { isCompareKey } from './groups';

export const RESEARCH_FILTER_KEYS = ['course', 'from', 'to', 'delegate', 'brand', 'system'] as const;
/** The filters, plus the page's Compare by choice (`compare`), which links carry but the readers ignore. */
export type ResearchFilters = Record<(typeof RESEARCH_FILTER_KEYS)[number], string> & { compare?: string };

export type DetailRow = ImplantRow & {
  site_id: string
  patient_id: string
  tooth: number
  placed_on: string
  /** First restoration fitted (implant_outcomes_detail); optional so fixtures without it still type. */
  loaded_on?: string | null
  latest_grade_reason: string | null
  product_id: string | null
  brand: string | null
  system: string | null
  patient_name: string | null
  file_no: string | null
}

export type CrownDetailRow = CrownRow & {
  restoration_id: string
  patient_id: string
  teeth: number[]
  fitted_on: string
  remade_on: string | null
  patient_name: string | null
  file_no: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const realDate = (s: string) => {
  if (!DATE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** The selected system if it belongs to the selected brand (or no brand is selected); otherwise none. */
export function effectiveSystem(brand: string, system: string, rows: { brand: string | null; system: string | null }[]): string {
  if (!system || !brand) return system;
  return rows.some((r) => r.brand === brand && r.system === system) ? system : "";
}

/** Arguments for implant_outcomes_detail / crown_outcomes_detail; empty or malformed filters mean "all". */
export function rpcArgs(f: ResearchFilters) {
  return {
    p_course: UUID.test(f.course) ? f.course : null,
    p_from: realDate(f.from) ? f.from : null,
    p_to: realDate(f.to) ? f.to : null,
    p_delegate: UUID.test(f.delegate) ? f.delegate : null,
    p_brand: f.brand || null,
    p_system: f.system || null,
  };
}

export function filterQuery(f: ResearchFilters): string {
  const q = new URLSearchParams();
  for (const k of RESEARCH_FILTER_KEYS) if (f[k]) q.set(k, f[k]);
  if (isCompareKey(f.compare)) q.set('compare', f.compare);
  return q.toString();
}

const MILESTONE_LISTS = ['survived', 'failed', 'not_reached', 'unknown'] as const;
const GRADE_LISTS = ['I', 'II', 'III', 'IV', 'not_assessable', 'not_graded'] as const;

export const MILESTONE_LABELS: Record<string, string> = {
  survived: 'Survived',
  failed: 'Failed',
  not_reached: 'Not reached',
  unknown: 'Lost to follow-up',
  not_loaded: 'Not loaded',
};
const MILESTONE_LABELS_PLAIN: Record<(typeof MILESTONE_LISTS)[number], string> = {
  survived: 'survived', failed: 'failed', not_reached: 'not reached', unknown: 'lost to follow-up',
};

export const GRADE_LABELS: Record<string, string> = {
  I: 'I · Success', II: 'II · Satisfactory survival', III: 'III · Compromised survival', IV: 'IV · Failure', not_assessable: 'Not assessable', not_graded: 'Not yet graded',
};
const GRADE_LABELS_PLAIN = GRADE_LABELS as Record<(typeof GRADE_LISTS)[number], string>;

export const DRILLDOWN_TITLES = {
  implants: 'Implants placed',
  ...Object.fromEntries(
    (['year_1', 'year_2'] as const).flatMap((y) =>
      MILESTONE_LISTS.map((m) => [`${y}_${m}`, `${y === 'year_1' ? '1 year' : '2 years'}: ${MILESTONE_LABELS_PLAIN[m]}`]),
    ),
  ),
  ...Object.fromEntries(GRADE_LISTS.map((g) => [`icoi_${g}`, `ICOI: ${GRADE_LABELS_PLAIN[g]}`])),
  biological: 'Implants with a biological complication',
  mechanical: 'Implants with a mechanical complication',
  km_excluded: 'Left out of the curve: failure date unknown',
  no_product: 'Implants with no product recorded',
  crowns: 'Final restorations',
  crowns_remade: 'Final restorations remade',
  crowns_problems: 'Final restorations with a problem',
} as Record<string, string>;

export type DrilldownList = string;

export function isDrilldownList(list: string): boolean {
  return Object.prototype.hasOwnProperty.call(DRILLDOWN_TITLES, list);
}

export function isCrownList(list: DrilldownList): boolean {
  return list.startsWith('crowns');
}

/** The Research page with these filters and compare (the drill-down's link back). */
export function researchHref(f: ResearchFilters): string {
  const q = filterQuery(f);
  return `/statistics${q ? `?${q}` : ''}`;
}

export function drilldownHref(list: DrilldownList, f: ResearchFilters): string {
  const rest = filterQuery(f);
  return `/statistics/drilldown?list=${encodeURIComponent(list)}${rest ? `&${rest}` : ''}`;
}

export function selectImplants<R extends DetailRow>(list: DrilldownList, rows: R[]): R[] {
  if (list === 'implants') return rows;
  if (list === 'biological') return rows.filter((r) => r.biological_complications > 0);
  if (list === 'mechanical') return rows.filter((r) => r.mechanical_complications > 0);
  if (list === 'km_excluded') return rows.filter((r) => r.event_time_unknown);
  if (list === 'no_product') return rows.filter((r) => r.product_id === null);
  if (list === 'icoi_not_graded') return rows.filter((r) => r.latest_grade === null);
  if (list.startsWith('icoi_')) return rows.filter((r) => r.latest_grade === list.slice(5));
  const m = /^(year_[12])_(.+)$/.exec(list);
  if (m) return rows.filter((r) => r[m[1] as 'year_1' | 'year_2'] === m[2]);
  return [];
}

export function selectCrowns<R extends CrownRow>(list: DrilldownList, crowns: R[]): R[] {
  if (list === 'crowns_remade') return crowns.filter((c) => c.remade);
  if (list === 'crowns_problems') return crowns.filter((c) => c.problems > 0);
  return crowns;
}

/** The milestone column the drill-down shows, when the list is about one. */
export function milestoneKey(list: DrilldownList): 'year_1' | 'year_2' | null {
  return list.startsWith('year_1') ? 'year_1' : list.startsWith('year_2') ? 'year_2' : null;
}

export function gradeLabel(grade: string | null): string {
  return GRADE_LABELS[grade ?? 'not_graded'] ?? grade ?? '';
}
