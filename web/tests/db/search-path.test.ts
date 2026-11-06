import { describe, it, expect } from 'vitest';
import { withTx } from './helpers';

// Supabase Advisors lint 0011 (function_search_path_mutable): every function of ours pins its search_path,
// so a caller's search_path can't change which objects its unqualified names resolve to.
describe('functions pin their search_path', () => {
  it('no function in public, app_private or app runs with the caller search_path', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`
        select p.oid::regprocedure::text as fn
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'app_private', 'app')
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
           and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search\\_path=%')
         order by 1`);
      expect(rows.map((r) => r.fn)).toEqual([]);
    });
  });
});
