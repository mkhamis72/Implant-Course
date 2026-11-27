// Statistics → Full arch: one summary column per configuration, from analysis_full_arch_cases (0146) and the Results
// detail rows. A case's status and final-bridge date come from the same rule the patient chart uses (caseStatus /
// caseBridges in src/lib/full-arch/cases.ts).
import { DAYS_PER_MONTH } from '@/lib/dates';
import {
  CONFIGURATIONS, caseBridges, caseStatus,
  type Arch, type CaseRestoration, type CaseSite, type CaseStatus, type Configuration,
} from '@/lib/full-arch/cases';
import { MILESTONE_DAYS, kmEstimate } from './summary';
import type { GroupableRow } from './groups';
import type { RehabVars } from './rehab';

/** The KM figure the Results tiles use. */
export type KmFigure = ReturnType<typeof kmEstimate>;

/** One row of analysis_full_arch_cases. */
export type FullArchCaseRow = {
  case_id: string;
  patient_id: string;
  file_no: string;
  arch: Arch;
  configuration: Configuration;
  closed_at: string | null;
  first_placed_on: string | null;
  implants_placed: number;
  implants_failed: number;
  bridge_problems: number;
  /** Every site of the case. */
  sites: { id: string; tooth: number; state: CaseSite['state'] }[];
  /** The case's live restorations. */
  bridges: { id: string; type: CaseRestoration['type']; stage: CaseRestoration['stage']; fitted_on: string; ended_on: string | null; site_ids: string[] }[];
};

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

export function caseOutcome(row: FullArchCaseRow): { status: CaseStatus; finalBridgeOn: string | null; monthsToBridge: number | null } {
  const c = { id: row.case_id, closed_at: row.closed_at };
  const sites: CaseSite[] = row.sites.map((s) => ({ ...s, case_id: row.case_id }));
  const restorations: CaseRestoration[] = row.bridges.map((b) => ({ ...b, case_id: row.case_id }));
  const finalBridgeOn = caseBridges(c, sites, restorations).deliveredOn;
  const monthsToBridge = finalBridgeOn && row.first_placed_on
    ? (dayNumber(finalBridgeOn) - dayNumber(row.first_placed_on)) / DAYS_PER_MONTH
    : null;
  return { status: caseStatus(c, sites, restorations), finalBridgeOn, monthsToBridge };
}

export type CaseColumn = {
  configuration: Configuration;
  cases: number;
  completed: number;
  closedIncomplete: number;
  monthsToBridge: { median: number | null; min: number | null; max: number | null };
  withBridgeProblem: number;
  bridgeProblems: number;
  lostImplant: number;
  implantsFailed: number;
  implantsPlaced: number;
  medianImplants: number | null;
  survival12: KmFigure | null;
  survival24: KmFigure | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** One column per configuration (All-on-4, All-on-6, All-on-X, Other); a configuration with no case stays, all zeros. */
export function summariseCases(cases: FullArchCaseRow[], implants: GroupableRow[], rehab: RehabVars[]): CaseColumn[] {
  const configOf = new Map(rehab.map((r) => [r.site_id, r.case_configuration]));
  return CONFIGURATIONS.map((configuration) => {
    const mine = cases.filter((c) => c.configuration === configuration);
    const outcomes = mine.map(caseOutcome);
    const months = outcomes.filter((o) => o.status === 'completed' && o.monthsToBridge !== null).map((o) => o.monthsToBridge as number);
    const rows = implants.filter((i) => configOf.get(i.site_id) === configuration);
    return {
      configuration,
      cases: mine.length,
      completed: outcomes.filter((o) => o.status === 'completed').length,
      closedIncomplete: outcomes.filter((o) => o.status === 'closed').length,
      monthsToBridge: {
        median: median(months),
        min: months.length ? Math.min(...months) : null,
        max: months.length ? Math.max(...months) : null,
      },
      withBridgeProblem: mine.filter((c) => c.bridge_problems > 0).length,
      bridgeProblems: sum(mine.map((c) => c.bridge_problems)),
      lostImplant: mine.filter((c) => c.implants_failed > 0).length,
      implantsFailed: sum(mine.map((c) => c.implants_failed)),
      implantsPlaced: sum(mine.map((c) => c.implants_placed)),
      medianImplants: median(mine.map((c) => c.implants_placed)),
      survival12: rows.length ? kmEstimate(rows, MILESTONE_DAYS.year_1) : null,
      survival24: rows.length ? kmEstimate(rows, MILESTONE_DAYS.year_2) : null,
    };
  });
}
