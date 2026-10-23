// Research page "Compare by": implants split into groups (from the detail rows and implant_outcomes_groups), each
// group's KM figures, and the log-rank test across groups. Statuses come from SQL; nothing here recomputes one.
import { LOADING_LABELS, loadingFrom } from '@/lib/restorations/restorations';
import { TECHNIQUE_LABELS } from '@/lib/inventory/types';
import { logRank, thinData } from './stats';
import { MILESTONE_DAYS, kmEstimate, type ImplantRow } from './summary';

const MONTH_DAYS = 30.4375;

export const COMPARE_KEYS = ['brand', 'technique', 'loading', 'smoking', 'diabetes', 'periodontitis', 'bone_type'] as const;
export type CompareKey = (typeof COMPARE_KEYS)[number];

export const COMPARE_LABELS: Record<CompareKey, string> = {
  brand: 'Brand / line',
  technique: 'Technique',
  loading: 'Loading',
  smoking: 'Smoking',
  diabetes: 'Diabetes',
  periodontitis: 'Periodontitis history',
  bone_type: 'Bone type',
};

export function isCompareKey(v: string | undefined): v is CompareKey {
  return (COMPARE_KEYS as readonly string[]).includes(v ?? '');
}

/** Comparisons that need implant_outcomes_groups (brand and loading come from the detail rows). */
export function needsGroupVars(key: CompareKey | null): boolean {
  return key !== null && key !== 'brand' && key !== 'loading';
}

/** One row of implant_outcomes_groups (0071); null = not recorded. */
export type GroupVars = {
  site_id: string;
  technique: string | null;
  bone_type: string | null;
  smoking: string | null;
  diabetes_status: string | null;
  periodontitis_history: string | null;
};

export type GroupableRow = ImplantRow & {
  site_id: string;
  placed_on: string;
  loaded_on?: string | null;
  brand: string | null;
  system: string | null;
};

export type Group<R> = { label: string; rows: R[]; notAssessed: boolean };

const YES_NO: [string, string][] = [['no', 'No'], ['yes', 'Yes']];
const BY_VARIABLE: Record<'technique' | 'smoking' | 'diabetes' | 'periodontitis' | 'bone_type', { field: keyof GroupVars; values: [string, string][] }> = {
  technique: { field: 'technique', values: Object.entries(TECHNIQUE_LABELS) },
  smoking: { field: 'smoking', values: [['never', 'Never'], ['former', 'Former'], ['current', 'Current']] },
  diabetes: { field: 'diabetes_status', values: YES_NO },
  periodontitis: { field: 'periodontitis_history', values: YES_NO },
  bone_type: { field: 'bone_type', values: ['D1', 'D2', 'D3', 'D4'].map((d) => [d, d]) },
};

/**
 * The implants split by `key`, in a fixed order, empty groups left out. A missing value ("Not assessed", or no
 * product for brand) is its own last group with `notAssessed`: shown, but never in the test. Brand groups are
 * `brand · line` when every implant has the same brand. Loading follows the part-3 rule; "Not loaded" is a group.
 */
