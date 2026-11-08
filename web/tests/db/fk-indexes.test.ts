import { describe, it, expect } from 'vitest';
import { withTx } from './helpers';

/**
 * Every link between tables has an index on its column, so deleting or looking up the row it points at doesn't
 * read the whole table. A (company_id, x) link counts as indexed when an index starts with x. Who-did-it columns
 * (created_by, voided_by …) are left out: they point at profiles, which are almost never deleted.
 */
const WHO_COLUMNS = ['created_by', 'voided_by', 'recorded_by', 'uploaded_by', 'done_by', 'actor_id', 'author_id'];

describe('foreign key indexes', () => {
  it('every foreign key in public and app_private has an index on its main column', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select c.conrelid::regclass::text || '(' || a.attname || ')' as fk
         from pg_constraint c
         join pg_namespace n on n.oid = c.connamespace
         cross join lateral unnest(c.conkey) k(attnum)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         where c.contype = 'f' and n.nspname in ('public', 'app_private')
           and a.attname <> 'company_id' and a.attname <> all($1)
           and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                             and (i.indkey[0] = k.attnum
                                  or (i.indkey[1] = k.attnum
                                      and i.indkey[0] = (select attnum from pg_attribute
                                                         where attrelid = c.conrelid and attname = 'company_id'))))
         order by 1`,
        [WHO_COLUMNS],
      );
      expect(rows.map((r) => r.fk)).toEqual([]);
    });
  });
});
