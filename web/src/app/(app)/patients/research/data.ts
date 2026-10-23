import { createClient } from '@/lib/supabase/server';
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
    supabase.rpc('implant_outcomes_detail', args),
    byProduct
      ? supabase.rpc('implant_outcomes_detail', { ...args, p_brand: null, p_system: null })
      : Promise.resolve(null),
    supabase.rpc('crown_outcomes_detail', args),
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
