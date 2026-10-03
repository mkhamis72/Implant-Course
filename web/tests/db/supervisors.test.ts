import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('supervisors', () => {
  it('every profile has a supervisor with the same id', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        'select count(*)::int as n from public.profiles p where not exists (select 1 from public.supervisors s where s.id = p.user_id)',
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('organizers read all supervisors, including inactive ones; only admins write', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query('select active from public.supervisors where id = $1', [users.inactive]);
      expect(rows).toEqual([{ active: false }]);
      await refused(c, () => c.query(`insert into public.supervisors (full_name) values ('Zz Sup Nope')`), /row-level security/);
      await actAs(c, users.admin);
      const added = await c.query(`insert into public.supervisors (full_name) values ('Zz Sup Visiting') returning id`);
      await c.query('update public.supervisors set active = false where id = $1', [added.rows[0].id]);
    });
  });

  it('placing with an inactive supervisor is refused; renames show in lot usage', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c);
      const implant = await makeProduct(c);
      const lot = await receive(c, implant, 2, 'SUP');
      const delegate = await makeDelegate(c);
      await refused(
        c,
        () => place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.inactive }),
        /Choose an active supervisor/,
      );
      await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer });
      await asPostgres(c);
      await c.query(`update public.supervisors set full_name = 'Zz Renamed Sup' where id = $1`, [users.organizer]);
      await actAs(c, users.organizer);
      const { rows } = await c.query('select supervisor from public.lot_usage($1)', [lot]);
      expect(rows).toEqual([{ supervisor: 'Zz Renamed Sup' }]);
    });
  });
});
