import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/research/export/fetch-all';
import { rpcArgs, type CrownDetailRow, type DetailRow, type ResearchFilters } from '@/lib/research/view';

export type ResearchRow = DetailRow & { placing_delegate_id: string | null; placing_delegate: string | null };

/**
 * The filtered implants and crowns, plus `base`: the implants before the brand / type filter (for the brand and
 * line options and the no-product note — a brand filter always drops implants without a product).
 */
export async function loadResearch(filters: ResearchFilters) {
  const supabase = await createClient();
  const args = rpcArgs(filters);
  const byProduct = args.p_brand !== null || args.p_system !== null;
  const [version, implants, base, crowns] = await Promise.all([
    supabase.rpc('outcomes_version'),
    fetchAll<ResearchRow>(supabase, 'implant_outcomes_detail', args, ['site_id']),
    byProduct
      ? fetchAll<ResearchRow>(supabase, 'implant_outcomes_detail', { ...args, p_brand: null, p_system: null }, ['site_id'])
      : Promise.resolve(null),
    fetchAll<CrownDetailRow>(supabase, 'crown_outcomes_detail', args, ['restoration_id']),
  ]);
  if (version.error || implants.error || base?.error || crowns.error) throw new Error('Could not load the research figures');
  const rows = (implants.data ?? []) as ResearchRow[];
  return {
    version: version.data as string,
    rows,
    base: base ? ((base.data ?? []) as ResearchRow[]) : rows,
    crowns: (crowns.data ?? []) as CrownDetailRow[],
  };
}
