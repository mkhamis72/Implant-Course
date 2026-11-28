import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/research/export/fetch-all';
import { caseOutcome, summariseCases, type CaseColumn, type FullArchCaseRow } from '@/lib/research/full-arch';
import { toRehabVars } from '@/lib/research/rehab';
import type { GroupableRow } from '@/lib/research/groups';
import { rpcArgs, type ResearchFilters } from '@/lib/research/view';

export type FullArchCase = FullArchCaseRow & ReturnType<typeof caseOutcome>;

/** First placement (none last), then case id: fetchAll pages by case_id, which replaces the reader's own order. */
const byFirstPlaced = (a: FullArchCaseRow, b: FullArchCaseRow) =>
  a.first_placed_on === b.first_placed_on ? (a.case_id < b.case_id ? -1 : a.case_id > b.case_id ? 1 : 0)
    : a.first_placed_on === null ? 1 : b.first_placed_on === null ? -1 : a.first_placed_on < b.first_placed_on ? -1 : 1;

const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();

/**
 * One column per case type, the cases behind them, and the planned cases left out. `brands` / `systems` are the
 * filter options (from the implants before the brand and line filter, as on Results).
 */
export async function loadFullArch(filters: ResearchFilters): Promise<{
  columns: CaseColumn[]; cases: FullArchCase[]; planned: number; brands: string[]; systems: string[];
}> {
  const supabase = await createClient();
  const args = rpcArgs(filters);
  const byProduct = args.p_brand !== null || args.p_system !== null;
  const [cases, implants, base, rehab, planned] = await Promise.all([
    fetchAll<FullArchCaseRow>(supabase, 'analysis_full_arch_cases', args, ['case_id']),
    fetchAll<GroupableRow>(supabase, 'implant_outcomes_detail', args, ['site_id']),
    byProduct
      ? fetchAll<GroupableRow>(supabase, 'implant_outcomes_detail', { ...args, p_brand: null, p_system: null }, ['site_id'])
      : Promise.resolve(null),
    fetchAll<Record<string, unknown>>(supabase, 'implant_rehab_vars', args, ['site_id']),
    supabase.rpc('full_arch_planned_cases'),
  ]);
  if (cases.error || implants.error || base?.error || rehab.error || planned.error) throw new Error('Could not load the full-arch figures');
  const options = base ? base.data : implants.data;
  return {
    columns: summariseCases(cases.data, implants.data, rehab.data.map(toRehabVars)),
    cases: [...cases.data].sort(byFirstPlaced).map((r) => ({ ...r, ...caseOutcome(r) })),
    planned: Number(planned.data ?? 0),
    brands: distinct([...options.map((r) => r.brand), filters.brand]),
    systems: distinct([...options.filter((r) => !filters.brand || r.brand === filters.brand).map((r) => r.system), filters.system]),
  };
}
