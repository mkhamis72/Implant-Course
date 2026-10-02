import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');

describe('privilege lockdown', () => {
  it('users cannot insert, delete or truncate profiles and settings', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      for (const sql of [
        'delete from public.settings',
        'truncate public.settings',
        'delete from public.profiles where user_id = $1',
        "insert into public.settings (id) values (false)",
      ]) {
        await c.query('savepoint s');
        await expect(c.query(sql, sql.includes('$1') ? [users.target] : [])).rejects.toThrow(/permission denied/);
        await c.query('rollback to savepoint s');
      }
    });
  });

  it('new tables start with no access for anon and no write access for users', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query('create table public.zz_default_priv_probe (id int)');
      const { rows } = await c.query(
        `select has_table_privilege('anon', 'public.zz_default_priv_probe', 'select') as anon_select,
                has_table_privilege('authenticated', 'public.zz_default_priv_probe', 'insert') as auth_insert,
                has_table_privilege('authenticated', 'public.zz_default_priv_probe', 'delete') as auth_delete`,
      );
      expect(rows[0]).toEqual({ anon_select: false, auth_insert: false, auth_delete: false });
    });
  });
});
