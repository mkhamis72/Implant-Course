import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

describe('one database foundation (0083)', () => {
  it('seeds academy as the only company', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query('select id, slug, name from public.companies');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: ACADEMY_ID, slug: 'academy' });
      expect(rows[0].name.length).toBeGreaterThan(0);
    });
  });

  it('forces row level security on companies', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.companies'::regclass`,
      );
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });

  it('reads the signed-in user and aal from the JWT', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer, { aal: 'aal2' });
      const { rows } = await c.query('select app.current_user_id() as uid, app.current_aal() as aal');
      expect(rows[0]).toEqual({ uid: users.organizer, aal: 'aal2' });
    });
  });

  it('has no user for anon', async () => {
    await withTx(async (c) => {
      await actAs(c, null);
      const { rows } = await c.query('select app.current_user_id() as uid, app.current_company_id() as company');
      expect(rows[0]).toEqual({ uid: null, company: null });
    });
  });

  it('shows a signed-in user no company until sessions are bound', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      expect((await c.query('select * from public.companies')).rows).toEqual([]);
      await c.query('savepoint s');
      await expect(c.query(`insert into public.companies (slug, name) values ('x', 'X')`)).rejects.toThrow(/permission denied/);
      await c.query('rollback to savepoint s');
    });
  });

  it('keeps company_tables() from API roles', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await expect(c.query('select * from app.company_tables()')).rejects.toThrow(/permission denied/);
    });
  });

  it('lists the company tables', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { rows } = await c.query(`
        select n.nspname || '.' || k.relname as name
        from app.company_tables() t join pg_class k on k.oid = t join pg_namespace n on n.oid = k.relnamespace`);
      const names = rows.map((r) => r.name as string);
      expect(names).toEqual(expect.arrayContaining(['public.patients', 'app_private.research_codes']));
      expect(names).not.toContain('public.companies');
      expect(names).not.toContain('public.profiles');
    });
  });
});
