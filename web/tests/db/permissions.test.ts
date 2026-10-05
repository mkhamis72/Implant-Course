import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeCourse, makeProduct, receive, setPerms } from './fixtures';

const users = inject('testUsers');
const AREAS = ['patients', 'schedule', 'courses', 'checklists', 'inventory', 'delegates'];

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}
const can = async (c: Client, area: string, level: string) =>
  (await c.query('select public.can($1, $2) as ok', [area, level])).rows[0].ok as boolean;

describe('permissions: helpers and defaults', () => {
  it('a new organizer starts with View everywhere; an admin demoted to organizer too', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-perm-new@example.com') returning id`,
      );
      const id = rows[0].id;
      const perms = await c.query('select area, level from public.user_permissions where user_id = $1 order by area', [id]);
      expect(perms.rows).toEqual([...AREAS].sort().map((area) => ({ area, level: 'view' })));
      await c.query(`update public.profiles set role = 'admin', active = true where user_id = $1`, [id]);
      await c.query('delete from public.user_permissions where user_id = $1', [id]);
      await c.query(`update public.profiles set role = 'organizer' where user_id = $1`, [id]);
      const again = await c.query(`select count(*)::int as n from public.user_permissions where user_id = $1 and level = 'view'`, [id]);
      expect(again.rows[0].n).toBe(6);
    });
  });

  it('existing organizers were given Edit everywhere', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from public.user_permissions where user_id = $1 and level = 'edit'`, [
        users.organizer,
      ]);
      expect(rows[0].n).toBe(6);
    });
  });

  it('can(): admin passes everything; organizer per row; edit implies view', async () => {
    await withTx(async (c) => {
      await setPerms(c, users.target, { inventory: 'edit', courses: 'view' });
      await actAs(c, users.admin);
      expect(await can(c, 'patients', 'edit')).toBe(true);
      await actAs(c, users.target);
      expect(await can(c, 'inventory', 'view')).toBe(true);
      expect(await can(c, 'inventory', 'edit')).toBe(true);
      expect(await can(c, 'courses', 'view')).toBe(true);
      expect(await can(c, 'courses', 'edit')).toBe(false);
      expect(await can(c, 'patients', 'view')).toBe(false);
      await actAs(c, users.inactive);
      expect(await can(c, 'inventory', 'view')).toBe(false);
    });
  });

  it('set_user_permissions: admin only, not on self, organizers only; replaces rows', async () => {
    await withTx(async (c) => {
      const grid = JSON.stringify({ patients: 'edit', schedule: 'view', inventory: null });
      await actAs(c, users.organizer);
      await refused(c, () => c.query('select public.set_user_permissions($1, $2::jsonb)', [users.target, grid]), /Only an admin/);
      await actAs(c, users.admin);
      await refused(c, () => c.query('select public.set_user_permissions($1, $2::jsonb)', [users.admin, grid]), /your own/);
      await refused(c, () => c.query('select public.set_user_permissions($1, $2::jsonb)', [users.target, '{"bogus":"edit"}']), /Unknown area/);
      await refused(c, () => c.query('select public.set_user_permissions($1, $2::jsonb)', [users.target, '{"patients":"all"}']), /Unknown level/);
      await c.query('select public.set_user_permissions($1, $2::jsonb)', [users.target, grid]);
      const { rows } = await c.query('select area, level from public.user_permissions where user_id = $1 order by area', [users.target]);
      expect(rows).toEqual([
        { area: 'patients', level: 'edit' },
        { area: 'schedule', level: 'view' },
      ]);
    });
  });

  it('organizers read only their own permission rows; nobody writes them directly', async () => {
    await withTx(async (c) => {
      await actAs(c, users.target);
      const { rows } = await c.query('select distinct user_id from public.user_permissions');
      expect(rows.every((r) => r.user_id === users.target)).toBe(true);
      await refused(c, () => c.query(`insert into public.user_permissions values ($1, 'patients', 'edit')`, [users.target]), /permission denied/);
    });
  });

  it('a delegate profile is not an active (staff) user', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const d = (await c.query(`insert into public.delegates (full_name) values ('Zz Perm Delegate') returning id`)).rows[0].id;
      await c.query(`update public.profiles set role = 'delegate', delegate_id = $2, active = true where user_id = $1`, [users.target, d]);
      await actAs(c, users.target);
      const r = await c.query('select public.is_active_user() as staff, public.is_delegate_user() as delegate, public.my_delegate_id() as me');
      expect(r.rows[0]).toEqual({ staff: false, delegate: true, me: d });
      await asPostgres(c);
      await refused(c, () => c.query(`update public.profiles set delegate_id = null where user_id = $1`, [users.target]), /profiles_delegate_link/);
    });
  });
});

const NIL = '00000000-0000-0000-0000-000000000000';
const DENIED = /permission|row-level security/;

describe('permissions: area matrix', () => {
  // One representative readable table and one representative write per area.
  const cases: { area: string; table: string; write: (c: Client) => Promise<unknown> }[] = [
    { area: 'patients', table: 'medical_history', write: (c) => c.query(`insert into public.patients (full_name) values ('Zz Perm Patient')`) },
    { area: 'schedule', table: 'surgery_slots', write: (c) => c.query('select public.cancel_surgery_slot($1, $2)', [NIL, 'Reason']) },
    { area: 'courses', table: 'courses', write: (c) => makeCourse(c) },
    { area: 'checklists', table: 'checklists', write: (c) => c.query('select public.toggle_checklist_item($1, true)', [NIL]) },
    { area: 'inventory', table: 'stock_movements', write: async (c) => receive(c, await makeProduct(c), 1, 'ZZPERM') },
    { area: 'delegates', table: 'delegates', write: (c) => c.query(`insert into public.delegates (full_name) values ('Zz Perm Del')`) },
  ];

  for (const k of cases) {
    it(`${k.area}: None hides rows and refuses writes; View reads only; Edit writes`, async () => {
      await withTx(async (c) => {
        await setPerms(c, users.target, {});
        await actAs(c, users.target);
        const none = await c.query(`select count(*)::int as n from public.${k.table}`);
        // delegates is a reference list every staff member reads
        if (k.area === 'delegates') expect(none.rows[0].n).toBeGreaterThan(0);
        else expect(none.rows[0].n).toBe(0);
        await refused(c, () => k.write(c), DENIED);

        await setPerms(c, users.target, { [k.area]: 'view' });
        await actAs(c, users.target);
        await refused(c, () => k.write(c), DENIED);

        await setPerms(c, users.target, { [k.area]: 'edit' });
        await actAs(c, users.target);
        await c.query('savepoint w');
        // Edit passes the permission check; a business error (e.g. "not found") is fine.
        await k.write(c).catch((e: Error) => expect(e.message).not.toMatch(DENIED));
        await c.query('rollback to savepoint w');
      });
    });
  }

  it('patients are readable with Schedule view (names on the schedule), medical history is not', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await c.query(`insert into public.patients (full_name) values ('Zz Perm Sched Patient')`);
      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      const p = await c.query(`select count(*)::int as n from public.patients where full_name = 'Zz Perm Sched Patient'`);
      expect(p.rows[0].n).toBe(1);
      const mh = await c.query('select count(*)::int as n from public.medical_history');
      expect(mh.rows[0].n).toBe(0);
    });
  });

  it('the refusal names the area', async () => {
    await withTx(async (c) => {
      await setPerms(c, users.target, { inventory: 'view' });
      await actAs(c, users.target);
      await refused(
        c,
        () => c.query(`select public.adjust_stock($1, 1, 'adjust', 'x')`, [NIL]),
        /You don't have permission to edit Inventory\./,
      );
    });
  });
});

describe('permissions: guard rails', () => {
  it('every public security-definer function checks a permission or is allow-listed', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.prosrc not like '%require_perm(%'`);
      const allow = new Set([
        'is_active_user', 'is_admin', 'is_delegate_user', 'my_delegate_id', 'can',
        'set_user_permissions', 'my_schedule', 'my_report', 'next_file_no',
      ]);
      expect(rows.map((r) => r.proname).filter((n) => !allow.has(n)).sort()).toEqual([]);
    });
  });

  it('every public table has an area policy or is a shared/admin table', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = c.relname
                          and pp.permissive = 'RESTRICTIVE')`);
      const shared = new Set(['profiles', 'settings', 'user_permissions', 'chairs', 'supervisors', 'lecturers', 'stock_lots']);
      expect(rows.map((r) => r.relname).filter((n) => !shared.has(n)).sort()).toEqual([]);
    });
  });
});