export function groupRows<R extends GroupableRow>(rows: R[], groups: GroupVars[], key: CompareKey): Group<R>[] {
  const vars = new Map(groups.map((g) => [g.site_id, g]));
  let order: string[];
  let labelOf: (r: R) => string | null;
  let missing = 'Not assessed';

  if (key === 'brand') {
    const multiBrand = new Set(rows.map((r) => r.brand).filter(Boolean)).size > 1;
    labelOf = (r) => (r.brand === null ? null : !multiBrand && r.system ? `${r.brand} · ${r.system}` : r.brand);
    order = [...new Set(rows.map(labelOf).filter((l): l is string => l !== null))].sort((a, b) => a.localeCompare(b));
    missing = 'No product recorded';
  } else if (key === 'loading') {
    labelOf = (r) => (r.loaded_on ? LOADING_LABELS[loadingFrom(r.placed_on, r.loaded_on)] : 'Not loaded');
    order = [...Object.values(LOADING_LABELS), 'Not loaded'];
  } else {
    const { field, values } = BY_VARIABLE[key];
    const labels = new Map(values);
    labelOf = (r) => {
      const v = vars.get(r.site_id)?.[field] ?? null;
      return v === null ? null : (labels.get(v) ?? v);
    };
    order = values.map(([, label]) => label);
  }

  const out = new Map<string, Group<R>>(order.map((label) => [label, { label, rows: [], notAssessed: false }]));
  const notAssessed: Group<R> = { label: missing, rows: [], notAssessed: true };
  for (const r of rows) {
    const label = labelOf(r);
    if (label === null) notAssessed.rows.push(r);
    else {
      if (!out.has(label)) out.set(label, { label, rows: [], notAssessed: false });
      out.get(label)!.rows.push(r);
    }
  }
  return [...out.values(), notAssessed].filter((g) => g.rows.length > 0);
}

const known = (rows: ImplantRow[]) => rows.filter((r) => !r.event_time_unknown);

/** One group's row in the compare table. Failures count only those with a known date (the KM ones). */
export function groupSummary(rows: ImplantRow[]) {
  const icoiGood = rows.filter((r) => r.latest_grade === 'I' || r.latest_grade === 'II').length;
  return {
    implants: rows.length,
    failures: known(rows).filter((r) => r.event).length,
    unknownDate: rows.filter((r) => r.event_time_unknown).length,
    y1: kmEstimate(rows, MILESTONE_DAYS.year_1),
    y2: kmEstimate(rows, MILESTONE_DAYS.year_2),
    icoiGood,
    icoiPct: rows.length === 0 ? null : (icoiGood / rows.length) * 100,
  };
}

/**
 * Log-rank across the groups that aren't "not assessed", on the implants with a known failure date. It runs when
 * at least two groups have an implant and there is at least one failure; thin data only adds the warning.
 */
export function compareGroups(groups: Group<ImplantRow>[]) {
  const tested = groups.filter((g) => !g.notAssessed).map((g) => known(g.rows)).filter((g) => g.length > 0);
  const n = tested.reduce((s, g) => s + g.length, 0);
  const events = tested.reduce((s, g) => s + g.filter((r) => r.event).length, 0);
  const unknownDate = groups.reduce((s, g) => s + g.rows.filter((r) => r.event_time_unknown).length, 0);
  const base = { n, events, unknownDate, p: null as number | null, chisq: null as number | null, df: null as number | null, thin: false };
  if (tested.length < 2) return { ...base, status: 'one_group' as const };
  if (events === 0) return { ...base, status: 'no_failures' as const };
  const lr = logRank(tested.map((g) => g.map((r) => ({ months: r.follow_up_days / MONTH_DAYS, event: r.event }))));
  return {
    ...base,
    status: lr.p === null ? ('undefined' as const) : ('ok' as const),
    p: lr.p,
    chisq: lr.chisq,
    df: lr.df,
    thin: thinData(n, events, Math.min(...tested.map((g) => g.length))),
  };
}

// Page copy (owner wording, global constraints).
export const CLUSTER_NOTE = 'Patients can have several implants; these figures treat implants as independent. Use the R script for patient-clustered models.';
export const OPERATOR_NOTE = 'Group comparisons here are not adjusted for who placed the implant or the course.';
export const LOADING_BIAS_NOTE = 'Late-loaded implants had to survive until loading, so this comparison is biased; no test is shown.';
export const NO_FAILURES_NOTE = "No failures yet, so this can't be estimated";

export function thinWarning(n: number, events: number): string {
  return `⚠ Not enough data — interpret with caution (n = ${n}, ${events} failure${events === 1 ? '' : 's'})`;
}

export function unknownDateNote(k: number): string {
  return `${k} failure${k === 1 ? '' : 's'} with unknown date not included`;
}
